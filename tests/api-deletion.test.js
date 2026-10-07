import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeletionHandler } from '../api/_lib/deletionHandlers.js';
import { cleanupPortalFiles, revokeAndCleanupShare } from '../api/_lib/portalFileCleanup.js';

function fixture(initial = {}) {
  const records = new Map(Object.entries(initial));
  const versions = new Map([...records.keys()].map((key) => [key, 1]));
  const state = { records, mediaCalls: [], commits: 0, failCommit: 0, failMedia: false };
  const apply = (operations) => {
    for (const [kind, ref, data, precondition] of operations) {
      if (precondition && versions.get(ref.path) !== precondition.lastUpdateTime) throw new Error('Record changed');
    }
    for (const [kind, ref, data] of operations) {
      if (kind === 'delete') { records.delete(ref.path); versions.delete(ref.path); }
      else {
        const next = { ...records.get(ref.path), ...data };
        Object.keys(next).forEach((key) => { if (next[key] === 'DELETE_FIELD') delete next[key]; });
        records.set(ref.path, next); versions.set(ref.path, (versions.get(ref.path) || 0) + 1);
      }
    }
  };
  const ref = (path) => ({ path, id: path.split('/')[1],
    async get() { return snap(path); },
    async update(data, precondition) { apply([['update', this, data, precondition]]); state.afterUpdate?.(path, data); return { writeTime: versions.get(path) }; },
    async delete(precondition) { apply([['delete', this, null, precondition]]); },
  });
  const snap = (path) => ({ ref: ref(path), id: path.split('/')[1], exists: records.has(path), updateTime: versions.get(path), data: () => structuredClone(records.get(path)) });
  const fieldValue = (value, field) => field.split('.').reduce((current, key) => current?.[key], value);
  const db = {
    collection(name) { return { doc: (id) => ref(`${name}/${id}`), where(field, op, value) {
      assert.equal(op, '==');
      return { async get() { return { docs: [...records].filter(([path, data]) => path.startsWith(name + '/') && fieldValue(data, field) === value).map(([path]) => snap(path)) }; } };
    } }; },
    batch() {
      const operations = [];
      return { delete(ref, precondition) { operations.push(['delete', ref, null, precondition]); },
        update(ref, data, precondition) { operations.push(['update', ref, data, precondition]); },
        async commit() { state.commits++; assert(operations.length <= 450); if (state.commits === state.failCommit) throw new Error('Offline'); apply(operations); },
      };
    },
  };
  const handler = createDeletionHandler({ db, deleteField: () => 'DELETE_FIELD',
    authenticate: async (req) => { if (!req.headers.authorization) throw Object.assign(new Error('Sign in'), { status: 401 }); return { uid: req.headers.authorization, role: req.headers.authorization === 'owner' ? 'owner' : 'agent', appUserId: req.headers.authorization === 'agent' ? 'legacy-agent' : undefined }; },
    requireOwner: async (req) => { if (req.headers.authorization !== 'owner') throw Object.assign(new Error('Owners only'), { status: 403 }); },
    deleteMedia: async (media) => { state.mediaCalls.push(media); await state.onMedia?.(); return { failed: state.failMedia ? 1 : 0 }; },
  });
  state.invoke = async (type, id, identity = 'owner', options = {}) => {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await handler({ method: 'POST', headers: { authorization: identity }, body: { type, id, ...options } }, res);
    return res;
  };
  state.ref = ref;
  return state;
}

