import { describe, expect, test } from "bun:test";
import { FixtureFieldCalibrator, type FieldCornerSet } from "../src/calibrator";
import { createPitchProjector, type NormalizedBox } from "../src/project";
import { UnsupportedCornerOrderError } from "../src/errors";
import { DegenerateCorrespondenceError, type Point2D } from "../src/index";

/**
 * Projector tests. Reference camera: zoom 1, pan 0.5, jitter 0 — visible
 * window x in [26.25, 78.75], y in [17, 51], so the image -> pitch map is
 *
 *   X = 26.25 + u * 52.5      Y = 17 + v * 34
 *
 * All expected values are hand-derived from that closed form; projector
 * results pass through the DLT solve, hence toBeCloseTo (the deterministic
 * deep-equality checks use toEqual on identical inputs).
 */

function projector(pan = 0.5, zoom = 1) {
  const cornerSet = new FixtureFieldCalibrator({
    pan,
    zoom,
    jitter: 0,
  }).calibrate({
    frameId: "f-0-0",
    presentationMs: 0,
    width: 160,
    height: 90,
    bytes: new Uint8Array(160 * 90 * 3),
    decodeOrder: 0,
  });
  return createPitchProjector(cornerSet);
}

describe("PitchProjector — project", () => {
  test("center of the image maps to the visible rect's pitch center", () => {
    const p = projector().project({ x: 0.5, y: 0.5 });
    expect(p.x).toBeCloseTo(52.5, 10);
    expect(p.y).toBeCloseTo(34, 10);
    expect(p.inBounds).toBe(true);
  });

  test("zoom 2: center maps into the zoomed window's center", () => {
    const p = projector(0.5, 2).project({ x: 0.5, y: 0.5 });
    expect(p.x).toBeCloseTo(52.5, 10);
    expect(p.y).toBeCloseTo(34, 10);
    expect(p.inBounds).toBe(true);
  });

  test("out-of-play projections are flagged, NEVER clamped", () => {
    const proj = projector(0.5, 1);
    // Far-left image point (u = -1): X = 26.25 - 52.5 = -26.25 < 0.
    const farLeft = proj.project({ x: -1, y: 0.5 });
    expect(farLeft.inBounds).toBe(false);
    expect(farLeft.x).toBeCloseTo(-26.25, 10);
    expect(farLeft.y).toBeCloseTo(34, 10);
    // Far-right (u = 2): X = 131.25 > 105.
    const farRight = proj.project({ x: 2, y: 0.5 });
    expect(farRight.inBounds).toBe(false);
    expect(farRight.x).toBeCloseTo(131.25, 10);
    // Below the frame (v = -1): Y = 17 - 34 = -17 < 0.
    const below = proj.project({ x: 0.5, y: -1 });
    expect(below.inBounds).toBe(false);
    expect(below.y).toBeCloseTo(-17, 10);
  });

  test("inBounds is inclusive on the pitch boundary", () => {
    const proj = projector(0, 1); // window x in [0, 52.5], y in [17, 51]
    const onGoalLine = proj.project({ x: 0, y: 0.5 }); // X = 0 exactly
    expect(onGoalLine.x).toBeCloseTo(0, 10);
    expect(onGoalLine.inBounds).toBe(true);
    const onTouchline = proj.project({ x: 1, y: 0 }); // X = 52.5, Y = 17
    expect(onTouchline.inBounds).toBe(true);
  });

  test("metric consistency: half the image width maps to half the visible pitch width", () => {
    const proj = projector(0.5, 1);
    const left = proj.project({ x: 0.25, y: 0.5 });
    const right = proj.project({ x: 0.75, y: 0.5 });
    expect(right.x - left.x).toBeCloseTo(26.25, 10); // half of the 52.5 m window
    const fullLeft = proj.project({ x: 0, y: 0.5 });
    const fullRight = proj.project({ x: 1, y: 0.5 });
    expect(fullRight.x - fullLeft.x).toBeCloseTo(52.5, 10);
  });
});

