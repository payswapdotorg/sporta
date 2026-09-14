/**
 * Typed processing-queues errors (W302), in the W101/W102/W301 style: every
 * classified refusal carries a `terminalFailureClass` value from the
 * `@sporta/contracts` enum (so the W004 `ProcessingStateService` /
 * `SessionLifecycle.fail` can record it), a `failureClass` alias, and a
 * structured, JSON-safe `details` object for logs and metric labels.
 */

/** Structured, JSON-safe details carried on every processing-queues error. */
export type ProcessingQueuesErrorDetails = Record<string, unknown>;

/**
 * A submitted segment (or a stage transform's returned segment) does not
 * satisfy the `PipelineSegment` invariants. Classified `media-invalid`:
 * the refusal is counted, logged, metered, and recorded in the rejection
 * ledger — the pipeline CONTINUES with the next segment (one corrupt
 * segment never kills a live match, the W301 posture).
 */
export class MalformedSegmentError extends Error {
  readonly terminalFailureClass: "media-invalid";
  /** Alias of {@link MalformedSegmentError.terminalFailureClass}. */
  readonly failureClass: "media-invalid";
  readonly details: ProcessingQueuesErrorDetails;

  constructor(message: string, details: ProcessingQueuesErrorDetails = {}) {
    super(message);
    this.name = "MalformedSegmentError";
    this.terminalFailureClass = "media-invalid";
    this.failureClass = "media-invalid";
    this.details = details;
  }
}

/**
 * The pipeline API was misused (submit/stop/done before `start()`, submit
 * after the pipeline ended, …). This is a CALLER error, not a pipeline
 * terminal failure: it carries no `terminalFailureClass` because no media
 * was in a failure state — nothing was accounted.
 */
export class InvalidPipelineStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPipelineStateError";
  }
}

/**
 * A checkpoint handed to `resumePipeline` (or read back from a pipeline)
 * does not satisfy the checkpoint invariants. Classified `media-invalid`
 * (the checkpoint is persisted recovery state, i.e. data — a corrupt one is
 * refused loudly, never silently replayed from).
 */
export class InvalidCheckpointError extends Error {
  readonly terminalFailureClass: "media-invalid";
  /** Alias of {@link InvalidCheckpointError.terminalFailureClass}. */
  readonly failureClass: "media-invalid";
  readonly details: ProcessingQueuesErrorDetails;

  constructor(message: string, details: ProcessingQueuesErrorDetails = {}) {
    super(message);
    this.name = "InvalidCheckpointError";
    this.terminalFailureClass = "media-invalid";
    this.failureClass = "media-invalid";
    this.details = details;
  }
}

/** Union of the classified processing-queues errors. */
export type ProcessingQueuesError = MalformedSegmentError | InvalidCheckpointError;

/**
 * Type guard: `true` when `value` is one of the classified
 * processing-queues errors (a deliberate boundary refusal rather than an
 * internal fault).
 */
export function isProcessingQueuesError(value: unknown): value is ProcessingQueuesError {
  return value instanceof MalformedSegmentError || value instanceof InvalidCheckpointError;
}
