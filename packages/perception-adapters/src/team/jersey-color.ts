/**
 * R206: `JerseyColorTeamAssigner` — the team-identity candidate: per-track
 * dominant-jersey-color clustering into two teams (k = 2).
 *
 * ALGORITHM (documented in full — every rule is part of the contract the
 * benchmark asserts against):
 *
 * 1. CROP SAMPLING: for every frame and every tracked box in it, the box's
 *    pixel crop is read from the frame bytes; pixels that read pitch-green
 *    (`isPitchGreen` — the background inside the crop) are excluded and the
 *    remaining rgb samples are accumulated per track. The per-track
 *    DOMINANT COLOR is the mean of those samples (RGB space; documented
 *    choice — LAB conversion adds nothing for kit-color separation at this
 *    signal level). A track with fewer than `minSamples` (default 40)
 *    accepted pixels is LOW-EVIDENCE: it is assigned `unknown` with a
 *    sample-scaled confidence <= 0.2 — never a guess.
 * 2. SEEDED k=2 CLUSTERING (deterministic, robust centers): among
 *    eligible tracks (enough samples), center A is drawn by the SEEDED RNG
 *    (`createRng` + `seedFromString(seed)` — the seed is a constructor
 *    option, default "jersey-color-default-seed"); center B is the
 *    eligible track color FARTHEST from A (ties -> lowest track order).
 *    Iteration: assign each color to the nearest center (ties -> center
 *    A), recompute centers as PER-CHANNEL MEDIANS of the assigned colors
 *    (k-medians: robust — a single distinct kit cannot drag a center the
 *    way a mean can, which is exactly the failure that would silently
 *    absorb a goalkeeper into a team), repeat until stable or
 *    `maxIterations` (25). If a cluster EMPTIES, the kits cannot be
 *    separated: every eligible track becomes `unknown` with confidence
 *    0.2 (documented failure class).
 * 3. ASSIGNMENT WITH EXPLICIT UNCERTAINTY: for each eligible track with
 *    squared-RGB distances `dA`, `dB` to the final centers:
 *
 *    ```text
 *      separation      = |dA - dB| / (dA + dB)          // 0 when both 0
 *      rawConfidence   = 0.5 + separation / 2           // [0.5, 1)
 *      outlier         = min(dA, dB) > max(0.5 * centerDistance, 1200)
 *    ```
 *
 *    - `rawConfidence < confidenceThreshold` (default 0.6) -> `unknown`
 *      carrying that LOW confidence (near-equidistant kits are honestly
 *      unassignable — never a silent guess);
 *    - `outlier` -> `unknown` with the raw confidence (a distinct kit —
 *      goalkeeper or referee — far from BOTH clusters; there is NO special
 *      goalkeeper/referee handling, documented: kits far from both
 *      clusters land in `unknown`, which is the honest outcome, while kits
 *      BETWEEN the clusters or near one can still be misassigned — the
 *      color-only limit a future appearance-embedding candidate closes);
 *    - otherwise -> the nearest cluster's team.
 * 4. HOME/AWAY LABELING: the cluster containing the lowest-ordered eligible
 *    track becomes `home`, the other `away`. DETERMINISTIC BUT ARBITRARY —
 *    the real home/away identity requires external match metadata, which
 *    this family's input does not carry (documented failure class).
 *
 * Pure function of `(options, sequence)` — the ONLY randomness is the
 * SEEDED first-center draw (deterministic for a fixed seed); no clock, no
 * I/O. `method` is always `"jersey-color"` on every emitted record.
 */
import { createRng, seedFromString } from "@sporta/testing";
import type { EntityId } from "@sporta/contracts";
import type {
  FailureClassRecord,
  PerceptionAdapterDescriptor,
  ResourceRequirements,
  TechnologyLicenseRecord,
} from "@sporta/contracts";
import { assertDescriptorBinding, perceptionDescriptor } from "../errors";
import { JERSEY_COLOR_TEAM_ASSIGNER_LICENSE } from "../licenses";
import { isPitchGreen, type Rgb } from "../pixels";
import type { TeamAssignment, TeamIdentityAdapter, TrackSequenceFrame } from "../adapter";
import { InvalidAdapterInputError } from "../errors";

/** Stable technology identity of this candidate. */
export const JERSEY_COLOR_TEAM_ASSIGNER_ID = "jersey-color-team-assigner";
export const JERSEY_COLOR_TEAM_ASSIGNER_VERSION = "0.1.0";
export const JERSEY_COLOR_TEAM_ASSIGNER_ADAPTER_VERSION = "0.1.0";

