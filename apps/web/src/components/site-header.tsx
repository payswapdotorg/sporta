import Link from "next/link";
import { ROUTES } from "@/lib/navigation";
import { SportaMark } from "@/components/sporta-mark";
import { SearchBox } from "@/components/search-box";
import { NavIcon } from "@/components/nav-icon";
import { HeaderAccount } from "@/components/header-account";

/**
 * Site header: brand, search seam and the role/profile area.
 *
 * The profile area is now the real account surface (W904): anonymous visitors
 * see the sign-in action; signed-in visitors see their account, the
 * active-role switcher (workspace only — grants, never authority) and
 * sign-out, all driven by /api/auth state.
 */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href={ROUTES.home} className="brand" aria-label="Sporta — home">
          <SportaMark size={30} />
          <span className="brand-name">Sporta</span>
        </Link>
        <SearchBox />
        <div className="header-actions">
          <Link href={ROUTES.search} className="icon-button search-jump" aria-label="Open search">
            <NavIcon name="search" />
          </Link>
          <HeaderAccount />
        </div>
      </div>
    </header>
  );
}
