/**
 * The tactical frame painter (R301): paints ONE frame of the tactical view
 * into a {@link FrameBuffer} from the canonical scene + view-model.
 *
 * Determinism: `drawTacticalFrame` is a pure function of its inputs — no
 * RNG, no clocks (the elapsed time is an explicit parameter), no I/O. The
 * same inputs always produce the same pixel bytes.
 *
 * Presentation honesty:
 * - entity markers are placed at the scene's verbatim meter positions
 *   (out-of-bounds entities keep their TRUE coordinates and are outlined
 *   differently, never clamped);
 * - the match clock/score panel shows the snapshot's verbatim football state
 *   (the clock does NOT tick — the SWM carries one state; no invented time);
 * - event badges appear on the clip timeline at their verbatim event times
 *   (clamped to the clip window edges, so no applied event is silently
 *   invisible; corrections are marked);
 * - the uncertainty of a position is drawn as a dashed confidence ring, never
 *   resolved away.
 */
import type { SceneSpecification } from "@sporta/scene-projection";
import { darken, lighten, type FrameBuffer, type Rgb } from "./canvas";
import { markerStyleOf, TACTICAL_BALL_STYLE } from "./palette";
import { OVERLAY_BAND_PX, pitchLayout, toPixels } from "./pitch";
import type { TacticalSceneView } from "./scene";

/** The surrounding color outside the pitch (dark analysis-room tone). */
const SURROUND: Rgb = [18, 22, 26];

/** The base grass color and the mowing-stripe tone. */
const GRASS: Rgb = [42, 96, 48];
const GRASS_STRIPE: Rgb = lighten(GRASS, 9);

/** The pitch marking color. */
const LINE: Rgb = [235, 238, 228];

/** The overlay band colors. */
const OVERLAY_BG: Rgb = [24, 28, 32];
const OVERLAY_TEXT: Rgb = [235, 238, 228];
const OVERLAY_DIM: Rgb = [148, 156, 164];
const PROGRESS_FILL: Rgb = [240, 200, 74];

/** The badge color per football event type tail (fallback: amber). */
const EVENT_COLORS: Record<string, Rgb> = {
  goal: [214, 79, 79],
  pass: [63, 174, 122],
  carry: [94, 148, 84],
  tackle: [47, 168, 201],
  shot: [232, 135, 58],
  save: [47, 168, 201],
  card: [240, 200, 74],
  substitution: [142, 91, 192],
  offside: [201, 79, 142],
  "possession-change": [148, 156, 164],
  "referee-decision": [142, 91, 192],
  "replay-cue": [148, 156, 164],
  kickoff: [63, 174, 122],
  restart: [63, 174, 122],
  "injury-pause": [201, 79, 142],
  "commentary-emphasis": [148, 156, 164],
};

/** Everything one frame needs. */
export interface TacticalFrameInput {
  /** The canonical scene specification (furniture, verbatim blocks). */
  scene: SceneSpecification;
  /** The tactical view-model of the same scene. */
  view: TacticalSceneView;
  /** The frame's elapsed time within the clip, ms ([0, durationMs)). */
  elapsedMs: number;
  /** The clip duration, ms. */
  durationMs: number;
  /** The session-time origin of the clip (the snapshot watermark, ms). */
  videoOriginMs: number;
}

/** Formats session-time milliseconds as `MM:SS`. */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** The short period label. */
function periodLabel(period: string | undefined): string {
  switch (period) {
    case "first-half":
      return "P1";
    case "second-half":
      return "P2";
    case "half-time":
      return "HT";
    case "pre-match":
      return "PRE";
    case "post-match":
      return "FT";
    case "stoppage":
      return "STOP";
    default:
      return "P?";
  }
}

/** The jersey token of an entity id: its last digit run (e.g. "player-7" -> "7"). */
function jerseyOf(entityId: string): string {
  const matches = entityId.match(/\d+/g);
  if (matches === null || matches.length === 0) return "";
  return matches[matches.length - 1]!;
}

