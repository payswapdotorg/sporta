/**
 * Tests for `BroadcastLineCalibrator` (the W303-class R606 fix path).
 *
 * FIXTURE HONESTY (the synth.ts contract): these are SYNTHETIC-DIAGNOSTIC
 * frames — flat-colored regions on an rgb24 raster, procedurally rendered
 * from a fixed ground-truth homography with deterministic per-pixel
 * variation, deterministic player walks, and no RNG, no clock. They are NOT
 * real video; they prove the algorithm's recovery and refusal behavior
 * before any real-media evidence.
 *
 * The recovery fixture renders a BROADCAST-PERSPECTIVE view: a ground-truth
 * homography H_gt (solved from 4 hand-placed image corners of the canonical
 * pitch quad — near touchline wide at the bottom, far touchline narrow at
 * the top), grass (90,120,50)±3 with deterministic variation, every
 * canonical model marking painted white 2 px thick by projecting model line
 * points through H_gt⁻¹, and 18 white 8x14 "player" boxes on deterministic
 * walks (≥13 px/frame) that the motion-compensated temporal aggregation
 * must exclude.
 */
import { describe, expect, test } from "bun:test";
import { FieldMappingPayload } from "@sporta/contracts";
import {
  CANONICAL_PITCH_CORNERS,
  applyHomography,
  invertHomography,
  solveHomography,
} from "@sporta/field-mapping";
import type { Homography, Point2D } from "@sporta/field-mapping";
import {
  BroadcastLineCalibrator,
  CandidateFailureError,
  makeDetectorFrameInput,
} from "../src/index";
import type { DetectorFrameInput } from "../src/index";

const WIDTH = 640;
const HEIGHT = 360;
const FRAME_COUNT = 6;

/**
 * Ground-truth image corners of the canonical pitch quad (tl, tr, br, bl =
 * canonical (0,0), (105,0), (105,68), (0,68)): the near touchline spans the
 * bottom of the frame, the far touchline is the narrow top edge — broadcast
 * main-camera perspective, all four corners in frame.
 */
const GT_IMAGE_CORNERS: [Point2D, Point2D, Point2D, Point2D] = [
  { x: 0.08, y: 0.88 },
  { x: 0.95, y: 0.9 },
  { x: 0.74, y: 0.16 },
  { x: 0.3, y: 0.11 },
];

/** Ground-truth image→pitch homography (solved once from the quad). */
const H_GT: Homography = solveHomography([...GT_IMAGE_CORNERS], [...CANONICAL_PITCH_CORNERS]);
/** Ground-truth pitch→image homography. */
const H_GT_INVERSE: Homography = invertHomography(H_GT);

/** The canonical model markings, restated here as the fixture's ground truth. */
const MODEL_SEGMENTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 105, 0],
  [0, 68, 105, 68],
  [0, 0, 0, 68],
  [105, 0, 105, 68],
  [52.5, 0, 52.5, 68],
  [16.5, 13.84, 16.5, 54.16],
  [88.5, 13.84, 88.5, 54.16],
  [0, 13.84, 16.5, 13.84],
  [0, 54.16, 16.5, 54.16],
  [88.5, 13.84, 105, 13.84],
  [88.5, 54.16, 105, 54.16],
  [5.5, 24.84, 5.5, 43.16],
  [99.5, 24.84, 99.5, 43.16],
  [0, 24.84, 5.5, 24.84],
  [0, 43.16, 5.5, 43.16],
  [99.5, 24.84, 105, 24.84],
  [99.5, 43.16, 105, 43.16],
];

interface TestArc {
  cx: number;
  cy: number;
  r: number;
  xMin?: number;
  xMax?: number;
}
const CENTER_CIRCLE: TestArc = { cx: 52.5, cy: 34, r: 9.15 };
const LEFT_PENALTY_ARC: TestArc = { cx: 11, cy: 34, r: 9.15, xMin: 16.5 };
const RIGHT_PENALTY_ARC: TestArc = { cx: 94, cy: 34, r: 9.15, xMax: 88.5 };

