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
 * Deferred-surface honesty (W903 → W904/W905 → J003): Home, Live, Explore,
 * Library, Watch, the sign-in surface, Create and J001's Home create shelf
 * are REAL (capability + catalog driven), so this module lists ONLY what is
 * still genuinely deferred. A surface that has a real implementation may
 * never appear here again.
 *
 * J003 adds the new pins:
 * - every deferred surface carries a REAL next action (a link to an
 *   existing surface — never a dead end, never a link back to itself);
 * - the wave-3 domain seams are worded honestly (the J009/J010 backing
 *   EXISTS at the domain level — the deferred boundary is the PAGE wiring,
 *   never "no data plane exists");
 * - the incoming UI lanes are named (J009 UI / J010 UI), so the wording
 *   cannot contradict Worker B's wave-4 surfaces.
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
      expect(real.has(surface.route)).toBe(false);
    }
  });

  test("the still-deferred pages are following, audit, clips and notes (J001 made the home create shelf real)", () => {
    const routes = DEFERRED_SURFACE_KEYS.map((key) => DEFERRED_SURFACES[key].route).sort();
    expect(routes).toEqual(["/audit", "/clips", "/following", "/notes"]);
    expect((DEFERRED_SURFACE_KEYS as readonly string[]).includes("home-create")).toBe(false);
    expect((DEFERRED_SURFACE_KEYS as readonly string[]).includes("search")).toBe(false);
  });

  test("the incoming UI lanes are named exactly (never contradicting wave-4's surfaces)", () => {
    expect(DEFERRED_SURFACES.following.plannedWorkOrder.startsWith("none yet")).toBe(true);
    expect(DEFERRED_SURFACES.clips.plannedWorkOrder).toBe("J010 UI (wave-4 lane)");
    expect(DEFERRED_SURFACES.notes.plannedWorkOrder).toBe("J010 UI (wave-4 lane)");
    expect(DEFERRED_SURFACES.audit.plannedWorkOrder).toBe("J009 UI (wave-4 lane)");
  });

  test("the wave-3 domain seams are worded honestly (the backing EXISTS; the page wiring is deferred)", () => {
    // J010: the clips/notes data plane exists at the domain level — the
    // stale "no clips/notes data plane yet" wording is gone.
    expect(DEFERRED_SURFACES.clips.detail).toContain("domain level");
    expect(DEFERRED_SURFACES.clips.detail).toContain("J010");
    expect(DEFERRED_SURFACES.clips.detail).not.toContain("no clips data plane yet");
    expect(DEFERRED_SURFACES.notes.detail).toContain("domain level");
    expect(DEFERRED_SURFACES.notes.detail).toContain("J010");
    expect(DEFERRED_SURFACES.notes.detail).not.toContain("no notes data plane yet");
    // J009: the rights-audit query exists at the domain level and two real
    // audit surfaces already exist — the stale "no audit log is exposed"
    // wording is gone.
    expect(DEFERRED_SURFACES.audit.detail).toContain("J009");
    expect(DEFERRED_SURFACES.audit.detail).not.toContain("No audit log is exposed");
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
    expect(DEFERRED_SURFACES.clips.nextAction.href).toBe(ROUTES.matchlab);
    expect(DEFERRED_SURFACES.notes.nextAction.href).toBe(ROUTES.matchlab);
    // The rights policy audit — a real audit surface that exists today.
    expect(DEFERRED_SURFACES.audit.nextAction.href).toBe(ROUTES.rightsPolicies);
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
