import assert from 'node:assert/strict';
import test from 'node:test';
import { createPaymentFollowUpHandler, paymentFollowUpDay } from '../api/_lib/paymentFollowUpHandlers.js';
import { createPushHandler } from '../api/_lib/pushHandlers.js';

function fixture(extra = {}) {
  const records = new Map(Object.entries({
    'users/owner': { role: 'owner' }, 'users/agent': { role: 'agent' }, 'users/other': { role: 'agent' },
    'invoices/i1': { clientId: 'c1', invoiceNumber: 'KM-1', status: 'sent', subtotal: 2000, items: [{ total: 2000 }] },
    'clients/c1': { businessName: 'Client', leadId: 'l1' },
    'projects/p1': { clientId: 'c1', assignedTo: 'legacy-agent', packageId: 'unknown' },
    'leads/l1': { assignedTo: 'legacy-agent' },
    'payments/partial': { invoiceId: 'i1', amount: 500 },
    'push_tokens/device': { userId: 'legacy-agent', token: 'device-token' }, ...extra,
  }));
  const state = { records, messages: [], clock: Date.parse('2026-10-08T07:00:00Z'), secret: 'private-cron-secret', deliveryFails: false };
  const snapshot = ref => ({ ref, id: ref.id, exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path)) });
  const ref = path => ({ path, id: path.split('/')[1], get: async () => snapshot(ref(path)),
    update: async patch => { assert(records.has(path)); records.set(path, { ...records.get(path), ...patch }); },
    delete: async () => records.delete(path),
  });
  const query = (name, field, value) => ({ kind: 'query', get: async () => ({ docs: [...records].filter(([path, data]) => path.startsWith(name + '/') && data[field] === value).map(([path]) => snapshot(ref(path))) }) });
  const db = { collection: name => ({ doc: id => ref(name + '/' + id), where: (field, op, value) => { assert.equal(op, '=='); return query(name, field, value); } }) };
  let queue = Promise.resolve();
  db.runTransaction = operation => {
    const pending = queue.then(async () => {
      const writes = [];
      const result = await operation({
        get: async reference => { assert.equal(writes.length, 0, 'All reads precede writes'); return reference.get(); },
        set: (reference, data) => writes.push([reference, data, false]),
        update: (reference, data) => writes.push([reference, data, true]),
      });
      for (const [reference, data, merge] of writes) records.set(reference.path, merge ? { ...records.get(reference.path), ...data } : data);
      return result;
    });
    queue = pending.catch(() => {});
    return pending;
  };
  const config = () => ({ owners: new Set(), legacyIds: {} });
  const authenticate = async req => {
    const uid = req.headers.authorization;
    if (!['agent', 'owner', 'other'].includes(uid)) throw Object.assign(new Error('Sign in'), { status: 401 });
    return { uid, role: uid === 'owner' ? 'owner' : 'agent', appUserId: uid === 'agent' ? 'legacy-agent' : uid };
  };
  const requireOwner = async req => { if (req.headers.authorization !== 'owner') throw Object.assign(new Error('Denied'), { status: 403 }); };
  const messaging = { sendEachForMulticast: async payload => {
    if (state.deliveryFails) throw new Error('Unavailable');
    state.messages.push(payload);
    return { successCount: payload.tokens.length, failureCount: 0, responses: payload.tokens.map(() => ({ success: true })) };
  } };
  const auth = { getUser: async uid => {
    if (!records.has('users/' + uid)) throw Object.assign(new Error('Missing user'), { code: 'auth/user-not-found' });
    return { disabled: state.disabled, customClaims: { appUserId: uid === 'agent' ? 'legacy-agent' : uid } };
  } };
  const handler = createPaymentFollowUpHandler({ db, auth, authenticate, requireOwner, getIdentityConfig: config,
    now: () => state.clock, cronSecret: () => state.secret,
    sendPush: async (notificationId, userId) => {
      const push = createPushHandler({ db, messaging, now: () => state.clock, getIdentityConfig: config,
        authenticate: async () => ({ uid: userId, role: 'agent' }), requireOwner });
      const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
      await push({ method: 'POST', body: { notificationId } }, res);
      if (res.code !== 200 || res.data.status === 'failed') throw new Error('Push failed');
    },
  });
  state.invoke = async (body, token = 'agent', method = 'POST') => {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
    await handler({ method, headers: { authorization: token }, body }, res); return res;
  };
  state.save = (date = '2026-10-08', token = 'agent') => state.invoke({ action: 'save', invoiceId: 'i1', followUpDate: date, notes: '**Call** client' }, token);
  return state;
}

