import { describe, expect, test } from "bun:test";
import { FrameBuffer, blend, darken, lighten } from "../src/canvas";
import { measureText } from "../src/font";

describe("FrameBuffer primitives (pure-TS compositor)", () => {
  test("fillRect fills exactly the requested clipped region", () => {
    const buffer = new FrameBuffer(16, 8, [0, 0, 0]);
    buffer.fillRect(2, 2, 4, 3, [10, 20, 30]);
    expect(buffer.getPixel(2, 2)).toEqual([10, 20, 30]);
    expect(buffer.getPixel(5, 4)).toEqual([10, 20, 30]);
    expect(buffer.getPixel(6, 2)).toEqual([0, 0, 0]);
    expect(buffer.getPixel(2, 5)).toEqual([0, 0, 0]);
  });

  test("fillCircle fills a centered disc and nothing else", () => {
    const buffer = new FrameBuffer(21, 21, [0, 0, 0]);
    buffer.fillCircle(10, 10, 5, [200, 10, 10]);
    expect(buffer.getPixel(10, 10)).toEqual([200, 10, 10]);
    expect(buffer.getPixel(14, 10)).toEqual([200, 10, 10]);
    expect(buffer.getPixel(16, 10)).toEqual([0, 0, 0]);
  });

  test("strokeCircle draws an empty ring (no fill)", () => {
    const buffer = new FrameBuffer(21, 21, [0, 0, 0]);
    buffer.strokeCircle(10, 10, 5, [255, 255, 255]);
    expect(buffer.getPixel(10, 5)).toEqual([255, 255, 255]);
    expect(buffer.getPixel(10, 10)).toEqual([0, 0, 0]);
  });

  test("drawLine connects both endpoints (Bresenham)", () => {
    const buffer = new FrameBuffer(20, 20, [0, 0, 0]);
    buffer.drawLine(2, 2, 12, 7, [9, 9, 9]);
    expect(buffer.getPixel(2, 2)).toEqual([9, 9, 9]);
    expect(buffer.getPixel(12, 7)).toEqual([9, 9, 9]);
  });

  test("drawText renders the pinned glyph pattern of '1'", () => {
    const buffer = new FrameBuffer(40, 12, [0, 0, 0]);
    buffer.drawText(0, 0, "1", [255, 255, 255]);
    // The '1' glyph: col 2 in row 0, cols 1-2 in row 1, col 2 in rows 2-5,
    // cols 1-3 in the base row 6.
    expect(buffer.getPixel(2, 0)).toEqual([255, 255, 255]);
    expect(buffer.getPixel(1, 1)).toEqual([255, 255, 255]);
    expect(buffer.getPixel(2, 5)).toEqual([255, 255, 255]);
    expect(buffer.getPixel(1, 6)).toEqual([255, 255, 255]);
    expect(buffer.getPixel(3, 6)).toEqual([255, 255, 255]);
    expect(buffer.getPixel(0, 6)).toEqual([0, 0, 0]);
    expect(buffer.getPixel(4, 6)).toEqual([0, 0, 0]);
  });

  test("drawText at scale 2 doubles the pixel block", () => {
    const buffer = new FrameBuffer(60, 20, [0, 0, 0]);
    const width = buffer.drawText(0, 0, "7", [255, 0, 0], 2);
    expect(width).toBe(measureText("7", 2).width);
    // The '7' glyph: row 0 spans all columns; row 1 (0x01) keeps only
    // col 4; row 2 (0x02) keeps only col 3 — at scale 2 each glyph row is
    // 2 px tall and each column 2 px wide.
    expect(buffer.getPixel(9, 0)).toEqual([255, 0, 0]);
    expect(buffer.getPixel(0, 1)).toEqual([255, 0, 0]);
    expect(buffer.getPixel(9, 2)).toEqual([255, 0, 0]);
    expect(buffer.getPixel(0, 4)).toEqual([0, 0, 0]);
    expect(buffer.getPixel(6, 4)).toEqual([255, 0, 0]);
    expect(buffer.getPixel(9, 4)).toEqual([0, 0, 0]);
  });

  test("measureText counts one blank column between glyphs", () => {
    expect(measureText("AB", 1).width).toBe(11);
    expect(measureText("", 1).width).toBe(0);
    expect(measureText("0", 1).width).toBe(5);
  });

  test("color helpers clamp channels", () => {
    expect(lighten([200, 200, 200], 100)).toEqual([255, 255, 255]);
    expect(darken([10, 10, 10], 100)).toEqual([0, 0, 0]);
    expect(blend([0, 0, 0], [100, 100, 100], 0.5)).toEqual([50, 50, 50]);
  });

  test("determinism: the same draw sequence yields identical bytes", () => {
    const paint = (): Uint8Array => {
      const buffer = new FrameBuffer(64, 48, [1, 2, 3]);
      buffer.fillCircle(30, 20, 9, [90, 60, 30]);
      buffer.strokeCircleDashed(30, 20, 12, [255, 255, 255]);
      buffer.drawLine(0, 0, 63, 47, [8, 8, 8]);
      buffer.drawText(2, 2, "GOAL 12:34", [240, 200, 74], 1);
      buffer.fillRect(10, 30, 20, 8, [42, 96, 48]);
      return buffer.data;
    };
    const first = paint();
    const second = paint();
    expect(first.length).toBe(64 * 48 * 3);
    expect(Buffer.compare(Buffer.from(first), Buffer.from(second))).toBe(0);
  });
});
