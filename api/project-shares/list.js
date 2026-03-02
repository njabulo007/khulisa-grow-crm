import { adminDb } from '../_lib/firebaseAdmin.js';
import { createHttpError, handleRouteError, json, methodNotAllowed, parseBody } from '../_lib/http.js';
import {
  PROJECT_SHARES_COLLECTION,
  computeShareStatus,
  parseOptionalIsoDate,
} from '../_lib/projectShareCore.js';
import { requireOwner } from '../_lib/requireOwner.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  try {
    await requireOwner(req);
    const payload = parseBody(req);
    const projectId = typeof payload.projectId === 'string' ? payload.projectId.trim() : '';
    if (!projectId) {
      throw createHttpError(400, 'projectId is required.');
    }

    const snapshot = await adminDb
      .collection(PROJECT_SHARES_COLLECTION)
      .where('projectId', '==', projectId)
      .get();

    const shares = snapshot.docs
      .map((docSnapshot) => {
        const data = docSnapshot.data() || {};
        return {
          id: docSnapshot.id,
          projectId: typeof data.projectId === 'string' ? data.projectId : '',
          clientId: typeof data.clientId === 'string' ? data.clientId : '',
          status: computeShareStatus(data),
          expiresAt: parseOptionalIsoDate(data.expiresAt),
          revokedAt: parseOptionalIsoDate(data.revokedAt),
          createdAt: parseOptionalIsoDate(data.createdAt),
          lastViewedAt: parseOptionalIsoDate(data.lastViewedAt),
        };
      })
      .sort((a, b) => {
        const aMs = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bMs = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bMs - aMs;
      });

    return json(res, 200, { shares });
  } catch (error) {
    return handleRouteError(res, error, 'Failed to load share links.');
  }
}
