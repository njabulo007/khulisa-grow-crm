const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
// Owner recovery uses server-configured UIDs, never an unverified email.
const OWNER_UIDS = new Set((process.env.CRM_OWNER_UIDS || '').split(',').map(uid => uid.trim()).filter(Boolean));
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

const findUserProfile = async (uid) => {
  const directSnapshot = await db.collection('users').doc(uid).get();
  let fallbackProfile = null;
  if (directSnapshot.exists) {
    const directProfile = { id: directSnapshot.id, data: directSnapshot.data() || {} };
    if (getRoleFromUserDoc(directProfile.data)) return directProfile;
    fallbackProfile = directProfile;
  }

  const authUser = await admin.auth().getUser(uid);
  const lookupQueries = [
    db.collection('users').where('uid', '==', uid).limit(1),
    db.collection('users').where('appUserId', '==', uid).limit(1),
  ];
  if (typeof authUser.email === 'string' && authUser.email.trim()) {
    lookupQueries.push(db.collection('users').where('email', '==', authUser.email.trim().toLowerCase()).limit(1));
  }

  for (const lookupQuery of lookupQueries) {
    const snapshot = await lookupQuery.get();
    if (!snapshot.empty) {
      const profile = { id: snapshot.docs[0].id, data: snapshot.docs[0].data() || {} };
      if (getRoleFromUserDoc(profile.data)) return profile;
      fallbackProfile = fallbackProfile || profile;
    }
  }
  return fallbackProfile;
};

const deriveRoleForUser = async (uid) => {
  const authUser = await admin.auth().getUser(uid);
  if (authUser.disabled) throw new HttpsError('permission-denied', 'CRM access is unavailable.');
  if (OWNER_UIDS.has(uid)) return 'owner';
  const profile = await db.collection('users').doc(uid).get();
  const role = getRoleFromUserDoc(profile.data()) || getRoleFromUserDoc(authUser.customClaims);
  if (role) return role;
  throw new HttpsError('permission-denied', 'CRM access is invitation-only. Ask the owner for an invitation.');
};

const requireOwner = async (request) => {
  if (!request.auth || typeof request.auth.uid !== 'string' || !request.auth.uid.trim()) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  const uid = request.auth.uid.trim();
  const claimedRole = request.auth.token && request.auth.token.role;
  const role = claimedRole === 'owner' ? 'owner' : await deriveRoleForUser(uid);
  if (role !== 'owner') {
    throw new HttpsError('permission-denied', 'Only owners can manage client share links.');
  }
  return { uid, role };
};

const requireAuth = (request) => {
  if (!request.auth || typeof request.auth.uid !== 'string' || !request.auth.uid.trim()) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  return request.auth.uid.trim();
};

const PACKAGE_CATALOG = {
  'digital-starter-presence': {
    name: 'Digital Starter Presence',
    price: 1500,
    features: [
      '1 page website or landing page',
      'Google My Business setup (Basic)',
      'Basic branding refresh (logo touch-up if needed)',
      'WhatsApp button for direct enquiries',
      '1 flyer or promo graphic',
    ],
  },
  'local-growth-engine': {
    name: 'Local Growth Engine',
    price: 3500,
    features: [
      '4-5 page website',
      'Full Google My Business optimisation',
      'Local SEO setup',
      'Facebook page refresh or setup',
      'Product/Business Photography - Image Optimisation',
      'Contact forms & WhatsApp integration',
      'Professional Email Activation - yourname@yourbusiness.co.za',
    ],
  },
  'business-brand-expansion': {
    name: 'Business Brand Expansion (Premium)',
    price: 6500,
    features: [
      'Paid Facebook advertising management',
      'R1,500 ad spend included',
      'Campaign setup, targeting, and optimisation',
      'Conversion tracking & performance summary',
    ],
  },
};

const createProjectMilestones = (packageId) => {
  const pkg = PACKAGE_CATALOG[packageId];
  return pkg.features.map((feature, index) => ({
    id: `m-${index + 1}`,
    title: feature,
    description: null,
    isCompleted: false,
    completedAt: null,
  }));
};

