import { adminDb } from '../_lib/firebaseAdmin.js';
import { createHttpError, handleRouteError, json, methodNotAllowed, parseBody } from '../_lib/http.js';
import { PROJECT_SHARES_COLLECTION, nowIso } from '../_lib/projectShareCore.js';
import { requireOwner } from '../_lib/requireOwner.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  try {
    const { uid } = await requireOwner(req);
    const payload = parseBody(req);
    const shareId = typeof payload.shareId === 'string' ? payload.shareId.trim() : '';
    if (!shareId) {
      throw createHttpError(400, 'shareId is required.');
    }

    const shareRef = adminDb.collection(PROJECT_SHARES_COLLECTION).doc(shareId);
    const snapshot = await shareRef.get();
    if (!snapshot.exists) {
      throw createHttpError(404, 'Share link not found.');
    }

    const now = nowIso();
    await shareRef.update({
      status: 'revoked',
      revokedAt: now,
      revokedBy: uid,
      updatedAt: now,
    });

    return json(res, 200, { ok: true, shareId });
  } catch (error) {
    return handleRouteError(res, error, 'Failed to revoke share link.');
  }
}
