/**
 * `createMediaToolchainWorker` — the hosted compute worker's MEDIA
 * TOOLCHAIN EXECUTION PROFILE (W914 Wave 2 / R607 lane B): the per-process
 * composition that executes the REAL media operations (ffprobe admission
 * probing, ffmpeg canonical normalization) behind the compute-adapter
 * contract over real HTTP.
 *
 * The worker owns:
 *
 * - the **honest descriptor** (`describe()`): the ACTUALLY resolved
 *   ffmpeg/ffprobe toolchain (paths + the measured `ffmpeg -version` line),
 *   the operations it can ACTUALLY execute (EMPTY when the toolchain does
 *   not resolve — nothing is advertised that cannot be executed, the
 *   descriptor-honesty law), the fail-closed budgets, and the cost units
 *   its metering reports;
 * - **job records**: one record per executed job (idempotent by `jobId` —
 *   a re-POST of an executed job returns the SAME envelope and counts a
 *   duplicate, so at-least-once transports stay safe), carrying the state,
 *   the classified result envelope, and the per-job metering;
 * - **metering** (whole-worker and per-job): jobs dispatched, duplicates,
 *   capacity refusals, succeeded/failed, REAL ffprobe/ffmpeg run counts,
 *   input/output bytes, total execution ms — plus ONE `ComputeUsageRecord`
 *   per terminally-disposed job (the Wave-1 contract VERBATIM — metering
 *   totality: never silent, drainable via the usage surface);
 * - the **accounting identities** (`assertMediaToolchainAccounting`):
 *   `jobsDispatched === succeeded + failed + inFlight` and
 *   `usageRecords === succeeded + failed` — the compute-adapter ledger
 *   identities restated for this profile's worker.
 *
 * The REAL media operations themselves are executed by
 * `@sporta/media-platform`'s `executeMediaToolchainJob` (the typed
 * subprocess wrapper + the classified-envelope discipline the media domain
 * owns) — the SAME dependency posture as the render profile executing REAL
 * renderer plugins from `@sporta/renderer-anime`. This module never
 * re-implements a subprocess: it orchestrates, meters, and enforces.
 *
 * Concurrency is bounded fail-closed at ONE concurrent ffmpeg by default
 * (the memory discipline — a real ffmpeg process holds the source, the
 * encoder, and the output; over-budget executions are refused
 * determinately, never queued silently).
 */
import { ComputeUsageRecord } from "@sporta/compute-adapter";
import type { ComputeUsageRecord as ComputeUsageRecordDoc } from "@sporta/compute-adapter";
import {
  DEFAULT_MEDIA_TOOLCHAIN_BUDGETS,
  MEDIA_TOOLCHAIN_ADAPTER_ID,
  MEDIA_TOOLCHAIN_ADAPTER_VERSION,
  MEDIA_TOOLCHAIN_COST_UNITS,
  MEDIA_TOOLCHAIN_PROVIDER_ID,
  FfmpegTool,
  MediaToolchainDescriptor,
  executeMediaToolchainJob,
  resolveMediaToolchainBudgets,
} from "@sporta/media-platform";
import type {
  MediaToolchainBudgets,
  MediaToolchainDescriptor as MediaToolchainDescriptorDoc,
  MediaToolchainDispatchRequest as MediaToolchainDispatchRequestDoc,
  MediaToolchainOperation as MediaToolchainOperationDoc,
  MediaToolchainResult as MediaToolchainResultDoc,
} from "@sporta/media-platform";

/** Options for {@link createMediaToolchainWorker}. */
export interface MediaToolchainWorkerOptions {
  /** The REAL typed ffmpeg/ffprobe wrapper (REQUIRED — injected). */
  tool: FfmpegTool;
  /** The injected clock (epoch-ms readings; REQUIRED — this is a server package). */
  nowMs: () => number;
  /** Fail-closed budgets (default: the documented media-toolchain bounds). */
  budgets?: Partial<MediaToolchainBudgets>;
  /** Adapter identity (default `sporta.compute.hosted.media`). */
  adapterId?: string;
  /** Provider identity (default `sporta-media-toolchain-worker-1`). */
  providerId?: string;
}

