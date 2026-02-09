const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

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
