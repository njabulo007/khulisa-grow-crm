import { createHttpError, json, methodNotAllowed, parseBody } from './http.js';
import { readIdentityConfig } from './migrationHandlers.js';

export function createPushHandler({ db, messaging, authenticate, requireOwner, now = () => Date.now(), getIdentityConfig = readIdentityConfig }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    let ref;
    let claimed = false;
    try {
      const identity = await authenticate(req);
      const { notificationId } = parseBody(req);
      if (typeof notificationId !== 'string' || !notificationId.trim() || notificationId.length > 128 || notificationId.includes('/')) {
        throw createHttpError(400, 'A notification ID is required.');
      }
      ref = db.collection('notifications').doc(notificationId.trim());
      const snapshot = await ref.get();
      if (!snapshot.exists) throw createHttpError(404, 'Notification not found.');
      const notification = snapshot.data();
      if (identity.role === 'owner') await requireOwner(req);
      else if (![identity.uid, identity.appUserId].filter(Boolean).includes(notification.userId)) {
        throw createHttpError(403, 'You cannot send this notification.');
      }
      const notificationData = await db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        if (!current.exists) throw createHttpError(404, 'Notification was removed.');
        const data = current.data();
        if (data.userId !== notification.userId) throw createHttpError(409, 'The recipient changed.');
        if (data.pushStatus === 'sent' || (data.pushStatus === 'sending' && now() - data.pushStartedAt < 120_000)) return null;
        transaction.update(ref, { pushStatus: 'sending', pushStartedAt: now(), pushManagedBy: 'vercel', pushErrorCodes: [] });
        return data;
      });
      if (!notificationData) return json(res, 200, { status: 'already-handled' });
      claimed = true;
      const keys = new Set([notificationData.userId]);
      for (const [uid, appId] of Object.entries(getIdentityConfig().legacyIds)) {
        if (keys.has(uid) || keys.has(appId)) { keys.add(uid); keys.add(appId); }
      }
      const tokenDocs = new Map();
      for (const key of keys) {
        const tokens = await db.collection('push_tokens').where('userId', '==', key).get();
        for (const doc of tokens.docs) tokenDocs.set(doc.ref.path, doc);
      }
      const tokens = [...new Set([...tokenDocs.values()].map((doc) => doc.data().token).filter((token) => typeof token === 'string' && token))];
      if (!tokens.length) {
        await ref.update({ pushStatus: 'no-devices', pushTargetCount: 0 });
        return json(res, 200, { status: 'no-devices' });
      }
      const link = ['invoice', 'client', 'project', 'lead'].find((type) => notificationData[`${type}Id`]);
      const clientSection = notificationData.type === 'client_feedback' ? '#client-feedback' : notificationData.type === 'client_opportunity' ? '#client-growth' : notificationData.type === 'client_health' ? '#client-health' : notificationData.type === 'client_request' ? '#client-requests' : notificationData.type === 'client_follow_up' ? '#client-activity' : '';
      let sent = 0;
      let failed = 0;
      const errorCodes = new Set();
      for (let offset = 0; offset < tokens.length; offset += 500) {
        const chunk = tokens.slice(offset, offset + 500);
        const result = await messaging.sendEachForMulticast({
          tokens: chunk,
          data: { title: String(notificationData.title || 'Khulisa CRM').slice(0, 180), body: String(notificationData.message || 'You have a new notification.').slice(0, 1800),
            notificationId: ref.id, link: link ? `/${link}s/${encodeURIComponent(notificationData[`${link}Id`])}${link === 'client' ? clientSection : ''}` : '/' },
          webpush: { headers: { Urgency: 'high', TTL: '86400' } },
        });
        sent += result.successCount; failed += result.failureCount;
        for (let index = 0; index < result.responses.length; index++) {
          const code = result.responses[index].error?.code;
          if (typeof code === 'string') errorCodes.add(code.slice(0, 120));
          if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
            for (const doc of tokenDocs.values()) if (doc.data().token === chunk[index]) await doc.ref.delete();
          }
        }
      }
      // Avoid resending to successful devices after a partial result. The saved
      // status exposes partial failure for diagnosis without hiding the bell item.
      if (errorCodes.size) console.warn('[Push] Device delivery errors', { notificationId: ref.id, codes: [...errorCodes] });
      await ref.update({ pushStatus: sent ? 'sent' : 'failed', pushSentAt: now(), pushSentCount: sent, pushFailureCount: failed,
        pushTargetCount: tokens.length, pushErrorCodes: [...errorCodes].slice(0, 10) });
      return json(res, 200, { status: sent ? 'sent' : 'failed', sent, failed });
    } catch (error) {
      if (!error?.status) console.error('[Push] Delivery failed', { code: error?.code || 'unknown' });
      if (claimed && ref) await ref.update({ pushStatus: 'failed', pushErrorCodes: [String(error?.code || 'server/unknown').slice(0, 120)] }).catch(() => {});
      return json(res, error?.status || 500, { error: error?.status ? error.message : 'Push delivery failed. Check Vercel logs and Firebase Cloud Messaging configuration.' });
    }
  };
}
