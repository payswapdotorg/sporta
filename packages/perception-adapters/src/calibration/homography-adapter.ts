/**
 * R205 candidate 1: `HomographyFieldCalibratorAdapter` — the BASELINE pitch
 * calibration candidate, WRAPPING the W203 DLT homography solver (wrap,
 * never fork).
 *
 * The baseline is CORRESPONDENCE-DRIVEN: it consumes the externally-supplied
 * corner set (`input.cornerSet`, the W203 `FieldCornerSet` shape in the
 * canonical `"tl, tr, br, bl"` producer order — the "input corner
 * correspondences"), solves the image -> pitch homography with W203's exact
 * 8-point DLT (`solveHomography` paired against `CANONICAL_PITCH_CORNERS`),
 * and emits the `FieldMappingPayload`-conformant mapping. The frame pixels
 * are IGNORED by design — exactly the difference a real CV calibrator would
 * not have (the same honesty note the W203 fixture calibrator carries);
 * candidate 2 (`LineBasedFieldCalibrator`) is the pixel-driven one.
 *
 * HONEST SEMANTICS inherited verbatim from W203: `confidence` is the corner
 * set's own confidence passed through (no silent collapse); degenerate
 * correspondence geometry throws the W203 `DegenerateCorrespondenceError`
 * (a typed refusal, never a silently wrong mapping); an unsupported
 * `cornerOrder` throws the W203 `UnsupportedCornerOrderError`; inBounds
 * semantics live in the W203 projector the emitted corner set feeds
 * (`createPitchProjector(result.cornerSet)` — out-of-play projections are
 * flagged, never clamped).
 */
import type {
  FailureClassRecord,
  PerceptionAdapterDescriptor,
  ResourceRequirements,
  TechnologyLicenseRecord,
} from "@sporta/contracts";
import {
  CANONICAL_PITCH_CORNERS,
  createPitchProjector,
  solveHomography,
} from "@sporta/field-mapping";
import type { Homography } from "@sporta/field-mapping";
import type { FieldMappingPayload } from "@sporta/contracts";
import { assertDescriptorBinding, InvalidAdapterInputError, perceptionDescriptor } from "../errors";
import { HOMOGRAPHY_FIELD_CALIBRATOR_LICENSE } from "../licenses";
import type { CalibrationResult, PitchCalibrationAdapter, PitchCalibrationInput } from "../adapter";

/** Stable technology identity of this candidate. */
export const HOMOGRAPHY_FIELD_CALIBRATOR_ID = "homography-field-calibrator";
export const HOMOGRAPHY_FIELD_CALIBRATOR_VERSION = "0.1.0";
export const HOMOGRAPHY_FIELD_CALIBRATOR_ADAPTER_VERSION = "0.1.0";

/** Options for {@link HomographyFieldCalibratorAdapter}. */
export interface HomographyFieldCalibratorOptions {
  /** Component id (default `homography-field-calibrator-v1`). */
  readonly calibratorId?: string;
}

/** Documented failure classes (inherited semantics from the wrapped W203). */
export const HOMOGRAPHY_FIELD_CALIBRATOR_FAILURE_CLASSES: readonly FailureClassRecord[] = [
  {
    failureClassId: "homography-field.degenerate-correspondences",
    description:
      "The corner correspondences do not determine a homography (collinear/coincident " +
      "corners, or a mapping not expressible with h[8] = 1): W203's DLT rank check " +
      "refuses with DegenerateCorrespondenceError. Never a silently wrong mapping.",
    retryable: false,
  },
  {
    failureClassId: "homography-field.missing-corner-set",
    description:
      "The correspondence-driven baseline REQUIRES an externally-supplied corner set " +
      "(input.cornerSet); without one it refuses loudly. Pixel-driven detection is " +
      "candidate 2's job (LineBasedFieldCalibrator).",
    retryable: false,
  },
];

/** Resource requirements: pure CPU, one core. */
export const HOMOGRAPHY_FIELD_CALIBRATOR_RESOURCES: ResourceRequirements = {
  gpuRequired: false,
  minCpuCores: 1,
};