/** Draws the grass with mowing stripes over the play area. */
function drawPitchSurface(buffer: FrameBuffer, scene: SceneSpecification): void {
  const layout = pitchLayout(buffer.width, buffer.height);
  const bounds = scene.world.pitch.bounds;
  const x0 = layout.originX + bounds.xMin * layout.scale;
  const y0 = layout.originY + bounds.yMin * layout.scale;
  const w = (bounds.xMax - bounds.xMin) * layout.scale;
  const h = (bounds.yMax - bounds.yMin) * layout.scale;
  buffer.fillRect(x0, y0, w, h, GRASS);
  // Ten mowing stripes across the length, alternating the tone.
  const stripes = 10;
  const stripeW = w / stripes;
  for (let i = 0; i < stripes; i += 1) {
    if (i % 2 === 0) continue;
    buffer.fillRect(x0 + i * stripeW, y0, stripeW, h, GRASS_STRIPE);
  }
}

/** Draws the pitch furniture (markings) from the scene's verbatim geometry. */
function drawFurniture(buffer: FrameBuffer, scene: SceneSpecification): void {
  const layout = pitchLayout(buffer.width, buffer.height);
  const f = scene.world.pitch.furniture;

  // Touchline / goal line rectangle.
  const bounds = scene.world.pitch.bounds;
  const x0 = layout.originX + bounds.xMin * layout.scale;
  const y0 = layout.originY + bounds.yMin * layout.scale;
  const w = (bounds.xMax - bounds.xMin) * layout.scale;
  const h = (bounds.yMax - bounds.yMin) * layout.scale;
  buffer.strokeRect(x0, y0, w, h, LINE);

  // Halfway line + center circle + center mark.
  const center = toPixels(layout, f.centerCircle.center);
  buffer.drawLine(center.x, y0, center.x, y0 + h, LINE);
  buffer.strokeCircle(center.x, center.y, f.centerCircle.radiusMeters * layout.scale, LINE);
  buffer.fillCircle(center.x, center.y, 2, LINE);

  // Penalty areas, goal areas, penalty spots.
  for (const area of [...f.penaltyAreas, ...f.goalAreas]) {
    const px = layout.originX + area.bounds.xMin * layout.scale;
    const py = layout.originY + area.bounds.yMin * layout.scale;
    const pw = (area.bounds.xMax - area.bounds.xMin) * layout.scale;
    const ph = (area.bounds.yMax - area.bounds.yMin) * layout.scale;
    buffer.strokeRect(px, py, pw, ph, LINE);
  }
  for (const spot of f.penaltySpots) {
    const p = toPixels(layout, spot.position);
    buffer.fillCircle(p.x, p.y, 2, LINE);
  }

  // Corner arcs (quarter circles inside the pitch).
  for (const arc of f.cornerArcs) {
    const c = toPixels(layout, arc.center);
    const r = arc.radiusMeters * layout.scale;
    // The arc quadrant points INTO the pitch from each corner.
    const corner = arc.corner;
    const angleBase =
      corner === "x0y0"
        ? 0
        : corner === "x105y0"
          ? Math.PI / 2
          : corner === "x105y68"
            ? Math.PI
            : (3 * Math.PI) / 2; // x0y68
    for (let i = 0; i <= 6; i += 1) {
      const a1 = angleBase + (i / 6) * (Math.PI / 2);
      const a2 = angleBase + ((i + 1) / 6) * (Math.PI / 2);
      buffer.drawLine(
        c.x + r * Math.cos(a1),
        c.y - r * Math.sin(a1),
        c.x + r * Math.cos(a2),
        c.y - r * Math.sin(a2),
        LINE,
      );
    }
  }

  // Goals: small white nets extending OUTWARD behind each goal line.
  for (const goal of f.goals) {
    const halfW = (goal.widthMeters / 2) * layout.scale;
    const netDepth = Math.max(3, 0.6 * layout.scale);
    const g = toPixels(layout, goal.center);
    if (goal.goalLine === "x0") {
      buffer.fillRect(g.x - netDepth, g.y - halfW, netDepth, halfW * 2, darken(LINE, 60));
      buffer.strokeRect(g.x - netDepth, g.y - halfW, netDepth, halfW * 2, LINE);
    } else {
      buffer.fillRect(g.x, g.y - halfW, netDepth, halfW * 2, darken(LINE, 60));
      buffer.strokeRect(g.x, g.y - halfW, netDepth, halfW * 2, LINE);
    }
  }
}

