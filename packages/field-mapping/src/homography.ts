/**
 * 3x3 homography math (W203) — pure, deterministic, dependency-free.
 *
 * A homography `H` maps image points to pitch points (projectively):
 *
 * ```text
 *   [X']   [h0 h1 h2] [x]
 *   [Y'] = [h3 h4 h5] [y]
 *   [W']   [h6 h7 h8] [1]      X = X'/W',  Y = Y'/W'
 * ```
 *
 * {@link Homography} is the canonical representation: a row-major `number[]`
 * of length 9 with `h[8]` normalized to 1. Producers in this package
 * (`solveHomography`, `invertHomography`) always return that form; consumers
 * (`applyHomography`, `invertHomography`) accept any length-9 finite matrix,
 * since the projection is scale-invariant (dividing all entries by a non-zero
 * constant leaves every projection unchanged).
 *
 * Everything here is exact floating-point arithmetic — no randomness, no
 * clock, no environment reads.
 */
import type { FieldMappingPayload, PitchPoint } from "@sporta/contracts";
import {
  DegenerateCorrespondenceError,
  DegenerateHomographyError,
  InvalidCorrespondenceError,
  InvalidHomographyError,
  ProjectionAtInfinityError,
} from "./errors";

/**
 * A 2D point in normalized image coordinates (the frame spans `[0, 1]²`;
 * points may legitimately sit outside it — off-frame detections and
 * out-of-play areas). Derived from the contracts `FieldMappingPayload`
 * corner shape so the two cannot drift.
 */
export type Point2D = FieldMappingPayload["pitchCorners"][number];

/** The canonical 3x3 homography: row-major, length 9, `h[8] === 1`. */
export type Homography = number[];

/** Exact number of point pairs the 8-point DLT requires. */
export const HOMOGRAPHY_PAIR_COUNT = 4;

/**
 * Rank-check tolerance for the DLT solver, RELATIVE to the largest absolute
 * entry of the 8x8 system. A pivot at or below `tolerance * scale` after
 * partial pivoting means the correspondence set is degenerate.
 */
const RANK_TOLERANCE = 1e-12;

/** Absolute tolerance for the near-zero checks (denominators, determinants). */
const ZERO_EPSILON = 1e-12;

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function assertFinitePoint(point: Point2D, plane: "image" | "pitch", index: number): void {
  if (
    typeof point !== "object" ||
    point === null ||
    typeof point.x !== "number" ||
    typeof point.y !== "number" ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    throw new InvalidCorrespondenceError(
      `solveHomography: ${plane} point ${index} must carry finite x/y numbers`,
      { plane, index, point },
    );
  }
}

/** Validates the length-9 finite-matrix shape shared by apply/invert. */
function assertValidMatrix(h: Homography, operation: string): void {
  if (!Array.isArray(h) || h.length !== 9 || !h.every((v) => Number.isFinite(v))) {
    throw new InvalidHomographyError(
      `${operation}: homography must be an array of 9 finite numbers (got length ` +
        `${Array.isArray(h) ? h.length : "non-array"})`,
      { length: Array.isArray(h) ? h.length : undefined },
    );
  }
}

// ---------------------------------------------------------------------------
// solveHomography — exact 8-point DLT for FOUR point pairs
// ---------------------------------------------------------------------------

/**
 * Builds one 8x8 DLT row pair for the correspondence `(x, y) -> (X, Y)`.
 *
 * CONSTRUCTION (documented once, honored exactly): with `h[8]` fixed to 1,
 * each correspondence contributes two linear equations in the eight unknowns
 * `h0..h7` (from `X * (h6 x + h7 y + 1) = h0 x + h1 y + h2` and the
 * `Y`-analogue):
 *
 * ```text
 *   [x  y  1  0  0  0  -X*x  -X*y] · [h0..h7]^T =  X
 *   [0  0  0  x  y  1  -Y*x  -Y*y] · [h0..h7]^T =  Y
 * ```
 *
 * Four correspondences give an 8x8 system with a unique solution whenever the
 * points are in general position (no three collinear on either plane).
 */
function buildDltRows(
  image: Point2D,
  pitch: PitchPoint,
): [{ row: number[]; rhs: number }, { row: number[]; rhs: number }] {
  const { x, y } = image;
  const { x: X, y: Y } = pitch;
  return [
    { row: [x, y, 1, 0, 0, 0, -X * x, -X * y], rhs: X },
    { row: [0, 0, 0, x, y, 1, -Y * x, -Y * y], rhs: Y },
  ];
}

