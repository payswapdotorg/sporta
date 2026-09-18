/**
 * R205 candidate 2: `LineBasedFieldCalibrator` — the PIXEL-DRIVEN pitch
 * calibration candidate: it detects pitch lines heuristically IN THE FRAME
 * PIXELS and feeds the strongest correspondences into the SAME W203
 * homography solver (wrap, never fork).
 *
 * ALGORITHM (documented in full — every rule is part of the contract the
 * benchmark asserts against):
 *
 * 1. PITCH MASK: pixels classified pitch-green (`isPitchGreen`); the pitch
 *    region's row/column extent is measured. A pitch region smaller than
 *    `minPitchFraction` of the frame (default 20%) is a typed refusal —
 *    there is not enough pitch in view to calibrate honestly.
 * 2. LINE MASK: bright-white pixels (`isBrightWhite`) INSIDE the pitch
 *    region — pitch markings only.
 * 3. PROJECTION HISTOGRAMS: per-column white counts (vertical-line
 *    evidence) and per-row white counts (horizontal-line evidence),
 *    normalized by the pitch extent. A column whose count >=
 *    `lineStrengthThreshold` (default 0.5) of the pitch height is line
 *    evidence; likewise rows against the pitch width.
 * 4. LINE EXTRACTION: each contiguous above-threshold histogram group is
 *    ONE line at the group's count-weighted pixel centroid (a 2-3px
 *    painted line yields one line, not three). Across the frame SEQUENCE,
 *    per-frame lines are aggregated by pixel-proximity clustering (gap <=
 *    `lineMergeTolerancePixels`, default 3): the aggregated line sits at
 *    the MEDIAN pixel of its cluster with the mean strength — robust to
 *    single-frame noise and to a line missing in some frames.
 * 5. LINE -> PITCH MAPPING: aggregated vertical lines (sorted by pixel,
 *    at most `maxVerticalLines` = 3 kept) map IN ORDER onto the pitch's
 *    vertical line family {x = 0 (goal line), x = 52.5 (halfway line),
 *    x = 105 (goal line)}; horizontal lines (at most 2 kept) onto
 *    {y = 0, y = 68} (the touchlines). With exactly two vertical lines
 *    they are ASSUMED to be the outer goal lines (the documented
 *    ambiguity — honestly penalized: the confidence takes an explicit
 *    x0.75 assumption discount on top of the reduced anchor count).
 *    Fewer than two vertical or two horizontal lines is a typed refusal.
 * 6. CORRESPONDENCES: every (vertical x horizontal) intersection is an
 *    image<->pitch correspondence. The FOUR BOUNDARY corners (outermost
 *    lines' intersections — the strongest anchors) are fed to W203's
 *    `solveHomography` in canonical `"tl, tr, br, bl"` order; remaining
 *    intersections (halfway-line crossings) VALIDATE the mapping via
 *    their projection residuals.
 * 7. CONFIDENCE (honest, per anchor count and quality):
 *    `0.35 + 0.4 * (correspondenceCount / 6) + 0.25 * meanLineStrength`,
 *    clamped into [0, 1], then DISCOUNTED by validation residuals (each
 *    residual above `validationResidualMeters` costs a multiplicative
 *    factor) and by the x0.75 two-line-assumption factor when the
 *    ambiguity branch was taken. Reported, never inflated.
 *
 * ENVELOPE (honest): the projection-histogram line model assumes
 * NEAR-AXIS-ALIGNED broadcast views, and the line -> pitch family mapping
 * assumes the pitch's VISIBLE vertical lines are exactly the family
 * {0, 52.5, 105} and horizontals {0, 68} — extra interior markings
 * (penalty areas) would be mistaken for family lines. The
 * synthetic-diagnostic fixtures paint exactly the family lines. Heavily
 * oblique cameras smear the histograms. All three limits are documented
 * failure classes; a real line detector arrives with the W203->W303 CV
 * path.
 */
