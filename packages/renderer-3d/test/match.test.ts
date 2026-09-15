/**
 * The W603 match-progression render path (`src/render.ts` `render3dMatch`):
 * a timeline of scene specifications → one coherent animated frame sequence
 * at the output profile's frame rate, with per-frame interpolation
 * provenance (INFERRED positions marked, never claimed observed),
 * discontinuities held and accounted, a stable per-segment camera, markers
 * at their timeline positions, and score/clock display state advancing
 * exactly as the specs state it.
 */
import { describe, expect, test } from "bun:test";
import { RendererContractError } from "@sporta/renderer-contract";
import { projectScene } from "@sporta/scene-projection";
import { render3dClip, render3dMatch } from "../src/index";
import type { AvatarField3dMatchStep } from "../src/index";
import {
  ALLOW_ALL,
  SESSION_ID,
  build3dMatchRequest,
  build3dRequest,
  buildFixtureEvent,
  buildFixtureMatch,
  buildFixtureSnapshot,
} from "./helpers";

/** Renders the canonical 6-step fixture at 5 fps (26 frames). */
function renderMatch() {
  return render3dMatch(build3dMatchRequest(), buildFixtureMatch());
}

describe("render3dMatch — the frame plan (deterministic, per-segment grids)", () => {
  test("6 steps at 5 fps → 26 frames (5 per 1 s segment + the observed tail)", () => {
    const out = renderMatch();
    expect(out.frames).toHaveLength(26);
    const timestamps = out.frames.map((frame) => frame.outputTimestampMs);
    // Segment 0: 1000, 1200, 1400, 1600, 1800; then 2000, 2200, … 6000.
    expect(timestamps.slice(0, 6)).toEqual([1_000, 1_200, 1_400, 1_600, 1_800, 2_000]);
    expect(timestamps[25]).toBe(6_000);
    // Every frame timestamp is start + k·interval (a uniform grid over the
    // fixture's divisible spans).
    for (let k = 0; k < 26; k += 1) {
      expect(timestamps[k]).toBe(1_000 + k * 200);
    }
  });

  test("an OBSERVED frame sits exactly on EVERY step's atMs (never skipped)", () => {
    const out = renderMatch();
    const observedAt = out.manifest.frames
      .filter((frame) => frame.interpolation!.kind === "observed")
      .map((frame) => frame.outputTimestampMs);
    expect(observedAt).toEqual([1_000, 2_000, 3_000, 4_000, 5_000, 6_000]);
  });

  test("frame windows tile the timeline exactly (R8-shape, non-overlapping)", () => {
    const out = renderMatch();
    for (let i = 0; i < out.result.outputSegments.length; i += 1) {
      const segment = out.result.outputSegments[i]!;
      expect(segment.segmentId).toBe(`scene3d-${i}`);
      expect(segment.startMs).toBeGreaterThanOrEqual(0);
      expect(segment.endMs).toBeGreaterThan(segment.startMs);
      if (i > 0) {
        expect(segment.startMs).toBe(out.result.outputSegments[i - 1]!.endMs);
      }
    }
    // The first window starts at the timeline start; the last ends at
    // lastAtMs + interval.
    expect(out.result.outputSegments[0]!.startMs).toBe(1_000);
    expect(out.result.outputSegments[25]!.endMs).toBe(6_200);
  });

  test("the manifest output block: start, 200 ms interval, 5200 ms duration (durationMs IGNORED)", () => {
    const out = renderMatch();
    expect(out.manifest.output).toMatchObject({
      startMs: 1_000,
      frameIntervalMs: 200,
      durationMs: 5_200,
    });
    // styleConfig.durationMs (default 6000) is ignored — the timeline IS
    // the duration.
    expect(out.manifest.output.durationMs).not.toBe(6_000);
  });

  test("a single step renders ONE observed frame (its tail window)", () => {
    const steps: AvatarField3dMatchStep[] = [
      { atMs: 1_000, scene: projectScene(buildFixtureSnapshot(0)) },
    ];
    const out = render3dMatch(build3dMatchRequest(), steps);
    expect(out.frames).toHaveLength(1);
    expect(out.manifest.frames[0]!.interpolation).toEqual({
      kind: "observed",
      fromStepIndex: 0,
      fromAtMs: 1_000,
      fraction: 0,
      sceneCut: false,
    });
    expect(out.manifest.frames[0]!.windowMs).toEqual({ startMs: 1_000, endMs: 1_200 });
    expect(out.manifest.watermarkAfter).toEqual({ watermarkMs: 1_200, sequence: 10 });
  });

  test("snapshots DENSER than the frame interval follow their own observed cadence", () => {
    // Steps 300 ms apart at the 200 ms interval: each segment plans
    // ceil(300/200) = 2 frames — observed at t, interpolated at t+200
    // (fraction 2/3), the second window clipped to 100 ms.
    const steps: AvatarField3dMatchStep[] = [0, 1, 2].map((i) => ({
      atMs: 1_000 + i * 300,
      scene: projectScene(buildFixtureSnapshot(i)),
    }));
    const out = render3dMatch(build3dMatchRequest(), steps);
    expect(out.frames.map((frame) => frame.outputTimestampMs)).toEqual([
      1_000, 1_200, 1_300, 1_500, 1_600,
    ]);
    expect(out.manifest.frames[1]!.interpolation!.fraction).toBe(2 / 3);
    expect(out.manifest.frames[1]!.windowMs).toEqual({ startMs: 1_200, endMs: 1_300 });
    // Segment 1 plans the SAME two-frame cadence (the frame rate is a cap,
    // never an invention — snapshots denser than the interval keep their
    // own observed cadence; the interpolated frames fill between).
    expect(out.manifest.frames[3]!.interpolation).toMatchObject({
      kind: "interpolated",
      fromStepIndex: 1,
      toStepIndex: 2,
      fraction: 2 / 3,
    });
    expect(out.manifest.frames[3]!.windowMs).toEqual({ startMs: 1_500, endMs: 1_600 });
    // The last step's observed tail frame covers [1600, 1800).
    expect(out.manifest.frames[4]!.interpolation).toMatchObject({
      kind: "observed",
      fromStepIndex: 2,
      fraction: 0,
    });
    expect(out.manifest.frames[4]!.windowMs).toEqual({ startMs: 1_600, endMs: 1_800 });
  });

  test("the render frame budget: > 3600 planned frames is a fail-loud media-invalid", () => {
    // A 999 s span at 200 ms → ceil(999000/200) + 1 = 4996 frames.
    const steps: AvatarField3dMatchStep[] = [
      { atMs: 1_000, scene: projectScene(buildFixtureSnapshot(0)) },
      { atMs: 1_000_000, scene: projectScene(buildFixtureSnapshot(1)) },
    ];
    expect(() => render3dMatch(build3dMatchRequest(), steps)).toThrow(RendererContractError);
    expect(() => render3dMatch(build3dMatchRequest(), steps)).toThrow(
      /beyond the per-render budget of 3600 frames/,
    );
  });
});

