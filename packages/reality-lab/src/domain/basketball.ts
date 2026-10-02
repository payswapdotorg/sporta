/**
 * The Basketball Domain Pack v0 (REL-032) — the SECOND real instance of the
 * §3 `DomainPack` seam, proving "Basketball, tennis, other sports, and
 * non-sport event domains must plug into this seam" (architecture §3,
 * acceptance gate REL-A9) without any change to generic lab/organization
 * code.
 *
 * What is real here (no stubs, football's v0 depth):
 * - entity types with identity semantics: PLAYER (persistent id; natural
 *   key team+jersey — basketball allows jersey 0), BALL (singular),
 *   OFFICIAL (persistent id, by role — three-person crew), COURT-FRAME
 *   (the singleton canonical spatial frame — 28m x 15m, center-court
 *   origin, +x toward away's basket, meters);
 * - observation taxonomy: broadcast-frame, tracking-sample, event-record
 *   (the same generic source roles as football — a broadcast camera, a
 *   tracking system, a delayed event feed — with basketball payloads);
 * - a zod world-state schema carrying positions, clock, FOUR QUARTERS,
 *   per-entity confidence and missingness, with `provenanceClass` PINNED
 *   to `lab-simulation` (the machine-checked "lab state is never
 *   production truth" law);
 * - an 8-event taxonomy — jump-ball, pass, shot, made-basket, block,
 *   rebound, turnover, free-throw — ALL reachable and measured in the
 *   simulator (../simulation/basketball-simulator, the discrete-correct
 *   rim-crossing physics);
 * - the six ADR-013 §8 hard invalidity rules via the shared factory
 *   (`createStandardHardInvalidityRules` — the extracted, byte-identical
 *   form of football's rules);
 * - the §8 reward dimensions (the same ten dimension ids and weights as
 *   football — the §8 list is domain-neutral);
 * - basketball fault profiles for the seeded schedule builder
 *   (../robustness/faults);
 * - replay + calibration adapters (the generic ./adapters);
 * - a seeded deterministic scenario generator (same seed ⇒ byte-identical
 *   record, the §3 scenario-generator law).
 *
 * What is deliberately v0 (honest): 5-on-court squads, simplified motion
 * (marking defense, patrol offense), a v0 foul model (a seeded fraction of
 * contested blocks award a free-throw — documented in the simulator), and
 * lab physics. The pack's contract shape is the point; the physics is
 * honest about being lab physics.
 */
import { z } from "zod";
import { LAB_SIMULATION_PROVENANCE } from "../provenance";
import type {
  ActionDescriptor,
  CapabilityDescriptor,
  DomainObservationBase,
  DomainPack,
  EntityTypeDescriptor,
  EventKindDescriptor,
  FaultProfile,
  HardInvalidityContext,
  HardInvalidityRule,
  HardInvalidityViolation,
  LabClaim,
  ObservationKindDescriptor,
  QualityEvaluatorRef,
  RenderTargetDescriptor,
  RewardDimension,
  ScenarioGenerator,
  ScenarioRecordBase,
} from "./domain-pack";
import { checkLabClaims, createStandardHardInvalidityRules } from "./domain-pack";
import { createListReplayAdapter, createMeanErrorCalibrationAdapter } from "./adapters";
import { contentId } from "../hash";
import { LabRng } from "../rng";
import { createLabEvaluator } from "../evaluation/evaluator";
import type { LabEvaluator } from "../evaluation/evaluator";
import { createRewardEngine, standardRewardWeightSets } from "../reward/engine";
import type { RewardEngine, RewardWeightSet } from "../reward/engine";
import {
  BASKETBALL_DOMAIN_PACK_ID,
  BASKETBALL_DOMAIN_PACK_VERSION,
  BASKETBALL_LAB_EVALUATOR_ID,
  BASKETBALL_LAB_EVALUATOR_VERSION,
} from "./basketball-ids";

export {
  BASKETBALL_DOMAIN_PACK_ID,
  BASKETBALL_DOMAIN_PACK_VERSION,
  BASKETBALL_LAB_EVALUATOR_ID,
  BASKETBALL_LAB_EVALUATOR_VERSION,
};

// ---------------------------------------------------------------------------
// Entity types and identity semantics (§3 bullet 1)
// ---------------------------------------------------------------------------

