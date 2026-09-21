/**
 * THE EVENT-TIME PER-SOURCE WATERMARK ARITHMETIC (L004 design D1) — pure,
 * property-tested functions ONLY (no state, no clock, no I/O).
 *
 * The frozen `Watermark { watermarkMs, sequence }` shape is used VERBATIM
 * (`@sporta/contracts`, timestamps.ts — a progress marker on the canonical
 * media timeline). The engine derives, per source:
 *
 * ```text
 * watermark.watermarkMs = min(
 *    sourceEmissionWatermark,     // what the source guarantees (max seen)
 *    maxEventTimeMs - reorderWindowMs   // the bounded reorder window
 * )                                // clamped >= 0, MONOTONIC (never regresses)
 * watermark.sequence  = the largest CONTIGUOUS RESOLVED sequence (holes
 *                       visible: an UNFILLED hole or an in-flight buffered
 *                       sequence holds it back — the engine never advances
 *                       the watermark past either)
 * ```
 *
 * The watermark is CONSERVATIVE: a new minimum can only hold it back, never
 * regress it (the frozen §3 rule "monotonically advancing version and
 * match-time watermark").
 */
import type { Watermark } from "@sporta/contracts";

/** Default bounded reorder window (ms) — 2x the L002 default tick of 100 ms. */
export const DEFAULT_REORDER_WINDOW_MS = 250;

/** Default watermark-lag budget (ms) beyond which a source is DEGRADED. */
export const DEFAULT_LAG_BUDGET_MS = 2000;

/** Default no-progress budget (ms) beyond which a source is STALLED. */
export const DEFAULT_STALL_BUDGET_MS = 3000;

/** Default bound on concurrently buffered observation batches per source. */
export const DEFAULT_MAX_BUFFERED_BATCHES = 64;

/**
 * The per-source watermark state (the D1 record; DATA — the engine owns one
 * per `sourceId`).
 */
export interface SourceWatermarkState {
  /** The combined conservative watermark (frozen shape; monotonic). */
  watermark: Watermark;
  /** The largest event time ever seen from this source. */
  maxEventTimeMs: number;
  /** The largest CONTIGUOUS RESOLVED sequence (applied or accounted-dropped). */
  lastContiguousSequence: number;
}

/** The bounded-window candidate: `max(0, maxEventTimeMs - reorderWindowMs)`. */
export function windowBoundMs(maxEventTimeMs: number, reorderWindowMs: number): number {
  return Math.max(0, maxEventTimeMs - reorderWindowMs);
}

/**
 * The combined watermark time: `min(sourceEmissionWatermarkMs, windowBound)`
 * clamped `>= 0`, then clamped MONOTONIC against `previousMs` (a regressing
 * input — a misbehaving source — can only hold the watermark back, never
 * pull it backwards).
 */
export function nextWatermarkMs(input: {
  sourceEmissionWatermarkMs: number;
  maxEventTimeMs: number;
  reorderWindowMs: number;
  previousMs: number;
}): number {
  const bound = windowBoundMs(input.maxEventTimeMs, input.reorderWindowMs);
  const candidate = Math.min(input.sourceEmissionWatermarkMs, bound);
  return Math.max(input.previousMs, Math.max(0, candidate));
}

/**
 * Whether a hole revealed at event time `revealingEventTimeMs` is CLOSED by
 * the current watermark: the window has advanced to (or past) the revealing
 * arrival's own event time, so nothing older-or-equal can still arrive
 * in-window for the hole's members. This is the D4 drop-scenario rule:
 * `min(emission watermark, window)` closes each hole.
 */
export function holeClosedByWatermark(watermarkMs: number, revealingEventTimeMs: number): boolean {
  return watermarkMs >= revealingEventTimeMs;
}

/**
 * The honest watermark lag (the §9 `watermark lag` counter the engine
 * owns): how far the render clock sits ahead of the watermark. A render
 * clock BEHIND the watermark is not lag (e.g. a replay consumer) — the
 * value is clamped at 0, never negative.
 */
export function watermarkLagMs(renderClockMs: number, watermarkMs: number): number {
  return Math.max(0, renderClockMs - watermarkMs);
}
