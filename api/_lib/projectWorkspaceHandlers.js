import crypto from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";
import { createPortalProjectAccess } from "./portalProjectAccess.js";
import { preparePortalUpload } from "./portalUpload.js";
import { createHttpError, json, parseBody, methodNotAllowed } from "./http.js";
import { isProjectClosed, sanitizeMilestones } from "./projectShareCore.js";
import {
  FILE_CATEGORIES,
  MILESTONE_STATUSES,
  milestoneStatus,
  milestoneSummary,
  validMilestoneGraph,
} from "../../shared/projectTracking.js";
const id = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const text = (v, max, required = false) =>
  typeof v === "string" && v.length <= max && (!required || v.trim());
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
const iso = (now) => new Date(now()).toISOString();
const validDay = (v) =>
  v === "" ||
  (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
    new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v);
const publishedVersions = (f) =>
  f.versions.filter((v) => v.visibility === "client");
const publicFile = (f) =>
  f.visibility === "client" &&
  !f.removing &&
  (f.origin === "client" || publishedVersions(f).length > 0);
const versionView = (v) => ({
  id: v.id,
  name: v.name,
  mimeType: v.mimeType,
  sizeBytes: v.sizeBytes,
  createdAt: v.createdAt,
  number: v.number,
  visibility: v.visibility,
});
const fileView = (f, ctx, actor) => ({
  id: f.id,
  category: f.category,
  milestoneId: f.milestoneId || "",
  attention: !!f.attention,
  visibility: f.visibility,
  origin: f.origin,
  updatedAt: f.updatedAt,
  versions: (actor ? f.versions : publishedVersions(f)).map(versionView),
  pending:
    f.pending &&
    (actor ||
      (f.pending.origin === "client" && f.createdByShare === ctx.shareId))
      ? { name: f.pending.name, leaseUntil: f.pending.leaseUntil }
      : null,
  removing: !!f.removing,
  canDelete: actor
    ? actor.role === "owner" ||
      [actor.uid, actor.appUserId].includes(f.createdByUid)
    : f.createdByShare === ctx.shareId &&
      f.origin === "client" &&
      f.versions.every((v) => v.origin === "client") &&
      (!f.pending || f.pending.origin === "client") &&
      ["client-uploads", "brand-assets", "website-content"].includes(
        f.category,
      ),
  canReplace: !!actor && !f.removing,
});
const threadSummary = (t, actor) => ({
  id: t.id,
  title: t.title,
  status: t.status,
  waitingOn: t.waitingOn,
  version: t.version,
  updatedAt: t.updatedAt,
  assignedTo: actor ? t.assignedTo : undefined,
  responsibility: t.assignedTo ? "Assigned to your team" : "Unassigned",
  lastSender: t.messages.at(-1)?.sender,
  lastMessage: t.messages.at(-1)?.content.slice(0, 180),
  readAt: actor ? t.readByTeamAt : t.readByClientAt,
});
export function createProjectWorkspaceHandlers({
  db,
  authenticate,
  requireOwner,
  files,
  notify = async () => {},
  now = () => Date.now(),
}) {
  const access = createPortalProjectAccess({ db, now }),
    workspaceRef = (projectId) =>
      db.collection("project_workspace").doc(projectId);
  async function context(p, actor, read) {
    return actor
      ? access.staffContext(p, actor, read)
      : access.publicContext(p, read);
  }
  const listFiles = (ws, ctx, actor) =>
    (ws?.files || [])
      .filter(
        (f) =>
          actor ||
          (publicFile(f) &&
            (publishedVersions(f).length > 0 ||
              f.createdByShare === ctx.shareId)) ||
          (f.removing && f.createdByShare === ctx.shareId),
      )
      .map((f) => fileView(f, ctx, actor));
  async function relatedFiles(ctx, read) {
    const doc = await read(
      db.collection("project_onboarding").doc(ctx.project.id),
    );
    return (doc.data()?.files || []).filter((f) => f.status === "ready");
  }
  async function run(req, res, staff = false) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    try {
      const p = parseBody(req),
        action =
          typeof p.action === "string"
            ? p.action.replace(/^workspace-/, "")
            : "",
        actor = staff ? await authenticate(req) : null;
      const allowed = staff
        ? [
            "get",
            "download",
            "file-upload",
            "file-update",
            "file-delete",
            "thread-create",
            "thread-get",
            "thread-reply",
            "thread-update",
            "thread-read",
            "milestone-update",
          ]
        : [
            "get",
            "download",
            "file-upload",
            "file-delete",
            "thread-create",
            "thread-get",
            "thread-reply",
            "thread-read",
          ];
      if (!allowed.includes(action))
        throw createHttpError(400, "Unknown workspace action.");
      if (["get", "download", "thread-get"].includes(action)) {
        const ctx = await context(p, actor, (q) => q.get()),
          ws = (await workspaceRef(ctx.project.id).get()).data();
        if (action === "get") {
          let query = db
            .collection("project_conversations")
            .where("projectId", "==", ctx.project.id)
            .orderBy(FieldPath.documentId(), "asc");
          if (p.cursor) {
            if (!id(p.cursor)) throw createHttpError(400, "Invalid page.");
            query = query.startAfter(p.cursor);
          }
          const page = await query.limit(21).get(),
            onboarding = await relatedFiles(ctx, (q) => q.get());
          return json(res, 200, {
            version: ws?.version || 0,
            files: listFiles(ws, ctx, actor),
            onboardingFiles: onboarding.map((f) => ({
              id: `ob_${f.id}`,
              name: f.name,
              mimeType: f.mimeType,
              sizeBytes: f.sizeBytes,
            })),
            threads: page.docs
              .slice(0, 20)
              .map((d) => threadSummary({ id: d.id, ...d.data() }, actor)),
            cursor: page.docs.length > 20 ? page.docs[19].id : null,
            milestones: sanitizeMilestones(ctx.project.milestones),
            milestoneVersion: ctx.project.milestoneVersion || 0,
            projectStatus: ctx.project.status,
          });
        }
        if (action === "thread-get") {
          if (!id(p.threadId))
            throw createHttpError(400, "Choose a conversation.");
          const doc = await db
            .collection("project_conversations")
            .doc(p.threadId)
            .get();
          if (!doc.exists || doc.data().projectId !== ctx.project.id)
            throw createHttpError(404, "Conversation unavailable.");
          const t = { id: doc.id, ...doc.data() },
            visibleIds = new Set(listFiles(ws, ctx, actor).map((f) => f.id));
          return json(res, 200, {
            ...threadSummary(t, actor),
            messages: t.messages.map((m) => ({
              ...m,
              unavailableAttachments: (m.attachments || []).some(
                (id) => !visibleIds.has(id),
              ),
              attachmentVersions: Object.fromEntries(
                Object.entries(m.attachmentVersions || {}).filter(([id]) =>
                  visibleIds.has(id),
                ),
              ),
              attachments: (m.attachments || []).filter((id) =>
                visibleIds.has(id),
              ),
            })),
          });
        }
        let file;
        if (typeof p.fileId === "string" && p.fileId.startsWith("ob_"))
          file = (await relatedFiles(ctx, (q) => q.get())).find(
            (f) => `ob_${f.id}` === p.fileId,
          );
        else {
          const f = ws?.files?.find(
            (f) => f.id === p.fileId && !f.removing && (actor || publicFile(f)),
          );
          const versions = f ? (actor ? f.versions : publishedVersions(f)) : [];
          file = versions.find((v) =>
            p.versionId ? v.id === p.versionId : v.id === versions.at(-1)?.id,
          );
        }
        if (!file) throw createHttpError(404, "File unavailable.");
        const bytes = await files.download(file);
        return json(res, 200, {
          name: file.name,
          mimeType: file.mimeType,
          base64: bytes.toString("base64"),
        });
      }
      if (!id(p.requestId))
        throw createHttpError(400, "Refresh and retry this action.");
      const upload = action === "file-upload" ? preparePortalUpload(p) : null;
      const result = await db.runTransaction(async (tx) => {
        const ctx = await context(p, actor, (q) => tx.get(q)),
          wsDoc = await tx.get(workspaceRef(ctx.project.id)),
          ws = { ...(wsDoc.data() || { version: 0, files: [] }) };
        const opRef = db
            .collection("_workspace_operations")
            .doc(
              hash(
                `${ctx.project.id}:${actor ? actor.uid : ctx.shareId}:${p.requestId}`,
              ),
            ),
          op = await tx.get(opRef),
          signature = hash(
            JSON.stringify({ ...p, token: undefined, base64: upload?.sha }),
          );
        if (op.exists) {
          if (op.data().signature !== signature)
            throw createHttpError(
              409,
              "This action already has different details.",
            );
          return {
            ctx,
            ws,
            file: ws.files.find((f) => f.id === op.data().fileId),
            threadId: op.data().threadId,
            uploadId: op.data().uploadId,
            changed: op.data().changed,
            event: op.data().event,
            duplicate: true,
            opId: opRef.id,
          };
        }
        const dailyRef = db
            .collection("_portal_limits")
            .doc(
              `workspace_${ctx.project.id}_${new Date(now() + 7200000).toISOString().slice(0, 10)}`,
            ),
          daily = await tx.get(dailyRef);
        if (!actor && (daily.data()?.writes || 0) >= 60)
          throw createHttpError(
            429,
            "Today’s workspace limit is reached. Contact your team.",
          );
        const timestamp = iso(now);
        let file,
          threadId,
          changed = true,
          projectUpdates = {},
          event = "Workspace updated";
        if (action.startsWith("file-")) {
          if (p.version !== ws.version)
            throw createHttpError(
              409,
              "Files have changed. Refresh the file list before retrying.",
            );
          if (p.fileId) {
            if (!id(p.fileId)) throw createHttpError(400, "Choose a file.");
            file = ws.files.find((f) => f.id === p.fileId);
            if (!file) throw createHttpError(404, "File unavailable.");
          }
          if (action === "file-upload") {
            if (!actor && file)
              throw createHttpError(
                403,
                "Your team manages deliverable replacements.",
              );
            if (file?.removing)
              throw createHttpError(409, "File deletion is in progress.");
            if ((daily.data()?.uploads || 0) >= (actor ? 20 : 10))
              throw createHttpError(
                429,
                "Today’s upload limit is reached. Use the agreed project folder for larger materials.",
              );
            const pendingFile = !file
              ? ws.files.find(
                  (f) =>
                    f.pending?.sha === upload.sha &&
                    f.pending.name === p.name.trim() &&
                    f.pending.createdBy === (actor?.uid || ctx.shareId),
                )
              : null;
            if (pendingFile) file = pendingFile;
            if (file?.pending && file.pending.sha !== upload.sha)
              throw createHttpError(
                409,
                "Another version is uploading. Finish or remove that upload first.",
              );
            if (!file && ws.files.length >= 20)
              throw createHttpError(
                429,
                "This project has 20 files. Ask the developer to remove unused files.",
              );
            if (file?.versions.length >= 3)
              throw createHttpError(
                409,
                "Three versions are retained. Ask the developer before removing this file or starting a new deliverable.",
              );
            if (!file) {
              file = {
                id: crypto.randomUUID(),
                origin: actor ? "team" : "client",
                createdByUid: actor?.uid || "",
                createdByShare: actor ? "" : ctx.shareId,
                visibility: actor ? "staff" : "client",
                category: actor ? "project-previews" : "client-uploads",
                milestoneId: "",
                attention: false,
                versions: [],
                updatedAt: timestamp,
              };
              ws.files = [...ws.files, file];
            }
            const blob = file.pending || {
              id: upload.id,
              path: `project-workspace/${ctx.project.id}/${upload.id}.enc`,
              key: upload.key,
              sha: upload.sha,
              name: p.name.trim(),
              mimeType: p.mimeType,
              sizeBytes: upload.bytes.length,
              createdBy: actor?.uid || ctx.shareId,
              origin: actor ? "team" : "client",
            };
            file.pending = { ...blob, leaseUntil: now() + 120000 };
            file.updatedAt = timestamp;
            event = actor ? "Team file uploaded" : "Client material uploaded";
          } else if (action === "file-update") {
            if (!file || file.removing)
              throw createHttpError(409, "File unavailable.");
            if (
              !Object.hasOwn(FILE_CATEGORIES, p.category) ||
              !["staff", "client"].includes(p.visibility) ||
              typeof p.attention !== "boolean" ||
              (p.milestoneId &&
                !sanitizeMilestones(ctx.project.milestones).some(
                  (m) => m.id === p.milestoneId,
                ))
            )
              throw createHttpError(
                400,
                "Check the category, visibility and milestone.",
              );
            const patch = {
              category: p.category,
              visibility: p.visibility,
              attention: p.attention,
              milestoneId: p.milestoneId || "",
            };
            if (p.visibility === "client" && !file.versions.length)
              throw createHttpError(
                409,
                "Finish uploading before publishing this file.",
              );
            changed =
              Object.entries(patch).some(([k, v]) => file[k] !== v) ||
              (p.visibility === "client" &&
                file.versions.at(-1)?.visibility !== "client");
            if (p.visibility === "client")
              file.versions.at(-1).visibility = "client";
            Object.assign(file, patch, {
              updatedAt: changed ? timestamp : file.updatedAt,
            });
            event = "Project file details updated";
          } else if (action === "file-delete") {
            if (!file || !fileView(file, ctx, actor).canDelete)
              throw createHttpError(
                403,
                "Only the uploader or developer can delete this file.",
              );
            if (!actor && !publicFile(file) && !file.removing)
              throw createHttpError(404, "File unavailable.");
            if (file.pending?.leaseUntil > now())
              throw createHttpError(
                409,
                "A version is still uploading. Retry deletion in two minutes.",
              );
            changed = !file.removing;
            file.removing = true;
            event = "Project file removed";
          }
          ws.version++;
          projectUpdates.workspaceFileAttention = ws.files.filter(
            (f) => publicFile(f) && f.attention && f.versions.length,
          ).length;
        } else if (action === "milestone-update") {
          if (
            !actor ||
            (![actor.uid, actor.appUserId].includes(ctx.project.assignedTo) &&
              actor.role !== "owner")
          )
            throw createHttpError(
              403,
              "Only the delivery coordinator or developer can update milestones.",
            );
          if (isProjectClosed(ctx.project.status) && actor.role !== "owner")
            throw createHttpError(
              403,
              "The developer must reopen this project.",
            );
          if (p.version !== (ctx.project.milestoneVersion || 0))
            throw createHttpError(
              409,
              "Milestones changed. Refresh before saving.",
            );
          const milestones = (
              Array.isArray(ctx.project.milestones)
                ? ctx.project.milestones
                : []
            ).map((m, i) => ({ ...m, id: m.id || `m-${i + 1}` })),
            index = milestones.findIndex((m) => m.id === p.milestoneId);
          if (index < 0) throw createHttpError(404, "Milestone unavailable.");
          const current = milestones[index];
          if (!Object.hasOwn(MILESTONE_STATUSES, p.status))
            throw createHttpError(400, "Choose a milestone status.");
          const patch = {
            status: p.status,
            isCompleted: p.status === "completed",
            completed: p.status === "completed",
            completedAt:
              p.status === "completed"
                ? milestoneStatus(current) === "completed"
                  ? current.completedAt || null
                  : timestamp
                : null,
          };
          if (p.details) {
            const d = p.details;
            if (
              !["team", "client", "both"].includes(d.responsibleParty) ||
              !text(d.clientAction, 1000) ||
              !text(d.description, 4000) ||
              !text(d.expectedDate, 10) ||
              !validDay(d.expectedDate) ||
              !Array.isArray(d.dependsOn) ||
              d.dependsOn.length > 20 ||
              new Set(d.dependsOn).size !== d.dependsOn.length
            )
              throw createHttpError(400, "Check the milestone details.");
            Object.assign(patch, {
              responsibleParty: d.responsibleParty,
              clientAction: d.clientAction.trim(),
              description: d.description.trim(),
              expectedDate: d.expectedDate,
              dependsOn: d.dependsOn,
            });
          }
          if (p.status === "awaiting-client")
            patch.responsibleParty =
              p.details?.responsibleParty === "both" ? "both" : "client";
          const next = milestones.map((m, i) =>
            i === index ? { ...m, ...patch } : m,
          );
          if (!validMilestoneGraph(next))
            throw createHttpError(
              400,
              "Dependencies must reference this project and cannot form a loop.",
            );
          if (
            next.some(
              (m) =>
                milestoneStatus(m) === "completed" &&
                (m.dependsOn || []).some(
                  (id) =>
                    milestoneStatus(next.find((dep) => dep.id === id)) !==
                    "completed",
                ),
            )
          )
            throw createHttpError(
              409,
              "Complete the prerequisite milestones first.",
            );
          changed =
            milestoneStatus(current) !== p.status ||
            (!!p.details &&
              Object.entries(p.details).some(
                ([k, v]) =>
                  JSON.stringify(
                    current[k] ??
                      (k === "dependsOn"
                        ? []
                        : k === "responsibleParty"
                          ? "team"
                          : ""),
                  ) !== JSON.stringify(typeof v === "string" ? v.trim() : v),
              ));
          const summary = milestoneSummary(next);
          let status = ctx.project.status;
          if (changed) {
            if (status !== "on-hold") {
              if (summary.total && summary.completed === summary.total)
                status = actor.role === "owner" ? "completed" : "in-progress";
              else if (
                summary.completed ||
                next.some((m) => milestoneStatus(m) !== "not-started")
              )
                status = "in-progress";
              else status = "not-started";
            }
            projectUpdates = {
              milestones: next,
              milestoneVersion: (ctx.project.milestoneVersion || 0) + 1,
              status,
            };
          }
          event = `Milestone: ${current.title || current.name} — ${MILESTONE_STATUSES[p.status]}`;
        } else {
          const ref = db
            .collection("project_conversations")
            .doc(
              action === "thread-create"
                ? `thread_${hash(`${ctx.project.id}:${actor?.uid || ctx.shareId}:${p.requestId}`)}`
                : p.threadId || "invalid",
            );
          if (action !== "thread-create" && !id(p.threadId))
            throw createHttpError(400, "Choose a conversation.");
          const doc = await tx.get(ref),
            existing = doc.data();
          threadId = ref.id;
          if (
            action === "thread-create"
              ? doc.exists
              : !doc.exists || existing.projectId !== ctx.project.id
          )
            throw createHttpError(404, "Conversation unavailable.");
          if (action !== "thread-create" && p.version !== existing.version)
            throw createHttpError(
              409,
              "This conversation changed. Reload it before replying.",
            );
          const t = existing || {
            id: ref.id,
            projectId: ctx.project.id,
            clientId: ctx.client.id,
            title: "",
            status: "open",
            waitingOn: "team",
            assignedTo: "",
            version: 0,
            messages: [],
          };
          const wasPending = t.status === "open" && t.waitingOn === "client";
          if (action === "thread-create" || action === "thread-reply") {
            if (
              !text(p.content, 4000, true) ||
              (!actor && !text(p.senderName, 120, true)) ||
              (action === "thread-create" && !text(p.title, 160, true))
            )
              throw createHttpError(
                400,
                "Add your name, a title and a message.",
              );
            if (t.messages.length >= 50)
              throw createHttpError(
                409,
                "This conversation has 50 messages. Start a new topic and reference this one.",
              );
            if (
              !Array.isArray(p.attachments) ||
              p.attachments.length > 3 ||
              new Set(p.attachments).size !== p.attachments.length ||
              p.attachments.some(
                (id) =>
                  !ws.files.some(
                    (f) =>
                      f.id === id &&
                      !f.removing &&
                      f.versions.length &&
                      (actor || publicFile(f)),
                  ),
              )
            )
              throw createHttpError(
                400,
                "Choose up to three authorised files from this project.",
              );
            if (
              actor &&
              p.attachments.some(
                (id) => !ws.files.some((f) => f.id === id && publicFile(f)),
              )
            )
              throw createHttpError(
                400,
                "Make attached files client-visible before including them in a client conversation.",
              );
            const profile = actor
              ? await tx.get(db.collection("users").doc(actor.uid))
              : null;
            if (action === "thread-create") t.title = p.title.trim();
            t.messages = [
              ...t.messages,
              {
                id: p.requestId,
                sender: actor ? "team" : "client",
                senderName: actor
                  ? profile.data()?.displayName ||
                    profile.data()?.name ||
                    "Khulisa team"
                  : p.senderName.trim(),
                content: p.content.trim(),
                attachments: p.attachments,
                attachmentVersions: Object.fromEntries(
                  p.attachments.map((id) => [
                    id,
                    publishedVersions(ws.files.find((f) => f.id === id)).at(-1)
                      .id,
                  ]),
                ),
                createdAt: timestamp,
              },
            ];
            t.status = "open";
            t.waitingOn = actor
              ? p.awaitingResponse === true
                ? "client"
                : "none"
              : "team";
            if (actor) t.readByTeamAt = timestamp;
            else t.readByClientAt = timestamp;
            event = actor ? "Team reply posted" : "Client message received";
          } else if (action === "thread-read") {
            const key = actor ? "readByTeamAt" : "readByClientAt";
            changed =
              !!t.messages.length &&
              (!t[key] || t[key] < t.messages.at(-1).createdAt);
            t[key] = timestamp;
          } else {
            if (
              !["open", "resolved"].includes(p.status) ||
              !text(p.assignedTo, 128)
            )
              throw createHttpError(
                400,
                "Check conversation status and responsibility.",
              );
            const allowed = [
              actor.uid,
              actor.appUserId,
              ctx.project.assignedTo,
              ctx.project.buildOwnerId,
              ctx.client.contactManagerId,
            ].filter(Boolean);
            if (p.assignedTo && !allowed.includes(p.assignedTo))
              throw createHttpError(
                403,
                "Assign only a current project team member.",
              );
            if (p.assignedTo) {
              let profile = await tx.get(
                db.collection("users").doc(p.assignedTo),
              );
              if (!profile.exists) {
                const found = await tx.get(
                  db
                    .collection("users")
                    .where("appUserId", "==", p.assignedTo)
                    .limit(1),
                );
                profile = found.docs[0];
              }
              if (
                !profile?.exists ||
                profile.data().accessDisabled === true ||
                profile.data().isActive === false
              )
                throw createHttpError(403, "Assigned account is unavailable.");
            }
            changed = t.status !== p.status || t.assignedTo !== p.assignedTo;
            t.status = p.status;
            t.assignedTo = p.assignedTo;
            if (t.status === "resolved") t.waitingOn = "none";
            event =
              t.status === "resolved"
                ? "Conversation resolved"
                : "Conversation responsibility updated";
          }
          if (changed) {
            t.version++;
            t.updatedAt = timestamp;
            tx.set(ref, t);
            const pending = t.status === "open" && t.waitingOn === "client";
            if (pending !== wasPending)
              projectUpdates.workspacePendingQuestions = Math.max(
                0,
                (ctx.project.workspacePendingQuestions || 0) +
                  (pending ? 1 : 0) -
                  (wasPending ? 1 : 0),
              );
          }
        }
        if (changed) {
          if (action.startsWith("file-"))
            tx.set(workspaceRef(ctx.project.id), {
              ...ws,
              projectId: ctx.project.id,
              clientId: ctx.client.id,
            });
          if (Object.keys(projectUpdates).length)
            tx.update(db.collection("projects").doc(ctx.project.id), {
              ...projectUpdates,
              updatedAt: timestamp,
            });
          if (action !== "thread-read")
            tx.set(db.collection("activities").doc(`workspace_${opRef.id}`), {
              entityType: "client",
              entityId: ctx.client.id,
              type: "note",
              description: event,
              createdBy: actor?.uid || "client-portal",
              createdAt: timestamp,
              metadata: { projectId: ctx.project.id, clientId: ctx.client.id },
            });
        }
        tx.set(opRef, {
          projectId: ctx.project.id,
          clientId: ctx.client.id,
          signature,
          fileId: file?.id || "",
          uploadId: file?.pending?.id || "",
          threadId: threadId || "",
          changed,
          event,
          expiresAt: new Date(now() + 7 * 86400000),
        });
        if (!actor || upload)
          tx.set(dailyRef, {
            projectId: ctx.project.id,
            clientId: ctx.client.id,
            writes: (daily.data()?.writes || 0) + 1,
            uploads: (daily.data()?.uploads || 0) + (upload ? 1 : 0),
            expiresAt: new Date(now() + 2 * 86400000),
          });
        return {
          ctx,
          ws,
          file,
          uploadId: file?.pending?.id,
          threadId,
          changed,
          event,
          opId: opRef.id,
        };
      });
      if (result.file && ["file-upload", "file-delete"].includes(action)) {
        const file = result.file;
        const uploading =
          action === "file-upload" &&
          file.pending?.id === result.uploadId &&
          !!file.pending;
        if (uploading) {
          if (file.pending.sha !== upload.sha)
            throw createHttpError(409, "Retry with the original file.");
          await files.upload(file.pending, upload.bytes);
        }
        if (action === "file-delete") {
          for (const v of [
            ...file.versions,
            ...(file.pending ? [file.pending] : []),
          ])
            await files.remove(v);
        }
        if (action === "file-delete" || uploading) {
          await db.runTransaction(async (tx) => {
            const ctx = await context(p, actor, (q) => tx.get(q)),
              doc = await tx.get(workspaceRef(ctx.project.id)),
              ws = doc.data(),
              current = ws?.files.find((f) => f.id === file.id);
            if (!current) return;
            if (action === "file-delete") {
              if (!current.removing)
                throw createHttpError(409, "File changed. Refresh.");
              ws.files = ws.files.filter((f) => f.id !== file.id);
            } else {
              if (current.pending?.id !== file.pending.id)
                throw createHttpError(409, "Upload changed. Refresh.");
              current.versions = [
                ...current.versions,
                {
                  ...current.pending,
                  visibility:
                    current.pending.origin === "client" ? "client" : "staff",
                  createdAt: iso(now),
                  number: current.versions.length + 1,
                },
              ];
              current.pending = null;
              current.updatedAt = iso(now);
            }
            tx.update(workspaceRef(ctx.project.id), {
              files: ws.files,
              version: ws.version + 1,
            });
            tx.update(db.collection("projects").doc(ctx.project.id), {
              workspaceFileAttention: ws.files.filter(
                (f) => publicFile(f) && f.attention && f.versions.length,
              ).length,
              updatedAt: iso(now),
            });
          });
        }
      }
      if (result.changed && action !== "thread-read") {
        try {
          await notify(
            {
              id: `workspace_${result.opId}`,
              projectId: result.ctx.project.id,
              title: result.event || "Project workspace updated",
            },
            { workspace: true },
          );
        } catch (e) {
          console.error("[Workspace notice]", {
            code: e.code || "unavailable",
          });
        }
      }
      return json(res, 200, { saved: true, threadId: result.threadId || null });
    } catch (e) {
      return json(res, e.status || 500, {
        error: e.status
          ? e.message
          : "The workspace action did not finish. Retry the same details or refresh.",
      });
    }
  }
  return {
    public: (req, res) => run(req, res),
    staff: (req, res) => run(req, res, true),
  };
}