export const BASKETBALL_ENTITY_TYPES: readonly EntityTypeDescriptor[] = [
  {
    typeId: "player",
    description: "An on-court player of either side (five positions, any jersey 0-99).",
    identitySemantics: {
      persistentId: true,
      naturalKey: ["team", "jersey"],
      singular: false,
      notes:
        "A player carries a persistent playerId for the whole record " +
        "(home-<jersey> / away-<jersey>); (team, jersey) is the human natural key — " +
        "jersey 0 is legal in basketball. Re-identification across occlusion is an " +
        "INFERENCE by default — presenting an inferred identity as fact is a " +
        "hard-invalidity violation.",
    },
  },
  {
    typeId: "ball",
    description: "The game ball (there is exactly one).",
    identitySemantics: {
      persistentId: true,
      naturalKey: [],
      singular: true,
      notes: "Singular entity; the ball never needs re-identification, only tracking.",
    },
  },
  {
    typeId: "official",
    description: "A game official (three-person crew: crew chief and two umpires).",
    identitySemantics: {
      persistentId: true,
      naturalKey: ["role"],
      singular: false,
      notes: "Officials are identified by role within the record (crew-chief, umpire-1, umpire-2).",
    },
  },
  {
    typeId: "court-frame",
    description:
      "The canonical court frame: 28m x 15m, origin at center court, +x toward away's basket, +y toward away's left sideline, meters.",
    identitySemantics: {
      persistentId: true,
      naturalKey: [],
      singular: true,
      notes:
        "The singleton canonical spatial frame. Every position in the pack is expressed " +
        "in this frame; a renderer-specific frame is NEVER canonical truth.",
    },
  },
];

// ---------------------------------------------------------------------------
// Observation taxonomy (§3 bullet 3a) + typed payloads
// ---------------------------------------------------------------------------

export const BASKETBALL_OBSERVATION_TAXONOMY: readonly ObservationKindDescriptor[] = [
  {
    kindId: "broadcast-frame",
    description:
      "One broadcast video frame: normalized boxes for visible players + ball visibility, per camera.",
    carriesConfidence: true,
    canBeMissing: true,
    sourceRole: "broadcast",
  },
  {
    kindId: "tracking-sample",
    description: "One tracking sample: court-frame position + velocity for one player.",
    carriesConfidence: true,
    canBeMissing: true,
    sourceRole: "tracking",
  },
  {
    kindId: "event-record",
    description:
      "One event record published by the event source (delayed relative to world truth).",
    carriesConfidence: true,
    canBeMissing: false,
    sourceRole: "events",
  },
];

/** A player's appearance in a broadcast frame (box is null when occluded). */
export interface BasketballBroadcastVisiblePlayer {
  playerId: string;
  box: { x: number; y: number; w: number; h: number } | null;
  occluded: boolean;
}

export interface BasketballBroadcastFrameObservation extends DomainObservationBase {
  kindId: "broadcast-frame";
  payload: {
    cameraId: string;
    frameNumber: number;
    /** True when the frame was dropped in transport/processing (payload is then empty). */
    dropped: boolean;
    visiblePlayers: readonly BasketballBroadcastVisiblePlayer[];
    ballVisible: boolean;
  };
}

export interface BasketballTrackingSampleObservation extends DomainObservationBase {
  kindId: "tracking-sample";
  payload: {
    playerId: string;
    position: { x: number; y: number };
    velocity: { vx: number; vy: number };
    /** True when the sample is absent for this tick (occlusion/ dropout). */
    missing: boolean;
  };
}

export interface BasketballEventRecordObservation extends DomainObservationBase {
  kindId: "event-record";
  payload: {
    eventId: string;
    eventKindId: string;
    participants: readonly string[];
    /** The tick at which the event source published this record (>= the event tick). */
    publishedAtTick: number;
  };
}

export type BasketballObservation =
  | BasketballBroadcastFrameObservation
  | BasketballTrackingSampleObservation
  | BasketballEventRecordObservation;

// ---------------------------------------------------------------------------
// Event taxonomy (§3 bullet 3b) + the ground-truth sim event
// ---------------------------------------------------------------------------