/** The method id stamped on every assignment this candidate emits. */
export const JERSEY_COLOR_METHOD = "jersey-color";

/** Options for {@link JerseyColorTeamAssigner}; every field is optional. */
export interface JerseyColorTeamAssignerOptions {
  /** Component id (default `jersey-color-team-assigner-v1`). */
  readonly assignerId?: string;
  /** Seeded clustering seed (default "jersey-color-default-seed"). */
  readonly seed?: string;
  /** Minimum accepted crop pixels per track (default 40). */
  readonly minSamples?: number;
  /** Minimum assignment confidence (default 0.6). */
  readonly confidenceThreshold?: number;
  /** Maximum k-means iterations (default 25). */
  readonly maxIterations?: number;
}

const JERSEY_DEFAULTS = {
  assignerId: "jersey-color-team-assigner-v1",
  seed: "jersey-color-default-seed",
  minSamples: 40,
  confidenceThreshold: 0.6,
  maxIterations: 25,
} as const;

/**
 * Squared-RGB noise floor for the outlier test: below this min-distance the
 * track is considered explained by its cluster regardless of separation.
 */
const OUTLIER_MIN_DISTANCE = 1200;

/** Documented failure classes of the jersey-color team assigner. */
export const JERSEY_COLOR_TEAM_ASSIGNER_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "jersey-color.low-signal-track",
    description:
      "A track with fewer than minSamples accepted crop pixels carries too little " +
      "color evidence to assign: it becomes `unknown` with a sample-scaled LOW " +
      "confidence (<= 0.2). First-class honest output, never a silent guess.",
    retryable: false,
  },
  {
    failureClassId: "jersey-color.unseparated-kits",
    description:
      "The two kits are too similar (or a cluster emptied during k-means): no " +
      "two-team structure is recoverable from color alone, and every eligible " +
      "track becomes `unknown` with confidence 0.2.",
    retryable: false,
  },
  {
    failureClassId: "jersey-color.distinct-kit-outlier",
    description:
      "A distinct kit (goalkeeper, referee) sits far from BOTH cluster centers " +
      "and becomes `unknown`. There is NO special goalkeeper or referee handling " +
      "in this candidate — landing in `unknown` is the honest outcome, and the " +
      "documented gap a future appearance-embedding candidate (W303) closes.",
    retryable: false,
  },
  {
    failureClassId: "jersey-color.label-arbitrariness",
    description:
      "Which cluster is `home` is deterministic (lowest-ordered eligible track's " +
      "cluster) but ARBITRARY: real home/away identity needs external match " +
      "metadata this family's input does not carry. Downstream consumers must " +
      "not treat the label as ground truth.",
    retryable: false,
  },
];

/** Resource requirements: pure CPU, one core. */
export const JERSEY_COLOR_TEAM_ASSIGNER_RESOURCES: ResourceRequirements = {
  gpuRequired: false,
  minCpuCores: 1,
};

/** One track's accumulated color evidence. */
interface TrackColorEvidence {
  readonly trackId: EntityId;
  sumR: number;
  sumG: number;
  sumB: number;
  samples: number;
}

/** Squared RGB distance between two colors. */
function squaredColorDistance(a: Rgb, b: Rgb): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

/** Numeric track order: `t<seq>` ids by their sequence, others lexicographic. */
function trackOrder(trackId: string): number {
  const match = /^t(\d+)$/.exec(trackId);
  return match === null ? Number.POSITIVE_INFINITY : Number.parseInt(match[1]!, 10);
}

