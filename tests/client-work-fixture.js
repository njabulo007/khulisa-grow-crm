import { createPaymentFollowUpHandler } from "../api/_lib/paymentFollowUpHandlers.js";
import assert from "node:assert/strict";
import { createClientSuccessHandlers } from "../api/_lib/clientSuccessHandlers.js";
export function clientWorkFixture(extra = {}) {
  const records = new Map(
    Object.entries({
      "users/owner": { role: "owner" },
      "users/agent": { role: "agent" },
      "users/other": { role: "agent" },
      "clients/c1": { businessName: "Client One", leadId: "l1" },
      "clients/c2": { businessName: "Project Client" },
      "leads/l1": { assignedTo: "legacy-agent", stage: "won" },
      "projects/p1": { clientId: "c2", assignedTo: "legacy-agent" },
      ...extra,
    }),
  );
  const state = {
    records,
    pushes: [],
    uploads: new Map(),
    clock: Date.parse("2026-10-10T07:00:00Z"),
    disabled: false,
    uploadFails: false,
    pushFails: false,
    removeFails: false,
  };
  const snapshot = (reference) => ({
    ref: reference,
    id: reference.id,
    exists: records.has(reference.path),
    data: () => structuredClone(records.get(reference.path)),
  });
  const ref = (path) => ({
    path,
    id: path.split("/").slice(1).join("/"),
    get: async () => snapshot(ref(path)),
    delete: async () => records.delete(path),
    update: async (patch) =>
      records.set(path, { ...records.get(path), ...patch }),
  });
  const query = (name, clauses = [], ordering, cursor, size) => ({
    where: (field, op, value) =>
      query(name, [...clauses, [field, op, value]], ordering, cursor, size),
    orderBy: (field, direction) =>
      query(name, clauses, [field, direction], cursor, size),
    startAfter: (value) => query(name, clauses, ordering, value, size),
    limit: (value) => query(name, clauses, ordering, cursor, value),
    get: async () => {
      let docs = [...records]
        .filter(
          ([path, data]) =>
            path.startsWith(name + "/") &&
            clauses.every(([field, op, value]) =>
              op === "=="
                ? data[field] === value
                : op === "<="
                  ? data[field] <= value
                  : data[field] >= value,
            ),
        )
        .map(([path]) => snapshot(ref(path)));
      if (ordering)
        docs.sort(
          (a, b) =>
            (ordering[1] === "desc" ? -1 : 1) * a.id.localeCompare(b.id),
        );
      if (cursor)
        docs = docs.filter((doc) =>
          ordering?.[1] === "desc" ? doc.id < cursor : doc.id > cursor,
        );
      return { docs: docs.slice(0, size) };
    },
  });
  const db = {
    collection: (name) => ({
      ...query(name),
      doc: (key) => ref(`${name}/${key}`),
    }),
  };
  let queue = Promise.resolve();
  db.runTransaction = (operation) => {
    const result = queue.then(async () => {
      const writes = [];
      const result = await operation({
        get: async (item) => {
          assert.equal(
            writes.length,
            0,
            "All transaction reads precede writes",
          );
          return item.get();
        },
        set: (item, data) => writes.push(() => records.set(item.path, data)),
        update: (item, data) =>
          writes.push(() =>
            records.set(item.path, { ...records.get(item.path), ...data }),
          ),
        delete: (item) => writes.push(() => records.delete(item.path)),
      });
      writes.forEach((write) => write());
      return result;
    });
    queue = result.catch(() => {});
    return result;
  };
  const auth = {
    getUser: async (uid) => {
      if (!records.has("users/" + uid))
        throw Object.assign(new Error("Missing"), {
          code: "auth/user-not-found",
        });
      return {
        disabled: state.disabled,
        customClaims: {
          role: records.get("users/" + uid).role,
          ...(uid === "agent" ? { appUserId: "legacy-agent" } : {}),
        },
      };
    },
  };
  const authenticate = async (req) => {
    const uid = req.headers?.authorization;
    if (!["owner", "agent", "other"].includes(uid))
      throw Object.assign(new Error("Sign in"), { status: 401 });
    return {
      uid,
      appUserId: uid === "agent" ? "legacy-agent" : uid,
      role: uid === "owner" ? "owner" : "agent",
    };
  };
  const handlers = createClientSuccessHandlers({
    db,
    auth,
    authenticate,
    requireOwner: async () => {},
    now: () => state.clock,
    getIdentityConfig: () => ({
      owners: new Set(["owner"]),
      legacyIds: { agent: "legacy-agent" },
    }),
    sendPush: async (notificationId, userId) => {
      if (state.pushFails) throw new Error("Unavailable");
      state.pushes.push({ notificationId, userId });
    },
    files: {
      upload: async (file, buffer) => {
        if (state.uploadFails) throw new Error("Upload failed");
        state.uploads.set(file.path, buffer);
      },
      download: async (file) => state.uploads.get(file.path),
      remove: async (file) => {
        if (state.removeFails) throw new Error("Delete failed");
        state.uploads.delete(file.path);
      },
    },
  });
  state.invoke = async (kind, body, uid = "agent") => {
    const res = {
      setHeader() {},
      status(code) {
        this.code = code;
        return this;
      },
      json(data) {
        this.data = data;
      },
    };
    await handlers[kind](
      { method: "POST", headers: { authorization: uid }, body },
      res,
    );
    return res;
  };
  state.schedule = (extra = {}, uid = "agent") =>
    state.invoke(
      "followUps",
      {
        action: "save",
        clientId: "c1",
        followUpDate: "2026-10-10",
        waitingForResponse: false,
        notes: "**Call** client",
        ...extra,
      },
      uid,
    );
  state.create = (extra = {}, uid = "agent") =>
    state.invoke(
      "requests",
      {
        action: "create",
        requestId: "1791615600000_00000000-0000-4000-8000-000000000001",
        clientId: "c1",
        title: "Update homepage",
        description: "**New** photos\n\nClient approved copy",
        category: "website-change",
        priority: "high",
        ...extra,
      },
      uid,
    );
  state.reminderHandler = createPaymentFollowUpHandler({
    db,
    auth,
    authenticate,
    requireOwner: async () => {},
    now: () => state.clock,
    cronSecret: () => "secret",
    sendPush: async () => {},
    runClientFollowUps: handlers.runDue,
  });
  state.runDue = handlers.runDue;
  state.handlers = handlers;
  return state;
}
