/**
 * Scene specification → drawable frame resolution (W602): the shared core
 * both render paths use.
 *
 * `resolve3dFrame` turns ONE validated W601 `SceneSpecification` plus the
 * chosen camera slot into
 *
 * - the drawable structure `composeFrame3dSvg` serializes (field geometry
 *   + per-entity figures in screen space, depth-sorted), and
 * - the per-entity manifest entries (provenance + honest accounting).
 *
 * HONESTY RULES (the W601 contract consumed, never re-derived):
 *
 * - **Dispositions are CONSUMED, not recomputed** — the spec's
 *   `omitted-no-position` / `omitted-invalid-position` /
 *   `omitted-non-pitch-frame` entities are omitted (NEVER placed), its
 *   `not-projected-kind` entities are accounted-only. The renderer adds
 *   only CAMERA-SPACE honesty for positioned entities
 *   (`omitted-behind-camera`, `omitted-off-canvas`) — positions are never
 *   clamped, never moved: an off-canvas entity's TRUE meters are recorded
 *   verbatim in the manifest.
 * - **Positions verbatim** — `positionMeters` is the spec's
 *   `SceneEntity.position` copied field-for-field; the ball's `z` is its
 *   carried height (drawn elevated with a shadow + drop line ONLY when
 *   the spec carries it — see `./style.ts` for the height/heading producer
 *   decision record).
 * - **Headings verbatim** — a facing wedge is drawn ONLY when the spec
 *   carries a usable `heading` (dashed when the slot is uncertain). No
 *   heading data → the avatar is a billboard figure making NO facing
 *   claim. The ball's carried heading is manifest-recorded but not drawn
 *   (the ball is not a figure).
 * - **Confidence verbatim** — `positionConfidence` drives visual opacity
 *   only (the documented `0.35 + 0.65·c` mapping); absent confidence
 *   renders with NO opacity attribute (a neutral no-claim style).
 * - **Identity stability** — avatar color tokens come from
 *   `avatarEntityStyle(entityId)` — a pure function of
 *   (styleKey, entityId), NEVER of the entity's SWM version (which would
 *   flicker on every upsert). Officials use the fixed uniform style; the
 *   ball's style is fixed.
 * - **Near-plane totality** — the resolution is TOTAL for any camera slot
 *   geometry a valid spec can carry: ground ANNOTATION rings (haloes,
 *   shadows, possession rings) are near-plane-clipped in camera space
 *   (empty ⇒ not drawn, never a crash), and FIGURES use the whole-figure
 *   guarantee — an entity is drawn only when EVERY body point (figure
 *   silhouette, head, facing wedge, top-view footprint) is in front of the
 *   near plane; otherwise it is omitted WHOLE as `omitted-behind-camera`
 *   (the camera.ts contract: never a half-drawn figure).
 */
import type { SceneCameraSlot, SceneEntity, SceneSpecification } from "@sporta/scene-projection";
import {
  cameraFromSlot,
  clipPolygonNear,
  projectCameraPoint,
  projectPoint,
  projectedRadius,
  toCameraSpace,
  NEAR_PLANE_METERS,
  type CameraFrame,
} from "./camera";
import { buildFieldGeometry } from "./furniture";
import type { FieldGeometry } from "./furniture";
import {
  AVATAR_FACING_HALF_WIDTH_METERS,
  AVATAR_FACING_HEIGHT_METERS,
  AVATAR_FACING_LENGTH_METERS,
  AVATAR_HEAD_CENTER_METERS,
  AVATAR_HEAD_RADIUS_METERS,
  AVATAR_LEG_HALF_WIDTH_METERS,
  AVATAR_LEG_TOP_METERS,
  AVATAR_SHOULDER_HALF_WIDTH_METERS,
  AVATAR_SHOULDER_METERS,
  AVATAR_TOPVIEW_RADIUS_METERS,
  BALL_RADIUS_METERS,
  HALO_RADIUS_METERS,
  OFFICIAL_STYLE,
  OUT_OF_PLAY_RING_RADIUS_METERS,
  POSSESSION_RING_RADIUS_METERS,
  avatarEntityStyle,
  opacityFromConfidence,
  type AvatarStyle,
} from "./style";
import type { Vec3 } from "./internal";
import { round2 } from "./internal";
import type { Render3dEntityEntry, Render3dPossessionEntry, Render3dStyleKind } from "./types";

