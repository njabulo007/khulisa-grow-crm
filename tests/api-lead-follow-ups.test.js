import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadFollowUpHandlers, leadFollowUpDay } from '../api/_lib/leadFollowUpHandlers.js';
import { createPaymentFollowUpHandler } from '../api/_lib/paymentFollowUpHandlers.js';
function fixture(extra = {}) {
  const records = new Map(Object.entries({
    'users/owner': { role: 'owner' }, 'users/agent': { role: 'agent' }, 'users/other': { role: 'agent' },
    'invoices/i1': { clientId: 'c1', invoiceNumber: 'KM-1', status: 'sent', subtotal: 2000, items: [{ total: 2000 }] },
    'clients/c1': { businessName: 'Client', leadId: 'l1' },
    'projects/p1': { clientId: 'c1', assignedTo: 'legacy-agent', packageId: 'unknown' },
    'leads/l1': { assignedTo: 'legacy-agent', stage: 'contacted', email: 'old invalid email', businessName: 'Test lead', followUpDate: '2026-10-08' },
    'payments/partial': { invoiceId: 'i1', amount: 500 },
    'push_tokens/device': { userId: 'legacy-agent', token: 'device-token' }, ...extra,
  }));
  const state = { records, messages: [], clock: Date.parse('2026-10-08T07:00:00Z'), secret: 'private-cron-secret', deliveryFails: false };
  const snapshot = ref => ({ ref, id: ref.id, exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path)) });
  const ref = path => ({ path, id: path.split('/')[1], get: async () => snapshot(ref(path)),
    update: async patch => { assert(records.has(path)); records.set(path, { ...records.get(path), ...patch }); },
    delete: async () => records.delete(path),
  });
  const query = (name, clauses = []) => ({ where: (field, op, value) => query(name, [...clauses, [field, op, value]]), get: async () => ({ docs: [...records].filter(([path, data]) => path.startsWith(name + '/') && clauses.every(([field, op, value]) => op === '==' ? data[field] === value : op === '>=' ? data[field] >= value : data[field] <= value)).map(([path]) => snapshot(ref(path))) }) });
  const db = { collection: name => ({ ...query(name), doc: id => ref(name + '/' + id) }) };
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

  const config = () => ({ legacyIds: { agent: 'legacy-agent' } });
  const authenticate = async req => {
    const uid = req.headers.authorization;
    if (!['owner', 'agent', 'other'].includes(uid)) throw Object.assign(new Error('Sign in'), { status: 401 });
    return { uid, appUserId: uid === 'agent' ? 'legacy-agent' : uid, role: uid === 'owner' ? 'owner' : 'agent' };
  };
  const requireOwner = async () => {};
  const auth = { getUser: async uid => {
    if (!records.has('users/' + uid)) throw Object.assign(new Error('Not found'), { code: 'auth/user-not-found' });
    return { disabled: state.disabled, customClaims: {} };
  } };
  const handlers = createLeadFollowUpHandlers({ db, auth, authenticate, requireOwner, getIdentityConfig: config, now: () => state.clock,
    sendPush: async (id, userId) => { if (state.deliveryFails) throw new Error('Push failed'); state.messages.push({ id, userId }); },
  });
  state.invoke = async (body, token = 'agent') => {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
    await handlers.handle({ method: 'POST', headers: { authorization: token }, body: { leadId: 'l1', ...body } }, res); return res;
  };
  state.complete = (requestId, nextFollowUpDate = '') => state.invoke({ action: 'complete', requestId, nextFollowUpDate, description: '**Called** client\n\nNext steps', type: 'call' });
  state.runDue = handlers.runDue;
  state.paymentHandler = createPaymentFollowUpHandler({ db, auth, authenticate, requireOwner, now: () => state.clock, cronSecret: () => 'secret', runLeadFollowUps: handlers.runDue, sendPush: async () => {} });
  return state;
}

test('unlimited follow-ups atomically retain formatted history, replace dates and stop when no next date', async () => {
  const f = fixture();
  for (let i = 1; i <= 4; i++) {
    assert.equal((await f.complete('request-' + i, i === 4 ? '' : '2026-10-09')).code, 200);
    assert.equal(f.records.get('leads/l1').followUpCount, i);
  }
  const lead = f.records.get('leads/l1');
  assert.equal(lead.followUpDate, ''); assert.equal(lead.email, 'old invalid email');
  const activities = [...f.records].filter(([path]) => path.startsWith('activities/'));
  assert.equal(activities.length, 4);
  assert.equal(activities[3][1].metadata.followUpNumber, 4);
  assert.equal(activities[3][1].metadata.nextFollowUpDate, null);
  assert.equal(activities[0][1].description, '**Called** client\n\nNext steps');
  assert.deepEqual(await f.runDue(), { notified: 0, stopped: 0, failed: 0 });
});

test('concurrent retries complete once, while a new request completes a new follow-up', async () => {
  const f = fixture(); await Promise.all([f.complete('same'), f.complete('same')]);
  assert.equal(f.records.get('leads/l1').followUpCount, 1);
  await f.complete('new'); assert.equal(f.records.get('leads/l1').followUpCount, 2);
});

