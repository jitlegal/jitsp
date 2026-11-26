// Offline support: keep the app itself on the device so it opens instantly, even without internet.
// Music, surprise photos and other outside data always go to the network and are never cached here.
const CACHE = 'family-jigsaw-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/main.js', 'js/engine.js', 'js/store.js', 'js/share.js', 'js/backup.js',
  'js/scenes.js', 'js/music.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'];
const CDN = ['https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const req = e.request; if(req.method !== 'GET') return;
  const url = new URL(req.url), same = url.origin === location.origin, cdn = CDN.some(p => req.url.startsWith(p));
  if(!same && !cdn) return;                                   // archive.org, picsum: straight to the network
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: same });
    const net = fetch(req).then(r => { if(r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;                                        // fast from cache, refreshed in the background
  }));
});
