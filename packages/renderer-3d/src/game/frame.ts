/**
 * THE frame composer of the reference 3D engine — one engine scene state +
 * one camera pose + one style profile become one fully rendered rgb24
 * frame. This is where the ADR-009 "visibly different realities" decision
 * lives as code: the SAME SWM scene, the SAME projection, the SAME camera
 * math, two PRESENTATION styles:
 *
 * - **stylized-3d (R303)** — a stylized game look: gradient sky, mowed
 *   stripe pitch, perspective-true markings and goals, players as
 *   vertically-shaded capsule billboards with team kit colors + jersey
 *   numbers, a shaded ball with a screen-space motion trail (the trail
 *   visualizes the ball's actual on-screen motion under the deterministic
 *   camera — never an invented world-space trajectory), possession ring,
 *   panel HUD.
 * - **cel-shaded (R304)** — the NPR look: flat two-tone shading (a hard
 *   light/dark split on every figure), posterized/reduced palette, BOLD
 *   outlines (a color-distance edge-detection pass over the rendered
 *   frame), manga-style halftone dots on the pitch, radial speed-line
 *   accents on fast view motion and on goal/shot/save emphasis windows,
 *   ink-and-paper HUD.
 *
 * Honesty invariants (the S2 discipline of the scene projection):
 * every NUMBER the composer draws is either a VERBATIM scene value
 * (positions, heights, headings, score, clock), a documented presentation
 * constant (the tables below), or a pure function of frame time + seed
 * (camera motion, pulses, fades). Nothing about the MATCH is invented:
 * entity positions are the snapshot's own state held for the render
 * window; the camera is presentation, not world data.
 */
import type { SceneScoreClock } from "@sporta/scene-projection";
import {
  NEAR_PLANE_METERS,
  buildGameCamera,
  cameraPhaseOf,
  projectPoint,
  toCameraSpace,
  type GameCamera,
} from "./camera";
import { drawText, measureText } from "./font";
import { CEL_SHADED_PALETTE, STYLIZED_3D_PALETTE } from "./palette";
import { Framebuffer, posterize, shade, tint, type Rgb, type ScreenPoint } from "./raster";

/** Which visual style a frame renders with. */
export type FrameStyle = "stylized-3d" | "cel-shaded";

/** One applied event marker, as the engine carries it for presentation. */
export interface FrameMarker {
  sequence: number;
  eventId: string;
  eventTimeMs: number;
  eventTypeRef: string;
}

/** The presentation-relevant view of one engine scene (built by the engine). */
export interface FrameScene {
  sessionId: string;
  /** Style key: `"<rendererId>:<rendererVersion>:<style>"` (identity-stable). */
  styleKey: string;
  figures: readonly FigureView[];
  /** The ball view (null when the scene carries no projectable ball). */
  ball: BallView | null;
  scoreClock: SceneScoreClock;
  markers: readonly FrameMarker[];
  possessionEntityId: string | null;
  watermarkMs: number;
}

// ---------------------------------------------------------------------------
// Documented presentation constants (the honest-numbers table)
// ---------------------------------------------------------------------------

/** Player capsule width at shoulder height (meters). */
const SHOULDER_WIDTH_M = 0.62;

/** Player figure height (meters) — head top above the pitch plane. */
const FIGURE_HEIGHT_M = 1.82;

/** Head radius as a fraction of shoulder width. */
const HEAD_FRACTION = 0.34;

/** Ball radius (meters) — the IFAB size-5 radius used for presentation. */
const BALL_RADIUS_M = 0.11;

/** Default ball center height when the SWM carries none (meters). */
export const BALL_DEFAULT_HEIGHT_M = 0.11;

/** Minimum drawn entity width (px) — the W602 readability-floor precedent. */
const MIN_ENTITY_WIDTH_PX = 3;

/** Minimum drawn ball radius (px). */
const MIN_BALL_RADIUS_PX = 1.5;

/** Grass apron around the pitch (meters). */
const APRON_M = 6;

/** Mow-stripe width along x (meters) — stylized only. */
const STRIPE_M = 105 / 20;

/** Field line thickness (meters). */
const LINE_W_M = 0.12;

/** Goal post thickness (meters). */
const POST_W_M = 0.12;

/** Possession ring radius (meters). */
const RING_R_M = 0.9;

/** Ground shadow radius (meters). */
const SHADOW_R_M = 0.5;

/** Trail length in frames (stylized ball trail). */
const TRAIL_FRAMES = 10;

/** Event chip lifetime (ms). */
const CHIP_LIFE_MS = 2_500;

/** Goal frame dimensions (from the furniture constants). */
const GOAL_HALF_W_M = 7.32 / 2;
const GOAL_H_M = 2.44;
const GOAL_Y_M = 34;

/** Halftone dot grid spacing (px, screen space) + rotation — cel only. */
const HALFTONE_SPACING_PX = 7;
const HALFTONE_ROT_RAD = 0.4636; // atan(1/2)
const HALFTONE_DOT_R = 0.34;

/** The cel edge-detection threshold (summed channel distance; above the
 *  halftone dot delta, below the marking/figure silhouette deltas). */
const CEL_EDGE_THRESHOLD = 110;

