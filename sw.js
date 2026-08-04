/* Travel Tracker service worker — offline support for Travel View.
 *
 * WHY THIS FILE EXISTS AT ALL (the app is otherwise deliberately one file):
 * a service worker script cannot be inlined or registered from a blob URL --
 * it must be a real, same-origin URL. manifest.json is the existing precedent
 * for a served sidecar file.
 *
 * STRATEGY: NETWORK-FIRST, cache only as a fallback. This app is republished
 * constantly (GitHub Pages serves `main` directly), so a cache-first worker
 * would strand users on a stale build -- the classic service-worker footgun,
 * and a genuinely confusing one to diagnose. Every navigation therefore tries
 * the network first and only falls back to the cached copy when the network is
 * actually unavailable. The cached page is a safety net for "no signal", never
 * the normal path.
 *
 * SCOPE: the app shell only (index.html + the manifest/icons). The trip DATA is
 * cached separately by the app itself, in IndexedDB (see tripsyCacheTripsForOffline
 * in index.html) -- Drive API responses are user-specific and auth-bearing, so
 * they are deliberately never touched here.
 *
 * Bump CACHE_VERSION to evict old entries on the next activate.
 */
const CACHE_VERSION = 'tt-shell-v1';
const SHELL_URLS = ['./', './index.html', './manifest.json'];

self.addEventListener('install', event => {
  // Pre-cache the shell so the very first offline open works even if the user
  // never happened to load while online since installing. Best-effort: a failed
  // pre-cache must not abort the install (the fetch handler still populates it).
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(SHELL_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Same-origin only: Google/Drive/Anthropic calls are auth-bearing and
  // user-specific, and must never be served from a shared cache.
  if (url.origin !== self.location.origin) return;

  const isShell = req.mode === 'navigate'
    || url.pathname.endsWith('/index.html')
    || url.pathname.endsWith('/manifest.json')
    || url.pathname === '/' || url.pathname.endsWith('/Flight-data/');

  if (!isShell) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        // Refresh the cached copy on every successful online load, so the
        // offline fallback is always the last build the user actually saw.
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        // Offline (or the network failed): serve the last good copy. Try the
        // exact request first, then the shell entries, so a navigation to
        // "/Flight-data/" still resolves to the cached index.html.
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match(req))
          || (await cache.match('./index.html'))
          || (await cache.match('./'))
          || new Response(
            '<!doctype html><meta charset="utf-8"><title>Offline</title>'
            + '<body style="font-family:system-ui;background:#10151B;color:#e8eaed;padding:40px;text-align:center">'
            + '<h2>Offline</h2><p>Travel Tracker has not been opened on this device while online yet, '
            + 'so there is nothing cached to show. Reconnect and open it once.</p></body>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
      })
  );
});
