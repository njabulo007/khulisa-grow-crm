import assert from "node:assert/strict";
import test from "node:test";
import { clientWorkFixture } from "./client-work-fixture.js";
const complete = (f, requestId, nextFollowUpDate = "") =>
  f.invoke("followUps", {
    action: "complete",
    clientId: "c1",
    requestId,
    nextFollowUpDate,
    type: "call",
    description: "**Called**\n\nWaiting on photos",
    notes: "Next action",
    waitingForResponse: Boolean(nextFollowUpDate),
  });

test("client check-ins authorize current lead/project assignees and owner; unassigned/naked callers denied", async () => {
  const f = clientWorkFixture();
  assert.equal((await f.schedule()).code, 200);
  assert.equal((await f.schedule({ clientId: "c2" })).code, 200);
  assert.equal((await f.schedule({}, "other")).code, 403);
  assert.equal((await f.schedule({}, "anonymous")).code, 401);
  assert.equal((await f.schedule({}, "owner")).code, 200);
  f.records.get("projects/p1").assignedTo = "other";
  assert.equal((await f.schedule({ clientId: "c2" })).code, 403);
});
test("repeat contacts keep formatted history, idempotent retries and optionally stop the schedule", async () => {
  const f = clientWorkFixture();
  await f.schedule();
  await Promise.all([
    complete(f, "same", "2026-10-11"),
    complete(f, "same", "2026-10-11"),
  ]);
  assert.equal(
    [...f.records.keys()].filter((key) => key.startsWith("activities/")).length,
    1,
  );
  for (let i = 0; i < 4; i++)
    assert.equal(
      (await complete(f, "new-" + i, i === 3 ? "" : "2026-10-12")).code,
      200,
    );
  assert.equal(
    [...f.records.keys()].filter((key) => key.startsWith("activities/")).length,
    5,
  );
  assert.equal(
    [...f.records.keys()].filter((key) => key.startsWith("client_follow_ups/"))
      .length,
    0,
  );
  assert.equal(
    [...f.records].find(([key]) => key.startsWith("activities/"))[1]
      .description,
    "**Called**\n\nWaiting on photos",
  );
});
test("invalid dates, missing interaction notes and oversized notes do not change schedules", async () => {
  const f = clientWorkFixture();
  assert.equal((await f.schedule({ followUpDate: "2026-02-30" })).code, 400);
  assert.equal((await f.schedule({ notes: "a".repeat(10001) })).code, 400);
  assert.equal(
    (
      await f.invoke("followUps", {
        action: "complete",
        clientId: "c1",
        requestId: "x",
        description: "",
        type: "call",
        nextFollowUpDate: "",
        notes: "",
        waitingForResponse: false,
      })
    ).code,
    400,
  );
  assert.equal(
    [...f.records.keys()].filter((key) => key.startsWith("client_follow_ups/"))
      .length,
    0,
  );
});
test("queues show waiting responses and owner-wide schedules; agents receive only their schedules", async () => {
  const f = clientWorkFixture();
  await f.schedule({ waitingForResponse: true });
  await f.schedule({}, "owner");
  const agent = await f.invoke("followUps", { action: "list" });
  assert.equal(agent.data.followUps.length, 1);
  assert.equal(agent.data.followUps[0].waitingForResponse, true);
  assert.equal(
    (await f.invoke("followUps", { action: "list" }, "owner")).data.followUps
      .length,
    2,
  );
  assert.equal(
    (await f.invoke("followUps", { action: "list", clientId: "c1" }, "other"))
      .code,
    403,
  );
});
test("client reminders target verified recipient, deduplicate daily, repeat overdue and start a new cycle", async () => {
  const f = clientWorkFixture();
  await f.schedule({ waitingForResponse: true });
  assert.equal((await f.runDue()).notified, 1);
  assert.equal(f.pushes[0].userId, "legacy-agent");
  assert.equal((await f.runDue()).notified, 0);
  f.clock += 86400000;
  assert.equal((await f.runDue()).notified, 1);
  await f.schedule({ followUpDate: "2026-10-11" });
  assert.equal((await f.runDue()).notified, 1);
  const notices = [...f.records].filter(([key]) =>
    key.startsWith("notifications/"),
  );
  assert.equal(notices.length, 3);
  assert(notices.at(-1)[1].message.includes("awaiting a response") === false);
});
test("reassignment, deleting client and disabled accounts stop reminders rather than leaking client data", async () => {
  for (const change of [
    (f) => {
      f.records.get("leads/l1").assignedTo = "other";
    },
    (f) => {
      f.records.get("clients/c1")._deleting = true;
    },
    (f) => {
      f.disabled = true;
    },
  ]) {
    const f = clientWorkFixture();
    await f.schedule();
    change(f);
    assert.equal((await f.runDue()).stopped, 1);
    assert.equal(f.pushes.length, 0);
    assert.equal(
      [...f.records.keys()].filter((key) =>
        key.startsWith("client_follow_ups/"),
      ).length,
      0,
    );
  }
});
test("request submission is retry-safe, owner notified once and unrelated agents cannot create/read it", async () => {
  const f = clientWorkFixture();
  const first = await f.create();
  const repeated = await f.create();
  assert.equal(first.code, 200);
  assert.equal(first.data.requestId, repeated.data.requestId);
  assert.equal(
    [...f.records.keys()].filter((key) => key.startsWith("client_requests/"))
      .length,
    1,
  );
  assert.equal(
    [...f.records.keys()].filter((key) => key.startsWith("notifications/"))
      .length,
    1,
  );
  assert.equal((await f.create({}, "other")).code, 403);
  assert.equal(
    (await f.invoke("requests", { action: "list" }, "other")).data.requests
      .length,
    0,
  );
  assert.equal(
    (await f.invoke("requests", { action: "list", clientId: "c1" }, "other"))
      .code,
    403,
  );
});
test("only owner moves progress, guards conflicting updates and saves a dated client activity", async () => {
  const f = clientWorkFixture();
  const requestId = (await f.create()).data.requestId;
  const change = {
    action: "status",
    requestId,
    version: 1,
    status: "ready-for-review",
    ownerUpdate: "**Ready** for client feedback",
  };
  assert.equal((await f.invoke("requests", change)).code, 403);
  assert.equal((await f.invoke("requests", change, "owner")).code, 200);
  assert.equal((await f.invoke("requests", change, "owner")).code, 200);
  assert.equal(
    (await f.invoke("requests", { ...change, status: "completed" }, "owner"))
      .code,
    409,
  );
  assert.equal(
    (
      await f.invoke(
        "requests",
        { ...change, version: 2, status: "completed" },
        "owner",
      )
    ).code,
    200,
  );
  assert.equal(
    f.records.get("client_requests/" + requestId).status,
    "completed",
  );
  assert.equal(
    [...f.records.keys()].filter((key) => key.startsWith("activities/")).length,
    2,
  );
  assert.equal(f.pushes.at(-1).userId, "legacy-agent");
});
test("current reassignment removes submitted requests from manager queue and stops status notifications", async () => {
  const f = clientWorkFixture();
  const requestId = (await f.create()).data.requestId;
  f.records.get("leads/l1").assignedTo = "other";
  assert.equal(
    (await f.invoke("requests", { action: "list" })).data.requests.length,
    0,
  );
  assert.equal(
    (
      await f.invoke(
        "requests",
        {
          action: "status",
          requestId,
          version: 1,
          status: "completed",
          ownerUpdate: "",
        },
        "owner",
      )
    ).code,
    200,
  );
  assert.equal(
    f.pushes.filter((item) => item.userId === "legacy-agent").length,
    0,
  );
});
test("attachment upload/download rechecks client access, excludes keys and public URLs from API output", async () => {
  const f = clientWorkFixture();
  const requestId = (await f.create()).data.requestId;
  const upload = {
    action: "upload",
    requestId,
    attachmentId: "file-1",
    name: "brief.txt",
    mimeType: "text/plain",
    content: Buffer.from("Client brief").toString("base64"),
  };
  assert.equal((await f.invoke("requests", upload)).code, 200);
  assert.equal((await f.invoke("requests", upload)).code, 200);
  assert.equal(f.uploads.size, 1);
  const list = (await f.invoke("requests", { action: "list" })).data;
  assert.equal(list.requests[0].attachments[0].name, "brief.txt");
  assert(!JSON.stringify(list).includes("key"));
  assert(!JSON.stringify(list).includes(".enc"));
  assert.equal(
    (
      await f.invoke("requests", {
        action: "download",
        requestId,
        attachmentId: "file-1",
      })
    ).data.content,
    upload.content,
  );
  assert.equal(
    (
      await f.invoke(
        "requests",
        { action: "download", requestId, attachmentId: "file-1" },
        "other",
      )
    ).code,
    403,
  );
  f.records.get("leads/l1").assignedTo = "other";
  assert.equal(
    (
      await f.invoke("requests", {
        action: "download",
        requestId,
        attachmentId: "file-1",
      })
    ).code,
    403,
  );
});
test("failed uploads retain cleanup references, lease prevents races, removal preserves references on storage failure", async () => {
  const f = clientWorkFixture();
  const requestId = (await f.create()).data.requestId;
  const upload = {
    action: "upload",
    requestId,
    attachmentId: "file-1",
    name: "brief.txt",
    mimeType: "text/plain",
    content: Buffer.from("brief").toString("base64"),
  };
  f.uploadFails = true;
  assert.equal((await f.invoke("requests", upload)).code, 500);
  assert.equal(
    f.records.get("client_requests/" + requestId).attachments[0].status,
    "pending",
  );
  assert.equal(
    (
      await f.invoke("requests", {
        action: "remove-attachment",
        requestId,
        attachmentId: "file-1",
      })
    ).code,
    409,
  );
  f.clock += 60001;
  f.uploadFails = false;
  await f.invoke("requests", upload);
  f.removeFails = true;
  assert.equal(
    (
      await f.invoke("requests", {
        action: "remove-attachment",
        requestId,
        attachmentId: "file-1",
      })
    ).code,
    500,
  );
  assert.equal(
    f.records.get("client_requests/" + requestId).attachments[0].status,
    "deleting",
  );
  assert.equal((await f.invoke("requests", upload)).code, 409);
  f.removeFails = false;
  assert.equal(
    (
      await f.invoke("requests", {
        action: "remove-attachment",
        requestId,
        attachmentId: "file-1",
      })
    ).code,
    200,
  );
  assert.equal(
    f.records.get("client_requests/" + requestId).attachments.length,
    0,
  );
  assert.equal(f.uploads.size, 0);
});
test("attachment limits reject executable formats, oversize data, bad base64 and fourth file", async () => {
  const f = clientWorkFixture();
  const requestId = (await f.create()).data.requestId;
  const file = {
    action: "upload",
    requestId,
    attachmentId: "f",
    name: "brief.txt",
    mimeType: "text/plain",
    content: Buffer.from("brief").toString("base64"),
  };
  for (const patch of [
    { mimeType: "text/html" },
    { content: "bad$$" },
    { content: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64") },
  ])
    assert.equal((await f.invoke("requests", { ...file, ...patch })).code, 400);
  for (let i = 0; i < 3; i++)
    assert.equal(
      (await f.invoke("requests", { ...file, attachmentId: "file-" + i })).code,
      200,
    );
  assert.equal(
    (await f.invoke("requests", { ...file, attachmentId: "fourth" })).code,
    400,
  );
});
test("push delivery failure preserves saved requests and bell notification; retry stays idempotent", async () => {
  const f = clientWorkFixture();
  f.pushFails = true;
  assert.equal((await f.create()).code, 200);
  assert.equal(
    [...f.records.keys()].filter((key) => key.startsWith("notifications/"))
      .length,
    1,
  );
  f.pushFails = false;
  assert.equal((await f.create()).code, 200);
  assert.equal(
    [...f.records.keys()].filter((key) => key.startsWith("client_requests/"))
      .length,
    1,
  );
});
test("pagination stays bounded and returns older requests without duplicates", async () => {
  const f = clientWorkFixture();
  for (let i = 0; i < 55; i++)
    f.records.set(`client_requests/${String(i).padStart(5, "0")}`, {
      clientId: "c1",
      submittedByUid: "agent",
      title: "Request " + i,
      description: "details",
      status: "received",
      priority: "normal",
      attachments: [],
    });
  const first = await f.invoke("requests", { action: "list" });
  assert.equal(first.data.requests.length, 50);
  assert(first.data.cursor);
  const next = await f.invoke("requests", {
    action: "list",
    cursor: first.data.cursor,
  });
  assert.equal(next.data.requests.length, 5);
  assert.equal(next.data.cursor, null);
  assert.equal(
    new Set(
      [...first.data.requests, ...next.data.requests].map((item) => item.id),
    ).size,
    55,
  );
});

test("existing protected cron runs client reminders and reports failed delivery for retry", async () => {
  const f = clientWorkFixture();
  await f.schedule();
  const run = async (token) => {
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
    await f.reminderHandler(
      { method: "GET", headers: { authorization: token } },
      res,
    );
    return res;
  };
  assert.equal((await run("Bearer wrong")).code, 401);
  assert.equal(f.pushes.length, 0);
  const first = await run("Bearer secret");
  assert.equal(first.code, 200);
  assert.equal(first.data.clients.notified, 1);
  f.clock += 86400000;
  f.pushFails = true;
  const failed = await run("Bearer secret");
  assert.equal(failed.code, 503);
  assert.equal(failed.data.clients.failed, 1);
});

test("owner can remove completed-request files to reclaim storage while managers cannot change closed attachments", async () => {
  const f = clientWorkFixture();
  const requestId = (await f.create()).data.requestId;
  await f.invoke("requests", {
    action: "upload",
    requestId,
    attachmentId: "file",
    name: "brief.txt",
    mimeType: "text/plain",
    content: Buffer.from("brief").toString("base64"),
  });
  await f.invoke(
    "requests",
    {
      action: "status",
      requestId,
      status: "completed",
      ownerUpdate: "",
      version: 1,
    },
    "owner",
  );
  const remove = {
    action: "remove-attachment",
    requestId,
    attachmentId: "file",
  };
  assert.equal((await f.invoke("requests", remove)).code, 409);
  assert.equal((await f.invoke("requests", remove, "owner")).code, 200);
  assert.equal(f.uploads.size, 0);
  assert.equal(
    f.records.get("client_requests/" + requestId).status,
    "completed",
  );
});