/**
 * The 8-event basketball taxonomy — every kind is REACHABLE and MEASURED in
 * the simulator (the basketball-lab tests count one of each per pinned
 * seed): jump-ball (each quarter start), pass, shot, made-basket (the
 * discrete-correct rim crossing), block (a contested shot), rebound (a
 * recovered miss), turnover (an intercepted pass or out-of-bounds award),
 * free-throw (the v0 foul model: a seeded fraction of contested blocks).
 */
export const BASKETBALL_EVENT_TAXONOMY: readonly EventKindDescriptor[] = [
  {
    eventKindId: "jump-ball",
    description: "Start or restart of a quarter (controlled possession award).",
    participantEntityTypes: ["player", "ball"],
  },
  {
    eventKindId: "pass",
    description: "A player passes the ball to a teammate.",
    participantEntityTypes: ["player", "ball"],
  },
  {
    eventKindId: "shot",
    description: "A player shoots at the opponent's basket.",
    participantEntityTypes: ["player", "ball"],
  },
  {
    eventKindId: "made-basket",
    description: "The ball descends through the rim cylinder from above (a score).",
    participantEntityTypes: ["player", "ball"],
  },
  {
    eventKindId: "block",
    description: "A defender blocks an opponent's shot before it reaches the rim.",
    participantEntityTypes: ["player", "ball"],
  },
  {
    eventKindId: "rebound",
    description: "A free ball is recovered after a missed shot or a block.",
    participantEntityTypes: ["player", "ball"],
  },
  {
    eventKindId: "turnover",
    description: "Possession changes without a basket (intercepted pass or out-of-bounds award).",
    participantEntityTypes: ["player", "ball"],
  },
  {
    eventKindId: "free-throw",
    description: "An uncontested set shot from the free-throw line, awarded after a foul.",
    participantEntityTypes: ["player", "ball"],
  },
];

/** A ground-truth event produced by the simulator (lab-simulation world truth). */
export interface BasketballSimEvent {
  eventId: string;
  eventKindId: string;
  tickIndex: number;
  clockMs: number;
  participants: readonly string[];
  provenanceClass: typeof LAB_SIMULATION_PROVENANCE;
}

// ---------------------------------------------------------------------------
// World-state schema (§3 bullet 2)
// ---------------------------------------------------------------------------

const positionField = z.object({ x: z.number(), y: z.number() });
const velocityField = z.object({ vx: z.number(), vy: z.number() });
const confidenceField = z.number().min(0).max(1);

export const BasketballPlayerStateSchema = z.object({
  playerId: z.string().min(1),
  team: z.enum(["home", "away"]),
  /** Basketball allows jersey 0. */
  jersey: z.number().int().min(0).max(99),
  /** The five basketball positions. */
  role: z.enum(["pg", "sg", "sf", "pf", "c"]),
  position: positionField,
  velocity: velocityField,
  onCourt: z.boolean(),
  /**
   * Missingness: true when the entity's state is UNKNOWN to the state's
   * producer for this instant (occlusion, dropout). Ground truth fills
   * `false` everywhere; reconstructed/partial world states express their
   * gaps through the same field.
   */
  missing: z.boolean(),
  /** Per-entity source confidence in [0, 1] (missingness-aware). */
  confidence: confidenceField,
});

export const BasketballBallStateSchema = z.object({
  position: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  velocity: z.object({ vx: z.number(), vy: z.number(), vz: z.number() }),
  possessedBy: z.string().nullable(),
  confidence: confidenceField,
});

export const BasketballOfficialStateSchema = z.object({
  officialId: z.string().min(1),
  role: z.enum(["crew-chief", "umpire-1", "umpire-2"]),
  position: positionField,
  confidence: confidenceField,
});

export const BasketballCourtFrameSchema = z.object({
  frameId: z.literal("court"),
  lengthM: z.literal(28),
  widthM: z.literal(15),
  units: z.literal("meters"),
  origin: z.literal("center-court"),
});

export const BasketballWorldStateSchema = z.object({
  schemaVersion: z.literal("basketball-world-state/0.1"),
  /** PINNED: simulator world state is lab-simulation, never production truth. */
  provenanceClass: z.literal(LAB_SIMULATION_PROVENANCE),
  clockMs: z.number().int().min(0),
  /** The quarter (1..4) — the pack's period/phase label semantics. */
  period: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  players: z.array(BasketballPlayerStateSchema),
  ball: BasketballBallStateSchema,
  officials: z.array(BasketballOfficialStateSchema),
  courtFrame: BasketballCourtFrameSchema,
});

