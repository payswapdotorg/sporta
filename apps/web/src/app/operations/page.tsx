import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { OperationsConsole } from "@/components/operations-console";

export const metadata: Metadata = {
  title: "Operations",
};

/**
 * Operations (W918) — the OPERATOR workspace's console surface. Every panel
 * is served by an operator grant-gated API (the real 401/403 paths for
 * everyone else): the health board, the bounded render queue, the compute
 * jobs ledger (FAILED jobs with their never-silent reasons + safe
 * remediations), the provider panel and the remediation audit trail.
 */
export default function OperationsPage() {
  return (
    <>
      <PageHeader
        kicker="Operator"
        title="Operations"
        description="The hosted platform's real operational state: provider health, the bounded render queue, provider quotas, the compute job ledger with failed-job reasons, and the audit-logged safe remediations."
      />
      <OperationsConsole />
    </>
  );
}
