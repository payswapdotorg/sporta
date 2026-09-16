/**
 * The hosted worker's RESULT ENVELOPE (W914 Wave 2): what one executed job
 * hands back — the wire shape of `POST /v1/jobs/execute` and the value the
 * `HostedComputeAdapter` consumes from an in-process or HTTP provider.
 *
 * This is the hosted package's own schema layer (zod, strict): it composes
 * the `@sporta/compute-adapter` contract types (`ComputeOutputArtifact`,
 * `ComputeTerminalClass`) with the worker-measured metering counters and —
 * on success — the contracts `RenderResult` document (opaque here; the
 * control plane re-validates it against `@sporta/contracts` at ingestion).
 *
 * Failure classification honesty: every failure carries the terminal class
 * in the W303 vocabulary (`non-retryable` | `timeout` | `internal`) plus an
 * `errorClass` string and `retryable` (the `ComputeProviderOutcome` shape).
 * This wave every executor failure is DETERMINATE and non-retryable — the
 * hosted worker executes one job once (idempotent by jobId); transport-level
 * retries/lease recovery are the later W913/W303-queue wave, honestly not
 * built here.
 */
import { z } from "zod";
import { ComputeOutputArtifact } from "@sporta/compute-adapter";

/** Non-empty string helper. */
const nonEmpty = z.string().min(1);

/** The worker-measured failure of one executed job. */
export const HostedJobFailure = z
  .object({
    /** Machine-readable failure class (e.g. "render-refused", "budget-exceeded"). */
    errorClass: nonEmpty,
    /** Human-readable failure message. */
    message: nonEmpty,
    /** The terminal classification (W303 `GpuTerminalClass`, minus retry-exhausted). */
    terminal: z.enum(["non-retryable", "timeout", "internal"]),
    /** Whether a retry could succeed (always false this wave — determinate failures). */
    retryable: z.boolean(),
  })
  .strict();
export type HostedJobFailure = z.infer<typeof HostedJobFailure>;

/** The worker's per-job metering counters (the "metered" of the acceptance). */
export const HostedJobMetering = z
  .object({
    /** Protocol-clock reading when execution started (injected clock). */
    startedAtMs: z.number().finite(),
    /** Protocol-clock reading when execution finished (injected clock). */
    finishedAtMs: z.number().finite(),
    /** Measured execution duration in ms (finishedAtMs - startedAtMs). */
    executionMs: z.number().finite().min(0),
    /** Frames rendered by the real renderer plugin. */
    framesRendered: z.number().int().min(0),
    /** Segments encoded through the W504 encoder. */
    segmentsEncoded: z.number().int().min(0),
    /** Segments stored through the W504 render-segment store. */
    segmentsStored: z.number().int().min(0),
    /** Sum of encoded segment byte lengths. */
    bytesEncoded: z.number().int().min(0),
    /** Counted duplicate store operations (idempotent re-stores). */
    duplicateStores: z.number().int().min(0),
  })
  .strict();
export type HostedJobMetering = z.infer<typeof HostedJobMetering>;

/**
 * The result envelope of one executed job: success carries the artifacts
 * (content-addressed, W504-aligned — inline delivery mode this wave) plus
 * the contracts `RenderResult` document (opaque JSON here); failure carries
 * the classified failure. Both carry the consumed-input accounting seed and
 * the worker's metering counters.
 */
export const HostedJobExecution = z
  .object({
    /** The job this envelope answers (echoed identity). */
    jobId: nonEmpty,
    /** The submitter-facing execution status. */
    status: z.enum(["succeeded", "failed"]),
    /** Output artifacts (non-empty only when succeeded). */
    outputs: z.array(ComputeOutputArtifact),
    /** Manifest inputs the execution consumed. */
    consumedInputIds: z.array(nonEmpty),
    /** Present iff status === "failed". */
    failure: HostedJobFailure.optional(),
    /**
     * The contracts `RenderResult` document, verbatim from the REAL
     * renderer plugin (opaque here; the control plane validates it against
     * `@sporta/contracts` at ingestion).
     */
    renderResult: z.unknown().optional(),
    /** The worker's metering counters for this job. */
    metering: HostedJobMetering,
  })
  .strict()
  .superRefine((envelope, ctx) => {
    if (envelope.status === "failed" && envelope.failure === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["failure"],
        message: 'status "failed" requires failure details',
      });
    }
    if (envelope.status !== "failed" && envelope.failure !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["failure"],
        message: `failure details are only legal when status is "failed" (got "${envelope.status}")`,
      });
    }
    if (envelope.status === "succeeded" && envelope.outputs.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["outputs"],
        message:
          "a succeeded render job must carry at least one output artifact (renderer without W504 encoding is not dispatchable to this worker)",
      });
    }
  });
export type HostedJobExecution = z.infer<typeof HostedJobExecution>;