/** Draws one placed entity (player/official) with its marker + uncertainty. */
function drawEntity(
  buffer: FrameBuffer,
  layout: ReturnType<typeof pitchLayout>,
  view: TacticalSceneView["entities"][number],
): void {
  const p = toPixels(layout, { x: view.x, y: view.y });
  const style = markerStyleOf(view.entityId);
  const radius = Math.max(4, Math.round(layout.scale * 1.6));
  const fill: Rgb = view.outOfBounds ? lighten(style.fill, 24) : style.fill;

  // Uncertainty ring (dashed) around uncertain positions — never resolved away.
  if (view.status === "uncertain") {
    buffer.strokeCircleDashed(p.x, p.y, radius + 2, style.trim, 3, 2);
  }

  // Heading arrow (screen y is flipped vs. the scene's +y).
  if (view.headingRadians !== undefined) {
    const length = radius + 6;
    const dx = Math.cos(view.headingRadians);
    const dy = -Math.sin(view.headingRadians);
    buffer.drawLine(p.x, p.y, p.x + dx * length, p.y + dy * length, style.trim);
  }

  buffer.fillCircle(p.x, p.y, radius, fill);
  buffer.strokeCircle(p.x, p.y, radius, SURROUND);

  // Jersey token when it fits inside the marker.
  const jersey = jerseyOf(view.entityId);
  if (jersey.length > 0 && radius >= 6) {
    const textW = jersey.length * 6 - 1;
    buffer.drawText(Math.round(p.x - textW / 2), Math.round(p.y - 3), jersey, style.trim);
  }
}

/** Draws the ball marker (always on top of players). */
function drawBall(
  buffer: FrameBuffer,
  layout: ReturnType<typeof pitchLayout>,
  ball: NonNullable<TacticalSceneView["ball"]>,
): void {
  const p = toPixels(layout, { x: ball.x, y: ball.y });
  const radius = Math.max(3, Math.round(layout.scale * 0.9));
  if (ball.status === "uncertain") {
    buffer.strokeCircleDashed(p.x, p.y, radius + 2, TACTICAL_BALL_STYLE.trim, 3, 2);
  }
  buffer.fillCircle(p.x, p.y, radius, TACTICAL_BALL_STYLE.fill);
  buffer.strokeCircle(p.x, p.y, radius, TACTICAL_BALL_STYLE.trim);
  buffer.fillCircle(p.x, p.y, Math.max(1, Math.round(radius / 3)), TACTICAL_BALL_STYLE.trim);
}

