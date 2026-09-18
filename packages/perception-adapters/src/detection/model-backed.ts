/**
 * R202 candidate 2: `ModelBackedDetector` — the model-backed player detector
 * candidate: it runs a real open-source detector WHEN weights are present
 * AND an inference backend is wired, and fails closed — loudly, typed, with
 * the exact integration point documented — otherwise.
 *
 * HONEST STATEMENT OF WHAT THIS CANDIDATE IS TODAY (no fabricated
 * competence): the adapter plane carries the binding, the license record,
 * the weights-provenance check, and the EXACT INTEGRATION POINT for the real
 * inference runtime. The runtime itself is the GPU worker protocol (W303) —
 * the repo's own architecture ("real ML backends arrive with the GPU worker
 * protocol", W201 seam docs) — so this candidate:
 *
 * - checks for `yolov8n.pt` / `yolov5nu.onnx` style assets under
 *   `packages/perception-adapters/assets/` (see `assets/README.md` for the
 *   pinned official-release provenance) and reports `weightsStatus`;
 * - runs `detect` ONLY when weights are present AND a
 *   {@link ModelInferenceBackend} was injected (the W303 integration
 *   point: a one-method seam taking the frame, returning raw boxes);
 * - otherwise throws {@link CandidateFailureError} with the documented
 *   failure class (`weights-unavailable` or `inference-backend-not-wired`)
 *   — a deliberate, classified refusal, never a silent empty result that
 *   would look like "no players in frame".
 *
 * CLASS MAPPING (documented for the standard YOLO COCO lineage, applied by
 * the backend CONTRACT not by this adapter): COCO class 0 ("person") maps
 * to the player label; class 32 ("sports ball") is NOT this family's
 * output and must be filtered by conforming backends. The adapter trusts
 * its backend to already emit player-class boxes only — the integration
 * point documents this obligation.
 *
 * DETERMINISM: the adapter itself is a pure function of
 * `(options, frame, backend)` — no RNG, no clock. Real-model determinism is
 * a property of the backend (fixed weights, fixed runtime, seeded
 * pre/post-processing); benchmarks record the seed in their
 * reproducibility block.
 *
 * LICENSE (see `licenses.ts` MODEL_BACKED_DETECTOR_LICENSE): code = repo's
 * (unresolved — no LICENSE file at the repo root); model = AGPL-3.0
 * (Ultralytics YOLOv8 lineage) with the commercial-use verdict deliberately
 * UNREVIEWED — evaluation-only; dataset = COCO detection corpus, commercial
 * use not affirmed; assets = the optional weights file, AGPL-3.0.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DetectedBox, DetectorFrameInput } from "@sporta/perception-detection";
import type {
  FailureClassRecord,
  PerceptionAdapterDescriptor,
  ResourceRequirements,
  TechnologyLicenseRecord,
} from "@sporta/contracts";
import { assertDescriptorBinding, CandidateFailureError, perceptionDescriptor } from "../errors";
import { MODEL_BACKED_DETECTOR_LICENSE } from "../licenses";
import type { PlayerDetectionAdapter } from "../adapter";

/** Stable technology identity of this candidate. */
export const MODEL_BACKED_DETECTOR_ID = "model-backed-detector";
export const MODEL_BACKED_DETECTOR_VERSION = "0.1.0";
export const MODEL_BACKED_DETECTOR_ADAPTER_VERSION = "0.1.0";

/** Weight asset file names this candidate checks for, in order. */
export const MODEL_WEIGHT_FILE_NAMES: readonly string[] = ["yolov8n.pt", "yolov5nu.onnx"];

/** The runtime presence status of the model weights asset. */
export type WeightsStatus = "downloaded" | "not-downloaded";

/**
 * THE EXACT INTEGRATION POINT (W303): the one-method inference backend seam
 * a real detector runtime plugs into. A conforming backend consumes the
 * normalized video frame plus the resolved weights path, runs the model,
 * and returns PLAYER-CLASS boxes only (COCO class 0 mapped to the player
 * label; everything else filtered) with calibrated confidences in [0, 1].
 */
export interface ModelInferenceBackend {
  /** Backend component id (used in failure messages). */
  readonly backendId: string;
  /** Runs player-class inference on one frame with the given weights. */
  infer(frame: DetectorFrameInput, weightsPath: string): readonly DetectedBox[];
}

/** Options for {@link ModelBackedDetector}. */
export interface ModelBackedDetectorOptions {
  /** Component id (default `model-backed-detector-v1`). */
  readonly detectorId?: string;
  /**
   * Directory to check for weight assets (default: this package's `assets/`
   * directory, resolved from the module location).
   */
  readonly weightsDir?: string;
  /** The injected inference backend — the W303 integration point. */
  readonly backend?: ModelInferenceBackend;
  /** Emitted class label (default "player"). */
  readonly label?: string;
}

