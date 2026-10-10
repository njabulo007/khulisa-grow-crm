import assert from "node:assert/strict";
import test from "node:test";
import { clientWorkFixture } from "./client-work-fixture.js";
import { createWorkflowHandler } from "../api/_lib/workflowHandlers.js";
import {
  createPortalResponseHandler,
  createPortalStaffHandler,
} from "../api/_lib/portalWorkflowHandlers.js";
import { tokenHash } from "../api/_lib/projectShareCore.js";
const invoke = async (handler, body, uid = "owner") => {
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
  await handler({ method: "POST", headers: { authorization: uid }, body }, res);
  return res;
};
const fixture = () => {
  const f = clientWorkFixture({
    "clients/c1": { businessName: "One", leadId: "l1" },
    "projects/p1": {
      clientId: "c1",
      assignedTo: "agent",
      packageId: "digital-starter-presence",
      status: "in-progress",
    },
    "users/agent": { role: "agent", appUserId: "agent", commissionRate: 25 },
    "settings/global": { commissionMode: "manual" },
    "invoices/i1": {
      clientId: "c1",
      projectId: "p1",
      status: "sent",
      invoiceNumber: "KM-2026-0003",
      packageId: "digital-starter-presence",
      items: [{ quantity: 1, unitPrice: 1500 }],
      createdAt: "2026-10-01",
    },
  });
  f.requireOwner = async (req) => {
    if (req.headers.authorization !== "owner")
      throw Object.assign(new Error("Owner only"), { status: 403 });
    return { uid: "owner" };
  };
  f.workflow = createWorkflowHandler({
    db: f.db,
    auth: f.auth,
    requireOwner: f.requireOwner,
    now: () => f.clock,
  });
  return f;
};
const pay = {
  action: "payment",
  invoiceId: "i1",
  requestId: "pay-1",
  amount: 500,
  method: "eft",
  reference: "BANK-ONE",
  paidAt: "2026-10-10T07:00:00Z",
};
test("invoice reservations use maximum existing suffix and survive deletion and concurrent attempts", async () => {
  const f = fixture();
  assert.equal(
    (await invoke(f.workflow, { action: "reserve-number" })).data.invoiceNumber,
    "KM-2026-0004",
  );
  f.records.delete("invoices/i1");
  const results = await Promise.all([
    invoke(f.workflow, { action: "reserve-number" }),
    invoke(f.workflow, { action: "reserve-number" }),
  ]);
  assert.deepEqual(
    results.map((r) => r.data.invoiceNumber),
    ["KM-2026-0005", "KM-2026-0006"],
  );
  assert.equal(
    (await invoke(f.workflow, { action: "reserve-number" }, "agent")).code,
    403,
  );
});
test("payment records reconcile partial and full balances plus central manual-rate commission, without duplicate retries", async () => {
  const f = fixture();
  const first = await invoke(f.workflow, pay);
  assert.equal(first.code, 200);
  assert.equal((await invoke(f.workflow, pay)).data.id, first.data.id);
  assert.equal(f.records.get("invoices/i1").amountPaid, 500);
  assert.equal(f.records.get("commissions/invoice_i1").commissionAmount, 375);
  assert.equal(f.records.get("commissions/invoice_i1").status, "pending");
  assert.equal(
    (
      await invoke(f.workflow, {
        ...pay,
        requestId: "pay-2",
        amount: 1000,
        reference: "BANK-TWO",
      })
    ).code,
    200,
  );
  assert.equal(f.records.get("invoices/i1").status, "paid");
  assert.equal(f.records.get("commissions/invoice_i1").status, "earned");
  assert.equal(
    (
      await invoke(f.workflow, {
        ...pay,
        requestId: "pay-3",
        reference: "BANK-THREE",
      })
    ).code,
    409,
  );
  assert.equal((await invoke(f.workflow, { ...pay, amount: 600 })).code, 409);
});
test("payments reject draft invoices, untrusted amounts and nonowners; settled commissions stay unchanged", async () => {
  const f = fixture();
  assert.equal((await invoke(f.workflow, pay, "agent")).code, 403);
  assert.equal((await invoke(f.workflow, { ...pay, amount: NaN })).code, 400);
  assert.equal((await invoke(f.workflow, { ...pay, amount: 0.001 })).code, 400);
  f.records.get("invoices/i1").status = "draft";
  assert.equal((await invoke(f.workflow, pay)).code, 409);
  f.records.get("invoices/i1").status = "sent";
  const settled = {
    invoiceId: "i1",
    status: "paid-out",
    commissionAmount: 123,
    rate: 0.12,
  };
  f.records.set("commissions/settled", settled);
  assert.equal((await invoke(f.workflow, pay)).code, 200);
  assert.deepEqual(f.records.get("commissions/settled"), settled);
});
test("commission rates persist centrally; disabling access denies profile before revoking sessions", async () => {
  const f = fixture(),
    events = [];
  f.auth.updateUser = async (uid, patch) => {
    events.push(["auth", uid, patch]);
    assert.equal(f.records.get("users/agent").accessDisabled, true);
  };
  f.auth.revokeRefreshTokens = async (uid) => events.push(["revoke", uid]);
  assert.equal(
    (
      await invoke(f.workflow, {
        action: "commission-rates",
        rates: [{ uid: "agent", rate: 32 }],
      })
    ).code,
    200,
  );
  assert.equal(f.records.get("users/agent").commissionRate, 32);
  assert.equal(
    (await invoke(f.workflow, { action: "disable-access", uid: "owner" })).code,
    400,
  );
  assert.equal(
    (await invoke(f.workflow, { action: "disable-access", uid: "agent" })).code,
    200,
  );
  assert.equal(events.length, 2);
});
test("growth invoice uses approved scope and price once and consumes a permanent number", async () => {
  const f = fixture();
  f.records.set("client_opportunities/g1", {
    clientId: "c1",
    status: "approved",
    title: "Support",
    approvedScope: "Monthly updates",
    approvedPrice: 900,
  });
  const first = await invoke(f.workflow, {
    action: "growth-invoice",
    opportunityId: "g1",
  });
  assert.equal(first.code, 200);
  assert.equal(
    (
      await invoke(f.workflow, {
        action: "growth-invoice",
        opportunityId: "g1",
      })
    ).data.invoiceId,
    first.data.invoiceId,
  );
  assert.equal(f.records.get("invoices/growth_g1").total, 900);
  assert.equal(
    f.records.get("invoices/growth_g1").items[0].description,
    "Monthly updates",
  );
  assert.equal(f.records.get("_invoice_counters/2026").last, 4);
});
const portalFixture = () => {
  const f = fixture();
  f.records.set("project_shares/s1", {
    tokenHash: tokenHash("secret-token"),
    projectId: "p1",
    status: "active",
    expiresAt: "2027-01-01",
  });
  f.public = createPortalResponseHandler({ db: f.db, now: () => f.clock });
  f.staff = createPortalStaffHandler({
    db: f.db,
    requireOwner: f.requireOwner,
    now: () => f.clock,
  });
  return f;
};
test("portal decisions are scoped to the current revision and wait for owner verification; history remains immutable", async () => {
  const f = portalFixture();
  const publish = await invoke(f.staff, {
    action: "publish-review",
    projectId: "p1",
    title: "Homepage",
    version: "v2",
    instructions: "Review the shared preview.",
  });
  assert.equal(publish.code, 200);
  const payload = {
    token: "secret-token",
    action: "decision",
    requestId: "response-1",
    contactName: "Client",
    notes: "Approved the revised hero.",
    decision: "approved",
    reviewId: publish.data.review.id,
  };
  const response = await invoke(f.public, payload);
  assert.equal(response.code, 200);
  assert.equal(response.data.status, "pending-verification");
  assert.equal((await invoke(f.public, payload)).data.id, response.data.id);
  assert.equal(
    [...f.records.keys()].filter((k) => k.startsWith("client_feedback/"))
      .length,
    0,
  );
  assert.equal(
    (
      await invoke(
        f.staff,
        {
          action: "verify-response",
          projectId: "p1",
          responseId: response.data.id,
        },
        "agent",
      )
    ).code,
    403,
  );
  const verified = await invoke(f.staff, {
    action: "verify-response",
    projectId: "p1",
    responseId: response.data.id,
  });
  assert.equal(verified.code, 200);
  const feedback = [...f.records.entries()].find(([k]) =>
    k.startsWith("client_feedback/"),
  )[1];
  assert.equal(feedback.decision, "approved");
  assert.equal(feedback.deliverableVersion, "v2");
  assert.equal(
    [...f.records.keys()].filter((k) =>
      k.startsWith("client_feedback_revisions/"),
    ).length,
    1,
  );
  assert.equal(
    (await invoke(f.public, { ...payload, requestId: "response-2" })).code,
    409,
  );
});
test("portal rejects revoked/expired links, superseded reviews, cross-project verification, and flood submissions", async () => {
  const f = portalFixture();
  const p = {
    token: "secret-token",
    action: "request",
    requestId: "one",
    title: "Change hours",
    contactName: "Client",
    notes: "Please use 9am.",
  };
  assert.equal((await invoke(f.public, { ...p, token: "bad" })).code, 404);
  f.records.get("project_shares/s1").status = "revoked";
  assert.equal((await invoke(f.public, p)).code, 403);
  f.records.get("project_shares/s1").status = "active";
  f.records.get("project_shares/s1").expiresAt = "2026-01-01";
  assert.equal((await invoke(f.public, p)).code, 403);
  f.records.get("project_shares/s1").expiresAt = "2027-01-01";
  for (let i = 0; i < 10; i++)
    assert.equal(
      (await invoke(f.public, { ...p, requestId: `r-${i}` })).code,
      200,
    );
  assert.equal(
    (await invoke(f.public, { ...p, requestId: "overflow" })).code,
    429,
  );
  assert.equal((await invoke(f.public, { ...p, requestId: "r-0" })).code, 200);
  const response = [...f.records.entries()].find(([k]) =>
    k.startsWith("portal_responses/"),
  );
  assert.equal(
    (
      await invoke(f.staff, {
        action: "verify-response",
        projectId: "p2",
        responseId: response[0].split("/")[1],
      })
    ).code,
    404,
  );
});
test("verified portal requests join the owner queue; review outcomes transition only the explicit linked request", async () => {
  const f = portalFixture();
  const r = await invoke(f.public, {
    token: "secret-token",
    action: "request",
    requestId: "change",
    title: "Hours",
    contactName: "Client",
    notes: "Change to 9am.",
  });
  assert.equal(
    (
      await invoke(f.staff, {
        action: "verify-response",
        projectId: "p1",
        responseId: r.data.id,
      })
    ).code,
    200,
  );
  const requestId = `portal_${r.data.id}`;
  assert.equal(
    f.records.get(`client_requests/${requestId}`).status,
    "received",
  );
  const review = await invoke(f.staff, {
    action: "publish-review",
    projectId: "p1",
    title: "Hours update",
    version: "v1",
    instructions: "Check hours.",
    requestId,
  });
  const decision = await invoke(f.public, {
    token: "secret-token",
    action: "decision",
    requestId: "decision",
    contactName: "Client",
    notes: "Needs 8am instead.",
    decision: "changes-requested",
    reviewId: review.data.review.id,
  });
  assert.equal(
    (
      await invoke(f.staff, {
        action: "verify-response",
        projectId: "p1",
        responseId: decision.data.id,
      })
    ).code,
    200,
  );
  assert.equal(
    f.records.get(`client_requests/${requestId}`).status,
    "in-progress",
  );
});

