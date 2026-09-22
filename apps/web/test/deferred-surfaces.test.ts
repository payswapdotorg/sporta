import { describe, expect, test } from "bun:test";
import {
  DEFERRED_SURFACE_KEYS,
  DEFERRED_SURFACES,
  REAL_SURFACE_ROUTES,
  UX_STATES,
  getDeferredSurface,
} from "../src/lib/deferred-surfaces";
import { isRoutePath, ROUTES } from "../src/lib/navigation";

/**
 * Deferred-surface honesty (W903 → W904/W905 → J003 → wave 4): Home, Live,
 * Explore, Library, Watch, the sign-in surface, Create and J001's Home
 * create shelf are REAL (capability + catalog driven), and the wave-4
 * J009/J010 lanes made Audit, Clips and Notes REAL (the role-gated domain
 * seams landed in wave 3; the surfaces in wave 4 — their deferred entries
 * were REMOVED per the module's own doctrine). This module now lists ONLY
 * what is still genuinely deferred; a surface that has a real
 * implementation may never appear here again.
 *
 * J003's standing pins:
 * - every deferred surface carries a REAL next action (a link to an
 *   existing surface — never a dead end, never a link back to itself);
 * - no wording ever contradicts a real implementation.
 */
describe("deferred-surface state machine (post-W904/W905, J003)", () => {
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

  test("every deferred surface is fully worded (title, summary, detail, plan, next action)", () => {
    for (const key of DEFERRED_SURFACE_KEYS) {
      const surface = DEFERRED_SURFACES[key];
      expect(surface.title.trim().length).toBeGreaterThan(3);
      expect(surface.summary.trim().length).toBeGreaterThan(20);
      expect(surface.detail.trim().length).toBeGreaterThan(30);
      // A work order id, the explicit honest "none yet" marker, or the
      // named J-item UI lane that delivers the surface (J003 vocabulary).
      expect(
        /^W9(0[1-9]|1\d|20)$/.test(surface.plannedWorkOrder) ||
          surface.plannedWorkOrder.startsWith("none yet") ||
          /^J\d{3} UI/.test(surface.plannedWorkOrder),
      ).toBe(true);
    }
  });

  test("exactly the real routes are marked real — no more, no fewer (wave 4 added audit/clips/notes)", () => {
    expect([...REAL_SURFACE_ROUTES].sort()).toEqual([
      "/",
      "/audit",
      "/auth/signin",
      "/clips",
      "/create",
      "/explore",
      "/jobs",
      "/library",
      "/live",
      "/matchlab",
      "/notes",
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
      expect(real.has(surface.route)).toBe(false);
    }
  });

  test("the only still-deferred page is following (wave 4 made audit/clips/notes real)", () => {
    const routes = DEFERRED_SURFACE_KEYS.map((key) => DEFERRED_SURFACES[key].route).sort();
    expect(routes).toEqual(["/following"]);
    expect((DEFERRED_SURFACE_KEYS as readonly string[]).includes("home-create")).toBe(false);
    expect((DEFERRED_SURFACE_KEYS as readonly string[]).includes("search")).toBe(false);
    expect((DEFERRED_SURFACE_KEYS as readonly string[]).includes("audit")).toBe(false);
    expect((DEFERRED_SURFACE_KEYS as readonly string[]).includes("clips")).toBe(false);
    expect((DEFERRED_SURFACE_KEYS as readonly string[]).includes("notes")).toBe(false);
  });

  test("no deferred surface's wording contradicts the wave-4 real surfaces", () => {
    expect(DEFERRED_SURFACES.following.plannedWorkOrder.startsWith("none yet")).toBe(true);
    // Following: still the honest no-follow-graph state.
    expect(DEFERRED_SURFACES.following.detail).toContain("does not include a follow graph");
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

describe("J003 — every deferred surface has a useful, REAL next action", () => {
  test("every deferred surface carries a next action", () => {
    for (const key of DEFERRED_SURFACE_KEYS) {
      expect(DEFERRED_SURFACES[key].nextAction.label.trim().length).toBeGreaterThan(5);
    }
  });

  test("every next action targets a real shell route (an existing surface)", () => {
    for (const key of DEFERRED_SURFACE_KEYS) {
      const href = DEFERRED_SURFACES[key].nextAction.href;
      expect(isRoutePath(href)).toBe(true);
    }
  });

  test("a next action never links back to its own deferred route (no circular dead end)", () => {
    for (const key of DEFERRED_SURFACE_KEYS) {
      expect(DEFERRED_SURFACES[key].nextAction.href).not.toBe(DEFERRED_SURFACES[key].route);
    }
  });

  test("the next actions point at today's real surfaces (pinned destinations)", () => {
    expect(DEFERRED_SURFACES.following.nextAction.href).toBe(ROUTES.explore);
  });

  test("the deferred-surface component renders the next action as a link", async () => {
    const component = await Bun.file(
      new URL("../src/components/deferred-surface.tsx", import.meta.url),
    ).text();
    expect(component).toContain("deferred-next");
    expect(component).toContain("spec.nextAction.href");
    expect(component).toContain("spec.nextAction.label");
  });
});
