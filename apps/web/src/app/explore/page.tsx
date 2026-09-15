import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DeferredSurface } from "@/components/deferred-surface";

export const metadata: Metadata = {
  title: "Explore",
};

/**
 * Explore (W903). Discovery arrives with the catalog (W904); the shell
 * reserves the surface without decorating it with sample content.
 */
export default function ExplorePage() {
  return (
    <>
      <PageHeader
        kicker="Discover"
        title="Explore"
        description="Browse the Sporta catalog — matches, realities, creators and collections — filtered to what your account is authorized to see."
      />
      <div className="surface-stack">
        <DeferredSurface surface="explore" />
      </div>
    </>
  );
}
