import { describe, expect, test } from "bun:test";
import {
  CANONICAL_CORNER_ORDER,
  FIXTURE_CALIBRATOR_CONFIDENCE,
  FixtureFieldCalibrator,
  type CalibratorFrameInput,
} from "../src/calibrator";
import { createPitchProjector } from "../src/project";

/**
 * Fixture-calibrator tests. All expectations are hand-derived from the
 * synthetic camera model documented on `FixtureFieldCalibrator`:
 *
 * ```text
 *   visLength = 52.5 / zoom    visWidth = 34 / zoom
 *   x0 = pan * (105 - visLength)    y0 = (68 - visWidth) / 2
 *   corners[i] = ((Xi - x0) / visLength, (Yi - y0) / visWidth) + jitter
 * ```
 *
 * Every value below is dyadic-rational arithmetic, so the model outputs are
 * EXACT floats (asserted with toBe); projector results pass through the DLT
 * solve and are asserted with toBeCloseTo.
 */

const W = 160;
const H = 90;

function makeFrame(decodeOrder: number): CalibratorFrameInput {
  return {
    frameId: `f-0-${decodeOrder}`,
    presentationMs: decodeOrder * 40,
    width: W,
    height: H,
    // rgb24 volume (validated upstream by decoding); the fixture ignores
    // pixel content by design.
    bytes: new Uint8Array(W * H * 3),
    decodeOrder,
  };
}

function calibrated(spec: { pan: number; zoom: number; jitter?: number }, decodeOrder = 0) {
  return new FixtureFieldCalibrator({
    pan: spec.pan,
    zoom: spec.zoom,
    jitter: spec.jitter ?? 0,
  }).calibrate(makeFrame(decodeOrder));
}

