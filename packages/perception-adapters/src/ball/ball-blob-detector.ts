/**
 * Ball-detection candidates (R201's `BallDetectionAdapter` family): the
 * pixel-space blob detector (the color-blob tracker's evidence layer,
 * exposed as its own per-frame candidate) and the model-backed ball
 * detector (the same weights/backend integration point as the player
 * candidate, with the ball class mapping). Both carry the frozen
 * `perception.ball-detection` binding (input `normalized-video-frame@1`,
 * output `observation.detection@1`) and fail-closed descriptor validation.
 *
 * HONEST SCOPE NOTE: the packet's funded candidate work items are
 * R202/R203/R204/R205/R206; this family's two candidates exist so that
 * EVERY R201-delivered family interface has at least two conforming,
 * materially different implementations (the strict reading of R201's
 * acceptance criterion).
 */
import type { DetectedBox, DetectorFrameInput } from "@sporta/perception-detection";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  FailureClassRecord,
  PerceptionAdapterDescriptor,
  ResourceRequirements,
  TechnologyLicenseRecord,
} from "@sporta/contracts";
import { assertDescriptorBinding, CandidateFailureError, perceptionDescriptor } from "../errors";
import { COLOR_BLOB_BALL_TRACKER_LICENSE, MODEL_BACKED_DETECTOR_LICENSE } from "../licenses";
import type { BallDetectionAdapter } from "../adapter";
import { extractBallBlobDetections } from "./color-blob";

// ---------------------------------------------------------------------------
// Candidate 1: the pixel-space blob ball detector
// ---------------------------------------------------------------------------

/** Stable technology identity of this candidate. */
export const BALL_BLOB_DETECTOR_ID = "ball-blob-detector";
export const BALL_BLOB_DETECTOR_VERSION = "0.1.0";
export const BALL_BLOB_DETECTOR_ADAPTER_VERSION = "0.1.0";

/** Options for {@link BallBlobDetector}; every field is optional. */
export interface BallBlobDetectorOptions {
  /** Component id (default `ball-blob-detector-v1`). */
  readonly detectorId?: string;
  /** Minimum blob pixel area (default 8 — see the color-blob module docs). */
  readonly minBlobArea?: number;
  /** Maximum blob pixel area (default 120). */
  readonly maxBlobArea?: number;
  /** Maximum bounding-box aspect ratio (default 1.6 — line rejection). */
  readonly maxAspectRatio?: number;
  /** Minimum blob compactness (default 0.5 — below a rasterized disc's ~0.55). */
  readonly minCompactness?: number;
}

const BALL_BLOB_DEFAULTS = {
  detectorId: "ball-blob-detector-v1",
  minBlobArea: 8,
  maxBlobArea: 120,
  maxAspectRatio: 1.6,
  minCompactness: 0.5,
} as const;

/** Documented failure classes (shared semantics with the color-blob tracker). */
export const BALL_BLOB_DETECTOR_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "ball-blob.white-kit-confusion",
    description:
      "A bright-white kit fragment inside the area gates masquerades as the ball. " +
      "Per-frame detection carries no motion context (that is the tracker's job), " +
      "so this candidate alone cannot disambiguate.",
    retryable: false,
  },
  {
    failureClassId: "ball-blob.line-clutter",
    description:
      "Line intersections and marking fragments that survive the shape gates emit " +
      "spurious ball detections; the area gate excludes the 2x2/2x3 crossing " +
      "fragments of 2px lines, but larger markings survive.",
    retryable: false,
  },
];

/** Resource requirements: pure CPU, one core. */
export const BALL_BLOB_DETECTOR_RESOURCES: ResourceRequirements = {
  gpuRequired: false,
  minCpuCores: 1,
};

/**
 * The pixel-space blob ball detector (R201 ball-detection candidate 1):
 * per-frame bright-white blob extraction with the ball-shape gates — the
 * exact evidence layer the R204 color-blob tracker consumes (shared code,
 * one truth). Every emitted box carries the ball class label.
 */