import type {
  FailureClassRecord,
  PerceptionAdapterDescriptor,
  ResourceRequirements,
  TechnologyLicenseRecord,
} from "@sporta/contracts";
import { CANONICAL_PITCH_CORNERS, applyHomography, solveHomography } from "@sporta/field-mapping";
import { PITCH_LENGTH_AXIS_METERS, PITCH_WIDTH_AXIS_METERS } from "@sporta/contracts";
import type { FieldCornerSet, Homography, Point2D } from "@sporta/field-mapping";
import type { FieldMappingPayload, PitchPoint } from "@sporta/contracts";
import type { DetectorFrameInput } from "@sporta/perception-detection";
import { assertDescriptorBinding, CandidateFailureError, perceptionDescriptor } from "../errors";
import { LINE_BASED_FIELD_CALIBRATOR_LICENSE } from "../licenses";
import { isBrightWhite, isPitchGreen } from "../pixels";
import type { CalibrationResult, PitchCalibrationAdapter, PitchCalibrationInput } from "../adapter";

/** Stable technology identity of this candidate. */
export const LINE_BASED_FIELD_CALIBRATOR_ID = "line-based-field-calibrator";
export const LINE_BASED_FIELD_CALIBRATOR_VERSION = "0.1.0";
export const LINE_BASED_FIELD_CALIBRATOR_ADAPTER_VERSION = "0.1.0";

/** The pitch's vertical line family (goal lines + halfway line), in order. */
const VERTICAL_LINE_PITCH_X: readonly number[] = [
  0,
  PITCH_LENGTH_AXIS_METERS / 2,
  PITCH_LENGTH_AXIS_METERS,
];

/** The pitch's horizontal line family (the two touchlines), in order. */
const HORIZONTAL_LINE_PITCH_Y: readonly number[] = [0, PITCH_WIDTH_AXIS_METERS];

/** Options for {@link LineBasedFieldCalibrator}; every field is optional. */
export interface LineBasedFieldCalibratorOptions {
  /** Component id (default `line-based-field-calibrator-v1`). */
  readonly calibratorId?: string;
  /** Minimum pitch-region fraction of the frame (default 0.2). */
  readonly minPitchFraction?: number;
  /** Line-strength threshold, fraction of the pitch extent (default 0.5). */
  readonly lineStrengthThreshold?: number;
  /**
   * Validation residual budget in meters: residuals above it discount the
   * confidence (default 1.0 — one meter on a 105 m pitch).
   */
  readonly validationResidualMeters?: number;
  /** Pixel gap below which per-frame lines merge into one (default 3). */
  readonly lineMergeTolerancePixels?: number;
}

const LINE_BASED_DEFAULTS = {
  calibratorId: "line-based-field-calibrator-v1",
  minPitchFraction: 0.2,
  lineStrengthThreshold: 0.5,
  validationResidualMeters: 1.0,
  lineMergeTolerancePixels: 3,
} as const;

/** Documented failure classes of the line-based field calibrator. */
export const LINE_BASED_FIELD_CALIBRATOR_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "line-based.no-pitch-visible",
    description:
      "The green-pitch region covers less than minPitchFraction of the frame (or no " +
      "green region exists): not enough pitch in view to calibrate honestly. Typed " +
      "refusal, never a guessed mapping.",
    retryable: false,
  },
  {
    failureClassId: "line-based.insufficient-line-evidence",
    description:
      "Fewer than two vertical or two horizontal line groups passed the strength " +
      "threshold: the correspondences cannot span the pitch. Typed refusal.",
    retryable: false,
  },
  {
    failureClassId: "line-based.off-axis-view",
    description:
      "Heavily oblique or rotating cameras smear the projection histograms: lines " +
      "go undetected or land at skewed positions and the mapping degrades. The " +
      "histogram model's documented envelope is near-axis-aligned broadcast views.",
    retryable: false,
  },
  {
    failureClassId: "line-based.extra-marking-confusion",
    description:
      "Interior markings (penalty areas, center circle arcs) that survive the " +
      "histogram thresholds are mistaken for family lines: with more than three " +
      "vertical candidates the first three (leftmost) win, which mislabels penalty " +
      "lines as goal/halfway lines. The synthetic-diagnostic fixtures paint exactly " +
      "the family lines; real-video line classification is W303 CV work.",
    retryable: false,
  },
  {
    failureClassId: "line-based.line-identity-ambiguity",
    description:
      "When exactly two vertical lines are visible they are ASSUMED to be the outer " +
      "goal lines (x=0 / x=105); a zoomed view showing {0, 52.5} or {52.5, 105} " +
      "instead violates the assumption and the mapping is wrong by a half pitch. " +
      "The reduced anchor count discounts the confidence honestly.",
    retryable: false,
  },
];