const currentUserKeys = async (uid) => {
  const profile = await findUserProfile(uid);
  const appUserId = profile && typeof profile.data.appUserId === 'string'
    ? profile.data.appUserId.trim()
    : profile && profile.id !== uid ? profile.id : '';
  return new Set([uid, appUserId].filter(Boolean));
};

const isUserKey = (value, keys) => typeof value === 'string' && keys.has(value);

const roundCurrency = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const getInvoiceTotal = (invoice, project) => {
  const packageId = project && typeof project.packageId === 'string'
    ? project.packageId
    : typeof invoice.packageId === 'string' ? invoice.packageId : '';
  const pkg = PACKAGE_CATALOG[packageId];
  if (pkg) return roundCurrency(pkg.price);
  if (Array.isArray(invoice.items)) {
    const itemTotal = invoice.items.reduce((sum, item) => sum + Number(item.total || 0), 0);
    if (itemTotal > 0) return roundCurrency(itemTotal);
  }
  return roundCurrency(invoice.total || invoice.subtotal || 0);
};

const getInvoiceStatus = (invoice, total, amountPaid) => {
  const balance = Math.max(roundCurrency(total - amountPaid), 0);
  if (balance <= 0) return 'paid';
  if (amountPaid > 0) return 'partially-paid';
  if (invoice.status === 'draft') return 'draft';
  if (invoice.dueDate && new Date(invoice.dueDate).getTime() < Date.now()) return 'overdue';
  return 'sent';
};

const resolveInvoiceAgent = async (invoice, project) => {
  if (project && typeof project.assignedTo === 'string' && project.assignedTo.trim()) {
    return project.assignedTo.trim();
  }
  const clientId = typeof invoice.clientId === 'string' ? invoice.clientId.trim() : '';
  if (!clientId) return null;
  const clientSnapshot = await db.collection(CLIENTS_COLLECTION).doc(clientId).get();
  const leadId = clientSnapshot.exists && clientSnapshot.data().leadId;
  if (!leadId) return null;
  const leadSnapshot = await db.collection('leads').doc(leadId).get();
  return leadSnapshot.exists && typeof leadSnapshot.data().assignedTo === 'string'
    ? leadSnapshot.data().assignedTo
    : null;
};

const getUserProfileForAppId = async (appUserId) => {
  if (!appUserId) return null;
  const byId = await db.collection('users').doc(appUserId).get();
  if (byId.exists) return byId.data() || {};
  const snapshot = await db.collection('users').where('appUserId', '==', appUserId).limit(1).get();
  return snapshot.empty ? null : snapshot.docs[0].data() || {};
};

const syncCommissionForInvoice = async (invoice, project) => {
  const agentId = await resolveInvoiceAgent(invoice, project);
  const packageId = project && typeof project.packageId === 'string'
    ? project.packageId
    : typeof invoice.packageId === 'string' ? invoice.packageId : '';
  const pkg = PACKAGE_CATALOG[packageId];
  if (!agentId || !pkg) return;

  const agentProfile = await getUserProfileForAppId(agentId);
  const agentEmail = typeof agentProfile?.email === 'string' ? agentProfile.email.toLowerCase() : '';
  const settingsSnapshot = await db.collection('settings').doc('global').get();
  const settings = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
  const [paidInvoices, agentProjects] = await Promise.all([
    db.collection('invoices').where('status', '==', 'paid').get(),
    db.collection(PROJECTS_COLLECTION).where('assignedTo', '==', agentId).get(),
  ]);
  const agentProjectIds = new Set(agentProjects.docs.map((entry) => entry.id));
  const paidSalesCount = paidInvoices.docs.filter((entry) => agentProjectIds.has(entry.data().projectId)).length;
  const defaultRate = agentEmail === 'njabulo@gmail.com'
    ? 0.3
    : paidSalesCount > 6 ? 0.2 : 0.15;
  const manualRate = Number(agentProfile?.commissionRate);
  const rate = settings.commissionMode === 'manual' && Number.isFinite(manualRate)
    ? Math.max(0, Math.min(100, manualRate <= 1 ? manualRate : manualRate / 100))
    : defaultRate;
  const status = invoice.status === 'paid' ? 'earned' : 'pending';
  const commissionSnapshot = await db.collection('commissions').where('invoiceId', '==', invoice.id).limit(1).get();
  const payload = {
    agentId,
    invoiceId: invoice.id,
    projectId: invoice.projectId || null,
    packageId,
    packageName: pkg.name,
    packagePrice: pkg.price,
    commissionAmount: roundCurrency(pkg.price * rate),
    rate,
    status: commissionSnapshot.empty ? status : commissionSnapshot.docs[0].data().status === 'paid-out'
      ? 'paid-out'
      : status,
    earnedDate: status === 'earned'
      ? (commissionSnapshot.empty ? nowIso() : commissionSnapshot.docs[0].data().earnedDate || nowIso())
      : commissionSnapshot.empty ? null : commissionSnapshot.docs[0].data().earnedDate || null,
    updatedAt: nowIso(),
  };

  if (commissionSnapshot.empty) {
    await db.collection('commissions').doc().set({ ...payload, createdAt: nowIso() });
  } else {
    await commissionSnapshot.docs[0].ref.set(payload, { merge: true });
  }
};

