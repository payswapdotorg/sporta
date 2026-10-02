/**
 * The Sports World Simulator v0 for the basketball pack (REL-032), per
 * docs/architecture/reality-engineering-lab.md §4 — the second domain's
 * deterministic world simulator, proving the §4 simulator contract is not
 * football-shaped.
 *
 * What is modeled here (all deterministic from (seed, configuration)):
 * - game clock (FOUR QUARTERS, alternating jump-ball awards);
 * - players + ball state (formation resets, marking defense, patrol
 *   offense, carry/pass/shot progression, projectile flight with gravity);
 * - spatial geometry (28m x 15m court frame, hoop centers at x=±12.425,
 *   rim height 3.05m, rim radius 0.23m, bounds, distance/step math);
 * - event progression (jump-ball, pass, shot, made-basket, block, rebound,
 *   turnover, free-throw — published to organizations only as DELAYED
 *   event-record observations);
 * - DISCRETE-CORRECT RIM-CROSSING physics: a made basket is decided at the
 *   tick where the ball's height descends through the rim plane — the
 *   ball's horizontal distance to the hoop center AT THAT TICK decides
 *   made vs missed (<= rim radius = through the cylinder). The discrete
 *   tick is the physics truth (no sub-tick interpolation): the sim states
 *   its own discretization honestly;
 * - confidence + missingness (per-source profiles; occlusion marks
 *   tracking samples missing and broadcast boxes null);
 * - source timing (per-source availability latency, per-profile);
 * - dropped frames (per-profile drop rate, boostable by fault injection);
 * - compute/provider failures, source disagreement, occlusion and
 *   processing latency — injected by replaying a REL-003 `FaultSchedule`
 *   (the same five fault kinds, the same application rules).
 *
 * THE LAW: the same (scenario, faultSchedule) always produces the same tick
 * stream — every stochastic decision flows from a fork of the scenario
 * seed, never `Math.random`/`Date.now`. And every world state, event and
 * observation this module produces carries
 * `provenanceClass: "lab-simulation"` — lab world state is NEVER
 * production truth.
 *
 * v0 honesty (documented simplifications): five-on-court with role-based
 * speeds, marking defense (defender i guards opponent i), a v0 FOUL MODEL —
 * a seeded 40% of contested blocks award a free-throw to the shooter (the
 * one honest path to the free-throw event kind in v0) — flat 2D broadcast
 * boxes, a single main camera, and arcade ball physics (bounce restitution
 * 0.55, per-tick friction). The contract shape (tick stream, ground truth
 * vs observations vs events separation, fault hooks) is the delivery; the
 * physics is deliberately simple and says so.
 */
import { LAB_SIMULATION_PROVENANCE } from "../provenance";
import { LabRng } from "../rng";
import type { FaultKind } from "../domain/domain-pack";
import type { FaultSchedule } from "../robustness/faults";
import { activeFaultsAt } from "../robustness/faults";
import type {
  BasketballBroadcastFrameObservation,
  BasketballBroadcastVisiblePlayer,
  BasketballEventRecordObservation,
  BasketballObservation,
  BasketballOfficialState,
  BasketballPlayerState,
  BasketballSimEvent,
  BasketballTrackingSampleObservation,
  BasketballWorldState,
} from "../domain/basketball";
import { createBasketballLabEvaluator, createBasketballRewardEngine } from "../domain/basketball";
import type { BasketballScenarioPlayer, BasketballScenarioRecord } from "../domain/basketball";
import type { DomainSimulationProfile } from "./domain-profile";

// ---------------------------------------------------------------------------
// The tick — the simulator's public output unit
// ---------------------------------------------------------------------------

/** A source-timing snapshot for one tick (simulated milliseconds). */
export interface BasketballSourceTiming {
  broadcastAvailableAtMs: number | null;
  trackingAvailableAtMs: number | null;
  eventsAvailableAtMs: number | null;
}

/** One applied fault occurrence within a tick. */
export interface BasketballAppliedFault {
  faultKind: FaultKind;
  note: string;
}

/** One simulation step: world truth, world events, org-visible observations. */
export interface BasketballSimulatedTick {
  tickIndex: number;
  clockMs: number;
  /** The quarter (1..4) — this pack's period/phase label. */
  period: 1 | 2 | 3 | 4;
  /** Ground truth (the world itself — organizations NEVER see this). */
  groundTruth: BasketballWorldState;
  /** Ground-truth events that happened this tick (organizations NEVER see these directly). */
  events: readonly BasketballSimEvent[];
  /** The observation stream organizations receive this tick. */
  observations: readonly BasketballObservation[];
  appliedFaults: readonly BasketballAppliedFault[];
  timing: BasketballSourceTiming;
}