/** Resource requirements: pure CPU, one core. */
export const LINE_BASED_FIELD_CALIBRATOR_RESOURCES: ResourceRequirements = {
  gpuRequired: false,
  minCpuCores: 1,
};

/** One detected line: pixel position (centroid) + strength in [0, 1]. */
interface DetectedLine {
  readonly pixel: number;
  readonly strength: number;
}

/**
 * Extracts single lines from a projection histogram: each contiguous run of
 * columns/rows whose count >= `threshold * extent` is ONE line at the
 * count-weighted centroid. Deterministic.
 */
function extractLinesFromHistogram(
  counts: readonly number[],
  extent: number,
  threshold: number,
): DetectedLine[] {
  const lines: DetectedLine[] = [];
  let groupStart = -1;
  let groupEnd = 0;
  let groupWeightedSum = 0;
  let groupWeight = 0;
  const flush = (): void => {
    if (groupStart < 0 || groupWeight <= 0) return;
    lines.push({
      pixel: groupWeightedSum / groupWeight,
      strength: groupWeight / Math.max(groupEnd - groupStart, 1) / Math.max(extent, 1),
    });
    groupStart = -1;
    groupWeightedSum = 0;
    groupWeight = 0;
  };
  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index]!;
    if (count >= threshold * extent) {
      if (groupStart < 0) groupStart = index;
      groupEnd = index + 1;
      groupWeightedSum += index * count;
      groupWeight += count;
    } else {
      flush();
    }
  }
  flush();
  return lines;
}

/**
 * Aggregates per-frame lines across the sequence by pixel proximity: all
 * lines are sorted by pixel; runs whose consecutive gap <= `tolerance`
 * merge into one aggregated line at the MEDIAN pixel with the MEAN
 * strength. Robust to single-frame noise AND to lines missing in some
 * frames. Deterministic.
 */
function aggregateLinesByProximity(
  perFrame: readonly DetectedLine[][],
  tolerance: number,
): DetectedLine[] {
  const all: DetectedLine[] = perFrame.flat();
  if (all.length === 0) return [];
  const sorted = [...all].sort((a, b) => a.pixel - b.pixel);
  const aggregated: DetectedLine[] = [];
  let cluster: DetectedLine[] = [sorted[0]!];
  for (let index = 1; index < sorted.length; index += 1) {
    const line = sorted[index]!;
    if (line.pixel - cluster[cluster.length - 1]!.pixel <= tolerance) {
      cluster.push(line);
    } else {
      aggregated.push(medianLine(cluster));
      cluster = [line];
    }
  }
  aggregated.push(medianLine(cluster));
  return aggregated;
}

/** The median pixel + mean strength of one proximity cluster. */
function medianLine(cluster: readonly DetectedLine[]): DetectedLine {
  const pixels = cluster.map((line) => line.pixel).sort((a, b) => a - b);
  const median = pixels[Math.floor(pixels.length / 2)]!;
  const strength = cluster.reduce((sum, line) => sum + line.strength, 0) / cluster.length;
  return { pixel: median, strength };
}

/**
 * Maps the index-th sorted line of a family onto its pitch coordinate. With
 * the full family visible the mapping is positional and unambiguous; with
 * exactly two vertical lines the outer-goal-line assumption applies (the
 * documented ambiguity).
 */
function linePitchCoordinate(lineCount: number, family: readonly number[], index: number): number {
  if (lineCount >= family.length) return family[Math.min(index, family.length - 1)]!;
  if (lineCount === 2 && family.length === 3) {
    return index === 0 ? family[0]! : family[family.length - 1]!;
  }
  return family[Math.min(index, family.length - 1)]!;
}

/**
 * The pixel-driven line-based field calibrator (R205 candidate 2).
 *
 * Construct with options; call {@link calibrate} with the frame sequence —
 * the pixels are the evidence (the input's optional `cornerSet` is IGNORED
 * by this candidate, documented: it detects its own anchors).
 */
