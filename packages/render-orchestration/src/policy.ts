/**
 * The degradation policy evaluator (W304) — pure decisions, no state.
 *
 * THE UNBOUNDED-BACKLOG RULE (docs/contracts/streaming.md backpressure +
 * architecture-lock §8): when rendering falls behind, the system must have an
 * EXPLICIT policy. This module is the skip-stale decision:
 *
 * - a batch is STALE when the stream head is more than
 *   `maxWatermarkLagMs` ahead of the batch's own watermark — rendering it
 *   would grow the backlog, so it is SKIPPED: counted, logged, metered,
 *   ledgered, with the batch's ORIGINAL watermark preserved (never
 *   re-stamped, never silently dropped, never rendered as if fresh);
 * - the decision is evaluated at ADMISSION (before the bounded queue — the
 *   consumer refuses to enqueue work that is already too old) and again at
 *   DEQUEUE (a batch can go stale while it sat in the queue behind a slow
 *   renderer);
 * - the measured lag and the head watermark at decision time travel WITH the
 *   decision (evidence, not just a boolean).
 */
import type { DegradationPolicy, StaleDecision } from "./types";
import type { Watermark } from "@sporta/contracts";

/**
 * Evaluates the skip-stale decision for one batch watermark against the
 * current stream head. Pure: the same (policy, batch watermark, head) triple
 * always yields the same decision.
 */
export function evaluateStaleSkip(
  policy: DegradationPolicy,
  batchWatermarkMs: number,
  head: Watermark,
): StaleDecision {
  const lagMs = head.watermarkMs - batchWatermarkMs;
  if (policy.skipStale === "disabled") {
    return {
      stale: false,
      lagMs,
      head: { watermarkMs: head.watermarkMs, sequence: head.sequence },
    };
  }
  return {
    stale: lagMs > policy.skipStale.maxWatermarkLagMs,
    lagMs,
    head: { watermarkMs: head.watermarkMs, sequence: head.sequence },
  };
}
