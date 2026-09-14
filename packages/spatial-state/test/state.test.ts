import { describe, expect, test } from "bun:test";
import { DegenerateCorrespondenceError, UnsupportedCornerOrderError } from "@sporta/field-mapping";
import type { FieldCornerSet } from "@sporta/field-mapping";
import { estimateSpatialState } from "../src/state";
import type { SpatialFrame } from "../src/state";
import { SpatialStateInputError, SpatialStateOptionsError } from "../src/state";
import { frameOf, trackOf, IDENTITY_CORNER_SET } from "./helpers";

/**
 * Fusion-core tests: option/input defaults, point ordering, determinism,
 * confidence fusion (the brief's "min"/"product" matrix with raw provenance),
 * clock plumbing, and fail-loud validation. Constants only — no
 * `Math.random`, no `Date.now`.
 */

const BOX_CENTERED = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } as const; // center (0.5, 0.5)

describe("estimateSpatialState — defaults and shape", () => {
  test('default clock is identityClock("video"): sessionMs === presentationMs', () => {
    const series = estimateSpatialState([
      {
        frame: frameOf("f-0-0", 120, 0),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [trackOf("t1", BOX_CENTERED)],
      },
    ]);
    expect(series.frames).toBe(1);
    expect(series.points).toHaveLength(1);
    const point = series.points[0]!;
    expect(point.frameId).toBe("f-0-0");
    expect(point.trackId).toBe("t1");
    expect(point.label).toBe("player");
    // Identity fallback: the honest default when no W103 alignment exists.
    expect(point.sessionMs).toBe(120);
    expect(series.outOfBounds).toBe(0);
  });

  test("empty input: empty series, zero counters", () => {
    expect(estimateSpatialState([])).toEqual({ frames: 0, points: [], outOfBounds: 0 });
  });

  test("frames with zero tracks still count toward series.frames", () => {
    const series = estimateSpatialState([
      { frame: frameOf("f-0-0", 0, 0), cornerSet: IDENTITY_CORNER_SET, tracks: [] },
      {
        frame: frameOf("f-0-1", 40, 1),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [trackOf("t1", BOX_CENTERED)],
      },
    ]);
    expect(series.frames).toBe(2);
    expect(series.points).toHaveLength(1);
  });
});

describe("estimateSpatialState — point ordering", () => {
  test("points sorted by (sessionMs, trackId) regardless of input order", () => {
    // Frame order in the array is the CALLER's (processing order); the OUTPUT
    // is sorted. Frames arrive presentation-descending here, tracks within a
    // frame arrive t2-first — the series must still come out ordered.
    const series = estimateSpatialState([
      {
        frame: frameOf("f-0-1", 40, 1),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [trackOf("t2", BOX_CENTERED), trackOf("t1", BOX_CENTERED)],
      },
      {
        frame: frameOf("f-0-0", 0, 0),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [trackOf("t1", BOX_CENTERED), trackOf("t2", BOX_CENTERED)],
      },
    ]);
    expect(series.points.map((p) => `${p.sessionMs}:${p.trackId}`)).toEqual([
      "0:t1",
      "0:t2",
      "40:t1",
      "40:t2",
    ]);
  });

  test("frameId is the final tie-break (total order, fully deterministic)", () => {
    // Same sessionMs and trackId, different frames: hand-built input only —
    // the order is sessionMs, then trackId, then frameId.
    const series = estimateSpatialState([
      {
        frame: frameOf("f-0-b", 0, 1),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [trackOf("t1", BOX_CENTERED)],
      },
      {
        frame: frameOf("f-0-a", 0, 0),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [trackOf("t1", BOX_CENTERED)],
      },
    ]);
    expect(series.points.map((p) => p.frameId)).toEqual(["f-0-a", "f-0-b"]);
  });
});

describe("estimateSpatialState — confidence fusion (explicit, no inflation)", () => {
  const frame = (trackConfidence: number, cornersConfidence: number): SpatialFrame => ({
    frame: frameOf("f-0-0", 0, 0),
    cornerSet: { ...IDENTITY_CORNER_SET, confidence: cornersConfidence },
    tracks: [trackOf("t1", BOX_CENTERED, "player", trackConfidence)],
  });

  test("track 0.9 x corners 0.9: min 0.9, product 0.9 * 0.9", () => {
    const min = estimateSpatialState([frame(0.9, 0.9)]).points[0]!;
    expect(min.confidence).toBe(0.9); // Math.min(0.9, 0.9) — exact
    expect(min.sourceConfidences).toEqual({ track: 0.9, corners: 0.9 });

    const product = estimateSpatialState([frame(0.9, 0.9)], {
      confidenceCombination: "product",
    }).points[0]!;
    expect(product.confidence).toBe(0.9 * 0.9); // the same IEEE-754 product
    expect(product.confidence).toBeCloseTo(0.81, 10); // documented meaning
    expect(product.sourceConfidences).toEqual({ track: 0.9, corners: 0.9 });
  });

  test("track 0.4 x corners 0.9: min keeps the bottleneck honest (0.4)", () => {
    const min = estimateSpatialState([frame(0.4, 0.9)]).points[0]!;
    expect(min.confidence).toBe(0.4);
    expect(min.sourceConfidences).toEqual({ track: 0.4, corners: 0.9 });

    const product = estimateSpatialState([frame(0.4, 0.9)], {
      confidenceCombination: "product",
    }).points[0]!;
    expect(product.confidence).toBe(0.4 * 0.9);
    expect(product.confidence).toBeCloseTo(0.36, 10);
    // Raw values preserved either way — downstream can re-fuse differently.
    expect(product.sourceConfidences).toEqual({ track: 0.4, corners: 0.9 });
  });

  test("corners can be the bottleneck too (track 0.9, corners 0.4)", () => {
    const min = estimateSpatialState([frame(0.9, 0.4)]).points[0]!;
    expect(min.confidence).toBe(0.4);
    expect(min.sourceConfidences).toEqual({ track: 0.9, corners: 0.4 });
  });
});

