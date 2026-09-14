/**
 * `resumePipeline` (W302) — recovery from a watermark-boundary checkpoint.
 *
 * The streaming contract's Recovery rule: "Processing stages support retries
 * where deterministic/idempotent. Stateful stages checkpoint enough
 * information to resume from a safe watermark. Duplicate messages are
 * tolerated through idempotency keys."
 *
 * Resume semantics (all exact, all counted):
 *
 * - `skip` (default): every idempotency key in the checkpoint's
 *   `processedKeys` was terminally disposed before the cut — re-submitting
 *   the segment list counts each as a DUPLICATE (never silent, never
 *   re-processed). Keys NOT in the checkpoint (in-flight at cut time, or
 *   submitted after it) are processed fresh: at-least-once recovery, with
 *   downstream dedupe on the key;
 * - `reprocess: true`: the checkpoint's skip function is deliberately
 *   disabled — the FULL segment list is processed again (e.g. replaying
 *   after a stage bug fix). The checkpoint is still validated and reported;
 *   nothing is counted as a duplicate by the skip rule.
 *
 * The run is self-contained: the segments are submitted in order, the
 * output queue is drained concurrently (a block-policy pipeline would
 * otherwise park once its queues fill), the pipeline is stopped with an
 * orderly drain (in-flight stage work COMPLETES), and the settled result,
 * emitted messages, dead letters, submit outcomes, and checkpoints are
 * returned. The accounting balance is runtime-asserted before the result
 * settles (an imbalance rejects — never a lying result).
 */
import type { StageMessage } from "@sporta/contracts";
import type { ProcessingPipelineOptions } from "./types";
import type { DeadLetterEntry, PipelineCheckpoint, PipelineResult } from "./types";
import { ProcessingPipeline } from "./pipeline";
import type { StopMode } from "./pipeline";
import { validateCheckpoint } from "./checkpoint";

/** Options for {@link resumePipeline}. */
export interface ResumePipelineOptions {
  /** The media session id for the resumed run (default: `resumed-<checkpoint index>`). */
  sessionId?: string;
  /**
   * `false` (default): checkpoint-known keys are skipped as counted
   * duplicates. `true`: process the full list again (checkpoint validation
   * and reporting still apply).
   */
  reprocess?: boolean;
  /**
   * How to stop the resumed pipeline (default `drain`: in-flight stage work
   * completes). `cancel` is available for crash-replay tests.
   */
  stopMode?: StopMode;
}

/** The collected evidence of one resumed run. */
export interface ResumeOutcome {
  /** The settled pipeline result (balances runtime-asserted). */
  result: PipelineResult;
  /** Emitted stage messages in output order (the consumer's full take). */
  emitted: StageMessage[];
  /** Retained dead-letter entries in occurrence order. */
  deadLetters: DeadLetterEntry[];
  /** Per-segment submit outcomes, in submission order. */
  submitOutcomes: Awaited<ReturnType<ProcessingPipeline["submit"]>>[];
  /** Checkpoints cut during the resumed run. */
  checkpoints: PipelineCheckpoint[];
}

/**
 * Replays `segments` through a fresh pipeline wired from the same stages /
 * queues / clock, resuming from `checkpoint`:
 *
 * - the checkpoint is validated fail-loud (`InvalidCheckpointError` on
 *   corrupt recovery state);
 * - under `skip` (default) the checkpoint's terminally-disposed keys are
 *   preloaded into the idempotency registry, so their re-submission counts
 *   as duplicates — skipped, never silent;
 * - the segment list is submitted in order while the output queue is
 *   drained concurrently;
 * - the pipeline stops with an orderly drain and settles with the balance
 *   asserted.
 */
export async function resumePipeline(
  checkpoint: PipelineCheckpoint,
  segments: readonly import("./segment").PipelineSegment[],
  wiring: Omit<ProcessingPipelineOptions, "sessionId" | "preloadedDispositions">,
  options: ResumePipelineOptions = {},
): Promise<ResumeOutcome> {
  validateCheckpoint(checkpoint);
  const reprocess = options.reprocess ?? false;
  const sessionId = options.sessionId ?? `resumed-${checkpoint.index}`;

  const pipeline = new ProcessingPipeline({
    ...wiring,
    sessionId,
    ...(reprocess
      ? {}
      : {
          preloadedDispositions: checkpoint.processedKeys.map((entry) => ({
            key: entry.key,
            disposition: entry.disposition,
          })),
        }),
  });
  pipeline.start();

  const submitOutcomes: Awaited<ReturnType<ProcessingPipeline["submit"]>>[] = [];
  const emitted: StageMessage[] = [];
  const consumer = (async () => {
    const channel = pipeline.outputChannel();
    for (;;) {
      try {
        emitted.push(await channel.receive());
      } catch {
        return; // ChannelClosedError: closed and drained
      }
    }
  })();

  for (const segment of segments) {
    submitOutcomes.push(await pipeline.submit(segment));
  }

  const result = await pipeline.stop({ mode: options.stopMode ?? "drain" });
  await consumer;

  return {
    result,
    emitted,
    deadLetters: pipeline.deadLetters(),
    submitOutcomes,
    checkpoints: pipeline.checkpoints(),
  };
}
