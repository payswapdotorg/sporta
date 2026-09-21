/**
 * THE LIVE 3D VIEW-MODEL ADAPTER (L013) — the additive seam through which
 * the EXISTING 3D renderer consumes LIVE world state: no renderer-specific
 * world truth (the ONE canonical SWM only — this adapter is a VIEW
 * projection of the live wire frames, exactly the L005 view-model posture),
 * an INTERACTIVE camera that state updates never touch (the L013
 * acceptance: "camera remains interactive while state updates"), and update
 * continuity without a renderer restart (the scene state is applied
 * per-entity, keyed by the canonical `entityRef`).
 *
 * WHAT THIS IS (and what it deliberately is NOT):
 *
 * - `LiveWorldFrameInput` — the wire frame's world-state subset the adapter
 *   consumes (structurally the W915 `LiveWorldFrameDoc` world fields: the
 *   frozen live-reality.md §5 `LiveRenderInput` semantics as delivered —
 *   `worldState` + `eventsSincePreviousFrame` + the render clock). The
 *   adapter defines the shape it consumes; the apps/web wire document is
 *   structurally assignable (no app import into a package).
 * - `createLiveSceneState` / `applyLiveFrame` — the identity-continuous
 *   scene carry: entities keyed by `entityRef`, positions updated on
 *   detection, an undetected entity carried at its LAST KNOWN position
 *   (marked, with its staleness — never fabricated, never silently
 *   removed). This is a VIEW carry for presentation, the same honest
 *   posture as the tactical view-model — never a second source of world
 *   truth (the canonical SWM seam, Worker A's L003, feeds the wire frames).
 * - `LiveCameraState` + `liveCameraReducer` + `liveCameraFrame` — the
 *   INTERACTIVE camera: a pure orbit/zoom/pan state machine over the pitch
 *   (azimuth/elevation/distance/target, documented bounds) whose frame
 *   derivation is the SAME look-at basis math as the renderer's canonical
 *   `cameraFromSlot` (forward/right/up with the straight-down fallback —
 *   the equivalence is pinned by test: a live camera placed at a canonical
 *   slot's position/target yields the IDENTICAL camera frame). State
 *   updates NEVER touch the camera: `applyLiveFrame` has no camera input,
 *   and the camera reducer has no world input — the two are independent by
 *   construction, which is the frozen camera rule as code.
 * - `projectLiveScene` — the deterministic 3D projection: one scene state +
 *   one camera state + one canvas → per-entity screen positions, depths
 *   and radii (reusing `toCameraSpace` / `projectCameraPoint` /
 *   `projectedRadius` — the renderer's own camera math, never a second
 *   projection).
 *
 * PURITY: no clock reads, no env, no I/O — everything is a pure function
 * of its arguments (the same discipline as the rest of this package).
 */
import type { CameraFrame, CameraPoint } from "./camera";
import { NEAR_PLANE_METERS, projectCameraPoint, projectedRadius, toCameraSpace } from "./camera";
import { cross3, normalize3, WORLD_UP, type Vec3 } from "./internal";

// ---------------------------------------------------------------------------
// The input (the frozen live-reality.md §5 semantics as delivered on the wire)
// ---------------------------------------------------------------------------

/** One entity's world-state row as the wire frame carries it. */
export interface LiveWorldEntityInput {
  /** The canonical entity id — the identity-continuity key. */
  entityRef: string;
  kind: "PLAYER" | "BALL" | "REFEREE" | "OTHER";
  teamRef?: string;
  /** Canonical pitch-frame position (105 × 68 m, x touchline / y goal line). */
  xMeters: number;
  yMeters: number;
  /** Whether the source detected the entity at this frame's event time. */
  detected: boolean;
  confidence: number;
  /** ms since the entity's last DETECTED observation (0 when detected). */
  staleForMs: number;
}

/** The honest frame-event vocabulary the wire carries (never match events). */
export interface LiveWorldEventInput {
  type:
    | "source-recovery"
    | "quality-degraded"
    | "quality-nominal"
    | "entity-appeared"
    | "entity-lost"
    | "entity-regained";
  atMs: number;
  detail?: { entityRef?: string; missedUpdates?: number; gapDurationMs?: number };
}

