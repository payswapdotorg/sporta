/**
 * R204 candidate 2: `ColorBlobBallTracker` — a DIRECT PIXEL-SPACE
 * ball-tracking candidate: it derives its own ball evidence from the frame
 * `bytes` (the detection annotations are IGNORED by design — that is the
 * material difference from candidate 1), then runs the honest W202 tracking
 * semantics over that evidence.
 *
 * EVIDENCE EXTRACTION (documented in full, per frame):
 *
 * 1. BRIGHT-WHITE MASK: `isBrightWhite` over every pixel (the ball-color
 *    predicate — white/near-white).
 * 2. CONNECTED COMPONENTS: 4-connectivity blobs, deterministic row-major
 *    order.
 * 3. BALL-SHAPE FILTER: a candidate blob must be SMALL (`area` in
 *    `[minBlobArea, maxBlobArea]`), roughly SQUARE (`aspectRatio <=
 *    maxAspectRatio`, default 1.6 — pitch lines are far more elongated),
 *    and COMPACT (`compactness >= minCompactness`, default 0.5 — the ball
 *    fills its box; note a RASTERIALIZED small disc sits around 0.55-0.8
 *    depending on sub-pixel centering, so the gate must stay below that;
 *    line fragments do not). Surviving blobs become
 *    ball-class `DetectedBox`s with `confidence = compactness` (honest:
 *    how ball-shaped the blob is).
 * 4. SMALLEST-FASTEST PREFERENCE is expressed through the ASSOCIATION
 *    stage, not the extraction: W202's nearest-box step gate keeps only
 *    blobs consistent with the ball's motion, and among same-frame
 *    candidates the tracker claims the NEAREST to the last observed box —
 *    for a small fast ball, that is the small fast blob; static line
 *    fragments fail the step gate across frames (they do not move with the
 *    ball) or were already excluded by shape.
 *
 * TRACKING (wrap, never fork): the extracted per-frame detections feed the
 * W202 `NearestBoxBallTracker` — occlusion gaps kept open and bridged with
 * exponentially DISCOUNTED interpolated confidence, edges never
 * extrapolated, too-late re-observations rejected. The honest gap/occlusion
 * semantics are therefore EXACTLY W202's; only the evidence layer differs.
 *
 * HONEST LIMITS: a white-clad player below the area gate can masquerade as
 * the ball (documented failure class); line-intersection clutter near the
 * penalty spots can survive the shape filter on noisy frames; occlusion
 * handling is W202's conservative bridging, nothing more.
 *
 * Pure function of `(options, frames)`: no RNG, no clock, no I/O.
 */
import type {
  FailureClassRecord,
  PerceptionAdapterDescriptor,
  ResourceRequirements,
  TechnologyLicenseRecord,
} from "@sporta/contracts";
import type { DetectedBox, DetectorFrameInput } from "@sporta/perception-detection";
import { NearestBoxBallTracker } from "@sporta/ball-tracking";
import type {
  BallObservationFrame,
  BallTrack,
  NearestBoxTrackerOptions,
} from "@sporta/ball-tracking";
import { assertDescriptorBinding, perceptionDescriptor } from "../errors";
import { COLOR_BLOB_BALL_TRACKER_LICENSE } from "../licenses";
import {
  BALL_DETECTION_LABEL,
  type BallTrackingAdapter,
  type DetectionSequenceFrame,
} from "../adapter";
import {
  blobAspectRatio,
  blobCompactness,
  connectedComponents,
  isBrightWhite,
  pixelBoundsToNormalizedBox,
} from "../pixels";
import { validatePresentationOrderedSequence } from "../validate";

/** Stable technology identity of this candidate. */
export const COLOR_BLOB_BALL_TRACKER_ID = "color-blob-ball-tracker";
export const COLOR_BLOB_BALL_TRACKER_VERSION = "0.1.0";
export const COLOR_BLOB_BALL_TRACKER_ADAPTER_VERSION = "0.1.0";

