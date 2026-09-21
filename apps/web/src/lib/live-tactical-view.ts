/**
 * THE LIVE TACTICAL VIEW PROJECTION (L005 full) — the PURE view-model the
 * browser tactical renderer draws from: one `LiveWorldFrameDoc` (the W915
 * wire frame — the frozen live-reality.md §5 `LiveRenderInput` semantics as
 * delivered) becomes one fully-specified set of DRAWABLE PRIMITIVES
 * (markers with screen positions, colors, identity labels, honest
 * hollow/detected state), plus the pitch geometry and the honest staleness
 * verdicts.
 *
 * WHY A PURE MODULE (the L005 test posture): the browser canvas component
 * becomes a thin renderer of these primitives, so the projection itself is
 * exactly assertable from FIXTURE world frames — the deterministic
 * view-model battery the work item requires (exact screen coordinates,
 * identity-continuous labels, honest carries), with no canvas and no
 * browser in the test path.
 *
 * HONESTY RULES ENCODED HERE (never violated by the component):
 *
 * - IDENTITY CONTINUITY IS VISIBLE: every marker carries a STABLE short
 *   label derived purely from its canonical `entityRef` (the same entity
 *   keeps the same label on every frame — `p-home-07` → `H07`), so a
 *   viewer can TRACK an entity across frames by eye, not just by position.
 * - A TRACKING MISS IS DATA: an undetected entity keeps its LAST KNOWN
 *   screen position, drawn HOLLOW with its staleness label — never
 *   fabricated certainty, never a silent removal.
 * - THE TEAM SPLIT FOLLOWS THE FROZEN L002 VOCABULARY (`team-home` /
 *   `team-away`) — an unknown team ref falls back to the neutral color,
 *   never a wrong split (the Wave 1 fix-forward's rule).
 * - A FROZEN PICTURE IS NOT LIVE: {@link liveStaleness} derives the honest
 *   presentation verdict from the RECEIPT clock — when no world frame has
 *   arrived within the tolerance window the view must SAY SO (the stalled
 *   state), never keep rendering the last frame as if it were current.
 *
 * PURITY: no clock reads (all timestamps are arguments), no env, no I/O.
 */

/** The canonical pitch frame (meters — the sporta-canonical coordinate contract). */
export const PITCH_X_METERS = 105;
export const PITCH_Y_METERS = 68;

/** The center-circle radius (meters, IFAB Law 1). */
export const CENTER_CIRCLE_RADIUS_METERS = 9.15;

/** The penalty-area depth and width (meters, IFAB Law 1). */
export const PENALTY_AREA_DEPTH_METERS = 16.5;
export const PENALTY_AREA_WIDTH_METERS = 40.32;

/** The goal-area depth and width (meters, IFAB Law 1). */
export const GOAL_AREA_DEPTH_METERS = 5.5;
export const GOAL_AREA_WIDTH_METERS = 18.32;

/** The penalty-spot distance from the goal line (meters, IFAB Law 1). */
export const PENALTY_SPOT_METERS = 11;

/** The closed team vocabulary the L002 frozen contract emits. */
export type TacticalTeamRef = "team-home" | "team-away";

/** The marker palette (identity-stable, never a data value). */
export const TACTICAL_TEAM_COLORS: Record<TacticalTeamRef, string> = {
  "team-home": "#e879b9",
  "team-away": "#34d399",
};

/** The referee marker color (the fixed official style). */
export const TACTICAL_REFEREE_COLOR = "#fbbf24";

/** The neutral marker color (unknown team / OTHER kinds). */
export const TACTICAL_NEUTRAL_COLOR = "#94a3b8";

/** The ball marker color (the fixed ball style). */
export const TACTICAL_BALL_COLOR = "#f8fafc";

/** The pitch surface + line colors (the presentation constants). */
export const TACTICAL_PITCH_SURFACE = "#0f172a";
export const TACTICAL_PITCH_LINES = "rgba(148, 163, 184, 0.9)";

/** The exact teamRef vocabulary check (the frozen L002 contract's split). */
export function teamRefOf(teamRef: string | undefined): TacticalTeamRef | null {
  if (teamRef === "team-home") return "team-home";
  if (teamRef === "team-away") return "team-away";
  return null;
}

/**
 * The STABLE identity label of one entity — a PURE function of the
 * canonical `entityRef` (the same entity keeps the same label on every
 * frame; identity continuity made visible):
 *
 * - `p-home-07` → `H07` (home players);
 * - `p-away-11` → `A11` (away players);
 * - `ref-1` → `R1` (referees);
 * - `ball-1` → `●` (the ball);
 * - anything else → the last dash segment verbatim (never invented).
 */
