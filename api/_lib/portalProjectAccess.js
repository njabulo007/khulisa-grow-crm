import { createHttpError } from "./http.js";
import { tokenHash, computeShareStatus } from "./projectShareCore.js";
const id = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export function createPortalProjectAccess({ db, now = () => Date.now() }) {
  async function publicContext(p, read) {
    if (typeof p.token !== "string" || !p.token.trim() || p.token.length > 200)
      throw createHttpError(400, "Use a valid workspace link.");
    const shares = await read(
      db
        .collection("project_shares")
        .where("tokenHash", "==", tokenHash(p.token.trim()))
        .limit(1),
    );
    const shareDoc = shares.docs[0],
      share = shareDoc?.data();
    if (!share || computeShareStatus(share, now()) !== "active")
      throw createHttpError(
        403,
        "Your link has expired or is unavailable. Contact your team.",
      );
    const ctx = await parents(share.projectId, read);
    if (share.clientId && share.clientId !== ctx.client.id)
      throw createHttpError(
        403,
        "This link no longer matches its client. Contact your team.",
      );
    return { ...ctx, shareId: shareDoc.id };
  }
  async function parents(projectId, read) {
    if (!id(projectId)) throw createHttpError(400, "Choose a project.");
    const projectDoc = await read(db.collection("projects").doc(projectId)),
      project = projectDoc.data();
    if (!project || project._deleting || !id(project.clientId))
      throw createHttpError(404, "Project unavailable.");
    const clientDoc = await read(
        db.collection("clients").doc(project.clientId),
      ),
      client = clientDoc.data();
    if (!client || client._deleting)
      throw createHttpError(404, "Client unavailable.");
    return {
      project: { ...project, id: projectDoc.id },
      client: { ...client, id: clientDoc.id },
    };
  }
  async function staffContext(p, actor, read) {
    const ctx = await parents(p.projectId, read);
    if (actor.role === "owner") return ctx;
    const keys = [actor.uid, actor.appUserId].filter(Boolean);
    if (
      keys.includes(ctx.project.assignedTo) ||
      keys.includes(ctx.client.contactManagerId)
    )
      return ctx;
    if (id(ctx.client.leadId)) {
      const lead = await read(db.collection("leads").doc(ctx.client.leadId));
      if (
        lead.exists &&
        !lead.data()._deleting &&
        keys.includes(lead.data().assignedTo)
      )
        return ctx;
    }
    throw createHttpError(
      403,
      "You are not assigned to this client or project.",
    );
  }
  return { publicContext, staffContext };
}
