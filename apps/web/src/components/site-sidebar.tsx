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
          The shell is live; surfaces fill in as the Sporta capability and
          data planes land.
        </p>
      </div>
    </nav>
  );
}
