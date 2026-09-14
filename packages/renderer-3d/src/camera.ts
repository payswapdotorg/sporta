/**
 * THE deterministic 3D camera of the avatar/field prototype (W602): a
 * pinhole perspective camera placed at a W601 named camera slot.
 *
 * Everything here is plain documented math — no 3D-engine dependency
 * (architecture-lock §9 vendor neutrality; the "presentation format" is a
 * deterministic SVG document produced by projecting the scene through THIS
 * camera — see RENDERER.md for the decision record).
 *
 * ## Camera model (all constants documented in RENDERER.md)
 *
 * - **Look-at basis**: `forward = normalize(target − eye)`;
 *   `right = normalize(forward × WORLD_UP)`; `up = right × forward`
 *   (right-handed, `forward` points INTO the scene). The world up is the
 *   scene frame's own `+z` (W601 S4: z up).
 * - **Straight-down fallback**: when `forward` is (anti)parallel to the
 *   world up — the `aerial-tactical` slot looks straight down —
 *   `forward × WORLD_UP` degenerates to the zero vector. The documented
 *   disambiguation uses the world `+y` axis as the provisional up hint:
 *   `right = normalize(forward × (0, 1, 0))` (= `+x` for a nadir camera),
 *   `up = right × forward` (= `+y`). The nadir frame therefore orients
 *   world `+x` screen-right and world `+y` screen-UP (a physical
 *   looking-straight-down orientation with the head toward `+y`), a
 *   documented presentation convention.
 * - **Projection**: a camera-space point `p_cam = (dot(d, right),
 *   dot(d, up), dot(d, forward))` with `d = p − eye` projects to
 *   `screen = (cx + focal · p_cam.x / p_cam.z, cy − focal · p_cam.y /
 *   p_cam.z)` — the classic perspective divide, with SVG's y-down screen
 *   convention. `focal` is fixed at {@link FOCAL_PX} (512 px on the
 *   1280×720 profile, ≈ 70° vertical FOV) chosen so the nadir
 *   `aerial-tactical` slot frames the FULL 105 × 68 pitch below the HUD
 *   band; other slots frame the pitch like their real-world counterparts
 *   (the main-touchline slot shows the far half large and the near corners
 *   outside the frame — honest slot geometry, never re-framed by the
 *   renderer).
 * - **Near plane**: points with `p_cam.z < NEAR_PLANE_METERS` are behind /
 *   too close to the camera. Polygons are clipped in camera space
 *   (Sutherland–Hodgman against the near plane) and segments parametrically,
 *   so EVERY drawable element stays well-defined for ANY slot position —
 *   including future slots inside the pitch or behind furniture (W604 can
 *   direct from anywhere). Entity figures do not partially clip: an entity
 *   whose base point is behind the near plane is OMITTED with an accounted
 *   disposition (never a half-drawn avatar).
 */
import type { SceneCameraSlot } from "@sporta/scene-projection";
import { cross3, dot3, lerp3, normalize3, round2, WORLD_UP, type Vec3 } from "./internal";

/**
 * The camera focal length in pixels (512 px on the 1280×720 profile,
 * ≈ 70° vertical FOV). A fixed presentation constant — the renderer never
 * zooms (W604 directs slots; it does not re-frame them).
 */
export const FOCAL_PX = 512;

/**
 * The near-plane distance in meters: camera-space points closer than this
 * (or behind the camera) are clipped / omitted. A documented constant that
 * keeps every projection finite and every clip deterministic.
 */
export const NEAR_PLANE_METERS = 0.5;

/**
 * The minimum drawn radius of a projected marker primitive (ball, head,
 * top-view footprint, spot dot, out-of-play ring) in pixels. A documented
 * READABILITY presentation constant: honest perspective makes a 0.11 m
 * ball under one pixel at aerial distances (60 m) — an invisible ball
 * breaks the coherent-field reading, so marker radii floor at 2.5 px
 * (ground polygons — shadows, haloes, rings — never floor; they stay
 * perspective-true). The manifest records positions/depth, not radii, so
 * the floor never mutates data.
 */
export const MIN_MARKER_RADIUS_PX = 2.5;

/** A 3D point in camera space (right-handed: +z INTO the scene). */
export interface CameraPoint {
  x: number;
  y: number;
  z: number;
}

/** The camera frame: eye position plus the orthonormal basis. */
export interface CameraFrame {
  /** The camera's position in scene coordinates (the slot's `position`). */
  eye: Vec3;
  /** Unit vector screen-right. */
  right: Vec3;
  /** Unit vector screen-up. */
  up: Vec3;
  /** Unit vector INTO the scene (from eye toward the slot's `target`). */
  forward: Vec3;
}

/** A projected 2D point in screen (SVG) coordinates + the camera depth. */
export interface ProjectedPoint {
  /** Screen x (SVG units; canvas center at `width / 2`). */
  x: number;
  /** Screen y (SVG units; canvas center at `height / 2`, y grows down). */
  y: number;
  /** Camera-space depth of the projected point (meters, > near plane). */
  depth: number;
}

