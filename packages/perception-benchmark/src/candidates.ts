/**
 * THE BENCHMARK-TRACK CANDIDATE REGISTRATIONS (L010) — the perception
 * candidates the benchmark harness can run, each registered through the
 * Technology Plane conventions (`docs/architecture/technology-plane.md`):
 * identity + version + provenance + THREE-WAY license (code / model
 * checkpoint / training dataset, recorded SEPARATELY per ADR-011 and the
 * technology-plane license policy) + documented failure classes + resource
 * requirements.
 *
 * THE HONEST BOUNDARY (recorded on every run this harness produces):
 *
 * - `contrast-context-detector` — the J012 license-clean production path
 *   (pure code, zero external components). RUNS on any benchmark clip
 *   CPU-only, deterministically.
 *
 * - `hf.rfdetr.soccernet` — the P1 license-clean MODEL candidate (RF-DETR
 *   SoccerNet, `docs/technology/hugging-face-candidates.yaml`). Its
 *   checkpoint is apache-2.0 (model card), which PERMITS an operator to
 *   download it for benchmark evaluation — but Sporta has NO inference
 *   runtime wired this wave (the W303 GPU-worker protocol / L011 runtime
 *   seam is Wave 2+), and the harness REFUSES to fabricate inference: the
 *   candidate runs honestly as its documented
 *   `rfdetr-soccernet.inference-runtime-unavailable` refusal class, counted
 *   per frame. Weights are NEVER vendored, NEVER committed, and the
 *   dataset-lineage component (SoccerNet corpus terms) stays honestly
 *   unresolved. Real model inference on authorized media is benchmarked
 *   when the runtime seam exists — that boundary is recorded on the run,
 *   never papered over.
 *
 * - `model-backed-detector` — the AGPL-adjacent Ultralytics YOLOv8n class
 *   (evaluation-only, never the production path; the J012 decision). Its
 *   refusal posture (weights-unavailable / inference-backend-not-wired) is
 *   the documented pre-W303 state.
 */
import type {
  FailureClassRecord,
  ResourceRequirements,
  TechnologyCandidate,
  TechnologyLicenseRecord,
} from "@sporta/contracts";
import { SCHEMA_VERSION } from "@sporta/contracts";
import {
  CONTRAST_CONTEXT_DETECTOR_ADAPTER_VERSION,
  CONTRAST_CONTEXT_DETECTOR_ID,
  CONTRAST_CONTEXT_DETECTOR_VERSION,
  ContrastContextDetector,
} from "@sporta/perception-adapters";
import type { PlayerDetectionAdapter } from "@sporta/perception-adapters";
import {
  HEURISTIC_COLOR_DETECTOR_ADAPTER_VERSION,
  HEURISTIC_COLOR_DETECTOR_ID,
  HEURISTIC_COLOR_DETECTOR_VERSION,
  HeuristicColorDetector,
} from "@sporta/perception-adapters";

/** The fixed registration epoch for benchmark-track binding records. */
export const PERCEPTION_BENCHMARK_REGISTRATION_EPOCH_MS = 1_736_164_800_000;

/** The registry id of the RF-DETR SoccerNet candidate (hugging-face-candidates.yaml). */
export const RFDETR_SOCCERNET_CANDIDATE_ID = "hf.rfdetr.soccernet";

/**
 * The THREE-WAY license record for `hf.rfdetr.soccernet` (recorded
 * separately per ADR-011: permissive code does NOT make the checkpoint or
 * the dataset commercially usable):
 *
 * - CODE: the RF-DETR architecture implementation (Roboflow lineage) —
 *   apache-2.0 per the model card.
 * - MODEL CHECKPOINT: `julianzu9612/RFDETR-Soccernet` — apache-2.0 per the
 *   model card (download permitted for benchmark evaluation; never
 *   committed, never vendored; production promotion requires the benchmark
 *   + runtime + review evidence).
 * - DATASET: the SoccerNet corpus lineage — challenge/research-oriented
 *   terms; commercial use NOT affirmed by Sporta review — honestly
 *   unresolved (never fabricated).
 */
