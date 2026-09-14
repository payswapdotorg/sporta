import { describe, expect, test } from "bun:test";
import {
  CANONICAL_CORNER_ORDER,
  FixtureFieldCalibrator,
  createPitchProjector,
} from "@sporta/field-mapping";
import type { FieldCornerSet } from "@sporta/field-mapping";
import { estimateSpatialState } from "../src/state";
import type { SpatialFrame } from "../src/state";
import type { TrackedBox } from "@sporta/perception-tracking";

/**
 * W206 inBounds honesty tests. Fixture camera pan 0.5, zoom 1, jitter 0:
 * the visible window is x in [26.25, 78.75], y in [17, 51], so
 *
 *   X = 26.25 + u * 52.5      Y = 17 + v * 34
 *
 * A player "walking off the visible pitch edge" — the box center marching
 * past the image frame and past the pitch's own touchline — must project
 * OUT of bounds with the RAW projected coordinates preserved (flag, never
 * clamp: architecture-lock §4 — a player beyond the touchline is an
 * out-of-play fact, not a clamped in-play fiction). Every box below is a
 * literal whose center `x + w/2` is binary-exact (hand-checked: 0.75+0.25,
 * 1.5+0.125, -0.85+0.25, …), so the closed-form expectations are exact up
 * to the DLT solve's ~1e-14 error (toBeCloseTo precision 10, the W203 test
 * convention) and BIT-IDENTICAL to the W203 projector on the same center
 * (proving no clamping layer sits in between).
 */

/** Fixture camera corner set, decode order 0, jitter 0 -> exact model corners. */
const CORNER_SET: FieldCornerSet = new FixtureFieldCalibrator({
  pan: 0.5,
  zoom: 1,
  jitter: 0,
}).calibrate({
  frameId: "f-0-0",
  presentationMs: 0,
  width: 160,
  height: 90,
  bytes: new Uint8Array(160 * 90 * 3),
  decodeOrder: 0,
});

/** Identity camera corner set (bit-exact solve — see projection.test.ts). */
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

/**
 * The walking-off sequence: image centers u = 1.0, 1.25, 1.625, 1.75, 2.0 —
 * the last three project clearly BEYOND the touchline (111.5625 m, 118.125
 * m, 131.25 m). The u = 1.5 touchline-exact step is deliberately NOT in
 * this sequence: its closed form X = 105 sits exactly on the boundary, and
 * the DLT solve's ~1e-14 float error may place the raw coordinate an
 * epsilon on either side — the boundary-inclusive semantics are proven
 * bit-exactly with the identity camera below instead. Plus the near-side
 * walk-off at u = -0.6 (X = -5.25).
 */
const WALKING_OFF: ReadonlyArray<{ readonly center: number; readonly box: TrackedBox["box"] }> = [
  { center: 1.0, box: { x: 0.75, y: 0.375, w: 0.5, h: 0.25 } },
  { center: 1.25, box: { x: 1.0, y: 0.375, w: 0.5, h: 0.25 } },
  { center: 1.625, box: { x: 1.5, y: 0.375, w: 0.25, h: 0.25 } },
  { center: 1.75, box: { x: 1.5, y: 0.375, w: 0.5, h: 0.25 } },
  { center: 2.0, box: { x: 1.75, y: 0.375, w: 0.5, h: 0.25 } },
];

function walkingTrack(box: TrackedBox["box"]): TrackedBox {
  return { box, label: "player", confidence: 0.9, trackId: "t1" };
}

function frameFor(d: number, box: TrackedBox["box"]): SpatialFrame {
  return {
    frame: { frameId: `f-0-${d}`, presentationMs: d * 40, decodeOrder: d },
    cornerSet: CORNER_SET,
    tracks: [walkingTrack(box)],
  };
}

