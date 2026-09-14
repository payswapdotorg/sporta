/**
 * @sporta/processing-queues — bounded multi-stage processing queues (W302).
 *
 * The processing spine of the streaming pipeline (architecture-lock §8
 * bounded buffers / asynchronous workers / explicit backpressure, §13
 * bounded resources): N stages, N+1 bounded queues carrying
 * W104 `BoundedChannel` semantics VERBATIM (`block` parks the producer —
 * backpressure propagates upstream channel-by-channel; `reject` refuses
 * with a typed `ResourceLimitError`, counted + logged + metered, the stream
 * continues; `drop-oldest` evicts with channel-owned count/log/metric —
 * never silent), queue limits on BOTH count and bytes (segments carry their
 * byte size), deterministic injectable-clock retries with the W104
 * non-retryable-never-blind-retried rule, a bounded DLQ for terminal
 * failures, idempotent cancellation with drain-or-abandon accounting,
 * watermark-boundary checkpoints with idempotency-key resume, and exact
 * stats reconciliation — the accounting balance
 * `segmentsIn === segmentsOut + rejected + duplicates + deadLettered +
 * abandoned + dropped` is runtime-asserted before every settle; an
 * imbalance rejects the done() promise instead of returning a lying result.
 *
 * Module map:
 *
 * - `clock`: the `ProcessingClock` seam + `VirtualProcessingClock`
 *   (deterministic virtual processing time — retry backoff, latency, DLQ
 *   and checkpoint timestamps all read it; never a wall clock);
 * - `segment`: the `PipelineSegment` (idempotency key, VERBATIM watermark,
 *   declared byte size, domain payload) + fail-loud validation;
 * - `types`: stage/queue specs, submit outcomes, stats, dead-letter
 *   entries, checkpoints, results, options, the metric vocabulary, and the
 *   balance assertions + stage-flow reconciliation;
 * - `errors`: typed errors carrying the contracts `terminalFailureClass`
 *   (`media-invalid`) plus the caller-misuse error;
 * - `registry`: the terminal-disposition registry (the idempotency-key
 *   record behind duplicate counting and resume);
 * - `dlq`: the BOUNDED dead-letter queue (overflow counted + logged +
 *   metered, never silent);
 * - `checkpoint`: watermark-boundary checkpoint cutting + fail-loud
 *   checkpoint validation;
 * - `pipeline`: `ProcessingPipeline` — the multi-stage engine;
 * - `resume`: `resumePipeline` — checkpoint recovery with counted
 *   duplicates (or explicit reprocess).
 *
 * Honest limitations (documented in the module docs, repeated here for the
 * record): checkpoint `processedKeys` lists are in-memory and cumulative
 * (O(keys) per checkpoint — a real deployment compacts/externalizes behind
 * a storage seam); drain-mode `stop()` requires the consumer to keep
 * receiving the output queue (a block-policy pipeline with a stopped
 * consumer parks its final sends — the W104 StageRunner behavior); a stage
 * transform that never settles cannot be killed (documented; the tests use
 * settling transforms); in-flight duplicate re-submissions (same key,
 * concurrently) are processed independently — dedupe is at TERMINAL
 * granularity, at-least-once in flight.
 */
export type { ProcessingClock } from "./clock";
export { VirtualProcessingClock } from "./clock";
export type { PipelineSegment } from "./segment";
export { validatePipelineSegment } from "./segment";
export type {
  DeadLetterEntry,
  OutputChannel,
  PipelineCheckpoint,
  PipelineOutcome,
  PipelineRejectionRecord,
  PipelineResult,
  PipelineStats,
  PipelineStageSpec,
  ProcessingLimits,
  ProcessingObservability,
  ProcessingPipelineOptions,
  StageOutcome,
  StageQueueSpec,
  StageStats,
  SubmitOutcome,
  SubmitRejectionDetails,
} from "./types";
export {
  DEFAULT_PROCESSING_LIMITS,
  PROCESSING_METRIC_NAMES,
  assertAccountingBalance,
  emptyStageStats,
  emptyStats,
  reconcileStageFlows,
} from "./types";
export {
  InvalidCheckpointError,
  InvalidPipelineStateError,
  MalformedSegmentError,
  isProcessingQueuesError,
} from "./errors";
export type { ProcessingQueuesError, ProcessingQueuesErrorDetails } from "./errors";
export type { TerminalDisposition, TerminalRecord } from "./registry";
export { TerminalDispositionRegistry } from "./registry";
export { DeadLetterQueue } from "./dlq";
export { CheckpointTracker, validateCheckpoint } from "./checkpoint";
export {
  ProcessingPipeline,
  type PipelinePhase,
  type StopMode,
  type SubmitOptions,
} from "./pipeline";
export { resumePipeline, type ResumeOutcome, type ResumePipelineOptions } from "./resume";
