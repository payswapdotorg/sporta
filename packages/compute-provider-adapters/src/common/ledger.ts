/**
 * The shared PROVIDER LEDGER (R402-R405): ONE `ComputeAdapterPort`
 * implementation the four real provider adapters compose — the job ledger
 * (admission, idempotency, the W914 lifecycle state machine,
 * `assertComputeTransition` on every change, the event trail, cancellation
 * with superseded reports, never-silent input accounting, metering
 * totality, and the settle-time accounting identities) over an INJECTED
 * provider client seam.
 *
 * This WRAPS the frozen `@sporta/compute-adapter` contract (its schemas,
 * its typed errors, its state machine, its accounting assertions) — it
 * forks nothing: the seam it implements is `ComputeAdapterPort`, the same
 * seam `InMemoryComputeAdapter` (test-only) and `HostedComputeAdapter`
 * (the in-process/http worker plane, `@sporta/compute-adapter-hosted`)
 * implement. Provider adapters cannot import the hosted package (this
 * package's dependency set is `@sporta/compute-adapter`,
 * `@sporta/contracts`, `@sporta/observability`, `@sporta/testing` only),
 * so the ledger is restated here once and SHARED by all four providers —
 * one ledger, four thin provider clients, honest descriptors.
 *
 * ## The provider client seam (per-provider, thin, real)
 *
 * {@link RemoteProviderClient} is the async-job surface every provider
 * maps its REAL REST API onto: `verifyCredentials` (connectivity + auth),
 * `submit` (one POST — never retried), `status` (an idempotent poll — at
 * most one retry inside the transport), `cancel` (terminate). Clients
 * answer typed VALUES — `{ ok: true, value } | { ok: false, refusal }` —
 * never thrown transport errors; every refusal carries the R401
 * closed-vocabulary reason (./refusal.ts) plus transport evidence.
 *
 * ## Honesty rules (test-pinned per adapter)
 *
 * - **Fail-loud credential gate**: a dispatch on an adapter whose
 *   credential state is `missing` (SandboxFallback) or `invalid` throws
 *   the typed `ProviderRefusalError` BEFORE any network call — the
 *   fixture tier asserts the transport saw ZERO calls;
 * - **No retry storms**: submit/cancel never retry; status polls at the
 *   injected interval, transient poll failures are counted and retried
 *   only at the next interval, the whole-job deadline is the backstop
 *   (poll/outcome-driven disposal — no timers beyond the injected sleep);
 * - **Failures are VALUES**: an admitted job resolves EXACTLY ONE
 *   terminal completion; a provider report racing a cancellation is
 *   counted `superseded-report`, never dropped; cancel never loses a job
 *   (a provider-side cancel refusal is recorded in the event trail — the
 *   ledger cancel still wins);
 * - **Honest metering**: the declared `time-ms` unit meters the MEASURED
 *   execution window (the provider-reported duration when the provider
 *   measures one, else the measured first-start-to-terminal window on the
 *   injected clock) — never an invented number;
 * - **Structurally invalid provider reports dead-letter** (`internal`) —
 *   a lying provider envelope is never trusted (the hosted http-client
 *   posture).
 */
import { z } from "zod";
import type {
  ComputeAdapterStats,
  ComputeCancelOutcome,
  ComputeDispatchOutcome,
  ComputeEventSink,
  ComputeJobEvent,
  ComputeJobState,
  ComputeMaterializedInputs,
  ComputeSubscription,
  ComputeTerminalDisposition,
  ComputeUsageQuery,
  ComputeUsageRecord,
  ComputeAdapterPort,
} from "@sporta/compute-adapter";
import {
  ComputeAdapterDescriptor,
  ComputeJobCompletion,
  ComputeJobDescription,
  ComputeJobSnapshot,
  ComputeOutputArtifact,
  ComputeValidationError,
  ComputeAdmissionError,
  ComputeResourceLimitError,
  ComputeRightsError,
  ComputeAdapterMisuseError,
  UnknownComputeJobError,
  emptyComputeStats,
  assertComputeTransition,
  assertComputeAccounting,
  isTerminalComputeState,
} from "@sporta/compute-adapter";
import type { ProviderRefusal } from "./refusal";
import { ProviderRefusalError } from "./refusal";
import type { ProviderCredentialStatus } from "./credentials";

// ---------------------------------------------------------------------------
// The provider result envelope (the terminal document a provider answers)
// ---------------------------------------------------------------------------

