/**
 * End-to-end evaluation tests (W503): the metrics run over the REAL W502
 * renderer output on both render paths —
 *
 * - the CLIP path (`renderAnimeClip`, covered by `fixture.test.ts`);
 * - the renderer-contract SINGLE-SNAPSHOT path via the plugin
 *   (`createAnimePrototypeRenderer().renderDetailed`) — the W501 seam a
 *   host actually drives, with positions honestly held between watermarks;
 * - the same path resolved through the `RendererRegistry` (the
 *   `@sporta/renderer-contract` plugin registry) — proving the evaluation
 *   works at the architecture's plugin boundary, not just via direct
 *   function calls.
 */
import { describe, expect, test } from "bun:test";
import { RendererRegistry } from "@sporta/renderer-contract";
import {
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  createAnimePrototypeRenderer,
} from "@sporta/renderer-anime";
import type { AnimePrototypeRenderer } from "@sporta/renderer-anime";
import {
  buildW503EventStream,
  buildW503RenderRequest,
  buildW503Snapshot,
  evaluateRenderOutput,
} from "../src/index";

/** The single-snapshot render input: fixture snapshot 0 + the 5-event stream. */
function snapshotInput() {
  return { snapshot: buildW503Snapshot(0), events: buildW503EventStream() };
}

describe("e2e — the renderer-contract single-snapshot path (plugin seam)", () => {
  const plugin = createAnimePrototypeRenderer();
  const output = plugin.renderDetailed(buildW503RenderRequest(), snapshotInput());
  const report = evaluateRenderOutput(output);

  test("6 frames at 1 fps over the default 6 s duration", () => {
    expect(output.frames).toHaveLength(6);
    expect(output.manifest.frames.map((frame) => frame.outputTimestampMs)).toEqual([
      1_000, 2_000, 3_000, 4_000, 5_000, 6_000,
    ]);
  });

  test("positions are HELD (the honest single-snapshot rendering): zero drift", () => {
    expect(report.geometry.measuredPairCount).toBe(25);
    expect(report.geometry.jumpCount).toBe(0);
    expect(report.geometry.maxDisplacementMeters).toBe(0);
    expect(report.geometry.maxJumpMeters).toBe(0);
    expect(report.geometry.maxJumpRatio).toBe(0);
  });

  test("equal watermarks across frames are not regressions (PASS)", () => {
    expect(report.artifacts.watermarkSequenceRegressionCount).toBe(0);
    expect(report.artifacts.watermarkTimeRegressionCount).toBe(0);
  });

  test("captions evolve per frame while geometry is held (VERDICT PASS)", () => {
    expect(report.verdict.pass).toBe(true);
    expect(report.verdict.failures).toEqual([]);
    // Frame windows [1000,2000) .. [6000,7000): kickoff@1000, pass@2500,
    // shot@4000 (+ the uncaptionable 4700), goal@5500, none in [6000,7000).
    expect(
      output.manifest.frames.map((frame) => frame.captions.events.map((event) => event.phrase)),
    ).toEqual([["Kick-off"], ["Pass"], [], ["Shot!"], ["GOAL!"], []]);
  });

  test("every event is applied exactly once (sequences 11..15)", () => {
    const applied = output.manifest.frames.flatMap((frame) => frame.appliedEventSequences);
    expect(applied).toEqual([11, 12, 13, 14, 15]);
    expect(report.artifacts.appliedDuplicateCount).toBe(0);
    expect(report.artifacts.appliedGapCount).toBe(0);
  });
});

describe("e2e — the same render through the RendererRegistry (W501 seam)", () => {
  test("resolve the anime plugin from a fresh registry and evaluate its render", () => {
    const registry = new RendererRegistry();
    registry.register(createAnimePrototypeRenderer());
    const resolved = registry.resolve(ANIME_RENDERER_ID, ANIME_RENDERER_VERSION);
    // The registry types the plugin as the contract interface; the manifest
    // detail is the W502 package-level surface (checked at runtime).
    expect(typeof (resolved as AnimePrototypeRenderer).renderDetailed).toBe("function");
    const output = (resolved as AnimePrototypeRenderer).renderDetailed(
      buildW503RenderRequest(),
      snapshotInput(),
    );
    const report = evaluateRenderOutput(output);
    expect(report.input.rendererId).toBe(ANIME_RENDERER_ID);
    expect(report.input.rendererVersion).toBe(ANIME_RENDERER_VERSION);
    expect(report.verdict.pass).toBe(true);
    expect(report.identity.styleStabilityRatio).toBe(1);
    expect(report.styleBytes!.stabilityRatio).toBe(1);
  });
});

describe("e2e — determinism of the full evaluation pipeline", () => {
  test("two full render+evaluate cycles are deep-equal", () => {
    const renderOnce = () => {
      const plugin = createAnimePrototypeRenderer();
      return evaluateRenderOutput(plugin.renderDetailed(buildW503RenderRequest(), snapshotInput()));
    };
    expect(renderOnce()).toEqual(renderOnce());
  });
});
