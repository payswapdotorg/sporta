import { describe, expect, test } from "bun:test";
import type { PitchPoint } from "@sporta/contracts";
import {
  applyHomography,
  invertHomography,
  solveHomography,
  type Point2D,
} from "../src/homography";
import {
  DegenerateCorrespondenceError,
  DegenerateHomographyError,
  InvalidCorrespondenceError,
  InvalidHomographyError,
  ProjectionAtInfinityError,
  isFieldMappingError,
} from "../src/errors";

/**
 * Pure homography-math tests. All point sets are FIXED constants — no
 * `Math.random`, no `Date.now` (docs/testing/HARNESS.md); every expected
 * value is hand-derived from the DLT construction documented in
 * `src/homography.ts`.
 */

const UNIT_IMAGE: readonly Point2D[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const UNIT_PITCH: readonly PitchPoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const FULL_PITCH_CORNERS: readonly PitchPoint[] = [
  { x: 0, y: 0 },
  { x: 105, y: 0 },
  { x: 105, y: 68 },
  { x: 0, y: 68 },
];

describe("solveHomography — construction", () => {
  test("identity: unit image corners = unit pitch corners -> identity transform", () => {
    const h = solveHomography([...UNIT_IMAGE], [...UNIT_PITCH]);
    expect(h).toHaveLength(9);
    // Canonical form: h[8] === 1 exactly (fixed by the DLT construction).
    expect(h[8]).toBe(1);
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let i = 0; i < 9; i += 1) {
      expect(h[i]).toBeCloseTo(identity[i]!, 12);
    }
    // A non-corner point maps to itself.
    const q = applyHomography(h, { x: 0.25, y: 0.75 });
    expect(q.x).toBeCloseTo(0.25, 12);
    expect(q.y).toBeCloseTo(0.75, 12);
  });

  test("known affine case: uniform 2x scale", () => {
    const scaledPitch: PitchPoint[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const h = solveHomography([...UNIT_IMAGE], scaledPitch);
    const expected = [2, 0, 0, 0, 2, 0, 0, 0, 1];
    for (let i = 0; i < 9; i += 1) {
      expect(h[i]).toBeCloseTo(expected[i]!, 12);
    }
    const q = applyHomography(h, { x: 0.5, y: 0.5 });
    expect(q.x).toBeCloseTo(1, 12);
    expect(q.y).toBeCloseTo(1, 12);
  });

  test("known affine case: anisotropic full-pitch map (unit square -> 105 x 68)", () => {
    const h = solveHomography([...UNIT_IMAGE], [...FULL_PITCH_CORNERS]);
    const expected = [105, 0, 0, 0, 68, 0, 0, 0, 1];
    for (let i = 0; i < 9; i += 1) {
      expect(h[i]).toBeCloseTo(expected[i]!, 10);
    }
    // The pitch center.
    const q = applyHomography(h, { x: 0.5, y: 0.5 });
    expect(q.x).toBeCloseTo(52.5, 10);
    expect(q.y).toBeCloseTo(34, 10);
  });

  test("projective case: unit square -> trapezoid yields h6/h7 != 0", () => {
    const trapezoid: PitchPoint[] = [
      { x: 0, y: 0 },
      { x: 105, y: 0 },
      { x: 95, y: 68 },
      { x: 0, y: 60 },
    ];
    const h = solveHomography([...UNIT_IMAGE], trapezoid);
    expect(Math.abs(h[6]!)).toBeGreaterThan(1e-6);
    expect(Math.abs(h[7]!)).toBeGreaterThan(1e-6);
    // Still exact on the correspondences (asserted generically below) and
    // NOT affine: the image line y=1 maps to a non-constant x offset.
    const left = applyHomography(h, { x: 0, y: 1 });
    const right = applyHomography(h, { x: 1, y: 1 });
    expect(left.x).toBeCloseTo(0, 10);
    expect(left.y).toBeCloseTo(60, 10);
    expect(right.x).toBeCloseTo(95, 10);
    expect(right.y).toBeCloseTo(68, 10);
  });

  test("projection of the corner points themselves returns the exact pitch corners", () => {
    // Three geometries: identity, affine scale, projective trapezoid.
    const trapezoid: PitchPoint[] = [
      { x: 0, y: 0 },
      { x: 105, y: 0 },
      { x: 95, y: 68 },
      { x: 0, y: 60 },
    ];
    const cases: Array<{ name: string; pitch: PitchPoint[] }> = [
      { name: "identity", pitch: [...UNIT_PITCH] },
      { name: "affine full pitch", pitch: [...FULL_PITCH_CORNERS] },
      { name: "projective trapezoid", pitch: trapezoid },
    ];
    for (const { name, pitch } of cases) {
      const h = solveHomography([...UNIT_IMAGE], pitch);
      for (let i = 0; i < 4; i += 1) {
        const q = applyHomography(h, UNIT_IMAGE[i]!);
        expect(q.x).toBeCloseTo(pitch[i]!.x, 10);
        expect(q.y).toBeCloseTo(pitch[i]!.y, 10);
      }
      // The corners project back exactly for every named geometry (the DLT
      // is exact on its own correspondences).
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

describe("solveHomography — typed rejections", () => {
  test("wrong pair count -> InvalidCorrespondenceError", () => {
    const three = UNIT_IMAGE.slice(0, 3);
    const five = [...UNIT_IMAGE, { x: 0.5, y: 0.5 }];
    expect(() => solveHomography([...three], [...UNIT_PITCH])).toThrow(InvalidCorrespondenceError);
    expect(() => solveHomography([...five], [...UNIT_PITCH])).toThrow(InvalidCorrespondenceError);
    // Mismatched counts (4 image vs 3 pitch).
    expect(() => solveHomography([...UNIT_IMAGE], [...three])).toThrow(InvalidCorrespondenceError);
    expect(() => solveHomography([...three], [...UNIT_IMAGE])).toThrow(InvalidCorrespondenceError);
  });

  test("non-finite coordinates -> InvalidCorrespondenceError", () => {
    const withNaN = [...UNIT_IMAGE];
    withNaN[2] = { x: Number.NaN, y: 1 };
    expect(() => solveHomography(withNaN, [...UNIT_PITCH])).toThrow(InvalidCorrespondenceError);
    const withInfinity = [...UNIT_PITCH];
    withInfinity[1] = { x: Number.POSITIVE_INFINITY, y: 0 };
    expect(() => solveHomography([...UNIT_IMAGE], withInfinity)).toThrow(
      InvalidCorrespondenceError,
    );
  });

  test("all four image points collinear -> DegenerateCorrespondenceError", () => {
    const collinear: Point2D[] = [
      { x: 0, y: 0 },
      { x: 0.25, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.75, y: 0 },
    ];
    expect(() => solveHomography(collinear, [...UNIT_PITCH])).toThrow(
      DegenerateCorrespondenceError,
    );
  });

  test("three image points collinear -> DegenerateCorrespondenceError", () => {
    const threeCollinear: Point2D[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: 1 },
    ];
    expect(() => solveHomography(threeCollinear, [...UNIT_PITCH])).toThrow(
      DegenerateCorrespondenceError,
    );
  });

  test("all four pitch points collinear -> DegenerateCorrespondenceError", () => {
    const collinearPitch: PitchPoint[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
      { x: 90, y: 0 },
    ];
    expect(() => solveHomography([...UNIT_IMAGE], collinearPitch)).toThrow(
      DegenerateCorrespondenceError,
    );
  });

  test("duplicate image points -> DegenerateCorrespondenceError", () => {
    const duplicated: Point2D[] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(() => solveHomography(duplicated, [...UNIT_PITCH])).toThrow(
      DegenerateCorrespondenceError,
    );
  });
});

describe("applyHomography — typed rejections", () => {
  const h = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  test("zero denominator -> ProjectionAtInfinityError", () => {
    // w = x + 1 for this matrix: zero exactly at x = -1.
    const projective = [1, 0, 0, 0, 1, 0, 1, 0, 1];
    expect(() => applyHomography(projective, { x: -1, y: 0.5 })).toThrow(ProjectionAtInfinityError);
    // Canonical-form matrix with h[8] = 0: w = 0 at the origin.
    const throughOrigin = [1, 0, 0, 0, 1, 0, 0, 0, 0];
    expect(() => applyHomography(throughOrigin, { x: 0, y: 0 })).toThrow(ProjectionAtInfinityError);
  });

  test("malformed matrix -> InvalidHomographyError", () => {
    expect(() => applyHomography([1, 0, 0, 0, 1, 0, 0, 0], { x: 0, y: 0 })).toThrow(
      InvalidHomographyError,
    );
    expect(() => applyHomography([1, 0, 0, 0, 1, 0, 0, Number.NaN, 1], { x: 0, y: 0 })).toThrow(
      InvalidHomographyError,
    );
  });

  test("non-finite point -> InvalidHomographyError", () => {
    expect(() => applyHomography(h, { x: Number.NaN, y: 0 })).toThrow(InvalidHomographyError);
    expect(() => applyHomography(h, { x: Number.POSITIVE_INFINITY, y: 0 })).toThrow(
      InvalidHomographyError,
    );
  });
});

describe("invertHomography", () => {
  const FIXED_POINTS: readonly Point2D[] = [
    { x: 0.1, y: 0.2 },
    { x: 0.7, y: 0.3 },
    { x: 0.4, y: 0.9 },
    { x: 0.25, y: 0.55 },
  ];

  function projectiveHomography(): number[] {
    // Unit square -> trapezoid (non-affine, so inversion genuinely exercises
    // the projective path).
    const trapezoid: PitchPoint[] = [
      { x: 0, y: 0 },
      { x: 105, y: 0 },
      { x: 95, y: 68 },
      { x: 0, y: 60 },
    ];
    return solveHomography([...UNIT_IMAGE], trapezoid);
  }

  test("inverse of a uniform scale is the reciprocal scale", () => {
    const scaled: PitchPoint[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const h = solveHomography([...UNIT_IMAGE], scaled);
    const inverse = invertHomography(h);
    expect(inverse).toHaveLength(9);
    expect(inverse[8]).toBe(1);
    expect(inverse[0]).toBeCloseTo(0.5, 12);
    expect(inverse[4]).toBeCloseTo(0.5, 12);
    expect(inverse[1]).toBeCloseTo(0, 12);
    expect(inverse[3]).toBeCloseTo(0, 12);
  });

  test("round-trip: apply(invert(h), apply(h, p)) ~ p on a fixed point set", () => {
    const h = projectiveHomography();
    const inverse = invertHomography(h);
    for (const p of FIXED_POINTS) {
      const q = applyHomography(h, p);
      const back = applyHomography(inverse, q);
      expect(back.x).toBeCloseTo(p.x, 10);
      expect(back.y).toBeCloseTo(p.y, 10);
    }
  });

  test("round-trip holds for the affine full-pitch map too", () => {
    const h = solveHomography([...UNIT_IMAGE], [...FULL_PITCH_CORNERS]);
    const inverse = invertHomography(h);
    for (const p of FIXED_POINTS) {
      const back = applyHomography(inverse, applyHomography(h, p));
      expect(back.x).toBeCloseTo(p.x, 12);
      expect(back.y).toBeCloseTo(p.y, 12);
    }
  });

  test("double inversion returns the original canonical homography", () => {
    const h = projectiveHomography();
    const roundTrip = invertHomography(invertHomography(h));
    for (let i = 0; i < 9; i += 1) {
      expect(roundTrip[i]).toBeCloseTo(h[i]!, 10);
    }
  });

  test("h[8] ~ 0 rejection: invertible matrix whose inverse has h[8] = 0", () => {
    // M = [1 1 1; 1 1 0; 0 1 1]: det = 1 (invertible), but the adjugate's
    // [8] entry (top-left 2x2 minor) = 1*1 - 1*1 = 0, so the TRUE inverse has
    // h[8] = 0 and cannot be normalized to the canonical h[8] = 1 form.
    const m = [1, 1, 1, 1, 1, 0, 0, 1, 1];
    expect(() => invertHomography(m)).toThrow(DegenerateHomographyError);
    try {
      invertHomography(m);
      expect.unreachable();
    } catch (error) {
      expect(isFieldMappingError(error)).toBe(true);
      expect((error as DegenerateHomographyError).name).toBe("DegenerateHomographyError");
      expect((error as DegenerateHomographyError).details).toEqual({ inverseH8: 0 });
    }
  });

  test("singular matrix -> DegenerateHomographyError", () => {
    // Rows 1 and 2 identical -> det = 0.
    const singular = [1, 1, 1, 1, 1, 1, 0, 0, 1];
    expect(() => invertHomography(singular)).toThrow(DegenerateHomographyError);
  });

  test("malformed matrix -> InvalidHomographyError", () => {
    expect(() => invertHomography([1, 0, 0, 0, 1, 0, 0, 0])).toThrow(InvalidHomographyError);
    expect(() => invertHomography([1, 0, 0, 0, 1, 0, 0, 0, Number.NaN])).toThrow(
      InvalidHomographyError,
    );
  });
});

describe("determinism", () => {
  test("solve/apply/invert are pure: two runs deep-equal", () => {
    const trapezoid: PitchPoint[] = [
      { x: 0, y: 0 },
      { x: 105, y: 0 },
      { x: 95, y: 68 },
      { x: 0, y: 60 },
    ];
    const first = solveHomography([...UNIT_IMAGE], trapezoid);
    const second = solveHomography(
      [...UNIT_IMAGE],
      [{ ...trapezoid[0]! }, { ...trapezoid[1]! }, { ...trapezoid[2]! }, { ...trapezoid[3]! }],
    );
    expect(first).toEqual(second);
    expect(invertHomography(first)).toEqual(invertHomography(second));
    expect(applyHomography(first, { x: 0.3, y: 0.6 })).toEqual(
      applyHomography(second, { x: 0.3, y: 0.6 }),
    );
  });
});
