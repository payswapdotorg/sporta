import Link from "next/link";
import { ROUTES } from "@/lib/navigation";
import { SportaMark } from "@/components/sporta-mark";
import { SearchBox } from "@/components/search-box";
import { NavIcon } from "@/components/nav-icon";

/**
 * Site header: brand, search seam and the role/profile area.
 *
 * At W903 the role area is honestly minimal — accounts do not exist yet
 * (W902), so there is no avatar, no role chip and no session state: just
 * the real action that exists, signing in, routed to the /auth/signin
 * scaffold.
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
          <Link href={ROUTES.signin} className="signin-link">
            <NavIcon name="signin" />
            <span>Sign in</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
