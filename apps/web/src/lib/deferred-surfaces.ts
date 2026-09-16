/**
 * Deferred-surface state machine for the Sporta web app.
 *
 * W904/W905 made Home, Live, Explore, Library, Watch and the sign-in surface
 * REAL (capability-driven, over the real control plane). W906 made Create
 * real; W907 made Match Lab, Rights Center, Operations and Jobs real. This
 * module now covers ONLY the surfaces that are still genuinely deferred —
 * each one says what will live there and which work order delivers it. As
 * surfaces became real, their entries were REMOVED (not repurposed): this
 * list can never grow back a surface that has a real implementation.
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
export type SurfaceRoute = "/" | "/search" | "/following" | "/audit" | "/clips" | "/notes";

/** Key of a deferred surface (referenced by pages). */
export type SurfaceKey = "home-create" | "search" | "following" | "audit" | "clips" | "notes";

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
      "Starting points and ideas for new viewing experiences will be personalized here, linked into the Create Studio.",
    detail:
      "The Create Studio itself is real (Create in the navigation) — what does not exist yet is a personalized ideas shelf: there is no recommendation or template plane, so nothing is suggested or simulated here.",
    plannedWorkOrder: "W916",
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
    summary:
      "Activity from the creators, events and realities you follow will stream into this feed.",
    detail:
      "Accounts exist now (you can sign in), but there is no follow graph yet — no creator, event or reality can be followed, so no activity is simulated.",
    plannedWorkOrder: "W916",
  },
  audit: {
    id: "audit",
    route: "/audit",
    state: "unavailable",
    title: "Audit",
    summary:
      "The audit trail for your scope — rights decisions and publication events for rights holders, system-scope operations for operators.",
    detail:
      "No audit log is exposed by the control plane yet: rights-scope audit arrives with the rights/publication center (W917) and system-scope audit with the operational console (W918). Nothing is fabricated here.",
    plannedWorkOrder: "W918",
  },
  clips: {
    id: "clips",
    route: "/clips",
    state: "unavailable",
    title: "Clips",
    summary: "Saved analysis clips — moments you cut from the timeline while working in Match Lab.",
    detail:
      "There is no clips data plane yet: no clip can be cut, stored or listed, so none is simulated. Saved, role-scoped content arrives with the catalog/content model (W916).",
    plannedWorkOrder: "W916",
  },
  notes: {
    id: "notes",
    route: "/notes",
    state: "unavailable",
    title: "Notes",
    summary: "Analysis notes — your annotations on matches, events and commentary windows.",
    detail:
      "There is no notes data plane yet: no note can be written, stored or listed, so none is simulated. Personal analysis content arrives with the catalog/content model (W916).",
    plannedWorkOrder: "W916",
  },
};

export const DEFERRED_SURFACE_KEYS = Object.keys(DEFERRED_SURFACES) as readonly SurfaceKey[];

/** The page routes that are REAL (W904/W905/W906/W907) — no deferred panel any more. */
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
];

/** Look up a surface spec (unknown keys fail loudly in tests and code). */
export function getDeferredSurface(key: SurfaceKey): DeferredSurfaceSpec {
  return DEFERRED_SURFACES[key];
}
