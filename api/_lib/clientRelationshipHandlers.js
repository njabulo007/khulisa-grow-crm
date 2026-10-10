import crypto from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";
import { createHttpError, json, methodNotAllowed, parseBody } from "./http.js";
import { leadFollowUpDay } from "./leadFollowUpHandlers.js";
import { paymentFollowUpDay } from "./paymentFollowUpHandlers.js";
const id = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 128 &&
  !value.includes("/");
const text = (value, max, required = false) =>
  typeof value === "string" &&
  value.length <= max &&
  (!required || value.trim());
const money = (value) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1e9 &&
  Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const decisions = ["approved", "rejected", "changes-requested"];
const types = ["additional-service", "renewal", "referral"];

export function createClientRelationshipHandlers({
  db,
  authenticate,
  clientContext,
  notifyOwners,
  notifySubmitter,
  now = () => Date.now(),
}) {
  const page = async (query, cursor) => {
    if (cursor !== undefined && !id(cursor))
      throw createHttpError(400, "Invalid page cursor.");
    let current = query.orderBy(FieldPath.documentId(), "asc");
    if (cursor) current = current.startAfter(cursor);
    const result = await current.limit(51).get();
    const docs = result.docs.slice(0, 50);
    return { docs, cursor: result.docs.length > 50 ? docs.at(-1).id : null };
  };
  const handler = (kind) => async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    const payload = parseBody(req);
    const feedback = kind === "feedback";
    const collection = feedback ? "client_feedback" : "client_opportunities";
    const revisions = feedback
      ? "client_feedback_revisions"
      : "client_opportunity_revisions";
    try {
      const actor = await authenticate(req);
      if (payload.action === "list") {
        if (payload.clientId !== undefined)
          await clientContext(actor, payload.clientId);
        if (feedback && !id(payload.clientId))
          throw createHttpError(400, "Choose a client.");
        const query = payload.clientId
          ? db.collection(collection).where("clientId", "==", payload.clientId)
          : actor.role === "owner"
            ? db.collection(collection)
            : db.collection(collection).where("proposedByUid", "==", actor.uid);
        const result = await page(query, payload.cursor);
        const records = [];
        const clients = new Map();
        for (const doc of result.docs) {
          const record = doc.data();
          try {
            if (!clients.has(record.clientId))
              clients.set(
                record.clientId,
                await clientContext(actor, record.clientId),
              );
            records.push({
              id: doc.id,
              ...record,
              clientName: clients.get(record.clientId).data().businessName,
              canEditProposal:
                !feedback &&
                (actor.role === "owner" ||
                  record.proposedByUid === actor.uid) &&
                ["proposed", "needs-changes"].includes(record.status),
            });
          } catch (error) {
            if (![403, 404].includes(error.status)) throw error;
          }
        }
        return json(res, 200, { records, cursor: result.cursor });
      }
      if (!id(payload.clientId)) throw createHttpError(400, "Choose a client.");
      await clientContext(actor, payload.clientId);
      if (payload.action === "history") {
        if (!id(payload.recordId))
          throw createHttpError(400, "Choose a record.");
        const current = await db
          .collection(collection)
          .doc(payload.recordId)
          .get();
        if (!current.exists || current.data().clientId !== payload.clientId)
          throw createHttpError(404, "Record unavailable.");
        const result = await page(
          db.collection(revisions).where("recordId", "==", payload.recordId),
          payload.cursor,
        );
        return json(res, 200, {
          revisions: result.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
          cursor: result.cursor,
        });
      }
      if (
        !["create", "revise", "review"].includes(payload.action) ||
        !id(payload.requestId) ||
        (payload.action !== "create" &&
          (!id(payload.recordId) ||
            !Number.isInteger(payload.version) ||
            payload.version < 1)) ||
        (feedback && payload.action === "review")
      )
        throw createHttpError(400, "A valid record update is required.");
      const review = payload.action === "review";
      if (review && actor.role !== "owner")
        throw createHttpError(
          403,
          "Only the owner can approve scope and pricing.",
        );
      if (feedback) {
        if (
          !text(payload.title, 160, true) ||
          !text(payload.deliverableVersion, 120, true) ||
          !decisions.includes(payload.decision) ||
          !text(payload.decidedBy, 160, true) ||
          !text(payload.notes, 10000, true) ||
          leadFollowUpDay(payload.decisionDate) !== payload.decisionDate ||
          payload.decisionDate > paymentFollowUpDay(now())
        )
          throw createHttpError(
            400,
            "Describe the deliverable, version, client decision, person, date, and supporting feedback.",
          );
      } else if (review) {
        if (
          !["approved", "needs-changes", "declined"].includes(payload.status) ||
          !text(payload.ownerNote, 4000, payload.status !== "approved") ||
          (payload.status === "approved" &&
            (!text(payload.approvedScope, 10000, true) ||
              !money(payload.approvedPrice)))
        )
          throw createHttpError(
            400,
            "Approve a clear scope and price in rand, or explain the requested changes or decline.",
          );
      } else if (
        !text(payload.title, 160, true) ||
        !types.includes(payload.type) ||
        !text(payload.proposal, 10000, true) ||
        !text(payload.suggestedScope, 10000, true) ||
        (payload.suggestedPrice !== null && !money(payload.suggestedPrice)) ||
        (payload.targetDate !== "" &&
          leadFollowUpDay(payload.targetDate) !== payload.targetDate)
      )
        throw createHttpError(
          400,
          "Enter the opportunity, proposal, suggested scope, optional price, and a valid target date.",
        );
      const recordId =
        payload.action === "create"
          ? `${feedback ? "feedback" : "growth"}_${digest(`${actor.uid}:${payload.clientId}:${payload.requestId}`)}`
          : payload.recordId;
      const ref = db.collection(collection).doc(recordId);
      const activityRef = db
        .collection("activities")
        .doc(
          `client_relationship_${digest(`${kind}:${actor.uid}:${payload.clientId}:${payload.requestId}`)}`,
        );
      const result = await db.runTransaction(async (tx) => {
        const client = await clientContext(actor, payload.clientId, (item) =>
          tx.get(item),
        );
        const [snapshot, previous] = await Promise.all([
          tx.get(ref),
          tx.get(activityRef),
        ]);
        const current = snapshot.data();
        if (current && current.clientId !== payload.clientId)
          throw createHttpError(404, "Record unavailable.");
        if (previous.exists)
          return { record: { id: ref.id, ...current }, duplicate: true };
        if (payload.action === "create" ? snapshot.exists : !snapshot.exists)
          throw createHttpError(
            409,
            "Record unavailable. Refresh and try again.",
          );
        if (current && current.version !== payload.version)
          throw createHttpError(
            409,
            "This record changed. Refresh before saving the next revision.",
          );
        if (
          !feedback &&
          current &&
          !review &&
          actor.role !== "owner" &&
          current.proposedByUid !== actor.uid
        )
          throw createHttpError(
            403,
            "Only the proposer or owner can revise this proposal.",
          );
        if (
          !feedback &&
          current &&
          !review &&
          !["proposed", "needs-changes"].includes(current.status)
        )
          throw createHttpError(
            409,
            "Ask the owner to request changes before revising an approved or declined opportunity.",
          );
        const timestamp = new Date(now()).toISOString();
        const version = (current?.version || 0) + 1;
        const record = {
          ...(current || {}),
          clientId: payload.clientId,
          version,
          createdAt: current?.createdAt || timestamp,
          updatedAt: timestamp,
          updatedBy: actor.uid,
        };
        if (feedback)
          Object.assign(record, {
            title: payload.title.trim(),
            deliverableVersion: payload.deliverableVersion.trim(),
            decision: payload.decision,
            decisionDate: payload.decisionDate,
            decidedBy: payload.decidedBy.trim(),
            notes: payload.notes.trim(),
            recordedByUid: current?.recordedByUid || actor.uid,
          });
        else if (review)
          Object.assign(record, {
            status: payload.status,
            ownerNote: payload.ownerNote.trim(),
            reviewedBy: actor.uid,
            reviewedAt: timestamp,
            approvedScope:
              payload.status === "approved" ? payload.approvedScope.trim() : "",
            approvedPrice:
              payload.status === "approved" ? payload.approvedPrice : null,
          });
        else
          Object.assign(record, {
            title: payload.title.trim(),
            type: payload.type,
            proposal: payload.proposal.trim(),
            suggestedScope: payload.suggestedScope.trim(),
            suggestedPrice: payload.suggestedPrice,
            targetDate: payload.targetDate,
            status: "proposed",
            proposedByUid: current?.proposedByUid || actor.uid,
            proposedByName:
              current?.proposedByName || actor.name || actor.email || actor.uid,
            approvedScope: "",
            approvedPrice: null,
          });
        tx.set(ref, record);
        tx.set(
          db
            .collection(revisions)
            .doc(`${recordId}_${String(version).padStart(10, "0")}`),
          { ...record, recordId, revisionAction: payload.action },
        );
        tx.set(activityRef, {
          type: "note",
          entityType: "client",
          entityId: payload.clientId,
          createdBy: actor.appUserId || actor.uid,
          createdAt: timestamp,
          description: feedback
            ? `Client feedback · ${record.title} (${record.deliverableVersion})\n\n${record.decision.replaceAll("-", " ")} by ${record.decidedBy} on ${record.decisionDate}\n\n${record.notes}`
            : review
              ? `Growth opportunity · ${record.title}\n\n${record.status.replaceAll("-", " ")}${record.status === "approved" ? ` · R ${record.approvedPrice.toFixed(2)}\n\nApproved scope: ${record.approvedScope}` : ""}\n\n${record.ownerNote}`
              : `Growth opportunity proposed · ${record.title}\n\n${record.proposal}`,
        });
        return {
          record: { id: ref.id, ...record },
          clientName: client.data().businessName,
          duplicate: false,
        };
      });
      if (!result.duplicate) {
        const notification = {
          type: feedback ? "client_feedback" : "client_opportunity",
          clientId: payload.clientId,
          title: feedback
            ? `Client feedback: ${result.clientName}`
            : review
              ? `Opportunity ${result.record.status.replaceAll("-", " ")}`
              : `Growth proposal: ${result.clientName}`,
          message: feedback
            ? `${result.record.title}: ${result.record.decision.replaceAll("-", " ")} · ${result.record.decidedBy}`
            : review
              ? `${result.record.title}. Open the client to review the approved scope, pricing, or owner feedback.`
              : `${result.record.title}. Review the proposed scope and pricing.`,
        };
        try {
          if (review)
            await notifySubmitter(
              result.record.proposedByUid,
              `growth:${activityRef.id}`,
              notification,
            );
          else
            await notifyOwners(
              `${kind}:${activityRef.id}`,
              { clientId: payload.clientId },
              notification,
            );
        } catch (error) {
          console.error("[Client relationship notification]", {
            code: error.code || error.status || "unknown",
          });
        }
      }
      return json(res, 200, result.record);
    } catch (error) {
      if (!error.status)
        console.error("[Client relationship API]", {
          kind,
          action: payload.action,
          code: error.code || "unknown",
          message: error.message,
        });
      return json(res, error.status || 500, {
        error: error.status
          ? error.message
          : "Client feedback or opportunity could not be processed. Refresh and try again.",
      });
    }
  };
  return {
    feedback: handler("feedback"),
    opportunities: handler("opportunity"),
  };
}
