import test from "node:test";
import assert from "node:assert/strict";
import { clientWorkFixture } from "./client-work-fixture.js";
import { createPortalOnboardingHandlers } from "../api/_lib/portalOnboardingHandlers.js";
import { tokenHash } from "../api/_lib/projectShareCore.js";
import {
  missingOnboardingFields,
  templateIdsFor,
} from "../shared/onboarding.js";
const answers = {
  businessName: "Client One",
  businessDescription: "We repair equipment.",
  contactName: "Client Contact",
  contactPhone: "0600000000",
  location: "Soweto",
  productsServices: "Equipment repairs",
  customers: "Local small businesses",
  preferredContact: "WhatsApp",
  websiteGoals: "Get enquiries",
  websitePages: "Home, services, contact",
  websiteAction: "Call us",
};
function fixture() {
  const f = clientWorkFixture({
    "projects/p1": {
      clientId: "c1",
      assignedTo: "legacy-agent",
      packageId: "digital-starter-presence",
      status: "in-progress",
    },
    "project_shares/s1": {
      projectId: "p1",
      tokenHash: tokenHash("token"),
      status: "active",
    },
    "clients/c1": {
      businessName: "Original",
      ownerName: "Contact",
      email: "client@example.com",
      phone: "0600000000",
      leadId: "l1",
    },
  });
  const handlers = createPortalOnboardingHandlers({
    db: f.db,
    now: () => f.clock,
    authenticate: async (req) => ({
      uid: req.headers.authorization,
      appUserId:
        req.headers.authorization === "agent"
          ? "legacy-agent"
          : req.headers.authorization,
      role: req.headers.authorization === "owner" ? "owner" : "agent",
    }),
    requireOwner: async (req) => {
      if (req.headers.authorization !== "owner")
        throw Object.assign(Error("Developer approval required"), {
          status: 403,
        });
    },
    notify: async (...args) => f.pushes.push(args),
    files: {
      upload: async (file, bytes) => {
        if (f.uploadFails) throw Error("Storage unavailable");
        f.uploads.set(file.path, bytes);
      },
      download: async (file) => f.uploads.get(file.path),
      remove: async (file) => {
        if (f.removeFails) throw Error("Storage unavailable");
        f.uploads.delete(file.path);
      },
    },
  });
  f.call = async (p = {}, uid) => {
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
    await handlers[uid ? "staff" : "public"](
      {
        method: "POST",
        headers: { authorization: uid },
        body: { token: "token", action: "onboarding-get", ...p },
      },
      res,
    );
    return res;
  };
  return f;
}
const save = (version = 0, extra = {}) => ({
  action: "onboarding-save",
  version,
  requestId: `save-${version}`,
  answers,
  ...extra,
});
const submit = (version = 0, extra = {}) => ({
  ...save(version),
  action: "onboarding-submit",
  confirmed: true,
  ...extra,
});
const png = {
  name: "logo.png",
  mimeType: "image/png",
  base64: Buffer.from("89504e470d0a1a0a010203", "hex").toString("base64"),
};
test("existing links load known details without exposing internal data or making writes", async () => {
  const f = fixture();
  f.records.set("project_onboarding/p1", {
    version: 1,
    status: "in-progress",
    answers: { businessDescription: "Repairs" },
    reviewedBy: "SECRET",
    files: [
      {
        id: "f1",
        name: "logo",
        key: "SECRET",
        path: "PRIVATE",
        status: "ready",
      },
    ],
  });
  const r = await f.call();
  assert.equal(r.code, 200);
  assert.equal(r.data.answers.businessName, "Original");
  assert.deepEqual(r.data.templateIds, ["website"]);
  assert.doesNotMatch(JSON.stringify(r.data), /SECRET|PRIVATE/);
  assert.equal(f.records.size, 9);
});
test("drafts use optimistic versions, retry IDs and never overwrite canonical client records", async () => {
  const f = fixture();
  assert.equal((await f.call(save())).code, 200);
  assert.equal((await f.call(save())).code, 200);
  assert.equal((await f.call(save(0, { requestId: "stale" }))).code, 409);
  assert.equal(
    (
      await f.call(
        save(0, { answers: { ...answers, businessName: "Changed" } }),
      )
    ).code,
    409,
  );
  assert.equal(f.records.get("clients/c1").businessName, "Original");
  assert.equal(f.records.get("projects/p1").onboardingStatus, "in-progress");
});
test("client cannot inject states, prices, irrelevant questions or submit missing details", async () => {
  const f = fixture();
  assert.equal(
    (await f.call(save(0, { answers: { ...answers, status: "approved" } })))
      .code,
    400,
  );
  assert.equal(
    (await f.call(save(0, { answers: { ...answers, shopPayments: "Cash" } })))
      .code,
    400,
  );
  assert.equal(
    (await f.call(submit(0, { answers: { businessName: "Only name" } }))).code,
    400,
  );
  assert.equal((await f.call(submit(0, { confirmed: false }))).code, 400);
  assert.equal(
    (await f.call({ action: "onboarding-review", status: "approved" })).code,
    400,
  );
});
test("submission records immutable history/activity, notifies team and freezes client editing", async () => {
  const f = fixture();
  const r = await f.call(submit());
  assert.equal(r.code, 200);
  assert.equal(r.data.status, "submitted");
  assert.equal(
    f.records.get("project_onboarding_revisions/p1_1").answers.businessName,
    "Client One",
  );
  assert.equal(f.pushes.length, 1);
  assert.ok(
    [...f.records.keys()].some((k) => k.startsWith("activities/onboarding_")),
  );
  assert.equal((await f.call(save(1))).code, 409);
});
test("only current team can review, only developer approves; more-information enables resubmission", async () => {
  const f = fixture();
  await f.call(submit());
  const review = {
    projectId: "p1",
    action: "review",
    version: 1,
    requestId: "review",
    status: "more-information-needed",
    feedback: "Please confirm the opening hours.",
  };
  assert.equal((await f.call(review, "other")).code, 403);
  assert.equal(
    (await f.call({ ...review, status: "approved" }, "agent")).code,
    403,
  );
  assert.equal((await f.call(review, "agent")).code, 200);
  const again = await f.call(
    submit(2, { answers: { ...answers, hours: "8am to 5pm" } }),
  );
  assert.equal(again.data.submission, 2);
  assert.equal(
    f.records.get("project_onboarding_revisions/p1_1").answers.hours,
    undefined,
  );
  assert.equal(
    (
      await f.call(
        {
          action: "review",
          projectId: "p1",
          version: 3,
          requestId: "approve",
          status: "approved",
          feedback: "Confirmed with client.",
        },
        "owner",
      )
    ).data.status,
    "approved",
  );
  assert.equal((await f.call(save(4))).code, 409);
  assert.equal(
    (await f.call({ action: "history", projectId: "p1" }, "agent")).data
      .revisions.length,
    2,
  );
});
test("revoked, expired, deleting and unknown links reject all read and write operations", async () => {
  const f = fixture();
  assert.equal((await f.call({ token: "wrong" })).code, 403);
  for (const patch of [
    { status: "revoked" },
    { expiresAt: "2020-01-01" },
    { status: "expired" },
  ]) {
    f.records.set("project_shares/s1", {
      projectId: "p1",
      tokenHash: tokenHash("token"),
      ...patch,
    });
    assert.equal((await f.call()).code, 403);
    assert.equal((await f.call(save())).code, 403);
  }
  f.records.set("project_shares/s1", {
    projectId: "p1",
    tokenHash: tokenHash("token"),
    status: "active",
  });
  f.records.get("projects/p1")._deleting = true;
  assert.equal((await f.call()).code, 404);
});
test("developer selects relevant templates before work starts; later edits cannot discard answers", async () => {
  const f = fixture();
  const config = {
    action: "configure",
    projectId: "p1",
    version: 0,
    requestId: "template",
    templateIds: ["shop", "branding"],
  };
  assert.equal((await f.call(config, "agent")).code, 403);
  assert.equal((await f.call(config, "owner")).code, 200);
  assert.deepEqual((await f.call()).data.templateIds, ["shop", "branding"]);
  assert.equal((await f.call(save(1))).code, 400);
  const next = { ...answers };
  delete next.websiteGoals;
  delete next.websitePages;
  delete next.websiteAction;
  assert.equal((await f.call(save(1, { answers: next }))).code, 200);
  assert.equal(
    (await f.call({ ...config, version: 2, requestId: "reconfigure" }, "owner"))
      .code,
    409,
  );
  assert.deepEqual(templateIdsFor({ packageId: "unknown" }), []);
  assert.ok(
    missingOnboardingFields({}, ["automation"]).includes(
      "Describe your current process",
    ),
  );
});
test("scoped uploads are bounded, encrypted by adapter, safely projected and retried without duplicates", async () => {
  const f = fixture();
  const input = {
    ...png,
    action: "onboarding-upload",
    version: 0,
    requestId: "upload",
  };
  const uploaded = await f.call(input);
  assert.equal(uploaded.code, 200);
  assert.equal(uploaded.data.files.length, 1);
  assert.equal(uploaded.data.files[0].status, "ready");
  assert.doesNotMatch(
    JSON.stringify(uploaded.data),
    /portal-onboarding\/|"key"|"sha"/,
  );
  assert.equal((await f.call(input)).data.files.length, 1);
  assert.equal(f.uploads.size, 1);
  const fileId = uploaded.data.files[0].id;
  const downloaded = await f.call({ action: "onboarding-download", fileId });
  assert.equal(downloaded.data.base64, png.base64);
  assert.equal(
    (await f.call({ action: "onboarding-download", fileId: "wrong" })).code,
    404,
  );
  assert.equal(
    (
      await f.call({
        ...input,
        version: 2,
        requestId: "bad",
        mimeType: "image/svg+xml",
      })
    ).code,
    400,
  );
  assert.equal(
    (
      await f.call({
        ...input,
        version: 2,
        requestId: "fake",
        base64: Buffer.from("<html>").toString("base64"),
      })
    ).code,
    400,
  );
  assert.equal(
    (
      await f.call({
        ...input,
        version: 2,
        requestId: "fake",
        name: "../../logo.png",
      })
    ).code,
    400,
  );
});
test("failed uploads keep reservation and can retry safely; failed deletes preserve file references", async () => {
  const f = fixture();
  f.uploadFails = true;
  const input = {
    ...png,
    action: "onboarding-upload",
    version: 0,
    requestId: "upload",
  };
  assert.equal((await f.call(input)).code, 500);
  assert.equal((await f.call()).data.files[0].status, "uploading");
  f.uploadFails = false;
  const retried = await f.call(input);
  assert.equal(retried.data.files.length, 1);
  assert.equal(retried.data.files[0].status, "ready");
  f.removeFails = true;
  const remove = {
    action: "onboarding-remove-file",
    version: 2,
    requestId: "remove",
    fileId: retried.data.files[0].id,
  };
  assert.equal((await f.call(remove)).code, 500);
  assert.equal(f.records.get("project_onboarding/p1").files.length, 1);
  f.removeFails = false;
  assert.equal((await f.call(remove)).data.files.length, 0);
  assert.equal(f.uploads.size, 0);
});
test("daily write/upload reservations and closed project controls prevent unlimited writes", async () => {
  const f = fixture();
  f.records.set("_portal_limits/onboarding_p1_2026-10-10", { writes: 60 });
  assert.equal((await f.call(save())).code, 429);
  f.records.set("_portal_limits/onboarding_p1_2026-10-10", { uploads: 10 });
  assert.equal(
    (
      await f.call({
        ...png,
        action: "onboarding-upload",
        version: 0,
        requestId: "up",
      })
    ).code,
    429,
  );
  f.records.get("projects/p1").status = "delivered";
  assert.equal((await f.call()).data.editable, false);
  assert.equal((await f.call(save())).code, 409);
});

