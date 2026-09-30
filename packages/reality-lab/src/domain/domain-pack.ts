/**
 * The Lab Domain Pack contract (REL-001) — the frozen seam of
 * docs/architecture/reality-engineering-lab.md §3:
 *
 * "A domain pack defines: entity types and identity semantics; world-state
 * schema or adapter; observation/event taxonomy; action space;
 * capabilities; render targets; quality evaluators; hard invalidity rules;
 * reward dimensions; scenario/fault generators; replay and calibration
 * adapters."
 *
 * Football is the first pack (`./football`); basketball, tennis, other
 * sports and non-sport event domains must plug into THIS seam without any
 * change to generic lab/organization code (ADR-013 §2, acceptance gate
 * REL-A9's precondition).
 *
 * This module is DOMAIN-NEUTRAL: it names shapes, not football. It also
 * carries the fault taxonomy (`FaultKind`, `FaultProfile`) and the
 * lab-claim model (`LabClaim`) that the hard invalidity rules judge — both
 * part of the §3 seam ("hard invalidity rules", "scenario/fault
 * generators").
 */
import { z } from "zod";
import { LabProvenanceClass, LAB_SIMULATION_PROVENANCE } from "../provenance";

// ---------------------------------------------------------------------------
// §3 bullet 1 — entity types and identity semantics
// ---------------------------------------------------------------------------

/** How instances of one entity type are identified and re-identified. */
export interface IdentitySemantics {
  /** A stable id carried across the whole record (true for players/officials). */
  persistentId: boolean;
  /** Natural key fields (e.g. ["team", "jersey"]) — what humans match on. */
  naturalKey: readonly string[];
  /** At most one instance exists per record (ball, pitch frame). */
  singular: boolean;
  /** Plain words: the re-identification contract, in domain language. */
  notes: string;
}

/** One entity type in the domain (player, ball, official, pitch frame, ...). */
export interface EntityTypeDescriptor {
  typeId: string;
  description: string;
  identitySemantics: IdentitySemantics;
}

// ---------------------------------------------------------------------------
// §3 bullets 2–3 — world-state schema, observation/event taxonomy
// ---------------------------------------------------------------------------

/** Base every simulated world state satisfies (the lab-simulation law). */
export interface WorldStateBase {
  schemaVersion: string;
  provenanceClass: z.infer<typeof LabProvenanceClass>;
  clockMs: number;
}

/** The open world-state shape — packs tighten it with their own zod schema. */
export type AnyWorldState = WorldStateBase & { [field: string]: unknown };

/** Base every simulated observation satisfies. */
export interface DomainObservationBase {
  observationId: string;
  kindId: string;
  tickIndex: number;
  clockMs: number;
  provenanceClass: z.infer<typeof LabProvenanceClass>;
  /** Source honesty in [0, 1]; absent when the source cannot even guess. */
  confidence?: number;
}

/** One observation kind in the pack's taxonomy (broadcast-frame, ...). */
export interface ObservationKindDescriptor {
  kindId: string;
  description: string;
  carriesConfidence: boolean;
  canBeMissing: boolean;
  /** Which simulated source role produces it (for source-timing/faults). */
  sourceRole: string;
}

/** One canonical event kind in the pack's event taxonomy (kickoff, pass, ...). */
export interface EventKindDescriptor {
  eventKindId: string;
  description: string;
  participantEntityTypes: readonly string[];
}

// ---------------------------------------------------------------------------
// §3 bullets 4–7 — action space, capabilities, render targets, evaluator refs
// ---------------------------------------------------------------------------

/** One action the organization's bodies may take. */
export interface ActionDescriptor {
  actionId: string;
  description: string;
}

/** One replaceable capability the domain understands (versioned, like the registry's). */
export interface CapabilityDescriptor {
  capabilityId: string;
  version: string;
  description: string;
}

/** One render target the domain can produce. */
export interface RenderTargetDescriptor {
  targetId: string;
  description: string;
}

/** A reference to a quality evaluator the domain declares (v0: the lab evaluator). */
export interface QualityEvaluatorRef {
  evaluatorId: string;
  version: string;
  rewardDimensionIds: readonly string[];
}

// ---------------------------------------------------------------------------
// §3 bullet 8 — hard invalidity rules (ADR-013 §8) over the lab-claim model
// ---------------------------------------------------------------------------

