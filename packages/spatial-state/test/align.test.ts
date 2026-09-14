import { describe, expect, test } from "bun:test";
import { identityClock } from "@sporta/timeline";
import type { TrackClock } from "@sporta/timeline";
import { CANONICAL_CORNER_ORDER } from "@sporta/field-mapping";
import type { FieldCornerSet } from "@sporta/field-mapping";
import { alignSessionMs, ensureSpatialMonotonic } from "../src/align";
import type { SpatialStatePoint } from "../src/state";
import { estimateSpatialState } from "../src/state";
import type { SpatialFrame } from "../src/state";

/**
 * W206 time-alignment tests: the W103 seam (identity clock = source time;
 * an affine clock with slope 1.001 — driftPpm 1000 — and offset +50 maps
 * source -> session exactly), and the W103 monotonicity semantics for
 * multi-source re-stamping. All expected values are hand-computed from the
 * documented affine formula. Constants only.
 */

/** Affine clock: sessionMs = presentationMs + 50 + presentationMs * 1000 / 1e6 (slope 1.001). */
const AFFINE_CLOCK: TrackClock = { trackId: "video", offsetMs: 50, driftPpm: 1000 };

const IDENTITY_CORNER_SET: FieldCornerSet = {
  corners: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
  cornerOrder: CANONICAL_CORNER_ORDER,
  confidence: 0.9,
};

function point(sessionMs: number, trackId = "t1"): SpatialStatePoint {
  return {
    trackId,
    frameId: "f-0-0",
    sessionMs,
    pitch: { x: 52.5, y: 34 },
    inBounds: true,
    confidence: 0.9,
    sourceConfidences: { track: 0.9, corners: 0.9 },
  };
}

describe("alignSessionMs — the W103 seam", () => {
  test("identity clock: sessionMs === presentationMs (bit-exact)", () => {
    const clock = identityClock("video");
    for (const presentationMs of [0, 40, 4760, 12345.5]) {
      expect(alignSessionMs(clock, presentationMs)).toBe(presentationMs);
    }
  });

  test("affine clock (slope 1.001, offset +50): exact closed-form values", () => {
    // sessionMs = presentationMs + 50 + presentationMs * 1000 / 1_000_000
    expect(alignSessionMs(AFFINE_CLOCK, 0)).toBe(50);
    expect(alignSessionMs(AFFINE_CLOCK, 1000)).toBe(1051);
    expect(alignSessionMs(AFFINE_CLOCK, 2000)).toBe(2052);
    expect(alignSessionMs(AFFINE_CLOCK, 1_000_000)).toBe(1_001_050);
    // Bit-identity with the documented formula (same operations, same order).
    const p = 4760; // frame 119 at 25 fps (40 ms)
    expect(alignSessionMs(AFFINE_CLOCK, p)).toBe(p + 50 + (p * 1000) / 1_000_000);
    expect(alignSessionMs(AFFINE_CLOCK, p)).toBeCloseTo(1.001 * p + 50, 9);
  });

  test("estimateSpatialState stamps every point with the clock-mapped session time", () => {
    const frames: SpatialFrame[] = [0, 1].map((d) => ({
      frame: { frameId: `f-0-${d}`, presentationMs: d * 40, decodeOrder: d },
      cornerSet: IDENTITY_CORNER_SET,
      tracks: [
        {
          box: { x: 0.25, y: 0.375, w: 0.5, h: 0.25 },
          label: "player",
          confidence: 0.9,
          trackId: "t1",
        },
      ],
    }));
    const series = estimateSpatialState(frames, { clock: AFFINE_CLOCK });
    expect(series.points.map((p) => p.sessionMs)).toEqual([
      alignSessionMs(AFFINE_CLOCK, 0),
      alignSessionMs(AFFINE_CLOCK, 40),
    ]);
    expect(series.points[0]!.sessionMs).toBe(50);
    // Session time is NOT the source presentationMs (offset +50 applied).
    expect(series.points[1]!.sessionMs).not.toBe(40);
    expect(series.points[1]!.sessionMs).toBeCloseTo(90.04, 9);
  });

  test("non-finite presentation time fails loud (W103 RangeError)", () => {
    expect(() => alignSessionMs(AFFINE_CLOCK, Number.NaN)).toThrow(RangeError);
    expect(() =>
      estimateSpatialState([
        {
          frame: { frameId: "f-0-0", presentationMs: Number.POSITIVE_INFINITY, decodeOrder: 0 },
          cornerSet: IDENTITY_CORNER_SET,
          tracks: [],
        },
      ]),
    ).toThrow(RangeError);
  });
});

describe("ensureSpatialMonotonic — W103 semantics, pure", () => {
  test("deliberately non-monotonic 3-point series re-stamps per W103 semantics", () => {
    // Walk: 100 (first, passes) -> 300 (>= 100, passes) -> 200 (< 300,
    // clamped UP to 300). Expected [100, 300, 300] — the W103 rule: a
    // regressing candidate takes the previous session position.
    const input = [point(100), point(300, "t2"), point(200, "t3")];
    const output = ensureSpatialMonotonic(input);
    expect(output.map((p) => p.sessionMs)).toEqual([100, 300, 300]);
    expect(output.map((p) => p.trackId)).toEqual(["t1", "t2", "t3"]);
    // Purity: the INPUT is never mutated.
    expect(input.map((p) => p.sessionMs)).toEqual([100, 300, 200]);
  });

  test("already-monotonic series passes through value-unchanged (single-video case)", () => {
    // Single-video estimator output is already monotonic — the identity
    // clock maps decode-ordered presentationMs 1:1; re-stamping is a no-op.
    const input = [point(0), point(40, "t1"), point(80, "t1")];
    const output = ensureSpatialMonotonic(input);
    expect(output).toEqual(input);
    expect(output).not.toBe(input); // fresh array, inputs not aliased
  });

  test("equal sessionMs values pass through (monotone is non-strict)", () => {
    const input = [point(40, "t1"), point(40, "t2")];
    expect(ensureSpatialMonotonic(input).map((p) => p.sessionMs)).toEqual([40, 40]);
  });

  test("non-finite sessionMs fails loud", () => {
    expect(() => ensureSpatialMonotonic([point(Number.NaN)])).toThrow(RangeError);
  });

  test("deterministic: same input -> deep-equal output", () => {
    const input = [point(100), point(50, "t2")];
    expect(ensureSpatialMonotonic(input)).toEqual(ensureSpatialMonotonic(input));
  });
});
