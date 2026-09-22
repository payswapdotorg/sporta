/**
 * The role → workspace model (W907) — the product surface map of
 * docs/architecture/role-experience-matrix.md, made executable:
 *
 * | Viewer      | Home, Live, Explore, Watch, Library          |
 * | Creator     | Home, Create Studio, Jobs, Library           |
 * | Analyst     | Home, Watch, Match Lab, Clips, Notes          |
 * | Rights Hldr | Home, Rights Center, Catalog, Audit          |
 * | Operator    | Operations, Jobs, Health, Providers, Audit    |
 *
 * DESIGN RULES (the matrix + Simulation C, made structural):
 *
 * - The ACTIVE ROLE is PRESENTATION CONTEXT ONLY: it selects which workspace
 *   (navigation supplement + default destination) the account sees. It NEVER
 *   selects what the account may DO — every protected action is reauthorized
 *   server-side by `@sporta/identity`'s policy against the account's GRANTS.
 * - J002: the workspace navigation SUPPLEMENTS the core product navigation —
 *   global Home/discovery stay reachable from every role state; a role
 *   workspace never replaces (and so never traps) the core product nav.
 * - The switcher offers EXACTLY the account's grants (never all five
 *   roles): a role the account does not hold is never switchable.
 * - Surfaces that have no backing yet (Clips, Notes, Audit) exist as
 *   honest placeholders, never as fabricated content.
 *
 * Pure data + pure functions only — no React, no Next imports — so the
 * whole workspace contract is directly testable from `bun test`.
 */
import type { Role } from "@sporta/capability";
import { ROLES } from "@sporta/capability";
import { PRIMARY_NAV, ROUTES } from "./navigation";
import type { NavIcon, NavItem } from "./navigation";

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/** One surface of one role's workspace. */
export interface WorkspaceSurface {
  /** Stable surface id (also the nav key). */
  id: string;
  /** Nav label (the matrix's product-facing name). */
  label: string;
  /** Destination (`ROUTES.*` paths; anchors address a section of a page). */
  href: string;
  icon: NavIcon;
  /** One-line description (nav title text). */
  description: string;
}

/**
 * The five workspaces, EXACTLY as the matrix's product surface map lists
 * them (order preserved — the first entry is the workspace's entry point).
 */
