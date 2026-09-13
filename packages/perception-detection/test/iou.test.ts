import { describe, expect, test } from "bun:test";
import type { NormalizedBox } from "../src/detector";
import { iou } from "../src/benchmark";

const box = (x: number, y: number, w: number, h: number): NormalizedBox => ({ x, y, w, h });

describe("iou", () => {
  test("identical non-degenerate boxes -> exactly 1", () => {
    const a = box(0.1, 0.2, 0.3, 0.4);
    expect(iou(a, { ...a })).toBe(1);
  });

  test("identical degenerate (zero-area) boxes -> 1 (documented 0/0 convention)", () => {
    const a = box(0.5, 0.5, 0, 0);
    expect(iou(a, { ...a })).toBe(1);
  });

  test("disjoint boxes -> 0", () => {
    expect(iou(box(0, 0, 0.2, 0.2), box(0.5, 0.5, 0.2, 0.2))).toBe(0);
  });

  test("hand-computed partial overlap: (0,0,.5,.5) vs (.25,.25,.5,.5) -> 1/7", () => {
    // inter = 0.25 * 0.25 = 0.0625; union = 0.25 + 0.25 - 0.0625 = 0.4375;
    // iou = 0.0625 / 0.4375 = 1/7 = 0.142857142857...
    const a = box(0, 0, 0.5, 0.5);
    const b = box(0.25, 0.25, 0.5, 0.5);
    expect(iou(a, b)).toBeCloseTo(1 / 7, 15);
    expect(iou(a, b)).toBeCloseTo(0.142857142857, 11);
  });

  test("boxes extending past the frame edge are clamped to the unit square", () => {
    // a: x-extent [0.9, 1.4] clamps to [0.9, 1] -> effective width 0.1
    // b: x-extent [0.95, 1.45] clamps to [0.95, 1] -> effective width 0.05
    // inter = 0.05 * 0.5 = 0.025; union = 0.05 + 0.025 - 0.025 = 0.05 -> 0.5.
    // (WITHOUT edge clamping this pair would compute ~0.818, so the asserted
    // value proves the clamp.)
    const a = box(0.9, 0, 0.5, 0.5);
    const b = box(0.95, 0, 0.5, 0.5);
    expect(iou(a, b)).toBeCloseTo(0.5, 10);
  });

  test("containment: big box fully containing small box", () => {
    // inter = 0.3 * 0.3 = 0.09; union = 1 + 0.09 - 0.09 = 1 -> 0.09.
    expect(iou(box(0, 0, 1, 1), box(0.2, 0.2, 0.3, 0.3))).toBeCloseTo(0.09, 10);
  });

  test("boxes touching at an edge have zero overlap -> 0", () => {
    expect(iou(box(0, 0, 0.5, 0.5), box(0.5, 0, 0.5, 0.5))).toBe(0);
  });

  test("zero-area box against an overlapping non-zero box -> 0", () => {
    // The zero-area box contributes no intersection; union is positive.
    expect(iou(box(0.5, 0.5, 0, 0), box(0.4, 0.4, 0.2, 0.2))).toBe(0);
  });

  test("distinct zero-area boxes -> 0; same-position different-extent -> 0", () => {
    expect(iou(box(0.1, 0.1, 0, 0), box(0.9, 0.9, 0, 0))).toBe(0);
    // Both zero-width, same left/top/right edges but different bottom edges.
    expect(iou(box(0.5, 0.5, 0, 0.2), box(0.5, 0.5, 0, 0.3))).toBe(0);
  });

  test("symmetric: iou(a, b) === iou(b, a)", () => {
    const a = box(0.1, 0.1, 0.4, 0.4);
    const b = box(0.3, 0.2, 0.5, 0.5);
    expect(iou(a, b)).toBe(iou(b, a));
  });
});