describe("FixtureFieldCalibrator — synthetic camera geometry", () => {
  test("zoom 1, pan 0.5: canonical corners at exact half-pitch window positions", () => {
    // Window: x in [26.25, 78.75], y in [17, 51].
    const { corners, cornerOrder, confidence } = calibrated({ pan: 0.5, zoom: 1 });
    expect(corners).toHaveLength(4);
    // (X - 26.25)/52.5 and (Y - 17)/34 for the four canonical corners.
    expect(corners[0]).toEqual({ x: -0.5, y: -0.5 });
    expect(corners[1]).toEqual({ x: 1.5, y: -0.5 });
    expect(corners[2]).toEqual({ x: 1.5, y: 1.5 });
    expect(corners[3]).toEqual({ x: -0.5, y: 1.5 });
    expect(cornerOrder).toBe(CANONICAL_CORNER_ORDER);
    expect(confidence).toBe(0.9);
    expect(confidence).toBe(FIXTURE_CALIBRATOR_CONFIDENCE);
  });

  test("zoom 2: window shrinks to a quarter of the touchline per axis", () => {
    // Window: x in [39.375, 65.625], y in [25.5, 42.5].
    const { corners } = calibrated({ pan: 0.5, zoom: 2 });
    expect(corners[0]).toEqual({ x: -1.5, y: -1.5 });
    expect(corners[1]).toEqual({ x: 2.5, y: -1.5 });
    expect(corners[2]).toEqual({ x: 2.5, y: 2.5 });
    expect(corners[3]).toEqual({ x: -1.5, y: 2.5 });
  });

  test("pan 0 vs pan 1 slide the window along the touchline (both recoverable, in pitch)", () => {
    const pan0 = calibrated({ pan: 0, zoom: 1 });
    const pan1 = calibrated({ pan: 1, zoom: 1 });
    // pan 0: x0 = 0 -> corners (0, -0.5), (2, -0.5), (2, 1.5), (0, 1.5).
    expect(pan0.corners[0]).toEqual({ x: 0, y: -0.5 });
    expect(pan0.corners[1]).toEqual({ x: 2, y: -0.5 });
    expect(pan0.corners[2]).toEqual({ x: 2, y: 1.5 });
    expect(pan0.corners[3]).toEqual({ x: 0, y: 1.5 });
    // pan 1: x0 = 52.5 -> corners (-1, -0.5), (1, -0.5), (1, 1.5), (-1, 1.5).
    expect(pan1.corners[0]).toEqual({ x: -1, y: -0.5 });
    expect(pan1.corners[1]).toEqual({ x: 1, y: -0.5 });
    expect(pan1.corners[2]).toEqual({ x: 1, y: 1.5 });
    expect(pan1.corners[3]).toEqual({ x: -1, y: 1.5 });

    // Projector-recovered visible rectangles: different pitch corners, all
    // in bounds (the accept-relevant property of the pan slide).
    const imageCorners = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const recovered0 = createPitchProjector(pan0);
    const recovered1 = createPitchProjector(pan1);
    const projected0 = imageCorners.map((c) => recovered0.project(c));
    const projected1 = imageCorners.map((c) => recovered1.project(c));
    for (const p of projected0) {
      expect(p.inBounds).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(52.5 + 1e-9);
    }
    for (const p of projected1) {
      expect(p.inBounds).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(52.5 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(105);
    }
    // The windows are genuinely different (flush left vs flush right).
    expect(projected0[0]!.x).toBeCloseTo(0, 9);
    expect(projected1[0]!.x).toBeCloseTo(52.5, 9);
  });

  test("zoom 1: projector-recovered image corners span exactly 52.5 m (half pitch)", () => {
    const projector = createPitchProjector(calibrated({ pan: 0.5, zoom: 1 }));
    const tl = projector.project({ x: 0, y: 0 });
    const tr = projector.project({ x: 1, y: 0 });
    const br = projector.project({ x: 1, y: 1 });
    const bl = projector.project({ x: 0, y: 1 });
    expect(tl.x).toBeCloseTo(26.25, 10);
    expect(tl.y).toBeCloseTo(17, 10);
    expect(tr.x).toBeCloseTo(78.75, 10);
    expect(tr.y).toBeCloseTo(17, 10);
    expect(br.x).toBeCloseTo(78.75, 10);
    expect(br.y).toBeCloseTo(51, 10);
    expect(bl.x).toBeCloseTo(26.25, 10);
    expect(bl.y).toBeCloseTo(51, 10);
    // "Span 52.5 m": x-extent of the recovered visible rectangle.
    expect(tr.x - tl.x).toBeCloseTo(52.5, 10);
    expect(br.x - bl.x).toBeCloseTo(52.5, 10);
    // Half the width axis as well (34 m of the 68 m goal-line axis).
    expect(bl.y - tl.y).toBeCloseTo(34, 10);
  });

  test("zoom 2: projector-recovered image corners span a quarter (26.25 m)", () => {
    const projector = createPitchProjector(calibrated({ pan: 0.5, zoom: 2 }));
    const tl = projector.project({ x: 0, y: 0 });
    const tr = projector.project({ x: 1, y: 0 });
    expect(tl.x).toBeCloseTo(39.375, 10);
    expect(tl.y).toBeCloseTo(25.5, 10);
    expect(tr.x).toBeCloseTo(65.625, 10);
    expect(tr.y).toBeCloseTo(25.5, 10);
    expect(tr.x - tl.x).toBeCloseTo(26.25, 10);
  });
});

describe("FixtureFieldCalibrator — jitter", () => {
  test("jitter 0 -> exact model corners, independent of decodeOrder", () => {
    const a = calibrated({ pan: 0.25, zoom: 1 }, 0);
    const b = calibrated({ pan: 0.25, zoom: 1 }, 57);
    expect(a).toEqual(b);
    expect(a.corners[0]).toEqual({ x: -0.25, y: -0.5 });
  });

  test("jitter formula: ((decodeOrder*7 + cornerIndex*13) % 100)/100 * jitter on both axes", () => {
    // pan 0.5, zoom 1 -> base corners (-0.5,-0.5),(1.5,-0.5),(1.5,1.5),(-0.5,1.5).
    // decodeOrder 3, jitter 0.02:
    //   corner 0: (21 + 0)  % 100 = 21 -> delta = 0.21 * 0.02 = 0.0042
    //   corner 1: (21 + 13) % 100 = 34 -> delta = 0.34 * 0.02 = 0.0068
    //   corner 2: (21 + 26) % 100 = 47 -> delta = 0.47 * 0.02 = 0.0094
    //   corner 3: (21 + 39) % 100 = 60 -> delta = 0.60 * 0.02 = 0.012
    const { corners } = calibrated({ pan: 0.5, zoom: 1, jitter: 0.02 }, 3);
    const deltas = [21, 34, 47, 60].map((m) => (m / 100) * 0.02);
    const base = [
      { x: -0.5, y: -0.5 },
      { x: 1.5, y: -0.5 },
      { x: 1.5, y: 1.5 },
      { x: -0.5, y: 1.5 },
    ];
    for (let i = 0; i < 4; i += 1) {
      expect(corners[i]!.x).toBeCloseTo(base[i]!.x + deltas[i]!, 12);
      expect(corners[i]!.y).toBeCloseTo(base[i]!.y + deltas[i]!, 12);
    }
  });

  test("jitter determinism: same decodeOrder -> same corners; different -> different", () => {
    const calibrator = new FixtureFieldCalibrator({ pan: 0.5, zoom: 1, jitter: 0.02 });
    const frame3 = makeFrame(3);
    const frame4 = makeFrame(4);
    // Same decodeOrder, fresh calls and fresh instances: identical.
    expect(calibrator.calibrate(frame3)).toEqual(calibrator.calibrate(frame3));
    const twin = new FixtureFieldCalibrator({ pan: 0.5, zoom: 1, jitter: 0.02 });
    expect(calibrator.calibrate(frame3)).toEqual(twin.calibrate(frame3));
    // decodeOrder 4 shifts every corner's mod-100 phase by +7 -> corner 0
    // delta = 0.28*0.02 != 0.21*0.02 (and the set as a whole differs).
    const at3 = calibrator.calibrate(frame3);
    const at4 = calibrator.calibrate(frame4);
    expect(at4.corners[0]!.x).toBeCloseTo(-0.5 + 0.28 * 0.02, 12);
    expect(at4).not.toEqual(at3);
  });
});

describe("FixtureFieldCalibrator — contract hygiene", () => {
  test("ignores pixel bytes, geometry, frameId, and presentationMs (documented)", () => {
    const calibrator = new FixtureFieldCalibrator({ pan: 0.5, zoom: 1, jitter: 0 });
    const frame = makeFrame(7);
    const otherFrame: CalibratorFrameInput = {
      frameId: "f-1-999",
      presentationMs: 123_456,
      width: 640,
      height: 360,
      bytes: new Uint8Array(640 * 360 * 3).fill(255),
      decodeOrder: 7, // the ONLY input the fixture consumes (via jitter)
    };
    expect(calibrator.calibrate(frame)).toEqual(calibrator.calibrate(otherFrame));
  });

  test("calibratorId defaults and is overridable (stamped on observations later)", () => {
    expect(new FixtureFieldCalibrator({ pan: 0, zoom: 1, jitter: 0 }).calibratorId).toBe(
      "fixture-field-calibrator",
    );
    expect(
      new FixtureFieldCalibrator({ pan: 0, zoom: 1, jitter: 0 }, "fixture-cam-b").calibratorId,
    ).toBe("fixture-cam-b");
  });

  test("spec validation fails loud at construction (RangeError, repo convention)", () => {
    expect(() => new FixtureFieldCalibrator({ pan: -0.01, zoom: 1, jitter: 0 })).toThrow(
      RangeError,
    );
    expect(() => new FixtureFieldCalibrator({ pan: 1.01, zoom: 1, jitter: 0 })).toThrow(RangeError);
    expect(() => new FixtureFieldCalibrator({ pan: 0.5, zoom: 0.99, jitter: 0 })).toThrow(
      RangeError,
    );
    expect(() => new FixtureFieldCalibrator({ pan: 0.5, zoom: 1, jitter: -0.001 })).toThrow(
      RangeError,
    );
    expect(() => new FixtureFieldCalibrator({ pan: Number.NaN, zoom: 1, jitter: 0 })).toThrow(
      RangeError,
    );
    expect(() => new FixtureFieldCalibrator({ pan: 0.5, zoom: 1, jitter: 0 }, "")).toThrow(
      RangeError,
    );
  });
});
