import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DeferredSurface } from "@/components/deferred-surface";

export const metadata: Metadata = {
  title: "Audit",
};

/**
 * Audit (W907) — the honest deferred audit surface for the Rights Holder
 * (rights scope) and Operator (system scope) workspaces: no audit log is
 * exposed by the control plane yet (W917/W918), so the page says exactly
 * that instead of fabricating an activity feed.
 */
export default function AuditPage() {
  return (
    <>
      <PageHeader
        kicker="Accountability"
        title="Audit"
        description="The audit trail for your scope — honestly empty until the control plane exposes one."
      />
      <DeferredSurface surface="audit" />
    </>
  );
}