/** One executed job's worker-side record. */
export interface MediaToolchainJobRecord {
  jobId: string;
  sessionId: string;
  operation: MediaToolchainOperationDoc;
  state: "executing" | "succeeded" | "failed";
  startedAtMs: number;
  finishedAtMs: number | undefined;
  /** The classified result envelope (present once execution finished). */
  result: MediaToolchainResultDoc | undefined;
  /** Per-job metering counters (present once execution finished). */
  metering: MediaToolchainResultDoc["metering"] | undefined;
  /** Counted duplicate executions of this job id (idempotent re-POSTs). */
  duplicateExecutions: number;
}

/** Whole-worker metering counters (never silent). */
export interface MediaToolchainStats {
  /** Execute calls that entered execution (the ledger population). */
  jobsDispatched: number;
  /** Counted idempotent re-POSTs of executed jobs. */
  duplicates: number;
  succeeded: number;
  failed: number;
  /** Jobs currently executing (0 at settle). */
  inFlight: number;
  /** Determinate refusals (capacity) — counted, never executed. */
  capacityRefusals: number;
  /** One usage record per terminally-disposed job (metering totality). */
  usageRecords: number;
  /** REAL ffprobe invocations across all jobs. */
  probeRuns: number;
  /** REAL ffmpeg invocations across all jobs. */
  transcodeRuns: number;
  /** Source bytes measured inbound across all jobs. */
  inputBytes: number;
  /** Normalized bytes measured outbound across all jobs. */
  outputBytes: number;
  /** Sum of per-job measured execution ms. */
  totalExecutionMs: number;
}

/** The determinate disposition of one `execute` call. */
export type MediaToolchainWorkerExecution =
  | { kind: "executed"; result: MediaToolchainResultDoc }
  | { kind: "duplicate"; result: MediaToolchainResultDoc; duplicateExecutions: number }
  | {
      kind: "refused";
      reason: { errorClass: string; message: string; terminal: "resource-limit" };
    };

/**
 * The media-toolchain compute worker application. The clock is INJECTED
 * (`nowMs`) — the transport composition roots inject a real wall clock;
 * tests inject counters.
 */
export class MediaToolchainWorker {
  private readonly tool: FfmpegTool;
  private readonly nowMs: () => number;
  private readonly records = new Map<string, MediaToolchainJobRecord>();
  private readonly usage: ComputeUsageRecordDoc[] = [];
  private readonly statsState: MediaToolchainStats = {
    jobsDispatched: 0,
    duplicates: 0,
    succeeded: 0,
    failed: 0,
    inFlight: 0,
    capacityRefusals: 0,
    usageRecords: 0,
    probeRuns: 0,
    transcodeRuns: 0,
    inputBytes: 0,
    outputBytes: 0,
    totalExecutionMs: 0,
  };
  private inFlight = 0;
  private descriptorCache: MediaToolchainDescriptorDoc | undefined;
  readonly adapterId: string;
  readonly providerId: string;
  readonly budgets: MediaToolchainBudgets;

  constructor(options: MediaToolchainWorkerOptions) {
    this.tool = options.tool;
    this.nowMs = options.nowMs;
    this.budgets = resolveMediaToolchainBudgets(options.budgets);
    this.adapterId = options.adapterId ?? MEDIA_TOOLCHAIN_ADAPTER_ID;
    this.providerId = options.providerId ?? MEDIA_TOOLCHAIN_PROVIDER_ID;
  }