describe("render3dMatch — per-frame interpolation provenance (the W603 honesty surface)", () => {
  test("frame 0 (on a step): observed, pair recorded, fraction 0, no per-entity marks", () => {
    const out = renderMatch();
    expect(out.manifest.frames[0]!.interpolation).toEqual({
      kind: "observed",
      fromStepIndex: 0,
      toStepIndex: 1,
      fromAtMs: 1_000,
      toAtMs: 2_000,
      fraction: 0,
      sceneCut: false,
    });
    // Observed frames carry NO per-entity position provenance (verbatim =
    // observed, the W602 default posture).
    for (const entry of out.manifest.frames[0]!.entities) {
      expect(entry.positionProvenance).toBeUndefined();
      expect(entry.heldReason).toBeUndefined();
    }
  });

  test("interpolated frames record the pair + fraction; entities are marked INFERRED/held", () => {
    const out = renderMatch();
    expect(out.manifest.frames[1]!.interpolation).toEqual({
      kind: "interpolated",
      fromStepIndex: 0,
      toStepIndex: 1,
      fromAtMs: 1_000,
      toAtMs: 2_000,
      fraction: 0.2,
      sceneCut: false,
    });
    const byId = new Map(out.manifest.frames[1]!.entities.map((entry) => [entry.entityId, entry]));
    expect(byId.get("striker-9")!.positionProvenance).toBe("interpolated");
    expect(byId.get("striker-9")!.heldReason).toBeUndefined();
    expect(byId.get("winger-7")!.positionProvenance).toBe("interpolated");
    expect(byId.get("ball-1")!.positionProvenance).toBe("interpolated");
    expect(byId.get("official-1")!.positionProvenance).toBe("interpolated");
    // Held entities are accounted with reasons:
    expect(byId.get("bench-12")).toMatchObject({
      positionProvenance: "held",
      heldReason: "position-missing",
    });
    expect(byId.get("team-home")).toMatchObject({
      positionProvenance: "held",
      heldReason: "position-missing",
    });
  });

  test("the tail frame (last step) records NO to-step (no next snapshot exists)", () => {
    const out = renderMatch();
    expect(out.manifest.frames[25]!.interpolation).toEqual({
      kind: "observed",
      fromStepIndex: 5,
      fromAtMs: 6_000,
      fraction: 0,
      sceneCut: false,
    });
    expect("toStepIndex" in out.manifest.frames[25]!.interpolation!).toBe(false);
  });

  test("fraction series within each segment: 0, 0.2, 0.4, 0.6, 0.8", () => {
    const out = renderMatch();
    for (let segment = 0; segment < 5; segment += 1) {
      const fractions = out.manifest.frames
        .slice(segment * 5, segment * 5 + 5)
        .map((frame) => frame.interpolation!.fraction);
      expect(fractions).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    }
  });

  test("per-frame source provenance: the FROM spec's watermark (held display state)", () => {
    const out = renderMatch();
    // Frames 0-4 render step 0's spec (watermark seq 10); frames 5-9 step
    // 1's (11); …; frame 25 step 5's (15).
    expect(out.manifest.frames.map((frame) => frame.source.watermark.sequence)).toEqual([
      10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 12, 12, 12, 12, 12, 13, 13, 13, 13, 13, 14, 14, 14,
      14, 14, 15,
    ]);
  });
});

