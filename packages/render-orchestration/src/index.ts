/**
 * @sporta/render-orchestration — streaming render orchestration (W304).
 *
 * THE M4 render stage (acceptance: "incremental SWM updates can drive
 * renderer work without unbounded backlog"): a deterministic, in-process,
 * vendor-neutral orchestrator that consumes a growing Sports World Model
 * INCREMENTALLY (W402 `stateAt`/`eventWindow`-style sequence-anchored
 * queries, never whole-history re-reads), cuts the updates into
 * watermark-aligned bounded batches, maps each batch to renderer work
 * through the W303 GPU-worker job protocol (idempotency keys derived from
 * batch watermarks — the same watermark never double-submits), executes
 * through the REAL W502 anime plugin (the provided
 * `createAnimeRenderBatchExecutor` — composable, workspace-only deps), and
 * emits rendered outputs in watermark order with per-output provenance.
 *
 * Unbounded backlog is prevented by FOUR bounded, loud mechanisms (the
 * acceptance core): the W104 `BoundedChannel` between consumption and
 * render work (block/reject/drop-oldest VERBATIM — counted, logged,
 * metered), the W303 dispatcher's typed `GpuResourceLimitError` capacity
 * refusals, the bounded reorder buffer (overflow counted
 * `reorder-overflow`, never a silent drop), and the EXPLICIT skip-stale
 * degradation policy (batches older than a configured watermark lag are
 * skipped with counted+logged+metered accounting, the original watermark
 * preserved — never re-stamped, never rendered as if fresh). The
 * burst test proves `peakBatchesInSystem` plateaus at the configured
 * bounds under a large burst with a slow renderer — never at stream length.
 *
 * The never-silent constitution (runtime-asserted at every settle — an
 * imbalance REJECTS the settle promise, never a lying result):
 * `batchesIn === batchesRendered + batchesSkippedStale + batchesDropped +
 * batchesCancelled + batchesDuplicateSkips (+ in-flight during a run, 0 at
 * settle)`, split into five exact sub-identities plus the cross-boundary
 * identity with the channel's own `dropped` counter. Recovery checkpoints
 * are cut at watermark boundaries ANCHORED AT THE CROSSING BATCH (a replay
 * re-cuts the same batches with the same idempotency keys); `resume()`
 * skips or reprocesses with counted duplicates; `stop()`/`shutdown()`
 * drain or cancel with every batch, job, and output landing in exactly ONE
 * terminal bucket.
 *
 * Module map:
 *
 * - `types`: the `SwmUpdateStore`/`SwmUpdate` consumption seam, the
 *   `RenderBatch` unit, the degradation policy, ledger/checkpoint/stats
 *   documents, the balance assertions, options, and the metric vocabulary;
 * - `batch`: the pure batch arithmetic (cut, idempotency/job ids, the
 *   watermark grid, `postCutGrid` — the checkpoint's resume anchors);
 * - `policy`: the pure skip-stale decision (measured lag + head evidence);
 * - `errors`: typed boundary errors carrying the contracts
 *   `terminalFailureClass`;
 * - `registry`: the payload-resolution table behind the W303 `payloadRef`
 *   seam + the in-queue FIFO ledger attributing channel evictions to
 *   specific batches;
 * - `checkpoint`: the watermark-boundary checkpoint tracker (anchored cuts)
 *   + fail-loud checkpoint validation;
 * - `executor`: the provided executor (one REAL W502 anime render per
 *   batch, deterministic clock-consumed duration, refusal mapping) + the
 *   structural validation of every executor output;
 * - `orchestrator`: `RenderOrchestrator` — the consumer/scheduler pumps,
 *   the serialized in-order emitter, checkpointing, resume, stop modes.
 *
 * Constitution: ZERO wall-clock reads (the only clock is the injected W303
 * `GpuClock`, shared by every component), zero `Math.random`, zero external
 * runtime dependencies (workspace `@sporta/*` only — `bun.lock` carries
 * nothing but the workspace registration). Rendering is IN-PROCESS and
 * vendor-neutral: no GPU, no network, no real timers — the W303 worker
 * protocol and the W104 channel semantics are the real seams a deployment
 * wires.
 *
 * Honest limitations (documented in README.md, repeated for the record):
 * recovery is in-process (the W303 dispatcher's in-memory ledger IS the
 * idempotency registry — a process crash loses it, and a fresh-process
 * replay re-renders at-least-once); checkpoint `processedKeys` lists are
 * in-memory and cumulative (a real deployment externalizes them behind a
 * storage seam); a store that never completes and never announces growth
 * settles the run honestly as `stopped` (never a fake `completed`); the
 * reorder bound drops the INCOMING output at overflow (never a
 * closer-to-head one) — documented and counted.
 */
export type {
  BatchClosedBy,
  BatchDropReason,
  DegradationPolicy,
  RenderBatch,
  RenderBatchExecutor,
  RenderBatchLedgerEntry,
  RenderBatchOutcome,
  RenderCheckpoint,
  RenderExecutorContext,
  RenderOrchestrationLimits,
  RenderOrchestrationObservability,
  RenderOrchestrationOptions,
  RenderOrchestrationResult,
  RenderOrchestrationStats,
  RenderOutputRecord,
  RenderResumeOptions,
  RenderStopMode,
  RenderWorkerSpec,
  SkipStalePolicy,
  StaleDecision,
  SwmUpdate,
  SwmUpdateStore,
} from "./types";
export {
  DEFAULT_RENDER_LIMITS,
  RENDER_METRIC_NAMES,
  assertRenderAccounting,
  emptyStats,
} from "./types";
export {
  InvalidRenderCheckpointError,
  InvalidRenderSetupError,
  InvalidOrchestratorPhaseError,
  InvalidOrchestratorStateError,
  RenderOutputInvalidError,
  isRenderOrchestrationError,
} from "./errors";
export type { RenderOrchestrationError, RenderOrchestrationErrorDetails } from "./errors";
export { BatchRegistry } from "./registry";
export { RenderCheckpointTracker, validateRenderCheckpoint } from "./checkpoint";
export {
  boundaryAt,
  cutBatch,
  idempotencyKeyOf,
  jobIdOf,
  nextBoundary,
  postCutGrid,
} from "./batch";
export { evaluateStaleSkip } from "./policy";
export {
  assertAnimeRenderOutputShape,
  createAnimeRenderBatchExecutor,
  type AnimeRenderExecutorOptions,
} from "./executor";
export { RenderOrchestrator, type RenderOrchestratorPhase } from "./orchestrator";
