/**
 * The Sports World Simulator v0 for the football pack (REL-002), per
 * docs/architecture/reality-engineering-lab.md §4.
 *
 * What is modeled here (all deterministic from (seed, configuration)):
 * - match clock (two periods, half-time kickoff swap);
 * - players + ball state (formation resets, waypoint patrol, chase logic,
 *   dribble/pass/shot progression, projectile flight with gravity);
 * - spatial geometry (105m x 68m pitch frame, goal mouths 7.32m, bounds,
 *   distance/step math);
 * - event progression (kickoff, pass, shot, goal, save, throw-in,
 *   goal-kick, recovery — published to organizations only as DELAYED
 *   event-record observations);
 * - confidence + missingness (per-source profiles; occlusion marks tracking
 *   samples missing and broadcast boxes null);
 * - source timing (per-source availability latency, per-profile);
 * - dropped frames (per-profile drop rate, boostable by fault injection);
 * - compute/provider failures, source disagreement, occlusion and
 *   processing latency — injected by replaying a REL-003 `FaultSchedule`.
 *
 * THE LAW: the same (scenario, faultSchedule) always produces the same tick
 * stream — every stochastic decision flows from a fork of the scenario
 * seed, never `Math.random`/`Date.now`. And every world state, event and
 * observation this module produces carries
 * `provenanceClass: "lab-simulation"` — lab world state is NEVER
 * production truth.
 *
 * v0 honesty: 7-a-side default, flat 2D broadcast boxes, a single main
 * camera, ground-ish ball physics. The contract shape (tick stream,
 * ground truth vs observations vs events separation, fault hooks) is the
 * delivery; the physics is deliberately simple and says so.
 */
import { LAB_SIMULATION_PROVENANCE } from "../provenance";
import { LabRng } from "../rng";
import type { FaultKind } from "../domain/domain-pack";
import type { FaultSchedule } from "../robustness/faults";
import { activeFaultsAt } from "../robustness/faults";
import type {
  FootballBroadcastFrameObservation,
  FootballBroadcastVisiblePlayer,
  FootballEventRecordObservation,
  FootballObservation,
  FootballPlayerState,
  FootballSimEvent,
  FootballTrackingSampleObservation,
  FootballWorldState,
} from "../domain/football";
import type { FootballScenarioPlayer, FootballScenarioRecord } from "../domain/scenario";

// ---------------------------------------------------------------------------
// The tick — the simulator's public output unit
// ---------------------------------------------------------------------------

/** A source-timing snapshot for one tick (simulated milliseconds). */
export interface SourceTiming {
  broadcastAvailableAtMs: number | null;
  trackingAvailableAtMs: number | null;
  eventsAvailableAtMs: number | null;
}

/** One applied fault occurrence within a tick. */
export interface AppliedFault {
  faultKind: FaultKind;
  note: string;
}

/** One simulation step: world truth, world events, org-visible observations. */
export interface SimulatedTick {
  tickIndex: number;
  clockMs: number;
  period: 1 | 2;
  /** Ground truth (the world itself — organizations NEVER see this). */
  groundTruth: FootballWorldState;
  /** Ground-truth events that happened this tick (organizations NEVER see these directly). */
  events: readonly FootballSimEvent[];
  /** The observation stream organizations receive this tick. */
  observations: readonly FootballObservation[];
  appliedFaults: readonly AppliedFault[];
  timing: SourceTiming;
}

export interface FootballWorldSimulator {
  readonly scenarioId: string;
  readonly tickCount: number;
  /** Advance one tick (throws past the end — use `steps()` for iteration). */
  step(): SimulatedTick;
  /** Iterate every tick from the current position (resumable mid-run). */
  steps(): IterableIterator<SimulatedTick>;
  /** Run to completion and materialize every tick (deterministic). */
  ticks(): readonly SimulatedTick[];
}

// ---------------------------------------------------------------------------
// Source profiles (confidence / missingness / latency / drops per profile)
// ---------------------------------------------------------------------------

interface SourceProfileParams {
  trackingJitterMeters: number;
  broadcastJitterMeters: number;
  baseConfidence: number;
  dropRate: number;
  broadcastLatencyMs: number;
  trackingLatencyMs: number;
  eventsLatencyMs: number;
  occlusionRadiusM: number;
}

