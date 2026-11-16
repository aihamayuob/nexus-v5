/* ==========================================================================
   sw.js — Neural Nexus AI Agents — offline app-shell service worker (Release V1, B1)

   AUTHORED from the measured boot dependency map (baseline/evidence/release-v1-b1-acceptance-criteria.md),
   NOT recovered from the original sw.js (which is unavailable). Behavior of the original that is not listed
   below (push, background sync, other caching rules) is NOT reproduced.

   What it does
   - Precaches the 6 same-origin JS files the boot needs (main.js + 5 ES modules) atomically: if one is missing
     the install FAILS (loud), it never silently installs a broken shell.
   - Best-effort precaches the document ('./' and the known HTML name). A deployment under another file name is
     cached at its first successful navigation.
   - Network-first with cache fallback, ONLY for that allowlist (fresh when online, boots offline from cache).
   - Everything else is passed through untouched: non-GET, cross-origin (cdnjs, providers), and every other
     same-origin path — including /api/*, /v2/* and SSE streams. No API response is ever cached.
   - Uses no web storage and never reads or stores request headers.

   Cache versioning: bump CACHE_VERSION when the SHELL list changes. `activate` removes older `nexus-shell-*`
   caches (and only those). Not available offline (disclosed): features loaded lazily from cdnjs (QR, PDF.js).
   ========================================================================== */
const CACHE_VERSION = 'v1';
const CACHE_NAME = 'nexus-shell-' + CACHE_VERSION;
const HTML_NAME = 'neural_nexus_ai_agents-4-3-5-3.html';

// Required boot files (ES module graph rooted at main.js). Keep one entry per line.
const SHELL = [
  './main.js',
  './modules/security.mjs',
  './modules/storage.mjs',
  './modules/utilities.mjs',
  './modules/settings.mjs',
  './modules/state.mjs',
];
// Document: best effort only (its served name differs between deployments).
const DOCUMENT = ['./', './' + HTML_NAME];

const scopeUrl = (rel) => new URL(rel, self.registration.scope).href;
const allowlist = () => new Set([...SHELL, ...DOCUMENT].map(scopeUrl));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL.map(scopeUrl)); // atomic: rejects if any required file is unavailable
    await Promise.all(DOCUMENT.map((d) => cache.add(scopeUrl(d)).catch(() => {}))); // best effort
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('nexus-shell-') && k !== CACHE_NAME) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isNav = req.mode === 'navigate';
  const key = url.origin + url.pathname; // ignore the query string for the allowlist
  if (!isNav && !allowlist().has(key)) return; // pass-through: API, SSE, anything not in the shell
  event.respondWith(networkFirst(req, isNav, key));
});

async function networkFirst(req, isNav, key) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    // Cache only good, same-origin responses to allowlisted URLs and top-level navigations to the document.
    const isHtml = (res.headers.get('content-type') || '').includes('text/html');
    if (res.ok && res.type === 'basic' && (allowlist().has(key) || (isNav && isHtml))) {
      cache.put(isNav ? key : req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const hit = (await cache.match(isNav ? key : req, { ignoreSearch: true }))
      || (isNav && ((await cache.match(scopeUrl('./'))) || (await cache.match(scopeUrl('./' + HTML_NAME)))));
    if (hit) return hit;
    throw err;
  }
}
