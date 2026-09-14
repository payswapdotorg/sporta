/**
 * Deterministic SVG frame synthesis for the avatar/field prototype (W602):
 * the 3D-look presentation layer.
 *
 * `composeFrame3dSvg` is a PURE function: the same input always yields the
 * byte-identical SVG document — fixed element order, fixed attribute order,
 * fixed 2-decimal number formatting; no randomness, no clocks, no external
 * references, no scripts. Procedural flat-color graphics only — an ORIGINAL
 * stylized representation (no proprietary game assets; architecture-lock
 * §10 / roadmap G7).
 *
 * Frame layout (painter's order, documented):
 *
 * 1. backdrop: a flat dusk fill over the whole canvas;
 * 2. the ground polygons (apron → pitch → 10 mow stripes), near-plane
 *    clipped in camera space, then perspective-projected;
 * 3. the pitch markings (boundary, halfway, areas, spots, arcs, center
 *    circle) and the 3D goal frames as clipped, projected line segments;
 * 4. the possession ring (ground level);
 * 5. the entity figures, depth-sorted far → near (the painter's algorithm
 *    for opaque figures): each inside a `<g data-entity="…">` for tooling;
 * 6. the HUD annotation band (status line, camera-slot label, event chips).
 *
 * Depth cues are honest perspective artifacts, never decorations: figure
 * size falls with camera depth, elevated balls carry a ground shadow plus a
 * dashed drop line (only when the spec carries the height), and the ground
 * rings (haloes, possession) are projected polygons (perspective-true, not
 * screen circles).
 */
import { AVATAR_HEAD_COLOR, BALL_STYLE } from "./style";
import {
  clipPolygonNear,
  clipSegmentNear,
  projectCameraPoint,
  projectedRadius,
  toCameraSpace,
  NEAR_PLANE_METERS,
} from "./camera";
import type { CameraFrame } from "./camera";
import type { FieldDot, FieldGeometry, FieldLine, GroundPolygon } from "./furniture";
import { FIELD_DOT_RADIUS_METERS } from "./furniture";
import type {
  AvatarDrawable,
  BallDrawable,
  CanvasSize,
  EntityDrawable,
  PossessionDrawable,
  ScreenPoint,
  ScreenPolygon,
} from "./scene";
import { HUD_HEIGHT } from "./scene";
import { escapeXml, round2, round3 } from "./internal";

/** The fixed flat-color palette of the field, chrome, and annotation layer. */
export const FIELD_PALETTE = {
  backdrop: "#232b36",
  apron: "#2c5a3a",
  pitch: "#3f7a4b",
  stripeA: "#42804f",
  stripeB: "#3b7347",
  lines: "#eef4ea",
  possession: "#ffd166",
  outOfPlay: "#d9534f",
  hudBand: "#10151d",
  hudText: "#f4f7f0",
  hudCameraText: "#9fb2c8",
  hudEventText: "#ffd166",
  shadow: "#1c2f22",
  dropLine: "#161a1f",
} as const;

/** The fixed font stack for all text (deterministic serialization). */
const FONT_FAMILY = "'DejaVu Sans', Arial, sans-serif";

/** Number → string with 2-decimal rounding (screen coordinates). */
function n2(value: number): string {
  return String(round2(value));
}

/** Optional `opacity="…"` attribute; absent when confidence is absent. */
function opacityAttr(opacity: number | undefined): string {
  return opacity === undefined ? "" : ` opacity="${String(round3(opacity))}"`;
}

/** The `points` attribute of a screen polygon. */
function pointsOf(points: ScreenPolygon): string {
  return points.map((point) => `${n2(point.x)},${n2(point.y)}`).join(" ");
}

/** The polygon attribute for a ground-polygon fill key. */
function groundFill(fill: GroundPolygon["fill"]): string {
  switch (fill) {
    case "apron":
      return FIELD_PALETTE.apron;
    case "pitch":
      return FIELD_PALETTE.pitch;
    case "stripe-a":
      return FIELD_PALETTE.stripeA;
    case "stripe-b":
      return FIELD_PALETTE.stripeB;
  }
}

