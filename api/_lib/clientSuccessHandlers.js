import crypto from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";
import { createHttpError, json, methodNotAllowed, parseBody } from "./http.js";
import { readIdentityConfig } from "./migrationHandlers.js";
import { paymentFollowUpDay } from "./paymentFollowUpHandlers.js";
import { leadFollowUpDay } from "./leadFollowUpHandlers.js";

const id = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 128 &&
  !value.includes("/");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const text = (value, max, required = false) =>
  typeof value === "string" &&
  value.length <= max &&
  (!required || value.trim());
const dateValid = (value) => value === "" || leadFollowUpDay(value) === value;
const statuses = ["received", "in-progress", "ready-for-review", "completed"];
const priorities = ["low", "normal", "high", "urgent"];
const types = ["website-change", "issue", "new-requirement"];
const attachmentTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
]);
const MAX_FILE = 2 * 1024 * 1024;
const outputRequest = (snapshot, clientName, actor) => {
  const value = snapshot.data();
  return {
    id: snapshot.id,
    clientId: value.clientId,
    clientName,
    title: value.title,
    description: value.description,
    priority: value.priority,
    category: value.category,
    status: value.status,
    ownerUpdate: value.ownerUpdate || "",
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    version: value.version || 1,
    canEditFiles: actor.role === "owner" || value.submittedByUid === actor.uid,
    attachments: (value.attachments || [])
      .filter((file) => file.status === "ready")
      .map(({ id, name, mimeType, sizeBytes }) => ({
        id,
        name,
        mimeType,
        sizeBytes,
      })),
    pendingAttachments: (value.attachments || [])
      .filter((file) => file.status !== "ready")
      .map(({ id, name }) => ({ id, name })),
  };
};

