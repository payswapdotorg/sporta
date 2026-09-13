/**
 * Deterministic ground-truth track fixtures (W204).
 *
 * Serves the same role for the identity-continuity benchmark that W201's
 * `FixtureDetectorAdapter` serves for the detection benchmark: a PURE,
 * DETERMINISTIC generator (no RNG, no clock, no environment reads) that
 * produces per-frame ground truth AND a detector-like input stream, so
 * identity continuity can be measured end-to-end before any real ML backend
 * exists (W303).
 *
 * Interpolation law (documented once, honored exactly — IDENTICAL to W201's
 * fixture detector so tests can hand-compute exact boxes and so GT and
 * W201-generated scenes interoperate): the linear-motion parameter is
 *
 * ```text
 * t = decodeOrder / max(frames - 1, 1)
 * ```
 *
 * `decodeOrder 0` gives `t = 0` (at `from`), `decodeOrder frames - 1` gives
 * `t = 1` (at `to`); a single-frame spec divides by the `max(…, 1)` guard
 * instead of zero (still `t = 0`). The `MotionSpec` type is imported
 * TYPE-ONLY from `@sporta/perception-detection` (the ground truth follows
 * the same motion law as W201's fixture detector; a test asserts the
 * generated boxes are deep-equal to the W201 adapter's output for an
 * equivalent spec).
 *
 * Box construction (documented — identical to W201): the spec box is the
 * rectangle of `size` centered on the motion's interpolated center, with
 * every edge clamped into [0, 1]:
 *
 * ```text
 * left   = clamp01(cx - w/2)   right  = clamp01(cx + w/2)
 * top    = clamp01(cy - h/2)   bottom = clamp01(cy + h/2)
 * box    = { x: left, y: top, w: right - left, h: bottom - top }
 * ```
 *
 * NOTE on `FixtureTrackSpec.size` (documented deviation from the work-item
 * sketch): the brief's type sketch lists id/label/motion/visibility only, but
 * boxes cannot be constructed without extents; `size` mirrors W201's
 * `FixtureLabelSpec.size` (center-based, normalized) so the two fixture
 * grammars stay aligned.
 */
import type { DetectedBox, MotionSpec, NormalizedBox } from "@sporta/perception-detection";
import type { TrackerFrameInput } from "./tracker";

/**
 * One ground-truth tracked object: identity (`gtId`), class label, motion
 * across the fixture's frames, (center-based) box size, and the visibility
 * model — a decode-order window plus a set of occluded frames.
 */
export interface FixtureTrackSpec {
  /** Ground-truth object id (stable identity the benchmark scores against). */
  readonly gtId: string;
  /** Class label (must match what a detector would emit for this object). */
  readonly label: string;
  /** Box-center motion across the fixture's frames (W201 `MotionSpec`). */
  readonly motion: MotionSpec;
  /** Box size in normalized coordinates, applied around the moving center. */
  readonly size: { readonly w: number; readonly h: number };
  /** First visible decode order (inclusive; default 0). */
  readonly visibleFrom?: number;
  /** Last visible decode order (inclusive; default `frames - 1`). */
  readonly visibleUntil?: number;
  /** Decode orders where the object is occluded (invisible) within the window. */
  readonly occludedFrames?: ReadonlySet<number>;
}

/** One ground-truth entry in one frame: identity, label, and exact box. */
export interface GroundTruthEntry {
  readonly gtId: string;
  readonly label: string;
  readonly box: NormalizedBox;
}

/** One generated frame: the tracker-frame view plus its ground truth. */
export interface GroundTruthFrame {
  readonly frame: TrackerFrameInput;
  /** One entry per VISIBLE spec, in spec order. */
  readonly groundTruth: readonly GroundTruthEntry[];
}

