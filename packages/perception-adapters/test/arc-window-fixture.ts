/**
 * The SYNTHETIC-DIAGNOSTIC arc-window fixture (module docs of the test
 * suite's fixture honesty contract): a true PINHOLE projection of the
 * regulation pitch rendered from an explicit camera pose onto a 640x360
 * rgb24 raster, deterministic per-pixel grass variation, deterministic
 * player walks, no RNG, no clock. Extracted v0.4.0 so the development
 * probes share the EXACT fixture bytes with the tests.
 */
import { makeDetectorFrameInput } from "../src/index";
import type { DetectorFrameInput } from "../src/index";
import { invertHomography } from "@sporta/field-mapping";
import { CandidateFailureError } from "../src/errors";
import type { Homography } from "@sporta/field-mapping";

export interface RenderVariant {
  /** Omit the center circle entirely (the occluded-circle refusal fixture). */
  readonly skipCenterCircle?: boolean;
  /** Paint only this many degrees of the center circle (the below-quota fixture). */
  readonly centerCircleSpanDeg?: number;
  /**
   * v0.4.0 conic-selection fixture: paint the NON-CIRCLE dominant curve
   * (a ~2500-px curved marking near the near touchline) and omit the
   * halfway line — the real-window class (b8p3-b/b8p3-f, VLM-verified
   * hoarding/stand-boundary curves): a dominant non-circle arc whose
   * RANSAC winner outranks the center circle, so the single-conic
   * surface anchors to the wrong conic and refuses; the chain must
   * recover the circle's component candidate.
   */
  readonly hoardingCurve?: boolean;
  /**
   * v0.4.1 hardening fixture (the b3-a class): paint a STATIC FILLED
   * WHITE DISK (~8 m diameter, mid-grass away from every marking) and
   * omit the center circle (the real window's circle is out of view) —
   * the real-window class (clip-b3-fast-action frames 20-120, VLM-
   * verified): a dense STATIC non-green structure ON the grass whose
   * rim band survives every arc-evidence filter as a quota-passing
   * conic. The v0.4.0 chain anchored its solve on exactly such a conic
   * (the goal/net) and degenerately satisfied every machine gate; the
   * v0.4.1 grass-support gate must refuse it with the typed
   * `broadcast-line.ellipse-conic-off-pitch` class (the disk's interior
   * is white in EVERY frame — the median green fraction ~0 — while a
   * real circle's painted band leaves its interior grass).
   */
  readonly netStructure?: boolean;
  /**
   * v0.5.0 anchor-conversion fixture (the b5-b real-window class): paint
   * the FULL grass-backed circle 17 m RIGHT of the model center
   * (~(69.5, 34), r 9.15 — mid-grass, clear of every marking) INSTEAD of
   * the true center circle. The fitted conic is a REAL, quota-passing,
   * grass-backed circle — but NOT the model's center circle: the E4b
   * machinery's world-side anchor is the MODEL circle at (52.5, 34), so
   * the J-orthogonal closure is conic-exact against the WRONG world
   * circle and the UNCHANGED validation bar refuses honestly (the
   * anchors-fight outcome: conic-exact survivors whose line rows fight —
   * the recorded b5-b class where the frame is NOT degenerate, the
   * conic-exact solves simply contradict the line evidence).
   */
  readonly offsetCircle?: boolean;
}

export const WIDTH = 640;
export const HEIGHT = 360;
export const FRAME_COUNT = 6;

// ---------------------------------------------------------------------------
// The pinhole ground truth (explicit camera pose → K·[r1 r2 t]).
// ---------------------------------------------------------------------------

/** Camera pose: pitch-side, elevated, slightly right of the halfway line. */
const CAMERA_POSITION: readonly [number, number, number] = [58, -38, 14];
const CAMERA_TARGET: readonly [number, number, number] = [52.5, 18, 0];
const FOCAL_PX = 800;

type Vec3 = readonly [number, number, number];

