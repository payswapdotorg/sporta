import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { RightsPolicyConsole } from "@/components/rights-policy-console";

export const metadata: Metadata = {
  title: "Rights policies",
};

/**
 * The W917 Rights Policy Console: the rights/publication editing surface —
 * inspect, edit and revoke the rights policies of the content you own or
 * control, over the real contracts' semantics, with the append-only audit
 * trail. (The W907 Rights Center page is the workspace shell's read view;
 * this is its editing backend's surface — the two compose.)
 */
export default function RightsPoliciesPage() {
  return (
    <>
      <PageHeader
        kicker="Rights"
        title="Rights policies"
        description="Inspect and change the rights policies of the content you own or control — operations, expiry, visibility and revocation — with every change audited."
      />
      <RightsPolicyConsole />
    </>
  );
}
