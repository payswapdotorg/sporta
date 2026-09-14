import { describe, expect, test } from "bun:test";
import { CANONICAL_CAMERA_SLOTS } from "@sporta/scene-projection";
import {
  FOCAL_PX,
  MIN_MARKER_RADIUS_PX,
  NEAR_PLANE_METERS,
  cameraFromSlot,
  clipPolygonNear,
  clipSegmentNear,
  projectCameraPoint,
  projectPoint,
  projectedRadius,
  toCameraSpace,
} from "../src/index";
import type { CameraPoint } from "../src/index";

const MAIN = CANONICAL_CAMERA_SLOTS[0]!; // eye (52.5, -25, 20) → target (52.5, 34, 0)
const AERIAL = CANONICAL_CAMERA_SLOTS[4]!; // eye (52.5, 34, 60) → target (52.5, 34, 0)

describe("cameraFromSlot — the look-at basis (documented math)", () => {
  test("main-touchline: forward toward the target, right = +x, up = right × forward", () => {
    const frame = cameraFromSlot(MAIN);
    const length = Math.hypot(59, -20); // |target − eye|
    expect(frame.forward.x).toBeCloseTo(0, 6);
    expect(frame.forward.y).toBeCloseTo(59 / length, 6);
    expect(frame.forward.z).toBeCloseTo(-20 / length, 6);
    // toBeCloseTo everywhere: the cross product can produce −0 components,
    // and strict equality distinguishes −0 from 0.
    expect(frame.right.x).toBeCloseTo(1, 12);
    expect(frame.right.y).toBeCloseTo(0, 12);
    expect(frame.right.z).toBeCloseTo(0, 12);
    expect(frame.up.x).toBeCloseTo(0, 6);
    expect(frame.up.y).toBeCloseTo(20 / length, 6);
    expect(frame.up.z).toBeCloseTo(59 / length, 6);
    // Orthonormal (a rigid frame).
    for (const [a, b] of [
      [frame.forward, frame.right],
      [frame.forward, frame.up],
      [frame.right, frame.up],
    ] as const) {
      expect(a.x * b.x + a.y * b.y + a.z * b.z).toBeCloseTo(0, 6);
    }
  });

  test("aerial-tactical: the straight-down fallback (documented +y up-hint)", () => {
    const frame = cameraFromSlot(AERIAL);
    expect(frame.forward.x).toBeCloseTo(0, 12);
    expect(frame.forward.y).toBeCloseTo(0, 12);
    expect(frame.forward.z).toBe(-1); // straight down (exact)
    // The degenerate cross product disambiguates to world +x screen-right…
    expect(frame.right.x).toBeCloseTo(1, 12);
    expect(frame.right.y).toBeCloseTo(0, 12);
    expect(frame.right.z).toBeCloseTo(0, 12);
    // …and world +y screen-UP (up = right × forward = +y).
    expect(frame.up.x).toBeCloseTo(0, 12);
    expect(frame.up.y).toBeCloseTo(1, 12);
    expect(frame.up.z).toBeCloseTo(0, 12);
  });

  test("the eye is the slot position, verbatim; the camera never moves or re-aims", () => {
    const frame = cameraFromSlot(MAIN);
    expect(frame.eye).toEqual(MAIN.position);
  });
});

describe("toCameraSpace + projectCameraPoint — the perspective divide", () => {
  const camera = cameraFromSlot(MAIN);
  const canvas = { width: 1280, height: 720 };

  test("the fixture striker base (60, 30, 0): hand-derived camera space", () => {
    // d = (7.5, 55, −20); cam = (dot(d,right), dot(d,up), dot(d,forward)).
    const cam = toCameraSpace(camera, { x: 60, y: 30, z: 0 });
    expect(cam.x).toBeCloseTo(7.5, 6);
    expect(cam.y).toBeCloseTo(-1.2842, 3);
    expect(cam.z).toBeCloseTo(58.5094, 3);
  });

  test("the perspective divide lands the striker at (705.63, 371.24) — pinned", () => {
    const projected = projectCameraPoint(toCameraSpace(camera, { x: 60, y: 30, z: 0 }), canvas);
    // x/y are round2-serialized; the depth is full precision.
    expect(projected!.x).toBe(705.63);
    expect(projected!.y).toBe(371.24);
    expect(projected!.depth).toBeCloseTo(58.5094, 3);
  });

  test("y grows DOWN the screen (SVG convention): +up points map above center", () => {
    const above = projectCameraPoint({ x: 0, y: 10, z: 40 }, canvas)!;
    const below = projectCameraPoint({ x: 0, y: -10, z: 40 }, canvas)!;
    expect(above.y).toBeLessThan(360);
    expect(below.y).toBeGreaterThan(360);
  });

  test("points at or behind the near plane do not project (undefined)", () => {
    expect(projectCameraPoint({ x: 0, y: 0, z: NEAR_PLANE_METERS - 0.01 }, canvas)).toBeUndefined();
    expect(projectCameraPoint({ x: 0, y: 0, z: 0 }, canvas)).toBeUndefined();
    expect(projectCameraPoint({ x: 0, y: 0, z: -5 }, canvas)).toBeUndefined();
    expect(projectCameraPoint({ x: 0, y: 0, z: NEAR_PLANE_METERS }, canvas)).toBeDefined();
  });

  test("projectPoint composes transform + divide (pure)", () => {
    expect(projectPoint(camera, { x: 60, y: 30, z: 0 }, canvas)).toEqual(
      projectCameraPoint(toCameraSpace(camera, { x: 60, y: 30, z: 0 }), canvas),
    );
  });

  test("aerial slot: the FULL pitch frames below the HUD band (the focal choice)", () => {
    const nadir = cameraFromSlot(AERIAL);
    // Far corners (0, 0) and (105, 68).
    const cornerA = projectPoint(nadir, { x: 0, y: 0, z: 0 }, canvas)!;
    const cornerB = projectPoint(nadir, { x: 105, y: 68, z: 0 }, canvas)!;
    // x spans 640 ± 512·52.5/60 = [192, 1088]; y spans 360 ± 512·34/60.
    expect(cornerA).toEqual({ x: 192, y: 650.13, depth: 60 });
    expect(cornerB).toEqual({ x: 1088, y: 69.87, depth: 60 });
    // Both inside the canvas AND below the 64 px HUD band.
    for (const point of [cornerA, cornerB]) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1280);
      expect(point.y).toBeGreaterThanOrEqual(64);
      expect(point.y).toBeLessThanOrEqual(720);
    }
  });
});

