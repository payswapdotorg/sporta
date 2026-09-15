"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CapabilityLike, SessionCardLike } from "@/lib/api-types";
import type { FetchState } from "@/lib/client-api";
import { fetchCapability, fetchCatalog } from "@/lib/client-api";
import {
  collectRealityCards,
  deriveHomeShelves,
  isWatchable,
} from "@/lib/surface-state";
import { SessionCard } from "@/components/session-card";
import { LoadingPanel, StateChip, StatePanel } from "@/components/state-panels";
import { ROUTES } from "@/lib/navigation";

/**
 * The Home data surface (W904): the ux-architecture's three simultaneous
 * messages — sports people are watching / alternate realities / things you
 * can create — each driven by the REAL capability response + catalog.
 */
export function HomeSurface() {
  const [capability, setCapability] = useState<FetchState<CapabilityLike>>({ phase: "loading" });
  const [catalog, setCatalog] = useState<FetchState<SessionCardLike[]>>({ phase: "loading" });

  useEffect(() => {
    void fetchCapability().then(
      (data) => setCapability({ phase: "ready", data }),
      (error) => setCapability({ phase: "failed", error: String(error) }),
    );
    void fetchCatalog().then(
      (data) => setCatalog({ phase: "ready", data }),
      (error) => setCatalog({ phase: "failed", error: String(error) }),
    );
  }, []);

  if (capability.phase === "loading" || catalog.phase === "loading") {
    return <LoadingPanel label="Today on Sporta" />;
  }
  if (capability.phase === "failed" || catalog.phase === "failed") {
    return (
      <StatePanel
        state="failed"
        title="The product state could not be read"
        reason="The capability or catalog request failed. This is a real failure, not simulated — retry from your browser when the service is back."
      />
    );
  }

  const shelves = deriveHomeShelves(capability.data, catalog.data);
  const watchable = catalog.data.filter(isWatchable);
  const realities = collectRealityCards(capability.data, catalog.data);

  return (
    <div className="surface-stack">
      <section className="home-shelf" aria-labelledby="shelf-live" data-shelf="live">
        <header className="section-head">
          <h2 className="section-title" id="shelf-live">Live and upcoming</h2>
          <StateChip state={shelves.live.state === "ready" ? "ready" : "not-live"}>
            {shelves.live.state === "ready" ? "live" : "not live"}
          </StateChip>
        </header>
        <p className="section-lede">{shelves.live.reason}</p>
      </section>

      <section className="home-shelf" aria-labelledby="shelf-watch" data-shelf="watch-now">
        <header className="section-head">
          <h2 className="section-title" id="shelf-watch">Sports people are watching</h2>
          <StateChip state={shelves.watchNow.state}>{shelves.watchNow.state}</StateChip>
        </header>
        {watchable.length > 0 ? (
          <ul className="card-grid">
            {watchable.map((card) => (
              <li key={card.sessionId}>
                <SessionCard card={card} capability={capability.data} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="section-lede">{shelves.watchNow.reason}</p>
        )}
      </section>

      <section className="home-shelf" aria-labelledby="shelf-realities" data-shelf="realities">
        <header className="section-head">
          <h2 className="section-title" id="shelf-realities">Alternate realities of those matches</h2>
          <StateChip state={shelves.realities.state}>{shelves.realities.state}</StateChip>
        </header>
        {realities.length > 0 ? (
          <ul className="reality-offer-grid">
            {realities.map((reality) => (
              <li key={`${reality.sessionId}:${reality.rendererId}`}>
                <Link
                  className="reality-offer"
                  href={`${ROUTES.watch}?session=${encodeURIComponent(reality.sessionId)}&renderer=${encodeURIComponent(reality.rendererId)}`}
                >
                  <span className="reality-offer-renderer">{reality.rendererId}</span>
                  <span className="reality-offer-session">{reality.sessionLabel}</span>
                  <span className="reality-offer-note">stored output — ready to watch</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="section-lede">{shelves.realities.reason}</p>
        )}
      </section>
    </div>
  );
}
