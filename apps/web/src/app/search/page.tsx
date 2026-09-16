import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SearchSurface } from "@/components/search-surface";

export const metadata: Metadata = {
  title: "Search",
};

/**
 * Search (W903 shell → W908 REAL): the query in the URL is the user's own
 * input; W908 wires it to the real W916 catalog search
 * (GET /api/catalog/search) with the honest state derivations — the zero-match
 * answer is a result, a degraded listing stays degraded, and nothing is
 * suggested or auto-completed (no recommendation plane exists).
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = params.q;
  const value = Array.isArray(raw) ? raw[0] : raw;
  // Truncate by code points (never split a surrogate pair), then trim.
  const query = Array.from(value ?? "")
    .slice(0, 200)
    .join("")
    .trim();
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
        <SearchSurface query={hasQuery ? query : null} />
      </div>
    </>
  );
}
