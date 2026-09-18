/**
 * Shared pixel-space utilities for the pixel-driven perception-adapter
 * candidates (R202 `HeuristicColorDetector`, R204 `ColorBlobBallTracker`,
 * R205 `LineBasedFieldCalibrator`, R206 `JerseyColorTeamAssigner`).
 *
 * Everything here is PURE and DETERMINISTIC over the pixel bytes: fixed
 * row-major scan orders, no RNG, no clock, no environment reads. The color
 * predicates are deliberately SIMPLE thresholds (documented envelopes, not
 * learned models): they are calibrated for typical broadcast-style frames —
 * green-dominant pitch, white pitch markings, saturated team kits — and each
 * consuming candidate documents its own failure modes when a real frame
 * falls outside that envelope.
 */

/** One rgb24 pixel value. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Minimum green dominance (absolute) for the pitch-color predicate. */
const PITCH_GREEN_MARGIN = 25;

/** Minimum green channel value for the pitch-color predicate. */
const PITCH_GREEN_MIN = 90;

/**
 * `true` when the pixel reads as pitch-colored: green-dominant by a margin
 * (the pitch-suppression predicate — blob extraction runs on the NEGATION).
 * Calibrated for green-dominant grass tones (synthetic fixtures render
 * ~(70, 130, 60); real broadcast grass varies but stays green-dominant).
 */
export function isPitchGreen(r: number, g: number, b: number): boolean {
  return g >= PITCH_GREEN_MIN && g - Math.max(r, b) >= PITCH_GREEN_MARGIN;
}

/** Minimum per-channel value for the bright-white predicate. */
const BRIGHT_WHITE_MIN = 190;

/** Maximum channel spread for the bright-white predicate. */
const BRIGHT_WHITE_SPREAD = 50;

/**
 * `true` when the pixel reads as bright near-white: the pitch-marking /
 * ball-color predicate. Both markings and the ball share this predicate —
 * CONSUMERS separate them by blob geometry and motion (lines are long and
 * static; the ball is small, compact, and moving).
 */
export function isBrightWhite(r: number, g: number, b: number): boolean {
  return (
    r >= BRIGHT_WHITE_MIN &&
    g >= BRIGHT_WHITE_MIN &&
    b >= BRIGHT_WHITE_MIN &&
    Math.abs(r - g) <= BRIGHT_WHITE_SPREAD &&
    Math.abs(g - b) <= BRIGHT_WHITE_SPREAD
  );
}

/** Mean channel brightness `(r + g + b) / 3`. */
export function brightness(r: number, g: number, b: number): number {
  return (r + g + b) / 3;
}

/**
 * Reads the rgb24 pixel at `(x, y)` from a `width * height` frame (no bounds
 * check — callers clamp; the byte volume invariant is enforced upstream by
 * decoding, architecture-lock §13).
 */
export function pixelAt(bytes: Uint8Array, width: number, x: number, y: number): Rgb {
  const index = (y * width + x) * 3;
  return { r: bytes[index]!, g: bytes[index + 1]!, b: bytes[index + 2]! };
}

/**
 * One connected blob in a binary mask: inclusive pixel bounds plus the exact
 * pixel count. Blobs from {@link connectedComponents} are emitted in
 * row-major FIRST-PIXEL order (deterministic).
 */
export interface PixelBlob {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly area: number;
}

/**
 * 4-connectivity connected-component labeling over a `width * height` binary
 * mask (non-zero = foreground). Deterministic: components are discovered in
 * row-major scan order and emitted in that order; ties cannot occur. Pure
 * function of the mask.
 */
