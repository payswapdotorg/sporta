import { describe, expect, test } from "bun:test";
import { PRIMARY_NAV, ROUTES, ROUTE_PATHS, isNavActive, isRoutePath } from "../src/lib/navigation";

describe("W903 route map", () => {
  test("contains every required product route", () => {
    const required = [
      ROUTES.home,
      ROUTES.live,
      ROUTES.explore,
      ROUTES.search,
      ROUTES.library,
      ROUTES.following,
      ROUTES.create,
      ROUTES.watch,
      ROUTES.signin,
    ];
    for (const path of required) {
      expect(ROUTE_PATHS).toContain(path);
    }
  });

  test("route paths are unique", () => {
    expect(new Set(ROUTE_PATHS).size).toBe(ROUTE_PATHS.length);
  });

  test("route paths are root-absolute and canonical", () => {
    for (const path of ROUTE_PATHS) {
      expect(path.startsWith("/")).toBe(true);
      expect(path.includes("//")).toBe(false);
      // only the root may end with a slash
      expect(path === "/" || !path.endsWith("/")).toBe(true);
    }
  });

  test("isRoutePath accepts known paths and rejects unknown ones", () => {
    expect(isRoutePath("/live")).toBe(true);
    expect(isRoutePath("/auth/signin")).toBe(true);
    expect(isRoutePath("/live/anything")).toBe(false);
    expect(isRoutePath("live")).toBe(false);
    expect(isRoutePath("")).toBe(false);
  });
});

describe("W903 primary navigation model", () => {
  test("exposes the six primary destinations from ux-architecture", () => {
    expect(PRIMARY_NAV.map((item) => item.href)).toEqual([
      ROUTES.home,
      ROUTES.live,
      ROUTES.explore,
      ROUTES.library,
      ROUTES.following,
      ROUTES.create,
    ]);
  });

  test("every nav item is fully specified", () => {
    for (const item of PRIMARY_NAV) {
      expect(item.label.trim().length).toBeGreaterThan(0);
      expect(item.description.trim().length).toBeGreaterThan(12);
      expect(["home", "live", "explore", "library", "following", "create"]).toContain(item.icon);
    }
  });

  test("nav labels and hrefs are unique", () => {
    const labels = PRIMARY_NAV.map((item) => item.label);
    expect(new Set(labels).size).toBe(labels.length);
    const hrefs = PRIMARY_NAV.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  test("desktop sidebar and mobile tab bar render the same single model", async () => {
    const navLinks = await Bun.file(
      new URL("../src/components/nav-links.tsx", import.meta.url),
    ).text();
    const sidebar = await Bun.file(
      new URL("../src/components/site-sidebar.tsx", import.meta.url),
    ).text();
    const tabbar = await Bun.file(
      new URL("../src/components/mobile-tabbar.tsx", import.meta.url),
    ).text();
    // the rendering components must consume the shared model...
    expect(navLinks).toContain("PRIMARY_NAV");
    // ...and both navigations must be projections of it
    expect(sidebar).toContain('variant="sidebar"');
    expect(tabbar).toContain('variant="tabbar"');
  });
});

describe("W903 active-route highlighting", () => {
  test("the root route is active only on itself", () => {
    expect(isNavActive("/", "/")).toBe(true);
    expect(isNavActive("/live", "/")).toBe(false);
    expect(isNavActive("", "/")).toBe(false);
  });

  test("a section is active on itself and its sub-paths", () => {
    expect(isNavActive("/live", "/live")).toBe(true);
    expect(isNavActive("/live/match-17", "/live")).toBe(true);
    expect(isNavActive("/auth/signin", "/auth/signin")).toBe(true);
  });

  test("prefix matching is segment-aware (no /livestream false positives)", () => {
    expect(isNavActive("/livestream", "/live")).toBe(false);
    expect(isNavActive("/library-all", "/library")).toBe(false);
    expect(isNavActive("/create/new/recipe", "/create")).toBe(true);
  });

  test("an unrelated pathname highlights nothing in the primary nav", () => {
    const pathname = "/definitely/not/a/section";
    expect(PRIMARY_NAV.some((item) => isNavActive(pathname, item.href))).toBe(false);
  });
});
