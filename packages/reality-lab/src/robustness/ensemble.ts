/**
 * The Ensemble Runner (REL-003) — N seeded runs and the aggregate record
 * per docs/architecture/reality-engineering-lab.md §9's robustness subset:
 * expected score, variance/uncertainty, seed robustness. (The remaining §9
 * fields — simulator-model agreement, OOD score, cost/latency
 * distribution, known failure envelope, corpus coverage — belong to later
 * slices that have the calibration and corpus seams; REL-025's
 * ./benchmark.ts is that later slice, and it REUSES this module's
 * aggregate verbatim — same object references, never re-derived.)
 *
 * THE LAWS:
 * - every run's seed derives deterministically from the ensemble base seed
 *   (`${baseSeed}::ensemble:${i}`), so the SAME (baseSeed, size, config,
 *   organization) ⇒ deep-equal ensemble record, runs included;
 * - the aggregate is a PURE function of the run records
 *   (`aggregateLabRuns`) so its arithmetic is hand-checkable on synthetic
 *   records (the test suite pins the mean/variance on fixed inputs);
 * - every run in the record is a deterministic view (execution stripped) —
 *   an ensemble record is pure evidence, no wall clock inside;
 * - the whole record carries the lab-simulation provenance class — an
 *   ensemble of simulations is never production truth.
 *
 * REL-032 SEAM NOTE: since the seam generalization the runner logic lives
 * in `runDomainEnsemble` (below), flowing through `DomainPack` (the §3
 * contract, via `DomainPackLabView`) + `DomainSimulationProfile`
 * (../simulation/domain-profile) with the domain's OWN scenario generator
 * (`domainPack.scenarioGenerator`) and derived evaluator
 * (`profile.createLabEvaluator()`); the football facade (`runEnsemble`)
 * delegates with the football profile — football behavior stays
 * byte-identical, and the seam-neutrality tests pin
 * `runEnsemble default ≡ derived ≡ explicit`.
 */
import { contentId } from "../hash";
import { LAB_SIMULATION_PROVENANCE } from "../provenance";
import type { FaultProfile, ScenarioConfigBase, ScenarioRecordBase } from "../domain/domain-pack";
import type { FootballDomainPack } from "../domain/football";
import type { FootballScenarioConfig, FootballScenarioRecord } from "../domain/scenario";
import type {
  DomainPackLabView,
  DomainRunnerScenario,
  DomainRunnerTick,
  DomainSimulationProfile,
} from "../simulation/domain-profile";
import { footballDomainSimulationProfile } from "../simulation/football-profile";
import type { SimulatedTick } from "../simulation/world-simulator";
import { generateFaultSchedule } from "./faults";
import {
  deterministicDomainLabRun,
  runDomainLab,
  type DomainLabRunRecord,
  type DeterministicDomainLabRun,
  type OrganizationRuntimeBundle,
} from "../simulation/domain-lab-run";
import type { LabEvaluator } from "../evaluation/evaluator";

// ---------------------------------------------------------------------------
// The aggregate (§9 subset) — pure, hand-checkable
// ---------------------------------------------------------------------------

/** Mean + SAMPLE variance (n−1; 0 for a single run) of a score series. */
export interface ScoreStats {
  mean: number | null;
  sampleVariance: number | null;
  std: number | null;
  min: number | null;
  max: number | null;
}

/** The §9 robustness subset every ensemble records. */
export interface EnsembleAggregate {
  /** Expected score (architecture §9: "expected score"). */
  expectedScore: { overall: number | null; perDimension: Record<string, number | null> };
  /** Variance (architecture §9: "uncertainty"). */
  variance: { overall: number | null; perDimension: Record<string, number | null> };
  /** Spread of the overall score (a plain range — no distributional claim). */
  uncertainty: { overall: ScoreStats };
  /** Seed robustness (architecture §9: "seed robustness"). */
  seedRobustness: {
    seedsTested: number;
    validRuns: number;
    validFraction: number;
    overallScoreSpread: { min: number | null; max: number | null };
    distinctTrajectoryHashes: number;
  };
}

function statsOf(values: readonly (number | null)[]): ScoreStats {
  const numbers = values.filter((value): value is number => value !== null);
  if (numbers.length === 0) {
    return { mean: null, sampleVariance: null, std: null, min: null, max: null };
  }
  const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  if (numbers.length === 1) {
    return { mean, sampleVariance: 0, std: 0, min: numbers[0] ?? null, max: numbers[0] ?? null };
  }
  const squaredDiff = numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const sampleVariance = squaredDiff / (numbers.length - 1);
  return {
    mean,
    sampleVariance,
    std: Math.sqrt(sampleVariance),
    min: Math.min(...numbers),
    max: Math.max(...numbers),
  };
}