describe("estimateSpatialState — clock plumbing", () => {
  test("affine W103 clock maps presentationMs onto the session timeline", () => {
    // slope 1.001 = driftPpm 1000, offset +50 (constructed per W103's
    // TrackClock interface): sessionMs = p + 50 + p * 1000 / 1_000_000.
    const clock = { trackId: "t-0-video", offsetMs: 50, driftPpm: 1000 };
    const series = estimateSpatialState(
      [
        {
          frame: frameOf("f-0-0", 1000, 0),
          cornerSet: IDENTITY_CORNER_SET,
          tracks: [trackOf("t1", BOX_CENTERED)],
        },
      ],
      { clock },
    );
    // 1000 + 50 + 1000 * 1000 / 1e6 = 1051 — exact integer arithmetic.
    expect(series.points[0]!.sessionMs).toBe(1051);
  });
});

describe("estimateSpatialState — determinism", () => {
  test("same inputs produce a deep-equal series", () => {
    const frames: SpatialFrame[] = [
      {
        frame: frameOf("f-0-0", 0, 0),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [trackOf("t1", BOX_CENTERED), trackOf("t2", { x: 0.2, y: 0.6, w: 0.1, h: 0.1 })],
      },
      {
        frame: frameOf("f-0-1", 40, 1),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [trackOf("t1", { x: 0.41, y: 0.4, w: 0.2, h: 0.2 })],
      },
    ];
    expect(estimateSpatialState(frames)).toEqual(estimateSpatialState(frames));
  });
});

describe("estimateSpatialState — fail-loud validation", () => {
  test("unknown confidenceCombination -> SpatialStateOptionsError", () => {
    expect(() =>
      estimateSpatialState(
        [
          {
            frame: frameOf("f-0-0", 0, 0),
            cornerSet: IDENTITY_CORNER_SET,
            tracks: [trackOf("t1", BOX_CENTERED)],
          },
        ],
        { confidenceCombination: "average" as never },
      ),
    ).toThrow(SpatialStateOptionsError);
  });

  test("malformed clock -> SpatialStateOptionsError", () => {
    expect(() =>
      estimateSpatialState(
        [
          {
            frame: frameOf("f-0-0", 0, 0),
            cornerSet: IDENTITY_CORNER_SET,
            tracks: [],
          },
        ],
        { clock: { trackId: "t-0-video", offsetMs: Number.NaN, driftPpm: 0 } },
      ),
    ).toThrow(SpatialStateOptionsError);
  });

  test("frames not an array / non-object frame -> SpatialStateInputError", () => {
    expect(() => estimateSpatialState("nope" as never)).toThrow(SpatialStateInputError);
    expect(() => estimateSpatialState([null as never])).toThrow(SpatialStateInputError);
  });

  test("empty frameId / non-finite presentationMs -> SpatialStateInputError", () => {
    expect(() =>
      estimateSpatialState([
        {
          frame: frameOf("", 0, 0),
          cornerSet: IDENTITY_CORNER_SET,
          tracks: [],
        },
      ]),
    ).toThrow(SpatialStateInputError);
    expect(() =>
      estimateSpatialState([
        {
          frame: frameOf("f-0-0", Number.NaN, 0),
          cornerSet: IDENTITY_CORNER_SET,
          tracks: [],
        },
      ]),
    ).toThrow(SpatialStateInputError);
  });

  test("bad trackId / bad box field / bad confidence -> SpatialStateInputError", () => {
    const base = {
      frame: frameOf("f-0-0", 0, 0),
      cornerSet: IDENTITY_CORNER_SET,
    };
    expect(() =>
      estimateSpatialState([{ ...base, tracks: [trackOf("bad id", BOX_CENTERED)] }]),
    ).toThrow(SpatialStateInputError);
    expect(() =>
      estimateSpatialState([{ ...base, tracks: [trackOf("t1", { x: 0, y: 0, w: 1.5, h: 0.2 })] }]),
    ).toThrow(SpatialStateInputError);
    expect(() =>
      estimateSpatialState([{ ...base, tracks: [trackOf("t1", BOX_CENTERED, "player", 1.5)] }]),
    ).toThrow(SpatialStateInputError);
  });

  test("bad corner-set surface -> SpatialStateInputError", () => {
    expect(() =>
      estimateSpatialState([
        {
          frame: frameOf("f-0-0", 0, 0),
          cornerSet: { ...IDENTITY_CORNER_SET, confidence: 1.5 },
          tracks: [],
        },
      ]),
    ).toThrow(SpatialStateInputError);
    expect(() =>
      estimateSpatialState([
        {
          frame: frameOf("f-0-0", 0, 0),
          cornerSet: { ...IDENTITY_CORNER_SET, corners: [{ x: 0, y: 0 }] as never },
          tracks: [],
        },
      ]),
    ).toThrow(SpatialStateInputError);
  });

  test("W203 typed errors surface unchanged (degenerate corners, bad order)", () => {
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
    expect(() =>
      estimateSpatialState([{ frame: frameOf("f-0-0", 0, 0), cornerSet: collinear, tracks: [] }]),
    ).toThrow(DegenerateCorrespondenceError);
    expect(() =>
      estimateSpatialState([
        {
          frame: frameOf("f-0-0", 0, 0),
          cornerSet: { ...IDENTITY_CORNER_SET, cornerOrder: "bl, br, tr, tl" },
          tracks: [],
        },
      ]),
    ).toThrow(UnsupportedCornerOrderError);
  });
});
