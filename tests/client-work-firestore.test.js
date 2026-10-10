import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { Firestore } from "firebase-admin/firestore";
import { createClientSuccessHandlers } from "../api/_lib/clientSuccessHandlers.js";

// Use real SDK query construction, serialization, snapshots, and cursors.
// Replace only the network transport; production credentials are not available.
function fixture(populated) {
  const db = new Firestore({ projectId: "demo-client-work" });
  const records = new Map([
    ["clients/c1", { businessName: "Client One", leadId: "l1" }],
    ["leads/l1", { assignedTo: "agent" }],
  ]);
  if (populated)
    for (let i = 0; i < 53; i++) {
      const id = String(i).padStart(5, "0");
      records.set(`client_follow_ups/${id}`, {
        clientId: "c1",
        userUid: "agent",
        status: "scheduled",
        followUpDate: "2026-10-10",
        waitingForResponse: true,
        notes: "Call client",
      });
      records.set(`client_requests/${id}`, {
        clientId: "c1",
        submittedByUid: "agent",
        title: `Request ${id}`,
        description: "Update website",
        status: "received",
        priority: "normal",
        attachments: [],
      });
    }
  const time = { seconds: "1791615600", nanos: 0 };
  const document = (path, data) => ({
    name: `${db.formattedName}/documents/${path}`,
    fields: db._serializer.encodeFields(data),
    createTime: time,
    updateTime: time,
  });
  db.initializeIfNeeded = async () => {};
  db.getAll = async (...refs) =>
    refs.map((ref) =>
      db.snapshot_(document(ref.path, records.get(ref.path)), time),
    );
  const queries = [];
  db.requestStream = async (method, _bidirectional, request) => {
    assert.equal(method, "runQuery");
    const query = request.structuredQuery;
    queries.push(query);
    const filter = query.where?.fieldFilter;
    const descending = query.orderBy[0].direction === "DESCENDING";
    // Reproduce the production backend rejection, including owner queries.
    if (descending)
      throw Object.assign(
        new Error("9 FAILED_PRECONDITION: The query requires an index."),
        { code: 9 },
      );
    let docs = [...records].filter(
      ([path, data]) =>
        path.startsWith(`${query.from[0].collectionId}/`) &&
        (!filter || data[filter.field.fieldPath] === filter.value.stringValue),
    );
    docs.sort(([a], [b]) => (descending ? -1 : 1) * a.localeCompare(b));
    if (query.startAt) {
      const cursor = query.startAt.values[0].referenceValue;
      docs = docs.filter(([path]) =>
        descending
          ? `${db.formattedName}/documents/${path}` < cursor
          : `${db.formattedName}/documents/${path}` > cursor,
      );
    }
    return Readable.from(
      [
        ...docs.slice(0, query.limit.value).map(([path, data]) => ({
          document: document(path, data),
          readTime: time,
        })),
        { readTime: time },
      ],
      { objectMode: true },
    );
  };
  const handlers = createClientSuccessHandlers({
    db,
    authenticate: async (req) => ({ uid: req.uid, role: req.uid }),
    requireOwner: async () => {},
    getIdentityConfig: () => ({ owners: new Set(["owner"]), legacyIds: {} }),
  });
  const invoke = async (kind, uid, body) => {
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
      { method: "POST", uid, body: { action: "list", ...body } },
      res,
    );
    assert.equal(res.code, 200, res.data?.error);
    return res.data;
  };
  return { invoke, queries, records };
}

for (const populated of [false, true])
  for (const role of ["owner", "agent"])
    for (const scoped of [false, true]) {
      test(`real Firestore SDK loads ${populated ? "populated" : "empty"} ${role} ${scoped ? "client" : "global"} queues`, async () => {
        const f = fixture(populated);
        for (const [handler, key] of [
          ["followUps", "followUps"],
          ["requests", "requests"],
        ]) {
          const payload = scoped ? { clientId: "c1" } : {};
          const first = await f.invoke(handler, role, payload);
          assert.equal(first[key].length, populated ? 50 : 0);
          if (populated) {
            const next = await f.invoke(handler, role, {
              ...payload,
              cursor: first.cursor,
            });
            assert.equal(next[key].length, 3);
            assert.equal(next.cursor, null);
            assert.equal(
              new Set([...first[key], ...next[key]].map((record) => record.id))
                .size,
              53,
            );
          } else assert.equal(first.cursor, null);
        }
        for (const query of f.queries) assert.equal(query.limit.value, 51);
      });
    }

for (const role of ["owner", "agent"])
  for (const scoped of [false, true]) {
    test(`real SDK paginates ${role} ${scoped ? "client" : "global"} growth queues and feedback histories without descending indexes`, async () => {
      const f = fixture(false);
      for (let i = 0; i < 53; i++) {
        const id = String(i).padStart(5, "0");
        f.records.set(`client_opportunities/${id}`, {
          clientId: "c1",
          proposedByUid: "agent",
          status: "proposed",
          version: 1,
        });
        f.records.set(`client_feedback_revisions/${id}`, {
          recordId: "feedback1",
          clientId: "c1",
          version: i + 1,
          decision: "approved",
        });
      }
      f.records.set("client_feedback/feedback1", {
        clientId: "c1",
        version: 53,
        decision: "approved",
      });
      const growth = await f.invoke(
        "opportunities",
        role,
        scoped ? { clientId: "c1" } : {},
      );
      assert.equal(growth.records.length, 50);
      const next = await f.invoke("opportunities", role, {
        ...(scoped ? { clientId: "c1" } : {}),
        cursor: growth.cursor,
      });
      assert.equal(next.records.length, 3);
      const history = await f.invoke("feedback", role, {
        action: "history",
        clientId: "c1",
        recordId: "feedback1",
      });
      assert.equal(history.revisions.length, 50);
      const nextHistory = await f.invoke("feedback", role, {
        action: "history",
        clientId: "c1",
        recordId: "feedback1",
        cursor: history.cursor,
      });
      assert.equal(nextHistory.revisions.length, 3);
    });
  }
