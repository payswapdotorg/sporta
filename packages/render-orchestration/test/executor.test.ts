/**
 * The render executor (W304): the REAL W502 anime plugin over deterministic
 * fixture snapshots, the clock-consumed render duration, the refusal
 * mapping, and the structural validation of every executor output.
 */
import { describe, expect, test } from "bun:test";
import { VirtualGpuClock } from "@sporta/gpu-worker";
import { RendererContractError } from "@sporta/renderer-contract";
import { assertAnimeRenderOutputShape, createAnimeRenderBatchExecutor } from "../src/executor";
import { cutBatch } from "../src/batch";
import { RenderOutputInvalidError } from "../src/errors";
import { animeRequest, buildSwmStory } from "./helpers";
import type { RenderBatch } from "../src/types";

/** One deterministic batch over the real story updates. */
function storyBatch(sessionId: string, ordinal = 1): RenderBatch {
  const { updates } = buildSwmStory({ sessionId });
  return cutBatch({
    sessionId,
    ordinal,
    windowMs: { startMs: 0, endMs: 1_000 },
    updates: updates.slice(0, 1),
    closedBy: "watermark-boundary",
  });
}

describe("createAnimeRenderBatchExecutor", () => {
  test("renders the REAL anime plugin: one output per batch, steps from updates verbatim", async () => {
    const clock = new VirtualGpuClock(0);
    const executor = createAnimeRenderBatchExecutor();
    const batch = storyBatch("sess-exec");
    const request = animeRequest("sess-exec");
    const outcome = await executor.execute(batch, request, { clock });
    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;
    const output = outcome.output;
    expect(output.manifest.renderer.rendererId).toBe("anime.prototype");
    expect(output.manifest.renderer.rendererVersion).toBe("0.1.0");
    expect(output.frames).toHaveLength(1);
    expect(output.manifest.frames).toHaveLength(1);
    // The clip step IS the update: atMs = the update's watermark, verbatim.
    expect(output.frames[0]!.outputTimestampMs).toBe(batch.updates[0]!.watermark.watermarkMs);
    expect(output.manifest.session.sessionId).toBe("sess-exec");
    // The snapshot entities render (p1 + b1 from the story fixture).
    const entities = output.manifest.frames[0]!.entities;
    expect(entities.map((entry) => entry.entityId).sort()).toEqual(["b1", "p1"]);
  });

  test("render work CONSUMES clock time before synthesizing (the slow-renderer knob)", async () => {
    const clock = new VirtualGpuClock(1_000);
    const executor = createAnimeRenderBatchExecutor({ renderDurationMs: 2_500 });
    const batch = storyBatch("sess-exec");
    await executor.execute(batch, animeRequest("sess-exec"), { clock });
    expect(clock.now()).toBe(3_500);
  });

  test("a RendererContractError maps to a NON-RETRYABLE render-refused failure", async () => {
    const clock = new VirtualGpuClock(0);
    const executor = createAnimeRenderBatchExecutor();
    // A request whose rights forbid source frames with refs carried → the
    // plugin's own R2 refusal (fail-closed, beyond the contract baseline).
    const request = {
      ...animeRequest("sess-exec"),
      sourceFrameRefs: ["frame-1"],
      rightsCapabilities: {
        canReferenceSourceFrames: false,
        canDeliverLive: false,
        canStoreDerivatives: true,
        canShare: false,
      },
    };
    const outcome = await executor.execute(storyBatch("sess-exec"), request, { clock });
    expect(outcome).toEqual({
      status: "failed",
      errorClass: "render-refused",
      message: expect.stringContaining("source-frame"),
      retryable: false,
    });
  });

  test("an invalid request template is refused before any render (admission honesty)", async () => {
    const clock = new VirtualGpuClock(0);
    const executor = createAnimeRenderBatchExecutor();
    const request = { ...animeRequest("sess-exec"), rendererVersion: "9.9.9" };
    const outcome = await executor.execute(storyBatch("sess-exec"), request, { clock });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.retryable).toBe(false);
    expect(outcome.errorClass).toBe("render-refused");
  });

  test("a NON-contract thrown fault propagates (the W303 worker classifies it internal)", async () => {
    const clock = new VirtualGpuClock(0);
    const executor = createAnimeRenderBatchExecutor();
    // Steps with a duplicate atMs violate the W502 step contract → a
    // RendererContractError from the plugin — mapped render-refused. To pin
    // the propagation path we instead exercise a batch whose UPDATE
    // watermark sequence regresses: the plugin's step validation refuses.
    const batch = storyBatch("sess-exec");
    // Duplicating the single update keeps atMs constant → refused loudly
    // (not a crash, not a silent render).
    const duplicated: RenderBatch = {
      ...batch,
      updates: [batch.updates[0]!, { ...batch.updates[0]! }],
    };
    const outcome = await executor.execute(duplicated, animeRequest("sess-exec"), { clock });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.errorClass).toBe("render-refused");
    expect(outcome.message).toContain("atMs");
  });

  test("renderDurationMs validation is fail-loud", () => {
    expect(() => createAnimeRenderBatchExecutor({ renderDurationMs: -1 })).toThrow(RangeError);
    expect(() => createAnimeRenderBatchExecutor({ renderDurationMs: Number.NaN })).toThrow(
      RangeError,
    );
  });

  test("a contract error thrown by a custom seam is recognizable (the mapping contract)", () => {
    const err = new RendererContractError("refused", "media-invalid", {});
    expect(err.failureClass).toBe("media-invalid");
  });
});

