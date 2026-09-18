/**
 * R204 candidate 1: `NearestBoxBallTrackerAdapter` — the BASELINE
 * ball-tracking candidate, WRAPPING the W202 `NearestBoxBallTracker`
 * (wrap, never fork).
 *
 * The wrap adapts the R201 family interface (detection-annotated frame
 * sequences in, `BallTrack[]` out) onto the delivered W202 seam: the
 * per-frame `detections` (label-filtered to the ball class upstream, per
 * the W202 convention — label matching is the CALLER's filter) become
 * `BallObservationFrame`s; the association algorithm (nearest-unclaimed-box
 * with the per-frame step gate, occlusion gaps kept open and bridged with
 * exponentially DISCOUNTED interpolated confidence, never extrapolated
 * edges) is exactly W202's — nothing is re-implemented here.
 *
 * HONEST SEMANTICS inherited verbatim from W202: tracks start and end on
 * OBSERVED boxes; interpolated points carry discounted confidence and live
 * in the track structure only; a gap longer than `maxGapFrames` closes the
 * track (an id switch by construction — every additional track is a
 * switch).
 */
import type {
  FailureClassRecord,
  PerceptionAdapterDescriptor,
  ResourceRequirements,
  TechnologyLicenseRecord,
} from "@sporta/contracts";
import { NearestBoxBallTracker } from "@sporta/ball-tracking";
import type { BallObservationFrame, BallTrack } from "@sporta/ball-tracking";
import type { NearestBoxTrackerOptions } from "@sporta/ball-tracking";
import { assertDescriptorBinding, perceptionDescriptor } from "../errors";
import { NEAREST_BOX_BALL_TRACKER_LICENSE } from "../licenses";
import type { BallTrackingAdapter, DetectionSequenceFrame } from "../adapter";
import { validatePresentationOrderedSequence } from "../validate";

/** Stable technology identity of this candidate. */
export const NEAREST_BOX_BALL_TRACKER_ID = "nearest-box-ball-tracker";
export const NEAREST_BOX_BALL_TRACKER_VERSION = "0.1.0";
export const NEAREST_BOX_BALL_TRACKER_ADAPTER_VERSION = "0.1.0";

/** Options: the W202 tracker options, passed straight through (type alias). */
export type NearestBoxBallTrackerAdapterOptions = NearestBoxTrackerOptions;

/** Documented failure classes (inherited semantics from the wrapped W202). */
export const NEAREST_BOX_BALL_TRACKER_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "nearest-box-ball.too-late-re-observation",
    description:
      "A re-observation arriving after gap > maxGapFrames is rejected and the track " +
      "closes: the switch costs one visible frame of coverage. Conservative by " +
      "design — a too-late re-observation is never claimed as the same ball.",
    retryable: false,
  },
  {
    failureClassId: "nearest-box-ball.clutter-consumption",
    description:
      "The nearest-unclaimed-box rule can claim a clutter detection when the true " +
      "ball detection is missing; leftover candidates are never re-examined. The " +
      "benchmark's position RMSE surfaces this honestly.",
    retryable: false,
  },
];

/** Resource requirements: pure CPU, one core. */
export const NEAREST_BOX_BALL_TRACKER_RESOURCES: ResourceRequirements = {
  gpuRequired: false,
  minCpuCores: 1,
};

/**
 * The baseline ball-tracking candidate wrapping W202's
 * `NearestBoxBallTracker` (R204 candidate 1). Construct with the W202
 * options; call {@link track} with a presentation-ordered,
 * detection-annotated frame sequence (validated loud first).
 */
export class NearestBoxBallTrackerAdapter implements BallTrackingAdapter {
  readonly descriptor: PerceptionAdapterDescriptor;
  readonly license: TechnologyLicenseRecord = NEAREST_BOX_BALL_TRACKER_LICENSE;
  readonly failureClasses: readonly FailureClassRecord[] = NEAREST_BOX_BALL_TRACKER_FAILURE_CLASSES;
  readonly resourceRequirements: ResourceRequirements = NEAREST_BOX_BALL_TRACKER_RESOURCES;
  readonly trackerId: string;
  private readonly wrapped: NearestBoxBallTracker;

  constructor(options: NearestBoxBallTrackerAdapterOptions = {}) {
    // NearestBoxBallTracker's own constructor validates its options and id.
    this.wrapped = new NearestBoxBallTracker(options);
    this.trackerId = this.wrapped.trackerId;
    this.descriptor = perceptionDescriptor({
      technologyId: NEAREST_BOX_BALL_TRACKER_ID,
      technologyVersion: NEAREST_BOX_BALL_TRACKER_VERSION,
      adapterVersion: NEAREST_BOX_BALL_TRACKER_ADAPTER_VERSION,
      task: "perception.ball-tracking",
      inputContract: "contracts/observation.detection-sequence@1",
      outputContract: "contracts/observation.track@1",
    });
    assertDescriptorBinding(this.descriptor, "perception.ball-tracking");
  }

  track(frames: readonly DetectionSequenceFrame[]): BallTrack[] {
    validatePresentationOrderedSequence(frames);
    const observationFrames: BallObservationFrame[] = frames.map(({ frame, detections }) => ({
      frameId: frame.frameId,
      presentationMs: frame.presentationMs,
      decodeOrder: frame.decodeOrder,
      detections,
    }));
    return this.wrapped.track(observationFrames);
  }
}
