import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DeferredSurface } from "@/components/deferred-surface";

export const metadata: Metadata = {
  title: "Following",
};

/**
 * Following (W903). Needs accounts plus a real follow graph (W902);
 * no activity is simulated.
 */
export default function FollowingPage() {
  return (
    <>
      <PageHeader
        kicker="You"
        title="Following"
        description="New realities, events and creator activity from everything you follow."
      />
      <div className="surface-stack">
        <DeferredSurface surface="following" />
      </div>
    </>
  );
}