export const ROLE_WORKSPACES: Readonly<Record<Role, readonly WorkspaceSurface[]>> = {
  viewer: [
    {
      id: "home",
      label: "Home",
      href: ROUTES.home,
      icon: "home",
      description: "Live matches, alternate realities and things to create",
    },
    {
      id: "live",
      label: "Live",
      href: ROUTES.live,
      icon: "live",
      description: "Real live network streaming when the transport is enabled",
    },
    {
      id: "explore",
      label: "Explore",
      href: ROUTES.explore,
      icon: "explore",
      description: "Browse the Sporta catalog of events and realities",
    },
    {
      id: "watch",
      label: "Watch",
      href: ROUTES.watch,
      icon: "watch",
      description: "One match, many realities",
    },
    {
      id: "library",
      label: "Library",
      href: ROUTES.library,
      icon: "library",
      description: "Your saved matches, realities and clips",
    },
  ],
  creator: [
    {
      id: "home",
      label: "Home",
      href: ROUTES.home,
      icon: "home",
      description: "Live matches, alternate realities and things to create",
    },
    {
      id: "create",
      label: "Create Studio",
      href: ROUTES.create,
      icon: "create",
      description: "Turn authorized footage into new viewing experiences",
    },
    {
      id: "jobs",
      label: "Jobs",
      href: ROUTES.jobs,
      icon: "jobs",
      description: "Your render jobs and their real progress",
    },
    {
      id: "library",
      label: "Library",
      href: ROUTES.library,
      icon: "library",
      description: "Your saved matches, realities and clips",
    },
  ],
  analyst: [
    {
      id: "home",
      label: "Home",
      href: ROUTES.home,
      icon: "home",
      description: "Live matches, alternate realities and things to create",
    },
    {
      id: "watch",
      label: "Watch",
      href: ROUTES.watch,
      icon: "watch",
      description: "One match, many realities",
    },
    {
      id: "matchlab",
      label: "Match Lab",
      href: ROUTES.matchlab,
      icon: "matchlab",
      description: "Timeline, commentary, events and SWM evidence inspection",
    },
    {
      id: "clips",
      label: "Clips",
      href: ROUTES.clips,
      icon: "clips",
      description: "Saved analysis clips",
    },
    {
      id: "notes",
      label: "Notes",
      href: ROUTES.notes,
      icon: "notes",
      description: "Analysis notes",
    },
  ],
  "rights-holder": [
    {
      id: "home",
      label: "Home",
      href: ROUTES.home,
      icon: "home",
      description: "Live matches, alternate realities and things to create",
    },
    {
      id: "rights",
      label: "Rights Center",
      href: ROUTES.rights,
      icon: "rights",
      description: "The rights policies on the sessions you own or control",
    },
    {
      id: "catalog",
      label: "Catalog",
      href: ROUTES.explore,
      icon: "explore",
      description: "Browse the Sporta catalog of events and realities",
    },
    {
      id: "audit",
      label: "Audit",
      href: ROUTES.audit,
      icon: "audit",
      description: "Audit state for your rights scope",
    },
  ],
  operator: [
    {
      id: "operations",
      label: "Operations",
      href: ROUTES.operations,
      icon: "operations",
      description: "Platform health, queues, providers and failed jobs",
    },
    {
      id: "jobs",
      label: "Jobs",
      href: ROUTES.jobs,
      icon: "jobs",
      description: "Render jobs across the platform",
    },
    {
      id: "health",
      label: "Health",
      href: `${ROUTES.operations}#health`,
      icon: "live",
      description: "Provider reachability and environment",
    },
    {
      id: "providers",
      label: "Providers",
      href: `${ROUTES.operations}#providers`,
      icon: "explore",
      description: "Which provider each seam is bound to",
    },
    {
      id: "audit",
      label: "Audit",
      href: ROUTES.audit,
      icon: "audit",
      description: "System-scope audit state",
    },
  ],
};

/** Human-facing role names (the matrix's column headers). */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  viewer: "Viewer",
  creator: "Creator",
  analyst: "Analyst / Commentator",
  "rights-holder": "Rights Holder",
  operator: "Operator / Admin",
};

/** The workspace's entry point (its first surface per the matrix's order). */
export function workspaceDefaultPath(role: Role): string {
  return ROLE_WORKSPACES[role][0]!.href;
}

/**
 * Whether `pathname` belongs to `role`'s workspace (safe-return check): the
 * path matches a surface destination, ignoring anchors and query strings.
 * `/` matches only itself; every other surface matches itself + sub-paths.
 */
export function isRouteInWorkspace(role: Role, pathname: string): boolean {
  const path = pathname.split("#", 1)[0]!.split("?", 1)[0]!;
  return ROLE_WORKSPACES[role].some((surface) => {
    const surfacePath = surface.href.split("#", 1)[0]!;
    if (surfacePath === "/") return path === "/";
    return path === surfacePath || path.startsWith(`${surfacePath}/`);
  });
}

// ---------------------------------------------------------------------------
// Role-aware navigation (J002 — supplements, never replaces)
// ---------------------------------------------------------------------------

/** The base path of a nav href (anchors address sections of the same page). */
function basePathOf(href: string): string {
  return href.split("#", 1)[0]!;
}

/**
 * The role's workspace SUPPLEMENT (J002): the workspace's own surfaces the
 * core product navigation does not already serve, in the matrix's order.
 *
 * The workspace model itself stays the matrix's product surface map
 * verbatim (entry points, safe-return membership — unchanged); what J002
 * changes is the PROJECTION: a role's navigation SUPPLEMENTS the core
 * product navigation instead of replacing it, so Home, Live, Explore,
 * Library, Following and Create stay reachable from EVERY role state — no
 * role workspace can trap a visitor away from the global product.
 */
