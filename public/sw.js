// Minimal service worker — only exists so the browser considers this app
// installable (Add to Home Screen / Install App). It does not cache
// anything, so every request simply goes to the network as normal; this
// keeps auth/session/API calls behaving exactly like without a service
// worker.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