/** Options for {@link ColorBlobBallTracker}; every field is optional. */
export interface ColorBlobBallTrackerOptions extends NearestBoxTrackerOptions {
  /**
   * Minimum blob pixel area (default 8 — excludes speckle noise AND the
   * 2x2/2x3 pixel fragments a line CROSSING produces, which otherwise pass
   * the shape filter; a radius-3 ball (~28 px) clears it comfortably).
   */
  readonly minBlobArea?: number;
  /** Maximum blob pixel area (default 120 — white kit fragments rejected). */
  readonly maxBlobArea?: number;
  /** Maximum bounding-box aspect ratio (default 1.6 — line rejection). */
  readonly maxAspectRatio?: number;
  /** Minimum blob compactness (default 0.5 — below a rasterized disc's ~0.55). */
  readonly minCompactness?: number;
}

const COLOR_BLOB_DEFAULTS = {
  minBlobArea: 8,
  maxBlobArea: 120,
  maxAspectRatio: 1.6,
  minCompactness: 0.5,
} as const;

/** Documented failure classes of the color-blob ball tracker. */
export const COLOR_BLOB_BALL_TRACKER_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "color-blob-ball.white-kit-confusion",
    description:
      "A bright-white kit fragment inside the area gate masquerades as the ball " +
      "when the true ball is absent: association then follows the wrong blob. The " +
      "step gate and shape filter reduce but do not eliminate this.",
    retryable: false,
  },
  {
    failureClassId: "color-blob-ball.line-clutter",
    description:
      "Line intersections and worn-marking fragments can survive the shape filter " +
      "on noisy frames and seed short spurious tracks; leftover candidates are " +
      "clutter for the single-ball scan (W202 step 6 semantics).",
    retryable: false,
  },
  {
    failureClassId: "color-blob-ball.off-envelope-lighting",
    description:
      "Overexposed turf reads bright-white wholesale: the mask floods, the shape " +
      "filter rejects nearly everything, and the ball is lost. Calibrated for " +
      "broadcast-style exposure.",
    retryable: false,
  },
];

/** Resource requirements: pure CPU, one core. */
export const COLOR_BLOB_BALL_TRACKER_RESOURCES: ResourceRequirements = {
  gpuRequired: false,
  minCpuCores: 1,
};

/**
 * The pixel-space color-blob ball tracker (R204 candidate 2).
 *
 * Construct with options (blob gates + the W202 association options); call
 * {@link track} with a presentation-ordered frame sequence. The detection
 * annotations on the frames are IGNORED — the candidate's evidence is the
 * pixels themselves (documented, and exactly what the benchmark varies
 * against candidate 1).
 */
export class ColorBlobBallTracker implements BallTrackingAdapter {
  readonly descriptor: PerceptionAdapterDescriptor;
  readonly license: TechnologyLicenseRecord = COLOR_BLOB_BALL_TRACKER_LICENSE;
  readonly failureClasses: readonly FailureClassRecord[] = COLOR_BLOB_BALL_TRACKER_FAILURE_CLASSES;
  readonly resourceRequirements: ResourceRequirements = COLOR_BLOB_BALL_TRACKER_RESOURCES;
  readonly trackerId: string;
  private readonly minBlobArea: number;
  private readonly maxBlobArea: number;
  private readonly maxAspectRatio: number;
  private readonly minCompactness: number;
  private readonly wrapped: NearestBoxBallTracker;

