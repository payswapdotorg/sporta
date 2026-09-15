/**
 * `HostedComputeAdapter` — the production `ComputeAdapterPort`
 * implementation of the W914 Wave-2 hosted compute plane (what the control
 * plane consumes; the in-memory reference in `@sporta/compute-adapter` is
 * the TEST-ONLY proof of the same contract).
 *
 * The adapter owns the JOB LEDGER — admission, idempotency, the lifecycle
 * state machine (`assertComputeTransition` on every change), the event
 * trail, cancellation with superseded reports, never-silent input
 * accounting, metering totality, and the settle-time accounting identities
 * — and delegates EXECUTION to an injected
 * `execute(job, materialized) => Promise<HostedJobExecution>` function:
 *
 * - **in-process** (dev/reference): the function calls a `ComputeWorker`
 *   directly (./worker.ts) — no transport;
 * - **HTTP** (hosted): the function POSTs the dispatch request to the
 *   worker route (`POST /v1/jobs/execute`) — ./http.ts exports the client
 *   (`createHttpExecuteFunction`) and the worker's server surface.
 *
 * ## Semantics inherited from the W303 constitution (PROTOCOL.md)
 *
 * - idempotency-key check FIRST; malformed dispatches and typed
 *   admission/capacity/rights refusals THROW with their OWN counters
 *   OUTSIDE the terminal identities;
 * - failures are VALUES: every admitted job resolves EXACTLY ONE terminal
 *   completion; a provider outcome racing a cancellation is counted
 *   `superseded-report`, never dropped; cancel never loses a job;
 * - deadline enforcement is POLL-DRIVEN and OUTCOME-DRIVEN (no timers in
 *   this package): a live job observed past its deadline at poll time is
 *   disposed `failed`/`timeout` (`deadline-timeout`), and an outcome that
 *   arrives after the deadline settles the job `failed`/`timeout` with the
 *   outputs discarded — never a late lie;
 * - exactly one usage record per terminally-disposed job (metering
 *   totality), in the descriptor's declared units;
 * - `stats()` asserts all four accounting identities on EVERY call (an
 *   imbalance throws — never a lying result).
 *
 * ## Honest limitations (this wave)
 *
 * - NO automatic retries: a transport/execution failure the provider
 *   reports as fatal settles the job `dead-lettered`/`internal` (retry and
 *   lease recovery machinery is the later W913 queue wave);
 * - the ledger is process-local (the G7 durable-ledger seam is W913) — a
 *   control plane restart forgets live jobs; the worker's own jobId
 *   idempotence makes re-dispatch safe;
 * - timing comes from the injected clock plus the worker-reported
 *   execution measurement (`HostedJobExecution.metering.executionMs`) —
 *   the adapter never invents a number the provider did not report.
 */
import {
  ComputeAdapterDescriptor,
  ComputeJobCompletion,
  ComputeJobDescription,
  ComputeJobEvent,
  ComputeUsageRecord,
  emptyComputeStats,
} from "@sporta/compute-adapter";
import type {
  ComputeAdapterStats,
  ComputeCancelOutcome,
  ComputeDispatchOutcome,
  ComputeJobSnapshot,
  ComputeMaterializedInputs,
  ComputeTerminalDisposition,
} from "@sporta/compute-adapter";
import { assertComputeAccounting } from "@sporta/compute-adapter";
import type {
  ComputeAdapterPort,
  ComputeEventSink,
  ComputeSubscription,
  ComputeUsageQuery,
} from "@sporta/compute-adapter";
import type { HostedJobExecution as HostedJobExecutionDoc } from "./envelope";
import { assertComputeTransition, isTerminalComputeState } from "@sporta/compute-adapter";
import type { ComputeJobState } from "@sporta/compute-adapter";
import {
  ComputeAdapterMisuseError,
  ComputeAdmissionError,
  ComputeResourceLimitError,
  ComputeRightsError,
  ComputeValidationError,
  UnknownComputeJobError,
} from "@sporta/compute-adapter";