/** The camera-space transform of one scene point. */
export function toCameraSpace(camera: CameraFrame, point: Vec3): CameraPoint {
  const d = { x: point.x - camera.eye.x, y: point.y - camera.eye.y, z: point.z - camera.eye.z };
  return {
    x: dot3(d, camera.right),
    y: dot3(d, camera.up),
    z: dot3(d, camera.forward),
  };
}

/**
 * Builds the camera frame of one scene camera slot (the look-at basis with
 * the documented straight-down fallback). Pure: the slot's position and
 * target are used verbatim — the camera NEVER moves, zooms, or re-aims.
 */
export function cameraFromSlot(slot: SceneCameraSlot): CameraFrame {
  const eye: Vec3 = { x: slot.position.x, y: slot.position.y, z: slot.position.z };
  const target: Vec3 = { x: slot.target.x, y: slot.target.y, z: slot.target.z };
  const d = { x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z };
  const forward = normalize3(d);
  let right = normalize3(cross3(forward, WORLD_UP));
  const degenerate = right.x === 0 && right.y === 0 && right.z === 0;
  if (degenerate) {
    // Straight (anti)parallel-to-up view: the documented +y up-hint
    // disambiguation (module docblock). For a nadir camera this yields
    // right = +x, up = +y.
    right = normalize3(cross3(forward, { x: 0, y: 1, z: 0 }));
  }
  const up = cross3(right, forward);
  return { eye, right, up, forward };
}

/**
 * Projects one camera-space point onto the screen (the perspective divide).
 * Returns `undefined` when the point is at or behind the near plane — the
 * CALLER decides the honest treatment (clip for polygons/segments, omit for
 * entities). Pure.
 */
export function projectCameraPoint(
  point: CameraPoint,
  canvas: { width: number; height: number },
): ProjectedPoint | undefined {
  if (point.z < NEAR_PLANE_METERS) return undefined;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return {
    x: round2(cx + (FOCAL_PX * point.x) / point.z),
    y: round2(cy - (FOCAL_PX * point.y) / point.z),
    depth: point.z,
  };
}

/**
 * Projects one scene point through a camera frame (convenience composition
 * of {@link toCameraSpace} + {@link projectCameraPoint}). Pure.
 */
export function projectPoint(
  camera: CameraFrame,
  point: Vec3,
  canvas: { width: number; height: number },
): ProjectedPoint | undefined {
  return projectCameraPoint(toCameraSpace(camera, point), canvas);
}

/**
 * Clips one camera-space segment against the near plane (parametric): both
 * endpoints behind → `null` (nothing drawable); one behind → the segment
 * shortened to the near-plane crossing. Pure and deterministic.
 */
export function clipSegmentNear(a: CameraPoint, b: CameraPoint): [CameraPoint, CameraPoint] | null {
  const za = a.z;
  const zb = b.z;
  if (za < NEAR_PLANE_METERS && zb < NEAR_PLANE_METERS) return null;
  if (za >= NEAR_PLANE_METERS && zb >= NEAR_PLANE_METERS) return [a, b];
  // Exactly one endpoint is behind: interpolate to the near-plane crossing.
  const t = (NEAR_PLANE_METERS - za) / (zb - za);
  const clipped = lerp3(a, b, t);
  return za < NEAR_PLANE_METERS ? [clipped, b] : [a, clipped];
}

/**
 * Clips one polygon (camera-space vertices, any winding) against the near
 * plane — Sutherland–Hodgman restricted to the single `z >= NEAR` plane.
 * Returns the clipped vertex list (possibly empty). Pure and deterministic.
 */
export function clipPolygonNear(points: readonly CameraPoint[]): CameraPoint[] {
  const output: CameraPoint[] = [];
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const current = points[i]!;
    const next = points[(i + 1) % count]!;
    const currentInside = current.z >= NEAR_PLANE_METERS;
    const nextInside = next.z >= NEAR_PLANE_METERS;
    if (currentInside) output.push(current);
    if (currentInside !== nextInside) {
      const t = (NEAR_PLANE_METERS - current.z) / (next.z - current.z);
      output.push({
        x: current.x + t * (next.x - current.x),
        y: current.y + t * (next.y - current.y),
        z: NEAR_PLANE_METERS,
      });
    }
  }
  return output;
}

/**
 * The perspective-projected radius of a small sphere/circle of scene radius
 * `rMeters` at camera depth `depth` (the standard small-object silhouette
 * approximation `r_screen ≈ focal · r / depth`), floored at
 * {@link MIN_MARKER_RADIUS_PX} (a documented readability constant — see
 * its docblock). Rounds to 2 decimals for serialization.
 */
export function projectedRadius(rMeters: number, depth: number): number {
  const raw = (FOCAL_PX * rMeters) / depth;
  return round2(Math.max(raw, MIN_MARKER_RADIUS_PX));
}