/** Options for {@link generateFixtureFrames}. */
export interface FixtureFramesOptions {
  /** Number of frames (drives `t`); integer >= 1. */
  readonly frames: number;
  /**
   * Frame duration in ms (default 40 — 25 fps); `presentationMs` of frame
   * `d` is `d * frameMs` on the normalized media timeline.
   */
  readonly frameMs?: number;
  /**
   * Decode orders to mark `sceneCut: true` (hard camera-cut boundaries for
   * cut benchmark scenarios). Optional; no cut markers by default.
   */
  readonly sceneCutFrames?: ReadonlySet<number>;
}

/**
 * Fixed confidence stamped on fixture detections (what the "detector" would
 * report): a constant, so the tracker's confidence passthrough is trivial to
 * assert. Override per call via {@link DetectionsFromGroundTruthOptions.confidence}.
 */
export const FIXTURE_DETECTION_CONFIDENCE = 0.9;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Linear interpolation `from + (to - from) * t` (W201's documented law). */
function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** The box center for `motion` at interpolation parameter `t`. */
function centerAt(motion: MotionSpec, t: number): { x: number; y: number } {
  if (motion.kind === "static") return { x: motion.at.x, y: motion.at.y };
  return { x: lerp(motion.from.x, motion.to.x, t), y: lerp(motion.from.y, motion.to.y, t) };
}

/** Center-based box construction with unit-square edge clamping (W201's). */
function boxFromCenter(
  center: { x: number; y: number },
  size: { w: number; h: number },
): NormalizedBox {
  const left = clamp01(center.x - size.w / 2);
  const right = clamp01(center.x + size.w / 2);
  const top = clamp01(center.y - size.h / 2);
  const bottom = clamp01(center.y + size.h / 2);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function assertFiniteNumber(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`fixture track spec: ${what} must be a finite number (got ${value})`);
  }
}

function validateSpecs(specs: readonly FixtureTrackSpec[]): void {
  // Fail loud at construction (repo convention): bad ids/labels would
  // silently poison benchmark keys, non-finite geometry would poison
  // clamping. Positions/sizes are NOT range-checked (boxes are clamped into
  // the unit square at construction, mirroring W201).
  for (const spec of specs) {
    if (typeof spec.gtId !== "string" || spec.gtId.length < 1) {
      throw new RangeError("fixture track spec: gtId must be a non-empty string");
    }
    if (typeof spec.label !== "string" || spec.label.length < 1) {
      throw new RangeError(
        `fixture track spec: label for gtId "${spec.gtId}" must be a non-empty string`,
      );
    }
    assertFiniteNumber(spec.size.w, `size.w for gtId "${spec.gtId}"`);
    assertFiniteNumber(spec.size.h, `size.h for gtId "${spec.gtId}"`);
    const motion = spec.motion;
    if (motion.kind === "linear") {
      assertFiniteNumber(motion.from.x, `motion.from.x for gtId "${spec.gtId}"`);
      assertFiniteNumber(motion.from.y, `motion.from.y for gtId "${spec.gtId}"`);
      assertFiniteNumber(motion.to.x, `motion.to.x for gtId "${spec.gtId}"`);
      assertFiniteNumber(motion.to.y, `motion.to.y for gtId "${spec.gtId}"`);
    } else {
      assertFiniteNumber(motion.at.x, `motion.at.x for gtId "${spec.gtId}"`);
      assertFiniteNumber(motion.at.y, `motion.at.y for gtId "${spec.gtId}"`);
    }
  }
}

function validateFramesOptions(options: FixtureFramesOptions): void {
  if (!Number.isInteger(options.frames) || options.frames < 1) {
    throw new RangeError(
      `fixture frames options: frames must be an integer >= 1 (got ${options.frames})`,
    );
  }
  const frameMs = options.frameMs ?? 40;
  if (!Number.isFinite(frameMs) || frameMs < 0) {
    throw new RangeError(
      `fixture frames options: frameMs must be a finite number >= 0 (got ${frameMs})`,
    );
  }
}

