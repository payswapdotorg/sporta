/**
 * The IN-MEMORY REFERENCE compute adapter (W914 Wave 1) — ***TEST-ONLY, NOT A
 * PRODUCTION PROVIDER*** (the W303 in-process reference posture).
 *
 * This class exists to PROVE the `@sporta/compute-adapter` contract is
 * implementable and to exercise every seam deterministically: dispatch
 * admission (schema, descriptor honesty, rights, capacity), the idempotency
 * posture, the lifecycle state machine (`assertComputeTransition` on every
 * change), progress events, cancellation with superseded reports, provider
 * refusal, deadline expiry, recovery requeues with
 * dead-letter-on-exhaustion, never-silent input accounting, metering
 * totality, and the settle-time accounting assertions. A Wave-2 hosted
 * implementation satisfies `ComputeAdapterPort` the same way against a real
 * provider (CPU worker, GPU/on-demand worker, or a bounded managed actor).
 *
 * ## Determinism constitution (this package has NO clock, NO randomness)
 *
 * The reference adapter reads NO time source and spawns NO timers: every
 * `atMs`/timing field comes from the INJECTED `options.nowMs()` source
 * (default: the constant `0` — tests inject a deterministic counter). There
 * is no wall-clock read and no randomness anywhere in this package
 * (grep-pinned by
 * test/boundary.test.ts). Execution is driven EXCLUSIVELY by the test
 * through `this.provider` (the simulated provider port):
 *
 * ```
 * const adapter = new InMemoryComputeAdapter({ descriptor, nowMs });
 * await adapter.dispatch(job);              // → admitted → dispatched → queued
 * adapter.provider.reportStarted(jobId);    // queued → in-flight ("claimed")
 * adapter.provider.reportProgress(jobId, { fraction: 0.5 });
 * adapter.provider.reportOutcome(jobId, { status: "succeeded", ... });
 * adapter.stats();                          // identities hold
 * ```
 *
 * ## Semantics inherited VERBATIM from W303 (PROTOCOL.md)
 *
 * - idempotency-key check runs FIRST (a known key resolves a counted
 *   duplicate — even when the jobId repeats; a NEW key re-using an admitted
 *   job's id is a typed collision refusal);
 * - malformed dispatches and typed admission/capacity/rights refusals THROW
 *   and carry their OWN counters OUTSIDE the terminal identities (the
 *   deliberate W303 divergence);
 * - failures are VALUES: every ledger job resolves exactly one terminal
 *   completion; a provider report racing a cancellation is counted
 *   `superseded-report`, never silently dropped; a cancel that lands while
 *   the provider handoff is still in flight WINS — the late acceptance or
 *   refusal is not acted on, and the dispatch call still returns the honest
 *   handle for the job that was admitted;
 * - retryable provider failures consume the claim budget (`maxAttempts`,
 *   default 3 — the W303 default): each retry requeues (`in-flight →
 *   queued`, the lease-expiry edge), exhaustion dead-letters with
 *   `retry-exhausted`; non-retryable failures resolve `failed` immediately
 *   and are never blind-retried;
 * - `shutdown()` cancels everything unresolved (0 in-flight at settle) and
 *   REJECTS on any accounting imbalance — never a lying result.
 */
import {
  ComputeAdapterDescriptor,
  ComputeAdapterStats,
  ComputeCancelOutcome,
  ComputeDispatchOutcome,
  ComputeJobCompletion,
  ComputeJobDescription,
  ComputeJobEvent,
  ComputeJobSnapshot,
  ComputeOutputArtifact,
  ComputeTerminalDisposition,
  ComputeUsageRecord,
  emptyComputeStats,
} from "./schemas";
import type {
  ComputeProviderOutcome,
  ComputeProviderPort,
  ComputeProviderSubmission,
  ComputeUsageQuery,
} from "./adapter";
import type { ComputeAdapterPort, ComputeEventSink, ComputeSubscription } from "./adapter";
import { assertComputeAccounting } from "./accounting";
import {
  ComputeAdmissionError,
  ComputeAdapterMisuseError,
  ComputeResourceLimitError,
  ComputeRightsError,
  ComputeValidationError,
  UnknownComputeJobError,
} from "./errors";
import { assertComputeTransition, isTerminalComputeState } from "./states";
import type { ComputeJobState } from "./states";

/** Bounded-resource limits for one reference adapter. */
export interface InMemoryComputeLimits {
  /** Maximum jobs waiting in the queue (integer >= 1). */
  maxQueuedJobs: number;
  /** Maximum admitted jobs over the adapter's lifetime (integer >= 1). */
  maxAdmittedJobs: number;
}

