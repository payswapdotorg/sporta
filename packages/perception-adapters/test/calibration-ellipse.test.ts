/**
 * Tests for the v0.2.0 ELLIPSE/CIRCLE-CONSTRAINED calibration path of
 * `BroadcastLineCalibrator` (the R606 remaining-gap increment).
 *
 * FIXTURE HONESTY (the synth.ts contract): these are SYNTHETIC-DIAGNOSTIC
 * frames — a true PINHOLE projection of the regulation pitch (105×68,
 * center circle r = 9.15) rendered from an explicit camera pose
 * (position, look-at, focal length; K·[r1 r2 t] with the principal point
 * centered and square pixels) onto a 640×360 rgb24 raster, with
 * deterministic per-pixel grass variation, deterministic player walks,
 * and no RNG, no clock. They are NOT real video; they prove the
 * increment's recovery and refusal behavior before any real-media
 * evidence.
 *
 * The ARC-WINDOW fixture is the class the R606 record says line-only
 * solving fails: an elevated, slightly off-center main-camera midfield
 * view where BOTH touchlines cross the frame, the halfway line is the
 * sole near-vertical painted line, the center circle projects to a
 * ~200×38 px sliver ellipse, and the goal lines + penalty areas are out
 * of frame — the v0.1.0 (2+2)-family search refuses (family starvation
 * or validation failure), and the ellipse/circle-constrained path
 * calibrates.
 */
import { describe, expect, test } from "bun:test";
import { FieldMappingPayload } from "@sporta/contracts";
import {
  CANONICAL_PITCH_CORNERS,
  applyHomography,
  invertHomography,
  solveHomography,
} from "@sporta/field-mapping";
import type { Homography } from "@sporta/field-mapping";
import { makeDetectorFrameInput } from "../src/index";
import type { DetectorFrameInput } from "../src/index";
import { CandidateFailureError } from "../src/errors";
import {
  BroadcastLineCalibrator,
  evaluateBroadcastLineFit,
  fitBroadcastEllipseEvidence,
} from "../src/calibration/broadcast-line";

const WIDTH = 640;
const HEIGHT = 360;
const FRAME_COUNT = 6;

// ---------------------------------------------------------------------------
// The pinhole ground truth (explicit camera pose → K·[r1 r2 t]).
// ---------------------------------------------------------------------------

/** Camera pose: pitch-side, elevated, slightly right of the halfway line. */
const CAMERA_POSITION: readonly [number, number, number] = [58, -38, 14];
const CAMERA_TARGET: readonly [number, number, number] = [52.5, 18, 0];
const FOCAL_PX = 800;

type Vec3 = readonly [number, number, number];

