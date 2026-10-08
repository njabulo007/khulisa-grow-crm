import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

function legacyFixture(profile, customClaims = {}) {
  const records = new Map(profile ? [['users/person', profile]] : []);
  const claims = [];
  const authUser = { uid: 'person', email: 'njabulod007@gmail.com', customClaims };
  const query = () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) });
  const db = { collection: name => ({
    doc: id => ({ id, get: async () => ({ exists: records.has(name + '/' + id), data: () => records.get(name + '/' + id) }),
      set: async data => records.set(name + '/' + id, data) }),
    where: query,
  }) };
  const trigger = (...args) => args.at(-1);
  const exported = {};
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const modules = {
    'firebase-functions/v2/firestore': { onDocumentCreated: trigger, onDocumentUpdated: trigger, onDocumentDeleted: trigger },
    'firebase-functions/v2/https': { onCall: trigger, HttpsError },
    'firebase-functions/v2/scheduler': { onSchedule: trigger },
    'firebase-functions': { logger: { warn() {}, error() {}, info() {} } },
    'firebase-admin': { initializeApp() {}, firestore: () => db, messaging: () => ({}), auth: () => ({ getUser: async () => authUser, setCustomUserClaims: async (uid, data) => claims.push({ uid, ...data }) }) },
    crypto,
  };
  vm.runInNewContext(fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8'), {
    exports: exported, require: name => { assert(Object.hasOwn(modules, name)); return modules[name]; }, process: { env: {} },
  });
  return { run: () => exported.ensureUserRole({ auth: { uid: 'person', token: {} } }), records, claims };
}

test('legacy Firebase role recovery rejects an unknown account even if its email matches a former owner bootstrap email', async () => {
  const f = legacyFixture();
  await assert.rejects(f.run(), { code: 'permission-denied' });
  assert.equal(f.records.size, 0); assert.equal(f.claims.length, 0);
});

test('legacy Firebase role recovery retains an existing canonical agent without promoting based on email', async () => {
  const f = legacyFixture({ role: 'agent', appUserId: 'legacy-agent', displayName: 'Agent' });
  const result = await f.run(); assert.equal(result.role, 'agent'); assert.equal(result.appUserId, 'legacy-agent');
  assert.equal(f.claims[0].role, 'agent');
});
