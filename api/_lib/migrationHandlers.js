import crypto from 'node:crypto';
import { createHttpError, json, methodNotAllowed, parseBody } from './http.js';
import { PACKAGE_CATALOG } from './packages.js';

const roleOf = (profile) => profile?.role === 'owner' ? 'owner' : 'agent';
const validId = (value) => typeof value === 'string' && value.trim().length > 0
  && value.trim().length <= 128 && !value.includes('/');
const text = (value, maximum = 180) => {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > maximum) throw createHttpError(400, 'Invalid or oversized field.');
  return value.trim();
};

// Recovery UIDs and legacy identities come only from server configuration.
export const readIdentityConfig = (env = process.env) => {
  const owners = new Set((env.CRM_OWNER_UIDS || '').split(',').map((uid) => uid.trim()).filter(Boolean));
  let legacyIds = {};
  if (env.CRM_USER_ID_MAP) {
    try { legacyIds = JSON.parse(env.CRM_USER_ID_MAP); } catch {
      throw createHttpError(503, 'Invalid server identity configuration.');
    }
    if (!legacyIds || Array.isArray(legacyIds) || typeof legacyIds !== 'object'
      || Object.entries(legacyIds).some(([uid, id]) => !validId(uid) || !validId(id))) {
      throw createHttpError(503, 'Invalid server identity configuration.');
    }
  }
  return { owners, legacyIds };
};

