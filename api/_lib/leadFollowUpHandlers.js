import crypto from 'node:crypto';
import { createHttpError, json, methodNotAllowed, parseBody } from './http.js';
import { readIdentityConfig } from './migrationHandlers.js';
import { paymentFollowUpDay } from './paymentFollowUpHandlers.js';

const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export const leadFollowUpDay = value => {
  if (typeof value !== 'string') return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day ? day : null;
};
const active = lead => !lead._deleting && !['won', 'lost'].includes(lead.stage);

export function createLeadFollowUpHandlers({ db, auth, authenticate, requireOwner, sendPush, now = () => Date.now(), getIdentityConfig = readIdentityConfig }) {
  const aliasFor = uid => Object.hasOwn(getIdentityConfig().legacyIds, uid) ? getIdentityConfig().legacyIds[uid] : undefined;
  const keysFor = identity => [...new Set([identity.uid, identity.appUserId, aliasFor(identity.uid)].filter(validId))];
  const canManage = (identity, lead) => identity.role === 'owner' || keysFor(identity).includes(lead.assignedTo);
  const identityForUid = async uid => {
    const user = await auth.getUser(uid);
    if (user.disabled) return null;
    const appUserId = aliasFor(uid) || (validId(user.customClaims?.appUserId) ? user.customClaims.appUserId : uid);
    return { uid, appUserId };
  };
  const resolveAssignee = async assignedTo => {
    if (!validId(assignedTo)) return null;
    const candidates = new Set(Object.entries(getIdentityConfig().legacyIds).filter(([, alias]) => alias === assignedTo).map(([uid]) => uid));
    candidates.add(assignedTo);
    const resolve = async () => {
      for (const uid of candidates) {
        try {
          const identity = await identityForUid(uid);
          if (identity && keysFor(identity).includes(assignedTo)) return identity;
        } catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
      }
      return null;
    };
    let result = await resolve();
    if (result) return result;
    // Profile aliases are discovery hints only. Verify their UID and alias
    // against Auth's signed claims/server configuration before authorizing.
    const profiles = await db.collection('users').where('appUserId', '==', assignedTo).get();
    for (const profile of profiles.docs) {
      if (validId(profile.id)) candidates.add(profile.id);
      if (validId(profile.data().uid)) candidates.add(profile.data().uid);
    }
    result = await resolve();
    return result;
  };

  const runDue = async identity => {
    const day = paymentFollowUpDay(now());
    const docs = new Map();
    if (identity) {
      for (const key of keysFor(identity)) {
        const results = await db.collection('leads').where('assignedTo', '==', key).get();
        for (const snapshot of results.docs) docs.set(snapshot.id, snapshot);
      }
    } else {
      const results = await db.collection('leads').where('followUpDate', '>=', '0000-01-01').where('followUpDate', '<=', `${day}T23:59:59.999Z`).get();
      for (const snapshot of results.docs) docs.set(snapshot.id, snapshot);
    }
    let notified = 0;
    let stopped = 0;
    let failed = 0;
    const assignees = new Map();
    for (const snapshot of docs.values()) {
      const original = snapshot.data();
      const date = leadFollowUpDay(original.followUpDate);
      if (!active(original) || !date || date > day) continue;
      try {
        if (!assignees.has(original.assignedTo)) assignees.set(original.assignedTo, await resolveAssignee(original.assignedTo));
        const actor = assignees.get(original.assignedTo);
        if (!actor || (identity && actor.uid !== identity.uid)) continue;
        const notification = await db.runTransaction(async transaction => {
          const current = await transaction.get(snapshot.ref);
          if (!current.exists) return null;
          const lead = current.data();
          const date = leadFollowUpDay(lead.followUpDate);
          if (!active(lead) || !date || date > day || !keysFor(actor).includes(lead.assignedTo)) return null;
          const revision = typeof lead.followUpRevision === 'string' ? lead.followUpRevision : '';
          const ref = db.collection('notifications').doc(`lead_follow_up_${digest(`${snapshot.id}:${actor.uid}:${date}:${revision}:${day}`)}`);
          const existing = await transaction.get(ref);
          if (!existing.exists) transaction.set(ref, {
            userId: actor.appUserId, type: 'lead_follow_up', leadId: snapshot.id,
            title: date < day ? 'Lead follow-up overdue' : 'Lead follow-up due',
            message: `${lead.businessName || 'Lead'}: follow-up ${Math.max(Number(lead.followUpCount) || 0, 0) + 1} is due ${date}. Record the outcome and schedule another only if needed. Reminder date: ${day}.`,
            createdAt: new Date(now()).toISOString(), isRead: false, pushManagedBy: 'vercel',
          });
          return { id: ref.id, created: !existing.exists };
        });
        if (!notification) { stopped++; continue; }
        await sendPush(notification.id, actor.appUserId);
        if (notification.created) notified++;
      } catch (error) { failed++; console.error('[Lead follow-up]', { code: error.code || error.status || 'unknown' }); }
    }
    return { notified, stopped, failed };
  };

  const handle = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const identity = await authenticate(req);
      if (identity.role === 'owner') await requireOwner(req);
      const payload = parseBody(req);
      if (!validId(payload.leadId) || !['save', 'complete'].includes(payload.action)) throw createHttpError(400, 'A valid lead and follow-up action are required.');
      const date = payload.action === 'complete' ? payload.nextFollowUpDate : payload.followUpDate;
      if (date !== '' && (leadFollowUpDay(date) !== date)) throw createHttpError(400, 'Choose a valid follow-up date, or leave it empty.');
      if (payload.action === 'complete' && (!validId(payload.requestId) || !['note', 'call', 'email', 'whatsapp', 'meeting'].includes(payload.type)
        || typeof payload.description !== 'string' || !payload.description.trim() || payload.description.length > 10000)) {
        throw createHttpError(400, 'Record the follow-up outcome in notes up to 10,000 characters.');
      }
      const leadRef = db.collection('leads').doc(payload.leadId);
      const activityRef = payload.action === 'complete' ? db.collection('activities').doc(`lead_follow_up_${digest(`${payload.leadId}:${identity.uid}:${payload.requestId}`)}`) : null;
      const result = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(leadRef);
        if (!snapshot.exists || snapshot.data()._deleting) throw createHttpError(404, 'Lead unavailable.');
        const lead = snapshot.data();
        if (!canManage(identity, lead)) throw createHttpError(403, 'You do not have access to this lead.');
        const previous = activityRef ? await transaction.get(activityRef) : null;
        if (previous?.exists) return { leadId: leadRef.id, alreadyCompleted: true };
        if (!active(lead) && (date || payload.action === 'complete')) throw createHttpError(409, 'Won or lost leads do not need acquisition follow-up reminders.');
        const updatedAt = new Date(now()).toISOString();
        if (payload.action === 'save' && (lead.followUpDate || '') === date) return { leadId: leadRef.id };
        const followUpCount = Math.max(Number.isSafeInteger(lead.followUpCount) ? lead.followUpCount : 0, 0) + (activityRef ? 1 : 0);
        if (activityRef) transaction.set(activityRef, {
          type: payload.type, entityType: 'lead', entityId: leadRef.id, description: payload.description.trim(),
          createdBy: identity.appUserId || identity.uid, createdAt: updatedAt,
          metadata: { followUpCompleted: true, followUpNumber: followUpCount, previousFollowUpDate: lead.followUpDate || null, nextFollowUpDate: date || null },
        });
        transaction.update(leadRef, { followUpDate: date, followUpRevision: crypto.randomUUID(), followUpCount, updatedAt });
        return { leadId: leadRef.id, followUpCount, nextFollowUpDate: date || null };
      });
      return json(res, 200, result);
    } catch (error) {
      if (!error.status) console.error('[Lead follow-up API]', { code: error.code || 'unknown' });
      return json(res, error.status || 500, { error: error.status ? error.message : 'Lead follow-up could not be saved. Please retry.' });
    }
  };
  return { handle, runDue };
}
