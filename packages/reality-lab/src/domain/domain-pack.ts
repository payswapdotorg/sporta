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

// ---------------------------------------------------------------------------
// The shared hard-invalidity rule set (REL-032) — the six ADR-013 §8 gate
// classes as one reusable factory
// ---------------------------------------------------------------------------

/**
 * The six ADR-013 §8 hard invalidity gate classes, as pure check functions
 * over the `LabClaim` model (REL-032). The rules are DOMAIN-NEUTRAL by
 * construction — they judge claims against the run context (received
 * evidence, declared render targets, scenario duration, run id, the
 * lab-simulation provenance law), never against domain semantics. Football
 * (REL-001) shipped them inline; this factory is the extracted, byte-identical
 * form so a second domain pack gets the SAME six gates through the same seam
 * instead of copy-pasting them. Packs that need stricter domain gates may
 * append their own rules AFTER these.
 *
 * The six classes:
 * 1. fabricated canonical event (no / not-yet-received evidence);
 * 2. fabricated identity presented as fact (inference laundered into fact);
 * 3. violation of declared rights/policy (output without a rights basis);
 * 4. impossible/unsupported output claim (undeclared target / out-of-window);
 * 5. bypassed provenance (a non-lab-simulation class inside a lab run);
 * 6. invalid artifact lineage (lineage not rooting at the run).
 */
export function createStandardHardInvalidityRules(): readonly HardInvalidityRule[] {
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
          evidence: {
            entityId: claim.entityId,
            presentedAs: claim.presentedAs,
            basis: claim.basis,
          },
        };
      }
      return null;
    },
  };

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

  const invalidArtifactLineageRule: HardInvalidityRule = {
    ruleId: "invalid-artifact-lineage",
    description:
      "An output claim whose artifact lineage does not root at the run that produced it.",
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

  return [
    fabricatedCanonicalEventRule,
    fabricatedIdentityRule,
    rightsPolicyRule,
    impossibleOutputRule,
    provenanceBypassRule,
    invalidArtifactLineageRule,
  ];
}

/**
 * Run a pack's hard invalidity rules over a claim list, collecting EVERY
 * firing violation in rule order (REL-032). This is the generic form of the
 * per-pack claim checkers (`checkFootballClaims`, `checkBasketballClaims`):
 * a typed refusal list — evidence, never an exception.
 */
export function checkLabClaims(
  claims: readonly LabClaim[],
  rules: readonly HardInvalidityRule[],
  context: HardInvalidityContext,
): HardInvalidityViolation[] {
  const violations: HardInvalidityViolation[] = [];
  for (const claim of claims) {
    for (const rule of rules) {
      const violation = rule.check(claim, context);
      if (violation !== null) violations.push(violation);
    }
  }
  return violations;
}
