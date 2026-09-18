/**
 * The software 3D-ish raster core the game-engine adapter owns (R302).
 *
 * A tiny, fully deterministic software renderer: a look-at perspective
 * camera, a z-buffered triangle rasterizer, screen-space line drawing, and
 * integer pixel output (RGB24). No GPU, no engine binaries, no external
 * rendering services — the same scene plus the same style always rasterize
 * to byte-identical frames.
 *
 * This is deliberately NOT a full game engine: it is the in-repo
 * deterministic software compositor behind the frozen `GameEngineAdapter`
 * seam (headless Godot 4 is the documented next-wave engine candidate — the
 * seam keeps that swap invisible to product code).
 */

/** A 3D vector (scene space: meters, right-handed, z up). */
export type Vec3 = readonly [number, number, number];

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

/** Linear interpolation of two colors. */
export function lerpColor(a: Rgb, b: Rgb, t: number): Rgb {
  return clampColor([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/** Vector helpers (pure functions, no classes). */
export const vec3 = {
  sub(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  },
  cross(a: Vec3, b: Vec3): Vec3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  },
  dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  },
  length(a: Vec3): number {
    return Math.sqrt(vec3.dot(a, a));
  },
  normalize(a: Vec3): Vec3 {
    const length = vec3.length(a);
    if (length === 0) return [0, 0, 0];
    return [a[0] / length, a[1] / length, a[2] / length];
  },
};

/** A look-at perspective camera. */
export interface Camera {
  position: Vec3;
  target: Vec3;
  /** The vertical field of view, radians. */
  fovRadians: number;
}

/** The precomputed camera basis (right/up/forward + projection constants). */
interface CameraBasis {
  position: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  tanHalfFov: number;
  aspect: number;
  width: number;
  height: number;
}

/** The near-plane distance (meters); closer points are clipped. */
const NEAR = 0.1;

/** Builds the camera basis for a raster target. */
function cameraBasis(camera: Camera, width: number, height: number): CameraBasis {
  const forward = vec3.normalize(vec3.sub(camera.target, camera.position));
  const worldUp: Vec3 = [0, 0, 1];
  let right = vec3.cross(forward, worldUp);
  if (vec3.length(right) < 1e-6) {
    // Looking straight up/down: pick an arbitrary horizontal right vector.
    right = vec3.normalize(vec3.cross(forward, [0, 1, 0]));
  } else {
    right = vec3.normalize(right);
  }
  const up = vec3.normalize(vec3.cross(right, forward));
  return {
    position: camera.position,
    right,
    up,
    forward,
    tanHalfFov: Math.tan(camera.fovRadians / 2),
    aspect: width / height,
    width,
    height,
  };
}

/** A projected vertex: screen pixel coordinates + camera-space depth. */
export interface ProjectedVertex {
  x: number;
  y: number;
  /** Camera-space depth (smaller = closer to the camera). */
  z: number;
}

/** Projects one scene-space point to the screen (null when behind the near plane). */
function projectPoint(basis: CameraBasis, point: Vec3): ProjectedVertex | null {
  const d = vec3.sub(point, basis.position);
  const z = vec3.dot(d, basis.forward);
  if (z <= NEAR) return null;
  const camX = vec3.dot(d, basis.right);
  const camY = vec3.dot(d, basis.up);
  const ndcX = camX / (z * basis.tanHalfFov * basis.aspect);
  const ndcY = camY / (z * basis.tanHalfFov);
  return {
    x: ((ndcX + 1) / 2) * basis.width,
    y: ((1 - ndcY) / 2) * basis.height,
    z,
  };
}

/** A z-buffered RGB24 raster target with triangle + line primitives. */
export class DepthRaster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  private readonly depth: Float64Array;
  private basis: CameraBasis;

  constructor(width: number, height: number, camera: Camera, clear: Rgb) {
    if (!Number.isInteger(width) || width < 8 || !Number.isInteger(height) || height < 8) {
      throw new RangeError(`raster dimensions must be integers >= 8 (got ${width}x${height})`);
    }
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 3);
    this.depth = new Float64Array(width * height).fill(Number.POSITIVE_INFINITY);
    this.basis = cameraBasis(camera, width, height);
    for (let i = 0; i < this.data.length; i += 3) {
      this.data[i] = clear[0];
      this.data[i + 1] = clear[1];
      this.data[i + 2] = clear[2];
    }
  }

  /** Projects a scene point (null when clipped). */
  project(point: Vec3): ProjectedVertex | null {
    return projectPoint(this.basis, point);
  }

  /** Reads one pixel (out-of-bounds reads black). */
  getPixel(x: number, y: number): Rgb {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return [0, 0, 0];
    const offset = (y * this.width + x) * 3;
    return [this.data[offset]!, this.data[offset + 1]!, this.data[offset + 2]!];
  }

  /** Sets one pixel (out-of-bounds is a no-op). */
  setPixel(x: number, y: number, color: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const offset = (y * this.width + x) * 3;
    this.data[offset] = color[0];
    this.data[offset + 1] = color[1];
    this.data[offset + 2] = color[2];
  }

  /**
   * Fills one z-buffered triangle from three projected vertices. Back-face
   * culling is the caller's concern (the caller orders vertices
   * counter-clockwise in screen space for front faces).
   */
  fillTriangle(a: ProjectedVertex, b: ProjectedVertex, c: ProjectedVertex, color: Rgb): void {
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    if (minX > maxX || minY > maxY) return;
    const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (Math.abs(area) < 1e-9) return; // degenerate sliver
    const invArea = 1 / area;
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const w0 = ((b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y)) * invArea;
        const w1 = ((px - a.x) * (c.y - a.y) - (c.x - a.x) * (py - a.y)) * invArea;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        // w0 = weight of C, w1 = weight of B, w2 = weight of A.
        const z = w0 * c.z + w1 * b.z + w2 * a.z;
        const index = py * this.width + px;
        if (z >= this.depth[index]!) continue;
        this.depth[index] = z;
        const offset = index * 3;
        this.data[offset] = color[0];
        this.data[offset + 1] = color[1];
        this.data[offset + 2] = color[2];
      }
    }
  }

  /** Draws a 2D line (Bresenham) — used by projected 3D segments. */
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

  /** Draws a scene-space segment (clipped when either end is behind the near plane). */
  drawSegment3D(a: Vec3, b: Vec3, color: Rgb): void {
    const pa = this.project(a);
    const pb = this.project(b);
    if (pa === null || pb === null) return;
    this.drawLine(pa.x, pa.y, pb.x, pb.y, color);
  }

  /** Strokes the screen-space outline of projected vertices (cel outlines). */
  strokePolygonOutline(vertices: ProjectedVertex[], color: Rgb): void {
    for (let i = 0; i < vertices.length; i += 1) {
      const a = vertices[i]!;
      const b = vertices[(i + 1) % vertices.length]!;
      this.drawLine(a.x, a.y, b.x, b.y, color);
    }
  }

  /** Fills a screen-space axis-aligned rectangle (HUD elements). */
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
}

/**
 * FNV-1a 32-bit hash (deterministic across engines: `Math.imul` for exact
 * 32-bit multiply; `>>> 0` keeps the accumulator unsigned). Documented
 * constants: offset basis `0x811c9dc5`, prime `0x01000193`.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
