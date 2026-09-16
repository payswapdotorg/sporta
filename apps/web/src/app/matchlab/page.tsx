import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { MatchLab } from "@/components/match-lab";

export const metadata: Metadata = {
  title: "Match Lab",
};

/**
 * Match Lab (W907) — the Analyst / Commentator workspace: a read-only
 * analysis surface over the SAME authorized watch document the Watch
 * surface serves (event tail → timeline, transcript → commentary segments,
 * render watermarks → SWM evidence). `?session=<id>` pre-selects the match.
 */
export default async function MatchLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sessionParam = params.session;
  const sessionId =
    typeof sessionParam === "string" && sessionParam.length > 0 ? sessionParam : null;

  return (
    <>
      <PageHeader
        kicker="Analyst"
        title="Match Lab"
        description="Read-only analysis: the real event timeline, commentary segments and SWM evidence of a published session."
      />
      <MatchLab sessionId={sessionId} />
    </>
  );
}
