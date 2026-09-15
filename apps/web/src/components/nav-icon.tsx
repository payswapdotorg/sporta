import type { ReactNode } from "react";
import type { NavIcon } from "@/lib/navigation";

/**
 * Original geometric Sporta iconography (W903).
 *
 * Hand-drawn 24×24 stroke glyphs — no icon-library dependency, no
 * third-party artwork. Decorative by default: navigation links already
 * carry visible text labels, so the glyph is aria-hidden.
 */

const GLYPHS: Record<NavIcon, ReactNode> = {
  home: (
    <>
      <path d="M4 11.6 12 4.5l8 7.1" />
      <path d="M6.4 10.4V19a.9.9 0 0 0 .9.9h9.4a.9.9 0 0 0 .9-.9v-8.6" />
    </>
  ),
  live: (
    <>
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <path d="M8.1 8.1a5.5 5.5 0 0 0 0 7.8M15.9 8.1a5.5 5.5 0 0 1 0 7.8" />
      <path d="M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2" />
    </>
  ),
  explore: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="m15.2 8.8-1.9 4.5-4.5 1.9 1.9-4.5z" />
    </>
  ),
  library: (
    <>
      <path d="M4.5 6.5h11M4.5 11h11M4.5 15.5h7" />
      <path d="M19.5 5.5v13" />
    </>
  ),
  following: (
    <>
      <circle cx="9" cy="8.6" r="3" />
      <path d="M3.8 19.2c.8-3 2.9-4.4 5.2-4.4s4.4 1.4 5.2 4.4" />
      <circle cx="16.9" cy="9.6" r="2.4" />
      <path d="M15.9 14.9c2.2.1 3.7 1.4 4.3 4.1" />
    </>
  ),
  create: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <path d="M12 9v6M9 12h6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.4" />
      <path d="m15.8 15.8 4.2 4.2" />
    </>
  ),
  watch: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <path d="M10.1 8.7v6.6l5.6-3.3z" fill="currentColor" stroke="none" />
    </>
  ),
  signin: (
    <>
      <circle cx="12" cy="8.4" r="3.4" />
      <path d="M5.6 19.6c1-3.7 3.4-5.4 6.4-5.4s5.4 1.7 6.4 5.4" />
    </>
  ),
};

export function NavIcon({ name }: { name: NavIcon }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
}
