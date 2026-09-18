/**
 * The deterministic presentation camera of the reference 3D engine.
 *
 * Unlike the W602 slot camera (which frames a FIXED named slot), the R303
 * presentation model is a FOLLOW camera: it tracks the play (the ball's
 * projected position — the SWM's own best-known state, never invented)
 * while performing a documented, deterministic motion:
 *
 * - `aerial-follow` — an elevated drone-style orbit: azimuth drifts
 *   through a gentle sine arc around the follow target at a fixed radius
 *   and height (a presentation behavior, not world data);
 * - `sideline-follow` — a broadcast-style touchline camera that pans
 *   along the touchline beside the play with eased offset motion.
 *
 * **Event-driven emphasis** (the engine's `applySceneEvents` presentation
 * updates): `goal` and `shot` events arm an emphasis window (~1.8 s) that
 * eases the focal length up (a zoom punch) — the visible, honest effect of
 * applied events on the presentation.
 *
 * Everything here is pure math over (target, tMs, preset, seed): no RNG
 * beyond the injected seed, no clocks, no I/O — the same inputs give the
 * same camera pose, hence byte-identical frames.
 */
import { cross3, dot3, normalize3, type Vec3 } from "../internal";

/** The camera pose the frame composer projects through. */
export interface GameCamera {
  /** Eye position in scene coordinates (z up, meters). */
  eye: Vec3;
  /** Unit vector screen-right. */
  right: Vec3;
  /** Unit vector screen-up. */
  up: Vec3;
  /** Unit vector INTO the scene. */
  forward: Vec3;
  /** Focal length in pixels (vertical FOV ≈ 2·atan(h / 2f)). */
  focalPx: number;
  /** The behavior key this pose came from (echoed in telemetry/tests). */
  behavior: "aerial-follow" | "sideline-follow";
}

/** Near-plane distance (meters) — points closer than this project to null. */
export const NEAR_PLANE_METERS = 0.5;

/** A point in camera space (right-handed: +z INTO the scene). */
export interface CameraSpacePoint {
  x: number;
  y: number;
  z: number;
}

/** Transforms one world point into camera space (no projection). */
export function toCameraSpace(camera: GameCamera, point: Vec3): CameraSpacePoint {
  const dx = point.x - camera.eye.x;
  const dy = point.y - camera.eye.y;
  const dz = point.z - camera.eye.z;
  return {
    x: dot3({ x: dx, y: dy, z: dz }, camera.right),
    y: dot3({ x: dx, y: dy, z: dz }, camera.up),
    z: dot3({ x: dx, y: dy, z: dz }, camera.forward),
  };
}

/** The aerial preset's orbit radius around the follow target (meters). */
const AERIAL_RADIUS_M = 26;

/** The aerial preset's eye height above the pitch plane (meters). */
const AERIAL_HEIGHT_M = 21;

/** The aerial orbit's angular sweep (radians, ± half-amplitude). */
const AERIAL_SWEEP_RAD = 0.55;

/** The aerial orbit's full period (ms). */
const AERIAL_PERIOD_MS = 9_000;

/** The sideline preset's distance behind the y=0 touchline (meters). */
const SIDELINE_BACK_M = 11;

/** The sideline preset's eye height (meters). */
const SIDELINE_HEIGHT_M = 5.5;

/** The sideline pan amplitude along x (meters, ±). */
const SIDELINE_PAN_M = 7;

/** The sideline pan period (ms). */
const SIDELINE_PERIOD_MS = 7_000;

/** The base vertical focal fraction: focal = height × fraction (px). */
const FOCAL_FRACTION = 1.55;

/** The emphasis zoom multiplier at its peak. */
const EMPHASIS_ZOOM = 1.28;

/** The emphasis window length (ms) after the triggering event time. */
const EMPHASIS_WINDOW_MS = 1_800;

/** A deterministic scalar in [0, 1) — one draw from the seed (xorshift32). */
function seededUnit(seed: number, salt: number): number {
  let x = (seed ^ (salt * 0x9e3779b1)) >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return x / 0x1_0000_0000;
}

/**
 * Builds the follow camera pose at timeline position `tMs` for the given
 * play target (the ball's world position), behavior, seed, and the set of
 * emphasis windows armed by applied events (each `[startMs, endMs)`).
 */
