import {preparePortalUpload} from './portalUpload.js';
import { createPortalProjectAccess } from './portalProjectAccess.js';
import crypto from "node:crypto";
import { createHttpError, json, parseBody, methodNotAllowed } from "./http.js";
import {
  tokenHash,
  computeShareStatus,
  isProjectClosed,
} from "./projectShareCore.js";
import {
  ONBOARDING_TEMPLATES,
  templateIdsFor,
  onboardingFields,
  missingOnboardingFields,
} from "../../shared/onboarding.js";
const id = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const digest = (s) => crypto.createHash("sha256").update(s).digest("hex");
const editable = (r) =>
  !r ||
  ["not-started", "in-progress", "more-information-needed"].includes(r.status);
const stamp = (now) => new Date(now()).toISOString();
const fileView = (f) => ({
  id: f.id,
  name: f.name,
  mimeType: f.mimeType,
  sizeBytes: f.sizeBytes,
  status: f.status,
});
const known = (c) => ({
  businessName: c.businessName || "",
  contactName: c.ownerName || "",
  contactEmail: c.email || "",
  contactPhone: c.phone || "",
  location: c.location || "",
});
export function onboardingView(record, project, client) {
  const r = record || {};
  const legacyCompleted = !record && client.onboardingCompleted === true;
  return {
    projectId: project.id,
    status: r.status || (legacyCompleted ? "approved" : "not-started"),
    legacyCompleted,
    version: r.version || 0,
    templateIds: templateIdsFor(project),
    answers: { ...known(client), ...(r.answers || {}) },
    files: (r.files || []).map(fileView),
    feedback: r.feedback || "",
    submission: r.submission || 0,
    submittedAt: r.submittedAt || null,
    updatedAt: r.updatedAt || null,
    missing: legacyCompleted
      ? []
      : missingOnboardingFields(
          { ...known(client), ...(r.answers || {}) },
          templateIdsFor(project),
        ),
    editable:
      !legacyCompleted && editable(record) && !isProjectClosed(project.status),
  };
}
export function createPortalOnboardingHandlers({
  db,
  authenticate,
  requireOwner,
  files,
  notify = async () => {},
  now = () => Date.now(),
}) {
  const ref = (projectId) => db.collection("project_onboarding").doc(projectId);
  const {publicContext,staffContext}=createPortalProjectAccess({db,now});
  const output = (ctx, r) => onboardingView(r, ctx.project, ctx.client);
  async function notice(ctx, event) {
    try {
      await notify(
        {
          id: `onboarding_${ctx.project.id}_${event}`,
          projectId: ctx.project.id,
        },
        { onboarding: true },
      );
    } catch (e) {
      console.error("[Onboarding notice]", { code: e.code || "unavailable" });
    }
  }
  async function run(req, res, staff = false) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    try {
      const p = parseBody(req),
        action = p.action?.replace(/^onboarding-/, ""),
        actor = staff ? await authenticate(req) : null;
      if (
        staff &&
        !["get", "review", "configure", "download", "history"].includes(action)
      )
        throw createHttpError(400, "Unknown staff action.");
      if (
        !staff &&
        ![
          "get",
          "save",
          "submit",
          "upload",
          "remove-file",
          "download",
        ].includes(action)
      )
        throw createHttpError(400, "Unknown workspace action.");
      const context = (read) =>
        staff ? staffContext(p, actor, read) : publicContext(p, read);
      if (["get", "history", "download"].includes(action)) {
        const ctx = await context((q) => q.get()),
          doc = await ref(ctx.project.id).get(),
          r = doc.data();
        if (action === "history") {
          const count = Math.min(r?.submission || 0, 20);
          const history = await Promise.all(
            Array.from({ length: count }, (_, i) =>
              db
                .collection("project_onboarding_revisions")
                .doc(`${ctx.project.id}_${r.submission - i}`)
                .get(),
            ),
          );
          return json(res, 200, {
            revisions: history
              .filter((d) => d.exists)
              .map((d) => ({
                ...d.data(),
                files: (d.data().files || []).map(fileView),
              })),
          });
        }
        if (action === "get") return json(res, 200, output(ctx, r));
        const file = r?.files?.find(
          (f) => f.id === p.fileId && f.status === "ready",
        );
        if (!file) throw createHttpError(404, "File unavailable.");
        const bytes = await files.download(file);
        return json(res, 200, {
          ...fileView(file),
          base64: bytes.toString("base64"),
        });
      }
      if (!id(p.requestId))
        throw createHttpError(400, "Refresh and retry this change.");
      const upload=action==='upload'?preparePortalUpload(p):undefined;
      const result = await db.runTransaction(async (tx) => {
        const ctx = await context((q) => tx.get(q)),
          doc = await tx.get(ref(ctx.project.id)),
          r = doc.data();
        const operationRef = db
          .collection("_portal_onboarding_operations")
          .doc(
            digest(
              `${ctx.project.id}:${staff ? actor.uid : ctx.shareId}:${p.requestId}`,
            ),
          );
        const operation = await tx.get(operationRef),
          signature = digest(
            JSON.stringify({ ...p, token: undefined, base64: upload?.sha }),
          );
        if (operation.exists) {
          if (operation.data().signature !== signature)
            throw createHttpError(
              409,
              "This save attempt already contains different details. Refresh.",
            );
          return {
            ctx,
            record: r,
            file: r?.files?.find((f) => f.id === operation.data().fileId),
            duplicate: true,
          };
        }
        if (!Number.isInteger(p.version) || p.version !== (r?.version || 0))
          throw createHttpError(
            409,
            "Your workspace changed. Reload saved progress before saving again.",
          );
        const dailyRef = db
            .collection("_portal_limits")
            .doc(
              `onboarding_${ctx.project.id}_${new Date(now() + 7200000).toISOString().slice(0, 10)}`,
            ),
          daily = await tx.get(dailyRef);
        const ids = templateIdsFor(ctx.project),
          record = {
            ...(r || {}),
            projectId: ctx.project.id,
            clientId: ctx.client.id,
            version: (r?.version || 0) + 1,
            updatedAt: stamp(now),
          };
        let file;
        if (staff && isProjectClosed(ctx.project.status))
          throw createHttpError(
            409,
            "Reopen the project before changing onboarding.",
          );
        if (!staff) {
          if (!onboardingView(r, ctx.project, ctx.client).editable)
            throw createHttpError(
              409,
              "Your information is being reviewed. Contact your team to make changes.",
            );
          if ((daily.data()?.writes || 0) >= 60)
            throw createHttpError(
              429,
              "Today’s save limit is reached. Contact your team.",
            );
        }
        if (["save", "submit"].includes(action)) {
          if (
            !p.answers ||
            typeof p.answers !== "object" ||
            Array.isArray(p.answers)
          )
            throw createHttpError(400, "Add your business details.");
          const fields = onboardingFields(ids),
            allowed = new Set(fields.map((f) => f.id));
          for (const [key, value] of Object.entries(p.answers))
            if (
              !allowed.has(key) ||
              typeof value !== "string" ||
              value.length > 4000
            )
              throw createHttpError(
                400,
                "Use only the current form fields, up to 4,000 characters each.",
              );
          record.answers = Object.fromEntries(
            Object.entries(p.answers).map(([k, v]) => [k, v.trim()]),
          );
          if (
            record.answers.contactEmail &&
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.answers.contactEmail)
          )
            throw createHttpError(400, "Check the contact email address.");
          for (const field of fields)
            if (
              field.options &&
              record.answers[field.id] &&
              !field.options.includes(record.answers[field.id])
            )
              throw createHttpError(400, `Check ${field.label}.`);
          if (
            record.answers.existingWebsite &&
            !/^https?:\/\/[^\s]+$/i.test(record.answers.existingWebsite)
          )
            throw createHttpError(
              400,
              "Use a website address starting with https:// or http://.",
            );
          record.status = "in-progress";
          if (action === "submit") {
            const missing = missingOnboardingFields(record.answers, ids);
            if (missing.length)
              throw createHttpError(
                400,
                `Please complete: ${missing.join(", ")}.`,
              );
            if (p.confirmed !== true)
              throw createHttpError(
                400,
                "Confirm that you have reviewed your answers.",
              );
            if (record.files?.some((f) => f.status !== "ready"))
              throw createHttpError(
                409,
                "Finish or remove pending uploads before submitting.",
              );
            record.status = "submitted";
            record.submission = (r?.submission || 0) + 1;
            record.submittedAt = stamp(now);
            record.feedback = "";
            tx.set(
              db
                .collection("project_onboarding_revisions")
                .doc(`${ctx.project.id}_${record.submission}`),
              {
                projectId: ctx.project.id,
                clientId: ctx.client.id,
                submission: record.submission,
                answers: record.answers,
                files: (record.files || []).map(fileView),
                templateIds: ids,
                submittedAt: record.submittedAt,
              },
            );
          }
        } else if (action === "upload") {
          const pending = record.files?.find(
            (f) =>
              f.status === "uploading" &&
              f.sha === upload.sha &&
              f.name === p.name.trim() &&
              f.mimeType === p.mimeType,
          );
          if (
            (!pending && (record.files || []).length >= 10) ||
            (daily.data()?.uploads || 0) >= 10
          )
            throw createHttpError(
              429,
              "Use up to 10 files per project and 10 upload attempts per day. Contact your team for larger materials.",
            );
          file = pending
            ? { ...pending, leaseUntil: now() + 120000 }
            : {
                id: upload.id,
                name: p.name.trim(),
                mimeType: p.mimeType,
                sizeBytes: upload.bytes.length,
                path: `portal-onboarding/${ctx.project.id}/${upload.id}.enc`,
                key: upload.key,
                status: "uploading",
                leaseUntil: now() + 120000,
                sha: upload.sha,
              };
          record.files = pending
            ? record.files.map((f) => (f.id === file.id ? file : f))
            : [...(record.files || []), file];
          record.status = r?.status || "in-progress";
        } else if (action === "remove-file") {
          file = record.files?.find((f) => f.id === p.fileId);
          if (!file) throw createHttpError(404, "File unavailable.");
          if (file.status === "uploading" && file.leaseUntil > now())
            throw createHttpError(
              409,
              "This upload is still running. Try again shortly.",
            );
          file = { ...file, status: "removing" };
          record.files = record.files.map((f) => (f.id === file.id ? file : f));
        } else if (action === "configure") {
          await requireOwner(req);
          if (
            r &&
            (Object.keys(r.answers || {}).length ||
              r.files?.length ||
              r.submission)
          )
            throw createHttpError(
              409,
              "Templates cannot change after the client starts. Keep their answers and discuss any new work separately.",
            );
          if (
            !Array.isArray(p.templateIds) ||
            p.templateIds.length > 4 ||
            new Set(p.templateIds).size !== p.templateIds.length ||
            p.templateIds.some((i) => !Object.hasOwn(ONBOARDING_TEMPLATES, i))
          )
            throw createHttpError(400, "Choose supported service templates.");
          tx.update(db.collection("projects").doc(ctx.project.id), {
            onboardingTemplateIds: p.templateIds,
            updatedAt: stamp(now),
          });
          ctx.project.onboardingTemplateIds = p.templateIds;
          record.status = "not-started";
        } else if (action === "review") {
          if (
            !["under-review", "more-information-needed", "approved"].includes(
              p.status,
            ) ||
            !["submitted", "under-review", "more-information-needed"].includes(
              r?.status,
            )
          )
            throw createHttpError(409, "Review a submitted onboarding first.");
          if (p.status === "approved") await requireOwner(req);
          if (
            typeof p.feedback !== "string" ||
            p.feedback.length > 4000 ||
            (p.status === "more-information-needed" && !p.feedback.trim())
          )
            throw createHttpError(
              400,
              "Explain what the client needs to clarify.",
            );
          record.status = p.status;
          record.feedback = p.feedback.trim();
          record.reviewedBy = actor.uid;
          record.reviewedAt = stamp(now);
        }
        tx.set(ref(ctx.project.id), record);
        tx.set(operationRef, {
          projectId: ctx.project.id,
          clientId: ctx.client.id,
          signature,
          fileId: file?.id || "",
          expiresAt: new Date(now() + 7 * 86400000),
        });
        if (!staff)
          tx.set(dailyRef, {
            projectId: ctx.project.id,
            clientId: ctx.client.id,
            writes: (daily.data()?.writes || 0) + 1,
            uploads:
              (daily.data()?.uploads || 0) + (action === "upload" ? 1 : 0),
            expiresAt: new Date(now() + 2 * 86400000),
          });
        tx.update(db.collection("projects").doc(ctx.project.id), {
          onboardingStatus: record.status,
          updatedAt: stamp(now),
        });
        if (action === "submit" || action === "review")
          tx.set(
            db
              .collection("activities")
              .doc(
                `onboarding_${digest(`${ctx.project.id}:${record.version}`)}`,
              ),
            {
              entityType: "client",
              entityId: ctx.client.id,
              type: "note",
              description:
                action === "submit"
                  ? `Project onboarding submitted (revision ${record.submission}). Client details await team verification.`
                  : `Project onboarding: ${record.status}. ${record.feedback}`,
              createdBy: staff ? actor.uid : "client-portal",
              createdAt: stamp(now),
              metadata: { projectId: ctx.project.id, clientId: ctx.client.id },
            },
          );
        return { ctx, record, file };
      });
      if (result.file && ["upload", "remove-file"].includes(action)) {
        const f = result.file;
        if (action === "upload" && f.status === "ready")
          return json(res, 200, output(result.ctx, result.record));
        if (action === "upload" && f.sha !== upload.sha)
          throw createHttpError(409, "Retry this upload with the same file.");
        if (action === "upload") await files.upload(f, upload.bytes);
        else await files.remove(f);
        await db.runTransaction(async (tx) => {
          const ctx = await context((q) => tx.get(q)),
            doc = await tx.get(ref(ctx.project.id)),
            r = doc.data();
          if (!r?.files?.some((entry) => entry.id === f.id))
            throw createHttpError(
              409,
              "The file changed. Reload saved progress.",
            );
          const list =
            action === "upload"
              ? r.files.map((entry) =>
                  entry.id === f.id
                    ? { ...entry, status: "ready", leaseUntil: 0 }
                    : entry,
                )
              : r.files.filter((entry) => entry.id !== f.id);
          tx.update(ref(ctx.project.id), {
            files: list,
            version: r.version + 1,
            updatedAt: stamp(now),
          });
        });
      }
      if (action === "submit" || action === "review")
        await notice(
          result.ctx,
          `${action}_${result.record.submission}_${result.record.status}`,
        );
      const latest = await ref(result.ctx.project.id).get();
      return json(res, 200, output(result.ctx, latest.data()));
    } catch (e) {
      return json(res, e.status || 500, {
        error: e.status
          ? e.message
          : "Your onboarding could not be saved. Retry the same action or contact your team.",
      });
    }
  }
  return {
    public: (req, res) => run(req, res),
    staff: (req, res) => run(req, res, true),
  };
}
