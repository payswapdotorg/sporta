import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DeferredSurface } from "@/components/deferred-surface";

export const metadata: Metadata = {
  title: "Notes",
};

/**
 * Notes (W907 → J003) — the Analyst workspace's honest deferred notes
 * surface. The J010 notes data plane EXISTS at the domain level (notes on
 * real timeline-backed markers, durable); this page is not wired to it yet
 * and arrives with the J010 UI lane. Until then nothing is written, stored
 * or simulated HERE, and the panel's next action points at Match Lab.
 */
export default function NotesPage() {
  return (
    <>
      <PageHeader
        kicker="Analyst"
        title="Notes"
        description="Analysis notes — the backing plane exists; this page arrives with the J010 UI lane."
      />
      <DeferredSurface surface="notes" />
    </>
  );
}
