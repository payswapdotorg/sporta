/*
 * Sporta app-shell service worker (W903).
 *
 * WHAT THIS SERVICE WORKER DOES
 * =============================
 * 1. On install it precaches (with cache-busting `cache: "reload"`) a tiny
 *    app-shell set: the offline fallback page, the web app manifest and the
 *    two primary PWA icons.
 * 2. It serves immutable Next.js build assets (`/_next/static/...`) and the
 *    static icon/manifest assets cache-first, and stores them in the
 *    versioned shell cache on first fetch.
 * 3. For page navigations it is strictly network-first: if the network
 *    fails, it serves the cached offline page. Successful page responses
 *    are NOT cached — pages will become data-driven and must never go
 *    stale.
 * 4. On activate it deletes every cache from an older shell version
 *    (versioned cache names) and claims clients.
 *
 * WHAT IT NEVER CACHES (the boundary)
 * ===================================
 * - Any non-GET request.
 * - Any cross-origin request.
 * - Anything under `/api/` — the future data plane.
 * - Anything under `/_next/data/` — Next.js data routes.
 * - Successful navigation responses (only the offline fallback is ever
 *   served from cache for navigations).
 *
 * Bump CACHE_VERSION to invalidate every previous cache.
 */

const CACHE_VERSION = "w903-shell-v1";
const SHELL_CACHE = `sporta-shell-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];
const CACHE_FIRST_PREFIXES = [
  "/_next/static/",
  "/icons/",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(
        PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" })),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Never touch non-GET traffic.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch cross-origin traffic.
  if (url.origin !== self.location.origin) return;

  // Never cache the (future) data plane.
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/data/")) return;

  // Pages: network-first, offline fallback only. Never cached.
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Immutable build assets + static shell assets: cache-first.
  if (isCacheFirstAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else: network only, no caching at all.
});

function isCacheFirstAsset(pathname) {
  return CACHE_FIRST_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const offline = await cache.match(OFFLINE_URL);
    return offline ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    try {
      await cache.put(request, response.clone());
    } catch {
      // A failed cache write must not break the response.
    }
  }
  return response;
}
