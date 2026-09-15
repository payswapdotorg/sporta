import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DeferredSurface } from "@/components/deferred-surface";
import { HomeSurface } from "@/components/home-surface";
import { SportaMark } from "@/components/sporta-mark";
import { BRAND, REALITIES } from "@/lib/brand";
import { ROUTES } from "@/lib/navigation";

export const metadata: Metadata = {
  title: "Home",
};

/**
 * Home (W904). The brand story and the four realities Sporta will offer,
 * then the three home categories per ux-architecture — live/upcoming,
 * alternate realities, things you can create — with the first two now REAL
 * (capability + catalog driven) and the create shelf honestly deferred to
 * the Create Studio (W906).
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
            <Link className="button-primary" href={ROUTES.explore}>
              Explore the catalog
            </Link>
            <Link className="button-ghost" href="#todays-sporta">
              What&rsquo;s on today
            </Link>
          </div>
          <p className="hero-note">
            This deployment runs a real in-process control plane with dev-seed content — every
            card, state and output below is real engine output, and live is honestly absent until a
            real live transport exists.
          </p>
        </div>
      </section>

      <section className="realities" aria-labelledby="realities-title">
        <header className="section-head">
          <p className="page-kicker">Coming to Sporta</p>
          <h2 className="section-title" id="realities-title">
            Four ways to watch the same game
          </h2>
          <p className="section-lede">
            These are the visual realities of one event — not different matches. Availability on any
            given event is shown honestly, driven by real renderer capabilities and rights.
          </p>
        </header>
        <ul className="reality-grid" id="coming-to-sporta">
          {REALITIES.map((reality) => (
            <li key={reality.key} className="reality-card" data-reality={reality.key}>
              <span
                className="reality-swatch"
                style={
                  {
                    "--reality-accent": BRAND.realityAccents[reality.key],
                  } as React.CSSProperties
                }
                aria-hidden="true"
              />
              <h3 className="reality-name">{reality.name}</h3>
              <p className="reality-description">{reality.description}</p>
              <p className="status-chip subtle" role="status">
                {reality.key === "anime"
                  ? "Prototype renderer registered"
                  : reality.key === "original"
                    ? "Reference renderer registered"
                    : "No renderer registered yet"}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <div id="todays-sporta">
        <PageHeader
          kicker="Home"
          title="Today on Sporta"
          description="The three home shelves — live and upcoming, alternate realities, and things you can create — driven by the real capability response and control-plane catalog."
        />
        <HomeSurface />
        <DeferredSurface surface="home-create" />
      </div>
    </>
  );
}
