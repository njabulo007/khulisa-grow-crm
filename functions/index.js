const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const OWNER_EMAILS = new Set(['njabulo@khulisamedia.co.za', 'njabulod007@gmail.com']);
const PROJECT_SHARES_COLLECTION = 'project_shares';
const PROJECTS_COLLECTION = 'projects';
const CLIENTS_COLLECTION = 'clients';

const nowIso = () => new Date().toISOString();

const parseOptionalIsoDate = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const getRoleFromUserDoc = (data) => {
  if (!data || typeof data !== 'object') return null;
  const rawRole = data.role || data.userRole || data.Role || data.user_role;
  if (rawRole === 'owner' || rawRole === 'agent') return rawRole;
  return null;
};

const deriveRoleForUser = async (uid) => {
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      const role = getRoleFromUserDoc(userDoc.data() || {});
      if (role) return role;
    }
  } catch (error) {
    logger.warn('Failed to read users/{uid} profile when deriving role.', { uid, error: String(error) });
  }

  try {
    const authUser = await admin.auth().getUser(uid);
    const normalizedEmail = typeof authUser.email === 'string' ? authUser.email.trim().toLowerCase() : '';
    if (OWNER_EMAILS.has(normalizedEmail)) return 'owner';
  } catch (error) {
    logger.warn('Failed to read Firebase Auth user when deriving role.', { uid, error: String(error) });
  }

  return 'agent';
};

const requireOwner = async (request) => {
  if (!request.auth || typeof request.auth.uid !== 'string' || !request.auth.uid.trim()) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  const uid = request.auth.uid.trim();
  const role = await deriveRoleForUser(uid);
  if (role !== 'owner') {
    throw new HttpsError('permission-denied', 'Only owners can manage client share links.');
  }
  return { uid, role };
};

const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

const sanitizeMilestones = (milestones) => {
  if (!Array.isArray(milestones)) return [];
  return milestones.map((milestone, index) => {
    const entry = milestone && typeof milestone === 'object' ? milestone : {};
    const title = typeof entry.title === 'string' && entry.title.trim()
      ? entry.title.trim()
      : typeof entry.name === 'string' && entry.name.trim()
        ? entry.name.trim()
        : `Milestone ${index + 1}`;
    const isCompleted = entry.isCompleted === true || entry.completed === true;
    const completedAt = parseOptionalIsoDate(entry.completedAt);
    const description = typeof entry.description === 'string' ? entry.description.trim() : '';
    return {
      id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `m-${index + 1}`,
      title,
      description: description || null,
      isCompleted,
      completedAt: completedAt || null,
    };
  });
};

const isProjectClosed = (status) => status === 'completed' || status === 'delivered';

const buildLinkFromNotification = (notification) => {
  if (typeof notification.invoiceId === 'string' && notification.invoiceId) return `/invoices/${notification.invoiceId}`;
  if (typeof notification.clientId === 'string' && notification.clientId) return `/clients/${notification.clientId}`;
  if (typeof notification.projectId === 'string' && notification.projectId) return `/projects/${notification.projectId}`;
  if (typeof notification.leadId === 'string' && notification.leadId) return `/leads/${notification.leadId}`;
  return '/';
};

exports.sendWebPushOnNotificationCreate = onDocumentCreated('notifications/{notificationId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const payload = snapshot.data();
  const userId = payload.userId;
  if (typeof userId !== 'string' || !userId.trim()) {
    logger.warn('Skipping push: missing userId', { notificationId: event.params.notificationId });
    return;
  }

  const tokenSnapshot = await db.collection('push_tokens').where('userId', '==', userId).get();
  if (tokenSnapshot.empty) {
    logger.info('No push tokens registered for user', { userId });
    return;
  }

  const tokens = tokenSnapshot.docs
    .map((doc) => doc.data().token)
    .filter((value) => typeof value === 'string' && value.length > 0);

  if (tokens.length === 0) return;

  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'Khulisa CRM';
  const body = typeof payload.message === 'string' && payload.message ? payload.message : 'You have a new notification.';
  const link = buildLinkFromNotification(payload);

  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title,
      body,
    },
    data: {
      notificationId: event.params.notificationId || '',
      type: typeof payload.type === 'string' ? payload.type : 'general',
      link,
    },
    webpush: {
      headers: {
        Urgency: 'high',
      },
      notification: {
        title,
        body,
        icon: '/images/khulisa-logo-icon.png',
        badge: '/images/khulisa-logo-icon.png',
        tag: `khulisa-${event.params.notificationId}`,
        renotify: true,
        requireInteraction: true,
        silent: false,
        data: { link },
      },
      fcmOptions: {
        link,
      },
    },
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
      },
    },
  });

  const cleanupTasks = [];
  response.responses.forEach((result, index) => {
    if (!result.success && result.error) {
      const code = result.error.code || '';
      const token = tokens[index];
      if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
        cleanupTasks.push(
          db.collection('push_tokens').where('token', '==', token).get().then((staleDocs) => {
            const batch = db.batch();
            staleDocs.docs.forEach((doc) => batch.delete(doc.ref));
            return batch.commit();
          })
        );
      }
      logger.warn('Push send failed for token', { code });
    }
  });

  if (cleanupTasks.length > 0) {
    await Promise.all(cleanupTasks);
  }
});

