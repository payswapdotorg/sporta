import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { NotesSurface } from "@/components/notes-surface";

export const metadata: Metadata = {
  title: "Notes",
};

/**
 * Notes (J010) — the Analyst workspace's REAL notes surface, live since the
 * wave-4 UI lane: notes attached to saved media-time markers (which ride
 * real session timelines), listed and revisitable. Each note is a
 * first-class domain document — the verified author, the timestamp, the
 * text. `?session=<id>` pre-selects the session.
 */
export default async function NotesPage({
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
        title="Notes"
        description="Analysis notes attached to your saved markers — first-class, persisted, and revisitable."
      />
      <NotesSurface sessionId={sessionId} />
    </>
  );
}
