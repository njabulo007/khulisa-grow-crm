import assert from "node:assert/strict";
import test from "node:test";
import { clientWorkFixture } from "./client-work-fixture.js";
const feedback = (f, patch = {}, uid = "agent") =>
  f.invoke(
    "feedback",
    {
      action: "create",
      clientId: "c1",
      requestId: "feedback-1",
      title: "Homepage design",
      deliverableVersion: "v1",
      decision: "changes-requested",
      decisionDate: "2026-10-10",
      decidedBy: "Client Contact",
      notes: "**Requested changes**\n\nReplace the hero photo.",
      ...patch,
    },
    uid,
  );
const growth = (f, patch = {}, uid = "agent") =>
  f.invoke(
    "opportunities",
    {
      action: "create",
      clientId: "c1",
      requestId: "growth-1",
      title: "Maintenance renewal",
      type: "renewal",
      proposal: "Client wants another year of support.",
      suggestedScope: "Monthly website updates and backups.",
      suggestedPrice: 1500,
      targetDate: "2027-01-10",
      ...patch,
    },
    uid,
  );
const review = (f, record, patch = {}, uid = "owner") =>
  f.invoke(
    "opportunities",
    {
      action: "review",
      clientId: record.clientId,
      recordId: record.id,
      version: record.version,
      requestId: `review-${record.version}`,
      status: "approved",
      approvedScope: "Monthly updates, backups and quarterly review.",
      approvedPrice: 1800,
      ownerNote: "Proceed with this scope.",
      ...patch,
    },
    uid,
  );

test("feedback captures the client decision, date and version; retries preserve immutable history", async () => {
  const f = clientWorkFixture();
  const first = await feedback(f);
  assert.equal(first.code, 200);
  assert.equal(first.data.version, 1);
  assert.equal((await feedback(f)).data.id, first.data.id);
  assert.equal(f.pushes.length, 1);
  const second = await feedback(f, {
    action: "revise",
    recordId: first.data.id,
    version: 1,
    requestId: "feedback-2",
    deliverableVersion: "v2",
    decision: "approved",
    notes: "Client approved the revised hero image.",
  });
  assert.equal(second.code, 200);
  assert.equal(second.data.version, 2);
  const history = await f.invoke("feedback", {
    action: "history",
    clientId: "c1",
    recordId: first.data.id,
  });
  assert.equal(history.code, 200);
  assert.equal(history.data.revisions.length, 2);
  assert.equal(history.data.revisions[0].decision, "changes-requested");
  assert.match(history.data.revisions[0].notes, /Replace the hero photo/);
  assert.equal(history.data.revisions[1].decision, "approved");
  assert.equal(
    (
      await feedback(f, {
        action: "revise",
        recordId: first.data.id,
        version: 1,
        requestId: "feedback-stale",
      })
    ).code,
    409,
  );
});

test("feedback access and history use current client assignments, including project-based access", async () => {
  const f = clientWorkFixture();
  const record = (await feedback(f)).data;
  assert.equal(
    (await feedback(f, { requestId: "other-feedback" }, "other")).code,
    403,
  );
  assert.equal(
    (await feedback(f, { clientId: "c2", requestId: "project-feedback" })).code,
    200,
  );
  assert.equal(
    (
      await f.invoke("feedback", {
        action: "history",
        clientId: "c2",
        recordId: record.id,
      })
    ).code,
    404,
  );
  f.records.set("leads/l1", { assignedTo: "other" });
  assert.equal(
    (
      await f.invoke("feedback", {
        action: "history",
        clientId: "c1",
        recordId: record.id,
      })
    ).code,
    403,
  );
  assert.equal(
    (await f.invoke("feedback", { action: "list", clientId: "c1" }, "owner"))
      .data.records.length,
    1,
  );
  assert.equal((await feedback(f, {}, "naked")).code, 401);
});

test("feedback rejects invented decisions, future or impossible dates and empty supporting evidence", async () => {
  const f = clientWorkFixture();
  for (const fields of [
    { decision: "pending" },
    { decisionDate: "2026-10-11" },
    { decisionDate: "2026-02-30" },
    { notes: "" },
    { deliverableVersion: "" },
    { decidedBy: "" },
  ])
    assert.equal((await feedback(f, fields)).code, 400);
  assert.equal(
    [...f.records.keys()].some((key) => key.startsWith("client_feedback/")),
    false,
  );
});

test("managers propose opportunities but cannot inject approval or approve scope and price", async () => {
  const f = clientWorkFixture();
  const record = await growth(f, {
    approvedScope: "Injected",
    approvedPrice: 1,
    status: "approved",
  });
  assert.equal(record.code, 200);
  assert.equal(record.data.status, "proposed");
  assert.equal(record.data.approvedPrice, null);
  assert.equal(record.data.approvedScope, "");
  assert.equal((await review(f, record.data, {}, "agent")).code, 403);
  const approved = await review(f, record.data);
  assert.equal(approved.code, 200);
  assert.equal(approved.data.approvedPrice, 1800);
  assert.match(approved.data.approvedScope, /quarterly review/);
  assert.equal(
    (
      await growth(f, {
        action: "revise",
        recordId: record.data.id,
        version: 2,
        requestId: "revise-approved",
      })
    ).code,
    409,
  );
  assert.equal(f.pushes.at(-1).userId, "legacy-agent");
  assert.equal(
    (await review(f, approved.data, { requestId: "stale-review", version: 1 }))
      .code,
    409,
  );
});

