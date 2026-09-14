/**
 * Identity-stable stylization for the anime renderer prototype (W502).
 *
 * CONSTITUTION (architecture-lock §6): frame-to-frame identity and motion
 * continuity are product-critical; per-frame image quality alone is not
 * sufficient. This module makes identity stability true BY CONSTRUCTION:
 * every visual property of an entity is a PURE function of
 * `(styleKey, entityId)` where `styleKey = "<rendererId>:<rendererVersion>"`.
 * There is no per-frame randomness, no Math.random, no time input — the same
 * entityId under the same renderer version always yields the byte-identical
 * style. Bumping the renderer version is the ONLY way to restyle (a
 * deliberate, versioned change; renderer versions are immutable per the
 * renderer contract).
 *
 * The style derivation is a fixed palette table plus a deterministic hash:
 *
 * 1. {@link fnv1a32} — the FNV-1a 32-bit hash of the composite string
 *    `"<styleKey>:<entityId>"` (documented constants: offset basis
 *    `0x811c9dc5`, prime `0x01000193`, `Math.imul` for exact 32-bit
 *    multiplication — deterministic across engines);
 * 2. `hash % PLAYER_PALETTE.length` selects one entry of the fixed
 *    {@link PLAYER_PALETTE} (8 two-tone entries, flat anime-style colors).
 *
 * The palette is a first-party flat-color design (public-domain-style hex
 * values); no proprietary game assets are used or reproduced
 * (architecture-lock §10).
 */
import { ANIME_RENDERER_ID, ANIME_RENDERER_VERSION } from "./identity";

/** One two-tone player style: jersey fill plus trim (outline + accents). */
export interface PlayerStyle {
  /** Palette table index (0-based) — the identity-stable style token. */
  paletteIndex: number;
  /** Jersey fill color (flat anime palette). */
  jersey: string;
  /** Trim color: marker outline, uncertainty halo, and accents. */
  trim: string;
}

/**
 * The fixed player palette: 8 two-tone entries. Flat, saturated,
 * anime-inspired colors with high figure/ground separation from the pitch
 * greens. IMMUTABLE: changing an entry changes every downstream frame and
 * must ride a renderer version bump.
 */
export const PLAYER_PALETTE: readonly PlayerStyle[] = [
  { paletteIndex: 0, jersey: "#3f6fbf", trim: "#f2c94c" },
  { paletteIndex: 1, jersey: "#d64f4f", trim: "#f8f4e8" },
  { paletteIndex: 2, jersey: "#3fae7a", trim: "#1d2a3a" },
  { paletteIndex: 3, jersey: "#e8873a", trim: "#22252a" },
  { paletteIndex: 4, jersey: "#8e5bc0", trim: "#f2c94c" },
  { paletteIndex: 5, jersey: "#2fa8c9", trim: "#d64f4f" },
  { paletteIndex: 6, jersey: "#c94f8e", trim: "#f8f4e8" },
  { paletteIndex: 7, jersey: "#f2c94c", trim: "#22252a" },
];

/** The fixed ball style (the ball entity's look is constant, not hashed). */
export const BALL_STYLE: { fill: string; stroke: string } = {
  fill: "#fbfbf4",
  stroke: "#22252a",
};

/**
 * FNV-1a 32-bit hash (deterministic across engines: `Math.imul` gives exact
 * 32-bit multiply semantics; `>>> 0` keeps the accumulator unsigned).
 * Documented constants: offset basis `0x811c9dc5`, prime `0x01000193`.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The identity-stable player style for one entity under one style key.
 *
 * Pure: same `(styleKey, entityId)` → deep-equal result, forever. The
 * composite input is `"<styleKey>:<entityId>"`; the palette entry is
 * selected by `fnv1a32(composite) % PLAYER_PALETTE.length`. The returned
 * object is a fresh clone each call (callers may not mutate the table).
 */
export function stableEntityStyle(styleKey: string, entityId: string): PlayerStyle {
  const hash = fnv1a32(`${styleKey}:${entityId}`);
  const entry = PLAYER_PALETTE[hash % PLAYER_PALETTE.length]!;
  return { ...entry };
}

/** The style key of this renderer version: `"<rendererId>:<rendererVersion>"`. */
export function animeStyleKey(): string {
  return `${ANIME_RENDERER_ID}:${ANIME_RENDERER_VERSION}`;
}

/**
 * The identity-stable player style for one entity under THIS renderer
 * version. Convenience wrapper over {@link stableEntityStyle} with the
 * package's fixed style key.
 */
export function animeEntityStyle(entityId: string): PlayerStyle {
  return stableEntityStyle(animeStyleKey(), entityId);
}

/**
 * Confidence → visual weight mapping (documented formula, never inverted):
 * `opacity = 0.35 + 0.65 * confidence`. A fully confident value renders
 * opaque (1.0); a zero-confidence value still renders (0.35) — uncertainty
 * reduces visual weight but never invents confidence or hides the fact.
 * `undefined` confidence (absent in the snapshot) maps to `undefined`: the
 * caller renders with NO opacity attribute (neutral styling, an honest
 * no-claim default) rather than a fabricated number.
 */
export function opacityFromConfidence(confidence: number | undefined): number | undefined {
  if (confidence === undefined) return undefined;
  return round3(0.35 + 0.65 * confidence);
}

/** Serialization rounding to 3 decimals (opacity), pinned by tests. */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
