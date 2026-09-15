/**
 * The W306 trace: per-frame and per-batch stage-boundary evidence assembled
 * from the instrumented seams, plus the pure batch-cut replay that maps
 * EVERY cut batch (executed or not) back to its update sequences.
 *
 * ## The stage vocabulary (the work item's five stages, on real seams)
 *
 * The work item asks for "ingestion → SWM/world-model update → render
 * scheduling (W303) → renderer execution → output emission". The W304
 * pipeline's honest seams measure it as follows (ALL in the injected clock
 * domain; every boundary below is either an authored fixture constant or a
 * measured clock read — the frame rows carry both, labeled):
 *
 * - **ingestion → SWM/world-model update** (the fixture's authored source
 *   model, recorded per frame): `observedAtMs → visibleAtMs` with
 *   `deriveMs` the world-model update derivation cost. The pipeline-measured
 *   tail of this span is the store sojourn (`firstQueriedAtMs −
 *   visibleAtMs`) — how long a visible update waits for the consumer's
 *   watermark-grid query.
 * - **batch cut** (render scheduling entry): `cutAtMs` — the clock read of
 *   the store query that returned the batch's last update (the consumer
 *   cuts in the same synchronous segment; virtual time cannot pass between
 *   synchronous statements, so the read IS the cut instant).
 * - **render scheduling (W303)**: `submittedAtMs`, `startedAtMs`,
 *   `queueWaitMs`, `executionMs`, `finishedAtMs` — carried VERBATIM from the
 *   W303 result envelope's `jobTiming` in every emitted output's provenance
 *   (the protocol's own timing evidence, never re-derived).
 * - **renderer execution**: the `executionMs` above, VERBATIM — the worker's
 *   elapsed-virtual-time reading of the execution window, cross-checked
 *   against the instrumented executor wrapper's entry/exit reads for
 *   CONTAINMENT (the wrapper window must sit inside the W303 job lifetime:
 *   `submittedAtMs <= entry <= exit <= finishedAtMs`). Exact EQUALITY is
 *   deliberately NOT asserted: with concurrent work on the ONE shared
 *   virtual clock, any party's `sleep` advances the clock inside another
 *   party's window, so two honest elapsed-time readings of overlapping
 *   windows measure different sums (a real deployment's wall clock has the
 *   same property for elapsed time; only exclusive CPU time would agree).
 * - **output emission**: `emittedAtMs` — the clock read when the
 *   orchestrator's serialized in-order emitter delivered the record.
 *
 * ## The batch-cut replay (why it is sound)
 *
 * The W304 cut is PURE arithmetic over the ordered update list (the grid
 * walk + `cutBatch`), and the orchestrator's own checkpoint design documents
 * the deterministic-replay property: replaying the cut over the same store
 * re-cuts the SAME batches with the SAME ordinals and watermarks. The replay
 * here walks the same grid over the fixture's complete update list — giving
 * every batch (including ones that never reach the executor: skipped,
 * evicted, refused) its update sequences — and the assembly cross-checks it
 * against the orchestrator's ledger and the executor invocations (any
 * divergence is a loud accounting error, never a silent guess).
 */
import type { GpuJobResultTiming } from "@sporta/gpu-worker";
import type {
  RenderBatch,
  RenderOrchestrationResult,
  RenderOrchestrationLimits,
  SwmUpdate,
} from "@sporta/render-orchestration";
import { cutBatch } from "@sporta/render-orchestration";
import type { LiveFixture } from "./fixture";
import type { EmissionRecord, ExecutorInvocation } from "./instrument";
import { LatencyAccountingError } from "./errors";
import { InvalidBenchmarkOptionsError } from "./errors";
import { latencyStats, type LatencyStats } from "./percentiles";
import type { LiveSwmStore } from "./store";

