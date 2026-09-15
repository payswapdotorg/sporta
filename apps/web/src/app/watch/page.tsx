import type { Metadata } from "next";
import { DeferredSurface } from "@/components/deferred-surface";

export const metadata: Metadata = {
  title: "Watch",
};

/**
 * Watch (W903). The main product surface is reserved but empty: no player
 * is rendered because no real Sporta-rendered output exists to play. The
 * region below is the clearly-marked placeholder for the watch experience
 * that arrives with the data plane (W905).
 */
export default function WatchPage() {
  return (
    <>
      <header className="page-header">
        <p className="page-kicker">Watch</p>
        <h1 className="page-title">The match view</h1>
        <p className="page-description">
          One match, many realities: the player, the event timeline and the Reality Switcher will
          live here — switching the visual reality without ever leaving the match.
        </p>
      </header>
      <div className="watch-stage" role="region" aria-label="Watch surface">
        <DeferredSurface surface="watch" />
      </div>
    </>
  );
}
