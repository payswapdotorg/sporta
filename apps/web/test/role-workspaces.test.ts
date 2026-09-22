import { describe, expect, test } from "bun:test";
import { ROLES } from "@sporta/capability";
import {
  ROLE_LABELS,
  ROLE_WORKSPACES,
  formatPendingWork,
  isRouteInWorkspace,
  navForRole,
  navGroupsForRole,
  switchableRoles,
  workspaceDefaultPath,
  workspaceSupplements,
} from "../src/lib/role-workspaces";
import { PRIMARY_NAV, ROUTES } from "../src/lib/navigation";

/**
 * W907 — the role → workspace model (docs/architecture/role-experience-matrix.md
 * "Product surface map" + "Role semantics"), made executable:
 *
 * - every role's workspace is EXACTLY the matrix's surface list;
 * - the switcher offers EXACTLY the account's grants (never all five);
 * - the active role is presentation context only (nav/workspace), and a
 *   no-active-role account falls back to the shared navigation;
 * - safe return: the workspace's default path + membership check never
 *   strand a switched account on a foreign surface;
 * - pending work formats honestly (zero/invalid pending is null, never 0).
 */

describe("W907 role workspaces — the matrix's product surface map", () => {
  test("every role has a workspace with at least one surface", () => {
    for (const role of ROLES) {
      expect(ROLE_WORKSPACES[role].length).toBeGreaterThan(0);
    }
  });

  test("Viewer: Home, Live, Explore, Watch, Library — exactly", () => {
    expect(ROLE_WORKSPACES.viewer.map((s) => s.label)).toEqual([
      "Home",
      "Live",
      "Explore",
      "Watch",
      "Library",
    ]);
  });

  test("Creator: Home, Create Studio, Jobs, Library — exactly", () => {
    expect(ROLE_WORKSPACES.creator.map((s) => s.label)).toEqual([
      "Home",
      "Create Studio",
      "Jobs",
      "Library",
    ]);
  });

  test("Analyst: Home, Watch, Match Lab, Clips, Notes — exactly", () => {
    expect(ROLE_WORKSPACES.analyst.map((s) => s.label)).toEqual([
      "Home",
      "Watch",
      "Match Lab",
      "Clips",
      "Notes",
    ]);
  });

  test("Rights Holder: Home, Rights Center, Catalog, Audit — exactly", () => {
    expect(ROLE_WORKSPACES["rights-holder"].map((s) => s.label)).toEqual([
      "Home",
      "Rights Center",
      "Catalog",
      "Audit",
    ]);
  });

  test("Operator: Operations, Jobs, Health, Providers, Audit — exactly", () => {
    expect(ROLE_WORKSPACES.operator.map((s) => s.label)).toEqual([
      "Operations",
      "Jobs",
      "Health",
      "Providers",
      "Audit",
    ]);
  });

  test("every surface destination is a real shell route (anchors address sections)", () => {
    const routes = new Set(Object.values(ROUTES));
    for (const role of ROLES) {
      for (const surface of ROLE_WORKSPACES[role]) {
        const path = surface.href.split("#", 1)[0]!;
        expect(routes.has(path as typeof routes extends Set<infer T> ? T : never)).toBe(true);
      }
    }
  });

  test("the matrix's catalog surface is the real Explore catalog route", () => {
    const catalog = ROLE_WORKSPACES["rights-holder"].find((s) => s.id === "catalog")!;
    expect(catalog.href).toBe(ROUTES.explore);
  });

  test("operator Health and Providers surface sections of the real operations page", () => {
    const health = ROLE_WORKSPACES.operator.find((s) => s.id === "health")!;
    const providers = ROLE_WORKSPACES.operator.find((s) => s.id === "providers")!;
    expect(health.href).toBe(`${ROUTES.operations}#health`);
    expect(providers.href).toBe(`${ROUTES.operations}#providers`);
  });
});