export function buildGameCamera(options: {
  target: Vec3;
  tMs: number;
  behavior: "aerial-follow" | "sideline-follow";
  seed: number;
  canvasHeight: number;
  emphasisWindows: readonly { startMs: number; endMs: number }[];
}): GameCamera {
  const { target, tMs, behavior, seed, canvasHeight, emphasisWindows } = options;
  const phase = seededUnit(seed, 1) * Math.PI * 2;

  let eye: Vec3;
  if (behavior === "aerial-follow") {
    const azimuth =
      Math.PI / 2 + // start behind the y<0 side
      Math.sin(phase + (2 * Math.PI * tMs) / AERIAL_PERIOD_MS) * AERIAL_SWEEP_RAD;
    eye = {
      x: target.x - Math.cos(azimuth) * AERIAL_RADIUS_M,
      y: target.y - Math.sin(azimuth) * AERIAL_RADIUS_M,
      z: AERIAL_HEIGHT_M,
    };
  } else {
    const pan = Math.sin(phase + (2 * Math.PI * tMs) / SIDELINE_PERIOD_MS) * SIDELINE_PAN_M;
    eye = { x: target.x + pan, y: -SIDELINE_BACK_M, z: SIDELINE_HEIGHT_M };
  }

  // The look-at target sits at the play, slightly above the plane.
  const lookAt: Vec3 = { x: target.x, y: target.y, z: 1.2 };
  const forward = normalize3({
    x: lookAt.x - eye.x,
    y: lookAt.y - eye.y,
    z: lookAt.z - eye.z,
  });
  // Straight-down guard: the world-up cross degenerates near nadir; the
  // aerial preset never reaches it (height 21, radius 26 → max depression
  // ≈ 39°), so the documented fallback only protects hypothetical presets.
  let right = normalize3(cross3(forward, { x: 0, y: 0, z: 1 }));
  if (right.x === 0 && right.y === 0 && right.z === 0) {
    right = normalize3(cross3(forward, { x: 0, y: 1, z: 0 }));
  }
  const up = normalize3(cross3(right, forward));

  // Event-driven emphasis: an ease-in-out zoom punch inside armed windows.
  let emphasis = 0;
  for (const window of emphasisWindows) {
    if (tMs >= window.startMs && tMs < window.endMs) {
      const local = (tMs - window.startMs) / (window.endMs - window.startMs);
      // Smooth bump: sin² over the window (0 → 1 → 0).
      const bump = Math.sin(Math.PI * local) ** 2;
      emphasis = Math.max(emphasis, bump);
    }
  }
  const focalPx = canvasHeight * FOCAL_FRACTION * (1 + (EMPHASIS_ZOOM - 1) * emphasis);

  return { eye, right, up, forward, focalPx, behavior };
}

/** Projects one world point through a camera (null when behind the near plane). */
export function projectPoint(
  camera: GameCamera,
  point: Vec3,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number; depth: number } | null {
  const cam = toCameraSpace(camera, point);
  if (cam.z < NEAR_PLANE_METERS) return null;
  return {
    x: canvasWidth / 2 + (camera.focalPx * cam.x) / cam.z,
    y: canvasHeight / 2 - (camera.focalPx * cam.y) / cam.z,
    depth: cam.z,
  };
}

/** The camera's orbit phase for a seed (shared by the camera + speed model). */
export function cameraPhaseOf(seed: number): number {
  return seededUnit(seed, 1) * Math.PI * 2;
}

/**
 * The emphasis windows armed by applied football events (goal/shot arms
 * the zoom punch; other events arm none). Pure: derived from the event
 * stream the engine applied.
 */
export function emphasisWindowsOf(
  events: readonly { eventTimeMs: number; eventTypeRef: string }[],
): { startMs: number; endMs: number }[] {
  const windows: { startMs: number; endMs: number }[] = [];
  for (const event of events) {
    if (
      event.eventTypeRef === "football/v1/goal" ||
      event.eventTypeRef === "football/v1/shot" ||
      event.eventTypeRef === "football/v1/save"
    ) {
      windows.push({
        startMs: event.eventTimeMs,
        endMs: event.eventTimeMs + EMPHASIS_WINDOW_MS,
      });
    }
  }
  return windows;
}
