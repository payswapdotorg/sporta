import { describe, expect, test } from "bun:test";
import { projectScene } from "@sporta/scene-projection";
import { CANONICAL_CAMERA_SLOTS } from "@sporta/scene-projection";
import {
  APRON_WIDTH_METERS,
  CIRCLE_SEGMENTS,
  CORNER_ARC_SEGMENTS,
  FIELD_DOT_RADIUS_METERS,
  PENALTY_ARC_SEGMENTS,
  STRIPE_COUNT,
  buildFieldGeometry,
} from "../src/index";
import { buildFixtureSnapshot } from "./helpers";

/** The fixture's projected scene (all 5 canonical camera slots). */
function fixtureScene() {
  return projectScene(buildFixtureSnapshot(0));
}

describe("buildFieldGeometry — verbatim derivation from the spec's world block", () => {
  test("fixed element counts: 12 ground polygons, 155 marking lines, 3 dots, 5 slots", () => {
    const field = buildFieldGeometry(fixtureScene());
    // 1 apron + 1 pitch + 10 mow stripes.
    expect(field.polygons).toHaveLength(12);
    expect(field.polygons.filter((polygon) => polygon.kind === "apron")).toHaveLength(1);
    expect(field.polygons.filter((polygon) => polygon.kind === "pitch")).toHaveLength(1);
    expect(field.polygons.filter((polygon) => polygon.kind === "stripe")).toHaveLength(
      STRIPE_COUNT,
    );
    // 4 boundary + 1 halfway + 8 goal-area + 8 penalty-area + 64 center-circle
    // + 32 penalty-arc + 32 corner-arc + 6 goal-frame.
    expect(field.lines).toHaveLength(155);
    expect(field.dots).toHaveLength(3);
    expect(field.cameraSlots).toHaveLength(5);
  });

  test("line kinds are counted exactly (serialization determinism)", () => {
    const kinds = new Map<string, number>();
    for (const line of buildFieldGeometry(fixtureScene()).lines) {
      kinds.set(line.kind, (kinds.get(line.kind) ?? 0) + 1);
    }
    expect(Object.fromEntries(kinds)).toEqual({
      boundary: 4,
      halfway: 1,
      "goal-area": 8,
      "penalty-area": 8,
      "center-circle": CIRCLE_SEGMENTS,
      "penalty-arc": PENALTY_ARC_SEGMENTS * 2,
      "corner-arc": CORNER_ARC_SEGMENTS * 4,
      "goal-frame": 6,
    });
  });

  test("the apron is the spec's bounds extended by the documented 6 m margin", () => {
    const apron = buildFieldGeometry(fixtureScene()).polygons[0]!;
    expect(apron.fill).toBe("apron");
    expect(APRON_WIDTH_METERS).toBe(6);
    expect(apron.points.map((point) => [point.x, point.y])).toEqual([
      [-6, -6],
      [111, -6],
      [111, 74],
      [-6, 74],
    ]);
  });

  test("the halfway line runs through the spec's center mark, spanning the bounds", () => {
    const halfway = buildFieldGeometry(fixtureScene()).lines.find(
      (line) => line.kind === "halfway",
    )!;
    expect(halfway.from).toEqual({ x: 52.5, y: 0, z: 0 });
    expect(halfway.to).toEqual({ x: 52.5, y: 68, z: 0 });
  });

  test("goal frames: posts at the goal-line width, crossbar at the Law 1 height", () => {
    const goals = buildFieldGeometry(fixtureScene()).lines.filter(
      (line) => line.kind === "goal-frame",
    );
    // x0 goal: 3 lines (post, post, crossbar) — verbatim spec values.
    const x0 = goals.slice(0, 3);
    expect(x0[0]!.from).toEqual({ x: 0, y: 30.34, z: 0 });
    expect(x0[0]!.to).toEqual({ x: 0, y: 30.34, z: 2.44 });
    expect(x0[1]!.from).toEqual({ x: 0, y: 37.66, z: 0 });
    expect(x0[1]!.to).toEqual({ x: 0, y: 37.66, z: 2.44 });
    expect(x0[2]!.from).toEqual({ x: 0, y: 30.34, z: 2.44 });
    expect(x0[2]!.to).toEqual({ x: 0, y: 37.66, z: 2.44 });
    // x105 goal: mirrored.
    const x105 = goals.slice(3, 6);
    expect(x105[0]!.from.x).toBe(105);
    expect(x105[1]!.to).toEqual({ x: 105, y: 37.66, z: 2.44 });
  });

  test("penalty spots and the center mark are the spec's own points", () => {
    const dots = buildFieldGeometry(fixtureScene()).dots;
    expect(dots.map((dot) => [dot.kind, dot.center.x, dot.center.y])).toEqual([
      ["penalty-spot", 11, 34],
      ["penalty-spot", 94, 34],
      ["center-mark", 52.5, 34],
    ]);
    expect(FIELD_DOT_RADIUS_METERS).toBe(0.2);
  });

  test("corner arcs sweep INTO the pitch (the quadrant toward the center)", () => {
    const lines = buildFieldGeometry(fixtureScene()).lines.filter(
      (line) => line.kind === "corner-arc",
    );
    // x0y0 arc: 8 lines from (cos45, sin45)·1 around (0, 0) toward (105, 68).
    const x0y0 = lines.slice(0, CORNER_ARC_SEGMENTS);
    expect(x0y0[0]!.from.x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(x0y0[0]!.from.y).toBeCloseTo(Math.SQRT1_2, 5);
    expect(x0y0[0]!.from.z).toBe(0);
    // x105y0 arc: the quadrant points toward −x, +y.
    const x105y0 = lines.slice(CORNER_ARC_SEGMENTS, 2 * CORNER_ARC_SEGMENTS);
    expect(x105y0[0]!.from.x).toBeCloseTo(105 - Math.SQRT1_2, 5);
    expect(x105y0[0]!.from.y).toBeCloseTo(Math.SQRT1_2, 5);
  });

  test("penalty arcs bulge toward the pitch center and meet the area front line", () => {
    const lines = buildFieldGeometry(fixtureScene()).lines.filter(
      (line) => line.kind === "penalty-arc",
    );
    const x0 = lines.slice(0, PENALTY_ARC_SEGMENTS);
    // First polyline point: spot (11, 34) + 9.15·(cos, sin)(−acos(5.5/9.15)).
    expect(x0[0]!.from.x).toBeCloseTo(16.5, 5); // the penalty-area front line
    expect(x0[0]!.from.y).toBeCloseTo(34 - Math.sqrt(9.15 ** 2 - 5.5 ** 2), 4);
    // All arc points lie OUTSIDE the penalty area (x ≥ 16.5) — Law 1 semantics.
    for (const line of x0) {
      expect(line.from.x).toBeGreaterThanOrEqual(16.5 - 1e-6);
      expect(line.to.x).toBeGreaterThanOrEqual(16.5 - 1e-6);
    }
  });

  test("the center circle discretizes to 64 segments at the spec's 9.15 m radius", () => {
    const circle = buildFieldGeometry(fixtureScene()).lines.filter(
      (line) => line.kind === "center-circle",
    );
    expect(circle).toHaveLength(CIRCLE_SEGMENTS);
    // Every segment endpoint lies on the circle (radius check, center 52.5, 34).
    for (const line of circle) {
      for (const point of [line.from, line.to]) {
        expect(Math.hypot(point.x - 52.5, point.y - 34)).toBeCloseTo(9.15, 5);
      }
    }
  });

  test("mow stripes: 10 stripes of 10.5 m across the spec's bounds", () => {
    const stripes = buildFieldGeometry(fixtureScene()).polygons.filter(
      (polygon) => polygon.kind === "stripe",
    );
    expect(stripes[0]!.points.map((point) => point.x)).toEqual([0, 10.5, 10.5, 0]);
    expect(stripes[9]!.points.map((point) => point.x)).toEqual([94.5, 105, 105, 94.5]);
    // Alternating fills, deterministic parity.
    expect(stripes.map((stripe) => stripe.fill)).toEqual([
      "stripe-a",
      "stripe-b",
      "stripe-a",
      "stripe-b",
      "stripe-a",
      "stripe-b",
      "stripe-a",
      "stripe-b",
      "stripe-a",
      "stripe-b",
    ]);
  });

  test("camera slots are the spec's slots, cloned (framing selection is the caller's)", () => {
    const scene = fixtureScene();
    const field = buildFieldGeometry(scene);
    expect(field.cameraSlots).toEqual(CANONICAL_CAMERA_SLOTS.map((slot) => ({ ...slot })));
    // Fresh clones: mutating the field's slots never mutates the spec.
    field.cameraSlots[0]!.position.x = 999;
    expect(scene.cameraSlots[0]!.position.x).toBe(52.5);
  });
});

describe("buildFieldGeometry — purity", () => {
  test("deep-equal rerun over the same spec", () => {
    expect(buildFieldGeometry(fixtureScene())).toEqual(buildFieldGeometry(fixtureScene()));
  });

  test("the input scene is never mutated", () => {
    const scene = fixtureScene();
    const before = JSON.stringify(scene);
    buildFieldGeometry(scene);
    expect(JSON.stringify(scene)).toBe(before);
  });
});
