import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DeferredSurface } from "@/components/deferred-surface";
import { SportaMark } from "@/components/sporta-mark";
import { BRAND, REALITIES } from "@/lib/brand";
import { ROUTES } from "@/lib/navigation";

export const metadata: Metadata = {
  title: "Home",
};

/**
 * Home (W903). The shell of the main discovery surface: the brand story,
 * the four realities Sporta will offer, and — per ux-architecture — the
 * three home categories (live/upcoming, alternate realities, things to
 * create), each rendered as an honest deferred surface because no real
 * catalog exists yet.
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
            Sporta turns a single sporting event into many viewing realities.
            Watch the original broadcast, then switch — without leaving the
            match — into an Anime, 3D or Tactical rendering of the same
            event, all backed by one sports world model.
          </p>
          <div className="hero-actions">
            <Link className="button-primary" href="#coming-to-sporta">
              See what&rsquo;s coming
            </Link>
            <Link className="button-ghost" href={ROUTES.explore}>
              Browse Explore
            </Link>
          </div>
          <p className="hero-note">
            You are looking at the product shell. It loads, navigates and
            installs — and every data surface says plainly what it is
            waiting for.
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
            These are the visual realities of one event — not different
            matches. Availability on any given event will be shown honestly,
            driven by real renderer capabilities and rights.
          </p>
        </header>
        <ul className="reality-grid" id="coming-to-sporta">
          {REALITIES.map((reality) => (
            <li
              key={reality.key}
              className="reality-card"
              data-reality={reality.key}
            >
              <span
                className="reality-swatch"
                style={
                  {
                    "--reality-accent":
                      BRAND.realityAccents[reality.key],
                  } as React.CSSProperties
                }
                aria-hidden="true"
              />
              <h3 className="reality-name">{reality.name}</h3>
              <p className="reality-description">{reality.description}</p>
              <p className="status-chip subtle" role="status">
                Planned — not yet available
              </p>
            </li>
          ))}
        </ul>
      </section>

      <PageHeader
        kicker="Home"
        title="Today on Sporta"
        description="The three home shelves — live and upcoming matches, alternate realities of those matches, and things you can create — appear below as they become real."
      />
      <div className="surface-stack">
        <DeferredSurface surface="home-live" />
        <DeferredSurface surface="home-realities" />
        <DeferredSurface surface="home-create" />
      </div>
    </>
  );
}
