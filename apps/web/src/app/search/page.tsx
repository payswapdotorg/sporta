import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DeferredSurface } from "@/components/deferred-surface";

export const metadata: Metadata = {
  title: "Search",
};

/**
 * Search (W903). The query in the URL is the user's own input, so echoing
 * it is honest; results themselves wait for the catalog (W904).
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = params.q;
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 200) ?? "";
  const hasQuery = query.length > 0;

  return (
    <>
      <PageHeader
        kicker="Discover"
        title="Search"
        description="Search across matches, realities, creators and events you are authorized to access."
      />
      {hasQuery ? (
        <p className="search-echo">
          You searched for <strong>&ldquo;{query}&rdquo;</strong>.
        </p>
      ) : null}
      <div className="surface-stack">
        <DeferredSurface surface="search" />
      </div>
    </>
  );
}