/** A projected screen point (2-decimal serialization values). */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** A projected screen polygon (ground circles, quads, wedges). */
export type ScreenPolygon = ScreenPoint[];

/** The billboard avatar figure (a non-overhead camera). */
export interface AvatarFigureDrawable {
  /** The legs quad (base → leg top), trim-colored. */
  legs: ScreenPolygon;
  /** The torso quad (leg top → shoulder), jersey-colored. */
  torso: ScreenPolygon;
  /** The head circle. */
  head: { cx: number; cy: number; r: number };
  /** The facing wedge (ONLY when the spec carried a usable heading). */
  facing: ScreenPolygon | null;
}

/** The top-view avatar marker (an overhead camera, |forward.z| ≥ 0.75). */
export interface AvatarTopViewDrawable {
  /** The ground footprint circle polygon, jersey-colored. */
  circle: ScreenPolygon;
  /** The ground facing wedge (ONLY when the spec carried a usable heading). */
  facing: ScreenPolygon | null;
}

/** One avatar entity's drawable (participant or official). */
export interface AvatarDrawable {
  type: "avatar";
  entityId: string;
  kind: "participant" | "official";
  /** Camera depth of the figure (meters) — the painter's sort key. */
  depth: number;
  /** Opacity from verbatim confidence; `undefined` renders no attribute. */
  opacity: number | undefined;
  /** Out-of-play marker posture (dashed ring + OUT tag, no styled figure). */
  outOfPlay: boolean;
  /** The uncertainty halo ring (candidate position). */
  halo: ScreenPolygon | null;
  /** The identity-stable style token (or the fixed official style). */
  style: AvatarStyle;
  /** Billboard mode (non-overhead camera). */
  figure: AvatarFigureDrawable | null;
  /** Top-view mode (overhead camera). */
  topView: AvatarTopViewDrawable | null;
  /** Whether the carried heading slot was UNCERTAIN (dashed wedge). */
  facingDashed: boolean;
  /** The figure's base screen point (label + ring anchoring). */
  base: ScreenPoint;
  /** The projected out-of-play ring radius at the base. */
  ringRadius: number;
}

/** One ball entity's drawable. */
export interface BallDrawable {
  type: "ball";
  entityId: string;
  /** Camera depth of the ball's center (meters). */
  depth: number;
  /** Opacity from verbatim confidence; `undefined` renders no attribute. */
  opacity: number | undefined;
  /** Out-of-play marker posture (dashed ring + OUT tag, no ball). */
  outOfPlay: boolean;
  /** The ball circle center + radius. */
  center: ScreenPoint;
  radius: number;
  /** Whether the spec carried the ball's height (elevated rendering). */
  heightCarried: boolean;
  /** The ground shadow polygon (height carried only). */
  shadow: ScreenPolygon | null;
  /** The drop line's ground end (height carried only). */
  dropTo: ScreenPoint | null;
}

/** Any drawable entity (discriminated by `type`). */
export type EntityDrawable = AvatarDrawable | BallDrawable;

/** The possession ring drawable (ground level, under the possessing avatar). */
export interface PossessionDrawable {
  entityId: string;
  polygon: ScreenPolygon;
  opacity: number | undefined;
}

/** What `resolve3dFrame` produces: the drawables + manifest accounting. */
export interface Resolved3dFrame {
  /** The camera frame built from the slot (the framing used, verbatim slot). */
  camera: CameraFrame;
  /** The camera slot, verbatim. */
  slot: SceneCameraSlot;
  /** Whether the camera is overhead (top-view avatar rendering). */
  topView: boolean;
  /** The field geometry derived from the spec's world block. */
  field: FieldGeometry;
  /** The drawable entities, depth-sorted far → near (stable on spec order). */
  entities: EntityDrawable[];
  /** The per-entity manifest entries, in SPEC order (never re-sorted). */
  manifestEntities: Render3dEntityEntry[];
  /** The possession ring drawable (null when not displayed). */
  possessionDrawable: PossessionDrawable | null;
  /** The possession manifest entry, or null without football state. */
  possession: Render3dPossessionEntry | null;
}

