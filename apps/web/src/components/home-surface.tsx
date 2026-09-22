"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CapabilityLike, SessionCardLike, StudioOptionsLike } from "@/lib/api-types";
import type { FetchState } from "@/lib/client-api";
import { fetchCapability, fetchCatalog, fetchCreateOptions } from "@/lib/client-api";
import {
  collectRealityCards,
  deriveHomeCreateState,
  deriveHomeRealityStatus,
  deriveHomeShelves,
  HOME_REALITY_KIND_BY_KEY,
  isWatchable,
} from "@/lib/surface-state";
import { SessionCard } from "@/components/session-card";
import { LoadingPanel, StateChip, StatePanel } from "@/components/state-panels";
import { ProviderNotices } from "@/components/provider-notices";
import { BRAND, REALITIES } from "@/lib/brand";
import { ROUTES } from "@/lib/navigation";

/**
 * The Home data surfaces (W904 → J001): the ux-architecture's three
 * simultaneous messages — sports people are watching / alternate realities
 * / things you can create — each driven by the REAL capability response,
 * the control-plane catalog and the Create Studio's live options. Since
 * J001 the reality grid and the create shelf reflect the LIVE capability
 * state too (no static "registered"/"not registered" promises, no deferred
 * panel where a real entry exists): the grid's per-reality chips derive
 * from the same seams the studio uses, and the create shelf exposes the
 * REAL Create entry (`/create`, the W906 surface) — never a dead end.
 */

/** The shared capability + create-options fetch both J001 surfaces run. */
function useCapabilityAndOptions() {
  const [capability, setCapability] = useState<FetchState<CapabilityLike>>({ phase: "loading" });
  const [options, setOptions] = useState<FetchState<StudioOptionsLike | null>>({
    phase: "loading",
  });

  useEffect(() => {
    void fetchCapability().then(
      (data) => setCapability({ phase: "ready", data }),
      (error) => setCapability({ phase: "failed", error: String(error) }),
    );
    // 401 (anonymous) is the expected null here — the shelf and grid derive
    // their honest anonymous states from it; only a REAL failure is failed.
    void fetchCreateOptions().then(
      (data) => setOptions({ phase: "ready", data }),
      (error) => setOptions({ phase: "failed", error: String(error) }),
    );
  }, []);

  return {
    capability,
    options,
    /** null unless the options were READ (anonymous reads as null-by-design). */
    optionsOrNull: options.phase === "ready" ? options.data : null,
  };
}

/**
 * J001 — the four-realities grid, capability-driven: every card's status
 * chip is derived from the LIVE seams (the studio's own offered/reason
 * rows when signed in; the public capability response's renderer registry
 * otherwise). The card copy (name/description/accent) is the brand's;
 * the AVAILABILITY is never a static promise.
 */
export function HomeRealityGrid() {
  const { capability, optionsOrNull } = useCapabilityAndOptions();

  return (
    <ul className="reality-grid" id="coming-to-sporta">
      {REALITIES.map((reality) => {
        const status =
          capability.phase === "ready"
            ? deriveHomeRealityStatus(
                HOME_REALITY_KIND_BY_KEY[reality.key],
                capability.data,
                optionsOrNull,
              )
            : null;
        return (
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
            {status !== null ? (
              <div className="reality-status">
                <StateChip state={status.state}>{status.state}</StateChip>
                <p className="reality-status-reason">{status.reason}</p>
              </div>
            ) : capability.phase === "failed" ? (
              <div className="reality-status">
                <StateChip state="failed">failed</StateChip>
                <p className="reality-status-reason">
                  the live capability state could not be read — a real failure, not simulated; retry
                  from your browser
                </p>
              </div>
            ) : (
              <StateChip state="loading">loading</StateChip>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * J001 — the create shelf: the REAL Create entry (the W906 Create Studio)
 * with its live capability state — which realities the studio offers today
 * and whether the real upload path is open — plus the honestly-deferred
 * note for the personalized-ideas part (there is no recommendation plane,
 * so nothing is suggested or simulated there).
 */
export function HomeCreateShelf() {
  const { capability, optionsOrNull } = useCapabilityAndOptions();

  if (capability.phase === "loading") {
    return <LoadingPanel label="Things you can create" />;
  }
  if (capability.phase === "failed") {
    return (
      <StatePanel
        state="failed"
        title="The create state could not be read"
        reason="The capability request failed. This is a real failure, not simulated — retry from your browser when the service is back."
      />
    );
  }

  const verdict = deriveHomeCreateState(capability.data, optionsOrNull);

  return (
    <section className="home-shelf" aria-labelledby="shelf-create" data-shelf="create">
      <header className="section-head">
        <h2 className="section-title" id="shelf-create">
          Things you can create
        </h2>
        <StateChip state={verdict.state}>{verdict.state}</StateChip>
      </header>
      <p className="section-lede">{verdict.reason}</p>
      <div className="create-entry">
        <Link className="create-entry-link" href={ROUTES.create}>
          <span className="create-entry-title">Open the Create Studio</span>
          <span className="create-entry-note">
            Turn authorized footage into new viewing realities: a real MP4 upload, your rights
            declaration, and one submission for every reality you select.
          </span>
        </Link>
        {verdict.offeredRealityLabels.length > 0 && (
          <p className="create-entry-facts">
            Offered today: {verdict.offeredRealityLabels.join(", ")}
          </p>
        )}
      </div>
      <p className="section-lede">
        Personalized starting points would need a recommendation plane that does not exist yet —
        nothing is suggested or simulated here; the studio itself is real and one click away.
      </p>
    </section>
  );
}

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
      <ProviderNotices capability={capability.data} />
      <section className="home-shelf" aria-labelledby="shelf-live" data-shelf="live">
        <header className="section-head">
          <h2 className="section-title" id="shelf-live">
            Live and upcoming
          </h2>
          <StateChip state={shelves.live.state === "ready" ? "ready" : "not-live"}>
            {shelves.live.state === "ready" ? "live" : "not live"}
          </StateChip>
        </header>
        <p className="section-lede">{shelves.live.reason}</p>
      </section>

      <section className="home-shelf" aria-labelledby="shelf-watch" data-shelf="watch-now">
        <header className="section-head">
          <h2 className="section-title" id="shelf-watch">
            Sports people are watching
          </h2>
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
          <h2 className="section-title" id="shelf-realities">
            Alternate realities of those matches
          </h2>
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
