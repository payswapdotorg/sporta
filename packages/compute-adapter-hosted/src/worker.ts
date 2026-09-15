/**
 * `createComputeWorker` — the hosted compute WORKER application (W914 Wave 2):
 * the per-process composition that executes REAL render jobs.
 *
 * The worker owns:
 *
 * - the **honest descriptor**: `supportedRenderers` is derived from the REAL
 *   renderer registry's capabilities (nothing is advertised that is not
 *   resolvable), latency classes from the plugins' supported output
 *   profiles, concurrency/budgets from ./budgets.ts (the documented Vercel
 *   Hobby limits), and the cost units its metering reports;
 * - **job records**: one record per executed job (idempotent by `jobId` — a
 *   re-POST of an executed job returns the SAME envelope and counts a
 *   duplicate, so at-least-once transports stay safe), carrying the state,
 *   the result envelope, and the per-job metering counters;
 * - **metering counters** (whole-worker and per-job): jobs executed,
 *   duplicates, refusals, succeeded/failed, segments encoded/stored, bytes,
 *   total execution ms — the W919 raw material, in the descriptor's units.
 *
 * The worker never fabricates: unknown jobs answer `null`, refusals are
 * determinate, and every counter is incremented exactly where the event it
 * names happens. The clock is INJECTED (`nowMs`) — the transport
 * composition roots inject a real wall clock; tests inject counters.
 */
import { ComputeAdapterDescriptor } from "@sporta/compute-adapter";
import type {
  ComputeAdapterDescriptor as ComputeAdapterDescriptorDoc,
  ComputeDispatchRequest as ComputeDispatchRequestDoc,
} from "@sporta/compute-adapter";
import { RendererRegistry } from "@sporta/renderer-contract";
import type { RenderSegmentStore } from "@sporta/output-pipeline";
import { HostedJobExecution } from "./envelope";
import type { HostedJobExecution as HostedJobExecutionDoc } from "./envelope";
import { DEFAULT_HOSTED_COMPUTE_BUDGETS, resolveHostedComputeBudgets } from "./budgets";
import type { HostedComputeBudgets } from "./budgets";
import { executeRenderJob } from "./executor";

/** The adapter identity this worker reports (names logs and usage records). */
export const HOSTED_COMPUTE_ADAPTER_ID = "sporta.compute.hosted";

/** The provider identity this worker executes as (abstract, never a vendor). */
export const HOSTED_COMPUTE_PROVIDER_ID = "sporta-compute-worker-1";

/** The adapter version of this worker implementation. */
export const HOSTED_COMPUTE_ADAPTER_VERSION = "0.1.0";

/** The cost units this worker meters (the descriptor's currency). */
export const HOSTED_COMPUTE_COST_UNITS: ComputeAdapterDescriptorDoc["costUnits"] = [
  { unitId: "cpu-ms", unitKind: "time-ms", description: "measured render+encode execution time" },
  { unitId: "render-requests", unitKind: "count", description: "renderer plugin invocations" },
  { unitId: "artifact-bytes", unitKind: "bytes", description: "encoded artifact bytes stored" },
];

/** Options for {@link createComputeWorker}. */
export interface ComputeWorkerOptions {
  /** The renderer registry the REAL plugins resolve from (required). */
  rendererRegistry: RendererRegistry;
  /** The REAL W504 render-segment store encoded artifacts land in (required). */
  outputSegmentStore: RenderSegmentStore;
  /** The injected clock (epoch-ms readings; REQUIRED — this is a server package). */
  nowMs: () => number;
  /** Fail-closed budgets (default: the documented Vercel Hobby limits). */
  budgets?: Partial<HostedComputeBudgets>;
  /** Adapter identity (default `sporta.compute.hosted`). */
  adapterId?: string;
  /** Provider identity (default `sporta-compute-worker-1`). */
  providerId?: string;
}

/** One executed job's worker-side record. */
export interface ComputeWorkerJobRecord {
  jobId: string;
  sessionId: string;
  state: "executing" | "succeeded" | "failed";
  startedAtMs: number;
  finishedAtMs: number | undefined;
  /** The result envelope (present once execution finished). */
  result: HostedJobExecutionDoc | undefined;
  /** Per-job metering counters (present once execution finished). */
  metering: HostedJobExecutionDoc["metering"] | undefined;
  /** Counted duplicate executions of this job id (idempotent re-POSTs). */
  duplicateExecutions: number;
}

/** Whole-worker metering counters (never silent). */
export interface ComputeWorkerStats {
  jobsExecuted: number;
  duplicateExecutions: number;
  succeeded: number;
  failed: number;
  /** Determinate refusals (capacity) — counted, never executed. */
  capacityRefusals: number;
  segmentsEncoded: number;
  segmentsStored: number;
  bytesEncoded: number;
  totalExecutionMs: number;
}

/** The determinate disposition of one `execute` call. */
export type ComputeWorkerExecution =
  | { kind: "executed"; result: HostedJobExecutionDoc }
  | { kind: "duplicate"; result: HostedJobExecutionDoc; duplicateExecutions: number }
  | { kind: "refused"; reason: { errorClass: string; message: string; terminal: "resource-limit" } };