const reconcileInvoiceFromPayments = async (invoiceId) => {
  if (!invoiceId) return;
  const invoiceRef = db.collection('invoices').doc(invoiceId);
  const invoiceSnapshot = await invoiceRef.get();
  if (!invoiceSnapshot.exists) return;

  const invoice = invoiceSnapshot.data() || {};
  const projectSnapshot = invoice.projectId
    ? await db.collection(PROJECTS_COLLECTION).doc(invoice.projectId).get()
    : null;
  const project = projectSnapshot && projectSnapshot.exists ? { id: projectSnapshot.id, ...projectSnapshot.data() } : null;
  const paymentsSnapshot = await db.collection('payments').where('invoiceId', '==', invoiceId).get();
  const amountPaid = roundCurrency(paymentsSnapshot.docs.reduce((sum, entry) => sum + Number(entry.data().amount || 0), 0));
  const total = getInvoiceTotal(invoice, project);
  const status = getInvoiceStatus(invoice, total, amountPaid);

  if (roundCurrency(invoice.amountPaid || 0) !== amountPaid || invoice.status !== status) {
    await invoiceRef.set({ amountPaid, status, updatedAt: nowIso() }, { merge: true });
  }
  await syncCommissionForInvoice({ id: invoiceId, ...invoice, amountPaid, status }, project);
};

const invoiceSyncFields = ['projectId', 'clientId', 'packageId', 'total', 'subtotal', 'status', 'dueDate'];
const invoiceNeedsReconciliation = (before, after) => invoiceSyncFields.some((field) => before[field] !== after[field]);

const reconcilePaymentChange = async (before, after) => {
  const invoiceIds = new Set([
    before && before.invoiceId,
    after && after.invoiceId,
  ].filter((value) => typeof value === 'string' && value));
  await Promise.all(Array.from(invoiceIds).map((invoiceId) => reconcileInvoiceFromPayments(invoiceId)));
};

const backfillClientVisibility = async () => {
  const projectsSnapshot = await db.collection(PROJECTS_COLLECTION).get();
  const visibilityByClient = new Map();
  projectsSnapshot.docs.forEach((projectSnapshot) => {
    const project = projectSnapshot.data() || {};
    const clientId = typeof project.clientId === 'string' ? project.clientId.trim() : '';
    const assignedTo = typeof project.assignedTo === 'string' ? project.assignedTo.trim() : '';
    if (!clientId || !assignedTo) return;
    const current = visibilityByClient.get(clientId) || new Set();
    current.add(assignedTo);
    visibilityByClient.set(clientId, current);
  });

  let batch = db.batch();
  let operationCount = 0;
  for (const [clientId, agentIds] of visibilityByClient.entries()) {
    const clientRef = db.collection(CLIENTS_COLLECTION).doc(clientId);
    batch.set(clientRef, {
      visibleTo: Array.from(agentIds),
      updatedAt: nowIso(),
    }, { merge: true });
    operationCount += 1;
    if (operationCount >= 400) {
      await batch.commit();
      batch = db.batch();
      operationCount = 0;
    }
  }
  if (operationCount > 0) await batch.commit();
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

const REMINDER_TIME_ZONE = 'Africa/Johannesburg';
const REMINDER_WINDOW_DAYS = 7;

const getDateKey = (value, timeZone = REMINDER_TIME_ZONE) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const dateKeyDistance = (fromKey, toKey) => {
  if (!fromKey || !toKey) return null;
  const from = new Date(`${fromKey}T00:00:00Z`);
  const to = new Date(`${toKey}T00:00:00Z`);
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
};

const addDaysToDateKey = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const formatReminderDate = (dateKey) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? dateKey
    : new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
};