const SOURCE_PROFILES: Record<string, SourceProfileParams> = {
  clean: {
    trackingJitterMeters: 0.15,
    broadcastJitterMeters: 0.004,
    baseConfidence: 0.95,
    dropRate: 0,
    broadcastLatencyMs: 60,
    trackingLatencyMs: 30,
    eventsLatencyMs: 90,
    occlusionRadiusM: 1.5,
  },
  "noisy-broadcast": {
    trackingJitterMeters: 0.3,
    broadcastJitterMeters: 0.012,
    baseConfidence: 0.85,
    dropRate: 0.05,
    broadcastLatencyMs: 140,
    trackingLatencyMs: 40,
    eventsLatencyMs: 150,
    occlusionRadiusM: 2,
  },
  degraded: {
    trackingJitterMeters: 0.7,
    broadcastJitterMeters: 0.025,
    baseConfidence: 0.7,
    dropRate: 0.15,
    broadcastLatencyMs: 260,
    trackingLatencyMs: 80,
    eventsLatencyMs: 300,
    occlusionRadiusM: 2.5,
  },
};

// Simulation constants (v0 physics — documented, deterministic).
const PITCH_LENGTH_M = 105;
const PITCH_HALF_LENGTH_M = PITCH_LENGTH_M / 2;
const PITCH_HALF_WIDTH_M = 34;
const GOAL_HALF_WIDTH_M = 3.66;
const PLAYER_MAX_SPEED_MPS = 6.5;
const KEEPER_MAX_SPEED_MPS = 4.5;
const BALL_FRICTION_PER_TICK = 0.96; // calibrated: a 11 m/s pass carries ~27m (0.92 capped it at ~14m — the ball could never reach wide receivers)
const PASS_SPEED_MPS = 11;
const SHOT_SPEED_MPS = 18;
const SHOT_VZ_MPS = 3.5;
const GRAVITY_MPS2 = 9.81;
const POSSESSION_RADIUS_M = 0.9;
const SAVE_RADIUS_M = 2.6;
const EVENT_PUBLISH_DELAY_TICKS = 2;
const BROADCAST_EVERY_TICKS = 2;
const WAYPOINT_EVERY_TICKS = 25;

// ---------------------------------------------------------------------------
// Internal mutable sim state
// ---------------------------------------------------------------------------

interface SimPlayer {
  playerId: string;
  team: "home" | "away";
  jersey: number;
  role: "gk" | "df" | "mf" | "fw";
  home: { x: number; y: number };
  position: { x: number; y: number };
  velocity: { vx: number; vy: number };
  waypoint: { x: number; y: number };
  waypointUntil: number;
  rng: LabRng;
}

interface SimBall {
  position: { x: number; y: number; z: number };
  velocity: { vx: number; vy: number; vz: number };
  possessedBy: string | null;
  lastTouch: string | null;
  passTarget: string | null;
  holdTicks: number;
}

// ---------------------------------------------------------------------------
// The simulator
// ---------------------------------------------------------------------------

export interface FootballSimulatorOptions {
  scenario: FootballScenarioRecord;
  /** An optional REL-003 fault schedule to inject (replayable). */
  faultSchedule?: FaultSchedule;
}