exports.revokeProjectSharesWhenProjectClosed = onDocumentUpdated('projects/{projectId}', async (event) => {
  const before = event.data && event.data.before ? event.data.before.data() || {} : {};
  const after = event.data && event.data.after ? event.data.after.data() || {} : {};
  const beforeStatus = typeof before.status === 'string' ? before.status : '';
  const afterStatus = typeof after.status === 'string' ? after.status : '';
  const projectId = event.params.projectId;
  if (!projectId) return;

  if (!isProjectClosed(afterStatus) || isProjectClosed(beforeStatus)) {
    return;
  }

  const sharesSnapshot = await db.collection(PROJECT_SHARES_COLLECTION).where('projectId', '==', projectId).get();
  if (sharesSnapshot.empty) return;

  const now = nowIso();
  const batch = db.batch();
  sharesSnapshot.docs.forEach((docSnapshot) => {
    const share = docSnapshot.data() || {};
    const isActive = share.status === 'active' && !share.revokedAt;
    if (!isActive) return;
    batch.update(docSnapshot.ref, {
      status: 'expired',
      revokedAt: now,
      revokedBy: 'system:project-closed',
      updatedAt: now,
    });
  });
  await batch.commit();
});

exports.createProjectShare = onCall(async (request) => {
  const { uid } = await requireOwner(request);
  const payload = request.data && typeof request.data === 'object' ? request.data : {};
  const projectId = typeof payload.projectId === 'string' ? payload.projectId.trim() : '';
  const requestedExpiry = parseOptionalIsoDate(payload.expiresAt);

  if (!projectId) {
    throw new HttpsError('invalid-argument', 'projectId is required.');
  }

  const projectRef = db.collection(PROJECTS_COLLECTION).doc(projectId);
  const projectSnapshot = await projectRef.get();
  if (!projectSnapshot.exists) {
    throw new HttpsError('not-found', 'Project not found.');
  }

  const project = projectSnapshot.data() || {};
  const projectStatus = typeof project.status === 'string' ? project.status : 'not-started';
  if (isProjectClosed(projectStatus)) {
    throw new HttpsError('failed-precondition', 'Cannot create links for completed/delivered projects.');
  }

  const clientId = typeof project.clientId === 'string' ? project.clientId.trim() : '';
  if (!clientId) {
    throw new HttpsError('failed-precondition', 'Project has no linked client.');
  }

  const clientSnapshot = await db.collection(CLIENTS_COLLECTION).doc(clientId).get();
  if (!clientSnapshot.exists) {
    throw new HttpsError('failed-precondition', 'Linked client record is missing.');
  }

  const now = nowIso();
  const expiresAt = requestedExpiry || new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  if (new Date(expiresAt).getTime() <= Date.now()) {
    throw new HttpsError('invalid-argument', 'Expiry date must be in the future.');
  }

  // Keep one active share per project: revoke any existing active shares.
  const existingShares = await db.collection(PROJECT_SHARES_COLLECTION).where('projectId', '==', projectId).get();
  if (!existingShares.empty) {
    const batch = db.batch();
    existingShares.docs.forEach((docSnapshot) => {
      const data = docSnapshot.data() || {};
      const isActive = data.status === 'active' && !data.revokedAt;
      if (!isActive) return;
      batch.update(docSnapshot.ref, {
        status: 'revoked',
        revokedAt: now,
        revokedBy: uid,
        updatedAt: now,
      });
    });
    await batch.commit();
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const shareRef = db.collection(PROJECT_SHARES_COLLECTION).doc();
  await shareRef.set({
    projectId,
    clientId,
    tokenHash: tokenHash(rawToken),
    status: 'active',
    expiresAt,
    revokedAt: null,
    revokedBy: null,
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
    lastViewedAt: null,
  });

  return {
    shareId: shareRef.id,
    token: rawToken,
    projectId,
    clientId,
    expiresAt,
    status: 'active',
  };
});

exports.listProjectShares = onCall(async (request) => {
  await requireOwner(request);
  const payload = request.data && typeof request.data === 'object' ? request.data : {};
  const projectId = typeof payload.projectId === 'string' ? payload.projectId.trim() : '';
  if (!projectId) {
    throw new HttpsError('invalid-argument', 'projectId is required.');
  }

  const snapshot = await db.collection(PROJECT_SHARES_COLLECTION).where('projectId', '==', projectId).get();
  const nowMs = Date.now();
  const shares = snapshot.docs
    .map((docSnapshot) => {
      const data = docSnapshot.data() || {};
      const expiresAt = parseOptionalIsoDate(data.expiresAt);
      const revokedAt = parseOptionalIsoDate(data.revokedAt);
      const createdAt = parseOptionalIsoDate(data.createdAt);
      const lastViewedAt = parseOptionalIsoDate(data.lastViewedAt);
      const status = typeof data.status === 'string' ? data.status : 'active';
      const isExpired = !!expiresAt && new Date(expiresAt).getTime() <= nowMs;
      return {
        id: docSnapshot.id,
        projectId: typeof data.projectId === 'string' ? data.projectId : '',
        clientId: typeof data.clientId === 'string' ? data.clientId : '',
        status: isExpired && status === 'active' ? 'expired' : status,
        expiresAt,
        revokedAt,
        createdAt,
        lastViewedAt,
      };
    })
    .sort((a, b) => {
      const aMs = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bMs = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bMs - aMs;
    });

  return { shares };
});

exports.revokeProjectShare = onCall(async (request) => {
  const { uid } = await requireOwner(request);
  const payload = request.data && typeof request.data === 'object' ? request.data : {};
  const shareId = typeof payload.shareId === 'string' ? payload.shareId.trim() : '';
  if (!shareId) {
    throw new HttpsError('invalid-argument', 'shareId is required.');
  }

  const shareRef = db.collection(PROJECT_SHARES_COLLECTION).doc(shareId);
  const snapshot = await shareRef.get();
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'Share link not found.');
  }

  const now = nowIso();
  await shareRef.update({
    status: 'revoked',
    revokedAt: now,
    revokedBy: uid,
    updatedAt: now,
  });

  return { ok: true, shareId };
});