/**
 * The baseline pitch-calibration candidate wrapping the W203 DLT solver
 * (R205 candidate 1). Construct with options; call {@link calibrate} with
 * the externally-supplied corner set (`input.cornerSet` — REQUIRED for this
 * candidate) plus the frame sequence (used for sequence validation only;
 * pixels are ignored, documented).
 */
export class HomographyFieldCalibratorAdapter implements PitchCalibrationAdapter {
  readonly descriptor: PerceptionAdapterDescriptor;
  readonly license: TechnologyLicenseRecord = HOMOGRAPHY_FIELD_CALIBRATOR_LICENSE;
  readonly failureClasses: readonly FailureClassRecord[] =
    HOMOGRAPHY_FIELD_CALIBRATOR_FAILURE_CLASSES;
  readonly resourceRequirements: ResourceRequirements = HOMOGRAPHY_FIELD_CALIBRATOR_RESOURCES;
  readonly calibratorId: string;

  constructor(options: HomographyFieldCalibratorOptions = {}) {
    const calibratorId = options.calibratorId ?? "homography-field-calibrator-v1";
    if (typeof calibratorId !== "string" || calibratorId.length < 1) {
      throw new RangeError(
        "HomographyFieldCalibratorAdapter: calibratorId must be a non-empty string",
      );
    }
    this.calibratorId = calibratorId;
    this.descriptor = perceptionDescriptor({
      technologyId: HOMOGRAPHY_FIELD_CALIBRATOR_ID,
      technologyVersion: HOMOGRAPHY_FIELD_CALIBRATOR_VERSION,
      adapterVersion: HOMOGRAPHY_FIELD_CALIBRATOR_ADAPTER_VERSION,
      task: "perception.pitch-calibration",
      inputContract: "contracts/normalized-video-frame-sequence@1",
      outputContract: "contracts/observation.field-mapping@1",
    });
    assertDescriptorBinding(this.descriptor, "perception.pitch-calibration");
  }

  calibrate(input: PitchCalibrationInput): CalibrationResult {
    const cornerSet = input.cornerSet;
    if (cornerSet === undefined) {
      throw new InvalidAdapterInputError(
        "HomographyFieldCalibratorAdapter: this correspondence-driven baseline " +
          "requires input.cornerSet (the W203 FieldCornerSet in canonical order); " +
          "pixel-driven detection is the line-based candidate's job",
        { failureClassId: "homography-field.missing-corner-set" },
      );
    }
    // W203's own validations surface verbatim: unsupported cornerOrder and
    // degenerate geometry are typed W203 refusals (never silent). Solving
    // directly keeps the homography the primary artifact; the projector
    // construction afterwards validates consistency AND the corner order.
    const homography: Homography = solveHomography(
      [...cornerSet.corners],
      [...CANONICAL_PITCH_CORNERS],
    );
    createPitchProjector(cornerSet);
    // Ref convention mirrors W203's emission ("homography-<who>-<frameId>"):
    // an identity reference — the payload corners re-solve the homography,
    // and CalibrationResult carries the solved matrix alongside.
    const anchorFrameId =
      input.frames.length > 0 ? input.frames[input.frames.length - 1]!.frameId : "no-frames";
    const mapping: FieldMappingPayload = {
      kind: "field-mapping",
      pitchCorners: [
        { x: cornerSet.corners[0].x, y: cornerSet.corners[0].y },
        { x: cornerSet.corners[1].x, y: cornerSet.corners[1].y },
        { x: cornerSet.corners[2].x, y: cornerSet.corners[2].y },
        { x: cornerSet.corners[3].x, y: cornerSet.corners[3].y },
      ],
      cameraHomographyRef: `homography-${this.calibratorId}-${anchorFrameId}`,
    };
    return {
      mapping,
      homography,
      cornerSet,
      // Confidence passed through VERBATIM (architecture-lock §6).
      confidence: cornerSet.confidence,
      // The four corner correspondences are the anchors this candidate used.
      correspondenceCount: 4,
    };
  }
}