/** Cel posterization levels (the reduced palette). */
const CEL_LEVELS = 6;

/** Speed-line triggers (view-motion + emphasis) — cel only. */
const SPEED_LINE_COUNT = 14;
const SPEED_LINE_MIN_FACTOR = 0.5;

/** Camera behaviors re-exported for the composer's input type. */
export type FrameCameraBehavior = "aerial-follow" | "sideline-follow";

// ---------------------------------------------------------------------------
// The drawable view model (resolved once by the engine — see engine.ts)
// ---------------------------------------------------------------------------

/** A player/official figure to draw (resolved from projected + raw SWM state). */
export interface FigureView {
  entityId: string;
  kind: "participant" | "official";
  x: number;
  y: number;
  kitColor: Rgb;
  goalkeeper: boolean;
  jersey: number;
  headingRad: number | null;
}

/** The ball view (resolved once by the engine). */
export interface BallView {
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------------------
// The frame render call
// ---------------------------------------------------------------------------

/** Mutable per-render composer state (the trail history). */
export class FrameComposer {
  private readonly trail: ScreenPoint[] = [];
  private readonly scratch: Framebuffer | null;

  constructor(
    readonly style: FrameStyle,
    canvasWidth: number,
    canvasHeight: number,
  ) {
    this.scratch = style === "cel-shaded" ? new Framebuffer(canvasWidth, canvasHeight) : null;
  }

