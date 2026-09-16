"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  CapabilityLike,
  OperationsAuditLike,
  OperationsHealthLike,
  OperationsJobsLike,
  OperationsProvidersLike,
  OperationsQueuesLike,
} from "@/lib/api-types";
import type { FetchState } from "@/lib/client-api";
import {
  ApiError,
  cancelOperationsJob,
  fetchCapability,
  fetchOperationsAudit,
  fetchOperationsHealth,
  fetchOperationsJobs,
  fetchOperationsProviders,
  fetchOperationsQueues,
  retryOperationsJob,
} from "@/lib/client-api";
import { LoadingPanel, StatePanel } from "@/components/state-panels";
import { deriveReauthState } from "@/lib/surface-state";
import { ROUTES } from "@/lib/navigation";

/**
 * The OPERATIONS CONSOLE (W918) — the operator workspace's surface: the
 * health board, the bounded queue panel, the provider panel, the compute
 * jobs table (FAILED jobs with their never-silent reasons + retry) and the
 * remediation audit trail. Real data only: every panel reads its live API,
 * and an honest unavailable/unknown state renders as exactly that.
 *
 * ACCESS: the console APIs are operator grant-gated server-side (the real
 * 401/403 paths); this surface renders those answers honestly rather than
 * hiding them — a signed-in non-operator sees the typed permission-denied
 * panel, an anonymous visitor the sign-in prompt.
 */
