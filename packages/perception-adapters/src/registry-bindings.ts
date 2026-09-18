/**
 * Registration bindings (R201): maps every shipped adapter instance to a
 * `TechnologyCandidate`-shaped record (frozen types from
 * `@sporta/contracts` ONLY) — the BINDING-READINESS proof for the runtime
 * Technology Registry, which is ANOTHER LANE's Wave-1 deliverable and is
 * deliberately NOT in this tree. The Tech Lead wires the registry at
 * integration; what this module proves is that every candidate can hand
 * the registry a coherent, frozen-contract-shaped registration record.
 *
 * `registeredAtMs` uses a FIXED deterministic epoch constant (the repo's
 * test epoch): these are binding-readiness records, not live registrations
 * — the live registry stamps real time at actual registration. Honest and
 * documented.
 */
import type {
  FailureClassRecord,
  PerceptionAdapterDescriptor,
  ResourceRequirements,
  TechnologyCandidate,
  TechnologyLicenseRecord,
} from "@sporta/contracts";
import type { PerceptionTaskKind } from "@sporta/contracts";
import { PERCEPTION_TASK_BINDINGS } from "@sporta/contracts";
import type { TechnologyBoundedAdapter } from "./adapter";
import { HeuristicColorDetector } from "./detection/heuristic-color";
import { ModelBackedDetector } from "./detection/model-backed";
import { BallBlobDetector, ModelBackedBallDetector } from "./ball/ball-blob-detector";
import { GreedyIouTrackerAdapter } from "./tracking/greedy-iou-adapter";
import { TwoStageHungarianTracker } from "./tracking/hungarian";
import { NearestBoxBallTrackerAdapter } from "./ball/nearest-box-adapter";
import { ColorBlobBallTracker } from "./ball/color-blob";
import { HomographyFieldCalibratorAdapter } from "./calibration/homography-adapter";
import { LineBasedFieldCalibrator } from "./calibration/line-based";
import { JerseyColorTeamAssigner } from "./team/jersey-color";

/**
 * The fixed registration epoch for binding-readiness records (the repo's
 * deterministic test epoch — see the module docs).
 */
export const PERCEPTION_ADAPTERS_REGISTRATION_EPOCH_MS = 1_736_164_800_000;

/** One complete registration binding for a candidate adapter instance. */
export interface CandidateBinding {
  /** The frozen `TechnologyCandidate`-shaped registration record. */
  readonly candidate: TechnologyCandidate;
  /** The candidate's frozen binding descriptor. */
  readonly descriptor: PerceptionAdapterDescriptor;
  /** The candidate's honest per-component license record. */
  readonly license: TechnologyLicenseRecord;
  /** The candidate's documented failure classes. */
  readonly failureClasses: readonly FailureClassRecord[];
  /** The candidate's deployment resource requirements. */
  readonly resourceRequirements: ResourceRequirements;
}

/**
 * Builds the `TechnologyCandidate`-shaped registration record for ONE
 * adapter instance: identity and task flow from the instance's frozen
 * descriptor; `displayName`, optional `sourceUrl` and honest `notes` come
 * from the caller (they are human-facing metadata the descriptor does not
 * carry); `registeredAtMs` defaults to the fixed epoch constant.
 */
export function candidateBindingFor(
  adapter: TechnologyBoundedAdapter,
  meta: {
    displayName: string;
    sourceUrl?: string;
    notes?: string;
    registeredAtMs?: number;
  },
): CandidateBinding {
  return {
    candidate: {
      schemaVersion: adapter.descriptor.schemaVersion,
      candidateId: `${adapter.descriptor.technologyId}@${adapter.descriptor.adapterVersion}`,
      technologyId: adapter.descriptor.technologyId,
      technologyVersion: adapter.descriptor.technologyVersion,
      adapterVersion: adapter.descriptor.adapterVersion,
      task: adapter.descriptor.task,
      displayName: meta.displayName,
      registeredAtMs: meta.registeredAtMs ?? PERCEPTION_ADAPTERS_REGISTRATION_EPOCH_MS,
      sourceUrl: meta.sourceUrl,
      notes: meta.notes,
    },
    descriptor: adapter.descriptor,
    license: adapter.license,
    failureClasses: adapter.failureClasses,
    resourceRequirements: adapter.resourceRequirements,
  };
}