  constructor(options: ColorBlobBallTrackerOptions = {}) {
    const {
      minBlobArea = COLOR_BLOB_DEFAULTS.minBlobArea,
      maxBlobArea = COLOR_BLOB_DEFAULTS.maxBlobArea,
      maxAspectRatio = COLOR_BLOB_DEFAULTS.maxAspectRatio,
      minCompactness = COLOR_BLOB_DEFAULTS.minCompactness,
      ...associationOptions
    } = options;
    if (!Number.isFinite(minBlobArea) || minBlobArea <= 0) {
      throw new RangeError(`ColorBlobBallTracker: minBlobArea must be > 0 (got ${minBlobArea})`);
    }
    if (!Number.isFinite(maxBlobArea) || maxBlobArea <= 0) {
      throw new RangeError(`ColorBlobBallTracker: maxBlobArea must be > 0 (got ${maxBlobArea})`);
    }
    if (minBlobArea > maxBlobArea) {
      throw new RangeError(
        `ColorBlobBallTracker: minBlobArea (${minBlobArea}) must not exceed maxBlobArea ` +
          `(${maxBlobArea})`,
      );
    }
    if (!Number.isFinite(maxAspectRatio) || maxAspectRatio < 1) {
      throw new RangeError(
        `ColorBlobBallTracker: maxAspectRatio must be >= 1 (got ${maxAspectRatio})`,
      );
    }
    if (!Number.isFinite(minCompactness) || minCompactness <= 0 || minCompactness > 1) {
      throw new RangeError(
        `ColorBlobBallTracker: minCompactness must be in (0, 1] (got ${minCompactness})`,
      );
    }
    this.minBlobArea = minBlobArea;
    this.maxBlobArea = maxBlobArea;
    this.maxAspectRatio = maxAspectRatio;
    this.minCompactness = minCompactness;
    this.wrapped = new NearestBoxBallTracker(associationOptions);
    this.trackerId = this.wrapped.trackerId;
    this.descriptor = perceptionDescriptor({
      technologyId: COLOR_BLOB_BALL_TRACKER_ID,
      technologyVersion: COLOR_BLOB_BALL_TRACKER_VERSION,
      adapterVersion: COLOR_BLOB_BALL_TRACKER_ADAPTER_VERSION,
      task: "perception.ball-tracking",
      inputContract: "contracts/observation.detection-sequence@1",
      outputContract: "contracts/observation.track@1",
    });
    assertDescriptorBinding(this.descriptor, "perception.ball-tracking");
  }

  track(frames: readonly DetectionSequenceFrame[]): BallTrack[] {
    validatePresentationOrderedSequence(frames);
    const observationFrames: BallObservationFrame[] = frames.map(({ frame }) => ({
      frameId: frame.frameId,
      presentationMs: frame.presentationMs,
      decodeOrder: frame.decodeOrder,
      detections: extractBallBlobDetections(frame, {
        minBlobArea: this.minBlobArea,
        maxBlobArea: this.maxBlobArea,
        maxAspectRatio: this.maxAspectRatio,
        minCompactness: this.minCompactness,
      }),
    }));
    return this.wrapped.track(observationFrames);
  }
}

/** The shared blob-gate shape used by the ball-blob evidence layer. */
export interface BallBlobGates {
  readonly minBlobArea: number;
  readonly maxBlobArea: number;
  readonly maxAspectRatio: number;
  readonly minCompactness: number;
}

/**
 * The shared ball-blob EVIDENCE LAYER (also consumed by the R201
 * `BallDetectionAdapter` candidate in `ball-blob-detector.ts`): bright-white
 * mask + connected components + the ball-shape gates, emitting ball-class
 * detections with compactness confidence. Pure and deterministic.
 */
export function extractBallBlobDetections(
  frame: DetectorFrameInput,
  gates: BallBlobGates,
): DetectedBox[] {
  const { width, height, bytes } = frame;
  if (width <= 0 || height <= 0) return [];
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      mask[y * width + x] = isBrightWhite(bytes[index]!, bytes[index + 1]!, bytes[index + 2]!)
        ? 1
        : 0;
    }
  }
  const detections: DetectedBox[] = [];
  for (const blob of connectedComponents(mask, width, height)) {
    if (blob.area < gates.minBlobArea || blob.area > gates.maxBlobArea) continue;
    if (blobAspectRatio(blob) > gates.maxAspectRatio) continue;
    const compactness = blobCompactness(blob);
    if (compactness < gates.minCompactness) continue;
    detections.push({
      box: pixelBoundsToNormalizedBox(blob, width, height),
      label: BALL_DETECTION_LABEL,
      confidence: Math.min(1, Math.max(0, compactness)),
    });
  }
  return detections;
}
