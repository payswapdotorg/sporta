/**
 * Default catalog-surface pins (W901): `DEFAULT_CATALOG_SURFACES` must encode
 * `docs/architecture/role-experience-matrix.md`'s product surface map
 * row-for-row — this is the "and why" of content availability, so it can
 * never silently drift from the authority document.
 */
import { describe, expect, test } from "bun:test";
import { buildCapabilityResponse, DEFAULT_CATALOG_SURFACES } from "../src/index";
import type { CatalogSurfaceId } from "../src/index";

describe("the default catalog surface table", () => {
  test("covers exactly the sixteen matrix surfaces", () => {
    const expected: CatalogSurfaceId[] = [
      "home",
      "live",
      "explore",
      "watch",
      "library",
      "create-studio",
      "jobs",
      "match-lab",
      "clips",
      "notes",
      "rights-center",
      "catalog",
      "audit",
      "operations",
      "health",
      "providers",
    ];
    expect(DEFAULT_CATALOG_SURFACES.map((surface) => surface.surfaceId).sort()).toEqual(
      [...expected].sort(),
    );
  });

  test("public surfaces are the four viewer-baseline ones (Simulation A)", () => {
    for (const surface of DEFAULT_CATALOG_SURFACES) {
      const isPublic = ["home", "live", "explore", "watch"].includes(surface.surfaceId);
      expect(surface.requiresAuthenticated, surface.surfaceId).toBe(!isPublic);
      if (isPublic) expect(surface.requiredRoles, surface.surfaceId).toEqual([]);
    }
  });

  test("role-gated surfaces encode the matrix rows exactly", () => {
    const byId = new Map(DEFAULT_CATALOG_SURFACES.map((surface) => [surface.surfaceId, surface]));
    expect(byId.get("library")).toMatchObject({ requiresAuthenticated: true, requiredRoles: ["viewer"] });
    expect(byId.get("create-studio")).toMatchObject({
      requiresAuthenticated: true,
      requiredRoles: ["creator"],
    });
    expect(byId.get("jobs")).toMatchObject({
      requiresAuthenticated: true,
      requiredRoles: ["creator", "operator"],
    });
    expect(byId.get("match-lab")).toMatchObject({ requiredRoles: ["analyst"] });
    expect(byId.get("clips")).toMatchObject({ requiredRoles: ["analyst"] });
    expect(byId.get("notes")).toMatchObject({ requiredRoles: ["analyst"] });
    expect(byId.get("rights-center")).toMatchObject({ requiredRoles: ["rights-holder"] });
    expect(byId.get("catalog")).toMatchObject({ requiredRoles: ["rights-holder"] });
    expect(byId.get("audit")).toMatchObject({ requiredRoles: ["rights-holder", "operator"] });
    expect(byId.get("operations")).toMatchObject({ requiredRoles: ["operator"] });
    expect(byId.get("health")).toMatchObject({ requiredRoles: ["operator"] });
    expect(byId.get("providers")).toMatchObject({ requiredRoles: ["operator"] });
  });
});

describe("surface visibility derivation (the default set in action)", () => {
  function surfacesFor(input: {
    authenticated: boolean;
    valid?: boolean;
    userId?: string;
    activeRole?: string | null;
    roles?: string[];
  }) {
    const response = buildCapabilityResponse({
      session: {
        authenticated: input.authenticated,
        valid: input.valid ?? true,
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
        ...(input.activeRole !== undefined ? { activeRole: input.activeRole } : {}),
      },
      ...(input.userId !== undefined
        ? {
            account: {
              userId: input.userId,
              roles: (input.roles ?? []) as ("viewer" | "creator" | "analyst" | "rights-holder" | "operator")[],
            },
          }
        : {}),
    });
    return new Map(response.content.catalogSurfaces.map((s) => [s.surfaceId, s]));
  }

  test("an operator sees every surface", () => {
    const surfaces = surfacesFor({
      authenticated: true,
      userId: "u-op",
      activeRole: "operator",
      roles: ["viewer", "creator", "analyst", "rights-holder", "operator"],
    });
    for (const surface of DEFAULT_CATALOG_SURFACES) {
      expect(surfaces.get(surface.surfaceId)!.visibility, surface.surfaceId).toBe("visible");
    }
  });

  test("an analyst sees public + analyst surfaces only", () => {
    const surfaces = surfacesFor({
      authenticated: true,
      userId: "u-an",
      activeRole: "analyst",
      roles: ["viewer", "analyst"],
    });
    expect(surfaces.get("match-lab")!.visibility).toBe("visible");
    expect(surfaces.get("notes")!.visibility).toBe("visible");
    expect(surfaces.get("create-studio")!.reasonCode).toBe("role-not-granted");
    expect(surfaces.get("rights-center")!.reasonCode).toBe("role-not-granted");
    expect(surfaces.get("operations")!.reasonCode).toBe("role-not-granted");
    expect(surfaces.get("jobs")!.reasonCode).toBe("role-not-granted");
  });

  test("a rights-holder sees the rights surfaces (any-of semantics with operator)", () => {
    const surfaces = surfacesFor({
      authenticated: true,
      userId: "u-rh",
      activeRole: "rights-holder",
      roles: ["viewer", "rights-holder"],
    });
    expect(surfaces.get("rights-center")!.visibility).toBe("visible");
    expect(surfaces.get("catalog")!.visibility).toBe("visible");
    expect(surfaces.get("audit")!.visibility).toBe("visible");
    expect(surfaces.get("match-lab")!.reasonCode).toBe("role-not-granted");
  });

  test("an anonymous visitor sees the four public surfaces only", () => {
    const surfaces = surfacesFor({ authenticated: false, valid: false });
    expect(surfaces.get("home")!.visibility).toBe("visible");
    expect(surfaces.get("live")!.visibility).toBe("visible");
    expect(surfaces.get("explore")!.visibility).toBe("visible");
    expect(surfaces.get("watch")!.visibility).toBe("visible");
    expect(surfaces.get("library")!.reasonCode).toBe("authentication-required");
    expect(surfaces.get("audit")!.reasonCode).toBe("authentication-required");
  });
});
