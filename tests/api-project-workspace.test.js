import test from "node:test";
import assert from "node:assert/strict";
import { clientWorkFixture } from "./client-work-fixture.js";
import { createProjectWorkspaceHandlers } from "../api/_lib/projectWorkspaceHandlers.js";
import { tokenHash } from "../api/_lib/projectShareCore.js";
import {
  milestoneSummary,
  nextProjectMilestone,
  validMilestoneGraph,
} from "../shared/projectTracking.js";
function fixture() {
  const f = clientWorkFixture({
    "clients/c1": { businessName: "Client", leadId: "l1" },
    "projects/p1": {
      clientId: "c1",
      assignedTo: "legacy-agent",
      status: "not-started",
      milestones: [
        { id: "m1", title: "Design", isCompleted: false },
        { id: "m2", title: "Build", isCompleted: false, dependsOn: ["m1"] },
      ],
    },
    "project_shares/s1": {
      projectId: "p1",
      clientId: "c1",
      tokenHash: tokenHash("token"),
      status: "active",
    },
    "users/agent": {
      role: "agent",
      appUserId: "legacy-agent",
      name: "Manager",
    },
  });
  const h = createProjectWorkspaceHandlers({
    db: f.db,
    now: () => f.clock,
    authenticate: async (req) => ({
      uid: req.headers.authorization,
      role: req.headers.authorization === "owner" ? "owner" : "agent",
      appUserId:
        req.headers.authorization === "agent"
          ? "legacy-agent"
          : req.headers.authorization,
    }),
    requireOwner: async () => {},
    files: {
      upload: async (file, bytes) => {
        if (f.uploadFails) throw Error("Failed");
        f.uploads.set(file.path, bytes);
      },
      download: async (file) => f.uploads.get(file.path),
      remove: async (file) => {
        if (f.removeFails) throw Error("Failed");
        f.uploads.delete(file.path);
      },
    },
    notify: async (...args) => f.pushes.push(args),
  });
  f.call = async (p = {}, actor) => {
    const res = {
      setHeader() {},
      status(c) {
        this.code = c;
        return this;
      },
      json(d) {
        this.data = d;
      },
    };
    await h[actor ? "staff" : "public"](
      {
        method: "POST",
        headers: { authorization: actor },
        body: {
          action: "workspace-get",
          token: "token",
          projectId: "p1",
          ...p,
        },
      },
      res,
    );
    return res;
  };
  f.change = async (action, extra = {}, actor) => {
    const state = (await f.call({}, actor)).data;
    return f.call(
      {
        action,
        requestId: crypto.randomUUID(),
        version:
          action === "milestone-update"
            ? state.milestoneVersion
            : state.version,
        ...extra,
      },
      actor,
    );
  };
  return f;
}
const image = {
  name: "logo.png",
  mimeType: "image/png",
  base64: Buffer.from("89504e470d0a1a0a010203", "hex").toString("base64"),
};
const firstFile = async (f, actor) => (await f.call({}, actor)).data.files[0];
test("team uploads are encrypted by adapter and start private; public projection excludes all keys and paths", async () => {
  const f = fixture();
  assert.equal((await f.change("file-upload", image, "owner")).code, 200);
  assert.equal((await f.call()).data.files.length, 0);
  let file = await firstFile(f, "owner");
  assert.equal(file.visibility, "staff");
  assert.equal(f.uploads.size, 1);
  assert.doesNotMatch(JSON.stringify(file), /"key"|project-workspace\//);
  assert.equal(
    (await f.call({ action: "workspace-download", fileId: file.id })).code,
    404,
  );
  assert.equal(
    (
      await f.change(
        "file-update",
        {
          fileId: file.id,
          category: "project-previews",
          visibility: "client",
          attention: true,
          milestoneId: "m1",
        },
        "owner",
      )
    ).code,
    200,
  );
  file = await firstFile(f);
  assert.equal(file.attention, true);
  assert.equal(
    (await f.call({ action: "workspace-download", fileId: file.id })).data
      .base64,
    image.base64,
  );
  assert.equal(f.records.get("projects/p1").workspaceFileAttention, 1);
});
test("client uploads cannot publish final work or replace team versions; only uploader share can delete", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.change("file-upload", {
        ...image,
        visibility: "client",
        category: "final-deliverables",
      })
    ).code,
    200,
  );
  let file = await firstFile(f);
  assert.equal(file.category, "client-uploads");
  assert.equal(
    (
      await f.change("file-update", {
        fileId: file.id,
        category: "final-deliverables",
        visibility: "client",
        attention: false,
        milestoneId: "",
      })
    ).code,
    400,
  );
  assert.equal(
    (await f.change("file-upload", { ...image, fileId: file.id })).code,
    403,
  );
  f.records.set("project_shares/s2", {
    projectId: "p1",
    clientId: "c1",
    tokenHash: tokenHash("other-token"),
    status: "active",
  });
  assert.equal(
    (await f.change("file-delete", { fileId: file.id, token: "other-token" }))
      .code,
    403,
  );
  assert.equal((await f.change("file-delete", { fileId: file.id })).code, 200);
  assert.equal(f.uploads.size, 0);
});
test("new versions retain prior downloads; visibility applies to every version and three versions are bounded", async () => {
  const f = fixture();
  await f.change("file-upload", image, "owner");
  let file = await firstFile(f, "owner");
  await f.change(
    "file-upload",
    { ...image, name: "preview-v2.png", fileId: file.id },
    "owner",
  );
  file = await firstFile(f, "owner");
  assert.equal(file.versions.length, 2);
  assert.equal(
    (
      await f.call(
        { action: "download", fileId: file.id, versionId: file.versions[0].id },
        "owner",
      )
    ).code,
    200,
  );
  await f.change(
    "file-upload",
    { ...image, name: "preview-v3.png", fileId: file.id },
    "owner",
  );
  assert.equal(
    (
      await f.change(
        "file-upload",
        { ...image, name: "preview-v4.png", fileId: file.id },
        "owner",
      )
    ).code,
    409,
  );
  assert.equal((await f.call()).data.files.length, 0);
  assert.equal(f.uploads.size, 3);
});
test("upload failure/retry and deletion failure/retry preserve exact references and do not duplicate versions", async () => {
  const f = fixture();
  f.uploadFails = true;
  const input = {
    action: "workspace-file-upload",
    requestId: "upload",
    version: 0,
    ...image,
  };
  assert.equal((await f.call(input)).code, 500);
  f.uploadFails = false;
  assert.equal((await f.call(input)).code, 200);
  assert.equal((await f.call(input)).code, 200);
  let file = await firstFile(f);
  assert.equal(file.versions.length, 1);
  assert.equal(f.uploads.size, 1);
  const del = {
    action: "file-delete",
    fileId: file.id,
    requestId: "delete",
    version: (await f.call()).data.version,
  };
  f.removeFails = true;
  assert.equal((await f.call(del)).code, 500);
  assert.equal(f.records.get("project_workspace/p1").files.length, 1);
  assert.equal((await f.call()).data.files[0].removing, true);
  f.removeFails = false;
  assert.equal((await f.call(del)).code, 200);
  assert.equal((await f.call(del)).code, 200);
  assert.equal(f.uploads.size, 0);
});
test("expired, revoked, stale client bindings and cross-project IDs fail closed", async () => {
  const f = fixture();
  assert.equal((await f.call({ projectId: "other" })).code, 200);
  await f.change("file-upload", image);
  const file = await firstFile(f);
  for (const patch of [
    { status: "revoked" },
    { status: "expired" },
    { expiresAt: "2020-01-01" },
  ]) {
    f.records.set("project_shares/s1", {
      projectId: "p1",
      clientId: "c1",
      tokenHash: tokenHash("token"),
      ...patch,
    });
    assert.equal((await f.call()).code, 403);
    assert.equal(
      (await f.call({ action: "download", fileId: file.id })).code,
      403,
    );
  }
  f.records.set("project_shares/s1", {
    projectId: "p1",
    clientId: "different",
    tokenHash: tokenHash("token"),
  });
  assert.equal((await f.call()).code, 403);
  assert.equal((await f.call({}, "other")).code, 403);
});
test("conversations retain messages and attachments, never convert to scope or approval records", async () => {
  const f = fixture();
  await f.change("file-upload", image);
  const file = await firstFile(f);
  const input = {
    action: "thread-create",
    requestId: "thread",
    version: 0,
    title: "A question",
    content: "Can we discuss this logo?",
    senderName: "Client",
    attachments: [file.id],
  };
  const created = await f.call(input);
  assert.equal(created.code, 200);
  assert.equal((await f.call(input)).data.threadId, created.data.threadId);
  let thread = (
    await f.call({ action: "thread-get", threadId: created.data.threadId })
  ).data;
  assert.equal(thread.messages.length, 1);
  assert.equal(thread.messages[0].sender, "client");
  const reply = {
    action: "thread-reply",
    threadId: thread.id,
    requestId: "reply",
    version: thread.version,
    content: "Which colours do you prefer?",
    attachments: [file.id],
    awaitingResponse: true,
    senderName: "SPOOF",
  };
  assert.equal((await f.call(reply, "agent")).code, 200);
  assert.equal((await f.call(reply, "agent")).code, 200);
  thread = (await f.call({ action: "thread-get", threadId: thread.id })).data;
  assert.equal(thread.messages.length, 2);
  assert.equal(thread.messages[1].senderName, "Manager");
  assert.equal(thread.waitingOn, "client");
  assert.equal(f.records.get("projects/p1").workspacePendingQuestions, 1);
  assert.equal(
    [...f.records.keys()].some(
      (k) =>
        k.startsWith("client_requests/") || k.startsWith("client_feedback/"),
    ),
    false,
  );
  assert.equal(
    (await f.call({ ...reply, requestId: "stale" }, "agent")).code,
    409,
  );
});
test("thread responsibility, resolution and read receipts use current project access", async () => {
  const f = fixture();
  const t = (
    await f.change("thread-create", {
      title: "Question",
      content: "Help",
      senderName: "Client",
      attachments: [],
    })
  ).data.threadId;
  let thread = (await f.call({ action: "thread-get", threadId: t }, "agent"))
    .data;
  assert.equal(
    (
      await f.call(
        {
          action: "thread-update",
          threadId: t,
          version: thread.version,
          requestId: "assign",
          assignedTo: "other",
          status: "open",
        },
        "agent",
      )
    ).code,
    403,
  );
  assert.equal(
    (
      await f.call(
        {
          action: "thread-update",
          threadId: t,
          version: thread.version,
          requestId: "resolve",
          assignedTo: "agent",
          status: "resolved",
        },
        "agent",
      )
    ).code,
    200,
  );
  thread = (await f.call({ action: "thread-get", threadId: t })).data;
  assert.equal(thread.status, "resolved");
  assert.equal(
    (
      await f.call({
        action: "thread-update",
        threadId: t,
        requestId: "client-close",
        version: thread.version,
        status: "resolved",
        assignedTo: "",
      })
    ).code,
    400,
  );
  assert.equal(
    (
      await f.call({
        action: "thread-read",
        threadId: t,
        version: thread.version,
        requestId: "read",
      })
    ).code,
    200,
  );
  f.records.get("projects/p1").assignedTo = "other";
  f.records.get("leads/l1").assignedTo = "other";
  assert.equal(
    (await f.call({ action: "thread-get", threadId: t }, "agent")).code,
    403,
  );
});
test("milestones preserve IDs, dependency rules, legacy booleans and developer-only final completion", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.change(
        "milestone-update",
        { milestoneId: "m2", status: "completed" },
        "agent",
      )
    ).code,
    409,
  );
  assert.equal(
    (
      await f.change(
        "milestone-update",
        { milestoneId: "m1", status: "completed" },
        "agent",
      )
    ).code,
    200,
  );
  assert.equal(
    (
      await f.change(
        "milestone-update",
        { milestoneId: "m2", status: "completed" },
        "agent",
      )
    ).code,
    200,
  );
  let project = f.records.get("projects/p1");
  assert.equal(project.status, "in-progress");
  assert.deepEqual(
    project.milestones.map((m) => m.id),
    ["m1", "m2"],
  );
  assert.equal(project.milestones[0].completed, true);
  assert.equal(
    (
      await f.change(
        "milestone-update",
        { milestoneId: "m1", status: "in-progress" },
        "owner",
      )
    ).code,
    409,
  );
  assert.equal(milestoneSummary(project.milestones).progress, 100);
});
test("milestone details prevent cycles and notify/log only actual changes", async () => {
  const f = fixture();
  const originalPush = f.pushes.length;
  assert.equal(
    (
      await f.change(
        "milestone-update",
        { milestoneId: "m1", status: "not-started" },
        "agent",
      )
    ).code,
    200,
  );
  assert.equal(f.pushes.length, originalPush);
  assert.equal(f.records.get("projects/p1").milestoneVersion, undefined);
  assert.equal(
    (
      await f.change(
        "milestone-update",
        {
          milestoneId: "m1",
          status: "blocked",
          details: {
            responsibleParty: "team",
            clientAction: "",
            description: "Waiting on setup",
            expectedDate: "2026-10-20",
            dependsOn: ["m2"],
          },
        },
        "agent",
      )
    ).code,
    400,
  );
  assert.equal(
    (
      await f.change(
        "milestone-update",
        {
          milestoneId: "m1",
          status: "awaiting-client",
          details: {
            responsibleParty: "client",
            clientAction: "Send logo",
            description: "Prepare design",
            expectedDate: "2026-10-20",
            dependsOn: [],
          },
        },
        "agent",
      )
    ).code,
    200,
  );
  assert.equal(f.pushes.length, 1);
  const next = nextProjectMilestone(f.records.get("projects/p1").milestones);
  assert.equal(next.id, "m1");
  assert.equal(next.responsibleParty, "client");
  assert.equal(milestoneSummary([]).progress, 0);
  assert.equal(validMilestoneGraph([{ id: "x", dependsOn: ["x"] }]), false);
});
test("file payloads, rates and message bounds are enforced server-side", async () => {
  const f = fixture();
  assert.equal(
    (await f.change("file-upload", { ...image, name: "bad.html" })).code,
    400,
  );
  assert.equal(
    (
      await f.change("file-upload", {
        ...image,
        base64: Buffer.from("fake").toString("base64"),
      })
    ).code,
    400,
  );
  assert.equal(
    (
      await f.change("thread-create", {
        title: "Bad",
        content: "x".repeat(4001),
        senderName: "Client",
        attachments: [],
      })
    ).code,
    400,
  );
  assert.equal(
    (
      await f.change("thread-create", {
        title: "Bad",
        content: "Hi",
        senderName: "Client",
        attachments: ["other-project"],
      })
    ).code,
    400,
  );
  f.records.set("_portal_limits/workspace_p1_2026-10-10", { writes: 60 });
  assert.equal((await f.change("file-upload", image)).code, 429);
});

