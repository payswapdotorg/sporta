import { describe, expect, test } from "bun:test";
import {
  CANONICAL_CORNER_ORDER,
  UnsupportedCornerOrderError,
  createPitchProjector,
} from "@sporta/field-mapping";
import type { FieldCornerSet } from "@sporta/field-mapping";
import { estimateSpatialState } from "../src/state";
import type { SpatialFrame } from "../src/state";
import type { TrackedBox } from "@sporta/perception-tracking";

/**
 * W206 projection math tests. Identity camera: the corner set maps image
 * corners (0,0),(1,0),(1,1),(0,1) onto pitch corners (0,0),(105,0),(105,68),
 * (0,68) — the solved homography is exactly X = 105u, Y = 68v, and every
 * hand-computed value below is BIT-EXACT through the DLT solve (verified
 * against the W203 seam directly). Constants only; no RNG, no clock.
 */

/** Identity camera corner set (canonical producer order, confidence 0.9). */
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

function frame(d: number): SpatialFrame["frame"] {
  return { frameId: `f-0-${d}`, presentationMs: d * 40, decodeOrder: d };
}

function track(id: string, box: { x: number; y: number; w: number; h: number }): TrackedBox {
  return { box, label: "player", confidence: 0.9, trackId: id };
}

describe("estimateSpatialState — projection math (identity camera)", () => {
  test("image center (0.5, 0.5) projects EXACTLY to pitch (52.5, 34)", () => {
    // Box centered exactly on the image center: 0.25 + 0.5/2 = 0.5 (binary
    // exact), 0.375 + 0.25/2 = 0.5.
    const series = estimateSpatialState([
      {
        frame: frame(0),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [track("t1", { x: 0.25, y: 0.375, w: 0.5, h: 0.25 })],
      },
    ]);
    expect(series.frames).toBe(1);
    expect(series.points).toHaveLength(1);
    const point = series.points[0]!;
    expect(point.pitch.x).toBe(52.5); // EXACT: 105 * 0.5
    expect(point.pitch.y).toBe(34); // EXACT: 68 * 0.5
    expect(point.inBounds).toBe(true);
  });

  test("image (0.25, 0.5) projects EXACTLY to pitch (26.25, 34)", () => {
    // Box center x: 0 + 0.5/2 = 0.25; y: 0.375 + 0.25/2 = 0.5.
    const series = estimateSpatialState([
      {
        frame: frame(0),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [track("t1", { x: 0, y: 0.375, w: 0.5, h: 0.25 })],
      },
    ]);
    const point = series.points[0]!;
    expect(point.pitch.x).toBe(26.25); // EXACT: 105 * 0.25
    expect(point.pitch.y).toBe(34);
    expect(point.inBounds).toBe(true);
  });

  test("box-center formula hand-checked once, bit-identical to the W203 projector", () => {
    // Hand-check the center formula: (0.25 + 0.25/2, 0.5 + 0.25/2) = (0.375, 0.625).
    const box = { x: 0.25, y: 0.5, w: 0.25, h: 0.25 };
    const centerX = box.x + box.w / 2;
    const centerY = box.y + box.h / 2;
    expect(centerX).toBe(0.375);
    expect(centerY).toBe(0.625);

    const series = estimateSpatialState([
      { frame: frame(2), cornerSet: IDENTITY_CORNER_SET, tracks: [track("t7", box)] },
    ]);
    const point = series.points[0]!;
    // Closed form: X = 105u, Y = 68v -> (39.375, 42.5), binary exact.
    expect(point.pitch.x).toBe(105 * centerX);
    expect(point.pitch.y).toBe(68 * centerY);
    expect(point.pitch.x).toBe(39.375);
    expect(point.pitch.y).toBe(42.5);
    // Bit-identity with the W203 seam on the same center point: the fusion
    // adds NO arithmetic of its own beyond the center formula.
    const direct = createPitchProjector(IDENTITY_CORNER_SET).project({ x: centerX, y: centerY });
    expect(point.pitch.x).toBe(direct.x);
    expect(point.pitch.y).toBe(direct.y);
    expect(point.inBounds).toBe(direct.inBounds);
  });

  test("identity clock default: sessionMs === presentationMs", () => {
    const series = estimateSpatialState([
      {
        frame: frame(7),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [track("t1", { x: 0.25, y: 0.375, w: 0.5, h: 0.25 })],
      },
    ]);
    expect(series.points[0]!.sessionMs).toBe(280); // 7 * 40, source === session
    expect(series.points[0]!.frameId).toBe("f-0-7");
  });

  test("points are ordered by (sessionMs, trackId) regardless of input frame order", () => {
    // Frame B (40 ms) is fed FIRST (array order is the caller's), frame A
    // (0 ms) second; tracks inside frame A arrive as [t2, t1].
    const series = estimateSpatialState([
      {
        frame: frame(1),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [
          track("t3", { x: 0, y: 0.375, w: 0.5, h: 0.25 }),
          track("t1", { x: 0.25, y: 0.375, w: 0.5, h: 0.25 }),
        ],
      },
      {
        frame: frame(0),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [
          track("t2", { x: 0, y: 0.375, w: 0.5, h: 0.25 }),
          track("t1", { x: 0.25, y: 0.375, w: 0.5, h: 0.25 }),
        ],
      },
    ]);
    expect(series.frames).toBe(2);
    expect(series.points.map((p) => p.trackId)).toEqual(["t1", "t2", "t1", "t3"]);
    expect(series.points.map((p) => p.sessionMs)).toEqual([0, 0, 40, 40]);
    expect(series.points.map((p) => p.frameId)).toEqual(["f-0-0", "f-0-0", "f-0-1", "f-0-1"]);
  });

  test("deterministic: same inputs -> deep-equal series", () => {
    const input: SpatialFrame[] = [
      {
        frame: frame(0),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [track("t1", { x: 0.25, y: 0.375, w: 0.5, h: 0.25 })],
      },
      {
        frame: frame(1),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [track("t1", { x: 0.3, y: 0.375, w: 0.5, h: 0.25 })],
      },
    ];
    expect(estimateSpatialState(input)).toEqual(estimateSpatialState(input));
  });

  test("frames with no tracks still count; outOfBounds tallies honestly", () => {
    const series = estimateSpatialState([
      { frame: frame(0), cornerSet: IDENTITY_CORNER_SET, tracks: [] },
      {
        frame: frame(1),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [track("t1", { x: 0.25, y: 0.375, w: 0.5, h: 0.25 })],
      },
    ]);
    expect(series.frames).toBe(2);
    expect(series.points).toHaveLength(1);
    expect(series.outOfBounds).toBe(0);
  });

  test("unsupported corner order fails loud through the W203 seam", () => {
    expect(() =>
      estimateSpatialState([
        {
          frame: frame(0),
          cornerSet: { ...IDENTITY_CORNER_SET, cornerOrder: "bl, br, tr, tl" },
          tracks: [track("t1", { x: 0.25, y: 0.375, w: 0.5, h: 0.25 })],
        },
      ]),
    ).toThrow(UnsupportedCornerOrderError);
  });
});
