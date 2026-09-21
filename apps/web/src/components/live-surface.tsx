"use client";

import { useEffect, useState } from "react";
import type { CapabilityLike } from "@/lib/api-types";
import type { FetchState } from "@/lib/client-api";
import { fetchCapability, fetchLiveSources } from "@/lib/client-api";
import type { LiveSourcesLike } from "@/lib/client-api";
import { deriveLiveState } from "@/lib/surface-state";
import { LoadingPanel, StateChip, StatePanel } from "@/components/state-panels";
import { ProviderNotices } from "@/components/provider-notices";
import { LivePlayer } from "@/components/live-player";
import type { LiveSourceOption } from "@/components/live-player";
import { LiveTacticalRenderer } from "@/components/live-tactical";
import type { LiveTacticalSourceOption } from "@/components/live-tactical";
import { Live3dRenderer } from "@/components/live-3d";

/**
 * The Live data surface (W904 → W915 → L005 → L013): live is a CAPABILITY
 * verdict, and — since W915 — a REAL one. When the SSE live transport is
 * env-active (`SPORTA_LIVE_TRANSPORT=sse`) and an authorized live source is
 * registered, the capability response reports `modes.live` available with
 * `live-network` transport evidence, this surface lists the real sources
 * (the story timelines' animated-SVG players AND the L005 live tactical
 * view's per-scenario sessions), and each player consumes the real SSE
 * stream over the real HTTP network.
 *
 * L013: a tactical source offers BOTH presentations of the SAME live
 * world state — the 2D tactical canvas and the interactive 3D view (one
 * stream, one world shape, two renderers; the camera in the 3D view is
 * the user's — state updates never move it).
 *
 * When the transport is NOT active, the surface renders the honest
 * unavailable state — never a simulated live badge (Simulation F).
 */

/** One row of the sources listing (the transport's own data). */
interface LiveSourceRow extends LiveSourceOption {
  sourceKind: "story" | "tactical";
  sourceNote?: string;
}

/** The presentation of a tactical source's world frames. */
type TacticalViewMode = "tactical-2d" | "tactical-3d";