describe("render3dMatch — coherent presentation (camera, clock, markers, possession)", () => {
  test("the camera is STABLE: every frame from main-touchline, the first step's slot recorded", () => {
    const out = renderMatch();
    expect(out.manifest.camera.slotId).toBe("main-touchline");
    expect(out.manifest.camera.position).toEqual({ x: 52.5, y: -25, z: 20 });
    for (const frame of out.frames) {
      expect(frame.svg).toContain("CAM · main-touchline");
    }
  });

  test("score/clock display state advances at SNAPSHOT boundaries (never ticked)", () => {
    const out = renderMatch();
    const lines = out.manifest.frames.map((frame) => frame.hud.statusLine);
    // Frames 0-4 show step 0's clock (45:04); the clock jumps at each
    // boundary — observed data, never frame-time extrapolation.
    expect(new Set(lines.slice(0, 5))).toEqual(new Set(["Second half · 45:04 · 2-1"]));
    expect(new Set(lines.slice(5, 10))).toEqual(new Set(["Second half · 45:05 · 2-1"]));
    expect(lines[25]).toBe("Second half · 45:09 · 2-1");
  });

  test("markers land at their TIMELINE positions (each in exactly one frame window)", () => {
    const out = renderMatch();
    // kickoff@1000 → frame 0 [1000,1200); pass@2500 → frame 7 [2400,2600);
    // shot@4000 → frame 15 [4000,4200); unknown@4700 → frame 18
    // [4600,4800); goal@5500 → frame 22 [5400,5600).
    const applied = out.manifest.frames.map((frame) => frame.appliedMarkerSequences);
    for (const [index, sequences] of [
      [0, [11]],
      [7, [12]],
      [15, [13]],
      [18, [14]],
      [22, [15]],
    ] as const) {
      expect(applied[index]).toEqual([...sequences]);
    }
    const all = out.manifest.frames.flatMap((frame) => frame.appliedMarkerSequences);
    expect(all).toEqual([11, 12, 13, 14, 15]);
    expect(out.manifest.skippedMarkers).toEqual([]);
    expect(out.manifest.degradation).toEqual({ degraded: false, reasons: [] });
    // The chip text is displayed in the marker's own frame:
    expect(out.manifest.frames[22]!.hud.eventChips).toEqual(["GOAL!"]);
  });

  test("markers outside the timeline are skipped + set degradation (R7 semantics)", () => {
    const markers = [
      buildFixtureEvent("fe-early", 900, "football/v1/kickoff", 16),
      buildFixtureEvent("fe-late", 6_500, "football/v1/goal", 17),
    ];
    const steps: AvatarField3dMatchStep[] = buildFixtureMatch();
    steps[0] = {
      atMs: 1_000,
      scene: projectScene(buildFixtureSnapshot(0), {
        events: [markers[0]!, ...markers.slice(0, 0)],
      }),
    };
    steps[5] = {
      atMs: 6_000,
      scene: projectScene(buildFixtureSnapshot(5), { events: [markers[1]!] }),
    };
    const out = render3dMatch(build3dMatchRequest(), steps);
    expect(out.manifest.skippedMarkers).toEqual([
      { sequence: 16, eventId: "fe-early", eventTimeMs: 900, reason: "before-window" },
      { sequence: 17, eventId: "fe-late", eventTimeMs: 6_500, reason: "after-window" },
    ]);
    expect(out.manifest.degradation).toEqual({
      degraded: true,
      reasons: ["markers-outside-render-window"],
    });
    // lastEventSequence reports only APPLIED markers (never the skipped):
    // the highest APPLIED sequence here is 14 (the unknown@4700 marker in
    // steps 1-4's untouched scenes) — strictly below both skipped sequences
    // (16/17), proving the skipped ones are never counted.
    expect(out.manifest.provenance.lastEventSequence).toBe(14);
    // watermarkAfter.sequence never less than anything consumed:
    expect(out.manifest.watermarkAfter.sequence).toBe(17);
  });

  test("duplicate marker sequences across steps are deduplicated (first occurrence)", () => {
    const marker = buildFixtureEvent("fe-pass", 2_500, "football/v1/pass", 12);
    const steps: AvatarField3dMatchStep[] = buildFixtureMatch();
    // The same sequence carried by BOTH step 1 and step 2's specs:
    steps[1] = { atMs: 2_000, scene: projectScene(buildFixtureSnapshot(1), { events: [marker] }) };
    steps[2] = { atMs: 3_000, scene: projectScene(buildFixtureSnapshot(2), { events: [marker] }) };
    const out = render3dMatch(build3dMatchRequest(), steps);
    const all = out.manifest.frames.flatMap((frame) => frame.appliedMarkerSequences);
    expect(all.filter((sequence) => sequence === 12)).toEqual([12]); // once
  });

  test("possession is displayed every frame (the ring follows the INTERPOLATED striker)", () => {
    const out = renderMatch();
    expect(out.manifest.frames.every((frame) => frame.possession?.displayed === true)).toBe(true);
    // The ring's anchor moves with the striker's interpolated positions:
    const ringX = out.manifest.frames
      .slice(0, 5)
      .map(
        (frame) =>
          frame.entities.find((entity) => entity.entityId === "striker-9")!.screenPosition!.x,
      );
    expect(ringX[0]!).toBeLessThan(ringX[4]!);
  });

  test("simulateDegradation is an explicit degradation source on the match path", () => {
    const req = build3dMatchRequest({
      styleConfig: {
        styleId: "s",
        configSchemaVersion: "1.0",
        config: { simulateDegradation: true },
      },
    });
    const out = render3dMatch(req, buildFixtureMatch());
    expect(out.manifest.degradation).toEqual({
      degraded: true,
      reasons: ["simulated-degradation"],
    });
    expect(out.result.rendererHealth.degradationReason).toBe("simulated-degradation");
  });
});

