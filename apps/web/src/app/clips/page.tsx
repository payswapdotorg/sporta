import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DeferredSurface } from "@/components/deferred-surface";

export const metadata: Metadata = {
  title: "Clips",
};

/**
 * Clips (W907) — the Analyst workspace's honest deferred clips surface:
 * no clips data plane exists yet, so nothing is cut, stored or simulated.
 */
export default function ClipsPage() {
  return (
    <>
      <PageHeader
        kicker="Analyst"
        title="Clips"
        description="Saved analysis clips — honestly deferred until a clips data plane exists."
      />
      <DeferredSurface surface="clips" />
    </>
  );
}
