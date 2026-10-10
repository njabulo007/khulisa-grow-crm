import assert from "node:assert/strict";
import test from "node:test";
import { clientWorkFixture } from "./client-work-fixture.js";
const get = (f, uid = "agent", clientId = "c1") =>
  f.invoke("care", { action: "get", clientId }, uid);
const health = (f, fields = {}, uid = "agent") =>
  f.invoke(
    "care",
    {
      action: "health",
      clientId: "c1",
      version: 0,
      requestId: "health-1",
      status: "needs-attention",
      reason: "**Client waiting** on updated content",
      lastContactDate: "2026-10-09",
      escalate: false,
      ...fields,
    },
    uid,
  );
const checklist = (status) =>
  Object.fromEntries(
    ["logo", "content", "access", "contract", "requirements"].map((key) => [
      key,
      { status, notes: "" },
    ]),
  );
const onboarding = (f, items, fields = {}, uid = "agent") =>
  f.invoke(
    "care",
    {
      action: "onboarding",
      clientId: "c1",
      version: 0,
      requestId: "checklist-1",
      checklist: items,
      ...fields,
    },
    uid,
  );

test("new clients are unassessed; existing completed onboarding is preserved without migrating records", async () => {
  const f = clientWorkFixture();
  const first = await get(f);
  assert.equal(first.code, 200);
  assert.equal(first.data.health, null);
  assert.equal(first.data.completedItems, 0);
  f.records.set("clients/c1", {
    ...f.records.get("clients/c1"),
    onboardingCompleted: true,
    contractSigned: true,
  });
  const legacy = await get(f);
  assert.equal(legacy.data.legacyCompleted, true);
  assert.equal(legacy.data.completedItems, 5);
  assert.equal(f.records.has("client_care/c1"), false);
  assert.equal((await get(f, "agent", "c2")).code, 200);
});

test("care access and summary recheck current assignments and omit inaccessible concerns", async () => {
  const f = clientWorkFixture();
  assert.equal((await health(f)).code, 200);
  assert.equal((await get(f, "other")).code, 403);
  const summary = await f.invoke("care", {
    action: "summary",
    clientIds: ["c1", "c2", "missing", "c1"],
  });
  assert.equal(summary.code, 200);
  assert.equal(summary.data.clients.length, 2);
  f.records.set("leads/l1", { assignedTo: "other" });
  assert.equal((await get(f)).code, 403);
  assert.equal(
    (await f.invoke("care", { action: "summary", clientIds: ["c1"] })).data
      .clients.length,
    0,
  );
  assert.equal(
    (await get(f, "owner")).data.health.reason,
    "**Client waiting** on updated content",
  );
  assert.equal(
    (
      await f.invoke("care", {
        action: "summary",
        clientIds: Array(51).fill("c1"),
      })
    ).code,
    400,
  );
  assert.equal((await get(f, "naked")).code, 401);
});

test("checklist tracks missing/requested items and derives legacy completion and signed-contract flags", async () => {
  const f = clientWorkFixture();
  const items = checklist("received");
  items.access = {
    status: "requested",
    notes: "Invite editor access by Friday; no passwords stored.",
  };
  const partial = await onboarding(f, items);
  assert.equal(partial.code, 200);
  assert.equal(partial.data.completedItems, 4);
  assert.equal(partial.data.onboardingCompleted, false);
  assert.equal(f.records.get("clients/c1").contractSigned, true);
  items.access.status = "not-required";
  const done = await onboarding(f, items, {
    version: 1,
    requestId: "checklist-2",
  });
  assert.equal(done.code, 200);
  assert.equal(done.data.onboardingCompleted, true);
  assert.equal(f.records.get("clients/c1").onboardingCompleted, true);
  items.content.status = "outstanding";
  assert.equal(
    (await onboarding(f, items, { version: 2, requestId: "checklist-3" })).data
      .onboardingCompleted,
    false,
  );
  assert.equal(f.records.get("clients/c1").onboardingCompleted, false);
  assert.equal(
    [...f.records.keys()].filter((key) =>
      key.startsWith("activities/client_care_"),
    ).length,
    3,
  );
});

test("health escalation is durable, retry-safe and sends one bell/push to the owner", async () => {
  const f = clientWorkFixture();
  const result = await health(f, { status: "at-risk", escalate: true });
  assert.equal(result.code, 200);
  assert.equal(result.data.escalation.status, "open");
  assert.equal(f.pushes.length, 1);
  assert.equal(f.pushes[0].userId, "owner");
  const notification = [...f.records.values()].find(
    (value) => value.type === "client_health",
  );
  assert.equal(notification.clientId, "c1");
  assert.match(notification.message, /Client waiting/);
  assert.equal(
    (await health(f, { status: "at-risk", escalate: true })).code,
    200,
  );
  assert.equal(f.pushes.length, 1);
  assert.equal(
    [...f.records.keys()].filter((key) =>
      key.startsWith("activities/client_care_"),
    ).length,
    1,
  );
  const forbidden = await f.invoke("care", {
    action: "resolve",
    clientId: "c1",
    version: 1,
    requestId: "resolve-1",
    reason: "Discussed with client",
  });
  assert.equal(forbidden.code, 403);
  const resolved = await f.invoke(
    "care",
    {
      action: "resolve",
      clientId: "c1",
      version: 1,
      requestId: "resolve-1",
      reason: "Agreed to deliver updated content tomorrow",
    },
    "owner",
  );
  assert.equal(resolved.code, 200);
  assert.equal(resolved.data.escalation.status, "resolved");
  assert.equal(
    (await get(f)).data.escalation.resolution,
    "Agreed to deliver updated content tomorrow",
  );
});