export class BallBlobDetector implements BallDetectionAdapter {
  readonly descriptor: PerceptionAdapterDescriptor;
  readonly license: TechnologyLicenseRecord = COLOR_BLOB_BALL_TRACKER_LICENSE;
  readonly failureClasses: readonly FailureClassRecord[] = BALL_BLOB_DETECTOR_FAILURE_CLASSES;
  readonly resourceRequirements: ResourceRequirements = BALL_BLOB_DETECTOR_RESOURCES;
  readonly detectorId: string;
  private readonly gates: {
    minBlobArea: number;
    maxBlobArea: number;
    maxAspectRatio: number;
    minCompactness: number;
  };

  constructor(options: BallBlobDetectorOptions = {}) {
    const detectorId = options.detectorId ?? BALL_BLOB_DEFAULTS.detectorId;
    const gates = {
      minBlobArea: options.minBlobArea ?? BALL_BLOB_DEFAULTS.minBlobArea,
      maxBlobArea: options.maxBlobArea ?? BALL_BLOB_DEFAULTS.maxBlobArea,
      maxAspectRatio: options.maxAspectRatio ?? BALL_BLOB_DEFAULTS.maxAspectRatio,
      minCompactness: options.minCompactness ?? BALL_BLOB_DEFAULTS.minCompactness,
    };
    if (typeof detectorId !== "string" || detectorId.length < 1) {
      throw new RangeError("BallBlobDetector: detectorId must be a non-empty string");
    }
    if (gates.minBlobArea <= 0 || gates.maxBlobArea <= 0 || gates.minBlobArea > gates.maxBlobArea) {
      throw new RangeError(
        `BallBlobDetector: blob area gates must satisfy 0 < min <= max (got ` +
          `${gates.minBlobArea}..${gates.maxBlobArea})`,
      );
    }
    if (gates.maxAspectRatio < 1) {
      throw new RangeError(
        `BallBlobDetector: maxAspectRatio must be >= 1 (got ${gates.maxAspectRatio})`,
      );
    }
    if (gates.minCompactness <= 0 || gates.minCompactness > 1) {
      throw new RangeError(
        `BallBlobDetector: minCompactness must be in (0, 1] (got ${gates.minCompactness})`,
      );
    }
    this.detectorId = detectorId;
    this.gates = gates;
    this.descriptor = perceptionDescriptor({
      technologyId: BALL_BLOB_DETECTOR_ID,
      technologyVersion: BALL_BLOB_DETECTOR_VERSION,
      adapterVersion: BALL_BLOB_DETECTOR_ADAPTER_VERSION,
      task: "perception.ball-detection",
      inputContract: "contracts/normalized-video-frame@1",
      outputContract: "contracts/observation.detection@1",
    });
    assertDescriptorBinding(this.descriptor, "perception.ball-detection");
  }

  detect(frame: DetectorFrameInput): DetectedBox[] {
    return extractBallBlobDetections(frame, this.gates);
  }
}

// ---------------------------------------------------------------------------
// Candidate 2: the model-backed ball detector
// ---------------------------------------------------------------------------

/** Stable technology identity of this candidate. */
export const MODEL_BACKED_BALL_DETECTOR_ID = "model-backed-ball-detector";
export const MODEL_BACKED_BALL_DETECTOR_VERSION = "0.1.0";
export const MODEL_BACKED_BALL_DETECTOR_ADAPTER_VERSION = "0.1.0";

/**
 * THE EXACT INTEGRATION POINT (W303): a conforming backend consumes the
 * frame plus weights and returns BALL-class boxes only — for the standard
 * YOLO COCO lineage that means COCO class 32 ("sports ball") mapped to the
 * ball label; every other class filtered. The adapter trusts its backend
 * to already emit ball-class boxes only (the obligation is documented
 * here, enforced by contract review of the backend).
 */
export interface BallModelInferenceBackend {
  /** Backend component id (used in failure messages). */
  readonly backendId: string;
  /** Runs ball-class inference on one frame with the given weights. */
  infer(frame: DetectorFrameInput, weightsPath: string): readonly DetectedBox[];
}

/** Options for {@link ModelBackedBallDetector}. */
export interface ModelBackedBallDetectorOptions {
  /** Component id (default `model-backed-ball-detector-v1`). */
  readonly detectorId?: string;
  /** Directory to check for weight assets (default: the package assets dir). */
  readonly weightsDir?: string;
  /** The injected inference backend — the W303 integration point. */
  readonly backend?: BallModelInferenceBackend;
}