export class LineBasedFieldCalibrator implements PitchCalibrationAdapter {
  readonly descriptor: PerceptionAdapterDescriptor;
  readonly license: TechnologyLicenseRecord = LINE_BASED_FIELD_CALIBRATOR_LICENSE;
  readonly failureClasses: readonly FailureClassRecord[] =
    LINE_BASED_FIELD_CALIBRATOR_FAILURE_CLASSES;
  readonly resourceRequirements: ResourceRequirements = LINE_BASED_FIELD_CALIBRATOR_RESOURCES;
  readonly calibratorId: string;
  private readonly minPitchFraction: number;
  private readonly lineStrengthThreshold: number;
  private readonly validationResidualMeters: number;
  private readonly lineMergeTolerancePixels: number;

  constructor(options: LineBasedFieldCalibratorOptions = {}) {
    const calibratorId = options.calibratorId ?? LINE_BASED_DEFAULTS.calibratorId;
    const minPitchFraction = options.minPitchFraction ?? LINE_BASED_DEFAULTS.minPitchFraction;
    const lineStrengthThreshold =
      options.lineStrengthThreshold ?? LINE_BASED_DEFAULTS.lineStrengthThreshold;
    const validationResidualMeters =
      options.validationResidualMeters ?? LINE_BASED_DEFAULTS.validationResidualMeters;
    const lineMergeTolerancePixels =
      options.lineMergeTolerancePixels ?? LINE_BASED_DEFAULTS.lineMergeTolerancePixels;
    if (typeof calibratorId !== "string" || calibratorId.length < 1) {
      throw new RangeError("LineBasedFieldCalibrator: calibratorId must be a non-empty string");
    }
    if (!Number.isFinite(minPitchFraction) || minPitchFraction <= 0 || minPitchFraction > 1) {
      throw new RangeError(
        `LineBasedFieldCalibrator: minPitchFraction must be in (0, 1] (got ${minPitchFraction})`,
      );
    }
    if (
      !Number.isFinite(lineStrengthThreshold) ||
      lineStrengthThreshold <= 0 ||
      lineStrengthThreshold > 1
    ) {
      throw new RangeError(
        `LineBasedFieldCalibrator: lineStrengthThreshold must be in (0, 1] ` +
          `(got ${lineStrengthThreshold})`,
      );
    }
    if (!Number.isFinite(validationResidualMeters) || validationResidualMeters <= 0) {
      throw new RangeError(
        `LineBasedFieldCalibrator: validationResidualMeters must be > 0 ` +
          `(got ${validationResidualMeters})`,
      );
    }
    if (!Number.isFinite(lineMergeTolerancePixels) || lineMergeTolerancePixels < 0) {
      throw new RangeError(
        `LineBasedFieldCalibrator: lineMergeTolerancePixels must be >= 0 ` +
          `(got ${lineMergeTolerancePixels})`,
      );
    }
    this.calibratorId = calibratorId;
    this.minPitchFraction = minPitchFraction;
    this.lineStrengthThreshold = lineStrengthThreshold;
    this.validationResidualMeters = validationResidualMeters;
    this.lineMergeTolerancePixels = lineMergeTolerancePixels;
    this.descriptor = perceptionDescriptor({
      technologyId: LINE_BASED_FIELD_CALIBRATOR_ID,
      technologyVersion: LINE_BASED_FIELD_CALIBRATOR_VERSION,
      adapterVersion: LINE_BASED_FIELD_CALIBRATOR_ADAPTER_VERSION,
      task: "perception.pitch-calibration",
      inputContract: "contracts/normalized-video-frame-sequence@1",
      outputContract: "contracts/observation.field-mapping@1",
    });
    assertDescriptorBinding(this.descriptor, "perception.pitch-calibration");
  }

