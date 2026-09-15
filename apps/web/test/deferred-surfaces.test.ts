import { describe, expect, test } from "bun:test";
import {
  DEFERRED_SURFACE_KEYS,
  DEFERRED_SURFACES,
  UX_STATES,
  getDeferredSurface,
} from "../src/lib/deferred-surfaces";

describe("W903 deferred-surface state machine", () => {
  test("surface ids and keys are 1:1 and unique", () => {
    expect(DEFERRED_SURFACE_KEYS.length).toBe(Object.keys(DEFERRED_SURFACES).length);
    const ids = DEFERRED_SURFACE_KEYS.map((key) => DEFERRED_SURFACES[key].id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every surface state is exactly 'unavailable' — nothing fakes readiness", () => {
    for (const key of DEFERRED_SURFACE_KEYS) {
      expect(DEFERRED_SURFACES[key].state).toBe("unavailable");
    }
  });

  test("every surface state is inside the canonical UX state vocabulary", () => {
    for (const key of DEFERRED_SURFACE_KEYS) {
      expect(UX_STATES).toContain(DEFERRED_SURFACES[key].state);
    }
  });

  test("every surface is fully worded (title, summary, detail, plan)", () => {
    for (const key of DEFERRED_SURFACE_KEYS) {
      const surface = DEFERRED_SURFACES[key];
      expect(surface.title.trim().length).toBeGreaterThan(3);
      expect(surface.summary.trim().length).toBeGreaterThan(20);
      expect(surface.detail.trim().length).toBeGreaterThan(30);
      expect(surface.plannedWorkOrder).toMatch(/^W9(0[1-9]|1\d|20)$/);
    }
  });

  test("every page route of the shell is covered by at least one surface", () => {
    const pageRoutes = [
      "/",
      "/live",
      "/explore",
      "/search",
      "/library",
      "/following",
      "/create",
      "/watch",
      "/auth/signin",
    ] as const;
    const covered = new Set(DEFERRED_SURFACE_KEYS.map((key) => DEFERRED_SURFACES[key].route));
    for (const route of pageRoutes) {
      expect(covered.has(route)).toBe(true);
    }
  });

  test("home carries the three ux-architecture categories", () => {
    const homeSurfaces = DEFERRED_SURFACE_KEYS.filter(
      (key) => DEFERRED_SURFACES[key].route === "/",
    ).map((key) => DEFERRED_SURFACES[key].title);
    expect(homeSurfaces.length).toBe(3);
    expect(homeSurfaces.some((title) => /live/i.test(title))).toBe(true);
    expect(homeSurfaces.some((title) => /realit/i.test(title))).toBe(true);
    expect(homeSurfaces.some((title) => /create/i.test(title))).toBe(true);
  });

  test("the live surface never implies live content exists", () => {
    // Simulation F: live labels are evidence-driven. The copy must say the
    // opposite of "there is something live right now".
    const live = DEFERRED_SURFACES.live;
    expect(live.state).toBe("unavailable");
    expect(live.detail).toContain("no live transport");
  });

  test("getDeferredSurface resolves every key and only known keys", () => {
    for (const key of DEFERRED_SURFACE_KEYS) {
      expect(getDeferredSurface(key).id).toBe(DEFERRED_SURFACES[key].id);
    }
  });
});
