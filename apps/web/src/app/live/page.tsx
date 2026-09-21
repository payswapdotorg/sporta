import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { LiveSurface } from "@/components/live-surface";

export const metadata: Metadata = {
  title: "Live",
};

/**
 * Live (W904 → W915 → L005 → L013). Live is a capability verdict (Simulation F):
 * the surface renders whatever the REAL transport state says — with the SSE
 * live transport env-active (`SPORTA_LIVE_TRANSPORT=sse`), the players
 * consume REAL network streams (the story timelines' animated-SVG frames
 * and the live tactical view's world frames, with measured end-to-end
 * latency); otherwise the honest unavailable state. The tactical sessions
 * offer both presentations — the 2D canvas and the interactive 3D view.
 */
export default function LivePage() {
  return (
    <>
      <PageHeader
        kicker="Watch"
        title="Live"
        description="Real live network streaming when the SSE transport is enabled — never simulated. The live tactical view renders live world state on the canonical pitch as it changes, with an interactive 3D presentation of the same world frames."
      />
      <LiveSurface />
    </>
  );
}