/** Draws the bottom overlay band: score/clock/possession + event ticker + timeline. */
function drawOverlayBand(buffer: FrameBuffer, input: TacticalFrameInput): void {
  const bandY = buffer.height - OVERLAY_BAND_PX;
  buffer.fillRect(0, bandY, buffer.width, OVERLAY_BAND_PX, OVERLAY_BG);

  // --- Left: score + clock + possession (all verbatim snapshot state).
  let cursorX = 12;
  const lineY = bandY + 7;
  const sc = input.view.scoreClock;
  if (sc.footballState && sc.home !== undefined && sc.away !== undefined) {
    const scoreText = `${sc.home}-${sc.away}`;
    buffer.drawText(cursorX, lineY, scoreText, OVERLAY_TEXT, 2);
    cursorX += scoreText.length * 12 + 10;
    if (sc.scoreStatus === "uncertain") {
      const provisional = sc.scoreStatusValue === "provisional" ? "(PROV)" : "(?)";
      buffer.drawText(cursorX, lineY + 3, provisional, OVERLAY_DIM);
      cursorX += provisional.length * 6 + 10;
    }
  }
  if (sc.clockPeriod !== undefined && sc.clockMs !== undefined) {
    const clock = `${periodLabel(sc.clockPeriod)} ${formatClock(sc.clockMs)}${
      sc.stoppage ? "+" : ""
    }`;
    buffer.drawText(cursorX, lineY, clock, OVERLAY_TEXT, 2);
    cursorX += clock.length * 12 + 10;
  }
  if (sc.possessionEntityId !== undefined) {
    const possession = `POS ${sc.possessionEntityId.slice(0, 12).toUpperCase()}${
      sc.possessionConfidence !== undefined ? ` ${Math.round(sc.possessionConfidence * 100)}%` : ""
    }`;
    buffer.drawText(cursorX, lineY + 3, possession, OVERLAY_DIM);
  }

  // --- Right: the event ticker — the most recent badges whose time is due.
  const visible = input.view.eventBadges.filter((badge) => {
    const offset = badge.eventTimeMs - input.videoOriginMs;
    return Math.min(Math.max(offset, 0), Math.max(0, input.durationMs - 1)) <= input.elapsedMs;
  });
  const recent = visible.slice(-3);
  let badgeX = buffer.width - 12;
  for (const badge of recent.slice().reverse()) {
    const color =
      EVENT_COLORS[badge.eventTypeRef.slice(badge.eventTypeRef.lastIndexOf("/") + 1)] ??
      PROGRESS_FILL;
    const label = `${badge.isCorrection ? "*" : ""}${badge.label}`;
    const textW = label.length * 6 - 1;
    const timeW = 5 * 6 - 1;
    const cellW = textW + timeW + 16;
    badgeX -= cellW + 8;
    const cellY = bandY + 6;
    buffer.fillRect(badgeX, cellY, cellW, 18, darken(color, 96));
    buffer.strokeRect(badgeX, cellY, cellW, 18, color);
    buffer.drawText(badgeX + 4, cellY + 5, label, color === PROGRESS_FILL ? OVERLAY_TEXT : color);
    buffer.drawText(
      badgeX + 4 + textW + 6,
      cellY + 5,
      formatClock(badge.eventTimeMs).slice(-5),
      OVERLAY_TEXT,
    );
  }

  // --- Bottom strip: the clip timeline with the progress fill.
  const trackY = buffer.height - 8;
  const marginX = 12;
  const trackW = buffer.width - marginX * 2;
  buffer.fillRect(marginX, trackY, trackW, 3, darken(OVERLAY_BG, -40));
  const progress = input.durationMs > 0 ? input.elapsedMs / input.durationMs : 0;
  buffer.fillRect(marginX, trackY, Math.max(0, Math.min(1, progress)) * trackW, 3, PROGRESS_FILL);
}

/** Draws the small session tag (top-left). */
function drawSessionTag(buffer: FrameBuffer, input: TacticalFrameInput): void {
  const tag = `TACTICAL ${input.view.sessionId.slice(0, 16).toUpperCase()} SWM V${input.scene.source.schemaVersion}`;
  const w = tag.length * 6 - 1;
  buffer.fillRect(8, 8, w + 10, 17, darken(SURROUND, -14));
  buffer.drawText(13, 13, tag, OVERLAY_DIM);
}

/**
 * Paints one tactical frame. Pure: the same `(buffer, input)` always yields
 * the same pixel bytes.
 */
export function drawTacticalFrame(buffer: FrameBuffer, input: TacticalFrameInput): void {
  buffer.fill(SURROUND);
  const layout = pitchLayout(buffer.width, buffer.height);
  drawPitchSurface(buffer, input.scene);
  drawFurniture(buffer, input.scene);
  for (const entity of input.view.entities) {
    if (entity.kind === "ball") continue; // the ball draws on top, below
    drawEntity(buffer, layout, entity);
  }
  if (input.view.ball !== undefined) {
    drawBall(buffer, layout, input.view.ball);
  }
  drawOverlayBand(buffer, input);
  drawSessionTag(buffer, input);
}
