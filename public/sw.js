// Minimal service worker — exists only to satisfy Chrome's installability
// criteria (a registered SW with a fetch handler) so "Add to Home Screen" on
// Android offers a real standalone/fullscreen install, not just a bookmark
// shortcut that opens in a normal browser tab. Deliberately network-only, no
// caching — this app already re-fetches files.json/audio fresh each time.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
