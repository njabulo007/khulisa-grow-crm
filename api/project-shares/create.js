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
    const projectStatus = typeof project.status === 'string' ? project.status : 'not-started';
    if (isProjectClosed(projectStatus)) {
      throw createHttpError(409, 'Cannot create links for completed/delivered projects.');
    }

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
      const batch = adminDb.batch();
      let writes = 0;
      existingShares.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data() || {};
        if (data.status === 'active' && !data.revokedAt) {
          batch.update(docSnapshot.ref, {
            status: 'revoked',
            revokedAt: now,
            revokedBy: uid,
            updatedAt: now,
          });
          writes += 1;
        }
      });
      if (writes > 0) {
        await batch.commit();
      }
    }

    const token = crypto.randomBytes(32).toString('hex');
    const shareRef = adminDb.collection(PROJECT_SHARES_COLLECTION).doc();
    await shareRef.set({
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