test("a stale client binding and cross-project IDs cannot escape the share scope", async () => {
  const f = fixture();
  const r = await f.call({
    ...save(),
    projectId: "another-project",
    clientId: "c2",
  });
  assert.equal(r.code, 200);
  assert.equal(r.data.projectId, "p1");
  assert.equal(f.records.has("project_onboarding/another-project"), false);
  f.records.get("project_shares/s1").clientId = "c2";
  assert.equal((await f.call()).code, 403);
  assert.equal((await f.call(save(1))).code, 403);
});
test("onboarding notices reach the assigned manager and developer through existing notification records", async () => {
  const { createPortalNotifier } =
    await import("../api/_lib/portalNotifications.js");
  const f = fixture();
  f.records.set("users/agent", {
    role: "agent",
    appUserId: "legacy-agent",
    uid: "agent",
  });
  const delivered = [];
  const notify = createPortalNotifier({
    db: f.db,
    auth: f.auth,
    sendPush: async (id, userId) => delivered.push({ id, userId }),
  });
  await notify({ id: "submission-1", projectId: "p1" }, { onboarding: true });
  assert.deepEqual(delivered.map((d) => d.userId).sort(), [
    "legacy-agent",
    "owner",
  ]);
  assert.equal(
    [...f.records.keys()].filter((k) => k.startsWith("notifications/")).length,
    2,
  );
  await notify({ id: "submission-1", projectId: "p1" }, { onboarding: true });
  assert.equal(
    [...f.records.keys()].filter((k) => k.startsWith("notifications/")).length,
    2,
  );
});