/** Documented failure classes (shared semantics with the player candidate). */
export const MODEL_BACKED_BALL_DETECTOR_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "model-backed-ball.weights-unavailable",
    description:
      "No weights asset (yolov8n.pt / yolov5nu.onnx) found under the assets " +
      "directory — see packages/perception-adapters/assets/README.md.",
    retryable: false,
  },
  {
    failureClassId: "model-backed-ball.inference-backend-not-wired",
    description:
      "Weights present but no BallModelInferenceBackend injected: the real runtime " +
      "arrives with the GPU worker protocol (W303). Typed refusal, never a silent " +
      "empty detection list.",
    retryable: false,
  },
];

/** Resource requirements: CPU-capable; GPU strongly preferred; weights RAM. */
export const MODEL_BACKED_BALL_DETECTOR_RESOURCES: ResourceRequirements = {
  gpuRequired: false,
  minRamGb: 1,
  minCpuCores: 2,
};

/**
 * The model-backed ball detector (R201 ball-detection candidate 2): the
 * same honest pattern as the player-side `ModelBackedDetector` — weights
 * presence check, typed fail-closed refusals, and the documented W303
 * integration point; when weights AND a backend are present it runs and
 * emits ball-class boxes only.
 */
export class ModelBackedBallDetector implements BallDetectionAdapter {
  readonly descriptor: PerceptionAdapterDescriptor;
  readonly license: TechnologyLicenseRecord = MODEL_BACKED_DETECTOR_LICENSE;
  readonly failureClasses: readonly FailureClassRecord[] =
    MODEL_BACKED_BALL_DETECTOR_FAILURE_CLASSES;
  readonly resourceRequirements: ResourceRequirements = MODEL_BACKED_BALL_DETECTOR_RESOURCES;
  readonly detectorId: string;
  readonly weightsStatus: "downloaded" | "not-downloaded";
  readonly weightsPath: string | undefined;
  private readonly backend: BallModelInferenceBackend | undefined;

  constructor(options: ModelBackedBallDetectorOptions = {}) {
    const detectorId = options.detectorId ?? "model-backed-ball-detector-v1";
    if (typeof detectorId !== "string" || detectorId.length < 1) {
      throw new RangeError("ModelBackedBallDetector: detectorId must be a non-empty string");
    }
    this.detectorId = detectorId;
    // `import.meta.dir` is Bun-only (undefined under Node/bundled runtimes
    // — a TypeError in `join`); `import.meta.url` is the portable ESM form.
    const weightsDir = options.weightsDir ??
      join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "assets");
    let weightsPath: string | undefined;
    for (const fileName of ["yolov8n.pt", "yolov5nu.onnx"]) {
      const candidate = join(weightsDir, fileName);
      if (existsSync(candidate)) {
        weightsPath = candidate;
        break;
      }
    }
    this.weightsPath = weightsPath;
    this.weightsStatus = weightsPath === undefined ? "not-downloaded" : "downloaded";
    this.backend = options.backend;
    this.descriptor = perceptionDescriptor({
      technologyId: MODEL_BACKED_BALL_DETECTOR_ID,
      technologyVersion: MODEL_BACKED_BALL_DETECTOR_VERSION,
      adapterVersion: MODEL_BACKED_BALL_DETECTOR_ADAPTER_VERSION,
      task: "perception.ball-detection",
      inputContract: "contracts/normalized-video-frame@1",
      outputContract: "contracts/observation.detection@1",
    });
    assertDescriptorBinding(this.descriptor, "perception.ball-detection");
  }

  detect(frame: DetectorFrameInput): readonly DetectedBox[] {
    if (this.weightsPath === undefined) {
      throw new CandidateFailureError(
        `ModelBackedBallDetector: no model weights asset found; see ` +
          `packages/perception-adapters/assets/README.md for the pinned download`,
        { failureClassId: "model-backed-ball.weights-unavailable", detectorId: this.detectorId },
      );
    }
    if (this.backend === undefined) {
      throw new CandidateFailureError(
        `ModelBackedBallDetector: weights present (${this.weightsPath}) but no inference ` +
          `backend is wired — the real runtime arrives with the GPU worker protocol ` +
          `(W303); inject a BallModelInferenceBackend to run this candidate`,
        {
          failureClassId: "model-backed-ball.inference-backend-not-wired",
          detectorId: this.detectorId,
        },
      );
    }
    return this.backend.infer(frame, this.weightsPath);
  }
}
