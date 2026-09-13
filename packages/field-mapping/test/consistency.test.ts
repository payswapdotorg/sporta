import { describe, expect, test } from "bun:test";
import { Observation } from "@sporta/contracts";
import {
  FixtureFieldCalibrator,
  type CalibratorFrameInput,
  type FieldCornerSet,
} from "../src/calibrator";
import { createPitchProjector, type PitchProjector } from "../src/project";
import { emitFieldMappingObservation, validateFieldMappingObservation } from "../src/observe";

/**
 * W203 ACCEPT-CRITERION PROOF (benchmark-clip simulation): "field
 * coordinates can be mapped consistently for benchmark clips."
 *
 * SCENE: 100 frames (decodeOrder 0..99, 25 fps -> presentationMs = 40 * d),
 * 160x90 rgb24 frames (the fixture calibrator ignores pixel content), a
 * fixed 5x5 image grid (u, v in {0, 0.25, 0.5, 0.75, 1}) projected through a
 * projector rebuilt from every frame's calibration.
 *
 * SWEEP MATH (documented once, honored exactly):
 *
 *   pan(d) = 0.25 + 0.5 * d / 99          // slow sweep 0.25 -> 0.75
 *   per-frame pan step = 0.5 / 99 ~ 0.0050505
 *   window x0(d) = pan(d) * (105 - visLength)
 *   inter-frame window shift = step * (105 - visLength)
 *     zoom 1: 0.5/99 * 52.5  = 26.25/99 ~ 0.2652 m  <- exact movement of every
 *                                                       grid point (x only; the
 *                                                       camera is affine and pan
 *                                                       does not touch y)
 *     zoom 2: 0.5/99 * 78.75 ~ 0.3977 m
 *
 * Zoom 2 + jitter adds bounded wobble on top of the shift: each corner's
 * jitter phase advances by 7 (mod 100) per frame, so a corner offset changes
 * by at most 0.99 * jitter ~ 0.0093 image units between adjacent frames,
 * i.e. at most ~0.25 m of projection movement at zoom 2 — total inter-frame
 * movement stays far below the 3 m smoothness bound.
 *
 * Bounds: for pan in [0.25, 0.75] the visible window lies inside the pitch
 * with margins (zoom 1: x in [13.125, 91.875]; zoom 2: x in [19.6875, 85.3125]
 * at the extremes; y margins are even larger), so every grid point — and in
 * particular the CENTER image point (0.5, 0.5) — projects in bounds for every
 * frame of the sweep, jitter wobble included.
 *
 * No `Date.now`, no `Math.random` — every number is a constant or derived
 * deterministically from `d`.
 */

const FRAME_COUNT = 100;
const FRAME_MS = 40; // 25 fps
const FRAME_W = 160;
const FRAME_H = 90;
const SESSION_ID = "sess-w203-consistency";
const SMOOTHNESS_BOUND_M = 3;

const GRID: ReadonlyArray<{ x: number; y: number }> = (() => {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= 4; i += 1) {
    for (let j = 0; j <= 4; j += 1) {
      points.push({ x: i / 4, y: j / 4 });
    }
  }
  return points;
})();

function makeFrame(decodeOrder: number): CalibratorFrameInput {
  return {
    frameId: `f-0-${decodeOrder}`,
    presentationMs: decodeOrder * FRAME_MS,
    width: FRAME_W,
    height: FRAME_H,
    bytes: new Uint8Array(FRAME_W * FRAME_H * 3),
    decodeOrder,
  };
}

/** The slow pan sweep: 0.25 at frame 0, 0.75 at frame 99. */
function panAt(decodeOrder: number): number {
  return 0.25 + (0.5 * decodeOrder) / (FRAME_COUNT - 1);
}

const FRAMES = Array.from({ length: FRAME_COUNT }, (_, d) => makeFrame(d));

interface SweepResult {
  /** Per frame: the 25 grid projections, in grid order. */
  projections: Array<Array<{ x: number; y: number; inBounds: boolean }>>;
  cornerSets: FieldCornerSet[];
}

function runSweep(spec: { zoom: number; jitter: number }): SweepResult {
  const projections: SweepResult["projections"] = [];
  const cornerSets: FieldCornerSet[] = [];
  for (const frame of FRAMES) {
    const calibrator = new FixtureFieldCalibrator({
      pan: panAt(frame.decodeOrder),
      zoom: spec.zoom,
      jitter: spec.jitter,
    });
    const cornerSet = calibrator.calibrate(frame);
    cornerSets.push(cornerSet);
    const projector: PitchProjector = createPitchProjector(cornerSet);
    projections.push(GRID.map((point) => projector.project(point)));
  }
  return { projections, cornerSets };
}

