"use client";

import { useEffect, useState } from "react";
import type { CapabilityLike, SessionCardLike } from "@/lib/api-types";
import type { FetchState } from "@/lib/client-api";
import { fetchCapability, fetchCatalog } from "@/lib/client-api";
import { deriveExploreState } from "@/lib/surface-state";
import { SessionCard } from "@/components/session-card";
import { LoadingPanel, StateChip, StatePanel } from "@/components/state-panels";

/**
 * The Explore data surface (W904): the real catalog, every card carrying its
 * real status and availability. The whole-shelf verdict is the derived
 * explore state (degraded surfaces remain real listings).
 */
export function ExploreSurface() {
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
    return <LoadingPanel label="Explore" />;
  }
  if (capability.phase === "failed" || catalog.phase === "failed") {
    return (
      <StatePanel
        state="failed"
        title="The catalog could not be read"
        reason="The capability or catalog request failed — a real failure, not simulated."
      />
    );
  }

  const verdict = deriveExploreState(capability.data, catalog.data);

  return (
    <div className="surface-stack">
      {verdict.state !== "ready" && <StatePanel state={verdict.state} title="Explore" reason={verdict.reason} />}
      <section className="explore-catalog" aria-labelledby="explore-all">
        <header className="section-head">
          <h2 className="section-title" id="explore-all">The full catalog</h2>
          <StateChip state={verdict.state}>{verdict.state}</StateChip>
        </header>
        <p className="section-lede">
          {catalog.data.length} real control-plane session(s). Every card carries its real event
          status, renderer availability and playback-rights state.
        </p>
        <ul className="card-grid">
          {catalog.data.map((card) => (
            <li key={card.sessionId}>
              <SessionCard card={card} capability={capability.data} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
