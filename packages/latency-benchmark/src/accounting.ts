/**
 * The W306 never-silent accounting: every input frame and batch lands in
 * EXACTLY ONE terminal bucket, runtime-asserted (the W304 posture — an
 * imbalance throws, never a lying report).
 *
 * The W304 orchestrator already asserts ITS OWN batch identities at settle
 * (`assertRenderAccounting` — batches in = rendered + skipped + dropped +
 * cancelled + duplicates + in-flight). This module extends the same posture
 * to the FRAME level over the recorded trace:
 *
 *   frames in (fixture updates)
 *     === frames emitted + frames skipped-stale + frames dropped
 *        + frames cancelled + frames duplicate
 *
 * where each bucket sums the update counts of the batches carrying that
 * ledger disposition, plus the emitted-output frame cross-check:
 *
 *   frames emitted === Σ emitted outputs' manifest frame counts
 *
 * and the emitted-frames identity with the W304 stats:
 *
 *   trace rendered batches === stats.batchesRendered
 *   trace batches === stats.batchesIn
 *   Σ batch update counts === fixture update count
 *
 * Every identity is labeled; the first broken one throws
 * `LatencyAccountingError` with the full breakdown.
 */
import { assertRenderAccounting } from "@sporta/render-orchestration";
import type {
  RenderOrchestrationResult,
  RenderOrchestrationStats,
} from "@sporta/render-orchestration";
import { LatencyAccountingError } from "./errors";
import type { LatencyTrace } from "./trace";

/** The frame-level buckets (the batch dispositions projected onto frames). */
export interface FrameAccounting {
  readonly framesIn: number;
  readonly framesEmitted: number;
  readonly framesSkippedStale: number;
  readonly framesDropped: number;
  readonly framesCancelled: number;
  readonly framesDuplicate: number;
  /** The exact labeled drop-reason histogram (never a silent lump). */
  readonly dropReasons: Readonly<Record<string, number>>;
  /** The emitted outputs' own manifest frame counts (the cross-check). */
  readonly emittedManifestFrames: number;
  /** Runtime-asserted balance proofs (present only after they held). */
  readonly balanced: true;
}

/** The full accounting block the report carries. */
export interface LatencyAccounting {
  /** The W304 orchestrator's own settled stats, VERBATIM (re-asserted). */
  readonly orchestratorStats: RenderOrchestrationStats;
  readonly frames: FrameAccounting;
}

const IDENTITY_LABELS = [
  "framesIn === framesEmitted + framesSkippedStale + framesDropped + framesCancelled + framesDuplicate",
  "framesEmitted === emittedManifestFrames (every emitted frame is the renderer's own output frame)",
] as const;

/**
 * Asserts the never-silent frame/batch identities over the trace and the
 * settled orchestrator result. Throws {@link LatencyAccountingError} naming
 * the broken identity with the full breakdown — never returns a lying
 * `balanced` marker.
 */
export function assertLatencyAccounting(
  trace: LatencyTrace,
  result: RenderOrchestrationResult,
  emittedManifestFrames: number,
): void {
  // The W304 identities, re-asserted over the settled snapshot (the
  // orchestrator already asserted at settle; this is the benchmark's own
  // never-silent re-verification, the repo's double-run posture).
  assertRenderAccounting(result.stats);

  if (trace.batches.length !== result.stats.batchesIn) {
    throw new LatencyAccountingError(
      `the trace carries ${String(trace.batches.length)} batches but the orchestrator stats say ` +
        `batchesIn=${String(result.stats.batchesIn)} — the trace and the settled accounting diverged`,
    );
  }
  const traceRendered = trace.batches.filter((row) => row.disposition === "rendered").length;
  if (traceRendered !== result.stats.batchesRendered) {
    throw new LatencyAccountingError(
      `the trace carries ${String(traceRendered)} rendered batches but the orchestrator stats say ` +
        `batchesRendered=${String(result.stats.batchesRendered)}`,
    );
  }
  const framesIn = trace.fixture.updateCount;
  const framesSequenced = trace.frames.length;
  if (framesIn !== framesSequenced) {
    throw new LatencyAccountingError(
      `the fixture authors ${String(framesIn)} updates but the trace carries ${String(framesSequenced)} frame rows`,
    );
  }
  const bucketOf = (disposition: string): number =>
    trace.batches
      .filter((row) => row.disposition === disposition)
      .reduce((sum, row) => sum + row.sequences.length, 0);
  const framesEmitted = bucketOf("rendered");
  const framesSkippedStale = bucketOf("skipped-stale");
  const framesDropped = bucketOf("dropped");
  const framesCancelled = bucketOf("cancelled");
  const framesDuplicate = bucketOf("duplicate");
  const dropReasons: Record<string, number> = {};
  for (const row of trace.batches) {
    if (row.disposition === "dropped") {
      const reason = row.dropReason ?? "unknown";
      dropReasons[reason] = (dropReasons[reason] ?? 0) + row.sequences.length;
    }
  }
  const checks: Array<[boolean, string]> = [
    [
      framesIn ===
        framesEmitted + framesSkippedStale + framesDropped + framesCancelled + framesDuplicate,
      IDENTITY_LABELS[0]!,
    ],
    [framesEmitted === emittedManifestFrames, IDENTITY_LABELS[1]!],
  ];
  const breakdown = JSON.stringify({
    framesIn,
    framesEmitted,
    framesSkippedStale,
    framesDropped,
    framesCancelled,
    framesDuplicate,
    emittedManifestFrames,
  });
  for (const [ok, label] of checks) {
    if (!ok) {
      throw new LatencyAccountingError(`identity broken: ${label} — ${breakdown}`);
    }
  }
}

/**
 * Builds the report's accounting block. Pure; the assertions MUST have held
 * (call {@link assertLatencyAccounting} first — the benchmark driver does).
 */
export function buildAccounting(
  trace: LatencyTrace,
  result: RenderOrchestrationResult,
  emittedManifestFrames: number,
): LatencyAccounting {
  assertLatencyAccounting(trace, result, emittedManifestFrames);
  const bucketOf = (disposition: string): number =>
    trace.batches
      .filter((row) => row.disposition === disposition)
      .reduce((sum, row) => sum + row.sequences.length, 0);
  const dropReasons: Record<string, number> = {};
  for (const row of trace.batches) {
    if (row.disposition === "dropped") {
      const reason = row.dropReason ?? "unknown";
      dropReasons[reason] = (dropReasons[reason] ?? 0) + row.sequences.length;
    }
  }
  return {
    orchestratorStats: result.stats,
    frames: {
      framesIn: trace.fixture.updateCount,
      framesEmitted: bucketOf("rendered"),
      framesSkippedStale: bucketOf("skipped-stale"),
      framesDropped: bucketOf("dropped"),
      framesCancelled: bucketOf("cancelled"),
      framesDuplicate: bucketOf("duplicate"),
      dropReasons,
      emittedManifestFrames,
      balanced: true,
    },
  };
}