describe("W907 role switcher model — grants-only, context-only", () => {
  test("a grant-less account can switch to nothing (honest empty list)", () => {
    expect(switchableRoles({ roles: [], activeRole: null })).toEqual([]);
  });

  test("a viewer-only account may switch to viewer only", () => {
    expect(switchableRoles({ roles: ["viewer"], activeRole: "viewer" })).toEqual(["viewer"]);
  });

  test("switchable roles are exactly the grants, in canonical order, never deduplicated away", () => {
    expect(switchableRoles({ roles: ["operator", "analyst", "viewer"], activeRole: null })).toEqual(
      ["viewer", "analyst", "operator"],
    );
  });

  test("roles the account does NOT hold are never offered (grants-only rule)", () => {
    const offered = switchableRoles({ roles: ["viewer", "creator"], activeRole: "viewer" });
    expect(offered).not.toContain("rights-holder");
    expect(offered).not.toContain("analyst");
    expect(offered).not.toContain("operator");
    expect(offered).toEqual(["viewer", "creator"]);
  });

  test("duplicate grants collapse (a store must never expand the offered set)", () => {
    expect(switchableRoles({ roles: ["viewer", "viewer"], activeRole: null })).toEqual(["viewer"]);
  });

  test("unknown wire strings are never offered (fail-closed against version skew)", () => {
    expect(switchableRoles({ roles: ["viewer", "superuser", ""], activeRole: null })).toEqual([
      "viewer",
    ]);
    expect(switchableRoles({ roles: ["admin"], activeRole: null })).toEqual([]);
  });

  test("an unknown active-role wire string falls back to the shared navigation (fail-closed)", () => {
    expect(navForRole("superuser")).toBe(PRIMARY_NAV);
    expect(navForRole("")).toBe(PRIMARY_NAV);
  });

  test("every role has a human-facing label (the matrix's column headers)", () => {
    expect(ROLE_LABELS.viewer).toBe("Viewer");
    expect(ROLE_LABELS["rights-holder"]).toBe("Rights Holder");
    for (const role of ROLES) {
      expect(ROLE_LABELS[role].length).toBeGreaterThan(3);
    }
  });
});