const getNotificationDocumentId = (userId, dedupeKey) => {
  let hash = 2166136261;
  for (const character of `${userId}:${dedupeKey}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `dedupe_${(hash >>> 0).toString(16)}`;
};

const resolveNotificationRecipients = async (userKey) => {
  if (typeof userKey !== 'string' || !userKey.trim()) return [];
  const normalizedKey = userKey.trim();
  const recipients = new Set([normalizedKey]);
  const directProfile = await db.collection('users').doc(normalizedKey).get();
  if (directProfile.exists) {
    const profile = directProfile.data() || {};
    if (typeof profile.appUserId === 'string' && profile.appUserId.trim()) recipients.add(profile.appUserId.trim());
  }
  const profileSnapshot = await db.collection('users').where('appUserId', '==', normalizedKey).limit(5).get();
  profileSnapshot.docs.forEach((profileSnapshot) => {
    recipients.add(profileSnapshot.id);
    const appUserId = profileSnapshot.data().appUserId;
    if (typeof appUserId === 'string' && appUserId.trim()) recipients.add(appUserId.trim());
  });
  return Array.from(recipients);
};

const createScheduledNotification = async (userKey, data) => {
  const recipients = await resolveNotificationRecipients(userKey);
  let created = 0;
  for (const recipientId of recipients) {
    const notificationRef = db.collection('notifications').doc(getNotificationDocumentId(recipientId, data.dedupeKey));
    try {
      await notificationRef.create({
        userId: recipientId,
        type: data.type,
        leadId: data.leadId || null,
        invoiceId: data.invoiceId || null,
        clientId: data.clientId || null,
        projectId: data.projectId || null,
        title: data.title,
        message: data.message,
        isRead: false,
        dedupeKey: data.dedupeKey,
        createdAt: nowIso(),
      });
      created += 1;
    } catch (error) {
      if (error.code !== 6 && error.code !== 'already-exists') throw error;
    }
  }
  return created;
};

exports.sendScheduledCrmReminders = onSchedule({
  schedule: '0 7 * * *',
  timeZone: REMINDER_TIME_ZONE,
  retryConfig: { retryCount: 3 },
}, async () => {
  const todayKey = getDateKey(new Date());
  if (!todayKey) return;
  const horizonKey = addDaysToDateKey(todayKey, REMINDER_WINDOW_DAYS);
  if (!horizonKey) return;
  const reminderCount = { leads: 0, projects: 0, invoices: 0 };
  const [leadsSnapshot, projectsSnapshot, invoicesSnapshot] = await Promise.all([
    db.collection('leads').where('followUpDate', '<=', `${horizonKey}T23:59:59.999Z`).get(),
    db.collection(PROJECTS_COLLECTION).where('dueDate', '<=', `${horizonKey}T23:59:59.999Z`).get(),
    db.collection('invoices').where('dueDate', '<=', `${todayKey}T23:59:59.999Z`).get(),
  ]);

  for (const leadSnapshot of leadsSnapshot.docs) {
    const lead = leadSnapshot.data() || {};
    if (lead.stage === 'won' || lead.stage === 'lost') continue;
    const dueKey = getDateKey(lead.followUpDate);
    const distance = dateKeyDistance(todayKey, dueKey);
    if (distance === null || distance > REMINDER_WINDOW_DAYS) continue;
    const overdue = distance < 0;
    const dueLabel = overdue ? `overdue since ${formatReminderDate(dueKey)}` : distance === 0 ? 'due today' : `due ${formatReminderDate(dueKey)}`;
    reminderCount.leads += await createScheduledNotification(lead.assignedTo, {
      type: 'lead_follow_up',
      leadId: leadSnapshot.id,
      title: overdue ? 'Lead follow-up overdue' : 'Lead follow-up reminder',
      message: `${lead.businessName || 'Lead'} follow-up is ${dueLabel}.`,
      dedupeKey: `scheduled-lead-follow-up:${leadSnapshot.id}:${dueKey}:${overdue ? 'overdue' : 'upcoming'}`,
    });
  }

  for (const projectSnapshot of projectsSnapshot.docs) {
    const project = projectSnapshot.data() || {};
    if (isProjectClosed(project.status)) continue;
    const dueKey = getDateKey(project.dueDate);
    const distance = dateKeyDistance(todayKey, dueKey);
    if (distance === null || distance > REMINDER_WINDOW_DAYS) continue;
    const overdue = distance < 0;
    const dueLabel = overdue ? `overdue since ${formatReminderDate(dueKey)}` : distance === 0 ? 'due today' : `due ${formatReminderDate(dueKey)}`;
    reminderCount.projects += await createScheduledNotification(project.assignedTo, {
      type: 'project_deadline',
      projectId: projectSnapshot.id,
      clientId: typeof project.clientId === 'string' ? project.clientId : undefined,
      title: overdue ? 'Project deadline overdue' : 'Project deadline reminder',
      message: `${project.name || 'Project'} is ${dueLabel}.`,
      dedupeKey: `scheduled-project-deadline:${projectSnapshot.id}:${dueKey}:${overdue ? 'overdue' : 'upcoming'}`,
    });
  }

  for (const invoiceSnapshot of invoicesSnapshot.docs) {
    const invoice = invoiceSnapshot.data() || {};
    if (invoice.status === 'paid' || invoice.status === 'draft') continue;
    const dueKey = getDateKey(invoice.dueDate);
    const distance = dateKeyDistance(todayKey, dueKey);
    if (distance === null || distance > 0) continue;
    const projectSnapshot = invoice.projectId
      ? await db.collection(PROJECTS_COLLECTION).doc(invoice.projectId).get()
      : null;
    const project = projectSnapshot && projectSnapshot.exists ? projectSnapshot.data() || {} : null;
    const agentId = await resolveInvoiceAgent(invoice, project);
    reminderCount.invoices += await createScheduledNotification(agentId, {
      type: 'invoice_due',
      invoiceId: invoiceSnapshot.id,
      clientId: typeof invoice.clientId === 'string' ? invoice.clientId : undefined,
      projectId: typeof invoice.projectId === 'string' ? invoice.projectId : undefined,
      title: distance < 0 ? 'Invoice overdue' : 'Invoice due today',
      message: `${invoice.invoiceNumber || 'Invoice'} is ${distance < 0 ? `overdue since ${formatReminderDate(dueKey)}` : 'due today'}.`,
      dedupeKey: `scheduled-invoice-due:${invoiceSnapshot.id}:${dueKey}:${distance < 0 ? 'overdue' : 'due'}`,
    });
  }

  logger.info('Scheduled CRM reminders processed.', reminderCount);
});

const buildLinkFromNotification = (notification) => {
  if (typeof notification.invoiceId === 'string' && notification.invoiceId) return `/invoices/${notification.invoiceId}`;
  if (typeof notification.clientId === 'string' && notification.clientId) return `/clients/${notification.clientId}`;
  if (typeof notification.projectId === 'string' && notification.projectId) return `/projects/${notification.projectId}`;
  if (typeof notification.leadId === 'string' && notification.leadId) return `/leads/${notification.leadId}`;
  return '/';
};

const resolvePushTokenUserIds = async (userKey) => {
  const normalizedKey = typeof userKey === 'string' ? userKey.trim() : '';
  if (!normalizedKey) return [];

  const userIds = new Set([normalizedKey]);
  const profileSnapshots = [];
  const directProfile = await db.collection('users').doc(normalizedKey).get();
  if (directProfile.exists) profileSnapshots.push(directProfile);

  const lookupValues = [normalizedKey];
  if (normalizedKey.includes('@')) lookupValues.push(normalizedKey.toLowerCase());
  const lookupQueries = [
    ...lookupValues.map((value) => db.collection('users').where('uid', '==', value).limit(5)),
    ...lookupValues.map((value) => db.collection('users').where('appUserId', '==', value).limit(5)),
    ...lookupValues
      .filter((value) => value.includes('@'))
      .map((value) => db.collection('users').where('email', '==', value.toLowerCase()).limit(5)),
  ];
  const lookupResults = await Promise.all(lookupQueries.map((lookupQuery) => lookupQuery.get()));
  lookupResults.forEach((snapshot) => profileSnapshots.push(...snapshot.docs));

  profileSnapshots.forEach((profileSnapshot) => {
    const profile = profileSnapshot.data() || {};
    userIds.add(profileSnapshot.id);
    ['uid', 'appUserId'].forEach((field) => {
      if (typeof profile[field] === 'string' && profile[field].trim()) userIds.add(profile[field].trim());
    });
  });

  return Array.from(userIds);
};

exports.sendWebPushOnNotificationCreate = onDocumentCreated('notifications/{notificationId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const payload = snapshot.data();
  if (payload.pushManagedBy === 'vercel') return;
  const userId = payload.userId;
  if (typeof userId !== 'string' || !userId.trim()) {
    logger.warn('Skipping push: missing userId', { notificationId: event.params.notificationId });
    return;
  }

  const userKeys = await resolvePushTokenUserIds(userId);
  const tokenSnapshots = await Promise.all(
    userKeys.map((userKey) => db.collection('push_tokens').where('userId', '==', userKey).get())
  );
  const tokenDocuments = new Map();
  tokenSnapshots.forEach((snapshot) => {
    snapshot.docs.forEach((tokenDocument) => tokenDocuments.set(tokenDocument.id, tokenDocument));
  });
  if (tokenDocuments.size === 0) {
    logger.info('No push tokens registered for user', { userId });
    return;
  }

  const tokens = Array.from(tokenDocuments.values())
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
        badge: '/images/khulisa-notification-badge.png',
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

exports.reconcileInvoiceAfterPaymentCreated = onDocumentCreated('payments/{paymentId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  await reconcileInvoiceFromPayments(snapshot.data().invoiceId);
});

exports.reconcileInvoiceAfterPaymentUpdated = onDocumentUpdated('payments/{paymentId}', async (event) => {
  const before = event.data && event.data.before ? event.data.before.data() || {} : {};
  const after = event.data && event.data.after ? event.data.after.data() || {} : {};
  await reconcilePaymentChange(before, after);
});

exports.reconcileInvoiceAfterPaymentDeleted = onDocumentDeleted('payments/{paymentId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  await reconcileInvoiceFromPayments(snapshot.data().invoiceId);
});

exports.reconcileInvoiceAfterCreated = onDocumentCreated('invoices/{invoiceId}', async (event) => {
  await reconcileInvoiceFromPayments(event.params.invoiceId);
});

exports.reconcileInvoiceAfterUpdated = onDocumentUpdated('invoices/{invoiceId}', async (event) => {
  const before = event.data && event.data.before ? event.data.before.data() || {} : {};
  const after = event.data && event.data.after ? event.data.after.data() || {} : {};
  if (invoiceNeedsReconciliation(before, after)) {
    await reconcileInvoiceFromPayments(event.params.invoiceId);
  }
});

exports.removeCommissionAfterInvoiceDeleted = onDocumentDeleted('invoices/{invoiceId}', async (event) => {
  const snapshot = await db.collection('commissions').where('invoiceId', '==', event.params.invoiceId).get();
  if (snapshot.empty) return;
  const batch = db.batch();
  snapshot.docs.forEach((commission) => batch.delete(commission.ref));
  await batch.commit();
});

exports.refreshClientVisibilityForProject = onDocumentCreated('projects/{projectId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  const project = snapshot.data() || {};
  const clientId = typeof project.clientId === 'string' ? project.clientId.trim() : '';
  const assignedTo = typeof project.assignedTo === 'string' ? project.assignedTo.trim() : '';
  if (!clientId || !assignedTo) return;
  const clientRef = db.collection(CLIENTS_COLLECTION).doc(clientId);
  const clientSnapshot = await clientRef.get();
  if (!clientSnapshot.exists) return;
  const visibleTo = Array.isArray(clientSnapshot.data().visibleTo) ? clientSnapshot.data().visibleTo : [];
  if (visibleTo.includes(assignedTo)) return;
  await clientRef.set({ visibleTo: [...visibleTo, assignedTo], updatedAt: nowIso() }, { merge: true });
});

exports.refreshClientVisibilityForProjectUpdated = onDocumentUpdated('projects/{projectId}', async (event) => {
  const snapshot = event.data && event.data.after;
  if (!snapshot) return;
  const project = snapshot.data() || {};
  const clientId = typeof project.clientId === 'string' ? project.clientId.trim() : '';
  const assignedTo = typeof project.assignedTo === 'string' ? project.assignedTo.trim() : '';
  if (!clientId || !assignedTo) return;
  const clientRef = db.collection(CLIENTS_COLLECTION).doc(clientId);
  const clientSnapshot = await clientRef.get();
  if (!clientSnapshot.exists) return;
  const visibleTo = Array.isArray(clientSnapshot.data().visibleTo) ? clientSnapshot.data().visibleTo : [];
  if (!visibleTo.includes(assignedTo)) {
    await clientRef.set({ visibleTo: [...visibleTo, assignedTo], updatedAt: nowIso() }, { merge: true });
  }
});

exports.ensureUserRole = onCall(async (request) => {
  const uid = requireAuth(request);
  const role = await deriveRoleForUser(uid);
  const authUser = await admin.auth().getUser(uid);
  const profile = await findUserProfile(uid);
  const profileData = profile?.data || {};
  const appUserId = typeof profileData.appUserId === 'string' && profileData.appUserId.trim()
    ? profileData.appUserId.trim()
    : profile && profile.id !== uid ? profile.id : uid;
  await admin.auth().setCustomUserClaims(uid, {
    ...(authUser.customClaims || {}),
    role,
  });
  await db.collection('users').doc(uid).set({
    uid,
    appUserId,
    email: authUser.email || profileData.email || null,
    displayName: typeof profileData.displayName === 'string'
      ? profileData.displayName
      : typeof profileData.name === 'string' ? profileData.name : authUser.displayName || null,
    role,
    updatedAt: nowIso(),
  }, { merge: true });
  if (role === 'owner') await backfillClientVisibility();
  return {
    role,
    appUserId,
    displayName: typeof profileData.displayName === 'string'
      ? profileData.displayName
      : typeof profileData.name === 'string' ? profileData.name : authUser.displayName || null,
  };
});

exports.setUserRole = onCall(async (request) => {
  const { uid: ownerUid } = await requireOwner(request);
  const payload = request.data && typeof request.data === 'object' ? request.data : {};
  const targetUid = typeof payload.uid === 'string' ? payload.uid.trim() : '';
  const role = payload.role === 'owner' || payload.role === 'agent' ? payload.role : '';

  if (!targetUid || !role) {
    throw new HttpsError('invalid-argument', 'A target user and valid role are required.');
  }
  if (targetUid === ownerUid) {
    throw new HttpsError('failed-precondition', 'You cannot change your own role.');
  }

  const targetUser = await admin.auth().getUser(targetUid);
  await admin.auth().setCustomUserClaims(targetUid, {
    ...(targetUser.customClaims || {}),
    role,
  });
  await db.collection('users').doc(targetUid).set({
    uid: targetUid,
    email: targetUser.email || null,
    displayName: targetUser.displayName || null,
    role,
    updatedAt: nowIso(),
  }, { merge: true });

  return { uid: targetUid, role };
});

exports.convertLead = onCall(async (request) => {
  const uid = requireAuth(request);
  const keys = await currentUserKeys(uid);
  const callerRole = request.auth.token && request.auth.token.role === 'owner'
    ? 'owner'
    : await deriveRoleForUser(uid);
  const payload = request.data && typeof request.data === 'object' ? request.data : {};
  const leadId = typeof payload.leadId === 'string' ? payload.leadId.trim() : '';
  const createProject = payload.createProject === true;
  const projectName = typeof payload.projectName === 'string' ? payload.projectName.trim() : '';
  const packageId = typeof payload.packageId === 'string' ? payload.packageId.trim() : '';
  const location = typeof payload.location === 'string' ? payload.location.trim() : '';
  const industry = typeof payload.industry === 'string' ? payload.industry.trim() : '';

  if (!leadId) throw new HttpsError('invalid-argument', 'leadId is required.');
  if (createProject && !projectName) {
    throw new HttpsError('invalid-argument', 'projectName is required when creating a project.');
  }
  if (createProject && !PACKAGE_CATALOG[packageId]) {
    throw new HttpsError('invalid-argument', 'A valid package is required when creating a project.');
  }

  const leadRef = db.collection('leads').doc(leadId);
  const result = await db.runTransaction(async (transaction) => {
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError('not-found', 'Lead not found.');

    const lead = leadSnapshot.data() || {};
    if (!isUserKey(lead.assignedTo, keys) && callerRole !== 'owner') {
      throw new HttpsError('permission-denied', 'You do not have access to this lead.');
    }

    const existingClientQuery = db.collection('clients').where('leadId', '==', leadId).limit(1);
    const existingClientSnapshot = await transaction.get(existingClientQuery);
    let clientRef;
    let client;
    if (!existingClientSnapshot.empty) {
      clientRef = existingClientSnapshot.docs[0].ref;
      client = existingClientSnapshot.docs[0].data() || {};
    } else {
      clientRef = db.collection('clients').doc();
      client = {
        businessName: typeof lead.businessName === 'string' ? lead.businessName : 'New client',
        ownerName: typeof lead.contactName === 'string' ? lead.contactName : '',
        email: typeof lead.email === 'string' ? lead.email : '',
        phone: typeof lead.phone === 'string' ? lead.phone : '',
        location,
        industry,
        contractSigned: false,
        onboardingCompleted: false,
        leadId,
        createdBy: uid,
        visibleTo: typeof lead.assignedTo === 'string' ? [lead.assignedTo] : [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      transaction.set(clientRef, client);
    }

    let projectId;
    if (createProject) {
      const existingProjectQuery = db.collection('projects')
        .where('clientId', '==', clientRef.id)
        .where('name', '==', projectName)
        .limit(1);
      const existingProjectSnapshot = await transaction.get(existingProjectQuery);
      if (!existingProjectSnapshot.empty) {
        projectId = existingProjectSnapshot.docs[0].id;
      } else {
        const projectRef = db.collection('projects').doc();
        projectId = projectRef.id;
        const pkg = PACKAGE_CATALOG[packageId];
        transaction.set(projectRef, {
          name: projectName,
          clientId: clientRef.id,
          packageId,
          packageName: pkg.name,
          packagePrice: pkg.price,
          status: 'not-started',
          milestones: createProjectMilestones(packageId),
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          startDate: nowIso(),
          assignedTo: lead.assignedTo || uid,
          notes: '',
          createdBy: uid,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
      }
    }

    transaction.update(leadRef, {
      stage: 'won',
      clientId: clientRef.id,
      updatedAt: nowIso(),
    });

    const activityRef = db.collection('activities').doc();
    transaction.set(activityRef, {
      type: 'status-change',
      entityType: 'lead',
      entityId: leadId,
      description: 'Lead converted to client',
      metadata: { to: 'won', clientId: clientRef.id, projectId: projectId || null },
      createdAt: nowIso(),
      createdBy: uid,
    });

    return { leadId, clientId: clientRef.id, projectId };
  });

  return result;
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
