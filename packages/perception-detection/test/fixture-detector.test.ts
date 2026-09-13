import { describe, expect, test } from "bun:test";
import type { DetectorFrameInput } from "../src/detector";
import { FixtureDetectorAdapter } from "../src/fixture-detector";
import type { FixtureDetectorSpec } from "../src/fixture-detector";

const FRAME_W = 4;
const FRAME_H = 4;

/** A minimal valid frame input; pixel bytes are irrelevant to the fixture. */
function makeFrame(
  decodeOrder: number,
  overrides: Partial<DetectorFrameInput> = {},
): DetectorFrameInput {
  return {
    frameId: `f-0-${decodeOrder}`,
    presentationMs: decodeOrder * 40,
    width: FRAME_W,
    height: FRAME_H,
    bytes: new Uint8Array(FRAME_W * FRAME_H * 3),
    decodeOrder,
    streamIndex: 0,
    ...overrides,
  };
}

const linearSpec: FixtureDetectorSpec = {
  detectorId: "fixture-det-linear",
  frames: 5,
  labels: [
    {
      label: "player",
      confidence: 0.9,
      motion: { kind: "linear", from: { x: 0.25, y: 0.25 }, to: { x: 0.75, y: 0.5 } },
      size: { w: 0.25, h: 0.25 },
    },
  ],
};

describe("FixtureDetectorAdapter — linear motion", () => {
  test("t = 0 (decodeOrder 0) -> center at `from`", () => {
    const detector = new FixtureDetectorAdapter(linearSpec);
    const [detection] = detector.detect(makeFrame(0));
    // center (0.25, 0.25), size 0.25 -> box (0.125, 0.125, 0.25, 0.25).
    expect(detection?.box).toEqual({ x: 0.125, y: 0.125, w: 0.25, h: 0.25 });
    expect(detection?.label).toBe("player");
    expect(detection?.confidence).toBe(0.9);
  });

  test("t = 1 (decodeOrder frames - 1) -> center at `to`", () => {
    const detector = new FixtureDetectorAdapter(linearSpec);
    const [detection] = detector.detect(makeFrame(4));
    // center (0.75, 0.5) -> box (0.625, 0.375, 0.25, 0.25).
    expect(detection?.box).toEqual({ x: 0.625, y: 0.375, w: 0.25, h: 0.25 });
  });

  test("midpoint (decodeOrder 2 of 5) -> interpolated center", () => {
    const detector = new FixtureDetectorAdapter(linearSpec);
    const [detection] = detector.detect(makeFrame(2));
    // t = 2 / 4 = 0.5 -> center (0.5, 0.375) -> box (0.375, 0.25, 0.25, 0.25).
    expect(detection?.box).toEqual({ x: 0.375, y: 0.25, w: 0.25, h: 0.25 });
  });

  test("single-frame spec divides by the max(frames - 1, 1) guard, t stays 0", () => {
    const detector = new FixtureDetectorAdapter({ ...linearSpec, frames: 1 });
    const [detection] = detector.detect(makeFrame(0));
    expect(detection?.box).toEqual({ x: 0.125, y: 0.125, w: 0.25, h: 0.25 });
  });

  test("decodeOrder beyond frames - 1 extrapolates; box edges still clamp", () => {
    const detector = new FixtureDetectorAdapter(linearSpec);
    // t = 10 / 4 = 2.5 -> center (1.5, 0.875); edges clamp into [0, 1]:
    // x-extent [1.375, 1.625] -> [1, 1] -> w 0 (pinned to the right edge);
    // y-extent [0.75, 1.0] -> [0.75, 1] -> h 0.25. Every field in [0, 1].
    const [detection] = detector.detect(makeFrame(10));
    expect(detection?.box).toEqual({ x: 1, y: 0.75, w: 0, h: 0.25 });
  });
});

describe("FixtureDetectorAdapter — static motion", () => {
  test("center is `at` for every decodeOrder; output is identical", () => {
    const spec: FixtureDetectorSpec = {
      detectorId: "fixture-det-static",
      frames: 10,
      labels: [
        {
          label: "ball",
          confidence: 0.75,
          motion: { kind: "static", at: { x: 0.5, y: 0.5 } },
          // Binary-exact size: center 0.5, half 0.0625 -> box 0.4375..0.5625.
          size: { w: 0.125, h: 0.125 },
        },
      ],
    };
    const detector = new FixtureDetectorAdapter(spec);
    expect(detector.detect(makeFrame(0))).toEqual(detector.detect(makeFrame(7)));
    expect(detector.detect(makeFrame(0))[0]?.box).toEqual({
      x: 0.4375,
      y: 0.4375,
      w: 0.125,
      h: 0.125,
    });
  });
});