describe("inBounds honesty — out-of-play is flagged, NEVER clamped", () => {
  test("box centers are binary-exact (the hand-check behind the closed forms)", () => {
    for (const step of WALKING_OFF) {
      expect(step.box.x + step.box.w / 2).toBe(step.center);
      expect(step.box.y + step.box.h / 2).toBe(0.5); // pitch midline Y = 34
    }
  });

  test("a player walking off the far touchline projects out-of-bounds with raw coordinates", () => {
    // Centers march u = 1.0, 1.25, 1.625, 1.75, 2.0 ->
    // X = 78.75, 91.875, 111.5625, 118.125, 131.25 (closed form
    // X = 26.25 + u * 52.5; the last three are beyond the 105 m touchline).
    const frames = WALKING_OFF.map((step, d) => frameFor(d, step.box));
    const series = estimateSpatialState(frames);

    expect(series.points).toHaveLength(5);
    expect(series.points.map((p) => p.inBounds)).toEqual([true, true, false, false, false]);

    // Hand-computed closed form (raw, unclamped).
    expect(series.points[0]!.pitch.x).toBeCloseTo(78.75, 10);
    expect(series.points[1]!.pitch.x).toBeCloseTo(91.875, 10);
    // Beyond the touchline: raw values BEYOND 105 — never clamped to 105.
    expect(series.points[2]!.pitch.x).toBeCloseTo(111.5625, 10);
    expect(series.points[3]!.pitch.x).toBeCloseTo(118.125, 10);
    expect(series.points[4]!.pitch.x).toBeCloseTo(131.25, 10);
    expect(series.points[4]!.pitch.x).toBeGreaterThan(105);
    // Y stays on the pitch midline throughout.
    for (const point of series.points) {
      expect(point.pitch.y).toBeCloseTo(34, 10);
    }
    // The series tallies the flagged points honestly.
    expect(series.outOfBounds).toBe(3);
  });

  test("coordinates are BIT-IDENTICAL to the W203 projector (no clamping layer)", () => {
    const frames = WALKING_OFF.map((step, d) => frameFor(d, step.box));
    const series = estimateSpatialState(frames);
    const projector = createPitchProjector(CORNER_SET);
    // Single track per frame, sessionMs strictly increasing -> the series
    // order IS the frame order, so points[i] pairs with WALKING_OFF[i].
    series.points.forEach((point, i) => {
      const box = WALKING_OFF[i]!.box;
      const direct = projector.project({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
      expect(point.pitch.x).toBe(direct.x);
      expect(point.pitch.y).toBe(direct.y);
      expect(point.inBounds).toBe(direct.inBounds);
    });
  });

  test("a player walking off the near goal-line side projects NEGATIVE, unclamped", () => {
    // Center u = -0.6 (x = -0.85, w = 0.5; -0.85 + 0.25 === -0.6 exactly)
    // -> X = 26.25 - 31.5 = -5.25 < 0 (out of play).
    const box = { x: -0.85, y: 0.375, w: 0.5, h: 0.25 };
    expect(box.x + box.w / 2).toBe(-0.6);
    const series = estimateSpatialState([frameFor(0, box)]);
    const point = series.points[0]!;
    expect(point.inBounds).toBe(false);
    expect(point.pitch.x).toBeCloseTo(-5.25, 10);
    expect(point.pitch.x).toBeLessThan(0);
    expect(series.outOfBounds).toBe(1);
  });

  test("exactly ON the touchline is IN play (identity camera — bit-exact boundary)", () => {
    // W203's bounds are INCLUSIVE, and the identity camera solves
    // bit-exactly: center u = 1.0 -> X = 105 * 1.0 = 105 EXACTLY on the
    // touchline, in play. (The fixture-camera sequence above deliberately
    // avoids this step: its closed form also sits on the boundary, where
    // the DLT solve's ~1e-14 float error may place the raw coordinate an
    // epsilon on either side — the flag then honestly reflects the raw
    // value, which is exactly the no-clamping guarantee under test.)
    const series = estimateSpatialState([
      {
        frame: { frameId: "f-0-0", presentationMs: 0, decodeOrder: 0 },
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [walkingTrack({ x: 0.75, y: 0.375, w: 0.5, h: 0.25 })], // center (1.0, 0.5)
      },
    ]);
    const point = series.points[0]!;
    expect(point.pitch.x).toBe(105);
    expect(point.inBounds).toBe(true);
    expect(series.outOfBounds).toBe(0);
  });
});
