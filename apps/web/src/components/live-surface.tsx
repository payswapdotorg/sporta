"use client";

import { useEffect, useState } from "react";
import type { CapabilityLike } from "@/lib/api-types";
import type { FetchState } from "@/lib/client-api";
import { fetchCapability } from "@/lib/client-api";
import { deriveLiveState } from "@/lib/surface-state";
import { LoadingPanel, StateChip, StatePanel } from "@/components/state-panels";

/**
 * The Live data surface (W904, Simulation F): live is a CAPABILITY verdict.
 * With the in-process control plane this deployment runs, the surface shows
 * the honest unavailable state — never a simulated live badge.
 */
export function LiveSurface() {
  const [capability, setCapability] = useState<FetchState<CapabilityLike>>({ phase: "loading" });

  useEffect(() => {
    void fetchCapability().then(
      (data) => setCapability({ phase: "ready", data }),
      (error) => setCapability({ phase: "failed", error: String(error) }),
    );
  }, []);

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
        </dl>
        <p className="section-lede">
          Sporta labels something live only when a real live network transport backs it. When the
          live transport arrives (W915), this page lists it — from this same capability field.
        </p>
        <StateChip state="not-live">not live</StateChip>
      </section>
    </div>
  );
}
