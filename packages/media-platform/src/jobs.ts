/**
 * THE MEDIA JOB SERVICE (R103) — the real lifecycle of one media-processing
 * job (upload-admitted → normalization → original-artifact), over the W914
 * compute/job state vocabulary VERBATIM:
 *
 * `admitted / dispatched / queued / in-flight / succeeded / failed /
 * cancelled / dead-lettered`
 *
 * ## Honesty rules (the packet's, encoded)
 *
 * - every state change is asserted against the W914 transition table
 *   (`assertComputeTransition` — reused, not mirrored), so an illegal
 *   transition can never be recorded silently;
 * - NO FAKE PROGRESS: progress is a STEP FUNCTION tied to ACTUAL stage
 *   completions — `upload-complete` (1/3) is only claimable after the
 *   source asset is durably `stored`; `normalization-complete` (2/3) only
 *   after the normalized manifest is durably recorded;
   `artifact-stored` (1/1) only after the artifact manifest is durably
 *   recorded and byte-verified;
 * - jobs are DURABLE (SQLite through the repository port): a restart reads
 *   the last durable state and NEVER invents a completion. The optional
 *   `failInterruptedJobs` reconciliation moves live-state jobs to a typed
 *   `failed(internal, "interrupted-by-restart")` — an explicit operator
 *   decision, never a silent rewrite (the default is `preserve`: show the
 *   last durable state exactly as it was);
 * - every terminal job carries its measured stage timings and, on failure,
 *   the typed failure class (`media-invalid` / `resource-limit` /
 *   `rights-denied` / `internal`).
 */
import { z } from "zod";
import { schemaVersionField } from "@sporta/contracts";
import { assertComputeTransition, type ComputeJobState } from "@sporta/compute-adapter";
import type { MediaJobRepository } from "./repositories";

/** The closed job-state vocabulary (VERBATIM the W914 `ComputeJobState`). */
export type MediaJobState =
  | "admitted"
  | "dispatched"
  | "queued"
  | "in-flight"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "dead-lettered";

/** The pipeline's honest stage labels (progress is stage-tied, never fake). */
export const MEDIA_JOB_STAGES = [
  "upload-complete",
  "normalization-complete",
  "artifact-stored",
] as const;
export type MediaJobStage = (typeof MEDIA_JOB_STAGES)[number];

/** The stage-completion fraction each actual stage earns (1/3, 2/3, 1). */
export const STAGE_FRACTIONS: Readonly<Record<MediaJobStage, number>> = Object.freeze({
  "upload-complete": 1 / 3,
  "normalization-complete": 2 / 3,
  "artifact-stored": 1,
});

/** One stage-completion event on a job's trail (JSON-safe, bounded). */
export interface MediaJobStageEvent {
  /** Which actual stage completed. */
  stage: MediaJobStage | "created" | "terminal";
  /** The injected clock reading (ms). */
  atMs: number;
  /** The honest fraction AFTER this stage (0 for created; see table). */
  fraction: number;
}

/** The typed failure vocabulary a terminal job records (contracts-aligned). */
export const MEDIA_JOB_FAILURE_CLASSES = [
  "media-invalid",
  "resource-limit",
  "rights-denied",
  "internal",
] as const;
export type MediaJobFailureClass = (typeof MEDIA_JOB_FAILURE_CLASSES)[number];

/** The durable media-job record (the R103 ledger row). */
export const MediaJobRecordSchema = z.object({
  schemaVersion: schemaVersionField,
  jobId: z.string().min(1),
  /** The source asset this job processes. */
  sourceAssetId: z.string().min(1),
  /** The session the artifact will belong to. */
  sessionId: z.string().min(1),
  /** The W914 lifecycle state (VERBATIM vocabulary). */
  state: z.enum([
    "admitted",
    "dispatched",
    "queued",
    "in-flight",
    "succeeded",
    "failed",
    "cancelled",
    "dead-lettered",
  ]),
  /** The stage-completion trail (progress is tied to these, never fake). */
  stages: z.array(
    z.object({
      stage: z.enum([
        "created",
        "upload-complete",
        "normalization-complete",
        "artifact-stored",
        "terminal",
      ]),
      atMs: z.number().int().min(0),
      fraction: z.number().min(0).max(1),
    }),
  ),
  /** Present iff state === "failed". */
  failure: z
    .object({
      failureClass: z.enum(MEDIA_JOB_FAILURE_CLASSES),
      message: z.string().min(1),
    })
    .optional(),
  /** Present iff state === "succeeded": the produced records' ids. */
  result: z
    .object({
      manifestId: z.string().min(1),
      artifactId: z.string().min(1),
    })
    .optional(),
  createdAtMs: z.number().int().min(0),
  updatedAtMs: z.number().int().min(0),
});
export type MediaJobRecord = z.infer<typeof MediaJobRecordSchema>;