  /**
   * Renders one frame at timeline offset `tMs` (from the render window
   * start) into `fb`. Deterministic: a pure function of (scene, camera
   * inputs, tMs, seed) — the trail history is itself a function of the
   * same inputs over earlier frames.
   */
  renderFrame(options: {
    fb: Framebuffer;
    scene: FrameScene;
    tMs: number;
    seed: number;
    behavior: FrameCameraBehavior;
    emphasisWindows: readonly { startMs: number; endMs: number }[];
  }): void {
    const { fb, scene, tMs, seed, behavior, emphasisWindows } = options;
    const w = fb.width;
    const h = fb.height;
    const stylized = this.style === "stylized-3d";
    const pal = stylized ? STYLIZED_3D_PALETTE : CEL_SHADED_PALETTE;
    const cel = CEL_SHADED_PALETTE;

    // ---- camera over the follow target (the ball, or the play centroid) --
    const figures = scene.figures;
    const ball = scene.ball;
    const target = ball !== null ? { x: ball.x, y: ball.y, z: 0 } : playCentroid(figures);
    const camera = buildGameCamera({
      target,
      tMs,
      behavior,
      seed,
      canvasHeight: h,
      emphasisWindows,
    });
    const project = (p: { x: number; y: number; z: number }) => projectPoint(camera, p, w, h);

    // ---- 1. sky ------------------------------------------------------------
    if (stylized) {
      fb.clearGradient(STYLIZED_3D_PALETTE.skyTop, STYLIZED_3D_PALETTE.skyBottom);
    } else {
      // Flat paper sky with one alt band (the posterized horizon feel).
      fb.clear(cel.skyBand);
      fb.fillRect(0, Math.floor(h * 0.16), w, Math.floor(h * 0.1), cel.skyBandAlt);
    }

    // ---- 2. ground: apron + pitch (+ stripes / halftone) ------------------
    // Ground polygons are near-plane CLIPPED (Sutherland–Hodgman in camera
    // space, the W602 precedent): a follow camera inside the apron must
    // still draw the ground it hovers over — never drop the whole polygon
    // because one corner is behind the near plane.
    const apron = projectGroundPolygon(
      camera,
      [
        { x: -APRON_M, y: -APRON_M, z: 0 },
        { x: 105 + APRON_M, y: -APRON_M, z: 0 },
        { x: 105 + APRON_M, y: 68 + APRON_M, z: 0 },
        { x: -APRON_M, y: 68 + APRON_M, z: 0 },
      ],
      w,
      h,
    );
    if (apron !== null) {
      fillConvexSpan(fb, apron, () => pal.apron);
    }
    if (stylized) {
      for (let s = 0; s < 20; s += 1) {
        const x0 = s * STRIPE_M;
        const x1 = x0 + STRIPE_M;
        const quad = projectGroundPolygon(
          camera,
          [
            { x: x0, y: 0, z: 0 },
            { x: x1, y: 0, z: 0 },
            { x: x1, y: 68, z: 0 },
            { x: x0, y: 68, z: 0 },
          ],
          w,
          h,
        );
        if (quad !== null) {
          const color = s % 2 === 0 ? pal.grassA : pal.grassB;
          fillConvexSpan(fb, quad, () => color);
        }
      }
    } else {
      const pitch = projectGroundPolygon(
        camera,
        [
          { x: 0, y: 0, z: 0 },
          { x: 105, y: 0, z: 0 },
          { x: 105, y: 68, z: 0 },
          { x: 0, y: 68, z: 0 },
        ],
        w,
        h,
      );
      if (pitch !== null) {
        const cosR = Math.cos(HALFTONE_ROT_RAD);
        const sinR = Math.sin(HALFTONE_ROT_RAD);
        fillConvexSpan(fb, pitch, (x, y) => {
          const u = (x * cosR + y * sinR) / HALFTONE_SPACING_PX;
          const v = (-x * sinR + y * cosR) / HALFTONE_SPACING_PX;
          const fu = u - Math.floor(u) - 0.5;
          const fv = v - Math.floor(v) - 0.5;
          return fu * fu + fv * fv < HALFTONE_DOT_R * HALFTONE_DOT_R
            ? shade(cel.grassB, 0.12)
            : cel.grassA;
        });
      }
    }

    // ---- 3. markings --------------------------------------------------------
    const lineColor = pal.line;
    drawGroundLine(fb, camera, w, h, 0, 0, 105, 0, LINE_W_M, lineColor);
    drawGroundLine(fb, camera, w, h, 0, 68, 105, 68, LINE_W_M, lineColor);
    drawGroundLine(fb, camera, w, h, 0, 0, 0, 68, LINE_W_M, lineColor);
    drawGroundLine(fb, camera, w, h, 105, 0, 105, 68, LINE_W_M, lineColor);
    drawGroundLine(fb, camera, w, h, 52.5, 0, 52.5, 68, LINE_W_M, lineColor);
    drawGroundCircle(fb, camera, w, h, 52.5, 34, 9.15, LINE_W_M, lineColor);
    fillGroundDot(fb, camera, w, h, 52.5, 34, 0.2, lineColor);
    for (const goalLine of [0, 105] as const) {
      const dir = goalLine === 0 ? 1 : -1;
      // goal area (5.5 m deep, 18.32 m wide)
      drawGroundRect(
        fb,
        camera,
        w,
        h,
        goalLine,
        34 - 9.16,
        goalLine + dir * 5.5,
        34 + 9.16,
        lineColor,
      );
      // penalty area (16.5 m deep, 40.32 m wide)
      drawGroundRect(
        fb,
        camera,
        w,
        h,
        goalLine,
        34 - 20.16,
        goalLine + dir * 16.5,
        34 + 20.16,
        lineColor,
      );
      // penalty spot
      fillGroundDot(fb, camera, w, h, goalLine + dir * 11, 34, 0.2, lineColor);
      // corner arcs on this goal line
      const cornerY = goalLine === 0 ? [0, 68] : [68, 0];
      for (const cy of cornerY) {
        drawGroundArc(fb, camera, w, h, goalLine, cy, 1, lineColor, goalLine === 0 ? 0 : Math.PI);
      }
    }

    // ---- 4. goals (3D frames: posts + crossbar) ------------------------------
    for (const goalLine of [0, 105] as const) {
      for (const postY of [GOAL_Y_M - GOAL_HALF_W_M, GOAL_Y_M + GOAL_HALF_W_M]) {
        drawPost(fb, project, camera, goalLine, postY, GOAL_H_M, POST_W_M, lineColor);
      }
      const barA = project({ x: goalLine, y: GOAL_Y_M - GOAL_HALF_W_M, z: GOAL_H_M });
      const barB = project({ x: goalLine, y: GOAL_Y_M + GOAL_HALF_W_M, z: GOAL_H_M });
      if (barA !== null && barB !== null) {
        const thickness = (POST_W_M * camera.focalPx) / ((barA.depth + barB.depth) / 2);
        fb.drawThickLine(barA.x, barA.y, barB.x, barB.y, thickness, lineColor);
      }
    }

    // ---- 5. ground overlays: possession ring + shadows ------------------------
    const possession = figures.find((f) => f.entityId === scene.possessionEntityId);
    if (possession !== undefined) {
      drawGroundRing(
        fb,
        project,
        possession.x,
        possession.y,
        RING_R_M,
        lineColor,
        pal.possession,
        tMs,
        stylized,
      );
    }
    for (const figure of figures) {
      const base = project({ x: figure.x, y: figure.y, z: 0 });
      if (base === null) continue;
      const rx = (SHADOW_R_M * camera.focalPx) / base.depth;
      const ry = Math.max(1, rx * 0.38);
      if (stylized) {
        fb.blendEllipse(base.x, base.y, rx, ry, STYLIZED_3D_PALETTE.shadow, 0.3);
      } else {
        fb.blendEllipse(base.x, base.y, rx, ry, cel.shadow, 0.55);
      }
    }

    // ---- 6. figures (painter's order: far → near) -----------------------------
    const drawable = figures
      .map(
        (figure): { figure: FigureView; base: { x: number; y: number; depth: number } | null } => ({
          figure,
          base: project({ x: figure.x, y: figure.y, z: 0 }),
        }),
      )
      .filter(
        (entry): entry is { figure: FigureView; base: { x: number; y: number; depth: number } } =>
          entry.base !== null &&
          entry.base.depth >= 0.5 &&
          (SHOULDER_WIDTH_M * camera.focalPx) / entry.base.depth >= MIN_ENTITY_WIDTH_PX * 0.5,
      )
      .sort((a, b) => b.base.depth - a.base.depth);

    for (const { figure, base } of drawable) {
      drawFigure(fb, project, camera, figure, base, stylized);
    }

    // ---- 7. ball (+ trail) ----------------------------------------------------
    if (ball !== null) {
      const center = project({ x: ball.x, y: ball.y, z: ball.z });
      const ground = project({ x: ball.x, y: ball.y, z: 0 });
      if (center !== null && ground !== null) {
        const radius = Math.max(
          MIN_BALL_RADIUS_PX,
          (BALL_RADIUS_M * camera.focalPx) / center.depth,
        );
        if (stylized) {
          // The motion trail: the ball's own on-screen positions over the
          // last frames (real rendered motion — the camera's, never an
          // invented world trajectory).
          for (let i = 0; i < this.trail.length; i += 1) {
            const point = this.trail[i]!;
            const age = (this.trail.length - i) / (TRAIL_FRAMES + 1);
            fb.blendEllipse(
              point.x,
              point.y,
              radius * (1.1 - age * 0.5),
              radius * (1.1 - age * 0.5),
              STYLIZED_3D_PALETTE.trail,
              0.38 * (1 - age),
            );
          }
          fb.fillEllipse(center.x, center.y, radius, radius, STYLIZED_3D_PALETTE.ball);
          fb.blendEllipse(
            center.x + radius * 0.3,
            center.y + radius * 0.35,
            radius * 0.8,
            radius * 0.8,
            STYLIZED_3D_PALETTE.ballShade,
            0.55,
          );
          fb.fillEllipse(
            center.x - radius * 0.35,
            center.y - radius * 0.4,
            radius * 0.28,
            radius * 0.28,
            { r: 255, g: 255, b: 255 },
          );
          // ground drop-line (the W602 honest-height cue, condensed)
          fb.drawThickLine(
            center.x,
            center.y,
            ground.x,
            ground.y,
            1,
            STYLIZED_3D_PALETTE.ballShade,
            0.5,
          );
        } else {
          fb.fillEllipse(
            center.x,
            center.y,
            radius + 1.2,
            radius + 1.2,
            posterize(cel.ink, CEL_LEVELS),
          );
          fb.fillEllipse(center.x, center.y, radius, radius, cel.ball);
        }
        // Update the trail AFTER drawing this frame's ball.
        this.trail.push({ x: center.x, y: center.y });
        if (this.trail.length > TRAIL_FRAMES) this.trail.shift();
      }
    }

    // ---- 8. cel post-processing: outlines + speed lines -----------------------
    if (!stylized && this.scratch !== null) {
      applyEdgeOutline(fb, this.scratch);
      const speed = viewMotionFactor(tMs, behavior, seed, emphasisWindows);
      if (speed >= SPEED_LINE_MIN_FACTOR) {
        drawSpeedLines(fb, seed, speed);
      }
    }

    // ---- 9. HUD -----------------------------------------------------------------
    drawHud(fb, scene, tMs, stylized, behavior);
  }
}

// ---------------------------------------------------------------------------
// Ground-space drawing helpers (world meters → projected screen)
// ---------------------------------------------------------------------------

/** A point the span filler uses. */
interface SpanPoint {
  x: number;
  y: number;
}

type Projector = (p: { x: number; y: number; z: number }) => {
  x: number;
  y: number;
  depth: number;
} | null;

/** A world-space point (x, y, z in meters, z up). */
interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Projects a world-space polygon with Sutherland–Hodgman clipping against
 * the near plane (in camera space) BEFORE the perspective divide — the
 * W602 precedent, so a camera hovering inside the polygon's extents still
 * draws the visible part. Returns null when the polygon is entirely
 * behind the near plane.
 */
function projectGroundPolygon(
  camera: GameCamera,
  points: readonly WorldPoint[],
  canvasWidth: number,
  canvasHeight: number,
): SpanPoint[] | null {
  const cameraSpace = points.map((point) => toCameraSpace(camera, point));
  const clipped: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < cameraSpace.length; i += 1) {
    const a = cameraSpace[i]!;
    const b = cameraSpace[(i + 1) % cameraSpace.length]!;
    const aIn = a.z >= NEAR_PLANE_METERS;
    const bIn = b.z >= NEAR_PLANE_METERS;
    if (aIn) clipped.push(a);
    if (aIn !== bIn) {
      const t = (NEAR_PLANE_METERS - a.z) / (b.z - a.z);
      clipped.push({
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y),
        z: NEAR_PLANE_METERS,
      });
    }
  }
  if (clipped.length < 3) return null;
  return clipped.map((p) => ({
    x: canvasWidth / 2 + (camera.focalPx * p.x) / p.z,
    y: canvasHeight / 2 - (camera.focalPx * p.y) / p.z,
  }));
}