/**
 * One live world frame as the adapter consumes it (the W915 wire document's
 * world-state subset — the frozen §5 `LiveRenderInput` semantics as
 * delivered: `worldState` + `eventsSincePreviousFrame` + the render clock).
 */
export interface LiveWorldFrameInput {
  /** The view-model's monotonically advancing world version. */
  worldVersion: number;
  /** The observation's event time (ms — authoritative). */
  eventTimeMs: number;
  /** The source's honest quality at this observation. */
  quality: "nominal" | "degraded";
  entities: readonly LiveWorldEntityInput[];
  eventsSincePreviousFrame: readonly LiveWorldEventInput[];
}

// ---------------------------------------------------------------------------
// The scene state (the identity-continuous VIEW carry)
// ---------------------------------------------------------------------------

/** One carried entity's scene placement (identity-continuous by entityRef). */
export interface LiveSceneEntity {
  entityRef: string;
  kind: "PLAYER" | "BALL" | "REFEREE" | "OTHER";
  teamRef?: string;
  /** The pitch-frame position, verbatim (meters — the canonical frame). */
  xMeters: number;
  yMeters: number;
  detected: boolean;
  confidence: number;
  staleForMs: number;
}

/** The live scene state (the carried view — NEVER world truth). */
export interface LiveSceneState {
  /** The newest applied world version (0 before the first frame). */
  worldVersion: number;
  /** The newest applied event time (ms). */
  eventTimeMs: number;
  /** The newest applied quality state. */
  quality: "nominal" | "degraded";
  /** The carried entities, keyed by canonical entityRef (insertion order). */
  entities: ReadonlyMap<string, LiveSceneEntity>;
}

/** The honest accounting of one applied frame. */
export interface LiveSceneApplyReport {
  worldVersion: number;
  /** Entities whose placement UPDATED this frame (detected rows). */
  updated: number;
  /** Entities carried as last-known this frame (undetected rows). */
  carried: number;
  /** Entities present in the frame but NEW to the carry (appeared). */
  appeared: number;
}

/** Creates the empty live scene state (before the first frame). */
export function createLiveSceneState(): LiveSceneState {
  return {
    worldVersion: 0,
    eventTimeMs: 0,
    quality: "nominal",
    entities: new Map(),
  };
}

/**
 * Applies ONE live world frame to the scene state — UPDATE CONTINUITY: the
 * carry is updated per-entity (keyed by the canonical entityRef), an
 * undetected entity keeps its LAST KNOWN position (marked, with the
 * staleness the wire carries), and NOTHING about the camera is touched
 * (this function has no camera input at all — the frozen camera rule as
 * code). Pure: returns a NEW state (the caller's state is never mutated).
 */
export function applyLiveFrame(
  state: LiveSceneState,
  frame: LiveWorldFrameInput,
): { state: LiveSceneState; report: LiveSceneApplyReport } {
  const entities = new Map(state.entities);
  let updated = 0;
  let carried = 0;
  let appeared = 0;
  for (const row of frame.entities) {
    const previous = entities.get(row.entityRef);
    if (row.detected) {
      updated += 1;
      if (previous === undefined) appeared += 1;
      entities.set(row.entityRef, {
        entityRef: row.entityRef,
        kind: row.kind,
        ...(row.teamRef !== undefined ? { teamRef: row.teamRef } : {}),
        xMeters: row.xMeters,
        yMeters: row.yMeters,
        detected: true,
        confidence: row.confidence,
        staleForMs: 0,
      });
    } else {
      // The honest carry: LAST KNOWN position, marked undetected with the
      // wire's staleness — never fabricated certainty, never a removal.
      carried += 1;
      const base: LiveSceneEntity = previous ?? {
        entityRef: row.entityRef,
        kind: row.kind,
        ...(row.teamRef !== undefined ? { teamRef: row.teamRef } : {}),
        xMeters: row.xMeters,
        yMeters: row.yMeters,
        detected: false,
        confidence: row.confidence,
        staleForMs: row.staleForMs,
      };
      entities.set(row.entityRef, {
        ...base,
        detected: false,
        confidence: row.confidence,
        staleForMs: row.staleForMs,
      });
    }
  }
  return {
    state: {
      worldVersion: frame.worldVersion,
      eventTimeMs: frame.eventTimeMs,
      quality: frame.quality,
      entities,
    },
    report: { worldVersion: frame.worldVersion, updated, carried, appeared },
  };
}

