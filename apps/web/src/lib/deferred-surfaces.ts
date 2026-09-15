/**
 * Deferred-surface state machine for the Sporta web shell (W903).
 *
 * W903 ships the product shell only. The capability plane (W901, in flight)
 * and the data plane (W904+) do not exist yet, so every data-bearing surface
 * is an HONEST `unavailable` placeholder: it never invents match data, live
 * state, thumbnails-as-content, capability responses or any other fake
 * product feature (docs/agent-handoff/productization-tech-lead.md: "Never
 * turn an architectural seam into a fake product feature").
 *
 * The UX state vocabulary is the one pinned by
 * docs/architecture/ux-architecture.md:
 * `loading | ready | processing | degraded | denied | unavailable | failed`.
 * At W903 every surface is exactly `unavailable`, and the reason is always
 * the missing real data/capability plane — never a simulated failure.
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
export type SurfaceRoute =
  | "/"
  | "/live"
  | "/explore"
  | "/search"
  | "/library"
  | "/following"
  | "/create"
  | "/watch"
  | "/auth/signin";

/** Key of a deferred surface (referenced by pages). */
export type SurfaceKey =
  | "home-live"
  | "home-realities"
  | "home-create"
  | "live"
  | "explore"
  | "search"
  | "library"
  | "following"
  | "create"
  | "watch"
  | "signin";

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

export const DEFERRED_SURFACES: Readonly<
  Record<SurfaceKey, DeferredSurfaceSpec>
> = {
  "home-live": {
    id: "home-live",
    route: "/",
    state: "unavailable",
    title: "Live and upcoming matches",
    summary:
      "This is where live and upcoming matches will be listed, with real status, renderer availability and authorization state on every card.",
    detail:
      "No matches are shown because Sporta has no real catalog yet. Nothing here is simulated: listings arrive when the capability plane (W901) and the catalog surfaces (W904) are live, and a match is only ever labelled live when a real live transport backs it (W915).",
    plannedWorkOrder: "W904",
  },
  "home-realities": {
    id: "home-realities",
    route: "/",
    state: "unavailable",
    title: "Alternate realities of those matches",
    summary:
      "This shelf will hold the other visual realities of each match — the same event rendered as Anime, 3D or Tactical from one world model.",
    detail:
      "There are no rendered outputs to show yet. Realities appear here once authorized media can be uploaded and rendered through the hosted control plane (W904/W905), and each card will carry its real renderer and rights state.",
    plannedWorkOrder: "W905",
  },
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
  live: {
    id: "live",
    route: "/live",
    state: "unavailable",
    title: "Live now",
    summary:
      "Everything currently streaming over a real live transport will be listed here.",
    detail:
      "Sporta does not label anything as live without a real live network delivery behind it. There is no live transport in this preview, so this page truthfully shows nothing (see docs/testing/ux-operational-simulation.md, Simulation F).",
    plannedWorkOrder: "W915",
  },
  explore: {
    id: "explore",
    route: "/explore",
    state: "unavailable",
    title: "Explore the catalog",
    summary:
      "Browse matches, realities, creators and collections — filtered by what your account is authorized to see.",
    detail:
      "The catalog does not exist yet, so there is nothing to explore. Discovery surfaces arrive with the data plane, and they will only ever list content that real capability responses say is available to you.",
    plannedWorkOrder: "W904",
  },
  search: {
    id: "search",
    route: "/search",
    state: "unavailable",
    title: "Search results",
    summary:
      "Search will look across matches, realities, creators and events you are authorized to access.",
    detail:
      "Search needs the catalog to exist before it can return anything real. Your query is not stored or executed anywhere at this stage.",
    plannedWorkOrder: "W904",
  },
  library: {
    id: "library",
    route: "/library",
    state: "unavailable",
    title: "Your library",
    summary:
      "Saved matches, followed series and your own rendered realities will be collected here.",
    detail:
      "Libraries are per-account, and accounts do not exist yet (W902). This page stays empty instead of showing sample content that is not yours.",
    plannedWorkOrder: "W902",
  },
  following: {
    id: "following",
    route: "/following",
    state: "unavailable",
    title: "Following",
    summary:
      "Activity from the creators, events and realities you follow will stream into this feed.",
    detail:
      "Following needs accounts and a real follow graph, neither of which exists yet. No activity is simulated.",
    plannedWorkOrder: "W902",
  },
  create: {
    id: "create",
    route: "/create",
    state: "unavailable",
    title: "Create Studio",
    summary:
      "The guided creation flow: authorized source, desired experience, renderer and style, rights preview, render, then publish or keep private.",
    detail:
      "Uploading and rendering are not connected to the hosted control plane yet. When the studio opens, every job will run against real ingestion and render pipelines with real progress states.",
    plannedWorkOrder: "W906",
  },
  watch: {
    id: "watch",
    route: "/watch",
    state: "unavailable",
    title: "The watch experience",
    summary:
      "One match, many realities: the player, the timeline with event markers, commentary and the Reality Switcher between Original, Anime, 3D and Tactical.",
    detail:
      "No player is rendered here because no real Sporta-rendered output exists to play, and a fake player would tell you nothing true. The watch surface arrives with the data plane and will play only real authorized artifacts.",
    plannedWorkOrder: "W905",
  },
  signin: {
    id: "signin",
    route: "/auth/signin",
    state: "unavailable",
    title: "Sign in",
    summary:
      "This is where you will sign in to Sporta, pick your active role and reach your workspaces.",
    detail:
      "Accounts, roles and server-side authorization arrive with the identity plane. No sign-in form is shown now because it could not actually sign you in.",
    plannedWorkOrder: "W902",
  },
};

export const DEFERRED_SURFACE_KEYS = Object.keys(
  DEFERRED_SURFACES,
) as readonly SurfaceKey[];

/** Look up a surface spec (unknown keys fail loudly in tests and code). */
export function getDeferredSurface(key: SurfaceKey): DeferredSurfaceSpec {
  return DEFERRED_SURFACES[key];
}