function compareTrackIds(a: string, b: string): number {
  const orderA = trackOrder(a);
  const orderB = trackOrder(b);
  if (orderA !== orderB) return orderA - orderB;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Validates a track sequence (R206 input): unique non-empty frame ids,
 * finite non-negative presentation times, ascending integer decode orders,
 * and contract-shaped tracked boxes (EntityId-pattern track ids, non-empty
 * labels, confidences and box fields in range). Untrusted-input law
 * (architecture-lock §13): fail loud, never silently degrade.
 */
function validateTrackSequence(sequence: readonly TrackSequenceFrame[]): void {
  const seenFrameIds = new Set<string>();
  let previousDecodeOrder: number | undefined;
  for (const { frame, tracked } of sequence) {
    if (typeof frame.frameId !== "string" || frame.frameId.length < 1) {
      throw new InvalidAdapterInputError(
        "team identity input: every frame needs a non-empty frameId",
        {},
      );
    }
    if (seenFrameIds.has(frame.frameId)) {
      throw new InvalidAdapterInputError(
        `team identity input: duplicate frameId "${frame.frameId}"`,
        { frameId: frame.frameId },
      );
    }
    seenFrameIds.add(frame.frameId);
    if (!Number.isFinite(frame.presentationMs) || frame.presentationMs < 0) {
      throw new InvalidAdapterInputError(
        `team identity input: presentationMs must be finite >= 0 (frame ` +
          `"${frame.frameId}": ${frame.presentationMs})`,
        { frameId: frame.frameId },
      );
    }
    if (!Number.isInteger(frame.decodeOrder) || frame.decodeOrder < 0) {
      throw new InvalidAdapterInputError(
        `team identity input: decodeOrder must be an integer >= 0 (frame ` +
          `"${frame.frameId}": ${frame.decodeOrder})`,
        { frameId: frame.frameId },
      );
    }
    if (previousDecodeOrder !== undefined && frame.decodeOrder < previousDecodeOrder) {
      throw new InvalidAdapterInputError(
        `team identity input: frames must be ascending in decodeOrder (frame ` +
          `"${frame.frameId}" at ${frame.decodeOrder} follows ${previousDecodeOrder})`,
        { frameId: frame.frameId },
      );
    }
    previousDecodeOrder = frame.decodeOrder;
    for (const [index, box] of tracked.entries()) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(box.trackId)) {
        throw new InvalidAdapterInputError(
          `team identity input: tracked box ${index} of frame "${frame.frameId}" has an ` +
            `invalid trackId "${box.trackId}"`,
          { frameId: frame.frameId, index, trackId: box.trackId },
        );
      }
      if (typeof box.label !== "string" || box.label.length < 1) {
        throw new InvalidAdapterInputError(
          `team identity input: tracked box ${index} of frame "${frame.frameId}" needs a ` +
            `non-empty label`,
          { frameId: frame.frameId, index },
        );
      }
      if (!Number.isFinite(box.confidence) || box.confidence < 0 || box.confidence > 1) {
        throw new InvalidAdapterInputError(
          `team identity input: tracked box confidence must be in [0, 1] (frame ` +
            `"${frame.frameId}", index ${index}: ${box.confidence})`,
          { frameId: frame.frameId, index, confidence: box.confidence },
        );
      }
      for (const field of [box.box.x, box.box.y, box.box.w, box.box.h] as const) {
        if (!Number.isFinite(field) || field < 0 || field > 1) {
          throw new InvalidAdapterInputError(
            `team identity input: tracked box fields must be in [0, 1] (frame ` +
              `"${frame.frameId}", index ${index}: ${field})`,
            { frameId: frame.frameId, index, field },
          );
        }
      }
    }
  }
}

/**
 * The jersey-color team assigner (R206's ONE implementation).
 *
 * Construct with options; call {@link assign} with the track sequence (per
 * frame: pixels + that frame's tracked boxes). Emits one
 * {@link TeamAssignment} per track seen, ordered by deterministic track
 * order (`t<seq>` numeric first).
 */
export class JerseyColorTeamAssigner implements TeamIdentityAdapter {
  readonly descriptor: PerceptionAdapterDescriptor;
  readonly license: TechnologyLicenseRecord = JERSEY_COLOR_TEAM_ASSIGNER_LICENSE;
  readonly failureClasses: readonly FailureClassRecord[] =
    JERSEY_COLOR_TEAM_ASSIGNER_FAILURE_CLASSES;
  readonly resourceRequirements: ResourceRequirements = JERSEY_COLOR_TEAM_ASSIGNER_RESOURCES;
  readonly assignerId: string;
  /** The recorded clustering seed (drives the first-center draw). */
  readonly seed: string;
  private readonly minSamples: number;
  private readonly confidenceThreshold: number;
  private readonly maxIterations: number;