export interface BasketballWorldSimulator {
  readonly scenarioId: string;
  readonly tickCount: number;
  /** Advance one tick (throws past the end — use `steps()` for iteration). */
  step(): BasketballSimulatedTick;
  /** Iterate every tick from the current position (resumable mid-run). */
  steps(): IterableIterator<BasketballSimulatedTick>;
  /** Run to completion and materialize every tick (deterministic). */
  ticks(): readonly BasketballSimulatedTick[];
}

// ---------------------------------------------------------------------------
// Source profiles (confidence / missingness / latency / drops per profile)
// ---------------------------------------------------------------------------

interface BasketballSourceProfileParams {
  trackingJitterMeters: number;
  broadcastJitterMeters: number;
  baseConfidence: number;
  dropRate: number;
  broadcastLatencyMs: number;
  trackingLatencyMs: number;
  eventsLatencyMs: number;
  occlusionRadiusM: number;
}

const SOURCE_PROFILES: Record<string, BasketballSourceProfileParams> = {
  clean: {
    trackingJitterMeters: 0.08,
    broadcastJitterMeters: 0.004,
    baseConfidence: 0.95,
    dropRate: 0,
    broadcastLatencyMs: 60,
    trackingLatencyMs: 30,
    eventsLatencyMs: 90,
    occlusionRadiusM: 1.2,
  },
  "noisy-broadcast": {
    trackingJitterMeters: 0.16,
    broadcastJitterMeters: 0.012,
    baseConfidence: 0.85,
    dropRate: 0.05,
    broadcastLatencyMs: 140,
    trackingLatencyMs: 40,
    eventsLatencyMs: 150,
    occlusionRadiusM: 1.6,
  },
  degraded: {
    trackingJitterMeters: 0.35,
    broadcastJitterMeters: 0.025,
    baseConfidence: 0.7,
    dropRate: 0.15,
    broadcastLatencyMs: 260,
    trackingLatencyMs: 80,
    eventsLatencyMs: 300,
    occlusionRadiusM: 2,
  },
};

// Simulation constants (v0 lab physics — documented, deterministic).
const COURT_LENGTH_M = 28;
const COURT_HALF_LENGTH_M = COURT_LENGTH_M / 2;
const COURT_HALF_WIDTH_M = 7.5;
/** The hoop centers: 1.575m in from each baseline. */
const HOOP_X_M = 12.425;
const RIM_HEIGHT_M = 3.05;
const RIM_RADIUS_M = 0.23;
/** An uncontested free throw is taken 5.8m from the baseline. */
const FREE_THROW_X_M = 8.2;
const GUARD_MAX_SPEED_MPS = 5.5;
const FORWARD_MAX_SPEED_MPS = 5.0;
const CENTER_MAX_SPEED_MPS = 4.5;
const BALL_FRICTION_PER_TICK = 0.96;
const BALL_BOUNCE_RESTITUTION = 0.55;
/** Shot aim scatter around the hoop center (meters) — drives the make rate. */
const SHOT_AIM_ERROR_M = 0.32;
const PASS_SPEED_MPS = 8.0;
const PASS_AIM_ERROR_M = 1.2;
const POSSESSION_RADIUS_M = 0.8;
/** A player can only take a live ball at or below this height (meters). */
const PICKUP_MAX_HEIGHT_M = 2.0;
const BLOCK_RADIUS_M = 1.1;
const BLOCK_PROBABILITY = 0.3;
/** The v0 foul model: a seeded fraction of contested blocks award a free-throw. */
const FOUL_ON_BLOCK_PROBABILITY = 0.4;
const FREE_THROW_MAKE_PROBABILITY = 0.75;
const EVENT_PUBLISH_DELAY_TICKS = 2;
const BROADCAST_EVERY_TICKS = 2;
const WAYPOINT_EVERY_TICKS = 25;
const GRAVITY_MPS2 = 9.81;

// ---------------------------------------------------------------------------
// Internal mutable sim state
// ---------------------------------------------------------------------------

interface SimPlayer {
  playerId: string;
  team: "home" | "away";
  jersey: number;
  role: "pg" | "sg" | "sf" | "pf" | "c";
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
  /** Why the ball is free: "pass" | "shot" | "block" | "loose". */
  freeOrigin: "pass" | "shot" | "block" | "loose";
  /** True once the descending rim crossing was already judged. */
  rimJudged: boolean;
}

// ---------------------------------------------------------------------------
// The simulator
// ---------------------------------------------------------------------------

export interface BasketballSimulatorOptions {
  scenario: BasketballScenarioRecord;
  /** An optional REL-003 fault schedule to inject (replayable). */
  faultSchedule?: FaultSchedule;
}

