/**
 * Streaming stage contracts: messages, results, and backpressure policy.
 *
 * Each pipeline stage receives a message carrying session id, sequence
 * number/watermark, payload, schema version, correlation/trace ids, and
 * resource budget hints; it emits an explicit ok/failed/degraded status with
 * an updated watermark, latency, and retryability classification
 * (docs/contracts/streaming.md). Queues are bounded: silent unbounded
 * buffering is prohibited, so backpressure is an explicit policy choice.
 */
import { z } from "zod";
import { Watermark } from "./timestamps";
import { schemaVersionField } from "./versioning";

/** Resource budget hints for a stage invocation. */
export const ResourceBudget = z.object({
  maxMemoryMb: z.number().min(0).optional(),
  maxGpuMs: z.number().min(0).optional(),
});
export type ResourceBudget = z.infer<typeof ResourceBudget>;

/**
 * One message delivered to a processing stage. `sequence` is the stage-input
 * sequence; `watermark` is the canonical media-timeline position the payload
 * corresponds to. `correlationId` ties a message to its triggering request;
 * `traceId` spans the observable processing chain.
 */
export const StageMessage = z.object({
  sessionId: z.string().min(1),
  schemaVersion: schemaVersionField,
  sequence: z.number().int().min(0),
  watermark: Watermark,
  payload: z.unknown(),
  correlationId: z.string().min(1),
  traceId: z.string().min(1),
  resourceBudget: ResourceBudget.optional(),
});
export type StageMessage = z.infer<typeof StageMessage>;

/** Terminal status of a stage invocation. */
export const StageStatus = z.enum(["ok", "failed", "degraded"]);
export type StageStatus = z.infer<typeof StageStatus>;

/**
 * The result of a stage invocation: status, an optional output payload
 * reference, the watermark after processing, latency, an explicit
 * retryability classification (retries are allowed only where
 * deterministic/idempotent), and an error class on failure.
 */
export const StageResult = z.object({
  sessionId: z.string().min(1),
  stage: z.string().min(1),
  status: StageStatus,
  outputRef: z.string().min(1).optional(),
  watermarkAfter: Watermark,
  latencyMs: z.number(),
  retryable: z.boolean(),
  errorClass: z.string().min(1).optional(),
});
export type StageResult = z.infer<typeof StageResult>;

/**
 * The explicit policy applied when a bounded queue is full. Exactly one
 * policy applies at a time; silent unbounded buffering is never an option.
 *
 * - `wait`: block the producer until space is available.
 * - `drop-nonessential`: drop only non-essential intermediate frames.
 * - `reduce-quality`: reduce processing/rendering quality to keep up.
 * - `reduce-frequency`: process at a lower rate.
 * - `defer-to-batch`: switch to delayed/batch mode.
 */
export const BackpressurePolicy = z.enum([
  "wait",
  "drop-nonessential",
  "reduce-quality",
  "reduce-frequency",
  "defer-to-batch",
]);
export type BackpressurePolicy = z.infer<typeof BackpressurePolicy>;