  constructor(options: JerseyColorTeamAssignerOptions = {}) {
    const assignerId = options.assignerId ?? JERSEY_DEFAULTS.assignerId;
    const seed = options.seed ?? JERSEY_DEFAULTS.seed;
    const minSamples = options.minSamples ?? JERSEY_DEFAULTS.minSamples;
    const confidenceThreshold = options.confidenceThreshold ?? JERSEY_DEFAULTS.confidenceThreshold;
    const maxIterations = options.maxIterations ?? JERSEY_DEFAULTS.maxIterations;
    if (typeof assignerId !== "string" || assignerId.length < 1) {
      throw new RangeError("JerseyColorTeamAssigner: assignerId must be a non-empty string");
    }
    if (typeof seed !== "string" || seed.length < 1) {
      throw new RangeError("JerseyColorTeamAssigner: seed must be a non-empty string");
    }
    if (!Number.isInteger(minSamples) || minSamples < 1) {
      throw new RangeError(
        `JerseyColorTeamAssigner: minSamples must be an integer >= 1 (got ${minSamples})`,
      );
    }
    if (
      !Number.isFinite(confidenceThreshold) ||
      confidenceThreshold <= 0.5 ||
      confidenceThreshold > 1
    ) {
      throw new RangeError(
        `JerseyColorTeamAssigner: confidenceThreshold must be in (0.5, 1] ` +
          `(got ${confidenceThreshold})`,
      );
    }
    if (!Number.isInteger(maxIterations) || maxIterations < 1) {
      throw new RangeError(
        `JerseyColorTeamAssigner: maxIterations must be an integer >= 1 ` +
          `(got ${maxIterations})`,
      );
    }
    this.assignerId = assignerId;
    this.seed = seed;
    this.minSamples = minSamples;
    this.confidenceThreshold = confidenceThreshold;
    this.maxIterations = maxIterations;
    this.descriptor = perceptionDescriptor({
      technologyId: JERSEY_COLOR_TEAM_ASSIGNER_ID,
      technologyVersion: JERSEY_COLOR_TEAM_ASSIGNER_VERSION,
      adapterVersion: JERSEY_COLOR_TEAM_ASSIGNER_ADAPTER_VERSION,
      task: "perception.team-identity",
      inputContract: "contracts/observation.track-sequence@1",
      outputContract: "contracts/observation.team-assignment@1",
    });
    assertDescriptorBinding(this.descriptor, "perception.team-identity");
  }

  assign(sequence: readonly TrackSequenceFrame[]): readonly TeamAssignment[] {
    validateTrackSequence(sequence);
    const evidence = this.collectEvidence(sequence);
    const trackIds = [...evidence.keys()].sort(compareTrackIds);
    if (trackIds.length === 0) return [];

    const eligible = trackIds.filter((trackId) => {
      const track = evidence.get(trackId)!;
      return track.samples >= this.minSamples;
    });
    const lowSignalConfidence = (trackId: string): number => {
      const track = evidence.get(trackId)!;
      return Math.min(0.2, (0.2 * track.samples) / this.minSamples);
    };
    if (eligible.length < 2) {
      // Fewer than two eligible tracks: no two-team structure is
      // recoverable — everyone lands in `unknown` (honest, low confidence).
      return trackIds.map((trackId) => ({
        trackId: trackId as EntityId,
        teamId: "unknown",
        confidence: eligible.includes(trackId) ? 0.2 : lowSignalConfidence(trackId),
        method: JERSEY_COLOR_METHOD,
      }));
    }

    const colors = new Map<string, Rgb>(
      eligible.map((trackId) => {
        const track = evidence.get(trackId)!;
        return [
          trackId,
          {
            r: track.sumR / track.samples,
            g: track.sumG / track.samples,
            b: track.sumB / track.samples,
          },
        ];
      }),
    );

    // Seeded k=2 initialization: center A from the seeded draw, center B the
    // farthest color from A (ties -> lowest track order).
    const rng = createRng(seedFromString(this.seed));
    const centerAIndex = Math.floor(rng() * eligible.length);
    const centerAColor = colors.get(eligible[centerAIndex] ?? eligible[0]!)!;
    let centerBColor: Rgb = centerAColor;
    let bestDistance = -1;
    for (const trackId of eligible) {
      const distance = squaredColorDistance(centerAColor, colors.get(trackId)!);
      if (distance > bestDistance) {
        bestDistance = distance;
        centerBColor = colors.get(trackId)!;
      }
    }
    let centerA = centerAColor;
    let centerB = centerBColor;

    // k-means iterations to stability.
    let membership = new Map<string, 0 | 1>();
    for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
      const next = new Map<string, 0 | 1>();
      for (const trackId of eligible) {
        const dA = squaredColorDistance(colors.get(trackId)!, centerA);
        const dB = squaredColorDistance(colors.get(trackId)!, centerB);
        next.set(trackId, dB < dA ? 1 : 0);
      }
      const membersA = eligible.filter((trackId) => next.get(trackId) === 0);
      const membersB = eligible.filter((trackId) => next.get(trackId) === 1);
      if (membersA.length === 0 || membersB.length === 0) {
        // A cluster emptied: the kits cannot be separated by color.
        return trackIds.map((trackId) => ({
          trackId: trackId as EntityId,
          teamId: "unknown",
          confidence: eligible.includes(trackId) ? 0.2 : lowSignalConfidence(trackId),
          method: JERSEY_COLOR_METHOD,
        }));
      }
      centerA = medianColor(membersA.map((trackId) => colors.get(trackId)!));
      centerB = medianColor(membersB.map((trackId) => colors.get(trackId)!));
      let stable = true;
      for (const trackId of eligible) {
        if (next.get(trackId) !== membership.get(trackId)) {
          stable = false;
          break;
        }
      }
      membership = next;
      if (stable) break;
    }

