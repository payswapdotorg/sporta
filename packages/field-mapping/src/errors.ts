/**
 * Typed field-mapping errors (W203), in the style of the W101/W102 error
 * modules: every deliberate rejection in the pitch/field-mapping path throws
 * one of these (never a bare `Error`), each carrying a structured, JSON-safe
 * `details` object for logs and metrics labels. Pure-math failures (degenerate
 * geometry, zero denominators) are classified refusals, not internal faults —
 * media-derived corner sets are UNTRUSTED input (architecture-lock §13), so a
 * calibrator that hands us collinear corners must fail loudly and typed.
 */

/** Structured, JSON-safe details carried on every field-mapping error. */
export type FieldMappingErrorDetails = Record<string, unknown>;

/** Base of all typed field-mapping errors: message + structured details. */
export class FieldMappingError extends Error {
  readonly details: FieldMappingErrorDetails;

  constructor(message: string, details: FieldMappingErrorDetails = {}) {
    super(message);
    this.name = "FieldMappingError";
    this.details = details;
  }
}

/**
 * Malformed correspondence input to `solveHomography`: not exactly four
 * point pairs, or a non-finite coordinate. `details` carries the observed
 * image/pitch point counts and the offending index where applicable.
 */
export class InvalidCorrespondenceError extends FieldMappingError {
  constructor(message: string, details: FieldMappingErrorDetails = {}) {
    super(message, details);
    this.name = "InvalidCorrespondenceError";
  }
}

/**
 * The four point pairs do not determine a homography: the 8x8 DLT system is
 * singular (rank-deficient) — collinear or coincident image points, collinear
 * pitch points, or a true homography that is not expressible with `h[8] = 1`
 * (the image origin mapping to a point at infinity). Detected by the rank
 * check during Gaussian elimination.
 */
export class DegenerateCorrespondenceError extends FieldMappingError {
  constructor(message: string, details: FieldMappingErrorDetails = {}) {
    super(message, details);
    this.name = "DegenerateCorrespondenceError";
  }
}

/**
 * Malformed homography matrix input to `applyHomography`/`invertHomography`:
 * not a length-9 array of finite numbers, or a non-finite projection point.
 */
export class InvalidHomographyError extends FieldMappingError {
  constructor(message: string, details: FieldMappingErrorDetails = {}) {
    super(message, details);
    this.name = "InvalidHomographyError";
  }
}

/**
 * A homography operation is degenerate: `invertHomography` on a singular
 * matrix (determinant ~ 0), or an inverse that cannot be normalized to the
 * canonical `h[8] = 1` form because its `h[8]` entry is ~ 0 (the rejection
 * required by the W203 homography contract).
 */
export class DegenerateHomographyError extends FieldMappingError {
  constructor(message: string, details: FieldMappingErrorDetails = {}) {
    super(message, details);
    this.name = "DegenerateHomographyError";
  }
}

/**
 * `applyHomography` was asked to project a point whose denominator (the third
 * row of `H * [x, y, 1]^T`) is ~ 0: the point maps to a point at infinity and
 * has no finite pitch coordinates.
 */
export class ProjectionAtInfinityError extends FieldMappingError {
  constructor(message: string, details: FieldMappingErrorDetails = {}) {
    super(message, details);
    this.name = "ProjectionAtInfinityError";
  }
}

/**
 * A corner set names a `cornerOrder` this package does not interpret. W203
 * supports exactly the canonical `"tl, tr, br, bl"` producer order (see
 * `CANONICAL_CORNER_ORDER`); other documented orders are future extensibility.
 */
export class UnsupportedCornerOrderError extends FieldMappingError {
  constructor(message: string, details: FieldMappingErrorDetails = {}) {
    super(message, details);
    this.name = "UnsupportedCornerOrderError";
  }
}

/** Union of the typed field-mapping errors. */
export type FieldMappingErrorUnion =
  | InvalidCorrespondenceError
  | DegenerateCorrespondenceError
  | InvalidHomographyError
  | DegenerateHomographyError
  | ProjectionAtInfinityError
  | UnsupportedCornerOrderError;

/**
 * Type guard: `true` when `value` is one of the typed field-mapping errors
 * (a deliberate, classified refusal rather than an internal fault).
 */
export function isFieldMappingError(value: unknown): value is FieldMappingErrorUnion {
  return value instanceof FieldMappingError;
}
