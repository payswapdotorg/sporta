import Link from "next/link";
import { PRIMARY_NAV, ROUTES } from "@/lib/navigation";
import { A11Y } from "@/lib/a11y";
import { BRAND } from "@/lib/brand";
import { SportaMark } from "@/components/sporta-mark";

/**
 * Site footer: brand, the primary destinations repeated as a footer nav,
 * and the honest pre-beta statement. Laid out with `margin-top: auto`
 * inside the flex app frame so it always sits at the bottom of the
 * viewport, with no floating gap on short pages.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="footer-brand">
          <div className="footer-mark">
            <SportaMark size={26} />
            <span className="brand-name">Sporta</span>
          </div>
          <p className="footer-tagline">{BRAND.tagline}</p>
          <p className="footer-note">
            Pre-beta shell: this app is the Sporta product frontend before
            the data plane exists. Surfaces populate as real capabilities
            land — nothing here is simulated.
          </p>
        </div>
        <nav className="footer-nav" aria-label={A11Y.footerNavLabel}>
          <ul>
            {PRIMARY_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
            <li>
              <Link href={ROUTES.signin}>Sign in</Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="site-footer-legal">
        <p>© Sporta — a work in progress.</p>
      </div>
    </footer>
  );
}