/**
 * Gaussian elimination WITH PARTIAL PIVOTING on the 8x8 system
 * `A · h = b` (in-place on copies; the inputs are never mutated).
 *
 * Partial pivoting: for each column, the row with the largest absolute
 * diagonal-candidate is swapped to the diagonal before eliminating below it.
 * RANK CHECK: if the best available pivot is at or below
 * `RANK_TOLERANCE * max(|A|, 1)`, the system is singular — collinear or
 * coincident points (or a homography not expressible with `h[8] = 1`) — and a
 * {@link DegenerateCorrespondenceError} is thrown. Back substitution then
 * yields the exact solution vector.
 */
function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = a.length;
  let scale = 0;
  for (const row of a) {
    for (const entry of row) scale = Math.max(scale, Math.abs(entry));
  }
  const tolerance = RANK_TOLERANCE * Math.max(scale, 1);

  for (let col = 0; col < n; col += 1) {
    // Partial pivot: largest |entry| in this column, at or below the diagonal.
    let pivotRow = col;
    let pivotAbs = Math.abs(a[col]![col]!);
    for (let row = col + 1; row < n; row += 1) {
      const candidate = Math.abs(a[row]![col]!);
      if (candidate > pivotAbs) {
        pivotRow = row;
        pivotAbs = candidate;
      }
    }
    if (pivotAbs <= tolerance) {
      throw new DegenerateCorrespondenceError(
        `solveHomography: degenerate correspondence set — the 8x8 DLT system is ` +
          `rank-deficient at column ${col} (best pivot ${pivotAbs} <= tolerance ${tolerance}); ` +
          `typical causes are collinear/coincident points or a homography not expressible ` +
          `with h[8] = 1`,
        { column: col, pivot: pivotAbs, tolerance },
      );
    }
    if (pivotRow !== col) {
      const swapRow = a[col]!;
      a[col] = a[pivotRow]!;
      a[pivotRow] = swapRow;
      const swapRhs = b[col]!;
      b[col] = b[pivotRow]!;
      b[pivotRow] = swapRhs;
    }
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row]![col]! / a[col]![col]!;
      if (factor === 0) continue;
      for (let k = col; k < n; k += 1) {
        a[row]![k] = a[row]![k]! - factor * a[col]![k]!;
      }
      b[row] = b[row]! - factor * b[col]!;
    }
  }

  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = b[row]!;
    for (let k = row + 1; k < n; k += 1) {
      sum = sum - a[row]![k]! * solution[k]!;
    }
    solution[row] = sum / a[row]![row]!;
  }
  return solution;
}

/**
 * Solves the homography that maps `imagePoints` to `pitchPoints`.
 *
 * Exactly FOUR point pairs are required (the 8-point DLT with `h[8] = 1`;
 * {@link HOMOGRAPHY_PAIR_COUNT}); any other count, non-finite coordinates,
 * or a degenerate (rank-deficient) geometry throws a typed error. The result
 * is the canonical length-9 row-major matrix with `h[8] === 1`.
 */
export function solveHomography(imagePoints: Point2D[], pitchPoints: PitchPoint[]): Homography {
  if (
    !Array.isArray(imagePoints) ||
    !Array.isArray(pitchPoints) ||
    imagePoints.length !== HOMOGRAPHY_PAIR_COUNT ||
    pitchPoints.length !== HOMOGRAPHY_PAIR_COUNT
  ) {
    throw new InvalidCorrespondenceError(
      `solveHomography: exactly ${HOMOGRAPHY_PAIR_COUNT} point pairs are required ` +
        `(got ${Array.isArray(imagePoints) ? imagePoints.length : "non-array"} image and ` +
        `${Array.isArray(pitchPoints) ? pitchPoints.length : "non-array"} pitch points)`,
      {
        imageCount: Array.isArray(imagePoints) ? imagePoints.length : undefined,
        pitchCount: Array.isArray(pitchPoints) ? pitchPoints.length : undefined,
      },
    );
  }
  for (let i = 0; i < HOMOGRAPHY_PAIR_COUNT; i += 1) {
    assertFinitePoint(imagePoints[i]!, "image", i);
    assertFinitePoint(pitchPoints[i]!, "pitch", i);
  }

  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < HOMOGRAPHY_PAIR_COUNT; i += 1) {
    const [xRow, yRow] = buildDltRows(imagePoints[i]!, pitchPoints[i]!);
    a.push(xRow.row, yRow.row);
    b.push(xRow.rhs, yRow.rhs);
  }

  const solution = solveLinearSystem(a, b);
  // Canonical form: h[8] is fixed to 1 by the construction (documented in
  // buildDltRows) — a true homography requiring h[8] = 0 shows up as a
  // rank-deficient system above, never as a silently wrong solution here.
  return [...solution, 1];
}