/**
 * Scanline-fills a convex screen polygon with a per-pixel color function
 * (stripes / halftone / flat). The color function receives SCREEN
 * coordinates — the halftone pattern is deliberately screen-space (the
 * manga convention: uniform dot size regardless of depth).
 */
function fillConvexSpan(
  fb: Framebuffer,
  points: readonly SpanPoint[],
  colorAt: (x: number, y: number) => Rgb,
): void {
  if (points.length < 3) return;
  const minY = Math.max(0, Math.ceil(Math.min(...points.map((p) => p.y))));
  const maxY = Math.min(fb.height - 1, Math.floor(Math.max(...points.map((p) => p.y))));
  for (let y = minY; y <= maxY; y += 1) {
    const scan = y + 0.5;
    let xa = Number.POSITIVE_INFINITY;
    let xb = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      if (a.y === b.y) continue;
      const t = (scan - a.y) / (b.y - a.y);
      if (t >= 0 && t <= 1) {
        const x = a.x + t * (b.x - a.x);
        if (x < xa) xa = x;
        if (x > xb) xb = x;
      }
    }
    if (xa > xb) continue;
    const x0 = Math.max(0, Math.ceil(xa));
    const x1 = Math.min(fb.width - 1, Math.floor(xb));
    for (let x = x0; x <= x1; x += 1) {
      fb.setPixel(x, y, colorAt(x, y));
    }
  }
}

