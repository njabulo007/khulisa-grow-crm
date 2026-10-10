import crypto from 'crypto';
import { adminDb } from '../_lib/firebaseAdmin.js';
import { createHttpError, handleRouteError, json, methodNotAllowed, parseBody } from '../_lib/http.js';
import {
  CLIENTS_COLLECTION,
  PROJECT_SHARES_COLLECTION,
  PROJECTS_COLLECTION,
  isProjectClosed,
  nowIso,
  parseOptionalIsoDate,
  tokenHash,
} from '../_lib/projectShareCore.js';
import { revokeShareAndDeleteMedia } from '../_lib/projectShareMedia.js';
import { requireOwner } from '../_lib/requireOwner.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  try {
    const { uid } = await requireOwner(req);
    const payload = parseBody(req);
    const projectId = typeof payload.projectId === 'string' ? payload.projectId.trim() : '';
    const requestedExpiry = parseOptionalIsoDate(payload.expiresAt);

    if (!projectId) {
      throw createHttpError(400, 'projectId is required.');
    }

    const projectSnapshot = await adminDb.collection(PROJECTS_COLLECTION).doc(projectId).get();
    if (!projectSnapshot.exists) {
      throw createHttpError(404, 'Project not found.');
    }

    const project = projectSnapshot.data() || {};
    if (project._deleting) throw createHttpError(409, 'Project deletion is in progress.');
    const projectStatus = typeof project.status === 'string' ? project.status : 'not-started';


    const clientId = typeof project.clientId === 'string' ? project.clientId.trim() : '';
    if (!clientId) {
      throw createHttpError(409, 'Project has no linked client.');
    }

    const clientSnapshot = await adminDb.collection(CLIENTS_COLLECTION).doc(clientId).get();
    if (!clientSnapshot.exists) {
      throw createHttpError(409, 'Linked client record is missing.');
    }

    const now = nowIso();
    const expiresAt = requestedExpiry || new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    if (new Date(expiresAt).getTime() <= Date.now()) {
      throw createHttpError(400, 'Expiry date must be in the future.');
    }

    const existingShares = await adminDb
      .collection(PROJECT_SHARES_COLLECTION)
      .where('projectId', '==', projectId)
      .get();

    if (!existingShares.empty) {
      for (const docSnapshot of existingShares.docs) {
        const data = docSnapshot.data() || {};
        const deletion = await revokeShareAndDeleteMedia({
          shareRef: docSnapshot.ref,
          shareData: data,
          shareUpdateTime: docSnapshot.updateTime,
          revokedBy: uid,
          now,
        });
        if (deletion.failed) throw createHttpError(502, 'Old portal files could not be deleted. Retry cleanup before creating another link.');
      }
    }

    const token = crypto.randomBytes(32).toString('hex');
    const shareRef = adminDb.collection(PROJECT_SHARES_COLLECTION).doc();
    const newShare = {
      projectId,
      clientId,
      tokenHash: tokenHash(token),
      status: 'active',
      expiresAt,
      revokedAt: null,
      revokedBy: null,
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
      lastViewedAt: null,
      media: [],
    };
    await adminDb.runTransaction(async (transaction) => {
      const [currentProject, currentClient] = await Promise.all([
        transaction.get(projectSnapshot.ref), transaction.get(adminDb.collection(CLIENTS_COLLECTION).doc(clientId)),
      ]);
      if (!currentProject.exists || !currentClient.exists || currentProject.data()._deleting || currentClient.data()._deleting
        || currentProject.data().clientId !== clientId) {
        throw createHttpError(409, 'The project or client changed. Refresh before creating a portal link.');
      }
      transaction.set(shareRef, newShare);
    });

    return json(res, 200, {
      shareId: shareRef.id,
      token,
      projectId,
      clientId,
      expiresAt,
      status: 'active',
    });
  } catch (error) {
    return handleRouteError(res, error, 'Failed to create share link.');
  }
}
