import assert from 'node:assert/strict';
import test from 'node:test';
import { createMigrationHandlers, readIdentityConfig } from '../api/_lib/migrationHandlers.js';

const clone = (value) => value === undefined ? undefined : structuredClone(value);
function fixture(initial = {}, configuration = { owners: new Set(), legacyIds: {} }) {
  const records = new Map(Object.entries({
    'users/owner': { uid: 'owner', role: 'owner', email: 'owner@example.com' },
    'users/agent': { uid: 'agent', role: 'agent', appUserId: 'victim', email: 'agent@example.com' },
    'leads/lead-one': { assignedTo: 'agent', stage: 'negotiation', businessName: 'Business', contactName: 'Client', email: '', phone: '' },
    ...initial,
  }));
  const users = new Map(['owner', 'agent', 'other'].map(uid => [uid, {
    uid, email: `${uid}@example.com`, customClaims: { role: uid === 'owner' ? 'owner' : 'agent', extra: 'keep' },
  }]));
  const tokens = new Map([...users].map(([uid, user]) => [uid, { uid, ...user.customClaims }]));
  const calls = { claims: [], revoked: [], writes: 0 };
  const snapshot = (ref) => ({ ref, id: ref.id, exists: records.has(ref.path), data: () => clone(records.get(ref.path)) });
  const query = (name, conditions = [], maximum = Infinity) => ({
    kind: 'query', name, conditions, maximum,
    where(field, operator, value) { assert.equal(operator, '=='); return query(name, [...conditions, [field, value]], maximum); },
    limit(count) { return query(name, conditions, count); },
  });
  const db = { collection(name) {
    return { doc(id) { return { path: `${name}/${id}`, id, get: async () => snapshot(db.collection(name).doc(id)) }; },
      where(field, operator, value) { return query(name).where(field, operator, value); } };
  } };
  let queue = Promise.resolve();
  db.runTransaction = async (operation) => {
    const task = queue.then(async () => {
      const writes = [];
      const result = await operation({
        async get(ref) {
          assert.equal(writes.length, 0, 'Firestore disallows reads after queued writes');
          if (ref.kind !== 'query') return snapshot(ref);
          const docs = [...records].filter(([path, value]) => path.startsWith(ref.name + '/')
            && ref.conditions.every(([field, expected]) => value[field] === expected))
            .slice(0, ref.maximum).map(([path]) => snapshot(db.collection(ref.name).doc(path.slice(ref.name.length + 1))));
          return { docs, empty: docs.length === 0 };
        },
        set(ref, value, options) { writes.push([ref, clone(value), options?.merge]); },
        update(ref, value) { assert(records.has(ref.path)); writes.push([ref, clone(value), true]); },
      });
      for (const [ref, data, merge] of writes) { records.set(ref.path, merge ? { ...records.get(ref.path), ...data } : data); calls.writes++; }
      return result;
    });
    queue = task.catch(() => {});
    return task;
  };
  const auth = {
    async verifyIdToken(token, revoked) { assert.equal(revoked, true); if (!tokens.has(token)) throw new Error('Invalid token'); return clone(tokens.get(token)); },
    async getUser(uid) { if (!users.has(uid)) throw Object.assign(new Error('User not found'), { code: 'auth/user-not-found' }); return clone(users.get(uid)); },
    async setCustomUserClaims(uid, claims) { calls.claims.push([uid, claims]); users.get(uid).customClaims = clone(claims); },
    async revokeRefreshTokens(uid) { calls.revoked.push(uid); },
  };
  const handlers = createMigrationHandlers({ auth, db, getIdentityConfig: () => configuration });
  const invoke = async (operation, token = 'agent', body = {}, method = 'POST') => {
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(status) { this.statusCode = status; return this; }, json(value) { this.body = value; return this; } };
    await handlers[operation]({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res);
    return res;
  };
  return { records, users, tokens, calls, auth, db, handlers, invoke };
}

