/**
 * The normative default catalog-surface requirements (W901).
 *
 * Pinned to `docs/architecture/role-experience-matrix.md`'s product surface
 * map, one row per surface:
 *
 * | Surface | Who may see it (matrix) | Encoded requirement |
 * |---|---|---|
 * | home, live, explore, watch | Viewer (the baseline experience; public per Simulation A — an anonymous visitor can open the URL, discover, and watch) | public |
 * | library | Viewer | authenticated + `viewer` grant |
 * | create-studio | Creator | authenticated + `creator` grant |
 * | jobs | Creator and Operator (their own jobs / all jobs) | authenticated + `creator` OR `operator` grant |
 * | match-lab, clips, notes | Analyst | authenticated + `analyst` grant |
 * | rights-center, catalog | Rights Holder | authenticated + `rights-holder` grant |
 * | audit | Rights Holder (rights scope) and Operator (system scope) | authenticated + `rights-holder` OR `operator` grant |
 * | operations, health, providers | Operator | authenticated + `operator` grant |
 *
 * These are PRESENTATION requirements only (which workspace the UI offers).
 * They are NOT authorization: server-side policy (`@sporta/identity`) decides
 * every protected action regardless of what the frontend shows
 * (roles-are-grants, architecture-lock "do not let role switching grant
 * authority").
 *
 * `test/defaults.test.ts` pins this table row-for-row so it can never drift
 * from the matrix.
 */
import type { CatalogSurfaceRequest } from "./schema";

/** The default catalog-surface requests (the matrix, encoded). */
export const DEFAULT_CATALOG_SURFACES: readonly CatalogSurfaceRequest[] = [
  { surfaceId: "home", requiresAuthenticated: false, requiredRoles: [] },
  { surfaceId: "live", requiresAuthenticated: false, requiredRoles: [] },
  { surfaceId: "explore", requiresAuthenticated: false, requiredRoles: [] },
  { surfaceId: "watch", requiresAuthenticated: false, requiredRoles: [] },
  { surfaceId: "library", requiresAuthenticated: true, requiredRoles: ["viewer"] },
  { surfaceId: "create-studio", requiresAuthenticated: true, requiredRoles: ["creator"] },
  { surfaceId: "jobs", requiresAuthenticated: true, requiredRoles: ["creator", "operator"] },
  { surfaceId: "match-lab", requiresAuthenticated: true, requiredRoles: ["analyst"] },
  { surfaceId: "clips", requiresAuthenticated: true, requiredRoles: ["analyst"] },
  { surfaceId: "notes", requiresAuthenticated: true, requiredRoles: ["analyst"] },
  { surfaceId: "rights-center", requiresAuthenticated: true, requiredRoles: ["rights-holder"] },
  { surfaceId: "catalog", requiresAuthenticated: true, requiredRoles: ["rights-holder"] },
  { surfaceId: "audit", requiresAuthenticated: true, requiredRoles: ["rights-holder", "operator"] },
  { surfaceId: "operations", requiresAuthenticated: true, requiredRoles: ["operator"] },
  { surfaceId: "health", requiresAuthenticated: true, requiredRoles: ["operator"] },
  { surfaceId: "providers", requiresAuthenticated: true, requiredRoles: ["operator"] },
] as const;
