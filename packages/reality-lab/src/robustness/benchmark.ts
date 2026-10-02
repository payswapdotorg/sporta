/**
 * The Robustness Benchmark (REL-025) — `runRobustnessBenchmark` completes the
 * architecture §9 record: EVERY promoted/evaluated organization gets a
 * `RobustnessRecord` carrying ALL §9 fields, measured this run:
 *
 * - expected score + uncertainty: the REL-003 ensemble aggregate, REUSED
 *   VERBATIM (the same object references as the embedded standard-family
 *   ensemble's `aggregate` — never re-derived);
 * - seed robustness: the aggregate's seed-robustness section (same object);
 * - simulator-model agreement: the organization's canonical-event CLAIMS
 *   matched against the ground-truth simulator events by identity+kind
 *   (each claim's evidence observation resolves to a sim event by eventId;
 *   the claimed kind is compared to the world's kind) — a MEASURED
 *   comparison, recorded per claim, never an assertion;
 * - out-of-distribution score: an explicit OOD family (an adversarial fault
 *   profile + caller-degraded scenario overrides) scored through the SAME
 *   aggregate arithmetic (`runDomainEnsemble` + `aggregateLabRuns`), with
 *   the measured fault-tick distinction (standard vs OOD) and the score
 *   delta;
 * - cost/latency distribution: per-run distributions from the ensemble
 *   runs' simulated cost/latency fields (scripted-runtime constants —
 *   NEVER wall clock);
 * - known failure envelope: a severity-multiplied sweep over the fault
 *   profile space (each severity's profile derives deterministically from
 *   the base profile with rates × severity, capped at 1) whose boundary is
 *   MEASURED (the lowest severity whose validFraction drops below 1, or
 *   honestly null when no swept severity breaks the organization);
 * - benchmark corpus coverage: a VERSIONED list of the fixture/scenario
 *   families exercised, plus an honest not-covered list.
 *
 * THE LAWS:
 * - DETERMINISM: same (baseSeed, config, organization, profile) ⇒
 *   deep-equal record — every stochastic input flows from the seed; the
 *   embedded run views are `deterministicDomainLabRun` views (execution
 *   stripped); NO wall clock anywhere in the record;
 * - PROVENANCE: everything carries the lab-simulation class — a robustness
 *   record is pure evidence, never production truth (ADR-013 §8);
 * - BOUNDARY: the benchmark CHOOSES organizations and parameters; it never
 *   mutates authoritative world facts (architecture §6).
 */
import { contentId } from "../hash";
import { LAB_SIMULATION_PROVENANCE } from "../provenance";
import type { FaultProfile, ScenarioConfigBase, ScenarioRecordBase } from "../domain/domain-pack";
import type {
  DomainPackLabView,
  DomainRunnerScenario,
  DomainRunnerTick,
  DomainSimulationProfile,
} from "../simulation/domain-profile";
import { assertProfileMatchesPack } from "../simulation/domain-profile";
import type {
  DeterministicDomainLabRun,
  OrganizationRuntimeBundle,
} from "../simulation/domain-lab-run";
import { deterministicDomainLabRun, runDomainLab } from "../simulation/domain-lab-run";
import type { DomainEnsembleRecord } from "./ensemble";
import { runDomainEnsemble } from "./ensemble";
import type { LabEvaluator } from "../evaluation/evaluator";
import { generateFaultSchedule, type FaultSchedule } from "./faults";

// ---------------------------------------------------------------------------
// The §9 completion record
// ---------------------------------------------------------------------------

/** One claim's measured simulator-vs-model comparison. */
export interface SimulatorModelClaimAgreement {
  claimId: string;
  /** The kind the organization's model path CLAIMED. */
  claimedEventKindId: string;
  /** The kind the simulator's ground truth recorded for the same event (null when unresolved). */
  groundTruthEventKindId: string | null;
  /** True when the claim resolved to a sim event of the SAME kind. */
  agreed: boolean;
}