  /**
   * The honest capability descriptor, derived from the REAL toolchain
   * resolution: when ffmpeg/ffprobe do not resolve, `toolchain.resolved`
   * is false and `operations` is EMPTY (never advertised beyond
   * resolution) — and every dispatch refuses with the typed
   * `ffmpeg-unavailable` class. ASYNC by necessity: the resolution is
   * MEASURED (a real `ffmpeg -version` run), cached after the first call.
   */
  async describe(): Promise<MediaToolchainDescriptorDoc> {
    if (this.descriptorCache === undefined) {
      const resolved = await this.tool.available();
      const ffmpegVersion = resolved ? await this.tool.version() : null;
      const descriptor = {
        schemaVersion: "1.0" as const,
        adapterId: this.adapterId,
        adapterVersion: MEDIA_TOOLCHAIN_ADAPTER_VERSION,
        providerId: this.providerId,
        providerKind: "cpu-worker" as const,
        operations: resolved
          ? ([
              "probe",
              "normalize",
              "decode-probe",
              "decode-frames",
            ] as const satisfies readonly MediaToolchainOperationDoc[])
          : [],
        toolchain: {
          ffmpegPath: resolved ? this.tool.ffmpegPath : null,
          ffprobePath: resolved ? this.tool.ffprobePath : null,
          ffmpegVersion,
          resolved,
        },
        budgets: {
          maxExecutionMs: this.budgets.maxExecutionMs,
          maxSourceBytes: this.budgets.maxSourceBytes,
          maxArtifactBytes: this.budgets.maxArtifactBytes,
          maxConcurrentJobs: this.budgets.maxConcurrentJobs,
          maxDecodedFrameBytes: this.budgets.maxDecodedFrameBytes,
        },
        costUnits: MEDIA_TOOLCHAIN_COST_UNITS,
      };
      const parsed = MediaToolchainDescriptor.safeParse(descriptor);
      if (!parsed.success) {
        throw new Error(
          "media toolchain worker derived an invalid descriptor: " +
            parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        );
      }
      this.descriptorCache = parsed.data;
    }
    return structuredClone(this.descriptorCache);
  }

  /**
   * Executes one media-toolchain dispatch (idempotent by `jobId`).
   * Concurrency is bounded fail-closed: over-budget executions are refused
   * determinately, never queued silently.
   */
  async execute(request: MediaToolchainDispatchRequestDoc): Promise<MediaToolchainWorkerExecution> {
    const known = this.records.get(request.job.jobId);
    if (known !== undefined && known.result !== undefined) {
      known.duplicateExecutions += 1;
      this.statsState.duplicates += 1;
      return {
        kind: "duplicate",
        result: known.result,
        duplicateExecutions: known.duplicateExecutions,
      };
    }
    if (this.inFlight >= this.budgets.maxConcurrentJobs) {
      this.statsState.capacityRefusals += 1;
      return {
        kind: "refused",
        reason: {
          errorClass: "capacity",
          message: `media toolchain worker is executing ${this.inFlight} jobs (budget ${this.budgets.maxConcurrentJobs}) — retry later`,
          terminal: "resource-limit",
        },
      };
    }
    const startedAtMs = this.nowMs();
    const record: MediaToolchainJobRecord = {
      jobId: request.job.jobId,
      sessionId: request.job.sessionId,
      operation: request.job.operation,
      state: "executing",
      startedAtMs,
      finishedAtMs: undefined,
      result: undefined,
      metering: undefined,
      duplicateExecutions: 0,
    };
    this.records.set(request.job.jobId, record);
    this.inFlight += 1;
    this.statsState.inFlight = this.inFlight;
    this.statsState.jobsDispatched += 1;
    try {
      // The REAL media operation (the media domain's classified executor).
      const result = await executeMediaToolchainJob(request, {
        tool: this.tool,
        nowMs: this.nowMs,
        budgets: this.budgets,
      });
      record.result = result;
      record.metering = result.metering;
      record.finishedAtMs = result.metering.finishedAtMs;
      record.state = result.status === "succeeded" ? "succeeded" : "failed";
      this.statsState.totalExecutionMs += result.metering.executionMs;
      this.statsState.probeRuns += result.metering.ffprobeRuns;
      this.statsState.transcodeRuns += result.metering.ffmpegRuns;
      this.statsState.inputBytes += result.metering.inputBytes;
      this.statsState.outputBytes += result.metering.outputBytes;
      if (result.status === "succeeded") {
        this.statsState.succeeded += 1;
      } else {
        this.statsState.failed += 1;
      }
      // Metering totality: EXACTLY ONE usage record per terminal job (the
      // Wave-1 contract's own schema is the validation).
      this.usage.push(
        ComputeUsageRecord.parse({
          schemaVersion: "1.0",
          jobId: request.job.jobId,
          idempotencyKey: request.job.idempotencyKey,
          sessionId: request.job.sessionId,
          adapterId: this.adapterId,
          providerId: this.providerId,
          terminalDisposition: result.status === "succeeded" ? "succeeded" : "failed",
          timing: { queueWaitMs: 0, executionMs: result.metering.executionMs },
          attempts: 1,
          claims: 1,
          costUnits: [
            { unitId: "cpu-ms", quantity: result.metering.executionMs },
            { unitId: "media-jobs", quantity: 1 },
            { unitId: "artifact-bytes", quantity: result.metering.outputBytes },
          ],
          meteredAtMs: this.nowMs(),
        }),
      );
      this.statsState.usageRecords = this.usage.length;
      return { kind: "executed", result };
    } finally {
      this.inFlight -= 1;
      this.statsState.inFlight = this.inFlight;
    }
  }

