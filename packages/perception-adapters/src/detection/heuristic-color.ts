/**
 * R202 candidate 1: `HeuristicColorDetector` — a REAL, deterministic,
 * CPU-only player detector that runs on the actual frame `bytes` pixels.
 *
 * ALGORITHM (documented in full — every rule is part of the contract the
 * benchmark asserts against):
 *
 * 1. PITCH/BACKGROUND SUPPRESSION: a pixel is FOREGROUND when it is NOT
 *    pitch-green (`isPitchGreen` — green-dominant grass tones), NOT
 *    bright-white (`isBrightWhite` — pitch markings and the ball), and
 *    bright enough (`minBrightness`, default 70) to exclude dark
 *    off-pitch background. This suppresses the two dominant non-player
 *    regions of a broadcast-style frame.
 * 2. CONNECTED COMPONENTS: 4-connectivity blob extraction over the
 *    foreground mask, in deterministic row-major order.
 * 3. GEOMETRIC FILTER: blobs with pixel area outside
 *    `[minBlobArea, maxBlobArea]` or bounding-box aspect ratio outside
 *    `[aspectMin, aspectMax]` are discarded (pitch lines are far too
 *    elongated; the ball too small; merged crowds too large).
 * 4. BOX + CONFIDENCE: each surviving blob becomes a `DetectedBox` —
 *    the clamped normalized bounding box, the configured label, and
 *    confidence = the blob's COMPACTNESS (pixel area / bounding-box area,
 *    in `(0, 1]`): how convincingly the blob fills its own box. No
 *    averaging, no flooring — a lanky partial player yields a visibly
 *    lower confidence (architecture-lock §6: no silent confidence
 *    collapse).
 *
 * HONEST LIMITS (this is a WEAK detector, NOT a production candidate —
 * recorded in the descriptor notes and the registry binding):
 *
 * - adjacent/overlapping players MERGE into one blob (undercount);
 * - white or near-white kits are suppressed exactly like pitch markings;
 * - green kits are suppressed exactly like grass;
 * - heavy occlusion truncates blobs (the box keeps the visible part only);
 * - non-broadcast framings (no green pitch dominance) degrade the
 *   suppression predicate catastrophically.
 *
 * Every failure class is deterministic (same input, same output — a retry
 * with identical inputs cannot succeed); `retryable: false` throughout.
 * Pure function of `(options, frame)` — no RNG, no clock, no I/O.
 */
import type { DetectedBox, DetectorFrameInput } from "@sporta/perception-detection";
import type {
  FailureClassRecord,
  PerceptionAdapterDescriptor,
  ResourceRequirements,
  TechnologyLicenseRecord,
} from "@sporta/contracts";
import { assertDescriptorBinding, perceptionDescriptor } from "../errors";
import {
  blobAspectRatio,
  blobCompactness,
  connectedComponents,
  isBrightWhite,
  isPitchGreen,
  pixelBoundsToNormalizedBox,
  brightness,
} from "../pixels";
import { HEURISTIC_COLOR_DETECTOR_LICENSE } from "../licenses";
import type { PlayerDetectionAdapter } from "../adapter";

/** Stable technology identity of this candidate. */
export const HEURISTIC_COLOR_DETECTOR_ID = "heuristic-color-detector";
export const HEURISTIC_COLOR_DETECTOR_VERSION = "0.1.0";
export const HEURISTIC_COLOR_DETECTOR_ADAPTER_VERSION = "0.1.0";

/** Options for {@link HeuristicColorDetector}; every field is optional. */
export interface HeuristicColorDetectorOptions {
  /** Component id (default `heuristic-color-detector-v1`). */
  readonly detectorId?: string;
  /** Emitted class label (default "player"). */
  readonly label?: string;
  /** Minimum blob pixel area (default 24 — excludes the ball and speckle). */
  readonly minBlobArea?: number;
  /** Maximum blob pixel area (default 4000 — excludes merged crowds). */
  readonly maxBlobArea?: number;
  /** Minimum bounding-box aspect ratio (default 0.2). */
  readonly aspectMin?: number;
  /** Maximum bounding-box aspect ratio (default 5). */
  readonly aspectMax?: number;
  /** Minimum foreground brightness (default 70 — excludes dark background). */
  readonly minBrightness?: number;
}

const DEFAULTS = {
  detectorId: "heuristic-color-detector-v1",
  label: "player",
  minBlobArea: 24,
  maxBlobArea: 4000,
  aspectMin: 0.2,
  aspectMax: 5,
  minBrightness: 70,
} as const;

/** Documented failure classes of the heuristic color detector. */
export const HEURISTIC_COLOR_DETECTOR_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "heuristic-color.merged-players",
    description:
      "Adjacent or overlapping players merge into one blob: the frame undercounts " +
      "players and the merged box spans both. Deterministic — identical input " +
      "reproduces the merge; documented weak-detector limit.",
    retryable: false,
  },
  {
    failureClassId: "heuristic-color.suppressed-kit",
    description:
      "A kit that reads pitch-green or bright-white is suppressed with the " +
      "background: those players produce no detection at all. Deterministic.",
    retryable: false,
  },
  {
    failureClassId: "heuristic-color.off-envelope-frame",
    description:
      "A frame without green-pitch dominance (tight crowd shot, off-pitch view) " +
      "degrades the suppression predicate: detection quality collapses. The " +
      "detector is calibrated for broadcast-style pitch views.",
    retryable: false,
  },
];