/** The batch-level stage keys (the report's main stage table). */
export const BATCH_STAGE_KEYS = [
  "swm-to-batch",
  "batch-queue",
  "w303-schedule",
  "render-execution",
  "finish-to-emit",
  "end-to-end",
] as const;

/** The frame-level stage keys. */
export const FRAME_STAGE_KEYS = ["swm-store-sojourn", "end-to-end"] as const;

export type BatchStageKey = (typeof BATCH_STAGE_KEYS)[number];
export type FrameStageKey = (typeof FRAME_STAGE_KEYS)[number];

/** Human-readable stage definitions (echoed into the report verbatim). */
export const STAGE_DEFINITIONS: Readonly<Record<BatchStageKey | FrameStageKey, string>> =
  Object.freeze({
    "swm-to-batch":
      "batch cutAtMs − last update visibleAtMs: from the batch's last input being visible in the store to the batch being cut (the watermark-grid wait)",
    "batch-queue":
      "jobTiming.submittedAtMs − cutAtMs: the bounded batch channel sojourn + scheduler admission before the W303 submit",
    "w303-schedule":
      "jobTiming.queueWaitMs VERBATIM: the W303 dispatcher ready-queue wait from submit to the first executor invocation",
    "render-execution":
      "jobTiming.executionMs VERBATIM: the worker-measured renderer execution time (the authored render duration through the real anime render)",
    "finish-to-emit":
      "emittedAtMs − jobTiming.finishedAtMs: the reorder hold + in-order emission wait after the render finished",
    "swm-store-sojourn":
      "frame-level: firstQueriedAtMs − visibleAtMs — how long a visible update waits for the consumer's query",
    "end-to-end":
      "batch: emittedAtMs − first update visibleAtMs (all inputs visible → output emitted); frame: emittedAtMs − visibleAtMs",
  });

/** One frame's (update's) trace row — authored + measured evidence, labeled. */
export interface FrameTraceRow {
  readonly sequence: number;
  readonly batchId: string;
  /** Authored: when the live evidence existed (the ingestion input boundary). */
  readonly observedAtMs: number;
  /** Authored: when the world-model update completed and entered the store. */
  readonly visibleAtMs: number;
  /** Authored: `visibleAtMs − observedAtMs` (the derivation cost model). */
  readonly deriveMs: number;
  /** Measured: clock read of the first store query that returned this update. */
  readonly firstQueriedAtMs: number | null;
  /** Measured: clock read when this frame's batch output was emitted. */
  readonly emittedAtMs: number | null;
  /** Measured: `firstQueriedAtMs − visibleAtMs` (null when never queried). */
  readonly swmStoreSojournMs: number | null;
  /** Measured: `emittedAtMs − visibleAtMs` (null when never emitted). */
  readonly endToEndMs: number | null;
}

/** One batch's trace row — every boundary that applies, null where absent. */
export interface BatchTraceRow {
  readonly batchId: string;
  readonly ordinal: number;
  readonly sequences: readonly number[];
  readonly watermarkMs: number;
  readonly windowMs: { readonly startMs: number; readonly endMs: number };
  readonly closedBy: string;
  readonly disposition: "rendered" | "skipped-stale" | "dropped" | "cancelled" | "duplicate";
  readonly dropReason: string | null;
  /** How many times the real executor was invoked for this batch. */
  readonly executorInvocations: number;
  // Authored boundaries (the fixture's source model):
  readonly visibleFirstAtMs: number;
  readonly visibleLastAtMs: number;
  // Measured boundaries:
  readonly cutAtMs: number | null;
  readonly executorEntryAtMs: number | null;
  readonly executorExitAtMs: number | null;
  readonly emittedAtMs: number | null;
  // W303 `jobTiming`, VERBATIM from the output provenance (rendered only):
  readonly jobTiming: GpuJobResultTiming | null;
  // Stage latencies (null where a boundary is absent):
  readonly stageMs: Readonly<{
    "swm-to-batch": number | null;
    "batch-queue": number | null;
    "w303-schedule": number | null;
    "render-execution": number | null;
    "finish-to-emit": number | null;
    "end-to-end": number | null;
  }>;
}