test('missing/invalid credentials and wrong methods cannot mutate data', async () => {
  for (const operation of ['ensureRole', 'setRole', 'convertLead']) {
    const f = fixture();
    assert.equal((await f.invoke(operation, null)).statusCode, 401);
    assert.equal((await f.invoke(operation, 'invalid')).statusCode, 401);
    const get = await f.invoke(operation, 'owner', {}, 'GET');
    assert.equal(get.statusCode, 405); assert.equal(get.headers.Allow, 'POST'); assert.equal(f.calls.writes, 0);
  }
});
test('canonical Firestore owner recovers missing claim and preserves unrelated claims', async () => {
  const f = fixture(); f.users.get('owner').customClaims.role = 'agent';
  const response = await f.invoke('ensureRole', 'owner');
  assert.equal(response.statusCode, 200); assert.equal(response.body.role, 'owner');
  assert.deepEqual(f.users.get('owner').customClaims, { role: 'owner', appUserId: 'owner', extra: 'keep' });
  assert.equal(response.headers['Cache-Control'], 'no-store');
});
test('configured UID recovers owner without trusting request roles or email', async () => {
  const f = fixture({}, { owners: new Set(['agent']), legacyIds: {} });
  assert.equal((await f.invoke('ensureRole', 'agent')).body.role, 'owner');
  const ordinary = fixture();
  assert.equal((await ordinary.invoke('ensureRole', 'agent', { uid: 'owner', role: 'owner', email: 'owner@example.com' })).body.role, 'agent');
});
test('browser-writable profile aliases are ignored; only configured/signed aliases survive', async () => {
  const f = fixture();
  assert.equal((await f.invoke('ensureRole')).body.appUserId, 'agent');
  const configured = fixture({}, { owners: new Set(), legacyIds: { agent: 'legacy-agent' } });
  assert.equal((await configured.invoke('ensureRole')).body.appUserId, 'legacy-agent');
});
test('repeated recovery does not rewrite unchanged records/claims', async () => {
  const f = fixture(); await f.invoke('ensureRole'); const writes = f.calls.writes;
  await f.invoke('ensureRole'); assert.equal(f.calls.writes, writes); assert.equal(f.calls.claims.length, 1);
});
test('demoted canonical profile overrides a stale owner claim', async () => {
  const f = fixture({ 'users/owner': { role: 'agent' } });
  assert.equal((await f.invoke('ensureRole', 'owner')).body.role, 'agent');
  await assert.rejects(f.handlers.requireOwner({ headers: { authorization: 'Bearer owner' } }), { status: 403 });
});
test('role updates are owner-only and cannot target self or demote recovery owner', async () => {
  const f = fixture({}, { owners: new Set(['other']), legacyIds: {} });
  assert.equal((await f.invoke('setRole', 'agent', { uid: 'other', role: 'owner' })).statusCode, 403);
  assert.equal((await f.invoke('setRole', 'owner', { uid: 'owner', role: 'agent' })).statusCode, 409);
  assert.equal((await f.invoke('setRole', 'owner', { uid: 'other', role: 'agent' })).statusCode, 409);
  assert.equal((await f.invoke('setRole', 'owner', { uid: 'missing', role: 'owner' })).statusCode, 404);
});
test('owner role updates canonical profile and claims; demotion revokes refresh tokens', async () => {
  const f = fixture();
  assert.equal((await f.invoke('setRole', 'owner', { uid: 'agent', role: 'owner' })).statusCode, 200);
  assert.equal(f.records.get('users/agent').role, 'owner'); assert.equal(f.users.get('agent').customClaims.extra, 'keep');
  assert.equal((await f.invoke('setRole', 'owner', { uid: 'agent', role: 'agent' })).statusCode, 200);
  assert.deepEqual(f.calls.revoked, ['agent']);
});
test('concurrent cross-demotions cannot remove both owners', async () => {
  const f = fixture({ 'users/other': { role: 'owner' } }); f.tokens.get('other').role = 'owner';
  const responses = await Promise.all([
    f.invoke('setRole', 'owner', { uid: 'other', role: 'agent' }),
    f.invoke('setRole', 'other', { uid: 'owner', role: 'agent' }),
  ]);
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 403]);
  assert.equal([...f.records].filter(([path, value]) => path.startsWith('users/') && value.role === 'owner').length, 1);
});
const conversion = { leadId: 'lead-one', createProject: true, projectName: 'Website', packageId: 'business-brand-expansion' };
test('assigned agent creates client and full premium project with reads before writes', async () => {
  const f = fixture(); const response = await f.invoke('convertLead', 'agent', conversion);
  assert.equal(response.statusCode, 200);
  assert.equal(f.records.get('leads/lead-one').stage, 'won');
  const project = f.records.get('projects/' + response.body.projectId);
  assert.equal(project.clientId, response.body.clientId); assert.equal(project.milestones.length, 11);
});
test('unassigned agent or forged profile alias cannot convert another agent lead', async () => {
  const f = fixture({ 'leads/lead-one': { assignedTo: 'victim', stage: 'new' } });
  assert.equal((await f.invoke('convertLead', 'agent', conversion)).statusCode, 403); assert.equal(f.calls.writes, 0);
});
test('owner and server-configured legacy assignee can convert', async () => {
  const owner = fixture({ 'leads/lead-one': { assignedTo: 'another', stage: 'new' } });
  assert.equal((await owner.invoke('convertLead', 'owner', conversion)).statusCode, 200);
  const legacy = fixture({ 'leads/lead-one': { assignedTo: 'legacy-agent', stage: 'new' } }, { owners: new Set(), legacyIds: { agent: 'legacy-agent' } });
  assert.equal((await legacy.invoke('convertLead', 'agent', conversion)).statusCode, 200);
});
test('concurrent requests/retries create one client, project and conversion activity', async () => {
  const f = fixture(); const responses = await Promise.all(Array.from({ length: 4 }, () => f.invoke('convertLead', 'agent', conversion)));
  assert(responses.every(r => r.statusCode === 200));
  assert.equal(new Set(responses.map(r => r.body.clientId)).size, 1);
  for (const collection of ['clients', 'projects', 'activities']) assert.equal([...f.records.keys()].filter(key => key.startsWith(collection + '/')).length, 1);
  const writes = f.calls.writes;
  const retry = await f.invoke('convertLead', 'agent', { ...conversion, projectName: 'Renamed retry' });
  assert.equal(retry.body.projectId, responses[0].body.projectId); assert.equal(f.calls.writes, writes);
});
test('client-only conversion can add its single project later without duplicate activity', async () => {
  const f = fixture(); const first = await f.invoke('convertLead', 'agent', { leadId: 'lead-one', createProject: false });
  assert.equal(first.statusCode, 200); assert.equal(first.body.projectId, undefined);
  const next = await f.invoke('convertLead', 'agent', conversion);
  assert.equal(next.body.clientId, first.body.clientId);
  assert.equal([...f.records.keys()].filter(key => key.startsWith('activities/')).length, 1);
});
test('historical client and project are reused', async () => {
  const f = fixture({
    'clients/historical': { leadId: 'lead-one' },
    'projects/historical-project': { clientId: 'historical', name: 'Website' },
  });
  const response = await f.invoke('convertLead', 'agent', conversion);
  assert.equal(response.body.clientId, 'historical'); assert.equal(response.body.projectId, 'historical-project');
});
test('invalid payloads and conflicting client records cannot partially mutate data', async () => {
  for (const body of [{}, { ...conversion, packageId: '__proto__' }, { ...conversion, createProject: 'true' }, { ...conversion, leadId: 'bad/path' }, { ...conversion, projectName: '' }]) {
    const f = fixture(); assert.equal((await f.invoke('convertLead', 'agent', body)).statusCode, 400); assert.equal(f.calls.writes, 0);
  }
  const duplicate = fixture({ 'clients/one': { leadId: 'lead-one' }, 'clients/two': { leadId: 'lead-one' } });
  assert.equal((await duplicate.invoke('convertLead', 'agent', conversion)).statusCode, 409); assert.equal(duplicate.calls.writes, 0);
  const conflicting = fixture({
    'leads/lead-one': { assignedTo: 'agent', clientId: 'existing' },
    'clients/existing': { leadId: 'another-lead' },
  });
  assert.equal((await conflicting.invoke('convertLead', 'agent', conversion)).statusCode, 409);
  assert.equal(conflicting.calls.writes, 0);
});
test('internal configuration/credential errors are not returned to callers', async () => {
  const f = fixture(); f.auth.getUser = async () => { throw new Error('PRIVATE KEY VALUE'); };
  const response = await f.invoke('ensureRole'); assert.equal(response.statusCode, 500);
  assert(!response.body.error.includes('PRIVATE KEY'));
});
test('legacy ID configuration rejects malformed or path-containing values', () => {
  assert.throws(() => readIdentityConfig({ CRM_USER_ID_MAP: '{' }), { status: 503 });
  assert.throws(() => readIdentityConfig({ CRM_USER_ID_MAP: '{"agent":"bad/path"}' }), { status: 503 });
});

