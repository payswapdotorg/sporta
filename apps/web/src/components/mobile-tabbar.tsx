import { A11Y } from "@/lib/a11y";
import { NavLinks } from "@/components/nav-links";

/**
 * Mobile primary navigation (<1024px): a bottom tab bar with
 * safe-area padding, rendered from the same shared navigation model as
 * the desktop sidebar.
 */
export function MobileTabbar() {
  return (
    <nav className="mobile-tabbar" aria-label={A11Y.tabbarNavLabel}>
      <NavLinks variant="tabbar" />
    </nav>
  );
}
