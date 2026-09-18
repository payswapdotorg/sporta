/**
 * Presentation palettes and identity-stable styling for the R303/R304
 * renderers — the W602 no-flicker discipline carried into the engine-consumer
 * path: every cosmetic choice is a PURE function of `(styleKey, entityId)`
 * (or of verbatim SWM slots when the world model carries the fact).
 *
 * Honesty rules (the W602/W603 posture, unchanged):
 *
 * - **Kit colors**: when an entity carries a `teamId` state slot with status
 *   `known`, the kit color maps STABLY from that verbatim slot value.
 *   Otherwise the color is an identity-stable COSMETIC derivation from
 *   `(styleKey, entityId)` — it is NOT a claim about canonical team
 *   assignment (R206 team/identity data does not exist in the public SWM
 *   yet; inventing a team split would fabricate a fact). A goalkeeper
 *   (`teamRole: "goalkeeper"`, known) always reads as the keeper kit.
 * - **Jersey numbers**: a `jerseyNumber` state slot with status `known`
 *   and a numeric value is used VERBATIM; otherwise the number derives
 *   deterministically from the entityId (trailing digits, else a stable
 *   hash in 1–99) — a documented presentation derivation, never asserted
 *   as canonical squad data.
 */
import type { Rgb } from "./raster";

/** The stylized-3d kit palette (classic kit families, no pure blue primary). */
const KIT_PALETTE: readonly Rgb[] = [
  { r: 214, g: 48, b: 49 }, // red
  { r: 245, g: 236, b: 116 }, // yellow
  { r: 46, g: 125, b: 50 }, // green
  { r: 129, g: 26, b: 26 }, // claret
  { r: 236, g: 239, b: 243 }, // white
  { r: 33, g: 33, b: 38 }, // black
  { r: 240, g: 146, b: 63 }, // orange
  { r: 158, g: 200, b: 185 }, // mint
];

/** The kit palette size (test pin). */
export const KIT_PALETTE_SIZE = KIT_PALETTE.length;

/** The goalkeeper kit color (test pin). */
export const KEEPER_KIT_COLOR: Rgb = { r: 32, g: 100, b: 98 };

/** The officials' kit color (test pin). */
export const OFFICIAL_KIT_COLOR: Rgb = { r: 60, g: 64, b: 74 };

/** FNV-1a 32-bit (the repo's stable-hash precedent). */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** One entity's resolved presentation kit. */
export interface EntityKit {
  /** Primary kit color. */
  color: Rgb;
  /** Whether the keeper variant applies. */
  goalkeeper: boolean;
}

/**
 * Resolves the presentation kit of one entity. `teamId` (when known) maps
 * stably; a known `goalkeeper` team role forces the keeper kit; officials
 * get the neutral kit; everything else is the identity-stable cosmetic
 * derivation over the style key (documented above).
 */
export function entityKit(options: {
  styleKey: string;
  entityId: string;
  kind: string;
  teamRole: string | null;
  teamId: string | null;
}): EntityKit {
  const { styleKey, entityId, kind, teamRole, teamId } = options;
  if (kind === "official") return { color: OFFICIAL_KIT_COLOR, goalkeeper: false };
  const isKeeper = teamRole === "goalkeeper";
  if (isKeeper) return { color: KEEPER_KIT_COLOR, goalkeeper: true };
  if (teamId !== null) {
    const palette = KIT_PALETTE[fnv1a32(`${styleKey}:team:${teamId}`) % KIT_PALETTE.length]!;
    return { color: palette, goalkeeper: false };
  }
  const palette = KIT_PALETTE[fnv1a32(`${styleKey}:entity:${entityId}`) % KIT_PALETTE.length]!;
  return { color: palette, goalkeeper: false };
}

/**
 * Derives the jersey number: a `jerseyNumber` slot (known, 1–99) verbatim;
 * else the entityId's trailing digit run; else a stable hash in 1–99.
 */
export function jerseyNumberOf(entityId: string, declared: number | null): number {
  if (declared !== null && Number.isInteger(declared) && declared >= 1 && declared <= 99) {
    return declared;
  }
  const trailing = /(\d+)$/.exec(entityId);
  if (trailing !== null) {
    const value = Number.parseInt(trailing[1]!, 10);
    if (Number.isFinite(value) && value >= 1 && value <= 99) return value;
    if (value > 99) return (value % 99) + 1;
  }
  return (fnv1a32(`jersey:${entityId}`) % 99) + 1;
}

/** The stylized-3d scene palette. */
export const STYLIZED_3D_PALETTE = {
  skyTop: { r: 116, g: 176, b: 214 } as Rgb,
  skyBottom: { r: 206, g: 228, b: 240 } as Rgb,
  apron: { r: 42, g: 108, b: 58 } as Rgb,
  grassA: { r: 62, g: 140, b: 76 } as Rgb,
  grassB: { r: 54, g: 126, b: 68 } as Rgb,
  line: { r: 245, g: 248, b: 245 } as Rgb,
  shadow: { r: 18, g: 46, b: 26 } as Rgb,
  possession: { r: 255, g: 214, b: 79 } as Rgb,
  ball: { r: 248, g: 248, b: 250 } as Rgb,
  ballShade: { r: 196, g: 200, b: 210 } as Rgb,
  trail: { r: 255, g: 255, b: 255 } as Rgb,
  hudPanel: { r: 16, g: 20, b: 26 } as Rgb,
  hudText: { r: 244, g: 246, b: 250 } as Rgb,
  hudAccent: { r: 255, g: 214, b: 79 } as Rgb,
  cameraLabel: { r: 226, g: 230, b: 236 } as Rgb,
} as const;

/** The cel-shaded/NPR scene palette (reduced, posterized families). */
export const CEL_SHADED_PALETTE = {
  skyBand: { r: 248, g: 236, b: 205 } as Rgb,
  skyBandAlt: { r: 238, g: 219, b: 172 } as Rgb,
  apron: { r: 106, g: 158, b: 96 } as Rgb,
  grassA: { r: 138, g: 186, b: 122 } as Rgb,
  grassB: { r: 122, g: 170, b: 106 } as Rgb,
  line: { r: 250, g: 250, b: 244 } as Rgb,
  shadow: { r: 66, g: 96, b: 72 } as Rgb,
  possession: { r: 255, g: 200, b: 62 } as Rgb,
  ball: { r: 252, g: 252, b: 252 } as Rgb,
  ink: { r: 24, g: 22, b: 28 } as Rgb,
  chip: { r: 24, g: 22, b: 28 } as Rgb,
  chipText: { r: 252, g: 250, b: 242 } as Rgb,
  hudText: { r: 24, g: 22, b: 28 } as Rgb,
  speedLine: { r: 252, g: 252, b: 252 } as Rgb,
  cameraLabel: { r: 24, g: 22, b: 28 } as Rgb,
} as const;