/** Draws a ground-plane line as a near-clipped world-thickness quad. */
function drawGroundLine(
  fb: Framebuffer,
  camera: GameCamera,
  canvasWidth: number,
  canvasHeight: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  widthM: number,
  color: Rgb,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const nx = (-dy / len) * (widthM / 2);
  const ny = (dx / len) * (widthM / 2);
  const corners = projectGroundPolygon(
    camera,
    [
      { x: x0 + nx, y: y0 + ny, z: 0 },
      { x: x1 + nx, y: y1 + ny, z: 0 },
      { x: x1 - nx, y: y1 - ny, z: 0 },
      { x: x0 - nx, y: y0 - ny, z: 0 },
    ],
    canvasWidth,
    canvasHeight,
  );
  if (corners === null) return;
  fb.fillConvexPolygon(corners, color);
}

/** Draws a ground-plane rectangle outline (four ground lines). */
function drawGroundRect(
  fb: Framebuffer,
  camera: GameCamera,
  canvasWidth: number,
  canvasHeight: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: Rgb,
): void {
  drawGroundLine(fb, camera, canvasWidth, canvasHeight, x0, y0, x1, y0, LINE_W_M, color);
  drawGroundLine(fb, camera, canvasWidth, canvasHeight, x1, y0, x1, y1, LINE_W_M, color);
  drawGroundLine(fb, camera, canvasWidth, canvasHeight, x1, y1, x0, y1, LINE_W_M, color);
  drawGroundLine(fb, camera, canvasWidth, canvasHeight, x0, y1, x0, y0, LINE_W_M, color);
}

/** Draws a ground-plane circle as a world-thickness polyline (64 segments). */
function drawGroundCircle(
  fb: Framebuffer,
  camera: GameCamera,
  canvasWidth: number,
  canvasHeight: number,
  cx: number,
  cy: number,
  radiusM: number,
  widthM: number,
  color: Rgb,
): void {
  const segments = 64;
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    drawGroundLine(
      fb,
      camera,
      canvasWidth,
      canvasHeight,
      cx + Math.cos(a0) * radiusM,
      cy + Math.sin(a0) * radiusM,
      cx + Math.cos(a1) * radiusM,
      cy + Math.sin(a1) * radiusM,
      widthM,
      color,
    );
  }
}

/** Draws a ground-plane arc (quarter circle) as world-thickness lines. */
function drawGroundArc(
  fb: Framebuffer,
  camera: GameCamera,
  canvasWidth: number,
  canvasHeight: number,
  cx: number,
  cy: number,
  radiusM: number,
  color: Rgb,
  startRad: number,
): void {
  const segments = 12;
  for (let i = 0; i < segments; i += 1) {
    const a0 = startRad + (i / segments) * (Math.PI / 2);
    const a1 = startRad + ((i + 1) / segments) * (Math.PI / 2);
    drawGroundLine(
      fb,
      camera,
      canvasWidth,
      canvasHeight,
      cx + Math.cos(a0) * radiusM,
      cy + Math.sin(a0) * radiusM,
      cx + Math.cos(a1) * radiusM,
      cy + Math.sin(a1) * radiusM,
      LINE_W_M,
      color,
    );
  }
}

/** Fills a small ground dot (spot/mark) as a near-clipped polygon. */
function fillGroundDot(
  fb: Framebuffer,
  camera: GameCamera,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  y: number,
  radiusM: number,
  color: Rgb,
): void {
  const world: WorldPoint[] = [];
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2;
    world.push({ x: x + Math.cos(a) * radiusM, y: y + Math.sin(a) * radiusM, z: 0 });
  }
  const points = projectGroundPolygon(camera, world, canvasWidth, canvasHeight);
  if (points === null) return;
  fb.fillConvexPolygon(points, color);
}

/** Draws a vertical post (world thickness from its base depth). */
function drawPost(
  fb: Framebuffer,
  project: Projector,
  camera: GameCamera,
  x: number,
  y: number,
  heightM: number,
  widthM: number,
  color: Rgb,
): void {
  const base = project({ x, y, z: 0 });
  const top = project({ x, y, z: heightM });
  if (base === null || top === null) return;
  const thickness = (widthM * camera.focalPx) / base.depth;
  fb.drawThickLine(base.x, base.y, top.x, top.y, Math.max(1.2, thickness), color);
}

