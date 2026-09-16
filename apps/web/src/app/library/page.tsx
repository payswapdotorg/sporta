import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { LibrarySurface } from "@/components/library-surface";

export const metadata: Metadata = {
  title: "Library",
};

/**
 * Library (W904): personal and signed-in. The capability response gates the
 * state; the signed-in account's OWN sessions (identity-gate ownership)
 * render as cards.
 */
export default function LibraryPage() {
  return (
    <>
      <PageHeader
        kicker="You"
        title="Library"
        description="Your sessions — the media you created through the control plane, with their real render and output state."
      />
      <LibrarySurface />
    </>
  );
}
