"use client";

import { useEffect, useState } from "react";
import type { CapabilityLike } from "@/lib/api-types";
import type { FetchState } from "@/lib/client-api";
import { fetchCapability, fetchLiveSources } from "@/lib/client-api";
import type { LiveSourcesLike } from "@/lib/client-api";
import { deriveLiveState } from "@/lib/surface-state";
import { LoadingPanel, StateChip, StatePanel } from "@/components/state-panels";
import { LivePlayer } from "@/components/live-player";
import type { LiveSourceOption } from "@/components/live-player";

/**
 * The Live data surface (W904 → W915): live is a CAPABILITY verdict, and —
 * since W915 — a REAL one. When the SSE live transport is env-active
 * (`SPORTA_LIVE_TRANSPORT=sse`) and an authorized live source is
 * registered, the capability response reports `modes.live` available with
 * `live-network` transport evidence, this surface lists the real sources,
 * and the player consumes the real SSE stream over the real HTTP network
 * (frames rendered as they arrive; latency measured end-to-end).
 *
 * When the transport is NOT active, the surface renders the honest
 * unavailable state — never a simulated live badge (Simulation F).
 */
export function LiveSurface() {
  const [capability, setCapability] = useState<FetchState<CapabilityLike>>({ phase: "loading" });
  const [sources, setSources] = useState<FetchState<LiveSourcesLike>>({ phase: "loading" });

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

  return (
    <div className="surface-stack">
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
        ) : sources.data.sources.length === 0 ? (
          <StatePanel
            state="unavailable"
            title="No live source is registered"
            reason="the live transport is active but no authorized live session is registered — nothing may be labelled live (Simulation F)"
          />
        ) : (
          <LivePlayer source={sources.data.sources[0] as LiveSourceOption} />
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
          and measured end-to-end latency. When it is not enabled on this deployment, this page
          stays honestly unavailable.
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
