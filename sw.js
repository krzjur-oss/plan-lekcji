const CACHE = 'planlekcji-v8';

// Absolutne URL-e — kluczowe dla poprawnego działania na GH Pages
// i przy uruchamianiu zainstalowanej PWA z ikony na Android
const ASSETS = [
  self.registration.scope,
  self.registration.scope + 'index.html',
  self.registration.scope + 'app.js',
  self.registration.scope + 'styles.css',
  self.registration.scope + 'manifest.json',
  self.registration.scope + 'icon-192.png',
  self.registration.scope + 'icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(ASSETS.map(url =>
        cache.add(url).catch(err => {
          console.warn('Nie udało się cacheować:', url, err);
          return null;
        })
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // Obsługuj tylko zasoby w scope aplikacji
  const url = new URL(e.request.url);
  if (!e.request.url.startsWith(self.registration.scope)) return;

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;

      return fetch(e.request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback — zawsze zwróć index.html
        if (e.request.mode === 'navigate') {
          return caches.match(self.registration.scope + 'index.html')
            || caches.match(self.registration.scope);
        }
      });
    })
  );
});