test("previously completed onboarding stays complete until developer explicitly starts a project form", async () => {
  const f = fixture();
  f.records.get("clients/c1").onboardingCompleted = true;
  const legacy = await f.call();
  assert.equal(legacy.data.status, "approved");
  assert.equal(legacy.data.legacyCompleted, true);
  assert.equal(legacy.data.editable, false);
  assert.deepEqual(legacy.data.missing, []);
  assert.equal((await f.call(save())).code, 409);
  assert.equal(
    (
      await f.call(
        {
          action: "configure",
          projectId: "p1",
          version: 0,
          requestId: "start-new-project-form",
          templateIds: ["website"],
        },
        "owner",
      )
    ).code,
    200,
  );
  assert.equal((await f.call(save(1))).code, 200);
  assert.equal(f.records.get("clients/c1").onboardingCompleted, true);
});
test("reassignment immediately removes a former manager’s onboarding access", async () => {
  const f = fixture();
  assert.equal(
    (await f.call({ action: "get", projectId: "p1" }, "agent")).code,
    200,
  );
  f.records.get("projects/p1").assignedTo = "other";
  f.records.get("leads/l1").assignedTo = "other";
  assert.equal(
    (await f.call({ action: "get", projectId: "p1" }, "agent")).code,
    403,
  );
  f.records.get("clients/c1").contactManagerId = "agent";
  assert.equal(
    (await f.call({ action: "get", projectId: "p1" }, "agent")).code,
    200,
  );
});