describe("PitchProjector — projectBox", () => {
  test("box center and four corners are consistent with project()", () => {
    const proj = projector(0.5, 1);
    const box: NormalizedBox = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
    const result = proj.projectBox(box);
    // Center: image (0.5, 0.5) -> pitch (52.5, 34).
    expect(result.center.x).toBeCloseTo(52.5, 10);
    expect(result.center.y).toBeCloseTo(34, 10);
    // Corners in image order tl, tr, br, bl — constructed exactly as
    // projectBox constructs them (x + w etc.), so the bit-identity check
    // below compares identical float inputs (0.4 + 0.2 !== literal 0.6 in
    // IEEE-754 — the same arithmetic must be used on both sides).
    const expected: readonly Point2D[] = [
      { x: box.x, y: box.y },
      { x: box.x + box.w, y: box.y },
      { x: box.x + box.w, y: box.y + box.h },
      { x: box.x, y: box.y + box.h },
    ];
    expect(result.corners).toHaveLength(4);
    expected.forEach((corner, i) => {
      const projected = result.corners[i]!;
      // Bit-identical to project() on the same point (same code path) —
      // compared field-wise: project() adds the inBounds flag, projectBox
      // corners are plain PitchPoints per the seam contract.
      const direct = proj.project(corner);
      expect(projected.x).toBe(direct.x);
      expect(projected.y).toBe(direct.y);
      expect(projected.x).toBeCloseTo(26.25 + corner.x * 52.5, 10);
      expect(projected.y).toBeCloseTo(17 + corner.y * 34, 10);
    });
    const directCenter = proj.project({ x: 0.5, y: 0.5 });
    expect(result.center.x).toBe(directCenter.x);
    expect(result.center.y).toBe(directCenter.y);
    expect(result.inBounds).toBe(true);
  });

  test("box straddling the pitch boundary: inBounds false, coordinates unclamped", () => {
    const proj = projector(0.5, 1);
    // Hand-built box whose fields are each in [0, 1] (contract-legal) but
    // whose x + w reaches 2: the tr/br corners project past the touchline.
    const box: NormalizedBox = { x: 1, y: 0, w: 1, h: 1 };
    const result = proj.projectBox(box);
    expect(result.inBounds).toBe(false);
    // tl (1, 0) -> (78.75, 17); tr/br (2, ·) -> x = 131.25 (NOT clamped).
    expect(result.corners[0]!.x).toBe(proj.project({ x: 1, y: 0 }).x);
    expect(result.corners[0]!.y).toBe(proj.project({ x: 1, y: 0 }).y);
    expect(result.corners[1]!.x).toBeCloseTo(131.25, 10);
    expect(result.corners[2]!.x).toBeCloseTo(131.25, 10);
    expect(result.corners[3]!.x).toBe(proj.project({ x: 1, y: 1 }).x);
    expect(result.corners[3]!.y).toBe(proj.project({ x: 1, y: 1 }).y);
    // Center (1.5, 0.5) -> (105, 34): exactly ON the boundary, in bounds.
    expect(result.center.x).toBeCloseTo(105, 10);
    expect(result.center.y).toBeCloseTo(34, 10);
  });

  test("half-image-width box maps to half the visible pitch width (accept-criterion math)", () => {
    const proj = projector(0.5, 1);
    const result = proj.projectBox({ x: 0.25, y: 0.4, w: 0.5, h: 0.2 });
    expect(result.corners[0]!.x).toBeCloseTo(39.375, 10);
    expect(result.corners[1]!.x).toBeCloseTo(65.625, 10);
    expect(result.corners[1]!.x - result.corners[0]!.x).toBeCloseTo(26.25, 10);
    expect(result.inBounds).toBe(true);
  });
});

describe("PitchProjector — determinism and rejection", () => {
  test("pure: two projectors from equal corner sets deep-equal on a fixed grid", () => {
    const cornerSet: FieldCornerSet = new FixtureFieldCalibrator({
      pan: 0.5,
      zoom: 1,
      jitter: 0,
    }).calibrate({
      frameId: "f-0-5",
      presentationMs: 200,
      width: 160,
      height: 90,
      bytes: new Uint8Array(160 * 90 * 3),
      decodeOrder: 5,
    });
    const a = createPitchProjector(cornerSet);
    const b = createPitchProjector(cornerSet);
    const grid: Point2D[] = [];
    for (let i = 0; i <= 4; i += 1) {
      for (let j = 0; j <= 4; j += 1) {
        grid.push({ x: i / 4, y: j / 4 });
      }
    }
    for (const point of grid) {
      expect(a.project(point)).toEqual(b.project(point));
      expect(a.project(point)).toEqual(a.project(point));
    }
  });

  test("unknown cornerOrder -> UnsupportedCornerOrderError (W203 supports only the default)", () => {
    const valid = new FixtureFieldCalibrator({ pan: 0, zoom: 1, jitter: 0 }).calibrate({
      frameId: "f-0-0",
      presentationMs: 0,
      width: 160,
      height: 90,
      bytes: new Uint8Array(160 * 90 * 3),
      decodeOrder: 0,
    });
    for (const cornerOrder of [
      "top-left, top-right, bottom-right, bottom-left", // documented but not supported yet
      "",
      "tl,tr,br,bl", // different spacing
      "bl, br, tr, tl", // different order
    ]) {
      expect(() => createPitchProjector({ ...valid, cornerOrder })).toThrow(
        UnsupportedCornerOrderError,
      );
    }
    expect(() => createPitchProjector(valid)).not.toThrow();
  });

  test("degenerate (collinear) corner set fails loud at projector creation", () => {
    const collinear: FieldCornerSet = {
      corners: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0 },
        { x: 1, y: 0 },
        { x: 0.25, y: 0 },
      ],
      cornerOrder: "tl, tr, br, bl",
      confidence: 0.9,
    };
    expect(() => createPitchProjector(collinear)).toThrow(DegenerateCorrespondenceError);
  });
});
