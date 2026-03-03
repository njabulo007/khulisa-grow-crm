import { adminDb } from '../_lib/firebaseAdmin.js';
import { createHttpError, handleRouteError, json, methodNotAllowed, parseBody } from '../_lib/http.js';
import { PROJECT_SHARES_COLLECTION, computeShareStatus, nowIso } from '../_lib/projectShareCore.js';
import {
  assertPortalMediaCapacity,
  buildPortalMediaFromPayload,
  normalizePortalMedia,
} from '../_lib/projectShareMedia.js';
import { requireOwner } from '../_lib/requireOwner.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  try {
    await requireOwner(req);
    const payload = parseBody(req);
    const shareId = typeof payload.shareId === 'string' ? payload.shareId.trim() : '';
    if (!shareId) {
      throw createHttpError(400, 'shareId is required.');
    }

    const projectId = typeof payload.projectId === 'string' ? payload.projectId.trim() : '';
    if (!projectId) {
      throw createHttpError(400, 'projectId is required.');
    }

    const shareRef = adminDb.collection(PROJECT_SHARES_COLLECTION).doc(shareId);
    const media = buildPortalMediaFromPayload(payload);
    const now = nowIso();
    let persisted = null;

    await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(shareRef);
      if (!snapshot.exists) {
        throw createHttpError(404, 'Share link not found.');
      }

      const share = snapshot.data() || {};
      const linkedProjectId = typeof share.projectId === 'string' ? share.projectId.trim() : '';
      if (!linkedProjectId || linkedProjectId !== projectId) {
        throw createHttpError(409, 'Share link does not match this project.');
      }

      const shareStatus = computeShareStatus(share);
      if (shareStatus !== 'active') {
        throw createHttpError(409, 'Only active share links can receive media uploads.');
      }

      const existingMedia = normalizePortalMedia(share.media);
      assertPortalMediaCapacity(existingMedia);

      persisted = {
        ...media,
        createdAt: now,
      };

      transaction.update(shareRef, {
        media: [...existingMedia, persisted],
        updatedAt: now,
      });
    });

    return json(res, 200, { media: persisted });
  } catch (error) {
    return handleRouteError(res, error, 'Failed to attach media to share link.');
  }
}
