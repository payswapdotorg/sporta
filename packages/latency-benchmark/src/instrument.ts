/**
 * The W306 stage-boundary instrumentation: thin wrappers around the REAL
 * W304 seams that record injected-clock readings at every stage boundary.
 *
 * The wrappers add NO behavior — they delegate VERBATIM to the real seam
 * (`createAnimeRenderBatchExecutor` — one real W502 anime render per batch)
 * and the real orchestrator's `onOutput` sink — and only take clock reads:
 *
 * - the executor wrapper records, per batch, the entry/exit readings around
 *   the renderer execution (cross-checking the W303 `jobTiming.executionMs`
 *   the orchestrator later carries in the output's provenance);
 * - the output tap records, per emitted output, the reading when the
 *   orchestrator's serialized in-order emitter handed the record over.
 *
 * Every timestamp in the resulting trace is therefore a reading of the ONE
 * injected `GpuClock` shared by the whole pipeline (the W303/W304
 * constitution) — never a wall clock, never `Date.now`, never
 * `performance.now`.
 */
import type { GpuClock } from "@sporta/gpu-worker";
import type {
  RenderBatch,
  RenderBatchExecutor,
  RenderBatchOutcome,
  RenderOutputRecord,
} from "@sporta/render-orchestration";
import type { RenderRequest } from "@sporta/contracts";

/** One recorded executor invocation (the renderer-execution boundary). */
export interface ExecutorInvocation {
  readonly batchId: string;
  readonly ordinal: number;
  readonly sequences: readonly number[];
  readonly watermarkMs: number;
  /** Injected-clock reading when the real executor was entered. */
  readonly entryAtMs: number;
  /** Injected-clock reading when the real executor returned/threw. */
  readonly exitAtMs: number;
  /** The invocation's outcome class (`succeeded` / `failed` / `thrown`). */
  readonly outcome: "succeeded" | "failed" | "thrown";
}

/** Wraps a real executor with entry/exit clock instrumentation. */
export function instrumentedExecutor(
  clock: GpuClock,
  inner: RenderBatchExecutor,
): { executor: RenderBatchExecutor; invocations: readonly ExecutorInvocation[] } {
  const invocations: ExecutorInvocation[] = [];
  const wrapped: RenderBatchExecutor = {
    async execute(
      batch: RenderBatch,
      request: RenderRequest,
      context: { clock: GpuClock },
    ): Promise<RenderBatchOutcome> {
      const entryAtMs = clock.now();
      let outcome: ExecutorInvocation["outcome"] = "thrown";
      try {
        const result = await inner.execute(batch, request, context);
        outcome = result.status === "succeeded" ? "succeeded" : "failed";
        return result;
      } finally {
        invocations.push({
          batchId: batch.batchId,
          ordinal: batch.ordinal,
          sequences: batch.updates.map((update) => update.sequence),
          watermarkMs: batch.watermark.watermarkMs,
          entryAtMs,
          exitAtMs: clock.now(),
          outcome,
        });
      }
    },
  };
  return { executor: wrapped, invocations };
}

/** One recorded output emission (the output-emission boundary). */
export interface EmissionRecord {
  readonly batchId: string;
  readonly batchOrdinal: number;
  readonly jobId: string;
  /** Injected-clock reading when the in-order emitter delivered the record. */
  readonly emittedAtMs: number;
  /** The emitted record itself (provenance carried VERBATIM). */
  readonly record: RenderOutputRecord;
}

/**
 * Builds the `onOutput` tap: records the injected-clock reading per emitted
 * output while delegating to an optional real sink (the benchmark's sink is
 * capture-only; the orchestrator awaits it, and ordering is the
 * orchestrator's own — the tap never reorders anything).
 */
export function outputTap(
  clock: GpuClock,
  innerSink?: (record: RenderOutputRecord) => Promise<void> | void,
): {
  onOutput: (record: RenderOutputRecord) => Promise<void>;
  emissions: readonly EmissionRecord[];
} {
  const emissions: EmissionRecord[] = [];
  const onOutput = async (record: RenderOutputRecord): Promise<void> => {
    emissions.push({
      batchId: record.provenance.batchId,
      batchOrdinal: record.provenance.batchOrdinal,
      jobId: record.provenance.jobId,
      emittedAtMs: clock.now(),
      record,
    });
    if (innerSink !== undefined) {
      await innerSink(record);
    }
  };
  return { onOutput, emissions };
}