test("replacement drafts remain private while earlier published versions stay available; attachments pin exact versions", async () => {
  const f = fixture();
  await f.change("file-upload", image, "owner");
  const file = await firstFile(f, "owner");
  await f.change(
    "file-update",
    {
      fileId: file.id,
      category: "final-deliverables",
      visibility: "client",
      attention: false,
      milestoneId: "m1",
    },
    "owner",
  );
  const first = (await firstFile(f)).versions[0];
  const thread = (
    await f.change("thread-create", {
      title: "Review file",
      content: "Question about this version",
      senderName: "Client",
      attachments: [file.id],
    })
  ).data.threadId;
  await f.change(
    "file-upload",
    { ...image, name: "private-draft.png", fileId: file.id },
    "owner",
  );
  let publicView = await firstFile(f);
  assert.equal(publicView.versions.length, 1);
  assert.equal(publicView.versions[0].id, first.id);
  assert.equal(publicView.pending, null);
  assert.doesNotMatch(JSON.stringify(publicView), /private-draft/);
  const teamView = await firstFile(f, "owner");
  assert.equal(
    (
      await f.call({
        action: "download",
        fileId: file.id,
        versionId: teamView.versions[1].id,
      })
    ).code,
    404,
  );
  await f.change(
    "file-update",
    {
      fileId: file.id,
      category: "final-deliverables",
      visibility: "client",
      attention: false,
      milestoneId: "m1",
    },
    "owner",
  );
  publicView = await firstFile(f);
  assert.equal(publicView.versions.length, 2);
  const t = (await f.call({ action: "thread-get", threadId: thread })).data;
  assert.equal(t.messages[0].attachmentVersions[file.id], first.id);
  await f.change(
    "file-update",
    {
      fileId: file.id,
      category: "final-deliverables",
      visibility: "staff",
      attention: false,
      milestoneId: "m1",
    },
    "owner",
  );
  assert.equal(
    (await f.call({ action: "thread-get", threadId: thread })).data.messages[0]
      .attachments.length,
    0,
  );
});