/** The canvas dimensions (SVG units). */
export interface CanvasSize {
  width: number;
  height: number;
}

/** The height of the HUD annotation band at the top of the canvas. */
export const HUD_HEIGHT = 64;

/** Ground-circle polygon discretization (a presentation constant). */
export const GROUND_CIRCLE_SEGMENTS = 12;

/**
 * The overhead-camera threshold: a camera whose forward direction points
 * downward with `forward.z <= −0.75` (≥ ~48.6° below the horizon) renders
 * avatars as top-view ground markers — from that steepness a billboard
 * figure is edge-on and unreadable; the footprint is the honest view.
 */
export const OVERHEAD_FORWARD_Z = -0.75;

/** Whether a screen point is inside the drawable region (below the HUD). */
export function inDrawableRegion(point: ScreenPoint, canvas: CanvasSize): boolean {
  return (
    point.x >= 0 && point.x <= canvas.width && point.y >= HUD_HEIGHT && point.y <= canvas.height
  );
}

/** Projects one 3D point, failing loud on a non-projectable point. */
function mustProject(camera: CameraFrame, point: Vec3, canvas: CanvasSize): ScreenPoint {
  const projected = projectPoint(camera, point, canvas);
  if (projected === undefined) {
    throw new RangeError(
      `resolve3dFrame: point (${point.x}, ${point.y}, ${point.z}) is behind the near plane — the caller must classify it first`,
    );
  }
  return { x: projected.x, y: projected.y };
}

/**
 * The polygon of a ground circle (center + radius, on the plane at `z`),
 * NEAR-PLANE-CLIPPED in camera space: a ground ring that crosses the near
 * plane (an exotic close-up slot) is clipped, not crashed — a partially
 * visible annotation ring is honest perspective, and an empty result (the
 * ring entirely behind the near plane) means the ring is not drawn at all.
 * Ground rings are ANNOTATIONS (haloes, shadows, possession rings), never
 * figures — figures use the whole-figure near-plane guarantee instead (see
 * `resolveAvatarEntity`).
 */
function groundCircle(
  camera: CameraFrame,
  center: { x: number; y: number },
  radius: number,
  z: number,
  canvas: CanvasSize,
): ScreenPolygon {
  const scenePoints: Vec3[] = [];
  for (let i = 0; i < GROUND_CIRCLE_SEGMENTS; i += 1) {
    const angle = (2 * Math.PI * i) / GROUND_CIRCLE_SEGMENTS;
    scenePoints.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
      z,
    });
  }
  const clipped = clipPolygonNear(scenePoints.map((point) => toCameraSpace(camera, point)));
  const points: ScreenPoint[] = [];
  for (const cameraPoint of clipped) {
    const projected = projectCameraPoint(cameraPoint, canvas);
    if (projected !== undefined) points.push({ x: projected.x, y: projected.y });
  }
  return points;
}

/** The scene-space points of one discretized ground circle (unprojected). */
function groundCirclePoints(center: { x: number; y: number }, radius: number, z: number): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i < GROUND_CIRCLE_SEGMENTS; i += 1) {
    const angle = (2 * Math.PI * i) / GROUND_CIRCLE_SEGMENTS;
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
      z,
    });
  }
  return points;
}

/** The horizontal billboard-right direction (camera right flattened to z=0). */
function horizontalRight(camera: CameraFrame): { x: number; y: number } {
  const r = camera.right;
  if (r.x === 0 && r.y === 0) return { x: 1, y: 0 }; // Nadir camera: +x (documented).
  const length = Math.sqrt(r.x * r.x + r.y * r.y);
  return { x: r.x / length, y: r.y / length };
}

