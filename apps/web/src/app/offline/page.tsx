import type { Metadata } from "next";
import Link from "next/link";
import { ROUTES } from "@/lib/navigation";

export const metadata: Metadata = {
  title: "Offline",
};

/**
 * Offline fallback (W903). Precached by the service worker and served for
 * failed navigations while offline. The honest message: only the app shell
 * is cached — Sporta has no offline data plane yet.
 */
export default function OfflinePage() {
  return (
    <>
      <header className="page-header">
        <p className="page-kicker">Offline</p>
        <h1 className="page-title">You&rsquo;re offline</h1>
        <p className="page-description">
          Sporta&rsquo;s app shell was loaded from your device, but this preview has no offline
          data: every page needs the network to show real content.
        </p>
      </header>
      <section className="offline-panel">
        <p>
          Reconnect and try again — nothing was lost, because nothing here pretends to work without
          the network.
        </p>
        <Link className="button-primary" href={ROUTES.home}>
          Try Home again
        </Link>
      </section>
    </>
  );
}
