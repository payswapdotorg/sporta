/**
 * Accessibility contract for the Sporta web shell (W903).
 *
 * The ids/labels live in one pure module so the layout, the components and
 * the tests cannot drift apart: tests assert that the skip link points at
 * the real main landmark and that landmark labels are wired the way the
 * accessibility baseline requires.
 */

export const A11Y = {
  /** Skip-link target: the primary content landmark. */
  mainId: "main-content",
  skipLinkText: "Skip to main content",
  /** Landmark labels (screen-reader names). */
  sidebarNavLabel: "Primary",
  tabbarNavLabel: "Primary",
  searchFormLabel: "Search Sporta",
  searchInputLabel: "Search matches, realities and creators",
  footerNavLabel: "Footer",
} as const;

export const SKIP_LINK_HREF = `#${A11Y.mainId}`;