/** Grass / marking / player / background colors (deterministic, flat). */
const GRASS: readonly [number, number, number] = [90, 120, 50];
const LINE: readonly [number, number, number] = [170, 172, 166];
const PLAYER: readonly [number, number, number] = [200, 200, 200];
const BACKGROUND: readonly [number, number, number] = [90, 92, 88];

/** Local safe projection (test-side convenience; never at infinity here). */
function project(h: Homography, u: number, v: number): { x: number; y: number } {
  const denominator = h[6]! * u + h[7]! * v + 1;
  return {
    x: (h[0]! * u + h[1]! * v + h[2]!) / denominator,
    y: (h[3]! * u + h[4]! * v + h[5]!) / denominator,
  };
}

function setPixel(
  bytes: Uint8Array,
  x: number,
  y: number,
  color: readonly [number, number, number],
): void {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const index = (y * WIDTH + x) * 3;
  bytes[index] = color[0];
  bytes[index + 1] = color[1];
  bytes[index + 2] = color[2];
}

/** Projects a pitch point to image pixels and paints a 2x2 white block. */
function paintMarkingPoint(
  bytes: Uint8Array,
  pitchX: number,
  pitchY: number,
  offsetPx: number,
): void {
  const image = project(H_GT_INVERSE, pitchX, pitchY);
  const x = Math.round(image.x * WIDTH + offsetPx);
  const y = Math.round(image.y * HEIGHT);
  setPixel(bytes, x, y, LINE);
  setPixel(bytes, x + 1, y, LINE);
  setPixel(bytes, x, y + 1, LINE);
  setPixel(bytes, x + 1, y + 1, LINE);
}

/** Paints every canonical model marking, 2 px thick, every 0.25 m. */
function paintModelMarkings(bytes: Uint8Array, offsetPx: number): void {
  for (const [x0, y0, x1, y1] of MODEL_SEGMENTS) {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(length / 0.25));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      paintMarkingPoint(bytes, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, offsetPx);
    }
  }
  const arcs = [CENTER_CIRCLE, LEFT_PENALTY_ARC, RIGHT_PENALTY_ARC];
  for (const arc of arcs) {
    let angle0 = 0;
    let angleSpan = Math.PI * 2;
    if (arc.xMin !== undefined) {
      const half = Math.acos((arc.xMin - arc.cx) / arc.r);
      angle0 = -half;
      angleSpan = 2 * half;
    } else if (arc.xMax !== undefined) {
      const half = Math.acos((arc.cx - arc.xMax) / arc.r);
      angle0 = Math.PI - half;
      angleSpan = 2 * half;
    }
    const steps = Math.max(1, Math.ceil((arc.r * angleSpan) / 0.25));
    for (let step = 0; step <= steps; step += 1) {
      const angle = angle0 + (angleSpan * step) / steps;
      paintMarkingPoint(bytes, arc.cx + arc.r * Math.cos(angle), arc.cy + arc.r * Math.sin(angle), offsetPx);
    }
  }
}

/**
 * 18 white 8x14 player boxes on deterministic walks: ≥13 px/frame of image
 * movement so the ≥50% temporal threshold excludes them (a pixel is covered
 * by at most two frames' dilated boxes).
 */
function paintPlayers(bytes: Uint8Array, frameIndex: number, offsetPx: number): void {
  for (let k = 0; k < 18; k += 1) {
    const baseX = 15 + ((k * 97 + 31) % 590);
    const baseY = 55 + ((k * 61 + 47) % 250);
    const x = Math.round(baseX + 13 * frameIndex + (k % 3) + offsetPx);
    const y = Math.round(baseY + 7 * (((k + frameIndex) % 5) - 2));
    for (let dy = 0; dy < 14; dy += 1) {
      for (let dx = 0; dx < 8; dx += 1) {
        setPixel(bytes, x + dx, y + dy, PLAYER);
      }
    }
  }
}

/**
 * Renders one broadcast-perspective frame. `offsetPx` translates the WHOLE
 * scene (camera pan; 0 for the static fixture). Grass carries the
 * deterministic per-world-pixel variation ±3.
 */
