"use client";

import { useEffect, useState } from "react";
import { useAccount } from "@/components/account-provider";
import { ApiError, fetchOperations } from "@/lib/client-api";
import type { FetchState } from "@/lib/client-api";
import type { OperationsLike } from "@/lib/api-types";
import { LoadingPanel, StatePanel } from "@/components/state-panels";

/**
 * OPERATIONS (W907) — the Operator workspace's real-data console:
 *
 * - Health + Providers: the SAME honest platform snapshot
 *   `/api/platform/health` serves (one shared server implementation);
 * - Compute: the composed compute plane (provider selection + real adapter
 *   id), or honest null when the async render surface is disabled;
 * - Queues: honestly unavailable — the control plane exposes no queue-depth
 *   surface yet (no numbers are invented);
 * - Live transport: the real env-gated SSE transport state;
 * - Failed jobs: the render jobs that failed for real.
 *
 * The operator gate is the REAL identity policy (`provider-health.read`) —
 * everyone else receives the policy's own 403, surfaced here as the denied
 * state with its explanation.
 */
export function OperationsSurface() {
  const { phase: accountPhase, account } = useAccount();
  const [state, setState] = useState<FetchState<OperationsLike>>({ phase: "loading" });

  useEffect(() => {
    if (accountPhase !== "ready") return;
    if (account === null) {
      setState({ phase: "loading" });
      return;
    }
    setState({ phase: "loading" });
    void fetchOperations().then(
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
        title="Sign in to operate"
        reason="Operations reports the platform's real health, providers, compute and failed jobs — an operator-only surface."
      />
    );
  }
  if (state.phase === "loading") {
    return <LoadingPanel label="Reading the platform state" />;
  }
  if (state.phase === "failed") {
    if (state.status === 403) {
      return (
        <StatePanel
          state="denied"
          title="The operator grant is required"
          reason={`${state.error} Operators are minted through the account store — never self-registration — and switching the active role never grants one.`}
        />
      );
    }
    return (
      <StatePanel
        state="failed"
        title="The platform state could not be read"
        reason={state.error}
      />
    );
  }

  const data = state.data;
  const providerRows = Object.entries(data.health.providers);

  return (
    <div className="surface-stack">
      <section
        className="studio-section"
        id="health"
        data-surface="operations-health"
      >
        <h2 className="section-title">Health</h2>
        <p className="field-note">
          The same honest snapshot <code>/api/platform/health</code> serves — one shared
          implementation, so the two can never drift.
        </p>
        <table className="data-table">
          <tbody>
            <tr>
              <th scope="row">Environment</th>
              <td>{data.health.env}</td>
            </tr>
            <tr>
              <th scope="row">Deployment marker</th>
              <td>{data.health.deployMarker ?? "not set"}</td>
            </tr>
            <tr>
              <th scope="row">Usage guardrails</th>
              <td>{data.health.usageGuardrails.note}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section
        className="studio-section"
        id="providers"
        data-surface="operations-providers"
      >
        <h2 className="section-title">Providers</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Seam</th>
              <th scope="col">Bound provider</th>
              <th scope="col">Reachability</th>
            </tr>
          </thead>
          <tbody>
            {providerRows.map(([seam, provider]) => (
              <tr key={seam}>
                <td>{seam}</td>
                <td>
                  {provider.provider} {provider.configured ? "" : "(unconfigured)"}
                </td>
                <td>
                  {provider.check.state}
                  {provider.check.detail !== undefined ? ` · ${provider.check.detail}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="studio-section" data-surface="operations-compute">
        <h2 className="section-title">Compute &amp; queues</h2>
        {data.compute === null ? (
          <StatePanel
            state="unavailable"
            title="Async render surface disabled"
            reason="The compute plane is disabled (COMPUTE_PROVIDER=none) — the control plane's async dispatch answers its own typed 503."
          />
        ) : (
          <table className="data-table">
            <tbody>
              <tr>
                <th scope="row">Provider selection</th>
                <td>{data.compute.provider}</td>
              </tr>
              <tr>
                <th scope="row">Adapter</th>
                <td>
                  <code>{data.compute.adapterId}</code>
                </td>
              </tr>
            </tbody>
          </table>
        )}
        <p className="field-note">
          Queues: {data.queues.state} — {data.queues.note}
        </p>
      </section>

      <section className="studio-section" data-surface="operations-live">
        <h2 className="section-title">Live transport</h2>
        <table className="data-table">
          <tbody>
            <tr>
              <th scope="row">State</th>
              <td>{data.live.state}</td>
            </tr>
            <tr>
              <th scope="row">Serving sources</th>
              <td>{data.live.servingSources}</td>
            </tr>
            <tr>
              <th scope="row">Detail</th>
              <td>{data.live.detail}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="studio-section" data-surface="operations-failed-jobs">
        <h2 className="section-title">Failed jobs</h2>
        {data.failedJobs.length === 0 ? (
          <StatePanel
            state="unavailable"
            title="No failed jobs"
            reason="No render job is in a failed or dead-lettered state right now — the real answer, not a placeholder."
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Session</th>
                <th scope="col">Job</th>
                <th scope="col">State</th>
                <th scope="col">Failure</th>
              </tr>
            </thead>
            <tbody>
              {data.failedJobs.map((job) => (
                <tr key={job.jobId}>
                  <td>
                    <code>{job.sessionId}</code>
                  </td>
                  <td>
                    <code>{job.jobId}</code>
                  </td>
                  <td>{job.state}</td>
                  <td>{job.failureMessage ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
