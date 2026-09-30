/**
 * The Football Domain Pack v0 (REL-001) — the FIRST real instance of the
 * §3 `DomainPack` seam.
 *
 * What is real here (no stubs):
 * - entity types with identity semantics: PLAYER (persistent id; natural
 *   key team+jersey), BALL (singular), OFFICIAL (persistent id, by role),
 *   PITCH-FRAME (the singleton canonical spatial frame — 105m x 68m,
 *   center-spot origin, meters);
 * - observation taxonomy: broadcast-frame, tracking-sample, event-record;
 * - a zod world-state schema carrying positions, clock, per-entity
 *   confidence and missingness, with `provenanceClass` PINNED to
 *   `lab-simulation` (the machine-checked "lab state is never production
 *   truth" law);
 * - the ADR-013 §8 hard invalidity rules as pure check functions over the
 *   `LabClaim` model: fabricated canonical event, fabricated identity
 *   presented as fact, rights/policy violation, impossible output claim,
 *   provenance bypass, invalid artifact lineage;
 * - the §8 reward dimensions (the full reward engine is REL-007 — a later
 *   slice; here they are declared, weighted and v0-measured where evidence
 *   exists);
 * - football fault profiles for REL-003's seeded schedule builder;
 * - replay + calibration adapters (see ./adapters).
 *
 * What is deliberately v0: 7-a-side default squads, simplified motion and
 * event progression (the simulator's job — ./world-simulator), and a
 * 4-action organization action space. The pack's contract shape is the
 * point; the physics is honest about being lab physics.
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
} from "./domain-pack";
import { createListReplayAdapter, createMeanErrorCalibrationAdapter } from "./adapters";
import { footballScenarioGenerator } from "./scenario";
import type { FootballScenarioConfig, FootballScenarioRecord } from "./scenario";
import {
  FOOTBALL_DOMAIN_PACK_ID,
  FOOTBALL_DOMAIN_PACK_VERSION,
  FOOTBALL_LAB_EVALUATOR_ID,
  FOOTBALL_LAB_EVALUATOR_VERSION,
} from "./football-ids";

export {
  FOOTBALL_DOMAIN_PACK_ID,
  FOOTBALL_DOMAIN_PACK_VERSION,
  FOOTBALL_LAB_EVALUATOR_ID,
  FOOTBALL_LAB_EVALUATOR_VERSION,
};

// ---------------------------------------------------------------------------
// Entity types and identity semantics (§3 bullet 1)
// ---------------------------------------------------------------------------

export const FOOTBALL_ENTITY_TYPES: readonly EntityTypeDescriptor[] = [
  {
    typeId: "player",
    description: "An on-pitch player of either side (including goalkeepers).",
    identitySemantics: {
      persistentId: true,
      naturalKey: ["team", "jersey"],
      singular: false,
      notes:
        "A player carries a persistent playerId for the whole record " +
        "(home-<jersey> / away-<jersey>); (team, jersey) is the human natural key. " +
        "Re-identification across occlusion is an INFERENCE by default — presenting " +
        "an inferred identity as fact is a hard-invalidity violation.",
    },
  },
  {
    typeId: "ball",
    description: "The match ball (there is exactly one).",
    identitySemantics: {
      persistentId: true,
      naturalKey: [],
      singular: true,
      notes: "Singular entity; the ball never needs re-identification, only tracking.",
    },
  },
  {
    typeId: "official",
    description: "A match official (referee, assistants, fourth official).",
    identitySemantics: {
      persistentId: true,
      naturalKey: ["role"],
      singular: false,
      notes: "Officials are identified by role within the record (referee, assistant-1, ...).",
    },
  },
  {
    typeId: "pitch-frame",
    description:
      "The canonical pitch frame: 105m x 68m, origin at the center spot, +x toward away's goal, +y toward away's left touchline, meters.",
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

export const FOOTBALL_OBSERVATION_TAXONOMY: readonly ObservationKindDescriptor[] = [
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
    description: "One tracking sample: pitch-frame position + velocity for one player.",
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
export interface FootballBroadcastVisiblePlayer {
  playerId: string;
  box: { x: number; y: number; w: number; h: number } | null;
  occluded: boolean;
}

export interface FootballBroadcastFrameObservation extends DomainObservationBase {
  kindId: "broadcast-frame";
  payload: {
    cameraId: string;
    frameNumber: number;
    /** True when the frame was dropped in transport/processing (payload is then empty). */
    dropped: boolean;
    visiblePlayers: readonly FootballBroadcastVisiblePlayer[];
    ballVisible: boolean;
  };
}

