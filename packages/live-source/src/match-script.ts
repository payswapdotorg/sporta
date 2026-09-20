/**
 * THE DETERMINISTIC MATCH SCRIPT (L002) — the synthetic match truth the
 * source OBSERVES (never world truth itself: the script produces ENTITY
 * OBSERVATIONS only; the canonical SWM stays the single world truth and is
 * built downstream by the L003 updater from these observations).
 *
 * DESIGN (the purity constitution):
 *
 * - every entity trajectory is a PURE function of (seed, entityIndex,
 *   matchTimeSeconds) — smooth parametric paths (offset ellipses), so
 *   positions AND their analytic velocities are exact and repeatable;
 * - per-tick visibility/confidence draws come from per-entity sub-streams
 *   (stable seed derivation — never cross-entity call-order dependence);
 * - the pitch frame is the Sporta canonical football frame (105 x 68 m,
 *   corner origin, x = touchline, y = goal-line — the frozen
 *   `@sporta/contracts` PitchFrame constants); positions are clamped
 *   inside the frame with a small margin (a tracking source never reports
 *   a player at x = -3 — but a source CAN lose an entity: that is the
 *   `detected: false` path, not an out-of-frame position);
 * - MISSING DATA IS HONEST: when the visibility draw loses an entity, the
 *   script reports `detected: false` with the LAST KNOWN position, a LOW
 *   confidence and NO velocity — never fabricated certainty (the frozen
 *   temporal rules).
 *
 * PURITY: no clock, no env, no I/O, no unseeded randomness.
 */
import { PITCH_LENGTH_AXIS_METERS, PITCH_WIDTH_AXIS_METERS } from "@sporta/contracts";
import type { LiveEntityObservation } from "./observation";
import { createSeededRandom, substreamSeed } from "./prng";

/** The margin from the touchlines every scripted position respects (m). */
const FRAME_MARGIN_METERS = 1.5;

/** One scripted entity's static identity (derived once from the seed). */
interface ScriptedEntity {
  entityRef: string;
  kind: "PLAYER" | "BALL" | "REFEREE";
  teamRef: "team-home" | "team-away" | undefined;
  sourceLocalTrackId: string;
  /** The parametric path coefficients (deterministic per entity). */
  path: {
    cx: number;
    cy: number;
    ax: number;
    ay: number;
    /** Angular frequencies (rad/s). */
    wx: number;
    wy: number;
    /** Phase offsets (rad). */
    px: number;
    py: number;
    /** The vertical bounce amplitude (m; 0 = ground entity). */
    az: number;
    wz: number;
    pz: number;
  };
  /** The per-entity visibility stream seed (independent sub-stream). */
  visibilitySeed: number;
  /** The per-entity confidence stream seed. */
  confidenceSeed: number;
}

/** The script's configuration (all DATA — validated by the source config). */
export interface MatchScriptConfig {
  /** The deterministic replay key (same seed → same script). */
  seed: number;
  /** Players per team (default 11; tests may shrink). */
  playersPerTeam: number;
  /** Referees (default 1). */
  referees: number;
}

/**
 * Builds the scripted entity roster: home players, away players, referees,
 * one ball. Ids are stable per seed: `p-home-01`…, `p-away-01`…, `ref-1`…,
 * `ball-1` (all within the frozen EntityId pattern).
 */
