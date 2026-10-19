// Service worker minimal agar bisa dipasang di layar utama (Android & iPhone).
// Hanya aset statis yang di-cache. Halaman pesanan/akun/admin/API TIDAK pernah di-cache (berisi data pribadi & produk).
const CACHE = 'shell-v2';
const STATIC = ['/store.css', '/store.js', '/icon-192.png', '/icon-512.png', '/offline.html'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) =>
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
);
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (STATIC.includes(url.pathname)) return void e.respondWith(caches.match(req).then((r) => r || fetch(req)));
  if (req.mode === 'navigate') e.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
});
