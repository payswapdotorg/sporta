/**
 * @sporta/field-mapping — pitch/field mapping (work item W203).
 *
 * The image -> pitch coordinate transform: a homography seam, a deterministic
 * fixture calibrator, the projection math (image-normalized coordinates ->
 * canonical pitch meters), and field-mapping observation emission. Real CV
 * corner detection arrives with the GPU worker protocol (W303) — the SEAM is
 * what W206 (spatial state estimation) consumes. Module map:
 *
 * - `homography`: pure 3x3 math — `solveHomography` (exact 8-point DLT for
 *   four pairs, Gaussian elimination with partial pivoting + rank check),
 *   `applyHomography` (project a point; zero denominator -> typed error),
 *   `invertHomography` (adjugate/cofactor method, canonical `h[8] = 1`,
 *   round-trip guarantee), `Point2D` (contract-derived)
 * - `calibrator`: the provider-neutral seam — `FieldCalibratorAdapter`,
 *   `FieldCornerSet`, `CalibratorFrameInput`, the canonical producer order
 *   (`CANONICAL_CORNER_ORDER` = `"tl, tr, br, bl"`) and canonical pitch
 *   corners — plus `FixtureFieldCalibrator`, a pure deterministic synthetic
 *   camera (pan/zoom/jitter; ignores pixel content by design, which is
 *   exactly what a real calibrator would not do)
 * - `project`: `createPitchProjector` — solves the homography from a corner
 *   set ONCE and exposes pure `project` / `projectBox`; out-of-play results
 *   are flagged via `inBounds`, never clamped
 * - `observe`: `emitFieldMappingObservation` — turns a frame's corner set
 *   into a contract `Observation` (vision / OBSERVED, confidence verbatim,
 *   stable `cameraHomographyRef`), plus the
 *   `validateFieldMappingObservation` zod-parse helper
 *
 * Architecture-lock conformance: vendor-neutral seam (§9), observations carry
 * provenance and confidence with no silent collapse (§6), W203 emits in
 * frame-native timeline time and never invents in-play positions (§4 —
 * out-of-bounds projections are flagged, not clamped).
 */
export type { Homography, Point2D } from "./homography";
export {
  HOMOGRAPHY_PAIR_COUNT,
  applyHomography,
  invertHomography,
  solveHomography,
} from "./homography";
export {
  CANONICAL_CORNER_ORDER,
  CANONICAL_PITCH_CORNERS,
  FIXTURE_CALIBRATOR_CONFIDENCE,
  FIXTURE_CALIBRATOR_DEFAULT_ID,
  FixtureFieldCalibrator,
  type CalibratorFrameInput,
  type FieldCalibratorAdapter,
  type FieldCornerSet,
  type FixtureCameraSpec,
} from "./calibrator";
export {
  createPitchProjector,
  type NormalizedBox,
  type PitchProjector,
  type ProjectedBox,
  type ProjectedPitchPoint,
} from "./project";
export { emitFieldMappingObservation, validateFieldMappingObservation } from "./observe";
export type { EmitFieldMappingInput } from "./observe";
export {
  DegenerateCorrespondenceError,
  DegenerateHomographyError,
  FieldMappingError,
  InvalidCorrespondenceError,
  InvalidHomographyError,
  ProjectionAtInfinityError,
  UnsupportedCornerOrderError,
  isFieldMappingError,
  type FieldMappingErrorDetails,
  type FieldMappingErrorUnion,
} from "./errors";
