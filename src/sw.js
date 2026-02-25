import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();

// Wait for explicit user consent via update prompt before activating a waiting worker.
self.addEventListener("message", (event) => {
  if (event?.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: "khulisa-pages-v1",
      networkTimeoutSeconds: 5,
    })
  )
);

registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    ["script", "style"].includes(request.destination),
  new NetworkFirst({
    cacheName: "khulisa-network-assets-v1",
    networkTimeoutSeconds: 5,
  })
);

registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    ["image", "font", "audio"].includes(request.destination),
  new CacheFirst({
    cacheName: "khulisa-static-assets-v1",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
    ],
  })
);

registerRoute(
  ({ request, url }) => request.method === "GET" && url.origin === self.location.origin,
  new NetworkFirst({
    cacheName: "khulisa-runtime-v1",
    networkTimeoutSeconds: 5,
  })
);

const parsePushPayload = (event) => {
  if (!event.data) return {};

  try {
    return event.data.json() || {};
  } catch {
    try {
      return JSON.parse(event.data.text() || "{}");
    } catch {
      return {};
    }
  }
};

const toBoolean = (value, fallback) => {
  if (typeof value === "boolean") return value;
  return fallback;
};

const buildNotificationFromPayload = (payload) => {
  const fcmMessage = payload?.data?.FCM_MSG || payload?.FCM_MSG || null;
  const notification = payload?.notification || fcmMessage?.notification || payload?.data?.notification || {};
  const data = payload?.data || fcmMessage?.data || {};
  const fcmOptions = payload?.fcmOptions || fcmMessage?.fcmOptions || {};

  const title =
    (typeof notification.title === "string" && notification.title) ||
    (typeof payload.title === "string" && payload.title) ||
    "Khulisa CRM";
  const body =
    (typeof notification.body === "string" && notification.body) ||
    (typeof payload.body === "string" && payload.body) ||
    "You have a new notification.";
  const link =
    (typeof data.link === "string" && data.link) ||
    (typeof fcmOptions.link === "string" && fcmOptions.link) ||
    "/";
  const icon =
    (typeof notification.icon === "string" && notification.icon) ||
    "/images/khulisa-logo-icon.png";
  const badge =
    (typeof notification.badge === "string" && notification.badge) ||
    "/images/khulisa-logo-icon.png";
  const tag =
    (typeof notification.tag === "string" && notification.tag) ||
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

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  const { title, options } = buildNotificationFromPayload(payload);

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetPath =
    event.notification?.data?.link || event.notification?.data?.FCM_MSG?.fcmOptions?.link || "/";
  const absoluteUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existingClient = clients.find((client) => client.url === absoluteUrl);
      if (existingClient) {
        return existingClient.focus();
      }
      return self.clients.openWindow(absoluteUrl);
    })
  );
});
