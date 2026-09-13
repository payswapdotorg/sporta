/**
 * Deterministic fixture detector (W201).
 *
 * The fixture adapter exists so the detection benchmark harness and the
 * observation-emission path can be exercised end-to-end BEFORE any real ML
 * backend exists (W303). It is a PURE, DETERMINISTIC function of
 * `(spec, frame.decodeOrder)`:
 *
 * - no RNG, no clock, no environment reads (docs/testing/HARNESS.md);
 * - pixel content is IGNORED — `bytes`, `width`, `height`, `presentationMs`,
 *   `streamIndex`, and `frameId` do not influence the output. A real detector
 *   would not ignore pixels; that is exactly the difference this fixture
 *   documents, and why the benchmark's ground truth is generated from it
 *   rather than from media.
 */
import type { DetectedBox, DetectorAdapter, DetectorFrameInput, NormalizedBox } from "./detector";

/** A 2D point in normalized image coordinates (box-center space). */
export interface FixturePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Linear motion: the box CENTER moves from `from` to `to` as the frame's
 * `decodeOrder` advances (see {@link FixtureDetectorSpec.frames}).
 */
export interface LinearMotionSpec {
  readonly kind: "linear";
  readonly from: FixturePoint;
  readonly to: FixturePoint;
}

/** Static motion: the box CENTER stays at `at` for every frame. */
export interface StaticMotionSpec {
  readonly kind: "static";
  readonly at: FixturePoint;
}

/** How a fixture label's box center moves across the spec's frames. */
export type MotionSpec = LinearMotionSpec | StaticMotionSpec;

/** One fixture object: label, confidence, motion, and (center-based) size. */
export interface FixtureLabelSpec {
  readonly label: string;
  /** Emitted confidence in [0, 1]; passed through to observations verbatim. */
  readonly confidence: number;
  readonly motion: MotionSpec;
  /** Box size in normalized coordinates, applied around the moving center. */
  readonly size: { readonly w: number; readonly h: number };
}

/**
 * The complete fixture scene: one detector id plus the labeled objects it
 * "finds" in every frame.
 *
 * Interpolation (documented once, honored exactly): the linear-motion
 * parameter is
 *
 * ```text
 * t = decodeOrder / max(frames - 1, 1)
 * ```
 *
 * so `decodeOrder 0` gives `t = 0` (at `from`), `decodeOrder frames - 1`
 * gives `t = 1` (at `to`), and a single-frame spec (`frames = 1`) divides by
 * the `max(…, 1)` guard instead of zero (still `t = 0`). A `decodeOrder`
 * beyond `frames - 1` extrapolates past `to` (`t > 1`); the box edges are
 * still clamped into the unit square.
 */
export interface FixtureDetectorSpec {
  /** Component id; becomes `detectorId` and the observations' `componentId`. */
  readonly detectorId: string;
  /** Number of frames the motion spans (drives `t`). Must be an integer ≥ 1. */
  readonly frames: number;
  /** One detection per label spec per frame, emitted in spec order. */
  readonly labels: readonly FixtureLabelSpec[];
}

function assertFiniteNumber(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`fixture detector spec: ${what} must be a finite number (got ${value})`);
  }
}