  /** The worker-side record of one executed job (or `null` — never fabricated). */
  getJob(jobId: string): MediaToolchainJobRecord | null {
    const record = this.records.get(jobId);
    return record === undefined ? null : structuredClone(record);
  }

  /** The metering drain: one `ComputeUsageRecord` per terminal job. */
  usageRecords(): ComputeUsageRecordDoc[] {
    return structuredClone(this.usage);
  }

  /** Whole-worker metering counters. */
  stats(): MediaToolchainStats {
    return { ...this.statsState };
  }
}

/** Creates the media-toolchain compute worker application. */
export function createMediaToolchainWorker(
  options: MediaToolchainWorkerOptions,
): MediaToolchainWorker {
  return new MediaToolchainWorker(options);
}

/**
 * The media-toolchain worker's accounting identities (the
 * `assertComputeAccounting` posture restated for this profile — an
 * imbalance THROWS naming the identity and the full breakdown):
 *
 * 1. `jobsDispatched === succeeded + failed + inFlight` — every
 *    ledger-populating execute call lands in EXACTLY ONE terminal bucket,
 *    with the not-yet-terminal jobs as `inFlight` (0 at settle);
 * 2. `usageRecords === succeeded + failed` — metering totality: exactly one
 *    usage record per terminally-disposed job (never silent).
 *
 * Boundary refusals (capacity) carry their OWN counter OUTSIDE the
 * identities (they never entered the ledger; the caller learned the
 * refusal loudly and synchronously) — the deliberate W303 divergence the
 * compute-adapter contract documents.
 */
export function assertMediaToolchainAccounting(stats: MediaToolchainStats): void {
  const breakdown = JSON.stringify(stats);
  const terminalSum = stats.succeeded + stats.failed;
  if (stats.jobsDispatched !== terminalSum + stats.inFlight) {
    throw new RangeError(
      `media toolchain identity 1 broken: jobsDispatched ${stats.jobsDispatched} != ` +
        `succeeded ${stats.succeeded} + failed ${stats.failed} + inFlight ${stats.inFlight} — ${breakdown}`,
    );
  }
  if (stats.usageRecords !== terminalSum) {
    throw new RangeError(
      `media tool chain identity 2 broken: usageRecords ${stats.usageRecords} != ` +
        `terminal jobs ${terminalSum} (metering totality) — ${breakdown}`,
    );
  }
}

export { DEFAULT_MEDIA_TOOLCHAIN_BUDGETS, MEDIA_TOOLCHAIN_ADAPTER_ID, MEDIA_TOOLCHAIN_PROVIDER_ID };
