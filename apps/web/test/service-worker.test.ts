import { describe, expect, test } from "bun:test";

const swUrl = new URL("../public/sw.js", import.meta.url);
const registrarUrl = new URL("../src/components/service-worker-registrar.tsx", import.meta.url);
const offlinePageUrl = new URL("../src/app/offline/page.tsx", import.meta.url);

/**
 * String-level static checks on the hand-written service worker (W903).
 * The SW is plain browser JavaScript; these tests pin its caching
 * boundary: it may only cache the static app shell, never the (future)
 * data plane.
 */
describe("W903 service worker — caching boundary", async () => {
  const sw = await Bun.file(swUrl).text();

  test("uses a versioned cache name so old caches are invalidated", () => {
    expect(sw).toContain("CACHE_VERSION");
    expect(sw).toContain("sporta-shell-");
  });

  test("install precaches use cache-busting reload requests", () => {
    expect(sw).toContain('cache: "reload"');
    expect(sw).toContain("skipWaiting");
  });

  test("activate deletes caches from other versions and claims clients", () => {
    expect(sw).toContain("caches.keys()");
    expect(sw).toContain("caches.delete");
    expect(sw).toContain("clients.claim");
  });

  test("never touches non-GET traffic", () => {
    expect(sw).toContain('request.method !== "GET"');
  });

  test("never touches cross-origin traffic", () => {
    expect(sw).toContain("url.origin !== self.location.origin");
  });

  test("never caches the future data plane", () => {
    expect(sw).toContain('"/api/"');
    expect(sw).toContain('"/_next/data/"');
  });

  test("serves only the offline fallback for failed navigations", () => {
    expect(sw).toContain('const OFFLINE_URL = "/offline"');
    expect(sw).toContain("networkFirstNavigation");
    // successful page responses are deliberately NOT cached: the only
    // cached navigation asset is the offline fallback itself.
    expect(sw).toContain("cache.match(OFFLINE_URL)");
  });

  test("cache-first routing is limited to static shell assets", () => {
    expect(sw).toContain('"/_next/static/"');
    expect(sw).toContain('"/icons/"');
    expect(sw).toContain('"/manifest.webmanifest"');
    // exactly one respondWith for the asset path — the guard list is
    // explicit and closed (no catch-all fetch handler).
    expect(sw.match(/respondWith/g)?.length).toBe(2);
  });

  test("registration registers /sw.js in production builds only", async () => {
    const registrar = await Bun.file(registrarUrl).text();
    expect(registrar).toContain('"/sw.js"');
    expect(registrar).toContain('process.env.NODE_ENV !== "production"');
  });

  test("the offline fallback route exists as a real page", async () => {
    expect(await Bun.file(offlinePageUrl).exists()).toBe(true);
  });
});
