import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { HomeCreateShelf, HomeRealityGrid, HomeSurface } from "@/components/home-surface";
import { SportaMark } from "@/components/sporta-mark";
import { BRAND } from "@/lib/brand";
import { ROUTES } from "@/lib/navigation";

export const metadata: Metadata = {
  title: "Home",
};

/**
 * Home (W904 → J001). The brand story and the four realities Sporta
 * offers, then the three home categories per ux-architecture — live and
 * upcoming, alternate realities, things you can create — ALL REAL and
 * capability-driven since J001: the reality grid's availability chips
 * derive from the live capability/studio seams (never static "registered"
 * wording), and the create shelf exposes the REAL Create Studio entry
 * (`/create`, the W906 surface) — never a deferred dead end.
 */
export default function HomePage() {
  return (
    <>
      <section className="home-hero">
        <div className="hero-mark" aria-hidden="true">
          <SportaMark size={120} />
        </div>
        <div className="hero-copy">
          <p className="page-kicker">The sports reality platform</p>
          <h1 className="hero-title">{BRAND.tagline}</h1>
          <p className="hero-lede">
            Sporta turns a single sporting event into many viewing realities. Watch the original
            broadcast, then switch — without leaving the match — into an Anime, 3D or Tactical
            rendering of the same event, all backed by one sports world model.
          </p>
          <div className="hero-actions">
            <Link className="button-primary" href={ROUTES.create}>
              Create a reality
            </Link>
            <Link className="button-ghost" href={ROUTES.explore}>
              Explore the catalog
            </Link>
            <Link className="button-ghost" href="#todays-sporta">
              What&rsquo;s on today
            </Link>
          </div>
          <p className="hero-note">
            This deployment runs a real in-process control plane with dev-seed content — every card,
            state and output below is real engine output, and live appears only when the real SSE
            live network transport is enabled (SPORTA_LIVE_TRANSPORT=sse) — never simulated.
          </p>
        </div>
      </section>

      <section className="realities" aria-labelledby="realities-title">
        <header className="section-head">
          <p className="page-kicker">The realities of Sporta</p>
          <h2 className="section-title" id="realities-title">
            Four ways to watch the same game
          </h2>
          <p className="section-lede">
            These are the visual realities of one event — not different matches. Availability on any
            given event is shown honestly, driven by real renderer capabilities and rights.
          </p>
        </header>
        <HomeRealityGrid />
      </section>

      <div id="todays-sporta">
        <PageHeader
          kicker="Home"
          title="Today on Sporta"
          description="The three home shelves — live and upcoming, alternate realities, and things you can create — driven by the real capability response and control-plane catalog."
        />
        <HomeSurface />
        <HomeCreateShelf />
      </div>
    </>
  );
}