/** One avatar entity → drawable + manifest entry. Pure. */
function resolveAvatarEntity(
  entity: SceneEntity,
  sceneDisposition: "projected" | "projected-out-of-bounds",
  camera: CameraFrame,
  topView: boolean,
  canvas: CanvasSize,
): { drawable: AvatarDrawable | null; entry: Render3dEntityEntry } {
  const position = entity.position!;
  const entityId = entity.entityId;
  const isOfficial = entity.kind === "official";
  const style = isOfficial ? OFFICIAL_STYLE : avatarEntityStyle(entityId);
  const styleKind: Render3dStyleKind = isOfficial ? "official-fixed" : "identity";
  const heading = entity.heading;
  const headingCarried = heading !== undefined && heading.radians !== undefined;
  const baseZ = position.z ?? 0;
  const base: Vec3 = { x: position.x, y: position.y, z: baseZ };

  const manifest: Render3dEntityEntry = {
    entityId,
    kind: entity.kind,
    version: entity.version,
    lastEventTimeMs: entity.lastEventTimeMs,
    sceneDisposition: entity.disposition,
    renderDisposition: sceneDisposition === "projected" ? "rendered" : "rendered-out-of-play",
    positionMeters: {
      x: position.x,
      y: position.y,
      ...(position.z !== undefined ? { z: position.z } : {}),
    },
    headingCarried,
    ...(headingCarried ? { headingRadians: heading!.radians } : {}),
    ...(entity.positionStatus !== undefined ? { positionStatus: entity.positionStatus } : {}),
    ...(entity.positionConfidence !== undefined
      ? { positionConfidence: entity.positionConfidence }
      : {}),
    ...(isOfficial ? {} : { style: { ...style } }),
    styleKind,
  };

  const baseCam = toCameraSpace(camera, base);
  if (baseCam.z < NEAR_PLANE_METERS) {
    manifest.renderDisposition = "omitted-behind-camera";
    return { drawable: null, entry: manifest };
  }
  const baseProjected = projectPoint(camera, base, canvas);
  if (baseProjected === undefined || !inDrawableRegion(baseProjected, canvas)) {
    manifest.renderDisposition = "omitted-off-canvas";
    return { drawable: null, entry: manifest };
  }
  const baseScreen = { x: baseProjected.x, y: baseProjected.y };
  const depth = baseProjected.depth;
  const outOfPlay = sceneDisposition === "projected-out-of-bounds";

  // The WHOLE-FIGURE near-plane guarantee (the camera.ts contract: "an
  // entity whose base point is behind the near plane is OMITTED … never a
  // half-drawn avatar"): the figure's body extends up to 1.8 m up and
  // ±0.25 m sideways from the base, so a base in front of the near plane
  // does NOT imply every body point is. An entity in the near band whose
  // ANY body point falls behind the near plane is omitted WHOLE with the
  // accounted `omitted-behind-camera` disposition (its TRUE position stays
  // verbatim in the manifest, and NO screen position is recorded — the
  // entry types document drawn dispositions only) — the render never
  // crashes and never draws a clipped-in-half figure.
  if (!outOfPlay) {
    const right = horizontalRight(camera);
    const bodyPoints: Vec3[] = topView
      ? groundCirclePoints({ x: position.x, y: position.y }, AVATAR_TOPVIEW_RADIUS_METERS, baseZ)
      : [
          {
            x: position.x - AVATAR_LEG_HALF_WIDTH_METERS * right.x,
            y: position.y - AVATAR_LEG_HALF_WIDTH_METERS * right.y,
            z: baseZ,
          },
          {
            x: position.x + AVATAR_LEG_HALF_WIDTH_METERS * right.x,
            y: position.y + AVATAR_LEG_HALF_WIDTH_METERS * right.y,
            z: baseZ,
          },
          {
            x: position.x - AVATAR_SHOULDER_HALF_WIDTH_METERS * right.x,
            y: position.y - AVATAR_SHOULDER_HALF_WIDTH_METERS * right.y,
            z: baseZ + AVATAR_SHOULDER_METERS,
          },
          {
            x: position.x + AVATAR_SHOULDER_HALF_WIDTH_METERS * right.x,
            y: position.y + AVATAR_SHOULDER_HALF_WIDTH_METERS * right.y,
            z: baseZ + AVATAR_SHOULDER_METERS,
          },
          {
            x: position.x,
            y: position.y,
            z: baseZ + AVATAR_HEAD_CENTER_METERS + AVATAR_HEAD_RADIUS_METERS,
          },
        ];
    if (headingCarried) {
      const theta = heading!.radians!;
      const dir = { x: Math.cos(theta), y: Math.sin(theta) };
      const perp = { x: -dir.y, y: dir.x };
      const chestZ = topView ? baseZ : baseZ + AVATAR_FACING_HEIGHT_METERS;
      bodyPoints.push(
        {
          x: position.x + AVATAR_FACING_HALF_WIDTH_METERS * perp.x,
          y: position.y + AVATAR_FACING_HALF_WIDTH_METERS * perp.y,
          z: chestZ,
        },
        {
          x: position.x + AVATAR_FACING_LENGTH_METERS * dir.x,
          y: position.y + AVATAR_FACING_LENGTH_METERS * dir.y,
          z: chestZ,
        },
        {
          x: position.x - AVATAR_FACING_HALF_WIDTH_METERS * perp.x,
          y: position.y - AVATAR_FACING_HALF_WIDTH_METERS * perp.y,
          z: chestZ,
        },
      );
    }
    if (bodyPoints.some((point) => toCameraSpace(camera, point).z < NEAR_PLANE_METERS)) {
      manifest.renderDisposition = "omitted-behind-camera";
      return { drawable: null, entry: manifest };
    }
  }

  manifest.screenPosition = { ...baseScreen };
  manifest.depthMeters = round2(depth);

  const opacity = opacityFromConfidence(entity.positionConfidence);
  const ringRadius = projectedRadius(OUT_OF_PLAY_RING_RADIUS_METERS, depth);

  const haloPolygon =
    !outOfPlay && entity.positionStatus === "uncertain"
      ? groundCircle(camera, { x: position.x, y: position.y }, HALO_RADIUS_METERS, baseZ, canvas)
      : [];
  const halo = haloPolygon.length >= 3 ? haloPolygon : null;

  let figure: AvatarFigureDrawable | null = null;
  let topViewMarker: AvatarTopViewDrawable | null = null;
  if (!outOfPlay && !topView) {
    // Billboard figure: silhouette edges offset along the flattened
    // camera-right direction (the figure always faces the camera
    // horizontally; a documented billboard convention). The body sections
    // span ground → leg top → shoulder (the style.ts presentation
    // constants), each a quad between two heights at a constant half-width.
    const right = horizontalRight(camera);
    const quad = (h0: number, h1: number, halfWidth: number): ScreenPolygon => [
      mustProject(
        camera,
        { x: position.x - halfWidth * right.x, y: position.y - halfWidth * right.y, z: baseZ + h0 },
        canvas,
      ),
      mustProject(
        camera,
        { x: position.x + halfWidth * right.x, y: position.y + halfWidth * right.y, z: baseZ + h0 },
        canvas,
      ),
      mustProject(
        camera,
        { x: position.x + halfWidth * right.x, y: position.y + halfWidth * right.y, z: baseZ + h1 },
        canvas,
      ),
      mustProject(
        camera,
        { x: position.x - halfWidth * right.x, y: position.y - halfWidth * right.y, z: baseZ + h1 },
        canvas,
      ),
    ];
    const legs = quad(0, AVATAR_LEG_TOP_METERS, AVATAR_LEG_HALF_WIDTH_METERS);
    const torso = quad(
      AVATAR_LEG_TOP_METERS,
      AVATAR_SHOULDER_METERS,
      AVATAR_SHOULDER_HALF_WIDTH_METERS,
    );
    const headCenter = mustProject(
      camera,
      { x: position.x, y: position.y, z: baseZ + AVATAR_HEAD_CENTER_METERS },
      canvas,
    );
    const head = {
      cx: headCenter.x,
      cy: headCenter.y,
      r: projectedRadius(AVATAR_HEAD_RADIUS_METERS, depth),
    };
    let facing: ScreenPolygon | null = null;
    if (headingCarried) {
      const theta = heading!.radians!;
      const dir = { x: Math.cos(theta), y: Math.sin(theta) };
      const perp = { x: -dir.y, y: dir.x };
      const chestZ = baseZ + AVATAR_FACING_HEIGHT_METERS;
      const chest = { x: position.x, y: position.y };
      facing = [
        mustProject(
          camera,
          {
            x: chest.x + AVATAR_FACING_HALF_WIDTH_METERS * perp.x,
            y: chest.y + AVATAR_FACING_HALF_WIDTH_METERS * perp.y,
            z: chestZ,
          },
          canvas,
        ),
        mustProject(
          camera,
          {
            x: chest.x + AVATAR_FACING_LENGTH_METERS * dir.x,
            y: chest.y + AVATAR_FACING_LENGTH_METERS * dir.y,
            z: chestZ,
          },
          canvas,
        ),
        mustProject(
          camera,
          {
            x: chest.x - AVATAR_FACING_HALF_WIDTH_METERS * perp.x,
            y: chest.y - AVATAR_FACING_HALF_WIDTH_METERS * perp.y,
            z: chestZ,
          },
          canvas,
        ),
      ];
    }
    figure = { legs, torso, head, facing };
  } else if (!outOfPlay && topView) {
    // Top-view marker: the body's ground footprint + ground facing wedge.
    // The footprint points were whole-figure-checked above (never a
    // half-drawn marker), so mustProject cannot throw here.
    const circle = groundCirclePoints(
      { x: position.x, y: position.y },
      AVATAR_TOPVIEW_RADIUS_METERS,
      baseZ,
    ).map((point) => mustProject(camera, point, canvas));
    let facing: ScreenPolygon | null = null;
    if (headingCarried) {
      const theta = heading!.radians!;
      const dir = { x: Math.cos(theta), y: Math.sin(theta) };
      const perp = { x: -dir.y, y: dir.x };
      facing = [
        mustProject(
          camera,
          {
            x: position.x + AVATAR_FACING_HALF_WIDTH_METERS * perp.x,
            y: position.y + AVATAR_FACING_HALF_WIDTH_METERS * perp.y,
            z: baseZ,
          },
          canvas,
        ),
        mustProject(
          camera,
          {
            x: position.x + AVATAR_FACING_LENGTH_METERS * dir.x,
            y: position.y + AVATAR_FACING_LENGTH_METERS * dir.y,
            z: baseZ,
          },
          canvas,
        ),
        mustProject(
          camera,
          {
            x: position.x - AVATAR_FACING_HALF_WIDTH_METERS * perp.x,
            y: position.y - AVATAR_FACING_HALF_WIDTH_METERS * perp.y,
            z: baseZ,
          },
          canvas,
        ),
      ];
    }
    topViewMarker = { circle, facing };
  }

  const drawable: AvatarDrawable = {
    type: "avatar",
    entityId,
    kind: isOfficial ? "official" : "participant",
    depth,
    opacity,
    outOfPlay,
    halo,
    style,
    figure,
    topView: topViewMarker,
    facingDashed: entity.heading?.status === "uncertain",
    base: baseScreen,
    ringRadius,
  };
  return { drawable, entry: manifest };
}

