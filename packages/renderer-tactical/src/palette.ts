/**
 * Identity-stable stylization for the tactical renderer (R301) — the W502
 * anime-palette precedent applied to the tactical 2D view.
 *
 * Every visual property of an entity is a PURE function of
 * `(styleKey, entityId)` where `styleKey = "<rendererId>:<rendererVersion>"`.
 * No randomness, no clocks: the same entityId under the same renderer version
 * always yields the same colors. Bumping the renderer version is the only way
 * to restyle (renderer versions are immutable per the renderer contract).
 */
import type { Rgb } from "./canvas";
import { TACTICAL_RENDERER_ID, TACTICAL_RENDERER_VERSION } from "./identity";

/** One two-tone tactical marker style: fill plus trim (outline/label). */
export interface TacticalMarkerStyle {
  /** Palette table index (0-based) — the identity-stable style token. */
  paletteIndex: number;
  /** Marker fill color. */
  fill: Rgb;
  /** Marker outline and label color. */
  trim: Rgb;
}

/**
 * The fixed tactical palette: 8 two-tone entries with high figure/ground
 * separation from the pitch greens. IMMUTABLE: changing an entry changes
 * every downstream frame and must ride a renderer version bump.
 */
export const TACTICAL_PALETTE: readonly TacticalMarkerStyle[] = [
  { paletteIndex: 0, fill: [214, 79, 79], trim: [248, 244, 232] },
  { paletteIndex: 1, fill: [232, 135, 58], trim: [34, 37, 42] },
  { paletteIndex: 2, fill: [240, 200, 74], trim: [34, 37, 42] },
  { paletteIndex: 3, fill: [63, 174, 122], trim: [248, 244, 232] },
  { paletteIndex: 4, fill: [142, 91, 192], trim: [248, 244, 232] },
  { paletteIndex: 5, fill: [201, 79, 142], trim: [34, 37, 42] },
  { paletteIndex: 6, fill: [216, 216, 200], trim: [34, 37, 42] },
  { paletteIndex: 7, fill: [94, 60, 36], trim: [248, 244, 232] },
];

/** The fixed ball style (constant, not hashed). */
export const TACTICAL_BALL_STYLE: { fill: Rgb; trim: Rgb } = {
  fill: [251, 251, 244],
  trim: [34, 37, 42],
};

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

/** The composite style key of this renderer version. */
const STYLE_KEY = `${TACTICAL_RENDERER_ID}:${TACTICAL_RENDERER_VERSION}`;

/**
 * The identity-stable marker style for one entity. Pure: the same
 * `(styleKey, entityId)` → the same palette entry, forever.
 */
export function markerStyleOf(entityId: string): TacticalMarkerStyle {
  const hash = fnv1a32(`${STYLE_KEY}:${entityId}`);
  return TACTICAL_PALETTE[hash % TACTICAL_PALETTE.length]!;
}
