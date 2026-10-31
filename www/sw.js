const V = 'gestor-v13';
const FILES = ['./', 'index.html', 'app.css', 'app.js', 'sync.js', 'extras.js', 'html2canvas.min.js', 'version.json', 'config.js', 'catalog-template.js', 'qrcode.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
// red primero (siempre la versión más nueva); si no hay internet, usa la copia guardada. La API nunca se cachea.
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
