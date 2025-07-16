const CACHE_NAME = 'soleil-pictures-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/about-us.html',
  '/projects.html',
  '/style.css',
  '/script.js',
  '/assets/soleilpictures_favicon.png',
  '/assets/deepdiveweb1.jpg',
  '/assets/frankielosttime.png',
  '/assets/moelosttime.png',
  'https://use.typekit.net/qtd2rwk.css'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
}); 