/**
 * Aggregate run records into the §9 robustness subset. PURE: the same runs
 * always yield the same aggregate — the test suite hand-checks the
 * arithmetic on fixed synthetic scores. Accepts ANY domain's run views
 * (REL-032): the arithmetic reads only `metrics` and `trajectoryHash`.
 */
export function aggregateLabRuns<
  TScenario extends ScenarioRecordBase = ScenarioRecordBase,
  TTick extends DomainRunnerTick = DomainRunnerTick,
>(
  runs: readonly (
    DomainLabRunRecord<TScenario, TTick> | DeterministicDomainLabRun<TScenario, TTick>
  )[],
): EnsembleAggregate {
  const overalls = runs.map((run) => run.metrics.overall);
  const overallStats = statsOf(overalls);
  const dimensionIds = new Set<string>();
  for (const run of runs) {
    for (const dimension of run.metrics.dimensions) dimensionIds.add(dimension.dimensionId);
  }
  const perDimensionMean: Record<string, number | null> = {};
  const perDimensionVariance: Record<string, number | null> = {};
  for (const dimensionId of dimensionIds) {
    const stats = statsOf(
      runs.map((run) => {
        const dimension = run.metrics.dimensions.find((d) => d.dimensionId === dimensionId);
        return dimension?.measured ? dimension.score : null;
      }),
    );
    perDimensionMean[dimensionId] = stats.mean;
    perDimensionVariance[dimensionId] = stats.sampleVariance;
  }
  const validRuns = runs.filter((run) => run.metrics.valid).length;
  const trajectoryHashes = new Set(runs.map((run) => run.trajectoryHash));
  const numbers = overalls.filter((value): value is number => value !== null);
  return {
    expectedScore: { overall: overallStats.mean, perDimension: perDimensionMean },
    variance: { overall: overallStats.sampleVariance, perDimension: perDimensionVariance },
    uncertainty: { overall: overallStats },
    seedRobustness: {
      seedsTested: runs.length,
      validRuns,
      validFraction: runs.length === 0 ? 0 : validRuns / runs.length,
      overallScoreSpread: {
        min: numbers.length > 0 ? Math.min(...numbers) : null,
        max: numbers.length > 0 ? Math.max(...numbers) : null,
      },
      distinctTrajectoryHashes: trajectoryHashes.size,
    },
  };
}

// ---------------------------------------------------------------------------
// The ensemble record + runner (generic, REL-032)
// ---------------------------------------------------------------------------

/** The generic ensemble record: N deterministic run views + the aggregate. */
export interface DomainEnsembleRecord<
  TConfig extends ScenarioConfigBase = ScenarioConfigBase,
  TScenario extends ScenarioRecordBase<TConfig> = ScenarioRecordBase<TConfig>,
  TTick extends DomainRunnerTick = DomainRunnerTick,
> {
  schemaVersion: "lab-ensemble/0.1";
  ensembleId: string;
  baseSeed: string;
  size: number;
  organization: { organizationId: string; version: number };
  scenarioConfig: TConfig;
  faultProfileId: string | null;
  runs: readonly DeterministicDomainLabRun<TScenario, TTick>[];
  aggregate: EnsembleAggregate;
  provenance: {
    provenanceClass: typeof LAB_SIMULATION_PROVENANCE;
    note: string;
  };
}

/** The generic ensemble options (the pack view + the simulation profile). */
export interface DomainEnsembleOptions<
  TConfig extends ScenarioConfigBase = ScenarioConfigBase,
  TScenario extends DomainRunnerScenario<TConfig> = DomainRunnerScenario<TConfig>,
  TTick extends DomainRunnerTick = DomainRunnerTick,
> {
  domainPack: DomainPackLabView<TConfig, TScenario>;
  simulationProfile: DomainSimulationProfile<TScenario, TTick>;
  organization: OrganizationRuntimeBundle;
  baseSeed: string;
  /** Number of seeded runs (>= 1). */
  size: number;
  scenarioConfig?: Partial<TConfig>;
  /** When provided, a per-run seeded fault schedule is injected. */
  faultProfile?: FaultProfile;
  evaluator?: LabEvaluator;
}

