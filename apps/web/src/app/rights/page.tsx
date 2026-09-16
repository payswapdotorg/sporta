import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { RightsCenter } from "@/components/rights-center";

export const metadata: Metadata = {
  title: "Rights Center",
};

/**
 * Rights Center (W907) — the Rights Holder workspace: the real rights-policy
 * records of the sessions the account owns (operators: controls), each read
 * through the identity control gate. Read-only by design; policy editing is
 * W917 scope.
 */
export default function RightsPage() {
  return (
    <>
      <PageHeader
        kicker="Rights Holder"
        title="Rights Center"
        description="The rights policies on the sessions you own or control — policy records and their fail-closed capability decisions, read through the control gate."
      />
      <RightsCenter />
    </>
  );
}