/** Everything one SVG frame needs (already resolved; pure input). */
export interface Svg3dFrameInput {
  frameIndex: number;
  camera: CameraFrame;
  canvas: CanvasSize;
  field: FieldGeometry;
  /** The drawable entities, depth-sorted far → near. */
  entities: EntityDrawable[];
  possession: PossessionDrawable | null;
  hud: {
    statusLine: string | null;
    cameraLabel: string;
    eventChips: string[];
  };
}

// ---------------------------------------------------------------------------
// Field geometry serialization (3D → near-clip → perspective → SVG)
// ---------------------------------------------------------------------------

/** Serializes one ground polygon (near-clipped, projected). */
function groundPolygonSvg(polygon: GroundPolygon, camera: CameraFrame, canvas: CanvasSize): string {
  const cameraPoints = polygon.points.map((point) => toCameraSpace(camera, point));
  const clipped = clipPolygonNear(cameraPoints);
  if (clipped.length < 3) return "";
  const projected = clipped
    .map((point) => projectCameraPoint(point, canvas))
    .filter((point): point is NonNullable<typeof point> => point !== undefined);
  if (projected.length < 3) return "";
  return `<polygon points="${pointsOf(projected)}" fill="${groundFill(polygon.fill)}"/>`;
}

/** Serializes one marking/goal line (near-clipped segment, projected). */
function fieldLineSvg(line: FieldLine, camera: CameraFrame, canvas: CanvasSize): string {
  const a = toCameraSpace(camera, line.from);
  const b = toCameraSpace(camera, line.to);
  const clipped = clipSegmentNear(a, b);
  if (clipped === null) return "";
  const from = projectCameraPoint(clipped[0], canvas);
  const to = projectCameraPoint(clipped[1], canvas);
  if (from === undefined || to === undefined) return "";
  const width = line.kind === "goal-frame" ? 3 : 2;
  return `<line x1="${n2(from.x)}" y1="${n2(from.y)}" x2="${n2(to.x)}" y2="${n2(to.y)}" stroke="${FIELD_PALETTE.lines}" stroke-width="${width}"/>`;
}

/** Serializes one point marker (a projected dot). */
function fieldDotSvg(dot: FieldDot, camera: CameraFrame, canvas: CanvasSize): string {
  const cameraPoint = toCameraSpace(camera, dot.center);
  if (cameraPoint.z < NEAR_PLANE_METERS) return ""; // Behind the near plane: skipped.
  const projected = projectCameraPoint(cameraPoint, canvas);
  if (projected === undefined) return "";
  return `<circle cx="${n2(projected.x)}" cy="${n2(projected.y)}" r="${n2(projectedRadius(FIELD_DOT_RADIUS_METERS, projected.depth))}" fill="${FIELD_PALETTE.lines}"/>`;
}

