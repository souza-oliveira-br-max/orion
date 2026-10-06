// Service Worker — PWA v6g.1
// Estrategia:
//   - HTML: network-first (sempre pega novo do servidor, cache so como fallback offline)
//   - Demais assets: cache-first (imagens, manifest, etc.)
// Versao dinamica — bump pra forcar invalidacao

const VERSION = 'v2-20261006';
const CACHE = 'orion-pwa-v6g-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(['./manifest.webmanifest']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // So lida com GET
  if (req.method !== 'GET') return;

  // Nao intercepta Supabase (sempre rede)
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // HTML: network-first, cai pra cache so se offline
  const isHTML = req.mode === 'navigate'
              || (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    e.respondWith(
      fetch(req)
        .then(resp => {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return resp;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Outros assets: cache-first com fallback rede
  e.respondWith(
    caches.match(req).then(r =>
      r || fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return resp;
      })
    )
  );
});