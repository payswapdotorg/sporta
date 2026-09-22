import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { RightsCenter } from "@/components/rights-center";

export const metadata: Metadata = {
  title: "Rights Center",
};

/**
 * Rights Center (W907 + J008) — the Rights Holder workspace: the real
 * rights-policy records of the sessions the account owns (operators:
 * controls), each read through the identity control gate — and, since the
 * J008 UI lane, EDITABLE (narrow-only, through the domain rights-editor
 * seam) and REVOCABLE (playback/publication stop fail-closed, verifiable
 * from the surface).
 */
export default function RightsPage() {
  return (
    <>
      <PageHeader
        kicker="Rights Holder"
        title="Rights Center"
        description="The rights policies on the sessions you own or control — inspect them through the control gate, edit them (narrow-only), or revoke them; every change is audited and every serving seam re-derives from it immediately."
      />
      <RightsCenter />
    </>
  );
}
