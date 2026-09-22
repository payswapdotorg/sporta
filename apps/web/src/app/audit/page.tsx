import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DeferredSurface } from "@/components/deferred-surface";

export const metadata: Metadata = {
  title: "Audit",
};

/**
 * Audit (W907 → J003) — the honest deferred audit surface for the Rights
 * Holder (rights scope) and Operator (system scope) workspaces. Audit
 * trails EXIST today behind two real surfaces (the Rights Center's
 * policy-change audit and the Operations console's remediation audit) and
 * the role-gated rights-audit query exists at the domain level (J009);
 * this page's own unified per-scope view arrives with the J009 UI lane.
 * The panel's next action points at the rights policy audit that exists.
 */
export default function AuditPage() {
  return (
    <>
      <PageHeader
        kicker="Accountability"
        title="Audit"
        description="The audit trail for your scope — the trails exist behind the Rights Center and Operations; this page arrives with the J009 UI lane."
      />
      <DeferredSurface surface="audit" />
    </>
  );
}
