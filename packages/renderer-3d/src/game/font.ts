/**
 * The compact 4×5 pixel font of the reference engine — every letter the
 * football presentation vocabulary needs (score/clock HUD, event chips,
 * camera labels, jersey numbers).
 *
 * A glyph is 4 bits wide × 5 rows; each row's bits are MSB-left (bit 3 =
 * leftmost pixel). The glyph set is uppercase A–Z, digits 0–9, and the
 * punctuation the HUD uses (`:`, `-`, `.`, `'`). This is a PRESENTATION
 * font (a documented constant set — it renders SWM-derived text, it never
 * alters it). Some glyphs are stylistically approximate at this size
 * (M/W/N); the tables are pinned by tests.
 */

/** One glyph: five 4-bit rows, MSB-left. */
export type Glyph = readonly [number, number, number, number, number];

const GLYPHS: Record<string, Glyph> = {
  "0": [0b0110, 0b1001, 0b1001, 0b1001, 0b0110],
  "1": [0b0010, 0b0110, 0b0010, 0b0010, 0b0111],
  "2": [0b1110, 0b0001, 0b0110, 0b1000, 0b1111],
  "3": [0b1110, 0b0001, 0b0110, 0b0001, 0b1110],
  "4": [0b1001, 0b1001, 0b1111, 0b0001, 0b0001],
  "5": [0b1111, 0b1000, 0b1110, 0b0001, 0b1110],
  "6": [0b0111, 0b1000, 0b1110, 0b1001, 0b0110],
  "7": [0b1111, 0b0001, 0b0010, 0b0100, 0b0100],
  "8": [0b0110, 0b1001, 0b0110, 0b1001, 0b0110],
  "9": [0b0110, 0b1001, 0b0111, 0b0001, 0b0110],
  A: [0b0110, 0b1001, 0b1111, 0b1001, 0b1001],
  B: [0b1110, 0b1001, 0b1110, 0b1001, 0b1110],
  C: [0b0111, 0b1000, 0b1000, 0b1000, 0b0111],
  D: [0b1110, 0b1001, 0b1001, 0b1001, 0b1110],
  E: [0b1111, 0b1000, 0b1110, 0b1000, 0b1111],
  F: [0b1111, 0b1000, 0b1110, 0b1000, 0b1000],
  G: [0b0111, 0b1000, 0b1011, 0b1001, 0b0111],
  H: [0b1001, 0b1001, 0b1111, 0b1001, 0b1001],
  I: [0b0111, 0b0010, 0b0010, 0b0010, 0b0111],
  J: [0b0011, 0b0001, 0b0001, 0b1001, 0b0110],
  K: [0b1001, 0b1010, 0b1100, 0b1010, 0b1001],
  L: [0b1000, 0b1000, 0b1000, 0b1000, 0b1111],
  M: [0b1001, 0b1111, 0b1111, 0b1001, 0b1001],
  N: [0b1001, 0b1101, 0b1011, 0b1001, 0b1001],
  O: [0b0110, 0b1001, 0b1001, 0b1001, 0b0110],
  P: [0b1110, 0b1001, 0b1110, 0b1000, 0b1000],
  Q: [0b0110, 0b1001, 0b1001, 0b1010, 0b0101],
  R: [0b1110, 0b1001, 0b1110, 0b1010, 0b1001],
  S: [0b0111, 0b1000, 0b0110, 0b0001, 0b1110],
  T: [0b1111, 0b0010, 0b0010, 0b0010, 0b0010],
  U: [0b1001, 0b1001, 0b1001, 0b1001, 0b0110],
  V: [0b1001, 0b1001, 0b1001, 0b0101, 0b0010],
  W: [0b1001, 0b1001, 0b1111, 0b1111, 0b1001],
  X: [0b1001, 0b1001, 0b0110, 0b1001, 0b1001],
  Y: [0b1001, 0b1001, 0b0110, 0b0010, 0b0010],
  Z: [0b1111, 0b0001, 0b0110, 0b1000, 0b1111],
  ":": [0b0000, 0b0100, 0b0000, 0b0100, 0b0000],
  "-": [0b0000, 0b0000, 0b1111, 0b0000, 0b0000],
  ".": [0b0000, 0b0000, 0b0000, 0b0000, 0b0100],
  "'": [0b0100, 0b0100, 0b0000, 0b0000, 0b0000],
  "!": [0b0100, 0b0100, 0b0100, 0b0000, 0b0100],
  " ": [0b0000, 0b0000, 0b0000, 0b0000, 0b0000],
};

/** The glyph width in pixels (4) — exported for layout math. */
export const GLYPH_WIDTH = 4;

/** The glyph height in pixels (5) — exported for layout math. */
export const GLYPH_HEIGHT = 5;

/** The horizontal advance between glyph origins (glyph + 1px spacing). */
export const GLYPH_ADVANCE = GLYPH_WIDTH + 1;

/** The measured width of a string at `scale` (for right-aligning). */
export function measureText(text: string, scale: number): number {
  if (text.length === 0) return 0;
  return text.length * GLYPH_ADVANCE * scale - scale; // no trailing space
}

/**
 * Draws text with the pixel font. Unknown characters render as blanks
 * (never an error — HUD text is presentation, and a missing glyph must
 * never crash a render).
 */
export function drawText(
  fb: DrawTarget,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: { r: number; g: number; b: number },
): void {
  let cursor = x;
  for (const ch of text.toUpperCase()) {
    const glyph = GLYPHS[ch];
    if (glyph !== undefined) {
      for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
        const bits = glyph[row]!;
        for (let col = 0; col < GLYPH_WIDTH; col += 1) {
          if (((bits >> (GLYPH_WIDTH - 1 - col)) & 1) === 1) {
            fb.fillRect(cursor + col * scale, y + row * scale, scale, scale, color);
          }
        }
      }
    }
    cursor += GLYPH_ADVANCE * scale;
  }
}

/** The minimal surface `drawText` needs (structural: Framebuffer satisfies). */
export interface DrawTarget {
  fillRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color: { r: number; g: number; b: number },
  ): void;
}

/** Whether every character of `text` has a glyph (test support). */
export function isRenderableText(text: string): boolean {
  return [...text.toUpperCase()].every((ch) => GLYPHS[ch] !== undefined);
}

/** The sorted glyph vocabulary (test pin). */
export function glyphVocabulary(): string[] {
  return Object.keys(GLYPHS).sort();
}