test("replaying a completed upload cannot overwrite a different pending replacement", async () => {
  const f = fixture();
  const original = {
    action: "file-upload",
    requestId: "first",
    version: 0,
    ...image,
  };
  assert.equal((await f.call(original, "owner")).code, 200);
  const file = await firstFile(f, "owner");
  const replacement = {
    action: "file-upload",
    requestId: "second",
    version: (await f.call({}, "owner")).data.version,
    fileId: file.id,
    name: "new.png",
    mimeType: "image/png",
    base64: Buffer.from("89504e470d0a1a0a040506", "hex").toString("base64"),
  };
  f.uploadFails = true;
  assert.equal((await f.call(replacement, "owner")).code, 500);
  const pending = f.records.get("project_workspace/p1").files[0].pending;
  f.uploadFails = false;
  assert.equal((await f.call(original, "owner")).code, 200);
  assert.equal(
    f.records.get("project_workspace/p1").files[0].pending.id,
    pending.id,
  );
  assert.equal(f.uploads.has(pending.path), false);
  assert.equal((await f.call(replacement, "owner")).code, 200);
  assert.equal(
    f.uploads.get(pending.path).toString("base64"),
    replacement.base64,
  );
  assert.equal((await firstFile(f, "owner")).versions.length, 2);
});