/** Resource requirements: pure CPU, one core, trivial memory. */
export const HEURISTIC_COLOR_DETECTOR_RESOURCES: ResourceRequirements = {
  gpuRequired: false,
  minCpuCores: 1,
};

/**
 * The deterministic heuristic color-blob player detector (R202 candidate 1).
 *
 * Construct with options; call {@link detect} per frame (synchronous return
 * satisfies the seam's sync-or-async union). The descriptor is validated
 * fail-closed at construction against the frozen binding table.
 */
export class HeuristicColorDetector implements PlayerDetectionAdapter {
  readonly descriptor: PerceptionAdapterDescriptor;
  readonly license: TechnologyLicenseRecord = HEURISTIC_COLOR_DETECTOR_LICENSE;
  readonly failureClasses: readonly FailureClassRecord[] = HEURISTIC_COLOR_DETECTOR_FAILURE_CLASSES;
  readonly resourceRequirements: ResourceRequirements = HEURISTIC_COLOR_DETECTOR_RESOURCES;
  readonly detectorId: string;
  private readonly label: string;
  private readonly minBlobArea: number;
  private readonly maxBlobArea: number;
  private readonly aspectMin: number;
  private readonly aspectMax: number;
  private readonly minBrightness: number;

  constructor(options: HeuristicColorDetectorOptions = {}) {
    const detectorId = options.detectorId ?? DEFAULTS.detectorId;
    const label = options.label ?? DEFAULTS.label;
    const minBlobArea = options.minBlobArea ?? DEFAULTS.minBlobArea;
    const maxBlobArea = options.maxBlobArea ?? DEFAULTS.maxBlobArea;
    const aspectMin = options.aspectMin ?? DEFAULTS.aspectMin;
    const aspectMax = options.aspectMax ?? DEFAULTS.aspectMax;
    const minBrightness = options.minBrightness ?? DEFAULTS.minBrightness;
    // Fail loud at construction (the repo convention): the geometric gates
    // are part of the documented algorithm and must stay ordered/positive.
    if (typeof detectorId !== "string" || detectorId.length < 1) {
      throw new RangeError("HeuristicColorDetector: detectorId must be a non-empty string");
    }
    if (typeof label !== "string" || label.length < 1) {
      throw new RangeError("HeuristicColorDetector: label must be a non-empty string");
    }
    for (const [name, value] of [
      ["minBlobArea", minBlobArea],
      ["maxBlobArea", maxBlobArea],
      ["aspectMin", aspectMin],
      ["aspectMax", aspectMax],
      ["minBrightness", minBrightness],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`HeuristicColorDetector: ${name} must be > 0 (got ${value})`);
      }
    }
    if (minBlobArea > maxBlobArea) {
      throw new RangeError(
        `HeuristicColorDetector: minBlobArea (${minBlobArea}) must not exceed maxBlobArea ` +
          `(${maxBlobArea})`,
      );
    }
    if (aspectMin > aspectMax) {
      throw new RangeError(
        `HeuristicColorDetector: aspectMin (${aspectMin}) must not exceed aspectMax ` +
          `(${aspectMax})`,
      );
    }
    this.detectorId = detectorId;
    this.label = label;
    this.minBlobArea = minBlobArea;
    this.maxBlobArea = maxBlobArea;
    this.aspectMin = aspectMin;
    this.aspectMax = aspectMax;
    this.minBrightness = minBrightness;
    this.descriptor = perceptionDescriptor({
      technologyId: HEURISTIC_COLOR_DETECTOR_ID,
      technologyVersion: HEURISTIC_COLOR_DETECTOR_VERSION,
      adapterVersion: HEURISTIC_COLOR_DETECTOR_ADAPTER_VERSION,
      task: "perception.player-detection",
      inputContract: "contracts/normalized-video-frame@1",
      outputContract: "contracts/observation.detection@1",
    });
    assertDescriptorBinding(this.descriptor, "perception.player-detection");
  }

  detect(frame: DetectorFrameInput): DetectedBox[] {
    const { width, height, bytes } = frame;
    if (width <= 0 || height <= 0) return [];
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 3;
        const r = bytes[index]!;
        const g = bytes[index + 1]!;
        const b = bytes[index + 2]!;
        const foreground =
          !isPitchGreen(r, g, b) &&
          !isBrightWhite(r, g, b) &&
          brightness(r, g, b) >= this.minBrightness;
        mask[y * width + x] = foreground ? 1 : 0;
      }
    }
    const detections: DetectedBox[] = [];
    for (const blob of connectedComponents(mask, width, height)) {
      if (blob.area < this.minBlobArea || blob.area > this.maxBlobArea) continue;
      const aspect = blobAspectRatio(blob);
      if (aspect < this.aspectMin || aspect > this.aspectMax) continue;
      const compactness = blobCompactness(blob);
      detections.push({
        box: pixelBoundsToNormalizedBox(blob, width, height),
        label: this.label,
        confidence: Math.min(1, Math.max(0, compactness)),
      });
    }
    return detections;
  }
}