test("one failed recipient never blocks the assigned manager notification", async () => {
  const { createPortalNotifier } =
    await import("../api/_lib/portalNotifications.js");
  const f = fixture();
  f.records.set("users/agent", {
    role: "agent",
    appUserId: "legacy-agent",
    uid: "agent",
  });
  const delivered = [];
  const notify = createPortalNotifier({
    db: f.db,
    auth: f.auth,
    sendPush: async (id, userId) => {
      if (userId === "owner") throw Error("Unavailable");
      delivered.push(userId);
    },
  });
  await assert.rejects(
    notify({ id: "submission-2", projectId: "p1" }, { onboarding: true }),
  );
  assert.deepEqual(delivered, ["legacy-agent"]);
  assert.equal(
    [...f.records.keys()].filter((k) => k.startsWith("notifications/")).length,
    2,
  );
});

test("an interrupted upload can resume after page reload without reserving a second file", async () => {
  const f = fixture();
  f.uploadFails = true;
  const payload = {
    ...png,
    action: "onboarding-upload",
    version: 0,
    requestId: "first-attempt",
  };
  assert.equal((await f.call(payload)).code, 500);
  const saved = (await f.call()).data;
  f.uploadFails = false;
  const resumed = await f.call({
    ...payload,
    version: saved.version,
    requestId: "after-reload",
  });
  assert.equal(resumed.code, 200);
  assert.equal(resumed.data.files.length, 1);
  assert.equal(resumed.data.files[0].id, saved.files[0].id);
  assert.equal(resumed.data.files[0].status, "ready");
  assert.equal(f.uploads.size, 1);
});

test("file extensions must match the validated image or PDF type", async () => {
  const f = fixture();
  for (const name of ["logo.html", "logo.svg", "logo.exe", "logo"])
    assert.equal(
      (
        await f.call({
          ...png,
          name,
          action: "onboarding-upload",
          version: 0,
          requestId: "extension-check",
        })
      ).code,
      400,
    );
  assert.equal(f.uploads.size, 0);
});