export function buildScriptedRoster(config: MatchScriptConfig): ScriptedEntity[] {
  const roster: ScriptedEntity[] = [];
  const seed = config.seed >>> 0;

  const addEntity = (entity: ScriptedEntity): void => {
    roster.push(entity);
  };

  // -- home players: patrol bands across x ∈ [margin, halfway + 10] ------
  for (let i = 0; i < config.playersPerTeam; i += 1) {
    const index = roster.length;
    const random = createSeededRandom(substreamSeed(seed, 10_000 + index));
    const lane = config.playersPerTeam <= 1 ? 0 : i / (config.playersPerTeam - 1);
    addEntity({
      entityRef: `p-home-${String(i + 1).padStart(2, "0")}`,
      kind: "PLAYER",
      teamRef: "team-home",
      sourceLocalTrackId: `h${i + 1}`,
      path: {
        cx: 8 + lane * 40,
        cy: PITCH_WIDTH_AXIS_METERS * (0.18 + 0.64 * lane) + (i % 2 === 0 ? 4 : -4),
        ax: random.nextFloatBetween(4, 12),
        ay: random.nextFloatBetween(3, 9),
        wx: random.nextFloatBetween(0.06, 0.16) * 2 * Math.PI,
        wy: random.nextFloatBetween(0.08, 0.2) * 2 * Math.PI,
        px: random.nextFloatBetween(0, 2 * Math.PI),
        py: random.nextFloatBetween(0, 2 * Math.PI),
        az: 0,
        wz: 0,
        pz: 0,
      },
      visibilitySeed: substreamSeed(seed, 20_000 + index),
      confidenceSeed: substreamSeed(seed, 30_000 + index),
    });
  }

  // -- away players: mirrored bands across x ∈ [halfway - 10, 105-margin] -
  for (let i = 0; i < config.playersPerTeam; i += 1) {
    const index = roster.length;
    const random = createSeededRandom(substreamSeed(seed, 10_000 + index));
    const lane = config.playersPerTeam <= 1 ? 0 : i / (config.playersPerTeam - 1);
    addEntity({
      entityRef: `p-away-${String(i + 1).padStart(2, "0")}`,
      kind: "PLAYER",
      teamRef: "team-away",
      sourceLocalTrackId: `a${i + 1}`,
      path: {
        cx: PITCH_LENGTH_AXIS_METERS - 8 - lane * 40,
        cy: PITCH_WIDTH_AXIS_METERS * (0.82 - 0.64 * lane) + (i % 2 === 0 ? -4 : 4),
        ax: random.nextFloatBetween(4, 12),
        ay: random.nextFloatBetween(3, 9),
        wx: random.nextFloatBetween(0.06, 0.16) * 2 * Math.PI,
        wy: random.nextFloatBetween(0.08, 0.2) * 2 * Math.PI,
        px: random.nextFloatBetween(0, 2 * Math.PI),
        py: random.nextFloatBetween(0, 2 * Math.PI),
        az: 0,
        wz: 0,
        pz: 0,
      },
      visibilitySeed: substreamSeed(seed, 20_000 + index),
      confidenceSeed: substreamSeed(seed, 30_000 + index),
    });
  }

  // -- referees: central patrol -------------------------------------------
  for (let i = 0; i < config.referees; i += 1) {
    const index = roster.length;
    const random = createSeededRandom(substreamSeed(seed, 10_000 + index));
    addEntity({
      entityRef: `ref-${i + 1}`,
      kind: "REFEREE",
      teamRef: undefined,
      sourceLocalTrackId: `r${i + 1}`,
      path: {
        cx: PITCH_LENGTH_AXIS_METERS / 2,
        cy: PITCH_WIDTH_AXIS_METERS / 2,
        ax: random.nextFloatBetween(10, 20),
        ay: random.nextFloatBetween(4, 8),
        wx: random.nextFloatBetween(0.04, 0.1) * 2 * Math.PI,
        wy: random.nextFloatBetween(0.05, 0.12) * 2 * Math.PI,
        px: random.nextFloatBetween(0, 2 * Math.PI),
        py: random.nextFloatBetween(0, 2 * Math.PI),
        az: 0,
        wz: 0,
        pz: 0,
      },
      visibilitySeed: substreamSeed(seed, 20_000 + index),
      confidenceSeed: substreamSeed(seed, 30_000 + index),
    });
  }

  // -- the ball: the widest, fastest path with a small bounce -------------
  const ballRandom = createSeededRandom(substreamSeed(seed, 9_999));
  addEntity({
    entityRef: "ball-1",
    kind: "BALL",
    teamRef: undefined,
    sourceLocalTrackId: "b1",
    path: {
      cx: PITCH_LENGTH_AXIS_METERS / 2,
      cy: PITCH_WIDTH_AXIS_METERS / 2,
      ax: 44,
      ay: 26,
      wx: ballRandom.nextFloatBetween(0.1, 0.18) * 2 * Math.PI,
      wy: ballRandom.nextFloatBetween(0.2, 0.3) * 2 * Math.PI,
      px: ballRandom.nextFloatBetween(0, 2 * Math.PI),
      py: ballRandom.nextFloatBetween(0, 2 * Math.PI),
      az: 1.2,
      wz: 0.35 * 2 * Math.PI,
      pz: ballRandom.nextFloatBetween(0, 2 * Math.PI),
    },
    visibilitySeed: substreamSeed(seed, 29_999),
    confidenceSeed: substreamSeed(seed, 39_999),
  });

  return roster;
}

/** The exact position of one scripted entity at one match time. */
function positionOf(
  entity: ScriptedEntity,
  tSeconds: number,
): { x: number; y: number; z: number; vx: number; vy: number; vz: number } {
  const p = entity.path;
  const x = p.cx + p.ax * Math.sin(p.wx * tSeconds + p.px);
  const y = p.cy + p.ay * Math.sin(p.wy * tSeconds + p.py);
  const z = p.az > 0 ? Math.max(0, p.az * Math.sin(p.wz * tSeconds + p.pz)) : 0;
  const vx = p.ax * p.wx * Math.cos(p.wx * tSeconds + p.px);
  const vy = p.ay * p.wy * Math.cos(p.wy * tSeconds + p.py);
  const vz = p.az > 0 ? p.az * p.wz * Math.cos(p.wz * tSeconds + p.pz) : 0;
  const clampX = Math.min(
    PITCH_LENGTH_AXIS_METERS - FRAME_MARGIN_METERS,
    Math.max(FRAME_MARGIN_METERS, x),
  );
  const clampY = Math.min(
    PITCH_WIDTH_AXIS_METERS - FRAME_MARGIN_METERS,
    Math.max(FRAME_MARGIN_METERS, y),
  );
  // Clamping distorts the analytic velocity at the frame edge — report the
  // clamped position with the analytic velocity only when they agree (the
  // honest approach: a clamped position has an unknown true velocity).
  const clampedX = clampX !== x;
  const clampedY = clampY !== y;
  return {
    x: clampX,
    y: clampY,
    z,
    vx: clampedX || clampedY ? 0 : vx,
    vy: clampedX || clampedY ? 0 : vy,
    vz,
  };
}