exports.resolveProjectShare = onCall(async (request) => {
  const payload = request.data && typeof request.data === 'object' ? request.data : {};
  const token = typeof payload.token === 'string' ? payload.token.trim() : '';
  if (!token) {
    throw new HttpsError('invalid-argument', 'token is required.');
  }

  const snapshot = await db
    .collection(PROJECT_SHARES_COLLECTION)
    .where('tokenHash', '==', tokenHash(token))
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new HttpsError('not-found', 'Share link is invalid.');
  }

  const shareDoc = snapshot.docs[0];
  const share = shareDoc.data() || {};
  const status = typeof share.status === 'string' ? share.status : 'active';
  const expiresAt = parseOptionalIsoDate(share.expiresAt);
  const revokedAt = parseOptionalIsoDate(share.revokedAt);
  if (status !== 'active' || revokedAt) {
    throw new HttpsError('permission-denied', 'Share link is no longer active.');
  }

  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    await shareDoc.ref.update({
      status: 'expired',
      updatedAt: nowIso(),
    });
    throw new HttpsError('permission-denied', 'Share link has expired.');
  }

  const projectId = typeof share.projectId === 'string' ? share.projectId : '';
  if (!projectId) {
    throw new HttpsError('failed-precondition', 'Share link is missing project reference.');
  }

  const projectSnapshot = await db.collection(PROJECTS_COLLECTION).doc(projectId).get();
  if (!projectSnapshot.exists) {
    throw new HttpsError('not-found', 'Linked project no longer exists.');
  }
  const project = projectSnapshot.data() || {};
  const projectStatus = typeof project.status === 'string' ? project.status : 'not-started';
  if (isProjectClosed(projectStatus)) {
    await shareDoc.ref.update({
      status: 'expired',
      updatedAt: nowIso(),
    });
    throw new HttpsError('permission-denied', 'Project has been closed. This link is no longer available.');
  }

  const clientId = typeof project.clientId === 'string' ? project.clientId : '';
  if (!clientId) {
    throw new HttpsError('failed-precondition', 'Project is missing linked client.');
  }
  const clientSnapshot = await db.collection(CLIENTS_COLLECTION).doc(clientId).get();
  if (!clientSnapshot.exists) {
    throw new HttpsError('not-found', 'Linked client no longer exists.');
  }
  const client = clientSnapshot.data() || {};

  await shareDoc.ref.update({
    lastViewedAt: nowIso(),
    updatedAt: nowIso(),
  });

  return {
    share: {
      id: shareDoc.id,
      expiresAt,
      status: 'active',
    },
    client: {
      id: clientSnapshot.id,
      businessName: typeof client.businessName === 'string' ? client.businessName : 'Client',
    },
    project: {
      id: projectSnapshot.id,
      name: typeof project.name === 'string' ? project.name : 'Project',
      status: projectStatus,
      packageName: typeof project.packageName === 'string' ? project.packageName : null,
      packageId: typeof project.packageId === 'string' ? project.packageId : null,
      startDate: parseOptionalIsoDate(project.startDate),
      dueDate: parseOptionalIsoDate(project.dueDate),
      notes: typeof project.notes === 'string' ? project.notes : '',
      driveLink: typeof project.driveLink === 'string' ? project.driveLink : null,
      milestones: sanitizeMilestones(project.milestones),
      updatedAt: parseOptionalIsoDate(project.updatedAt),
    },
  };
});
