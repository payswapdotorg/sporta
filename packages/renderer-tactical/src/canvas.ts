/**
 * The pure-TypeScript pixel compositor the tactical renderer owns (R301).
 *
 * A `FrameBuffer` is a plain RGB24 raster (width × height × 3 bytes, no
 * alpha, no dependencies, no canvas API, no GPU): every drawing primitive is
 * deterministic integer math (scanline fills, Bresenham lines, midpoint
 * circles). The same buffer contents always serialize to the same bytes, so
 * the encoded artifact is a pure function of the drawn scene. No
 * anti-aliasing by design — hard pixel edges keep every frame bit-exact.
 *
 * This module is I/O-free and clock-free; it never touches the filesystem.
 */
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphOf } from "./font";

/** An RGB color (each channel 0-255). */
export type Rgb = readonly [number, number, number];

/** Clamps a channel value to [0, 255]. */
function clampChannel(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

/** Clamps all channels of a color. */
export function clampColor(color: Rgb): Rgb {
  return [clampChannel(color[0]), clampChannel(color[1]), clampChannel(color[2])];
}

/**
 * Lightens `color` by `amount` (0-255 added per channel, clamped) — used for
 * pitch mowing stripes and overlay panels.
 */
export function lighten(color: Rgb, amount: number): Rgb {
  return clampColor([color[0] + amount, color[1] + amount, color[2] + amount]);
}

/** Darkens `color` by `amount` (0-255 subtracted per channel, clamped). */
export function darken(color: Rgb, amount: number): Rgb {
  return clampColor([color[0] - amount, color[1] - amount, color[2] - amount]);
}

/** Blends `over` onto `under` with alpha in [0, 1] (no gamma tricks). */
export function blend(under: Rgb, over: Rgb, alpha: number): Rgb {
  const a = Math.min(1, Math.max(0, alpha));
  return clampColor([
    under[0] + (over[0] - under[0]) * a,
    under[1] + (over[1] - under[1]) * a,
    under[2] + (over[2] - under[2]) * a,
  ]);
}

/**
 * An RGB24 raster with deterministic integer drawing primitives. Coordinates
 * are pixel-space (x right, y down); all shapes are clipped to the buffer —
 * drawing outside is a no-op, never an error.
 */
export class FrameBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number, fill: Rgb = [0, 0, 0]) {
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      throw new RangeError(
        `FrameBuffer dimensions must be positive integers (got ${width}x${height})`,
      );
    }
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 3);
    this.fill(fill);
  }

  /** Fills the whole buffer with one color. */
  fill(color: Rgb): void {
    for (let i = 0; i < this.data.length; i += 3) {
      this.data[i] = color[0];
      this.data[i + 1] = color[1];
      this.data[i + 2] = color[2];
    }
  }

  /** Sets one pixel (out-of-bounds is a no-op). */
  setPixel(x: number, y: number, color: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const offset = (y * this.width + x) * 3;
    this.data[offset] = color[0];
    this.data[offset + 1] = color[1];
    this.data[offset + 2] = color[2];
  }

  /** Reads one pixel (out-of-bounds reads black). */
  getPixel(x: number, y: number): Rgb {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return [0, 0, 0];
    const offset = (y * this.width + x) * 3;
    return [this.data[offset]!, this.data[offset + 1]!, this.data[offset + 2]!];
  }

  /** Fills an axis-aligned rectangle (clipped). */
  fillRect(x: number, y: number, w: number, h: number, color: Rgb): void {
    const x0 = Math.max(0, Math.trunc(x));
    const y0 = Math.max(0, Math.trunc(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let py = y0; py < y1; py += 1) {
      let offset = (py * this.width + x0) * 3;
      for (let px = x0; px < x1; px += 1) {
        this.data[offset] = color[0];
        this.data[offset + 1] = color[1];
        this.data[offset + 2] = color[2];
        offset += 3;
      }
    }
  }

  /** Strokes a 1-pixel rectangle border (clipped). */
  strokeRect(x: number, y: number, w: number, h: number, color: Rgb): void {
    const x0 = Math.trunc(x);
    const y0 = Math.trunc(y);
    const x1 = Math.trunc(x + w) - 1;
    const y1 = Math.trunc(y + h) - 1;
    for (let px = x0; px <= x1; px += 1) {
      this.setPixel(px, y0, color);
      this.setPixel(px, y1, color);
    }
    for (let py = y0; py <= y1; py += 1) {
      this.setPixel(x0, py, color);
      this.setPixel(x1, py, color);
    }
  }

  /** Fills a circle (midpoint scanlines, clipped). */
  fillCircle(cx: number, cy: number, radius: number, color: Rgb): void {
    const r = Math.max(0, radius);
    const cxi = Math.round(cx);
    const cyi = Math.round(cy);
    const ri = Math.round(r);
    for (let dy = -ri; dy <= ri; dy += 1) {
      const span = Math.floor(Math.sqrt(Math.max(0, ri * ri - dy * dy)));
      const y = cyi + dy;
      if (y < 0 || y >= this.height) continue;
      const from = Math.max(0, cxi - span);
      const to = Math.min(this.width - 1, cxi + span);
      let offset = (y * this.width + from) * 3;
      for (let px = from; px <= to; px += 1) {
        this.data[offset] = color[0];
        this.data[offset + 1] = color[1];
        this.data[offset + 2] = color[2];
        offset += 3;
      }
    }
  }

  /** Strokes a 1-pixel circle outline (midpoint algorithm, clipped). */
  strokeCircle(cx: number, cy: number, radius: number, color: Rgb): void {
    const ri = Math.round(Math.max(0, radius));
    if (ri === 0) {
      this.setPixel(Math.round(cx), Math.round(cy), color);
      return;
    }
    const cxi = Math.round(cx);
    const cyi = Math.round(cy);
    let x = ri;
    let y = 0;
    let err = 1 - ri;
    while (x >= y) {
      this.setPixel(cxi + x, cyi + y, color);
      this.setPixel(cxi + y, cyi + x, color);
      this.setPixel(cxi - y, cyi + x, color);
      this.setPixel(cxi - x, cyi + y, color);
      this.setPixel(cxi - x, cyi - y, color);
      this.setPixel(cxi - y, cyi - x, color);
      this.setPixel(cxi + y, cyi - x, color);
      this.setPixel(cxi + x, cyi - y, color);
      y += 1;
      if (err < 0) {
        err += 2 * y + 1;
      } else {
        x -= 1;
        err += 2 * (y - x) + 1;
      }
    }
  }

  /** Strokes a dashed 1-pixel circle (used for uncertainty rings). */
  strokeCircleDashed(
    cx: number,
    cy: number,
    radius: number,
    color: Rgb,
    dashLength = 4,
    gapLength = 3,
  ): void {
    const ri = Math.round(Math.max(0, radius));
    const cxi = Math.round(cx);
    const cyi = Math.round(cy);
    const period = Math.max(1, dashLength + gapLength);
    // Walk the full 360° by sampling the parametric circle at fine steps; the
    // dash phase is the accumulated arc length in pixels (deterministic).
    const steps = Math.max(16, Math.ceil(2 * Math.PI * ri * 2));
    let arc = 0;
    let previousX = cxi + ri;
    let previousY = cyi;
    for (let i = 1; i <= steps; i += 1) {
      const angle = (2 * Math.PI * i) / steps;
      const x = Math.round(cxi + ri * Math.cos(angle));
      const y = Math.round(cyi + ri * Math.sin(angle));
      arc += Math.max(Math.abs(x - previousX), Math.abs(y - previousY));
      previousX = x;
      previousY = y;
      if (arc % period < dashLength) {
        this.setPixel(x, y, color);
      }
    }
  }

  /** Draws a 1-pixel line (Bresenham, clipped). */
  drawLine(x0: number, y0: number, x1: number, y1: number, color: Rgb): void {
    let ax = Math.round(x0);
    let ay = Math.round(y0);
    const bx = Math.round(x1);
    const by = Math.round(y1);
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.setPixel(ax, ay, color);
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ay += sy;
      }
    }
  }

  /**
   * Draws text with the 5×7 font at integer `scale` (1 = 5×7 px per glyph,
   * one blank column between glyphs). Returns the text width in pixels.
   */
  drawText(x: number, y: number, text: string, color: Rgb, scale = 1): number {
    let cursorX = Math.round(x);
    const cursorY = Math.round(y);
    for (const ch of text) {
      const glyph = glyphOf(ch);
      for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
        const bits = glyph[row]!;
        for (let col = 0; col < GLYPH_WIDTH; col += 1) {
          if ((bits >> (GLYPH_WIDTH - 1 - col)) & 1) {
            if (scale === 1) {
              this.setPixel(cursorX + col, cursorY + row, color);
            } else {
              this.fillRect(cursorX + col * scale, cursorY + row * scale, scale, scale, color);
            }
          }
        }
      }
      cursorX += (GLYPH_WIDTH + 1) * scale;
    }
    return cursorX - Math.round(x) - scale; // exclude the trailing gap column
  }
}