export function OperationsConsole() {
  const [capability, setCapability] = useState<FetchState<CapabilityLike>>({ phase: "loading" });
  const [health, setHealth] = useState<FetchState<OperationsHealthLike>>({ phase: "loading" });
  const [queues, setQueues] = useState<FetchState<OperationsQueuesLike>>({ phase: "loading" });
  const [providers, setProviders] = useState<FetchState<OperationsProvidersLike>>({
    phase: "loading",
  });
  const [jobs, setJobs] = useState<FetchState<OperationsJobsLike>>({ phase: "loading" });
  const [audit, setAudit] = useState<FetchState<OperationsAuditLike>>({ phase: "loading" });
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);

  const refresh = useCallback(() => {
    // Every failure records its HTTP status so a mid-session 401 (W908) can
    // render the honest re-auth state instead of a generic failure.
    const failOf =
      (set: (state: { phase: "failed"; error: string; status?: number }) => void) =>
      (error: unknown) =>
        set({
          phase: "failed",
          error: String(error),
          status: error instanceof ApiError ? error.status : undefined,
        });
    void fetchCapability().then(
      (data) => setCapability({ phase: "ready", data }),
      failOf(setCapability),
    );
    void fetchOperationsHealth().then(
      (data) => setHealth({ phase: "ready", data }),
      failOf(setHealth),
    );
    void fetchOperationsQueues().then(
      (data) => setQueues({ phase: "ready", data }),
      failOf(setQueues),
    );
    void fetchOperationsProviders().then(
      (data) => setProviders({ phase: "ready", data }),
      failOf(setProviders),
    );
    void fetchOperationsJobs().then((data) => setJobs({ phase: "ready", data }), failOf(setJobs));
    void fetchOperationsAudit().then(
      (data) => setAudit({ phase: "ready", data }),
      failOf(setAudit),
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (capability.phase === "loading") {
    return <LoadingPanel label="Operations console" />;
  }
  if (capability.phase === "failed") {
    return (
      <StatePanel
        state="failed"
        title="The operations console could not load"
        reason="The capability request failed — a real failure, not simulated."
      />
    );
  }

  if (capability.data.auth.state === "anonymous") {
    return (
      <div className="surface-stack">
        <StatePanel
          state="unavailable"
          title="Operations requires a signed-in operator"
          reason="The console surfaces are operator grant-gated server-side; anonymous visitors get the real 401."
        />
        <p className="library-signin-hint">
          <Link className="button-primary" href={ROUTES.signin}>
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  const notOperator =
    capability.data.auth.state === "authenticated" &&
    !capability.data.account.roles.includes("operator");

  return (
    <div className="surface-stack">
      {notOperator && (
        <StatePanel
          state="unavailable"
          title="Operator grant required"
          reason="Your account does not hold the operator grant — every console API answers the real 403 (permission-denied). An operator-assigned grant is required (self-registration cannot mint it)."
        />
      )}
      {actionMessage !== null && (
        <p className="status-chip" role="status">
          {actionMessage}
        </p>
      )}

      <section className="section-head" aria-labelledby="ops-health-title">
        <h2 className="section-title" id="ops-health-title">
          Platform health
        </h2>
        <p className="section-lede">
          The honest platform snapshot: live provider checks, the compute provider selection, the
          live transport state and the bounded render queue depth. Unconfigured is reported as
          unconfigured — never as healthy.
        </p>
        <HealthBoard state={health} />
      </section>

      <section className="section-head" aria-labelledby="ops-queue-title">
        <h2 className="section-title" id="ops-queue-title">
          Render queue
        </h2>
        <p className="section-lede">
          The W913 bounded queue: depth against the hard bound, the admitted jobs with their ages,
          and the admission refusals counted at the dispatch seam (fail-closed — a full queue
          refuses before the provider is asked).
        </p>
        <QueuePanel state={queues} />
      </section>

      <section className="section-head" aria-labelledby="ops-jobs-title">
        <h2 className="section-title" id="ops-jobs-title">
          Compute jobs
        </h2>
        <p className="section-lede">
          The compute ledger: every dispatched async job with its live state; FAILED jobs carry
          their never-silent failure reasons and the metered usage. Retry re-dispatches through the
          real admission ladder (a NEW job — never a status flip); cancel runs the adapter&apos;s
          real cancel.
        </p>
        <JobsTable
          state={jobs}
          pending={actionPending}
          onRetry={async (jobId) => {
            setActionPending(jobId);
            try {
              const result = await retryOperationsJob(jobId);
              setActionMessage(
                `Retry: job ${jobId} re-dispatched as NEW job ${result.newJobId} (disposition ${result.disposition}).`,
              );
            } catch (error) {
              setActionMessage(describeActionError(error, `retry of ${jobId}`));
            } finally {
              setActionPending(null);
              refresh();
            }
          }}
          onCancel={async (jobId) => {
            setActionPending(jobId);
            try {
              const result = await cancelOperationsJob(jobId);
              setActionMessage(
                result.cancelled
                  ? `Cancel: job ${jobId} cancelled; its queue admission slot was released.`
                  : `Cancel: job ${jobId} is already terminal (${result.alreadyTerminal}) — counted no-op.`,
              );
            } catch (error) {
              setActionMessage(describeActionError(error, `cancel of ${jobId}`));
            } finally {
              setActionPending(null);
              refresh();
            }
          }}
        />
      </section>

      <section className="section-head" aria-labelledby="ops-providers-title">
        <h2 className="section-title" id="ops-providers-title">
          Providers &amp; quotas
        </h2>
        <p className="section-lede">
          Usage counters only where a provider seam exposes them; the documented free-tier limits
          ride along as the W919 seam and are never presented as measured facts; unknown stays
          unknown.
        </p>
        <ProviderPanel state={providers} />
      </section>

      <section className="section-head" aria-labelledby="ops-audit-title">
        <h2 className="section-title" id="ops-audit-title">
          Remediation audit
        </h2>
        <p className="section-lede">
          Every console remediation — executed or refused — with actor, target and reason (an audit
          trail that only recorded successes would be a lie).
        </p>
        <AuditPanel state={audit} />
      </section>
    </div>
  );
}

/** Renders an action failure honestly (typed classes carry real reasons). */
function describeActionError(error: unknown, what: string): string {
  if (error instanceof ApiError) {
    return `${what} refused: ${error.failureClass} — ${error.message}`;
  }
  return `${what} failed: ${String(error)}`;
}

function HealthBoard({ state }: { state: FetchState<OperationsHealthLike> }) {
  if (state.phase === "loading") return <LoadingPanel label="Platform health" />;
  if (state.phase === "failed") {
    return failedPanel("The health board could not be read", state);
  }
  const health = state.data;
  const rows: [string, OperationsHealthLike["providers"]["identity"]][] = [
    ["Identity (Neon)", health.providers.identity],
    ["Artifacts (R2)", health.providers.artifacts],
    ["Transient state (Upstash)", health.providers.transientState],
  ];
  return (
    <div className="surface-stack">
      <p className="status-chip" data-state={health.overall} role="status">
        overall: {health.overall} · env {health.env}
        {health.deployMarker !== null ? ` · deploy ${health.deployMarker}` : ""}
      </p>
      <table className="tactics-table">
        <thead>
          <tr>
            <th>Seam</th>
            <th>State</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, check]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>
                {check.state}
                {check.configured ? "" : " (unconfigured — the honest in-memory fallback)"}
              </td>
              <td>{check.detail}</td>
            </tr>
          ))}
          <tr>
            <td>Compute</td>
            <td>{health.compute.configured ? health.compute.provider : "none"}</td>
            <td>
              {health.compute.configured
                ? `adapter ${health.compute.adapterId}`
                : "COMPUTE_PROVIDER=none — the async surface is disabled"}
            </td>
          </tr>
          <tr>
            <td>Live transport</td>
            <td>{health.liveTransport.state}</td>
            <td>{health.liveTransport.note}</td>
          </tr>
          <tr>
            <td>Render queue depth</td>
            <td>
              {health.renderQueue.depth === null
                ? "unknown (queue unreadable)"
                : `${health.renderQueue.depth} / ${health.renderQueue.maxDepth}`}
            </td>
            <td>key {health.renderQueue.key}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function QueuePanel({ state }: { state: FetchState<OperationsQueuesLike> }) {
  if (state.phase === "loading") return <LoadingPanel label="Render queue" />;
  if (state.phase === "failed") {
    return failedPanel("The queue panel could not be read", state);
  }
  const queues = state.data;
  return (
    <div className="surface-stack">
      <p className="status-chip" role="status">
        depth{" "}
        {queues.queue.depth === null
          ? "unknown"
          : `${queues.queue.depth} / ${queues.queue.maxDepth}`}{" "}
        · backing {queues.provider} · admission refusals {queues.admissionRefusals.count}
      </p>
      {queues.queue.entries.length === 0 ? (
        <p className="section-lede">
          No admitted jobs are waiting (the queue drains as dispatches settle; depth is read live
          from the real backing).
        </p>
      ) : (
        <table className="tactics-table">
          <thead>
            <tr>
              <th>Admission</th>
              <th>Kind</th>
              <th>User</th>
              <th>Age</th>
            </tr>
          </thead>
          <tbody>
            {queues.queue.entries.map((entry) => (
              <tr key={entry.jobId}>
                <td>{entry.jobId}</td>
                <td>{entry.kind}</td>
                <td>{entry.userId ?? "system"}</td>
                <td>{entry.ageMs} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="section-lede">{queues.admissionRefusals.note}</p>
    </div>
  );
}

function JobsTable({
  state,
  pending,
  onRetry,
  onCancel,
}: {
  state: FetchState<OperationsJobsLike>;
  pending: string | null;
  onRetry: (jobId: string) => Promise<void>;
  onCancel: (jobId: string) => Promise<void>;
}) {
  if (state.phase === "loading") return <LoadingPanel label="Compute jobs" />;
  if (state.phase === "failed") {
    return failedPanel("The jobs table could not be read", state);
  }
  const jobs = state.data;
  if (jobs.jobs.length === 0) {
    return (
      <p className="section-lede">
        No async compute jobs have been dispatched through the studio surface yet (the ledger
        records real dispatches only — nothing is fabricated).
      </p>
    );
  }
  return (
    <div className="surface-stack">
      <p className="status-chip" role="status">
        {jobs.totals.all} jobs · {jobs.totals.succeeded} succeeded · {jobs.totals.failed} failed ·{" "}
        {jobs.totals.inFlight} in flight · {jobs.totals.cancelled} cancelled
      </p>
      <table className="tactics-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>State</th>
            <th>Renderer</th>
            <th>Never-silent reason / accounting</th>
            <th>Remediation</th>
          </tr>
        </thead>
        <tbody>
          {jobs.jobs.map((job) => (
            <tr key={job.jobId}>
              <td>
                {job.jobId}
                <br />
                <span className="section-lede">session {job.sessionId}</span>
              </td>
              <td>{job.state}</td>
              <td>{job.rendererId ?? "unknown"}</td>
              <td>
                {job.unavailableReason !== null ? (
                  <span>unavailable: {job.unavailableReason}</span>
                ) : job.state === "failed" && job.completion?.failure ? (
                  <span>
                    {job.completion.failure.errorClass}: {job.completion.failure.message} (
                    {job.completion.failure.terminal}); usage{" "}
                    {job.completion.usage
                      .map((unit) => `${unit.unitId}=${unit.quantity}`)
                      .join(", ")}
                  </span>
                ) : job.completion ? (
                  <span>
                    {job.completion.outputs} output(s),{" "}
                    {job.completion.accounting?.consumedInputs ?? 0} input(s) consumed
                    {job.completion.accounting !== null &&
                    job.completion.accounting.unconsumedInputs.length > 0
                      ? `, unconsumed: ${job.completion.accounting.unconsumedInputs
                          .map((input) => `${input.inputId} (${input.reason})`)
                          .join("; ")}`
                      : ""}
                  </span>
                ) : (
                  <span>in flight — no completion yet</span>
                )}
              </td>
              <td>
                {job.state === "failed" ? (
                  <button
                    type="button"
                    className="button-ghost"
                    disabled={pending === job.jobId}
                    onClick={() => void onRetry(job.jobId)}
                  >
                    Retry (new job)
                  </button>
                ) : null}{" "}
                {job.state !== "succeeded" &&
                job.state !== "failed" &&
                job.state !== "cancelled" &&
                job.state !== "dead-lettered" ? (
                  <button
                    type="button"
                    className="button-ghost"
                    disabled={pending === job.jobId}
                    onClick={() => void onCancel(job.jobId)}
                  >
                    Cancel
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProviderPanel({ state }: { state: FetchState<OperationsProvidersLike> }) {
  if (state.phase === "loading") return <LoadingPanel label="Providers & quotas" />;
  if (state.phase === "failed") {
    return failedPanel("The provider panel could not be read", state);
  }
  const providers = state.data;
  return (
    <div className="surface-stack">
      {providers.providers.map((provider) => (
        <div key={provider.provider} className="surface-stack">
          <h3 className="section-subtitle">
            {provider.provider} — usage {provider.usage}
          </h3>
          {provider.counters.length > 0 ? (
            <table className="tactics-table">
              <thead>
                <tr>
                  <th>Counter</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {provider.counters.map((counter) => (
                  <tr key={counter.name}>
                    <td>{counter.name}</td>
                    <td>{counter.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="section-lede">No measured counters over this seam.</p>
          )}
          <p className="section-lede">
            {provider.note} · limits:{" "}
            {provider.limits.map((l) => `${l.name} = ${l.value}`).join("; ")}
          </p>
        </div>
      ))}
      <p className="section-lede">{providers.notes.join(" · ")}</p>
    </div>
  );
}

function AuditPanel({ state }: { state: FetchState<OperationsAuditLike> }) {
  if (state.phase === "loading") return <LoadingPanel label="Remediation audit" />;
  if (state.phase === "failed") {
    return failedPanel("The audit trail could not be read", state);
  }
  const audit = state.data;
  if (audit.records.length === 0) {
    return <p className="section-lede">No remediation actions have been taken yet. {audit.note}</p>;
  }
  return (
    <div className="surface-stack">
      <table className="tactics-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {audit.records.map((record, index) => (
            <tr key={`${record.atMs}-${index}`}>
              <td>{new Date(record.atMs).toISOString()}</td>
              <td>{record.actorUsername}</td>
              <td>
                {record.action} → {record.targetJobId}
                {record.sessionId !== null ? ` (session ${record.sessionId})` : ""}
              </td>
              <td>
                {record.outcome}: {record.detail}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="section-lede">{audit.note}</p>
    </div>
  );
}

function failedPanel(title: string, state: { phase: "failed"; error: string; status?: number }) {
  // A 401 after the session was established = the session expired or was
  // revoked mid-session (W908): the honest state is denied + re-auth with the
  // sign-in action — never a generic failure page, never a retry loop.
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
  // The error string carries the typed failure (an operator-gate refusal
  // includes the real permission-denied class from the API body).
  return <StatePanel state="failed" title={title} reason={state.error} />;
}