test("invoiced opportunities preserve approved terms while approval retries remain safe", async () => {
  const f = clientWorkFixture();
  const proposed = (await growth(f)).data;
  const approved = (await review(f, proposed)).data;
  const key = `client_opportunities/${approved.id}`;
  f.records.set(key, { ...f.records.get(key), linkedInvoiceId: "invoice-1" });
  assert.equal((await review(f, proposed)).code, 200);
  const changed = await review(f, approved, {
    requestId: "change-invoiced-terms",
    approvedPrice: 900,
    approvedScope: "Different scope",
  });
  assert.equal(changed.code, 409);
  assert.equal(f.records.get(key).approvedPrice, 1800);
  assert.equal(f.records.get(key).approvedScope, approved.approvedScope);
});

test("requesting changes and resubmission preserve the original scope and pricing history", async () => {
  const f = clientWorkFixture();
  const record = (await growth(f)).data;
  const changes = await review(f, record, {
    status: "needs-changes",
    approvedScope: "",
    approvedPrice: null,
    ownerNote: "Add a clear response-time commitment.",
  });
  assert.equal(changes.code, 200);
  const revised = await growth(f, {
    action: "revise",
    recordId: record.id,
    version: 2,
    requestId: "resubmit",
    suggestedScope:
      "Monthly backups and updates with next-business-day response.",
    suggestedPrice: 1700,
  });
  assert.equal(revised.code, 200);
  assert.equal(revised.data.status, "proposed");
  const final = await review(f, revised.data);
  assert.equal(final.code, 200);
  const history = await f.invoke("opportunities", {
    action: "history",
    clientId: "c1",
    recordId: record.id,
  });
  assert.deepEqual(
    history.data.revisions.map((item) => item.status),
    ["proposed", "needs-changes", "proposed", "approved"],
  );
  assert.equal(history.data.revisions[0].suggestedPrice, 1500);
  assert.equal(history.data.revisions[3].approvedPrice, 1800);
  assert.equal((await review(f, revised.data)).code, 200); // duplicate request, no additional revision
  assert.equal(
    [...f.records.keys()].filter((key) =>
      key.startsWith("client_opportunity_revisions/"),
    ).length,
    4,
  );
});

test("opportunity visibility and edit rights follow current assignments and the original proposer", async () => {
  const f = clientWorkFixture();
  const record = (await growth(f)).data;
  f.records.set("projects/p2", { clientId: "c1", assignedTo: "other" });
  assert.equal(
    (
      await f.invoke(
        "opportunities",
        { action: "list", clientId: "c1" },
        "other",
      )
    ).data.records[0].canEditProposal,
    false,
  );
  assert.equal(
    (
      await growth(
        f,
        {
          action: "revise",
          recordId: record.id,
          version: 1,
          requestId: "wrong-proposer",
        },
        "other",
      )
    ).code,
    403,
  );
  assert.equal(
    (await f.invoke("opportunities", { action: "list" }, "other")).data.records
      .length,
    0,
  );
  f.records.set("leads/l1", { assignedTo: "other" });
  const pushes = f.pushes.length;
  assert.equal((await review(f, record)).code, 200);
  assert.equal(f.pushes.length, pushes);
  assert.equal(
    (await f.invoke("opportunities", { action: "list" })).data.records.length,
    0,
  );
  assert.equal(
    (await f.invoke("opportunities", { action: "list" }, "owner")).data.records
      .length,
    1,
  );
});

test("scope and money validation reject invalid prices and incomplete owner decisions", async () => {
  const f = clientWorkFixture();
  const record = (await growth(f)).data;
  for (const approvedPrice of [null, -1, NaN, Infinity, 12.345, 1e10])
    assert.equal((await review(f, record, { approvedPrice })).code, 400);
  assert.equal((await review(f, record, { approvedScope: "" })).code, 400);
  assert.equal(
    (await review(f, record, { status: "declined", ownerNote: "" })).code,
    400,
  );
  assert.equal(
    (await growth(f, { suggestedPrice: 12.345, requestId: "invalid-price" }))
      .code,
    400,
  );
  assert.equal(
    (
      await growth(f, {
        type: "referral",
        suggestedPrice: null,
        requestId: "referral",
      })
    ).code,
    200,
  );
  assert.equal(
    (await growth(f, { type: "additional-service", requestId: "service" }))
      .code,
    200,
  );
  assert.equal((await review(f, record, { approvedPrice: 0 })).code, 200);
});

test("feedback and opportunity lists and revision histories remain bounded and paginated", async () => {
  const f = clientWorkFixture();
  for (let i = 0; i < 53; i++)
    f.records.set(`client_opportunities/${String(i).padStart(5, "0")}`, {
      clientId: "c1",
      proposedByUid: "agent",
      status: "proposed",
      updatedAt: "2026-10-10",
    });
  const first = await f.invoke("opportunities", { action: "list" });
  assert.equal(first.data.records.length, 50);
  assert.equal(
    (
      await f.invoke("opportunities", {
        action: "list",
        cursor: first.data.cursor,
      })
    ).data.records.length,
    3,
  );
  const parent = (await feedback(f)).data;
  for (let i = 2; i <= 53; i++)
    f.records.set(
      `client_feedback_revisions/${parent.id}_${String(i).padStart(10, "0")}`,
      { recordId: parent.id, clientId: "c1", version: i },
    );
  const history = await f.invoke("feedback", {
    action: "history",
    clientId: "c1",
    recordId: parent.id,
  });
  assert.equal(history.data.revisions.length, 50);
  assert.equal(
    (
      await f.invoke("feedback", {
        action: "history",
        clientId: "c1",
        recordId: parent.id,
        cursor: history.data.cursor,
      })
    ).data.revisions.length,
    3,
  );
});
