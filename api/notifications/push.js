import { adminAuth, adminDb, adminMessaging } from '../_lib/firebaseAdmin.js';
import { migration } from '../_lib/migration.js';
import { createPushHandler } from '../_lib/pushHandlers.js';
import { createPaymentFollowUpHandler } from '../_lib/paymentFollowUpHandlers.js';
import { createClientSuccessHandlers } from '../_lib/clientSuccessHandlers.js';
import { requestAttachmentStorage } from '../_lib/requestAttachmentStorage.js';
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
const clientWork = createClientSuccessHandlers({ db: adminDb, auth: adminAuth, authenticate: migration.authenticate,
  requireOwner: migration.requireOwner, sendPush, files: requestAttachmentStorage });
const followUps = createPaymentFollowUpHandler({ db: adminDb, auth: adminAuth,
  authenticate: migration.authenticate, requireOwner: migration.requireOwner, sendPush, runLeadFollowUps: leads.runDue, runClientFollowUps: clientWork.runDue,
});

export default (req, res) => {
  const kind = parseBody(req).kind;
  if (kind === 'client-feedback' && req.method !== 'GET') return clientWork.feedback(req, res);
  if (kind === 'client-opportunity' && req.method !== 'GET') return clientWork.opportunities(req, res);
  if (kind === 'client-care' && req.method !== 'GET') return clientWork.care(req, res);
  if (kind === 'client-follow-up' && req.method !== 'GET') return clientWork.followUps(req, res);
  if (kind === 'client-request' && req.method !== 'GET') return clientWork.requests(req, res);
  if (kind === 'lead-follow-up' && req.method !== 'GET') return leads.handle(req, res);
  return req.method === 'GET' || kind === 'payment-follow-up' ? followUps(req, res) : push(req, res);
};