/**
 * Generates the fixture frames: for each decode order `d` in `0..frames-1`,
 * one {@link GroundTruthFrame} whose `groundTruth` has one entry per VISIBLE
 * spec (visibility window minus occluded frames), in spec order, with the
 * exact box from the W201 interpolation law and clamping (see module docs).
 *
 * Frame conventions (documented): `frameId = "f-0-<d>"` (the decoding
 * convention), `presentationMs = d * frameMs` (default 40 ms = 25 fps),
 * `decodeOrder = d`, `sceneCut` set to `true` only for decode orders in
 * `sceneCutFrames` (absent otherwise). The motion interpolates over the FULL
 * frame span regardless of the visibility window — a spec visible from
 * frame 40 still has its position at frame 40 computed from
 * `t = 40 / max(frames - 1, 1)`, never re-parameterized — so tests can
 * hand-compute exact boxes and the GT continues "through" occlusions (the
 * physical object keeps moving while invisible, which is what reappearance
 * geometry must be scored against).
 */
export function generateFixtureFrames(
  specs: readonly FixtureTrackSpec[],
  options: FixtureFramesOptions,
): GroundTruthFrame[] {
  validateSpecs(specs);
  validateFramesOptions(options);
  const { frames, frameMs = 40, sceneCutFrames } = options;

  const framesOut: GroundTruthFrame[] = [];
  for (let d = 0; d < frames; d += 1) {
    const t = d / Math.max(frames - 1, 1);
    const groundTruth: GroundTruthEntry[] = [];
    for (const spec of specs) {
      const visibleFrom = spec.visibleFrom ?? 0;
      const visibleUntil = spec.visibleUntil ?? frames - 1;
      if (d < visibleFrom || d > visibleUntil) continue;
      if (spec.occludedFrames?.has(d)) continue;
      groundTruth.push({
        gtId: spec.gtId,
        label: spec.label,
        box: boxFromCenter(centerAt(spec.motion, t), spec.size),
      });
    }
    const isCut = sceneCutFrames?.has(d) === true;
    framesOut.push({
      frame: {
        frameId: `f-0-${d}`,
        presentationMs: d * frameMs,
        decodeOrder: d,
        ...(isCut ? { sceneCut: true } : {}),
      },
      groundTruth,
    });
  }
  return framesOut;
}

/** Deterministic degrade transforms for benchmark scenarios. */
export interface FixtureDegrade {
  /**
   * Drop every Nth detection PER FRAME: an entry is dropped when its 1-BASED
   * position within the frame's ground-truth array satisfies
   * `position % N === 0` (N = 2 drops the 2nd, 4th, … entries of every
   * frame). Integer >= 1.
   */
  readonly dropEveryNth?: number;
  /**
   * From `swapAt.frame` (inclusive, by decode order) on, EXCHANGE the boxes
   * of the two named GT entries in the emitted detections — the detector
   * confuses the two objects: the detection emitted for `gtA`'s slot carries
   * `gtB`'s box and vice versa (labels stay with their slots). Both entries
   * must be present in a frame's ground truth for the swap to apply that
   * frame (a missing/occluded object makes the frame's swap a no-op).
   *
   * GEOMETRIC NOTE (documented honestly): the exchange preserves the
   * per-frame BOX SET — association (and the benchmark correspondence) is
   * purely geometric, so this transform alone cannot alter tracking; it
   * matters through exact-tie association resolved by detection array order,
   * and it DOCUMENTS the detector-level identity confusion that accompanies
   * crossing trajectories (the purity benchmark pairs it with a crossing
   * fixture, where the greedy association flips track ids onto the other
   * trajectory — the flip itself is geometric). A genuinely visible
   * detector-level identity error requires set-changing degradation or
   * appearance embeddings (W303).
   */
  readonly swapAt?: {
    readonly frame: number;
    readonly gtA: string;
    readonly gtB: string;
  };
}