/**
 * A domain-level claim an organization emits during a lab run. These are the
 * ONLY things the hard invalidity rules judge, and they deliberately carry
 * NO model/runtime binding — the binding is execution metadata, never
 * domain truth (docs/contracts/agent-body-and-organization.md §Agent
 * Instance).
 */
export type LabClaim =
  | {
      claimKind: "canonical-event";
      claimId: string;
      eventKindId: string;
      clockMs: number;
      /** Observation/event-record ids that substantiate the claim. */
      evidenceRefs: readonly string[];
      provenanceClass: z.infer<typeof LabProvenanceClass>;
    }
  | {
      claimKind: "identity-assertion";
      claimId: string;
      entityId: string;
      /** "fact" = presented as observed truth; "inference" = honest guess. */
      presentedAs: "fact" | "inference";
      basis: "observed" | "inferred";
      evidenceRefs: readonly string[];
      provenanceClass: z.infer<typeof LabProvenanceClass>;
    }
  | {
      claimKind: "output-claim";
      claimId: string;
      renderTargetId: string;
      /** Declared rights basis for producing this output, or null. */
      rightsBasis: string | null;
      /** Artifact lineage: must root at the run id. */
      artifactLineage: readonly string[];
      clockMs: number;
      provenanceClass: z.infer<typeof LabProvenanceClass>;
    };

/** A typed hard-invalidity refusal record — evidence, never an exception. */
export interface HardInvalidityViolation {
  ruleId: string;
  claimId: string;
  reason: string;
  /** JSON-safe evidence for the audit trail. */
  evidence: Record<string, unknown>;
}

/** What the rules are allowed to know about the run (no internal state). */
export interface HardInvalidityContext {
  runId: string;
  /** Observation/event ids the organization ACTUALLY received. */
  knownEvidenceRefs: ReadonlySet<string>;
  /** Render targets the pack declares (for impossible-output-claim). */
  renderTargetIds: readonly string[];
  /** Total simulated match duration (claims beyond it are impossible). */
  scenarioDurationMs: number;
}

/**
 * A hard invalidity rule: a pure function from (claim, context) to a typed
 * violation record, or null when the claim is clean. A rule firing makes
 * the whole run hard-invalid — no reward can buy it back.
 */
export interface HardInvalidityRule {
  ruleId: string;
  description: string;
  check(claim: LabClaim, context: HardInvalidityContext): HardInvalidityViolation | null;
}

// ---------------------------------------------------------------------------
// §3 bullet 9 — reward dimensions
// ---------------------------------------------------------------------------

/** One reward axis the domain scores organizations on (ADR-013 §8 list). */
export interface RewardDimension {
  dimensionId: string;
  description: string;
  /** Default aggregation weight (the full reward engine is REL-007). */
  weight: number;
}

// ---------------------------------------------------------------------------
// §3 bullet 10 — scenario generators and the fault taxonomy
// ---------------------------------------------------------------------------

/** Base every scenario config satisfies. */
export interface ScenarioConfigBase {
  matchDurationMs: number;
  tickMs: number;
  [field: string]: unknown;
}

/** Base every scenario record satisfies (deterministic from seed — see below). */
export interface ScenarioRecordBase<C extends ScenarioConfigBase = ScenarioConfigBase> {
  scenarioId: string;
  domainPackId: string;
  domainPackVersion: string;
  seed: string;
  config: C;
  /** Deterministic initial conditions (per-pack shape). */
  initialConditions: Record<string, unknown>;
}

/**
 * The scenario generator seam: SAME SEED ⇒ BYTE-IDENTICAL scenario record
 * (JSON-serialization identical, ids included). A generator is a pure
 * function of (seed, config); no wall clock, no randomness outside the
 * seed.
 */
export interface ScenarioGenerator<
  TScenario extends ScenarioRecordBase<TConfig>,
  TConfig extends ScenarioConfigBase,
> {
  generate(seed: string, configOverrides?: Partial<TConfig>): TScenario;
}

/** The fault taxonomy injected by the robustness slice (REL-003). */
export type FaultKind =
  | "compute-provider-failure"
  | "source-disagreement"
  | "occlusion"
  | "processing-latency"
  | "dropped-frames";