test("portal publication and response retries remain idempotent after verification", async () => {
  const f = portalFixture(),
    input = {
      action: "publish-review",
      projectId: "p1",
      title: "Home",
      version: "v1",
      instructions: "Review.",
      attemptId: "attempt-1",
    };
  const a = await invoke(f.staff, input),
    b = await invoke(f.staff, input);
  assert.equal(a.data.review.id, b.data.review.id);
  const responseInput = {
    token: "secret-token",
    action: "decision",
    requestId: "decision-1",
    contactName: "Client",
    notes: "Approved.",
    decision: "approved",
    reviewId: a.data.review.id,
  };
  const response = await invoke(f.public, responseInput);
  await invoke(f.staff, {
    action: "verify-response",
    projectId: "p1",
    responseId: response.data.id,
  });
  assert.equal(
    (await invoke(f.public, responseInput)).data.id,
    response.data.id,
  );
});
test("dedicated contact managers access client care and requests without a lead/project assignment", async () => {
  const f = clientWorkFixture({
    "clients/c1": { businessName: "Managed", contactManagerId: "other" },
  });
  assert.equal(
    (await f.invoke("care", { action: "get", clientId: "c1" }, "other")).code,
    200,
  );
  assert.equal(
    (await f.invoke("care", { action: "get", clientId: "c2" }, "other")).code,
    403,
  );
  f.records.get("clients/c1").contactManagerId = "agent";
  assert.equal(
    (await f.invoke("care", { action: "get", clientId: "c1" }, "other")).code,
    403,
  );
});
test("bounded maintenance deletes expired notifications and rate limits while preserving financial and recent records", async () => {
  const { sweepWorkflowHistory } =
    await import("../api/_lib/workflowMaintenance.js");
  const f = fixture();
  f.records.set("notifications/old", { createdAt: "2026-08-01T00:00:00Z" });
  f.records.set("notifications/recent", { createdAt: "2026-10-09T00:00:00Z" });
  f.records.set("_portal_limits/old", { expiresAt: "2026-10-01T00:00:00Z" });
  const result = await sweepWorkflowHistory(f.db, f.clock);
  assert.equal(result.deleted, 2);
  assert.equal(f.records.has("notifications/recent"), true);
  assert.equal(f.records.has("invoices/i1"), true);
  assert.equal((await sweepWorkflowHistory(f.db, f.clock)).deleted, 0);
});
test("duplicate receipt survives page reload and payout requires actual full payment with a fixed receipt", async () => {
  const f = fixture();
  await invoke(f.workflow, pay);
  const repeat = await invoke(f.workflow, {
    ...pay,
    requestId: "new-page-attempt",
  });
  assert.equal(repeat.code, 200);
  assert.equal(
    [...f.records.keys()].filter((k) => k.startsWith("payments/")).length,
    1,
  );
  assert.equal(
    (
      await invoke(f.workflow, {
        action: "payout",
        commissionId: "invoice_i1",
        reference: "TRANSFER",
      })
    ).code,
    409,
  );
  await invoke(f.workflow, {
    ...pay,
    requestId: "remainder",
    amount: 1000,
    reference: "BANK-TWO",
  });
  assert.equal(
    (
      await invoke(f.workflow, {
        action: "payout",
        commissionId: "invoice_i1",
        reference: "TRANSFER",
      })
    ).code,
    200,
  );
  const settled = f.records.get("commissions/invoice_i1");
  assert.equal(settled.payoutReference, "TRANSFER");
  assert.equal(
    (
      await invoke(f.workflow, {
        action: "payout",
        commissionId: "invoice_i1",
        reference: "TRANSFER",
      })
    ).code,
    200,
  );
  assert.equal(
    (
      await invoke(f.workflow, {
        action: "payout",
        commissionId: "invoice_i1",
        reference: "DIFFERENT",
      })
    ).code,
    409,
  );
  assert.deepEqual(f.records.get("commissions/invoice_i1"), settled);
});
test("new percentage rates below one percent are distinct from legacy decimal rates", async () => {
  const f = fixture();
  await invoke(f.workflow, {
    action: "commission-rates",
    rates: [{ uid: "agent", rate: 0.5 }],
  });
  await invoke(f.workflow, pay);
  assert.equal(f.records.get("commissions/invoice_i1").rate, 0.005);
  assert.equal(f.records.get("commissions/invoice_i1").commissionAmount, 7.5);
  const legacy = fixture();
  legacy.records.get("users/agent").commissionRate = 0.15;
  await invoke(legacy.workflow, pay);
  assert.equal(legacy.records.get("commissions/invoice_i1").rate, 0.15);
});
test("delivered project keeps scoped requests available, while older review decisions are blocked", async () => {
  const f = portalFixture();
  f.records.get("projects/p1").status = "delivered";
  assert.equal(
    (
      await invoke(f.public, {
        token: "secret-token",
        action: "request",
        requestId: "after-delivery",
        title: "New update",
        contactName: "Client",
        notes: "Please add a new service.",
      })
    ).code,
    200,
  );
  assert.equal(
    (
      await invoke(f.public, {
        token: "secret-token",
        action: "decision",
        reviewId: "old",
        decision: "approved",
        requestId: "old-review",
        contactName: "Client",
        notes: "Approved.",
      })
    ).code,
    409,
  );
});