test('lead deletion removes notes/reminders but preserves and unlinks its converted client', async () => {
  const f = fixture({ 'leads/l': { assignedTo: 'legacy-agent' }, 'clients/c': { leadId: 'l' },
    'projects/p': { clientId: 'c' }, 'activities/a': { entityType: 'lead', entityId: 'l' },
    'activities/unrelated': { entityType: 'client', entityId: 'l' }, 'notifications/n': { leadId: 'l' } });
  assert.equal((await f.invoke('lead', 'l', 'agent')).code, 200);
  assert.deepEqual([...f.records.keys()].sort(), ['activities/unrelated', 'clients/c', 'projects/p']);
  assert.equal(f.records.get('clients/c').leadId, undefined);
});
test('unauthenticated users and other agents cannot delete records', async () => {
  const f = fixture({ 'leads/l': { assignedTo: 'agent' }, 'projects/p': {} });
  assert.equal((await f.invoke('lead', 'l', '')).code, 401);
  assert.equal((await f.invoke('lead', 'l', 'other')).code, 403);
  assert.equal((await f.invoke('project', 'p', 'agent')).code, 403);
  assert.equal(f.commits, 0);
});
test('projects and clients with linked business/financial records are protected without any cleanup', async () => {
  const f = fixture({ 'projects/p': { clientId: 'c' }, 'clients/c': {}, 'invoices/i': { projectId: 'p', clientId: 'c' } });
  assert.equal((await f.invoke('project', 'p')).code, 409);
  assert.equal((await f.invoke('client', 'c')).code, 409);
  assert.equal(f.commits, 0); assert.equal(f.mediaCalls.length, 0);
});
test('invoice deletion requires explicit financial override and removes all owned dependants', async () => {
  const f = fixture({ 'invoices/i': {}, 'payments/p': { invoiceId: 'i' }, 'commissions/c': { invoiceId: 'i' },
    'activities/a': { entityType: 'invoice', entityId: 'i' }, 'notifications/n': { invoiceId: 'i' } });
  assert.equal((await f.invoke('invoice', 'i')).code, 409);
  assert.equal(f.records.size, 5);
  assert.equal((await f.invoke('invoice', 'i', 'owner', { forceLinked: true })).code, 200);
  assert.equal(f.records.size, 0);
});
test('portal file failures keep project and every share reference for retry', async () => {
  const media = [{ storagePath: 'old-file' }];
  const f = fixture({ 'projects/p': {}, 'project_shares/s': { projectId: 'p', media } });
  f.failMedia = true;
  assert.equal((await f.invoke('project', 'p')).code, 502);
  assert.equal(f.records.size, 2); assert.equal(f.commits, 0);
  assert.equal(f.records.get('projects/p')._deleting, true);
  f.failMedia = false;
  assert.equal((await f.invoke('project', 'p')).code, 200);
  assert.equal(f.records.size, 0);
  assert.equal((await f.invoke('project', 'p')).code, 200);
});
test('a financial link arriving before the lock is protected and the parent is unlocked', async () => {
  const f = fixture({ 'projects/p': {} });
  f.afterUpdate = (path, data) => { if (path === 'projects/p' && data._deleting === true) f.records.set('invoices/i', { projectId: 'p' }); };
  assert.equal((await f.invoke('project', 'p')).code, 409);
  assert(f.records.has('projects/p')); assert(f.records.has('invoices/i'));
  assert.equal(f.records.get('projects/p')._deleting, undefined);
  assert.equal(f.mediaCalls.length, 0);
});
test('a share changing during file cleanup retains its references for retry', async () => {
  const f = fixture({ 'projects/p': {}, 'project_shares/s': { projectId: 'p', media: [{ storagePath: 'old' }] } });
  // Simulate a concurrent Admin update while external storage is being cleaned.
  f.onMedia = () => f.ref('project_shares/s').update({ media: [{ storagePath: 'new' }] });
  assert.equal((await f.invoke('project', 'p')).code, 500);
  assert(f.records.has('projects/p')); assert(f.records.has('project_shares/s'));
  assert.deepEqual(f.records.get('project_shares/s').media, [{ storagePath: 'new' }]);
});
test('large histories use bounded batches and a failed batch leaves a retryable parent', async () => {
  const initial = { 'leads/l': { assignedTo: 'agent' } };
  for (let i = 0; i < 530; i++) initial[`activities/${i}`] = { entityType: 'lead', entityId: 'l' };
  const f = fixture(initial); f.failCommit = 2;
  assert.equal((await f.invoke('lead', 'l', 'agent')).code, 500);
  assert(f.records.has('leads/l')); assert.equal(f.records.size, 81);
  assert.equal((await f.invoke('lead', 'l', 'agent')).code, 200);
  assert.equal(f.records.size, 0);
});
test('deleting a client unlinks retained leads and removes its metadata activities and shares', async () => {
  const f = fixture({ 'clients/c': {}, 'leads/l': { clientId: 'c', stage: 'won' },
    'activities/a': { entityType: 'lead', entityId: 'l', metadata: { clientId: 'c' } },
    'project_shares/s': { clientId: 'c', media: [] } });
  assert.equal((await f.invoke('client', 'c')).code, 200);
  assert.deepEqual([...f.records.keys()], ['leads/l']);
  assert.equal(f.records.get('leads/l').clientId, undefined);
});
test('invalid deletion payloads cannot choose arbitrary collections or paths', async () => {
  const f = fixture({ 'users/owner': {} });
  for (const [type, id] of [['users', 'owner'], ['lead', '../owner'], ['__proto__', 'owner']]) {
    assert.equal((await f.invoke(type, id)).code, 400);
  }
  assert.equal(f.commits, 0);
});
test('file cleanup processes legacy entries beyond 24 and deduplicates paths', async () => {
  const calls = [];
  const media = Array.from({ length: 30 }, (_, i) => ({ storagePath: `files/${i}` }));
  media.push(media[0], { storagePath: 'vercel-blob:https://store.public.blob.vercel-storage.com/file' });
  const result = await cleanupPortalFiles(media, { deleteFirebase: async (path) => calls.push(path), deleteBlob: async (url) => calls.push(url) });
  assert.equal(result.failed, 0); assert.equal(result.deleted, 31); assert.equal(calls.length, 31);
});
test('invalid paths and failed deletions remain in failedEntries', async () => {
  const good = { storagePath: 'files/good' }, failed = { storagePath: 'files/failed' }, invalid = { name: 'missing path' };
  const result = await cleanupPortalFiles([good, failed, invalid], { deleteFirebase: async (path) => { if (path.endsWith('failed')) throw new Error('Unavailable'); }, deleteBlob: async () => {} });
  assert.equal(result.deleted, 1); assert.equal(result.failed, 2); assert.deepEqual(result.failedEntries, [failed, invalid]);
});
test('revoked shares retain failed paths and disappear from Firestore after successful retry', async () => {
  const a = { storagePath: 'files/a' }, b = { storagePath: 'files/b' };
  const f = fixture({ 'project_shares/s': { status: 'active', media: [a, b] } });
  const shareRef = f.ref('project_shares/s');
  const first = await revokeAndCleanupShare({ shareRef, shareData: f.records.get(shareRef.path), shareUpdateTime: 1,
    revokedBy: 'owner', now: 'now', deleteFiles: async () => { assert.equal(f.records.get(shareRef.path).status, 'revoked'); return { failed: 1, failedEntries: [b] }; } });
  assert.equal(first.failed, 1); assert.deepEqual(f.records.get(shareRef.path).media, [b]);
  await revokeAndCleanupShare({ shareRef, shareData: f.records.get(shareRef.path), shareUpdateTime: 3,
    revokedBy: 'owner', now: 'later', deleteFiles: async (media) => { assert.deepEqual(media, [b]); return { failed: 0 }; } });
  assert.equal(f.records.size, 0);
});

test('project deletion preserves client access through another assigned project', async () => {
  const f = fixture({
    'clients/c': { projectAccess: { agent: 'p' } },
    'projects/p': { clientId: 'c', assignedTo: 'agent' },
    'projects/remaining': { clientId: 'c', assignedTo: 'agent' },
  });
  assert.equal((await f.invoke('project', 'p')).code, 200);
  assert.deepEqual(f.records.get('clients/c').projectAccess, { agent: 'remaining' });
  assert.equal(f.records.has('projects/remaining'), true);
});