export interface FootballTrackingSampleObservation extends DomainObservationBase {
  kindId: "tracking-sample";
  payload: {
    playerId: string;
    position: { x: number; y: number };
    velocity: { vx: number; vy: number };
    /** True when the sample is absent for this tick (occlusion/ dropout). */
    missing: boolean;
  };
}

export interface FootballEventRecordObservation extends DomainObservationBase {
  kindId: "event-record";
  payload: {
    eventId: string;
    eventKindId: string;
    participants: readonly string[];
    /** The tick at which the event source published this record (>= the event tick). */
    publishedAtTick: number;
  };
}

export type FootballObservation =
  | FootballBroadcastFrameObservation
  | FootballTrackingSampleObservation
  | FootballEventRecordObservation;

// ---------------------------------------------------------------------------
// Event taxonomy (§3 bullet 3b) + the ground-truth sim event
// ---------------------------------------------------------------------------

export const FOOTBALL_EVENT_TAXONOMY: readonly EventKindDescriptor[] = [
  {
    eventKindId: "kickoff",
    description: "Start or restart of play.",
    participantEntityTypes: ["player", "ball"],
  },
  {
    eventKindId: "pass",
    description: "A player plays the ball to a teammate.",
    participantEntityTypes: ["player", "ball"],
  },
  {
    eventKindId: "shot",
    description: "A player shoots at the opponent's goal.",
    participantEntityTypes: ["player", "ball"],
  },
  {
    eventKindId: "goal",
    description: "The ball fully crosses the goal line between the posts.",
    participantEntityTypes: ["player", "ball"],
  },
  {
    eventKindId: "save",
    description: "The goalkeeper prevents a shot from becoming a goal.",
    participantEntityTypes: ["player", "ball"],
  },
  {
    eventKindId: "throw-in",
    description: "The ball leaves the pitch over a touchline.",
    participantEntityTypes: ["player", "ball"],
  },
  {
    eventKindId: "goal-kick",
    description: "The ball leaves the pitch over a goal line (not a goal).",
    participantEntityTypes: ["player", "ball"],
  },
  {
    eventKindId: "recovery",
    description: "A free ball is brought under control.",
    participantEntityTypes: ["player", "ball"],
  },
];

