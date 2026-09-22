import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DeferredSurface } from "@/components/deferred-surface";

export const metadata: Metadata = {
  title: "Clips",
};

/**
 * Clips (W907 → J003) — the Analyst workspace's honest deferred clips
 * surface. The J010 clips data plane EXISTS at the domain level (real
 * timeline-backed markers, durable, no fake bytes); this page is not wired
 * to it yet and arrives with the J010 UI lane. Until then nothing is cut,
 * stored or simulated HERE, and the panel's next action points at Match
 * Lab — the analysis workspace that exists today.
 */
export default function ClipsPage() {
  return (
    <>
      <PageHeader
        kicker="Analyst"
        title="Clips"
        description="Saved analysis clips — the backing plane exists; this page arrives with the J010 UI lane."
      />
      <DeferredSurface surface="clips" />
    </>
  );
}
