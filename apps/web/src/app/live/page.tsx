import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { LiveSurface } from "@/components/live-surface";

export const metadata: Metadata = {
  title: "Live",
};

/**
 * Live (W904). Live is a capability verdict (Simulation F): with the
 * in-process control plane this deployment runs, the surface renders the
 * honest unavailable state — and shows the real transport evidence it
 * derived that from.
 */
export default function LivePage() {
  return (
    <>
      <PageHeader
        kicker="Watch"
        title="Live"
        description="Matches streaming now over real live delivery. Sporta never marks anything live without a real live transport behind it."
      />
      <LiveSurface />
    </>
  );
}
