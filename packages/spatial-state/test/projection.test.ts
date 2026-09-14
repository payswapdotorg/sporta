import { describe, expect, test } from "bun:test";
import { estimateSpatialState } from "../src/state";
import { frameOf, trackOf, IDENTITY_CORNER_SET } from "./helpers";

/**
 * Projection-math tests (the brief's identity-camera case). The identity
 * corner set maps image (u, v) EXACTLY onto pitch (105u, 68v):
 *
 *   corners (0,0),(1,0),(1,1),(0,1)  <->  pitch (0,0),(105,0),(105,68),(0,68)
 *
 * so the image center (0.5, 0.5) is the pitch center (52.5, 34) and
 * (0.25, 0.5) is (26.25, 34). Expected values are hand-derived from that
 * closed form; the projection passes through W203's DLT solve, hence
 * toBeCloseTo at the repo's standard precision (10) — the same convention as
 * W203's own projector tests.
 */
describe("projection math — identity camera", () => {
  test("image center (0.5, 0.5) -> pitch center (52.5, 34) EXACT (to DLT precision)", () => {
    const series = estimateSpatialState([
      {
        frame: frameOf("f-0-0", 0, 0),
        cornerSet: IDENTITY_CORNER_SET,
        // Box center = (0.4 + 0.2/2, 0.4 + 0.2/2) = (0.5, 0.5) — hand-checked.
        tracks: [trackOf("t1", { x: 0.4, y: 0.4, w: 0.2, h: 0.2 })],
      },
    ]);
    const point = series.points[0]!;
    expect(point.pitch.x).toBeCloseTo(52.5, 10);
    expect(point.pitch.y).toBeCloseTo(34, 10);
    expect(point.inBounds).toBe(true);
  });

  test("image (0.25, 0.5) -> pitch (26.25, 34) EXACT (to DLT precision)", () => {
    // Box center hand-check: x + w/2 = 0.15 + 0.2/2 = 0.25; y + h/2 =
    // 0.35 + 0.3/2 = 0.5.
    const series = estimateSpatialState([
      {
        frame: frameOf("f-0-0", 0, 0),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [trackOf("t1", { x: 0.15, y: 0.35, w: 0.2, h: 0.3 })],
      },
    ]);
    const point = series.points[0]!;
    expect(point.pitch.x).toBeCloseTo(26.25, 10);
    expect(point.pitch.y).toBeCloseTo(34, 10);
    expect(point.inBounds).toBe(true);
  });

  test("box-center formula: the projected point is the box CENTER, not an edge", () => {
    // Same center (0.5, 0.5) via two different boxes: a small centered box
    // and a large straddling box. Both must project identically — only the
    // CENTER feeds the projection (documented W206 convention).
    const small = estimateSpatialState([
      {
        frame: frameOf("f-0-0", 0, 0),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [trackOf("t1", { x: 0.4, y: 0.4, w: 0.2, h: 0.2 })],
      },
    ]).points[0]!;
    const large = estimateSpatialState([
      {
        frame: frameOf("f-0-0", 0, 0),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [trackOf("t1", { x: 0.1, y: 0.1, w: 0.8, h: 0.8 })],
      },
    ]).points[0]!;
    expect(large.pitch.x).toBeCloseTo(small.pitch.x, 12);
    expect(large.pitch.y).toBeCloseTo(small.pitch.y, 12);
  });

  test("anisotropic scaling: half the image width = 52.5 m of touchline", () => {
    // Centers (0.25, 0.5) and (0.75, 0.5): 105 * 0.5 = 52.5 m apart —
    // the metric-consistency sanity of the identity camera.
    const series = estimateSpatialState([
      {
        frame: frameOf("f-0-0", 0, 0),
        cornerSet: IDENTITY_CORNER_SET,
        tracks: [
          trackOf("t1", { x: 0.15, y: 0.45, w: 0.2, h: 0.1 }),
          trackOf("t2", { x: 0.65, y: 0.45, w: 0.2, h: 0.1 }),
        ],
      },
    ]);
    const [left, right] = series.points;
    expect(left!.pitch.x).toBeCloseTo(26.25, 10);
    expect(right!.pitch.x).toBeCloseTo(78.75, 10);
    expect(right!.pitch.x - left!.pitch.x).toBeCloseTo(52.5, 10);
  });
});