/** The assembled trace (pure evidence — no stats, no verdicts). */
export interface LatencyTrace {
  readonly fixture: {
    readonly profileId: string;
    readonly profileVersion: number;
    readonly seed: string;
    readonly seconds: number;
    readonly updateCount: number;
    readonly burstEventFromMs: number;
    readonly burstEventToMs: number;
  };
  readonly sessionId: string;
  readonly orchestratorOutcome: RenderOrchestrationResult["outcome"];
  readonly frames: readonly FrameTraceRow[];
  readonly batches: readonly BatchTraceRow[];
}

/**
 * Replays the W304 consumer's pure batch-cut arithmetic over the complete
 * ordered update list — the deterministic-replay property (see module doc).
 * Produces every batch the live run cut, with identities and update
 * sequences, WITHOUT any clock.
 */
export function replayBatchCuts(
  sessionId: string,
  updates: readonly SwmUpdate[],
  limits: Pick<RenderOrchestrationLimits, "batchIntervalMs" | "maxUpdatesPerBatch">,
  startMs: number,
): RenderBatch[] {
  if (updates.length === 0) {
    return [];
  }
  const sliceAfter = (
    afterSequence: number,
    toMs: number,
  ): { updates: SwmUpdate[]; more: boolean } => {
    const matched: SwmUpdate[] = [];
    let more = false;
    for (const update of updates) {
      if (update.sequence > afterSequence && update.watermark.watermarkMs <= toMs) {
        if (matched.length >= limits.maxUpdatesPerBatch) {
          more = true;
          break;
        }
        matched.push(update);
      }
    }
    return { updates: matched, more };
  };
  const batches: RenderBatch[] = [];
  let boundaryMs = startMs + limits.batchIntervalMs;
  let windowStartMs = startMs;
  let lastConsumedSequence = -1;
  // 1-BASED ordinals, matching the orchestrator's own `nextBatchOrdinal`
  // initialization (and its `boundaryAt(startMs, interval, 1)` grid origin).
  let ordinal = 1;
  while (lastConsumedSequence < updates.length - 1) {
    const head = updates[updates.length - 1]!.watermark.watermarkMs;
    let slice: { updates: SwmUpdate[]; more: boolean };
    let closedBy: RenderBatch["closedBy"];
    let windowEndMs: number;
    if (head < boundaryMs) {
      // The final flush (the stream is complete; the tail window is partial).
      slice = sliceAfter(lastConsumedSequence, Number.POSITIVE_INFINITY);
      closedBy = slice.more ? "size-limit" : "stream-complete";
      windowEndMs = slice.more
        ? boundaryMs
        : slice.updates[slice.updates.length - 1]!.watermark.watermarkMs;
    } else {
      slice = sliceAfter(lastConsumedSequence, boundaryMs);
      if (slice.updates.length === 0) {
        // Empty window (the head jumped past it): advance the grid.
        windowStartMs = boundaryMs;
        boundaryMs += limits.batchIntervalMs;
        continue;
      }
      closedBy = slice.more ? "size-limit" : "watermark-boundary";
      windowEndMs = boundaryMs;
    }
    const batch = cutBatch({
      sessionId,
      ordinal,
      windowMs: { startMs: windowStartMs, endMs: windowEndMs },
      updates: slice.updates,
      closedBy,
    });
    batches.push(batch);
    ordinal += 1;
    lastConsumedSequence = batch.toSequence;
    if (closedBy === "size-limit") {
      windowStartMs = batch.watermark.watermarkMs;
    } else {
      windowStartMs = boundaryMs;
      boundaryMs += limits.batchIntervalMs;
    }
  }
  return batches;
}

