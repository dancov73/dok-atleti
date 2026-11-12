// The pages of the app stay on the phone, so it opens at once, also with no network or a weak one (docs/ruoli.md §11). Never the data:
// those are in IndexedDB (store.js). The app opens from this copy; at each opening the browser checks this file on the network, and a
// new CACHE fetches all the pages together in the background: the phone uses them from the next opening.
const CACHE = 'dok-6';
const SHELL = ['.', 'index.html', 'style.css', 'app.js', 'api.js', 'store.js', 'track.js', 'demo.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/lockup.svg'];
// the pages of the coaches live on the same site and never come from here (Registro 06/11/2026)
const NOT_HERE = '/allenatori';

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE)
  .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith(NOT_HERE)) return;
  e.respondWith(caches.open(CACHE).then(c => c.match(e.request, { ignoreSearch: e.request.mode === 'navigate' })).then(hit => hit || fetch(e.request)));
});
