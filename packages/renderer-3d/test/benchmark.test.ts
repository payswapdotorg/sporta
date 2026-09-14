/**
 * THE W602 benchmark (the acceptance deliverable): "benchmark SWM state
 * becomes a coherent playable-style field scene using original /
 * proprietary-safe assets."
 *
 * The canonical fixture (test/helpers.ts) — a 6-step clip over one session
 * with 8 entity shapes (moving striker with version bumps, uncertain
 * winger, no-position participant, official, out-of-bounds player,
 * off-canvas corner player, non-renderable kind, moving elevated ball with
 * an absent final height) plus football state and a 5-marker stream — is
 * rendered through the clip path and measured for: per-frame provenance
 * completeness, disposition accounting totals, identity stability across
 * frames, real per-step motion, byte-identical determinism, scene-spec
 * conformance (W601) of every step, and the G7 boundary (every color/
 * phrase/geometry constant is a documented in-package original).
 */
import { describe, expect, test } from "bun:test";
import { runSceneConformance } from "@sporta/scene-projection";
import { render3dClip } from "../src/index";
import { AVATAR_PALETTE, FIELD_PALETTE } from "../src/index";
import { build3dRequest, buildFixtureClip } from "./helpers";

function renderBenchmark() {
  return render3dClip(build3dRequest(), buildFixtureClip());
}

