import { describe, expect, test } from "bun:test";
import { identityClock } from "@sporta/timeline";
import { alignSessionMs, ensureSpatialMonotonic } from "../src/align";
import { estimateSpatialState } from "../src/state";
import { frameOf, pointWith, trackOf, IDENTITY_CORNER_SET } from "./helpers";

/**
 * Time-alignment tests (the brief's §3.6 group). The affine clock is
 * constructed per W103's TrackClock interface: slope 1.001 = driftPpm 1000,
 * offset +50, so sessionMs = p + 50 + p * 1000 / 1_000_000. Expected values
 * use the SAME expression W103 computes (bit-exact) plus the documented
 * affine meaning at close precision. Constants only — no clock reads.
 */

const AFFINE = { trackId: "t-0-video", offsetMs: 50, driftPpm: 1000 };

describe("alignSessionMs — W103 seam", () => {
  test("identity clock: sessionMs === presentationMs", () => {
    const clock = identityClock("video");
    for (const presentationMs of [0, 40, 1_200, 4760]) {
      expect(alignSessionMs(clock, presentationMs)).toBe(presentationMs);
    }
  });

  test("affine clock (slope 1.001, offset +50): sessionMs = 1.001 * p + 50", () => {
    // W103's exact formula (bit-identical to the wrapper's computation):
    // p + 50 + p * 1000 / 1_000_000.
    for (const presentationMs of [0, 1_000, 40_000, 2_000_000]) {
      expect(alignSessionMs(AFFINE, presentationMs)).toBe(
        presentationMs + 50 + (presentationMs * 1000) / 1_000_000,
      );
      // The affine meaning: slope 1.001, offset +50.
      expect(alignSessionMs(AFFINE, presentationMs)).toBeCloseTo(1.001 * presentationMs + 50, 9);
    }
    // Hand-derived integer checkpoints (exact arithmetic):
    expect(alignSessionMs(AFFINE, 0)).toBe(50);
    expect(alignSessionMs(AFFINE, 1_000)).toBe(1051);
    expect(alignSessionMs(AFFINE, 40_000)).toBe(40_090);
  });

  test("estimateSpatialState applies the SAME mapping to every frame", () => {
    const series = estimateSpatialState(
      [
        {
          frame: frameOf("f-0-0", 1000, 0),
          cornerSet: IDENTITY_CORNER_SET,
          tracks: [trackOf("t1", { x: 0.4, y: 0.4, w: 0.2, h: 0.2 })],
        },
        {
          frame: frameOf("f-0-1", 2000, 1),
          cornerSet: IDENTITY_CORNER_SET,
          tracks: [trackOf("t1", { x: 0.42, y: 0.4, w: 0.2, h: 0.2 })],
        },
      ],
      { clock: AFFINE },
    );
    expect(series.points[0]!.sessionMs).toBe(alignSessionMs(AFFINE, 1000));
    expect(series.points[1]!.sessionMs).toBe(alignSessionMs(AFFINE, 2000));
  });
});

describe("ensureSpatialMonotonic — W103 ensureMonotonic semantics", () => {
  test("deliberately non-monotonic 3-point series -> [100, 300, 300]", () => {
    // W103 semantics (documented expected values): the first point is
    // emitted verbatim; a candidate that regresses below the running maximum
    // is clamped UP to it. 100 -> 100 (first, verbatim); 300 >= 100 -> 300;
    // 200 < 300 -> clamped to 300.
    const points = [
      pointWith(100, "t1", "f-0-0"),
      pointWith(300, "t2", "f-0-1"),
      pointWith(200, "t3", "f-0-2"),
    ];
    const restamped = ensureSpatialMonotonic(points);
    expect(restamped.map((p) => p.sessionMs)).toEqual([100, 300, 300]);
    // Purity: the INPUT is never mutated (points and array untouched)...
    expect(points.map((p) => p.sessionMs)).toEqual([100, 300, 200]);
    // ...and the output points are FRESH objects (no aliasing), with every
    // non-time field carried through verbatim.
    expect(restamped[0]).not.toBe(points[0]);
    expect(restamped[0]).toEqual(points[0]);
    expect(restamped[2]!.trackId).toBe("t3");
    expect(restamped[2]!.frameId).toBe("f-0-2");
    expect(restamped[2]!.pitch).toEqual(points[2]!.pitch);
  });

  test("already-monotonic series is unchanged in value (single-video input)", () => {
    // A single-video fused series is already monotonic — decode-order
    // presentation times strictly increase and the affine map has a positive
    // rate — so re-stamping is a value-preserving copy.
    const monotonic = [pointWith(0), pointWith(40, "t1", "f-0-1"), pointWith(80, "t1", "f-0-2")];
    expect(ensureSpatialMonotonic(monotonic).map((p) => p.sessionMs)).toEqual([0, 40, 80]);
    // Equal sessionMs values are NOT regressions (>= semantics).
    const plateau = [pointWith(40), pointWith(40, "t2", "f-0-0")];
    expect(ensureSpatialMonotonic(plateau).map((p) => p.sessionMs)).toEqual([40, 40]);
  });

  test("empty and single-point series pass through", () => {
    expect(ensureSpatialMonotonic([])).toEqual([]);
    const single = [pointWith(100)];
    expect(ensureSpatialMonotonic(single)).toEqual([pointWith(100)]);
  });

  test("non-array input fails loud", () => {
    expect(() => ensureSpatialMonotonic("nope" as never)).toThrow(RangeError);
  });
});