// ---------------------------------------------------------------------------
// The interactive camera (pure state + the SAME look-at basis math)
// ---------------------------------------------------------------------------

/** The orbit camera's documented bounds (the interactive envelope). */
export const LIVE_CAMERA_MIN_ELEVATION_DEG = 2;
export const LIVE_CAMERA_MAX_ELEVATION_DEG = 88;
export const LIVE_CAMERA_MIN_DISTANCE_M = 12;
export const LIVE_CAMERA_MAX_DISTANCE_M = 260;
/** The pan target's bound: the pitch + a 12 m apron (documented). */
export const LIVE_CAMERA_TARGET_APRON_M = 12;

/** The pitch extents (the canonical 105 × 68 m frame). */
export const LIVE_PITCH_X_METERS = 105;
export const LIVE_PITCH_Y_METERS = 68;

/**
 * The interactive camera state: an orbit around a pitch-plane target.
 * PURE DATA — the reducer is the only writer, world frames never touch it.
 */
export interface LiveCameraState {
  /** The azimuth around the target (degrees; 0 = the −y touchline side). */
  azimuthDeg: number;
  /** The elevation above the pitch plane (degrees, clamped 2..88). */
  elevationDeg: number;
  /** The orbit distance from the target (meters, clamped 12..260). */
  distanceM: number;
  /** The orbit target in the pitch plane (clamped to the pitch + apron). */
  target: { x: number; y: number };
}

/** The canonical initial camera: the main-touchline broadcast framing. */
export const LIVE_CAMERA_INITIAL: LiveCameraState = {
  azimuthDeg: 0,
  elevationDeg: 28,
  distanceM: 62,
  target: { x: LIVE_PITCH_X_METERS / 2, y: LIVE_PITCH_Y_METERS / 2 },
};

