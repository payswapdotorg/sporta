/**
 * Shared navigation + route model for the Sporta web shell (W903).
 *
 * Pure data + pure functions only — no React, no Next imports — so the
 * product navigation contract is directly testable from `bun test` at the
 * repository root (docs/architecture/ux-architecture.md: shared navigation
 * is `Home | Live | Explore | Library | Create | Following | Search |
 * role/profile area`).
 */

/** Every route the product shell owns (W903 + the W907 role workspaces). */
export const ROUTES = {
  home: "/",
  live: "/live",
  explore: "/explore",
  search: "/search",
  library: "/library",
  following: "/following",
  create: "/create",
  watch: "/watch",
  matchlab: "/matchlab",
  clips: "/clips",
  notes: "/notes",
  rights: "/rights",
  operations: "/operations",
  jobs: "/jobs",
  audit: "/audit",
  signin: "/auth/signin",
  offline: "/offline",
} as const;

export type RouteKey = keyof typeof ROUTES;
export type RoutePath = (typeof ROUTES)[RouteKey];

/** All shell route paths as a stable array. */
export const ROUTE_PATHS: readonly RoutePath[] = Object.values(ROUTES);

/** Type guard for values claimed to be shell routes. */
export function isRoutePath(path: string): path is RoutePath {
  return (ROUTE_PATHS as readonly string[]).includes(path);
}

/** Icon vocabulary — one glyph per destination, rendered by <NavIcon />. */
export type NavIcon =
  | "home"
  | "live"
  | "explore"
  | "library"
  | "following"
  | "create"
  | "search"
  | "watch"
  | "signin"
  | "matchlab"
  | "clips"
  | "notes"
  | "rights"
  | "operations"
  | "jobs"
  | "audit";

/** One primary navigation destination. */
export type NavItem = {
  href: RoutePath;
  label: string;
  description: string;
  icon: NavIcon;
};

/**
 * The primary destinations. One model drives BOTH the desktop sidebar and
 * the mobile tab bar, so the two navigations can never drift apart.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  {
    href: ROUTES.home,
    label: "Home",
    description: "Live matches, alternate realities and things to create",
    icon: "home",
  },
  {
    href: ROUTES.live,
    label: "Live",
    description: "Real live network streaming when the transport is enabled",
    icon: "live",
  },
  {
    href: ROUTES.explore,
    label: "Explore",
    description: "Browse the Sporta catalog of events and realities",
    icon: "explore",
  },
  {
    href: ROUTES.library,
    label: "Library",
    description: "Your saved matches, realities and clips",
    icon: "library",
  },
  {
    href: ROUTES.following,
    label: "Following",
    description: "Activity from creators and events you follow",
    icon: "following",
  },
  {
    href: ROUTES.create,
    label: "Create",
    description: "Turn authorized footage into new viewing experiences",
    icon: "create",
  },
];

/**
 * Active-link policy for navigation highlighting.
 *
 * The root route matches only itself; every other route matches itself and
 * its sub-paths (`/live` is active on `/live` and `/live/x`, but never on
 * `/livestream`). Deterministic, path-only, no location side effects.
 */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
