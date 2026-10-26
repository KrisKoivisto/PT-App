// Keeps the app shell available offline. Network first, so a new version
// shows up on the next open; the cache is only a fallback.
const CACHE = 'wtw-v2';
const SHELL = [
  './', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png',
  'lib/api.js', 'lib/browse.js', 'lib/csv.js', 'lib/demo.js', 'lib/imdb.js', 'lib/mine.js', 'lib/recommend.js', 'lib/tmdb.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only the app's own files; TMDB calls and posters go straight to the network.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});
