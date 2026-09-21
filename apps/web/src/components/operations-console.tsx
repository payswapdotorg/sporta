"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
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
 * J011: one console job row — the API's own shape plus the session-label
 * join the operations service serves (additive at the route; typed here
 * so the shared api-types mirror stays untouched).
 */
type ConsoleJob = OperationsJobsLike["jobs"][number] & {
  sessionLabel?: string | null;
};

/**
 * J011: the contextual navigation targets for one job row — PURE
 * derivations over the job's real data (no fabricated targets, no
 * guessing URLs). Exported for the route-level battery.
 */
export function operationsJobContextLinks(job: {
  sessionId: string;
}): {
  watch: string;
  create: string;
  providers: string;
  computeCenter: string;
} {
  return {
    // The existing session-addressable watch route (the same target the
    // session cards use — the affected session's Watch page).
    watch: `${ROUTES.watch}?session=${encodeURIComponent(job.sessionId)}`,
    // The Create studio — where a re-submission is launched.
    create: ROUTES.create,
    // The console's own Providers & quotas panel (the relevant provider
    // state — in-page, one anchor away).
    providers: "#ops-providers-title",
    // The compute connection center (the provider connection state).
    computeCenter: ROUTES.computeCenter,
  };
}

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
          real cancel. J011: every row links DIRECTLY to its context — the affected session&apos;s
          Watch page, the full job details, the Create studio, and the provider state — no guessing
          URLs.
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
          Usage counters only where a provider seam exposes them, and the W919 free-tier ledger
          evaluated against the MEASURED usage (approaching / reached / exceeded states with the
          checked-date source); seams without a counter stay honestly unmeasured — never estimated.
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
      {health.spendAlarms.length > 0 ? (
        <table className="tactics-table">
          <thead>
            <tr>
              <th>Spend alarm (W919)</th>
              <th>Usage</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {health.spendAlarms.map((alarm) => (
              <tr key={alarm.limitId}>
                <td>
                  {alarm.provider} · {alarm.limitId}
                  {alarm.transitioned
                    ? ` — changed from ${alarm.previousState ?? "(first observation)"}`
                    : ""}
                </td>
                <td>
                  {alarm.used === null
                    ? "unmeasured"
                    : `${alarm.used} / ${alarm.limit} ${alarm.unit}`}
                </td>
                <td>{alarm.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
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
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
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
            <th>Context (J011)</th>
            <th>Remediation</th>
          </tr>
        </thead>
        <tbody>
          {jobs.jobs.map((jobRow) => {
            const job = jobRow as ConsoleJob;
            const links = operationsJobContextLinks(job);
            const expanded = expandedJob === job.jobId;
            return (
              <Fragment key={job.jobId}>
                <tr>
                  <td>
                    {job.jobId}
                    <br />
                    <span className="section-lede">
                      session{" "}
                      <Link href={links.watch}>
                        {job.sessionLabel ?? job.sessionId}
                      </Link>
                    </span>
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
                    {/* J011: the DIRECT contextual links — the affected
                        session's Watch page, the full job details (the
                        expansion below), the Create studio, and the relevant
                        provider state. */}
                    <Link href={links.watch}>Watch session</Link>
                    <br />
                    <button
                      type="button"
                      className="button-ghost"
                      aria-expanded={expanded}
                      onClick={() => setExpandedJob(expanded ? null : job.jobId)}
                    >
                      {expanded ? "Hide job details" : "Job details"}
                    </button>{" "}
                    <Link href={links.create}>Create</Link>
                    <br />
                    <Link href={links.providers}>Provider state</Link> ·{" "}
                    <Link href={links.computeCenter}>Compute center</Link>
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
                {expanded ? (
                  <tr data-surface="ops-job-details">
                    <td colSpan={6}>
                      {/* J011: the job's FULL honest record — the detail the
                          operator needs before remediating, served by the
                          console itself (no URL guessing). */}
                      <dl className="field-note">
                        <dt>session</dt>
                        <dd>
                          {job.sessionLabel ?? "(no recorded label)"} —{" "}
                          <code>{job.sessionId}</code>
                        </dd>
                        <dt>dispatched</dt>
                        <dd>
                          {new Date(job.dispatchedAtMs).toISOString()} by{" "}
                          {job.dispatchedByUserId ?? "unknown"}
                        </dd>
                        <dt>renderer</dt>
                        <dd>{job.rendererId ?? "unknown"}</dd>
                        <dt>render id</dt>
                        <dd>{job.renderId ?? "none yet"}</dd>
                        <dt>admission</dt>
                        <dd>
                          {job.admission.released
                            ? `released (was ${job.admission.admissionId ?? "unknown"})`
                            : `held (${job.admission.admissionId ?? "unknown"})`}
                        </dd>
                        <dt>state</dt>
                        <dd>{job.state}</dd>
                        <dt>completion</dt>
                        <dd>
                          {job.completion === null
                            ? "none yet (in flight)"
                            : `${job.completion.status} · ${job.completion.outputs} output(s)`}
                        </dd>
                        <dt>metered usage</dt>
                        <dd>
                          {job.completion?.usage.length
                            ? job.completion.usage
                                .map((unit) => `${unit.unitId}=${unit.quantity}`)
                                .join(", ")
                            : "unmeasured (the adapter exposes no usage for this job)"}
                        </dd>
                      </dl>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
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
          {provider.limitStates.length > 0 ? (
            <table className="tactics-table">
              <thead>
                <tr>
                  <th>Free-tier limit (W919 ledger)</th>
                  <th>Usage vs threshold</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {provider.limitStates.map((limit) => (
                  <tr key={limit.limitId}>
                    <td>
                      {limit.name} ·{" "}
                      <span className="section-lede">
                        {limit.limitId}
                        {limit.admissionEnforced ? " (admission-enforced)" : " (alarm-only)"}
                      </span>
                    </td>
                    <td>
                      {limit.used === null
                        ? `unmeasured — threshold ${limit.limit} ${limit.unit}`
                        : `${limit.used} / ${limit.limit} ${limit.unit}`}
                    </td>
                    <td>{limit.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <p className="section-lede">
            {provider.note}
            {provider.limits.length > 0
              ? ` · bounds: ${provider.limits.map((l) => `${l.name} = ${l.value}`).join("; ")}`
              : ""}
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
                {record.sessionId !== null ? (
                  <>
                    {" "}
                    (session{" "}
                    <Link
                      href={`${ROUTES.watch}?session=${encodeURIComponent(record.sessionId)}`}
                    >
                      {record.sessionId}
                    </Link>
                    )
                  </>
                ) : ""}
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