/** One ball entity → drawable + manifest entry. Pure. */
function resolveBallEntity(
  entity: SceneEntity,
  sceneDisposition: "projected" | "projected-out-of-bounds",
  camera: CameraFrame,
  planeZ: number,
  canvas: CanvasSize,
): { drawable: BallDrawable | null; entry: Render3dEntityEntry } {
  const position = entity.position!;
  const entityId = entity.entityId;
  // Whether the spec carries the ball's height: the drawn elevation is the
  // spec's `position.z` (W601 sets it from the height slot); an UNPOSITIONED
  // ball can still carry a `height` slot record, so the manifest flag is the
  // UNION — a carried height is never silently dropped from the accounting
  // even when the ball itself is omitted (never placed).
  const heightCarried = position.z !== undefined || entity.height?.meters !== undefined;
  const centerZ = position.z ?? planeZ;
  const center: Vec3 = { x: position.x, y: position.y, z: centerZ };
  const ground: Vec3 = { x: position.x, y: position.y, z: planeZ };

  const manifest: Render3dEntityEntry = {
    entityId,
    kind: entity.kind,
    version: entity.version,
    lastEventTimeMs: entity.lastEventTimeMs,
    sceneDisposition: entity.disposition,
    renderDisposition: sceneDisposition === "projected" ? "rendered" : "rendered-out-of-play",
    positionMeters: {
      x: position.x,
      y: position.y,
      ...(position.z !== undefined ? { z: position.z } : {}),
    },
    heightCarried,
    headingCarried: entity.heading !== undefined && entity.heading.radians !== undefined,
    ...(entity.heading?.radians !== undefined ? { headingRadians: entity.heading.radians } : {}),
    ...(entity.positionStatus !== undefined ? { positionStatus: entity.positionStatus } : {}),
    ...(entity.positionConfidence !== undefined
      ? { positionConfidence: entity.positionConfidence }
      : {}),
    styleKind: "ball-fixed",
  };

  const centerCam = toCameraSpace(camera, center);
  if (centerCam.z < NEAR_PLANE_METERS) {
    manifest.renderDisposition = "omitted-behind-camera";
    return { drawable: null, entry: manifest };
  }
  const centerProjected = projectPoint(camera, center, canvas);
  if (centerProjected === undefined || !inDrawableRegion(centerProjected, canvas)) {
    manifest.renderDisposition = "omitted-off-canvas";
    return { drawable: null, entry: manifest };
  }
  const centerScreen = { x: centerProjected.x, y: centerProjected.y };
  const depth = centerProjected.depth;
  manifest.screenPosition = { ...centerScreen };
  manifest.depthMeters = round2(depth);

  // The elevated-ball depth cues: ground shadow directly below + a dashed
  // drop line — ONLY when the spec carries the height (never a faked z).
  // The shadow ring is a ground ANNOTATION: near-plane-clipped (an empty
  // result means the ground point is behind the camera — no shadow, the
  // ball itself is unaffected).
  let shadow: ScreenPolygon | null = null;
  let dropTo: ScreenPoint | null = null;
  if (heightCarried) {
    const groundCam = toCameraSpace(camera, ground);
    if (groundCam.z >= NEAR_PLANE_METERS) {
      const shadowPolygon = groundCircle(
        camera,
        { x: position.x, y: position.y },
        BALL_RADIUS_METERS,
        planeZ,
        canvas,
      );
      shadow = shadowPolygon.length >= 3 ? shadowPolygon : null;
      const groundProjected = projectPoint(camera, ground, canvas);
      if (groundProjected !== undefined) {
        dropTo = { x: groundProjected.x, y: groundProjected.y };
      }
    }
  }

  const drawable: BallDrawable = {
    type: "ball",
    entityId,
    depth,
    opacity: opacityFromConfidence(entity.positionConfidence),
    outOfPlay: sceneDisposition === "projected-out-of-bounds",
    center: centerScreen,
    radius: projectedRadius(BALL_RADIUS_METERS, depth),
    heightCarried,
    shadow,
    dropTo,
  };
  return { drawable, entry: manifest };
}