describe("render3dMatch — provenance/watermark (R5/R6 analogs)", () => {
  test("watermarkAfter = render end; sequence = max(last scene watermark, max marker)", () => {
    const out = renderMatch();
    expect(out.manifest.watermarkAfter).toEqual({ watermarkMs: 6_200, sequence: 15 });
    expect(out.manifest.provenance).toEqual({ snapshotVersion: 1, lastEventSequence: 15 });
    expect(out.manifest.session).toEqual({
      sessionId: SESSION_ID,
      snapshotVersion: 1,
      eventsSinceSequence: 0,
    });
  });

  test("no markers → the LAST step's scene watermark governs the sequence", () => {
    const steps: AvatarField3dMatchStep[] = [
      { atMs: 1_000, scene: projectScene(buildFixtureSnapshot(0)) },
      { atMs: 2_000, scene: projectScene(buildFixtureSnapshot(1)) },
    ];
    const out = render3dMatch(build3dMatchRequest(), steps);
    expect(out.manifest.watermarkAfter).toEqual({ watermarkMs: 2_200, sequence: 11 });
    expect(out.manifest.provenance.lastEventSequence).toBe(0);
  });
});

describe("render3dMatch — the scene-cut boundary (declared, never interpolated across)", () => {
  /** The fixture with a declared cut into step 3 (t = 4000). */
  function cutFixture(): AvatarField3dMatchStep[] {
    const steps = buildFixtureMatch();
    steps[3] = { ...steps[3]!, sceneCutBefore: true };
    return steps;
  }

  test("frames strictly between the cut pair HOLD the from-spec verbatim", () => {
    const out = render3dMatch(build3dMatchRequest(), cutFixture());
    // Segment 2→3 covers frames 10-14: frame 10 observed (t=3000); frames
    // 11-14 (t=3200..3800) HELD on step 2's scene.
    for (const index of [11, 12, 13, 14]) {
      expect(out.manifest.frames[index]!.interpolation).toMatchObject({
        kind: "held",
        fromStepIndex: 2,
        toStepIndex: 3,
        fraction: 0,
        sceneCut: true,
      });
      // The striker stays at step 2's VERBATIM position — no lerp toward
      // step 3's:
      const striker = out.manifest.frames[index]!.entities.find(
        (entity) => entity.entityId === "striker-9",
      )!;
      expect(striker.positionMeters).toEqual({ x: 61.6, y: 30, z: 0 });
      expect(striker.positionProvenance).toBe("held");
      expect(striker.heldReason).toBe("scene-cut");
      // EVERY entity is held on a cut-governed frame:
      for (const entry of out.manifest.frames[index]!.entities) {
        expect(entry.positionProvenance).toBe("held");
        expect(entry.heldReason).toBe("scene-cut");
      }
    }
    // The cut lands AT the boundary: frame 15 (t=4000) is step 3 observed.
    expect(out.manifest.frames[15]!.interpolation).toMatchObject({
      kind: "observed",
      fromStepIndex: 3,
    });
    expect(
      out.manifest.frames[15]!.entities.find((entity) => entity.entityId === "striker-9")!
        .positionMeters,
    ).toEqual({ x: 62.4, y: 30, z: 0 });
  });

  test("no frame ever shows a position BETWEEN the cut pair (never blended)", () => {
    const out = render3dMatch(build3dMatchRequest(), cutFixture());
    const strikerX = out.manifest.frames.map(
      (frame) =>
        frame.entities.find((entity) => entity.entityId === "striker-9")!.positionMeters!.x,
    );
    // Frames 11-14 all read 61.6; frame 15 reads 62.4 — nothing between.
    expect(strikerX.slice(11, 15)).toEqual([61.6, 61.6, 61.6, 61.6]);
    expect(strikerX[15]).toBe(62.4);
  });

  test("segments around the cut interpolate NORMALLY (the cut is boundary-local)", () => {
    const out = render3dMatch(build3dMatchRequest(), cutFixture());
    expect(out.manifest.frames[1]!.interpolation).toMatchObject({ kind: "interpolated" });
    expect(out.manifest.frames[16]!.interpolation).toMatchObject({ kind: "interpolated" });
  });

  test("the clip path is UNAFFECTED by the declared flag (per-step truth, W602)", () => {
    // sceneCutBefore is match-path vocabulary; render3dClip ignores it.
    const out = render3dClip(build3dRequest(), cutFixture());
    expect(out.frames).toHaveLength(6);
    expect(out.manifest.frames.every((frame) => frame.interpolation === undefined)).toBe(true);
  });
});

