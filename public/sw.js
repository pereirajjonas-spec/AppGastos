/* Service worker: guarda a "casca" do app para abrir rápido. A API nunca é cacheada. */
const VERSAO = 'despesas-v1';
const CASCA = ['/app', '/css/app.css', '/js/comum.js', '/js/app.js', '/img/logo.jpg', '/img/icone-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Rede primeiro (sempre a versão mais nova); cache só se estiver sem conexão.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok && CASCA.includes(url.pathname)) {
          const copia = r.clone();
          caches.open(VERSAO).then(c => c.put(e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