test('only owner and assigned agent may save or complete; bad dates and missing notes leave data untouched', async () => {
  const f = fixture();
  assert.equal((await f.invoke({ action: 'save', followUpDate: '2026-10-09' }, 'other')).code, 403);
  assert.equal((await f.invoke({ action: 'save', followUpDate: '2026-02-30' })).code, 400);
  assert.equal((await f.invoke({ action: 'complete', requestId: 'x', type: 'call', description: '', nextFollowUpDate: '' })).code, 400);
  assert.equal(f.records.get('leads/l1').followUpDate, '2026-10-08');
  assert.equal((await f.invoke({ action: 'save', followUpDate: '2026-10-10' }, 'owner')).code, 200);
});

test('due reminders target verified assignee, deduplicate bell items daily and repeat on the next day', async () => {
  const f = fixture();
  assert.equal((await f.runDue()).notified, 1); assert.equal(f.messages[0].userId, 'legacy-agent');
  assert.equal((await f.runDue()).notified, 0);
  assert.equal([...f.records.keys()].filter(key => key.startsWith('notifications/')).length, 1);
  // The push dispatcher independently leases delivery; calls here may retry the same ID safely.
  assert.equal(f.messages[0].id, f.messages[1].id);
  f.clock += 86400000; assert.equal((await f.runDue()).notified, 1);
});

test('future, closed, deleting, unassigned and disabled leads do not send reminders', async () => {
  for (const patch of [{ followUpDate: '2026-10-09' }, { stage: 'won' }, { stage: 'lost' }, { _deleting: true }, { assignedTo: 'missing' }]) {
    const f = fixture({ 'leads/l1': { assignedTo: 'legacy-agent', stage: 'new', followUpDate: '2026-10-08', ...patch } });
    assert.equal((await f.runDue()).notified, 0);
  }
  const f = fixture(); f.disabled = true; assert.equal((await f.runDue()).notified, 0);
});

test('foreground checks cannot send another agent reminders and clearing date stops reminders', async () => {
  const f = fixture(); assert.equal((await f.runDue({ uid: 'other' })).notified, 0);
  await f.invoke({ action: 'save', followUpDate: '' }); assert.equal((await f.runDue()).notified, 0);
});

test('same-day next follow-up produces a new reminder without reusing previous cycle', async () => {
  const f = fixture(); await f.runDue(); const first = f.messages[0].id;
  await f.complete('new-cycle', '2026-10-08'); await f.runDue(); assert.notEqual(f.messages.at(-1).id, first);
});

test('won/lost leads reject acquisition follow-ups but allow clearing an old date', async () => {
  const f = fixture({ 'leads/l1': { assignedTo: 'legacy-agent', stage: 'won', followUpDate: '2026-10-08' } });
  assert.equal((await f.complete('x')).code, 409);
  assert.equal((await f.invoke({ action: 'save', followUpDate: '2026-10-09' })).code, 409);
  assert.equal((await f.invoke({ action: 'save', followUpDate: '' })).code, 200);
});

test('South African date boundary and legacy ISO follow-up dates are supported', async () => {
  const f = fixture({ 'leads/l1': { assignedTo: 'legacy-agent', stage: 'new', followUpDate: '2026-10-09T00:00:00.000Z' } });
  f.clock = Date.parse('2026-10-08T22:05:00Z'); assert.equal((await f.runDue()).notified, 1);
  assert.equal(leadFollowUpDay('2026-02-30'), null);
});

test('existing protected cron dispatches lead reminders and reports delivery failures', async () => {
  const f = fixture();
  const invoke = async token => { const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; } }; await f.paymentHandler({ method: 'GET', headers: { authorization: token } }, res); return res; };
  assert.equal((await invoke('Bearer wrong')).code, 401);
  const result = await invoke('Bearer secret'); assert.equal(result.code, 200); assert.equal(result.data.leads.notified, 1);
  f.clock += 86400000; f.deliveryFails = true; assert.equal((await invoke('Bearer secret')).code, 503);
});

test('browser-writable profile aliases alone cannot receive another assigned lead reminder', async () => {
  const f = fixture({ 'leads/l1': { assignedTo: 'forged-alias', stage: 'new', followUpDate: '2026-10-08' }, 'users/other': { appUserId: 'forged-alias', uid: 'other' } });
  assert.equal((await f.runDue()).notified, 0);
  assert.equal(f.messages.length, 0);
});

test('reassignment revokes the previous agent completion permission and moves future reminders', async () => {
  const f = fixture();
  f.records.get('leads/l1').assignedTo = 'other';
  assert.equal((await f.complete('old-agent')).code, 403);
  assert.equal((await f.runDue({ uid: 'agent', appUserId: 'legacy-agent' })).notified, 0);
  assert.equal((await f.runDue()).notified, 1);
  assert.equal(f.messages[0].userId, 'other');
});