/** Non-empty string helper (the contract convention). */
const nonEmpty = z.string().min(1);

/** The provider's classified failure (the hosted envelope shape, strict). */
export const ProviderJobFailure = z
  .object({
    errorClass: nonEmpty,
    message: nonEmpty,
    terminal: z.enum(["non-retryable", "timeout", "internal"]),
    retryable: z.boolean(),
  })
  .strict();
export type ProviderJobFailure = z.infer<typeof ProviderJobFailure>;

/**
 * The TERMINAL result envelope one executed provider job answers: the
 * W914-aligned artifacts (content-addressed, validated fail-loud),
 * consumed-input accounting, and the classified failure. A provider whose
 * envelope fails this schema is a LYING provider — the ledger dead-letters
 * the job `internal`, never trusts the document.
 */
export const ProviderJobResult = z
  .object({
    status: z.enum(["succeeded", "failed"]),
    outputs: z.array(ComputeOutputArtifact),
    consumedInputIds: z.array(nonEmpty),
    failure: ProviderJobFailure.optional(),
    /** The provider-measured execution duration (optional — honest). */
    executionMs: z.number().finite().min(0).optional(),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (result.status === "failed" && result.failure === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["failure"],
        message: 'status "failed" requires failure details',
      });
    }
    if (result.status !== "failed" && result.failure !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["failure"],
        message: `failure details are only legal when status is "failed" (got "${result.status}")`,
      });
    }
    if (result.status !== "succeeded" && result.outputs.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["outputs"],
        message: "outputs are only legal on a succeeded result",
      });
    }
  });
export type ProviderJobResult = z.infer<typeof ProviderJobResult>;

/** The non-terminal poll answer a provider client maps its status API onto. */
export type ProviderClientStatus =
  | { phase: "queued" }
  | { phase: "running"; fraction?: number; stage?: string }
  | { phase: "terminal"; result: ProviderJobResult };

/** One provider call's typed answer (never a thrown transport error). */
export type ProviderCall<T> = { ok: true; value: T } | { ok: false; refusal: ProviderRefusal };

// ---------------------------------------------------------------------------
// The provider client seam (per-provider REST mapping)
// ---------------------------------------------------------------------------

/**
 * The async-job surface every provider client implements over its REAL
 * REST API (plain fetch through ./http.ts — no SDKs anywhere).
 */
export interface RemoteProviderClient {
  /** The provider's endpoint-family label (DATA for evidence records). */
  readonly endpointFamily: string;
  /** The provider identity usage records name (data — the client's own id). */
  readonly providerInstanceId: string;
  /** Verifies connectivity + credentials with ONE real authenticated GET. */
  verifyCredentials(): Promise<ProviderCall<string>>;
  /** Submits one job (ONE POST — never retried). */
  submit(
    job: ComputeJobDescription,
    materialized?: ComputeMaterializedInputs,
  ): Promise<ProviderCall<{ providerJobId: string }>>;
  /** Polls one provider job (idempotent — at most one transport retry). */
  status(providerJobId: string): Promise<ProviderCall<ProviderClientStatus>>;
  /** Terminates one provider job (best-effort from the ledger's cancel). */
  cancel(providerJobId: string): Promise<ProviderCall<void>>;
}

/** The credential gate every adapter consults before any network call. */
export interface ProviderCredentialGate {
  credentialStatus(): ProviderCredentialStatus;
  gateRefusal(): ProviderRefusal | null;
  markVerified(detail: string, atMs: number): void;
  markInvalid(detail: string, atMs: number): void;
  markUnverifiable(detail: string, atMs: number): void;
}

// ---------------------------------------------------------------------------
// The ledger adapter
// ---------------------------------------------------------------------------

/** Options for {@link ProviderLedgerAdapter}. */
export interface ProviderLedgerAdapterOptions {
  /** The frozen capability descriptor (validated fail-loud at construction). */
  descriptor: ComputeAdapterDescriptor;
  /** The provider client (the REAL REST mapping — injected, never faked). */
  client: RemoteProviderClient;
  /** The credential gate (missing/invalid refuse dispatch pre-network). */
  credentials: ProviderCredentialGate;
  /** The injected clock (epoch-ms readings; REQUIRED — no wall-clock reads). */
  nowMs: () => number;
  /** The injected sleep between status polls (default: real setTimeout). */
  sleep?: (ms: number) => Promise<void>;
  /** The status poll interval in ms (default 250 — honest small default). */
  pollIntervalMs?: number;
  /** Lifetime admitted-jobs bound (default 1_000_000 — the W303 magnitude). */
  maxAdmittedJobs?: number;
}