/** One candidate's summary inside {@link describeAdapters}. */
export interface CandidateSummary {
  readonly technologyId: string;
  readonly technologyVersion: string;
  readonly adapterVersion: string;
  readonly displayName: string;
  /** Zero-arg default constructor of the candidate (registry convenience). */
  readonly defaultInstance: () => TechnologyBoundedAdapter;
  /** License component statuses (code always present). */
  readonly licenseStatus: {
    code: string;
    model?: string;
    dataset?: string;
    assets?: string;
  };
  /** Whether any license component blocks production promotion today. */
  readonly licenseBlocksPromotion: boolean;
  readonly failureClassIds: readonly string[];
  readonly gpuRequired: boolean;
  /** Honest candidate notes (mirrors the binding record). */
  readonly notes: string;
}

/** One family's summary inside {@link describeAdapters}. */
export interface AdapterFamilySummary {
  /** The family's perception task. */
  readonly task: PerceptionTaskKind;
  /** The family's frozen binding (input/output contract references). */
  readonly binding: { inputContract: string; outputContract: string };
  /** The family's shipped candidates (>= 2 per family, per R201). */
  readonly candidates: readonly CandidateSummary[];
}

interface CandidateSpec {
  readonly displayName: string;
  readonly notes: string;
  readonly instantiate: () => TechnologyBoundedAdapter;
}

/** The eleven shipped candidates, family by family (>= 2 per family). */
const FAMILY_CANDIDATES: ReadonlyArray<{
  task: PerceptionTaskKind;
  candidates: readonly CandidateSpec[];
}> = [
  {
    task: "perception.player-detection",
    candidates: [
      {
        displayName: "Heuristic color-blob player detector (CPU, deterministic)",
        notes:
          "WEAK detector: pitch/white suppression + connected-component blobs + " +
          "compactness confidence. Deterministic, CPU-only, no model files. NOT a " +
          "production candidate (documented merge/kit limits).",
        instantiate: () => new HeuristicColorDetector(),
      },
      {
        displayName: "Model-backed player detector (YOLOv8n-class weights when present)",
        notes:
          "Runs a real open-source detector when weights AND an inference backend " +
          "are present; fails closed with documented classes otherwise. Model " +
          "license AGPL-3.0 (commercial use UNRESOLVED — evaluation-only); the " +
          "inference runtime arrives with the W303 GPU worker protocol.",
        instantiate: () => new ModelBackedDetector(),
      },
    ],
  },
  {
    task: "perception.ball-detection",
    candidates: [
      {
        displayName: "Ball blob detector (pixel-space, deterministic)",
        notes:
          "The color-blob tracker's evidence layer as its own per-frame " +
          "candidate: bright-white blobs + ball-shape gates, ball-class labels. " +
          "CPU-only, deterministic; carries no motion context by design.",
        instantiate: () => new BallBlobDetector(),
      },
      {
        displayName: "Model-backed ball detector (YOLOv8n-class weights when present)",
        notes:
          "Same honest pattern as the player-side candidate: weights + backend " +
          "required (W303 integration point), COCO class 32 -> ball mapping. " +
          "Model license AGPL-3.0 (commercial use UNRESOLVED — evaluation-only).",
        instantiate: () => new ModelBackedBallDetector(),
      },
    ],
  },
  {
    task: "perception.player-tracking",
    candidates: [
      {
        displayName: "Greedy IoU player tracker (W204 baseline wrap)",
        notes:
          "Wraps the delivered W204 GreedyIouTracker: best-IoU-first greedy " +
          "association, label gating, gap tolerance, scene-cut policy. Baseline " +
          "candidate.",
        instantiate: () => new GreedyIouTrackerAdapter(),
      },
      {
        displayName: "Two-stage Hungarian player tracker",
        notes:
          "Own O(n^3) Hungarian assignment over an IoU+centroid cost matrix with " +
          "forbidden-pair gating; materially different global assignment vs the " +
          "greedy baseline. Deterministic (lexicographic tie-breaks; seed recorded " +
          "for bookkeeping only).",
        instantiate: () => new TwoStageHungarianTracker(),
      },
    ],
  },
  {
    task: "perception.ball-tracking",
    candidates: [
      {
        displayName: "Nearest-box ball tracker (W202 baseline wrap)",
        notes:
          "Wraps the delivered W202 NearestBoxBallTracker over the detection " +
          "stream: step-gated nearest-box association, occlusion bridging with " +
          "discounted interpolation, never-extrapolated edges. Baseline candidate.",
        instantiate: () => new NearestBoxBallTrackerAdapter(),
      },
      {
        displayName: "Color-blob pixel-space ball tracker",
        notes:
          "Derives ball evidence from the frame pixels (bright-white blobs, " +
          "ball-shape filter) and feeds W202's honest tracking semantics. " +
          "Materially different evidence layer: ignores the detection annotations.",
        instantiate: () => new ColorBlobBallTracker(),
      },
    ],
  },
  {
    task: "perception.pitch-calibration",
    candidates: [
      {
        displayName: "Homography field calibrator (W203 DLT wrap)",
        notes:
          "Wraps W203's exact 8-point DLT solver over externally-supplied corner " +
          "correspondences; confidence passed through verbatim. Baseline " +
          "candidate (ignores pixels by design).",
        instantiate: () => new HomographyFieldCalibratorAdapter(),
      },
      {
        displayName: "Line-based field calibrator (projection histograms)",
        notes:
          "Pixel-driven: green-pitch mask, white-line projection histograms, " +
          "line->pitch-family mapping, W203 solver on the strongest " +
          "correspondences with halfway-line validation. Envelope: " +
          "near-axis-aligned broadcast views.",
        instantiate: () => new LineBasedFieldCalibrator(),
      },
    ],
  },
  {
    task: "perception.team-identity",
    candidates: [
      {
        displayName: "Jersey-color team assigner (k=2 clustering)",
        notes:
          "Per-track dominant-jersey-color k=2 clustering (seeded, deterministic) " +
          "with explicit uncertainty: low-signal tracks and distinct kits land in " +
          "`unknown` with LOW confidence — first-class honest output, never a " +
          "silent guess.",
        instantiate: () => new JerseyColorTeamAssigner(),
      },
    ],
  },
];

