import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { ComputeCenterSurface } from "@/components/compute-center";

export const metadata: Metadata = {
  title: "Compute",
};

/**
 * The Compute Connection Center (J005) — the first-class, persistent,
 * URL-addressable destination for the account's compute: the
 * Sporta-compute vs BYOC distinction in goal-oriented language, the
 * connect/verify/disconnect lifecycle with typed failure states, the
 * no-master-passwords posture, and the caller's allowance/usage context.
 *
 * Reachable from the account menu (every signed-in surface) and from the
 * Create Studio's compute step — no guessing URLs (Journey 3).
 */
export default function ComputeCenterPage() {
  return (
    <>
      <PageHeader
        kicker="Account"
        title="Compute"
        description="Your compute connections — Sporta's managed compute or your own provider accounts (BYOC), with honest verification states and no master passwords, ever."
      />
      <ComputeCenterSurface />
    </>
  );
}