/** Frozen default limits (the W303 magnitudes). */
export const DEFAULT_IN_MEMORY_LIMITS: InMemoryComputeLimits = Object.freeze({
  maxQueuedJobs: 64,
  maxAdmittedJobs: 1_000_000,
});

/** The injected timestamp source (deterministic; default: constant 0). */
export type NowMsSource = () => number;

/** The injected metering function: quantities in the descriptor's units. */
export type MeterUsageFn = (input: {
  job: ComputeJobDescription;
  terminalDisposition: ComputeTerminalDisposition;
  queueWaitMs: number;
  executionMs: number;
  attempts: number;
  claims: number;
}) => Array<{ unitId: string; quantity: number }>;

/** Options for {@link InMemoryComputeAdapter}. */
export interface InMemoryComputeAdapterOptions {
  /** The frozen capability descriptor (validated fail-loud). */
  descriptor: ComputeAdapterDescriptor;
  /**
   * Deterministic timestamp source for every `atMs`/timing field. The
   * reference reads NO time source of its own; tests inject a counter.
   * Default: constant `0`.
   */
  nowMs?: NowMsSource;
  /**
   * The provider's acceptance policy (default: accept everything). Return
   * `{ accepted: false, reason }` to exercise the determinate
   * provider-refusal path; returning a PROMISE parks the dispatch at the
   * handoff (the race tests use this to prove cancel-wins-during-handoff).
   */
  providerSubmit?: (
    job: ComputeJobDescription,
  ) => ComputeProviderSubmission | Promise<ComputeProviderSubmission>;
  /**
   * The metering function (default: every declared cost unit at quantity 0 —
   * the reference has no real usage knowledge; tests inject real
   * quantities). Quantities MUST be in units the descriptor declares.
   */
  meterUsage?: MeterUsageFn;
  /** Default claim budget when the job description omits `maxAttempts` (W303 default 3). */
  defaultMaxAttempts?: number;
  /** Resource bounds (default: {@link DEFAULT_IN_MEMORY_LIMITS}). */
  limits?: Partial<InMemoryComputeLimits>;
}

/** One job's internal record (the never-silent ledger entry). */
interface JobRecord {
  job: ComputeJobDescription;
  state: ComputeJobState;
  events: ComputeJobEvent[];
  claims: number;
  attempts: number;
  firstStartedAtMs: number | undefined;
  roundStartedAtMs: number | undefined;
  submittedAtMs: number;
  executionMs: number;
  consumedInputIds: Set<string>;
  completion: ComputeJobCompletion | undefined;
  subscribers: Set<ComputeEventSink>;
}

/**
 * ***TEST-ONLY IN-MEMORY REFERENCE — NOT A PRODUCTION PROVIDER.***
 *
 * The deterministic proof that the compute-adapter contract is satisfiable:
 * a complete in-process adapter over a simulated provider port. Every
 * vocabulary it emits is the contract's own (which is the W303/W304/W504
 * vocabulary, cited in ./schemas.ts); every state change passes
 * `assertComputeTransition`; every terminal job gets exactly one completion
 * AND exactly one usage record; `stats()` asserts all accounting identities
 * on every call.
 */
export class InMemoryComputeAdapter implements ComputeAdapterPort {
  private readonly descriptor: ComputeAdapterDescriptor;
  private readonly nowMs: NowMsSource;
  private readonly providerSubmit: (
    job: ComputeJobDescription,
  ) => ComputeProviderSubmission | Promise<ComputeProviderSubmission>;
  private readonly meterUsage: MeterUsageFn;
  private readonly defaultMaxAttempts: number;
  private readonly limits: InMemoryComputeLimits;
  private readonly records = new Map<string, JobRecord>();
  private readonly byIdempotencyKey = new Map<string, string>();
  private readonly statsState: ComputeAdapterStats = emptyComputeStats();
  private readonly usageRecords: ComputeUsageRecord[] = [];

  /** The simulated provider port — the TEST DRIVE SURFACE (see class docs). */
  readonly provider: ComputeProviderPort;