describe("the W602 benchmark: SWM state → coherent 3D-style field scene", () => {
  test("6 frames render, each a complete self-contained SVG document", () => {
    const out = renderBenchmark();
    expect(out.frames).toHaveLength(6);
    for (const frame of out.frames) {
      expect(
        frame.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">'),
      ).toBe(true);
      expect(frame.svg.endsWith("</svg>")).toBe(true);
      expect(frame.svg).not.toContain("<script");
    }
  });

  test("every frame records its full provenance (watermark, football state, schema version)", () => {
    const out = renderBenchmark();
    for (let index = 0; index < 6; index += 1) {
      const frame = out.manifest.frames[index]!;
      expect(frame.frameIndex).toBe(index);
      expect(frame.outputTimestampMs).toBe((index + 1) * 1_000);
      expect(frame.source.watermark).toEqual({
        sequence: 10 + index,
        watermarkMs: (index + 1) * 1_000,
      });
      expect(frame.source.generatedAtMs).toBe(1_736_164_800_000);
      expect(frame.source.footballState).toBe(true);
      expect(frame.source.sceneSchemaVersion).toBe("1.0");
    }
  });

  test("total accounting: every spec entity appears in every frame's manifest", () => {
    const out = renderBenchmark();
    for (const frame of out.manifest.frames) {
      expect(frame.entities).toHaveLength(8);
      expect(frame.entities.map((entity) => entity.entityId)).toEqual([
        "striker-9",
        "winger-7",
        "bench-12",
        "official-1",
        "outlier-8",
        "corner-player",
        "team-home",
        "ball-1",
      ]);
    }
  });

  test("the disposition vocabulary is exercised end-to-end (all 8 render dispositions)", () => {
    const out = renderBenchmark();
    const frame0 = out.manifest.frames[0]!;
    const byId = new Map(frame0.entities.map((entry) => [entry.entityId, entry]));
    expect(byId.get("striker-9")!.renderDisposition).toBe("rendered");
    expect(byId.get("winger-7")!.renderDisposition).toBe("rendered");
    expect(byId.get("bench-12")!.renderDisposition).toBe("omitted-no-position");
    expect(byId.get("official-1")!.renderDisposition).toBe("rendered");
    expect(byId.get("outlier-8")!.renderDisposition).toBe("rendered-out-of-play");
    expect(byId.get("corner-player")!.renderDisposition).toBe("omitted-off-canvas");
    expect(byId.get("team-home")!.renderDisposition).toBe("not-rendered-kind");
    expect(byId.get("ball-1")!.renderDisposition).toBe("rendered");
    // (omitted-behind-camera is the near-band disposition — pinned in the
    // scene tests with exotic slot geometry; canonical slots never hit it.)
  });

  test("coherence: real per-step motion (striker 60→64 m, ball 58→61 m elevated)", () => {
    const out = renderBenchmark();
    const striker = out.manifest.frames.map((frame) =>
      frame.entities.find((entity) => entity.entityId === "striker-9")!,
    );
    expect(striker.map((entry) => entry.positionMeters!.x)).toEqual([
      60, 60.8, 61.6, 62.4, 63.2, 64,
    ]);
    // Screen x advances 7 px/step (the true 0.8 m at ~58.5 m depth through
    // the 512 px focal); screen y is constant (the striker walks parallel
    // to the touchline — honest slot geometry, never re-framed).
    expect(striker.map((entry) => entry.screenPosition!.x)).toEqual([
      705.63, 712.63, 719.63, 726.63, 733.63, 740.63,
    ]);
    expect(striker.map((entry) => entry.screenPosition!.y)).toEqual([
      371.24, 371.24, 371.24, 371.24, 371.24, 371.24,
    ]);
    const ball = out.manifest.frames.map((frame) =>
      frame.entities.find((entity) => entity.entityId === "ball-1")!,
    );
    expect(ball.map((entry) => entry.positionMeters!.x)).toEqual([58, 58.6, 59.2, 59.8, 60.4, 61]);
    // The ball's height series (carried 1.2..2.0, ABSENT on the last step).
    expect(ball.map((entry) => [entry.heightCarried, entry.positionMeters?.z])).toEqual([
      [true, 1.2],
      [true, 1.4],
      [true, 1.6],
      [true, 1.8],
      [true, 2],
      [false, undefined],
    ]);
  });

  test("identity stability: styles byte-identical across frames while versions bump", () => {
    const out = renderBenchmark();
    for (const entityId of ["striker-9", "winger-7", "official-1"]) {
      const tokens = out.manifest.frames.map((frame) => {
        const entry = frame.entities.find((entity) => entity.entityId === entityId)!;
        return JSON.stringify(entry.style ?? null);
      });
      expect(new Set(tokens).size).toBe(1);
    }
    // The striker's SWM version bumps 3..8 (an upsert per frame) — the
    // no-flicker proof that styling is (styleKey, entityId)-pure.
    expect(
      out.manifest.frames.map(
        (frame) => frame.entities.find((entity) => entity.entityId === "striker-9")!.version,
      ),
    ).toEqual([3, 4, 5, 6, 7, 8]);
  });

  test("the on-screen presence never flickers: dispositions are stable across frames", () => {
    const out = renderBenchmark();
    for (const entityId of [
      "striker-9",
      "winger-7",
      "bench-12",
      "official-1",
      "outlier-8",
      "corner-player",
      "team-home",
      "ball-1",
    ]) {
      const dispositions = out.manifest.frames.map((frame) => {
        const entry = frame.entities.find((entity) => entity.entityId === entityId)!;
        return entry.renderDisposition;
      });
      expect(new Set(dispositions).size).toBe(1);
    }
  });

  test("every step's scene spec PASSES the W601 conformance harness", () => {
    for (const step of buildFixtureClip()) {
      const report = runSceneConformance(step.scene);
      expect(report.passed).toBe(true);
      expect(report.checks.every((check) => check.passed)).toBe(true);
    }
  });

  test("byte-identical reruns: the whole benchmark is deterministic", () => {
    const a = renderBenchmark();
    const b = renderBenchmark();
    expect(a.result).toEqual(b.result);
    expect(a.manifest).toEqual(b.manifest);
    for (let i = 0; i < 6; i += 1) {
      expect(a.frames[i]!.svg).toBe(b.frames[i]!.svg);
      expect(a.frames[i]!.svg.length).toBeGreaterThan(10_000); // substantive frames
    }
  });

  test("the marker stream is fully consumed (5 markers, one frame each, all accounted)", () => {
    const out = renderBenchmark();
    const all = out.manifest.frames.flatMap((frame) => frame.appliedMarkerSequences);
    expect(all).toEqual([11, 12, 13, 14, 15]);
    expect(out.manifest.skippedMarkers).toEqual([]);
    expect(out.manifest.provenance.lastEventSequence).toBe(15);
  });

  test("G7 boundary: every color is a documented in-package original (no proprietary assets)", () => {
    // The avatar palette and the field palette are this package's own flat
    // color constants (see RENDERER.md §4 and style.ts/svg.ts); the pitch
    // geometry is the spec's IFAB Law 1 constants. No external asset is
    // referenced anywhere in the output documents.
    expect(AVATAR_PALETTE.length).toBe(8);
    expect(new Set(AVATAR_PALETTE.map((style) => style.jersey)).size).toBe(8);
    expect(FIELD_PALETTE.lines).toBe("#eef4ea");
    const out = renderBenchmark();
    for (const frame of out.frames) {
      expect(frame.svg).not.toContain("href");
      expect(frame.svg).not.toContain("<image");
      expect((frame.svg.match(/http:\/\//g) ?? []).length).toBe(1); // the xmlns only
    }
  });

  test("honest 3D limitations hold (documented): no interpolation, no direction policy", () => {
    const out = renderBenchmark();
    // Frames are discrete per-step snapshots — the striker moves only
    // because each step's SPEC carries its own position (never blended).
    const strikerX = out.manifest.frames.map(
      (frame) =>
        frame.entities.find((entity) => entity.entityId === "striker-9")!.positionMeters!.x,
    );
    expect(strikerX).toEqual([60, 60.8, 61.6, 62.4, 63.2, 64]); // 0.8 m steps, no interpolation
    // One camera slot for the whole clip: the renderer never directs.
    expect(out.manifest.camera.slotId).toBe("main-touchline");
    for (const frame of out.frames) {
      expect(frame.svg).toContain("CAM · main-touchline");
    }
  });
});
