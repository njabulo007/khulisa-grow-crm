import { createPortalNotifier } from '../_lib/portalNotifications.js';
import { sweepWorkflowHistory } from '../_lib/workflowMaintenance.js';
import { createPortalStaffHandler } from '../_lib/portalWorkflowHandlers.js';
import { createWorkflowHandler } from '../_lib/workflowHandlers.js';
import { adminAuth, adminDb, adminMessaging } from '../_lib/firebaseAdmin.js';
import { migration } from '../_lib/migration.js';
import { createPushHandler } from '../_lib/pushHandlers.js';
import { createPaymentFollowUpHandler } from '../_lib/paymentFollowUpHandlers.js';
import { createClientSuccessHandlers } from '../_lib/clientSuccessHandlers.js';
import { requestAttachmentStorage } from '../_lib/requestAttachmentStorage.js';
import { parseBody } from '../_lib/http.js';
import { createLeadFollowUpHandlers } from '../_lib/leadFollowUpHandlers.js';

const workflow = createWorkflowHandler({ db: adminDb, auth: adminAuth, requireOwner: migration.requireOwner });
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
  authenticate: migration.authenticate, requireOwner: migration.requireOwner, sendPush, runLeadFollowUps: leads.runDue, runClientFollowUps: async identity => { const result = await clientWork.runDue(identity); if (!identity) await sweepWorkflowHistory(adminDb); return result; },
});

export default (req, res) => {
  const kind = parseBody(req).kind;
  if (kind === 'portal-workflow' && req.method !== 'GET') return createPortalStaffHandler({ db: adminDb, requireOwner: migration.requireOwner, notify: createPortalNotifier({db:adminDb,auth:adminAuth,sendPush}) })(req, res);
  if (kind === 'workflow' && req.method !== 'GET') return workflow(req, res);
  if (kind === 'client-feedback' && req.method !== 'GET') return clientWork.feedback(req, res);
  if (kind === 'client-opportunity' && req.method !== 'GET') return clientWork.opportunities(req, res);
  if (kind === 'client-care' && req.method !== 'GET') return clientWork.care(req, res);
  if (kind === 'client-follow-up' && req.method !== 'GET') return clientWork.followUps(req, res);
  if (kind === 'client-request' && req.method !== 'GET') return clientWork.requests(req, res);
  if (kind === 'lead-follow-up' && req.method !== 'GET') return leads.handle(req, res);
  return req.method === 'GET' || kind === 'payment-follow-up' ? followUps(req, res) : push(req, res);
};
