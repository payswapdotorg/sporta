/**
 * R203 candidate 1: `GreedyIouTrackerAdapter` — the BASELINE player-tracking
 * candidate, WRAPPING the W204 `GreedyIouTracker` (wrap, never fork).
 *
 * The wrap's job is pure conformance: adapt the R201 family interface
 * (detection-annotated frame sequences in, per-frame `TrackedBox` arrays +
 * a typed apparent identity-switch count out) onto the delivered W204
 * association tracker, carrying the frozen binding descriptor + honest
 * evaluation metadata. The association ALGORITHM is exactly W204's —
 * best-IoU-first greedy consumption with the documented deterministic
 * tie-breaks, label gating, gap tolerance, and scene-cut policy — nothing
 * is re-implemented here.
 *
 * The input sequence is validated loud (untrusted media/model output,
 * architecture-lock §13) before it reaches the wrapped tracker; the
 * apparent identity-switch count uses the shared honest proxy
 * (`countApparentIdentitySwitches`).
 */
import type {
  FailureClassRecord,
  PerceptionAdapterDescriptor,
  ResourceRequirements,
  TechnologyLicenseRecord,
} from "@sporta/contracts";
import { GreedyIouTracker } from "@sporta/perception-tracking";
import type {
  GreedyIouTrackerOptions,
  SceneCutPolicy,
  TrackerFrameInput,
} from "@sporta/perception-tracking";
import type { TrackedBox } from "@sporta/perception-tracking";
import { assertDescriptorBinding, perceptionDescriptor } from "../errors";
import { GREEDY_IOU_TRACKER_LICENSE } from "../licenses";
import type {
  DetectionSequenceFrame,
  PlayerTrackingAdapter,
  PlayerTrackingResult,
} from "../adapter";
import { countApparentIdentitySwitches } from "./apparent-switches";
import { validateDetectionSequence } from "../validate";

/** Stable technology identity of this candidate. */
export const GREEDY_IOU_TRACKER_ID = "greedy-iou-tracker";
export const GREEDY_IOU_TRACKER_VERSION = "0.1.0";
export const GREEDY_IOU_TRACKER_ADAPTER_VERSION = "0.1.0";

/** Options: the W204 tracker options plus this adapter's identity. */
export interface GreedyIouTrackerAdapterOptions extends GreedyIouTrackerOptions {
  /** Component id (default `greedy-iou-tracker-v1`). */
  readonly trackerId?: string;
}

/** Documented failure classes (inherited semantics from the wrapped W204). */
export const GREEDY_IOU_TRACKER_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "greedy-iou.fragmentation-under-occlusion",
    description:
      "A track closed after gap > maxGap re-opens under a fresh id when the player " +
      "reappears: occlusions longer than the tolerance fragment identity. The " +
      "identity-continuity benchmark measures this fragmentation; conservative by " +
      "design (never invents certainty).",
    retryable: false,
  },
  {
    failureClassId: "greedy-iou.crossing-identity-drift",
    description:
      "Under dense crossings the greedy best-IoU-first consumption can hand a track " +
      "to the crossing player: association is a geometric hypothesis, and ids carry " +
      "no certainty claim (architecture-lock §6).",
    retryable: false,
  },
];

/** Resource requirements: pure CPU, one core. */
export const GREEDY_IOU_TRACKER_RESOURCES: ResourceRequirements = {
  gpuRequired: false,
  minCpuCores: 1,
};

/**
 * The baseline player-tracking candidate wrapping W204's `GreedyIouTracker`
 * (R203 candidate 1). Construct with the W204 options (plus `trackerId`);
 * call {@link track} with a decode-ordered detection sequence.
 */
export class GreedyIouTrackerAdapter implements PlayerTrackingAdapter {
  readonly descriptor: PerceptionAdapterDescriptor;
  readonly license: TechnologyLicenseRecord = GREEDY_IOU_TRACKER_LICENSE;
  readonly failureClasses: readonly FailureClassRecord[] = GREEDY_IOU_TRACKER_FAILURE_CLASSES;
  readonly resourceRequirements: ResourceRequirements = GREEDY_IOU_TRACKER_RESOURCES;
  readonly trackerId: string;
  private readonly trackerOptions: GreedyIouTrackerOptions;

  constructor(options: GreedyIouTrackerAdapterOptions = {}) {
    const { trackerId, ...trackerOptions } = options;
    this.trackerId = trackerId ?? "greedy-iou-tracker-v1";
    // Validate the wrapped tracker's options once at construction (the
    // repo convention: fail loud before any frame is consumed).
    new GreedyIouTracker(trackerOptions, this.trackerId);
    this.trackerOptions = trackerOptions;
    this.descriptor = perceptionDescriptor({
      technologyId: GREEDY_IOU_TRACKER_ID,
      technologyVersion: GREEDY_IOU_TRACKER_VERSION,
      adapterVersion: GREEDY_IOU_TRACKER_ADAPTER_VERSION,
      task: "perception.player-tracking",
      inputContract: "contracts/observation.detection-sequence@1",
      outputContract: "contracts/observation.track@1",
    });
    assertDescriptorBinding(this.descriptor, "perception.player-tracking");
  }

  track(sequence: readonly DetectionSequenceFrame[]): PlayerTrackingResult {
    validateDetectionSequence(sequence);
    // One track() call = one SESSION: the wrapped tracker starts fresh, so
    // consecutive calls are independent and repeatable (id sequences do
    // not leak across sessions).
    const wrapped = new GreedyIouTracker(this.trackerOptions, this.trackerId);
    const perFrame: (readonly TrackedBox[])[] = [];
    for (const { frame, detections, sceneCut } of sequence) {
      const trackerFrame: TrackerFrameInput = {
        frameId: frame.frameId,
        presentationMs: frame.presentationMs,
        decodeOrder: frame.decodeOrder,
        sceneCut,
      };
      perFrame.push(wrapped.assign(trackerFrame, [...detections]));
    }
    return {
      perFrame,
      identitySwitches: countApparentIdentitySwitches(perFrame),
    };
  }
}

// Re-export the wrapped baseline's option types for consumer convenience.
export type { GreedyIouTrackerOptions, SceneCutPolicy };