function normalizeVec(v: Vec3): [number, number, number] {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}
function crossVec(a: Vec3, b: Vec3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dotVec(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The look-at rotation (right-handed camera frame: x right, y down, z forward). */
const Z_AXIS = normalizeVec([
  CAMERA_TARGET[0] - CAMERA_POSITION[0],
  CAMERA_TARGET[1] - CAMERA_POSITION[1],
  CAMERA_TARGET[2] - CAMERA_POSITION[2],
]);
const X_AXIS = normalizeVec(crossVec(Z_AXIS, [0, 0, 1]));
const Y_AXIS = crossVec(Z_AXIS, X_AXIS);
const TRANSLATION: readonly [number, number, number] = [
  -dotVec(X_AXIS, CAMERA_POSITION),
  -dotVec(Y_AXIS, CAMERA_POSITION),
  -dotVec(Z_AXIS, CAMERA_POSITION),
];

/** Pitch (x, y, 0) → image (normalized): S⁻¹·K·[r1 r2 t]. */
const M_PITCH_TO_IMAGE: Homography = [
  (FOCAL_PX * X_AXIS[0] + (WIDTH / 2) * Z_AXIS[0]) / WIDTH,
  (FOCAL_PX * X_AXIS[1] + (WIDTH / 2) * Z_AXIS[1]) / WIDTH,
  (FOCAL_PX * TRANSLATION[0] + (WIDTH / 2) * TRANSLATION[2]) / WIDTH,
  (FOCAL_PX * Y_AXIS[0] + (HEIGHT / 2) * Z_AXIS[0]) / HEIGHT,
  (FOCAL_PX * Y_AXIS[1] + (HEIGHT / 2) * Z_AXIS[1]) / HEIGHT,
  (FOCAL_PX * TRANSLATION[1] + (HEIGHT / 2) * TRANSLATION[2]) / HEIGHT,
  Z_AXIS[0],
  Z_AXIS[1],
  TRANSLATION[2],
];
/** Ground-truth image→pitch homography (canonical h[8] = 1). */
const H_GT: Homography = invertHomography(M_PITCH_TO_IMAGE);

function projectImage(h: Homography, u: number, v: number): { x: number; y: number } {
  const denominator = h[6]! * u + h[7]! * v + 1;
  return {
    x: (h[0]! * u + h[1]! * v + h[2]!) / denominator,
    y: (h[3]! * u + h[4]! * v + h[5]!) / denominator,
  };
}
/** Pitch meters → image-normalized through a (possibly non-canonical) matrix. */
function projectPitchNormalized(m: Homography, px: number, py: number): { x: number; y: number } {
  const denominator = m[6]! * px + m[7]! * py + m[8]!;
  return {
    x: (m[0]! * px + m[1]! * py + m[2]!) / denominator,
    y: (m[3]! * px + m[4]! * py + m[5]!) / denominator,
  };
}
function projectPitchToPx(px: number, py: number): { x: number; y: number } {
  const denominator = M_PITCH_TO_IMAGE[6]! * px + M_PITCH_TO_IMAGE[7]! * py + M_PITCH_TO_IMAGE[8]!;
  return {
    x:
      ((M_PITCH_TO_IMAGE[0]! * px + M_PITCH_TO_IMAGE[1]! * py + M_PITCH_TO_IMAGE[2]!) / denominator) *
      WIDTH,
    y:
      ((M_PITCH_TO_IMAGE[3]! * px + M_PITCH_TO_IMAGE[4]! * py + M_PITCH_TO_IMAGE[5]!) / denominator) *
      HEIGHT,
  };
}

// ---------------------------------------------------------------------------
// The renderer (mirrors broadcast-line.test.ts's fixture style).
// ---------------------------------------------------------------------------

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
interface FixtureArc {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly xMin?: number;
  readonly xMax?: number;
}
const CENTER_CIRCLE: FixtureArc = { cx: 52.5, cy: 34, r: 9.15 };
const LEFT_PENALTY_ARC: FixtureArc = { cx: 11, cy: 34, r: 9.15, xMin: 16.5 };
const RIGHT_PENALTY_ARC: FixtureArc = { cx: 94, cy: 34, r: 9.15, xMax: 88.5 };

const GRASS: readonly [number, number, number] = [90, 120, 50];
const LINE: readonly [number, number, number] = [170, 172, 166];
const PLAYER: readonly [number, number, number] = [200, 200, 200];
const BACKGROUND: readonly [number, number, number] = [90, 92, 88];

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

function paintMarkingPoint(bytes: Uint8Array, pitchX: number, pitchY: number): void {
  const image = projectPitchToPx(pitchX, pitchY);
  const x = Math.round(image.x);
  const y = Math.round(image.y);
  setPixel(bytes, x, y, LINE);
  setPixel(bytes, x + 1, y, LINE);
  setPixel(bytes, x, y + 1, LINE);
  setPixel(bytes, x + 1, y + 1, LINE);
}

interface RenderVariant {
  /** Omit the center circle entirely (the occluded-circle refusal fixture). */
  readonly skipCenterCircle?: boolean;
  /** Paint only this many degrees of the center circle (the below-quota fixture). */
  readonly centerCircleSpanDeg?: number;
}

function paintArc(bytes: Uint8Array, arc: FixtureArc, spanDeg?: number): void {
  let angle0 = 0;
  let angleSpan = Math.PI * 2;
  if (spanDeg !== undefined) {
    angle0 = (-spanDeg * Math.PI) / 360;
    angleSpan = (spanDeg * Math.PI) / 180;
  } else if (arc.xMin !== undefined) {
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
    paintMarkingPoint(bytes, arc.cx + arc.r * Math.cos(angle), arc.cy + arc.r * Math.sin(angle));
  }
}

/** Renders one arc-window frame under the pinhole ground truth. */
function renderArcWindowFrame(frameIndex: number, variant: RenderVariant = {}): Uint8Array {
  const bytes = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let i = 0; i < bytes.length; i += 3) {
    bytes[i] = BACKGROUND[0];
    bytes[i + 1] = BACKGROUND[1];
    bytes[i + 2] = BACKGROUND[2];
  }
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const pitch = projectImage(H_GT, x / WIDTH, y / HEIGHT);
      if (pitch.x >= 0 && pitch.x <= 105 && pitch.y >= 0 && pitch.y <= 68) {
        const variation = ((x * 31 + y * 17) % 7) - 3;
        const index = (y * WIDTH + x) * 3;
        bytes[index] = GRASS[0] + variation;
        bytes[index + 1] = GRASS[1] + variation;
        bytes[index + 2] = GRASS[2] + variation;
      }
    }
  }
  for (const [x0, y0, x1, y1] of MODEL_SEGMENTS) {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(length / 0.25));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      paintMarkingPoint(bytes, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  }
  if (!variant.skipCenterCircle) {
    paintArc(bytes, CENTER_CIRCLE, variant.centerCircleSpanDeg);
  }
  paintArc(bytes, LEFT_PENALTY_ARC);
  paintArc(bytes, RIGHT_PENALTY_ARC);
  for (let k = 0; k < 18; k += 1) {
    const baseX = 15 + ((k * 97 + 31) % 590);
    const baseY = 55 + ((k * 61 + 47) % 250);
    const x = Math.round(baseX + 13 * frameIndex + (k % 3));
    const y = Math.round(baseY + 7 * (((k + frameIndex) % 5) - 2));
    for (let dy = 0; dy < 14; dy += 1) {
      for (let dx = 0; dx < 8; dx += 1) {
        setPixel(bytes, x + dx, y + dy, PLAYER);
      }
    }
  }
  return bytes;
}