/**
 * The measured simulator-model agreement (§9): the organization's
 * canonical-event claims vs the ground-truth sim events, matched by
 * identity+kind — disagreements are RECORDED, not hidden.
 */
export interface SimulatorModelAgreement {
  /** The single seeded agreement run's id (reproducible from the baseSeed). */
  runId: string;
  claimsExamined: number;
  /** Claims whose claimed kind equals the ground-truth kind. */
  agreed: number;
  /** Claims whose claimed kind DIFFERS from the ground-truth kind. */
  kindDisagreements: number;
  /** Claims whose evidence could not be resolved to a sim event at all. */
  unmatchedClaims: number;
  perClaim: readonly SimulatorModelClaimAgreement[];
  note: string;
}

/** One family's per-run simulated cost/latency distribution. */
export interface CostLatencyDistribution {
  familyId: string;
  perRun: readonly { runId: string; costUsd: number; meanLatencyMs: number | null }[];
  costUsd: { min: number | null; max: number | null; mean: number | null };
  meanLatencyMs: { min: number | null; max: number | null; mean: number | null };
  note: string;
}

/** One severity's measured envelope row. */
export interface FailureEnvelopeSeverityRow {
  severity: number;
  /** The derived profile's content id (rates = base × severity, capped at 1). */
  derivedProfileId: string;
  validFraction: number;
  /** Measured fault ticks across the severity's sweep runs. */
  faultTicks: number;
  /** Mean overall score across the severity's sweep runs (null when unmeasurable). */
  overallMean: number | null;
  runIds: readonly string[];
}

/** The measured known failure envelope (§9) — a recorded boundary. */
export interface KnownFailureEnvelope {
  /** The base profile every severity derives from (rates × severity, capped at 1). */
  baseProfileId: string;
  severities: readonly FailureEnvelopeSeverityRow[];
  /**
   * The LOWEST severity whose validFraction dropped below 1 — the measured
   * boundary. Null when every swept severity kept the organization valid
   * (honest none-within-swept-range).
   */
  boundarySeverity: number | null;
  note: string;
}

/** One exercised corpus family (versioned coverage). */
export interface CorpusCoverageFamily {
  familyId: string;
  description: string;
  faultProfileId: string | null;
  runs: number;
}

/** The versioned benchmark corpus coverage (§9) — what WAS and WAS NOT covered. */
export interface BenchmarkCorpusCoverage {
  coverageVersion: "robustness-corpus/0.1";
  domainPackId: string;
  domainPackVersion: string;
  simulationProfileId: string;
  families: readonly CorpusCoverageFamily[];
  covered: readonly string[];
  notCovered: readonly string[];
}

/** The complete §9 robustness record — pure evidence. */
export interface RobustnessRecord<
  TConfig extends ScenarioConfigBase = ScenarioConfigBase,
  TScenario extends DomainRunnerScenario<TConfig> = DomainRunnerScenario<TConfig>,
  TTick extends DomainRunnerTick = DomainRunnerTick,