describe("render3dMatch — step validation (fail-loud)", () => {
  test("an empty steps array → media-invalid", () => {
    expect(() => render3dMatch(build3dMatchRequest(), [])).toThrow(
      /non-empty array of match steps/,
    );
    expect(() => render3dMatch(build3dMatchRequest(), [])).toThrow(RendererContractError);
  });

  test("a non-step entry → media-invalid", () => {
    expect(() => render3dMatch(build3dMatchRequest(), [null as never])).toThrow(
      /must be an AvatarField3dMatchStep/,
    );
  });

  test("atMs must be finite, ≥ 0, strictly increasing", () => {
    const base = () => projectScene(buildFixtureSnapshot(0));
    expect(() => render3dMatch(build3dMatchRequest(), [{ atMs: -1, scene: base() }])).toThrow(
      /atMs must be a finite number/,
    );
    expect(() =>
      render3dMatch(build3dMatchRequest(), [
        { atMs: 1_000, scene: base() },
        { atMs: 1_000, scene: base() },
      ]),
    ).toThrow(/strictly increasing/);
  });

  test("sceneCutBefore must be a boolean when present (never a truthy coercion)", () => {
    const steps: AvatarField3dMatchStep[] = [
      { atMs: 1_000, scene: projectScene(buildFixtureSnapshot(0)) },
      { atMs: 2_000, scene: projectScene(buildFixtureSnapshot(1)), sceneCutBefore: "yes" as never },
    ];
    expect(() => render3dMatch(build3dMatchRequest(), steps)).toThrow(
      /sceneCutBefore must be a boolean/,
    );
  });

  test("a missing scene → media-invalid", () => {
    expect(() => render3dMatch(build3dMatchRequest(), [{ atMs: 1_000 } as never])).toThrow(
      /must be a SceneSpecification/,
    );
  });

  test("a schema-invalid scene → media-invalid", () => {
    const scene = projectScene(buildFixtureSnapshot(0));
    const broken = { ...scene, world: 42 } as never;
    expect(() => render3dMatch(build3dMatchRequest(), [{ atMs: 1_000, scene: broken }])).toThrow(
      /not a valid SceneSpecification/,
    );
  });

  test("an incompatible scene schema version → media-invalid (fail-closed)", () => {
    const scene = projectScene(buildFixtureSnapshot(0));
    const newer = { ...scene, sceneSchemaVersion: "1.1" };
    expect(() => render3dMatch(build3dMatchRequest(), [{ atMs: 1_000, scene: newer }])).toThrow(
      /not compatible/,
    );
  });

  test("a scene from another session → media-invalid", () => {
    const scene = projectScene(buildFixtureSnapshot(0));
    const foreign = { ...scene, sessionId: "sess-other" };
    expect(() => render3dMatch(build3dMatchRequest(), [{ atMs: 1_000, scene: foreign }])).toThrow(
      /belongs to session "sess-other"/,
    );
  });

  test("a REGRESSING snapshot watermark → media-invalid (mixed replay branches)", () => {
    const steps: AvatarField3dMatchStep[] = [
      { atMs: 1_000, scene: projectScene(buildFixtureSnapshot(1)) }, // seq 11
      { atMs: 2_000, scene: projectScene(buildFixtureSnapshot(0)) }, // seq 10 < 11
    ];
    expect(() => render3dMatch(build3dMatchRequest(), steps)).toThrow(/mixed replay branches/);
    expect(() => render3dMatch(build3dMatchRequest(), steps)).toThrow(RendererContractError);
  });

  test("EQUAL watermark sequences are accepted (non-decreasing, not strictly increasing)", () => {
    const steps: AvatarField3dMatchStep[] = [
      { atMs: 1_000, scene: projectScene(buildFixtureSnapshot(0)) },
      { atMs: 2_000, scene: projectScene(buildFixtureSnapshot(0)) },
    ];
    expect(() => render3dMatch(build3dMatchRequest(), steps)).not.toThrow();
  });

  test("an uncarried camera slot on ANY step → media-invalid up front (step-named)", () => {
    const steps: AvatarField3dMatchStep[] = buildFixtureMatch();
    steps[1] = {
      atMs: 2_000,
      scene: projectScene(buildFixtureSnapshot(1), { cameraSlotIds: ["aerial-tactical"] }),
    };
    expect(() => render3dMatch(build3dMatchRequest(), steps)).toThrow(
      /clip steps\[1\].scene carries camera slots/,
    );
  });

  test("admission gates re-run on the match path (rights fail-closed, R2-beyond)", () => {
    const req = build3dMatchRequest({
      rightsCapabilities: {
        canReferenceSourceFrames: false,
        canDeliverLive: false,
        canStoreDerivatives: false,
        canShare: false,
      },
      sourceFrameRefs: ["frame-9"],
    });
    expect(() => render3dMatch(req, buildFixtureMatch())).toThrow(RendererContractError);
    expect(() => render3dMatch(req, buildFixtureMatch())).toThrow(/canReferenceSourceFrames/);
  });

  test("the full-deny rights WITHOUT carried refs still renders (the gate is carried-refs)", () => {
    const req = build3dMatchRequest({ rightsCapabilities: ALLOW_ALL, sourceFrameRefs: [] });
    expect(() => render3dMatch(req, buildFixtureMatch())).not.toThrow();
  });
});

describe("render3dMatch — determinism + purity", () => {
  test("rerun over freshly built steps is deep-equal + byte-identical frames", () => {
    const a = render3dMatch(build3dMatchRequest(), buildFixtureMatch());
    const b = render3dMatch(build3dMatchRequest(), buildFixtureMatch());
    expect(a.result).toEqual(b.result);
    expect(a.manifest).toEqual(b.manifest);
    expect(a.frames).toEqual(b.frames);
    for (let i = 0; i < a.frames.length; i += 1) {
      expect(a.frames[i]!.svg).toBe(b.frames[i]!.svg);
    }
  });

  test("the input steps are never mutated", () => {
    const steps = buildFixtureMatch();
    const before = JSON.stringify(steps);
    render3dMatch(build3dMatchRequest(), steps);
    expect(JSON.stringify(steps)).toBe(before);
  });
});
