/**
 * Deferred-surface state machine for the Sporta web app.
 *
 * W904/W905 made Home, Live, Explore, Library, Watch and the sign-in surface
 * REAL (capability-driven, over the real control plane). W906 made Create
 * real; W907 made Match Lab, Rights Center, Operations and Jobs real; W908
 * made Search real over the W916 catalog search. J001 made the Home create
 * shelf real (the Create Studio entry, capability-driven). This module now
 * covers ONLY the surfaces that are still genuinely deferred — each one
 * says what will live there, which lane delivers it, the honest state of
 * the backing planes TODAY (the wave-3 J009/J010 domain seams exist; the
 * page surfaces do not), and a REAL next action the visitor can take now.
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
export type SurfaceRoute = "/following" | "/audit" | "/clips" | "/notes";

/** Key of a deferred surface (referenced by pages). */
export type SurfaceKey = "following" | "audit" | "clips" | "notes";

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
  audit: {
    id: "audit",
    route: "/audit",
    state: "unavailable",
    title: "Audit",
    summary:
      "The audit trail for your scope — rights decisions and publication events for rights holders, system-scope operations for operators.",
    detail:
      "Audit trails already exist behind two real surfaces: the Rights Center's policy console keeps the append-only rights audit (every policy edit and revocation, who/what/when) and the Operations console keeps the remediation audit. The role-gated rights-audit query also exists at the domain level (J009). What does not exist yet is this page's own unified per-scope trail view — it arrives with the J009 UI lane, and nothing is fabricated here meanwhile.",
    plannedWorkOrder: "J009 UI (wave-4 lane)",
    nextAction: {
      label: "Open the rights policy audit today",
      href: ROUTES.rightsPolicies,
    },
  },
  clips: {
    id: "clips",
    route: "/clips",
    state: "unavailable",
    title: "Clips",
    summary: "Saved analysis clips — moments you cut from the timeline while working in Match Lab.",
    detail:
      "The clips data plane now exists at the domain level (J010's analyst annotations service: media-time markers and clip ranges saved only where a real session timeline backs them, durably, with no fake clip bytes) — but this page is not wired to it yet. The surface that lists and cuts your clips here arrives with the J010 UI lane; until then none is simulated.",
    plannedWorkOrder: "J010 UI (wave-4 lane)",
    nextAction: {
      label: "Work in Match Lab meanwhile",
      href: ROUTES.matchlab,
    },
  },
  notes: {
    id: "notes",
    route: "/notes",
    state: "unavailable",
    title: "Notes",
    summary: "Analysis notes — your annotations on matches, events and commentary windows.",
    detail:
      "The notes data plane now exists at the domain level (J010's analyst annotations service: notes attached to real timeline-backed markers, with author and timestamp, durably) — but this page is not wired to it yet. The surface that lists and writes your notes here arrives with the J010 UI lane; until then none is simulated.",
    plannedWorkOrder: "J010 UI (wave-4 lane)",
    nextAction: {
      label: "Work in Match Lab meanwhile",
      href: ROUTES.matchlab,
    },
  },
};

export const DEFERRED_SURFACE_KEYS = Object.keys(DEFERRED_SURFACES) as readonly SurfaceKey[];

/** The page routes that are REAL (W904-W908 + J001's create shelf) — no deferred panel any more. */
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
];

/** Look up a surface spec (unknown keys fail loudly in tests and code). */
export function getDeferredSurface(key: SurfaceKey): DeferredSurfaceSpec {
  return DEFERRED_SURFACES[key];
}