export function workspaceSupplements(role: string | null | undefined): readonly NavItem[] {
  if (role === null || role === undefined) return [];
  const workspace = ROLE_WORKSPACES[role as Role];
  if (workspace === undefined) return [];
  const corePaths = new Set(PRIMARY_NAV.map((item) => basePathOf(item.href)));
  return workspace
    .filter((surface) => !corePaths.has(basePathOf(surface.href)))
    .map((surface) => ({
      href: surface.href as NavItem["href"],
      label: surface.label,
      description: surface.description,
      icon: surface.icon,
    }));
}

/**
 * The navigation items for the given active role (a wire string — validated):
 * J002 — the CORE product navigation first, then the role's workspace
 * supplement. A role in the vocabulary never REMOVES a core destination;
 * no active role (or an unknown wire string — fail-closed) shows the
 * shared navigation alone. Presentation context only, never authority.
 */
export function navForRole(role: string | null | undefined): readonly NavItem[] {
  const supplements = workspaceSupplements(role);
  return supplements.length === 0 ? PRIMARY_NAV : [...PRIMARY_NAV, ...supplements];
}

/**
 * One rendered navigation group (J002): the core product group, plus the
 * labeled workspace supplement group when a role is active.
 */
export interface NavGroup {
  id: "core" | "workspace";
  /** Visible heading (null for the core group — the product nav needs none). */
  label: string | null;
  items: readonly NavItem[];
}

/**
 * The grouped navigation model both shells render (J002): the core product
 * group first, then the active role's labeled workspace supplement group.
 * The desktop sidebar shows the group heading; the mobile tab bar keeps
 * the flat scrollable row (the account chip already names the workspace).
 */
export function navGroupsForRole(role: string | null | undefined): readonly NavGroup[] {
  const supplements = workspaceSupplements(role);
  if (supplements.length === 0) {
    return [{ id: "core", label: null, items: PRIMARY_NAV }];
  }
  const label = ROLE_LABELS[role as Role];
  return [
    { id: "core", label: null, items: PRIMARY_NAV },
    { id: "workspace", label: `${label} workspace`, items: supplements },
  ];
}

// ---------------------------------------------------------------------------
// The role switcher model (grants-only, context-only)
// ---------------------------------------------------------------------------

/** The account shape the switcher needs (the real /api/auth/me projection). */
export interface SwitcherAccount {
  /** The account's grants (untrusted wire strings — validated below). */
  roles: readonly string[];
  activeRole: string | null;
}

/**
 * The roles the switcher may offer: EXACTLY the account's grants that are in
 * the closed role vocabulary, in the canonical ROLES order — a role the
 * account does not hold is never switchable, and an unknown wire string is
 * never offered either (fail-closed against version skew).
 */
export function switchableRoles(account: SwitcherAccount): readonly Role[] {
  const grants = new Set(account.roles);
  return ROLES.filter((role) => grants.has(role));
}

// ---------------------------------------------------------------------------
// Pending work
// ---------------------------------------------------------------------------

/** One role's pending-work answer (from the real data planes; null = none). */
export interface PendingWork {
  /** Short human label for the badge (e.g. "2 jobs in flight"). */
  label: string;
  /** The count behind the label (always > 0 — zero pending is null). */
  count: number;
}

/** Per-role pending work, ONLY for roles the account holds. */
export type PendingWorkByRole = Partial<Record<Role, PendingWork>>;

/** Formats a pending-work badge, or null when there is nothing pending. */
export function formatPendingWork(
  kind: "creator-jobs" | "operator-failures",
  count: number,
): PendingWork | null {
  if (!Number.isInteger(count) || count <= 0) return null;
  return {
    label:
      kind === "creator-jobs"
        ? `${count} job${count === 1 ? "" : "s"} in flight`
        : `${count} failed job${count === 1 ? "" : "s"}`,
    count,
  };
}
