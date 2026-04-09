const CACHE = 'planlekcji-v5';

// Cachujemy tylko index.html i manifest — reszta ładuje się online
// Używamy self.location do budowania absolutnych URL-i
// (rozwiązuje problem cache miss na GH Pages z sub-path)
const ASSETS = [
  self.registration.scope,             // np. https://user.github.io/repo/
  self.registration.scope + 'index.html',
  self.registration.scope + 'manifest.json',
  self.registration.scope + 'icon-192.png',
  self.registration.scope + 'icon-512.png',
];

// Install
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(ASSETS.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

// Activate — usuń stare cache
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch — cache-first dla własnych zasobów, network dla reszty
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // Tylko obsługuj zasoby w scope SW
  if (!e.request.url.startsWith(self.registration.scope)) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;

      return fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline — zwróć index.html dla żądań nawigacyjnych
        if (e.request.mode === 'navigate') {
          return caches.match(self.registration.scope + 'index.html');
        }
      });
    })
  );
});
