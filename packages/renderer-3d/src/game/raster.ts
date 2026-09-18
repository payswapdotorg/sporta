/**
 * The deterministic software rasterizer of the reference 3D engine — the
 * pixel layer `Software3DEngine` renders every frame through.
 *
 * Design posture (documented decision record):
 *
 * - **Typed arrays, no allocations in the hot path.** One `Framebuffer`
 *   owns an interleaved rgb24 `Uint8Array` and is REUSED across every
 *   frame of a render; all primitives write in place. No `Math.random`,
 *   no clocks, no I/O — the same draw calls produce byte-identical pixels
 *   (the determinism the tests pin by hashing the staged frame stream).
 * - **Painter's algorithm with analytic depth ordering.** The ground plane
 *   is drawn first (it is behind every entity for every supported camera),
 *   then ground overlays (markings, shadows, rings), then entities sorted
 *   far→near by camera-space depth of their base point. This is exact for
 *   the engine's scene vocabulary (a ground plane + camera-facing convex
 *   billboards) and needs no z-buffer.
 * - **No anti-aliasing — a documented presentation constant.** Both styles
 *   read as intentional pixel art of a stylized game view; the cel style
 *   in particular WANTS hard edges (post-pass edge detection turns them
 *   into the bold manga outlines).
 * - **Perspective-correct world geometry.** Pitch quads and line
 *   thicknesses are computed in WORLD meters and projected through the
 *   pinhole camera (see `./camera.ts`), so depth cues (size falloff,
 *   foreshortening) are honest perspective artifacts, never decorations.
 */
import type { Vec3 } from "../internal";

/** An rgb color (each channel 0–255). */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Clamps a channel value into [0, 255] and floors it to an integer. */
function channelByte(value: number): number {
  const v = value < 0 ? 0 : value > 255 ? 255 : value;
  return v | 0;
}

/** Makes a color from three floats (clamped, floored). */
export function rgb(r: number, g: number, b: number): Rgb {
  return { r: channelByte(r), g: channelByte(g), b: channelByte(b) };
}

/** Linearly blends two colors (`t = 0` → `a`, `t = 1` → `b`). */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: channelByte(a.r + (b.r - a.r) * t),
    g: channelByte(a.g + (b.g - a.g) * t),
    b: channelByte(a.b + (b.b - a.b) * t),
  };
}

/** Darkens a color toward black by `amount` (0 none, 1 black). */
export function shade(color: Rgb, amount: number): Rgb {
  return mixRgb(color, rgb(0, 0, 0), amount);
}

/** Lightens a color toward white by `amount` (0 none, 1 white). */
export function tint(color: Rgb, amount: number): Rgb {
  return mixRgb(color, rgb(255, 255, 255), amount);
}

/** Quantizes each channel to `levels` evenly spaced steps (posterization). */
export function posterize(color: Rgb, levels: number): Rgb {
  if (levels < 2) return color;
  const step = 255 / (levels - 1);
  return {
    r: channelByte(Math.round(color.r / step) * step),
    g: channelByte(Math.round(color.g / step) * step),
    b: channelByte(Math.round(color.b / step) * step),
  };
}

/**
 * The reusable rgb24 framebuffer. `width` × `height` pixels, row-major,
 * three bytes per pixel. All draw methods clip to the canvas — no write
 * can ever escape the buffer.
 */
export class Framebuffer {
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;