/** Draws the possession ring (a pulsing ground circle, style-dependent). */
function drawGroundRing(
  fb: Framebuffer,
  project: Projector,
  x: number,
  y: number,
  radiusM: number,
  lineColor: Rgb,
  accentColor: Rgb,
  tMs: number,
  stylized: boolean,
): void {
  const pulse = stylized ? 1 + 0.06 * Math.sin((2 * Math.PI * tMs) / 1_200) : 1;
  const segments = 24;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const p = project({
      x: x + Math.cos(a) * radiusM * pulse,
      y: y + Math.sin(a) * radiusM * pulse,
      z: 0,
    });
    if (p === null) return;
    points.push(p);
  }
  fb.drawThickPolyline(points, stylized ? 2.2 : 3, accentColor, stylized ? 0.9 : 1);
}

// ---------------------------------------------------------------------------
// Figure drawing (capsule billboards, style-split)
// ---------------------------------------------------------------------------

function drawFigure(
  fb: Framebuffer,
  project: Projector,
  camera: GameCamera,
  figure: FigureView,
  base: { x: number; y: number; depth: number },
  stylized: boolean,
): void {
  const head = project({ x: figure.x, y: figure.y, z: FIGURE_HEIGHT_M });
  if (head === null) return;
  const widthBase = Math.max(MIN_ENTITY_WIDTH_PX, (SHOULDER_WIDTH_M * camera.focalPx) / base.depth);
  const widthHead = Math.max(
    MIN_ENTITY_WIDTH_PX * 0.9,
    (SHOULDER_WIDTH_M * camera.focalPx) / head.depth,
  );
  const kit = stylized ? figure.kitColor : posterize(figure.kitColor, CEL_LEVELS);

  if (stylized) {
    // Vertically shaded capsule: a light-to-dark Gouraud trapezoid body
    // plus a shaded head sphere and a facing tick when the SWM carries one.
    const topColor = tint(kit, 0.22);
    const bottomColor = shade(kit, 0.24);
    const a = { x: base.x - widthBase / 2, y: base.y };
    const b = { x: base.x + widthBase / 2, y: base.y };
    const c = { x: head.x + widthHead / 2, y: head.y + widthHead * HEAD_FRACTION };
    const d = { x: head.x - widthHead / 2, y: head.y + widthHead * HEAD_FRACTION };
    fb.fillTriangleGouraud(a, b, c, bottomColor, bottomColor, topColor);
    fb.fillTriangleGouraud(a, c, d, bottomColor, topColor, topColor);
    // head
    const headR = widthHead * HEAD_FRACTION;
    fb.fillEllipse(head.x, head.y, headR, headR, tint(kit, 0.35));
    fb.blendEllipse(
      head.x + headR * 0.25,
      head.y + headR * 0.3,
      headR * 0.8,
      headR * 0.8,
      shade(kit, 0.5),
      0.5,
    );
    // jersey number (contrast by luminance)
    const luminance = (kit.r * 0.299 + kit.g * 0.587 + kit.b * 0.114) / 255;
    const numberColor = luminance > 0.55 ? { r: 24, g: 24, b: 28 } : { r: 250, g: 250, b: 250 };
    const scale = widthBase >= 14 ? 2 : 1;
    const label = String(figure.jersey);
    drawText(
      fb,
      label,
      base.x - measureText(label, scale) / 2,
      (base.y + head.y) / 2 - (GLYPH_H * scale) / 2,
      scale,
      numberColor,
    );
    if (figure.headingRad !== null) {
      const nose = project({
        x: figure.x + Math.cos(figure.headingRad) * 0.5,
        y: figure.y + Math.sin(figure.headingRad) * 0.5,
        z: FIGURE_HEIGHT_M * 0.62,
      });
      if (nose !== null) {
        fb.drawThickLine(head.x, head.y, nose.x, nose.y, 1.4, shade(kit, 0.45));
      }
    }
  } else {
    // Cel capsule: flat two-tone split (light 62% / shade 38%) with the
    // bold outline coming from the edge-detection pass.
    const light = kit;
    const dark = shade(kit, 0.3);
    const a = { x: base.x - widthBase / 2, y: base.y };
    const b = { x: base.x + widthBase / 2, y: base.y };
    const c = { x: head.x + widthHead / 2, y: head.y + widthHead * HEAD_FRACTION };
    const d = { x: head.x - widthHead / 2, y: head.y + widthHead * HEAD_FRACTION };
    // light region (left 62%)
    const splitB = { x: base.x - widthBase / 2 + widthBase * 0.62, y: base.y };
    const splitC = { x: head.x - widthHead / 2 + widthHead * 0.62, y: c.y };
    fb.fillConvexPolygon([a, splitB, splitC, d], light);
    // dark region (right 38%)
    fb.fillConvexPolygon([splitB, b, c, splitC], dark);
    // head: flat two-tone circle
    const headR = widthHead * HEAD_FRACTION;
    fb.fillEllipse(head.x, head.y, headR, headR, dark);
    fb.fillEllipse(head.x - headR * 0.22, head.y - headR * 0.1, headR * 0.78, headR * 0.9, light);
    const luminance = (kit.r * 0.299 + kit.g * 0.587 + kit.b * 0.114) / 255;
    const numberColor = luminance > 0.55 ? CEL_SHADED_PALETTE.ink : { r: 252, g: 250, b: 242 };
    const scale = widthBase >= 14 ? 2 : 1;
    const label = String(figure.jersey);
    drawText(
      fb,
      label,
      base.x - measureText(label, scale) / 2,
      (base.y + head.y) / 2 - (GLYPH_H * scale) / 2,
      scale,
      numberColor,
    );
  }
}