describe("FixtureDetectorAdapter — clamping", () => {
  test("motion to a far negative center clamps the whole box in-range", () => {
    const spec: FixtureDetectorSpec = {
      detectorId: "fixture-det-clamp",
      frames: 2,
      labels: [
        {
          label: "player",
          confidence: 0.9,
          motion: { kind: "linear", from: { x: 0.5, y: 0.5 }, to: { x: -1, y: 2 } },
          size: { w: 0.2, h: 0.2 },
        },
      ],
    };
    const detector = new FixtureDetectorAdapter(spec);
    // t = 1 -> center (-1, 2): x-extent [-1.1, -0.9] clamps to [0, 0]; y-extent
    // [1.9, 2.1] clamps to [1, 1]. A zero-area box pinned to the top-left
    // corner in x and the bottom edge in y — every field in [0, 1].
    const [detection] = detector.detect(makeFrame(1));
    expect(detection?.box).toEqual({ x: 0, y: 1, w: 0, h: 0 });
  });

  test("partial clamp: off-frame center intersects the spec box with the unit square", () => {
    const spec: FixtureDetectorSpec = {
      detectorId: "fixture-det-clamp-partial",
      frames: 2,
      labels: [
        {
          label: "player",
          confidence: 0.9,
          // t = 1 -> center (-0.125, 0.875), size 0.375:
          // x-extent [-0.3125, 0.0625] -> [0, 0.0625] (w 0.0625);
          // y-extent [0.6875, 1.0625] -> [0.6875, 1] (h 0.3125).
          motion: { kind: "linear", from: { x: 0.5, y: 0.5 }, to: { x: -0.125, y: 0.875 } },
          size: { w: 0.375, h: 0.375 },
        },
      ],
    };
    const detector = new FixtureDetectorAdapter(spec);
    const [detection] = detector.detect(makeFrame(1));
    expect(detection?.box).toEqual({ x: 0, y: 0.6875, w: 0.0625, h: 0.3125 });
  });
});

describe("FixtureDetectorAdapter — determinism and purity", () => {
  test("two detect calls on the same frame deep-equal", () => {
    const detector = new FixtureDetectorAdapter(linearSpec);
    expect(detector.detect(makeFrame(3))).toEqual(detector.detect(makeFrame(3)));
  });

  test("two adapters from the same spec deep-equal", () => {
    const a = new FixtureDetectorAdapter(linearSpec);
    const b = new FixtureDetectorAdapter(linearSpec);
    expect(a.detect(makeFrame(3))).toEqual(b.detect(makeFrame(3)));
  });

  test("ignores pixel bytes and every frame field except decodeOrder", () => {
    const detector = new FixtureDetectorAdapter(linearSpec);
    const frameA = makeFrame(2);
    const filled = new Uint8Array(FRAME_W * FRAME_H * 3).fill(255);
    const frameB = makeFrame(2, {
      frameId: "f-9-99",
      presentationMs: 12_345,
      width: 640,
      height: 360,
      bytes: filled,
      streamIndex: 9,
    });
    expect(detector.detect(frameA)).toEqual(detector.detect(frameB));
  });
});

describe("FixtureDetectorAdapter — spec shape", () => {
  test("one detection per label spec per frame, in spec order", () => {
    const spec: FixtureDetectorSpec = {
      detectorId: "fixture-det-multi",
      frames: 4,
      labels: [
        {
          label: "player",
          confidence: 0.92,
          motion: { kind: "static", at: { x: 0.3, y: 0.3 } },
          size: { w: 0.2, h: 0.2 },
        },
        {
          label: "player",
          confidence: 0.88,
          motion: { kind: "static", at: { x: 0.7, y: 0.7 } },
          size: { w: 0.2, h: 0.2 },
        },
        {
          label: "ball",
          confidence: 0.75,
          motion: { kind: "linear", from: { x: 0.4, y: 0.4 }, to: { x: 0.6, y: 0.4 } },
          size: { w: 0.15, h: 0.15 },
        },
      ],
    };
    const detections = new FixtureDetectorAdapter(spec).detect(makeFrame(1));
    expect(detections).toHaveLength(3);
    expect(detections.map((d) => d.label)).toEqual(["player", "player", "ball"]);
    expect(detections.map((d) => d.confidence)).toEqual([0.92, 0.88, 0.75]);
  });

  test("detectorId is exposed as the adapter's component id", () => {
    expect(new FixtureDetectorAdapter(linearSpec).detectorId).toBe("fixture-det-linear");
  });

  test("invalid specs fail loud at construction (RangeError)", () => {
    const base: FixtureDetectorSpec = {
      detectorId: "fixture-det-invalid",
      frames: 2,
      labels: [
        {
          label: "player",
          confidence: 0.5,
          motion: { kind: "static", at: { x: 0.5, y: 0.5 } },
          size: { w: 0.2, h: 0.2 },
        },
      ],
    };

    expect(() => new FixtureDetectorAdapter({ ...base, detectorId: "" })).toThrow(RangeError);
    expect(() => new FixtureDetectorAdapter({ ...base, frames: 0 })).toThrow(RangeError);
    expect(() => new FixtureDetectorAdapter({ ...base, frames: 2.5 })).toThrow(RangeError);
    expect(
      () =>
        new FixtureDetectorAdapter({
          ...base,
          labels: [{ ...base.labels[0]!, label: "" }],
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new FixtureDetectorAdapter({
          ...base,
          labels: [{ ...base.labels[0]!, confidence: 1.2 }],
        }),
    ).toThrow(/confidence/);
    expect(
      () =>
        new FixtureDetectorAdapter({
          ...base,
          labels: [
            {
              ...base.labels[0]!,
              motion: { kind: "linear", from: { x: Number.NaN, y: 0 }, to: { x: 1, y: 1 } },
            },
          ],
        }),
    ).toThrow(RangeError);
  });
});