test('assigned agent schedules own reminder without changing any financial records', async () => {
  const f = fixture(); const invoice = structuredClone(f.records.get('invoices/i1'));
  const result = await f.save(); assert.equal(result.code, 200);
  assert.equal(result.data.followUp.userUid, 'agent');
  assert.deepEqual(f.records.get('invoices/i1'), invoice);
  const list = await f.invoke({ action: 'list' });
  assert.equal(list.data.followUps[0].balance, 1500);
  assert.equal(list.data.followUps[0].notes, '**Call** client');
});

test('unassigned users, invalid dates, malformed notes and unauthorized cron calls cannot schedule or dispatch', async () => {
  const f = fixture();
  assert.equal((await f.save('2026-10-08', 'other')).code, 403);
  assert.equal((await f.save('2026-02-30')).code, 400);
  assert.equal((await f.invoke({ action: 'save', invoiceId: 'bad/path', followUpDate: '2026-10-08', notes: '' })).code, 400);
  assert.equal((await f.invoke({ action: 'save', invoiceId: 'i1', followUpDate: '2026-10-08', notes: 'x'.repeat(4001) })).code, 400);
  assert.equal((await f.invoke({}, '', 'GET')).code, 401);
  assert.equal((await f.invoke({}, 'Bearer incorrect', 'GET')).code, 401);
  assert.equal((await f.invoke({ action: 'check' }, '')).code, 401);
  assert.equal(f.messages.length, 0);
  assert(![...f.records.keys()].some(key => key.startsWith('payment_follow_ups/')));
});

test('daily cron and foreground checks deliver one bell item and one push per day, then repeat next day', async () => {
  const f = fixture(); await f.save();
  assert.equal((await f.invoke({}, 'Bearer private-cron-secret', 'GET')).data.notified, 1);
  await f.invoke({ action: 'check' });
  assert.equal(f.messages.length, 1);
  assert.deepEqual(f.messages[0].tokens, ['device-token']);
  assert.equal(f.messages[0].data.link, '/invoices/i1');
  assert(f.messages[0].data.body.includes('1500.00 outstanding'));
  f.clock += 86400000;
  await f.invoke({}, 'Bearer private-cron-secret', 'GET');
  assert.equal(f.messages.length, 2);
  assert.equal([...f.records.keys()].filter(key => key.startsWith('notifications/')).length, 2);
});

test('future reminders wait, then stop automatically after the unpaid balance is settled', async () => {
  const f = fixture(); await f.save('2026-10-09'); await f.invoke({ action: 'check' });
  assert.equal(f.messages.length, 0);
  f.clock += 86400000; f.records.set('payments/final', { invoiceId: 'i1', amount: 1500 });
  assert.equal((await f.invoke({}, 'Bearer private-cron-secret', 'GET')).data.stopped, 1);
  assert.equal(f.messages.length, 0);
  assert.equal((await f.invoke({ action: 'list' })).data.followUps.length, 0);
  assert.equal((await f.save()).code, 409);
});

test('draft and paid invoices cannot receive schedules', async () => {
  for (const status of ['draft', 'paid', 'cancelled']) {
    const f = fixture(); f.records.get('invoices/i1').status = status;
    assert.equal((await f.save()).code, 409);
  }
});