/** Create the deterministic football world simulator for a scenario. */
export function createFootballWorldSimulator(
  options: FootballSimulatorOptions,
): FootballWorldSimulator {
  const { scenario } = options;
  const faultSchedule = options.faultSchedule;
  const config = scenario.config;
  const tickCount = scenario.initialConditions.expectedTickCount;
  const dtSeconds = config.tickMs / 1000;
  const profile = SOURCE_PROFILES[config.sourceProfile] ?? SOURCE_PROFILES["clean"]!;

  const masterRng = new LabRng(`${scenario.seed}::simulator`);
  const motionRng = masterRng.fork("motion");
  const possessionRng = masterRng.fork("possession");
  const broadcastRng = masterRng.fork("source:broadcast");
  const trackingRng = masterRng.fork("source:tracking");
  const initialKickoff = { done: false };
  const halfTimeNotified = { period1: false };

  const players: SimPlayer[] = scenario.initialConditions.players.map((player) =>
    createSimPlayer(player, motionRng),
  );
  const ball: SimBall = {
    position: { ...scenario.initialConditions.ball.position },
    velocity: { vx: 0, vy: 0, vz: 0 },
    possessedBy: null,
    lastTouch: null,
    passTarget: null,
    holdTicks: 0,
  };
  const officials = scenario.initialConditions.officials.map((official) => ({
    officialId: official.officialId,
    role: official.role as "referee" | "assistant-1" | "assistant-2" | "fourth",
    position: { ...official.position },
    confidence: 0.99,
  }));

  const pendingEvents: FootballSimEvent[] = [];
  let tickIndex = -1;
  let frameNumber = 0;

  // NOTE: the initial kickoff fires lazily at tick 0 (an event at "tick -1"
  // would carry a negative clock — impossible-output territory).

  function createSimPlayer(player: FootballScenarioPlayer, parentRng: LabRng): SimPlayer {
    return {
      playerId: player.playerId,
      team: player.team,
      jersey: player.jersey,
      role: player.role,
      home: { ...player.position },
      position: { ...player.position },
      velocity: { vx: 0, vy: 0 },
      waypoint: { ...player.position },
      waypointUntil: 0,
      rng: parentRng.fork(`player:${player.playerId}`),
    };
  }

  function resetFormations(): void {
    for (const player of players) {
      player.position = { ...player.home };
      player.velocity = { vx: 0, vy: 0 };
      player.waypoint = { ...player.home };
      player.waypointUntil = 0;
    }
    ball.position = { x: 0, y: 0, z: 0 };
    ball.velocity = { vx: 0, vy: 0, vz: 0 };
    ball.possessedBy = null;
    ball.passTarget = null;
    ball.holdTicks = 0;
  }

  function kickOff(team: "home" | "away"): void {
    const candidates = players.filter((p) => p.team === team && p.role !== "gk");
    const taker = candidates.find((p) => p.role === "mf") ?? candidates[0] ?? players[0];
    if (!taker) return;
    resetFormations();
    taker.position = { x: team === "home" ? -0.8 : 0.8, y: 0.4 };
    ball.position = { x: 0, y: 0, z: 0 };
    ball.possessedBy = taker.playerId;
    ball.lastTouch = taker.playerId;
    ball.holdTicks = 0;
    pushEvent(tickIndex, "kickoff", [taker.playerId, "ball"]);
  }

  function pushEvent(atTick: number, eventKindId: string, participants: readonly string[]): void {
    const seq = pendingEvents.filter((event) => event.tickIndex === atTick).length;
    pendingEvents.push({
      eventId: `ev-${atTick}-${seq}`,
      eventKindId,
      tickIndex: atTick,
      clockMs: clockMsForTick(atTick),
      participants: [...participants],
      provenanceClass: LAB_SIMULATION_PROVENANCE,
    });
  }

  function clockMsForTick(index: number): number {
    return Math.min(index * config.tickMs, config.matchDurationMs);
  }

  function distance(ax: number, ay: number, bx: number, by: number): number {
    return Math.hypot(ax - bx, ay - by);
  }

  function nearestTo(
    point: { x: number; y: number },
    filter: (player: SimPlayer) => boolean,
  ): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const player of players) {
      if (!filter(player)) continue;
      const d = distance(point.x, point.y, player.position.x, player.position.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = player;
      }
    }
    return best;
  }

  function opponentGoalX(team: "home" | "away"): number {
    // Home attacks +x (away's goal at +52.5); away attacks -x.
    return team === "home" ? PITCH_HALF_LENGTH_M : -PITCH_HALF_LENGTH_M;
  }

  // -------------------------------------------------------------------------
  // Motion
  // -------------------------------------------------------------------------

  function movePlayers(
    chaserHome: SimPlayer | null,
    chaserAway: SimPlayer | null,
    passReceiver: SimPlayer | null,
  ): void {
    for (const player of players) {
      const chaser = player === chaserHome || player === chaserAway || player === passReceiver;
      let target: { x: number; y: number };
      if (chaser) {
        target = { x: ball.position.x, y: ball.position.y };
      } else if (tickIndex >= player.waypointUntil) {
        // Patrol around the formation slot, within the player's half-ish zone.
        const roleSpread = player.role === "fw" ? 30 : player.role === "mf" ? 20 : 10;
        player.waypoint = {
          x: clamp(
            player.home.x + player.rng.range(-roleSpread, roleSpread),
            -PITCH_HALF_LENGTH_M + 1,
            PITCH_HALF_LENGTH_M - 1,
          ),
          y: clamp(
            player.home.y + player.rng.range(-17, 17),
            -PITCH_HALF_WIDTH_M + 0.5,
            PITCH_HALF_WIDTH_M - 0.5,
          ),
        };
        player.waypointUntil = tickIndex + WAYPOINT_EVERY_TICKS;
        target = player.waypoint;
      } else {
        target = player.waypoint;
      }
      const maxSpeed = player.role === "gk" ? KEEPER_MAX_SPEED_MPS : PLAYER_MAX_SPEED_MPS;
      // Goalkeepers stay near their goal line band.
      if (player.role === "gk") {
        target = {
          x: clamp(target.x, player.home.x - 4, player.home.x + 10),
          y: clamp(target.y, -GOAL_HALF_WIDTH_M - 4, GOAL_HALF_WIDTH_M + 4),
        };
      }
      const dx = target.x - player.position.x;
      const dy = target.y - player.position.y;
      const dist = Math.hypot(dx, dy);
      const maxStep = maxSpeed * dtSeconds;
      if (dist > 1e-9 && dist > maxStep) {
        const nx = player.position.x + (dx / dist) * maxStep;
        const ny = player.position.y + (dy / dist) * maxStep;
        player.velocity = {
          vx: (nx - player.position.x) / dtSeconds,
          vy: (ny - player.position.y) / dtSeconds,
        };
        player.position = { x: nx, y: ny };
      } else {
        player.velocity = { vx: dx / dtSeconds, vy: dy / dtSeconds };
        player.position = { x: target.x, y: target.y };
      }
    }
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  // -------------------------------------------------------------------------
  // Ball + event progression
  // -------------------------------------------------------------------------

  function progressPossessionAndBall(): void {
    if (ball.possessedBy !== null) {
      const holder = players.find((p) => p.playerId === ball.possessedBy);
      if (!holder) {
        ball.possessedBy = null;
        return;
      }
      ball.holdTicks += 1;
      // Carry the ball just ahead of the holder.
      const goalX = opponentGoalX(holder.team);
      const heading = goalX >= 0 ? 1 : -1;
      ball.position = {
        x: holder.position.x + heading * 0.7,
        y: holder.position.y,
        z: 0,
      };
      ball.velocity = { vx: holder.velocity.vx, vy: holder.velocity.vy, vz: 0 };
      // Decisions: shot in the attacking final third, else pass with rising pressure.
      const inFinalThird =
        Math.abs(holder.position.x) > 35 &&
        Math.sign(holder.position.x) === Math.sign(opponentGoalX(holder.team));
      const pShot = inFinalThird ? 0.08 : 0;
      const pPass = Math.min(0.03 + ball.holdTicks * 0.01, 0.25);
      const draw = possessionRng.next();
      if (draw < pShot) {
        shoot(holder);
      } else if (draw < pShot + pPass) {
        passTo(holder);
      }
      return;
    }
    // Free ball: physics + pickups + boundary events.
    ball.position = {
      x: ball.position.x + ball.velocity.vx * dtSeconds,
      y: ball.position.y + ball.velocity.vy * dtSeconds,
      z: Math.max(0, ball.position.z + ball.velocity.vz * dtSeconds),
    };
    ball.velocity = {
      vx: ball.velocity.vx * BALL_FRICTION_PER_TICK,
      vy: ball.velocity.vy * BALL_FRICTION_PER_TICK,
      vz: ball.velocity.vz - GRAVITY_MPS2 * dtSeconds,
    };
    if (ball.position.z <= 0) ball.velocity.vz = 0;
    resolveGoalAndBounds();
    const speed = Math.hypot(ball.velocity.vx, ball.velocity.vy);
    if (speed < 0.4 && ball.position.z < 0.05) {
      // Ball stopped: pickup by the nearest player (silent if the intended
      // pass receiver arrives; otherwise a recovery event).
      const picker = nearestTo(ball.position, () => true);
      if (
        picker &&
        distance(picker.position.x, picker.position.y, ball.position.x, ball.position.y) <
          POSSESSION_RADIUS_M * 3
      ) {
        takePossession(picker, ball.passTarget === picker.playerId ? null : "recovery");
      }
      return;
    }
    const closest = nearestTo(ball.position, () => true);
    if (
      closest &&
      distance(closest.position.x, closest.position.y, ball.position.x, ball.position.y) <
        POSSESSION_RADIUS_M
    ) {
      takePossession(closest, ball.passTarget === closest.playerId ? null : "recovery");
    }
  }

  function takePossession(player: SimPlayer, eventKindId: string | null): void {
    ball.possessedBy = player.playerId;
    ball.lastTouch = player.playerId;
    ball.passTarget = null;
    ball.holdTicks = 0;
    ball.velocity = { vx: 0, vy: 0, vz: 0 };
    if (eventKindId !== null) {
      pushEvent(tickIndex, eventKindId, [player.playerId, "ball"]);
    }
  }

  function shoot(shooter: SimPlayer): void {
    const goalX = opponentGoalX(shooter.team);
    // Aim across the goal mouth AND beyond it (±5m vs 3.66m posts): shots
    // can be on target, saved, or off target (-> goal kick) — all three
    // branches of the taxonomy are reachable.
    const aimY = possessionRng.range(-5, 5);
    const dx = goalX - ball.position.x;
    const dy = aimY - ball.position.y;
    const dist = Math.hypot(dx, dy) || 1;
    ball.possessedBy = null;
    ball.lastTouch = shooter.playerId;
    ball.passTarget = null;
    ball.velocity = {
      vx: (dx / dist) * SHOT_SPEED_MPS,
      vy: (dy / dist) * SHOT_SPEED_MPS,
      vz: SHOT_VZ_MPS,
    };
    pushEvent(tickIndex, "shot", [shooter.playerId, "ball"]);
  }

  function passTo(holder: SimPlayer): void {
    const goalX = opponentGoalX(holder.team);
    const mates = players.filter((p) => p.team === holder.team && p.playerId !== holder.playerId);
    if (mates.length === 0) return;
    // Directional play (deterministic): sort teammates by progress toward
    // the opponent goal and draw with a squared index — advanced teammates
    // are favored, so possession progresses instead of random-walking.
    const sorted = [...mates].sort(
      (a, b) => Math.abs(goalX - b.position.x) - Math.abs(goalX - a.position.x),
    );
    const drawIndex = Math.min(
      sorted.length - 1,
      Math.floor(possessionRng.next() ** 2 * sorted.length),
    );
    const receiver = sorted[drawIndex];
    if (!receiver) return;
    // Aim error: passes target the receiver's position plus seeded jitter —
    // imperfect passes can be intercepted or run out of play.
    const aimX = receiver.position.x + possessionRng.normal(0, 2.5);
    const aimY = receiver.position.y + possessionRng.normal(0, 2.5);
    const dx = aimX - ball.position.x;
    const dy = aimY - ball.position.y;
    const dist = Math.hypot(dx, dy) || 1;
    ball.possessedBy = null;
    ball.lastTouch = holder.playerId;
    ball.passTarget = receiver.playerId;
    ball.velocity = {
      vx: (dx / dist) * PASS_SPEED_MPS,
      vy: (dy / dist) * PASS_SPEED_MPS,
      vz: 0,
    };
    pushEvent(tickIndex, "pass", [holder.playerId, receiver.playerId, "ball"]);
  }

  function resolveGoalAndBounds(): void {
    const x = ball.position.x;
    const y = ball.position.y;
    // Goal line crossings (only when moving outward).
    if (Math.abs(x) >= PITCH_HALF_LENGTH_M && Math.abs(ball.velocity.vx) > 0) {
      const attackingTeam = x > 0 ? "home" : "away";
      const keeper = players.find((p) => p.team !== attackingTeam && p.role === "gk");
      const keeperNear =
        keeper !== undefined &&
        distance(
          keeper.position.x,
          keeper.position.y,
          x,
          clamp(y, -GOAL_HALF_WIDTH_M, GOAL_HALF_WIDTH_M),
        ) < SAVE_RADIUS_M;
      if (Math.abs(y) <= GOAL_HALF_WIDTH_M) {
        if (keeperNear) {
          // Save: the keeper smothers the ball.
          ball.position = { x: Math.sign(x) * (PITCH_HALF_LENGTH_M - 1), y, z: 0 };
          ball.velocity = { vx: 0, vy: 0, vz: 0 };
          if (keeper) {
            pushEvent(tickIndex, "save", [keeper.playerId, "ball"]);
            takePossession(keeper, null);
          }
          return;
        }
        pushEvent(tickIndex, "goal", [ball.lastTouch ?? "ball", "ball"]);
        kickOff(attackingTeam === "home" ? "away" : "home");
        return;
      }
      // Out over the goal line, not a goal: goal kick to the defending side.
      const defendingTeam = x > 0 ? "away" : "home";
      const defenderKeeper = players.find((p) => p.team === defendingTeam && p.role === "gk");
      if (defenderKeeper) {
        pushEvent(tickIndex, "goal-kick", [defenderKeeper.playerId, "ball"]);
        ball.position = { x: Math.sign(x) * (PITCH_HALF_LENGTH_M - 5.5), y: 0, z: 0 };
        takePossession(defenderKeeper, null);
      }
      return;
    }
    // Touchline: throw-in to the non-last-touching side (v0: placement + possession).
    if (Math.abs(y) >= PITCH_HALF_WIDTH_M) {
      const toTeam: "home" | "away" =
        ball.lastTouch !== null &&
        players.find((p) => p.playerId === ball.lastTouch)?.team === "home"
          ? "away"
          : "home";
      const taker = nearestTo(
        {
          x: clamp(x, -PITCH_HALF_LENGTH_M + 1, PITCH_HALF_LENGTH_M - 1),
          y: Math.sign(y) * (PITCH_HALF_WIDTH_M - 1),
        },
        (p) => p.team === toTeam,
      );
      ball.position = {
        x: clamp(x, -PITCH_HALF_LENGTH_M + 2, PITCH_HALF_LENGTH_M - 2),
        y: Math.sign(y) * (PITCH_HALF_WIDTH_M - 0.5),
        z: 0,
      };
      ball.velocity = { vx: 0, vy: 0, vz: 0 };
      if (taker) {
        pushEvent(tickIndex, "throw-in", [taker.playerId, "ball"]);
        takePossession(taker, null);
      }
    }
  }

  // -------------------------------------------------------------------------
  // World state + observations
  // -------------------------------------------------------------------------

  function worldState(clockMs: number, period: 1 | 2): FootballWorldState {
    return {
      schemaVersion: "football-world-state/0.1",
      provenanceClass: LAB_SIMULATION_PROVENANCE,
      clockMs,
      period,
      players: players.map((player): FootballPlayerState => ({
        playerId: player.playerId,
        team: player.team,
        jersey: player.jersey,
        role: player.role,
        position: { ...player.position },
        velocity: { ...player.velocity },
        onPitch: true,
        missing: false,
        confidence: 1,
      })),
      ball: {
        position: { ...ball.position },
        velocity: { ...ball.velocity },
        possessedBy: ball.possessedBy,
        confidence: 1,
      },
      officials: officials.map((official) => ({
        officialId: official.officialId,
        role: official.role,
        position: { ...official.position },
        confidence: official.confidence,
      })),
      pitchFrame: {
        frameId: "pitch" as const,
        lengthM: 105,
        widthM: 68,
        units: "meters" as const,
        origin: "center-spot" as const,
      },
    };
  }

  /** How many players stand within `radius` of the point (x, y). */
  function crowdCount(x: number, y: number, radius: number): number {
    let count = 0;
    for (const other of players) {
      if (distance(other.position.x, other.position.y, x, y) <= radius) count += 1;
    }
    return count;
  }

  function occludedFaultActive(tick: number): number {
    if (!faultSchedule) return 0;
    for (const entry of activeFaultsAt(faultSchedule, tick)) {
      if (entry.faultKind === "occlusion") return entry.params.occlusionRadiusM ?? 3;
    }
    return 0;
  }

  function playerOccluded(player: SimPlayer, tick: number): boolean {
    const crowd = crowdCount(player.position.x, player.position.y, profile.occlusionRadiusM) >= 3;
    const zone = occludedFaultActive(tick);
    const zoneOccluded =
      zone > 0 &&
      distance(player.position.x, player.position.y, ball.position.x, ball.position.y) < zone;
    return crowd || zoneOccluded;
  }

  function ballOccluded(): boolean {
    return crowdCount(ball.position.x, ball.position.y, profile.occlusionRadiusM) >= 3;
  }

  function broadcastFrame(
    tick: number,
    clockMs: number,
    droppedRateBoost: number,
  ): FootballBroadcastFrameObservation {
    frameNumber += 1;
    const dropRate = clamp(profile.dropRate + droppedRateBoost, 0, 0.95);
    const dropped = broadcastRng.bool(dropRate);
    const visiblePlayers: FootballBroadcastVisiblePlayer[] = players.map((player) => {
      const occluded = playerOccluded(player, tick);
      if (occluded) {
        return { playerId: player.playerId, box: null, occluded: true };
      }
      const jitterX = broadcastRng.normal(0, profile.broadcastJitterMeters);
      const jitterY = broadcastRng.normal(0, profile.broadcastJitterMeters);
      const boxX = clamp(
        (player.position.x + PITCH_HALF_LENGTH_M) / PITCH_LENGTH_M + jitterX,
        0,
        0.98,
      );
      const boxY = clamp(
        (PITCH_HALF_WIDTH_M - player.position.y) / (PITCH_HALF_WIDTH_M * 2) + jitterY,
        0,
        0.97,
      );
      return {
        playerId: player.playerId,
        box: { x: boxX, y: boxY, w: 0.025, h: 0.04 },
        occluded: false,
      };
    });
    return {
      observationId: `obs-bf-${tick}`,
      kindId: "broadcast-frame",
      tickIndex: tick,
      clockMs,
      provenanceClass: LAB_SIMULATION_PROVENANCE,
      confidence: dropped ? 0 : profile.baseConfidence,
      payload: {
        cameraId: "cam-main",
        frameNumber,
        dropped,
        visiblePlayers: dropped ? [] : visiblePlayers,
        ballVisible: !dropped && !ballOccluded(),
      },
    };
  }

  function trackingSamples(
    tick: number,
    clockMs: number,
    disagreementMeters: number,
  ): FootballTrackingSampleObservation[] {
    return players.map((player) => {
      const occluded = playerOccluded(player, tick);
      const jitterX = trackingRng.normal(0, profile.trackingJitterMeters);
      const jitterY = trackingRng.normal(0, profile.trackingJitterMeters);
      const position = {
        x: player.position.x + jitterX + disagreementMeters,
        y: player.position.y + jitterY,
      };
      const confidence = clamp(
        profile.baseConfidence - (occluded ? 0.5 : 0) + trackingRng.range(0, 0.04),
        0,
        1,
      );
      return {
        observationId: `obs-ts-${tick}-${player.playerId}`,
        kindId: "tracking-sample",
        tickIndex: tick,
        clockMs,
        provenanceClass: LAB_SIMULATION_PROVENANCE,
        confidence,
        payload: {
          playerId: player.playerId,
          position,
          velocity: {
            vx: player.velocity.vx + trackingRng.normal(0, 0.2),
            vy: player.velocity.vy + trackingRng.normal(0, 0.2),
          },
          missing: occluded,
        },
      };
    });
  }

  function publishDueEvents(tick: number, clockMs: number): FootballEventRecordObservation[] {
    const due = pendingEvents.filter(
      (event) => event.tickIndex + EVENT_PUBLISH_DELAY_TICKS <= tick,
    );
    for (const event of due) {
      const index = pendingEvents.indexOf(event);
      pendingEvents.splice(index, 1);
    }
    return due.map((event) => ({
      observationId: `obs-evt-${event.eventId}`,
      kindId: "event-record",
      tickIndex: tick,
      clockMs,
      provenanceClass: LAB_SIMULATION_PROVENANCE,
      confidence: 0.98,
      payload: {
        eventId: event.eventId,
        eventKindId: event.eventKindId,
        participants: [...event.participants],
        publishedAtTick: tick,
      },
    }));
  }

  // -------------------------------------------------------------------------
  // The tick itself
  // -------------------------------------------------------------------------

  function makeTick(): SimulatedTick {
    tickIndex += 1;
    const clockMs = clockMsForTick(tickIndex);
    const halfMs = config.matchDurationMs / 2;
    const period: 1 | 2 = clockMs < halfMs ? 1 : 2;
    if (!initialKickoff.done) {
      initialKickoff.done = true;
      kickOff(scenario.initialConditions.kickoffTeam);
    }
    if (!halfTimeNotified.period1 && clockMs >= halfMs) {
      halfTimeNotified.period1 = true;
      // Second-half kickoff for the side that did not kick off first.
      kickOff(scenario.initialConditions.kickoffTeam === "home" ? "away" : "home");
    }

    const active = faultSchedule ? activeFaultsAt(faultSchedule, tickIndex) : [];
    const appliedFaults: AppliedFault[] = active.map((entry) => ({
      faultKind: entry.faultKind,
      note: `fault ${entry.faultKind} active ticks ${entry.tickIndex}..${entry.tickIndex + entry.durationTicks - 1}`,
    }));
    const latencyFaultMs = active
      .filter((entry) => entry.faultKind === "processing-latency")
      .reduce((sum, entry) => sum + (entry.params.latencyMs ?? 250), 0);
    const dropBoost = active
      .filter((entry) => entry.faultKind === "dropped-frames")
      .reduce((sum, entry) => sum + (entry.params.dropRateBoost ?? 0.25), 0);
    const disagreement = active
      .filter((entry) => entry.faultKind === "source-disagreement")
      .reduce((max, entry) => Math.max(max, entry.params.disagreementMeters ?? 0.6), 0);
    const providerDown = active.some((entry) => entry.faultKind === "compute-provider-failure");

    // Chase logic: the nearest player of each side pursues a free ball, and
    // the intended pass receiver runs to meet the pass (passTarget).
    const passReceiver =
      ball.possessedBy === null && ball.passTarget !== null
        ? (players.find((p) => p.playerId === ball.passTarget) ?? null)
        : null;
    const chaserHome =
      ball.possessedBy === null
        ? nearestTo(ball.position, (p) => p.team === "home" && p.role !== "gk")
        : null;
    const chaserAway =
      ball.possessedBy === null
        ? nearestTo(ball.position, (p) => p.team === "away" && p.role !== "gk")
        : null;
    movePlayers(chaserHome, chaserAway, passReceiver);
    progressPossessionAndBall();

    const observations: FootballObservation[] = [];
    // Broadcast every BROADCAST_EVERY_TICKS ticks (v0: 5 Hz at a 100ms tick).
    if (tickIndex % BROADCAST_EVERY_TICKS === 0) {
      if (!providerDown) {
        observations.push(broadcastFrame(tickIndex, clockMs, dropBoost));
      } else {
        frameNumber += 1; // the frame existed; the provider failed to deliver it
      }
    }
    observations.push(...trackingSamples(tickIndex, clockMs, disagreement));
    observations.push(...publishDueEvents(tickIndex, clockMs));

    return {
      tickIndex,
      clockMs,
      period,
      groundTruth: worldState(clockMs, period),
      events: pendingEvents
        .filter((event) => event.tickIndex === tickIndex)
        .map((event) => ({ ...event, participants: [...event.participants] })),
      observations,
      appliedFaults,
      timing: {
        broadcastAvailableAtMs: providerDown
          ? null
          : tickIndex % BROADCAST_EVERY_TICKS === 0
            ? clockMs + profile.broadcastLatencyMs + latencyFaultMs
            : null,
        trackingAvailableAtMs: clockMs + profile.trackingLatencyMs + Math.floor(latencyFaultMs / 2),
        eventsAvailableAtMs: clockMs + profile.eventsLatencyMs + latencyFaultMs,
      },
    };
  }

  return {
    scenarioId: scenario.scenarioId,
    tickCount,
    step(): SimulatedTick {
      if (tickIndex + 1 >= tickCount) {
        throw new RangeError(`simulator exhausted: tick ${tickIndex + 1} of ${tickCount}`);
      }
      return makeTick();
    },
    *steps(): IterableIterator<SimulatedTick> {
      while (tickIndex + 1 < tickCount) {
        yield makeTick();
      }
    },
    ticks(): readonly SimulatedTick[] {
      const collected: SimulatedTick[] = [];
      for (const tick of this.steps()) collected.push(tick);
      return collected;
    },
  };
}
