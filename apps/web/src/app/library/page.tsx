import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DeferredSurface } from "@/components/deferred-surface";

export const metadata: Metadata = {
  title: "Library",
};

/**
 * Library (W903). Libraries are per-account; accounts arrive with W902,
 * so this surface stays empty rather than showing sample shelves.
 */
export default function LibraryPage() {
  return (
    <>
      <PageHeader
        kicker="You"
        title="Library"
        description="Your saved matches, followed series and the realities you have rendered — collected in one place."
      />
      <div className="surface-stack">
        <DeferredSurface surface="library" />
      </div>
    </>
  );
}