test('conversion exposes actionable Firebase failures without private SDK details', async () => {
  for (const [code, message] of [[7, 'service account permissions'], [8, 'usage limits'], [14, 'temporarily unavailable'], [9, 'Firestore index']]) {
    const f = fixture();
    f.db.runTransaction = async () => { throw Object.assign(new Error('PRIVATE KEY VALUE index'), { code }); };
    const response = await f.invoke('convertLead', 'agent', { leadId: 'lead-one', createProject: false });
    assert.equal(response.statusCode, 503);
    assert(response.body.error.includes(message));
    assert(!response.body.error.includes('PRIVATE KEY'));
    assert.equal(f.calls.writes, 0);
  }
});

test('missing client is recovered at its original ID with surviving project access and financial links intact', async () => {
  const f = fixture({
    'leads/lead-one': { stage: 'won', assignedTo: 'agent', clientId: 'gone', businessName: 'Recovered business', contactName: 'Client', email: 'client@example.com', phone: '123' },
    'projects/surviving': { clientId: 'gone', assignedTo: 'other' },
    'projects/deleting': { clientId: 'gone', assignedTo: 'removed-agent', _deleting: true },
    'invoices/surviving': { clientId: 'gone', status: 'paid', amount: 1500 },
  });
  const invoice = clone(f.records.get('invoices/surviving'));
  const response = await f.invoke('convertLead', 'agent', { leadId: 'lead-one', createProject: false });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.clientId, 'gone');
  assert.equal(response.body.projectId, undefined);
  assert.equal(f.records.get('clients/gone').businessName, 'Recovered business');
  assert.deepEqual(f.records.get('clients/gone').projectAccess, { other: 'surviving' });
  assert.equal(f.records.get('projects/surviving').clientId, 'gone');
  assert.deepEqual(f.records.get('invoices/surviving'), invoice);
  const writes = f.calls.writes;
  await f.invoke('convertLead', 'agent', { leadId: 'lead-one', createProject: false });
  assert.equal(f.calls.writes, writes);
});

