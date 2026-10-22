/* Neura Al Noor - notification service worker.
 * Only used to display prayer reminders on browsers that refuse
 * `new Notification()` (Android Chrome, installed Android app).
 * It has no fetch handler: it never caches or intercepts requests. */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => 'focus' in client);
    if (existing) return existing.focus();
    return self.clients.openWindow('/prayer-times');
  })());
});
