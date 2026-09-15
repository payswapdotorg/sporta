/**
 * Deferred-surface state machine for the Sporta web app.
 *
 * W904/W905 made Home, Live, Explore, Library, Watch and the sign-in surface
 * REAL (capability-driven, over the real control plane). This module now
 * covers ONLY the surfaces that are still genuinely deferred — each one says
 * what will live there and which work order delivers it. As surfaces became
 * real, their entries were REMOVED (not repurposed): this list can never
 * grow back a surface that has a real implementation.
 *
 * The UX state vocabulary is the one pinned by
 * docs/architecture/ux-architecture.md:
 * `loading | ready | processing | degraded | denied | unavailable | failed`.
 * Every deferred surface here is exactly `unavailable`, and the reason is
 * always the missing real data/capability plane — never a simulated failure.
 */

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
export type SurfaceRoute = "/" | "/search" | "/following" | "/create";

/** Key of a deferred surface (referenced by pages). */
export type SurfaceKey = "home-create" | "search" | "following" | "create";

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
};

export const DEFERRED_SURFACES: Readonly<Record<SurfaceKey, DeferredSurfaceSpec>> = {
  "home-create": {
    id: "home-create",
    route: "/",
    state: "unavailable",
    title: "Things you can create",
    summary:
      "Ideas and starting points for new viewing experiences will live here, linked into the Create Studio.",
    detail:
      "The Create Studio flow (authorized upload, render recipe, progress, publish) is not built yet, so this section stays empty rather than suggesting actions that do not exist.",
    plannedWorkOrder: "W906",
  },
  search: {
    id: "search",
    route: "/search",
    state: "unavailable",
    title: "Search results",
    summary:
      "Search will look across matches, realities, creators and events you are authorized to access.",
    detail:
      "Search needs the real catalog/content model (W916) before it can return anything real. Your query is not stored or executed anywhere at this stage.",
    plannedWorkOrder: "W916",
  },
  following: {
    id: "following",
    route: "/following",
    state: "unavailable",
    title: "Following",
    summary: "Activity from the creators, events and realities you follow will stream into this feed.",
    detail:
      "Accounts exist now (you can sign in), but there is no follow graph yet — no creator, event or reality can be followed, so no activity is simulated.",
    plannedWorkOrder: "W916",
  },
  create: {
    id: "create",
    route: "/create",
    state: "unavailable",
    title: "Create Studio",
    summary:
      "The guided creation flow: authorized source, desired experience, renderer and style, rights preview, render, then publish or keep private.",
    detail:
      "Uploading and rendering are not connected to the control plane from this studio yet. When it opens, every job will run against real ingestion and render pipelines with real progress states.",
    plannedWorkOrder: "W906",
  },
};

export const DEFERRED_SURFACE_KEYS = Object.keys(DEFERRED_SURFACES) as readonly SurfaceKey[];

/** The page routes that are REAL (W904/W905) — no deferred panel any more. */
export const REAL_SURFACE_ROUTES: readonly string[] = [
  "/",
  "/live",
  "/explore",
  "/library",
  "/watch",
  "/auth/signin",
];

/** Look up a surface spec (unknown keys fail loudly in tests and code). */
export function getDeferredSurface(key: SurfaceKey): DeferredSurfaceSpec {
  return DEFERRED_SURFACES[key];
}