/** The evidence inputs to {@link assembleTrace}. */
export interface TraceEvidence {
  readonly fixture: LiveFixture;
  readonly store: LiveSwmStore;
  readonly invocations: readonly ExecutorInvocation[];
  readonly emissions: readonly EmissionRecord[];
  readonly result: RenderOrchestrationResult;
  readonly limits: RenderOrchestrationLimits;
  readonly startMs: number;
}

/** Assembles the trace from the seam evidence (pure; fail-loud on mismatch). */
export function assembleTrace(evidence: TraceEvidence): LatencyTrace {
  const { fixture, store, invocations, emissions, result, limits, startMs } = evidence;

  // --- the batch-cut replay + never-silent cross-checks ---------------------
  const replayed = replayBatchCuts(
    result.sessionId,
    fixture.steps.map((step) => step.update),
    limits,
    startMs,
  );
  const ledger = result.ledger;
  if (replayed.length !== ledger.length) {
    throw new LatencyAccountingError(
      `the batch-cut replay produced ${String(replayed.length)} batches but the orchestrator ` +
        `ledger carries ${String(ledger.length)} — the replay diverged from the real cut`,
    );
  }
  const replayById = new Map(replayed.map((batch) => [batch.batchId, batch]));
  const ledgerById = new Map(ledger.map((entry) => [entry.batchId, entry]));
  for (const batch of replayed) {
    const entry = ledgerById.get(batch.batchId);
    if (entry === undefined) {
      throw new LatencyAccountingError(
        `replayed batch '${batch.batchId}' has no ledger entry — every cut batch must land in exactly one terminal disposition`,
      );
    }
    if (
      entry.ordinal !== batch.ordinal ||
      entry.watermark.watermarkMs !== batch.watermark.watermarkMs
    ) {
      throw new LatencyAccountingError(
        `ledger entry for '${batch.batchId}' (ordinal ${String(entry.ordinal)}, watermark ` +
          `${String(entry.watermark.watermarkMs)}) disagrees with the replay (ordinal ` +
          `${String(batch.ordinal)}, watermark ${String(batch.watermark.watermarkMs)})`,
      );
    }
  }
  for (const entry of ledger) {
    if (!replayById.has(entry.batchId)) {
      throw new LatencyAccountingError(
        `ledger entry '${entry.batchId}' has no replayed batch — the orchestrator cut a batch the replay cannot reproduce`,
      );
    }
  }

  const invocationByBatch = new Map<string, ExecutorInvocation>();
  const invocationCounts = new Map<string, number>();
  for (const invocation of invocations) {
    invocationCounts.set(invocation.batchId, (invocationCounts.get(invocation.batchId) ?? 0) + 1);
    if (!invocationByBatch.has(invocation.batchId)) {
      invocationByBatch.set(invocation.batchId, invocation);
    }
    const replayBatch = replayById.get(invocation.batchId);
    if (replayBatch === undefined) {
      throw new LatencyAccountingError(
        `executor invoked for batch '${invocation.batchId}' which the replay never cut`,
      );
    }
    if (
      invocation.sequences.length !== replayBatch.updates.length ||
      invocation.sequences.some(
        (sequence, index) => sequence !== replayBatch.updates[index]!.sequence,
      )
    ) {
      throw new LatencyAccountingError(
        `executor invocation for '${invocation.batchId}' carries sequences ` +
          `${JSON.stringify(invocation.sequences)} but the replay cut ${JSON.stringify(replayBatch.updates.map((u) => u.sequence))}`,
      );
    }
  }
  const emissionByBatch = new Map<string, EmissionRecord>();
  for (const emission of emissions) {
    if (emissionByBatch.has(emission.batchId)) {
      throw new LatencyAccountingError(
        `batch '${emission.batchId}' was emitted more than once — the in-order emitter is single-delivery`,
      );
    }
    emissionByBatch.set(emission.batchId, emission);
  }
  if (emissions.length !== result.outputs.length) {
    throw new LatencyAccountingError(
      `the output tap observed ${String(emissions.length)} emissions but the settled result carries ` +
        `${String(result.outputs.length)} outputs`,
    );
  }

  // --- per-batch rows --------------------------------------------------------
  const stepBySequence = new Map(fixture.steps.map((step) => [step.update.sequence, step]));
  const batches: BatchTraceRow[] = replayed.map((batch) => {
    const entry = ledgerById.get(batch.batchId)!;
    const invocation = invocationByBatch.get(batch.batchId);
    const emission = emissionByBatch.get(batch.batchId);
    const steps = batch.updates.map((update) => stepBySequence.get(update.sequence)!);
    if (steps.some((step) => step === undefined)) {
      throw new LatencyAccountingError(
        `batch '${batch.batchId}' carries an update sequence the fixture never authored`,
      );
    }
    const visibleFirstAtMs = steps[0]!.visibleAtMs;
    const visibleLastAtMs = steps[steps.length - 1]!.visibleAtMs;
    const cutAtMs = (() => {
      const queried = batch.updates.map((update) => store.firstQueriedAtMs(update.sequence));
      if (queried.some((value) => value === undefined)) return null;
      return Math.max(...(queried as number[]));
    })();
    const jobTiming = emission?.record.provenance.jobTiming ?? null;
    if (
      jobTiming !== null &&
      invocation !== undefined &&
      (invocation.entryAtMs < jobTiming.submittedAtMs ||
        invocation.exitAtMs > jobTiming.finishedAtMs)
    ) {
      throw new LatencyAccountingError(
        `batch '${batch.batchId}': the instrumented executor window [${String(invocation.entryAtMs)}, ` +
          `${String(invocation.exitAtMs)}] escapes the W303 job lifetime [${String(jobTiming.submittedAtMs)}, ` +
          `${String(jobTiming.finishedAtMs)}] — a clock-domain boundary diverged (investigate before ` +
          "reporting any latency)",
      );
    }
    const emittedAtMs = emission?.emittedAtMs ?? null;
    const stageMs: BatchTraceRow["stageMs"] = {
      "swm-to-batch": cutAtMs === null ? null : cutAtMs - visibleLastAtMs,
      "batch-queue":
        jobTiming === null || cutAtMs === null ? null : jobTiming.submittedAtMs - cutAtMs,
      "w303-schedule":
        jobTiming === null || jobTiming.queueWaitMs === undefined ? null : jobTiming.queueWaitMs,
      "render-execution": jobTiming === null ? null : jobTiming.executionMs,
      "finish-to-emit":
        jobTiming === null || emittedAtMs === null ? null : emittedAtMs - jobTiming.finishedAtMs,
      "end-to-end": emittedAtMs === null ? null : emittedAtMs - visibleFirstAtMs,
    };
    return {
      batchId: batch.batchId,
      ordinal: batch.ordinal,
      sequences: batch.updates.map((update) => update.sequence),
      watermarkMs: batch.watermark.watermarkMs,
      windowMs: { startMs: batch.windowMs.startMs, endMs: batch.windowMs.endMs },
      closedBy: batch.closedBy,
      disposition: entry.disposition,
      dropReason: entry.dropReason ?? null,
      executorInvocations: invocationCounts.get(batch.batchId) ?? 0,
      visibleFirstAtMs,
      visibleLastAtMs,
      cutAtMs,
      executorEntryAtMs: invocation?.entryAtMs ?? null,
      executorExitAtMs: invocation?.exitAtMs ?? null,
      emittedAtMs,
      jobTiming,
      stageMs,
    };
  });

  // --- per-frame rows --------------------------------------------------------
  const batchBySequence = new Map<number, BatchTraceRow>();
  for (const row of batches) {
    for (const sequence of row.sequences) {
      batchBySequence.set(sequence, row);
    }
  }
  const frames: FrameTraceRow[] = fixture.steps.map((step) => {
    const owner = batchBySequence.get(step.sequence)!;
    if (owner === undefined) {
      throw new LatencyAccountingError(
        `update sequence ${String(step.sequence)} belongs to no cut batch — every input must land in exactly one batch`,
      );
    }
    const firstQueriedAtMs = store.firstQueriedAtMs(step.sequence) ?? null;
    const emittedAtMs = owner.emittedAtMs;
    return {
      sequence: step.sequence,
      batchId: owner.batchId,
      observedAtMs: step.observedAtMs,
      visibleAtMs: step.visibleAtMs,
      deriveMs: step.deriveMs,
      firstQueriedAtMs,
      emittedAtMs,
      swmStoreSojournMs: firstQueriedAtMs === null ? null : firstQueriedAtMs - step.visibleAtMs,
      endToEndMs: emittedAtMs === null ? null : emittedAtMs - step.visibleAtMs,
    };
  });

  return {
    fixture: {
      profileId: fixture.profile.profileId,
      profileVersion: fixture.profile.profileVersion,
      seed: fixture.profile.seed,
      seconds: fixture.profile.seconds,
      updateCount: fixture.steps.length,
      burstEventFromMs: fixture.profile.burstEventFromMs,
      burstEventToMs: fixture.profile.burstEventToMs,
    },
    sessionId: result.sessionId,
    orchestratorOutcome: result.outcome,
    frames,
    batches,
  };
}

