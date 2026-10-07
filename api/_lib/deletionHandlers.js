import { createHttpError, json, methodNotAllowed, parseBody } from './http.js';

const collections = { lead: 'leads', client: 'clients', project: 'projects', invoice: 'invoices' };
const validId = (id) => typeof id === 'string' && id.trim().length > 0 && id.length <= 128 && !id.includes('/');

// Keep the parent until cleanup succeeds, so a failed request can be retried.
// Delete only owned dependants; shared business/financial records are protected.
export function createDeletionHandler({ db, authenticate, requireOwner, deleteMedia, deleteField }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const identity = await authenticate(req);
      const { type, id: rawId, forceLinked = false } = parseBody(req);
      if (!Object.hasOwn(collections, type) || !validId(rawId) || typeof forceLinked !== 'boolean') {
        throw createHttpError(400, 'A valid record type and ID are required.');
      }
      const id = rawId.trim();
      const root = await db.collection(collections[type]).doc(id).get();
      if (type !== 'lead' || identity.role === 'owner') await requireOwner(req);
      else if (!root.exists || ![identity.uid, identity.appUserId].filter(Boolean).includes(root.data().assignedTo)) {
        throw createHttpError(403, 'You cannot delete this lead.');
      }

      const query = async (collection, field, value) => (await db.collection(collection).where(field, '==', value).get()).docs;
      const removals = new Map();
      const add = (docs) => docs.forEach((doc) => removals.set(doc.ref.path, doc));
      const updates = [];

      if (type === 'client') {
        const [projects, invoices] = await Promise.all([query('projects', 'clientId', id), query('invoices', 'clientId', id)]);
        if (projects.length || invoices.length) throw createHttpError(409, 'Delete or reassign this client’s projects and invoices first. Nothing was deleted.');
      }
      if (type === 'project') {
        const [invoices, commissions] = await Promise.all([query('invoices', 'projectId', id), query('commissions', 'projectId', id)]);
        if (invoices.length || commissions.length) throw createHttpError(409, 'Delete or detach this project’s invoices and commissions first. Nothing was deleted.');
      }
      if (type === 'invoice') {
        const [payments, commissions] = await Promise.all([query('payments', 'invoiceId', id), query('commissions', 'invoiceId', id)]);
        if (!forceLinked && (payments.length || commissions.length)) {
          throw createHttpError(409, 'This invoice has payments or commissions. Confirm force deletion to remove them too.');
        }
        add(payments); add(commissions);
      }

      // Block new browser writes into a parent being cleaned up. A failed
      // cleanup stays locked for retry instead of accepting new dependants.
      let rootVersion = root.updateTime;
      if (root.exists) {
        const locked = await root.ref.update({ _deleting: true }, { lastUpdateTime: root.updateTime });
        rootVersion = locked.writeTime;
      }
      // Re-read links after locking: a write may have completed between the
      // preflight and the lock. Never delete a newly linked financial record.
      let blocked = false;
      if (type === 'client') {
        const [projects, invoices] = await Promise.all([query('projects', 'clientId', id), query('invoices', 'clientId', id)]);
        blocked = projects.length > 0 || invoices.length > 0;
      } else if (type === 'project') {
        const [invoices, commissions] = await Promise.all([query('invoices', 'projectId', id), query('commissions', 'projectId', id)]);
        blocked = invoices.length > 0 || commissions.length > 0;
      } else if (type === 'invoice') {
        const [payments, commissions] = await Promise.all([query('payments', 'invoiceId', id), query('commissions', 'invoiceId', id)]);
        blocked = !forceLinked && (payments.length > 0 || commissions.length > 0);
        if (!blocked) { add(payments); add(commissions); }
      }
      if (blocked) {
        if (root.exists) await root.ref.update({ _deleting: deleteField() }, { lastUpdateTime: rootVersion });
        throw createHttpError(409, 'Linked records changed. Delete or detach the financial records first, then retry.');
      }
      if (type === 'lead' || type === 'client') {
        updates.length = 0;
        const linked = await query(type === 'lead' ? 'clients' : 'leads', type === 'lead' ? 'leadId' : 'clientId', id);
        linked.forEach((doc) => updates.push({ doc, data: { [type === 'lead' ? 'leadId' : 'clientId']: deleteField(), updatedAt: new Date().toISOString() } }));
      }
      if (type === 'project' && root.exists && validId(root.data().clientId)) {
        const clientId = root.data().clientId;
        const [client, linkedProjects] = await Promise.all([
          db.collection('clients').doc(clientId).get(), query('projects', 'clientId', clientId),
        ]);
        if (client.exists) updates.push({ doc: client, data: {
          projectAccess: Object.fromEntries(linkedProjects
            .filter((entry) => entry.id !== id && !entry.data()._deleting && validId(entry.data().assignedTo))
            .map((entry) => [entry.data().assignedTo, entry.id])),
          updatedAt: new Date().toISOString(),
        } });
      }
      const field = `${type}Id`;
      const [activities, notifications, linkedActivities] = await Promise.all([
        query('activities', 'entityId', id), query('notifications', field, id), query('activities', `metadata.${field}`, id),
      ]);
      add(activities.filter((entry) => entry.data().entityType === type));
      add(notifications); add(type === 'lead' ? linkedActivities.filter((entry) => entry.data().entityType === 'lead') : linkedActivities);
      if (type === 'client' || type === 'project') {
        const shares = await query('project_shares', field, id);
        // Preserve every reference if any external deletion fails. Missing files
        // are treated as already deleted by the storage adapters.
        for (const share of shares) {
          const result = await deleteMedia(share.data().media || []);
          if (result.failed) throw createHttpError(502, 'Some portal files could not be deleted. The record and file references were kept; please retry.');
        }
        add(shares);
      }

      // Use bounded batches for large histories. Parents stay available until
      // all leaves are removed; retries discover the remaining leaves by ID.
      const children = [...removals.values()];
      while (children.length) {
        const batch = db.batch();
        children.splice(0, 450).forEach((doc) => batch.delete(doc.ref, { lastUpdateTime: doc.updateTime }));
        await batch.commit();
      }
      while (updates.length > 400) {
        const batch = db.batch();
        updates.splice(0, 400).forEach(({ doc, data }) => batch.update(doc.ref, data, { lastUpdateTime: doc.updateTime }));
        await batch.commit();
      }
      const batch = db.batch();
      updates.forEach(({ doc, data }) => batch.update(doc.ref, data, { lastUpdateTime: doc.updateTime }));
      if (root.exists) batch.delete(root.ref, { lastUpdateTime: rootVersion });
      await batch.commit();
      return json(res, 200, { removed: true, cleaned: removals.size });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      return json(res, status, { error: error?.status ? error.message : 'Deletion did not finish. The parent is kept until cleanup finishes; refresh and retry.' });
    }
  };
}