describe("consistency (W203 accept criterion) — 100-frame pan-sweep benchmark clip", () => {
  const primary = runSweep({ zoom: 1, jitter: 0 });

  test("(a) same frame twice -> identical results (calibrate -> project is pure)", () => {
    for (const frame of FRAMES) {
      const calibrator = new FixtureFieldCalibrator({
        pan: panAt(frame.decodeOrder),
        zoom: 1,
        jitter: 0,
      });
      const first = calibrator.calibrate(frame);
      const second = calibrator.calibrate(frame);
      expect(first).toEqual(second); // deterministic calibration
      const projectorA = createPitchProjector(first);
      const projectorB = createPitchProjector(second);
      for (const point of GRID) {
        const a = projectorA.project(point);
        expect(a).toEqual(projectorB.project(point));
        expect(a).toEqual(projectorA.project(point)); // repeated call, same projector
      }
    }
  });

  test("(b) adjacent frames move smoothly: every grid point < 3 m per frame", () => {
    let maxMove = 0;
    for (let d = 0; d + 1 < FRAME_COUNT; d += 1) {
      const now = primary.projections[d]!;
      const next = primary.projections[d + 1]!;
      for (let g = 0; g < GRID.length; g += 1) {
        const a = now[g]!;
        const b = next[g]!;
        const distance = Math.hypot(b.x - a.x, b.y - a.y);
        expect(distance).toBeLessThan(SMOOTHNESS_BOUND_M);
        maxMove = Math.max(maxMove, distance);
      }
    }
    // Tightened, hand-derived bound: the affine camera slides the window by
    // exactly (0.5 / 99) * (105 - 52.5) = 26.25/99 ~ 0.2652 m per frame in x
    // (y does not move at all — pan is horizontal only).
    expect(maxMove).toBeGreaterThan(0);
    expect(maxMove).toBeLessThanOrEqual(26.25 / 99 + 1e-9);
  });

  test("(b, zoom 2 + jitter) smoothness still holds with wobble on top", () => {
    const jittered = runSweep({ zoom: 2, jitter: 0.01 });
    let maxMove = 0;
    for (let d = 0; d + 1 < FRAME_COUNT; d += 1) {
      const now = jittered.projections[d]!;
      const next = jittered.projections[d + 1]!;
      for (let g = 0; g < GRID.length; g += 1) {
        const a = now[g]!;
        const b = next[g]!;
        const distance = Math.hypot(b.x - a.x, b.y - a.y);
        expect(distance).toBeLessThan(SMOOTHNESS_BOUND_M);
        maxMove = Math.max(maxMove, distance);
      }
    }
    // Documented bound: window shift 0.3977 m + jitter wobble <= ~0.25 m per
    // axis (0.99 * 0.01 image units * 26.25 m visible width) — well under 1.
    expect(maxMove).toBeLessThanOrEqual(1);
  });

  test("(c) the CENTER image point stays within pitch bounds for pan 0.25..0.75", () => {
    const centerIndex = GRID.findIndex((p) => p.x === 0.5 && p.y === 0.5);
    expect(centerIndex).toBe(12); // the middle of the 5x5 grid
    for (let d = 0; d < FRAME_COUNT; d += 1) {
      const center = primary.projections[d]![centerIndex]!;
      expect(center.inBounds).toBe(true);
      expect(center.x).toBeGreaterThanOrEqual(0);
      expect(center.x).toBeLessThanOrEqual(105);
      expect(center.y).toBeGreaterThanOrEqual(0);
      expect(center.y).toBeLessThanOrEqual(68);
    }
  });

  test("(c, stronger) every grid point of every frame stays within pitch bounds", () => {
    for (let d = 0; d < FRAME_COUNT; d += 1) {
      for (const projected of primary.projections[d]!) {
        expect(projected.inBounds).toBe(true);
      }
    }
    // Zoom 2 with jitter keeps the same guarantee (documented margins).
    const jittered = runSweep({ zoom: 2, jitter: 0.01 });
    for (const frameProjections of jittered.projections) {
      for (const projected of frameProjections) {
        expect(projected.inBounds).toBe(true);
      }
    }
  });

  test("metric consistency across the clip: the image center tracks the window center", () => {
    // For the affine fixture camera the image center (0.5, 0.5) must project
    // to the visible window's pitch center: x0(d) + visLength/2, y0 + 34/2 -
    // (68 - 34)/2 ... at zoom 1: y is the PITCH center (34) for every pan.
    const centerIndex = GRID.findIndex((p) => p.x === 0.5 && p.y === 0.5);
    for (let d = 0; d < FRAME_COUNT; d += 1) {
      const center = primary.projections[d]![centerIndex]!;
      const pan = panAt(d);
      const expectedX = pan * (105 - 52.5) + 52.5 / 2;
      expect(center.x).toBeCloseTo(expectedX, 9);
      expect(center.y).toBeCloseTo(34, 9);
    }
  });

  test("every frame of the clip emits a zod-valid field-mapping observation", () => {
    const ids = new Set<string>();
    const refs = new Set<string>();
    for (const frame of FRAMES) {
      const calibrator = new FixtureFieldCalibrator({
        pan: panAt(frame.decodeOrder),
        zoom: 1,
        jitter: 0,
      });
      const observation = emitFieldMappingObservation({
        sessionId: SESSION_ID,
        componentId: calibrator.calibratorId,
        frame,
        cornerSet: calibrator.calibrate(frame),
      });
      expect(() => Observation.parse(observation)).not.toThrow();
      expect(validateFieldMappingObservation(observation)).toBe(true);
      expect(observation.observationId).toBe(`fm-${frame.frameId}`);
      ids.add(observation.observationId);
      if (observation.payload.kind === "field-mapping") {
        expect(observation.payload.cameraHomographyRef).toBe(
          `homography-${SESSION_ID}-${frame.frameId}`,
        );
        refs.add(observation.payload.cameraHomographyRef!);
      }
    }
    expect(ids.size).toBe(FRAME_COUNT);
    expect(refs.size).toBe(FRAME_COUNT);
  });
});