/** The hosted compute worker application. */
export class ComputeWorker {
  private readonly registry: RendererRegistry;
  private readonly store: RenderSegmentStore;
  private readonly nowMs: () => number;
  private readonly records = new Map<string, ComputeWorkerJobRecord>();
  private readonly statsState: ComputeWorkerStats = {
    jobsExecuted: 0,
    duplicateExecutions: 0,
    succeeded: 0,
    failed: 0,
    capacityRefusals: 0,
    segmentsEncoded: 0,
    segmentsStored: 0,
    bytesEncoded: 0,
    totalExecutionMs: 0,
  };
  private inFlight = 0;
  private descriptorCache: ComputeAdapterDescriptorDoc | undefined;
  readonly adapterId: string;
  readonly providerId: string;
  readonly budgets: HostedComputeBudgets;

  constructor(options: ComputeWorkerOptions) {
    this.registry = options.rendererRegistry;
    this.store = options.outputSegmentStore;
    this.nowMs = options.nowMs;
    this.budgets = resolveHostedComputeBudgets(options.budgets);
    this.adapterId = options.adapterId ?? HOSTED_COMPUTE_ADAPTER_ID;
    this.providerId = options.providerId ?? HOSTED_COMPUTE_PROVIDER_ID;
  }

  /** The honest capability descriptor, derived from the REAL registry. */
  describe(): ComputeAdapterDescriptorDoc {
    if (this.descriptorCache === undefined) {
      const renderers = this.registry.list();
      const supportedRenderers = renderers.map((capability) => ({
        rendererId: capability.rendererId,
        rendererVersions: [capability.rendererVersion],
      }));
      const latencyClasses = new Set<string>();
      for (const capability of renderers) {
        for (const profile of capability.supportedOutputProfiles) {
          latencyClasses.add(profile.latencyClass);
        }
      }
      const descriptor = {
        schemaVersion: "1.0" as const,
        adapterId: this.adapterId,
        adapterVersion: HOSTED_COMPUTE_ADAPTER_VERSION,
        providerKind: "cpu-worker" as const,
        supportedRenderers,
        supportedLatencyClasses:
          latencyClasses.size > 0 ? (Array.from(latencyClasses) as ("offline" | "near-live" | "live")[]) : (["offline"] as const),
        maxConcurrentJobs: this.budgets.maxConcurrentJobs,
        dispatchTimeoutMs: this.budgets.dispatchTimeoutMs,
        maxJobDeadlineMs: this.budgets.maxJobDeadlineMs,
        minJobDeadlineMs: this.budgets.minJobDeadlineMs,
        costUnits: HOSTED_COMPUTE_COST_UNITS,
      };
      const parsed = ComputeAdapterDescriptor.safeParse(descriptor);
      if (!parsed.success) {
        throw new Error(
          "hosted compute worker derived an invalid descriptor: " +
            parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        );
      }
      this.descriptorCache = parsed.data;
    }
    return structuredClone(this.descriptorCache);
  }

  /**
   * Executes one materialized dispatch request (idempotent by `jobId`).
   * Concurrency is bounded fail-closed: over-budget executions are refused
   * determinately, never queued silently.
   */
  async execute(request: ComputeDispatchRequestDoc): Promise<ComputeWorkerExecution> {
    const known = this.records.get(request.job.jobId);
    if (known !== undefined && known.result !== undefined) {
      known.duplicateExecutions += 1;
      this.statsState.duplicateExecutions += 1;
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
          message: `worker is executing ${this.inFlight} jobs (budget ${this.budgets.maxConcurrentJobs}) — retry later`,
          terminal: "resource-limit",
        },
      };
    }
    const startedAtMs = this.nowMs();
    const record: ComputeWorkerJobRecord = {
      jobId: request.job.jobId,
      sessionId: request.job.sessionId,
      state: "executing",
      startedAtMs,
      finishedAtMs: undefined,
      result: undefined,
      metering: undefined,
      duplicateExecutions: 0,
    };
    this.records.set(request.job.jobId, record);
    this.inFlight += 1;
    try {
      const result = await executeRenderJob(request, {
        rendererRegistry: this.registry,
        outputSegmentStore: this.store,
        nowMs: this.nowMs,
        budgets: this.budgets,
      });
      record.result = result;
      record.metering = result.metering;
      record.finishedAtMs = result.metering.finishedAtMs;
      record.state = result.status === "succeeded" ? "succeeded" : "failed";
      this.statsState.jobsExecuted += 1;
      this.statsState.totalExecutionMs += result.metering.executionMs;
      if (result.status === "succeeded") {
        this.statsState.succeeded += 1;
        this.statsState.segmentsEncoded += result.metering.segmentsEncoded;
        this.statsState.segmentsStored += result.metering.segmentsStored;
        this.statsState.bytesEncoded += result.metering.bytesEncoded;
      } else {
        this.statsState.failed += 1;
      }
      return { kind: "executed", result };
    } finally {
      this.inFlight -= 1;
    }
  }

  /** The worker-side record of one executed job (or `null` — never fabricated). */
  getJob(jobId: string): ComputeWorkerJobRecord | null {
    const record = this.records.get(jobId);
    return record === undefined ? null : structuredClone(record);
  }

  /** Whole-worker metering counters. */
  stats(): ComputeWorkerStats {
    return { ...this.statsState };
  }
}

/** Creates the hosted compute worker application. */
export function createComputeWorker(options: ComputeWorkerOptions): ComputeWorker {
  return new ComputeWorker(options);
}

export { DEFAULT_HOSTED_COMPUTE_BUDGETS };