> {
  schemaVersion: "lab-robustness/0.1";
  benchmarkId: string;
  organization: { organizationId: string; version: number };
  domainPack: { domainPackId: string; domainPackVersion: string };
  simulationProfile: { profileId: string; version: string };
  baseSeed: string;
  ensembleSize: number;
  scenarioConfig: TConfig;

  // --- §9 fields, ALL measured this run ---

  /** Expected score (REL-003 aggregate, reused verbatim — same object). */
  expectedScore: DomainEnsembleRecord<TConfig, TScenario, TTick>["aggregate"]["expectedScore"];
  /** Variance / uncertainty (REL-003 aggregate, reused verbatim — same object). */
  variance: DomainEnsembleRecord<TConfig, TScenario, TTick>["aggregate"]["variance"];
  /** The overall spread stats (REL-003 aggregate, reused verbatim — same object). */
  uncertainty: DomainEnsembleRecord<TConfig, TScenario, TTick>["aggregate"]["uncertainty"];
  /** Seed robustness (REL-003 aggregate, reused verbatim — same object). */
  seedRobustness: DomainEnsembleRecord<TConfig, TScenario, TTick>["aggregate"]["seedRobustness"];

  /** Simulator-model agreement (measured claim-by-claim). */
  simulatorModelAgreement: SimulatorModelAgreement;
  /** The OOD family's full evidence (scored through the same aggregate arithmetic). */
  outOfDistribution: {
    family: {
      faultProfileId: string;
      scenarioOverrides: Partial<TConfig> | null;
      description: string;
    };
    ensemble: DomainEnsembleRecord<TConfig, TScenario, TTick>;
    /** Aggregate over the OOD ensemble (same arithmetic as the standard family). */
    aggregate: DomainEnsembleRecord<TConfig, TScenario, TTick>["aggregate"];
    /** Measured fault-tick distinction: standard family vs OOD family. */
    faultTicksStandard: number;
    faultTicksOod: number;
    overallScoreStandard: number | null;
    overallScoreOod: number | null;
    /** OOD minus standard (negative = the OOD family scored lower). */
    scoreDelta: number | null;
  };
  /** Cost/latency distributions (simulated fields only, never wall clock). */
  costLatencyDistribution: {
    standard: CostLatencyDistribution;
    ood: CostLatencyDistribution;
  };
  /** The severity-multiplied failure-envelope sweep (measured boundary). */
  knownFailureEnvelope: KnownFailureEnvelope;
  /** The versioned corpus coverage (honest covered + not-covered lists). */
  benchmarkCorpusCoverage: BenchmarkCorpusCoverage;

  /** The full standard-family ensemble evidence (REL-003 record, embedded). */
  ensemble: DomainEnsembleRecord<TConfig, TScenario, TTick>;
  /** The single seeded agreement run (deterministic view). */
  agreementRun: DeterministicDomainLabRun<TScenario, TTick>;

  provenance: {
    provenanceClass: typeof LAB_SIMULATION_PROVENANCE;
    note: string;
  };
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** The OOD family definition (honest: adversarial faults + degraded source). */
export interface RobustnessOodFamily<TConfig extends ScenarioConfigBase = ScenarioConfigBase> {
  /**
   * The OOD fault profile. Defaults to the pack's LAST fault profile — the
   * adversarial stress profile by convention (football/basketball both
   * declare clean / noisy-broadcast / adversarial in that order).
   */
  faultProfile?: FaultProfile;
  /** Scenario overrides for the OOD family (e.g. sourceProfile: "degraded"). */
  scenarioOverrides?: Partial<TConfig>;
  /** An honest description of what this family perturbs. */
  description?: string;
}

/** The benchmark configuration (same seed + config ⇒ deep-equal record). */
export interface RobustnessBenchmarkOptions<
  TConfig extends ScenarioConfigBase = ScenarioConfigBase,
  TScenario extends DomainRunnerScenario<TConfig> = DomainRunnerScenario<TConfig>,
  TTick extends DomainRunnerTick = DomainRunnerTick,
> {
  domainPack: DomainPackLabView<TConfig, TScenario>;
  simulationProfile: DomainSimulationProfile<TScenario, TTick>;
  organization: OrganizationRuntimeBundle;
  baseSeed: string;
  /** Seeded runs per family (the standard ensemble and the OOD ensemble). */
  ensembleSize: number;
  scenarioConfig?: Partial<TConfig>;
  ood?: RobustnessOodFamily<TConfig>;
  /** The severity grid for the failure-envelope sweep (default [1, 2, 3]). */
  severities?: readonly number[];
  /** Seeded runs per severity in the sweep (default 1). */
  sweepSize?: number;
  evaluator?: LabEvaluator;
}

// ---------------------------------------------------------------------------
// Measured helpers
// ---------------------------------------------------------------------------

function distributionStats(values: readonly number[]): {
  min: number | null;
  max: number | null;
  mean: number | null;
} {
  if (values.length === 0) return { min: null, max: null, mean: null };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { min: Math.min(...values), max: Math.max(...values), mean };
}

function meanActionLatencyOf(
  run: DeterministicDomainLabRun<ScenarioRecordBase, DomainRunnerTick>,
): number | null {
  if (run.actions.length === 0) return null;
  return (
    run.actions.reduce((sum, action) => sum + action.simulatedLatencyMs, 0) / run.actions.length
  );
}

function costLatencyOf(
  familyId: string,
  runs: readonly DeterministicDomainLabRun<ScenarioRecordBase, DomainRunnerTick>[],
): CostLatencyDistribution {
  const perRun = runs.map((run) => ({
    runId: run.runId,
    costUsd: run.metrics.budgetUsage.total.costUsd,
    meanLatencyMs: meanActionLatencyOf(run),
  }));
  return {
    familyId,
    perRun,
    costUsd: distributionStats(perRun.map((entry) => entry.costUsd)),
    meanLatencyMs: distributionStats(
      perRun.map((entry) => entry.meanLatencyMs).filter((value): value is number => value !== null),
    ),
    note:
      "per-run simulated cost/latency from the scripted runtimes' usage tables — " +
      "modeled constants, never wall-clock measurements",
  };
}

/** A tick that also carries ground-truth events (football/basketball both do). */
type EventsCarryingTick = DomainRunnerTick & {
  events: readonly { eventId?: unknown; eventKindId?: unknown }[];
};

/** Resolve the claim's evidence observation -> the ground-truth sim event's kind. */
function groundTruthKindForEvidence(
  evidenceRef: string,
  run: DeterministicDomainLabRun<ScenarioRecordBase, DomainRunnerTick>,
): string | null {
  const ticks = run.trajectory.ticks as readonly EventsCarryingTick[];
  for (const tick of ticks) {
    for (const observation of tick.observations) {
      if (observation.observationId !== evidenceRef) continue;
      const payload = (observation as { payload?: unknown }).payload;
      if (typeof payload !== "object" || payload === null) return null;
      const eventId = (payload as { eventId?: unknown }).eventId;
      if (typeof eventId !== "string") return null;
      for (const tickAgain of ticks) {
        for (const event of tickAgain.events) {
          if (event.eventId === eventId) {
            const kind = event.eventKindId;
            return typeof kind === "string" ? kind : null;
          }
        }
      }
      return null;
    }
  }
  return null;
}

/** The severity-multiplied profile: rates = base × severity (capped at 1), params verbatim. */
function deriveSeverityProfile(base: FaultProfile, severity: number): FaultProfile {
  const rates: Record<string, number> = {};
  for (const [kind, rate] of Object.entries(base.rates)) {
    rates[kind] = Math.min(1, (rate ?? 0) * severity);
  }
  return {
    profileId: `${base.profileId}::severity:${severity}`,
    description: `${base.description} (severity-multiplied x${severity}: rates x${severity} capped at 1)`,
    rates: rates as FaultProfile["rates"],
    params: base.params,
  };
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/**
 * Run the robustness benchmark: the standard seeded ensemble (REL-003
 * aggregate reused verbatim), the measured simulator-model agreement, the
 * OOD family scored through the same aggregate arithmetic, the per-run
 * simulated cost/latency distributions, the severity-multiplied
 * failure-envelope sweep, and the versioned corpus coverage. Same seed +
 * config ⇒ deep-equal record; no wall clock anywhere.
 */
export function runRobustnessBenchmark<
  TConfig extends ScenarioConfigBase,
  TScenario extends DomainRunnerScenario<TConfig>,
  TTick extends DomainRunnerTick,
>(
  options: RobustnessBenchmarkOptions<TConfig, TScenario, TTick>,
): RobustnessRecord<TConfig, TScenario, TTick> {
  const { domainPack, simulationProfile, organization } = options;
  assertProfileMatchesPack(simulationProfile, domainPack);
  const evaluator = options.evaluator ?? simulationProfile.createLabEvaluator();
  const ensembleSize = Math.max(1, Math.floor(options.ensembleSize));
  const severities =
    options.severities !== undefined && options.severities.length > 0
      ? [...options.severities]
      : [1, 2, 3];
  const sweepSize = Math.max(1, Math.floor(options.sweepSize ?? 1));
  const scenarioConfig = domainPack.scenarioGenerator.generate(
    `${options.baseSeed}::config`,
    options.scenarioConfig,
  ).config;

  // --- the standard family (clean, seeded): the REL-003 ensemble, verbatim ---
  const ensemble = runDomainEnsemble({
    domainPack,
    simulationProfile,
    organization,
    baseSeed: `${options.baseSeed}::standard`,
    size: ensembleSize,
    scenarioConfig: options.scenarioConfig,
    evaluator,
  });

  // --- simulator-model agreement (one seeded run, claim-by-claim) ---
  const agreementScenario = domainPack.scenarioGenerator.generate(
    `${options.baseSeed}::agreement`,
    options.scenarioConfig,
  );
  const agreementRaw = runDomainLab({
    domainPack,
    simulationProfile,
    organization,
    scenario: agreementScenario,
    evaluator,
  });
  const agreementRun = deterministicDomainLabRun(agreementRaw);
  const perClaim: SimulatorModelClaimAgreement[] = [];
  for (const claim of agreementRun.claims) {
    if (claim.claimKind !== "canonical-event") continue;
    const groundTruthKind = groundTruthKindForEvidence(claim.evidenceRefs[0] ?? "", agreementRun);
    perClaim.push({
      claimId: claim.claimId,
      claimedEventKindId: claim.eventKindId,
      groundTruthEventKindId: groundTruthKind,
      agreed: groundTruthKind !== null && groundTruthKind === claim.eventKindId,
    });
  }
  const agreed = perClaim.filter((entry) => entry.agreed).length;
  const kindDisagreements = perClaim.filter(
    (entry) => entry.groundTruthEventKindId !== null && !entry.agreed,
  ).length;
  const unmatchedClaims = perClaim.filter((entry) => entry.groundTruthEventKindId === null).length;
  const simulatorModelAgreement: SimulatorModelAgreement = {
    runId: agreementRun.runId,
    claimsExamined: perClaim.length,
    agreed,
    kindDisagreements,
    unmatchedClaims,
    perClaim,
    note:
      "canonical-event claims matched against ground-truth sim events by identity " +
      "(evidence observation -> eventId) and kind — a measured comparison; " +
      "disagreements are recorded, never hidden",
  };

  // --- the OOD family (adversarial + degraded, scored the same way) ---
  const baseProfiles = domainPack.faultProfiles;
  const oodFaultProfile =
    options.ood?.faultProfile ?? baseProfiles[baseProfiles.length - 1] ?? baseProfiles[0];
  if (oodFaultProfile === undefined) {
    throw new RangeError(
      `domain pack ${domainPack.domainPackId} declares no fault profiles — the OOD family needs one`,
    );
  }
  const oodScenarioOverrides = options.ood?.scenarioOverrides ?? undefined;
  const oodDescription =
    options.ood?.description ??
    `adversarial fault profile ${oodFaultProfile.profileId}` +
      (oodScenarioOverrides !== undefined
        ? ` with scenario overrides ${JSON.stringify(stableOverrides(oodScenarioOverrides))}`
        : " (no scenario overrides)");
  const oodEnsemble = runDomainEnsemble({
    domainPack,
    simulationProfile,
    organization,
    baseSeed: `${options.baseSeed}::ood`,
    size: ensembleSize,
    scenarioConfig: { ...options.scenarioConfig, ...oodScenarioOverrides } as Partial<TConfig>,
    faultProfile: oodFaultProfile,
    evaluator,
  });
  const faultTicksStandard = ensemble.runs.reduce(
    (sum, run) => sum + run.metrics.faultSummary.faultTicks,
    0,
  );
  const faultTicksOod = oodEnsemble.runs.reduce(
    (sum, run) => sum + run.metrics.faultSummary.faultTicks,
    0,
  );
  const overallScoreStandard = ensemble.aggregate.expectedScore.overall;
  const overallScoreOod = oodEnsemble.aggregate.expectedScore.overall;
  const scoreDelta =
    overallScoreStandard !== null && overallScoreOod !== null
      ? overallScoreOod - overallScoreStandard
      : null;

  // --- the severity-multiplied failure-envelope sweep ---
  const sweepBaseProfile = oodFaultProfile;
  const sweepRows: FailureEnvelopeSeverityRow[] = [];
  for (const severity of severities) {
    const derived = deriveSeverityProfile(sweepBaseProfile, severity);
    const derivedProfileId = contentId({
      kind: "derived-fault-profile/0.1",
      baseProfileId: sweepBaseProfile.profileId,
      severity,
      rates: derived.rates,
    });
    const runViews: DeterministicDomainLabRun<TScenario, TTick>[] = [];
    for (let index = 0; index < sweepSize; index++) {
      const runSeed = `${options.baseSeed}::sweep:${severity}:${index}`;
      const scenario = domainPack.scenarioGenerator.generate(runSeed, options.scenarioConfig);
      const faultSchedule: FaultSchedule = generateFaultSchedule({
        seed: `${runSeed}::faults`,
        tickCount: scenario.initialConditions.expectedTickCount,
        profile: derived,
      });
      const record = runDomainLab({
        domainPack,
        simulationProfile,
        organization,
        scenario,
        faultSchedule,
        evaluator,
      });
      runViews.push(deterministicDomainLabRun(record));
    }
    const validRuns = runViews.filter((run) => run.metrics.valid).length;
    const overalls = runViews
      .map((run) => run.metrics.overall)
      .filter((value): value is number => value !== null);
    sweepRows.push({
      severity,
      derivedProfileId,
      validFraction: runViews.length === 0 ? 0 : validRuns / runViews.length,
      faultTicks: runViews.reduce((sum, run) => sum + run.metrics.faultSummary.faultTicks, 0),
      overallMean:
        overalls.length > 0 ? overalls.reduce((s, v) => s + v, 0) / overalls.length : null,
      runIds: runViews.map((run) => run.runId),
    });
  }
  const boundarySeverity = sweepRows.find((row) => row.validFraction < 1)?.severity ?? null;
  const knownFailureEnvelope: KnownFailureEnvelope = {
    baseProfileId: sweepBaseProfile.profileId,
    severities: sweepRows,
    boundarySeverity,
    note:
      boundarySeverity === null
        ? `no swept severity (of ${severities.join(", ")}) made a run hard-invalid or " +
          "score-degraded — none-within-swept-range is the honest record`
        : `validFraction drops below 1 first at severity ${boundarySeverity} — " +
          "the measured boundary of the known failure envelope`,
  };

  // --- cost/latency distributions (simulated fields only) ---
  const costLatencyDistribution = {
    standard: costLatencyOf("standard-clean", ensemble.runs),
    ood: costLatencyOf("out-of-distribution", oodEnsemble.runs),
  };

  // --- the versioned corpus coverage ---
  const benchmarkCorpusCoverage: BenchmarkCorpusCoverage = {
    coverageVersion: "robustness-corpus/0.1",
    domainPackId: domainPack.domainPackId,
    domainPackVersion: domainPack.version,
    simulationProfileId: simulationProfile.profileId,
    families: [
      {
        familyId: "standard-clean",
        description:
          "the seeded standard family: clean profile, the pack's scenario generator, " +
          "the REL-003 ensemble aggregate",
        faultProfileId: null,
        runs: ensembleSize,
      },
      {
        familyId: "simulator-model-agreement",
        description:
          "one seeded run whose canonical-event claims are matched against ground-truth " +
          "sim events by identity+kind",
        faultProfileId: null,
        runs: 1,
      },
      {
        familyId: "out-of-distribution",
        description: oodDescription,
        faultProfileId: oodFaultProfile.profileId,
        runs: ensembleSize,
      },
      {
        familyId: "failure-envelope-sweep",
        description:
          `severity-multiplied sweep over ${sweepBaseProfile.profileId} ` +
          `(severities ${severities.join(", ")}, ${sweepSize} run(s) per severity)`,
        faultProfileId: sweepBaseProfile.profileId,
        runs: severities.length * sweepSize,
      },
    ],
    covered: [
      `the ${domainPack.domainPackId} domain pack at version ${domainPack.version}`,
      `the seeded standard family (fault-free) with ${ensembleSize} run(s)`,
      "simulator-model agreement over every canonical-event claim of the agreement run",
      `an OOD family: ${oodDescription}`,
      `cost/latency distributions over the standard and OOD families' runs`,
      `a failure-envelope sweep at severities ${severities.join(", ")}`,
    ],
    notCovered: [
      "renderer-in-the-loop dimensions (motion-fidelity, camera-scene-correctness, " +
        "stylization-quality) — not measured in v0",
      "historical-replay and real-observation OOD families — the OOD family here is " +
        "lab-simulation perturbation only",
      "wall-clock cost/latency — every cost/latency field is a simulated constant",
      "multi-organization comparison — this record benchmarks exactly one organization",
      "fault kinds beyond the pack's declared fault profiles and the severity multiplier",
    ],
  };

  // --- the record itself ---
  const record: RobustnessRecord<TConfig, TScenario, TTick> = {
    schemaVersion: "lab-robustness/0.1",
    benchmarkId: "",
    organization: {
      organizationId: organization.definition.organizationId,
      version: organization.definition.version,
    },
    domainPack: { domainPackId: domainPack.domainPackId, domainPackVersion: domainPack.version },
    simulationProfile: {
      profileId: simulationProfile.profileId,
      version: simulationProfile.version,
    },
    baseSeed: options.baseSeed,
    ensembleSize,
    scenarioConfig,
    // §9: the REL-003 aggregate, reused VERBATIM (same object references).
    expectedScore: ensemble.aggregate.expectedScore,
    variance: ensemble.aggregate.variance,
    uncertainty: ensemble.aggregate.uncertainty,
    seedRobustness: ensemble.aggregate.seedRobustness,
    simulatorModelAgreement,
    outOfDistribution: {
      family: {
        faultProfileId: oodFaultProfile.profileId,
        scenarioOverrides: oodScenarioOverrides ?? null,
        description: oodDescription,
      },
      ensemble: oodEnsemble,
      aggregate: oodEnsemble.aggregate,
      faultTicksStandard,
      faultTicksOod,
      overallScoreStandard,
      overallScoreOod,
      scoreDelta,
    },
    costLatencyDistribution,
    knownFailureEnvelope,
    benchmarkCorpusCoverage,
    ensemble,
    agreementRun,
    provenance: {
      provenanceClass: LAB_SIMULATION_PROVENANCE,
      note:
        "a robustness record is an ensemble of simulations — pure evidence, " +
        "never production truth (ADR-013 §8); promotion gates live in the registry",
    },
  };
  record.benchmarkId = contentId({
    kind: "lab-robustness/0.1",
    organizationId: record.organization.organizationId,
    organizationVersion: record.organization.version,
    domainPackId: record.domainPack.domainPackId,
    domainPackVersion: record.domainPack.domainPackVersion,
    simulationProfileId: record.simulationProfile.profileId,
    baseSeed: record.baseSeed,
    ensembleSize,
    scenarioConfig,
    ood: {
      faultProfileId: oodFaultProfile.profileId,
      scenarioOverrides: stableOverrides(oodScenarioOverrides ?? {}),
    },
    severities,
    sweepSize,
    ensembleId: ensemble.ensembleId,
    oodEnsembleId: oodEnsemble.ensembleId,
    agreementRunId: agreementRun.runId,
    sweepRowIds: sweepRows.map((row) => row.derivedProfileId),
  });
  return record;
}

/** A JSON-safe view of scenario overrides for ids and descriptions. */
function stableOverrides(overrides: Partial<ScenarioConfigBase>): Record<string, unknown> {
  const entries = Object.entries(overrides).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries);
}