export function entityMarkerLabel(entityRef: string): string {
  if (entityRef === "ball-1") return "●";
  const match = /^p-(home|away)-(\d{1,2})$/.exec(entityRef);
  if (match !== null) return `${match[1] === "home" ? "H" : "A"}${match[2]}`;
  const referee = /^ref-(\d+)$/.exec(entityRef);
  if (referee !== null) return `R${referee[1]}`;
  const lastDash = entityRef.lastIndexOf("-");
  return lastDash === -1 ? entityRef : entityRef.slice(lastDash + 1);
}

/** One entity's honest marker color (team / referee / ball / neutral). */
export function entityMarkerColor(entity: {
  kind: "PLAYER" | "BALL" | "REFEREE" | "OTHER";
  teamRef?: string;
}): string {
  if (entity.kind === "BALL") return TACTICAL_BALL_COLOR;
  const team = teamRefOf(entity.teamRef);
  if (team !== null) return TACTICAL_TEAM_COLORS[team];
  if (entity.kind === "REFEREE") return TACTICAL_REFEREE_COLOR;
  return TACTICAL_NEUTRAL_COLOR;
}

/** One projected entity marker (a fully-specified drawable primitive). */
export interface TacticalMarker {
  /** The canonical entity id (identity-continuous across frames). */
  entityRef: string;
  /** The STABLE identity label (see {@link entityMarkerLabel}). */
  label: string;
  kind: "PLAYER" | "BALL" | "REFEREE" | "OTHER";
  teamRef?: string;
  /** The marker's center in CANVAS pixels. */
  x: number;
  y: number;
  /** The marker's radius in CANVAS pixels (kind-scaled, canvas-scaled). */
  radius: number;
  /** The marker's fill/stroke color (identity-stable). */
  color: string;
  /** Whether the source DETECTED the entity at this frame's event time. */
  detected: boolean;
  /** The entity's pitch-frame position, verbatim (meters). */
  xMeters: number;
  yMeters: number;
  /** ms since the entity's last DETECTED observation (0 when detected). */
  staleForMs: number;
  /** The entity's confidence, verbatim. */
  confidence: number;
}

/** The canonical pitch markings, projected to canvas pixels. */
export interface TacticalPitchGeometry {
  /** The outer touchline/goal-line rectangle. */
  boundary: { x: number; y: number; w: number; h: number };
  /** The halfway line (x at the pitch center, full height). */
  halfwayLine: { x1: number; y1: number; x2: number; y2: number };
  /** The center circle. */
  centerCircle: { cx: number; cy: number; r: number };
  /** The two penalty areas (index 0 = the x=0 goal, 1 = the x=105 goal). */
  penaltyAreas: { x: number; y: number; w: number; h: number }[];
  /** The two goal areas (same ordering). */
  goalAreas: { x: number; y: number; w: number; h: number }[];
  /** The two penalty spots (same ordering). */
  penaltySpots: { cx: number; cy: number }[];
}

/** The full projection of one world frame (the component's whole input). */
export interface TacticalFrameProjection {
  markers: TacticalMarker[];
  pitch: TacticalPitchGeometry;
}

/** Meters → canvas pixels on the touchline axis. */
function mx(xMeters: number, width: number): number {
  return (xMeters / PITCH_X_METERS) * width;
}

/** Meters → canvas pixels on the goal-line axis. */
function my(yMeters: number, height: number): number {
  return (yMeters / PITCH_Y_METERS) * height;
}

/**
 * The canonical pitch markings in canvas pixels (105 × 68 m → the canvas
 * rectangle). Pure: the same canvas size always yields the same geometry.
 */
export function projectPitchGeometry(canvas: {
  width: number;
  height: number;
}): TacticalPitchGeometry {
  const { width, height } = canvas;
  return {
    boundary: { x: 0, y: 0, w: mx(PITCH_X_METERS, width), h: my(PITCH_Y_METERS, height) },
    halfwayLine: {
      x1: mx(PITCH_X_METERS / 2, width),
      y1: 0,
      x2: mx(PITCH_X_METERS / 2, width),
      y2: my(PITCH_Y_METERS, height),
    },
    centerCircle: {
      cx: mx(PITCH_X_METERS / 2, width),
      cy: my(PITCH_Y_METERS / 2, height),
      r: mx(CENTER_CIRCLE_RADIUS_METERS, width),
    },
    penaltyAreas: [0, 1].map((side) => ({
      x: mx(side === 0 ? 0 : PITCH_X_METERS - PENALTY_AREA_DEPTH_METERS, width),
      y: my((PITCH_Y_METERS - PENALTY_AREA_WIDTH_METERS) / 2, height),
      w: mx(PENALTY_AREA_DEPTH_METERS, width),
      h: my(PENALTY_AREA_WIDTH_METERS, height),
    })),
    goalAreas: [0, 1].map((side) => ({
      x: mx(side === 0 ? 0 : PITCH_X_METERS - GOAL_AREA_DEPTH_METERS, width),
      y: my((PITCH_Y_METERS - GOAL_AREA_WIDTH_METERS) / 2, height),
      w: mx(GOAL_AREA_DEPTH_METERS, width),
      h: my(GOAL_AREA_WIDTH_METERS, height),
    })),
    penaltySpots: [0, 1].map((side) => ({
      cx: mx(side === 0 ? PENALTY_SPOT_METERS : PITCH_X_METERS - PENALTY_SPOT_METERS, width),
      cy: my(PITCH_Y_METERS / 2, height),
    })),
  };
}