  calibrate(input: PitchCalibrationInput): CalibrationResult {
    if (input.frames.length === 0) {
      throw new CandidateFailureError(
        "LineBasedFieldCalibrator: an empty frame sequence carries no line evidence",
        { failureClassId: "line-based.insufficient-line-evidence" },
      );
    }
    const verticalPerFrame: DetectedLine[][] = [];
    const horizontalPerFrame: DetectedLine[][] = [];
    for (const frame of input.frames) {
      const evidence = this.extractLineEvidence(frame);
      verticalPerFrame.push(evidence.vertical);
      horizontalPerFrame.push(evidence.horizontal);
    }
    const vertical = aggregateLinesByProximity(verticalPerFrame, this.lineMergeTolerancePixels);
    const horizontal = aggregateLinesByProximity(horizontalPerFrame, this.lineMergeTolerancePixels);
    if (vertical.length < 2 || horizontal.length < 2) {
      throw new CandidateFailureError(
        `LineBasedFieldCalibrator: insufficient line evidence (${vertical.length} vertical, ` +
          `${horizontal.length} horizontal; at least two of each are required to span ` +
          `the pitch) — threshold ${this.lineStrengthThreshold}, documented envelope: ` +
          `near-axis-aligned views`,
        {
          failureClassId: "line-based.insufficient-line-evidence",
          verticalLines: vertical.length,
          horizontalLines: horizontal.length,
        },
      );
    }

    // Line -> pitch mapping: sorted by pixel, at most the family size kept
    // (leftmost first — see the extra-marking-confusion failure class).
    const verticalMap = vertical.slice(0, VERTICAL_LINE_PITCH_X.length).map((line, index) => ({
      imagePixel: line.pixel,
      pitchX: linePitchCoordinate(
        Math.min(vertical.length, VERTICAL_LINE_PITCH_X.length),
        VERTICAL_LINE_PITCH_X,
        index,
      ),
      strength: line.strength,
    }));
    const horizontalMap = horizontal
      .slice(0, HORIZONTAL_LINE_PITCH_Y.length)
      .map((line, index) => ({
        imagePixel: line.pixel,
        pitchY: linePitchCoordinate(
          Math.min(horizontal.length, HORIZONTAL_LINE_PITCH_Y.length),
          HORIZONTAL_LINE_PITCH_Y,
          index,
        ),
        strength: line.strength,
      }));

    const frameWidth = input.frames[0]!.width;
    const frameHeight = input.frames[0]!.height;
    const anchorFrame = input.frames[input.frames.length - 1]!;

    // All intersections = correspondences; the boundary four are the
    // strongest (outermost lines) and feed the W203 solver.
    const correspondences: Array<{ image: Point2D; pitch: PitchPoint }> = [];
    for (const verticalLine of verticalMap) {
      for (const horizontalLine of horizontalMap) {
        correspondences.push({
          image: {
            x: verticalLine.imagePixel / frameWidth,
            y: horizontalLine.imagePixel / frameHeight,
          },
          pitch: { x: verticalLine.pitchX, y: horizontalLine.pitchY },
        });
      }
    }
    const leftMost = verticalMap[0]!;
    const rightMost = verticalMap[verticalMap.length - 1]!;
    const topMost = horizontalMap[0]!;
    const bottomMost = horizontalMap[horizontalMap.length - 1]!;
    const imageCorners: Point2D[] = [
      { x: leftMost.imagePixel / frameWidth, y: topMost.imagePixel / frameHeight },
      { x: rightMost.imagePixel / frameWidth, y: topMost.imagePixel / frameHeight },
      { x: rightMost.imagePixel / frameWidth, y: bottomMost.imagePixel / frameHeight },
      { x: leftMost.imagePixel / frameWidth, y: bottomMost.imagePixel / frameHeight },
    ];
    const homography: Homography = solveHomography(imageCorners, [...CANONICAL_PITCH_CORNERS]);

    // Validation: every NON-anchor correspondence's projection residual
    // discounts the confidence (multiplicative penalty per over-budget
    // residual — reported, never inflated).
    let residualPenalty = 1;
    for (const correspondence of correspondences) {
      const isAnchor =
        (correspondence.pitch.x === leftMost.pitchX ||
          correspondence.pitch.x === rightMost.pitchX) &&
        (correspondence.pitch.y === topMost.pitchY || correspondence.pitch.y === bottomMost.pitchY);
      if (isAnchor) continue;
      const projected = applyHomography(homography, correspondence.image);
      const residual = Math.hypot(
        projected.x - correspondence.pitch.x,
        projected.y - correspondence.pitch.y,
      );
      if (residual > this.validationResidualMeters) {
        residualPenalty *= 1 / (1 + residual - this.validationResidualMeters);
      }
    }

    // Honest confidence (see the module docs): anchor count + line strength
    // + validation residual.
    const strengths = [...verticalMap, ...horizontalMap].map((line) => line.strength);
    const meanStrength = strengths.reduce((sum, value) => sum + value, 0) / strengths.length;
    const confidence = Math.min(
      1,
      Math.max(
        0,
        (0.35 + 0.4 * (correspondences.length / 6) + 0.25 * meanStrength) *
          residualPenalty *
          // Explicit two-line-assumption discount: the candidate KNOWS when
          // it took the outer-goal-line ambiguity branch (see the module
          // docs and the line-identity-ambiguity failure class).
          (verticalMap.length === 2 ? 0.75 : 1),
      ),
    );

    const cornerSet: FieldCornerSet = {
      corners: [imageCorners[0]!, imageCorners[1]!, imageCorners[2]!, imageCorners[3]!],
      cornerOrder: "tl, tr, br, bl",
      confidence,
    };
    const mapping: FieldMappingPayload = {
      kind: "field-mapping",
      pitchCorners: imageCorners.map((corner) => ({ x: corner.x, y: corner.y })),
      cameraHomographyRef: `homography-${this.calibratorId}-${anchorFrame.frameId}`,
    };
    return {
      mapping,
      homography,
      cornerSet,
      confidence,
      correspondenceCount: correspondences.length,
    };
  }