export function normalizeVec(v: Vec3): [number, number, number] {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}
export function crossVec(a: Vec3, b: Vec3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function dotVec(a: Vec3, b: Vec3): number {
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
export const M_PITCH_TO_IMAGE: Homography = [
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
export const H_GT: Homography = invertHomography(M_PITCH_TO_IMAGE);

export function projectImage(h: Homography, u: number, v: number): { x: number; y: number } {
  const denominator = h[6]! * u + h[7]! * v + 1;
  return {
    x: (h[0]! * u + h[1]! * v + h[2]!) / denominator,
    y: (h[3]! * u + h[4]! * v + h[5]!) / denominator,
  };
}
/** Pitch meters → image-normalized through a (possibly non-canonical) matrix. */
export function projectPitchNormalized(
  m: Homography,
  px: number,
  py: number,
): { x: number; y: number } {
  const denominator = m[6]! * px + m[7]! * py + m[8]!;
  return {
    x: (m[0]! * px + m[1]! * py + m[2]!) / denominator,
    y: (m[3]! * px + m[4]! * py + m[5]!) / denominator,
  };
}
export function projectPitchToPx(px: number, py: number): { x: number; y: number } {
  const denominator = M_PITCH_TO_IMAGE[6]! * px + M_PITCH_TO_IMAGE[7]! * py + M_PITCH_TO_IMAGE[8]!;
  return {
    x:
      ((M_PITCH_TO_IMAGE[0]! * px + M_PITCH_TO_IMAGE[1]! * py + M_PITCH_TO_IMAGE[2]!) /
        denominator) *
      WIDTH,
    y:
      ((M_PITCH_TO_IMAGE[3]! * px + M_PITCH_TO_IMAGE[4]! * py + M_PITCH_TO_IMAGE[5]!) /
        denominator) *
      HEIGHT,
  };
}

// ---------------------------------------------------------------------------
// The renderer (mirrors broadcast-line.test.ts's fixture style).
// ---------------------------------------------------------------------------

export const MODEL_SEGMENTS: ReadonlyArray<readonly [number, number, number, number]> = [
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
export const CENTER_CIRCLE: FixtureArc = { cx: 52.5, cy: 34, r: 9.15 };
export const LEFT_PENALTY_ARC: FixtureArc = { cx: 11, cy: 34, r: 9.15, xMin: 16.5 };
export const RIGHT_PENALTY_ARC: FixtureArc = { cx: 94, cy: 34, r: 9.15, xMax: 88.5 };
/** The v0.5.0 anchors-fight fixture circle (17 m off the model center). */
export const OFFSET_CIRCLE: FixtureArc = { cx: 69.5, cy: 34, r: 9.15 };

export const GRASS: readonly [number, number, number] = [90, 120, 50];
export const LINE: readonly [number, number, number] = [170, 172, 166];
export const PLAYER: readonly [number, number, number] = [200, 200, 200];
export const BACKGROUND: readonly [number, number, number] = [90, 92, 88];

/**
 * The v0.4.0 conic-selection fixture curve: a curved marking bulging up
 * from the near touchline (an arc of a 35 m circle centered (52.5, -30):
 * in-pitch from (34.5, 0) over (52.5, 5) to (70.5, 0)) painted as
 * overlapping 4x5-px strokes every 0.15 m — ONE connected ~2500-px
 * component at the near side's ~17 px/m scale (dots fragment there:
 * 0.25 m steps leave 2-3 px gaps; a continuous band would exceed the
 * 150-px run-length filter). It is the NON-CIRCLE DOMINANT-ARC class the
 * real b8p3 windows' fitted "conic" actually is (VLM-verified: the
 * hoarding/stand-boundary curve): its arc-evidence component and the
 * global RANSAC's mixed winner-by-support OUTRANK the center circle, so
 * the single-conic v0.3.0 surface anchors to a non-circle and refuses —
 * the conic-selection defect class the v0.4.0 chain must recover from.
 */
const HOARDING_CURVE_ARC: FixtureArc = { cx: 52.5, cy: -30, r: 35 };

/** Paints the fixture curve as connected 4x5-px strokes every 0.15 m. */
function paintHoardingCurve(bytes: Uint8Array): void {
  const { cx, cy, r } = HOARDING_CURVE_ARC;
  const steps = Math.max(1, Math.ceil((r * 2 * Math.PI) / 0.15));
  for (let step = 0; step <= steps; step += 1) {
    const angle = (2 * Math.PI * step) / steps;
    const image = projectPitchToPx(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    const x = Math.round(image.x);
    const y = Math.round(image.y);
    for (let dy = 0; dy < 5; dy += 1) {
      for (let dx = 0; dx < 4; dx += 1) {
        setPixel(bytes, x + dx, y + dy, LINE);
      }
    }
  }
}

/**
 * The v0.4.1 hardening fixture's static structure: a FILLED WHITE DISK
 * (radius 4 m at pitch (65, 50) — mid-grass, >= 10 m from every marking
 * and 20 m from the omitted circle's center) — the goal/net-structure
 * class stand-in: dense, static, non-green, ON the grass. Rasterized in
 * IMAGE space (every pixel whose back-projected pitch point lies within
 * the disk): the local-contrast line mask fires only on its RIM (the
 * grass-to-white transition — the interior has no local contrast), so
 * the arc evidence is exactly the disk's rim band, the conic fit lands
 * on the disk's ellipse, and the disk's interior is white in every
 * frame — the measured b3-a discrimination (median interior green ~0.0
 * for the structure vs 0.9 for a real grass-backed circle).
 */
const NET_STRUCTURE_DISK = { cx: 65, cy: 50, r: 4 };

/** Paints the fixture's static filled white disk (image-space rasterization). */
function paintNetStructureDisk(bytes: Uint8Array): void {
  const center = projectPitchToPx(NET_STRUCTURE_DISK.cx, NET_STRUCTURE_DISK.cy);
  const margin = 32;
  for (let y = Math.floor(center.y) - margin; y <= Math.ceil(center.y) + margin; y += 1) {
    for (let x = Math.floor(center.x) - margin; x <= Math.ceil(center.x) + margin; x += 1) {
      if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) continue;
      const pitch = projectImage(H_GT, x / WIDTH, y / HEIGHT);
      if (
        Math.hypot(pitch.x - NET_STRUCTURE_DISK.cx, pitch.y - NET_STRUCTURE_DISK.cy) <=
        NET_STRUCTURE_DISK.r
      ) {
        setPixel(bytes, x, y, LINE);
      }
    }
  }
}

export function setPixel(
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

export function paintMarkingPoint(bytes: Uint8Array, pitchX: number, pitchY: number): void {
  const image = projectPitchToPx(pitchX, pitchY);
  const x = Math.round(image.x);
  const y = Math.round(image.y);
  setPixel(bytes, x, y, LINE);
  setPixel(bytes, x + 1, y, LINE);
  setPixel(bytes, x, y + 1, LINE);
  setPixel(bytes, x + 1, y + 1, LINE);
}

export function paintArc(bytes: Uint8Array, arc: FixtureArc, spanDeg?: number): void {
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
  let segments: ReadonlyArray<readonly [number, number, number, number]> = MODEL_SEGMENTS;
  if (variant.hoardingCurve) {
    // Fixture isolation (documented): the variant OMITS the halfway line —
    // its Hough-quantization "shadow" (the >2 px drift band the explain
    // leaves) 8-connects to the circle's arc band and the merged
    // component's conic fit drifts (measured: semi 64 vs the true 100).
    // The ellipse path needs only the same-family parallel touchline
    // pair, so the solve surface is unchanged; the line-path's family
    // starvation (the arc-window class) still holds.
    segments = segments.filter(([x0, , x1]) => !(x0 === 52.5 && x1 === 52.5));
  }
  for (const [x0, y0, x1, y1] of segments) {
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length <= 0) continue;
    const steps = Math.max(1, Math.ceil(length / 0.25));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      paintMarkingPoint(bytes, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  }
  if (!variant.skipCenterCircle && !variant.netStructure && !variant.offsetCircle) {
    paintArc(bytes, CENTER_CIRCLE, variant.centerCircleSpanDeg);
  }
  if (variant.offsetCircle) {
    paintArc(bytes, OFFSET_CIRCLE);
  }
  if (variant.hoardingCurve) {
    paintHoardingCurve(bytes);
  }
  if (variant.netStructure) {
    paintNetStructureDisk(bytes);
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

export function arcWindowFrames(
  variant: RenderVariant = {},
  count = FRAME_COUNT,
): DetectorFrameInput[] {
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
export const PROBE_PITCH_POINTS: ReadonlyArray<readonly [number, number]> = [
  [45, 25],
  [60, 45],
  [40, 60],
  [65, 63],
  [52.5, 34],
  [25, 40],
];

/** Reads a typed refusal's failure class (fails the test on success). */
export function refusalClassOf(calibrate: () => unknown): {
  classId: string;
  details: Record<string, unknown>;
} {
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
