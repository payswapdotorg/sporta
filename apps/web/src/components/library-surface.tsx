"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CapabilityLike, SessionCardLike } from "@/lib/api-types";
import type { FetchState } from "@/lib/client-api";
import { fetchCapability, fetchLibrary } from "@/lib/client-api";
import { deriveLibraryState } from "@/lib/surface-state";
import { SessionCard } from "@/components/session-card";
import { LoadingPanel, StatePanel } from "@/components/state-panels";
import { ROUTES } from "@/lib/navigation";

/**
 * The Library data surface (W904): personal, signed-in. The capability
 * response decides the state (authentication-required for anonymous
 * visitors); signed-in users see their OWN sessions (identity-gate
 * ownership), with the honest empty state when they have none.
 */
export function LibrarySurface() {
  const [capability, setCapability] = useState<FetchState<CapabilityLike>>({ phase: "loading" });
  const [sessions, setSessions] = useState<FetchState<SessionCardLike[] | null>>({ phase: "loading" });

  useEffect(() => {
    void fetchCapability().then(
      (data) => setCapability({ phase: "ready", data }),
      (error) => setCapability({ phase: "failed", error: String(error) }),
    );
    void fetchLibrary().then(
      (data) => setSessions({ phase: "ready", data }),
      (error) => setSessions({ phase: "failed", error: String(error) }),
    );
  }, []);

  if (capability.phase === "loading" || sessions.phase === "loading") {
    return <LoadingPanel label="Your library" />;
  }
  if (capability.phase === "failed" || sessions.phase === "failed") {
    return (
      <StatePanel
        state="failed"
        title="Your library could not be read"
        reason="The capability or library request failed — a real failure, not simulated."
      />
    );
  }

  const verdict = deriveLibraryState(capability.data, sessions.data);

  if (verdict.state !== "ready") {
    return (
      <div className="surface-stack">
        <StatePanel state={verdict.state} title="Your library" reason={verdict.reason} />
        {(capability.data.auth.state === "anonymous" ||
          capability.data.auth.state === "invalid-session") && (
          <p className="library-signin-hint">
            <Link className="button-primary" href={ROUTES.signin}>
              Sign in
            </Link>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="surface-stack">
      <p className="section-lede">{verdict.reason}</p>
      {sessions.data !== null && sessions.data.length > 0 && (
        <ul className="card-grid">
          {sessions.data.map((card) => (
            <li key={card.sessionId}>
              <SessionCard card={card} capability={capability.data} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