export function connectedComponents(mask: Uint8Array, width: number, height: number): PixelBlob[] {
  const visited = new Uint8Array(width * height);
  const blobs: PixelBlob[] = [];
  const queue = new Int32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (mask[start] === 0 || visited[start] !== 0) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;
      while (head < tail) {
        const current = queue[head]!;
        head += 1;
        const cx = current % width;
        const cy = (current - cx) / width;
        area += 1;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        // 4-neighbours, west/north already visited by scan order; checked
        // explicitly anyway for clarity (idempotent).
        if (cx > 0) {
          const west = current - 1;
          if (mask[west] !== 0 && visited[west] === 0) {
            visited[west] = 1;
            queue[tail++] = west;
          }
        }
        if (cx < width - 1) {
          const east = current + 1;
          if (mask[east] !== 0 && visited[east] === 0) {
            visited[east] = 1;
            queue[tail++] = east;
          }
        }
        if (cy > 0) {
          const north = current - width;
          if (mask[north] !== 0 && visited[north] === 0) {
            visited[north] = 1;
            queue[tail++] = north;
          }
        }
        if (cy < height - 1) {
          const south = current + width;
          if (mask[south] !== 0 && visited[south] === 0) {
            visited[south] = 1;
            queue[tail++] = south;
          }
        }
      }
      blobs.push({ minX, minY, maxX, maxY, area });
    }
  }
  return blobs;
}

/** Blob compactness in `(0, 1]`: pixel area over bounding-box area. */
export function blobCompactness(blob: PixelBlob): number {
  const boxArea = (blob.maxX - blob.minX + 1) * (blob.maxY - blob.minY + 1);
  return blob.area / boxArea;
}

/** Blob bounding-box aspect ratio in `[1, infinity)`: long side / short side. */
export function blobAspectRatio(blob: PixelBlob): number {
  const w = blob.maxX - blob.minX + 1;
  const h = blob.maxY - blob.minY + 1;
  return Math.max(w, h) / Math.min(w, h);
}

/**
 * Converts inclusive pixel bounds into the contract `NormalizedBox` shape,
 * EXCLUSIVE at the far edge (pixel `maxX` spans to `(maxX + 1) / width`) and
 * clamped into `[0, 1]` on every field (the same convention the W201 fixture
 * detector's clamping uses).
 */
export function pixelBoundsToNormalizedBox(
  blob: PixelBlob,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
  const x0 = clamp01(blob.minX / width);
  const x1 = clamp01((blob.maxX + 1) / width);
  const y0 = clamp01(blob.minY / height);
  const y1 = clamp01((blob.maxY + 1) / height);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Center of a normalized box, in normalized image coordinates. */
export function normalizedBoxCenter(box: { x: number; y: number; w: number; h: number }): {
  x: number;
  y: number;
} {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/**
 * Mean color over a normalized-box crop, restricted to pixels accepted by
 * the optional filter (e.g. NOT pitch-green, for jersey sampling). Returns
 * the mean and the exact accepted sample count (deterministic row-major
 * scan; a stride of 1 keeps every pixel).
 */
export function cropMeanColor(
  bytes: Uint8Array,
  width: number,
  height: number,
  box: { x: number; y: number; w: number; h: number },
  accept?: (r: number, g: number, b: number) => boolean,
): { mean: Rgb; samples: number } {
  const clamp = (value: number, max: number): number =>
    Math.min(max - 1, Math.max(0, Math.round(value)));
  const x0 = clamp(box.x * width, width);
  const y0 = clamp(box.y * height, height);
  const x1 = clamp((box.x + box.w) * width, width);
  const y1 = clamp((box.y + box.h) * height, height);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let samples = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * width + x) * 3;
      const r = bytes[index]!;
      const g = bytes[index + 1]!;
      const b = bytes[index + 2]!;
      if (accept !== undefined && !accept(r, g, b)) continue;
      sumR += r;
      sumG += g;
      sumB += b;
      samples += 1;
    }
  }
  if (samples === 0) {
    return { mean: { r: 0, g: 0, b: 0 }, samples: 0 };
  }
  return {
    mean: { r: sumR / samples, g: sumG / samples, b: sumB / samples },
    samples,
  };
}