function renderBroadcastFrame(frameIndex: number, offsetPx: number): Uint8Array {
  const bytes = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = (y * WIDTH + x) * 3;
      bytes[index] = BACKGROUND[0];
      bytes[index + 1] = BACKGROUND[1];
      bytes[index + 2] = BACKGROUND[2];
    }
  }
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const worldX = x - offsetPx;
      if (worldX < 0 || worldX >= WIDTH) continue;
      const pitch = project(H_GT, worldX / WIDTH, y / HEIGHT);
      if (pitch.x >= 0 && pitch.x <= 105 && pitch.y >= 0 && pitch.y <= 68) {
        const variation = ((worldX * 31 + y * 17) % 7) - 3;
        const index = (y * WIDTH + x) * 3;
        bytes[index] = GRASS[0] + variation;
        bytes[index + 1] = GRASS[1] + variation;
        bytes[index + 2] = GRASS[2] + variation;
      }
    }
  }
  paintModelMarkings(bytes, offsetPx);
  paintPlayers(bytes, frameIndex, offsetPx);
  return bytes;
}

/** The static-camera fixture: `count` frames, 40 ms presentation cadence. */
function broadcastFrames(count: number, panPerFramePx = 0): DetectorFrameInput[] {
  const frames: DetectorFrameInput[] = [];
  for (let index = 0; index < count; index += 1) {
    frames.push(
      makeDetectorFrameInput({
        bytes: renderBroadcastFrame(index, panPerFramePx * index),
        width: WIDTH,
        height: HEIGHT,
        decodeOrder: index,
        presentationMs: index * 40,
      }),
    );
  }
  return frames;
}

/** Probe pitch points spread over the visible pitch (all project in-frame). */
const PROBE_PITCH_POINTS: ReadonlyArray<readonly [number, number]> = [
  [10, 8],
  [95, 8],
  [52.5, 30],
  [20, 60],
  [85, 55],
  [30, 20],
  [70, 45],
  [12, 40],
  [95, 25],
  [52.5, 10],
];