/** The computed stage summaries (batch stages + frame stages + source model). */
export interface LatencyStageStats {
  readonly batchStages: Readonly<Record<BatchStageKey, LatencyStats>>;
  readonly frameStages: Readonly<Record<FrameStageKey, LatencyStats>>;
  readonly sourceModel: {
    /** AUTHORED (the fixture's derivation-cost model), not measured. */
    readonly worldModelUpdateDeriveMs: LatencyStats;
  };
}

/** Computes the per-stage percentile summaries (pure over the trace). */
export function computeStageStats(trace: LatencyTrace): LatencyStageStats {
  const batchStage = (key: BatchStageKey): LatencyStats => {
    const samples = trace.batches
      .map((row) => row.stageMs[key])
      .filter((value): value is number => value !== null);
    if (samples.length === 0) {
      throw new InvalidBenchmarkOptionsError(
        `batch stage "${key}" has no samples — no batch reached that stage's ` +
          "boundaries (typically: the pipeline bounds dropped or skipped every " +
          "batch before it rendered); stage latency statistics are undefined for " +
          "an all-loss run, and a report carrying a fabricated zero would lie",
      );
    }
    return latencyStats(samples);
  };
  const frameStage = (key: FrameStageKey): LatencyStats => {
    const samples = trace.frames
      .map((row) => (key === "end-to-end" ? row.endToEndMs : row.swmStoreSojournMs))
      .filter((value): value is number => value !== null);
    if (samples.length === 0) {
      throw new InvalidBenchmarkOptionsError(
        `frame stage "${key}" has no samples — no frame reached that stage's ` +
          "boundaries (typically: nothing was emitted); stage latency statistics " +
          "are undefined for an all-loss run, and a report carrying a fabricated " +
          "zero would lie",
      );
    }
    return latencyStats(samples);
  };
  return {
    batchStages: {
      "swm-to-batch": batchStage("swm-to-batch"),
      "batch-queue": batchStage("batch-queue"),
      "w303-schedule": batchStage("w303-schedule"),
      "render-execution": batchStage("render-execution"),
      "finish-to-emit": batchStage("finish-to-emit"),
      "end-to-end": batchStage("end-to-end"),
    },
    frameStages: {
      "swm-store-sojourn": frameStage("swm-store-sojourn"),
      "end-to-end": frameStage("end-to-end"),
    },
    sourceModel: {
      worldModelUpdateDeriveMs: latencyStats(trace.frames.map((row) => row.deriveMs)),
    },
  };
}