/** Options for {@link detectionsFromGroundTruth}. */
export interface DetectionsFromGroundTruthOptions {
  /**
   * Confidence stamped on every emitted detection (default
   * {@link FIXTURE_DETECTION_CONFIDENCE}).
   */
  readonly confidence?: number;
  /** Deterministic degrade transforms (see {@link FixtureDegrade}). */
  readonly degrade?: FixtureDegrade;
}

function validateDegradeOptions(options: DetectionsFromGroundTruthOptions): void {
  const confidence = options.confidence ?? FIXTURE_DETECTION_CONFIDENCE;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new RangeError(
      `detectionsFromGroundTruth options: confidence must be in [0, 1] (got ${confidence})`,
    );
  }
  const degrade = options.degrade;
  if (degrade === undefined) return;
  if (degrade.dropEveryNth !== undefined) {
    if (!Number.isInteger(degrade.dropEveryNth) || degrade.dropEveryNth < 1) {
      throw new RangeError(
        `detectionsFromGroundTruth degrade: dropEveryNth must be an integer >= 1 ` +
          `(got ${degrade.dropEveryNth})`,
      );
    }
  }
  if (degrade.swapAt !== undefined) {
    const { frame, gtA, gtB } = degrade.swapAt;
    if (!Number.isInteger(frame) || frame < 0) {
      throw new RangeError(
        `detectionsFromGroundTruth degrade: swapAt.frame must be an integer >= 0 (got ${frame})`,
      );
    }
    if (typeof gtA !== "string" || gtA.length < 1 || typeof gtB !== "string" || gtB.length < 1) {
      throw new RangeError("detectionsFromGroundTruth degrade: swapAt gtA/gtB must be non-empty");
    }
    if (gtA === gtB) {
      throw new RangeError("detectionsFromGroundTruth degrade: swapAt gtA and gtB must differ");
    }
  }
}

/**
 * Strips the ground truth into what a detector would see: boxes + labels +
 * a fixed confidence — the tracker's INPUT (identity never leaks: no gtIds).
 *
 * The input is one generated frame (needs the decode order for the
 * `swapAt.frame` transform). Deterministic transforms only — see
 * {@link FixtureDegrade}. Output order: the ground-truth entry order
 * (post-degrade), boxes shallow-copied so the caller never aliases the GT.
 */
export function detectionsFromGroundTruth(
  gt: GroundTruthFrame,
  options?: DetectionsFromGroundTruthOptions,
): DetectedBox[] {
  const resolved: DetectionsFromGroundTruthOptions = options ?? {};
  validateDegradeOptions(resolved);
  const confidence = resolved.confidence ?? FIXTURE_DETECTION_CONFIDENCE;
  const degrade = resolved.degrade;

  // Optional box exchange between the two named entries (from swapAt.frame
  // on). Applied to a box-lookup copy so the emitted detections and the GT
  // never alias.
  let entries = gt.groundTruth;
  if (degrade?.swapAt !== undefined && gt.frame.decodeOrder >= degrade.swapAt.frame) {
    const { gtA, gtB } = degrade.swapAt;
    const boxA = gt.groundTruth.find((entry) => entry.gtId === gtA)?.box;
    const boxB = gt.groundTruth.find((entry) => entry.gtId === gtB)?.box;
    if (boxA !== undefined && boxB !== undefined) {
      entries = gt.groundTruth.map((entry) =>
        entry.gtId === gtA
          ? { ...entry, box: { ...boxB } }
          : entry.gtId === gtB
            ? { ...entry, box: { ...boxA } }
            : entry,
      );
    }
  }

  const dropEveryNth = degrade?.dropEveryNth;
  const detections: DetectedBox[] = [];
  for (const [index, entry] of entries.entries()) {
    // 1-based per-frame position: drop when position % N === 0.
    if (dropEveryNth !== undefined && (index + 1) % dropEveryNth === 0) continue;
    detections.push({
      box: { ...entry.box },
      label: entry.label,
      confidence,
    });
  }
  return detections;
}
