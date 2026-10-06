import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createPushHandler } from '../api/_lib/pushHandlers.js';

function fixture() {
  const records = new Map([
    ['notifications/n', { userId: 'agent', title: 'New lead', message: 'A lead was assigned', leadId: 'lead-1' }],
    ['push_tokens/device', { userId: 'agent', token: 'agent-token' }],
    ['push_tokens/other', { userId: 'other', token: 'other-token' }],
  ]);
  const ref = (path) => ({ path, id: path.split('/')[1],
    async get() { const data = structuredClone(records.get(path)); return { exists: !!data, data: () => data }; },
    async update(data) { assert(records.has(path)); records.set(path, { ...records.get(path), ...data }); },
    async delete() { records.delete(path); },
  });
  const db = {
    collection(name) { return { doc: (id) => ref(`${name}/${id}`), where(field, operator, value) {
      assert.equal(operator, '==');
      return { async get() { return { docs: [...records].filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value).map(([path, data]) => ({ ref: ref(path), data: () => structuredClone(data) })) }; } };
    } }; },
    async runTransaction(operation) { const writes = []; const result = await operation({ get: (doc) => doc.get(), update: (doc, data) => writes.push([doc, data]) }); for (const [doc, data] of writes) await doc.update(data); return result; },
  };
  const state = { records, messages: [], invalid: false };
  const handler = createPushHandler({ db, getIdentityConfig: () => ({ legacyIds: {} }),
    authenticate: async (req) => { if (!req.headers.authorization) throw Object.assign(new Error('Sign in'), { status: 401 }); return { uid: req.headers.authorization, role: req.headers.authorization === 'owner' ? 'owner' : 'agent' }; },
    requireOwner: async (req) => { if (req.headers.authorization !== 'owner') throw Object.assign(new Error('Denied'), { status: 403 }); },
    messaging: { async sendEachForMulticast(message) { state.messages.push(message); return state.invalid
      ? { successCount: 0, failureCount: 1, responses: [{ success: false, error: { code: 'messaging/registration-token-not-registered' } }] }
      : { successCount: message.tokens.length, failureCount: 0, responses: message.tokens.map(() => ({ success: true })) }; } },
  });
  state.invoke = async (identity = 'owner', body = { notificationId: 'n' }) => {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
    await handler({ method: 'POST', headers: { authorization: identity }, body }, res); return res;
  };
  return state;
}

test('push targets only the saved recipient and uses the saved message, not browser text', async () => {
  const f = fixture();
  assert.equal((await f.invoke('owner', { notificationId: 'n', title: 'Forged title', userId: 'other' })).code, 200);
  assert.deepEqual(f.messages[0].tokens, ['agent-token']);
  assert.equal(f.messages[0].data.title, 'New lead');
  assert.equal(f.messages[0].data.link, '/leads/lead-1');
  assert.equal(f.messages[0].webpush.headers.TTL, '86400');
  assert.equal(f.messages[0].notification, undefined, 'custom service worker displays the data message once');
});
test('another agent and unauthenticated caller cannot dispatch a notification', async () => {
  const f = fixture();
  assert.equal((await f.invoke('other')).code, 403);
  assert.equal((await f.invoke('')).code, 401);
  assert.equal(f.messages.length, 0);
});
test('successful push and an active sending lease are not resent on retry', async () => {
  const f = fixture();
  await f.invoke(); await f.invoke();
  assert.equal(f.messages.length, 1);
  f.records.set('notifications/n', { ...f.records.get('notifications/n'), pushStatus: 'sending', pushStartedAt: Date.now() });
  await f.invoke(); assert.equal(f.messages.length, 1);
});
test('missing registrations retain the bell notification with a diagnostic status', async () => {
  const f = fixture(); f.records.delete('push_tokens/device');
  const result = await f.invoke();
  assert.equal(result.data.status, 'no-devices');
  assert.equal(f.records.get('notifications/n').pushStatus, 'no-devices');
});
test('expired registrations are removed and failed delivery remains diagnosable', async () => {
  const f = fixture(); f.invalid = true;
  const result = await f.invoke();
  assert.equal(result.data.status, 'failed');
  assert(!f.records.has('push_tokens/device')); assert(f.records.has('notifications/n'));
});
test('service worker displays data-only FCM messages with their title, body, and link', async () => {
  const events = new Map(); const displayed = [];
  const source = readFileSync(new URL('../src/sw.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  class Strategy {}
  vm.runInNewContext(source, { clientsClaim() {}, cleanupOutdatedCaches() {}, precacheAndRoute() {}, registerRoute() {},
    NavigationRoute: Strategy, NetworkFirst: Strategy, CacheFirst: Strategy, ExpirationPlugin: Strategy,
    URL, self: { __WB_MANIFEST: [], location: { origin: 'https://crm.example.com' },
      addEventListener: (name, callback) => events.set(name, callback),
      registration: { async showNotification(title, options) { displayed.push({ title, options }); } },
    },
  });
  let pending;
  events.get('push')({ data: { json: () => ({ data: { title: 'New lead', body: 'Assigned to you', link: '/leads/lead-1', notificationId: 'n' } }) }, waitUntil: (promise) => { pending = promise; } });
  await pending;
  assert.equal(displayed.length, 1); assert.equal(displayed[0].title, 'New lead');
  assert.equal(displayed[0].options.body, 'Assigned to you');
  assert.equal(displayed[0].options.tag, 'khulisa-notification-n');
  assert.equal(displayed[0].options.data.link, '/leads/lead-1');
});