describe("W907 workspace navigation — presentation context only (J002: supplements, never replaces)", () => {
  test("no active role falls back to the shared navigation (never a fabricated workspace)", () => {
    expect(navForRole(null)).toBe(PRIMARY_NAV);
    expect(navForRole(undefined)).toBe(PRIMARY_NAV);
  });

  test("J002: EVERY role retains the full core product navigation — global Home/discovery first", () => {
    // The core destinations (Home, Live, Explore, Library, Following,
    // Create) stay reachable from every role state — no workspace traps a
    // visitor away from the global product.
    for (const role of ROLES) {
      const nav = navForRole(role);
      expect(nav.slice(0, PRIMARY_NAV.length)).toEqual([...PRIMARY_NAV]);
    }
  });

  test("J002: the active role's nav is the core navigation plus its workspace supplement, in order", () => {
    const nav = navForRole("rights-holder");
    expect(nav.map((item) => item.label)).toEqual([
      "Home",
      "Live",
      "Explore",
      "Library",
      "Following",
      "Create",
      "Rights Center",
      "Audit",
    ]);
    expect(nav.map((item) => item.href)).toEqual([
      ROUTES.home,
      ROUTES.live,
      ROUTES.explore,
      ROUTES.library,
      ROUTES.following,
      ROUTES.create,
      ROUTES.rights,
      ROUTES.audit,
    ]);
  });

  test("J002: each role's supplement is exactly its workspace's non-core surfaces (matrix order)", () => {
    expect(workspaceSupplements("viewer").map((item) => item.label)).toEqual(["Watch"]);
    expect(workspaceSupplements("creator").map((item) => item.label)).toEqual(["Jobs"]);
    expect(workspaceSupplements("analyst").map((item) => item.label)).toEqual([
      "Watch",
      "Match Lab",
      "Clips",
      "Notes",
    ]);
    expect(workspaceSupplements("rights-holder").map((item) => item.label)).toEqual([
      "Rights Center",
      "Audit",
    ]);
    // The operator workspace (the one that used to REPLACE the core nav,
    // hiding Home/discovery entirely) now supplements it.
    expect(workspaceSupplements("operator").map((item) => item.label)).toEqual([
      "Operations",
      "Jobs",
      "Health",
      "Providers",
      "Audit",
    ]);
  });

  test("J002: a supplement never duplicates a core destination (no double-listed routes)", () => {
    for (const role of ROLES) {
      const hrefs = navForRole(role).map((item) => item.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
      // Surfaces the core already serves (e.g. Creator's Create Studio on
      // /create, Rights Holder's Catalog on /explore) are deduplicated by
      // base path — the core entry stays, the workspace copy drops.
      const core = new Set(PRIMARY_NAV.map((item) => item.href));
      for (const supplement of workspaceSupplements(role)) {
        expect(core.has(supplement.href)).toBe(false);
      }
    }
  });

  test("J002: unknown roles supplement nothing (fail-closed, core navigation only)", () => {
    expect(workspaceSupplements("superuser")).toEqual([]);
    expect(workspaceSupplements("")).toEqual([]);
    expect(navForRole("superuser")).toBe(PRIMARY_NAV);
  });

  test("J002: the grouped model renders the core group plus the labeled workspace group", () => {
    expect(navGroupsForRole(null)).toEqual([{ id: "core", label: null, items: PRIMARY_NAV }]);
    const groups = navGroupsForRole("analyst");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ id: "core", label: null, items: PRIMARY_NAV });
    expect(groups[1]!.id).toBe("workspace");
    expect(groups[1]!.label).toBe(`${ROLE_LABELS.analyst} workspace`);
    expect(groups[1]!.items).toEqual(workspaceSupplements("analyst"));
  });

  test("every workspace's first surface is its entry point (safe return target)", () => {
    expect(workspaceDefaultPath("viewer")).toBe(ROUTES.home);
    expect(workspaceDefaultPath("creator")).toBe(ROUTES.home);
    expect(workspaceDefaultPath("analyst")).toBe(ROUTES.home);
    expect(workspaceDefaultPath("rights-holder")).toBe(ROUTES.home);
    expect(workspaceDefaultPath("operator")).toBe(ROUTES.operations);
  });

  test("workspace membership ignores anchors and query strings", () => {
    expect(isRouteInWorkspace("operator", "/operations#health")).toBe(true);
    expect(isRouteInWorkspace("operator", "/operations?tab=1")).toBe(true);
  });

  test("the root path belongs to every workspace that lists Home, and only those", () => {
    expect(isRouteInWorkspace("viewer", "/")).toBe(true);
    expect(isRouteInWorkspace("operator", "/")).toBe(false);
  });

  test("sub-paths of a workspace surface stay inside the workspace", () => {
    expect(isRouteInWorkspace("viewer", "/watch/abc")).toBe(true);
    expect(isRouteInWorkspace("creator", "/create")).toBe(true);
    expect(isRouteInWorkspace("analyst", "/matchlab")).toBe(true);
  });

  test("a foreign surface is NOT in the workspace (the safe-return redirect case)", () => {
    // A viewer's workspace has no rights center, operations or jobs surfaces.
    expect(isRouteInWorkspace("viewer", "/rights")).toBe(false);
    expect(isRouteInWorkspace("viewer", "/operations")).toBe(false);
    expect(isRouteInWorkspace("viewer", "/jobs")).toBe(false);
    // An operator's workspace has no Live surface.
    expect(isRouteInWorkspace("operator", "/live")).toBe(false);
  });

  test("near-miss prefixes never match (no /livestream-style false positives)", () => {
    expect(isRouteInWorkspace("viewer", "/livestream")).toBe(false);
    expect(isRouteInWorkspace("analyst", "/matchlabx")).toBe(false);
  });
});

describe("W907 pending work — honest formatting", () => {
  test("zero pending is null (no fabricated 0 badges)", () => {
    expect(formatPendingWork("creator-jobs", 0)).toBeNull();
  });

  test("negative and non-integer counts are null (fail-closed formatting)", () => {
    expect(formatPendingWork("creator-jobs", -1)).toBeNull();
    expect(formatPendingWork("operator-failures", 1.5)).toBeNull();
    expect(formatPendingWork("creator-jobs", Number.NaN)).toBeNull();
  });

  test("one pending job formats singular", () => {
    expect(formatPendingWork("creator-jobs", 1)).toEqual({ label: "1 job in flight", count: 1 });
  });

  test("several pending jobs format plural", () => {
    expect(formatPendingWork("creator-jobs", 3)).toEqual({
      label: "3 jobs in flight",
      count: 3,
    });
    expect(formatPendingWork("operator-failures", 2)).toEqual({
      label: "2 failed jobs",
      count: 2,
    });
  });
});
