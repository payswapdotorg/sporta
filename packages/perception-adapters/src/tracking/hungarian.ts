/**
 * R203 candidate 2: `TwoStageHungarianTracker` — a MATERIALLY different
 * player tracker behind the SAME family interface.
 *
 * DIFFERENCE FROM THE BASELINE (documented, measurable in the benchmark):
 * the baseline (W204 `GreedyIouTracker`, wrapped by candidate 1) consumes
 * candidate pairs greedily best-IoU-first; this candidate solves, per frame,
 * a GLOBALLY MINIMUM-COST one-to-one assignment between active tracks and
 * detections via the OWN O(n^3) Hungarian solver
 * (`hungarian-algorithm.ts`, no external dependencies), over a COMBINED
 * IoU + centroid-distance cost:
 *
 * ```text
 *   cost(track, detection) = iouWeight * (1 - iou(lastBox, det.box))
 *                          + centroidWeight * ||center(lastBox) - center(det.box)||
 * ```
 *
 * with FORBIDDEN (sentinel) pairs when labels mismatch or IoU < iouGate —
 * the solver never forces a forbidden pairing (a gated detection opens a
 * fresh track instead).
 *
 * TWO STAGES (the name's origin):
 *
 * - STAGE 1 (associate): solve the assignment; matched detections extend
 *   their tracks (`lastBox` updated, gap reset, confidence passed through
 *   VERBATIM — architecture-lock §6, no silent collapse).
 * - STAGE 2 (lifecycle): unmatched detections open fresh tracks `t<seq>`
 *   (the same session-scoped `EntityId` scheme as W204 — ids are never
 *   reissued); unmatched active tracks age (`gap += 1`) and CLOSE once
 *   `gap > maxGap`; a `sceneCut` frame with the "close-all" policy closes
 *   every active track BEFORE association (a camera cut is a hard boundary —
 *   the same deliberate conservatism as W204).
 *
 * DETERMINISM: pure state machine over the call sequence — the Hungarian's
 * strict-`<` comparisons resolve every tie to the lowest index, no RNG, no
 * clock. The accepted `seed` is RECORDED (exposed as `trackerSeed`) for
 * benchmark reproducibility bookkeeping; determinism does not depend on it
 * (the honest, documented claim).
 *
 * Output parity with the baseline: one `TrackedBox` per input detection, in
 * INPUT DETECTION ORDER; boxes shallow-copied. The apparent identity-switch
 * count uses the same shared honest proxy as candidate 1
 * (`countApparentIdentitySwitches`), so both candidates are scored
 * identically at the adapter level.
 */
import type { EntityId } from "@sporta/contracts";
import type {
  FailureClassRecord,
  PerceptionAdapterDescriptor,
  ResourceRequirements,
  TechnologyLicenseRecord,
} from "@sporta/contracts";
import { iou } from "@sporta/perception-detection";
import type { NormalizedBox } from "@sporta/perception-detection";
import type { SceneCutPolicy, TrackedBox } from "@sporta/perception-tracking";
import { assertDescriptorBinding, perceptionDescriptor } from "../errors";
import { HUNGARIAN_TRACKER_LICENSE } from "../licenses";
import type {
  DetectionSequenceFrame,
  PlayerTrackingAdapter,
  PlayerTrackingResult,
} from "../adapter";
import { countApparentIdentitySwitches } from "./apparent-switches";
import { FORBIDDEN_COST, solveHungarianAssignment } from "./hungarian-algorithm";
import { validateDetectionSequence } from "../validate";

/** Stable technology identity of this candidate. */
export const HUNGARIAN_TRACKER_ID = "hungarian-tracker";
export const HUNGARIAN_TRACKER_VERSION = "0.1.0";
export const HUNGARIAN_TRACKER_ADAPTER_VERSION = "0.1.0";

/** Options for {@link TwoStageHungarianTracker}; every field is optional. */
export interface TwoStageHungarianTrackerOptions {
  /** Component id (default `hungarian-tracker-v1`). */
  readonly trackerId?: string;
  /** Weight of the IoU term in the cost (default 1). */
  readonly iouWeight?: number;
  /** Weight of the centroid-distance term in the cost (default 1). */
  readonly centroidWeight?: number;
  /** Association gate: pairs with IoU below it are forbidden (default 0.2). */
  readonly iouGate?: number;
  /** Missed-frames tolerance before a track closes (default 0, as W204). */
  readonly maxGap?: number;
  /** Scene-cut policy (default "close-all", as W204). */
  readonly onSceneCut?: SceneCutPolicy;
  /**
   * Seed recorded for benchmark reproducibility bookkeeping (exposed as
   * `trackerSeed`). Determinism does NOT depend on it — see the module docs.
   */
  readonly seed?: string;
}