export function createClientSuccessHandlers({
  db,
  auth,
  authenticate,
  requireOwner,
  sendPush,
  files,
  now = () => Date.now(),
  getIdentityConfig = readIdentityConfig,
}) {
  const alias = (uid) => getIdentityConfig().legacyIds[uid];
  const keys = (actor) =>
    new Set([actor.uid, actor.appUserId, alias(actor.uid)].filter(id));
  const identityFor = async (uid) => {
    const [account, profile] = await Promise.all([
      auth.getUser(uid),
      db.collection("users").doc(uid).get(),
    ]);
    if (
      account.disabled ||
      !profile.exists ||
      !["owner", "agent"].includes(profile.data().role) ||
      (!getIdentityConfig().owners.has(uid) &&
        !["owner", "agent"].includes(account.customClaims?.role))
    )
      throw createHttpError(403, "Account unavailable.");
    return {
      uid,
      role:
        getIdentityConfig().owners.has(uid) ||
        (profile.data().role === "owner" &&
          account.customClaims?.role === "owner")
          ? "owner"
          : "agent",
      appUserId: alias(uid) || account.customClaims?.appUserId || uid,
    };
  };
  const clientContext = async (
    actor,
    clientId,
    read = (item) => item.get(),
  ) => {
    if (!id(clientId)) throw createHttpError(400, "Choose a client.");
    const snapshot = await read(db.collection("clients").doc(clientId));
    if (!snapshot.exists || snapshot.data()._deleting)
      throw createHttpError(404, "Client unavailable.");
    if (actor.role === "owner") return snapshot;
    const client = snapshot.data();
    const userKeys = keys(actor);
    if (id(client.leadId)) {
      const lead = await read(db.collection("leads").doc(client.leadId));
      if (
        lead.exists &&
        !lead.data()._deleting &&
        userKeys.has(lead.data().assignedTo)
      )
        return snapshot;
    }
    // Check actual project assignments; stored grants and browser profile aliases cannot grant access.
    const projects = await read(
      db.collection("projects").where("clientId", "==", clientId),
    );
    if (
      projects.docs.some(
        (project) =>
          !project.data()._deleting && userKeys.has(project.data().assignedTo),
      )
    )
      return snapshot;
    throw createHttpError(403, "You do not have access to this client.");
  };
  const authenticateActor = async (req) => {
    const actor = await authenticate(req);
    if (actor.role === "owner") await requireOwner(req);
    return actor;
  };
  const paginate = async (query, cursor) => {
    if (cursor !== undefined && !id(cursor))
      throw createHttpError(400, "Invalid page cursor.");
    // Use the default document-ID order for every queue. Firestore also
    // requires an extra index for unfiltered descending document-ID queries.
    let page = query.orderBy(FieldPath.documentId(), "asc");
    if (cursor) page = page.startAfter(cursor);
    const result = await page.limit(51).get();
    const docs = result.docs.slice(0, 50);
    return { docs, cursor: result.docs.length > 50 ? docs.at(-1).id : null };
  };
  const notify = async (actor, eventId, value) => {
    const ref = db
      .collection("notifications")
      .doc(`client_work_${hash(`${actor.uid}:${eventId}`)}`);
    await db.runTransaction(async (tx) => {
      if (!(await tx.get(ref)).exists)
        tx.set(ref, {
          ...value,
          userId: actor.appUserId || actor.uid,
          createdAt: new Date(now()).toISOString(),
          isRead: false,
          pushManagedBy: "vercel",
        });
    });
    try {
      await sendPush(ref.id, actor.appUserId || actor.uid);
    } catch (error) {
      console.error("[Client work push]", { code: error.code || "unknown" });
    }
  };
  const notifyOwners = async (requestId, request) => {
    const profiles = await db
      .collection("users")
      .where("role", "==", "owner")
      .get();
    const recipients = new Set([
      ...getIdentityConfig().owners,
      ...profiles.docs.map((profile) => profile.id),
    ]);
    for (const uid of recipients) {
      try {
        const actor = await identityFor(uid);
        if (actor.role === "owner")
          await notify(actor, `request:${requestId}`, {
            type: "client_request",
            clientId: request.clientId,
            requestId,
            title: "New client request",
            message: `${request.title} · ${request.priority} priority. Open the work queue to review.`,
          });
      } catch (error) {
        console.error("[Client work owner notification]", {
          code: error.code || error.status || "unknown",
        });
      }
    }
  };
  const refFor = (clientId, uid) =>
    db.collection("client_follow_ups").doc(hash(`${clientId}:${uid}`));

  const followUps = async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    try {
      const actor = await authenticateActor(req);
      const payload = parseBody(req);
      if (payload.action === "list") {
        if (payload.clientId !== undefined)
          await clientContext(actor, payload.clientId);
        const query = payload.clientId
          ? db
              .collection("client_follow_ups")
              .where("clientId", "==", payload.clientId)
          : actor.role === "owner"
            ? db.collection("client_follow_ups")
            : db
                .collection("client_follow_ups")
                .where("userUid", "==", actor.uid);
        const { docs, cursor } = await paginate(query, payload.cursor);
        const records = [];
        const contexts = new Map();
        for (const doc of docs) {
          const record = doc.data();
          if (
            record.status !== "scheduled" ||
            (actor.role !== "owner" && record.userUid !== actor.uid)
          )
            continue;
          try {
            if (!contexts.has(record.clientId))
              contexts.set(
                record.clientId,
                await clientContext(actor, record.clientId),
              );
            records.push({
              id: doc.id,
              clientId: record.clientId,
              clientName: contexts.get(record.clientId).data().businessName,
              followUpDate: record.followUpDate,
              waitingForResponse: record.waitingForResponse,
              notes: record.notes,
              lastContactAt: record.lastContactAt || null,
              userUid: record.userUid,
              mine: record.userUid === actor.uid,
            });
          } catch (error) {
            if (![403, 404].includes(error.status)) throw error;
          }
        }
        return json(res, 200, {
          followUps: records.sort((a, b) =>
            a.followUpDate.localeCompare(b.followUpDate),
          ),
          cursor,
        });
      }
      if (!["save", "complete", "cancel"].includes(payload.action))
        throw createHttpError(400, "Invalid client follow-up action.");
      const date =
        payload.action === "complete"
          ? payload.nextFollowUpDate
          : payload.followUpDate;
      if (
        payload.action !== "cancel" &&
        (!dateValid(date) ||
          typeof payload.waitingForResponse !== "boolean" ||
          !text(payload.notes, 10000))
      )
        throw createHttpError(
          400,
          "Choose a valid date and notes up to 10,000 characters.",
        );
      if (payload.action === "save" && !date)
        throw createHttpError(400, "Choose the next contact date.");
      if (
        payload.action === "complete" &&
        (!id(payload.requestId) ||
          !text(payload.description, 10000, true) ||
          !["note", "call", "email", "whatsapp", "meeting"].includes(
            payload.type,
          ))
      )
        throw createHttpError(400, "Record the interaction and its outcome.");
      const ref = refFor(payload.clientId, actor.uid);
      const activity =
        payload.action === "complete"
          ? db
              .collection("activities")
              .doc(
                `client_contact_${hash(`${actor.uid}:${payload.clientId}:${payload.requestId}`)}`,
              )
          : null;
      const result = await db.runTransaction(async (tx) => {
        await clientContext(actor, payload.clientId, (item) => tx.get(item));
        const current = await tx.get(ref);
        const previous = activity ? await tx.get(activity) : null;
        if (previous?.exists) return { alreadyCompleted: true };
        const timestamp = new Date(now()).toISOString();
        if (payload.action === "cancel") {
          if (current.exists) tx.delete(ref);
          return { stopped: true };
        }
        if (activity)
          tx.set(activity, {
            type: payload.type,
            entityType: "client",
            entityId: payload.clientId,
            description: payload.description.trim(),
            createdBy: actor.appUserId || actor.uid,
            createdAt: timestamp,
            metadata: {
              followUpCompleted: true,
              previousFollowUpDate: current.data()?.followUpDate || null,
              nextFollowUpDate: date || null,
            },
          });
        // A completed interaction with no next date stops the reminder instead of growing done records.
        if (!date) {
          if (current.exists) tx.delete(ref);
          return { stopped: true };
        }
        tx.set(ref, {
          clientId: payload.clientId,
          userUid: actor.uid,
          followUpDate: date,
          notes: payload.notes.trim(),
          waitingForResponse: payload.waitingForResponse,
          status: "scheduled",
          revision: crypto.randomUUID(),
          lastContactAt: activity
            ? timestamp
            : current.data()?.lastContactAt || null,
          updatedAt: timestamp,
        });
        return { scheduled: true };
      });
      return json(res, 200, result);
    } catch (error) {
      return fail(
        res,
        error,
        "Client follow-up could not be processed.",
        parseBody(req).action,
      );
    }
  };

  const runDue = async (identity) => {
    const day = paymentFollowUpDay(now());
    const records = await (
      identity
        ? db
            .collection("client_follow_ups")
            .where("userUid", "==", identity.uid)
        : db.collection("client_follow_ups").where("followUpDate", "<=", day)
    ).get();
    let notified = 0;
    let stopped = 0;
    let failed = 0;
    const actors = new Map();
    for (const snapshot of records.docs) {
      const record = snapshot.data();
      if (
        record.status !== "scheduled" ||
        !record.followUpDate ||
        record.followUpDate > day
      )
        continue;
      try {
        if (!actors.has(record.userUid))
          actors.set(record.userUid, await identityFor(record.userUid));
        const actor = actors.get(record.userUid);
        const result = await db.runTransaction(async (tx) => {
          const current = await tx.get(snapshot.ref);
          if (!current.exists || current.data().followUpDate > day) return null;
          const value = current.data();
          let client;
          try {
            client = await clientContext(actor, value.clientId, (item) =>
              tx.get(item),
            );
          } catch (error) {
            if (![403, 404].includes(error.status)) throw error;
            tx.delete(snapshot.ref);
            return { stopped: true };
          }
          const ref = db
            .collection("notifications")
            .doc(
              `client_due_${hash(`${snapshot.id}:${value.revision}:${day}`)}`,
            );
          const existing = await tx.get(ref);
          if (!existing.exists)
            tx.set(ref, {
              userId: actor.appUserId || actor.uid,
              type: "client_follow_up",
              clientId: value.clientId,
              title:
                value.followUpDate < day
                  ? "Client check-in overdue"
                  : "Client check-in today",
              message: `${client.data().businessName || "Client"}: ${value.waitingForResponse ? "awaiting a response — " : ""}contact due ${value.followUpDate}. Record the outcome and choose another date if needed.`,
              createdAt: new Date(now()).toISOString(),
              isRead: false,
              pushManagedBy: "vercel",
            });
          return { notificationId: ref.id, created: !existing.exists };
        });
        if (!result) continue;
        if (result.stopped) {
          stopped++;
          continue;
        }
        await sendPush(result.notificationId, actor.appUserId || actor.uid);
        if (result.created) notified++;
      } catch (error) {
        if (error.status === 403 || error.code === "auth/user-not-found") {
          await snapshot.ref.delete();
          stopped++;
        } else {
          failed++;
          console.error("[Client follow-up]", {
            code: error.code || "unknown",
          });
        }
      }
    }
    return { notified, stopped, failed };
  };

  const readRequest = async (actor, requestId, read = (item) => item.get()) => {
    if (!id(requestId)) throw createHttpError(400, "Invalid request.");
    const snapshot = await read(
      db.collection("client_requests").doc(requestId),
    );
    if (!snapshot.exists || snapshot.data()._deleting)
      throw createHttpError(404, "Request unavailable.");
    const client = await clientContext(actor, snapshot.data().clientId, read);
    return { snapshot, client };
  };
  const canEditFiles = (actor, request, cleanup = false) => {
    if (actor.role !== "owner" && request.submittedByUid !== actor.uid)
      throw createHttpError(
        403,
        "Only the submitter or owner can change attachments.",
      );
    if (request.status === "completed" && !(cleanup && actor.role === "owner"))
      throw createHttpError(
        409,
        "This request is completed. Ask the owner to reopen it before adding files.",
      );
  };
  const requests = async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    try {
      const actor = await authenticateActor(req);
      const payload = parseBody(req);
      if (payload.action === "list") {
        if (payload.clientId !== undefined)
          await clientContext(actor, payload.clientId);
        // Scoped pagination must use the built-in equality index ordering.
        const query = payload.clientId
          ? db
              .collection("client_requests")
              .where("clientId", "==", payload.clientId)
          : actor.role === "owner"
            ? db.collection("client_requests")
            : db
                .collection("client_requests")
                .where("submittedByUid", "==", actor.uid);
        const { docs, cursor } = await paginate(query, payload.cursor);
        const records = [];
        const clients = new Map();
        for (const snapshot of docs) {
          if (snapshot.data()._deleting) continue;
          try {
            const clientId = snapshot.data().clientId;
            if (!clients.has(clientId))
              clients.set(clientId, await clientContext(actor, clientId));
            records.push(
              outputRequest(
                snapshot,
                clients.get(clientId).data().businessName,
                actor,
              ),
            );
          } catch (error) {
            if (![403, 404].includes(error.status)) throw error;
          }
        }
        return json(res, 200, { requests: records, cursor });
      }
      if (payload.action === "create") {
        if (
          !id(payload.requestId) ||
          !/^\d{13}_[a-zA-Z0-9-]{36}$/.test(payload.requestId) ||
          !text(payload.title, 160, true) ||
          !text(payload.description, 10000, true) ||
          !priorities.includes(payload.priority) ||
          !types.includes(payload.category)
        )
          throw createHttpError(
            400,
            "Add a title, request details, category and priority.",
          );
        const ref = db
          .collection("client_requests")
          .doc(`${payload.requestId}_${hash(actor.uid).slice(0, 12)}`);
        const result = await db.runTransaction(async (tx) => {
          await clientContext(actor, payload.clientId, (item) => tx.get(item));
          const existing = await tx.get(ref);
          if (existing.exists) {
            if (
              existing.data().clientId !== payload.clientId ||
              existing.data().submittedByUid !== actor.uid
            )
              throw createHttpError(409, "Request ID is already in use.");
            return existing.data();
          }
          const timestamp = new Date(now()).toISOString();
          const value = {
            clientId: payload.clientId,
            title: payload.title.trim(),
            description: payload.description.trim(),
            category: payload.category,
            priority: payload.priority,
            status: "received",
            submittedByUid: actor.uid,
            createdAt: timestamp,
            updatedAt: timestamp,
            version: 1,
            ownerUpdate: "",
            attachments: [],
          };
          tx.set(ref, value);
          return value;
        });
        try {
          await notifyOwners(ref.id, result);
        } catch (error) {
          console.error("[Request owner notice]", {
            code: error.code || "unknown",
          });
        }
        return json(res, 200, { requestId: ref.id });
      }
      if (payload.action === "status") {
        if (actor.role !== "owner")
          throw createHttpError(
            403,
            "Only the owner can update work progress.",
          );
        if (
          !statuses.includes(payload.status) ||
          !text(payload.ownerUpdate, 4000) ||
          !Number.isSafeInteger(payload.version)
        )
          throw createHttpError(
            400,
            "Choose a progress stage and update up to 4,000 characters.",
          );
        const value = await db.runTransaction(async (tx) => {
          const { snapshot } = await readRequest(
            actor,
            payload.requestId,
            (item) => tx.get(item),
          );
          const current = snapshot.data();
          if (
            current.status === payload.status &&
            current.ownerUpdate === payload.ownerUpdate.trim()
          )
            return current;
          if (current.version !== payload.version)
            throw createHttpError(
              409,
              "This request changed. Refresh before updating it.",
            );
          const next = {
            ...current,
            status: payload.status,
            ownerUpdate: payload.ownerUpdate.trim(),
            updatedAt: new Date(now()).toISOString(),
            version: current.version + 1,
          };
          tx.update(snapshot.ref, next);
          tx.set(
            db
              .collection("activities")
              .doc(
                `request_progress_${hash(`${snapshot.id}:${next.version}`)}`,
              ),
            {
              type: "note",
              entityType: "client",
              entityId: current.clientId,
              createdBy: actor.appUserId || actor.uid,
              createdAt: next.updatedAt,
              description: `${current.title}: ${next.status.replaceAll("-", " ")}${next.ownerUpdate ? `\n\n${next.ownerUpdate}` : ""}`,
              metadata: { requestId: snapshot.id, requestStatus: next.status },
            },
          );
          return next;
        });
        try {
          const recipient = await identityFor(value.submittedByUid);
          await clientContext(recipient, value.clientId);
          await notify(
            recipient,
            `${payload.requestId}:version:${value.version}`,
            {
              type: "client_request",
              requestId: payload.requestId,
              clientId: value.clientId,
              title: "Client request updated",
              message: `${value.title}: ${value.status.replaceAll("-", " ")}. Open the request for the owner’s update.`,
            },
          );
        } catch (error) {
          console.error("[Request update notification]", {
            code: error.code || error.status || "unknown",
          });
        }
        return json(res, 200, { updated: true });
      }
      if (payload.action === "upload") {
        if (
          !id(payload.attachmentId) ||
          !text(payload.name, 180, true) ||
          !attachmentTypes.has(payload.mimeType) ||
          typeof payload.content !== "string" ||
          payload.content.length > Math.ceil(MAX_FILE / 3) * 4 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.content)
        )
          throw createHttpError(
            400,
            "Attach a PNG, JPG, WebP, PDF or text file up to 2 MB.",
          );
        const buffer = Buffer.from(payload.content, "base64");
        if (
          !buffer.length ||
          buffer.length > MAX_FILE ||
          buffer.toString("base64") !== payload.content
        )
          throw createHttpError(400, "Invalid attachment or file size.");
        const reservation = await db.runTransaction(async (tx) => {
          const { snapshot } = await readRequest(
            actor,
            payload.requestId,
            (item) => tx.get(item),
          );
          const request = snapshot.data();
          canEditFiles(actor, request);
          const existing = (request.attachments || []).find(
            (file) => file.id === payload.attachmentId,
          );
          if (existing?.status === "deleting")
            throw createHttpError(409, "This attachment is being removed.");
          if (existing?.status === "ready") return existing;
          if (existing?.leaseUntil > now())
            throw createHttpError(
              409,
              "Attachment upload is still finishing. Retry in a minute.",
            );
          if (existing) {
            const retry = { ...existing, leaseUntil: now() + 60000 };
            tx.update(snapshot.ref, {
              attachments: request.attachments.map((file) =>
                file.id === retry.id ? retry : file,
              ),
            });
            return retry;
          }
          if ((request.attachments || []).length >= 3)
            throw createHttpError(
              400,
              "Each request supports up to 3 attachments.",
            );
          const attachment = {
            id: payload.attachmentId,
            name: payload.name.trim(),
            mimeType: payload.mimeType,
            sizeBytes: buffer.length,
            path: `client-requests/${snapshot.id}/${crypto.randomUUID()}.enc`,
            key: crypto.randomBytes(32).toString("hex"),
            status: "pending",
            leaseUntil: now() + 60000,
          };
          tx.update(snapshot.ref, {
            attachments: [...(request.attachments || []), attachment],
          });
          return attachment;
        });
        if (reservation.status === "ready")
          return json(res, 200, { uploaded: true });
        // Reserve a durable cleanup reference before uploading; interrupted files remain discoverable.
        await files.upload(reservation, buffer);
        await db
          .runTransaction(async (tx) => {
            const { snapshot } = await readRequest(
              actor,
              payload.requestId,
              (item) => tx.get(item),
            );
            const request = snapshot.data();
            canEditFiles(actor, request);
            if (
              !(request.attachments || []).some(
                (file) =>
                  file.id === reservation.id && file.status !== "deleting",
              )
            )
              throw createHttpError(409, "Attachment was removed.");
            tx.update(snapshot.ref, {
              attachments: request.attachments.map((file) =>
                file.id === reservation.id
                  ? { ...file, status: "ready", leaseUntil: 0 }
                  : file,
              ),
            });
          })
          .catch(async (error) => {
            await files.remove(reservation).catch(() => {});
            throw error;
          });
        return json(res, 200, { uploaded: true });
      }
      if (payload.action === "download") {
        const { snapshot } = await readRequest(actor, payload.requestId);
        const file = (snapshot.data().attachments || []).find(
          (file) => file.id === payload.attachmentId && file.status === "ready",
        );
        if (!file) throw createHttpError(404, "Attachment unavailable.");
        const content = await files.download(file);
        await readRequest(actor, payload.requestId);
        return json(res, 200, {
          name: file.name,
          mimeType: file.mimeType,
          content: content.toString("base64"),
        });
      }
      if (payload.action === "remove-attachment") {
        const { snapshot } = await readRequest(actor, payload.requestId);
        canEditFiles(actor, snapshot.data(), true);
        const file = (snapshot.data().attachments || []).find(
          (file) => file.id === payload.attachmentId,
        );
        if (!file) return json(res, 200, { removed: true });
        if (file.leaseUntil > now())
          throw createHttpError(
            409,
            "The upload is still finishing. Retry removal in a minute.",
          );
        // Mark first, so a concurrent upload cannot resurrect a deleted file.
        await db.runTransaction(async (tx) => {
          const { snapshot: current } = await readRequest(
            actor,
            payload.requestId,
            (item) => tx.get(item),
          );
          canEditFiles(actor, current.data(), true);
          tx.update(current.ref, {
            attachments: (current.data().attachments || []).map((item) =>
              item.id === file.id ? { ...item, status: "deleting" } : item,
            ),
          });
        });
        await files.remove(file);
        await db.runTransaction(async (tx) => {
          const { snapshot: current } = await readRequest(
            actor,
            payload.requestId,
            (item) => tx.get(item),
          );
          tx.update(current.ref, {
            attachments: (current.data().attachments || []).filter(
              (item) => item.id !== file.id,
            ),
          });
        });
        return json(res, 200, { removed: true });
      }
      throw createHttpError(400, "Invalid request action.");
    } catch (error) {
      return fail(
        res,
        error,
        "Client request could not be processed.",
        parseBody(req).action,
      );
    }
  };
  return { followUps, requests, runDue, clientContext };
}
function fail(res, error, fallback, action) {
  if (!error.status)
    console.error("[Client success API]", {
      operation: fallback,
      action,
      code: error.code || "unknown",
      message:
        typeof error.message === "string"
          ? error.message.slice(0, 1000)
          : "Unknown error",
    });
  return json(res, error.status || 500, {
    error: error.status ? error.message : fallback,
  });
}
