// Offline support. The app's own files are network-first, so updates show up as soon as
// you're online, with the cached copy as a fallback. three.js and the font come from CDNs
// and are cached the first time they load.
const VERSION = 'iq3-v1';
const SHELL = [
  './', './index.html', './lab.html', './manifest.webmanifest',
  './js/app.js', './js/iq3.js', './js/stage.js', './js/thermo.js', './js/wraps.js', './js/demo.js',
  './icons/icon-192.png', './icons/icon-512.png',
];
const CDN = /^(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match('./index.html')),
    );
    return;
  }

  if (CDN.test(url.hostname)) {
    event.respondWith(caches.open(`${VERSION}-cdn`).then(async (cache) => {
      const hit = await cache.match(req);
      const fresh = fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || fresh;
    }));
  }
});
