import Link from "next/link";
import { ROUTES } from "@/lib/navigation";

/**
 * 404 (W903). Same honest shell, standard recovery action.
 */
export default function NotFound() {
  return (
    <>
      <header className="page-header">
        <p className="page-kicker">404</p>
        <h1 className="page-title">Page not found</h1>
        <p className="page-description">This address isn&rsquo;t part of the Sporta shell (yet).</p>
      </header>
      <section className="offline-panel">
        <Link className="button-primary" href={ROUTES.home}>
          Back to Home
        </Link>
      </section>
    </>
  );
}