function arcWindowFrames(variant: RenderVariant = {}, count = FRAME_COUNT): DetectorFrameInput[] {
  const frames: DetectorFrameInput[] = [];
  for (let index = 0; index < count; index += 1) {
    frames.push(
      makeDetectorFrameInput({
        bytes: renderArcWindowFrame(index, variant),
        width: WIDTH,
        height: HEIGHT,
        decodeOrder: index,
        presentationMs: index * 40,
      }),
    );
  }
  return frames;
}

/** Probe pitch points on the visible midfield region (all project in-frame). */
const PROBE_PITCH_POINTS: ReadonlyArray<readonly [number, number]> = [
  [45, 25],
  [60, 45],
  [40, 60],
  [65, 63],
  [52.5, 34],
  [25, 40],
];

/** Reads a typed refusal's failure class (fails the test on success). */
function refusalClassOf(calibrate: () => unknown): { classId: string; details: Record<string, unknown> } {
  try {
    calibrate();
  } catch (error) {
    if (error instanceof CandidateFailureError) {
      return {
        classId: error.details.failureClassId as string,
        details: error.details as Record<string, unknown>,
      };
    }
    throw error;
  }
  throw new Error("expected a typed refusal, got a calibration");
}

// ---------------------------------------------------------------------------
// The tests.
// ---------------------------------------------------------------------------