    // Home/away labeling: the cluster holding the lowest-ordered eligible
    // track is `home` (deterministic but arbitrary — see the failure class).
    const lowestTrack = eligible[0]!;
    const lowestCluster = membership.get(lowestTrack) === 1 ? 1 : 0;
    const clusterTeam = lowestCluster === 0 ? "home" : "away";
    const otherTeam = lowestCluster === 0 ? "away" : "home";
    const centerDistance = squaredColorDistance(centerA, centerB);
    const outlierThreshold = Math.max(0.5 * centerDistance, OUTLIER_MIN_DISTANCE);

    return trackIds.map((trackId) => {
      if (!eligible.includes(trackId)) {
        return {
          trackId: trackId as EntityId,
          teamId: "unknown",
          confidence: lowSignalConfidence(trackId),
          method: JERSEY_COLOR_METHOD,
        };
      }
      const dA = squaredColorDistance(colors.get(trackId)!, centerA);
      const dB = squaredColorDistance(colors.get(trackId)!, centerB);
      const total = dA + dB;
      const separation = total === 0 ? 0 : Math.abs(dA - dB) / total;
      const rawConfidence = 0.5 + separation / 2;
      const nearestCluster: 0 | 1 = dB < dA ? 1 : 0;
      const nearestDistance = Math.min(dA, dB);
      if (rawConfidence < this.confidenceThreshold) {
        // Near-equidistant: honestly unassignable — LOW confidence unknown.
        return {
          trackId: trackId as EntityId,
          teamId: "unknown",
          confidence: rawConfidence,
          method: JERSEY_COLOR_METHOD,
        };
      }
      if (nearestDistance > outlierThreshold) {
        // Distinct kit (goalkeeper/referee-like): far from BOTH clusters.
        return {
          trackId: trackId as EntityId,
          teamId: "unknown",
          confidence: rawConfidence,
          method: JERSEY_COLOR_METHOD,
        };
      }
      return {
        trackId: trackId as EntityId,
        teamId: nearestCluster === lowestCluster ? clusterTeam : otherTeam,
        confidence: rawConfidence,
        method: JERSEY_COLOR_METHOD,
      };
    });
  }

  /** Accumulates per-track non-green crop color evidence across the sequence. */
  private collectEvidence(
    sequence: readonly TrackSequenceFrame[],
  ): Map<string, TrackColorEvidence> {
    const evidence = new Map<string, TrackColorEvidence>();
    for (const { frame, tracked } of sequence) {
      const { width, height, bytes } = frame;
      if (width <= 0 || height <= 0) continue;
      for (const box of tracked) {
        const clamp = (value: number, max: number): number =>
          Math.min(max - 1, Math.max(0, Math.round(value)));
        const x0 = clamp(box.box.x * width, width);
        const y0 = clamp(box.box.y * height, height);
        const x1 = clamp((box.box.x + box.box.w) * width, width);
        const y1 = clamp((box.box.y + box.box.h) * height, height);
        let track = evidence.get(box.trackId);
        if (track === undefined) {
          track = {
            trackId: box.trackId,
            sumR: 0,
            sumG: 0,
            sumB: 0,
            samples: 0,
          };
          evidence.set(box.trackId, track);
        }
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const index = (y * width + x) * 3;
            const r = bytes[index]!;
            const g = bytes[index + 1]!;
            const b = bytes[index + 2]!;
            if (isPitchGreen(r, g, b)) continue;
            track.sumR += r;
            track.sumG += g;
            track.sumB += b;
            track.samples += 1;
          }
        }
      }
    }
    return evidence;
  }
}

/** Per-channel MEDIAN of a non-empty color list (robust center — k-medians). */
function medianColor(colors: readonly Rgb[]): Rgb {
  const channelMedian = (values: readonly number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  };
  return {
    r: channelMedian(colors.map((color) => color.r)),
    g: channelMedian(colors.map((color) => color.g)),
    b: channelMedian(colors.map((color) => color.b)),
  };
}