/** The whole field group (fixed element order). */
function fieldSvg(field: FieldGeometry, camera: CameraFrame, canvas: CanvasSize): string {
  const parts: string[] = [];
  for (const polygon of field.polygons) {
    parts.push(groundPolygonSvg(polygon, camera, canvas));
  }
  for (const line of field.lines) {
    parts.push(fieldLineSvg(line, camera, canvas));
  }
  for (const dot of field.dots) {
    parts.push(fieldDotSvg(dot, camera, canvas));
  }
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Entity serialization (depth-sorted, honest uncertainty + height)
// ---------------------------------------------------------------------------

/** The uncertainty halo ring (a candidate position, dashed). */
function haloSvg(halo: ScreenPolygon, trim: string): string {
  return `<polygon points="${pointsOf(halo)}" fill="none" stroke="${trim}" stroke-width="2" stroke-dasharray="4 3"/>`;
}

/** The out-of-play marker ring + OUT tag (the accounted marker posture). */
function outOfPlaySvg(base: ScreenPoint, ringRadius: number): string {
  return (
    `<circle cx="${n2(base.x)}" cy="${n2(base.y)}" r="${n2(ringRadius)}" fill="none" stroke="${FIELD_PALETTE.outOfPlay}" stroke-width="3" stroke-dasharray="6 4"/>` +
    `<text x="${n2(base.x)}" y="${n2(base.y - ringRadius - 6)}" text-anchor="middle" font-size="12" font-family="${FONT_FAMILY}" fill="${FIELD_PALETTE.outOfPlay}">OUT</text>`
  );
}

/** The entity id label under a figure (verbatim id, XML-escaped). */
function labelSvg(base: ScreenPoint, entityId: string): string {
  return `<text x="${n2(base.x)}" y="${n2(base.y + 18)}" text-anchor="middle" font-size="13" font-family="${FONT_FAMILY}" fill="${FIELD_PALETTE.lines}">${escapeXml(entityId)}</text>`;
}

/** One avatar group (figure or top-view marker, plus halo/ring/label). */
function avatarSvg(entity: AvatarDrawable): string {
  const entityId = escapeXml(entity.entityId);
  const opacity = opacityAttr(entity.opacity);
  const parts: string[] = [];
  if (entity.halo !== null) {
    parts.push(haloSvg(entity.halo, entity.style.trim));
  }
  if (entity.outOfPlay) {
    parts.push(outOfPlaySvg(entity.base, entity.ringRadius));
    parts.push(labelSvg(entity.base, entity.entityId));
    return `<g data-entity="${entityId}">${parts.join("")}</g>`;
  }
  const figure = entity.figure;
  if (figure !== null) {
    parts.push(
      `<polygon points="${pointsOf(figure.legs)}" fill="${entity.style.trim}"${opacity}/>`,
    );
    parts.push(
      `<polygon points="${pointsOf(figure.torso)}" fill="${entity.style.jersey}" stroke="${entity.style.trim}" stroke-width="1.5"${opacity}/>`,
    );
    parts.push(
      `<circle cx="${n2(figure.head.cx)}" cy="${n2(figure.head.cy)}" r="${n2(figure.head.r)}" fill="${AVATAR_HEAD_COLOR}" stroke="${entity.style.trim}" stroke-width="1"${opacity}/>`,
    );
    if (figure.facing !== null) {
      const dash = entity.facingDashed ? ' stroke-dasharray="3 3"' : "";
      parts.push(
        `<polygon points="${pointsOf(figure.facing)}" fill="${entity.style.trim}" stroke="${entity.style.trim}" stroke-width="1"${dash}/>`,
      );
    }
  }
  const topView = entity.topView;
  if (topView !== null) {
    parts.push(
      `<polygon points="${pointsOf(topView.circle)}" fill="${entity.style.jersey}" stroke="${entity.style.trim}" stroke-width="2"${opacity}/>`,
    );
    if (topView.facing !== null) {
      const dash = entity.facingDashed ? ' stroke-dasharray="3 3"' : "";
      parts.push(
        `<polygon points="${pointsOf(topView.facing)}" fill="${entity.style.trim}" stroke="${entity.style.trim}" stroke-width="1"${dash}/>`,
      );
    }
  }
  parts.push(labelSvg(entity.base, entity.entityId));
  return `<g data-entity="${entityId}">${parts.join("")}</g>`;
}

/** One ball group (elevated with shadow + drop line only when carried). */
function ballSvg(entity: BallDrawable): string {
  const entityId = escapeXml(entity.entityId);
  const opacity = opacityAttr(entity.opacity);
  if (entity.outOfPlay) {
    return (
      `<g data-entity="${entityId}" data-out-of-play="true">` +
      `<circle cx="${n2(entity.center.x)}" cy="${n2(entity.center.y)}" r="${n2(entity.radius)}" fill="none" stroke="${FIELD_PALETTE.outOfPlay}" stroke-width="2" stroke-dasharray="4 3"/>` +
      `<text x="${n2(entity.center.x)}" y="${n2(entity.center.y - entity.radius - 6)}" text-anchor="middle" font-size="12" font-family="${FONT_FAMILY}" fill="${FIELD_PALETTE.outOfPlay}">OUT</text>` +
      `</g>`
    );
  }
  const parts: string[] = [];
  if (entity.heightCarried) {
    // The honest height depth cues: ground shadow directly below + dashed
    // drop line — present ONLY when the spec carried the ball's z.
    if (entity.shadow !== null) {
      parts.push(
        `<polygon points="${pointsOf(entity.shadow)}" fill="${FIELD_PALETTE.shadow}" fill-opacity="0.4"/>`,
      );
    }
    if (entity.dropTo !== null) {
      parts.push(
        `<line x1="${n2(entity.center.x)}" y1="${n2(entity.center.y)}" x2="${n2(entity.dropTo.x)}" y2="${n2(entity.dropTo.y)}" stroke="${FIELD_PALETTE.dropLine}" stroke-width="1" stroke-dasharray="2 3"/>`,
      );
    }
  }
  const dash = entity.heightCarried ? "" : ' stroke-dasharray="3 3"';
  parts.push(
    `<circle cx="${n2(entity.center.x)}" cy="${n2(entity.center.y)}" r="${n2(entity.radius)}" fill="${BALL_STYLE.fill}" stroke="${BALL_STYLE.stroke}" stroke-width="1.5"${dash}${opacity}/>`,
  );
  return `<g data-entity="${entityId}">${parts.join("")}</g>`;
}

/** The possession ring (ground level, dashed). */
function possessionSvg(possession: PossessionDrawable): string {
  return `<polygon points="${pointsOf(possession.polygon)}" fill="none" stroke="${FIELD_PALETTE.possession}" stroke-width="2" stroke-dasharray="6 5"${opacityAttr(possession.opacity)}/>`;
}

// ---------------------------------------------------------------------------
// HUD band
// ---------------------------------------------------------------------------

/** The HUD annotation band (status line, camera label, event chips). */
function hudSvg(input: Svg3dFrameInput): string {
  const width = input.canvas.width;
  const parts: string[] = [
    `<rect x="0" y="0" width="${n2(width)}" height="${n2(HUD_HEIGHT)}" fill="${FIELD_PALETTE.hudBand}"/>`,
  ];
  if (input.hud.statusLine !== null) {
    parts.push(
      `<text x="24" y="28" font-size="20" font-family="${FONT_FAMILY}" fill="${FIELD_PALETTE.hudText}">${escapeXml(input.hud.statusLine)}</text>`,
    );
  }
  parts.push(
    `<text x="${n2(width - 24)}" y="28" text-anchor="end" font-size="18" font-family="${FONT_FAMILY}" fill="${FIELD_PALETTE.hudCameraText}">${escapeXml(input.hud.cameraLabel)}</text>`,
  );
  if (input.hud.eventChips.length > 0) {
    parts.push(
      `<text x="24" y="52" font-size="18" font-weight="bold" font-family="${FONT_FAMILY}" fill="${FIELD_PALETTE.hudEventText}">${escapeXml(input.hud.eventChips.join(" · "))}</text>`,
    );
  }
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Composes one complete SVG document for a frame. Pure and deterministic:
 * fixed element order (backdrop → ground polygons → markings/dots →
 * possession ring → entity groups in depth order → HUD band), fixed
 * attribute order, 2-decimal number formatting.
 */
export function composeFrame3dSvg(input: Svg3dFrameInput): string {
  const backdrop = `<rect x="0" y="0" width="${n2(input.canvas.width)}" height="${n2(input.canvas.height)}" fill="${FIELD_PALETTE.backdrop}"/>`;
  const possession = input.possession !== null ? possessionSvg(input.possession) : "";
  const entities = input.entities
    .map((entity) => (entity.type === "ball" ? ballSvg(entity) : avatarSvg(entity)))
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n2(input.canvas.width)} ${n2(input.canvas.height)}">` +
    `<title>avatar-field.prototype frame ${input.frameIndex}</title>` +
    backdrop +
    fieldSvg(input.field, input.camera, input.canvas) +
    possession +
    entities +
    hudSvg(input) +
    `</svg>`
  );
}
