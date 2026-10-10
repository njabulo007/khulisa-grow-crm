import crypto from "node:crypto";
import { createHttpError, json, parseBody, methodNotAllowed } from "./http.js";
import {
  computeShareStatus,
  tokenHash,
  isProjectClosed,
} from "./projectShareCore.js";
import { FieldPath } from "firebase-admin/firestore";
const id = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const text = (v, max) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
export const materialLabels = {
  logo: "Logo and brand assets",
  content: "Website content",
  access: "Platform access invitation",
  contract: "Signed contract",
  requirements: "Client requirements",
};
export function createPortalResponseHandler({
  db,
  now = () => Date.now(),
  notify = async () => {},
}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    try {
      const p = parseBody(req);
      if (
        !text(p.token, 200) ||
        !id(p.requestId) ||
        !["decision", "request"].includes(p.action) ||
        !text(p.contactName, 120) ||
        !text(p.notes, 4000)
      )
        throw createHttpError(400, "Add your name and response details.");
      if (
        p.action === "decision" &&
        (!id(p.reviewId) ||
          !["approved", "changes-requested", "rejected"].includes(p.decision))
      )
        throw createHttpError(400, "Choose a valid review decision.");
      if (p.action === "request" && !text(p.title, 160))
        throw createHttpError(400, "Add a request title.");
      const shares = await db
        .collection("project_shares")
        .where("tokenHash", "==", tokenHash(p.token))
        .limit(1)
        .get();
      if (shares.empty)
        throw createHttpError(404, "This portal link is unavailable.");
      const shareRef = shares.docs[0].ref;
      const result = await db.runTransaction(async (tx) => {
        const shareDoc = await tx.get(shareRef),
          share = shareDoc.data();
        if (!share || computeShareStatus(share, now()) !== "active")
          throw createHttpError(
            403,
            "This portal link has expired or was revoked.",
          );
        const project = await tx.get(
          db.collection("projects").doc(share.projectId),
        );
        if (!project.exists || project.data()._deleting)
          throw createHttpError(403, "The project is closed or unavailable.");
        if (p.action === "decision" && isProjectClosed(project.data().status))
          throw createHttpError(
            409,
            "This project is delivered. Submit a new change request instead.",
          );
        const client = await tx.get(
          db.collection("clients").doc(project.data().clientId),
        );
        if (!client.exists || client.data()._deleting)
          throw createHttpError(403, "Client is unavailable.");
        const responseRef = db
            .collection("portal_responses")
            .doc(hash(`${shareDoc.id}:${p.requestId}`)),
          existing = await tx.get(responseRef);
        const day = new Date(now() + 7200000).toISOString().slice(0, 10),
          counterRef = db
            .collection("_portal_limits")
            .doc(`${shareDoc.id}_${day}`),
          counter = await tx.get(counterRef);
        if (existing.exists) {
          const saved = existing.data();
          if (
            saved.kind !== p.action ||
            saved.contactName !== p.contactName.trim() ||
            saved.notes !== p.notes.trim() ||
            (p.action === "decision"
              ? saved.decision !== p.decision || saved.reviewId !== p.reviewId
              : saved.title !== p.title.trim())
          )
            throw createHttpError(
              409,
              "This response attempt already has different details.",
            );
          return { id: existing.id, status: saved.status };
        }
        const current = project.data().portalReview;
        if (
          p.action === "decision" &&
          (!current || current.id !== p.reviewId || current.status !== "open")
        )
          throw createHttpError(
            409,
            "This revision is no longer awaiting review. Refresh the portal.",
          );
        const value = {
          projectId: project.id,
          clientId: client.id,
          shareId: shareDoc.id,
          kind: p.action,
          contactName: p.contactName.trim(),
          notes: p.notes.trim(),
          title: p.action === "request" ? p.title.trim() : current.title,
          decision: p.action === "decision" ? p.decision : "",
          reviewId: p.action === "decision" ? current.id : "",
          deliverableVersion: p.action === "decision" ? current.version : "",
          status: "pending-verification",
          createdAt: new Date(now()).toISOString(),
        };
        if (Number(counter.data()?.count || 0) >= 10)
          throw createHttpError(
            429,
            "Today’s response limit is reached. Contact your project team.",
          );
        tx.set(responseRef, value);
        tx.set(counterRef, {
          shareId: shareDoc.id,
          clientId: client.id,
          projectId: project.id,
          count: Number(counter.data()?.count || 0) + 1,
          expiresAt: new Date(now() + 172800000),
        });
        return { id: responseRef.id, status: value.status };
      });
      try {
        await notify({
          id: result.id,
          projectId: shares.docs[0].data().projectId,
        });
      } catch (e) {
        console.error("[Portal notice]", { code: e.code || "unknown" });
      }
      return json(res, 200, result);
    } catch (e) {
      return json(res, e.status || 500, {
        error: e.status
          ? e.message
          : "Your response could not be saved. Retry with the same details.",
      });
    }
  };
}
export function createPortalStaffHandler({
  db,
  requireOwner,
  now = () => Date.now(),
  notify = async () => {},
}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    try {
      const actor = await requireOwner(req),
        p = parseBody(req);
      if (!id(p.projectId)) throw createHttpError(400, "Select a project.");
      if (p.action === "portal-responses") {
        let query = db
          .collection("portal_responses")
          .where("projectId", "==", p.projectId)
          .orderBy(FieldPath.documentId(), "asc");
        if (p.cursor) {
          if (!id(p.cursor)) throw createHttpError(400, "Invalid cursor.");
          query = query.startAfter(p.cursor);
        }
        const project = await db.collection("projects").doc(p.projectId).get();
        if (!project.exists || project.data()._deleting)
          throw createHttpError(404, "Project unavailable.");
        const result = await query.limit(51).get(),
          docs = result.docs.slice(0, 50);
        return json(res, 200, {
          responses: docs.map((d) => ({ id: d.id, ...d.data() })),
          cursor: result.docs.length > 50 ? docs.at(-1).id : null,
        });
      }
      const result = await db.runTransaction(async (tx) => {
        const ref = db.collection("projects").doc(p.projectId),
          project = await tx.get(ref);
        if (!project.exists || project.data()._deleting)
          throw createHttpError(404, "Project unavailable.");
        const client = await tx.get(
          db.collection("clients").doc(project.data().clientId),
        );
        if (!client.exists || client.data()._deleting)
          throw createHttpError(404, "Client unavailable.");
        const timestamp = new Date(now()).toISOString();
        if (p.action === "publish-review") {
          if (isProjectClosed(project.data().status))
            throw createHttpError(
              409,
              "Reopen the project before publishing another revision.",
            );
          if (
            !text(p.title, 160) ||
            !text(p.version, 120) ||
            !text(p.instructions, 4000)
          )
            throw createHttpError(
              400,
              "Add a review title, revision and instructions.",
            );
          if (p.requestId) {
            if (!id(p.requestId))
              throw createHttpError(400, "Invalid work request.");
            const request = await tx.get(
              db.collection("client_requests").doc(p.requestId),
            );
            if (
              !request.exists ||
              request.data().clientId !== client.id ||
              (request.data().projectId &&
                request.data().projectId !== project.id)
            )
              throw createHttpError(
                400,
                "Select a request for this client and project.",
              );
          }
          if (
            p.attemptId &&
            project.data().portalReview?.attemptId === p.attemptId
          )
            return { review: project.data().portalReview };
          if (!id(p.attemptId || "legacy"))
            throw createHttpError(400, "Invalid publication attempt.");
          const portalReview = {
            attemptId: p.attemptId || "",
            id: crypto.randomUUID(),
            title: p.title.trim(),
            version: p.version.trim(),
            instructions: p.instructions.trim(),
            requestId: p.requestId || "",
            status: "open",
            publishedAt: timestamp,
          };
          tx.update(ref, { portalReview, updatedAt: timestamp });
          return { review: portalReview };
        }
        if (p.action !== "verify-response" || !id(p.responseId))
          throw createHttpError(400, "Unknown portal action.");
        const responseRef = db.collection("portal_responses").doc(p.responseId),
          snapshot = await tx.get(responseRef),
          response = snapshot.data();
        if (
          !response ||
          response.projectId !== project.id ||
          response.clientId !== client.id
        )
          throw createHttpError(404, "Response unavailable.");
        if (response.status === "verified") return { verified: true };
        if (p.reject === true) {
          tx.update(responseRef, {
            status: "dismissed",
            verifiedBy: actor.uid,
            verifiedAt: timestamp,
          });
          return { dismissed: true };
        }
        if (response.status !== "pending-verification")
          throw createHttpError(409, "Response is already processed.");
        if (response.kind === "decision") {
          const review = project.data().portalReview;
          if (
            !review ||
            review.id !== response.reviewId ||
            review.version !== response.deliverableVersion ||
            review.status !== "open"
          )
            throw createHttpError(
              409,
              "This response is for an older or already reviewed revision. Publish a new review instead.",
            );
          const requestRef = review.requestId
              ? db.collection("client_requests").doc(review.requestId)
              : null,
            request = requestRef ? await tx.get(requestRef) : null;
          if (
            request &&
            (!request.exists || request.data().clientId !== client.id)
          )
            throw createHttpError(409, "Linked request unavailable.");
          const recordId = `portal_${snapshot.id}`,
            value = {
              clientId: client.id,
              projectId: project.id,
              requestId: review.requestId || "",
              title: response.title,
              deliverableVersion: response.deliverableVersion,
              decision: response.decision,
              decisionDate: new Date(now() + 7200000)
                .toISOString()
                .slice(0, 10),
              decidedBy: response.contactName,
              notes: response.notes,
              recordedByUid: actor.uid,
              version: 1,
              createdAt: timestamp,
              updatedAt: timestamp,
              updatedBy: actor.uid,
              source: "verified-portal-response",
            };
          tx.set(db.collection("client_feedback").doc(recordId), value);
          tx.set(
            db
              .collection("client_feedback_revisions")
              .doc(`${recordId}_0000000001`),
            { ...value, recordId, revisionAction: "create" },
          );
          tx.update(ref, {
            portalReview: {
              ...review,
              status: "reviewed",
              decision: response.decision,
              reviewedAt: timestamp,
            },
            updatedAt: timestamp,
          });
          if (requestRef)
            tx.update(requestRef, {
              status:
                response.decision === "approved" ? "completed" : "in-progress",
              ownerUpdate: `Verified client response (${review.version}): ${response.notes}`,
              version: Number(request.data().version || 1) + 1,
              updatedAt: timestamp,
            });
        } else {
          tx.set(
            db.collection("client_requests").doc(`portal_${snapshot.id}`),
            {
              clientId: client.id,
              projectId: project.id,
              title: response.title,
              description: `Client response from ${response.contactName}:\n\n${response.notes}`,
              category: "website-change",
              priority: "normal",
              status: "received",
              submittedByUid: actor.uid,
              createdAt: timestamp,
              updatedAt: timestamp,
              version: 1,
              ownerUpdate: "",
              attachments: [],
              source: "verified-portal-response",
            },
          );
        }
        tx.update(responseRef, {
          status: "verified",
          verifiedBy: actor.uid,
          verifiedAt: timestamp,
        });
        tx.set(db.collection("activities").doc(`portal_${snapshot.id}`), {
          type: "note",
          entityType: "client",
          entityId: client.id,
          createdBy: actor.uid,
          createdAt: timestamp,
          description: `Verified portal ${response.kind}: ${response.title}\n\n${response.notes}`,
        });
        return { verified: true };
      });
      if (p.action === "verify-response" && result.verified) {
        try {
          await notify(
            { id: p.responseId, projectId: p.projectId },
            { verified: true },
          );
        } catch (e) {
          console.error("[Verified portal notice]", {
            code: e.code || "unknown",
          });
        }
      }
      return json(res, 200, result);
    } catch (e) {
      return json(res, e.status || 500, {
        error: e.status ? e.message : "Portal work could not be processed.",
      });
    }
  };
}
