/**
 * THE ADR-009 difference test — the acceptance-level proof that the two
 * renderers produce VISIBLY DIFFERENT videos from the SAME canonical SWM
 * scene: both plugins render the identical snapshot + event window, then
 * the SAME frame index is decoded from each REAL MP4 (actual output
 * pixels, decoded by ffmpeg — never fabricated statistics) and compared
 * through frame-level pixel statistics:
 *
 * - **mean absolute channel difference** must be MATERIAL (not encoding
 *   noise): the whole frame differs, not just a corner;
 * - **palette reduction**: the cel-shaded frame uses FEWER distinct
 *   quantized colors than the stylized-3d frame (posterization);
 * - **edge density**: the cel-shaded frame has a HIGHER fraction of
 *   high-contrast edge pixels (the bold-outline pass).
 *
 * Same-event integrity (R605 preparation) lives here too: both artifacts
 * must carry the SAME SWM provenance block and session id — visibly
 * different realities of the SAME event, never two different matches.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createAnimeNprRenderer, createGame3DRenderer, decodeFrameRgb24 } from "../../src/index";
import type { GameRealityRenderer } from "../../src/index";
import {
  CODEC,
  buildAnimeRequest,
  buildFixtureEvents,
  buildFixtureSnapshot,
  buildGame3dRequest,
} from "./helpers";

interface FrameStats {
  meanAbsDiff: number;
  uniqueColorsStylized: number;
  uniqueColorsCel: number;
  edgeFractionStylized: number;
  edgeFractionCel: number;
}

/** Computes the frame-level pixel statistics of two decoded rgb24 frames. */
function frameStatistics(a: Uint8Array, b: Uint8Array, width: number, height: number): FrameStats {
  if (a.length !== b.length) throw new Error("frame size mismatch");
  let diffSum = 0;
  let edgeStylized = 0;
  let edgeCel = 0;
  const colorsStylized = new Set<number>();
  const colorsCel = new Set<number>();
  const px = width * height;
  for (let i = 0; i < px; i += 1) {
    const o = i * 3;
    const ar = a[o] ?? 0;
    const ag = a[o + 1] ?? 0;
    const ab = a[o + 2] ?? 0;
    const br = b[o] ?? 0;
    const bg = b[o + 1] ?? 0;
    const bb = b[o + 2] ?? 0;
    diffSum += Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
    // Distinct colors quantized to 4 bits/channel (encoding-noise robust).
    colorsStylized.add(((ar >> 4) << 8) | ((ag >> 4) << 4) | (ab >> 4));
    colorsCel.add(((br >> 4) << 8) | ((bg >> 4) << 4) | (bb >> 4));
    // Edge density: high-contrast neighbor (right) — the outline signature.
    if (i % width < width - 1) {
      const o2 = o + 3;
      if (
        Math.abs(ar - (a[o2] ?? 0)) +
          Math.abs(ag - (a[o2 + 1] ?? 0)) +
          Math.abs(ab - (a[o2 + 2] ?? 0)) >
        120
      ) {
        edgeStylized += 1;
      }
      if (
        Math.abs(br - (b[o2] ?? 0)) +
          Math.abs(bg - (b[o2 + 1] ?? 0)) +
          Math.abs(bb - (b[o2 + 2] ?? 0)) >
        120
      ) {
        edgeCel += 1;
      }
    }
  }
  return {
    meanAbsDiff: diffSum / (px * 3),
    uniqueColorsStylized: colorsStylized.size,
    uniqueColorsCel: colorsCel.size,
    edgeFractionStylized: edgeStylized / px,
    edgeFractionCel: edgeCel / px,
  };
}