describe("clipSegmentNear — parametric near-plane clipping", () => {
  test("both endpoints in front: unchanged", () => {
    const a: CameraPoint = { x: 0, y: 0, z: 5 };
    const b: CameraPoint = { x: 3, y: 2, z: 8 };
    expect(clipSegmentNear(a, b)).toEqual([a, b]);
  });

  test("both behind: nothing drawable (null)", () => {
    expect(clipSegmentNear({ x: 0, y: 0, z: 0.1 }, { x: 1, y: 1, z: 0.2 })).toBeNull();
    expect(clipSegmentNear({ x: 0, y: 0, z: -1 }, { x: 1, y: 1, z: -2 })).toBeNull();
  });

  test("one behind: shortened to the near-plane crossing", () => {
    const a: CameraPoint = { x: 0, y: 0, z: 0.2 };
    const b: CameraPoint = { x: 0, y: 0, z: 5 };
    const clipped = clipSegmentNear(a, b)!;
    expect(clipped).toHaveLength(2);
    expect(clipped[0]!.z).toBeCloseTo(NEAR_PLANE_METERS, 12);
    expect(clipped[1]).toEqual(b);
    // t = (0.5 − 0.2)/(5 − 0.2) = 0.0625 → x stays 0 along this segment.
    expect(clipped[0]!.x).toBeCloseTo(0, 12);
  });

  test("front-behind order is preserved (a in front, b behind)", () => {
    const a: CameraPoint = { x: 1, y: 1, z: 4 };
    const b: CameraPoint = { x: 2, y: 2, z: -1 };
    const clipped = clipSegmentNear(a, b)!;
    expect(clipped[0]).toEqual(a);
    expect(clipped[1]!.z).toBeCloseTo(NEAR_PLANE_METERS, 12);
    // t = (0.5 − 4)/(−1 − 4) = 0.7 → x = 1 + 0.7·(2 − 1) = 1.7.
    expect(clipped[1]!.x).toBeCloseTo(1.7, 6);
    expect(clipped[1]!.y).toBeCloseTo(1.7, 6);
  });
});

describe("clipPolygonNear — Sutherland–Hodgman against the single near plane", () => {
  test("fully in front: the same vertices, same order", () => {
    const square: CameraPoint[] = [
      { x: -1, y: -1, z: 5 },
      { x: 1, y: -1, z: 5 },
      { x: 1, y: 1, z: 5 },
      { x: -1, y: 1, z: 5 },
    ];
    expect(clipPolygonNear(square)).toEqual(square);
  });

  test("fully behind: empty", () => {
    expect(
      clipPolygonNear([
        { x: 0, y: 0, z: 0.1 },
        { x: 1, y: 0, z: 0.1 },
        { x: 1, y: 1, z: 0.1 },
      ]),
    ).toEqual([]);
  });

  test("crossing: two intersection vertices at the near plane (one per crossing edge)", () => {
    // A quad spanning z from 0 to 10 crosses the plane twice.
    const quad: CameraPoint[] = [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 10 },
      { x: 4, y: 4, z: 10 },
      { x: 0, y: 4, z: 0 },
    ];
    const clipped = clipPolygonNear(quad);
    // 2 front vertices + 2 crossing points.
    expect(clipped).toHaveLength(4);
    for (const point of clipped) {
      expect(point.z).toBeGreaterThanOrEqual(NEAR_PLANE_METERS - 1e-9);
    }
    const atNear = clipped.filter((point) => Math.abs(point.z - NEAR_PLANE_METERS) < 1e-9);
    expect(atNear).toHaveLength(2);
  });
});

describe("projectedRadius — the small-object silhouette + readability floor", () => {
  test("perspective-true radii at close range (r_screen ≈ focal · r / depth)", () => {
    expect(projectedRadius(0.11, 5)).toBe(11.26); // 512·0.11/5 = 11.264
    expect(projectedRadius(0.14, 7)).toBe(10.24); // 512·0.14/7 = 10.24
  });

  test("the floor: a 0.11 m ball is sub-pixel at aerial distance → MIN_MARKER_RADIUS_PX", () => {
    expect((512 * 0.11) / 60).toBeLessThan(1); // honest perspective: sub-pixel
    expect(projectedRadius(0.11, 60)).toBe(MIN_MARKER_RADIUS_PX);
    expect(MIN_MARKER_RADIUS_PX).toBe(2.5);
  });
});

describe("constants are the documented presentation values", () => {
  test("FOCAL_PX 512 on the 1280×720 profile (≈70° vertical FOV)", () => {
    expect(FOCAL_PX).toBe(512);
    // vertical FOV = 2·atan(h/2 / f) = 2·atan(360/512) ≈ 70.22°
    expect((2 * Math.atan(360 / FOCAL_PX) * 180) / Math.PI).toBeCloseTo(70.22, 1);
  });

  test("NEAR_PLANE_METERS 0.5", () => {
    expect(NEAR_PLANE_METERS).toBe(0.5);
  });
});
