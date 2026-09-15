import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DeferredSurface } from "@/components/deferred-surface";

export const metadata: Metadata = {
  title: "Live",
};

/**
 * Live (W903). The live surface is empty by policy, not by accident:
 * Sporta labels something live only when a real live network transport
 * backs it (ux-operational-simulation, Simulation F). No fake live badges.
 */
export default function LivePage() {
  return (
    <>
      <PageHeader
        kicker="Watch"
        title="Live"
        description="Matches streaming now over real live delivery. Sporta never marks anything live without a real live transport behind it — so while that transport does not exist, this page shows nothing."
      />
      <div className="surface-stack">
        <DeferredSurface surface="live" />
      </div>
    </>
  );
}