function validateSpec(spec: FixtureDetectorSpec): void {
  // Fail loud at construction (the repo convention) rather than emitting
  // contract-invalid observations later: empty ids/labels and out-of-range
  // confidences would fail the Observation zod schema downstream, and
  // non-finite geometry would poison box clamping. Motion positions and box
  // sizes are NOT range-checked: centers may sit anywhere (boxes are clamped
  // into the unit square at construction).
  if (typeof spec.detectorId !== "string" || spec.detectorId.length < 1) {
    throw new RangeError("fixture detector spec: detectorId must be a non-empty string");
  }
  if (!Number.isInteger(spec.frames) || spec.frames < 1) {
    throw new RangeError(
      `fixture detector spec: frames must be an integer >= 1 (got ${spec.frames})`,
    );
  }
  for (const labelSpec of spec.labels) {
    if (typeof labelSpec.label !== "string" || labelSpec.label.length < 1) {
      throw new RangeError("fixture detector spec: label must be a non-empty string");
    }
    if (
      !Number.isFinite(labelSpec.confidence) ||
      labelSpec.confidence < 0 ||
      labelSpec.confidence > 1
    ) {
      throw new RangeError(
        `fixture detector spec: confidence for label "${labelSpec.label}" must be in [0, 1] ` +
          `(got ${labelSpec.confidence})`,
      );
    }
    assertFiniteNumber(labelSpec.size.w, `size.w for label "${labelSpec.label}"`);
    assertFiniteNumber(labelSpec.size.h, `size.h for label "${labelSpec.label}"`);
    const motion = labelSpec.motion;
    if (motion.kind === "linear") {
      assertFiniteNumber(motion.from.x, `motion.from.x for label "${labelSpec.label}"`);
      assertFiniteNumber(motion.from.y, `motion.from.y for label "${labelSpec.label}"`);
      assertFiniteNumber(motion.to.x, `motion.to.x for label "${labelSpec.label}"`);
      assertFiniteNumber(motion.to.y, `motion.to.y for label "${labelSpec.label}"`);
    } else {
      assertFiniteNumber(motion.at.x, `motion.at.x for label "${labelSpec.label}"`);
      assertFiniteNumber(motion.at.y, `motion.at.y for label "${labelSpec.label}"`);
    }
  }
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Linear interpolation `from + (to - from) * t`. */
function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** The box center for `motion` at interpolation parameter `t`. */
function centerAt(motion: MotionSpec, t: number): FixturePoint {
  if (motion.kind === "static") return motion.at;
  return { x: lerp(motion.from.x, motion.to.x, t), y: lerp(motion.from.y, motion.to.y, t) };
}

/**
 * Center-based box construction with edge clamping: the spec box is the
 * rectangle of `size` centered on `center`, and every edge is clamped into
 * [0, 1] —
 *
 * ```text
 * left   = clamp01(cx - w/2)   right  = clamp01(cx + w/2)
 * top    = clamp01(cy - h/2)   bottom = clamp01(cy + h/2)
 * box    = { x: left, y: top, w: right - left, h: bottom - top }
 * ```
 *
 * Clamping is monotonic, so `right >= left` and `bottom >= top` always hold
 * and the result satisfies the contracts `NormalizedBox` bounds (each field
 * in [0, 1]). The emitted box is therefore the spec box INTERSECTED with the
 * unit square: an off-frame center yields a (possibly zero-area) box pinned
 * to the frame edge, never an out-of-range box.
 */
function boxFromCenter(center: FixturePoint, size: { w: number; h: number }): NormalizedBox {
  const left = clamp01(center.x - size.w / 2);
  const right = clamp01(center.x + size.w / 2);
  const top = clamp01(center.y - size.h / 2);
  const bottom = clamp01(center.y + size.h / 2);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The deterministic fixture {@link DetectorAdapter}.
 *
 * `detect` returns exactly one {@link DetectedBox} per label spec, in spec
 * order, computed purely from `(spec, frame.decodeOrder)` — see the module
 * and {@link FixtureDetectorSpec} docs for the interpolation and clamping
 * math. The call is synchronous (a plain array return satisfies the adapter
 * seam's sync/async union).
 */
export class FixtureDetectorAdapter implements DetectorAdapter {
  readonly detectorId: string;
  private readonly spec: FixtureDetectorSpec;

  constructor(spec: FixtureDetectorSpec) {
    validateSpec(spec);
    this.spec = spec;
    this.detectorId = spec.detectorId;
  }

  detect(frame: DetectorFrameInput): DetectedBox[] {
    const t = frame.decodeOrder / Math.max(this.spec.frames - 1, 1);
    return this.spec.labels.map((labelSpec) => ({
      box: boxFromCenter(centerAt(labelSpec.motion, t), labelSpec.size),
      label: labelSpec.label,
      confidence: labelSpec.confidence,
    }));
  }
}