export type BasketballPlayerState = z.infer<typeof BasketballPlayerStateSchema>;
export type BasketballBallState = z.infer<typeof BasketballBallStateSchema>;
export type BasketballOfficialState = z.infer<typeof BasketballOfficialStateSchema>;
export type BasketballWorldState = z.infer<typeof BasketballWorldStateSchema>;

// ---------------------------------------------------------------------------
// Action space, capabilities, render targets, evaluator refs (§3 bullets 4–7)
// ---------------------------------------------------------------------------

export const BASKETBALL_ACTION_SPACE: readonly ActionDescriptor[] = [
  {
    actionId: "emit-canonical-event",
    description:
      "Promote an observed event record to a canonical event claim, with evidence references.",
  },
  {
    actionId: "emit-identity-assertion",
    description: "Assert an identity for an observed entity, as fact or as inference.",
  },
  {
    actionId: "request-render",
    description: "Request rendering of the world toward one declared render target.",
  },
  {
    actionId: "escalate-uncertainty",
    description: "Flag low confidence / missingness for human or downstream review.",
  },
];

export const BASKETBALL_CAPABILITIES: readonly CapabilityDescriptor[] = [
  {
    capabilityId: "perception.broadcast-frame-ingest",
    version: "0.1.0",
    description: "Ingest and normalize broadcast frames.",
  },
  {
    capabilityId: "perception.tracking-ingest",
    version: "0.1.0",
    description: "Ingest and normalize tracking samples.",
  },
  {
    capabilityId: "event.fusion",
    version: "0.1.0",
    description: "Fuse event records into canonical event claims.",
  },
  {
    capabilityId: "identity.resolution",
    version: "0.1.0",
    description: "Resolve observed entities to persistent identities.",
  },
  {
    capabilityId: "render.tactical",
    version: "0.1.0",
    description: "Render the tactical 2D view.",
  },
  {
    capabilityId: "render.anime-npr",
    version: "0.1.0",
    description: "Render the anime non-photorealistic view.",
  },
  {
    capabilityId: "render.three-d-game",
    version: "0.1.0",
    description: "Render the 3D game view.",
  },
  {
    capabilityId: "render.original",
    version: "0.1.0",
    description: "Pass through the original source view.",
  },
];

export const BASKETBALL_RENDER_TARGETS: readonly RenderTargetDescriptor[] = [
  { targetId: "tactical", description: "2D tactical top-down view of the court frame." },
  { targetId: "anime-npr", description: "Anime non-photorealistic transformation." },
  { targetId: "three-d-game", description: "3D game-style rendering." },
  { targetId: "original", description: "Original source presentation (no transformation)." },
];

export const BASKETBALL_REWARD_DIMENSIONS: readonly RewardDimension[] = [
  {
    dimensionId: "event-source-fidelity",
    description: "Emitted canonical events match observed evidence.",
    weight: 1.0,
  },
  {
    dimensionId: "identity-continuity",
    description: "Identity assertions track real persistent identities.",
    weight: 1.0,
  },
  {
    dimensionId: "temporal-consistency",
    description: "Decisions follow observations without unexplained gaps.",
    weight: 0.75,
  },
  {
    dimensionId: "motion-fidelity",
    description: "Reconstructed motion matches world motion (renderer-in-the-loop; REL-007).",
    weight: 0.5,
  },
  {
    dimensionId: "camera-scene-correctness",
    description: "Camera/scene geometry correctness (REL-007).",
    weight: 0.5,
  },
  {
    dimensionId: "stylization-quality",
    description: "Stylization quality for NPR targets (REL-007).",
    weight: 0.5,
  },
  {
    dimensionId: "latency",
    description: "Simulated decision latency against the body's latency limits.",
    weight: 0.5,
  },
  {
    dimensionId: "cost",
    description: "Simulated cost against the organization budget.",
    weight: 0.5,
  },
  {
    dimensionId: "reliability",
    description: "Outputs keep flowing under injected faults.",
    weight: 0.75,
  },
  {
    dimensionId: "compute-usage",
    description: "Model invocations against allowed call budgets.",
    weight: 0.5,
  },
];

