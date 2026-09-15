/**
 * THE W602/W603 benchmarks (the acceptance deliverables):
 *
 * - W602: "benchmark SWM state becomes a coherent playable-style field
 *   scene using original / proprietary-safe assets."
 * - W603: "match progression rendered from SWM rather than replaying
 *   broadcast pixels" — the same fixture as an ANIMATED match timeline.
 *
 * The canonical fixture (test/helpers.ts) — a 6-step clip over one session
 * with 8 entity shapes (moving striker with version bumps, uncertain
 * winger, no-position participant, official, out-of-bounds player,
 * off-canvas corner player, non-renderable kind, moving elevated ball with
 * an absent final height) plus football state and a 5-marker stream — is
 * measured through the clip path (W602: per-frame provenance completeness,
 * disposition accounting totals, identity stability across frames, real
 * per-step motion, byte-identical determinism, scene-spec conformance, G7
 * boundary) and through the match path (W603: N snapshots → M interpolated
 * frames, interpolation provenance on every frame, identity stability
 * across ALL frames, real BETWEEN-snapshot motion, honest discontinuity
 * handling — scene cuts and disposition changes never blended across —
 * byte-identical determinism, and the game-style 25 fps cadence).
 */
import { describe, expect, test } from "bun:test";
import { runSceneConformance } from "@sporta/scene-projection";
import { projectScene } from "@sporta/scene-projection";
import { render3dClip, render3dMatch, AVATAR_FIELD_GAME_OUTPUT_PROFILE } from "../src/index";
import { AVATAR_PALETTE, FIELD_PALETTE } from "../src/index";
import type { AvatarField3dMatchStep } from "../src/index";
import {
  build3dRequest,
  buildFixtureClip,
  buildFixtureMatch,
  build3dMatchRequest,
  buildFixtureSnapshot,
} from "./helpers";

function renderBenchmark() {
  return render3dClip(build3dRequest(), buildFixtureClip());
}