/** The glyph height constant (imported once for the label math). */
const GLYPH_H = 5;

// ---------------------------------------------------------------------------
// Cel post-processing
// ---------------------------------------------------------------------------

/**
 * The bold-outline pass: color-distance edge detection over the finished
 * frame (right + down neighbors). Runs on a COPY (`scratch` holds the
 * pre-pass bytes) so neighbor reads see the original colors.
 */
function applyEdgeOutline(fb: Framebuffer, scratch: Framebuffer): void {
  const { bytes, width, height } = fb;
  scratch.bytes.set(bytes);
  const src = scratch.bytes;
  const ink = CEL_SHADED_PALETTE.ink;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 3;
      const r = src[o] ?? 0;
      const g = src[o + 1] ?? 0;
      const b = src[o + 2] ?? 0;
      let distance = 0;
      if (x + 1 < width) {
        const o2 = o + 3;
        distance = Math.max(
          distance,
          Math.abs(r - (src[o2] ?? 0)) +
            Math.abs(g - (src[o2 + 1] ?? 0)) +
            Math.abs(b - (src[o2 + 2] ?? 0)),
        );
      }
      if (y + 1 < height) {
        const o3 = o + width * 3;
        distance = Math.max(
          distance,
          Math.abs(r - (src[o3] ?? 0)) +
            Math.abs(g - (src[o3 + 1] ?? 0)) +
            Math.abs(b - (src[o3 + 2] ?? 0)),
        );
      }
      if (distance > CEL_EDGE_THRESHOLD) {
        bytes[o] = ink.r;
        bytes[o + 1] = ink.g;
        bytes[o + 2] = ink.b;
      }
    }
  }
}

/**
 * The view-motion factor in [0, 1]: the INSTANTANEOUS camera swing rate
 * (rad/ms — the orbit's |cos| envelope, so the accents fire in bursts at
 * the swing peaks, not constantly) PLUS the emphasis punches armed by
 * applied goal/shot/save events. Pure math — the speed lines key on it.
 */
function viewMotionFactor(
  tMs: number,
  behavior: FrameCameraBehavior,
  seed: number,
  emphasisWindows: readonly { startMs: number; endMs: number }[],
): number {
  const period = behavior === "aerial-follow" ? 9_000 : 7_000;
  const sweep = behavior === "aerial-follow" ? 0.55 : 7 / 26; // pan → angular
  const omega = (2 * Math.PI) / period;
  const rate = sweep * omega * Math.abs(Math.cos(cameraPhaseOf(seed) + omega * tMs));
  const swing = rate / 0.000_38; // reference rate → factor
  let emphasis = 0;
  for (const window of emphasisWindows) {
    if (tMs >= window.startMs && tMs < window.endMs) {
      const local = (tMs - window.startMs) / (window.endMs - window.startMs);
      emphasis = Math.max(emphasis, Math.sin(Math.PI * local) ** 2);
    }
  }
  return Math.min(1, Math.max(swing, emphasis * 0.9));
}