export const BASKETBALL_QUALITY_EVALUATORS: readonly QualityEvaluatorRef[] = [
  {
    evaluatorId: BASKETBALL_LAB_EVALUATOR_ID,
    version: BASKETBALL_LAB_EVALUATOR_VERSION,
    rewardDimensionIds: BASKETBALL_REWARD_DIMENSIONS.map((dimension) => dimension.dimensionId),
  },
];

// ---------------------------------------------------------------------------
// Hard invalidity rules (§3 bullet 8, ADR-013 §8) — the shared factory
// ---------------------------------------------------------------------------

/**
 * The six ADR-013 §8 hard invalidity rules for basketball, built through
 * the shared domain-neutral factory (`createStandardHardInvalidityRules`)
 * — the SAME rule objects football uses, so both packs' hard-gate
 * behavior is identical by construction.
 */
export const BASKETBALL_HARD_INVALIDITY_RULES: readonly HardInvalidityRule[] =
  createStandardHardInvalidityRules();

/** Run every rule over one claim; all firing violations, in rule order. */
export function checkBasketballClaims(
  claims: readonly LabClaim[],
  context: HardInvalidityContext,
): HardInvalidityViolation[] {
  return checkLabClaims(claims, BASKETBALL_HARD_INVALIDITY_RULES, context);
}

// ---------------------------------------------------------------------------
// Fault profiles (§3 bullet 10b — the seeded schedule builder is REL-003)
// ---------------------------------------------------------------------------

export const BASKETBALL_FAULT_PROFILES: readonly FaultProfile[] = [
  {
    profileId: "basketball-clean",
    description: "No injected faults — the clean baseline profile.",
    rates: {
      "compute-provider-failure": 0,
      "source-disagreement": 0,
      occlusion: 0,
      "processing-latency": 0,
      "dropped-frames": 0,
    },
    params: {},
  },
  {
    profileId: "basketball-noisy-broadcast",
    description: "A realistic broadcast environment: frame drops and latency spikes.",
    rates: {
      "compute-provider-failure": 0,
      "source-disagreement": 0,
      occlusion: 0,
      "processing-latency": 0.05,
      "dropped-frames": 0.04,
    },
    params: {
      "processing-latency": { latencyMs: 300, durationTicks: 5 },
      "dropped-frames": { dropRateBoost: 0.25, durationTicks: 4 },
    },
  },
  {
    profileId: "basketball-adversarial",
    description: "All five fault kinds at meaningful rates — the robustness stress profile.",
    rates: {
      "compute-provider-failure": 0.01,
      "source-disagreement": 0.03,
      occlusion: 0.04,
      "processing-latency": 0.06,
      "dropped-frames": 0.05,
    },
    params: {
      "compute-provider-failure": { durationTicks: 3 },
      "source-disagreement": { disagreementMeters: 0.8, durationTicks: 6 },
      occlusion: { occlusionRadiusM: 3.5, durationTicks: 5 },
      "processing-latency": { latencyMs: 500, durationTicks: 4 },
      "dropped-frames": { dropRateBoost: 0.3, durationTicks: 4 },
    },
  },
];

// ---------------------------------------------------------------------------
// The seeded deterministic scenario generator (§3 bullet 10a)
// ---------------------------------------------------------------------------

export const BasketballScenarioConfigSchema = z.object({
  /** Total simulated game duration (all four quarters), in simulated ms. */
  matchDurationMs: z.number().int().min(10_000).max(3_600_000).default(600_000),
  /** Simulator tick length in simulated ms. */
  tickMs: z.number().int().min(40).max(1_000).default(100),
  /** On-court squad size per side (v0 lab default: 5-on-court). */
  playersPerSide: z.number().int().min(1).max(5).default(5),
  /** Source quality profile (drives simulator noise/confidence/missingness). */
  sourceProfile: z.enum(["clean", "noisy-broadcast", "degraded"]).default("clean"),
  competitionLabel: z.string().min(1).default("lab-friendly"),
});

export type BasketballScenarioConfig = z.infer<typeof BasketballScenarioConfigSchema>;