function renderMatchBenchmark() {
  return render3dMatch(build3dMatchRequest(), buildFixtureMatch());
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

  test("honest 3D limitations hold (documented): the clip path never interpolates, no direction policy", () => {
    const out = renderBenchmark();
    // CLIP-path frames are discrete per-step snapshots — the striker moves
    // only because each step's SPEC carries its own position (never
    // blended; interpolation is the W603 MATCH path, benchmarked below).
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

describe("the W603 benchmark: match progression (N snapshots → M interpolated frames)", () => {
  /** The striker's manifest entry per frame (all 26). */
  function strikerSeries(out: ReturnType<typeof renderMatchBenchmark>) {
    return out.manifest.frames.map((frame) =>
      frame.entities.find((entity) => entity.entityId === "striker-9")!,
    );
  }

  test("6 snapshots → 26 animated frames at 5 fps (observed at every snapshot, interpolated between)", () => {
    const out = renderMatchBenchmark();
    expect(out.frames).toHaveLength(26);
    // Substantive self-contained SVG documents at the animated cadence.
    for (const frame of out.frames) {
      expect(
        frame.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">'),
      ).toBe(true);
      expect(frame.svg.length).toBeGreaterThan(10_000);
    }
    const kinds = out.manifest.frames.map((frame) => frame.interpolation!.kind);
    expect(kinds.filter((kind) => kind === "observed")).toHaveLength(6); // one per step
    expect(kinds[0]).toBe("observed");
    expect(kinds.slice(1, 5)).toEqual([
      "interpolated",
      "interpolated",
      "interpolated",
      "interpolated",
    ]);
  });

  test("EVERY frame's manifest carries interpolation provenance (pair + fraction, INFERRED marked)", () => {
    const out = renderMatchBenchmark();
    for (let index = 0; index < 26; index += 1) {
      const frame = out.manifest.frames[index]!;
      const interpolation = frame.interpolation!;
      expect(interpolation.fromStepIndex).toBe(Math.floor(index / 5));
      expect(interpolation.fromAtMs).toBe(1_000 + Math.floor(index / 5) * 1_000);
      if (interpolation.kind === "interpolated") {
        expect(interpolation.toStepIndex).toBe(interpolation.fromStepIndex + 1);
        expect(interpolation.toAtMs).toBe(interpolation.fromAtMs + 1_000);
        expect(interpolation.fraction).toBe(((index % 5) * 200) / 1000);
        expect(interpolation.fraction).toBeGreaterThan(0);
        expect(interpolation.fraction).toBeLessThan(1);
        // The INFERRED mark on every interpolated entity position:
        for (const entry of frame.entities) {
          if (entry.positionProvenance !== undefined) {
            expect(["interpolated", "held"]).toContain(entry.positionProvenance);
          }
        }
      } else {
        expect(interpolation.fraction).toBe(0); // observed/held: no interpolation parameter
      }
    }
    // Interpolated striker positions are marked INFERRED, never observed:
    for (const index of [1, 2, 3, 4]) {
      const striker = out.manifest.frames[index]!.entities.find(
        (entity) => entity.entityId === "striker-9",
      )!;
      expect(striker.positionProvenance).toBe("interpolated");
    }
    // Observed frames carry NO position provenance (verbatim = observed).
    for (const index of [0, 5, 25]) {
      const striker = out.manifest.frames[index]!.entities.find(
        (entity) => entity.entityId === "striker-9",
      )!;
      expect(striker.positionProvenance).toBeUndefined();
    }
  });

  test("real BETWEEN-snapshot motion: the striker advances linearly 60→64 m (0.16 m frames)", () => {
    const out = renderMatchBenchmark();
    const strikerX = strikerSeries(out).map((entry) => entry.positionMeters!.x);
    for (let index = 0; index < 26; index += 1) {
      expect(strikerX[index]).toBeCloseTo(60 + 0.16 * index, 9);
    }
    // The ball follows linearly 58→61 (0.12 m frames) with its height
    // interpolating 1.2→2.0 (0.04 m frames) UNTIL the honest gap: the last
    // step carries no height, so its approach segment renders NO z (never a
    // faked 0, never a stale height — frames 21-24).
    const ball = out.manifest.frames.map((frame) =>
      frame.entities.find((entity) => entity.entityId === "ball-1")!,
    );
    for (let index = 0; index < 26; index += 1) {
      expect(ball[index]!.positionMeters!.x).toBeCloseTo(58 + 0.12 * index, 9);
    }
    for (let index = 0; index <= 20; index += 1) {
      expect(ball[index]!.positionMeters!.z).toBeCloseTo(1.2 + 0.04 * index, 9);
    }
    for (const index of [21, 22, 23, 24, 25]) {
      expect(ball[index]!.positionMeters!.z).toBeUndefined();
    }
  });

  test("stable projection: the striker's screen track is affine (equal 1.4 px steps, constant y)", () => {
    const out = renderMatchBenchmark();
    const sx = strikerSeries(out).map((entry) => entry.screenPosition!.x);
    const sy = strikerSeries(out).map((entry) => entry.screenPosition!.y);
    // Motion parallel to the touchline at constant depth through a FIXED
    // camera: 0.16 m per frame → exactly 1.4 px per frame (the 0.8 m step
    // of the W602 clip benchmark), screen y never moves.
    for (let index = 0; index < 26; index += 1) {
      expect(sx[index]).toBeCloseTo(705.63 + 1.4 * index, 6);
      expect(sy[index]).toBe(371.24);
    }
    // The camera never moves within a segment: every frame from the same
    // carried slot (the W604 direction cut would land at a boundary).
    for (const frame of out.frames) {
      expect(frame.svg).toContain("CAM · main-touchline");
    }
  });

  test("identity stability across ALL 26 frames: style tokens byte-identical, dispositions stable", () => {
    const out = renderMatchBenchmark();
    for (const entityId of ["striker-9", "winger-7", "official-1"]) {
      const tokens = out.manifest.frames.map((frame) => {
        const entry = frame.entities.find((entity) => entity.entityId === entityId)!;
        return JSON.stringify(entry.style ?? null);
      });
      expect(new Set(tokens).size).toBe(1);
    }
    // No on-screen flicker: every entity keeps its render disposition on
    // every frame of the interpolated timeline.
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
    // The striker's SWM version is the FROM spec's between boundaries
    // (3,3,3,3,3, 4,4,4,4,4, … 8) — interpolated frames never invent a
    // version; the style never depends on it anyway (above).
    expect(strikerSeries(out).map((entry) => entry.version)).toEqual([
      3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 8,
    ]);
  });

  test("byte-identical rerun: the animated match render is fully deterministic", () => {
    const a = renderMatchBenchmark();
    const b = renderMatchBenchmark();
    expect(a.result).toEqual(b.result);
    expect(a.manifest).toEqual(b.manifest);
    for (let index = 0; index < 26; index += 1) {
      expect(a.frames[index]!.svg).toBe(b.frames[index]!.svg);
    }
  });

  test("honest discontinuity 1 — a declared scene cut is NEVER interpolated across", () => {
    const steps: AvatarField3dMatchStep[] = buildFixtureMatch();
    steps[3] = { ...steps[3]!, sceneCutBefore: true };
    const out = render3dMatch(build3dMatchRequest(), steps);
    // Frames 11-14 (t=3200..3800) hold step 2's striker at 61.6 m; frame 15
    // (t=4000) shows step 3's 62.4 — nothing in between, ever.
    const strikerX = out.manifest.frames.map(
      (frame) =>
        frame.entities.find((entity) => entity.entityId === "striker-9")!.positionMeters!.x,
    );
    expect(strikerX.slice(11, 15)).toEqual([61.6, 61.6, 61.6, 61.6]);
    expect(strikerX[15]).toBe(62.4);
    for (const index of [11, 12, 13, 14]) {
      const striker = out.manifest.frames[index]!.entities.find(
        (entity) => entity.entityId === "striker-9",
      )!;
      expect(striker.positionProvenance).toBe("held");
      expect(striker.heldReason).toBe("scene-cut");
    }
  });

  test("honest discontinuity 2 — a disposition change is accounted, never blended", () => {
    // Step 3's winger loses its position slot: the approach segment holds
    // step 2's VERBATIM winger (40, 21) with heldReason disposition-change
    // — no motion toward "nothing".
    const steps: AvatarField3dMatchStep[] = buildFixtureMatch();
    const snapshot3 = buildFixtureSnapshot(3);
    const unpositioned = snapshot3.entities.map((entity) =>
      entity.entityId === "winger-7"
        ? { ...entity, state: { teamRole: { status: "known" as const, value: "midfielder" } } }
        : entity,
    );
    steps[3] = { atMs: 4_000, scene: projectScene({ ...snapshot3, entities: unpositioned }) };
    const out = render3dMatch(build3dMatchRequest(), steps);
    for (const index of [11, 12, 13, 14]) {
      const winger = out.manifest.frames[index]!.entities.find(
        (entity) => entity.entityId === "winger-7",
      )!;
      expect(winger.positionMeters).toEqual({ x: 40, y: 21, z: 0 });
      expect(winger.positionProvenance).toBe("held");
      expect(winger.heldReason).toBe("disposition-change");
    }
  });

  test("the game-style 25 fps profile: 126 frames, 40 ms cadence, 0.032 m steps", () => {
    const req = build3dMatchRequest({ outputProfile: AVATAR_FIELD_GAME_OUTPUT_PROFILE });
    const out = render3dMatch(req, buildFixtureMatch());
    expect(out.frames).toHaveLength(126); // 25 per 1 s segment × 5 + the tail
    expect(out.manifest.output.frameIntervalMs).toBe(40);
    expect(out.frames[0]!.outputTimestampMs).toBe(1_000);
    expect(out.frames[1]!.outputTimestampMs).toBe(1_040);
    const strikerX = strikerSeries(out).map((entry) => entry.positionMeters!.x);
    for (let index = 0; index < 126; index += 1) {
      expect(strikerX[index]).toBeCloseTo(60 + 0.032 * index, 9);
    }
    // Style tokens stay byte-identical at the game cadence too.
    const tokens = out.manifest.frames.map((frame) =>
      JSON.stringify(frame.entities.find((entity) => entity.entityId === "striker-9")!.style),
    );
    expect(new Set(tokens).size).toBe(1);
  });
});