/** One job's ledger record (the never-silent entry). */
interface JobRecord {
  job: ComputeJobDescription;
  state: ComputeJobState;
  events: ComputeJobEvent[];
  claims: number;
  attempts: number;
  providerJobId: string | undefined;
  admittedAtMs: number;
  firstStartedAtMs: number | undefined;
  reportedExecutionMs: number | undefined;
  consumedInputIds: Set<string>;
  pollFailures: number;
  completion: ComputeJobCompletion | undefined;
  subscribers: Set<ComputeEventSink>;
}

/**
 * The shared provider-ledger adapter (R402-R405): implements
 * `ComputeAdapterPort` over an injected `RemoteProviderClient`. Every
 * concrete adapter this package ships (the managed-actor one, the two
 * dedicated-GPU-machine ones, and the self-hosted local one) is THIN:
 * its descriptor defaults + its real provider client + its credentials +
 * (the local one only) the GPU-admission hook.
 */
export class ProviderLedgerAdapter implements ComputeAdapterPort {
  private readonly descriptor: ComputeAdapterDescriptor;
  protected readonly client: RemoteProviderClient;
  protected readonly credentials: ProviderCredentialGate;
  private readonly nowMs: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly maxAdmittedJobs: number;
  private readonly records = new Map<string, JobRecord>();
  private readonly byIdempotencyKey = new Map<string, string>();
  private readonly statsState: ComputeAdapterStats = emptyComputeStats();
  private readonly usageRecords: ComputeUsageRecord[] = [];
  private inFlightHandoffs = 0;