/**
 * Describes every shipped adapter family and candidate: the frozen
 * bindings, the candidate identities, license component statuses, failure
 * classes, and resource requirements — the machine-readable inventory the
 * Technology Registry (another lane's Wave-1 deliverable) will consume.
 */
export function describeAdapters(): readonly AdapterFamilySummary[] {
  return FAMILY_CANDIDATES.map(({ task, candidates }) => ({
    task,
    binding: PERCEPTION_TASK_BINDINGS[task],
    candidates: candidates.map((spec) => {
      const adapter = spec.instantiate();
      const license = adapter.license;
      const issues = [];
      for (const [name, component] of [
        ["code", license.code],
        ["model", license.model],
        ["dataset", license.dataset],
        ["assets", license.assets],
      ] as const) {
        if (component === undefined) continue;
        if (component.status === "unresolved" || component.commercialUse !== true) {
          issues.push(name);
        }
      }
      return {
        technologyId: adapter.descriptor.technologyId,
        technologyVersion: adapter.descriptor.technologyVersion,
        adapterVersion: adapter.descriptor.adapterVersion,
        displayName: spec.displayName,
        defaultInstance: spec.instantiate,
        licenseStatus: {
          code: license.code.status,
          model: license.model?.status,
          dataset: license.dataset?.status,
          assets: license.assets?.status,
        },
        licenseBlocksPromotion: issues.length > 0,
        failureClassIds: adapter.failureClasses.map((failureClass) => failureClass.failureClassId),
        gpuRequired: adapter.resourceRequirements.gpuRequired,
        notes: spec.notes,
      };
    }),
  }));
}

/**
 * The default registration bindings for ALL eleven shipped candidates (the
 * instances the descriptors, licenses, failure classes, and resource
 * requirements are read from are the zero-arg default constructions).
 */
export function defaultCandidateBindings(): readonly CandidateBinding[] {
  const bindings: CandidateBinding[] = [];
  for (const { candidates } of FAMILY_CANDIDATES) {
    for (const spec of candidates) {
      const adapter = spec.instantiate();
      bindings.push(
        candidateBindingFor(adapter, {
          displayName: spec.displayName,
          notes: spec.notes,
          sourceUrl:
            adapter.descriptor.technologyId === "model-backed-detector" ||
            adapter.descriptor.technologyId === "model-backed-ball-detector"
              ? "https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8n.pt"
              : undefined,
        }),
      );
    }
  }
  return bindings;
}