  constructor(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new RangeError(`Framebuffer: dimensions must be positive integers`);
    }
    this.width = width;
    this.height = height;
    this.bytes = new Uint8Array(width * height * 3);
  }

  /** Writes one pixel (coordinates clipped silently). */
  setPixel(x: number, y: number, color: Rgb): void {
    const px = x | 0;
    const py = y | 0;
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const o = (py * this.width + px) * 3;
    this.bytes[o] = color.r;
    this.bytes[o + 1] = color.g;
    this.bytes[o + 2] = color.b;
  }

  /** Blends one pixel over the existing color (`t = 1` fully opaque). */
  blendPixel(x: number, y: number, color: Rgb, t: number): void {
    const px = x | 0;
    const py = y | 0;
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const o = (py * this.width + px) * 3;
    const r0 = this.bytes[o] ?? 0;
    const g0 = this.bytes[o + 1] ?? 0;
    const b0 = this.bytes[o + 2] ?? 0;
    this.bytes[o] = channelByte(r0 + (color.r - r0) * t);
    this.bytes[o + 1] = channelByte(g0 + (color.g - g0) * t);
    this.bytes[o + 2] = channelByte(b0 + (color.b - b0) * t);
  }

  /** Reads one pixel (out of canvas reads black). */
  pixel(x: number, y: number): Rgb {
    const px = x | 0;
    const py = y | 0;
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return rgb(0, 0, 0);
    const o = (py * this.width + px) * 3;
    return { r: this.bytes[o] ?? 0, g: this.bytes[o + 1] ?? 0, b: this.bytes[o + 2] ?? 0 };
  }

  /** Clears the whole canvas to one color. */
  clear(color: Rgb): void {
    const { bytes } = this;
    for (let i = 0; i < bytes.length; i += 3) {
      bytes[i] = color.r;
      bytes[i + 1] = color.g;
      bytes[i + 2] = color.b;
    }
  }

  /** Clears with a vertical gradient (top → bottom), one color per row. */
  clearGradient(top: Rgb, bottom: Rgb): void {
    const { bytes, height } = this;
    for (let y = 0; y < height; y += 1) {
      const t = height === 1 ? 0 : y / (height - 1);
      const r = channelByte(top.r + (bottom.r - top.r) * t);
      const g = channelByte(top.g + (bottom.g - top.g) * t);
      const b = channelByte(top.b + (bottom.b - top.b) * t);
      let o = y * this.width * 3;
      for (let x = 0; x < this.width; x += 1) {
        bytes[o] = r;
        bytes[o + 1] = g;
        bytes[o + 2] = b;
        o += 3;
      }
    }
  }

  /** Fills an axis-aligned rectangle. */
  fillRect(x: number, y: number, w: number, h: number, color: Rgb): void {
    const x0 = Math.max(0, Math.ceil(x));
    const y0 = Math.max(0, Math.ceil(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let py = y0; py < y1; py += 1) {
      let o = (py * this.width + x0) * 3;
      for (let px = x0; px < x1; px += 1) {
        this.bytes[o] = color.r;
        this.bytes[o + 1] = color.g;
        this.bytes[o + 2] = color.b;
        o += 3;
      }
    }
  }

  /** Fills an axis-aligned rectangle with a vertical color ramp. */
  fillRectGradient(x: number, y: number, w: number, h: number, top: Rgb, bottom: Rgb): void {
    const x0 = Math.max(0, Math.ceil(x));
    const y0 = Math.max(0, Math.ceil(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    const span = Math.max(1, y1 - y0 - 1);
    for (let py = y0; py < y1; py += 1) {
      const t = (py - y0) / span;
      const c = mixRgb(top, bottom, t);
      let o = (py * this.width + x0) * 3;
      for (let px = x0; px < x1; px += 1) {
        this.bytes[o] = c.r;
        this.bytes[o + 1] = c.g;
        this.bytes[o + 2] = c.b;
        o += 3;
      }
    }
  }

  /**
   * Fills an ellipse (axis-aligned in screen space). Ground shadows,
   * rings, the ball, and avatar heads use this.
   */
  fillEllipse(cx: number, cy: number, rx: number, ry: number, color: Rgb): void {
    if (rx <= 0 || ry <= 0) return;
    const x0 = Math.max(0, Math.ceil(cx - rx));
    const x1 = Math.min(this.width, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.ceil(cy - ry));
    const y1 = Math.min(this.height, Math.ceil(cy + ry));
    const invRx = 1 / (rx * rx);
    const invRy = 1 / (ry * ry);
    for (let py = y0; py < y1; py += 1) {
      const dy = py + 0.5 - cy;
      const yy = dy * dy * invRy;
      let o = (py * this.width + x0) * 3;
      for (let px = x0; px < x1; px += 1) {
        const dx = px + 0.5 - cx;
        if (dx * dx * invRx + yy <= 1) {
          this.bytes[o] = color.r;
          this.bytes[o + 1] = color.g;
          this.bytes[o + 2] = color.b;
        }
        o += 3;
      }
    }
  }

  /** Blends an ellipse over the canvas (soft shadows, trails, glows). */
  blendEllipse(cx: number, cy: number, rx: number, ry: number, color: Rgb, t: number): void {
    if (rx <= 0 || ry <= 0 || t <= 0) return;
    const alpha = t > 1 ? 1 : t;
    const x0 = Math.max(0, Math.ceil(cx - rx));
    const x1 = Math.min(this.width, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.ceil(cy - ry));
    const y1 = Math.min(this.height, Math.ceil(cy + ry));
    const invRx = 1 / (rx * rx);
    const invRy = 1 / (ry * ry);
    for (let py = y0; py < y1; py += 1) {
      const dy = py + 0.5 - cy;
      const yy = dy * dy * invRy;
      let o = (py * this.width + x0) * 3;
      for (let px = x0; px < x1; px += 1) {
        const dx = px + 0.5 - cx;
        if (dx * dx * invRx + yy <= 1) {
          const r0 = this.bytes[o] ?? 0;
          const g0 = this.bytes[o + 1] ?? 0;
          const b0 = this.bytes[o + 2] ?? 0;
          this.bytes[o] = channelByte(r0 + (color.r - r0) * alpha);
          this.bytes[o + 1] = channelByte(g0 + (color.g - g0) * alpha);
          this.bytes[o + 2] = channelByte(b0 + (color.b - b0) * alpha);
        }
        o += 3;
      }
    }
  }

  /**
   * Fills a triangle with per-vertex colors interpolated affinely in
   * screen space (Gouraud-style). This is the workhorse for every
   * perspective-projected world quad (pitch stripes, markings, goals):
   * world-space thickness and foreshortening come from the projected
   * vertex positions; the affine color ramp is the documented shading
   * approximation of the reference engine.
   */
  fillTriangleGouraud(
    p0: ScreenPoint,
    p1: ScreenPoint,
    p2: ScreenPoint,
    c0: Rgb,
    c1: Rgb,
    c2: Rgb,
  ): void {
    // Bounding box clipped to the canvas.
    const minX = Math.max(0, Math.ceil(Math.min(p0.x, p1.x, p2.x)));
    const maxX = Math.min(this.width - 1, Math.floor(Math.max(p0.x, p1.x, p2.x)));
    const minY = Math.max(0, Math.ceil(Math.min(p0.y, p1.y, p2.y)));
    const maxY = Math.min(this.height - 1, Math.floor(Math.max(p0.y, p1.y, p2.y)));
    if (minX > maxX || minY > maxY) return;

    // Edge functions (double area signs).
    const area = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
    if (area === 0) return; // degenerate (all three points collinear)
    const invArea = 1 / area;
    const e01dx = p1.x - p0.x;
    const e01dy = p1.y - p0.y;
    const e12dx = p2.x - p1.x;
    const e12dy = p2.y - p1.y;
    const e20dx = p0.x - p2.x;
    const e20dy = p0.y - p2.y;

    for (let py = minY; py <= maxY; py += 1) {
      const y = py + 0.5;
      let o = (py * this.width + minX) * 3;
      for (let px = minX; px <= maxX; px += 1) {
        const x = px + 0.5;
        // Edge functions (barycentric numerators): edge(a→b, p) =
        // (b.x−a.x)·(p.y−a.y) − (b.y−a.y)·(p.x−a.x); divided by the signed
        // area they sum to 1 INSIDE the triangle with matching signs.
        const w0 = e12dx * (y - p1.y) - e12dy * (x - p1.x);
        const w1 = e20dx * (y - p2.y) - e20dy * (x - p2.x);
        const w2 = e01dx * (y - p0.y) - e01dy * (x - p0.x);
        const s0 = w0 * invArea;
        const s1 = w1 * invArea;
        const s2 = w2 * invArea;
        // Interior test: all barycentrics share the area's sign.
        if ((s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0)) {
          const r = s0 * c0.r + s1 * c1.r + s2 * c2.r;
          const g = s0 * c0.g + s1 * c1.g + s2 * c2.g;
          const b = s0 * c0.b + s1 * c1.b + s2 * c2.b;
          this.bytes[o] = channelByte(r);
          this.bytes[o + 1] = channelByte(g);
          this.bytes[o + 2] = channelByte(b);
        }
        o += 3;
      }
    }
  }

  /** Fills a convex polygon (fan triangulation) with one flat color. */
  fillConvexPolygon(points: readonly ScreenPoint[], color: Rgb): void {
    for (let i = 1; i < points.length - 1; i += 1) {
      this.fillTriangleGouraud(points[0]!, points[i]!, points[i + 1]!, color, color, color);
    }
  }

  /**
   * Draws a screen-space thick line (rounded caps) — HUD rules, goal
   * frames, and the cel style's speed-line accents. Thickness is in
   * pixels; the walk is a distance-to-segment test over the bounding box.
   */
  drawThickLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    thickness: number,
    color: Rgb,
    alpha = 1,
  ): void {
    const half = Math.max(0.5, thickness / 2);
    const minX = Math.max(0, Math.ceil(Math.min(x0, x1) - half));
    const maxX = Math.min(this.width - 1, Math.floor(Math.max(x0, x1) + half));
    const minY = Math.max(0, Math.ceil(Math.min(y0, y1) - half));
    const maxY = Math.min(this.height - 1, Math.floor(Math.max(y0, y1) + half));
    if (minX > maxX || minY > maxY) return;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lenSq = dx * dx + dy * dy;
    const write = alpha >= 1 ? "set" : "blend";
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const x = px + 0.5;
        const y = py + 0.5;
        let t = 0;
        if (lenSq > 0) {
          t = ((x - x0) * dx + (y - y0) * dy) / lenSq;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
        }
        const ex = x0 + t * dx - x;
        const ey = y0 + t * dy - y;
        if (ex * ex + ey * ey <= half * half) {
          if (write === "set") this.setPixel(px, py, color);
          else this.blendPixel(px, py, color, alpha);
        }
      }
    }
  }

  /**
   * Draws a screen-space thick polyline through the given points (each
   * segment gets rounded caps; joints overlap seamlessly).
   */
  drawThickPolyline(
    points: readonly ScreenPoint[],
    thickness: number,
    color: Rgb,
    alpha = 1,
  ): void {
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i]!;
      const b = points[i + 1]!;
      this.drawThickLine(a.x, a.y, b.x, b.y, thickness, color, alpha);
    }
  }
}

/** A point in screen (raster) coordinates — y grows down, like the canvas. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** A screen point carrying its camera-space depth (meters). */
export interface DepthScreenPoint extends ScreenPoint {
  depth: number;
}

/** Projects world-space z-up scene coordinates onto the screen (see camera). */
export interface ProjectionCamera {
  /** Projects a world point; `null` when behind the near plane. */
  project(point: Vec3): DepthScreenPoint | null;
}