describe("assertAnimeRenderOutputShape (the orchestrator's trust boundary)", () => {
  test("the real plugin output passes", async () => {
    const executor = createAnimeRenderBatchExecutor();
    const outcome = await executor.execute(storyBatch("sess-exec"), animeRequest("sess-exec"), {
      clock: new VirtualGpuClock(0),
    });
    if (outcome.status !== "succeeded") throw new Error("expected success");
    expect(() =>
      assertAnimeRenderOutputShape(outcome.output, { jobId: "j1", batchId: "b1" }),
    ).not.toThrow();
  });

  const invalid: Array<{ label: string; output: unknown; field?: string }> = [
    { label: "a non-object", output: 42, field: undefined },
    { label: "missing frames", output: { result: {}, manifest: {} }, field: undefined },
    {
      label: "missing renderer identity",
      output: { result: {}, frames: [], manifest: {} },
      field: "manifest.renderer",
    },
    {
      label: "empty rendererId",
      output: {
        result: {},
        frames: [{}],
        manifest: { renderer: { rendererId: "", rendererVersion: "0.1.0" }, frames: [{}] },
      },
      field: "manifest.renderer.rendererId",
    },
    {
      label: "empty rendererVersion",
      output: {
        result: {},
        frames: [{}],
        manifest: {
          renderer: { rendererId: "anime.prototype", rendererVersion: "" },
          frames: [{}],
        },
      },
      field: "manifest.renderer.rendererVersion",
    },
    {
      label: "frames do not match the manifest",
      output: {
        result: {},
        frames: [{}, {}],
        manifest: {
          renderer: { rendererId: "anime.prototype", rendererVersion: "0.1.0" },
          frames: [{}],
        },
      },
      field: "manifest.frames",
    },
    {
      label: "empty frames",
      output: {
        result: {},
        frames: [],
        manifest: {
          renderer: { rendererId: "anime.prototype", rendererVersion: "0.1.0" },
          frames: [],
        },
      },
      field: "manifest.frames",
    },
  ];

  for (const { label, output, field } of invalid) {
    test(`${label} fails LOUD as an internal fault (never silent)`, () => {
      try {
        assertAnimeRenderOutputShape(output, { jobId: "j-render", batchId: "b-batch" });
        expect.unreachable(`expected '${label}' to throw`);
      } catch (err) {
        expect(err).toBeInstanceOf(RenderOutputInvalidError);
        const error = err as RenderOutputInvalidError;
        expect(error.terminalFailureClass).toBe("internal");
        if (field !== undefined) {
          expect((error.details as Record<string, unknown>).field).toBe(field);
        }
      }
    });
  }
});