test('stale client pointer is relinked to the one existing client without creating duplicates', async () => {
  const f = fixture({
    'leads/lead-one': { stage: 'negotiation', assignedTo: 'agent', clientId: 'gone' },
    'clients/actual': { leadId: 'lead-one', businessName: 'Keep original details' },
  });
  const response = await f.invoke('convertLead', 'agent', { leadId: 'lead-one', createProject: false });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.clientId, 'actual');
  assert.equal(f.records.get('leads/lead-one').clientId, 'actual');
  assert.equal(f.records.get('clients/actual').businessName, 'Keep original details');
  assert(!f.records.has('clients/gone'));
  assert.equal([...f.records.keys()].filter(key => key.startsWith('clients/')).length, 1);
});

test('concurrent recovery creates one client and never bypasses deletion or assignment checks', async () => {
  const initial = { 'leads/lead-one': { stage: 'won', assignedTo: 'agent', clientId: 'gone' } };
  const f = fixture(initial);
  const body = { leadId: 'lead-one', createProject: false };
  const responses = await Promise.all(Array.from({ length: 3 }, () => f.invoke('convertLead', 'agent', body)));
  assert(responses.every(response => response.statusCode === 200));
  assert.equal([...f.records.keys()].filter(key => key.startsWith('clients/')).length, 1);
  const unauthorized = fixture(initial);
  assert.equal((await unauthorized.invoke('convertLead', 'other', body)).statusCode, 403);
  assert.equal(unauthorized.calls.writes, 0);
  const deleting = fixture({ ...initial, 'clients/gone': { leadId: 'lead-one', _deleting: true } });
  assert.equal((await deleting.invoke('convertLead', 'agent', body)).statusCode, 409);
  assert.equal(deleting.calls.writes, 0);
});

test('recovery with project creation keeps existing access and links the new project to the original client ID', async () => {
  const f = fixture({
    'leads/lead-one': { stage: 'negotiation', assignedTo: 'agent', clientId: 'gone' },
    'projects/surviving': { clientId: 'gone', assignedTo: 'other' },
  });
  const response = await f.invoke('convertLead', 'agent', conversion);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.clientId, 'gone');
  assert.equal(f.records.get('projects/' + response.body.projectId).clientId, 'gone');
  assert.deepEqual(f.records.get('clients/gone').projectAccess, { other: 'surviving', agent: response.body.projectId });
});