/** Documented failure classes of the model-backed detector. */
export const MODEL_BACKED_DETECTOR_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "model-backed.weights-unavailable",
    description:
      "No model weights asset (yolov8n.pt / yolov5nu.onnx) was found under the " +
      "assets directory. See packages/perception-adapters/assets/README.md for the " +
      "pinned official-release download. Not transient — a retry only succeeds " +
      "after the asset is placed.",
    retryable: false,
  },
  {
    failureClassId: "model-backed.inference-backend-not-wired",
    description:
      "Weights are present but no ModelInferenceBackend was injected: the real " +
      "inference runtime arrives with the GPU worker protocol (W303). This is the " +
      "documented pre-W303 state of the candidate, surfaced as a typed refusal " +
      "rather than a silent empty detection list.",
    retryable: false,
  },
];

/** Resource requirements: CPU-capable; GPU strongly preferred; weights RAM. */
export const MODEL_BACKED_DETECTOR_RESOURCES: ResourceRequirements = {
  gpuRequired: false,
  minRamGb: 1,
  minCpuCores: 2,
};

/**
 * Resolves the weights presence under `weightsDir`: the FIRST existing file
 * from {@link MODEL_WEIGHT_FILE_NAMES}, or `undefined` when none exists.
 * Pure filesystem check — deterministic, no network, no downloads.
 */
export function resolveWeightsPath(weightsDir: string): string | undefined {
  for (const fileName of MODEL_WEIGHT_FILE_NAMES) {
    const candidate = join(weightsDir, fileName);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The model-backed player detector (R202 candidate 2).
 *
 * The constructor resolves the weights presence once (see
 * {@link resolveWeightsPath}); {@link detect} runs the injected backend when
 * weights are present, and fails closed with the documented typed failure
 * classes otherwise. The descriptor is validated fail-closed at
 * construction against the frozen binding table.
 */
export class ModelBackedDetector implements PlayerDetectionAdapter {
  readonly descriptor: PerceptionAdapterDescriptor;
  readonly license: TechnologyLicenseRecord = MODEL_BACKED_DETECTOR_LICENSE;
  readonly failureClasses: readonly FailureClassRecord[] = MODEL_BACKED_DETECTOR_FAILURE_CLASSES;
  readonly resourceRequirements: ResourceRequirements = MODEL_BACKED_DETECTOR_RESOURCES;
  readonly detectorId: string;
  /** Resolved weights presence (checked at construction, reported honestly). */
  readonly weightsStatus: WeightsStatus;
  /** The resolved weights file path when {@link weightsStatus} is "downloaded". */
  readonly weightsPath: string | undefined;
  private readonly backend: ModelInferenceBackend | undefined;

  constructor(options: ModelBackedDetectorOptions = {}) {
    const detectorId = options.detectorId ?? "model-backed-detector-v1";
    if (typeof detectorId !== "string" || detectorId.length < 1) {
      throw new RangeError("ModelBackedDetector: detectorId must be a non-empty string");
    }
    this.detectorId = detectorId;
    this.weightsPath = resolveWeightsPath(
      options.weightsDir ?? join(import.meta.dir, "..", "..", "assets"),
    );
    this.weightsStatus = this.weightsPath === undefined ? "not-downloaded" : "downloaded";
    this.backend = options.backend;
    this.descriptor = perceptionDescriptor({
      technologyId: MODEL_BACKED_DETECTOR_ID,
      technologyVersion: MODEL_BACKED_DETECTOR_VERSION,
      adapterVersion: MODEL_BACKED_DETECTOR_ADAPTER_VERSION,
      task: "perception.player-detection",
      inputContract: "contracts/normalized-video-frame@1",
      outputContract: "contracts/observation.detection@1",
    });
    assertDescriptorBinding(this.descriptor, "perception.player-detection");
  }

  detect(frame: DetectorFrameInput): readonly DetectedBox[] {
    if (this.weightsPath === undefined) {
      throw new CandidateFailureError(
        `ModelBackedDetector: no model weights asset found (checked ` +
          `${MODEL_WEIGHT_FILE_NAMES.join(", ")}); see ` +
          `packages/perception-adapters/assets/README.md for the pinned download`,
        { failureClassId: "model-backed.weights-unavailable", detectorId: this.detectorId },
      );
    }
    if (this.backend === undefined) {
      throw new CandidateFailureError(
        `ModelBackedDetector: weights present (${this.weightsPath}) but no inference ` +
          `backend is wired — the real runtime arrives with the GPU worker protocol ` +
          `(W303); inject a ModelInferenceBackend to run this candidate`,
        { failureClassId: "model-backed.inference-backend-not-wired", detectorId: this.detectorId },
      );
    }
    return this.backend.infer(frame, this.weightsPath);
  }
}
