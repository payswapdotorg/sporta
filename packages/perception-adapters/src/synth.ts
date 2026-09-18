/**
 * Synthetic-diagnostic frame painter — the procedural generator behind the
 * benchmark fixtures (src/benchmark/fixtures.ts).
 *
 * HONESTY BOUNDARY (printed on every fixture this module paints): these are
 * SYNTHETIC-DIAGNOSTIC frames — flat-colored regions on an rgb24 raster,
 * procedurally generated from a seeded spec, with exact ground truth by
 * construction. They are NOT real video. They exist so the deterministic
 * benchmark modules can measure candidate behavior end-to-end before any
 * real-media fixture set exists; quality numbers against these fixtures are
 * DIAGNOSTIC of the algorithms, not of production accuracy.
 *
 * Determinism: fixed paint order (documented per painter), no RNG inside the
 * painter itself (all randomness lives in the seeded fixture generators),
 * no clock, no environment reads.
 */
import type { Rgb } from "./pixels";
import type { DetectorFrameInput } from "@sporta/perception-detection";

/** The synthetic pitch green used by every fixture (green-dominant). */
export const SYNTH_PITCH_GREEN: Rgb = { r: 70, g: 130, b: 60 };

/** The synthetic white used for pitch markings and the ball. */
export const SYNTH_WHITE: Rgb = { r: 240, g: 240, b: 240 };

/** The synthetic off-pitch background (stands/void — dark, low brightness). */
export const SYNTH_BACKGROUND: Rgb = { r: 40, g: 40, b: 44 };

/** The synthetic halfway-line/soft white (slightly off pure white). */
export const SYNTH_LINE_WHITE: Rgb = { r: 228, g: 230, b: 224 };

/**
 * A minimal rgb24 raster painter. Pixel coordinates are inclusive integer
 * bounds; every painter clamps to the raster (nothing bleeds outside the
 * frame) and overwrites previously painted pixels in the documented order:
 * background fill, pitch rectangle, lines, then blobs/ellipses on top.
 */
export class SyntheticFrame {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number, background: Rgb = SYNTH_BACKGROUND) {
    this.width = width;
    this.height = height;
    this.bytes = new Uint8Array(width * height * 3);
    this.fillRect(0, 0, width - 1, height - 1, background);
  }

  /** Fills the inclusive pixel rectangle, clamped into the raster. */
  fillRect(x0: number, y0: number, x1: number, y1: number, color: Rgb): void {
    const xa = Math.max(0, Math.min(this.width - 1, Math.round(x0)));
    const xb = Math.max(0, Math.min(this.width - 1, Math.round(x1)));
    const ya = Math.max(0, Math.min(this.height - 1, Math.round(y0)));
    const yb = Math.max(0, Math.min(this.height - 1, Math.round(y1)));
    for (let y = ya; y <= yb; y += 1) {
      for (let x = xa; x <= xb; x += 1) {
        const index = (y * this.width + x) * 3;
        this.bytes[index] = color.r;
        this.bytes[index + 1] = color.g;
        this.bytes[index + 2] = color.b;
      }
    }
  }

  /** Paints a filled ellipse (ball/disc), clamped into the raster. */
  fillEllipse(cx: number, cy: number, rx: number, ry: number, color: Rgb): void {
    const xa = Math.max(0, Math.floor(cx - rx));
    const xb = Math.min(this.width - 1, Math.ceil(cx + rx));
    const ya = Math.max(0, Math.floor(cy - ry));
    const yb = Math.min(this.height - 1, Math.ceil(cy + ry));
    for (let y = ya; y <= yb; y += 1) {
      for (let x = xa; x <= xb; x += 1) {
        const dx = (x - cx) / Math.max(rx, 1e-9);
        const dy = (y - cy) / Math.max(ry, 1e-9);
        if (dx * dx + dy * dy <= 1) {
          const index = (y * this.width + x) * 3;
          this.bytes[index] = color.r;
          this.bytes[index + 1] = color.g;
          this.bytes[index + 2] = color.b;
        }
      }
    }
  }
}

/**
 * Wraps painted bytes into the W201 `DetectorFrameInput` (the W102
 * normalized-frame fields a detector needs). Frame ids follow the decoding
 * convention `f-<streamIndex>-<decodeOrder>`.
 */
export function makeDetectorFrameInput(input: {
  bytes: Uint8Array;
  width: number;
  height: number;
  decodeOrder: number;
  presentationMs: number;
  streamIndex?: number;
}): DetectorFrameInput {
  return {
    frameId: `f-${input.streamIndex ?? 0}-${input.decodeOrder}`,
    presentationMs: input.presentationMs,
    width: input.width,
    height: input.height,
    bytes: input.bytes,
    decodeOrder: input.decodeOrder,
    streamIndex: input.streamIndex ?? 0,
  };
}