describe.skipIf(!CODEC.available)("ADR-009 — the two realities of one SWM scene", () => {
  const FRAME_INDEX = 24; // a mid-clip frame (event chips + camera motion visible)

  function renderBoth(): {
    stylized: ReturnType<GameRealityRenderer["renderDetailed"]>;
    cel: ReturnType<GameRealityRenderer["renderDetailed"]>;
  } {
    const snapshot = buildFixtureSnapshot();
    const events = buildFixtureEvents();
    const stylized = createGame3DRenderer().renderDetailed(buildGame3dRequest(), {
      snapshot,
      events,
    });
    const cel = createAnimeNprRenderer().renderDetailed(buildAnimeRequest(), {
      snapshot,
      events,
    });
    return { stylized, cel };
  }

  test("same scene → two REAL artifacts with materially different frames", () => {
    const { stylized, cel } = renderBoth();
    // Two distinct real artifacts (different content addresses, both probed).
    expect(stylized.contentHash).not.toBe(cel.contentHash);
    expect(stylized.probe.codecName).toBe("h264");
    expect(cel.probe.codecName).toBe("h264");

    // Decode the SAME frame from each artifact — real output pixels.
    const frameA = decodeFrameRgb24({
      path: stylized.artifactPath,
      frameIndex: FRAME_INDEX,
      widthPx: 640,
      heightPx: 360,
    });
    const frameB = decodeFrameRgb24({
      path: cel.artifactPath,
      frameIndex: FRAME_INDEX,
      widthPx: 640,
      heightPx: 360,
    });
    const stats = frameStatistics(frameA, frameB, 640, 360);

    // 1) The frames differ MATERIALLY (mean per-channel delta > 6/255
    //    across the whole frame — far beyond yuv420p encoding noise).
    expect(stats.meanAbsDiff).toBeGreaterThan(6);

    // 2) Palette reduction: the cel frame uses fewer distinct colors
    //    (posterized two-tone + flat fills vs gradients + stripes).
    expect(stats.uniqueColorsCel).toBeLessThan(stats.uniqueColorsStylized);

    // 3) Bold outlines: the cel frame is edge-denser than the stylized one.
    expect(stats.edgeFractionCel).toBeGreaterThan(stats.edgeFractionStylized);
  }, 60_000);

  test("same-event integrity (R605 preparation): identical SWM lineage", () => {
    const { stylized, cel } = renderBoth();
    // Both realities derive from the SAME canonical session + SWM window.
    expect(stylized.manifest.sessionId).toBe(cel.manifest.sessionId);
    expect(stylized.manifest.swm).toEqual(cel.manifest.swm);
    expect(stylized.manifest.swm).toEqual({ snapshotVersion: 1, lastEventSequence: 7 });
    // And the realities are the two different closed-vocabulary members.
    expect(stylized.manifest.reality).toBe("three-d-game");
    expect(cel.manifest.reality).toBe("anime-npr");
  }, 60_000);

  test("determinism: identical SWM input → byte-identical MP4s (2 runs each)", () => {
    const snapshot = buildFixtureSnapshot();
    const events = buildFixtureEvents();
    for (const [make, makeRequest] of [
      [createGame3DRenderer, buildGame3dRequest],
      [createAnimeNprRenderer, buildAnimeRequest],
    ] as const) {
      const run1 = make().renderDetailed(makeRequest(), { snapshot, events });
      const run2 = make().renderDetailed(makeRequest(), { snapshot, events });
      // Fresh plugin instances (fresh staging roots + artifact stores) —
      // the MP4 BYTES are still identical (deterministic raster + pinned
      // codec flags; the empirical determinism proof of the flag set).
      expect(run2.contentHash).toBe(run1.contentHash);
      expect(run2.artifactPath).not.toBe(run1.artifactPath); // different roots, same bytes
    }
  }, 120_000);

  test("the artifact chain is closed: segment ref ↔ manifest ↔ disk bytes ↔ re-hash", () => {
    const { stylized, cel } = renderBoth();
    for (const output of [stylized, cel]) {
      const segment = output.result.outputSegments[0]!;
      expect(segment.artifactRef).toBe(`artifact://${output.contentHash}`);
      expect(output.manifest.contentHash).toBe(output.contentHash);
      const digest = createHash("sha256").update(readFileSync(output.artifactPath)).digest("hex");
      expect(digest).toBe(output.contentHash);
      // The manifest declares the honest, measured duration.
      expect(Math.abs(output.manifest.durationMs - 1_600)).toBeLessThanOrEqual(101);
    }
  }, 60_000);
});
