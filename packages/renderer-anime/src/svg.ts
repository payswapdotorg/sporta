/**
 * Deterministic SVG frame synthesis for the anime prototype (W502).
 *
 * `composeFrameSvg` is a PURE function: the same input scene always yields
 * the byte-identical SVG document (element order, attribute order, and
 * number formatting are all fixed; no randomness, no clocks). Procedural
 * flat-color graphics only — no external graphics/ML/image-gen
 * dependencies, no proprietary game assets (architecture-lock §10).
 *
 * Frame layout (see `./geometry.ts` for the mapping math):
 *
 * - grass: 10 alternating vertical stripes over the full canvas above the
 *   caption band (flat two-green anime palette);
 * - pitch markings: boundary, halfway line, center circle + spot, penalty
 *   areas, goal areas, penalty spots, penalty arcs (Laws-of-the-Game
 *   standard dimensions);
 * - entity markers in SNAPSHOT ORDER (input order preserved — never
 *   re-sorted), each inside a `<g data-entity="…">` for tooling;
 * - a caption band: status line (left) and event phrases (second line).
 *
 * Number formatting: coordinates to 2 decimals, opacity to 3 (rounding is
 * display-only; the manifest keeps the true values). Text content is
 * XML-escaped (event ids are free-form strings upstream).
 */
import { BALL_STYLE, opacityFromConfidence } from "./palette";
import type { PlayerStyle } from "./palette";
import {
  CANVAS_H,
  CANVAS_W,
  CAPTION_BAND_H,
  CAPTION_BAND_Y,
  MARGIN,
  PITCH_CENTER_X,
  PITCH_CENTER_Y,
  PITCH_LEFT,
  PITCH_MARKINGS,
  PITCH_RECT,
  PITCH_TOP,
} from "./geometry";
import type { CanvasPoint } from "./geometry";

/** The fixed anime flat-color palette for the field and chrome. */
export const FIELD_PALETTE = {
  grassLight: "#6fc464",
  grassDark: "#64b759",
  lines: "#f2f7ee",
  captionBand: "#1d2a3a",
  captionText: "#f4f7f0",
  captionEventText: "#ffd166",
  outOfPlay: "#d9534f",
} as const;

/** The fixed font stack for all text (deterministic serialization). */
const FONT_FAMILY = "'DejaVu Sans', Arial, sans-serif";