  constructor(options: InMemoryComputeAdapterOptions) {
    const descriptorParse = ComputeAdapterDescriptor.safeParse(options.descriptor);
    if (!descriptorParse.success) {
      throw new ComputeAdapterMisuseError(
        "InMemoryComputeAdapter requires a valid ComputeAdapterDescriptor: " +
          descriptorParse.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    this.descriptor = descriptorParse.data;
    this.nowMs = options.nowMs ?? (() => 0);
    this.providerSubmit = options.providerSubmit ?? (() => ({ accepted: true }));
    this.meterUsage =
      options.meterUsage ??
      (() => this.descriptor.costUnits.map((unit) => ({ unitId: unit.unitId, quantity: 0 })));
    this.defaultMaxAttempts = options.defaultMaxAttempts ?? 3;
    this.limits = { ...DEFAULT_IN_MEMORY_LIMITS, ...options.limits };
    // Arrow-captured `this` (no aliasing): the provider port delegates to
    // this adapter's private handlers — the TEST DRIVE SURFACE.
    this.provider = {
      submit: async (job: ComputeJobDescription): Promise<ComputeProviderSubmission> =>
        this.providerSubmit(job),
      reportStarted: (jobId: string): void => {
        this.onProviderStarted(jobId);
      },
      reportProgress: (jobId: string, progress: { fraction: number; stage?: string }): void => {
        this.onProviderProgress(jobId, progress);
      },
      reportOutcome: (jobId: string, outcome: ComputeProviderOutcome): void => {
        this.onProviderOutcome(jobId, outcome);
      },
    };
  }

  // -------------------------------------------------------------------------
  // ComputeAdapterPort
  // -------------------------------------------------------------------------

  describe(): ComputeAdapterDescriptor {
    return this.descriptor;
  }

  async dispatch(job: ComputeJobDescription): Promise<ComputeDispatchOutcome> {
    // 1. Structural validation (fail-loud, own counter, outside the identities).
    const parsed = ComputeJobDescription.safeParse(job);
    if (!parsed.success) {
      this.statsState.malformedDispatches += 1;
      throw new ComputeValidationError("dispatch payload is not a valid ComputeJobDescription", {
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    const description = parsed.data;

    // 2. Idempotency-key check FIRST (the Recovery rule — a known key is a
    //    counted duplicate, never double-claimed, even when jobId repeats).
    const knownJobId = this.byIdempotencyKey.get(description.idempotencyKey);
    if (knownJobId !== undefined) {
      const known = this.records.get(knownJobId);
      if (known === undefined) {
        throw new ComputeAdapterMisuseError(
          `idempotency key '${description.idempotencyKey}' maps to unknown job '${knownJobId}'`,
        );
      }
      this.statsState.jobsDispatched += 1;
      this.statsState.duplicates += 1;
      assertComputeAccounting(this.statsState);
      return {
        disposition: "duplicate",
        jobId: known.job.jobId,
        idempotencyKey: known.job.idempotencyKey,
        jobState: known.state,
      };
    }

    // 3. JobId collision (a NEW key re-using an admitted job's id).
    if (this.records.has(description.jobId)) {
      this.statsState.malformedDispatches += 1;
      throw new ComputeValidationError(
        `jobId '${description.jobId}' is already admitted under a different idempotency key (job-id-collision)`,
        { jobId: description.jobId },
      );
    }

    // 4. Admission — descriptor honesty (unsupported renderer/version/latency
    //    class, deadline out of bounds). Declaring an unsupported renderer is
    //    rejected HERE, before any provider sees work.
    const rendererSupport = this.descriptor.supportedRenderers.find(
      (r) => r.rendererId === description.renderer.rendererId,
    );
    if (rendererSupport === undefined) {
      this.statsState.refusedAdmissions += 1;
      throw new ComputeAdmissionError(
        `adapter '${this.descriptor.adapterId}' does not support renderer '${description.renderer.rendererId}'`,
        { rendererId: description.renderer.rendererId, adapterId: this.descriptor.adapterId },
      );
    }
    if (
      description.renderer.rendererVersion !== undefined &&
      rendererSupport.rendererVersions !== undefined &&
      !rendererSupport.rendererVersions.includes(description.renderer.rendererVersion)
    ) {
      this.statsState.refusedAdmissions += 1;
      throw new ComputeAdmissionError(
        `adapter '${this.descriptor.adapterId}' does not support renderer '${description.renderer.rendererId}' version '${description.renderer.rendererVersion}'`,
        {
          rendererId: description.renderer.rendererId,
          rendererVersion: description.renderer.rendererVersion,
          supported: rendererSupport.rendererVersions,
        },
      );
    }
    if (!this.descriptor.supportedLatencyClasses.includes(description.outputProfile.latencyClass)) {
      this.statsState.refusedAdmissions += 1;
      throw new ComputeAdmissionError(
        `adapter '${this.descriptor.adapterId}' does not serve latency class '${description.outputProfile.latencyClass}'`,
        { latencyClass: description.outputProfile.latencyClass },
      );
    }
    if (description.constraints.deadlineMs > this.descriptor.maxJobDeadlineMs) {
      this.statsState.refusedAdmissions += 1;
      throw new ComputeAdmissionError(
        `job deadline ${description.constraints.deadlineMs}ms exceeds the adapter bound ${this.descriptor.maxJobDeadlineMs}ms`,
        {
          deadlineMs: description.constraints.deadlineMs,
          maxJobDeadlineMs: this.descriptor.maxJobDeadlineMs,
        },
      );
    }
    if (
      this.descriptor.minJobDeadlineMs !== undefined &&
      description.constraints.deadlineMs < this.descriptor.minJobDeadlineMs
    ) {
      this.statsState.refusedAdmissions += 1;
      throw new ComputeAdmissionError(
        `job deadline ${description.constraints.deadlineMs}ms is below the adapter bound ${this.descriptor.minJobDeadlineMs}ms`,
        {
          deadlineMs: description.constraints.deadlineMs,
          minJobDeadlineMs: this.descriptor.minJobDeadlineMs,
        },
      );
    }

    // 5. Rights (fail-closed BEFORE anything is queued — the R2 gate of the
    //    W501 renderer contract).
    if (
      !description.rights.canReferenceSourceFrames &&
      description.inputs.some((input) => input.kind === "source-media")
    ) {
      this.statsState.rightsRefusals += 1;
      throw new ComputeRightsError(
        "job manifests source-media inputs but the rights posture denies canReferenceSourceFrames",
        { jobId: description.jobId, policyRef: description.rights.policyRef },
      );
    }

    // 6. Capacity (typed refusal, never a silent queue-forever).
    const queuedCount = this.countInState("queued");
    if (queuedCount >= this.limits.maxQueuedJobs) {
      this.statsState.resourceRefusals += 1;
      throw new ComputeResourceLimitError(
        `compute queue is full (${queuedCount}/${this.limits.maxQueuedJobs})`,
        { queuedCount, maxQueuedJobs: this.limits.maxQueuedJobs },
      );
    }
    if (this.statsState.admitted >= this.limits.maxAdmittedJobs) {
      this.statsState.resourceRefusals += 1;
      throw new ComputeResourceLimitError(
        `admitted-job budget exhausted (${this.limits.maxAdmittedJobs})`,
        { maxAdmittedJobs: this.limits.maxAdmittedJobs },
      );
    }

    // 7. Admit (ledger-populating) + hand off to the provider.
    const now = this.nowMs();
    const record: JobRecord = {
      job: description,
      state: "admitted",
      events: [],
      claims: 0,
      attempts: 0,
      firstStartedAtMs: undefined,
      roundStartedAtMs: undefined,
      submittedAtMs: now,
      executionMs: 0,
      consumedInputIds: new Set<string>(),
      completion: undefined,
      subscribers: new Set<ComputeEventSink>(),
    };
    this.records.set(description.jobId, record);
    this.byIdempotencyKey.set(description.idempotencyKey, description.jobId);
    this.statsState.jobsDispatched += 1;
    this.statsState.admitted += 1;
    this.statsState.inFlight += 1;
    this.statsState.inputsManifested += description.inputs.length;
    this.statsState.inputsInFlight += description.inputs.length;
    this.appendEvent(record, {
      schemaVersion: "1.0",
      jobId: description.jobId,
      type: "submitted",
      atMs: now,
    });
    assertComputeAccounting(this.statsState);

    // 8. Provider handoff: admitted → dispatched → (queued | failed).
    this.transition(record, "dispatched");
    this.appendEvent(record, {
      schemaVersion: "1.0",
      jobId: description.jobId,
      type: "dispatched",
      atMs: this.nowMs(),
    });
    const submission = await this.providerSubmit(description);
    // A cancel (or any other terminal resolution) may have landed while the
    // provider handoff was in flight — the cancel WINS (the W303
    // supersession posture): no further transition is attempted, the
    // provider's acceptance is simply not acted on, and the dispatch still
    // honestly returns the handle for the job that WAS admitted.
    if (isTerminalComputeState(record.state)) {
      return {
        disposition: "admitted",
        handle: {
          schemaVersion: "1.0",
          jobId: description.jobId,
          idempotencyKey: description.idempotencyKey,
          sessionId: description.sessionId,
          rendererId: description.renderer.rendererId,
          adapterId: this.descriptor.adapterId,
          admittedAtMs: now,
        },
      };
    }
    if (!submission.accepted) {
      // Determinate provider refusal: the job resolves failed (never silent).
      const reason = submission.reason ?? {
        errorClass: "provider-refused",
        message: "provider refused the job",
        terminal: "non-retryable" as const,
      };
      this.transition(record, "failed");
      this.appendEvent(record, {
        schemaVersion: "1.0",
        jobId: description.jobId,
        type: "failed",
        atMs: this.nowMs(),
        details: { errorClass: reason.errorClass, refusedAtHandoff: true },
      });
      this.settleJob(record, {
        status: "failed",
        terminalDisposition: "failed",
        failure: {
          errorClass: reason.errorClass,
          message: reason.message,
          terminal: "non-retryable",
        },
        outputs: [],
        unconsumedReason: "provider-refusal-before-execution",
      });
    } else {
      this.transition(record, "queued");
      assertComputeAccounting(this.statsState);
    }

    return {
      disposition: "admitted",
      handle: {
        schemaVersion: "1.0",
        jobId: description.jobId,
        idempotencyKey: description.idempotencyKey,
        sessionId: description.sessionId,
        rendererId: description.renderer.rendererId,
        adapterId: this.descriptor.adapterId,
        admittedAtMs: now,
      },
    };
  }

  async getJob(jobId: string): Promise<ComputeJobSnapshot | null> {
    const record = this.records.get(jobId);
    if (record === undefined) return null;
    return this.snapshotOf(record);
  }

  async getJobOrFail(jobId: string): Promise<ComputeJobSnapshot> {
    const snapshot = await this.getJob(jobId);
    if (snapshot === null) {
      throw new UnknownComputeJobError(`no compute job '${jobId}' was ever admitted`, { jobId });
    }
    return snapshot;
  }

  subscribe(jobId: string, sink: ComputeEventSink): ComputeSubscription {
    const record = this.records.get(jobId);
    if (record === undefined) {
      throw new UnknownComputeJobError(`cannot subscribe to unknown compute job '${jobId}'`, {
        jobId,
      });
    }
    // Replay the past trail synchronously (no event lost between poll and
    // subscribe), then attach for live events (terminal jobs deliver nothing
    // further — the trail replay IS the full story).
    for (const event of record.events) {
      sink(event);
    }
    let active = !isTerminalComputeState(record.state);
    if (active) {
      record.subscribers.add(sink);
    }
    return {
      unsubscribe: () => {
        if (active) {
          active = false;
          record.subscribers.delete(sink);
        }
      },
    };
  }

  async cancel(jobId: string): Promise<ComputeCancelOutcome> {
    const record = this.records.get(jobId);
    if (record === undefined) {
      this.statsState.unknownCancelTargets += 1;
      throw new UnknownComputeJobError(`cannot cancel unknown compute job '${jobId}'`, { jobId });
    }
    if (isTerminalComputeState(record.state)) {
      // Idempotent no-op: nothing counted (the W303 terminal-cancel posture).
      return {
        cancelled: false,
        jobId,
        terminalDisposition: record.state as ComputeTerminalDisposition,
      };
    }
    this.transition(record, "cancelled");
    this.appendEvent(record, {
      schemaVersion: "1.0",
      jobId,
      type: "cancelled",
      atMs: this.nowMs(),
    });
    this.settleJob(record, {
      status: "cancelled",
      terminalDisposition: "cancelled",
      outputs: [],
      unconsumedReason: "job-cancelled",
    });
    return { cancelled: true, jobId };
  }

  async usage(query: ComputeUsageQuery = {}): Promise<ComputeUsageRecord[]> {
    return this.usageRecords.filter(
      (record) =>
        (query.sessionId === undefined || record.sessionId === query.sessionId) &&
        (query.sinceMs === undefined || record.meteredAtMs >= query.sinceMs),
    );
  }

  stats(): ComputeAdapterStats {
    assertComputeAccounting(this.statsState);
    return { ...this.statsState };
  }

  // -------------------------------------------------------------------------
  // Settle (the W303 shutdown posture: cancel everything unresolved, then
  // the accounting must balance or the promise REJECTS)
  // -------------------------------------------------------------------------

  /** Cancels every unresolved job, then returns the balanced stats snapshot. */
  async shutdown(): Promise<ComputeAdapterStats> {
    for (const record of this.records.values()) {
      if (!isTerminalComputeState(record.state)) {
        await this.cancel(record.job.jobId);
      }
    }
    return this.stats();
  }

  /**
   * TEST DRIVE: simulates the whole-job deadline firing on one live job
   * (queued or in-flight). The hosted adapter's deadline machinery owns this
   * in production; the reference exposes it so the contract's
   * `deadline-timeout` path is deterministically provable.
   */
  simulateDeadlineExpiry(jobId: string): void {
    const record = this.records.get(jobId);
    if (record === undefined) {
      throw new UnknownComputeJobError(`cannot expire unknown compute job '${jobId}'`, { jobId });
    }
    if (isTerminalComputeState(record.state)) {
      throw new ComputeAdapterMisuseError(
        `cannot expire terminal job '${jobId}' (state '${record.state}')`,
      );
    }
    if (record.state === "admitted" || record.state === "dispatched") {
      throw new ComputeAdapterMisuseError(
        `deadline expiry is not modeled in state '${record.state}' (the reference provider handoff is synchronous)`,
      );
    }
    this.transition(record, "failed");
    this.appendEvent(record, {
      schemaVersion: "1.0",
      jobId,
      type: "deadline-timeout",
      atMs: this.nowMs(),
    });
    this.settleJob(record, {
      status: "failed",
      terminalDisposition: "failed",
      failure: {
        errorClass: "deadline-timeout",
        message: "whole-job deadline expired before a terminal report",
        terminal: "timeout",
      },
      outputs: [],
      unconsumedReason: "deadline-expired-before-consumption",
    });
  }

  // -------------------------------------------------------------------------
  // Provider-port callbacks (the drive surface)
  // -------------------------------------------------------------------------

  private onProviderStarted(jobId: string): void {
    const record = this.records.get(jobId);
    if (record === undefined) {
      this.statsState.invalidProviderReports += 1;
      throw new UnknownComputeJobError(`provider reported start of unknown job '${jobId}'`, {
        jobId,
      });
    }
    if (record.state !== "queued") {
      this.statsState.invalidProviderReports += 1;
      throw new ComputeAdapterMisuseError(
        `provider reported start of job '${jobId}' in state '${record.state}' (expected 'queued')`,
      );
    }
    this.transition(record, "in-flight");
    record.claims += 1;
    if (record.firstStartedAtMs === undefined) {
      record.firstStartedAtMs = this.nowMs();
    }
    record.roundStartedAtMs = this.nowMs();
    this.appendEvent(record, {
      schemaVersion: "1.0",
      jobId,
      type: "claimed",
      atMs: this.nowMs(),
      details: { claimOrdinal: record.claims },
    });
  }

  private onProviderProgress(jobId: string, progress: { fraction: number; stage?: string }): void {
    const record = this.records.get(jobId);
    if (record === undefined) {
      this.statsState.invalidProviderReports += 1;
      throw new UnknownComputeJobError(`provider reported progress of unknown job '${jobId}'`, {
        jobId,
      });
    }
    if (record.state !== "in-flight") {
      this.statsState.invalidProviderReports += 1;
      throw new ComputeAdapterMisuseError(
        `provider reported progress of job '${jobId}' in state '${record.state}' (expected 'in-flight')`,
      );
    }
    if (!Number.isFinite(progress.fraction) || progress.fraction <= 0 || progress.fraction > 1) {
      this.statsState.invalidProviderReports += 1;
      throw new ComputeAdapterMisuseError(
        `provider reported invalid progress fraction '${String(progress.fraction)}' for job '${jobId}'`,
      );
    }
    this.appendEvent(record, {
      schemaVersion: "1.0",
      jobId,
      type: "progress",
      atMs: this.nowMs(),
      fraction: progress.fraction,
      ...(progress.stage !== undefined ? { stage: progress.stage } : {}),
    });
  }

  private onProviderOutcome(jobId: string, outcome: ComputeProviderOutcome): void {
    const record = this.records.get(jobId);
    if (record === undefined) {
      this.statsState.invalidProviderReports += 1;
      throw new UnknownComputeJobError(`provider reported outcome of unknown job '${jobId}'`, {
        jobId,
      });
    }
    if (isTerminalComputeState(record.state)) {
      // The W303 superseded-report posture: a report racing a
      // cancellation/deadline LOSES, is counted, never silently dropped.
      this.statsState.supersededReports += 1;
      this.appendEvent(record, {
        schemaVersion: "1.0",
        jobId,
        type: "superseded-report",
        atMs: this.nowMs(),
        details: { reportedStatus: outcome.status, jobState: record.state },
      });
      return;
    }
    if (record.state !== "in-flight") {
      this.statsState.invalidProviderReports += 1;
      throw new ComputeAdapterMisuseError(
        `provider reported outcome of job '${jobId}' in state '${record.state}' (expected 'in-flight')`,
      );
    }
    record.attempts += 1;
    const outcomeAtMs = this.nowMs();
    if (record.roundStartedAtMs !== undefined) {
      record.executionMs += Math.max(0, outcomeAtMs - record.roundStartedAtMs);
    }
    for (const inputId of outcome.consumedInputIds) {
      if (!record.job.inputs.some((input) => input.inputId === inputId)) {
        this.statsState.invalidProviderReports += 1;
        throw new ComputeAdapterMisuseError(
          `provider reported consumption of input '${inputId}' which is not in job '${jobId}'s manifest`,
        );
      }
      record.consumedInputIds.add(inputId);
    }
    if (outcome.status === "succeeded") {
      const outputs: ComputeOutputArtifact[] = [];
      for (const output of outcome.outputs) {
        const parsed = ComputeOutputArtifact.safeParse(output);
        if (!parsed.success) {
          this.statsState.invalidProviderReports += 1;
          throw new ComputeAdapterMisuseError(
            `provider reported a structurally invalid output artifact for job '${jobId}': ` +
              parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          );
        }
        outputs.push(parsed.data);
      }
      this.transition(record, "succeeded");
      this.appendEvent(record, {
        schemaVersion: "1.0",
        jobId,
        type: "succeeded",
        atMs: outcomeAtMs,
      });
      this.settleJob(record, {
        status: "succeeded",
        terminalDisposition: "succeeded",
        outputs,
        unconsumedReason: "not-consumed-by-execution",
      });
      return;
    }
    // Failed outcome: retryable failures consume the claim budget (requeue
    // while budget remains, dead-letter at exhaustion — the W303 posture);
    // non-retryable failures resolve failed immediately.
    const maxAttempts = record.job.constraints.maxAttempts ?? this.defaultMaxAttempts;
    if (outcome.retryable && record.claims < maxAttempts) {
      this.appendEvent(record, {
        schemaVersion: "1.0",
        jobId,
        type: "requeued",
        atMs: outcomeAtMs,
        details: { errorClass: outcome.errorClass, claims: record.claims, maxAttempts },
      });
      this.transition(record, "queued");
      assertComputeAccounting(this.statsState);
      return;
    }
    if (outcome.retryable) {
      this.transition(record, "dead-lettered");
      this.appendEvent(record, {
        schemaVersion: "1.0",
        jobId,
        type: "dead-lettered",
        atMs: outcomeAtMs,
        details: { errorClass: outcome.errorClass, claims: record.claims, maxAttempts },
      });
      this.settleJob(record, {
        status: "failed",
        terminalDisposition: "dead-lettered",
        failure: {
          errorClass: outcome.errorClass,
          message: outcome.message,
          terminal: "retry-exhausted",
        },
        outputs: [],
        unconsumedReason: "recovery-budget-exhausted-before-completion",
      });
      return;
    }
    this.transition(record, "failed");
    this.appendEvent(record, {
      schemaVersion: "1.0",
      jobId,
      type: "failed",
      atMs: outcomeAtMs,
      details: { errorClass: outcome.errorClass },
    });
    this.settleJob(record, {
      status: "failed",
      terminalDisposition: "failed",
      failure: {
        errorClass: outcome.errorClass,
        message: outcome.message,
        terminal: "non-retryable",
      },
      outputs: [],
      unconsumedReason: "execution-failed-before-consumption",
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Applies a state change: asserts the transition is legal, then moves the
   * accounting (terminal transitions close the job's input accounting and
   * land it in exactly one terminal bucket).
   */
  private transition(record: JobRecord, to: ComputeJobState): void {
    assertComputeTransition(record.state, to);
    if (isTerminalComputeState(to)) {
      const unconsumed = record.job.inputs.length - record.consumedInputIds.size;
      this.statsState.inFlight -= 1;
      this.statsState.inputsInFlight -= record.job.inputs.length;
      this.statsState.inputsConsumed += record.consumedInputIds.size;
      this.statsState.inputsUnconsumed += unconsumed;
      const bucket = to as ComputeTerminalDisposition;
      if (bucket === "succeeded") this.statsState.succeeded += 1;
      else if (bucket === "failed") this.statsState.failed += 1;
      else if (bucket === "cancelled") this.statsState.cancelled += 1;
      else this.statsState.deadLettered += 1;
    }
    record.state = to;
  }

  private appendEvent(record: JobRecord, event: ComputeJobEvent): void {
    record.events.push(event);
    for (const sink of record.subscribers) {
      sink(event);
    }
  }

  /** Builds and freezes one job's terminal completion + usage record. */
  private settleJob(
    record: JobRecord,
    outcome: {
      status: "succeeded" | "failed" | "cancelled";
      terminalDisposition: ComputeTerminalDisposition;
      failure?: {
        errorClass: string;
        message: string;
        terminal: "non-retryable" | "retry-exhausted" | "timeout" | "internal";
      };
      outputs: ComputeOutputArtifact[];
      unconsumedReason: string;
    },
  ): void {
    const finishedAtMs = this.nowMs();
    const queueWaitMs =
      record.firstStartedAtMs !== undefined
        ? Math.max(0, record.firstStartedAtMs - record.submittedAtMs)
        : undefined;
    const unconsumed = record.job.inputs
      .filter((input) => !record.consumedInputIds.has(input.inputId))
      .map((input) => ({ inputId: input.inputId, reason: outcome.unconsumedReason }));

    // Metering (validated against the descriptor's declared units).
    const metered = this.meterUsage({
      job: record.job,
      terminalDisposition: outcome.terminalDisposition,
      queueWaitMs: queueWaitMs ?? 0,
      executionMs: record.executionMs,
      attempts: record.attempts,
      claims: record.claims,
    });
    const declaredUnits = new Set(this.descriptor.costUnits.map((unit) => unit.unitId));
    for (const quantity of metered) {
      if (!declaredUnits.has(quantity.unitId)) {
        throw new ComputeAdapterMisuseError(
          `metering function reported unit '${quantity.unitId}' which the descriptor does not declare`,
        );
      }
    }
    const usage: ComputeUsageRecord = {
      schemaVersion: "1.0",
      jobId: record.job.jobId,
      idempotencyKey: record.job.idempotencyKey,
      sessionId: record.job.sessionId,
      adapterId: this.descriptor.adapterId,
      providerId: `${this.descriptor.adapterId}:memory`,
      terminalDisposition: outcome.terminalDisposition,
      timing: { queueWaitMs: queueWaitMs ?? 0, executionMs: record.executionMs },
      attempts: record.attempts,
      claims: record.claims,
      costUnits: metered,
      meteredAtMs: finishedAtMs,
    };
    const usageParse = ComputeUsageRecord.safeParse(usage);
    if (!usageParse.success) {
      throw new ComputeAdapterMisuseError(
        `internal: usage record for job '${record.job.jobId}' violates the contract: ` +
          usageParse.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }

    const completion: ComputeJobCompletion = {
      schemaVersion: "1.0",
      jobId: record.job.jobId,
      idempotencyKey: record.job.idempotencyKey,
      sessionId: record.job.sessionId,
      status: outcome.status,
      terminalDisposition: outcome.terminalDisposition,
      ...(outcome.failure !== undefined ? { failure: outcome.failure } : {}),
      outputs: outcome.outputs,
      attempts: record.attempts,
      claims: record.claims,
      timing: {
        submittedAtMs: record.submittedAtMs,
        ...(record.firstStartedAtMs !== undefined
          ? { startedAtMs: record.firstStartedAtMs, queueWaitMs }
          : {}),
        finishedAtMs,
        executionMs: record.executionMs,
      },
      accounting: {
        consumedInputIds: [...record.consumedInputIds],
        unconsumedInputs: unconsumed,
      },
      usage: usageParse.data,
    };
    const completionParse = ComputeJobCompletion.safeParse(completion);
    if (!completionParse.success) {
      throw new ComputeAdapterMisuseError(
        `internal: completion for job '${record.job.jobId}' violates the contract: ` +
          completionParse.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    record.completion = completionParse.data;
    this.usageRecords.push(usageParse.data);
    this.statsState.usageRecords += 1;
    record.subscribers.clear();
    assertComputeAccounting(this.statsState);
  }

  private snapshotOf(record: JobRecord): ComputeJobSnapshot {
    const snapshot: ComputeJobSnapshot = {
      schemaVersion: "1.0",
      jobId: record.job.jobId,
      idempotencyKey: record.job.idempotencyKey,
      sessionId: record.job.sessionId,
      state: record.state,
      events: [...record.events],
      ...(record.completion !== undefined ? { completion: record.completion } : {}),
    };
    const parsed = ComputeJobSnapshot.safeParse(snapshot);
    if (!parsed.success) {
      throw new ComputeAdapterMisuseError(
        `internal: snapshot for job '${record.job.jobId}' violates the contract: ` +
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    return parsed.data;
  }

  private countInState(state: ComputeJobState): number {
    let count = 0;
    for (const record of this.records.values()) {
      if (record.state === state) count += 1;
    }
    return count;
  }
}
