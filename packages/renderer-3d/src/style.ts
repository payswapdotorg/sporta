/**
 * Identity-stable stylization + presentation constants for the avatar/field
 * 3D prototype (W602).
 *
 * CONSTITUTION (architecture-lock §6): frame-to-frame identity and motion
 * continuity are product-critical. This module makes identity stability true
 * BY CONSTRUCTION: every COLOR property of an entity is a pure function of
 * `(styleKey, entityId)` where `styleKey = "<rendererId>:<rendererVersion>"`.
 * There is no per-frame randomness, no Math.random, no time input, and —
 * crucially — no dependence on the entity's SWM `version` (which bumps on
 * every upsert): the same entityId under the same renderer version yields
 * the byte-identical style across every frame. Bumping the renderer version
 * is the ONLY way to restyle (a deliberate, versioned change).
 *
 * ## The height/heading producer decision (documented, W601's open slots)
 *
 * W601's CONTRACT.md records that NO current producer writes the SWM
 * `height`/`heading` entity slots, so real scenes today carry neither. This
 * renderer takes the CARRIED-ABSENT HONEST posture — it never invents
 * either:
 *
 * - **Heading** — drawn ONLY when the scene spec carries a `heading` slot
 *   with a usable radians value (a facing wedge on the avatar, dashed when
 *   the slot is uncertain). No heading slot → the avatar is a billboard
 *   figure that makes NO facing claim. The renderer does NOT derive heading
 *   from cross-frame position deltas: a frame is a pure function of ONE
 *   SceneSpecification (no motion evidence exists inside a single spec),
 *   and temporal derivation is W603's motion territory.
 * - **Ball height** — the ball's elevation is the spec's own `position.z`
 *   (W601 S6: the SWM's verbatim claim). When the spec carries no `z` the
 *   ball draws AT the pitch plane in a distinct height-unknown style (dashed
 *   outline, no shadow/drop line) and the manifest records
 *   `heightCarried: false` — a documented presentation convention for
 *   "height unknown", never a faked `z = 0` value in data.
 * - **Avatar body size** — the figure's 1.8 m height, 0.5 m shoulder width,
 *   0.14 m head radius are PRESENTATION constants of the avatar
 *   representation (the stylized marker's size, exactly like W502's fixed
 *   disc radius), versioned with this module. They are NOT claims about the
 *   entity's measured stature — participants' `height` slots are not
 *   elevation semantics (W601's documented reading rule) and are never
 *   re-interpreted here.
 *
 * A future SWM-side producer that populates `height`/`heading` slots needs
 * NO change in this package — W601 designed the slots for exactly that, and
 * the verbatim rules here keep the render honest when they arrive.
 */
import { AVATAR_FIELD_RENDERER_ID, AVATAR_FIELD_RENDERER_VERSION } from "./identity";

/** One two-tone avatar style: jersey fill plus trim (outline + accents). */
export interface AvatarStyle {
  /** Palette table index (0-based) — the identity-stable style token. */
  paletteIndex: number;
  /** Jersey fill color (flat palette). */
  jersey: string;
  /** Trim color: marker outline, legs, facing wedge, accents. */
  trim: string;
}

/**
 * The fixed avatar palette: 8 two-tone entries. Flat, saturated colors with
 * high figure/ground separation from the pitch greens — an ORIGINAL
 * first-party stylization (no proprietary game assets are used or
 * reproduced; architecture-lock §10 / roadmap G7). IMMUTABLE: changing an
 * entry changes every downstream frame and must ride a renderer version
 * bump.
 */
export const AVATAR_PALETTE: readonly AvatarStyle[] = [
  { paletteIndex: 0, jersey: "#2d6cdf", trim: "#ffd23f" },
  { paletteIndex: 1, jersey: "#e63946", trim: "#f8f9fa" },
  { paletteIndex: 2, jersey: "#2a9d8f", trim: "#17202a" },
  { paletteIndex: 3, jersey: "#f4a261", trim: "#1b2631" },
  { paletteIndex: 4, jersey: "#9b5de5", trim: "#ffd23f" },
  { paletteIndex: 5, jersey: "#00b4d8", trim: "#e63946" },
  { paletteIndex: 6, jersey: "#ef476f", trim: "#f8f9fa" },
  { paletteIndex: 7, jersey: "#ffd23f", trim: "#1b2631" },
];

/**
 * The fixed official (referee) style — one documented constant, not hashed:
 * officials are not players and dress uniformly, so their representation is
 * a fixed marker style (the same honesty posture as the fixed ball style).
 */
export const OFFICIAL_STYLE: AvatarStyle = {
  paletteIndex: 8,
  jersey: "#22223b",
  trim: "#ffd166",
};

/** The fixed ball style (the ball entity's look is constant, not hashed). */
export const BALL_STYLE: { fill: string; stroke: string } = {
  fill: "#fdfdf6",
  stroke: "#161a1f",
};

// ---------------------------------------------------------------------------
// Presentation constants of the avatar/field representations (see the
// module docblock: these size the STYLIZED MARKERS, they are not entity data)
// ---------------------------------------------------------------------------