test("legacy milestones without IDs remain editable without losing existing IDs or completion history", async () => {
  const f = fixture();
  f.records.get("projects/p1").milestones = [
    { name: "Earlier legacy step", completed: true },
    { id: "keep-me", name: "Current step", completed: false },
  ];
  const state = (await f.call({}, "owner")).data;
  assert.equal(state.milestones[0].id, "m-1");
  assert.equal(
    (
      await f.change(
        "milestone-update",
        { milestoneId: "keep-me", status: "in-progress" },
        "owner",
      )
    ).code,
    200,
  );
  const saved = f.records.get("projects/p1").milestones;
  assert.equal(saved[0].name, "Earlier legacy step");
  assert.equal(saved[0].completed, true);
  assert.equal(saved[1].id, "keep-me");
  assert.equal(milestoneSummary(saved).progress, 50);
});

test("next milestones follow project order and dependencies and never infer completion from dates", () => {
  const rows = [
    {
      id: "second",
      title: "Second",
      order: 2,
      status: "not-started",
      dependsOn: ["first"],
      expectedDate: "2000-01-01",
    },
    {
      id: "first",
      title: "First",
      order: 1,
      status: "awaiting-client",
      responsibleParty: "both",
      clientAction: "Confirm requirements",
    },
  ];
  assert.equal(nextProjectMilestone(rows).id, "first");
  assert.equal(nextProjectMilestone(rows).responsibleParty, "both");
  assert.equal(milestoneSummary(rows).completed, 0);
  rows[1].status = "completed";
  assert.equal(nextProjectMilestone(rows).id, "second");
  assert.equal(nextProjectMilestone(rows, "delivered"), null);
  assert.equal(
    milestoneSummary([
      { completed: true },
      { isCompleted: false, status: "completed" },
    ]).progress,
    100,
  );
});

test("private replacement names and deletion rights stay private even on a client-origin file", async () => {
  const f = fixture();
  await f.change("file-upload", image);
  const file = await firstFile(f);
  f.uploadFails = true;
  assert.equal(
    (
      await f.change(
        "file-upload",
        { ...image, fileId: file.id, name: "private-team-draft.png" },
        "owner",
      )
    ).code,
    500,
  );
  const publicView = await firstFile(f);
  assert.equal(publicView.pending, null);
  assert.equal(publicView.canDelete, false);
  assert.doesNotMatch(JSON.stringify(publicView), /private-team-draft/);
  assert.equal((await f.change("file-delete", { fileId: file.id })).code, 403);
});
