import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { ClipsSurface } from "@/components/clips-surface";

export const metadata: Metadata = {
  title: "Clips",
};

/**
 * Clips (J010) — the Analyst workspace's REAL clips surface, live since the
 * wave-4 UI lane: media-time markers (moments and clip intervals) saved
 * only where the session has a REAL media timeline, listed as time ranges +
 * backing references, and revisitable. NO clip bytes are ever rendered or
 * stored here (the domain's NO-BYTES invariant) — the surface records where
 * a later rendering lane would cut, against the real timeline.
 * `?session=<id>` pre-selects the session.
 */
export default async function ClipsPage({
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
        title="Clips"
        description="Saved analysis clips — media-time markers on the session's real timeline. Time ranges and backing references only: clip bytes are never fabricated."
      />
      <ClipsSurface sessionId={sessionId} />
    </>
  );
}
