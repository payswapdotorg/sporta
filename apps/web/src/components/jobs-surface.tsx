"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/components/account-provider";
import { ApiError, fetchJobsOverview } from "@/lib/client-api";
import type { FetchState } from "@/lib/client-api";
import type { JobsOverviewLike } from "@/lib/api-types";
import { LoadingPanel, StatePanel } from "@/components/state-panels";
import { deriveReauthState } from "@/lib/surface-state";
import { ROUTES } from "@/lib/navigation";

/**
 * THE JOBS WORKSPACE (W907) — the Creator's job monitor (and the Operator's
 * platform-wide one): the account's sessions with their dispatched jobs'
 * REAL compute state. Every session was re-read through the studio's
 * owner/operator rule server-side; the active role is never consulted.
 *
 * The denied states are the real 403/401 paths: a viewer without a creator
 * or operator grant receives the server's own explanation.
 */
export function JobsSurface() {
  const { phase: accountPhase, account } = useAccount();
  const [state, setState] = useState<FetchState<JobsOverviewLike>>({ phase: "loading" });

  useEffect(() => {
    if (accountPhase !== "ready") return;
    if (account === null) {
      setState({ phase: "loading" });
      return;
    }
    setState({ phase: "loading" });
    void fetchJobsOverview().then(
      (data) => setState({ phase: "ready", data }),
      (error) =>
        setState({
          phase: "failed",
          error: error instanceof ApiError ? error.message : String(error),
          status: error instanceof ApiError ? error.status : undefined,
        }),
    );
  }, [accountPhase, account]);

  if (accountPhase === "loading") {
    return <LoadingPanel label="Checking session" />;
  }
  if (account === null) {
    return (
      <StatePanel
        state="denied"
        title="Sign in to monitor jobs"
        reason="Jobs lists the render jobs of a signed-in account's sessions (an operator sees every session's jobs)."
      />
    );
  }
  if (state.phase === "loading") {
    return <LoadingPanel label="Reading the job state" />;
  }
  if (state.phase === "failed") {
    // A 401 after the session was established = the session expired or was
    // revoked mid-session (W908): the honest state is denied + re-auth —
    // never a generic failure page and never a silent retry loop.
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
          title="A creator or operator grant is required"
          reason={`${state.error} Jobs monitoring belongs to the Creator and Operator workspaces; switching the active role never grants one.`}
        />
      );
    }
    return (
      <StatePanel state="failed" title="The job state could not be read" reason={state.error} />
    );
  }

  const { scope, sessions } = state.data;
  const withJobs = sessions.filter((entry) => entry.jobs.length > 0);

  return (
    <div className="surface-stack">
      <section className="studio-section" data-surface="jobs-summary">
        <h2 className="section-title">
          {scope === "operator" ? "All sessions' jobs (operator)" : "Your sessions' jobs"}
        </h2>
        <p className="field-note">
          {withJobs.length} session{withJobs.length === 1 ? "" : "s"} with dispatched jobs · every
          row is the compute plane&apos;s real state, re-read through the owner/operator rule.
        </p>
      </section>

      {withJobs.length === 0 ? (
        <StatePanel
          state="unavailable"
          title="No render jobs yet"
          reason="Dispatch a render from the Create Studio and its job will appear here with real progress and completion states."
        />
      ) : (
        withJobs.map((entry) => (
          <section key={entry.sessionId} className="studio-section" data-surface="jobs-session">
            <h2 className="section-title">{entry.label}</h2>
            <p className="field-note">
              session <code>{entry.sessionId}</code> · status {entry.status} ·{" "}
              <Link href={`${ROUTES.create}`}>Open in Create Studio →</Link>
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">State</th>
                  <th scope="col">Progress</th>
                  <th scope="col">Ingest</th>
                  <th scope="col">Completion</th>
                </tr>
              </thead>
              <tbody>
                {entry.jobs.map((job) => (
                  <tr key={job.jobId}>
                    <td>
                      <code>{job.jobId}</code>
                    </td>
                    <td>{job.state}</td>
                    <td>
                      {job.progressFraction === undefined
                        ? "—"
                        : `${Math.round(job.progressFraction * 100)}%`}
                    </td>
                    <td>{job.ingest.status}</td>
                    <td>
                      {job.completion === undefined
                        ? "—"
                        : `${job.completion.status}${
                            job.completion.failureMessage !== undefined
                              ? ` (${job.completion.failureMessage})`
                              : ""
                          }`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}
