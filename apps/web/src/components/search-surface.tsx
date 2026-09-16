"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, fetchSearch } from "@/lib/client-api";
import type { FetchState } from "@/lib/client-api";
import type { SearchResponseLike } from "@/lib/api-types";
import { deriveReauthState, deriveSearchState } from "@/lib/surface-state";
import { LoadingPanel, StateChip, StatePanel } from "@/components/state-panels";
import { SessionCard } from "@/components/session-card";
import { ROUTES } from "@/lib/navigation";
import { fetchCapability } from "@/lib/client-api";
import type { CapabilityLike } from "@/lib/api-types";

/**
 * THE SEARCH SURFACE (W908) — the W916 catalog search, wired.
 *
 * Every state is the real API's own answer:
 * - no query yet → the honest idle prompt (no fake state, nothing executed);
 * - in flight → `loading`;
 * - the real answer → `ready` — including the ZERO-match answer ("the search
 *   ran and nothing matched"), which is a result, never a failure;
 * - a degraded listing → `degraded` with the matches still real;
 * - a 400 (unknown closed-vocabulary filter) → the server's own validation
 *   words surfaced as `failed` (the search was not run — nothing pretended);
 * - a mid-session 401 → `denied` with the honest re-auth action.
 */
export function SearchSurface({ query }: { query: string | null }) {
  const [capability, setCapability] = useState<FetchState<CapabilityLike>>({ phase: "loading" });
  const [result, setResult] = useState<FetchState<SearchResponseLike>>({ phase: "loading" });

  useEffect(() => {
    void fetchCapability().then(
      (data) => setCapability({ phase: "ready", data }),
      (error) => setCapability({ phase: "failed", error: String(error) }),
    );
  }, []);

  useEffect(() => {
    if (query === null || query.length === 0) return;
    let cancelled = false;
    setResult({ phase: "loading" });
    void fetchSearch({ q: query }).then(
      (data) => {
        if (!cancelled) setResult({ phase: "ready", data });
      },
      (error) => {
        if (cancelled) return;
        setResult({
          phase: "failed",
          error: error instanceof ApiError ? error.message : String(error),
          status: error instanceof ApiError ? error.status : undefined,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (query === null || query.length === 0) {
    return (
      <section className="studio-section" data-surface="search-idle">
        <h2 className="section-title">Run a real search</h2>
        <p className="field-note">
          Search runs live over the sessions you are authorized to see — matches, their rendered
          realities and their story keys. Nothing is suggested or auto-completed: there is no
          recommendation plane, so no trending or popular list is shown either.
        </p>
      </section>
    );
  }

  if (result.phase === "loading" || capability.phase === "loading") {
    return <LoadingPanel label={`Searching for “${query}”`} />;
  }

  if (capability.phase === "failed") {
    return (
      <StatePanel
        state="failed"
        title="The capability state could not be read"
        reason="The search cannot be presented without the real renderer-availability state — a real failure, not simulated."
      />
    );
  }

  if (result.phase === "failed") {
    if (result.status === 401) {
      const verdict = deriveReauthState(result.error);
      return (
        <div className="surface-stack">
          <StatePanel state={verdict.state} title="Your session ended" reason={verdict.reason} />
          <p className="library-signin-hint">
            <Link className="button-primary" href={ROUTES.signin}>
              Sign in again
            </Link>
          </p>
        </div>
      );
    }
    return (
      <StatePanel
        state="failed"
        title="The search was not run"
        reason={`${result.error} — this is the server's own answer; nothing was searched or simulated instead.`}
      />
    );
  }

  const verdict = deriveSearchState(result.data);

  return (
    <div className="surface-stack" data-surface="search-results">
      <section className="studio-section" data-surface="search-verdict">
        <div className="session-card-head">
          <h2 className="section-title">
            {result.data.matches.length === 0
              ? "No matches"
              : `${result.data.matches.length} match(es)`}
          </h2>
          <StateChip state={verdict.state}>{verdict.state}</StateChip>
        </div>
        <p className="field-note">{verdict.reason}</p>
        <p className="field-note">
          Searched for <strong>&ldquo;{query}&rdquo;</strong> ·{" "}
          {result.data.viewer.state === "authenticated"
            ? `signed in (grants: ${result.data.viewer.grants.join(", ") || "none"})`
            : "anonymous — only publicly discoverable sessions were searched"}
          .
        </p>
      </section>

      {result.data.matches.length === 0 ? (
        <section className="studio-section" data-surface="search-empty">
          <p className="field-note">
            No session you are authorized to see matches this query. The search compared it against
            the real session labels, story keys and rendered-reality identifiers — nothing was
            matched approximately or invented to fill the page.
          </p>
        </section>
      ) : (
        <div className="card-grid">
          {result.data.matches.map((match) => (
            <SessionCard key={match.sessionId} card={match} capability={capability.data} />
          ))}
        </div>
      )}
    </div>
  );
}