/** Create the deterministic basketball world simulator for a scenario. */
export function createBasketballWorldSimulator(
  options: BasketballSimulatorOptions,
): BasketballWorldSimulator {
  const { scenario } = options;
  const faultSchedule = options.faultSchedule;
  const config = scenario.config;
  const tickCount = scenario.initialConditions.expectedTickCount;
  const dtSeconds = config.tickMs / 1000;
  const profile = SOURCE_PROFILES[config.sourceProfile] ?? SOURCE_PROFILES["clean"]!;
  const quarterMs = config.matchDurationMs / 4;

  const masterRng = new LabRng(`${scenario.seed}::simulator`);
  const motionRng = masterRng.fork("motion");
  const possessionRng = masterRng.fork("possession");
  const broadcastRng = masterRng.fork("source:broadcast");
  const trackingRng = masterRng.fork("source:tracking");
  const initialJump = { done: false };
  const quarterJumpDone = new Set<number>();

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
    freeOrigin: "loose",
    rimJudged: true,
  };
  const officials = scenario.initialConditions.officials.map((official) => ({
    officialId: official.officialId,
    role: official.role as "crew-chief" | "umpire-1" | "umpire-2",
    position: { ...official.position },
    confidence: 0.99,
  }));

  const pendingEvents: BasketballSimEvent[] = [];
  let tickIndex = -1;
  let frameNumber = 0;

  function createSimPlayer(player: BasketballScenarioPlayer, parentRng: LabRng): SimPlayer {
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
    ball.position = { x: 0, y: 0, z: 1.95 };
    ball.velocity = { vx: 0, vy: 0, vz: 0 };
    ball.possessedBy = null;
    ball.passTarget = null;
    ball.holdTicks = 0;
    ball.freeOrigin = "loose";
    ball.rimJudged = true;
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

  function maxSpeedOf(player: SimPlayer): number {
    if (player.role === "pg" || player.role === "sg") return GUARD_MAX_SPEED_MPS;
    if (player.role === "c") return CENTER_MAX_SPEED_MPS;
    return FORWARD_MAX_SPEED_MPS;
  }

  function opponentHoopX(team: "home" | "away"): number {
    // Home attacks +x (away's basket at +12.425); away attacks -x.
    return team === "home" ? HOOP_X_M : -HOOP_X_M;
  }

  function ownHoopX(team: "home" | "away"): number {
    return team === "home" ? -HOOP_X_M : HOOP_X_M;
  }

  /** The player's index among their team's players (stable, declaration order). */
  function teamIndexOf(player: SimPlayer): number {
    return players.filter((p) => p.team === player.team).indexOf(player);
  }

  function playerById(playerId: string): SimPlayer | null {
    return players.find((p) => p.playerId === playerId) ?? null;
  }

  function jumpBall(awardedTeam: "home" | "away", atTick: number): void {
    resetFormations();
    const centers = players.filter((p) => p.team === awardedTeam && p.role === "c");
    const taker = centers[0] ?? players.find((p) => p.team === awardedTeam) ?? players[0];
    if (!taker) return;
    taker.position = { x: awardedTeam === "home" ? -0.6 : 0.6, y: 0.3 };
    ball.position = { x: 0, y: 0, z: 2.6 };
    ball.possessedBy = taker.playerId;
    ball.lastTouch = taker.playerId;
    ball.holdTicks = 0;
    pushEvent(atTick, "jump-ball", [taker.playerId, "ball"]);
  }

  // -------------------------------------------------------------------------
  // Motion — marking defense, patrol offense, carrier attack
  // -------------------------------------------------------------------------

  function movePlayers(
    carrier: SimPlayer | null,
    passReceiver: SimPlayer | null,
    chaser: SimPlayer | null,
  ): void {
    const offenseTeam = carrier !== null ? carrier.team : lastTouchTeam();
    for (const player of players) {
      let target: { x: number; y: number };
      if (player === carrier || player === chaser) {
        // The carrier drifts toward the attacking basket; the chaser closes.
        const goalX = player === carrier ? opponentHoopX(player.team) : ball.position.x;
        target =
          player === carrier
            ? { x: (player.position.x + goalX) / 2, y: ball.position.y }
            : { x: ball.position.x, y: ball.position.y };
      } else if (player === passReceiver) {
        target = { x: ball.position.x, y: ball.position.y };
      } else if (player.team !== offenseTeam) {
        // MARKING DEFENSE: defender i guards opponent i, half a meter off
        // toward their own basket — contested shots and interceptions are
        // reachable by construction, not by accident.
        const mates = players.filter((p) => p.team === offenseTeam);
        const mark = mates[teamIndexOf(player) % Math.max(1, mates.length)] ?? null;
        if (mark !== null) {
          const own = ownHoopX(player.team);
          const off = Math.sign(own - mark.position.x) * 0.5;
          target = { x: mark.position.x + off, y: mark.position.y };
        } else {
          target = { ...player.home };
        }
      } else if (tickIndex >= player.waypointUntil) {
        // Offense patrol: spread around the formation slot within the
        // attacking half-ish zone.
        const roleSpread = player.role === "c" ? 3 : player.role === "pf" ? 4.5 : 6;
        player.waypoint = {
          x: clamp(
            player.home.x + player.rng.range(-roleSpread, roleSpread),
            -COURT_HALF_LENGTH_M + 1.5,
            COURT_HALF_LENGTH_M - 1.5,
          ),
          y: clamp(
            player.home.y + player.rng.range(-3.5, 3.5),
            -COURT_HALF_WIDTH_M + 0.5,
            COURT_HALF_WIDTH_M - 0.5,
          ),
        };
        player.waypointUntil = tickIndex + WAYPOINT_EVERY_TICKS;
        target = player.waypoint;
      } else {
        target = player.waypoint;
      }
      const maxStep = maxSpeedOf(player) * dtSeconds;
      const dx = target.x - player.position.x;
      const dy = target.y - player.position.y;
      const dist = Math.hypot(dx, dy);
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

  function lastTouchTeam(): "home" | "away" {
    const toucher = ball.lastTouch !== null ? playerById(ball.lastTouch) : null;
    return toucher !== null ? toucher.team : "home";
  }

  // -------------------------------------------------------------------------
  // Possession, passing, shooting, the rim, and the foul model
  // -------------------------------------------------------------------------

  function progressPossessionAndBall(): void {
    if (ball.possessedBy !== null) {
      const holder = playerById(ball.possessedBy);
      if (holder === null) {
        ball.possessedBy = null;
        return;
      }
      ball.holdTicks += 1;
      // Carry the ball just ahead of the holder toward the basket.
      const goalX = opponentHoopX(holder.team);
      const heading = goalX >= 0 ? 1 : -1;
      ball.position = {
        x: holder.position.x + heading * 0.5,
        y: holder.position.y,
        z: 1.35,
      };
      ball.velocity = { vx: holder.velocity.vx, vy: holder.velocity.vy, vz: 0 };
      // Decisions: contested shot in the scoring range, else pass with
      // rising pressure.
      const distToHoop = distance(
        holder.position.x,
        holder.position.y,
        opponentHoopX(holder.team),
        0,
      );
      const inScoringRange = distToHoop < 6.5;
      const pShot = inScoringRange ? Math.min(0.09 + ball.holdTicks * 0.01, 0.25) : 0;
      const pPass = Math.min(0.05 + ball.holdTicks * 0.012, 0.3);
      const draw = possessionRng.next();
      if (draw < pShot) {
        shoot(holder);
      } else if (draw < pShot + pPass) {
        passTo(holder);
      }
      return;
    }
    // Free ball: projectile physics, the rim, bounds, pickups.
    // Airborne honesty: NO horizontal drag in flight (the shot arc's
    // arrival math is exact — drag applies to floor-contact balls only).
    const prevZ = ball.position.z;
    ball.position = {
      x: ball.position.x + ball.velocity.vx * dtSeconds,
      y: ball.position.y + ball.velocity.vy * dtSeconds,
      z: ball.position.z + ball.velocity.vz * dtSeconds,
    };
    ball.velocity = {
      vx: ball.velocity.vx,
      vy: ball.velocity.vy,
      vz: ball.velocity.vz - GRAVITY_MPS2 * dtSeconds,
    };
    // Floor bounce (arcade restitution; rolling friction for floor contact).
    if (ball.position.z <= 0) {
      ball.position = { ...ball.position, z: 0 };
      ball.velocity = {
        vx: ball.velocity.vx * BALL_FRICTION_PER_TICK,
        vy: ball.velocity.vy * BALL_FRICTION_PER_TICK,
        vz: -ball.velocity.vz * BALL_BOUNCE_RESTITUTION,
      };
      if (Math.abs(ball.velocity.vz) < 0.4) ball.velocity.vz = 0;
    }
    judgeRim(prevZ);
    resolveOutOfBounds();
    const speed = Math.hypot(ball.velocity.vx, ball.velocity.vy);
    if (speed < 0.35 && ball.position.z < 0.4) {
      // Ball stopped: pickup by the nearest player.
      const picker = nearestTo(ball.position, () => true);
      if (
        picker !== null &&
        distance(picker.position.x, picker.position.y, ball.position.x, ball.position.y) <
          POSSESSION_RADIUS_M * 3
      ) {
        takePossession(picker);
      }
      return;
    }
    const closest = nearestTo(ball.position, () => true);
    if (
      closest !== null &&
      // Mid-flight honesty: a live ball above PICKUP_MAX_HEIGHT_M cannot be
      // taken, and a ball ASCENDING fast is out of reach (the shot's rim
      // judgment must happen before any rebound) — a descending or dead
      // ball at reachable height is live for a pickup.
      ball.position.z <= PICKUP_MAX_HEIGHT_M &&
      ball.velocity.vz < 0.5 &&
      distance(closest.position.x, closest.position.y, ball.position.x, ball.position.y) <
        POSSESSION_RADIUS_M
    ) {
      takePossession(closest);
    }
  }

  /**
   * DISCRETE-CORRECT RIM CROSSING: the made/missed decision happens at the
   * tick where the ball's height DESCENDS through the rim plane — at that
   * tick, a horizontal distance to the hoop center within the rim radius
   * means through the cylinder (a score). The discrete tick is the physics
   * truth; one judgment per flight (rimJudged resets on the next shot).
   */
  function judgeRim(prevZ: number): void {
    if (ball.rimJudged) return;
    if (prevZ < RIM_HEIGHT_M || ball.position.z >= RIM_HEIGHT_M) return;
    // Descending through the rim plane this tick: judge NOW.
    ball.rimJudged = true;
    if (ball.position.z >= RIM_HEIGHT_M) return; // defensive: not yet below
    const shooterId = ball.lastTouch;
    for (const hoopX of [HOOP_X_M, -HOOP_X_M]) {
      const dist = distance(ball.position.x, ball.position.y, hoopX, 0);
      if (dist <= RIM_RADIUS_M) {
        pushEvent(tickIndex, "made-basket", [shooterId ?? "ball", "ball"]);
        // The opponent inbounds at their own baseline end.
        const scoringTeam = shooterId !== null ? playerById(shooterId)?.team : undefined;
        const opponent: "home" | "away" = scoringTeam === "home" ? "away" : "home";
        inboundTo(opponent);
        return;
      }
    }
    // Missed: the free ball stays live (a rebound happens on pickup).
    ball.freeOrigin = "shot";
  }

  function inboundTo(team: "home" | "away"): void {
    const baselineX = team === "home" ? -COURT_HALF_LENGTH_M + 1.2 : COURT_HALF_LENGTH_M - 1.2;
    const taker =
      players
        .filter((p) => p.team === team)
        .sort(
          (a, b) =>
            distance(a.position.x, a.position.y, baselineX, 0) -
            distance(b.position.x, b.position.y, baselineX, 0),
        )[0] ?? null;
    ball.position = { x: baselineX, y: 0, z: 1.35 };
    ball.velocity = { vx: 0, vy: 0, vz: 0 };
    ball.passTarget = null;
    ball.freeOrigin = "loose";
    ball.rimJudged = true;
    if (taker !== null) takePossession(taker);
  }

  function takePossession(player: SimPlayer): void {
    const changedTeam = ball.lastTouch !== null && playerById(ball.lastTouch)?.team !== player.team;
    const origin = ball.freeOrigin;
    ball.possessedBy = player.playerId;
    ball.lastTouch = player.playerId;
    ball.passTarget = null;
    ball.holdTicks = 0;
    ball.velocity = { vx: 0, vy: 0, vz: 0 };
    ball.rimJudged = true;
    if (origin === "shot" || origin === "block") {
      // A recovered miss (offensive OR defensive) is a rebound.
      pushEvent(tickIndex, "rebound", [player.playerId, "ball"]);
      return;
    }
    if (origin === "pass" && changedTeam) {
      // An intercepted pass is a turnover.
      pushEvent(tickIndex, "turnover", [player.playerId, "ball"]);
      return;
    }
    // Clean pass arrival / initial possession: no event.
  }

  function shoot(shooter: SimPlayer, isFreeThrow = false): void {
    const goalX = opponentHoopX(shooter.team);
    const hoop = { x: goalX, y: 0 };
    const dx0 = hoop.x - ball.position.x;
    const dy0 = hoop.y - ball.position.y;
    const hoopDist = Math.hypot(dx0, dy0) || 1;
    // DISCRETE-CORRECT flight planning: the arc is solved against the
    // simulator's OWN integrator (position += v*dt, THEN v -= g*dt), not
    // against analytic formulas the integrator drifts from. The ball is
    // planned to be exactly AT the rim plane (z = 3.05) at flight tick n,
    // one tick's horizontal travel SHORT of the hoop center — so the
    // descending rim judgment (which fires on the first tick BELOW the
    // plane, i.e. at tick n+1) lands the ball exactly AT the hoop, with
    // only the aim error deciding made vs missed.
    const nTicks = Math.max(8, Math.ceil(hoopDist / (6.5 * dtSeconds)));
    const vHorizontal = hoopDist / (nTicks * dtSeconds);
    const unitX = dx0 / hoopDist;
    const unitY = dy0 / hoopDist;
    // Aim error: shots scatter around the hoop center — makes, misses off
    // the rim, and (with a defender nearby) blocks are all reachable. A
    // free throw is uncontested: NO aim error (the seeded 75% make draw is
    // the make/miss decision, judged by the same rim physics).
    const aimErrorX = isFreeThrow ? 0 : possessionRng.range(-SHOT_AIM_ERROR_M, SHOT_AIM_ERROR_M);
    const aimErrorY = isFreeThrow ? 0 : possessionRng.range(-SHOT_AIM_ERROR_M, SHOT_AIM_ERROR_M);
    const aimX = hoop.x - unitX * vHorizontal * dtSeconds + aimErrorX;
    const aimY = hoop.y - unitY * vHorizontal * dtSeconds + aimErrorY;
    // Discrete vertical solve: z_n = rim exactly (see the integrator above).
    const v0z =
      (RIM_HEIGHT_M -
        ball.position.z +
        (GRAVITY_MPS2 * dtSeconds * dtSeconds * (nTicks - 1) * nTicks) / 2) /
      (nTicks * dtSeconds);
    const aimDx = aimX - ball.position.x;
    const aimDy = aimY - ball.position.y;
    const aimDist = Math.hypot(aimDx, aimDy) || 1;
    const aimHorizontal = aimDist / (nTicks * dtSeconds);
    ball.possessedBy = null;
    ball.lastTouch = shooter.playerId;
    ball.passTarget = null;
    ball.velocity = {
      vx: (aimDx / aimDist) * aimHorizontal,
      vy: (aimDy / aimDist) * aimHorizontal,
      vz: v0z,
    };
    ball.rimJudged = false;
    pushEvent(tickIndex, isFreeThrow ? "free-throw" : "shot", [shooter.playerId, "ball"]);
    if (isFreeThrow) {
      // An uncontested free throw: 75% make, judged by the same rim physics.
      ball.freeOrigin = "shot";
      if (!possessionRng.bool(FREE_THROW_MAKE_PROBABILITY)) {
        // Miss: deflect the arrival so the rim judge records a miss.
        ball.velocity = {
          vx: ball.velocity.vx + 1.4,
          vy: ball.velocity.vy + 1.0,
          vz: ball.velocity.vz,
        };
      }
      return;
    }
    // Contested-shot check: a defender within BLOCK_RADIUS may block it.
    const defender = nearestTo(shooter.position, (p) => p.team !== shooter.team);
    if (
      defender !== null &&
      distance(defender.position.x, defender.position.y, shooter.position.x, shooter.position.y) <
        BLOCK_RADIUS_M &&
      possessionRng.bool(BLOCK_PROBABILITY)
    ) {
      blockShot(shooter, defender);
    }
    ball.freeOrigin = "shot";
  }

  function blockShot(shooter: SimPlayer, blocker: SimPlayer): void {
    // The block kills the shot: the ball is dead near the shooter.
    ball.possessedBy = null;
    ball.lastTouch = blocker.playerId;
    ball.passTarget = null;
    ball.position = { x: shooter.position.x, y: shooter.position.y, z: 2.1 };
    ball.velocity = {
      vx: possessionRng.range(-1.5, 1.5),
      vy: possessionRng.range(-1.5, 1.5),
      vz: 0.5,
    };
    ball.rimJudged = true;
    ball.freeOrigin = "block";
    pushEvent(tickIndex, "block", [blocker.playerId, "ball"]);
    // The v0 FOUL MODEL: a seeded fraction of contested blocks are ruled
    // shooting fouls — the shooter is awarded a free-throw from the line.
    if (possessionRng.bool(FOUL_ON_BLOCK_PROBABILITY)) {
      awardFreeThrow(shooter);
    }
  }

  function awardFreeThrow(shooter: SimPlayer): void {
    const lineX = opponentHoopX(shooter.team) > 0 ? FREE_THROW_X_M : -FREE_THROW_X_M;
    shooter.position = { x: lineX, y: 0 };
    shooter.velocity = { vx: 0, vy: 0 };
    ball.position = { x: lineX, y: 0, z: 1.6 };
    ball.possessedBy = shooter.playerId;
    ball.lastTouch = shooter.playerId;
    ball.holdTicks = 0;
    // The set shot fires at the START of the next tick (the free-throw event
    // kind records the ATTEMPT — see shoot(shooter, true)).
    pendingFreeThrowShooter = shooter.playerId;
  }

  let pendingFreeThrowShooter: string | null = null;

  function passTo(holder: SimPlayer): void {
    const mates = players.filter((p) => p.team === holder.team && p.playerId !== holder.playerId);
    if (mates.length === 0) return;
    // Directional play (deterministic): sort teammates by progress toward
    // the opponent basket and draw with a squared index — advanced
    // teammates are favored, so possession progresses.
    const goalX = opponentHoopX(holder.team);
    const sorted = [...mates].sort(
      (a, b) => Math.abs(goalX - b.position.x) - Math.abs(goalX - a.position.x),
    );
    const drawIndex = Math.min(
      sorted.length - 1,
      Math.floor(possessionRng.next() ** 2 * sorted.length),
    );
    const receiver = sorted[drawIndex];
    if (receiver === undefined) return;
    // Aim error: passes target the receiver's position plus seeded jitter —
    // loose passes can be intercepted by the marking defense.
    const aimX = receiver.position.x + possessionRng.normal(0, PASS_AIM_ERROR_M);
    const aimY = receiver.position.y + possessionRng.normal(0, PASS_AIM_ERROR_M);
    const dx = aimX - ball.position.x;
    const dy = aimY - ball.position.y;
    const dist = Math.hypot(dx, dy) || 1;
    ball.possessedBy = null;
    ball.lastTouch = holder.playerId;
    ball.passTarget = receiver.playerId;
    ball.velocity = {
      vx: (dx / dist) * PASS_SPEED_MPS,
      vy: (dy / dist) * PASS_SPEED_MPS,
      vz: 0.6,
    };
    ball.rimJudged = true;
    ball.freeOrigin = "pass";
    pushEvent(tickIndex, "pass", [holder.playerId, receiver.playerId, "ball"]);
  }

  function resolveOutOfBounds(): void {
    const x = ball.position.x;
    const y = ball.position.y;
    const outX = Math.abs(x) > COURT_HALF_LENGTH_M;
    const outY = Math.abs(y) > COURT_HALF_WIDTH_M;
    if (!outX && !outY) return;
    // Out of bounds: awarded to the team that did NOT touch last.
    const lastTeam = lastTouchTeam();
    const awarded: "home" | "away" = lastTeam === "home" ? "away" : "home";
    // Place the ball just inside the boundary for the awarded team.
    ball.position = {
      x: clamp(x, -COURT_HALF_LENGTH_M + 0.5, COURT_HALF_LENGTH_M - 0.5),
      y: clamp(y, -COURT_HALF_WIDTH_M + 0.5, COURT_HALF_WIDTH_M - 0.5),
      z: 1.2,
    };
    ball.velocity = { vx: 0, vy: 0, vz: 0 };
    ball.rimJudged = true;
    ball.freeOrigin = "loose";
    ball.lastTouch = null;
    const taker = nearestTo(ball.position, (p) => p.team === awarded);
    if (taker !== null) {
      pushEvent(tickIndex, "turnover", [taker.playerId, "ball"]);
      takePossession(taker);
    }
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

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  // -------------------------------------------------------------------------
  // World state + observations
  // -------------------------------------------------------------------------

  function worldState(clockMs: number, period: 1 | 2 | 3 | 4): BasketballWorldState {
    return {
      schemaVersion: "basketball-world-state/0.1",
      provenanceClass: LAB_SIMULATION_PROVENANCE,
      clockMs,
      period,
      players: players.map((player): BasketballPlayerState => ({
        playerId: player.playerId,
        team: player.team,
        jersey: player.jersey,
        role: player.role,
        position: { ...player.position },
        velocity: { ...player.velocity },
        onCourt: true,
        missing: false,
        confidence: 1,
      })),
      ball: {
        position: { ...ball.position },
        velocity: { ...ball.velocity },
        possessedBy: ball.possessedBy,
        confidence: 1,
      },
      officials: officials.map((official): BasketballOfficialState => ({
        officialId: official.officialId,
        role: official.role,
        position: { ...official.position },
        confidence: official.confidence,
      })),
      courtFrame: {
        frameId: "court" as const,
        lengthM: 28,
        widthM: 15,
        units: "meters" as const,
        origin: "center-court" as const,
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
    if (faultSchedule === undefined || faultSchedule === null) return 0;
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
  ): BasketballBroadcastFrameObservation {
    frameNumber += 1;
    const dropRate = clamp(profile.dropRate + droppedRateBoost, 0, 0.95);
    const dropped = broadcastRng.bool(dropRate);
    const visiblePlayers: BasketballBroadcastVisiblePlayer[] = players.map((player) => {
      const occluded = playerOccluded(player, tick);
      if (occluded) {
        return { playerId: player.playerId, box: null, occluded: true };
      }
      const jitterX = broadcastRng.normal(0, profile.broadcastJitterMeters);
      const jitterY = broadcastRng.normal(0, profile.broadcastJitterMeters);
      const boxX = clamp(
        (player.position.x + COURT_HALF_LENGTH_M) / COURT_LENGTH_M + jitterX,
        0,
        0.98,
      );
      const boxY = clamp(
        (COURT_HALF_WIDTH_M - player.position.y) / (COURT_HALF_WIDTH_M * 2) + jitterY,
        0,
        0.97,
      );
      return {
        playerId: player.playerId,
        box: { x: boxX, y: boxY, w: 0.03, h: 0.05 },
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
  ): BasketballTrackingSampleObservation[] {
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

  function publishDueEvents(tick: number, clockMs: number): BasketballEventRecordObservation[] {
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

  function makeTick(): BasketballSimulatedTick {
    tickIndex += 1;
    const clockMs = clockMsForTick(tickIndex);
    const quarterIndex = Math.min(3, Math.floor(clockMs / quarterMs));
    const period = (quarterIndex + 1) as 1 | 2 | 3 | 4;
    if (!initialJump.done) {
      initialJump.done = true;
      jumpBall(scenario.initialConditions.possessionTeam, tickIndex);
    } else if (!quarterJumpDone.has(quarterIndex) && quarterIndex > 0) {
      quarterJumpDone.add(quarterIndex);
      // Alternating possession at each later quarter's start.
      const first = scenario.initialConditions.possessionTeam;
      const awarded: "home" | "away" =
        quarterIndex % 2 === 1 ? (first === "home" ? "away" : "home") : first;
      jumpBall(awarded, tickIndex);
    }

    const active = faultSchedule ? activeFaultsAt(faultSchedule, tickIndex) : [];
    const appliedFaults: BasketballAppliedFault[] = active.map((entry) => ({
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

    // Free-throw set shot: fire the pending award at the tick start, as long
    // as the awarded shooter still holds the ball (a disrupted award clears
    // the pending honestly — the attempt event only records actual shots).
    if (pendingFreeThrowShooter !== null) {
      const shooterId = pendingFreeThrowShooter;
      pendingFreeThrowShooter = null;
      if (ball.possessedBy === shooterId) {
        const shooter = playerById(shooterId);
        if (shooter !== null) {
          shoot(shooter, true);
        }
      }
    }

    // Chase logic: the nearest defender pursues a free ball; the intended
    // pass receiver runs to meet the pass.
    const passReceiver =
      ball.possessedBy === null && ball.passTarget !== null
        ? (playerById(ball.passTarget) ?? null)
        : null;
    const carrier = ball.possessedBy !== null ? playerById(ball.possessedBy) : null;
    const offenseTeam = carrier !== null ? carrier.team : lastTouchTeam();
    const chaser =
      ball.possessedBy === null ? nearestTo(ball.position, (p) => p.team !== offenseTeam) : null;
    movePlayers(carrier, passReceiver, chaser);
    progressPossessionAndBall();

    const observations: BasketballObservation[] = [];
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
    step(): BasketballSimulatedTick {
      if (tickIndex + 1 >= tickCount) {
        throw new RangeError(`simulator exhausted: tick ${tickIndex + 1} of ${tickCount}`);
      }
      return makeTick();
    },
    *steps(): IterableIterator<BasketballSimulatedTick> {
      while (tickIndex + 1 < tickCount) {
        yield makeTick();
      }
    },
    ticks(): readonly BasketballSimulatedTick[] {
      const collected: BasketballSimulatedTick[] = [];
      for (const tick of this.steps()) collected.push(tick);
      return collected;
    },
  };
}

// ---------------------------------------------------------------------------
// The basketball DomainSimulationProfile (REL-032 seam implementation)
// ---------------------------------------------------------------------------

/**
 * The basketball implementation of the DomainSimulationProfile seam: the
 * basketball world simulator, the basketball identity ground truth, the
 * four-quarter period label, and the basketball default evaluator + reward
 * engine ("derived" defaults — the basketball profile's
 * `createLabEvaluator()` equals an explicit `createBasketballLabEvaluator()`).
 */
export const basketballDomainSimulationProfile: DomainSimulationProfile<
  BasketballScenarioRecord,
  BasketballSimulatedTick
> = {
  profileId: "basketball-simulation-profile",
  version: "0.1.0",
  domainPackId: "basketball",
  createSimulator(options: { scenario: BasketballScenarioRecord; faultSchedule?: FaultSchedule }) {
    return createBasketballWorldSimulator(options);
  },
  groundTruthEntityIds(tick: BasketballSimulatedTick): readonly string[] {
    return [...tick.groundTruth.players.map((player) => player.playerId), "ball"];
  },
  periodOf(tick: BasketballSimulatedTick): number {
    return tick.period;
  },
  createLabEvaluator(
    options: { rewardEngine?: ReturnType<typeof createBasketballRewardEngine> } = {},
  ) {
    return createBasketballLabEvaluator(options);
  },
  createRewardEngine() {
    return createBasketballRewardEngine();
  },
};
