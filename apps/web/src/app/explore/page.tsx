import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { ExploreSurface } from "@/components/explore-surface";

export const metadata: Metadata = {
  title: "Explore",
};

/**
 * Explore (W904): the real catalog — every control-plane session as a card
 * with its real status, renderer availability and playback-rights state.
 */
export default function ExplorePage() {
  return (
    <>
      <PageHeader
        kicker="Discover"
        title="Explore"
        description="Browse the Sporta catalog of events and realities — real control-plane sessions with honest status, renderer and rights state on every card."
      />
      <ExploreSurface />
    </>
  );
}
