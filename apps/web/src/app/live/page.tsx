import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { LiveSurface } from "@/components/live-surface";

export const metadata: Metadata = {
  title: "Live",
};

/**
 * Live (W904 → W915). Live is a capability verdict (Simulation F): the
 * surface renders whatever the REAL transport state says — with the SSE
 * live transport env-active (`SPORTA_LIVE_TRANSPORT=sse`), the player
 * consumes a REAL network stream (frames + measured end-to-end latency);
 * otherwise the honest unavailable state.
 */
export default function LivePage() {
  return (
    <>
      <PageHeader
        kicker="Watch"
        title="Live"
        description="Real live network streaming when the SSE transport is enabled — never simulated. The state below is the transport's own verdict."
      />
      <LiveSurface />
    </>
  );
}
