/**
 * Deferred-surface state machine for the Sporta web app.
 *
 * W904/W905 made Home, Live, Explore, Library, Watch and the sign-in surface
 * REAL (capability-driven, over the real control plane). W906 made Create
 * real; W907 made Match Lab, Rights Center, Operations and Jobs real; W908
 * made Search real over the W916 catalog search. J001 made the Home create
 * shelf real (the Create Studio entry, capability-driven). The wave-4 lanes
 * made Audit, Clips and Notes REAL (J009/J010 — the role-gated domain
 * seams landed in wave 3; the surfaces in wave 4). This module now
 * covers ONLY the surfaces that are still genuinely deferred — each one
 * says what will live there, which lane delivers it, the honest state of
 * the backing planes TODAY, and a REAL next action the visitor can take now.
 * As surfaces became real, their entries were REMOVED (not repurposed):
 * this list can never grow back a surface that has a real implementation.
 *
 * The UX state vocabulary is the one pinned by
 * docs/architecture/ux-architecture.md:
 * `loading | ready | processing | degraded | denied | unavailable | failed`.
 * Every deferred surface here is exactly `unavailable`, and the reason is
 * always the missing surface plane — never a simulated failure, and never a
 * wording that contradicts the incoming backing lane (J003).
 */

import { ROUTES } from "./navigation";

/** Canonical UX state vocabulary (ux-architecture "UX state contract"). */
export const UX_STATES = [
  "loading",
  "ready",
  "processing",
  "degraded",
  "denied",
  "unavailable",
  "failed",
] as const;
export type UxState = (typeof UX_STATES)[number];

/** Route a deferred surface belongs to. */
export type SurfaceRoute = "/following";

/** Key of a deferred surface (referenced by pages). */
export type SurfaceKey = "following";

/**
 * A useful next action on a deferred surface (J003): a REAL, existing
 * destination the visitor can reach now — never a promise, never a dead
 * end. The href must be a real shell route.
 */
export type DeferredNextAction = {
  label: string;
  href: string;
};

/** One honest deferred surface. */
export type DeferredSurfaceSpec = {
  id: string;
  route: SurfaceRoute;
  state: UxState;
  /** What will live here once the real plane exists. */
  title: string;
  /** Plain-language meaning for viewers. */
  summary: string;
  /** Why nothing is shown now — the honest boundary. */
  detail: string;
  /** Productization work order that delivers this surface. */
  plannedWorkOrder: string;
  /** A real destination the visitor can reach now (J003 — no dead ends). */
  nextAction: DeferredNextAction;
};

export const DEFERRED_SURFACES: Readonly<Record<SurfaceKey, DeferredSurfaceSpec>> = {
  following: {
    id: "following",
    route: "/following",
    state: "unavailable",
    title: "Following",
    summary:
      "Activity from the creators, events and realities you follow will stream into this feed.",
    detail:
      "The W916 catalog/content model landed (role-scoped discoverability, reality linkage, search), but it does not include a follow graph: no creator, event or reality can be followed yet, so no activity is simulated — and signing in alone would not create a feed.",
    plannedWorkOrder: "none yet (no follow-graph work order is scheduled)",
    nextAction: {
      label: "Explore the catalog instead",
      href: ROUTES.explore,
    },
  },
};

export const DEFERRED_SURFACE_KEYS = Object.keys(DEFERRED_SURFACES) as readonly SurfaceKey[];

/** The page routes that are REAL (W904-W908 + J001's create shelf + the wave-4 J009/J010 surfaces) — no deferred panel any more. */
export const REAL_SURFACE_ROUTES: readonly string[] = [
  "/",
  "/live",
  "/explore",
  "/library",
  "/watch",
  "/auth/signin",
  "/create",
  "/matchlab",
  "/rights",
  "/operations",
  "/jobs",
  "/search",
  "/audit",
  "/clips",
  "/notes",
];

/** Look up a surface spec (unknown keys fail loudly in tests and code). */
export function getDeferredSurface(key: SurfaceKey): DeferredSurfaceSpec {
  return DEFERRED_SURFACES[key];
}
