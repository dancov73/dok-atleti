// The pages of the app stay on the phone, so it opens at once, also with no network or a weak one (docs/ruoli.md §11). Never the data:
// those are in IndexedDB (store.js). The app opens from this copy; at each opening the browser checks this file on the network, and a
// new CACHE fetches all the pages together in the background: the phone uses them from the next opening.
const CACHE = 'dok-12';
const SHELL = ['.', 'index.html', 'style.css', 'app.js', 'api.js', 'store.js', 'track.js', 'demo.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/lockup.svg'];
// The pictures of the exercises of the gym (docs/ruoli.md §13), the small one and the phases of each: there with no network too. They
// are in a cache of their own, fetched again only when they change (a new PICTURES), not at each new version of the pages: about
// 0.7 MB. The list is the one of tools/esercizi_immagini.py (docs/esercizi-immagini.csv): name and number of phases.
const PICTURES = 'dok-img-1';
const PHASES = { power_clean: 3, hang_clean: 2, power_snatch: 3, push_press: 2, jerk: 2, back_squat: 2, front_squat: 2, leg_press: 2, lunge: 2, bulgarian_split_squat: 2, step_up: 2, jump_squat: 2, calf_raise: 2, deadlift: 2, romanian_deadlift: 2, hip_thrust: 2, single_leg_rdl: 2, nordic_hamstring: 2, leg_curl: 2, good_morning: 2, glute_ham_raise: 2, kettlebell_swing: 2, bench_press: 2, military_press: 2, pull_up: 2, row: 2, med_ball_throw: 3, plank: 1, hollow: 1, pallof_press: 2, ab_wheel: 2, copenhagen_adduction: 1, russian_twist: 2 };
const IMAGES = Object.entries(PHASES).flatMap(([n, k]) => [`esercizi/${n}.webp`, ...Array.from({ length: k }, (_, i) => `esercizi/${n}-${i + 1}.webp`)]);
// the pages of the coaches live on the same site and never come from here (Registro 06/11/2026)
const NOT_HERE = '/allenatori';

self.addEventListener('install', e => e.waitUntil(Promise.all([
  caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))),
  // only the pictures not there yet
  caches.open(PICTURES).then(async c => {
    const have = new Set((await c.keys()).map(r => r.url));
    return c.addAll(IMAGES.filter(u => !have.has(new URL(u, self.registration.scope).href)));
  }),
]).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n.startsWith('dok-') && n !== CACHE && n !== PICTURES).map(n => caches.delete(n))))
  .then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith(NOT_HERE)) return;
  e.respondWith(caches.open(CACHE).then(c => c.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }))
    .then(hit => hit || caches.open(PICTURES).then(c => c.match(e.request))).then(hit => hit || fetch(e.request)));
});