/** The injected execution function (in-process or HTTP — see module docs). */
export type HostedExecuteFn = (
  job: ComputeJobDescription,
  materialized?: ComputeMaterializedInputs,
) => Promise<HostedJobExecutionDoc>;

/** Options for {@link HostedComputeAdapter}. */
export interface HostedComputeAdapterOptions {
  /** The frozen capability descriptor (validated fail-loud). */
  descriptor: ComputeAdapterDescriptor;
  /** The execution function this adapter dispatches through (required). */
  execute: HostedExecuteFn;
  /** The injected clock (epoch-ms readings; REQUIRED — this is a server package). */
  nowMs: () => number;
  /** The provider identity usage records name (default `sporta-compute-worker-1`). */
  providerId?: string;
  /** Lifetime admitted-jobs bound (default 1_000_000 — the W303 magnitude). */
  maxAdmittedJobs?: number;
}

/** One job's ledger record. */
interface JobRecord {
  job: ComputeJobDescription;
  state: ComputeJobState;
  events: ComputeJobEvent[];
  claims: number;
  attempts: number;
  admittedAtMs: number;
  firstStartedAtMs: number | undefined;
  roundStartedAtMs: number | undefined;
  reportedExecutionMs: number | undefined;
  completion: ComputeJobCompletion | undefined;
  subscribers: Set<ComputeEventSink>;
}

/**
 * The hosted compute adapter: the control-plane-facing port over an
 * injected execution function.
 */
export class HostedComputeAdapter implements ComputeAdapterPort {
  private readonly descriptor: ComputeAdapterDescriptor;
  private readonly executeFn: HostedExecuteFn;
  private readonly nowMs: () => number;
  private readonly providerId: string;
  private readonly maxAdmittedJobs: number;
  private readonly records = new Map<string, JobRecord>();
  private readonly byIdempotencyKey = new Map<string, string>();
  private readonly statsState: ComputeAdapterStats = emptyComputeStats();
  private readonly usageRecords: ComputeUsageRecord[] = [];
  private inFlightHandoffs = 0;