/** XML-escaping for text nodes and attribute values (deterministic). */
export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Number → string with 2-decimal rounding (SVG coordinates). */
function n2(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Number → string with 3-decimal rounding (opacity). */
function n3(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** Player marker radius in canvas units (1.2 m equivalent). */
const PLAYER_R = 12;

/** Ball marker radius in canvas units. */
const BALL_R = 6;

/** Uncertainty halo radius (candidate positions, dashed). */
const HALO_R = 17;

/** Possession ring radius. */
const POSSESSION_R = 20;

/** One entity marker to draw. */
export interface SvgMarker {
  entityId: string;
  kind: "participant" | "ball";
  /** The TRUE (rounded) canvas position — never clamped. */
  canvas: CanvasPoint;
  /** Out-of-play styling (dashed red ring + `OUT` tag). */
  outOfPlay: boolean;
  /** Candidate (uncertain) position styling: dashed halo. */
  uncertain: boolean;
  /** Verbatim slot confidence; `undefined` renders NO opacity attribute. */
  confidence?: number;
  /** Participant style (identity-stable); balls use the fixed ball style. */
  style?: PlayerStyle;
}

/** The possession ring to draw (around a rendered participant), if any. */
export interface SvgPossession {
  /** The entity the ring belongs to (matched by id, never by position). */
  entityId: string;
  canvas: CanvasPoint;
  /** Verbatim confidence; `undefined` renders NO opacity attribute. */
  confidence?: number;
}

/** Everything one frame needs (already resolved; pure input). */
export interface SvgFrameInput {
  frameIndex: number;
  markers: SvgMarker[];
  possession: SvgPossession | null;
  /** The assembled status line, or `null` when football state is absent. */
  statusLine: string | null;
  /** Caption phrases for this frame's events, in input order. */
  eventPhrases: string[];
}

/** The grass background: 10 alternating stripes above the caption band. */
function grassSvg(): string {
  const stripeW = CANVAS_W / 10; // 117 units
  const parts: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const fill = i % 2 === 0 ? FIELD_PALETTE.grassLight : FIELD_PALETTE.grassDark;
    const x = i * stripeW;
    parts.push(
      `<rect x="${n2(x)}" y="0" width="${n2(stripeW)}" height="${n2(CAPTION_BAND_Y)}" fill="${fill}"/>`,
    );
  }
  return parts.join("");
}

/** The pitch markings group (fixed element order, pinned by tests). */
function pitchMarkingsSvg(): string {
  const line = FIELD_PALETTE.lines;
  const penaltyTop = n2(PITCH_CENTER_Y - PITCH_MARKINGS.penaltyWidth / 2);
  const penaltyH = n2(PITCH_MARKINGS.penaltyWidth);
  const goalTop = n2(PITCH_CENTER_Y - PITCH_MARKINGS.goalAreaWidth / 2);
  const goalH = n2(PITCH_MARKINGS.goalAreaWidth);
  return (
    `<rect x="${PITCH_RECT.x}" y="${PITCH_RECT.y}" width="${n2(PITCH_RECT.w)}" height="${n2(PITCH_RECT.h)}" fill="none" stroke="${line}" stroke-width="3"/>` +
    `<line x1="${PITCH_CENTER_X}" y1="${PITCH_TOP}" x2="${PITCH_CENTER_X}" y2="${n2(PITCH_TOP + PITCH_RECT.h)}" stroke="${line}" stroke-width="3"/>` +
    `<circle cx="${PITCH_CENTER_X}" cy="${PITCH_CENTER_Y}" r="${n2(PITCH_MARKINGS.centerCircleR)}" fill="none" stroke="${line}" stroke-width="3"/>` +
    `<circle cx="${PITCH_CENTER_X}" cy="${PITCH_CENTER_Y}" r="3" fill="${line}"/>` +
    `<rect x="${PITCH_LEFT}" y="${penaltyTop}" width="${n2(PITCH_MARKINGS.penaltyDepth)}" height="${penaltyH}" fill="none" stroke="${line}" stroke-width="3"/>` +
    `<rect x="${n2(CANVAS_W - MARGIN - PITCH_MARKINGS.penaltyDepth)}" y="${penaltyTop}" width="${n2(PITCH_MARKINGS.penaltyDepth)}" height="${penaltyH}" fill="none" stroke="${line}" stroke-width="3"/>` +
    `<rect x="${PITCH_LEFT}" y="${goalTop}" width="${n2(PITCH_MARKINGS.goalAreaDepth)}" height="${goalH}" fill="none" stroke="${line}" stroke-width="3"/>` +
    `<rect x="${n2(CANVAS_W - MARGIN - PITCH_MARKINGS.goalAreaDepth)}" y="${goalTop}" width="${n2(PITCH_MARKINGS.goalAreaDepth)}" height="${goalH}" fill="none" stroke="${line}" stroke-width="3"/>` +
    `<circle cx="${PITCH_MARKINGS.penaltySpotLeft.x}" cy="${PITCH_MARKINGS.penaltySpotLeft.y}" r="3" fill="${line}"/>` +
    `<circle cx="${PITCH_MARKINGS.penaltySpotRight.x}" cy="${PITCH_MARKINGS.penaltySpotRight.y}" r="3" fill="${line}"/>` +
    `<path d="${PITCH_MARKINGS.leftPenaltyArcPath}" fill="none" stroke="${line}" stroke-width="3"/>` +
    `<path d="${PITCH_MARKINGS.rightPenaltyArcPath}" fill="none" stroke="${line}" stroke-width="3"/>`
  );
}

/** Optional `opacity="…"` attribute; absent when confidence is absent. */
function opacityAttr(confidence: number | undefined): string {
  const opacity = opacityFromConfidence(confidence);
  return opacity === undefined ? "" : ` opacity="${n3(opacity)}"`;
}

/** One participant marker (identity-stable style, honest uncertainty). */
function participantSvg(marker: SvgMarker): string {
  if (marker.style === undefined) {
    // Fail-loud on a malformed public-API input: a participant marker
    // without its identity-stable style would otherwise crash cryptically.
    throw new TypeError(
      `participant marker for entity "${marker.entityId}" requires SvgMarker.style`,
    );
  }
  const style = marker.style;
  const entityId = escapeXml(marker.entityId);
  const opacity = opacityAttr(marker.confidence);
  if (marker.outOfPlay) {
    return (
      `<g data-entity="${entityId}" data-out-of-play="true">` +
      `<circle cx="${n2(marker.canvas.x)}" cy="${n2(marker.canvas.y)}" r="${PLAYER_R}" fill="none" stroke="${FIELD_PALETTE.outOfPlay}" stroke-width="3" stroke-dasharray="6 4"/>` +
      `<text x="${n2(marker.canvas.x)}" y="${n2(marker.canvas.y - PLAYER_R - 4)}" text-anchor="middle" font-size="12" font-family="${FONT_FAMILY}" fill="${FIELD_PALETTE.outOfPlay}">OUT</text>` +
      `</g>`
    );
  }
  const halo = marker.uncertain
    ? `<circle cx="${n2(marker.canvas.x)}" cy="${n2(marker.canvas.y)}" r="${HALO_R}" fill="none" stroke="${style.trim}" stroke-width="2" stroke-dasharray="4 3"/>`
    : "";
  return (
    `<g data-entity="${entityId}">` +
    halo +
    `<circle cx="${n2(marker.canvas.x)}" cy="${n2(marker.canvas.y)}" r="${PLAYER_R}" fill="${style.jersey}" stroke="${style.trim}" stroke-width="3"${opacity}/>` +
    `<text x="${n2(marker.canvas.x)}" y="${n2(marker.canvas.y + PLAYER_R + 14)}" text-anchor="middle" font-size="13" font-family="${FONT_FAMILY}" fill="${FIELD_PALETTE.captionText}">${entityId}</text>` +
    `</g>`
  );
}

/** One ball marker (fixed style, honest opacity from confidence). */
function ballSvg(marker: SvgMarker): string {
  const entityId = escapeXml(marker.entityId);
  const opacity = opacityAttr(marker.confidence);
  if (marker.outOfPlay) {
    return (
      `<g data-entity="${entityId}" data-out-of-play="true">` +
      `<circle cx="${n2(marker.canvas.x)}" cy="${n2(marker.canvas.y)}" r="${BALL_R}" fill="none" stroke="${FIELD_PALETTE.outOfPlay}" stroke-width="2" stroke-dasharray="4 3"/>` +
      `<text x="${n2(marker.canvas.x)}" y="${n2(marker.canvas.y - BALL_R - 4)}" text-anchor="middle" font-size="12" font-family="${FONT_FAMILY}" fill="${FIELD_PALETTE.outOfPlay}">OUT</text>` +
      `</g>`
    );
  }
  return (
    `<g data-entity="${entityId}">` +
    `<circle cx="${n2(marker.canvas.x)}" cy="${n2(marker.canvas.y)}" r="${BALL_R}" fill="${BALL_STYLE.fill}" stroke="${BALL_STYLE.stroke}" stroke-width="2"${opacity}/>` +
    `</g>`
  );
}

/** The possession ring (drawn under its participant marker by the caller). */
export function possessionRingSvg(possession: SvgPossession): string {
  const opacity = opacityAttr(possession.confidence);
  return (
    `<circle cx="${n2(possession.canvas.x)}" cy="${n2(possession.canvas.y)}" r="${POSSESSION_R}" ` +
    `fill="none" stroke="${FIELD_PALETTE.captionEventText}" stroke-width="3" stroke-dasharray="8 6"${opacity}/>`
  );
}

/** The caption band: status line + event phrases (verbatim caption text). */
function captionBandSvg(input: SvgFrameInput): string {
  const parts: string[] = [
    `<rect x="0" y="${n2(CAPTION_BAND_Y)}" width="${n2(CANVAS_W)}" height="${n2(CAPTION_BAND_H)}" fill="${FIELD_PALETTE.captionBand}"/>`,
  ];
  if (input.statusLine !== null) {
    parts.push(
      `<text x="70" y="${n2(CAPTION_BAND_Y + 38)}" font-size="20" font-family="${FONT_FAMILY}" fill="${FIELD_PALETTE.captionText}">${escapeXml(input.statusLine)}</text>`,
    );
  }
  if (input.eventPhrases.length > 0) {
    parts.push(
      `<text x="70" y="${n2(CAPTION_BAND_Y + 68)}" font-size="22" font-weight="bold" font-family="${FONT_FAMILY}" fill="${FIELD_PALETTE.captionEventText}">${escapeXml(input.eventPhrases.join(" · "))}</text>`,
    );
  }
  return parts.join("");
}

/**
 * Composes one complete SVG document for a frame. Pure and deterministic:
 * fixed element order (grass → markings → markers in input order, each
 * possession ring immediately under its participant marker → caption
 * band), fixed attribute order, 2/3-decimal number formatting.
 */
export function composeFrameSvg(input: SvgFrameInput): string {
  const markers = input.markers
    .map((marker) => {
      // The possession ring is drawn UNDER the marker of the possessing
      // entity — matched by ENTITY ID (never by position, which could
      // collide between entities).
      const ring =
        input.possession !== null && input.possession.entityId === marker.entityId
          ? possessionRingSvg(input.possession)
          : "";
      const body = marker.kind === "ball" ? ballSvg(marker) : participantSvg(marker);
      return ring + body;
    })
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">` +
    `<title>anime.prototype frame ${input.frameIndex}</title>` +
    grassSvg() +
    pitchMarkingsSvg() +
    markers +
    captionBandSvg(input) +
    `</svg>`
  );
}
