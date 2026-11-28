// Offline support: keep the app itself on the device so it opens instantly, even without internet.
// Music, surprise photos and other outside data always go to the network and are never cached here.
const CACHE = 'family-puzzles-v14';           // bump on every release so old copies are replaced            // bump on every release so old copies are replaced
const SHELL = ['./', 'index.html', 'css/app.css', 'js/main.js', 'js/engine.js', 'js/store.js', 'js/share.js', 'js/backup.js',
  'js/scenes.js', 'js/look.js', 'js/music.js', 'js/compose.js', 'js/restore-offline-worker.js', 'js/playlists.js', 'js/restore-worklet.js', 'js/games/registry.js', 'js/games/jigsaw.js', 'js/games/solitaire.js', 'css/solitaire.css', 'js/games/sudoku.js', 'css/sudoku.css', 'js/games/words.js', 'css/words.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'];
const CDN = ['https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const req = e.request; if(req.method !== 'GET') return;
  const url = new URL(req.url), same = url.origin === location.origin, cdn = CDN.some(p => req.url.startsWith(p));
  if(!same && !cdn) return;                                   // archive.org, picsum: straight to the network
  // The app's own files: network first (so every update shows up at once), saved copy when offline.
  // CDN files (pinned versions) never change: saved copy first.
  const fresh = () => fetch(req).then(async r => {
    if(r.ok && !r.redirected && (r.type === 'basic' || r.type === 'cors')){ const c = await caches.open(CACHE); await c.put(req, r.clone()); }
    return r;
  });
  const saved = () => caches.open(CACHE).then(c => c.match(req, { ignoreSearch: same }));
  if(same) e.respondWith(fresh().catch(() => saved().then(hit => hit || Response.error())));
  else e.respondWith(saved().then(hit => hit || fresh()));
});