/** A player's deterministic initial condition. */
export interface BasketballScenarioPlayer {
  playerId: string;
  team: "home" | "away";
  jersey: number;
  role: "pg" | "sg" | "sf" | "pf" | "c";
  position: { x: number; y: number };
}

export interface BasketballScenarioRecord extends ScenarioRecordBase<BasketballScenarioConfig> {
  domainPackId: typeof BASKETBALL_DOMAIN_PACK_ID;
  domainPackVersion: string;
  config: BasketballScenarioConfig;
  initialConditions: {
    /** The side awarded the first possession (the seeded jump-ball decision). */
    possessionTeam: "home" | "away";
    players: readonly BasketballScenarioPlayer[];
    ball: { position: { x: number; y: number; z: number } };
    officials: readonly { officialId: string; role: string; position: { x: number; y: number } }[];
    expectedTickCount: number;
  };
}

/** The five basketball positions, in slot order (pg..c). */
const ROLE_ORDER: readonly BasketballScenarioPlayer["role"][] = ["pg", "sg", "sf", "pf", "c"];

function roleForSlot(slot: number, playersPerSide: number): BasketballScenarioPlayer["role"] {
  const index = slot % Math.max(1, playersPerSide);
  return ROLE_ORDER[index] ?? "sf";
}

/**
 * Deterministic formation: each side occupies its half in three lanes at
 * depths spread from the perimeter to the post; jersey = slot (0-based so
 * jersey 0 is legal), ids `home-<slot>` / `away-<slot>`.
 */
function formationForSide(
  team: "home" | "away",
  playersPerSide: number,
): BasketballScenarioPlayer[] {
  const sign = team === "home" ? -1 : 1;
  const players: BasketballScenarioPlayer[] = [];
  for (let slot = 0; slot < playersPerSide; slot++) {
    const role = roleForSlot(slot, playersPerSide);
    const depth = (slot + 1) / Math.max(1, playersPerSide); // 0..1 across the half
    const lane = slot % 3 === 0 ? -1 : slot % 3 === 1 ? 0 : 1;
    const x = sign * (2.5 + 9.5 * depth);
    const y = lane * 4.5;
    players.push({
      playerId: `${team}-${slot}`,
      team,
      jersey: slot,
      role,
      position: { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 },
    });
  }
  return players;
}

