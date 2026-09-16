import { describe, expect, test } from "bun:test";
import {
  DEFERRED_SURFACE_KEYS,
  DEFERRED_SURFACES,
  REAL_SURFACE_ROUTES,
  UX_STATES,
  getDeferredSurface,
} from "../src/lib/deferred-surfaces";

/**
 * Deferred-surface honesty (W903 → W904/W905): Home, Live, Explore, Library,
 * Watch and the sign-in surface are now REAL (capability + catalog driven),
 * so this module lists ONLY what is still genuinely deferred. A surface that
 * has a real implementation may never appear here again.
 */
describe("deferred-surface state machine (post-W904/W905)", () => {
  test("surface ids and keys are 1:1 and unique", () => {
    expect(DEFERRED_SURFACE_KEYS.length).toBe(Object.keys(DEFERRED_SURFACES).length);
    const ids = DEFERRED_SURFACE_KEYS.map((key) => DEFERRED_SURFACES[key].id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every deferred surface state is exactly 'unavailable' — nothing fakes readiness", () => {
    for (const key of DEFERRED_SURFACE_KEYS) {
      expect(DEFERRED_SURFACES[key].state).toBe("unavailable");
    }
  });

  test("every deferred surface state is inside the canonical UX state vocabulary", () => {
    for (const key of DEFERRED_SURFACE_KEYS) {
      expect(UX_STATES).toContain(DEFERRED_SURFACES[key].state);
    }
  });

  test("every deferred surface is fully worded (title, summary, detail, plan)", () => {
    for (const key of DEFERRED_SURFACE_KEYS) {
      const surface = DEFERRED_SURFACES[key];
      expect(surface.title.trim().length).toBeGreaterThan(3);
      expect(surface.summary.trim().length).toBeGreaterThan(20);
      expect(surface.detail.trim().length).toBeGreaterThan(30);
      // A work order id, or the explicit honest "none yet" marker (W908:
      // following has no scheduled work order and must not pretend one exists).
      expect(
        /^W9(0[1-9]|1\d|20)$/.test(surface.plannedWorkOrder) ||
          surface.plannedWorkOrder.startsWith("none yet"),
      ).toBe(true);
    }
  });

  test("exactly the W904-W908-real routes are marked real — no more, no fewer", () => {
    expect([...REAL_SURFACE_ROUTES].sort()).toEqual([
      "/",
      "/auth/signin",
      "/create",
      "/explore",
      "/jobs",
      "/library",
      "/live",
      "/matchlab",
      "/operations",
      "/rights",
      "/search",
      "/watch",
    ]);
  });

  test("no real route is claimed by a whole-page deferred surface (no double-claiming)", () => {
    const real = new Set(REAL_SURFACE_ROUTES);
    for (const key of DEFERRED_SURFACE_KEYS) {
      const surface = DEFERRED_SURFACES[key];
      // The home-create surface is a SECTION of the real home page, not a page
      // claim — every other deferred surface must own a not-yet-real route.
      if (key === "home-create") continue;
      expect(real.has(surface.route)).toBe(false);
    }
  });

  test("the still-deferred pages are following, audit, clips and notes (search became real in W908)", () => {
    const routes = DEFERRED_SURFACE_KEYS.map((key) => DEFERRED_SURFACES[key].route).sort();
    expect(routes).toEqual(["/", "/audit", "/clips", "/following", "/notes"]);
    expect((DEFERRED_SURFACE_KEYS as readonly string[]).includes("search")).toBe(false);
    expect(DEFERRED_SURFACES.following.plannedWorkOrder.startsWith("none yet")).toBe(true);
    expect(DEFERRED_SURFACES.clips.plannedWorkOrder).toBe("W916");
    expect(DEFERRED_SURFACES.notes.plannedWorkOrder).toBe("W916");
    expect(DEFERRED_SURFACES.audit.plannedWorkOrder).toBe("W918");
  });

  test("no deferred surface implies live content or an implemented studio", () => {
    for (const key of DEFERRED_SURFACE_KEYS) {
      const surface = DEFERRED_SURFACES[key];
      expect(surface.state).not.toBe("ready");
      expect(surface.summary.toLowerCase()).not.toContain("stream now");
    }
  });

  test("getDeferredSurface resolves every key and only known keys", () => {
    for (const key of DEFERRED_SURFACE_KEYS) {
      expect(getDeferredSurface(key).id).toBe(DEFERRED_SURFACES[key].id);
    }
  });
});
