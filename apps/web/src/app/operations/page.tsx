import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { OperationsSurface } from "@/components/operations-surface";

export const metadata: Metadata = {
  title: "Operations",
};

/**
 * Operations (W907) — the Operator workspace: real platform health (the
 * shared /api/platform/health snapshot), provider bindings, the compute
 * plane, the live transport state and failed jobs. Queues stay honestly
 * unavailable until the control plane exposes them.
 */
export default function OperationsPage() {
  return (
    <>
      <PageHeader
        kicker="Operator"
        title="Operations"
        description="Platform health, providers, compute, live transport and failed jobs — real data only, honest unavailable where no surface exists yet."
      />
      <OperationsSurface />
    </>
  );
}