/** The entity shape the projection consumes (the wire frame's own fields). */
export interface TacticalFrameEntity {
  entityRef: string;
  kind: "PLAYER" | "BALL" | "REFEREE" | "OTHER";
  teamRef?: string;
  xMeters: number;
  yMeters: number;
  detected: boolean;
  confidence: number;
  staleForMs: number;
}

/**
 * Projects ONE world frame's entities into drawable markers — the pure
 * core of the L005 view (identity-continuous, honest carries, the frozen
 * team split). The marker radius is a documented presentation constant:
 * players scale with the canvas (`width / 64`, floored at 4 px), the ball
 * at 55% of that (floored at 2.5 px).
 */
export function projectTacticalFrame(
  entities: readonly TacticalFrameEntity[],
  canvas: { width: number; height: number },
): Pick<TacticalFrameProjection, "markers"> {
  const playerRadius = Math.max(4, canvas.width / 64);
  const ballRadius = Math.max(2.5, playerRadius * 0.55);
  return {
    markers: entities.map((entity) => ({
      entityRef: entity.entityRef,
      label: entityMarkerLabel(entity.entityRef),
      kind: entity.kind,
      ...(entity.teamRef !== undefined ? { teamRef: entity.teamRef } : {}),
      x: mx(entity.xMeters, canvas.width),
      y: my(entity.yMeters, canvas.height),
      radius: entity.kind === "BALL" ? ballRadius : playerRadius,
      color: entityMarkerColor(entity),
      detected: entity.detected,
      xMeters: entity.xMeters,
      yMeters: entity.yMeters,
      staleForMs: entity.staleForMs,
      confidence: entity.confidence,
    })),
  };
}

/** The honest presentation staleness verdict (never a frozen live picture). */
export type LiveStalenessState =
  | { state: "awaiting-first-frame" }
  | { state: "current" }
  | {
      state: "stalled";
      /** ms since the last RECEIPT (the receipt clock, not event time). */
      stalledForMs: number;
      /** The world version of the last received frame (labeled). */
      lastWorldVersion: number;
    };

/**
 * The honest staleness verdict: `current` while world frames keep arriving
 * within the tolerance window; `stalled` (with the counted gap) once none
 * has — the view must SHOW the stall, never keep presenting the last frame
 * as if it were live. Pure: the receipt clock is an argument.
 *
 * The tolerance is `2.5 × cadenceMs` (the documented bound — one dropped
 * tick plus transport headroom; the SSE keepalive interval is 15 s, far
 * above any honest cadence, so the watchdog fires LONG before the
 * transport's own silence signal).
 */
export function liveStaleness(input: {
  lastFrameReceivedAtMs: number | null;
  lastWorldVersion: number | null;
  nowMs: number;
  cadenceMs: number;
}): LiveStalenessState {
  if (input.lastFrameReceivedAtMs === null || input.lastWorldVersion === null) {
    return { state: "awaiting-first-frame" };
  }
  const stalledForMs = input.nowMs - input.lastFrameReceivedAtMs;
  const toleranceMs = 2.5 * input.cadenceMs;
  if (stalledForMs <= toleranceMs) return { state: "current" };
  return { state: "stalled", stalledForMs, lastWorldVersion: input.lastWorldVersion };
}

/** One honest frame event for the live event ticker (the wire's own kinds). */
export interface TacticalFrameEvent {
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

/** The human phrase of one honest frame event (a fixed table, never prose). */
export function frameEventPhrase(event: TacticalFrameEvent): string {
  const who = event.detail?.entityRef !== undefined ? ` ${event.detail.entityRef}` : "";
  switch (event.type) {
    case "source-recovery":
      return `source reconnect — ${event.detail?.missedUpdates ?? "?"} updates missed (${Math.round((event.detail?.gapDurationMs ?? 0) / 100) / 10}s gap, accounted)`;
    case "quality-degraded":
      return "source quality degraded (honest state, shown)";
    case "quality-nominal":
      return "source quality back to nominal";
    case "entity-appeared":
      return `entity appeared${who}`;
    case "entity-lost":
      return `entity lost from the batch${who} (carried last-known)`;
    case "entity-regained":
      return `entity regained${who}`;
  }
}