/** The probability an entity is visible at a given tick (per kind). */
function visibilityProbabilityOf(entity: ScriptedEntity): number {
  if (entity.kind === "BALL") return 0.985;
  if (entity.kind === "REFEREE") return 0.96;
  return 0.965;
}

/** The confidence band for a DETECTED observation (per kind). */
function detectedConfidenceBand(entity: ScriptedEntity): { min: number; max: number } {
  if (entity.kind === "BALL") return { min: 0.82, max: 0.97 };
  return { min: 0.74, max: 0.95 };
}

/** The confidence band for an UNDETECTED (carried) observation — low, honest. */
const UNDETECTED_CONFIDENCE_BAND = { min: 0.12, max: 0.28 } as const;

/** The per-tick draw count for one entity's streams (stable call order). */
const DRAWS_PER_TICK = 3;

/**
 * Observes the whole roster at one tick: one {@link LiveEntityObservation}
 * per scripted entity (detected or honestly carried), event time in ms.
 *
 * `degraded` (the reconnect recovery window) lowers the confidence band
 * multiplicatively and marks the batch quality at the SOURCE level; the
 * per-entity honesty here stays the same shape (detected → real position,
 * undetected → carried + low confidence).
 */
export function observeRosterAtTick(input: {
  roster: readonly ScriptedEntity[];
  tick: number;
  eventTimeMs: number;
  degraded: boolean;
  lastKnown: Map<string, LiveEntityObservation>;
}): LiveEntityObservation[] {
  const tSeconds = input.eventTimeMs / 1000;
  const observations: LiveEntityObservation[] = [];
  for (const entity of input.roster) {
    // The visibility + confidence draws for (entity, tick): a STABLE
    // per-(entity, tick) sub-draw — deterministic regardless of roster
    // iteration order, so adding entities never shifts earlier draws.
    const visibilityRandom = createSeededRandom(
      substreamSeed(entity.visibilitySeed, input.tick * DRAWS_PER_TICK),
    );
    const confidenceRandom = createSeededRandom(
      substreamSeed(entity.confidenceSeed, input.tick * DRAWS_PER_TICK),
    );
    const visibleDraw = visibilityRandom.nextFloat();
    const detected = visibleDraw < visibilityProbabilityOf(entity);
    const position = positionOf(entity, tSeconds);
    const degradedFactor = input.degraded ? 0.65 : 1;
    if (detected) {
      const band = detectedConfidenceBand(entity);
      const confidence =
        Math.round(confidenceRandom.nextFloatBetween(band.min, band.max) * degradedFactor * 1000) /
        1000;
      observations.push({
        entityRef: entity.entityRef,
        kind: entity.kind,
        ...(entity.teamRef !== undefined ? { teamRef: entity.teamRef } : {}),
        position: {
          xMeters: round3(position.x),
          yMeters: round3(position.y),
          ...(entity.path.az > 0 && position.z > 0.05 ? { zMeters: round3(position.z) } : {}),
        },
        velocity: {
          vxMps: round3(position.vx),
          vyMps: round3(position.vy),
          ...(entity.path.az > 0 && position.z > 0.05 ? { vzMps: round3(position.vz) } : {}),
        },
        detected: true,
        sourceLocalTrackId: entity.sourceLocalTrackId,
        confidence: Math.min(1, Math.max(0, confidence)),
        observedAtMs: input.eventTimeMs,
      });
      continue;
    }
    // The honest miss: carry the last known position (or the entity's
    // scripted rest position when this is the very first tick), LOW
    // confidence, NO velocity. Never fabricated certainty.
    const lastKnown = input.lastKnown.get(entity.entityRef);
    const band = UNDETECTED_CONFIDENCE_BAND;
    const confidence =
      Math.round(confidenceRandom.nextFloatBetween(band.min, band.max) * 1000) / 1000;
    const carried: LiveEntityObservation = {
      entityRef: entity.entityRef,
      kind: entity.kind,
      ...(entity.teamRef !== undefined ? { teamRef: entity.teamRef } : {}),
      position: lastKnown?.position ?? { xMeters: round3(position.x), yMeters: round3(position.y) },
      detected: false,
      sourceLocalTrackId: entity.sourceLocalTrackId,
      confidence,
      observedAtMs: input.eventTimeMs,
    };
    observations.push(carried);
  }
  return observations;
}

/** Rounds to 3 decimals (millimeter precision — stable JSON byte output). */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** The batch confidence: the mean of the per-entity confidences (honest). */
export function batchConfidenceOf(observations: readonly LiveEntityObservation[]): number {
  if (observations.length === 0) return 0;
  const sum = observations.reduce((acc, observation) => acc + observation.confidence, 0);
  return Math.round((sum / observations.length) * 1000) / 1000;
}

export type { ScriptedEntity };