test('rescheduling and stopping are personal; reassignment revokes reminder access', async () => {
  const f = fixture(); await f.save(); await f.save('2026-10-15');
  assert.equal((await f.invoke({ action: 'list' }, 'other')).data.followUps.length, 0);
  assert.equal((await f.invoke({ action: 'cancel', invoiceId: 'i1' }, 'other')).code, 403);
  await f.invoke({ action: 'check' }); assert.equal(f.messages.length, 0);
  await f.save();
  f.records.get('projects/p1').assignedTo = 'other'; f.records.get('leads/l1').assignedTo = 'other';
  assert.equal((await f.invoke({ action: 'list' })).data.followUps.length, 0);
  assert.equal((await f.invoke({}, 'Bearer private-cron-secret', 'GET')).data.stopped, 1);
  assert.equal(f.messages.length, 0);
});

test('owners and agents have independent schedules and cannot impersonate the reminder recipient', async () => {
  const f = fixture(); const owner = await f.save('2026-10-08', 'owner'); const agent = await f.save();
  assert.notEqual(owner.data.followUp.id, agent.data.followUp.id);
  await f.invoke({ action: 'cancel', invoiceId: 'i1', userUid: 'owner' });
  assert.equal((await f.invoke({ action: 'list' }, 'owner')).data.followUps.length, 1);
  assert.equal((await f.invoke({ action: 'list' }, 'agent')).data.followUps.length, 0);
});

test('a failed push keeps the saved reminder and retries without duplicating its bell item', async () => {
  const f = fixture(); await f.save(); f.deliveryFails = true;
  assert.equal((await f.invoke({ action: 'check' })).data.failed, 1);
  f.deliveryFails = false; await f.invoke({ action: 'check' });
  assert.equal(f.messages.length, 1);
  assert.equal([...f.records.keys()].filter(key => key.startsWith('notifications/')).length, 1);
});

test('missing scheduler configuration is explicit and South African calendar boundaries are correct', async () => {
  const f = fixture(); f.secret = '';
  assert.equal((await f.invoke({}, '', 'GET')).code, 503);
  assert.equal((await f.invoke({ action: 'list' })).data.backgroundConfigured, false);
  assert.equal(paymentFollowUpDay(Date.parse('2026-10-08T22:01:00Z')), '2026-10-09');
});

test('disabled or deleted accounts and removed invoices are stopped without dispatch', async () => {
  for (const change of [f => { f.disabled = true; }, f => { f.records.delete('users/agent'); }, f => { f.records.delete('invoices/i1'); }]) {
    const f = fixture(); await f.save(); change(f);
    const result = await f.invoke({}, 'Bearer private-cron-secret', 'GET');
    assert.equal(result.data.stopped, 1); assert.equal(f.messages.length, 0);
  }
});

test('daily notification remains saved when a receiving device is not registered', async () => {
  const f = fixture(); await f.save(); f.records.delete('push_tokens/device');
  await f.invoke({}, 'Bearer private-cron-secret', 'GET');
  const notifications = [...f.records].filter(([key]) => key.startsWith('notifications/'));
  assert.equal(notifications.length, 1); assert.equal(notifications[0][1].pushStatus, 'no-devices');
});

test('the cron exposes delivery failures and concurrent checks do not double-send', async () => {
  const failing = fixture(); await failing.save(); failing.deliveryFails = true;
  assert.equal((await failing.invoke({}, 'Bearer private-cron-secret', 'GET')).code, 503);
  const f = fixture(); await f.save();
  await Promise.all([f.invoke({ action: 'check' }), f.invoke({}, 'Bearer private-cron-secret', 'GET')]);
  assert.equal(f.messages.length, 1);
});

test('legacy project packages use the same remaining balance as the invoice screen', async () => {
  const f = fixture(); f.records.get('invoices/i1').projectId = 'p1';
  f.records.set('projects/p1', { clientId: 'c1', assignedTo: 'legacy-agent', packageType: 'SEO Package' });
  await f.save();
  assert.equal((await f.invoke({ action: 'list' })).data.followUps[0].balance, 3000);
});