/**
 * Run the generic ensemble: N runs with deterministic per-run seeds, each
 * generated by the domain pack's OWN scenario generator, aggregated into
 * the §9 robustness subset. Same (baseSeed, size, config, organization,
 * profile) ⇒ deep-equal record. The default evaluator is DERIVED from the
 * simulation profile (equivalent to passing the domain's evaluator
 * explicitly — the seam-neutrality tests pin this).
 */
export function runDomainEnsemble<
  TConfig extends ScenarioConfigBase,
  TScenario extends DomainRunnerScenario<TConfig>,
  TTick extends DomainRunnerTick,
>(
  options: DomainEnsembleOptions<TConfig, TScenario, TTick>,
): DomainEnsembleRecord<TConfig, TScenario, TTick> {
  const { domainPack, simulationProfile, organization } = options;
  const evaluator = options.evaluator ?? simulationProfile.createLabEvaluator();
  const size = Math.max(1, Math.floor(options.size));
  const runViews: DeterministicDomainLabRun<TScenario, TTick>[] = [];
  for (let index = 0; index < size; index++) {
    const runSeed = `${options.baseSeed}::ensemble:${index}`;
    const scenario = domainPack.scenarioGenerator.generate(runSeed, options.scenarioConfig);
    const faultSchedule =
      options.faultProfile !== undefined
        ? generateFaultSchedule({
            seed: `${runSeed}::faults`,
            tickCount: scenario.initialConditions.expectedTickCount,
            profile: options.faultProfile,
          })
        : undefined;
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
  const aggregate = aggregateLabRuns(runViews);
  const scenarioConfig = domainPack.scenarioGenerator.generate(
    `${options.baseSeed}::config`,
    options.scenarioConfig,
  ).config;
  const record: DomainEnsembleRecord<TConfig, TScenario, TTick> = {
    schemaVersion: "lab-ensemble/0.1",
    ensembleId: "",
    baseSeed: options.baseSeed,
    size,
    organization: {
      organizationId: organization.definition.organizationId,
      version: organization.definition.version,
    },
    scenarioConfig,
    faultProfileId: options.faultProfile?.profileId ?? null,
    runs: runViews,
    aggregate,
    provenance: {
      provenanceClass: LAB_SIMULATION_PROVENANCE,
      note: "an ensemble of simulations is itself simulation — never production truth (ADR-013 §8)",
    },
  };
  record.ensembleId = contentId({
    kind: "lab-ensemble/0.1",
    baseSeed: options.baseSeed,
    size,
    organizationId: record.organization.organizationId,
    organizationVersion: record.organization.version,
    scenarioConfig,
    faultProfileId: record.faultProfileId,
    runIds: runViews.map((run) => run.runId),
  });
  return record;
}

// ---------------------------------------------------------------------------
// The football facade (the v0 public surface, unchanged)
// ---------------------------------------------------------------------------

/** The ensemble record: N deterministic run views + the aggregate. */
export type EnsembleRecord = DomainEnsembleRecord<
  FootballScenarioConfig,
  FootballScenarioRecord,
  SimulatedTick
>;

export interface EnsembleOptions {
  domainPack: FootballDomainPack;
  organization: OrganizationRuntimeBundle;
  baseSeed: string;
  /** Number of seeded runs (>= 1). */
  size: number;
  scenarioConfig?: Partial<FootballScenarioConfig>;
  /** When provided, a per-run seeded fault schedule is injected. */
  faultProfile?: FaultProfile;
  evaluator?: LabEvaluator;
}

function domainOptions(
  options: EnsembleOptions,
): DomainEnsembleOptions<FootballScenarioConfig, FootballScenarioRecord, SimulatedTick> {
  return {
    domainPack: options.domainPack,
    simulationProfile: footballDomainSimulationProfile,
    organization: options.organization,
    baseSeed: options.baseSeed,
    size: options.size,
    scenarioConfig: options.scenarioConfig,
    faultProfile: options.faultProfile,
    evaluator: options.evaluator,
  };
}

/**
 * Run the ensemble: N runs with deterministic per-run seeds, aggregated
 * into the §9 robustness subset. Same (baseSeed, size, config,
 * organization, profile) ⇒ deep-equal record. Delegates to
 * `runDomainEnsemble` with the football profile (REL-032 seam).
 */
export function runEnsemble(options: EnsembleOptions): EnsembleRecord {
  return runDomainEnsemble<FootballScenarioConfig, FootballScenarioRecord, SimulatedTick>(
    domainOptions(options),
  );
}
