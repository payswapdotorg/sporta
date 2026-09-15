import { describe, expect, test } from "bun:test";
import { RendererContractError } from "@sporta/renderer-contract";
import { projectScene } from "@sporta/scene-projection";
import type { AvatarField3dClipStep } from "../src/index";
import { render3dClip } from "../src/index";
import { SESSION_ID, build3dRequest, buildFixtureClip, buildFixtureSnapshot } from "./helpers";

describe("render3dClip — the benchmark clip path (one frame per step)", () => {
  test("6 steps → 6 frames at the step positions, per-frame real motion", () => {
    const out = render3dClip(build3dRequest(), buildFixtureClip());
    expect(out.frames).toHaveLength(6);
    expect(out.frames.map((frame) => frame.outputTimestampMs)).toEqual([
      1_000, 2_000, 3_000, 4_000, 5_000, 6_000,
    ]);
    // The striker advances 60 → 64 m (0.8 m/step): the SCREEN x moves too.
    const strikerX = out.manifest.frames.map(
      (frame) =>
        frame.entities.find((entity) => entity.entityId === "striker-9")!.screenPosition!.x,
    );
    expect(strikerX.every((x, index) => index === 0 || x > strikerX[index - 1]!)).toBe(true);
    expect(strikerX[0]).toBe(705.63);
    // 640 + 512·11.5/58.507 (d = (11.5, 55, −20) from the slot eye).
    expect(strikerX[5]).toBe(740.63);
    // TRUE meters, verbatim: 60 → 64 with z = 0 (the plane constant).
    const strikerMeters = out.manifest.frames.map(
      (frame) => frame.entities.find((entity) => entity.entityId === "striker-9")!.positionMeters,
    );
    expect(strikerMeters).toEqual([
      { x: 60, y: 30, z: 0 },
      { x: 60.8, y: 30, z: 0 },
      { x: 61.6, y: 30, z: 0 },
      { x: 62.4, y: 30, z: 0 },
      { x: 63.2, y: 30, z: 0 },
      { x: 64, y: 30, z: 0 },
    ]);
  });

  test("segments: one per step, adjacent (non-overlapping, R8 shape)", () => {
    const out = render3dClip(build3dRequest(), buildFixtureClip());
    expect(out.result.outputSegments).toHaveLength(6);
    for (let i = 0; i < 6; i += 1) {
      const segment = out.result.outputSegments[i]!;
      expect(segment.segmentId).toBe(`scene3d-${i}`);
      expect(segment.startMs).toBe((i + 1) * 1_000);
      expect(segment.endMs).toBe((i + 2) * 1_000); // last frame extends by the interval
      if (i > 0) {
        expect(segment.startMs).toBe(out.result.outputSegments[i - 1]!.endMs);
      }
    }
  });

  test("markers: every step marker is consumed (each in exactly one frame)", () => {
    const out = render3dClip(build3dRequest(), buildFixtureClip());
    // Step windows are (previous atMs, this atMs]: kickoff@1000 → step 0,
    // pass@2500 → step 2, shot@4000 → step 3, unknown@4700 → step 4,
    // goal@5500 → step 5.
    expect(out.manifest.frames.map((frame) => frame.appliedMarkerSequences)).toEqual([
      [11],
      [],
      [12],
      [13],
      [14],
      [15],
    ]);
    expect(out.manifest.skippedMarkers).toEqual([]);
    expect(out.manifest.degradation).toEqual({ degraded: false, reasons: [] });
  });

  test("provenance/watermark (the R6 analog): highest marker sequence 15", () => {
    const out = render3dClip(build3dRequest(), buildFixtureClip());
    expect(out.manifest.provenance).toEqual({ snapshotVersion: 1, lastEventSequence: 15 });
    expect(out.manifest.watermarkAfter).toEqual({ watermarkMs: 7_000, sequence: 15 });
    expect(out.manifest.session).toEqual({
      sessionId: SESSION_ID,
      snapshotVersion: 1,
      eventsSinceSequence: 0,
    });
  });

  test("watermark falls back to the LAST step's scene watermark without markers", () => {
    // One step, no markers: sequence comes from the scene's own watermark.
    const steps: AvatarField3dClipStep[] = [
      { atMs: 1_000, scene: projectScene(buildFixtureSnapshot(0)) },
    ];
    const out = render3dClip(build3dRequest(), steps);
    expect(out.manifest.watermarkAfter).toEqual({ watermarkMs: 2_000, sequence: 10 });
    expect(out.manifest.provenance.lastEventSequence).toBe(0);
  });

  test("the ball's height is carried on steps 0..4 and ABSENT on step 5", () => {
    const out = render3dClip(build3dRequest(), buildFixtureClip());
    const heights = out.manifest.frames.map((frame) => {
      const ball = frame.entities.find((entity) => entity.entityId === "ball-1")!;
      return { carried: ball.heightCarried, z: ball.positionMeters?.z };
    });
    expect(heights).toEqual([
      { carried: true, z: 1.2 },
      { carried: true, z: 1.4 },
      { carried: true, z: 1.6 },
      { carried: true, z: 1.8 },
      { carried: true, z: 2 },
      { carried: false, z: undefined },
    ]);
    // The elevated ball's screen y rises with its height (frame 0 vs 4).
    const ballY = out.frames.map(
      (_, index) =>
        out.manifest.frames[index]!.entities.find((entity) => entity.entityId === "ball-1")!
          .screenPosition!.y,
    );
    expect(ballY[4]!).toBeLessThan(ballY[0]!); // higher elevation → higher on screen
  });

  test("identity stability across frames: the striker's version bumps, its style never changes", () => {
    const out = render3dClip(build3dRequest(), buildFixtureClip());
    const striker = out.manifest.frames.map((frame) =>
      frame.entities.find((entity) => entity.entityId === "striker-9")!,
    );
    // The SWM version bumps every step (3..8) — proof that styling never
    // depends on it.
    expect(striker.map((entry) => entry.version)).toEqual([3, 4, 5, 6, 7, 8]);
    const styleTokens = striker.map((entry) => JSON.stringify(entry.style));
    expect(new Set(styleTokens).size).toBe(1);
    // Re-keyed by the 0.2.0 bump (the sanctioned restyle moment):
    expect(styleTokens[0]).toBe(
      JSON.stringify({ paletteIndex: 5, jersey: "#00b4d8", trim: "#e63946" }),
    );
  });

  test("per-frame provenance: the source watermark advances per step (10..15)", () => {
    const out = render3dClip(build3dRequest(), buildFixtureClip());
    expect(out.manifest.frames.map((frame) => frame.source.watermark.sequence)).toEqual([
      10, 11, 12, 13, 14, 15,
    ]);
    expect(out.manifest.frames.map((frame) => frame.source.watermark.watermarkMs)).toEqual([
      1_000, 2_000, 3_000, 4_000, 5_000, 6_000,
    ]);
    expect(out.manifest.frames[0]!.source.sceneSchemaVersion).toBe("1.0");
  });

  test("the camera block records the FIRST step's slot", () => {
    const out = render3dClip(build3dRequest(), buildFixtureClip());
    expect(out.manifest.camera.slotId).toBe("main-touchline");
    expect(out.manifest.camera.position).toEqual({ x: 52.5, y: -25, z: 20 });
  });

  test("each frame renders from its OWN spec's carried slot", () => {
    // Steps 0-3 carry all slots; steps 4-5 carry only the aerial slot → the
    // per-step slot resolution must frame step 4 from aerial even though the
    // manifest's camera block still records step 0's main-touchline.
    const steps = buildFixtureClip();
    steps[4] = {
      atMs: 5_000,
      scene: projectScene(buildFixtureSnapshot(4), { cameraSlotIds: ["aerial-tactical"] }),
    };
    steps[5] = {
      atMs: 6_000,
      scene: projectScene(buildFixtureSnapshot(5), { cameraSlotIds: ["aerial-tactical"] }),
    };
    const out = render3dClip(
      build3dRequest({
        styleConfig: {
          styleId: "s",
          configSchemaVersion: "1.0",
          config: { cameraSlotId: "aerial-tactical" },
        },
      }),
      steps,
    );
    expect(out.frames[4]!.svg).toContain("CAM · aerial-tactical");
    expect(out.frames[0]!.svg).toContain("CAM · aerial-tactical");
    expect(out.manifest.camera.slotId).toBe("aerial-tactical");
  });

  test("simulateDegradation is the only degradation source on the clip path", () => {
    const req = build3dRequest({
      styleConfig: {
        styleId: "s",
        configSchemaVersion: "1.0",
        config: { simulateDegradation: true },
      },
    });
    const out = render3dClip(req, buildFixtureClip());
    expect(out.manifest.degradation).toEqual({
      degraded: true,
      reasons: ["simulated-degradation"],
    });
    expect(out.result.rendererHealth.degradationReason).toBe("simulated-degradation");
  });
});