// ---------------------------------------------------------------------------
// applyHomography — project one image point
// ---------------------------------------------------------------------------

/**
 * Projects `p` through `h`:
 *
 * ```text
 *   x' = (h0*x + h1*y + h2) / w
 *   y' = (h3*x + h4*y + h5) / w
 *   w  =  h6*x + h7*y + h8
 * ```
 *
 * A denominator `w` at or near 0 (the point maps to infinity) throws a
 * {@link ProjectionAtInfinityError}. Non-finite points or matrices throw
 * {@link InvalidHomographyError}. The result is NEVER clamped.
 */
export function applyHomography(h: Homography, p: Point2D): { x: number; y: number } {
  assertValidMatrix(h, "applyHomography");
  if (
    typeof p !== "object" ||
    p === null ||
    typeof p.x !== "number" ||
    typeof p.y !== "number" ||
    !Number.isFinite(p.x) ||
    !Number.isFinite(p.y)
  ) {
    throw new InvalidHomographyError(`applyHomography: point must carry finite x/y numbers`, {
      point: p,
    });
  }
  const numeratorX = h[0]! * p.x + h[1]! * p.y + h[2]!;
  const numeratorY = h[3]! * p.x + h[4]! * p.y + h[5]!;
  const denominator = h[6]! * p.x + h[7]! * p.y + h[8]!;
  if (Math.abs(denominator) <= ZERO_EPSILON) {
    throw new ProjectionAtInfinityError(
      `applyHomography: denominator ${denominator} is ~0 for point (${p.x}, ${p.y}) ` +
        `— the point maps to a point at infinity and has no finite pitch coordinates`,
      { point: { x: p.x, y: p.y }, denominator },
    );
  }
  return { x: numeratorX / denominator, y: numeratorY / denominator };
}

// ---------------------------------------------------------------------------
// invertHomography — adjugate/cofactor method
// ---------------------------------------------------------------------------

/**
 * Inverts `h` via the adjugate (transposed cofactor) method.
 *
 * For `M = [m0 m1 m2; m3 m4 m5; m6 m7 m8]`:
 *
 * ```text
 *   det(M) = m0(m4 m8 - m5 m7) - m1(m3 m8 - m5 m6) + m2(m3 m7 - m4 m6)
 *
 *   adj(M) = [ m4 m8 - m5 m7    m2 m7 - m1 m8    m1 m5 - m2 m4 ]
 *            [ m5 m6 - m3 m8    m0 m8 - m2 m6    m2 m3 - m0 m5 ]
 *            [ m3 m7 - m4 m6    m1 m6 - m0 m7    m0 m4 - m1 m3 ]
 *
 *   M^-1 = adj(M) / det(M)
 * ```
 *
 * The result is normalized to the canonical `h[8] = 1` form by dividing
 * `adj(M)` by its `[8]` entry (`m0 m4 - m1 m3`) — the `h[8]` the inverse
 * would have after `det` scaling. That entry ~ 0 means the inverse is not
 * expressible in canonical form (its true `h[8]` is 0), which throws the
 * DEGENERATE `h[8] ~ 0` rejection required by the W203 contract; a singular
 * input (`det ~ 0`) throws as well. Round-trip guarantee:
 * `apply(invert(h), apply(h, p)) ≈ p` for every point where both projections
 * are finite.
 */
export function invertHomography(h: Homography): Homography {
  assertValidMatrix(h, "invertHomography");
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = h as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  const det = m0 * (m4 * m8 - m5 * m7) - m1 * (m3 * m8 - m5 * m6) + m2 * (m3 * m7 - m4 * m6);
  if (Math.abs(det) <= ZERO_EPSILON * Math.max(...h.map(Math.abs), 1)) {
    throw new DegenerateHomographyError(
      `invertHomography: matrix is singular (determinant ${det} ~ 0) — no inverse exists`,
      { determinant: det },
    );
  }

  const adjugate: Homography = [
    m4 * m8 - m5 * m7,
    m2 * m7 - m1 * m8,
    m1 * m5 - m2 * m4,
    m5 * m6 - m3 * m8,
    m0 * m8 - m2 * m6,
    m2 * m3 - m0 * m5,
    m3 * m7 - m4 * m6,
    m1 * m6 - m0 * m7,
    m0 * m4 - m1 * m3,
  ];
  const inverseH8 = adjugate[8]!;
  if (Math.abs(inverseH8) <= ZERO_EPSILON) {
    throw new DegenerateHomographyError(
      `invertHomography: the inverse's h[8] entry is ~0 (${inverseH8}) — it cannot be ` +
        `normalized to the canonical h[8] = 1 form`,
      { inverseH8 },
    );
  }
  return adjugate.map((entry) => entry / inverseH8);
}
