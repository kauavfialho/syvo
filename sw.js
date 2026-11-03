// service worker do syvo. so deixa o app instalavel e abrir sem internet a ultima versao vista.
// rede primeiro: sempre tenta buscar o index novo, cache e so plano b. assim deploy novo aparece na hora.
// nada de supabase nem cdn aqui: dado financeiro nunca fica guardado no cache.
const CACHE = 'syvo-v1';
const ARQUIVOS = ['./', 'index.html', 'manifest.webmanifest', 'assets/icon-192.png', 'assets/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(chaves => Promise.all(chaves.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if(req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(resp => {
      if(resp.ok){ const copia = resp.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
      return resp;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
