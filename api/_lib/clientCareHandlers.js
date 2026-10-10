import crypto from "node:crypto";
import { createHttpError, json, methodNotAllowed, parseBody } from "./http.js";
import { leadFollowUpDay } from "./leadFollowUpHandlers.js";
import { paymentFollowUpDay } from "./paymentFollowUpHandlers.js";

const ITEMS = ["logo", "content", "access", "contract", "requirements"];
const STATES = ["outstanding", "requested", "received", "not-required"];
const HEALTH = ["healthy", "needs-attention", "at-risk"];
const validId = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 128 &&
  !value.includes("/");
const validText = (value, max) =>
  typeof value === "string" && value.length <= max;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
export function clientCareView(client, stored = {}) {
  const checklist = Object.fromEntries(
    ITEMS.map((key) => [
      key,
      stored.checklist?.[key] || {
        status: (
          key === "contract"
            ? client.contractSigned
            : client.onboardingCompleted
        )
          ? "received"
          : "outstanding",
        notes: "",
      },
    ]),
  );
  return {
    version: stored.version || 0,
    health: stored.health || null,
    lastContactAt: stored.lastContactAt || null,
    escalation: stored.escalation || null,
    checklist,
    legacyCompleted: !stored.checklist && client.onboardingCompleted === true,
    onboardingCompleted:
      (!stored.checklist && client.onboardingCompleted === true) ||
      ITEMS.every((key) =>
        ["received", "not-required"].includes(checklist[key].status),
      ),
    completedItems: ITEMS.filter((key) =>
      ["received", "not-required"].includes(checklist[key].status),
    ).length,
  };
}

