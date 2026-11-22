const CACHE = 'dobrota-v19';
const ASSETS = [
  './',
  './index.html',
  './style.css?v=19',
  './app.js?v=19',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isShellAsset(url) {
  const p = url.pathname;
  return (
    p.endsWith('/') ||
    p.endsWith('.html') ||
    p.endsWith('app.js') ||
    p.endsWith('style.css') ||
    p.endsWith('sw.js') ||
    p.endsWith('manifest.webmanifest')
  );
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  const nav = e.request.mode === 'navigate' || isShellAsset(url);

  // HTML / JS / CSS: network-first so Pages updates win over stale SW cache
  if (nav) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(e.request).then((cached) => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  // Icons / other: cache-first
  e.respondWith(
    caches.match(e.request).then(
      (cached) =>
        cached ||
        fetch(e.request).then((res) => {
          if (res.ok && url.pathname.includes('/dobrota/')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
    )
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Доброта', body: 'Пора сделать доброе дело', url: './?tab=add', tag: 'dobrota-daily' };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch {
    try { data.body = event.data.text(); } catch {}
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Доброта', {
      body: data.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: data.tag || 'dobrota-daily',
      renotify: true,
      data: { url: data.url || './?tab=add' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './?tab=add';
  const abs = new URL(target, self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          c.navigate(abs).catch(() => {});
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(abs);
    })
  );
});