/** A ground-truth event produced by the simulator (lab-simulation world truth). */
export interface FootballSimEvent {
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

export const FootballPlayerStateSchema = z.object({
  playerId: z.string().min(1),
  team: z.enum(["home", "away"]),
  jersey: z.number().int().min(1).max(99),
  role: z.enum(["gk", "df", "mf", "fw"]),
  position: positionField,
  velocity: velocityField,
  onPitch: z.boolean(),
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

export const FootballBallStateSchema = z.object({
  position: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  velocity: z.object({ vx: z.number(), vy: z.number(), vz: z.number() }),
  possessedBy: z.string().nullable(),
  confidence: confidenceField,
});

export const FootballOfficialStateSchema = z.object({
  officialId: z.string().min(1),
  role: z.enum(["referee", "assistant-1", "assistant-2", "fourth"]),
  position: positionField,
  confidence: confidenceField,
});

export const FootballPitchFrameSchema = z.object({
  frameId: z.literal("pitch"),
  lengthM: z.literal(105),
  widthM: z.literal(68),
  units: z.literal("meters"),
  origin: z.literal("center-spot"),
});

export const FootballWorldStateSchema = z.object({
  schemaVersion: z.literal("football-world-state/0.1"),
  /** PINNED: simulator world state is lab-simulation, never production truth. */
  provenanceClass: z.literal(LAB_SIMULATION_PROVENANCE),
  clockMs: z.number().int().min(0),
  period: z.union([z.literal(1), z.literal(2)]),
  players: z.array(FootballPlayerStateSchema),
  ball: FootballBallStateSchema,
  officials: z.array(FootballOfficialStateSchema),
  pitchFrame: FootballPitchFrameSchema,
});

export type FootballPlayerState = z.infer<typeof FootballPlayerStateSchema>;
export type FootballBallState = z.infer<typeof FootballBallStateSchema>;
export type FootballOfficialState = z.infer<typeof FootballOfficialStateSchema>;
export type FootballWorldState = z.infer<typeof FootballWorldStateSchema>;

// ---------------------------------------------------------------------------
// Action space, capabilities, render targets, evaluator refs (§3 bullets 4–7)
// ---------------------------------------------------------------------------

export const FOOTBALL_ACTION_SPACE: readonly ActionDescriptor[] = [
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

export const FOOTBALL_CAPABILITIES: readonly CapabilityDescriptor[] = [
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

export const FOOTBALL_RENDER_TARGETS: readonly RenderTargetDescriptor[] = [
  { targetId: "tactical", description: "2D tactical top-down view of the pitch frame." },
  { targetId: "anime-npr", description: "Anime non-photorealistic transformation." },
  { targetId: "three-d-game", description: "3D game-style rendering." },
  { targetId: "original", description: "Original source presentation (no transformation)." },
];

export const FOOTBALL_REWARD_DIMENSIONS: readonly RewardDimension[] = [
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

export const FOOTBALL_QUALITY_EVALUATORS: readonly QualityEvaluatorRef[] = [
  {
    evaluatorId: FOOTBALL_LAB_EVALUATOR_ID,
    version: FOOTBALL_LAB_EVALUATOR_VERSION,
    rewardDimensionIds: FOOTBALL_REWARD_DIMENSIONS.map((dimension) => dimension.dimensionId),
  },
];

// ---------------------------------------------------------------------------
// Hard invalidity rules (§3 bullet 8, ADR-013 §8) — pure functions over LabClaim
// ---------------------------------------------------------------------------

/** Rule 1 — fabricated canonical event: an event claim without received evidence. */
const fabricatedCanonicalEventRule: HardInvalidityRule = {
  ruleId: "fabricated-canonical-event",
  description:
    "A canonical event emitted with no (or not-yet-received) supporting observation. " +
    "Events the organization did not receive as evidence are fabrications.",
  check(claim: LabClaim, context: HardInvalidityContext): HardInvalidityViolation | null {
    if (claim.claimKind !== "canonical-event") return null;
    const unknown = claim.evidenceRefs.filter((ref) => !context.knownEvidenceRefs.has(ref));
    if (claim.evidenceRefs.length === 0 || unknown.length > 0) {
      return {
        ruleId: this.ruleId,
        claimId: claim.claimId,
        reason:
          claim.evidenceRefs.length === 0
            ? "canonical event emitted with ZERO evidence references"
            : `canonical event cites evidence the run never provided: ${unknown.join(", ")}`,
        evidence: { eventKindId: claim.eventKindId, unknownEvidenceRefs: [...unknown] },
      };
    }
    return null;
  },
};

/** Rule 2 — fabricated identity presented as fact. */
const fabricatedIdentityRule: HardInvalidityRule = {
  ruleId: "fabricated-identity-as-fact",
  description:
    "An identity inferred (or without evidence) but PRESENTED AS FACT. Inference is " +
    "legitimate; laundering inference into fact is a hard-invalidity violation.",
  check(claim: LabClaim): HardInvalidityViolation | null {
    if (claim.claimKind !== "identity-assertion") return null;
    const inferringAsFact = claim.presentedAs === "fact" && claim.basis === "inferred";
    const factWithoutEvidence = claim.presentedAs === "fact" && claim.evidenceRefs.length === 0;
    if (inferringAsFact || factWithoutEvidence) {
      return {
        ruleId: this.ruleId,
        claimId: claim.claimId,
        reason: inferringAsFact
          ? `identity for ${claim.entityId} was INFERRED but presented as fact`
          : `identity for ${claim.entityId} presented as fact without any evidence`,
        evidence: { entityId: claim.entityId, presentedAs: claim.presentedAs, basis: claim.basis },
      };
    }
    return null;
  },
};

/** Rule 3 — violation of declared rights/policy. */
const rightsPolicyRule: HardInvalidityRule = {
  ruleId: "rights-policy-violation",
  description:
    "An output claim produced without a declared rights basis. Transformation without " +
    "a declared basis violates the rights first-class boundary.",
  check(claim: LabClaim): HardInvalidityViolation | null {
    if (claim.claimKind !== "output-claim") return null;
    if (claim.rightsBasis === null || claim.rightsBasis.length === 0) {
      return {
        ruleId: this.ruleId,
        claimId: claim.claimId,
        reason: `output claim for target ${claim.renderTargetId} carries NO rights basis`,
        evidence: { renderTargetId: claim.renderTargetId, rightsBasis: claim.rightsBasis },
      };
    }
    return null;
  },
};

/** Rule 4 — impossible/unsupported output claim. */
const impossibleOutputRule: HardInvalidityRule = {
  ruleId: "impossible-output-claim",
  description:
    "A claim of an output the pack cannot produce (undeclared render target) or at a " +
    "clock time outside the scenario duration.",
  check(claim: LabClaim, context: HardInvalidityContext): HardInvalidityViolation | null {
    if (claim.claimKind === "output-claim") {
      if (!context.renderTargetIds.includes(claim.renderTargetId)) {
        return {
          ruleId: this.ruleId,
          claimId: claim.claimId,
          reason: `render target ${claim.renderTargetId} is not declared by the domain pack`,
          evidence: {
            renderTargetId: claim.renderTargetId,
            declaredTargets: [...context.renderTargetIds],
          },
        };
      }
      if (claim.clockMs < 0 || claim.clockMs > context.scenarioDurationMs) {
        return {
          ruleId: this.ruleId,
          claimId: claim.claimId,
          reason: `output claimed at clock ${claim.clockMs}ms outside scenario duration ${context.scenarioDurationMs}ms`,
          evidence: { clockMs: claim.clockMs, scenarioDurationMs: context.scenarioDurationMs },
        };
      }
      return null;
    }
    if (claim.claimKind === "canonical-event") {
      if (claim.clockMs < 0 || claim.clockMs > context.scenarioDurationMs) {
        return {
          ruleId: this.ruleId,
          claimId: claim.claimId,
          reason: `event claimed at clock ${claim.clockMs}ms outside scenario duration ${context.scenarioDurationMs}ms`,
          evidence: { clockMs: claim.clockMs, scenarioDurationMs: context.scenarioDurationMs },
        };
      }
    }
    return null;
  },
};

/** Rule 5 — bypassed provenance. */
const provenanceBypassRule: HardInvalidityRule = {
  ruleId: "provenance-bypass",
  description:
    "A lab-run claim whose provenance class is not lab-simulation. A lab run producing " +
    "real-observation or historical-replay provenance bypasses the lab-to-production " +
    "boundary — lab world state is NEVER production truth.",
  check(claim: LabClaim): HardInvalidityViolation | null {
    if (claim.provenanceClass !== LAB_SIMULATION_PROVENANCE) {
      return {
        ruleId: this.ruleId,
        claimId: claim.claimId,
        reason:
          `lab-run claim carries provenance class '${claim.provenanceClass}' — only ` +
          `'lab-simulation' is legal inside a lab run`,
        evidence: { provenanceClass: claim.provenanceClass, claimKind: claim.claimKind },
      };
    }
    return null;
  },
};

/** Rule 6 — invalid artifact lineage. */
const invalidArtifactLineageRule: HardInvalidityRule = {
  ruleId: "invalid-artifact-lineage",
  description: "An output claim whose artifact lineage does not root at the run that produced it.",
  check(claim: LabClaim, context: HardInvalidityContext): HardInvalidityViolation | null {
    if (claim.claimKind !== "output-claim") return null;
    const lineage = claim.artifactLineage;
    if (lineage.length === 0 || lineage[0] !== context.runId) {
      return {
        ruleId: this.ruleId,
        claimId: claim.claimId,
        reason:
          lineage.length === 0
            ? "output claim carries an EMPTY artifact lineage"
            : `artifact lineage does not root at run ${context.runId}`,
        evidence: { artifactLineage: [...lineage], runId: context.runId },
      };
    }
    return null;
  },
};

export const FOOTBALL_HARD_INVALIDITY_RULES: readonly HardInvalidityRule[] = [
  fabricatedCanonicalEventRule,
  fabricatedIdentityRule,
  rightsPolicyRule,
  impossibleOutputRule,
  provenanceBypassRule,
  invalidArtifactLineageRule,
];

/** Run every rule over one claim; all firing violations, in rule order. */
export function checkFootballClaims(
  claims: readonly LabClaim[],
  context: HardInvalidityContext,
): HardInvalidityViolation[] {
  const violations: HardInvalidityViolation[] = [];
  for (const claim of claims) {
    for (const rule of FOOTBALL_HARD_INVALIDITY_RULES) {
      const violation = rule.check(claim, context);
      if (violation !== null) violations.push(violation);
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Fault profiles (§3 bullet 10b — the seeded schedule builder is REL-003)
// ---------------------------------------------------------------------------

export const FOOTBALL_FAULT_PROFILES: readonly FaultProfile[] = [
  {
    profileId: "football-clean",
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
    profileId: "football-noisy-broadcast",
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
    profileId: "football-adversarial",
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
// The pack instance
// ---------------------------------------------------------------------------

/** The typed football instantiation of the §3 DomainPack seam. */
export type FootballDomainPack = DomainPack<
  FootballWorldState,
  FootballObservation,
  FootballScenarioConfig,
  FootballScenarioRecord
>;

/** `FootballDomainPack` also accepts the pack's observation base type in the replay adapter. */
export const footballDomainPack: FootballDomainPack = {
  domainPackId: FOOTBALL_DOMAIN_PACK_ID,
  version: FOOTBALL_DOMAIN_PACK_VERSION,
  entityTypes: FOOTBALL_ENTITY_TYPES,
  worldStateSchema: FootballWorldStateSchema,
  observationTaxonomy: FOOTBALL_OBSERVATION_TAXONOMY,
  eventTaxonomy: FOOTBALL_EVENT_TAXONOMY,
  actionSpace: FOOTBALL_ACTION_SPACE,
  capabilities: FOOTBALL_CAPABILITIES,
  renderTargets: FOOTBALL_RENDER_TARGETS,
  qualityEvaluators: FOOTBALL_QUALITY_EVALUATORS,
  hardInvalidityRules: FOOTBALL_HARD_INVALIDITY_RULES,
  rewardDimensions: FOOTBALL_REWARD_DIMENSIONS,
  scenarioGenerator: footballScenarioGenerator,
  faultProfiles: FOOTBALL_FAULT_PROFILES,
  replayAdapter: createListReplayAdapter("football-list-replay/0.1"),
  calibrationAdapter: createMeanErrorCalibrationAdapter("football-mean-error-calibration/0.1"),
};
