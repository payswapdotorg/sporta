/**
 * The browser-E2E inventory (W909) — the PURE model the harness executes.
 *
 * No Node, no browser, no React imports: this module is directly unit-tested
 * from the root `bun test` suite (apps/web/test/e2e-harness.test.ts) so the
 * E2E contract — which acceptance lines exist, which app routes each flow
 * must reach, and in which order the flows run — can never drift from the
 * product's own navigation model (`@/lib/navigation` ROUTES).
 */
import { ROUTE_PATHS } from "@/lib/navigation";

/** Every flow the W909 acceptance requires, as a stable id vocabulary. */
export const E2E_FLOW_IDS = [
  "a11y-smoke",
  "sign-in",
  "rights-denial",
  "watch",
  "reality-switch",
  "output-playback",
  "render",
  "role-switch",
] as const;

export type E2EFlowId = (typeof E2E_FLOW_IDS)[number];

/** One acceptance flow's specification (data, not behavior). */
export interface E2EFlowSpec {
  id: E2EFlowId;
  /** Human title used in the evidence report. */
  title: string;
  /** The W909 acceptance line(s) this flow proves. */
  covers: string;
  /**
   * App routes the flow must reach. Validated against ROUTE_PATHS — a flow
   * pointing at a route the product shell does not own is a harness bug.
   */
  routes: readonly string[];
}

/**
 * The full inventory. Order matters only as documentation — the runner uses
 * {@link recommendedFlowOrder} for the actual execution sequence.
 */
export const E2E_FLOW_INVENTORY: readonly E2EFlowSpec[] = [
  {
    id: "sign-in",
    title: "Sign-in — register → login → nav shows the account → sign out",
    covers: "W909: sign-in (register → login → nav shows the account → sign out)",
    routes: ["/auth/signin", "/library"],
  },
  {
    id: "watch",
    title: "Watch — the real output renders (SVG frames) + timeline/event markers",
    covers:
      "W909: watch (open /watch?session=<seeded> → the real output renders → markers visible)",
    routes: ["/watch"],
  },
  {
    id: "reality-switch",
    title: "Reality Switcher — real availabilities, switch without page reload",
    covers:
      "W909: reality switcher (real renderer availabilities → switch updates the player surface, no reload)",
    routes: ["/watch"],
  },
  {
    id: "render",
    title: "Render — guided flow → dispatch → progress → succeeded → output exists",
    covers:
      "W909: render (/create → the guided flow → dispatch → progress → succeeded → the output exists)",
    routes: ["/auth/signin", "/create"],
  },
  {
    id: "rights-denial",
    title: "Rights denial — viewer/anonymous on a denied route → real 403 state, no bytes",
    covers:
      "W909: rights denial (a viewer/anonymous hitting a denied route → the real 403/404 state rendered, no bytes)",
    routes: ["/operations", "/rights"],
  },
  {
    id: "role-switch",
    title: "Role switch — grants-only offers; switching changes the workspace nav",
    covers:
      "W909: role switch (the profile switcher → grants-only roles → switching changes the workspace nav, context-only)",
    routes: ["/auth/signin", "/operations", "/rights"],
  },
  {
    id: "output-playback",
    title: "Output playback — the real output document loads and its frames render",
    covers: "W909: output playback (the real output document loads and its frames render)",
    routes: ["/watch"],
  },
  {
    id: "a11y-smoke",
    title: "Accessibility smoke — skip link, landmarks, alt text, contrast, keyboard",
    covers:
      "W909: accessibility smoke (skip-link + landmarks + images alt + contrast spot-check + keyboard nav)",
    routes: ["/", "/watch"],
  },
];

/** Type guard for values claimed to be E2E flow ids. */
export function isE2EFlowId(id: string): id is E2EFlowId {
  return (E2E_FLOW_IDS as readonly string[]).includes(id);
}

/**
 * The route availability model: for every flow, every route it must reach
 * must be a route the product shell owns (ROUTE_PATHS). Returns the routes
 * that are NOT known to the shell — empty means the inventory is sound.
 */
export function unknownInventoryRoutes(
  inventory: readonly E2EFlowSpec[] = E2E_FLOW_INVENTORY,
  knownRoutes: readonly string[] = ROUTE_PATHS,
): string[] {
  const known = new Set(knownRoutes);
  const unknown: string[] = [];
  for (const flow of inventory) {
    for (const route of flow.routes) {
      if (!known.has(route)) unknown.push(`${flow.id}: ${route}`);
    }
  }
  return unknown;
}

/**
 * The recommended execution order (data — the runner follows this):
 *
 * 1. a11y-smoke      — anonymous, home + watch (also proves public watch)
 * 2. sign-in         — ends SIGNED IN as the fresh viewer account
 * 3. rights-denial   — uses that viewer (then anonymous) on denied routes
 * 4. watch           — anonymous watch of the seeded session
 * 5. reality-switch  — continues on the same watch page (no reload proof)
 * 6. output-playback — the output document + frame stepping on that page
 * 7. render          — registers a creator and runs the full studio flow
 * 8. role-switch     — grants-only menus, the demo account's five roles
 */
export function recommendedFlowOrder(): readonly E2EFlowId[] {
  return [
    "a11y-smoke",
    "sign-in",
    "rights-denial",
    "watch",
    "reality-switch",
    "output-playback",
    "render",
    "role-switch",
  ];
}

/** Every inventory id appears in the recommended order exactly once. */
export function orderCoversInventory(
  order: readonly E2EFlowId[] = recommendedFlowOrder(),
  inventory: readonly E2EFlowSpec[] = E2E_FLOW_INVENTORY,
): boolean {
  const expected = new Set(inventory.map((flow) => flow.id));
  const seen = new Set<E2EFlowId>();
  for (const id of order) {
    if (seen.has(id) || !expected.has(id)) return false;
    seen.add(id);
  }
  return seen.size === expected.size;
}

/** The flow spec for one id (throws on an unknown id — harness bug). */
export function flowSpecOf(id: E2EFlowId): E2EFlowSpec {
  const spec = E2E_FLOW_INVENTORY.find((flow) => flow.id === id);
  if (spec === undefined) throw new Error(`no E2E flow spec for ${id}`);
  return spec;
}