export const createMigrationHandlers = ({ auth, db, getIdentityConfig = readIdentityConfig }) => {
  const knownRole = value => ['owner', 'agent'].includes(value);
  const admitted = (uid, profile, claims, config) => knownRole(profile?.role) || knownRole(claims?.role) || config.owners.has(uid);
  const authenticate = async (req) => {
    const header = req.headers?.authorization;
    if (typeof header !== 'string' || !/^Bearer\s+\S+$/i.test(header)) throw createHttpError(401, 'Please sign in again.');
    let decoded;
    try {
      decoded = await auth.verifyIdToken(header.replace(/^Bearer\s+/i, ''), true);
      if (!validId(decoded.uid)) throw new Error('Invalid UID');
    } catch { throw createHttpError(401, 'Your session is invalid. Please sign in again.'); }
    const profile = await db.collection('users').doc(decoded.uid).get();
    const authUser = await auth.getUser(decoded.uid);
    if (authUser.disabled || profile.data()?.accessDisabled === true || !admitted(decoded.uid, profile.data(), authUser.customClaims, getIdentityConfig())) {
      throw createHttpError(403, 'CRM access is invitation-only. Ask the owner for an invitation.');
    }
    return decoded;
  };
  const ownerAuthorized = (uid, profile, config) => config.owners.has(uid) || roleOf(profile) === 'owner';
  const requireOwner = async (req) => {
    const decoded = await authenticate(req);
    const profile = await db.collection('users').doc(decoded.uid).get();
    if (decoded.role !== 'owner' || !ownerAuthorized(decoded.uid, profile.data(), getIdentityConfig())) {
      throw createHttpError(403, 'Only owners can perform this action.');
    }
    return { uid: decoded.uid, role: 'owner', email: decoded.email || '' };
  };
  const appIdFor = (uid, authUser, config) => {
    // Never authorize using an old browser-writable profile.appUserId.
    const configured = Object.hasOwn(config.legacyIds, uid) ? config.legacyIds[uid] : undefined;
    return configured || (validId(authUser.customClaims?.appUserId) ? authUser.customClaims.appUserId : uid);
  };

  const ensureRole = async (req) => {
    const action = parseBody(req).action;
    if (action === 'invite') return inviteUser(req);
    if (action !== undefined) throw createHttpError(400, 'Invalid account action.');
    const decoded = await authenticate(req);
    const authUser = await auth.getUser(decoded.uid);
    const config = getIdentityConfig();
    const ref = db.collection('users').doc(decoded.uid);
    const appUserId = appIdFor(decoded.uid, authUser, config);
    const profile = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.data() || {};
      if (!admitted(decoded.uid, current, authUser.customClaims, config)) throw createHttpError(403, 'CRM access is invitation-only.');
      const role = config.owners.has(decoded.uid) ? 'owner' : snapshot.exists
        ? roleOf(current) : authUser.customClaims?.role === 'owner' ? 'owner' : 'agent';
      const displayName = authUser.displayName || current.displayName || current.name || null;
      const now = new Date().toISOString();
      const next = { uid: decoded.uid, appUserId, email: authUser.email || null, displayName, role, ...(current.invitationPending === true ? { invitationPending: false } : {}) };
      if (!snapshot.exists || Object.entries(next).some(([key, value]) => current[key] !== value)) {
        transaction.set(ref, { ...next, ...(!snapshot.exists ? { createdAt: now } : {}), updatedAt: now }, { merge: true });
      }
      return next;
    });
    if (authUser.customClaims?.role !== profile.role || authUser.customClaims?.appUserId !== appUserId) {
      await auth.setCustomUserClaims(decoded.uid, { ...(authUser.customClaims || {}), role: profile.role, appUserId });
    }
    return profile;
  };

  const inviteUser = async req => {
    const actor = await requireOwner(req);
    const payload = parseBody(req);
    const email = text(payload.email, 254).toLowerCase();
    const displayName = text(payload.displayName, 120);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !displayName) throw createHttpError(400, 'Enter a valid email and full name.');
    let target;
    let created = false;
    try { target = await auth.getUserByEmail(email); } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }
    if (target) {
      const existing = await db.collection('users').doc(target.uid).get();
      // Never turn an arbitrary pre-registered account into a member: someone
      // else may know its password. Only retry a server-created pending invite.
      if (target.disabled || existing.data()?.invitationPending !== true || existing.data()?.role !== 'agent') {
        throw createHttpError(409, 'This email already has an account. Existing members should log in; ask the owner to review any unapproved Firebase account.');
      }
    } else {
      try {
        target = await auth.createUser({ email, displayName, password: crypto.randomBytes(48).toString('base64url'), emailVerified: false });
        created = true;
      } catch (error) {
        if (error.code === 'auth/email-already-exists') throw createHttpError(409, 'This email already has an account. Refresh before trying again.');
        throw error;
      }
    }
    const config = getIdentityConfig();
    const ref = db.collection('users').doc(target.uid);
    try {
      await db.runTransaction(async transaction => {
        const owner = await transaction.get(db.collection('users').doc(actor.uid));
        const existing = await transaction.get(ref);
        await transaction.get(db.collection('_role_control').doc('changes'));
        if (!ownerAuthorized(actor.uid, owner.data(), config)) throw createHttpError(403, 'Your owner access has changed.');
        if (existing.exists && (existing.data()?.invitationPending !== true || existing.data()?.role !== 'agent')) throw createHttpError(409, 'This account already has access.');
        const now = new Date().toISOString();
        transaction.set(ref, { uid: target.uid, appUserId: appIdFor(target.uid, target, config), email, displayName: target.displayName || displayName,
          role: 'agent', isActive: true, invitationPending: true, invitedBy: actor.uid,
          ...(!existing.exists ? { createdAt: now } : {}), updatedAt: now }, { merge: true });
      });
    } catch (error) {
      // No invitation has been granted or link disclosed before this point.
      if (created) await auth.deleteUser(target.uid).catch(() => {});
      throw error;
    }
    await auth.setCustomUserClaims(target.uid, { ...(target.customClaims || {}), role: 'agent', appUserId: appIdFor(target.uid, target, config) });
    const setupLink = await auth.generatePasswordResetLink(email);
    return { uid: target.uid, email, setupLink, role: 'agent' };
  };

  const setRole = async (req) => {
    const { uid } = await requireOwner(req);
    const payload = parseBody(req);
    if (!validId(payload.uid) || !['owner', 'agent'].includes(payload.role)) throw createHttpError(400, 'A valid user UID and role are required.');
    const targetUid = payload.uid.trim();
    if (targetUid === uid) throw createHttpError(409, 'You cannot change your own role.');
    const config = getIdentityConfig();
    if (config.owners.has(targetUid) && payload.role !== 'owner') {
      throw createHttpError(409, 'Remove this UID from CRM_OWNER_UIDS before demoting a recovery owner.');
    }
    let targetUser;
    try { targetUser = await auth.getUser(targetUid); } catch (error) {
      if (error.code === 'auth/user-not-found') throw createHttpError(404, 'User not found.');
      throw error;
    }
    await db.runTransaction(async (transaction) => {
      const actor = await transaction.get(db.collection('users').doc(uid));
      const lock = db.collection('_role_control').doc('changes');
      await transaction.get(lock);
      if (!ownerAuthorized(uid, actor.data(), config)) throw createHttpError(403, 'Your owner access has changed.');
      // Serialize demotions and recheck the actor so two owners cannot demote
      // each other concurrently using previously issued tokens.
      const now = new Date().toISOString();
      transaction.set(db.collection('users').doc(targetUid), {
        uid: targetUid, email: targetUser.email || null, role: payload.role, updatedAt: now,
      }, { merge: true });
      transaction.set(lock, { updatedAt: now });
    });
    await auth.setCustomUserClaims(targetUid, {
      ...(targetUser.customClaims || {}), role: payload.role, appUserId: appIdFor(targetUid, targetUser, config),
    });
    if (payload.role === 'agent') await auth.revokeRefreshTokens(targetUid);
    return { uid: targetUid, role: payload.role };
  };

  const convertLead = async (req) => {
    const decoded = await authenticate(req);
    const payload = parseBody(req);
    if (!validId(payload.leadId) || (payload.createProject !== undefined && typeof payload.createProject !== 'boolean')) {
      throw createHttpError(400, 'A valid leadId and createProject flag are required.');
    }
    const leadId = payload.leadId.trim();
    const createProject = payload.createProject === true;
    const projectName = text(payload.projectName);
    const location = text(payload.location);
    const industry = text(payload.industry);
    const packageId = text(payload.packageId, 100);
    const pkg = Object.hasOwn(PACKAGE_CATALOG, packageId) ? PACKAGE_CATALOG[packageId] : null;
    if (createProject && (!projectName || !pkg)) throw createHttpError(400, 'Choose a valid package and project name.');
    const config = getIdentityConfig();
    const leadRef = db.collection('leads').doc(leadId);
    const stableId = crypto.createHash('sha256').update(leadId).digest('hex');
    const defaultClientRef = db.collection('clients').doc(`lead_${stableId}`);
    const defaultProjectRef = db.collection('projects').doc(`lead_${stableId}`);
    const activityRef = db.collection('activities').doc(`lead_conversion_${stableId}`);
    return db.runTransaction(async (transaction) => {
      const profile = await transaction.get(db.collection('users').doc(decoded.uid));
      const leadSnapshot = await transaction.get(leadRef);
      if (!leadSnapshot.exists) throw createHttpError(404, 'Lead not found.');
      const lead = leadSnapshot.data();
      if (lead._deleting) throw createHttpError(409, 'This lead is being deleted. Finish deletion before converting it.');
      const keys = new Set([decoded.uid]);
      if (validId(decoded.appUserId)) keys.add(decoded.appUserId);
      if (Object.hasOwn(config.legacyIds, decoded.uid)) keys.add(config.legacyIds[decoded.uid]);
      const isOwner = decoded.role === 'owner' && ownerAuthorized(decoded.uid, profile.data(), config);
      if (!isOwner && !keys.has(lead.assignedTo)) throw createHttpError(403, 'You do not have access to this lead.');

      // Every read precedes the first write, including client + project creation.
      const linkedClients = await transaction.get(db.collection('clients').where('leadId', '==', leadId).limit(2));
      if (linkedClients.docs.length > 1) throw createHttpError(409, 'This lead has duplicate clients. Ask an owner to resolve them.');
      let clientRef = linkedClients.docs[0]?.ref || defaultClientRef;
      if (lead.clientId) {
        if (!validId(lead.clientId)) throw createHttpError(409, 'This lead has an invalid client link.');
        clientRef = db.collection('clients').doc(lead.clientId);
      }
      let clientSnapshot = await transaction.get(clientRef);
      if (linkedClients.docs[0] && linkedClients.docs[0].id !== clientRef.id) {
        // A stale pointer must not cause a second client to be created. Only
        // repair it if its target is absent and there is one verified lead link.
        if (clientSnapshot.exists) throw createHttpError(409, 'This lead has conflicting client links.');
        clientRef = linkedClients.docs[0].ref;
        clientSnapshot = await transaction.get(clientRef);
      }
      if (clientSnapshot.data()?._deleting) throw createHttpError(409, 'The linked client is being deleted.');
      if (clientSnapshot.exists && clientSnapshot.data().leadId !== leadId) throw createHttpError(409, 'The client is linked to another lead.');
      // Recreate a missing client at the original ID so surviving projects and
      // invoices retain their links. Restore access from actual live projects.
      const recoveredProjectAccess = new Map();
      if (!clientSnapshot.exists) {
        const existingProjects = await transaction.get(db.collection('projects').where('clientId', '==', clientRef.id));
        for (const project of existingProjects.docs) {
          const data = project.data();
          if (!data._deleting && validId(data.assignedTo)) {
            recoveredProjectAccess.set(data.assignedTo, project.id);
          }
        }
      }
      const previousActivity = await transaction.get(activityRef);
      let projectRef;
      let projectSnapshot;
      if (createProject) {
        const previousProjectId = previousActivity.data()?.metadata?.projectId;
        projectRef = validId(previousProjectId) ? db.collection('projects').doc(previousProjectId) : defaultProjectRef;
        projectSnapshot = await transaction.get(projectRef);
        if (!projectSnapshot.exists && !previousProjectId) {
          const historicalProjects = await transaction.get(db.collection('projects')
            .where('clientId', '==', clientRef.id).where('name', '==', projectName).limit(1));
          if (historicalProjects.docs[0]) { projectSnapshot = historicalProjects.docs[0]; projectRef = projectSnapshot.ref; }
        }
        if (projectSnapshot.exists && projectSnapshot.data().clientId !== clientRef.id) throw createHttpError(409, 'The conversion project is linked to another client.');
        if (projectSnapshot.data()?._deleting) throw createHttpError(409, 'The linked project is being deleted.');
        if (previousProjectId && !projectSnapshot.exists) throw createHttpError(409, 'The conversion project was removed.');
      }
      const now = new Date().toISOString();
      if (createProject) {
        const projectAgent = projectSnapshot.data()?.assignedTo || lead.assignedTo || decoded.uid;
        recoveredProjectAccess.set(projectAgent, projectRef.id);
      }
      if (!clientSnapshot.exists) transaction.set(clientRef, {
        businessName: lead.businessName || 'New client', ownerName: lead.contactName || '',
        email: lead.email || '', phone: lead.phone || '', location, industry,
        contractSigned: false, onboardingCompleted: false, leadId, createdBy: decoded.uid,
        visibleTo: lead.assignedTo ? [lead.assignedTo] : [],
        projectAccess: Object.fromEntries(recoveredProjectAccess), createdAt: now, updatedAt: now,
      });
      if (createProject && clientSnapshot.exists) {
        const projectAgent = projectSnapshot.data()?.assignedTo || lead.assignedTo || decoded.uid;
        const projectAccess = clientSnapshot.data().projectAccess || {};
        if (projectAccess[projectAgent] !== projectRef.id) transaction.update(clientRef, {
          projectAccess: { ...projectAccess, [projectAgent]: projectRef.id },
        });
      }
      if (createProject && !projectSnapshot.exists) transaction.set(projectRef, {
        name: projectName, clientId: clientRef.id, packageId, packageName: pkg.name, packagePrice: pkg.price,
        status: 'not-started', milestones: pkg.features.map((title, index) => ({
          id: `m-${index + 1}`, title, description: null, isCompleted: false, completedAt: null,
        })),
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString(), startDate: now,
        assignedTo: lead.assignedTo || decoded.uid, notes: '', createdBy: decoded.uid, createdAt: now, updatedAt: now,
      });
      if (lead.stage !== 'won' || lead.clientId !== clientRef.id) transaction.update(leadRef, { stage: 'won', clientId: clientRef.id, updatedAt: now });
      const previousProjectId = previousActivity.data()?.metadata?.projectId;
      if (!previousActivity.exists || previousActivity.data()?.metadata?.clientId !== clientRef.id
        || (createProject && !previousProjectId)) transaction.set(activityRef, {
        type: 'status-change', entityType: 'lead', entityId: leadId, description: 'Lead converted to client',
        metadata: { to: 'won', clientId: clientRef.id, projectId: projectRef?.id || previousProjectId || null },
        createdAt: previousActivity.data()?.createdAt || now, createdBy: previousActivity.data()?.createdBy || decoded.uid,
      });
      return { leadId, clientId: clientRef.id, ...(projectRef ? { projectId: projectRef.id } : {}) };
    });
  };
  const route = (operation, fallback) => async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try { return json(res, 200, await operation(req)); } catch (error) {
      // Log only the operation and code: SDK messages can contain configuration
      // or private data. Give callers actionable, bounded diagnostics instead.
      console.error('[Migration API]', operation.name, { code: error.code, status: error.status });
      const firestoreMessages = {
        7: 'The server cannot access Firebase. Check the Firebase Admin service account permissions in Vercel.',
        8: 'Firebase usage limits have been reached. Check your Firestore quota and retry after it resets.',
        14: 'Firebase is temporarily unavailable. Please retry shortly.',
      };
      if (firestoreMessages[error.code]) return json(res, 503, { error: firestoreMessages[error.code] });
      if (error.code === 9 && /index/i.test(error.message || '')) {
        return json(res, 503, { error: 'Lead conversion needs a Firestore index. Check the failed request in Vercel logs and your Firestore indexes.' });
      }
      const status = Number.isInteger(error.status) ? error.status : 500;
      return json(res, status, { error: status < 500 ? error.message : fallback });
    }
  };
  return {
    authenticate,
    requireOwner,
    ensureRole: route(ensureRole, 'Role recovery is unavailable. Check the Vercel Firebase Admin configuration.'),
    setRole: route(setRole, 'The role update could not be completed. Retry or ask the user to sign in again to synchronize their role.'),
    convertLead: route(convertLead, 'Lead conversion could not be completed. Please retry.'),
  };
};