/** The JSON-safe job view the polling route serves. */
export interface MediaJobView {
  jobId: string;
  sourceAssetId: string;
  sessionId: string;
  state: ComputeJobState;
  /** Whether the state is terminal (the W914 vocabulary's own notion). */
  terminal: boolean;
  /** The honest fraction (stage-tied; 0 before the first stage completes). */
  progress: number;
  stages: MediaJobStageEvent[];
  failure?: { failureClass: MediaJobFailureClass; message: string };
  result?: { manifestId: string; artifactId: string };
  createdAtMs: number;
  updatedAtMs: number;
}

/** Restart-reconciliation policy (an explicit operator decision). */
export type RestartPolicy = "preserve" | "fail-interrupted";

/** Options for {@link MediaJobService}. */
export interface MediaJobServiceOptions {
  /** The durable job ledger (required). */
  repository: MediaJobRepository;
  /** The injected clock (ms) — the service reads NO time source of its own. */
  nowMs: () => number;
  /**
   * What a construction-time restart does to live-state jobs (default
   * `preserve`: the ledger answers the LAST DURABLE STATE, never an
   * invented completion). `fail-interrupted` is the explicit operator
   * reconciliation: in-flight work whose executor is gone resolves a typed
   * `failed(internal, "interrupted-by-restart")` — still never a success.
   */
  onRestart?: RestartPolicy;
}

/**
 * The media job service: creates jobs (`admitted`), walks them through the
 * W914 lifecycle with stage-tied progress, and answers honest poll views.
 * Execution itself is driven by the pipeline service (the caller of the
 * stage-advance methods); this service owns ONLY the ledger's integrity.
 */
export class MediaJobService {
  private readonly repository: MediaJobRepository;
  private readonly nowMs: () => number;

  constructor(options: MediaJobServiceOptions) {
    this.repository = options.repository;
    this.nowMs = options.nowMs;
    if (options.onRestart === "fail-interrupted") {
      this.failInterruptedJobs();
    }
  }

  /**
   * The explicit restart reconciliation: every live-state job (its executor
   * died with the previous process) resolves a typed `failed` — class
   * `internal`, message naming the restart. Never a success, never silent.
   */
  private failInterruptedJobs(): void {
    for (const job of this.repository.listLive()) {
      const now = this.nowMs();
      assertComputeTransition(job.state, "failed");
      this.repository.update({
        ...job,
        state: "failed",
        failure: {
          failureClass: "internal",
          message: "interrupted-by-restart: the executing process ended before completion",
        },
        stages: [
          ...job.stages,
          { stage: "terminal", atMs: now, fraction: job.stages.at(-1)?.fraction ?? 0 },
        ],
        updatedAtMs: now,
      });
    }
  }

  /** Creates one job in `admitted` (the upload already completed durably). */
  createJob(input: { jobId: string; sourceAssetId: string; sessionId: string }): MediaJobRecord {
    const now = this.nowMs();
    return this.repository.create({
      schemaVersion: "1.1",
      jobId: input.jobId,
      sourceAssetId: input.sourceAssetId,
      sessionId: input.sessionId,
      state: "admitted",
      stages: [{ stage: "created", atMs: now, fraction: 0 }],
      createdAtMs: now,
      updatedAtMs: now,
    });
  }

  /** The stored record, or `null`. */
  get(jobId: string): MediaJobRecord | null {
    return this.repository.get(jobId);
  }

  /** Every job for one source asset, oldest first (the ledger's own order). */
  listBySourceAsset(sourceAssetId: string): MediaJobRecord[] {
    return this.repository.listBySourceAsset(sourceAssetId);
  }

