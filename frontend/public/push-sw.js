/*
 * MyBus push service worker (served from /push-sw.js, scope "/").
 * A small hand-written worker instead of Angular's ngsw: ngsw only runs in production builds,
 * while this one also works under `ng serve` on localhost. It only handles push + notification clicks
 * (no caching), so it never interferes with the app or the dev server.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'MyBus', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'MyBus', {
      body: data.body || '',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: data.tag,
      lang: data.lang,
      data: { url: data.url || '/' },
    }),
  );
});

// Focus an open MyBus tab (navigating it to the booking) or open a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) return client.navigate(url);
          return undefined;
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