  constructor(options: ProviderLedgerAdapterOptions) {
    const descriptorParse = ComputeAdapterDescriptor.safeParse(options.descriptor);
    if (!descriptorParse.success) {
      throw new ComputeAdapterMisuseError(
        "a provider adapter requires a valid ComputeAdapterDescriptor: " +
          descriptorParse.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    this.descriptor = descriptorParse.data;
    this.client = options.client;
    this.credentials = options.credentials;
    this.nowMs = options.nowMs;
    this.sleep =
      options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.maxAdmittedJobs = options.maxAdmittedJobs ?? 1_000_000;
  }

  // -------------------------------------------------------------------------
  // Provider-plane surface (beyond ComputeAdapterPort — R406 consumes these)
  // -------------------------------------------------------------------------

  /** The honest credential snapshot (never a credential value). */
  credentialStatus(): ProviderCredentialStatus {
    return this.credentials.credentialStatus();
  }

  /**
   * Verifies connectivity + credentials with ONE REAL authenticated call
   * (plain fetch through the client) and records the honest result:
   * `verified` on success, `invalid` on a provider rejection (401/403),
   * or the honest prior state when verification could not complete
   * (network/timeout — an unreachable provider proves nothing).
   */
  async verifyCredentials(): Promise<ProviderCredentialStatus> {
    const result = await this.client.verifyCredentials();
    const atMs = this.nowMs();
    if (result.ok) {
      this.credentials.markVerified(result.value, atMs);
    } else if (result.refusal.reason === "credential-invalid") {
      this.credentials.markInvalid(result.refusal.message, atMs);
    } else {
      this.credentials.markUnverifiable(result.refusal.message, atMs);
    }
    return this.credentialStatus();
  }

  // -------------------------------------------------------------------------
  // ComputeAdapterPort
  // -------------------------------------------------------------------------

  describe(): ComputeAdapterDescriptor {
    return structuredClone(this.descriptor);
  }

  /** The provider-plane admission hook (the local GPU honesty gate; null = admit). */
  protected admissionRefusalOf(job: ComputeJobDescription): ProviderRefusal | null {
    void job; // the default hook admits everything; the local adapter overrides
    return null;
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

    // 4. Admission — descriptor honesty (renderer/latency/deadline bounds).
    this.assertDescriptorAdmission(description);

    // 4.5. Provider-plane admission hook (the local GPU honesty gate).
    const providerRefusal = this.admissionRefusalOf(description);
    if (providerRefusal !== null) {
      this.statsState.resourceRefusals += 1;
      throw new ProviderRefusalError(providerRefusal, { adapterId: this.descriptor.adapterId });
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

    // 6. Credential gate — FAIL-LOUD, BEFORE ANY NETWORK CALL (the typed-
    //    refusal rule; the fixture tier pins transport-call-count 0).
    const gateRefusal = this.credentials.gateRefusal();
    if (gateRefusal !== null) {
      this.statsState.resourceRefusals += 1;
      throw new ProviderRefusalError(gateRefusal, {
        adapterId: this.descriptor.adapterId,
        credentialState: this.credentials.credentialStatus().state,
      });
    }

    // 7. Capacity (concurrently-live jobs bound + lifetime budget).
    if (this.inFlightHandoffs >= this.descriptor.maxConcurrentJobs) {
      this.statsState.resourceRefusals += 1;
      throw new ComputeResourceLimitError(
        `adapter '${this.descriptor.adapterId}' is executing ${this.inFlightHandoffs} jobs (concurrency bound ${this.descriptor.maxConcurrentJobs})`,
        { maxConcurrentJobs: this.descriptor.maxConcurrentJobs },
      );
    }
    if (this.statsState.admitted >= this.maxAdmittedJobs) {
      this.statsState.resourceRefusals += 1;
      throw new ComputeResourceLimitError(
        `adapter '${this.descriptor.adapterId}' admitted-job budget exhausted (${this.maxAdmittedJobs})`,
        { maxAdmittedJobs: this.maxAdmittedJobs },
      );
    }

    // 8. Admit (the ledger entry; the job is live from HERE to settle).
    const record: JobRecord = {
      job: description,
      state: "admitted",
      events: [],
      claims: 0,
      attempts: 0,
      providerJobId: undefined,
      admittedAtMs: this.nowMs(),
      firstStartedAtMs: undefined,
      reportedExecutionMs: undefined,
      consumedInputIds: new Set<string>(),
      pollFailures: 0,
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
    this.transition(
      record,
      "dispatched",
      this.eventOf(record, "submitted", { adapterId: this.descriptor.adapterId }),
    );
    this.appendEvent(
      record,
      this.eventOf(record, "dispatched", { provider: this.client.providerInstanceId }),
    );
    assertComputeAccounting(this.statsState);

    // 9. Decoupled handoff — the REAL provider submit happens after return.
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
    const snapshot = await this.getJob(jobId);
    if (snapshot === null) {
      throw new UnknownComputeJobError(
        `no compute job '${jobId}' was ever admitted by adapter '${this.descriptor.adapterId}'`,
        { jobId },
      );
    }
    return snapshot;
  }

  subscribe(jobId: string, sink: ComputeEventSink): ComputeSubscription {
    const record = this.records.get(jobId);
    if (record === undefined) {
      throw new UnknownComputeJobError(
        `cannot subscribe to unknown compute job '${jobId}' on adapter '${this.descriptor.adapterId}'`,
        { jobId },
      );
    }
    // Replay the past trail synchronously, then flow live events (a
    // terminal job delivers nothing further — the replay IS the story).
    for (const event of record.events) {
      sink(event);
    }
    let active = !isTerminalComputeState(record.state);
    if (active) {
      record.subscribers.add(sink);
    }
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
      throw new UnknownComputeJobError(
        `cannot cancel unknown compute job '${jobId}' on adapter '${this.descriptor.adapterId}'`,
        { jobId },
      );
    }
    if (isTerminalComputeState(record.state)) {
      // Idempotent no-op: nothing counted (the W303 terminal-cancel posture).
      return {
        cancelled: false,
        jobId,
        terminalDisposition: record.state as ComputeTerminalDisposition,
      };
    }
    // Best-effort provider-side cancel FIRST (the ledger cancel never
    // loses a job; a provider refusal is recorded in the event trail — a
    // leaked provider job is the documented risk, never a silent drop).
    let cancelDetails: Record<string, unknown> = {};
    if (record.providerJobId !== undefined) {
      const providerCancel = await this.client.cancel(record.providerJobId);
      if (!providerCancel.ok) {
        this.observeCredentialRefusal(providerCancel.refusal);
        cancelDetails = {
          providerCancelRefused: providerCancel.refusal.reason,
          providerCancelMessage: providerCancel.refusal.message,
        };
      }
    }
    this.settleAndTransition(
      record,
      "cancelled",
      this.eventOf(record, "cancelled", cancelDetails),
      undefined,
    );
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
  // Ledger internals
  // -------------------------------------------------------------------------

  /** Descriptor-honesty admission (the W914 checks, verbatim semantics). */
  private assertDescriptorAdmission(description: ComputeJobDescription): void {
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
  }

  /** Builds one decision event (schemaVersion + jobId always). */
  private eventOf(
    record: JobRecord,
    type:
      | "submitted"
      | "dispatched"
      | "claimed"
      | "deadline-timeout"
      | "cancelled"
      | "superseded-report"
      | "succeeded"
      | "failed"
      | "dead-lettered",
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
  private transition(record: JobRecord, to: ComputeJobState, event?: ComputeJobEvent): void {
    assertComputeTransition(record.state, to);
    record.state = to;
    if (event !== undefined) {
      this.appendEvent(record, event);
    }
  }

  /**
   * Terminal settlement + transition, in the CONTRACT-CORRECT ORDER: the
   * completion envelope is attached BEFORE the terminal event fans out.
   * The W914 `awaitCompletion` contract says "the terminal event implies
   * the completion envelope exists on the next poll" — a synchronous
   * subscriber that polls inside the terminal-event fan-out must never
   * observe a terminal state without its envelope (the snapshot contract
   * forbids exactly that shape). Attaching the envelope first keeps every
   * mid-fan-out poll consistent; the event TRAIL order is unchanged.
   */
  private settleAndTransition(
    record: JobRecord,
    disposition: ComputeTerminalDisposition,
    event: ComputeJobEvent,
    payload:
      | { outputs: ComputeOutputArtifact[] }
      | {
          failure: {
            errorClass: string;
            message: string;
            terminal: "non-retryable" | "timeout" | "internal";
          };
        }
      | undefined,
  ): void {
    this.settle(record, disposition, payload);
    this.transition(record, disposition, event);
  }

  /** Appends one event to the trail + fans it out to the subscribers. */
  private appendEvent(record: JobRecord, event: ComputeJobEvent): void {
    record.events.push(event);
    for (const sink of [...record.subscribers]) {
      sink(event);
    }
  }

  /** Poll/outcome-driven deadline disposal (no timers — the hosted posture). */
  private maybeDisposePastDeadline(record: JobRecord): void {
    if (isTerminalComputeState(record.state)) return;
    const now = this.nowMs();
    if (now - record.admittedAtMs <= record.job.constraints.deadlineMs) return;
    // The live job missed its whole-job deadline: dispose failed/timeout
    // and best-effort cancel at the provider (the outputs never arrive).
    if (record.providerJobId !== undefined) {
      void this.client.cancel(record.providerJobId).then(
        () => undefined,
        () => undefined,
      );
    }
    this.settleAndTransition(
      record,
      "failed",
      this.eventOf(record, "deadline-timeout", {
        deadlineMs: record.job.constraints.deadlineMs,
        elapsedMs: now - record.admittedAtMs,
      }),
      {
        failure: {
          errorClass: "deadline-exceeded",
          message: `job missed its ${record.job.constraints.deadlineMs}ms whole-job deadline (disposed at poll)`,
          terminal: "timeout",
        },
      },
    );
  }

  /** The decoupled handoff: submit → poll → terminal report into the ledger. */
  private async runHandoff(
    record: JobRecord,
    materialized: ComputeMaterializedInputs | undefined,
  ): Promise<void> {
    this.inFlightHandoffs += 1;
    try {
      if (isTerminalComputeState(record.state)) {
        // A cancel landed between admission and the handoff — the cancel
        // wins; this execution never starts (counted superseded).
        this.statsState.supersededReports += 1;
        return;
      }

      // --- SUBMIT (one real POST — never retried) -------------------------
      const submission = await this.client.submit(record.job, materialized);
      if (!submission.ok) {
        this.observeCredentialRefusal(submission.refusal);
        if (isTerminalComputeState(record.state)) {
          this.statsState.supersededReports += 1;
          return;
        }
        // The provider never took the job: dispatched → failed with the
        // typed refusal reason as the errorClass (the W303 determinate
        // provider-refusal posture — the caller may re-dispatch under a
        // new idempotency key; this adapter never auto-retries dispatch).
        this.settleAndTransition(
          record,
          "failed",
          this.eventOf(record, "failed", {
            errorClass: submission.refusal.reason,
            refusedAtHandoff: true,
            ...(submission.refusal.transport !== undefined
              ? { transport: submission.refusal.transport }
              : {}),
          }),
          {
            failure: {
              errorClass: submission.refusal.reason,
              message: submission.refusal.message,
              terminal: "non-retryable",
            },
          },
        );
        return;
      }
      record.providerJobId = submission.value.providerJobId;
      if (isTerminalComputeState(record.state)) {
        // Cancelled while the submit was in flight: the ledger cancel won;
        // the provider job that just materialized is best-effort cancelled
        // and the acceptance is counted superseded — never a silent leak.
        this.statsState.supersededReports += 1;
        void this.client.cancel(record.providerJobId).then(
          () => undefined,
          () => undefined,
        );
        return;
      }
      // Provider accepted: dispatched → queued.
      this.transition(record, "queued");
      assertComputeAccounting(this.statsState);

      // --- POLL LOOP (interval-bounded; deadline is the backstop) ---------
      await this.drivePollLoop(record);
    } finally {
      this.inFlightHandoffs -= 1;
    }
  }

  /** Polls the provider until terminal, cancelled, or deadline-disposed. */
  private async drivePollLoop(record: JobRecord): Promise<void> {
    for (;;) {
      await this.sleep(this.pollIntervalMs);
      if (isTerminalComputeState(record.state)) return;

      // Poll-driven deadline disposal (the backstop for unreachable polls).
      const now = this.nowMs();
      if (now - record.admittedAtMs > record.job.constraints.deadlineMs) {
        this.maybeDisposePastDeadline(record);
        return;
      }

      const providerJobId = record.providerJobId;
      if (providerJobId === undefined) {
        return; // defensive: nothing to poll (the submit path owns this)
      }
      const polled = await this.client.status(providerJobId);
      if (!polled.ok) {
        this.observeCredentialRefusal(polled.refusal);
        if (polled.refusal.permanent === true) {
          // The provider no longer knows this job (a 404 status poll): the
          // work is UNKNOWABLE — dead-letter internal with the REAL cause
          // (the provider-native error class when the client names one,
          // e.g. the R404 pod-not-found posture), never poll forever.
          const deadLetterClass = polled.refusal.terminalErrorClass ?? "provider-job-not-found";
          this.settleAndTransition(
            record,
            "dead-lettered",
            this.eventOf(record, "dead-lettered", {
              errorClass: deadLetterClass,
              realCause: polled.refusal.message,
              permanent: true,
            }),
            {
              failure: {
                errorClass: deadLetterClass,
                message: polled.refusal.message,
                terminal: "internal",
              },
            },
          );
          return;
        }
        // Transient poll failure: count it, poll again at the interval
        // (no retry storm — ONE transport retry already happened inside
        // the client for the idempotent GET), the deadline disposes.
        record.pollFailures += 1;
        continue;
      }

      if (polled.value.phase === "queued") {
        continue; // still queued at the provider
      }
      if (polled.value.phase === "running") {
        if (record.state === "queued") {
          record.claims += 1;
          record.attempts += 1;
          if (record.firstStartedAtMs === undefined) {
            record.firstStartedAtMs = this.nowMs();
          }
          this.transition(
            record,
            "in-flight",
            this.eventOf(record, "claimed", { provider: this.client.providerInstanceId }),
          );
        }
        const fraction = polled.value.fraction;
        if (fraction !== undefined && fraction > 0 && fraction <= 1) {
          this.appendEvent(record, {
            schemaVersion: "1.0",
            jobId: record.job.jobId,
            type: "progress",
            atMs: this.nowMs(),
            fraction,
            ...(polled.value.stage !== undefined ? { stage: polled.value.stage } : {}),
          });
        }
        continue;
      }

      // phase === "terminal"
      const raw = polled.value.result;
      const parsedResult = ProviderJobResult.safeParse(raw);
      if (!parsedResult.success) {
        // A lying provider envelope: dead-letter internal, never trust it.
        this.statsState.invalidProviderReports += 1;
        this.settleAndTransition(
          record,
          "dead-lettered",
          this.eventOf(record, "dead-lettered", { errorClass: "invalid-provider-report" }),
          {
            failure: {
              errorClass: "invalid-provider-report",
              message:
                "provider answered a terminal result that is not a valid provider result envelope: " +
                parsedResult.error.issues
                  .map((i) => `${i.path.join(".")}: ${i.message}`)
                  .join("; "),
              terminal: "internal",
            },
          },
        );
        return;
      }
      const result = parsedResult.data;
      if (result.executionMs !== undefined) {
        record.reportedExecutionMs = result.executionMs;
      }
      if (isTerminalComputeState(record.state)) {
        // The outcome lost the race to a cancellation — counted, never dropped.
        this.statsState.supersededReports += 1;
        this.appendEvent(
          record,
          this.eventOf(record, "superseded-report", {
            reportedStatus: result.status,
            jobState: record.state,
          }),
        );
        return;
      }
      // Late-outcome deadline check (fail-closed: discard the outputs).
      const nowLate = this.nowMs();
      if (nowLate - record.admittedAtMs > record.job.constraints.deadlineMs) {
        this.settleAndTransition(
          record,
          "failed",
          this.eventOf(record, "deadline-timeout", {
            deadlineMs: record.job.constraints.deadlineMs,
            elapsedMs: nowLate - record.admittedAtMs,
            lateOutcome: true,
          }),
          {
            failure: {
              errorClass: "deadline-exceeded",
              message: `provider outcome arrived after the ${record.job.constraints.deadlineMs}ms whole-job deadline — outputs discarded`,
              terminal: "timeout",
            },
          },
        );
        return;
      }
      for (const inputId of result.consumedInputIds) {
        if (record.job.inputs.some((input) => input.inputId === inputId)) {
          record.consumedInputIds.add(inputId);
        }
      }
      // A terminal RESULT while still `queued`: the provider executed
      // without ever reporting running — the outcome PROVES a claim was
      // granted, so the claim is synthesized honestly (counted, event
      // trail carries the marker) before the legal terminal transition.
      if (record.state === "queued") {
        record.claims += 1;
        record.attempts += 1;
        if (record.firstStartedAtMs === undefined) {
          record.firstStartedAtMs = this.nowMs();
        }
        this.transition(
          record,
          "in-flight",
          this.eventOf(record, "claimed", {
            provider: this.client.providerInstanceId,
            runningReportSkipped: true,
          }),
        );
      }
      if (result.status === "succeeded") {
        this.settleAndTransition(
          record,
          "succeeded",
          this.eventOf(record, "succeeded", { outputCount: result.outputs.length }),
          { outputs: result.outputs },
        );
        return;
      }
      const failure = result.failure;
      const bucket: ComputeTerminalDisposition =
        failure?.terminal === "internal" ? "dead-lettered" : "failed";
      this.settleAndTransition(
        record,
        bucket,
        this.eventOf(record, bucket === "dead-lettered" ? "dead-lettered" : "failed", {
          errorClass: failure?.errorClass ?? "provider-failure",
          ...(record.pollFailures > 0 ? { pollFailures: record.pollFailures } : {}),
        }),
        {
          failure:
            failure !== undefined
              ? {
                  errorClass: failure.errorClass,
                  message: failure.message,
                  terminal: failure.terminal,
                }
              : {
                  errorClass: "invalid-provider-report",
                  message: "provider reported failure without failure details",
                  terminal: "internal",
                },
        },
      );
      return;
    }
  }

  /** A credential-invalid refusal flips the monitor (next dispatch fails pre-network). */
  private observeCredentialRefusal(refusal: ProviderRefusal): void {
    if (refusal.reason === "credential-invalid") {
      this.credentials.markInvalid(refusal.message, this.nowMs());
    }
  }

  /** Builds + stores the terminal completion (exactly once per job). */
  private settle(
    record: JobRecord,
    disposition: ComputeTerminalDisposition,
    payload:
      | { outputs: ComputeOutputArtifact[] }
      | {
          failure: {
            errorClass: string;
            message: string;
            terminal: "non-retryable" | "timeout" | "internal";
          };
        }
      | undefined,
  ): void {
    if (record.completion !== undefined) {
      return; // once-only by construction (the first terminal envelope stays)
    }
    const finishedAtMs = this.nowMs();
    const queueWaitMs =
      record.firstStartedAtMs !== undefined
        ? Math.max(0, record.firstStartedAtMs - record.admittedAtMs)
        : 0;
    const executionMs =
      record.reportedExecutionMs !== undefined
        ? record.reportedExecutionMs
        : record.firstStartedAtMs !== undefined
          ? Math.max(0, finishedAtMs - record.firstStartedAtMs)
          : 0;

    const consumedInputIds: string[] = [];
    const unconsumedInputs: Array<{ inputId: string; reason: string }> = [];
    let outputs: ComputeOutputArtifact[] = [];
    let failure:
      | { errorClass: string; message: string; terminal: "non-retryable" | "timeout" | "internal" }
      | undefined;
    if (payload !== undefined && "outputs" in payload) {
      outputs = payload.outputs;
      for (const input of record.job.inputs) {
        if (record.consumedInputIds.has(input.inputId)) {
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
      for (const input of record.job.inputs) {
        unconsumedInputs.push({
          inputId: input.inputId,
          reason: `execution failed (${payload.failure.errorClass}) before consuming this input`,
        });
      }
    } else {
      for (const input of record.job.inputs) {
        unconsumedInputs.push({
          inputId: input.inputId,
          reason:
            disposition === "cancelled" ? "job cancelled" : "execution did not consume this input",
        });
      }
    }

    const status =
      disposition === "dead-lettered"
        ? "failed"
        : disposition === "cancelled"
          ? "cancelled"
          : disposition;
    const completion: ComputeJobCompletion = {
      schemaVersion: "1.0",
      jobId: record.job.jobId,
      idempotencyKey: record.job.idempotencyKey,
      sessionId: record.job.sessionId,
      status,
      terminalDisposition: disposition,
      ...(failure !== undefined ? { failure } : {}),
      outputs,
      attempts: record.attempts,
      claims: record.claims,
      timing: {
        submittedAtMs: record.admittedAtMs,
        ...(record.firstStartedAtMs !== undefined ? { startedAtMs: record.firstStartedAtMs } : {}),
        finishedAtMs,
        queueWaitMs,
        executionMs,
      },
      accounting: { consumedInputIds, unconsumedInputs },
      usage: this.buildUsageRecord(
        record,
        disposition,
        queueWaitMs,
        executionMs,
        outputs,
        finishedAtMs,
      ),
    };
    const completionParse = ComputeJobCompletion.safeParse(completion);
    if (!completionParse.success) {
      throw new ComputeAdapterMisuseError(
        `internal: completion for job '${record.job.jobId}' violates the contract: ` +
          completionParse.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    record.completion = completionParse.data;
    this.usageRecords.push(completionParse.data.usage);
    this.statsState.usageRecords += 1;
    this.statsState.inFlight -= 1;
    if (disposition === "succeeded") this.statsState.succeeded += 1;
    else if (disposition === "failed") this.statsState.failed += 1;
    else if (disposition === "cancelled") this.statsState.cancelled += 1;
    else this.statsState.deadLettered += 1;
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
    outputs: ComputeOutputArtifact[],
    meteredAtMs: number,
  ): ComputeUsageRecord {
    const declared = new Set(this.descriptor.costUnits.map((unit) => unit.unitId));
    const quantities: Array<{ unitId: string; quantity: number }> = [];
    if (declared.has("compute-ms")) {
      quantities.push({ unitId: "compute-ms", quantity: executionMs });
    }
    if (declared.has("cpu-ms")) {
      quantities.push({ unitId: "cpu-ms", quantity: executionMs });
    }
    if (declared.has("artifact-bytes")) {
      quantities.push({
        unitId: "artifact-bytes",
        quantity: outputs.reduce((total, artifact) => total + artifact.byteLength, 0),
      });
    }
    if (quantities.length === 0) {
      // Metering totality outranks unit richness (the hosted fallback): the
      // first declared unit meters 0 — never a missing record.
      const first = this.descriptor.costUnits[0];
      if (first !== undefined) quantities.push({ unitId: first.unitId, quantity: 0 });
    }
    return {
      schemaVersion: "1.0",
      jobId: record.job.jobId,
      idempotencyKey: record.job.idempotencyKey,
      sessionId: record.job.sessionId,
      adapterId: this.descriptor.adapterId,
      providerId: this.client.providerInstanceId,
      terminalDisposition: disposition,
      timing: { queueWaitMs, executionMs },
      attempts: record.attempts,
      claims: record.claims,
      costUnits: quantities,
      meteredAtMs,
    };
  }

  private snapshotOf(record: JobRecord): ComputeJobSnapshot {
    const snapshot: ComputeJobSnapshot = {
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
    const parsed = ComputeJobSnapshot.safeParse(snapshot);
    if (!parsed.success) {
      throw new ComputeAdapterMisuseError(
        `internal: snapshot for job '${record.job.jobId}' violates the contract: ` +
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    return parsed.data;
  }
}
