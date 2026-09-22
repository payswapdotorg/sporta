"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/components/account-provider";
import { ApiError, fetchRightsAuditTrail } from "@/lib/client-api";
import type { FetchState } from "@/lib/client-api";
import type { RightsAuditTrailLike } from "@/lib/api-types";
import { LoadingPanel, StatePanel } from "@/components/state-panels";
import { deriveReauthState } from "@/lib/surface-state";
import { ROUTES } from "@/lib/navigation";

/**
 * THE AUDIT SURFACE (J009) — the workspace-reachable rights audit trail:
 * the append-only record of every rights decision (policy edits and
 * revocations, with the J008 classification vocabulary), read through the
 * role-gated DOMAIN query seam:
 *
 * - a RIGHTS HOLDER sees the trails of the sessions THEY OWN;
 * - an OPERATOR sees every trail (the operational view);
 * - every other role gets the honest 403 (no audit workspace at all — the
 *   J003 honesty pattern, now with a real backing instead of a deferred
 *   panel);
 * - anonymous callers get the honest 401.
 *
 * Publication-visibility changes are W916 publication decisions — they are
 * recorded on the Rights Center's policy console trail, linked from here.
 * The operations (jobs/failures) audit stays on the Operations console,
 * also linked — this surface serves the RIGHTS trail the domain seam owns.
 */
export function AuditSurface({ sessionId }: { sessionId: string | null }) {
  const { phase: accountPhase, account } = useAccount();
  const [state, setState] = useState<FetchState<RightsAuditTrailLike>>({ phase: "loading" });

  useEffect(() => {
    if (accountPhase !== "ready") return;
    if (account === null) {
      setState({ phase: "loading" });
      return;
    }
    setState({ phase: "loading" });
    void fetchRightsAuditTrail(sessionId ?? undefined).then(
      (data) => setState({ phase: "ready", data }),
      (error) =>
        setState({
          phase: "failed",
          error: error instanceof ApiError ? error.message : String(error),
          status: error instanceof ApiError ? error.status : undefined,
        }),
    );
  }, [accountPhase, account, sessionId]);

  if (accountPhase === "loading") {
    return <LoadingPanel label="Checking session" />;
  }
  if (account === null) {
    return (
      <StatePanel
        state="denied"
        title="Sign in to read the audit trail"
        reason="The audit trail lists the rights decisions recorded for a signed-in account's scope — rights holders see their own sessions' trails, operators see every trail."
      />
    );
  }
  if (state.phase === "loading") {
    return <LoadingPanel label="Reading the audit trail" />;
  }
  if (state.phase === "failed") {
    if (state.status === 401) {
      const verdict = deriveReauthState(state.error);
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
    if (state.status === 403) {
      return (
        <StatePanel
          state="denied"
          title="The rights-holder or operator grant is required"
          reason={`${state.error} The rights audit trail is reachable by rights holders (their own sessions) and operators (every session) — grants are assigned by operators, and switching the active role never grants one.`}
        />
      );
    }
    return (
      <StatePanel state="failed" title="The audit trail could not be read" reason={state.error} />
    );
  }

  const { entries, scope, sessionId: focused, note } = state.data;
  return (
    <div className="surface-stack">
      <section className="studio-section" data-surface="audit-summary">
        <h2 className="section-title">
          {focused === null
            ? scope === "operator"
              ? "Every rights decision (operator view)"
              : "Rights decisions on your sessions"
            : `Rights decisions on ${focused}`}
        </h2>
        <p className="field-note">{note}</p>
        <p className="field-note">
          {entries.length} entr{entries.length === 1 ? "y" : "ies"} — read through the role-gated
          audit query (fail-closed, uniform denials, no existence oracle).
        </p>
      </section>

      {entries.length === 0 ? (
        <StatePanel
          state="unavailable"
          title="No rights decisions recorded in your scope yet"
          reason="Edits and revocations made in the Rights Center (or the policy console) are recorded here as they happen — append-only, with who, what, when, and what the change did."
        />
      ) : (
        <section className="studio-section" data-surface="audit-trail">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Session</th>
                <th scope="col">Change</th>
                <th scope="col">Actor</th>
                <th scope="col">Summary</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={`${entry.sessionId}-${entry.atIso}-${entry.editKind}-${entry.summary}`}>
                  <td>{entry.atIso}</td>
                  <td>
                    <code>{entry.sessionId}</code>
                  </td>
                  <td>
                    <span className="audit-kind">
                      {entry.changeKind === "revocation" ? "revoke" : entry.editKind}
                    </span>
                  </td>
                  <td>
                    <code>{entry.actorUserId}</code>
                  </td>
                  <td>{entry.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="studio-section" data-surface="audit-elsewhere">
        <h2 className="section-title">The other audit surfaces</h2>
        <p className="field-note">
          Publication-visibility changes (public / private / unlisted / role-scoped) are recorded on
          the <Link href={ROUTES.rightsPolicies}>Rights Center&apos;s policy console trail →</Link>{" "}
          Every rights decision made from either surface lands in this trail too.
        </p>
        <p className="field-note">
          Platform operations (render jobs, failures, remediations) are recorded on the{" "}
          <Link href={ROUTES.operations}>Operations console →</Link>
        </p>
        <p className="field-note">
          Manage the policies themselves in the <Link href={ROUTES.rights}>Rights Center →</Link>
        </p>
      </section>
    </div>
  );
}