  /**
   * One frame's line evidence: pitch extent measurement + projection
   * histograms (see the module docs). Deterministic.
   */
  private extractLineEvidence(frame: DetectorFrameInput): {
    vertical: DetectedLine[];
    horizontal: DetectedLine[];
  } {
    const { width, height, bytes } = frame;
    if (width <= 1 || height <= 1) {
      throw new CandidateFailureError(
        "LineBasedFieldCalibrator: frame too small to carry line evidence",
        { failureClassId: "line-based.no-pitch-visible", width, height },
      );
    }
    let pitchMinX = width;
    let pitchMaxX = -1;
    let pitchMinY = height;
    let pitchMaxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 3;
        if (isPitchGreen(bytes[index]!, bytes[index + 1]!, bytes[index + 2]!)) {
          if (x < pitchMinX) pitchMinX = x;
          if (x > pitchMaxX) pitchMaxX = x;
          if (y < pitchMinY) pitchMinY = y;
          if (y > pitchMaxY) pitchMaxY = y;
        }
      }
    }
    if (pitchMaxX < 0) {
      throw new CandidateFailureError(
        "LineBasedFieldCalibrator: no pitch-green region found in the frame",
        { failureClassId: "line-based.no-pitch-visible" },
      );
    }
    const pitchWidth = pitchMaxX - pitchMinX + 1;
    const pitchHeight = pitchMaxY - pitchMinY + 1;
    if (
      (pitchWidth * pitchHeight) / (width * height) < this.minPitchFraction ||
      pitchWidth < 8 ||
      pitchHeight < 8
    ) {
      throw new CandidateFailureError(
        `LineBasedFieldCalibrator: pitch region too small (${pitchWidth}x${pitchHeight} of ` +
          `${width}x${height}; minimum fraction ${this.minPitchFraction})`,
        { failureClassId: "line-based.no-pitch-visible", pitchWidth, pitchHeight },
      );
    }
    // Projection histograms over the pitch region: bright-white pixels.
    const columnCounts = new Array<number>(pitchWidth).fill(0);
    const rowCounts = new Array<number>(pitchHeight).fill(0);
    for (let y = pitchMinY; y <= pitchMaxY; y += 1) {
      for (let x = pitchMinX; x <= pitchMaxX; x += 1) {
        const index = (y * width + x) * 3;
        if (isBrightWhite(bytes[index]!, bytes[index + 1]!, bytes[index + 2]!)) {
          columnCounts[x - pitchMinX]! += 1;
          rowCounts[y - pitchMinY]! += 1;
        }
      }
    }
    return {
      vertical: extractLinesFromHistogram(columnCounts, pitchHeight, this.lineStrengthThreshold),
      horizontal: extractLinesFromHistogram(rowCounts, pitchWidth, this.lineStrengthThreshold),
    };
  }
}
