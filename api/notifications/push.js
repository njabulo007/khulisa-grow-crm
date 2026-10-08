import { adminAuth, adminDb, adminMessaging } from '../_lib/firebaseAdmin.js';
import { migration } from '../_lib/migration.js';
import { createPushHandler } from '../_lib/pushHandlers.js';
import { createPaymentFollowUpHandler } from '../_lib/paymentFollowUpHandlers.js';
import { parseBody } from '../_lib/http.js';
import { createLeadFollowUpHandlers } from '../_lib/leadFollowUpHandlers.js';

const push = createPushHandler({ db: adminDb, messaging: adminMessaging, authenticate: migration.authenticate, requireOwner: migration.requireOwner });
const sendPush = async (notificationId, userId) => {
  // Trusted internal dispatch still checks the saved notification recipient.
  const internal = createPushHandler({ db: adminDb, messaging: adminMessaging,
    authenticate: async () => ({ uid: userId, role: 'agent' }), requireOwner: migration.requireOwner });
  const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
  await internal({ method: 'POST', body: { notificationId } }, response);
  if (response.code >= 400 || response.data?.status === 'failed') throw new Error('Push delivery failed.');
};
const leads = createLeadFollowUpHandlers({ db: adminDb, auth: adminAuth, authenticate: migration.authenticate, requireOwner: migration.requireOwner, sendPush });
const followUps = createPaymentFollowUpHandler({ db: adminDb, auth: adminAuth,
  authenticate: migration.authenticate, requireOwner: migration.requireOwner, sendPush, runLeadFollowUps: leads.runDue,
});

export default (req, res) => {
  const kind = parseBody(req).kind;
  if (kind === 'lead-follow-up' && req.method !== 'GET') return leads.handle(req, res);
  return req.method === 'GET' || kind === 'payment-follow-up' ? followUps(req, res) : push(req, res);
};