export function createClientCareHandler({
  db,
  authenticate,
  clientContext,
  notifyOwners,
  now = () => Date.now(),
}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    const payload = parseBody(req);
    try {
      const actor = await authenticate(req);
      if (payload.action === "summary") {
        if (
          !Array.isArray(payload.clientIds) ||
          payload.clientIds.length > 50 ||
          !payload.clientIds.every(validId)
        )
          throw createHttpError(400, "Choose up to 50 clients.");
        const clients = [];
        for (const clientId of new Set(payload.clientIds)) {
          try {
            const client = await clientContext(actor, clientId);
            const record = await db
              .collection("client_care")
              .doc(clientId)
              .get();
            clients.push({
              clientId,
              clientName: client.data().businessName,
              ...clientCareView(client.data(), record.data()),
            });
          } catch (error) {
            if (![403, 404].includes(error.status)) throw error;
          }
        }
        return json(res, 200, { clients });
      }
      if (!validId(payload.clientId))
        throw createHttpError(400, "Choose a client.");
      const ref = db.collection("client_care").doc(payload.clientId);
      if (payload.action === "get") {
        const client = await clientContext(actor, payload.clientId);
        const care = await ref.get();
        return json(res, 200, clientCareView(client.data(), care.data()));
      }
      if (
        !["health", "onboarding", "resolve"].includes(payload.action) ||
        !validId(payload.requestId) ||
        !Number.isInteger(payload.version) ||
        payload.version < 0
      )
        throw createHttpError(400, "A valid update and version are required.");
      if (
        payload.action === "health" &&
        (!HEALTH.includes(payload.status) ||
          !validText(payload.reason, 4000) ||
          !payload.reason.trim() ||
          typeof payload.escalate !== "boolean" ||
          !validText(payload.lastContactDate, 10) ||
          (payload.lastContactDate !== "" &&
            (leadFollowUpDay(payload.lastContactDate) !==
              payload.lastContactDate ||
              payload.lastContactDate > paymentFollowUpDay(now()))) ||
          (payload.escalate && payload.status === "healthy"))
      )
        throw createHttpError(
          400,
          "Choose a health status, explain the reason, and use a valid past or current contact date. Only concerns can be escalated.",
        );
      if (
        payload.action === "onboarding" &&
        (!payload.checklist ||
          Object.keys(payload.checklist).length !== ITEMS.length ||
          !ITEMS.every(
            (key) =>
              STATES.includes(payload.checklist[key]?.status) &&
              validText(payload.checklist[key]?.notes, 2000),
          ))
      )
        throw createHttpError(
          400,
          "Complete the five checklist items with valid statuses and notes up to 2,000 characters.",
        );
      if (
        payload.action === "resolve" &&
        (actor.role !== "owner" ||
          !validText(payload.reason, 2000) ||
          !payload.reason.trim())
      )
        throw createHttpError(
          actor.role !== "owner" ? 403 : 400,
          "Only the owner can resolve a concern, with a resolution note.",
        );
      const activityRef = db
        .collection("activities")
        .doc(
          `client_care_${hash(`${actor.uid}:${payload.clientId}:${payload.requestId}`)}`,
        );
      const result = await db.runTransaction(async (tx) => {
        const client = await clientContext(actor, payload.clientId, (item) =>
          tx.get(item),
        );
        const [snapshot, previous] = await Promise.all([
          tx.get(ref),
          tx.get(activityRef),
        ]);
        const current = clientCareView(client.data(), snapshot.data());
        if (previous.exists) return { care: current, escalated: false };
        if (current.version !== payload.version)
          throw createHttpError(
            409,
            "This client was updated by someone else. Refresh before saving your changes.",
          );
        const timestamp = new Date(now()).toISOString();
        const patch = {
          clientId: payload.clientId,
          version: current.version + 1,
          updatedAt: timestamp,
          updatedBy: actor.uid,
        };
        let description;
        if (payload.action === "health") {
          patch.health = {
            status: payload.status,
            reason: payload.reason.trim(),
            updatedAt: timestamp,
            updatedBy: actor.uid,
          };
          // Preserve the precise automatic timestamp when its calendar date was not edited.
          patch.lastContactAt =
            (current.lastContactAt?.length === 10
              ? current.lastContactAt
              : current.lastContactAt
                ? paymentFollowUpDay(Date.parse(current.lastContactAt))
                : "") === payload.lastContactDate
              ? current.lastContactAt
              : payload.lastContactDate || null;
          description = `Client health: ${payload.status.replaceAll("-", " ")}\n\n${payload.reason.trim()}`;
          if (payload.escalate) {
            patch.escalation = {
              id: payload.requestId,
              status: "open",
              reason: payload.reason.trim(),
              raisedAt: timestamp,
              raisedBy: actor.uid,
            };
            description += "\n\nEscalated to owner.";
          }
        } else if (payload.action === "onboarding") {
          patch.checklist = Object.fromEntries(
            ITEMS.map((key) => [
              key,
              {
                status: payload.checklist[key].status,
                notes: payload.checklist[key].notes.trim(),
              },
            ]),
          );
          const complete = ITEMS.every((key) =>
            ["received", "not-required"].includes(patch.checklist[key].status),
          );
          tx.update(client.ref, {
            onboardingCompleted: complete,
            contractSigned: patch.checklist.contract.status === "received",
            updatedAt: timestamp,
          });
          description = `Onboarding checklist updated\n\n${ITEMS.map((key) => `- ${key}: ${patch.checklist[key].status.replaceAll("-", " ")}`).join("\n")}`;
        } else {
          if (current.escalation?.status !== "open")
            throw createHttpError(
              409,
              "This concern is already resolved or has not been escalated.",
            );
          patch.escalation = {
            ...current.escalation,
            status: "resolved",
            resolvedAt: timestamp,
            resolvedBy: actor.uid,
            resolution: payload.reason.trim(),
          };
          description = `Client concern resolved\n\n${payload.reason.trim()}`;
        }
        tx.set(ref, { ...(snapshot.data() || {}), ...patch });
        tx.set(activityRef, {
          type: "note",
          entityType: "client",
          entityId: payload.clientId,
          description,
          createdAt: timestamp,
          createdBy: actor.appUserId || actor.uid,
        });
        return {
          care: clientCareView(client.data(), {
            ...(snapshot.data() || {}),
            ...patch,
          }),
          escalated: Boolean(payload.escalate),
          clientName: client.data().businessName,
        };
      });
      if (result.escalated) {
        try {
          await notifyOwners(
            `health:${activityRef.id}`,
            { clientId: payload.clientId },
            {
              type: "client_health",
              title: `Client concern: ${result.clientName}`,
              message: `${payload.status.replaceAll("-", " ")}: ${payload.reason.trim().slice(0, 180)}`,
            },
          );
        } catch (error) {
          console.error("[Client health notification]", {
            code: error.code || error.status || "unknown",
          });
        }
      }
      return json(res, 200, result.care);
    } catch (error) {
      if (!error.status)
        console.error("[Client care API]", {
          action: payload.action,
          code: error.code || "unknown",
          message: error.message,
        });
      return json(res, error.status || 500, {
        error: error.status
          ? error.message
          : "Client care could not be updated. Refresh and try again.",
      });
    }
  };
}