test("invalid health, dates, notes and checklist values do not create care or activities", async () => {
  const f = clientWorkFixture();
  for (const patch of [
    { status: "unknown" },
    { reason: "" },
    { reason: "x".repeat(4001) },
    { lastContactDate: "2026-02-30" },
    { lastContactDate: "2026-10-11" },
    { status: "healthy", escalate: true },
  ])
    assert.equal((await health(f, patch)).code, 400);
  const bad = checklist("received");
  bad.access.status = "password";
  assert.equal((await onboarding(f, bad)).code, 400);
  assert.equal(
    (await onboarding(f, { logo: { status: "received", notes: "" } })).code,
    400,
  );
  assert.equal(f.records.has("client_care/c1"), false);
  assert.equal(
    [...f.records.keys()].some((key) => key.startsWith("activities/")),
    false,
  );
});

test("recording a contact updates the shared last-contact date and preserves health and onboarding", async () => {
  const f = clientWorkFixture();
  assert.equal((await health(f)).code, 200);
  assert.equal(
    (await onboarding(f, checklist("requested"), { version: 1 })).code,
    200,
  );
  const payload = {
    action: "complete",
    clientId: "c1",
    requestId: "contact-1",
    type: "call",
    description: "Discussed outstanding logo",
    nextFollowUpDate: "",
    notes: "",
    waitingForResponse: false,
  };
  assert.equal((await f.invoke("followUps", payload)).code, 200);
  const current = await get(f);
  assert.equal(current.data.lastContactAt, "2026-10-10T07:00:00.000Z");
  assert.equal(current.data.version, 3);
  assert.equal(current.data.health.status, "needs-attention");
  assert.equal(current.data.checklist.logo.status, "requested");
  assert.equal((await f.invoke("followUps", payload)).code, 200);
  assert.equal((await get(f)).data.version, 3);
  assert.equal(
    (await health(f, { requestId: "stale-save", version: 2 })).code,
    409,
  );
  assert.equal(
    (
      await health(f, {
        requestId: "health-2",
        version: 3,
        lastContactDate: "2026-10-10",
      })
    ).data.lastContactAt,
    "2026-10-10T07:00:00.000Z",
  );
  assert.equal(
    (
      await f.invoke("followUps", {
        ...payload,
        requestId: "note-1",
        type: "note",
      })
    ).code,
    200,
  );
  assert.equal((await get(f)).data.version, 4);
});

test("failed push does not lose the escalated concern or owner bell record", async () => {
  const f = clientWorkFixture();
  f.pushFails = true;
  assert.equal((await health(f, { escalate: true })).code, 200);
  assert.equal((await get(f, "owner")).data.escalation.status, "open");
  assert(
    [...f.records.values()].some((value) => value.type === "client_health"),
  );
});

test("last contact preserves precise timestamps across South African midnight", async () => {
  const f = clientWorkFixture();
  f.clock = Date.parse("2026-10-10T22:30:00Z");
  assert.equal((await health(f, { lastContactDate: "2026-10-11" })).code, 200);
  await f.invoke("followUps", {
    action: "complete",
    clientId: "c1",
    requestId: "late-call",
    type: "call",
    description: "Confirmed next steps",
    nextFollowUpDate: "",
    notes: "",
    waitingForResponse: false,
  });
  const response = await health(f, {
    version: 2,
    requestId: "midnight-health",
    lastContactDate: "2026-10-11",
  });
  assert.equal(response.code, 200);
  assert.equal(response.data.lastContactAt, "2026-10-10T22:30:00.000Z");
});

test("legacy onboarding completion never invents a signed contract", async () => {
  const f = clientWorkFixture();
  f.records.set("clients/c1", {
    ...f.records.get("clients/c1"),
    onboardingCompleted: true,
    contractSigned: false,
  });
  const care = await get(f);
  assert.equal(care.data.checklist.contract.status, "outstanding");
  assert.equal(care.data.onboardingCompleted, true);
  assert.equal(care.data.completedItems, 4);
  assert.equal((await health(f)).data.checklist.contract.status, "outstanding");
  assert.equal(f.records.get("clients/c1").contractSigned, false);
  const saved = await onboarding(f, care.data.checklist, { version: 1 });
  assert.equal(saved.data.onboardingCompleted, false);
  assert.equal(f.records.get("clients/c1").onboardingCompleted, false);
});
