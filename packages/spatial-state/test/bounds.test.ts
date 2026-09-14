import { describe, expect, test } from "bun:test";
import { createPitchProjector } from "@sporta/field-mapping";
import { estimateSpatialState } from "../src/state";
import { cornerSetFrom, frameOf, trackOf } from "./helpers";

/**
 * inBounds honesty tests (the brief's out-of-play case).
 *
 * DOCUMENTED DEVIATION from the brief's sketch: the brief suggests camera
 * "pan 0.5 zoom 1", but that configuration is EXACTLY TANGENT — the fixture
 * camera maps image [0, 1] onto the visible window [26.25, 78.75] x [17, 51]
 * (always inside the pitch), and a contract-legal NormalizedBox's center can
 * reach at most (1.5, 1.5) (x + w/2 with every field <= 1), which projects
 * to the pitch corner (105, 68) in exact arithmetic — at most ONE ULP past
 * the boundary through the DLT solve. No box can go meaningfully
 * out-of-pitch with pan 0.5 zoom 1. The out-of-play case is therefore
 * realized with pan 1 (window flush against the high-x touchline end:
 * X = 52.5 + 52.5u), where a box straddling the right image edge has center
 * u > 1 and projects PAST x = 105. The tangency itself is pinned by tests
 * below, so the geometry is fully documented.
 *
 * Out-of-play convention (W203 semantics, W206 passthrough): out-of-pitch
 * positions keep their TRUE projected coordinates and are flagged
 * `inBounds: false` — NEVER clamped (architecture-lock §4).
 */
const PAN_RIGHT = { pan: 1, zoom: 1, jitter: 0 } as const;
const PAN_CENTER = { pan: 0.5, zoom: 1, jitter: 0 } as const;

describe("inBounds honesty — out-of-play positions are flagged, never clamped", () => {
  test("player box straddling the visible edge projects PAST the touchline", () => {
    // Camera pan 1, zoom 1: X = 52.5 + 52.5u, Y = 17 + 34v. Box
    // {x: 0.9, y: 0.45, w: 0.4, h: 0.1} (every field in [0, 1] — legal) has
    // center (1.1, 0.5): X = 52.5 + 52.5 * 1.1 = 110.25 > 105, Y = 34.
    const series = estimateSpatialState([
      {
        frame: frameOf("f-0-0", 0, 0),
        cornerSet: cornerSetFrom(PAN_RIGHT, 0),
        tracks: [trackOf("t1", { x: 0.9, y: 0.45, w: 0.4, h: 0.1 })],
      },
    ]);
    const point = series.points[0]!;
    expect(point.inBounds).toBe(false);
    // The RAW projected value — NOT clamped to the 105 m touchline.
    expect(point.pitch.x).toBeCloseTo(110.25, 10);
    expect(point.pitch.x).toBeGreaterThan(105);
    expect(point.pitch.y).toBeCloseTo(34, 10);
    expect(series.outOfBounds).toBe(1);
  });

  test("a fully visible player in the same frame stays in bounds", () => {
    // Center (0.5, 0.5): X = 52.5 + 26.25 = 78.75, Y = 34 — inside.
    const series = estimateSpatialState([
      {
        frame: frameOf("f-0-0", 0, 0),
        cornerSet: cornerSetFrom(PAN_RIGHT, 0),
        tracks: [trackOf("t1", { x: 0.4, y: 0.45, w: 0.2, h: 0.1 })],
      },
    ]);
    expect(series.points[0]!.inBounds).toBe(true);
    expect(series.points[0]!.pitch.x).toBeCloseTo(78.75, 10);
    expect(series.outOfBounds).toBe(0);
  });

  test("mixed frame: outOfBounds counts exactly the flagged points", () => {
    const series = estimateSpatialState([
      {
        frame: frameOf("f-0-0", 0, 0),
        cornerSet: cornerSetFrom(PAN_RIGHT, 0),
        tracks: [
          trackOf("t1", { x: 0.4, y: 0.45, w: 0.2, h: 0.1 }), // in
          trackOf("t2", { x: 0.9, y: 0.45, w: 0.4, h: 0.1 }), // out (110.25, 34)
          trackOf("t3", { x: 0.95, y: 0.45, w: 0.3, h: 0.1 }), // center (1.1, 0.5) — out too
        ],
      },
    ]);
    expect(series.points).toHaveLength(3);
    expect(series.outOfBounds).toBe(2);
    expect(series.points.filter((p) => !p.inBounds).map((p) => p.trackId)).toEqual(["t2", "t3"]);
  });

  test("pan 0.5 zoom 1 tangency: the extreme legal box lands ON the pitch corner", () => {
    // Camera pan 0.5, zoom 1: X = 26.25 + 52.5u, Y = 17 + 34v. The extreme
    // contract-legal box {x: 1, y: 1, w: 1, h: 1} has center (1.5, 1.5) —
    // the MAXIMUM reachable center — projecting to exactly the pitch corner
    // (105, 68) in exact arithmetic. Through the DLT solve the x coordinate
    // lands one ulp OUTSIDE (105.00000000000001 — deterministic), so the
    // point is honestly flagged and the raw value kept: this IS the
    // flag-never-clamp rule operating at the boundary. It also documents why
    // the out-of-play case needs pan 1: no box can go MEANINGFULLY
    // out-of-pitch with the tangent camera (at most one ulp past the line).
    const cornerSet = cornerSetFrom(PAN_CENTER, 0);
    const series = estimateSpatialState([
      {
        frame: frameOf("f-0-0", 0, 0),
        cornerSet,
        tracks: [trackOf("t1", { x: 1, y: 1, w: 1, h: 1 })],
      },
    ]);
    const point = series.points[0]!;
    expect(point.pitch.x).toBeCloseTo(105, 10);
    expect(point.pitch.y).toBeCloseTo(68, 10);
    // W206 passes W203's projector semantics through UNCHANGED: the fused
    // point is bit-identical to the projector's own projection of the box
    // center (same code path — coordinates AND flag).
    const direct = createPitchProjector(cornerSet).project({ x: 1.5, y: 1.5 });
    expect(point.pitch.x).toBe(direct.x);
    expect(point.pitch.y).toBe(direct.y);
    expect(point.inBounds).toBe(direct.inBounds);
    expect(point.inBounds).toBe(false); // one ulp outside — flagged, kept raw
    expect(point.pitch.x).toBeGreaterThan(105); // NOT clamped to the touchline
  });

  test("a box landing just inside the corner stays in bounds (boundary is inclusive)", () => {
    // Center (1.49, 1.49): X = 26.25 + 52.5 * 1.49 = 104.475,
    // Y = 17 + 34 * 1.49 = 67.66 — inside, comfortably clear of the ulp noise.
    const series = estimateSpatialState([
      {
        frame: frameOf("f-0-0", 0, 0),
        cornerSet: cornerSetFrom(PAN_CENTER, 0),
        tracks: [trackOf("t1", { x: 1, y: 1, w: 0.98, h: 0.98 })],
      },
    ]);
    const point = series.points[0]!;
    expect(point.pitch.x).toBeCloseTo(104.475, 10);
    expect(point.pitch.y).toBeCloseTo(67.66, 10);
    expect(point.inBounds).toBe(true);
  });
});
