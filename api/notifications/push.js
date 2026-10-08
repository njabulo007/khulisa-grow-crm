import { adminAuth, adminDb, adminMessaging } from '../_lib/firebaseAdmin.js';
import { migration } from '../_lib/migration.js';
import { createPushHandler } from '../_lib/pushHandlers.js';
import { createPaymentFollowUpHandler } from '../_lib/paymentFollowUpHandlers.js';
import { parseBody } from '../_lib/http.js';

const push = createPushHandler({ db: adminDb, messaging: adminMessaging, authenticate: migration.authenticate, requireOwner: migration.requireOwner });
const followUps = createPaymentFollowUpHandler({ db: adminDb, auth: adminAuth,
  authenticate: migration.authenticate, requireOwner: migration.requireOwner,
  sendPush: async (notificationId, userId) => {
    // Trusted internal dispatch still checks the saved notification recipient.
    const internal = createPushHandler({ db: adminDb, messaging: adminMessaging,
      authenticate: async () => ({ uid: userId, role: 'agent' }), requireOwner: migration.requireOwner });
    const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
    await internal({ method: 'POST', body: { notificationId } }, response);
    if (response.code >= 400 || response.data?.status === 'failed') throw new Error('Push delivery failed.');
  },
});

export default (req, res) => req.method === 'GET' || parseBody(req).kind === 'payment-follow-up'
  ? followUps(req, res) : push(req, res);