describe("BroadcastLineCalibrator (W303-class, R606 fix path)", () => {
  test(
    "recovers the broadcast-perspective homography within 2.5 m on 10 probe points",
    () => {
      const calibrator = new BroadcastLineCalibrator();
      const frames = broadcastFrames(FRAME_COUNT);
      const result = calibrator.calibrate({ frames });
      let worstMeters = 0;
      for (const [pitchX, pitchY] of PROBE_PITCH_POINTS) {
        const image = project(H_GT_INVERSE, pitchX, pitchY);
        // Fixture sanity: every probe lands inside the frame.
        expect(image.x).toBeGreaterThan(0);
        expect(image.x).toBeLessThan(1);
        expect(image.y).toBeGreaterThan(0);
        expect(image.y).toBeLessThan(1);
        const recovered = applyHomography(result.homography, image);
        const error = Math.hypot(recovered.x - pitchX, recovered.y - pitchY);
        worstMeters = Math.max(worstMeters, error);
      }
      expect(worstMeters).toBeLessThan(2.5);
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.correspondenceCount).toBe(4);
      expect(result.cornerSet.cornerOrder).toBe("tl, tr, br, bl");
      expect(result.cornerSet.corners.length).toBe(4);
      // The contract payload conforms.
      const parsed = FieldMappingPayload.safeParse(result.mapping);
      expect(parsed.success).toBe(true);
      expect(parsed.data?.cameraHomographyRef).toContain("homography-");
      // The canonical homography form.
      expect(result.homography[8]).toBeCloseTo(1, 12);
    },
    120_000,
  );

  test("the moving players are excluded: the static evidence is line-only (poison test)", () => {
    // A player-only fixture (no markings) must refuse: nothing STATIC with
    // line contrast exists besides the (excluded) moving boxes — the
    // temporal aggregation is what makes this refuse, not the paint order.
    const calibrator = new BroadcastLineCalibrator();
    const grassOnly: DetectorFrameInput[] = [];
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      const bytes = renderBroadcastFrame(index, 0);
      // Remove ALL markings: repaint the pitch interior as pure grass.
      for (let y = 0; y < HEIGHT; y += 1) {
        for (let x = 0; x < WIDTH; x += 1) {
          const pitch = project(H_GT, x / WIDTH, y / HEIGHT);
          // erase with a 2m margin so no boundary-marking pixel (painted
          // with +-1px image rounding, which can project just outside the
          // exact pitch box) survives the repaint: the poison fixture must
          // carry ONLY grass + moving players, never marking slivers.
          if (pitch.x >= -2 && pitch.x <= 107 && pitch.y >= -2 && pitch.y <= 70) {
            const variation = ((x * 31 + y * 17) % 7) - 3;
            const pixel = (y * WIDTH + x) * 3;
            bytes[pixel] = GRASS[0] + variation;
            bytes[pixel + 1] = GRASS[1] + variation;
            bytes[pixel + 2] = GRASS[2] + variation;
          }
        }
      }
      grassOnly.push(
        makeDetectorFrameInput({
          bytes,
          width: WIDTH,
          height: HEIGHT,
          decodeOrder: index,
          presentationMs: index * 40,
        }),
      );
    }
    expect(() => calibrator.calibrate({ frames: grassOnly })).toThrow(CandidateFailureError);
    try {
      calibrator.calibrate({ frames: grassOnly });
    } catch (error) {
      expect((error as CandidateFailureError).details.failureClassId).toBe(
        "broadcast-line.insufficient-line-evidence",
      );
    }
  });

  test("empty sequence is a typed refusal", () => {
    const calibrator = new BroadcastLineCalibrator();
    expect(() => calibrator.calibrate({ frames: [] })).toThrow(CandidateFailureError);
    try {
      calibrator.calibrate({ frames: [] });
    } catch (error) {
      expect((error as CandidateFailureError).details.failureClassId).toBe(
        "broadcast-line.insufficient-line-evidence",
      );
    }
  });

  test("no green pitch in frame is a typed refusal", () => {
    const calibrator = new BroadcastLineCalibrator();
    const frames = broadcastFrames(3);
    // Overwrite every pixel with non-green gray.
    for (const frame of frames) {
      frame.bytes.fill(128);
    }
    expect(() => calibrator.calibrate({ frames })).toThrow(CandidateFailureError);
    try {
      calibrator.calibrate({ frames });
    } catch (error) {
      expect((error as CandidateFailureError).details.failureClassId).toBe(
        "broadcast-line.no-pitch-visible",
      );
    }
  });

  test("a panning camera (60 px/frame) is a typed refusal", () => {
    const calibrator = new BroadcastLineCalibrator();
    const frames = broadcastFrames(FRAME_COUNT, 60);
    expect(() => calibrator.calibrate({ frames })).toThrow(CandidateFailureError);
    try {
      calibrator.calibrate({ frames });
    } catch (error) {
      const failure = error as CandidateFailureError;
      expect(failure.details.failureClassId).toBe("broadcast-line.camera-motion");
      // The measured shift is honest evidence, not just a guard value.
      expect(Math.abs(failure.details.dx as number)).toBeGreaterThan(40);
    }
  });

  test("deterministic: two calibrations deep-equal", () => {
    const calibrator = new BroadcastLineCalibrator();
    const frames = broadcastFrames(FRAME_COUNT);
    const input = { frames };
    expect(calibrator.calibrate(input)).toEqual(calibrator.calibrate(input));
  });

  test("constructor options validate fail-loud (RangeError)", () => {
    expect(() => new BroadcastLineCalibrator({ calibratorId: "" })).toThrow(RangeError);
    expect(() => new BroadcastLineCalibrator({ minPitchFraction: 0 })).toThrow(RangeError);
    expect(() => new BroadcastLineCalibrator({ minPitchFraction: 1.5 })).toThrow(RangeError);
    expect(() => new BroadcastLineCalibrator({ lineContrastThreshold: 0 })).toThrow(RangeError);
    expect(() => new BroadcastLineCalibrator({ lineContrastThreshold: Number.NaN })).toThrow(
      RangeError,
    );
  });
});