/**
 * Resolves one scene specification into its drawable frame + manifest
 * accounting. Pure: a pure function of `(scene, cameraSlot, canvas)` —
 * identity-stable styling included. Both render paths (single scene, clip
 * steps) call this.
 */
export function resolve3dFrame(options: {
  scene: SceneSpecification;
  cameraSlot: SceneCameraSlot;
  canvas: CanvasSize;
}): Resolved3dFrame {
  const { scene, cameraSlot, canvas } = options;
  const camera = cameraFromSlot(cameraSlot);
  const topView = camera.forward.z <= OVERHEAD_FORWARD_Z;
  const field = buildFieldGeometry(scene);
  const planeZ = scene.world.pitch.planeZMeters;

  const drawables: EntityDrawable[] = [];
  const manifestEntities: Render3dEntityEntry[] = [];
  const renderedParticipants = new Map<string, AvatarDrawable>();
  for (const entity of scene.entities) {
    const disposition = entity.disposition;
    let resolved: { drawable: EntityDrawable | null; entry: Render3dEntityEntry } | undefined;
    if (disposition === "projected" || disposition === "projected-out-of-bounds") {
      if (entity.kind === "ball") {
        resolved = resolveBallEntity(entity, disposition, camera, planeZ, canvas);
      } else {
        resolved = resolveAvatarEntity(entity, disposition, camera, topView, canvas);
      }
    } else {
      // The spec's own accounting passes through VERBATIM (never placed).
      const heading = entity.heading;
      const heightCarried = entity.position?.z !== undefined || entity.height?.meters !== undefined;
      resolved = {
        drawable: null,
        entry: {
          entityId: entity.entityId,
          kind: entity.kind,
          version: entity.version,
          lastEventTimeMs: entity.lastEventTimeMs,
          sceneDisposition: disposition,
          renderDisposition:
            disposition === "not-projected-kind" ? "not-rendered-kind" : disposition,
          ...(entity.position !== undefined
            ? {
                positionMeters: {
                  x: entity.position.x,
                  y: entity.position.y,
                  ...(entity.position.z !== undefined ? { z: entity.position.z } : {}),
                },
              }
            : {}),
          headingCarried: heading !== undefined && heading.radians !== undefined,
          ...(heading?.radians !== undefined ? { headingRadians: heading.radians } : {}),
          ...(entity.positionStatus !== undefined ? { positionStatus: entity.positionStatus } : {}),
          ...(entity.positionConfidence !== undefined
            ? { positionConfidence: entity.positionConfidence }
            : {}),
          ...(entity.kind === "ball" ? { heightCarried } : {}),
          styleKind: "none",
        },
      };
    }
    manifestEntities.push(resolved.entry);
    if (resolved.drawable !== null) {
      drawables.push(resolved.drawable);
      if (resolved.drawable.type === "avatar" && resolved.drawable.kind === "participant") {
        renderedParticipants.set(entity.entityId, resolved.drawable);
      }
    }
  }

  // Depth sort: far figures first (painter's algorithm); ties keep spec
  // order (a stable sort — deterministic by construction).
  const order = new Map(drawables.map((drawable, index) => [drawable, index] as const));
  const sorted = [...drawables].sort((a, b) => b.depth - a.depth || order.get(a)! - order.get(b)!);

  // Possession ring: around a RENDERED participant only (matched by entity
  // id, never by position); the spec's possession data is verbatim. The ring
  // is a ground ANNOTATION: near-plane-clipped; a ring that is empty after
  // clipping (entirely behind the camera) is NOT displayed — the accounting
  // records `displayed: false` (never a drawn-but-unaccounted or
  // accounted-but-invisible ring).
  const possessionSlot = scene.scoreClock.possession;
  let possessionDrawable: PossessionDrawable | null = null;
  let possession: Render3dPossessionEntry | null = null;
  if (possessionSlot !== undefined) {
    const entry: Render3dPossessionEntry = {
      status: possessionSlot.status,
      ...(possessionSlot.confidence !== undefined ? { confidence: possessionSlot.confidence } : {}),
      displayed: false,
    };
    const value = possessionSlot.value;
    if (possessionSlot.status !== "unknown" && value !== undefined) {
      const target = renderedParticipants.get(value.entityId);
      if (target !== undefined && !target.outOfPlay) {
        // Invariant: a rendered participant has a spec position (the
        // disposition vocabulary guarantees `position` for `projected*`).
        const manifestEntity = scene.entities.find((entity) => entity.entityId === value.entityId)!;
        const base = manifestEntity.position!;
        const ringPolygon = groundCircle(
          camera,
          { x: base.x, y: base.y },
          POSSESSION_RING_RADIUS_METERS,
          base.z ?? planeZ,
          canvas,
        );
        if (ringPolygon.length >= 3) {
          possessionDrawable = {
            entityId: value.entityId,
            polygon: ringPolygon,
            opacity: opacityFromConfidence(possessionSlot.confidence),
          };
          possession = {
            ...entry,
            entityId: value.entityId,
            displayed: true,
          };
        } else {
          // The ring clipped away entirely: the possessing avatar IS
          // rendered, its ring is not — accounted, not drawn.
          possession = { ...entry, entityId: value.entityId };
        }
      } else {
        // The possessing entity is not a rendered participant (omitted,
        // out of play, an official, or another kind): accounted, not drawn.
        possession = { ...entry, entityId: value.entityId };
      }
    }
    if (possession === null) possession = entry;
  }

  return {
    camera,
    slot: cameraSlot,
    topView,
    field,
    entities: sorted,
    manifestEntities,
    possessionDrawable,
    possession,
  };
}