  constructor(options: HostedComputeAdapterOptions) {
    const descriptorParse = ComputeAdapterDescriptor.safeParse(options.descriptor);
    if (!descriptorParse.success) {
      throw new ComputeAdapterMisuseError(
        "HostedComputeAdapter requires a valid ComputeAdapterDescriptor: " +
          descriptorParse.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    this.descriptor = descriptorParse.data;
    this.executeFn = options.execute;
    this.nowMs = options.nowMs;
    this.providerId = options.providerId ?? "sporta-compute-worker-1";
    this.maxAdmittedJobs = options.maxAdmittedJobs ?? 1_000_000;
  }

  // -------------------------------------------------------------------------
  // ComputeAdapterPort
  // -------------------------------------------------------------------------

  describe(): ComputeAdapterDescriptor {
    return this.descriptor;
  }

  async dispatch(
    job: ComputeJobDescription,
    materialized?: ComputeMaterializedInputs,
  ): Promise<ComputeDispatchOutcome> {
    // 1. Structural validation (fail-loud, own counter, outside the identities).
    const parsed = ComputeJobDescription.safeParse(job);
    if (!parsed.success) {
      this.statsState.malformedDispatches += 1;
      throw new ComputeValidationError("dispatch payload is not a valid ComputeJobDescription", {
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    const description = parsed.data;

    // 2. Idempotency-key check FIRST (a known key is a counted duplicate).
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
      this.maybeDisposePastDeadline(known);
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

    // 4. Admission — descriptor honesty.
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

    // 5. Rights (source-media inputs without the capability — fail-closed).
    if (
      description.inputs.some((input) => input.kind === "source-media") &&
      !description.rights.canReferenceSourceFrames
    ) {
      this.statsState.rightsRefusals += 1;
      throw new ComputeRightsError(
        `job '${description.jobId}' carries source-media inputs but the rights posture denies canReferenceSourceFrames`,
        { jobId: description.jobId },
      );
    }

    // 6. Capacity (lifetime admitted budget + concurrent handoff budget).
    if (this.statsState.admitted >= this.maxAdmittedJobs) {
      this.statsState.resourceRefusals += 1;
      throw new ComputeResourceLimitError(
        `adapter '${this.descriptor.adapterId}' admitted-job budget exhausted (${this.maxAdmittedJobs})`,
        { maxAdmittedJobs: this.maxAdmittedJobs },
      );
    }
    if (this.inFlightHandoffs >= this.descriptor.maxConcurrentJobs) {
      this.statsState.resourceRefusals += 1;
      throw new ComputeResourceLimitError(
        `adapter '${this.descriptor.adapterId}' is executing ${this.inFlightHandoffs} jobs (concurrency bound ${this.descriptor.maxConcurrentJobs})`,
        { maxConcurrentJobs: this.descriptor.maxConcurrentJobs },
      );
    }

    // 7. Admit (the ledger entry + the submitted event).
    const record: JobRecord = {
      job: description,
      state: "admitted",
      events: [],
      claims: 0,
      attempts: 0,
      admittedAtMs: this.nowMs(),
      firstStartedAtMs: undefined,
      roundStartedAtMs: undefined,
      reportedExecutionMs: undefined,
      completion: undefined,
      subscribers: new Set(),
    };
    this.records.set(description.jobId, record);
    this.byIdempotencyKey.set(description.idempotencyKey, description.jobId);
    this.statsState.jobsDispatched += 1;
    this.statsState.admitted += 1;
    this.statsState.inputsManifested += description.inputs.length;
    this.statsState.inputsInFlight += description.inputs.length;
    this.transition(record, "dispatched", this.eventOf(record, "submitted", { adapterId: this.descriptor.adapterId }));
    this.transition(record, "queued", this.eventOf(record, "dispatched", { providerId: this.providerId }));
    assertComputeAccounting(this.statsState);

    // 8. Decoupled handoff — execution happens after dispatch returns.
    void this.runHandoff(record, materialized);

    return {
      disposition: "admitted",
      handle: {
        schemaVersion: "1.0",
        jobId: description.jobId,
        idempotencyKey: description.idempotencyKey,
        sessionId: description.sessionId,
        rendererId: description.renderer.rendererId,
        adapterId: this.descriptor.adapterId,
        admittedAtMs: record.admittedAtMs,
      },
    };
  }

  async getJob(jobId: string): Promise<ComputeJobSnapshot | null> {
    const record = this.records.get(jobId);
    if (record === undefined) return null;
    this.maybeDisposePastDeadline(record);
    return this.snapshotOf(record);
  }

  async getJobOrFail(jobId: string): Promise<ComputeJobSnapshot> {
    const record = this.records.get(jobId);
    if (record === undefined) {
      throw new UnknownComputeJobError(jobId);
    }
    this.maybeDisposePastDeadline(record);
    return this.snapshotOf(record);
  }

  subscribe(jobId: string, sink: ComputeEventSink): ComputeSubscription {
    const record = this.records.get(jobId);
    if (record === undefined) {
      throw new UnknownComputeJobError(jobId);
    }
    // Replay the past trail synchronously, then flow live events.
    for (const event of record.events) {
      sink(event);
    }
    record.subscribers.add(sink);
    let active = true;
    return {
      unsubscribe: (): void => {
        if (!active) return;
        active = false;
        record.subscribers.delete(sink);
      },
    };
  }

  async cancel(jobId: string): Promise<ComputeCancelOutcome> {
    const record = this.records.get(jobId);
    if (record === undefined) {
      this.statsState.unknownCancelTargets += 1;
      throw new UnknownComputeJobError(jobId);
    }
    if (isTerminalComputeState(record.state)) {
      return {
        cancelled: false,
        jobId,
        terminalDisposition: record.state as ComputeTerminalDisposition,
      };
    }
    this.transition(record, "cancelled", this.eventOf(record, "cancelled", { fromState: record.state }));
    this.settle(record, "cancelled", undefined);
    return { cancelled: true, jobId };
  }

  async usage(query?: ComputeUsageQuery): Promise<ComputeUsageRecord[]> {
    const all = [...this.usageRecords];
    if (query === undefined) return all;
    return all.filter(
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
  // Ledger internals
  // -------------------------------------------------------------------------

  /** Builds one decision event for a job (schemaVersion + jobId always). */
  private eventOf(
    record: JobRecord,
    type: "submitted" | "dispatched" | "claimed" | "deadline-timeout" | "cancelled" | "superseded-report" | "succeeded" | "failed" | "dead-lettered",
    details?: Record<string, unknown>,
  ): ComputeJobEvent {
    return {
      schemaVersion: "1.0",
      jobId: record.job.jobId,
      type,
      atMs: this.nowMs(),
      ...(details !== undefined ? { details } : {}),
    } as ComputeJobEvent;
  }

  /** Applies a legal transition + appends the event (fail-loud otherwise). */
  private transition(
    record: JobRecord,
    to: ComputeJobState,
    event?: ComputeJobEvent,
  ): void {
    assertComputeTransition(record.state, to);
    record.state = to;
    if (event !== undefined) {
      record.events.push(event);
      for (const sink of [...record.subscribers]) {
        sink(event);
      }
    }
  }

  /** Poll/outcome-driven deadline disposal (no timers — see module docs). */
  private maybeDisposePastDeadline(record: JobRecord): void {
    if (isTerminalComputeState(record.state)) return;
    const now = this.nowMs();
    if (now - record.admittedAtMs <= record.job.constraints.deadlineMs) return;
    // The live job missed its whole-job deadline: dispose it failed/timeout
    // (outputs never existed here — nothing to discard).
    this.transition(record, "failed", this.eventOf(record, "deadline-timeout", {
      deadlineMs: record.job.constraints.deadlineMs,
      elapsedMs: now - record.admittedAtMs,
    }));
    this.settle(record, "failed", {
      failure: {
        errorClass: "deadline-exceeded",
        message: `job missed its ${record.job.constraints.deadlineMs}ms whole-job deadline (disposed at poll)`,
        terminal: "timeout",
      },
    });
  }

  /** The decoupled handoff: execute → report into the ledger. */
  private async runHandoff(
    record: JobRecord,
    materialized: ComputeMaterializedInputs | undefined,
  ): Promise<void> {
    this.inFlightHandoffs += 1;
    try {
      // The claim: execution starts NOW (queued → in-flight).
      if (isTerminalComputeState(record.state)) {
        // A cancel landed between admission and the handoff — the cancel
        // wins; this job's execution never starts (the handoff is
        // superseded — counted as such).
        this.statsState.supersededReports += 1;
        return;
      }
      record.roundStartedAtMs = this.nowMs();
      if (record.firstStartedAtMs === undefined) {
        record.firstStartedAtMs = record.roundStartedAtMs;
      }
      record.claims += 1;
      record.attempts += 1;
      this.transition(record, "in-flight", this.eventOf(record, "claimed", { providerId: this.providerId }));
      let envelope: HostedJobExecutionDoc;
      try {
        envelope = await this.executeFn(record.job, materialized);
      } catch (err) {
        // Transport/execution fault: the work is unknowable — settle
        // dead-lettered/internal (no retries this wave; documented).
        this.transition(record, "dead-lettered", this.eventOf(record, "dead-lettered", { errorClass: "provider-fault" }));
        this.settle(record, "dead-lettered", {
          failure: {
            errorClass: "provider-fault",
            message: `provider execution fault: ${err instanceof Error ? err.message : String(err)}`,
            terminal: "internal",
          },
        });
        return;
      }
      if (isTerminalComputeState(record.state)) {
        // The outcome lost the race to a cancellation — counted, never dropped.
        this.statsState.supersededReports += 1;
        return;
      }
      record.reportedExecutionMs = envelope.metering.executionMs;
      // Late-outcome deadline check (fail-closed: discard the outputs).
      const now = this.nowMs();
      if (now - record.admittedAtMs > record.job.constraints.deadlineMs) {
        this.transition(record, "failed", this.eventOf(record, "deadline-timeout", {
          deadlineMs: record.job.constraints.deadlineMs,
          elapsedMs: now - record.admittedAtMs,
          lateOutcome: true,
        }));
        this.settle(record, "failed", {
          failure: {
            errorClass: "deadline-exceeded",
            message: `provider outcome arrived after the ${record.job.constraints.deadlineMs}ms whole-job deadline — outputs discarded`,
            terminal: "timeout",
          },
        });
        return;
      }
      if (envelope.status === "succeeded") {
        this.transition(record, "succeeded", this.eventOf(record, "succeeded", {
          outputCount: envelope.outputs.length,
          executionMs: envelope.metering.executionMs,
        }));
        this.settle(record, "succeeded", envelope);
        return;
      }
      const failure = envelope.failure;
      if (failure === undefined) {
        this.transition(record, "dead-lettered", this.eventOf(record, "dead-lettered", { errorClass: "invalid-provider-report" }));
        this.settle(record, "dead-lettered", {
          failure: {
            errorClass: "invalid-provider-report",
            message: "provider reported failure without failure details",
            terminal: "internal",
          },
        });
        return;
      }
      const bucket: ComputeTerminalDisposition =
        failure.terminal === "internal" ? "dead-lettered" : "failed";
      this.transition(record, bucket, this.eventOf(record, bucket === "dead-lettered" ? "dead-lettered" : "failed", {
        errorClass: failure.errorClass,
        terminal: failure.terminal,
      }));
      this.settle(record, bucket, envelope);
    } finally {
      this.inFlightHandoffs -= 1;
    }
  }

  /** Builds + stores the terminal completion (exactly once per job). */
  private settle(
    record: JobRecord,
    disposition: ComputeTerminalDisposition,
    payload:
      | HostedJobExecutionDoc
      | { failure: { errorClass: string; message: string; terminal: "non-retryable" | "timeout" | "internal" } }
      | undefined,
  ): void {
    if (record.completion !== undefined) {
      // Idempotent by construction — a double settle is a ledger bug, but
      // never a lying overwrite: keep the FIRST terminal envelope.
      return;
    }
    const finishedAtMs = this.nowMs();
    const queueWaitMs =
      record.firstStartedAtMs !== undefined
        ? Math.max(0, record.firstStartedAtMs - record.admittedAtMs)
        : 0;
    const executionMs =
      record.reportedExecutionMs ??
      (record.roundStartedAtMs !== undefined ? Math.max(0, finishedAtMs - record.roundStartedAtMs) : 0);
    const consumedInputIds: string[] = [];
    const unconsumedInputs: Array<{ inputId: string; reason: string }> = [];
    let outputs: HostedJobExecutionDoc["outputs"] = [];
    let failure:
      | { errorClass: string; message: string; terminal: "non-retryable" | "timeout" | "internal" }
      | undefined;
    if (payload !== undefined && "status" in payload && payload.status === "succeeded") {
      outputs = payload.outputs;
      const consumed = new Set(payload.consumedInputIds);
      for (const input of record.job.inputs) {
        if (consumed.has(input.inputId)) {
          consumedInputIds.push(input.inputId);
        } else {
          unconsumedInputs.push({
            inputId: input.inputId,
            reason: "provider did not consume this manifested input",
          });
        }
      }
    } else if (payload !== undefined && "failure" in payload && payload.failure !== undefined) {
      failure = payload.failure;
      const consumedSet = new Set(
        payload !== undefined && "consumedInputIds" in payload ? payload.consumedInputIds : [],
      );
      for (const input of record.job.inputs) {
        if (consumedSet.has(input.inputId)) {
          consumedInputIds.push(input.inputId);
        } else {
          unconsumedInputs.push({
            inputId: input.inputId,
            reason: `execution failed (${payload.failure.errorClass}) before consuming this input`,
          });
        }
      }
    } else {
      // Cancelled (or an outcome with no detail): nothing was consumed.
      for (const input of record.job.inputs) {
        unconsumedInputs.push({
          inputId: input.inputId,
          reason: disposition === "cancelled" ? "job cancelled" : "execution did not consume this input",
        });
      }
    }
    const status =
      disposition === "dead-lettered" ? "failed" : disposition === "cancelled" ? "cancelled" : disposition;
    const completion: ComputeJobCompletion = {
      schemaVersion: "1.0",
      jobId: record.job.jobId,
      idempotencyKey: record.job.idempotencyKey,
      sessionId: record.job.sessionId,
      status: status as "succeeded" | "failed" | "cancelled",
      terminalDisposition: disposition,
      ...(failure !== undefined
        ? {
            failure: {
              errorClass: failure.errorClass,
              message: failure.message,
              terminal: failure.terminal,
            },
          }
        : {}),
      outputs,
      attempts: record.attempts,
      claims: record.claims,
      timing: {
        submittedAtMs: record.admittedAtMs,
        ...(record.firstStartedAtMs !== undefined
          ? { startedAtMs: record.firstStartedAtMs }
          : {}),
        finishedAtMs,
        queueWaitMs,
        executionMs,
      },
      accounting: { consumedInputIds, unconsumedInputs },
      usage: this.buildUsageRecord(record, disposition, queueWaitMs, executionMs, outputs, finishedAtMs),
    };
    record.completion = completion;
    this.usageRecords.push(completion.usage);
    this.statsState.usageRecords += 1;
    if (disposition === "succeeded") {
      this.statsState.succeeded += 1;
    } else if (disposition === "failed") {
      this.statsState.failed += 1;
    } else if (disposition === "cancelled") {
      this.statsState.cancelled += 1;
    } else {
      this.statsState.deadLettered += 1;
    }
    this.statsState.inputsConsumed += consumedInputIds.length;
    this.statsState.inputsUnconsumed += unconsumedInputs.length;
    this.statsState.inputsInFlight -= record.job.inputs.length;
    assertComputeAccounting(this.statsState);
  }

  /** One metered usage record, in the descriptor's declared units only. */
  private buildUsageRecord(
    record: JobRecord,
    disposition: ComputeTerminalDisposition,
    queueWaitMs: number,
    executionMs: number,
    outputs: HostedJobExecutionDoc["outputs"],
    meteredAtMs: number,
  ): ComputeUsageRecord {
    const declared = new Set(this.descriptor.costUnits.map((unit) => unit.unitId));
    const quantities: Array<{ unitId: string; quantity: number }> = [];
    if (declared.has("cpu-ms")) quantities.push({ unitId: "cpu-ms", quantity: executionMs });
    if (declared.has("render-requests")) {
      quantities.push({ unitId: "render-requests", quantity: record.attempts });
    }
    if (declared.has("artifact-bytes")) {
      quantities.push({
        unitId: "artifact-bytes",
        quantity: outputs.reduce((total, artifact) => total + artifact.byteLength, 0),
      });
    }
    if (quantities.length === 0) {
      // Descriptor honesty fallback: meter the first declared unit at 0 —
      // metering totality outranks unit richness.
      const first = this.descriptor.costUnits[0];
      if (first !== undefined) quantities.push({ unitId: first.unitId, quantity: 0 });
    }
    return {
      schemaVersion: "1.0",
      jobId: record.job.jobId,
      idempotencyKey: record.job.idempotencyKey,
      sessionId: record.job.sessionId,
      adapterId: this.descriptor.adapterId,
      providerId: this.providerId,
      terminalDisposition: disposition,
      timing: { queueWaitMs, executionMs },
      attempts: record.attempts,
      claims: record.claims,
      costUnits: quantities,
      meteredAtMs,
    };
  }

  private snapshotOf(record: JobRecord): ComputeJobSnapshot {
    return {
      schemaVersion: "1.0",
      jobId: record.job.jobId,
      idempotencyKey: record.job.idempotencyKey,
      sessionId: record.job.sessionId,
      state: record.state,
      events: structuredClone(record.events),
      ...(record.completion !== undefined
        ? { completion: structuredClone(record.completion) }
        : {}),
    };
  }
}

/** Creates a hosted compute adapter over an injected execution function. */
export function createHostedComputeAdapter(
  options: HostedComputeAdapterOptions,
): HostedComputeAdapter {
  return new HostedComputeAdapter(options);
}