function parseConfig(overrides?: Partial<BasketballScenarioConfig>): BasketballScenarioConfig {
  const parsed = BasketballScenarioConfigSchema.safeParse(overrides ?? {});
  if (!parsed.success) {
    throw new RangeError(`basketball scenario config invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * The basketball scenario generator: `generate(seed, overrides?)` — SAME
 * SEED ⇒ byte-identical record (the test suite pins this by string
 * equality). The single stochastic decision (which side is awarded the
 * first possession) flows from a fork of the master seed.
 */
export const basketballScenarioGenerator: ScenarioGenerator<
  BasketballScenarioRecord,
  BasketballScenarioConfig
> = {
  generate(seed: string, overrides?: Partial<BasketballScenarioConfig>): BasketballScenarioRecord {
    const config = parseConfig(overrides);
    const possessionTeam = new LabRng(`${seed}::possession`).bool() ? "home" : "away";
    const players = [
      ...formationForSide("home", config.playersPerSide),
      ...formationForSide("away", config.playersPerSide),
    ];
    const record: BasketballScenarioRecord = {
      scenarioId: "", // content-derived below (config defaults already applied)
      domainPackId: BASKETBALL_DOMAIN_PACK_ID,
      domainPackVersion: BASKETBALL_DOMAIN_PACK_VERSION,
      seed,
      config,
      initialConditions: {
        possessionTeam,
        players,
        ball: { position: { x: 0, y: 0, z: 1.95 } },
        officials: [
          { officialId: "official-crew-chief", role: "crew-chief", position: { x: 0, y: 2 } },
          { officialId: "official-umpire-1", role: "umpire-1", position: { x: -7, y: 7.2 } },
          { officialId: "official-umpire-2", role: "umpire-2", position: { x: 7, y: -7.2 } },
        ],
        expectedTickCount: Math.ceil(config.matchDurationMs / config.tickMs),
      },
    };
    record.scenarioId = contentId({
      generator: "basketball-scenario/0.1",
      domainPackId: record.domainPackId,
      domainPackVersion: record.domainPackVersion,
      seed,
      config: {
        matchDurationMs: config.matchDurationMs,
        tickMs: config.tickMs,
        playersPerSide: config.playersPerSide,
        sourceProfile: config.sourceProfile,
        competitionLabel: config.competitionLabel,
      },
      possessionTeam,
    });
    return record;
  },
};

/** Convenience: generate a basketball scenario in one call. */
export function generateBasketballScenario(
  seed: string,
  overrides?: Partial<BasketballScenarioConfig>,
): BasketballScenarioRecord {
  return basketballScenarioGenerator.generate(seed, overrides);
}

// ---------------------------------------------------------------------------
// The pack instance + the basketball evaluation wiring
// ---------------------------------------------------------------------------

/** The typed basketball instantiation of the §3 DomainPack seam. */
export type BasketballDomainPack = DomainPack<
  BasketballWorldState,
  BasketballObservation,
  BasketballScenarioConfig,
  BasketballScenarioRecord
>;

/** `BasketballDomainPack` also accepts the pack's observation base type in the replay adapter. */
export const basketballDomainPack: BasketballDomainPack = {
  domainPackId: BASKETBALL_DOMAIN_PACK_ID,
  version: BASKETBALL_DOMAIN_PACK_VERSION,
  entityTypes: BASKETBALL_ENTITY_TYPES,
  worldStateSchema: BasketballWorldStateSchema,
  observationTaxonomy: BASKETBALL_OBSERVATION_TAXONOMY,
  eventTaxonomy: BASKETBALL_EVENT_TAXONOMY,
  actionSpace: BASKETBALL_ACTION_SPACE,
  capabilities: BASKETBALL_CAPABILITIES,
  renderTargets: BASKETBALL_RENDER_TARGETS,
  qualityEvaluators: BASKETBALL_QUALITY_EVALUATORS,
  hardInvalidityRules: BASKETBALL_HARD_INVALIDITY_RULES,
  rewardDimensions: BASKETBALL_REWARD_DIMENSIONS,
  scenarioGenerator: basketballScenarioGenerator,
  faultProfiles: BASKETBALL_FAULT_PROFILES,
  replayAdapter: createListReplayAdapter("basketball-list-replay/0.1"),
  calibrationAdapter: createMeanErrorCalibrationAdapter("basketball-mean-error-calibration/0.1"),
};

// ---------------------------------------------------------------------------
// The basketball reward engine + evaluator (the generic factories, basketball-bound)
// ---------------------------------------------------------------------------

/**
 * The versioned basketball weight sets (the standard three-set family —
 * balanced / quality-first / efficiency-first — bound to the basketball
 * pack's declared dimensions).
 */
export function basketballRewardWeightSets(
  dimensions: readonly RewardDimension[] = BASKETBALL_REWARD_DIMENSIONS,
): readonly RewardWeightSet[] {
  return standardRewardWeightSets("basketball", dimensions);
}

/** The versioned basketball weight sets over the pack's declared dimensions. */
export const BASKETBALL_REWARD_WEIGHT_SETS: readonly RewardWeightSet[] =
  basketballRewardWeightSets();

/** The basketball reward engine: the pack's dimensions + the three weight sets. */
export function createBasketballRewardEngine(): RewardEngine {
  return createRewardEngine({
    dimensions: BASKETBALL_REWARD_DIMENSIONS,
    weightSets: BASKETBALL_REWARD_WEIGHT_SETS,
    defaultWeightSetId: "basketball-balanced",
  });
}

/**
 * The basketball lab evaluator: the generic `createLabEvaluator` logic with
 * the basketball evaluator identity and reward engine — the same seven
 * measured dimensions, three honest not-measured markers, hard gates as
 * typed refusals, and per-run `RewardRecord` as the football evaluator.
 */
export function createBasketballLabEvaluator(
  options: { rewardEngine?: RewardEngine } = {},
): LabEvaluator {
  return createLabEvaluator({
    evaluatorId: BASKETBALL_LAB_EVALUATOR_ID,
    version: BASKETBALL_LAB_EVALUATOR_VERSION,
    dimensions: BASKETBALL_REWARD_DIMENSIONS,
    rewardEngine: options.rewardEngine ?? createBasketballRewardEngine(),
  });
}