/** Draws radial manga speed lines from the screen border toward the center. */
function drawSpeedLines(fb: Framebuffer, seed: number, factor: number): void {
  const { width, height } = fb;
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.hypot(cx, cy);
  for (let i = 0; i < SPEED_LINE_COUNT; i += 1) {
    // Deterministic angle set: golden-angle stepping + seeded phase.
    const angle = (i / SPEED_LINE_COUNT) * Math.PI * 2 + (seed % 97) * 0.013;
    const outer = maxR * 1.05;
    const inner = outer - maxR * (0.34 + (0.18 * ((i * 7 + seed) % 5)) / 5) * factor;
    const x0 = cx + Math.cos(angle) * outer;
    const y0 = cy + Math.sin(angle) * outer;
    const x1 = cx + Math.cos(angle) * inner;
    const y1 = cy + Math.sin(angle) * inner;
    fb.drawThickLine(x0, y0, x1, y1, 2.4, CEL_SHADED_PALETTE.speedLine, 0.75);
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

/** The event-chip phrase table (the football/v1 taxonomy → HUD text). */
const CHIP_PHRASES: Record<string, string> = {
  "football/v1/kickoff": "KICKOFF",
  "football/v1/pass": "PASS",
  "football/v1/carry": "CARRY",
  "football/v1/tackle": "TACKLE",
  "football/v1/shot": "SHOT!",
  "football/v1/save": "SAVE",
  "football/v1/goal": "GOAL!!",
  "football/v1/card": "CARD",
  "football/v1/substitution": "SUB",
  "football/v1/offside": "OFFSIDE",
  "football/v1/restart": "RESTART",
  "football/v1/possession-change": "TURNOVER",
  "football/v1/injury-pause": "INJURY",
  "football/v1/referee-decision": "REFEREE",
  "football/v1/replay-cue": "REPLAY",
  "football/v1/commentary-emphasis": "EMPHASIS",
};

/** The chip phrase for an eventTypeRef ("EVENT" for unknown refs). */
export function chipPhrase(eventTypeRef: string): string {
  return CHIP_PHRASES[eventTypeRef] ?? "EVENT";
}

/** The period label of the match clock. */
function periodLabel(period: string): string {
  switch (period) {
    case "first-half":
      return "1ST";
    case "second-half":
      return "2ND";
    case "half-time":
      return "HT";
    case "pre-match":
      return "PRE";
    case "post-match":
      return "FT";
    case "stoppage":
      return "STOP";
    default:
      return "";
  }
}

/** Formats clock milliseconds as MM:SS. */
export function formatClockMs(clockMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, clockMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function drawHud(
  fb: Framebuffer,
  scene: FrameScene,
  tMs: number,
  stylized: boolean,
  behavior: FrameCameraBehavior,
): void {
  const absoluteMs = scene.watermarkMs + tMs;
  const pad = stylized ? 10 : 12;

  // Active chips: applied markers inside their lifetime window.
  const chips = scene.markers
    .filter(
      (marker) =>
        marker.eventTimeMs <= absoluteMs && absoluteMs < marker.eventTimeMs + CHIP_LIFE_MS,
    )
    .slice(-3)
    .reverse();

  if (stylized) {
    const pal = STYLIZED_3D_PALETTE;
    const scale = 2;
    const scoreText =
      scene.scoreClock.score !== undefined
        ? `HOME ${scene.scoreClock.score.home} - ${scene.scoreClock.score.away} AWAY`
        : "HOME - AWAY";
    const clockText =
      scene.scoreClock.clock !== undefined
        ? `${formatClockMs(scene.scoreClock.clock.clockMs)} ${periodLabel(scene.scoreClock.clock.period)}`
        : "";
    const panelW = Math.max(measureText(scoreText, scale), measureText(clockText, scale)) + pad * 2;
    const panelH = scale * 5 * 2 + pad * 1.5 + (chips.length > 0 ? 14 : 0);
    fb.fillRect(pad, pad, panelW, panelH, pal.hudPanel);
    drawText(fb, scoreText, pad + 8, pad + 5, scale, pal.hudText);
    drawText(fb, clockText, pad + 8, pad + 5 + scale * 5 + 4, scale, pal.hudAccent);
    let chipY = pad + 5 + (scale * 5 + 4) * 2;
    for (const chip of chips) {
      const text = chipPhrase(chip.eventTypeRef);
      const w = measureText(text, 1) + 10;
      fb.fillRect(pad + 8, chipY, w, 11, pal.hudAccent);
      drawText(fb, text, pad + 13, chipY + 3, 1, { r: 24, g: 20, b: 16 });
      chipY += 14;
    }
    // camera label (bottom-right pill)
    const label = behavior === "aerial-follow" ? "AERIAL CAM" : "SIDELINE CAM";
    const labelW = measureText(label, 1) + 12;
    fb.fillRect(fb.width - labelW - pad, fb.height - 11 - pad, labelW, 11, pal.hudPanel);
    drawText(fb, label, fb.width - labelW - pad + 6, fb.height - 11 - pad + 3, 1, pal.cameraLabel);
  } else {
    const cel = CEL_SHADED_PALETTE;
    const scale = 2;
    const scoreText =
      scene.scoreClock.score !== undefined
        ? `HOME ${scene.scoreClock.score.home} - ${scene.scoreClock.score.away} AWAY`
        : "HOME - AWAY";
    const clockText =
      scene.scoreClock.clock !== undefined
        ? `${formatClockMs(scene.scoreClock.clock.clockMs)} ${periodLabel(scene.scoreClock.clock.period)}`
        : "";
    // Ink text with a paper halo (the manga HUD convention).
    drawHaloText(fb, scoreText, pad, pad, scale, cel.hudText);
    if (clockText.length > 0) {
      drawHaloText(fb, clockText, pad, pad + scale * 5 + 4, scale, cel.hudText);
    }
    let chipY = pad + (scale * 5 + 4) * 2;
    for (const chip of chips) {
      const text = chipPhrase(chip.eventTypeRef);
      const w = measureText(text, 1) + 12;
      fb.fillRect(pad, chipY, w, 13, cel.chip);
      drawText(fb, text, pad + 6, chipY + 4, 1, cel.chipText);
      chipY += 16;
    }
    const label = behavior === "aerial-follow" ? "AERIAL CAM" : "SIDELINE CAM";
    drawHaloText(
      fb,
      label,
      fb.width - measureText(label, 1) - pad,
      fb.height - 5 - pad,
      1,
      cel.cameraLabel,
    );
  }
}

/** Draws text with a 1px paper halo in the four cardinal offsets. */
function drawHaloText(
  fb: Framebuffer,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: Rgb,
): void {
  const halo: Rgb = { r: 252, g: 250, b: 242 };
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    drawText(fb, text, x + dx, y + dy, scale, halo);
  }
  drawText(fb, text, x, y, scale, color);
}

/** The play centroid (the follow fallback when no ball is projectable). */
function playCentroid(figures: readonly FigureView[]): { x: number; y: number; z: number } {
  if (figures.length === 0) return { x: 52.5, y: 34, z: 0 };
  let sx = 0;
  let sy = 0;
  for (const figure of figures) {
    sx += figure.x;
    sy += figure.y;
  }
  return { x: sx / figures.length, y: sy / figures.length, z: 0 };
}