export function LiveSurface() {
  const [capability, setCapability] = useState<FetchState<CapabilityLike>>({ phase: "loading" });
  const [sources, setSources] = useState<FetchState<LiveSourcesLike>>({ phase: "loading" });
  const [picked, setPicked] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<TacticalViewMode>("tactical-2d");

  useEffect(() => {
    void fetchCapability().then(
      (data) => setCapability({ phase: "ready", data }),
      (error) => setCapability({ phase: "failed", error: String(error) }),
    );
  }, []);

  const transportActive =
    capability.phase === "ready" &&
    capability.data.modes.live.availability === "available" &&
    capability.data.modes.live.transportKind === "live-network";

  useEffect(() => {
    if (!transportActive) return;
    void fetchLiveSources().then(
      (data) => setSources({ phase: "ready", data }),
      (error) => setSources({ phase: "failed", error: String(error) }),
    );
  }, [transportActive]);

  if (capability.phase === "loading") {
    return <LoadingPanel label="Live" />;
  }
  if (capability.phase === "failed") {
    return (
      <StatePanel
        state="failed"
        title="The capability state could not be read"
        reason="The capability request failed — a real failure, not simulated."
      />
    );
  }

  const live = deriveLiveState(capability.data);

  const rows: LiveSourceRow[] =
    sources.phase === "ready"
      ? sources.data.sources.map((source) => ({
          sessionId: source.sessionId,
          label: source.label,
          storyKey: source.storyKey,
          sourceKind: source.sourceKind ?? "story",
          ...(source.sourceNote !== undefined ? { sourceNote: source.sourceNote } : {}),
        }))
      : [];
  // The default pick: the FIRST tactical source (the L005 scaffold's live
  // tactical view), else the first source — a deliberate, visible default.
  const selected =
    rows.find((row) => row.sessionId === picked) ??
    rows.find((row) => row.sourceKind === "tactical") ??
    rows[0] ??
    null;

  return (
    <div className="surface-stack">
      <ProviderNotices capability={capability.data} />
      <StatePanel state={live.state} title="Live now" reason={live.reason} />

      {transportActive ? (
        sources.phase === "loading" ? (
          <LoadingPanel label="Live sources" />
        ) : sources.phase === "failed" ? (
          <StatePanel
            state="failed"
            title="The live sources could not be read"
            reason={sources.error}
          />
        ) : rows.length === 0 ? (
          <StatePanel
            state="unavailable"
            title="No live source is registered"
            reason="the live transport is active but no authorized live session is registered — nothing may be labelled live (Simulation F)"
          />
        ) : (
          <>
            <fieldset className="form-field" data-surface="live-source-picker">
              <legend>Live sources (the transport&rsquo;s own list)</legend>
              <ul className="studio-operation-list">
                {rows.map((row) => (
                  <li key={row.sessionId}>
                    <label>
                      <input
                        type="radio"
                        name="live-source"
                        checked={selected?.sessionId === row.sessionId}
                        onChange={() => setPicked(row.sessionId)}
                      />
                      <span className="studio-operation-label">{row.label}</span>
                      <span className="studio-operation-description">
                        {row.sourceKind === "tactical"
                          ? "live tactical view — the live view-model's world frames (L002 deterministic tracking source)"
                          : `dev-seed story timeline (${row.storyKey}), cycled`}
                      </span>
                      {row.sourceKind === "tactical" ? (
                        <StateChip state="ready">tactical view-model</StateChip>
                      ) : (
                        <StateChip state="degraded">story timeline</StateChip>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            {selected !== null &&
              (selected.sourceKind === "tactical" ? (
                <fieldset className="form-field" data-surface="live-view-mode">
                  <legend>View the same live world state as</legend>
                  <ul className="studio-operation-list">
                    <li>
                      <label>
                        <input
                          type="radio"
                          name="live-view-mode"
                          checked={viewMode === "tactical-2d"}
                          onChange={() => setViewMode("tactical-2d")}
                        />
                        <span className="studio-operation-label">2D tactical canvas</span>
                        <span className="studio-operation-description">
                          the canonical top-down pitch — identity-continuous markers
                        </span>
                      </label>
                    </li>
                    <li>
                      <label>
                        <input
                          type="radio"
                          name="live-view-mode"
                          checked={viewMode === "tactical-3d"}
                          onChange={() => setViewMode("tactical-3d")}
                        />
                        <span className="studio-operation-label">3D view (interactive camera)</span>
                        <span className="studio-operation-description">
                          the same world frames in 3D — your camera, never moved by state updates
                          (L013)
                        </span>
                      </label>
                    </li>
                  </ul>
                </fieldset>
              ) : null)}
            {selected !== null &&
              (selected.sourceKind === "tactical" ? (
                viewMode === "tactical-3d" ? (
                  <Live3dRenderer source={selected as LiveTacticalSourceOption} />
                ) : (
                  <LiveTacticalRenderer source={selected as LiveTacticalSourceOption} />
                )
              ) : (
                <LivePlayer source={selected} />
              ))}
          </>
        )
      ) : null}

      <section className="live-transport-detail">
        <h2 className="section-title">What the transport actually is</h2>
        <dl className="session-card-facts">
          <div className="fact">
            <dt>Live availability</dt>
            <dd>{capability.data.modes.live.availability}</dd>
          </div>
          <div className="fact">
            <dt>Reason code</dt>
            <dd>
              <code>{capability.data.modes.live.reasonCode}</code>
            </dd>
          </div>
          <div className="fact">
            <dt>Transport kind</dt>
            <dd>
              <code>{capability.data.modes.live.transportKind}</code>
            </dd>
          </div>
          {sources.phase === "ready" ? (
            <div className="fact">
              <dt>Transport detail</dt>
              <dd>{sources.data.detail}</dd>
            </div>
          ) : null}
        </dl>
        <p className="section-lede">
          Sporta labels something live only when a real live network transport backs it. The
          transport is Server-Sent-Events over HTTP — a genuine network path with real-time delivery
          and measured end-to-end latency. The live tactical view (and its 3D presentation) consumes
          live world state through the same transport (its producer seam re-pointed at the live
          view-model — one stream, one world shape, two renderers). When the transport is not
          enabled on this deployment, this page stays honestly unavailable.
        </p>
        {transportActive ? (
          <StateChip state="ready">live network transport active</StateChip>
        ) : (
          <StateChip state="not-live">not live</StateChip>
        )}
      </section>
    </div>
  );
}
