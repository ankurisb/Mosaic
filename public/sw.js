// Mosaic service worker — deliberately conservative.
// Goal: make the app installable and give a graceful offline shell, WITHOUT
// ever caching authenticated HTML or API responses (which would leak stale or
// cross-user data). So: static assets are cache-first; navigations and
// everything else are network-first with an offline fallback only when the
// network is unavailable; /api/* is never touched by the SW.
const VERSION = 'mosaic-v1'
const STATIC_CACHE = `${VERSION}-static`
const OFFLINE_URL = '/offline.html'
const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // Never intercept API / auth / streaming — always go to the network.
  if (url.pathname.startsWith('/api/')) return

  // Static immutable assets: cache-first.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone()
        caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {})
        return res
      }).catch(() => hit)),
    )
    return
  }

  // Navigations (HTML): network-first, offline fallback only on failure.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)))
    return
  }
})