export const RFDETR_SOCCERNET_LICENSE: TechnologyLicenseRecord = {
  code: {
    status: "permissive",
    licenseId: "Apache-2.0",
    commercialUse: true,
    reviewRef:
      "https://huggingface.co/julianzu9612/RFDETR-Soccernet — model card code license " +
      "(RF-DETR architecture, Roboflow apache-2.0 lineage)",
  },
  model: {
    status: "permissive",
    licenseId: "Apache-2.0",
    commercialUse: true,
    reviewRef:
      "https://huggingface/julianzu9612/RFDETR-Soccernet — model card: apache-2.0 " +
      "(operator may download for benchmark evaluation; NEVER committed to the repo)",
  },
  dataset: {
    status: "unresolved",
    licenseId: "SoccerNet-corpus-terms",
    reviewRef:
      "SoccerNet training corpus (challenge/research-oriented terms) — the checkpoint's " +
      "data lineage; commercial use not affirmed by Sporta review",
  },
};

/** Documented failure classes of the RF-DETR SoccerNet benchmark candidate. */
export const RFDETR_SOCCERNET_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "rfdetr-soccernet.inference-runtime-unavailable",
    description:
      "No Sporta inference runtime is wired (the W303 GPU-worker protocol / L011 " +
      "broadcast-perception runtime seam, Wave 2+). The candidate refuses per frame " +
      "rather than fabricating detections — the documented pre-runtime state, " +
      "identical in spirit to the model-backed detector's pre-W303 posture.",
    retryable: false,
  },
  {
    failureClassId: "rfdetr-soccernet.weights-not-downloaded",
    description:
      "The apache-2.0 checkpoint was not downloaded into the operator-provided " +
      "weights directory. An operator may download it for benchmark evaluation " +
      "(never committed); until then the candidate refuses with this class.",
    retryable: false,
  },
];

/** Resource requirements: GPU strongly preferred; checkpoint RAM. */
export const RFDETR_SOCCERNET_RESOURCES: ResourceRequirements = {
  gpuRequired: true,
  minRamGb: 4,
  minCpuCores: 2,
};

/** The TechnologyCandidate-shaped registration record for RF-DETR SoccerNet. */
export const RFDETR_SOCCERNET_CANDIDATE: TechnologyCandidate = {
  schemaVersion: SCHEMA_VERSION,
  candidateId: `${RFDETR_SOCCERNET_CANDIDATE_ID}@0.1.0`,
  technologyId: RFDETR_SOCCERNET_CANDIDATE_ID,
  technologyVersion: "0.1.0",
  adapterVersion: "0.1.0",
  task: "perception.player-detection",
  displayName: "RF-DETR SoccerNet (HF P1 candidate — benchmark track)",
  registeredAtMs: PERCEPTION_BENCHMARK_REGISTRATION_EPOCH_MS,
  sourceUrl: "https://huggingface.co/julianzu9612/RFDETR-Soccernet",
  notes:
    "License-clean MODEL candidate (code + checkpoint apache-2.0; dataset lineage " +
    "unresolved). Benchmark-track registration: refuses honestly until the W303/L011 " +
    "inference runtime exists; weights never vendored. Production promotion is " +
    "benchmark-required + runtime-seam-required (Wave 2+).",
};

/**
 * The REFUSAL the RF-DETR candidate produces per frame this wave — the
 * honest pre-runtime posture (the harness counts these per frame; it never
 * fabricates detections).
 */
export const RFDETR_SOCCERNET_RUNTIME_REFUSAL =
  "rfdetr-soccernet.inference-runtime-unavailable" as const;

/** One registered benchmark-track candidate. */
export interface PerceptionBenchmarkCandidate {
  /** The TechnologyCandidate-shaped registration record. */
  readonly candidate: TechnologyCandidate;
  /** The three-way license record. */
  readonly license: TechnologyLicenseRecord;
  /** Documented failure classes. */
  readonly failureClasses: readonly FailureClassRecord[];
  /** Resource requirements. */
  readonly resourceRequirements: ResourceRequirements;
  /**
   * The per-frame detect callable. For the runtime-backed candidates this
   * THROWS the documented refusal (the harness counts it per frame — the
   * honest degradation pattern); for the pure-code candidates it detects.
   */
  readonly detect: (frame: Parameters<PlayerDetectionAdapter["detect"]>[0]) => unknown;
  /** Whether the candidate is expected to RUN (vs refuse honestly). */
  readonly runnable: boolean;
}

