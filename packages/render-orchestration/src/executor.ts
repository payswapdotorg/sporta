/**
 * The render executor (W304): the W402-seam-shaped work function that turns
 * one {@link RenderBatch} into one W502 `AnimeRenderOutput`, plus the
 * structural validation the orchestrator applies to every executor result.
 *
 * THE COMPOSITION (documented decision): the REAL anime plugin
 * (`@sporta/renderer-anime`, W502) is the provided executor — it is
 * composable without heavy dependencies (runtime deps:
 * contracts/renderer-contract/testing — all workspace, zero external), so
 * the "fixture renderer vs real plugin" choice resolves in favor of the real
 * plugin. The batch's updates map one-to-one onto the W502 clip steps
 * (`atMs = update.watermark.watermarkMs`, the snapshot and its events
 * verbatim — exactly the construction the W502 integration tests drive with
 * the W402 `stateAt`/`eventWindow` seams).
 *
 * Render WORK is modeled deterministically: the executor CONSUMES
 * `renderDurationMs` of protocol-clock time before synthesizing (a real
 * renderer is slow; the slow-renderer burst fixtures inject a large
 * duration). The clock is the shared injected `GpuClock` — no wall time.
 *
 * Failure mapping (the W303 semantics inherited verbatim): a thrown
 * `RendererContractError` is a render REFUSAL (malformed request, rights,
 * profile, invalid steps) — non-retryable, classified `render-refused`;
 * any OTHER thrown fault propagates to the W303 worker, which classifies it
 * `internal` and dead-letters it (the W302 mapping of thrown bugs). A caller
 * wanting retryable render failures injects them through the
 * {@link RenderBatchExecutor} seam directly.
 */
import type { RenderRequest } from "@sporta/contracts";
import type { GpuClock } from "@sporta/gpu-worker";
import type { AnimeClipStep, AnimeRenderOutput } from "@sporta/renderer-anime";
import { renderAnimeClip } from "@sporta/renderer-anime";
import { RendererContractError } from "@sporta/renderer-contract";
import { RenderOutputInvalidError } from "./errors";
import type {
  RenderBatch,
  RenderBatchExecutor,
  RenderBatchOutcome,
  RenderExecutorContext,
} from "./types";

/** Options for {@link createAnimeRenderBatchExecutor}. */
export interface AnimeRenderExecutorOptions {
  /**
   * Protocol-clock time one render consumes, in ms (finite >= 0; default 0 —
   * the plugin itself is fast; slow-renderer fixtures inject a large value).
   */
  renderDurationMs?: number;
}

/**
 * The provided executor: one render of the real W502 anime plugin per batch,
 * consuming `renderDurationMs` of injected-clock time first.
 */
export function createAnimeRenderBatchExecutor(
  options: AnimeRenderExecutorOptions = {},
): RenderBatchExecutor {
  const renderDurationMs = options.renderDurationMs ?? 0;
  if (!Number.isFinite(renderDurationMs) || renderDurationMs < 0) {
    throw new RangeError(
      `createAnimeRenderBatchExecutor renderDurationMs must be a finite number >= 0 (got ${String(renderDurationMs)})`,
    );
  }
  return {
    async execute(
      batch: RenderBatch,
      request: RenderRequest,
      context: RenderExecutorContext,
    ): Promise<RenderBatchOutcome> {
      const clock: GpuClock = context.clock;
      if (renderDurationMs > 0) {
        await clock.sleep(renderDurationMs);
      }
      const steps: AnimeClipStep[] = batch.updates.map((update) => ({
        atMs: update.watermark.watermarkMs,
        snapshot: update.snapshot,
        events: [...update.events],
      }));
      try {
        const output = renderAnimeClip(request, steps);
        return { status: "succeeded", output };
      } catch (err) {
        if (err instanceof RendererContractError) {
          return {
            status: "failed",
            errorClass: "render-refused",
            message: err.message,
            retryable: false,
          };
        }
        throw err;
      }
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural validation of one executor output (the orchestrator's
 * trust boundary over the W303 job result's opaque `output` — the protocol
 * never interprets it, the orchestrator must). Checks the
 * `AnimeRenderOutput` shape: `result` (contract `RenderResult`), `frames`
 * (non-empty, one per manifest frame), and `manifest` with the renderer
 * identity and matching frame count. Throws `RenderOutputInvalidError`
 * naming the breach — a lying executor is an INTERNAL fault, the batch is
 * accounted dropped with the reason recorded (never silent).
 */
export function assertAnimeRenderOutputShape(
  output: unknown,
  evidence: { jobId: string; batchId: string },
): AnimeRenderOutput {
  if (!isPlainObject(output)) {
    throw new RenderOutputInvalidError(
      `render job '${evidence.jobId}' returned a non-object output for batch '${evidence.batchId}'`,
      { jobId: evidence.jobId, batchId: evidence.batchId, got: typeof output },
    );
  }
  if (
    !isPlainObject(output.result) ||
    !Array.isArray(output.frames) ||
    !isPlainObject(output.manifest)
  ) {
    throw new RenderOutputInvalidError(
      `render job '${evidence.jobId}' output for batch '${evidence.batchId}' is not an AnimeRenderOutput (needs result/frames/manifest)`,
      { jobId: evidence.jobId, batchId: evidence.batchId },
    );
  }
  const manifest = output.manifest;
  if (!isPlainObject(manifest.renderer)) {
    throw new RenderOutputInvalidError(
      `render job '${evidence.jobId}' output manifest has no renderer identity`,
      { jobId: evidence.jobId, batchId: evidence.batchId, field: "manifest.renderer" },
    );
  }
  const renderer = manifest.renderer as Record<string, unknown>;
  if (typeof renderer.rendererId !== "string" || renderer.rendererId.length < 1) {
    throw new RenderOutputInvalidError(
      `render job '${evidence.jobId}' output manifest rendererId must be a non-empty string`,
      { jobId: evidence.jobId, batchId: evidence.batchId, field: "manifest.renderer.rendererId" },
    );
  }
  if (typeof renderer.rendererVersion !== "string" || renderer.rendererVersion.length < 1) {
    throw new RenderOutputInvalidError(
      `render job '${evidence.jobId}' output manifest rendererVersion must be a non-empty string`,
      {
        jobId: evidence.jobId,
        batchId: evidence.batchId,
        field: "manifest.renderer.rendererVersion",
      },
    );
  }
  const frames = output.frames as unknown[];
  if (
    !Array.isArray(manifest.frames) ||
    manifest.frames.length !== frames.length ||
    frames.length === 0
  ) {
    throw new RenderOutputInvalidError(
      `render job '${evidence.jobId}' output frames (${frames.length}) do not match its manifest frames`,
      { jobId: evidence.jobId, batchId: evidence.batchId, field: "manifest.frames" },
    );
  }
  return output as unknown as AnimeRenderOutput;
}