/** Parameters one fault event may carry (per-kind subset; JSON-safe). */
export interface FaultParams {
  latencyMs?: number;
  disagreementMeters?: number;
  occlusionRadiusM?: number;
  durationTicks?: number;
  dropRateBoost?: number;
}

/**
 * A fault profile: per-kind per-tick rates plus parameters, judged against
 * a seeded schedule by `../robustness/faults` (REL-003).
 */
export interface FaultProfile {
  profileId: string;
  description: string;
  rates: Readonly<Record<FaultKind, number>>;
  params: Readonly<Partial<Record<FaultKind, FaultParams>>>;
}

// ---------------------------------------------------------------------------
// §3 bullet 11 — replay and calibration adapters
// ---------------------------------------------------------------------------

/** A replayable observation stream (v0: deterministic regrouping of recorded ticks). */
export interface ReplayStream {
  adapterId: string;
  /** Every recorded observation, in recorded order. */
  observations: readonly DomainObservationBase[];
  /** The sub-stream for one observation kind, in order. */
  byKind(kindId: string): readonly DomainObservationBase[];
}

/** Replay adapter: turns a recorded trajectory back into an observation stream. */
export interface ReplayAdapter<TObservation extends DomainObservationBase = DomainObservationBase> {
  adapterId: string;
  replay(observations: readonly TObservation[]): ReplayStream;
}

/** Predicted-vs-observed pairs for one metric (the calibration seam, v0). */
export interface CalibrationPairs {
  adapterId: string;
  pairs: readonly { predicted: number; observed: number; error: number }[];
  meanError: number;
}

/** Calibration adapter: compares predicted and observed metric series. */
export interface CalibrationAdapter {
  adapterId: string;
  compare(predictions: readonly number[], observations: readonly number[]): CalibrationPairs;
}

// ---------------------------------------------------------------------------
// The DomainPack contract itself
// ---------------------------------------------------------------------------

/**
 * A Lab Domain Pack — the frozen §3 seam. Generic parameters default so
 * `DomainPack` reads as the un-parameterized contract; the football pack
 * instantiates them with its typed world state, observations, config and
 * scenario record.
 */
export interface DomainPack<
  TWorldState extends AnyWorldState = AnyWorldState,
  TObservation extends DomainObservationBase = DomainObservationBase,
  TScenarioConfig extends ScenarioConfigBase = ScenarioConfigBase,
  TScenario extends ScenarioRecordBase<TScenarioConfig> = ScenarioRecordBase<TScenarioConfig>,
> {
  domainPackId: string;
  version: string;
  /** §3: entity types and identity semantics. */
  entityTypes: readonly EntityTypeDescriptor[];
  /** §3: world-state schema or adapter (a zod schema here; an adapter seam for heavier packs). */
  worldStateSchema: z.ZodType<TWorldState>;
  /** §3: observation taxonomy. */
  observationTaxonomy: readonly ObservationKindDescriptor[];
  /** §3: event taxonomy (canonical events). */
  eventTaxonomy: readonly EventKindDescriptor[];
  /** §3: action space. */
  actionSpace: readonly ActionDescriptor[];
  /** §3: capabilities. */
  capabilities: readonly CapabilityDescriptor[];
  /** §3: render targets. */
  renderTargets: readonly RenderTargetDescriptor[];
  /** §3: quality evaluator refs. */
  qualityEvaluators: readonly QualityEvaluatorRef[];
  /** §3: hard invalidity rules (ADR-013 §8). */
  hardInvalidityRules: readonly HardInvalidityRule[];
  /** §3: reward dimensions (ADR-013 §8 list). */
  rewardDimensions: readonly RewardDimension[];
  /** §3: scenario generator (seed-deterministic). */
  scenarioGenerator: ScenarioGenerator<TScenario, TScenarioConfig>;
  /** §3: fault generators (profiles; the seeded schedule builder lives in ../robustness). */
  faultProfiles: readonly FaultProfile[];
  /** §3: replay adapter. */
  replayAdapter: ReplayAdapter<TObservation>;
  /** §3: calibration adapter. */
  calibrationAdapter: CalibrationAdapter;
}

/**
 * The zod literal every pack's world-state schema must pin for
 * simulator-produced states — the machine-checked half of "lab world state
 * is NEVER production truth".
 */
export const LabSimulationProvenanceLiteral = z.literal(LAB_SIMULATION_PROVENANCE);
