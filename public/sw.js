const SW_CACHE = 'khulisa-crm-cache-v5';
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/images/khulisa-logo.png',
  '/images/khulisa-logo-icon.png',
  '/sounds/notification.wav',
];

const parsePushPayload = (event) => {
  if (!event.data) return {};

  try {
    return event.data.json() || {};
  } catch {
    try {
      return JSON.parse(event.data.text() || '{}');
    } catch {
      return {};
    }
  }
};

const toBoolean = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  return fallback;
};

const buildNotificationFromPayload = (payload) => {
  const fcmMessage = payload?.data?.FCM_MSG || payload?.FCM_MSG || null;
  const notification = payload?.notification || fcmMessage?.notification || payload?.data?.notification || {};
  const data = payload?.data || fcmMessage?.data || {};
  const fcmOptions = payload?.fcmOptions || fcmMessage?.fcmOptions || {};

  const title =
    (typeof notification.title === 'string' && notification.title) ||
    (typeof payload.title === 'string' && payload.title) ||
    'Khulisa CRM';
  const body =
    (typeof notification.body === 'string' && notification.body) ||
    (typeof payload.body === 'string' && payload.body) ||
    'You have a new notification.';
  const link =
    (typeof data.link === 'string' && data.link) ||
    (typeof fcmOptions.link === 'string' && fcmOptions.link) ||
    '/';
  const icon =
    (typeof notification.icon === 'string' && notification.icon) ||
    '/images/khulisa-logo-icon.png';
  const badge =
    (typeof notification.badge === 'string' && notification.badge) ||
    '/images/khulisa-logo-icon.png';
  const tag =
    (typeof notification.tag === 'string' && notification.tag) ||
    `khulisa-${Date.now()}`;

  return {
    title,
    options: {
      body,
      icon,
      badge,
      tag,
      renotify: toBoolean(notification.renotify, true),
      requireInteraction: toBoolean(notification.requireInteraction, true),
      silent: toBoolean(notification.silent, false),
      data: { ...data, link },
    },
  };
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SW_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SW_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  // Use network-first for navigations so new deployments don't get stuck on stale index/html.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone();
          caches.open(SW_CACHE).then((cache) => cache.put(request, responseClone));
          return networkResponse;
        })
        .catch(async () => (await caches.match(request)) || caches.match('/'))
    );
    return;
  }

  // Use network-first for scripts and styles so deployments load fresh code first.
  if (['script', 'style'].includes(request.destination)) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }
          const responseClone = networkResponse.clone();
          caches.open(SW_CACHE).then((cache) => cache.put(request, responseClone));
          return networkResponse;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for static media assets.
  if (['image', 'font', 'audio'].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(request).then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }
          const responseClone = networkResponse.clone();
          caches.open(SW_CACHE).then((cache) => cache.put(request, responseClone));
          return networkResponse;
        });
      })
    );
    return;
  }

  // Default: network-first with cache fallback.
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }
        const responseClone = networkResponse.clone();
        caches.open(SW_CACHE).then((cache) => cache.put(request, responseClone));
        return networkResponse;
      })
      .catch(() => caches.match(request))
  );
});

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event);
  const { title, options } = buildNotificationFromPayload(payload);

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetPath =
    event.notification?.data?.link ||
    event.notification?.data?.FCM_MSG?.fcmOptions?.link ||
    '/';
  const absoluteUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existingClient = clients.find((client) => client.url === absoluteUrl);
      if (existingClient) {
        return existingClient.focus();
      }
      return self.clients.openWindow(absoluteUrl);
    })
  );
});