describe("BroadcastLineCalibrator v0.2.0 — the ellipse/circle-constrained path", () => {
  test(
    "the arc window: v0.1.0 line-only refuses, the ellipse-constrained path calibrates within 2.5 m",
    () => {
      const frames = arcWindowFrames();
      // (a) The v0.1.0-equivalent line-only path refuses this window — the
      //     R606 record's arc-segment class.
      const lineOnly = refusalClassOf(() =>
        new BroadcastLineCalibrator({ ellipseConstrained: false }).calibrate({ frames }),
      );
      expect(lineOnly.classId).toBe("broadcast-line.no-consistent-homography");
      // (b) The v0.2.0 default calibrates it.
      const result = new BroadcastLineCalibrator().calibrate({ frames });
      let worstMeters = 0;
      for (const [pitchX, pitchY] of PROBE_PITCH_POINTS) {
        const image = projectPitchNormalized(M_PITCH_TO_IMAGE, pitchX, pitchY);
        // Fixture sanity: every probe lands inside the frame.
        expect(image.x).toBeGreaterThan(0);
        expect(image.x).toBeLessThan(1);
        expect(image.y).toBeGreaterThan(0);
        expect(image.y).toBeLessThan(1);
        const recovered = applyHomography(result.homography, image);
        worstMeters = Math.max(worstMeters, Math.hypot(recovered.x - pitchX, recovered.y - pitchY));
      }
      expect(worstMeters).toBeLessThan(2.5);
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.confidence).toBeLessThanOrEqual(1);
      // 5 anchors: the 4 circle point anchors + the conic (documented).
      expect(result.correspondenceCount).toBe(5);
      expect(result.cornerSet.cornerOrder).toBe("tl, tr, br, bl");
      expect(result.cornerSet.corners.length).toBe(4);
      const parsed = FieldMappingPayload.safeParse(result.mapping);
      expect(parsed.success).toBe(true);
      expect(parsed.data?.cameraHomographyRef).toContain("homography-");
      expect(result.homography[8]).toBeCloseTo(1, 12);
      // The fit quality the validation measured (the same gates the line
      // path uses, never lower): lineFit >= 0.6 over the full scored set,
      // backward <= 10 px, and the ellipse residual <= 4 px.
      const metrics = evaluateBroadcastLineFit({ frames }, result.homography);
      expect(metrics.lineFit).toBeGreaterThanOrEqual(0.6);
      expect(metrics.backwardPx ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(10);
      expect(metrics.ellipseMeanPx ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(4);
    },
    120_000,
  );

  test(
    "the ellipse-path arc evidence diagnostics record the fitted conic",
    () => {
      const frames = arcWindowFrames();
      const diagnostics = fitBroadcastEllipseEvidence({ frames });
      expect(diagnostics.fitted).toBe(true);
      expect(diagnostics.arcPixels).toBeGreaterThan(300);
      expect(diagnostics.supportPx ?? 0).toBeGreaterThanOrEqual(90);
      expect(diagnostics.coverageBins ?? 0).toBeGreaterThanOrEqual(12);
      // The fitted geometry approximates the TRUE projected circle
      // (center (337.3, 140.5) px, axes 100.4 x 19.3 px) within a few px.
      expect(Math.abs((diagnostics.centerPx?.x ?? 0) - 337.3)).toBeLessThan(4);
      expect(Math.abs((diagnostics.centerPx?.y ?? 0) - 140.5)).toBeLessThan(4);
      expect(Math.abs((diagnostics.semiMajorPx ?? 0) - 100.4)).toBeLessThan(4);
      expect(Math.abs((diagnostics.semiMinorPx ?? 0) - 19.3)).toBeLessThan(4);
    },
    60_000,
  );

  test(
    "an occluded circle refuses honestly (v0.3.0: at the hypothesis/validation stage — the flank-recovery explain admits the fixture's penalty arcs as quota-passing evidence)",
    () => {
      const frames = arcWindowFrames({ skipCenterCircle: true });
      // The line-only path still refuses (the arc window shape).
      const lineOnly = refusalClassOf(() =>
        new BroadcastLineCalibrator({ ellipseConstrained: false }).calibrate({ frames }),
      );
      expect(lineOnly.classId).toBe("broadcast-line.no-consistent-homography");
      // The ellipse path refuses honestly. v0.2.0: the arc evidence could
      // not support a center-circle conic fit (ellipse-evidence-
      // insufficient). v0.3.0 (straightness-aware explain — the flank
      // recovery): the fixture's PENALTY ARCS survive as arc evidence, the
      // quota PASSES on them, and the refusal moves to the LATER honest
      // stage — no conic-anchored hypothesis survives validation (a
      // penalty-arc conic is not the center circle; the solve refuses
      // rather than guessing). Both stages are typed refusals; the bar is
      // the same — never a calibration from non-circle evidence.
      const refusal = refusalClassOf(() => new BroadcastLineCalibrator().calibrate({ frames }));
      expect(refusal.classId).toBe("broadcast-line.ellipse-no-consistent-homography");
      // The measured evidence numbers ride the refusal.
      expect(refusal.details.arcPixels ?? refusal.details.linePathFailureDetails).toBeDefined();
      // And the recorded line-path refusal is carried.
      expect(refusal.details.linePathFailureClass).toBe("broadcast-line.no-consistent-homography");
      // The v0.2.0 class surface is reproducible with the option off.
      const v020 = refusalClassOf(() =>
        new BroadcastLineCalibrator({ ellipseStraightnessAwareExplain: false }).calibrate({ frames }),
      );
      expect(v020.classId).toBe("broadcast-line.ellipse-evidence-insufficient");
    },
    60_000,
  );

  test(
    "arc evidence below quota (a 40° painted arc) refuses honestly (v0.3.0: at the hypothesis/validation stage)",
    () => {
      const frames = arcWindowFrames({ centerCircleSpanDeg: 40 });
      const refusal = refusalClassOf(() => new BroadcastLineCalibrator().calibrate({ frames }));
      // v0.2.0: the coverage quota (12 of 36 bins) refused the 40° arc.
      // v0.3.0: the straightness-aware explain admits the fixture's
      // penalty arcs; the quota passes on them and the honest refusal
      // moves to the validation stage (a partial circle + penalty arcs
      // still cannot anchor a valid solve).
      expect(refusal.classId).toBe("broadcast-line.ellipse-no-consistent-homography");
      // The v0.2.0 class surface is reproducible with the option off.
      const v020 = refusalClassOf(() =>
        new BroadcastLineCalibrator({ ellipseStraightnessAwareExplain: false }).calibrate({ frames }),
      );
      expect(v020.classId).toBe("broadcast-line.ellipse-evidence-insufficient");
      expect(
        v020.details.coverageBins === undefined || (v020.details.coverageBins as number) < 12,
      ).toBe(true);
    },
    60_000,
  );

  test(
    "a degenerate grazing view refuses honestly at the earliest stage (no pitch visible)",
    () => {
      // A very low, far camera sees the pitch as a thin sliver: the
      // green-union gate refuses before any line/ellipse stage — the
      // honest earliest-incorrect-stage refusal, exactly as v0.1.0.
      // Render under a second pinhole ground truth.
      const position: readonly [number, number, number] = [52.5, -110, 2.2];
      const target: readonly [number, number, number] = [52.5, 40, 0];
      const zAxis = normalizeVec([
        target[0] - position[0],
        target[1] - position[1],
        target[2] - position[2],
      ]);
      const xAxis = normalizeVec(crossVec(zAxis, [0, 0, 1]));
      const yAxis = crossVec(zAxis, xAxis);
      const translation: readonly [number, number, number] = [
        -dotVec(xAxis, position),
        -dotVec(yAxis, position),
        -dotVec(zAxis, position),
      ];
      const mSliver: Homography = [
        (900 * xAxis[0] + (WIDTH / 2) * zAxis[0]) / WIDTH,
        (900 * xAxis[1] + (WIDTH / 2) * zAxis[1]) / WIDTH,
        (900 * translation[0] + (WIDTH / 2) * translation[2]) / WIDTH,
        (900 * yAxis[0] + (HEIGHT / 2) * zAxis[0]) / HEIGHT,
        (900 * yAxis[1] + (HEIGHT / 2) * zAxis[1]) / HEIGHT,
        (900 * translation[1] + (HEIGHT / 2) * translation[2]) / HEIGHT,
        zAxis[0],
        zAxis[1],
        translation[2],
      ];
      const hSliver = invertHomography(mSliver);
      const frames: DetectorFrameInput[] = [];
      for (let index = 0; index < FRAME_COUNT; index += 1) {
        const bytes = new Uint8Array(WIDTH * HEIGHT * 3);
        for (let i = 0; i < bytes.length; i += 3) {
          bytes[i] = BACKGROUND[0];
          bytes[i + 1] = BACKGROUND[1];
          bytes[i + 2] = BACKGROUND[2];
        }
        for (let y = 0; y < HEIGHT; y += 1) {
          for (let x = 0; x < WIDTH; x += 1) {
            const pitch = projectImage(hSliver, x / WIDTH, y / HEIGHT);
            if (pitch.x >= 0 && pitch.x <= 105 && pitch.y >= 0 && pitch.y <= 68) {
              const variation = ((x * 31 + y * 17) % 7) - 3;
              const pixel = (y * WIDTH + x) * 3;
              bytes[pixel] = GRASS[0] + variation;
              bytes[pixel + 1] = GRASS[1] + variation;
              bytes[pixel + 2] = GRASS[2] + variation;
            }
          }
        }
        frames.push(
          makeDetectorFrameInput({
            bytes,
            width: WIDTH,
            height: HEIGHT,
            decodeOrder: index,
            presentationMs: index * 40,
          }),
        );
      }
      const refusal = refusalClassOf(() => new BroadcastLineCalibrator().calibrate({ frames }));
      expect(refusal.classId).toBe("broadcast-line.no-pitch-visible");
      // Both paths refuse identically (the ellipse path never runs).
      const lineOnly = refusalClassOf(() =>
        new BroadcastLineCalibrator({ ellipseConstrained: false }).calibrate({ frames }),
      );
      expect(lineOnly.classId).toBe("broadcast-line.no-pitch-visible");
    },
    60_000,
  );

  test(
    "non-degradation: a window the line path calibrates returns byte-identical results",
    () => {
      // The FULL-MARKINGS broadcast-perspective fixture of the v0.1.0 test
      // suite (all boundary/interior lines + all circles visible): the line
      // path calibrates it, and the v0.2.0 default returns the IDENTICAL
      // result (the ellipse path never fires on a calibrated window).
      const GT_IMAGE_CORNERS = [
        { x: 0.08, y: 0.88 },
        { x: 0.95, y: 0.9 },
        { x: 0.74, y: 0.16 },
        { x: 0.3, y: 0.11 },
      ];
      const hQuad = solveHomography(
        [...GT_IMAGE_CORNERS],
        [...CANONICAL_PITCH_CORNERS],
      ); // image -> pitch
      const hQuadInverse = invertHomography(hQuad); // pitch -> image
      // Render a simple full-markings quad fixture (grass + every model
      // marking projected through the quad homography).
      const frames: DetectorFrameInput[] = [];
      for (let index = 0; index < FRAME_COUNT; index += 1) {
        const bytes = new Uint8Array(WIDTH * HEIGHT * 3);
        for (let i = 0; i < bytes.length; i += 3) {
          bytes[i] = BACKGROUND[0];
          bytes[i + 1] = BACKGROUND[1];
          bytes[i + 2] = BACKGROUND[2];
        }
        for (let y = 0; y < HEIGHT; y += 1) {
          for (let x = 0; x < WIDTH; x += 1) {
            const pitch = projectImage(hQuad, x / WIDTH, y / HEIGHT);
            if (pitch.x >= 0 && pitch.x <= 105 && pitch.y >= 0 && pitch.y <= 68) {
              const variation = ((x * 31 + y * 17) % 7) - 3;
              const pixel = (y * WIDTH + x) * 3;
              bytes[pixel] = GRASS[0] + variation;
              bytes[pixel + 1] = GRASS[1] + variation;
              bytes[pixel + 2] = GRASS[2] + variation;
            }
          }
        }
        const projectQuad = (px: number, py: number): { x: number; y: number } => {
          const image = projectPitchNormalized(hQuadInverse, px, py);
          return { x: image.x * WIDTH, y: image.y * HEIGHT };
        };
        const paintQuad = (px: number, py: number): void => {
          const image = projectQuad(px, py);
          const x = Math.round(image.x);
          const y = Math.round(image.y);
          setPixel(bytes, x, y, LINE);
          setPixel(bytes, x + 1, y, LINE);
          setPixel(bytes, x, y + 1, LINE);
          setPixel(bytes, x + 1, y + 1, LINE);
        };
        for (const [x0, y0, x1, y1] of MODEL_SEGMENTS) {
          const length = Math.hypot(x1 - x0, y1 - y0);
          const steps = Math.max(1, Math.ceil(length / 0.25));
          for (let step = 0; step <= steps; step += 1) {
            const t = step / steps;
            paintQuad(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
          }
        }
        for (const arc of [CENTER_CIRCLE, LEFT_PENALTY_ARC, RIGHT_PENALTY_ARC]) {
          paintArc(bytes, arc);
        }
        frames.push(
          makeDetectorFrameInput({
            bytes,
            width: WIDTH,
            height: HEIGHT,
            decodeOrder: index,
            presentationMs: index * 40,
          }),
        );
      }
      const withEllipse = new BroadcastLineCalibrator().calibrate({ frames });
      const withoutEllipse = new BroadcastLineCalibrator({ ellipseConstrained: false }).calibrate({
        frames,
      });
      expect(withEllipse).toEqual(withoutEllipse);
      expect(withEllipse.correspondenceCount).toBe(4);
    },
    120_000,
  );

  test("deterministic: two ellipse-path calibrations deep-equal", () => {
    const calibrator = new BroadcastLineCalibrator();
    const frames = arcWindowFrames();
    const input = { frames };
    expect(calibrator.calibrate(input)).toEqual(calibrator.calibrate(input));
  }, 120_000);

  test("the ellipseConstrained option validates fail-loud (RangeError)", () => {
    expect(
      () => new BroadcastLineCalibrator({ ellipseConstrained: "yes" as unknown as boolean }),
    ).toThrow(RangeError);
    expect(
      () => new BroadcastLineCalibrator({ ellipseConstrained: 1 as unknown as boolean }),
    ).toThrow(RangeError);
  });

  test("the diagnostic exports validate fail-loud (RangeError)", () => {
    const frames = arcWindowFrames();
    expect(() =>
      fitBroadcastEllipseEvidence({ frames }, { minPitchFraction: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      evaluateBroadcastLineFit({ frames }, [1, 2, 3] as unknown as Homography),
    ).toThrow(RangeError);
  });
});
