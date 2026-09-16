import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DeferredSurface } from "@/components/deferred-surface";

export const metadata: Metadata = {
  title: "Notes",
};

/**
 * Notes (W907) — the Analyst workspace's honest deferred notes surface:
 * no notes data plane exists yet, so nothing is written, stored or simulated.
 */
export default function NotesPage() {
  return (
    <>
      <PageHeader
        kicker="Analyst"
        title="Notes"
        description="Analysis notes — honestly deferred until a notes data plane exists."
      />
      <DeferredSurface surface="notes" />
    </>
  );
}