/** One interactive camera input (the user's intent, never world data). */
export type LiveCameraAction =
  | { kind: "orbit"; deltaAzimuthDeg: number; deltaElevationDeg: number }
  | { kind: "zoom"; factor: number }
  | { kind: "pan"; deltaX: number; deltaY: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The interactive camera reducer — PURE: one state + one user action → the
 * next state (documented bounds; a no-op action returns an equal state).
 * The pan axes follow the CAMERA's screen orientation: deltaX pans along
 * the camera's right vector projected to the pitch plane, deltaY along the
 * screen-up vector projected to the pitch plane (scaled by distance × 1%
 * per unit — a documented presentation constant), so panning feels the
 * same at every orbit angle.
 */
export function liveCameraReducer(
  state: LiveCameraState,
  action: LiveCameraAction,
): LiveCameraState {
  switch (action.kind) {
    case "orbit": {
      const nextAzimuth = state.azimuthDeg + action.deltaAzimuthDeg;
      return {
        ...state,
        // Wrap azimuth into (-180, 180] (full orbit allowed — a full turn
        // is a legitimate view, never clamped).
        azimuthDeg: ((((nextAzimuth + 180) % 360) + 360) % 360) - 180,
        elevationDeg: clamp(
          state.elevationDeg + action.deltaElevationDeg,
          LIVE_CAMERA_MIN_ELEVATION_DEG,
          LIVE_CAMERA_MAX_ELEVATION_DEG,
        ),
      };
    }
    case "zoom": {
      if (!(action.factor > 0)) return state; // a non-positive factor is a no-op
      return {
        ...state,
        distanceM: clamp(
          state.distanceM / action.factor,
          LIVE_CAMERA_MIN_DISTANCE_M,
          LIVE_CAMERA_MAX_DISTANCE_M,
        ),
      };
    }
    case "pan": {
      if (action.deltaX === 0 && action.deltaY === 0) return state;
      // The camera-relative pan basis on the pitch plane (z ignored).
      const radians = (state.azimuthDeg * Math.PI) / 180;
      const right = { x: Math.cos(radians), y: Math.sin(radians) };
      const forward = { x: Math.sin(radians), y: -Math.cos(radians) };
      const scale = state.distanceM * 0.01;
      const nextX = state.target.x + (right.x * action.deltaX - forward.x * action.deltaY) * scale;
      const nextY = state.target.y + (right.y * action.deltaX - forward.y * action.deltaY) * scale;
      return {
        ...state,
        target: {
          x: clamp(
            nextX,
            -LIVE_CAMERA_TARGET_APRON_M,
            LIVE_PITCH_X_METERS + LIVE_CAMERA_TARGET_APRON_M,
          ),
          y: clamp(
            nextY,
            -LIVE_CAMERA_TARGET_APRON_M,
            LIVE_PITCH_Y_METERS + LIVE_CAMERA_TARGET_APRON_M,
          ),
        },
      };
    }
  }
}

/**
 * Derives the camera's eye position from its orbit state (pure math):
 * `eye = target + distance · (sin(az)·cos(el), −cos(az)·cos(el), sin(el))`
 * — at azimuth 0 the eye sits beyond the −y touchline (the main-touchline
 * side), elevation lifting it above the plane.
 */
export function liveCameraEye(state: LiveCameraState): Vec3 {
  const az = (state.azimuthDeg * Math.PI) / 180;
  const el = (state.elevationDeg * Math.PI) / 180;
  const horizontal = Math.cos(el);
  return {
    x: state.target.x + state.distanceM * Math.sin(az) * horizontal,
    y: state.target.y - state.distanceM * Math.cos(az) * horizontal,
    z: state.distanceM * Math.sin(el),
  };
}

/**
 * Builds the camera FRAME of one live camera state — the SAME look-at
 * basis math as the canonical `cameraFromSlot` (forward = normalize(target
 * − eye); right = normalize(forward × WORLD_UP) with the documented
 * straight-down fallback; up = right × forward). The equivalence with the
 * canonical slot camera is pinned by test.
 */
export function liveCameraFrame(state: LiveCameraState): CameraFrame {
  const eye = liveCameraEye(state);
  const target: Vec3 = { x: state.target.x, y: state.target.y, z: 0 };
  const d = {
    x: target.x - eye.x,
    y: target.y - eye.y,
    z: target.z - eye.z,
  };
  const forward = normalize3(d);
  let right = cross3(forward, WORLD_UP);
  // The degeneracy check uses a documented epsilon: the live eye is
  // DERIVED from trig (unlike the canonical slots' exact constants), so a
  // straight-down orbit leaves ~1e-16 noise in the cross product where the
  // canonical exact-zero check would engage. The epsilon (1e-9) is six
  // orders below any meaningful right-vector magnitude and never masks a
  // real basis.
  if (Math.hypot(right.x, right.y, right.z) < 1e-9) {
    // Straight (anti)parallel-to-up view: the documented +y up-hint (the
    // same disambiguation as cameraFromSlot).
    right = normalize3(cross3(forward, { x: 0, y: 1, z: 0 }));
  } else {
    right = normalize3(right);
  }
  const up = cross3(right, forward);
  return { eye, right, up, forward };
}

// ---------------------------------------------------------------------------
// The projection (the renderer's own camera math, applied to the live scene)
// ---------------------------------------------------------------------------

/** The presentation figure heights (the game renderer's documented values). */
export const LIVE_FIGURE_HEIGHT_M = 1.82;
export const LIVE_BALL_RADIUS_M = 0.11;
export const LIVE_BALL_CENTER_HEIGHT_M = 0.11;

/** One projected live entity (a fully-specified drawable primitive). */
export interface ProjectedLiveEntity {
  entityRef: string;
  kind: "PLAYER" | "BALL" | "REFEREE" | "OTHER";
  teamRef?: string;
  /** The base point's screen position (undefined when behind the camera). */
  base: { x: number; y: number };
  /** The head point's screen position (figures only; the billboard's top). */
  head: { x: number; y: number };
  /** The camera depth of the base point (meters). */
  depthMeters: number;
  /** The figure's projected radius at the base (px, readability-floored). */
  radiusPx: number;
  detected: boolean;
  staleForMs: number;
  confidence: number;
  /** The scene-space position, verbatim (the carry's view data). */
  xMeters: number;
  yMeters: number;
}

/** One projected pitch line segment (undefined when fully behind camera). */
export interface ProjectedLiveSegment {
  a: { x: number; y: number };
  b: { x: number; y: number };
}

/** The projected pitch ground polygon (the drawable outline; possibly clipped). */
export interface ProjectedLivePolygon {
  points: { x: number; y: number }[];
}

/** The full projection of one live scene through one camera (pure). */
export interface ProjectedLiveScene {
  entities: ProjectedLiveEntity[];
  /** The pitch boundary polygon (clipped to the near plane). */
  pitch: ProjectedLivePolygon;
  /** The pitch line segments (clipped to the near plane). */
  lines: ProjectedLiveSegment[];
}

/** The canonical pitch line segments (meters — the IFAB Law 1 markings). */
export function livePitchLineSegments(): { a: Vec3; b: Vec3 }[] {
  const segments: { a: Vec3; b: Vec3 }[] = [];
  const z = 0;
  // The touchlines + goal lines (the boundary rides the polygon too).
  segments.push(
    { a: { x: 0, y: 0, z }, b: { x: 105, y: 0, z } },
    { a: { x: 105, y: 0, z }, b: { x: 105, y: 68, z } },
    { a: { x: 105, y: 68, z }, b: { x: 0, y: 68, z } },
    { a: { x: 0, y: 68, z }, b: { x: 0, y: 0, z } },
    // The halfway line.
    { a: { x: 52.5, y: 0, z }, b: { x: 52.5, y: 68, z } },
  );
  // The center circle (a 64-segment polyline — the documented constant).
  const circleSegments = 64;
  for (let index = 0; index < circleSegments; index += 1) {
    const angleA = (index / circleSegments) * Math.PI * 2;
    const angleB = ((index + 1) / circleSegments) * Math.PI * 2;
    segments.push({
      a: { x: 52.5 + 9.15 * Math.cos(angleA), y: 34 + 9.15 * Math.sin(angleA), z },
      b: { x: 52.5 + 9.15 * Math.cos(angleB), y: 34 + 9.15 * Math.sin(angleB), z },
    });
  }
  // The penalty areas + goal areas (both sides; three lines each).
  for (const side of [0, 1] as const) {
    const goalX = side === 0 ? 0 : 105;
    const dir = side === 0 ? 1 : -1; // into the pitch from the goal line
    const penaltyFrontX = goalX + dir * 16.5;
    const penaltyYMin = (68 - 40.32) / 2;
    const penaltyYMax = (68 + 40.32) / 2;
    segments.push(
      { a: { x: goalX, y: penaltyYMin, z }, b: { x: penaltyFrontX, y: penaltyYMin, z } },
      { a: { x: penaltyFrontX, y: penaltyYMin, z }, b: { x: penaltyFrontX, y: penaltyYMax, z } },
      { a: { x: penaltyFrontX, y: penaltyYMax, z }, b: { x: goalX, y: penaltyYMax, z } },
    );
    const goalAreaFrontX = goalX + dir * 5.5;
    const goalAreaYMin = (68 - 18.32) / 2;
    const goalAreaYMax = (68 + 18.32) / 2;
    segments.push(
      { a: { x: goalX, y: goalAreaYMin, z }, b: { x: goalAreaFrontX, y: goalAreaYMin, z } },
      {
        a: { x: goalAreaFrontX, y: goalAreaYMin, z },
        b: { x: goalAreaFrontX, y: goalAreaYMax, z },
      },
      { a: { x: goalAreaFrontX, y: goalAreaYMax, z }, b: { x: goalX, y: goalAreaYMax, z } },
    );
    // The penalty spot (a small 8-segment circle at 11 m).
    const spotX = goalX + dir * 11;
    for (let index = 0; index < 8; index += 1) {
      const angleA = (index / 8) * Math.PI * 2;
      const angleB = ((index + 1) / 8) * Math.PI * 2;
      segments.push({
        a: { x: spotX + 0.25 * Math.cos(angleA), y: 34 + 0.25 * Math.sin(angleA), z },
        b: { x: spotX + 0.25 * Math.cos(angleB), y: 34 + 0.25 * Math.sin(angleB), z },
      });
    }
  }
  return segments;
}

/** The near-plane segment clip (the camera module's own parametric rule). */
function clipSegment(a: CameraPoint, b: CameraPoint): [CameraPoint, CameraPoint] | null {
  const za = a.z;
  const zb = b.z;
  if (za < NEAR_PLANE_METERS && zb < NEAR_PLANE_METERS) return null;
  if (za >= NEAR_PLANE_METERS && zb >= NEAR_PLANE_METERS) return [a, b];
  const t = (NEAR_PLANE_METERS - za) / (zb - za);
  const clipped = {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
    z: NEAR_PLANE_METERS,
  };
  return za < NEAR_PLANE_METERS ? [clipped, b] : [a, clipped];
}

/** Projects one camera-space point, dropping it when behind the near plane. */
function projectDropped(
  point: CameraPoint,
  canvas: { width: number; height: number },
): { x: number; y: number; depth: number } | undefined {
  return projectCameraPoint(point, canvas);
}

/**
 * Projects ONE live scene through one camera state onto one canvas — the
 * deterministic 3D projection (the renderer's own camera math). Painter's
 * order is the CALLER's concern; this returns entities in carry order with
 * their depths (the component sorts by depth descending).
 */
export function projectLiveScene(
  scene: LiveSceneState,
  camera: LiveCameraState,
  canvas: { width: number; height: number },
): ProjectedLiveScene {
  const frame = liveCameraFrame(camera);
  // The pitch ground polygon (clipped against the near plane).
  const boundary: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 105, y: 0, z: 0 },
    { x: 105, y: 68, z: 0 },
    { x: 0, y: 68, z: 0 },
  ];
  const cameraBoundary = boundary.map((point) => toCameraSpace(frame, point));
  const clipped = clipPolygonLive(cameraBoundary);
  const pitch: ProjectedLivePolygon = {
    points: clipped
      .map((point) => projectDropped(point, canvas))
      .filter((point): point is { x: number; y: number; depth: number } => point !== undefined)
      .map((point) => ({ x: point.x, y: point.y })),
  };
  // The pitch lines (each clipped; fully-behind segments dropped).
  const lines: ProjectedLiveSegment[] = [];
  for (const segment of livePitchLineSegments()) {
    const cameraA = toCameraSpace(frame, segment.a);
    const cameraB = toCameraSpace(frame, segment.b);
    const clippedSegment = clipSegment(cameraA, cameraB);
    if (clippedSegment === null) continue;
    const a = projectDropped(clippedSegment[0], canvas);
    const b = projectDropped(clippedSegment[1], canvas);
    if (a === undefined || b === undefined) continue;
    lines.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
  }
  // The entities (billboards: base + head + radius at the base).
  const entities: ProjectedLiveEntity[] = [];
  for (const entity of scene.entities.values()) {
    const isBall = entity.kind === "BALL";
    const baseHeight = isBall ? LIVE_BALL_CENTER_HEIGHT_M : 0;
    const topHeight = isBall
      ? LIVE_BALL_CENTER_HEIGHT_M + LIVE_BALL_RADIUS_M
      : LIVE_FIGURE_HEIGHT_M;
    const cameraBase = toCameraSpace(frame, {
      x: entity.xMeters,
      y: entity.yMeters,
      z: baseHeight,
    });
    const cameraHead = toCameraSpace(frame, {
      x: entity.xMeters,
      y: entity.yMeters,
      z: topHeight,
    });
    if (cameraBase.z < NEAR_PLANE_METERS) continue; // omitted-behind-camera
    const base = projectCameraPoint(cameraBase, canvas);
    const head = projectCameraPoint(cameraHead, canvas);
    if (base === undefined) continue;
    const radiusMeters = isBall ? LIVE_BALL_RADIUS_M : 0.31; // shoulder half-width
    entities.push({
      entityRef: entity.entityRef,
      kind: entity.kind,
      ...(entity.teamRef !== undefined ? { teamRef: entity.teamRef } : {}),
      base: { x: base.x, y: base.y },
      head: head === undefined ? { x: base.x, y: base.y } : { x: head.x, y: head.y },
      depthMeters: base.depth,
      radiusPx: projectedRadius(radiusMeters, base.depth),
      detected: entity.detected,
      staleForMs: entity.staleForMs,
      confidence: entity.confidence,
      xMeters: entity.xMeters,
      yMeters: entity.yMeters,
    });
  }
  return { entities, pitch, lines };
}

/** Sutherland–Hodgman against the single near plane (the camera rule). */
function clipPolygonLive(points: readonly CameraPoint[]): CameraPoint[] {
  const output: CameraPoint[] = [];
  const count = points.length;
  for (let index = 0; index < count; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % count]!;
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
