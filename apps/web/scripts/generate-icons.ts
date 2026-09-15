/**
 * Deterministic Sporta icon generator (W903).
 *
 * Rasterizes the Sporta mark — three overlapping reality rings converging
 * on one ball — into the PNGs required for PWA installability:
 *
 *   public/icons/icon-192.png          (purpose "any", rounded canvas)
 *   public/icons/icon-512.png          (purpose "any", rounded canvas)
 *   public/icons/icon-maskable-512.png (purpose "maskable", full-bleed,
 *                                       motif inside the 80% safe zone)
 *   public/icons/apple-touch-icon.png  (180×180, full-bleed square)
 *
 * Pure math, no dependencies beyond node:zlib/node:fs, no randomness, no
 * network: the same script always produces byte-identical icons.
 *
 * Run: bun run icons   (from apps/web)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

type RGB = readonly [number, number, number];

/* Brand tokens (must match src/lib/brand.ts + globals.css). */
const INK: RGB = [10, 14, 24]; // #0a0e18
const INK_LIFT: RGB = [22, 30, 50]; // subtle vignette lift
const GREEN: RGB = [45, 240, 140]; // #2df08c
const AMBER: RGB = [255, 194, 77]; // #ffc24d
const SLATE: RGB = [143, 176, 255]; // #8fb0ff
const BALL: RGB = [233, 238, 251]; // #e9eefb

/* ------------------------------------------------------------------ */
/* Minimal, dependency-free PNG encoder                                 */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[crc ^ byte]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter: none
    const srcStart = y * width * 4;
    for (let x = 0; x < width * 4; x++) {
      raw[rowStart + 1 + x] = rgba[srcStart + x]!;
    }
  }

  const idat = deflateSync(Buffer.from(raw), { level: 9 });

  return Buffer.concat([
    signature,
    Buffer.from(chunk("IHDR", ihdr)),
    Buffer.from(chunk("IDAT", new Uint8Array(idat))),
    Buffer.from(chunk("IEND", new Uint8Array(0))),
  ]);
}

/* ------------------------------------------------------------------ */
/* Analytic rasterizer (4×4 supersampling, no randomness)              */
/* ------------------------------------------------------------------ */

type MarkOptions = {
  /** Full-bleed square (maskable/apple) or rounded canvas (any). */
  rounded: boolean;
  /** Content scale — 1 fills the canvas, 0.78 keeps the maskable safe zone. */
  scale: number;
};

/** Squared distance from (u,v) to a point, in normalized canvas units. */
function dist2(u: number, v: number, cx: number, cy: number): number {
  return (u - cx) ** 2 + (v - cy) ** 2;
}

function insideCircle(u: number, v: number, cx: number, cy: number, r: number): boolean {
  return dist2(u, v, cx, cy) <= r * r;
}

function insideRing(
  u: number,
  v: number,
  cx: number,
  cy: number,
  r: number,
  halfStroke: number,
): boolean {
  const d = Math.sqrt(dist2(u, v, cx, cy));
  return Math.abs(d - r) <= halfStroke;
}

/** Rounded-rect coverage for the square canvas [0,1]². */
function insideRoundedSquare(u: number, v: number, radius: number): boolean {
  const rx = radius;
  const ry = radius;
  const dx = Math.max(0, Math.abs(u - 0.5) - (0.5 - rx));
  const dy = Math.max(0, Math.abs(v - 0.5) - (0.5 - ry));
  return dx * dx + dy * dy <= rx * rx;
}

/** One subsample of the mark; returns [r, g, b, a]. */
function sampleMark(
  u: number,
  v: number,
  options: MarkOptions,
): readonly [number, number, number, number] {
  const { rounded, scale } = options;

  // Background: rounded (transparent corners) or full bleed.
  if (rounded && !insideRoundedSquare(u, v, 0.19)) {
    return [0, 0, 0, 0];
  }

  // Subtle radial vignette keeps the ink from feeling flat.
  const d = Math.sqrt(dist2(u, v, 0.5, 0.5)) / Math.SQRT1_2;
  const lift = Math.max(0, 1 - d) * 0.55;
  let color: RGB = [
    INK[0] + (INK_LIFT[0] - INK[0]) * lift,
    INK[1] + (INK_LIFT[1] - INK[1]) * lift,
    INK[2] + (INK_LIFT[2] - INK[2]) * lift,
  ];

  // The three reality rings (green / amber / slate), shrunk to the safe
  // zone for maskable canvases. Overlaps paint in this fixed order.
  const cx = 0.5;
  const cy = 0.5;
  const ringR = 0.25 * scale;
  const halfStroke = 0.032 * scale;

  const centers: readonly (readonly [number, number, RGB])[] = [
    [cx - 0.105 * scale, cy - 0.115 * scale, GREEN],
    [cx + 0.105 * scale, cy - 0.115 * scale, AMBER],
    [cx, cy + 0.125 * scale, SLATE],
  ];
  for (const [rcx, rcy, ringColor] of centers) {
    if (insideRing(u, v, rcx, rcy, ringR, halfStroke)) {
      color = ringColor;
    }
  }

  // The ball at the center of the three realities.
  if (insideCircle(u, v, cx, cy - 0.045 * scale, 0.085 * scale)) {
    color = BALL;
  }

  return [color[0], color[1], color[2], 255];
}

function renderMark(size: number, options: MarkOptions): Buffer {
  const supersample = 4;
  const rgba = new Uint8Array(size * size * 4);
  const samples = supersample * supersample;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < supersample; sy++) {
        for (let sx = 0; sx < supersample; sx++) {
          const u = (x + (sx + 0.5) / supersample) / size;
          const v = (y + (sy + 0.5) / supersample) / size;
          const [sr, sg, sb, sa] = sampleMark(u, v, options);
          r += sr * (sa / 255);
          g += sg * (sa / 255);
          b += sb * (sa / 255);
          a += sa;
        }
      }
      const alpha = a / samples / 255;
      const idx = (y * size + x) * 4;
      rgba[idx] = alpha > 0 ? Math.round(r / samples / alpha) : 0;
      rgba[idx + 1] = alpha > 0 ? Math.round(g / samples / alpha) : 0;
      rgba[idx + 2] = alpha > 0 ? Math.round(b / samples / alpha) : 0;
      rgba[idx + 3] = Math.round(a / samples);
    }
  }

  return encodePng(size, size, rgba);
}

/* ------------------------------------------------------------------ */
/* Build the icon set                                                   */
/* ------------------------------------------------------------------ */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(scriptDir, "..", "public", "icons");

const ICONS: readonly { file: string; size: number; options: MarkOptions }[] = [
  { file: "icon-192.png", size: 192, options: { rounded: true, scale: 1 } },
  { file: "icon-512.png", size: 512, options: { rounded: true, scale: 1 } },
  {
    file: "icon-maskable-512.png",
    size: 512,
    options: { rounded: false, scale: 0.78 },
  },
  {
    file: "apple-touch-icon.png",
    size: 180,
    options: { rounded: false, scale: 1 },
  },
];

mkdirSync(iconsDir, { recursive: true });

for (const { file, size, options } of ICONS) {
  const png = renderMark(size, options);
  writeFileSync(join(iconsDir, file), png);
  console.log(`wrote ${file} (${size}×${size}, ${png.length} bytes)`);
}