  /** The honest poll view (never invents state; `null` for an unknown job). */
  view(jobId: string): MediaJobView | null {
    const job = this.repository.get(jobId);
    if (job === null) return null;
    const terminal =
      job.state === "succeeded" ||
      job.state === "failed" ||
      job.state === "cancelled" ||
      job.state === "dead-lettered";
    return {
      jobId: job.jobId,
      sourceAssetId: job.sourceAssetId,
      sessionId: job.sessionId,
      state: job.state,
      terminal,
      progress: job.stages.at(-1)?.fraction ?? 0,
      stages: job.stages,
      ...(job.failure !== undefined ? { failure: job.failure } : {}),
      ...(job.result !== undefined ? { result: job.result } : {}),
      createdAtMs: job.createdAtMs,
      updatedAtMs: job.updatedAtMs,
    };
  }

  /**
   * Applies one lifecycle transition (asserted against the W914 table)
   * and optionally records one stage completion. The caller names the
   * stage; the FRACTION is derived from the stage table (never
   * caller-claimed) so a progress number can never outrun the actual
   * pipeline.
   */
  advance(jobId: string, to: ComputeJobState, stage?: MediaJobStage): MediaJobRecord {
    const job = this.require(jobId);
    assertComputeTransition(job.state, to);
    const now = this.nowMs();
    return this.repository.update({
      ...job,
      state: to,
      ...(stage !== undefined
        ? { stages: [...job.stages, { stage, atMs: now, fraction: STAGE_FRACTIONS[stage] }] }
        : {}),
      updatedAtMs: now,
    });
  }

  /**
   * Records one stage completion WITHOUT a lifecycle transition (the
   * pipeline stays `in-flight` while stages land). Same fraction-derivation
   * rule: the number comes from the stage table, never the caller.
   */
  noteStage(jobId: string, stage: MediaJobStage): MediaJobRecord {
    const job = this.require(jobId);
    const now = this.nowMs();
    return this.repository.update({
      ...job,
      stages: [...job.stages, { stage, atMs: now, fraction: STAGE_FRACTIONS[stage] }],
      updatedAtMs: now,
    });
  }

  /**
   * Records the terminal `succeeded` disposition with the produced record
   * ids (legal from `in-flight` only — the pipeline's terminal edge).
   */
  succeed(jobId: string, result: { manifestId: string; artifactId: string }): MediaJobRecord {
    const job = this.require(jobId);
    assertComputeTransition(job.state, "succeeded");
    const now = this.nowMs();
    return this.repository.update({
      ...job,
      state: "succeeded",
      result,
      stages: [...job.stages, { stage: "terminal", atMs: now, fraction: 1 }],
      updatedAtMs: now,
    });
  }

  /**
   * Records the terminal `failed` disposition with the typed failure class.
   * Legal from `dispatched`/`queued`/`in-flight`.
   */
  fail(
    jobId: string,
    failure: { failureClass: MediaJobFailureClass; message: string },
  ): MediaJobRecord {
    const job = this.require(jobId);
    assertComputeTransition(job.state, "failed");
    const now = this.nowMs();
    return this.repository.update({
      ...job,
      state: "failed",
      failure,
      stages: [
        ...job.stages,
        { stage: "terminal", atMs: now, fraction: job.stages.at(-1)?.fraction ?? 0 },
      ],
      updatedAtMs: now,
    });
  }

  /**
   * Cancels one job (idempotent per the W914 posture): live ⇒ `cancelled`;
   * terminal ⇒ a counted no-op returning the stored record unchanged.
   */
  cancel(jobId: string): MediaJobRecord {
    const job = this.require(jobId);
    const terminal =
      job.state === "succeeded" ||
      job.state === "failed" ||
      job.state === "cancelled" ||
      job.state === "dead-lettered";
    if (terminal) return job;
    const now = this.nowMs();
    assertComputeTransition(job.state, "cancelled");
    return this.repository.update({
      ...job,
      state: "cancelled",
      stages: [
        ...job.stages,
        { stage: "terminal", atMs: now, fraction: job.stages.at(-1)?.fraction ?? 0 },
      ],
      updatedAtMs: now,
    });
  }

  /** Fail-loud record access (an unknown job is a typed 404 at routes). */
  private require(jobId: string): MediaJobRecord {
    const job = this.repository.get(jobId);
    if (job === null) {
      throw new RangeError(`media job '${jobId}' was not found`);
    }
    return job;
  }
}