const HUNGARIAN_DEFAULTS = {
  trackerId: "hungarian-tracker-v1",
  iouWeight: 1,
  centroidWeight: 1,
  iouGate: 0.2,
  maxGap: 0,
  onSceneCut: "close-all" as SceneCutPolicy,
} as const;

/** Documented failure classes of the two-stage Hungarian tracker. */
export const HUNGARIAN_TRACKER_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "hungarian.fragmentation-under-occlusion",
    description:
      "A track closed after gap > maxGap re-opens under a fresh id when the player " +
      "reappears — the same deliberate conservatism as W204: occlusion bridging is " +
      "not this family's job (identity continuity beyond maxGap is downstream).",
    retryable: false,
  },
  {
    failureClassId: "hungarian.gate-starvation",
    description:
      "Fast motion between frames can drop IoU below the gate for the TRUE " +
      "continuation pair: the association is forbidden and identity fragments. " +
      "The centroid term mitigates (it keeps cost finite inside the gate) but " +
      "cannot recover a pair the gate forbids.",
    retryable: false,
  },
];

/** Resource requirements: pure CPU, one core. */
export const HUNGARIAN_TRACKER_RESOURCES: ResourceRequirements = {
  gpuRequired: false,
  minCpuCores: 1,
};

/** Internal mutable state of one active track. */
interface ActiveTrack {
  readonly trackId: EntityId;
  readonly label: string;
  lastBox: NormalizedBox;
  gap: number;
  /** Monotonic creation sequence; deterministic bookkeeping. */
  readonly creationOrder: number;
}

/** Center of a normalized box. */
function boxCenter(box: NormalizedBox): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** Euclidean center distance between two normalized boxes. */
function centerDistance(a: NormalizedBox, b: NormalizedBox): number {
  const ca = boxCenter(a);
  const cb = boxCenter(b);
  return Math.sqrt((cb.x - ca.x) ** 2 + (cb.y - ca.y) ** 2);
}

/**
 * The two-stage Hungarian player tracker (R203 candidate 2).
 *
 * Construct with options; call {@link track} with a decode-ordered
 * detection sequence (validated loud first). Output parity with the
 * baseline candidate: one `TrackedBox` per input detection per frame, in
 * input detection order.
 */
export class TwoStageHungarianTracker implements PlayerTrackingAdapter {
  readonly descriptor: PerceptionAdapterDescriptor;
  readonly license: TechnologyLicenseRecord = HUNGARIAN_TRACKER_LICENSE;
  readonly failureClasses: readonly FailureClassRecord[] = HUNGARIAN_TRACKER_FAILURE_CLASSES;
  readonly resourceRequirements: ResourceRequirements = HUNGARIAN_TRACKER_RESOURCES;
  readonly trackerId: string;
  /** The recorded seed (bookkeeping only — determinism does not depend on it). */
  readonly trackerSeed: string;
  private readonly iouWeight: number;
  private readonly centroidWeight: number;
  private readonly iouGate: number;
  private readonly maxGap: number;
  private readonly onSceneCut: SceneCutPolicy;
  private active: ActiveTrack[] = [];
  private seq = 1;