describe("render3dClip — step validation (fail-loud)", () => {
  test("an empty steps array → media-invalid", () => {
    expect(() => render3dClip(build3dRequest(), [])).toThrow(/non-empty array of clip steps/);
    expect(() => render3dClip(build3dRequest(), [])).toThrow(RendererContractError);
  });

  test("a non-step entry → media-invalid", () => {
    const steps = [null as never];
    expect(() => render3dClip(build3dRequest(), steps)).toThrow(/must be an AvatarField3dClipStep/);
  });

  test("atMs must be finite, ≥ 0, and strictly increasing", () => {
    const base = () => projectScene(buildFixtureSnapshot(0));
    expect(() => render3dClip(build3dRequest(), [{ atMs: -1, scene: base() }])).toThrow(
      /atMs must be a finite number/,
    );
    expect(() => render3dClip(build3dRequest(), [{ atMs: Number.NaN, scene: base() }])).toThrow(
      /atMs must be a finite number/,
    );
    expect(() =>
      render3dClip(build3dRequest(), [
        { atMs: 1_000, scene: base() },
        { atMs: 1_000, scene: base() },
      ]),
    ).toThrow(/strictly increasing/);
  });

  test("a missing scene → media-invalid", () => {
    const steps = [{ atMs: 1_000 } as never];
    expect(() => render3dClip(build3dRequest(), steps)).toThrow(/must be a SceneSpecification/);
  });

  test("a schema-invalid scene → media-invalid", () => {
    const scene = projectScene(buildFixtureSnapshot(0));
    const broken = { ...scene, world: 42 } as never;
    expect(() => render3dClip(build3dRequest(), [{ atMs: 1_000, scene: broken }])).toThrow(
      /not a valid SceneSpecification/,
    );
  });

  test("an incompatible scene schema version → media-invalid (fail-closed, never partial)", () => {
    const scene = projectScene(buildFixtureSnapshot(0));
    const newer = { ...scene, sceneSchemaVersion: "1.1" };
    expect(() => render3dClip(build3dRequest(), [{ atMs: 1_000, scene: newer }])).toThrow(
      /not compatible with this renderer's scene schema support/,
    );
    const future = { ...scene, sceneSchemaVersion: "2.0" };
    expect(() => render3dClip(build3dRequest(), [{ atMs: 1_000, scene: future }])).toThrow(
      /not compatible/,
    );
  });

  test("a scene from another session → media-invalid", () => {
    const scene = projectScene(buildFixtureSnapshot(0));
    const foreign = { ...scene, sessionId: "sess-other" };
    expect(() => render3dClip(build3dRequest(), [{ atMs: 1_000, scene: foreign }])).toThrow(
      /belongs to session "sess-other"/,
    );
  });

  test("admission gates re-run (rights refusal throws on the clip path too)", () => {
    const req = build3dRequest({
      rightsCapabilities: {
        canReferenceSourceFrames: false,
        canDeliverLive: false,
        canStoreDerivatives: false,
        canShare: false,
      },
      sourceFrameRefs: ["frame-9"],
    });
    expect(() => render3dClip(req, buildFixtureClip())).toThrow(RendererContractError);
    expect(() => render3dClip(req, buildFixtureClip())).toThrow(/canReferenceSourceFrames/);
  });
});

describe("render3dClip — determinism", () => {
  test("rerun over freshly built steps is deep-equal + byte-identical frames", () => {
    const a = render3dClip(build3dRequest(), buildFixtureClip());
    const b = render3dClip(build3dRequest(), buildFixtureClip());
    expect(a.result).toEqual(b.result);
    expect(a.manifest).toEqual(b.manifest);
    expect(a.frames).toEqual(b.frames);
    for (let i = 0; i < a.frames.length; i += 1) {
      expect(a.frames[i]!.svg).toBe(b.frames[i]!.svg);
    }
  });

  test("the input steps are never mutated", () => {
    const steps = buildFixtureClip();
    const before = JSON.stringify(steps);
    render3dClip(build3dRequest(), steps);
    expect(JSON.stringify(steps)).toBe(before);
  });
});