function repoCodeLicense(): TechnologyLicenseRecord["code"] {
  return {
    status: "unresolved",
    reviewRef:
      "https://github.com/payswapdotorg/sporta — repository root carries no LICENSE " +
      "file as of this wave; commercial-use verdict pending that declaration",
  };
}

/** The harness's runnable production-path candidate (pure code). */
export function contrastContextBenchmarkCandidate(): PerceptionBenchmarkCandidate {
  const detector = new ContrastContextDetector();
  return {
    candidate: {
      schemaVersion: SCHEMA_VERSION,
      candidateId: `${CONTRAST_CONTEXT_DETECTOR_ID}@${CONTRAST_CONTEXT_DETECTOR_VERSION}`,
      technologyId: CONTRAST_CONTEXT_DETECTOR_ID,
      technologyVersion: CONTRAST_CONTEXT_DETECTOR_VERSION,
      adapterVersion: CONTRAST_CONTEXT_DETECTOR_ADAPTER_VERSION,
      task: "perception.player-detection",
      displayName: "Contrast-context player detector (J012 production path)",
      registeredAtMs: PERCEPTION_BENCHMARK_REGISTRATION_EPOCH_MS,
      notes:
        "Pure-code license-clean production path: surface-agnostic local contrast + " +
        "surface/ring context gates; deterministic CPU-only; zero external components.",
    },
    license: { code: repoCodeLicense() },
    failureClasses: detector.failureClasses,
    resourceRequirements: detector.resourceRequirements,
    detect: (frame) => detector.detect(frame),
    runnable: true,
  };
}

/** The harness's baseline candidate (the weak color detector, for comparison). */
export function heuristicColorBenchmarkCandidate(): PerceptionBenchmarkCandidate {
  const detector = new HeuristicColorDetector();
  return {
    candidate: {
      schemaVersion: SCHEMA_VERSION,
      candidateId: `${HEURISTIC_COLOR_DETECTOR_ID}@${HEURISTIC_COLOR_DETECTOR_VERSION}`,
      technologyId: HEURISTIC_COLOR_DETECTOR_ID,
      technologyVersion: HEURISTIC_COLOR_DETECTOR_VERSION,
      adapterVersion: HEURISTIC_COLOR_DETECTOR_ADAPTER_VERSION,
      task: "perception.player-detection",
      displayName: "Heuristic color-blob player detector (weak baseline)",
      registeredAtMs: PERCEPTION_BENCHMARK_REGISTRATION_EPOCH_MS,
      notes:
        "Weak baseline: grass-calibrated suppression; documented merge/kit limits — " +
        "the detector that produced the audited empty-SWM failure mode.",
    },
    license: { code: repoCodeLicense() },
    failureClasses: detector.failureClasses,
    resourceRequirements: detector.resourceRequirements,
    detect: (frame) => detector.detect(frame),
    runnable: true,
  };
}

/** The RF-DETR SoccerNet benchmark-track candidate (refuses honestly pre-runtime). */
export function rfdetrSoccernetBenchmarkCandidate(): PerceptionBenchmarkCandidate {
  return {
    candidate: RFDETR_SOCCERNET_CANDIDATE,
    license: RFDETR_SOCCERNET_LICENSE,
    failureClasses: RFDETR_SOCCERNET_FAILURE_CLASSES,
    resourceRequirements: RFDETR_SOCCERNET_RESOURCES,
    detect: () => {
      throw new Error(
        `RF-DETR SoccerNet: ${RFDETR_SOCCERNET_RUNTIME_REFUSAL} — no Sporta inference ` +
          "runtime is wired (W303/L011, Wave 2+); the harness counts this refusal per " +
          "frame and never fabricates detections",
      );
    },
    runnable: false,
  };
}

/** All registered benchmark-track candidates (identity order, deterministic). */
export function registeredBenchmarkCandidates(): readonly PerceptionBenchmarkCandidate[] {
  return [
    contrastContextBenchmarkCandidate(),
    heuristicColorBenchmarkCandidate(),
    rfdetrSoccernetBenchmarkCandidate(),
  ];
}
