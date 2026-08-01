// Quickdraw service worker — PWA installability + Web Push.
//
// Registered by useServiceWorker() with ?apiUrl=<API origin> in the query
// string (the web app and API are separate origins, and a service worker
// can't read NEXT_PUBLIC_* env). The query string is also the SW's identity:
// changing it installs an updated worker.

const API_URL = new URL(self.location.href).searchParams.get("apiUrl") ?? "";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass-through fetch — no offline caching. The listener must exist for the
// app to count as installable; forks wanting offline support add their
// caching strategy here.
self.addEventListener("fetch", () => {});

// Incoming push. Payload shape: PushNotificationPayload (@project/shared) —
// { title, body, url, tag? }, produced by PushService on the API.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/web-app-manifest-192x192.png",
      badge: "/favicon-96x96.png",
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});

// Click focuses an existing app window on the target page, or opens one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

// Subscription expiry — re-subscribe and renew server-side over REST
// (service workers have no Socket.IO connection; the session cookie rides
// along via credentials: "include").
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription.options).then((subscription) =>
      fetch(`${API_URL}/api/push/resubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(subscription.toJSON()),
      }),
    ),
  );
});
