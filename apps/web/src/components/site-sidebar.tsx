import { A11Y } from "@/lib/a11y";
import { NavLinks } from "@/components/nav-links";

/**
 * Desktop primary navigation (≥1024px): a left rail rendered from the same
 * shared navigation model as the mobile tab bar.
 */
export function SiteSidebar() {
  return (
    <nav className="site-sidebar" aria-label={A11Y.sidebarNavLabel}>
      <NavLinks variant="sidebar" />
      <div className="sidebar-foot">
        <p className="sidebar-note">
          Every card, state and output on these surfaces reflects real engine data — never
          simulated.
        </p>
      </div>
    </nav>
  );
}