/**
 * The avatar figure's body height in meters (presentation constant — the
 * stylized marker's size, like W502's fixed disc radius; NOT a claim about
 * the player's stature).
 */
export const AVATAR_BODY_HEIGHT_METERS = 1.8;

/** Avatar leg section: from the ground to this height, narrower (meters). */
export const AVATAR_LEG_TOP_METERS = 0.85;

/** Avatar torso section: from the leg top to this height, wider (meters). */
export const AVATAR_SHOULDER_METERS = 1.5;

/** Avatar head circle center height (meters). */
export const AVATAR_HEAD_CENTER_METERS = 1.66;

/** Avatar torso half-width at the shoulders (meters). */
export const AVATAR_SHOULDER_HALF_WIDTH_METERS = 0.25;

/** Avatar leg half-width (meters). */
export const AVATAR_LEG_HALF_WIDTH_METERS = 0.17;

/** Avatar head radius (meters). */
export const AVATAR_HEAD_RADIUS_METERS = 0.14;

/** Avatar neutral head color (fixed; heads are not identity-styled). */
export const AVATAR_HEAD_COLOR = "#c3cad6";

/** The facing-wedge length when the spec carries a heading (meters). */
export const AVATAR_FACING_LENGTH_METERS = 0.4;

/** The facing-wedge half-width at its base (meters). */
export const AVATAR_FACING_HALF_WIDTH_METERS = 0.18;

/** The facing-wedge center height on the billboard figure (meters). */
export const AVATAR_FACING_HEIGHT_METERS = 1.2;

/** The ground-shadow radius under an avatar (meters). */
export const AVATAR_SHADOW_RADIUS_METERS = 0.45;

/**
 * The ground-ring radius of the uncertainty halo (a candidate position):
 * 0.6 m, a documented presentation constant.
 */
export const HALO_RADIUS_METERS = 0.6;

/**
 * The ground-ring radius of the out-of-play marker: 0.55 m, a documented
 * presentation constant (the W502 out-of-play ring posture).
 */
export const OUT_OF_PLAY_RING_RADIUS_METERS = 0.55;

/**
 * The top-view marker radius (an overhead camera renders avatars as ground
 * markers — the view from directly above sees the body's footprint):
 * 0.3 m, a documented presentation constant.
 */
export const AVATAR_TOPVIEW_RADIUS_METERS = 0.3;

/**
 * The ball marker radius in meters: IFAB Law 2 fixes the ball's
 * circumference at 68–70 cm; the maximum gives
 * `r = 0.70 / (2π) ≈ 0.1114 m`, rendered as 0.11 (a public
 * Laws-of-the-Game dimension, like the Law 1 furniture — not invented).
 */
export const BALL_RADIUS_METERS = 0.11;

/** The possession ring radius around the possessing avatar's base (meters). */
export const POSSESSION_RING_RADIUS_METERS = 0.62;

/**
 * FNV-1a 32-bit hash (deterministic across engines: `Math.imul` gives exact
 * 32-bit multiply semantics; `>>> 0` keeps the accumulator unsigned).
 * Documented constants: offset basis `0x811c9dc5`, prime `0x01000193` (the
 * same public algorithm the W502 renderer uses; duplicated here so the two
 * renderer packages stay isolated from each other — architecture-lock §5).
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
 * The identity-stable avatar style for one entity under one style key.
 *
 * Pure: same `(styleKey, entityId)` → deep-equal result, forever. The
 * composite input is `"<styleKey>:<entityId>"`; the palette entry is
 * selected by `fnv1a32(composite) % AVATAR_PALETTE.length`. The returned
 * object is a fresh clone each call (callers may not mutate the table).
 */
export function stableAvatarStyle(styleKey: string, entityId: string): AvatarStyle {
  const hash = fnv1a32(`${styleKey}:${entityId}`);
  const entry = AVATAR_PALETTE[hash % AVATAR_PALETTE.length]!;
  return { ...entry };
}

/** The style key of this renderer version: `"<rendererId>:<rendererVersion>"`. */
export function avatarFieldStyleKey(): string {
  return `${AVATAR_FIELD_RENDERER_ID}:${AVATAR_FIELD_RENDERER_VERSION}`;
}

/**
 * The identity-stable avatar style for one entity under THIS renderer
 * version. Convenience wrapper over {@link stableAvatarStyle} with the
 * package's fixed style key.
 */
export function avatarEntityStyle(entityId: string): AvatarStyle {
  return stableAvatarStyle(avatarFieldStyleKey(), entityId);
}

/**
 * Confidence → visual weight mapping (documented formula, never inverted):
 * `opacity = 0.35 + 0.65 * confidence`. A fully confident value renders
 * opaque (1.0); a zero-confidence value still renders (0.35) — uncertainty
 * reduces visual weight but never invents confidence or hides the fact.
 * `undefined` confidence (absent in the spec) maps to `undefined`: the
 * caller renders with NO opacity attribute (neutral styling, an honest
 * no-claim default) rather than a fabricated number.
 */
export function opacityFromConfidence(confidence: number | undefined): number | undefined {
  if (confidence === undefined) return undefined;
  return Math.round((0.35 + 0.65 * confidence) * 1000) / 1000;
}
