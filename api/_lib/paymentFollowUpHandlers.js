import crypto from 'node:crypto';
import { createHttpError, json, methodNotAllowed, parseBody } from './http.js';
import { readIdentityConfig } from './migrationHandlers.js';
import { PACKAGE_CATALOG, resolveServerPackageId } from './packages.js';

const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export const paymentFollowUpDay = time => new Date(time + 2 * 3600000).toISOString().slice(0, 10);
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const positive = value => Math.max(Number.isFinite(Number(value)) ? Number(value) : 0, 0);
const money = value => Math.round((positive(value) + Number.EPSILON) * 100) / 100;

export function createPaymentFollowUpHandler({ db, auth, authenticate, requireOwner, sendPush,
  now = () => Date.now(), getIdentityConfig = readIdentityConfig, cronSecret = () => process.env.CRON_SECRET,
  runLeadFollowUps = async () => ({ notified: 0, stopped: 0, failed: 0 }) }) {
  const refFor = (invoiceId, uid) => db.collection('payment_follow_ups').doc(digest(`${invoiceId}:${uid}`));
  const configuredAlias = uid => Object.hasOwn(getIdentityConfig().legacyIds, uid) ? getIdentityConfig().legacyIds[uid] : undefined;

  const currentIdentity = async uid => {
    const user = await auth.getUser(uid);
    if (user.disabled) throw createHttpError(403, 'This account is disabled.');
    const config = getIdentityConfig();
    const profile = await db.collection('users').doc(uid).get();
    return { uid, role: config.owners.has(uid) || profile.data()?.role === 'owner' ? 'owner' : 'agent',
      appUserId: configuredAlias(uid) || (validId(user.customClaims?.appUserId) ? user.customClaims.appUserId : uid) };
  };

  // All authorization and balance reads can run inside the transaction, so an
  // assignment change or payment cannot race with notification creation.
  const invoiceContext = async (identity, invoiceId, read = ref => ref.get()) => {
    const snapshot = await read(db.collection('invoices').doc(invoiceId));
    if (!snapshot.exists || snapshot.data()._deleting) throw createHttpError(404, 'Invoice unavailable.');
    const invoice = snapshot.data();
    const client = validId(invoice.clientId) ? await read(db.collection('clients').doc(invoice.clientId)) : null;
    if (client?.data()?._deleting) throw createHttpError(409, 'The client is being deleted.');
    const project = validId(invoice.projectId) ? await read(db.collection('projects').doc(invoice.projectId)) : null;
    if (identity.role !== 'owner') {
      const keys = new Set([identity.uid, identity.appUserId, configuredAlias(identity.uid)].filter(validId));
      let accessible = project?.exists && !project.data()._deleting && keys.has(project.data().assignedTo);
      if (!accessible && validId(client?.data()?.leadId)) {
        const lead = await read(db.collection('leads').doc(client.data().leadId));
        accessible = lead.exists && !lead.data()._deleting && keys.has(lead.data().assignedTo);
      }
      if (!accessible && client?.exists) {
        const projects = await read(db.collection('projects').where('clientId', '==', invoice.clientId));
        accessible = projects.docs.some(item => !item.data()._deleting && keys.has(item.data().assignedTo));
      }
      if (!accessible) throw createHttpError(403, 'You do not have access to this invoice.');
    }
    const payments = await read(db.collection('payments').where('invoiceId', '==', invoiceId));
    const paid = payments.docs.reduce((sum, item) => sum + positive(item.data().amount), 0);
    const packagePrice = project?.exists ? PACKAGE_CATALOG[resolveServerPackageId(project.data().packageId ?? project.data().packageType)].price : undefined;
    const items = Array.isArray(invoice.items) ? invoice.items.reduce((sum, item) => sum + positive(item.total), 0) : 0;
    const total = packagePrice ?? (items > 0 ? items : money(invoice.subtotal ?? invoice.total));
    const balance = money(total - paid);
    const payable = balance > 0 && !['draft', 'paid', 'cancelled'].includes(invoice.status);
    return { invoice, balance, payable, clientName: client?.data()?.businessName || 'Client' };
  };

  const runDue = async identity => {
    const day = paymentFollowUpDay(now());
    const query = identity
      ? db.collection('payment_follow_ups').where('userUid', '==', identity.uid)
      : db.collection('payment_follow_ups').where('status', '==', 'scheduled');
    const records = await query.get();
    let notified = 0;
    let stopped = 0;
    let failed = 0;
    for (const snapshot of records.docs) {
      const original = snapshot.data();
      if (original.status !== 'scheduled' || !validDay(original.followUpDate) || original.followUpDate > day) continue;
      try {
        let actor;
        try { actor = await currentIdentity(original.userUid); } catch (error) {
          if (error.status === 403 || error.code === 'auth/user-not-found') {
            await snapshot.ref.update({ status: 'done', updatedAt: new Date(now()).toISOString() }); stopped++; continue;
          }
          throw error;
        }
        const notificationRef = db.collection('notifications').doc(`payment_${digest(`${snapshot.id}:${day}`)}`);
        const result = await db.runTransaction(async transaction => {
          const record = await transaction.get(snapshot.ref);
          if (!record.exists || record.data().status !== 'scheduled' || record.data().followUpDate > day) return null;
          let context;
          try { context = await invoiceContext(actor, record.data().invoiceId, ref => transaction.get(ref)); } catch (error) {
            if (![403, 404, 409].includes(error.status)) throw error;
          }
          if (!context?.payable) {
            transaction.update(snapshot.ref, { status: 'done', updatedAt: new Date(now()).toISOString() });
            return { stopped: true };
          }
          const notification = await transaction.get(notificationRef);
          if (!notification.exists) transaction.set(notificationRef, {
            userId: actor.appUserId || actor.uid, type: 'payment_follow_up', invoiceId: record.data().invoiceId,
            clientId: context.invoice.clientId || null, projectId: context.invoice.projectId || null,
            title: 'Payment follow-up due',
            message: `${context.clientName}: follow up on ${context.invoice.invoiceNumber || 'invoice'} — R ${context.balance.toFixed(2)} outstanding. Follow-up date: ${record.data().followUpDate}.`,
            isRead: false, createdAt: new Date(now()).toISOString(), pushManagedBy: 'vercel',
          });
          if (record.data().lastNotifiedDay !== day) transaction.update(snapshot.ref, { lastNotifiedDay: day });
          return { notificationId: notificationRef.id, userId: actor.appUserId || actor.uid, created: !notification.exists };
        });
        if (!result) continue;
        if (result.stopped) { stopped++; continue; }
        await sendPush(result.notificationId, result.userId);
        if (result.created) notified++;
      } catch (error) {
        failed++;
        console.error('[Payment follow-up]', { code: error.code || error.status || 'unknown' });
      }
    }
    return { notified, stopped, failed };
  };

  const checkAll = async identity => {
    const payments = await runDue(identity);
    let leads;
    try { leads = await runLeadFollowUps(identity); } catch (error) {
      console.error('[Lead reminder check]', { code: error.code || 'unknown' });
      leads = { notified: 0, stopped: 0, failed: 1 };
    }
    return { notified: payments.notified + leads.notified, stopped: payments.stopped + leads.stopped,
      failed: payments.failed + leads.failed, payments, leads };
  };

  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method === 'GET') {
        const secret = cronSecret();
        if (!secret) throw createHttpError(503, 'Background reminders need CRON_SECRET in Vercel.');
        if (req.headers?.authorization !== `Bearer ${secret}`) throw createHttpError(401, 'Unauthorized scheduler request.');
        const result = await checkAll();
        return json(res, result.failed ? 503 : 200, result);
      }
      if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST']);
      const identity = await authenticate(req);
      if (identity.role === 'owner') await requireOwner(req);
      const payload = parseBody(req);
      if (payload.action === 'check') return json(res, 200, await checkAll(identity));
      if (!['list', 'save', 'cancel'].includes(payload.action)) throw createHttpError(400, 'Invalid payment follow-up action.');
      if (payload.action === 'list') {
        if (payload.invoiceId !== undefined && !validId(payload.invoiceId)) throw createHttpError(400, 'Invalid invoice ID.');
        const records = await db.collection('payment_follow_ups').where('userUid', '==', identity.uid).get();
        const followUps = [];
        for (const snapshot of records.docs) {
          const record = snapshot.data();
          if (record.status !== 'scheduled' || (payload.invoiceId && record.invoiceId !== payload.invoiceId)) continue;
          try {
            const context = await invoiceContext(identity, record.invoiceId);
            if (context.payable) followUps.push({ ...record, id: snapshot.id, balance: context.balance,
              invoiceNumber: context.invoice.invoiceNumber, clientName: context.clientName });
          } catch (error) { if (![403, 404, 409].includes(error.status)) throw error; }
        }
        return json(res, 200, { followUps: followUps.sort((a, b) => a.followUpDate.localeCompare(b.followUpDate)), backgroundConfigured: Boolean(cronSecret()) });
      }
      if (!validId(payload.invoiceId)) throw createHttpError(400, 'Invalid invoice ID.');
      if (payload.action === 'save' && (!validDay(payload.followUpDate) || typeof payload.notes !== 'string' || payload.notes.length > 4000)) {
        throw createHttpError(400, 'Choose a valid follow-up date and notes up to 4,000 characters.');
      }
      const ref = refFor(payload.invoiceId, identity.uid);
      const record = await db.runTransaction(async transaction => {
        const existing = await transaction.get(ref);
        const context = await invoiceContext(identity, payload.invoiceId, item => transaction.get(item));
        if (payload.action === 'cancel') {
          if (existing.exists) transaction.update(ref, { status: 'done', updatedAt: new Date(now()).toISOString() });
          return null;
        }
        if (!context.payable) throw createHttpError(409, 'Payment follow-ups are available only for issued invoices with an unpaid balance.');
        const record = { invoiceId: payload.invoiceId, clientId: context.invoice.clientId, userUid: identity.uid,
          followUpDate: payload.followUpDate, notes: payload.notes.trim(), status: 'scheduled',
          createdAt: existing.data()?.createdAt || new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString() };
        transaction.set(ref, record);
        return { ...record, id: ref.id };
      });
      return json(res, 200, { followUp: record });
    } catch (error) {
      if (!error.status) console.error('[Payment follow-up API]', { code: error.code || 'unknown' });
      return json(res, error.status || 500, { error: error.status ? error.message : 'Payment follow-ups could not be processed. Please retry.' });
    }
  };
}