  constructor(options: TwoStageHungarianTrackerOptions = {}) {
    const trackerId = options.trackerId ?? HUNGARIAN_DEFAULTS.trackerId;
    const iouWeight = options.iouWeight ?? HUNGARIAN_DEFAULTS.iouWeight;
    const centroidWeight = options.centroidWeight ?? HUNGARIAN_DEFAULTS.centroidWeight;
    const iouGate = options.iouGate ?? HUNGARIAN_DEFAULTS.iouGate;
    const maxGap = options.maxGap ?? HUNGARIAN_DEFAULTS.maxGap;
    const onSceneCut = options.onSceneCut ?? HUNGARIAN_DEFAULTS.onSceneCut;
    // Fail loud at construction (the repo convention).
    if (typeof trackerId !== "string" || trackerId.length < 1) {
      throw new RangeError("TwoStageHungarianTracker: trackerId must be a non-empty string");
    }
    for (const [name, value] of [
      ["iouWeight", iouWeight],
      ["centroidWeight", centroidWeight],
    ] as const) {
      if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`TwoStageHungarianTracker: ${name} must be >= 0 (got ${value})`);
      }
    }
    if (!Number.isFinite(iouGate) || iouGate < 0 || iouGate > 1) {
      throw new RangeError(`TwoStageHungarianTracker: iouGate must be in [0, 1] (got ${iouGate})`);
    }
    if (!Number.isInteger(maxGap) || maxGap < 0) {
      throw new RangeError(
        `TwoStageHungarianTracker: maxGap must be an integer >= 0 (got ${maxGap})`,
      );
    }
    if (onSceneCut !== "close-all" && onSceneCut !== "ignore") {
      throw new RangeError(
        `TwoStageHungarianTracker: onSceneCut must be "close-all" or "ignore" ` +
          `(got ${onSceneCut})`,
      );
    }
    this.trackerId = trackerId;
    this.trackerSeed = options.seed ?? "hungarian-default-seed";
    this.iouWeight = iouWeight;
    this.centroidWeight = centroidWeight;
    this.iouGate = iouGate;
    this.maxGap = maxGap;
    this.onSceneCut = onSceneCut;
    this.descriptor = perceptionDescriptor({
      technologyId: HUNGARIAN_TRACKER_ID,
      technologyVersion: HUNGARIAN_TRACKER_VERSION,
      adapterVersion: HUNGARIAN_TRACKER_ADAPTER_VERSION,
      task: "perception.player-tracking",
      inputContract: "contracts/observation.detection-sequence@1",
      outputContract: "contracts/observation.track@1",
    });
    assertDescriptorBinding(this.descriptor, "perception.player-tracking");
  }

  track(sequence: readonly DetectionSequenceFrame[]): PlayerTrackingResult {
    validateDetectionSequence(sequence);
    // One track() call = one SESSION: the tracker's mutable state starts
    // fresh, so consecutive calls are independent and repeatable (id
    // sequences do not leak across sessions).
    this.active = [];
    this.seq = 1;
    const perFrame: (readonly TrackedBox[])[] = [];
    for (const sequenceFrame of sequence) {
      perFrame.push(this.assignFrame(sequenceFrame));
    }
    return {
      perFrame,
      identitySwitches: countApparentIdentitySwitches(perFrame),
    };
  }

  /** Runs stages 1 + 2 for one frame (see the module docs). */
  private assignFrame(sequenceFrame: DetectionSequenceFrame): TrackedBox[] {
    const detections = [...sequenceFrame.detections];

    // Scene cut: a hard boundary — close every active track BEFORE
    // association (the W204 "close-all" conservatism; ids after the cut are
    // fresh — re-identification across cuts is downstream's job).
    if (sequenceFrame.sceneCut === true && this.onSceneCut === "close-all") {
      this.active = [];
    }

    // STAGE 1 — the assignment: rows = active tracks, columns = detections.
    const cost: number[][] = this.active.map((track) =>
      detections.map((detection) => {
        if (track.label !== detection.label) return FORBIDDEN_COST;
        const overlap = iou(track.lastBox, detection.box);
        if (overlap < this.iouGate) return FORBIDDEN_COST;
        return (
          this.iouWeight * (1 - overlap) +
          this.centroidWeight * centerDistance(track.lastBox, detection.box)
        );
      }),
    );
    const rowToCol = solveHungarianAssignment(cost);
    const detectionToTrack = new Map<number, number>();
    for (const [trackIndex, detectionIndex] of rowToCol.entries()) {
      if (detectionIndex >= 0) {
        detectionToTrack.set(detectionIndex, trackIndex);
      }
    }

    // STAGE 2 — lifecycle: extend matched, open fresh tracks for unmatched
    // detections (output in INPUT DETECTION ORDER), age the rest.
    const trackMatched = new Array<boolean>(this.active.length).fill(false);
    const newTracks: ActiveTrack[] = [];
    const output: TrackedBox[] = detections.map((detection, detectionIndex) => {
      const trackIndex = detectionToTrack.get(detectionIndex);
      if (trackIndex === undefined) {
        const trackId = `t${this.seq}` as EntityId;
        const creationOrder = this.seq;
        this.seq += 1;
        newTracks.push({
          trackId,
          label: detection.label,
          lastBox: { ...detection.box },
          gap: 0,
          creationOrder,
        });
        return {
          box: { ...detection.box },
          label: detection.label,
          confidence: detection.confidence,
          trackId,
        };
      }
      const track = this.active[trackIndex]!;
      trackMatched[trackIndex] = true;
      track.lastBox = { ...detection.box };
      track.gap = 0;
      return {
        box: { ...detection.box },
        label: detection.label,
        confidence: detection.confidence,
        trackId: track.trackId,
      };
    });

    // Age unmatched active tracks; close those past the gap tolerance.
    // Closed ids are never reissued; new tracks are appended after aging.
    this.active = this.active
      .filter((track, index) => {
        if (trackMatched[index]) return true;
        track.gap += 1;
        return track.gap <= this.maxGap;
      })
      .concat(newTracks);

    return output;
  }
}
