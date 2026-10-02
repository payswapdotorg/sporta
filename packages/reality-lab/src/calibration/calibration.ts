/**
 * Calibration (REL-008) — prediction vs observation per reward dimension,
 * the §7 learning-ladder rung "prediction-vs-observation calibration".
 *
 * THE RECORD (`CalibrationRecord`): which evaluator produced the predictions
 * (id + version), which domain pack (id + version), the per-dimension
 * predicted-vs-observed comparison (each carrying its OBSERVATION SOURCE
 * CLASS — lab-simulation vs historical-replay vs real-observation, the
 * ADR-013 §8 taxonomy), the measured drift, a deterministic timestamp
 * window, and provenance. Drift is the mean absolute error over the
 * dimensions comparable on both sides; dimensions unmeasurable on either
 * side are LISTED as skipped, never imputed.
 *
 * THE PORT (`CalibrationPort`): the adapter interface the registry/director
 * side consumes — `consume(record)` + `state()`, with drift detection at a
 * CONFIGURED threshold. Drift beyond threshold is a RECORDED STATE
 * ("drift-exceeded"), never an exception.
 *
 * THE DRIVER (`runCalibration`): deterministic — run the prediction ensemble
 * (clean, seeded), obtain observations from one of three source classes
 * (a perturbed lab ensemble, historical-replay scores, or real-observation
 * scores), build the record, and run drift detection with the configured
 * threshold. Same inputs ⇒ deep-equal record and drift state.
 *
 * PROVENANCE LAW: a driver-produced calibration record is lab evidence —
 * `provenanceClass: "lab-simulation"`. Real-observation INPUTS are marked
 * per-dimension and in `observation.sourceClass`; the record itself never
 * becomes production truth (ADR-013 §8).
 */
import { contentId } from "../hash";
import { LabValidationError } from "../errors";
import { LAB_SIMULATION_PROVENANCE } from "../provenance";
import type { LabProvenanceClass } from "../provenance";
import type { FaultProfile, ScenarioConfigBase } from "../domain/domain-pack";
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
import type { OrganizationRuntimeBundle } from "../simulation/domain-lab-run";
import { runDomainEnsemble, type DomainEnsembleRecord } from "../robustness/ensemble";
import type { LabEvaluator } from "../evaluation/evaluator";
import { deepFreeze } from "../orgsearch/search";

// ---------------------------------------------------------------------------
// The observation source classes (the ADR-013 §8 taxonomy, reused honestly)
// ---------------------------------------------------------------------------

/**
 * Where a calibration's OBSERVATIONS came from. This is the frozen ADR-013
 * §8 provenance taxonomy: `lab-simulation` (a perturbed lab ensemble),
 * `historical-replay` (replayed recorded evidence), `real-observation`
 * (actually-observed real-world measurements).
 */
export type ObservationSourceClass = LabProvenanceClass;

/**
 * Known injected perturbations for a perturbed-ensemble observation source
 * (the generic, domain-neutral form — REL-032): scenario overrides are
 * partial configs of whatever domain the calibration runs over.
 */
export interface DomainCalibrationPerturbations<
  TConfig extends ScenarioConfigBase = ScenarioConfigBase,
> {
  description: string;
  /** A fault profile injected into the observation ensemble. */
  faultProfile?: FaultProfile;
  /** Scenario overrides for the observation ensemble (e.g. sourceProfile: "degraded"). */
  scenarioOverrides?: Partial<TConfig>;
}

/** The football perturbations (the v0 public shape). */
export type CalibrationPerturbations = DomainCalibrationPerturbations<FootballScenarioConfig>;

/** Where a calibration's observations come from. */
export type CalibrationObservationSource =
  | {
      sourceClass: "lab-simulation";
      kind: "perturbed-ensemble";
      perturbations: DomainCalibrationPerturbations;
    }
  | {
      sourceClass: "historical-replay" | "real-observation";
      kind: "provided-scores";
      description: string;
      observedScores: readonly { dimensionId: string; score: number | null }[];
    };

// ---------------------------------------------------------------------------
// The calibration record
// ---------------------------------------------------------------------------

/** One dimension's prediction-vs-observation comparison. */
export interface CalibrationDimensionComparison {
  dimensionId: string;
  predicted: number | null;
  observed: number | null;
  /** predicted - observed (null when either side is unmeasured). */
  error: number | null;
  absError: number | null;
  /** Where the OBSERVED side came from (the §8 taxonomy). */
  observationSourceClass: ObservationSourceClass;
}

/**
 * The timestamp window. `simulated-clock` windows are deterministic (the
 * simulated match window the ensembles cover); `epoch` windows are provided
 * by the caller for externally-sourced observations — recorded as given,
 * never wall-clock-sampled inside a run.
 */
export interface CalibrationTimestampWindow {
  kind: "simulated-clock" | "epoch";
  startMs: number;
  endMs: number;
  note: string;
}

/** The measured drift summary. */
export interface CalibrationDriftSummary {
  /** Mean absolute error over the comparable dimensions (null when none comparable). */
  measuredDrift: number | null;
  comparableDimensions: number;
  /** Dimensions skipped because predicted and/or observed was unmeasured. */
  skippedDimensionIds: readonly string[];
}

/** The calibration record (§11 "calibration records" lab output). */
export interface CalibrationRecord {
  schemaVersion: "lab-calibration/0.1";
  calibrationId: string;
  /** Whose predictions are calibrated (the evaluator hook). */
  evaluator: { evaluatorId: string; evaluatorVersion: string };
  domainPack: { domainPackId: string; domainPackVersion: string };
  organization: { organizationId: string; version: number };
  seed: string;
  prediction: {
    sourceClass: typeof LAB_SIMULATION_PROVENANCE;
    ensembleSize: number;
    description: string;
  };
  observation: {
    sourceClass: ObservationSourceClass;
    kind: CalibrationObservationSource["kind"];
    description: string;
    perturbations: DomainCalibrationPerturbations | null;
  };
  dimensions: readonly CalibrationDimensionComparison[];
  drift: CalibrationDriftSummary;
  timestampWindow: CalibrationTimestampWindow;
  provenance: {
    provenanceClass: typeof LAB_SIMULATION_PROVENANCE;
    note: string;
  };
}

// ---------------------------------------------------------------------------
// Drift detection (a recorded state, never an exception)
// ---------------------------------------------------------------------------

/** The per-dimension drift view the state carries. */
export interface CalibrationDimensionDrift {
  dimensionId: string;
  drift: number | null;
  /** True when drift >= threshold (fires AT the threshold, not only beyond). */
  exceeded: boolean;
}

/** The port's state: calibrated / drift-exceeded / uncalibrated. */
export interface CalibrationDriftState {
  status: "uncalibrated" | "calibrated" | "drift-exceeded";
  driftThreshold: number;
  measuredDrift: number | null;
  comparableDimensions: number;
  perDimension: readonly CalibrationDimensionDrift[];
  lastCalibrationId: string | null;
  recordsConsumed: number;
}

/**
 * Pure drift detection over one record: fires (status "drift-exceeded")
 * exactly when `measuredDrift >= threshold` — at OR beyond the threshold,
 * never below it. Nothing comparable means the drift is unknown, so the
 * state is honestly "uncalibrated", not a silent zero.
 */
export function detectCalibrationDrift(
  record: CalibrationRecord,
  driftThreshold: number,
): CalibrationDriftState {
  const perDimension: CalibrationDimensionDrift[] = record.dimensions.map((dimension) => ({
    dimensionId: dimension.dimensionId,
    drift: dimension.absError,
    exceeded: dimension.absError !== null && dimension.absError >= driftThreshold,
  }));
  const measuredDrift = record.drift.measuredDrift;
  const status: CalibrationDriftState["status"] =
    measuredDrift === null
      ? "uncalibrated"
      : measuredDrift >= driftThreshold
        ? "drift-exceeded"
        : "calibrated";
  return {
    status,
    driftThreshold,
    measuredDrift,
    comparableDimensions: record.drift.comparableDimensions,
    perDimension,
    lastCalibrationId: record.calibrationId,
    recordsConsumed: 1,
  };
}

// ---------------------------------------------------------------------------
// The CalibrationPort adapter interface
// ---------------------------------------------------------------------------

/**
 * The adapter interface the registry/director side consumes: calibration
 * records in, current calibration state + drift detection out. Implementa-
 * tions may persist; the in-memory port below is the reference adapter.
 */
export interface CalibrationPort {
  readonly portId: string;
  /** Consume one record; returns the state AFTER consuming it. */
  consume(record: CalibrationRecord): CalibrationDriftState;
  /** The current state ("uncalibrated" before the first record). */
  state(): CalibrationDriftState;
}

/**
 * The in-memory reference port. The LATEST consumed record determines the
 * drift state (calibration is a current-state question); `recordsConsumed`
 * accumulates. Drift beyond the threshold is a recorded state — this port
 * never throws for drift.
 */
export function createCalibrationPort(options: {
  portId?: string;
  driftThreshold: number;
}): CalibrationPort {
  if (options.driftThreshold < 0) {
    throw new LabValidationError("driftThreshold must be >= 0");
  }
  const initial: CalibrationDriftState = {
    status: "uncalibrated",
    driftThreshold: options.driftThreshold,
    measuredDrift: null,
    comparableDimensions: 0,
    perDimension: [],
    lastCalibrationId: null,
    recordsConsumed: 0,
  };
  let current = initial;
  return {
    portId: options.portId ?? "calibration-port:in-memory",
    consume(record: CalibrationRecord): CalibrationDriftState {
      const detected = detectCalibrationDrift(record, options.driftThreshold);
      current = { ...detected, recordsConsumed: current.recordsConsumed + 1 };
      return current;
    },
    state(): CalibrationDriftState {
      return current;
    },
  };
}

// ---------------------------------------------------------------------------
// The deterministic calibration driver
// ---------------------------------------------------------------------------

/**
 * The generic calibration run options (REL-032): the pack view + simulation
 * profile replace the football pack; the default evaluator is DERIVED from
 * the profile (matching the v0 football default exactly).
 */
export interface DomainCalibrationRunOptions<
  TConfig extends ScenarioConfigBase = ScenarioConfigBase,
  TScenario extends DomainRunnerScenario<TConfig> = DomainRunnerScenario<TConfig>,
  TTick extends DomainRunnerTick = DomainRunnerTick,
> {
  domainPack: DomainPackLabView<TConfig, TScenario>;
  simulationProfile: DomainSimulationProfile<TScenario, TTick>;
  organization: OrganizationRuntimeBundle;
  seed: string;
  /** Seeded runs per ensemble (prediction and observation each). */
  ensembleSize: number;
  scenarioConfig?: Partial<TConfig>;
  observation: CalibrationObservationSource;
  evaluator?: LabEvaluator;
  /** The configured drift threshold — detection must fire exactly per it. */
  driftThreshold: number;
}

export interface CalibrationRunOptions {
  domainPack: FootballDomainPack;
  organization: OrganizationRuntimeBundle;
  seed: string;
  /** Seeded runs per ensemble (prediction and observation each). */
  ensembleSize: number;
  scenarioConfig?: Partial<FootballScenarioConfig>;
  observation: CalibrationObservationSource;
  evaluator?: LabEvaluator;
  /** The configured drift threshold — detection must fire exactly per it. */
  driftThreshold: number;
}

/** The driver's result: the record + the drift state it detected. */
export interface CalibrationRunResult {
  record: CalibrationRecord;
  drift: CalibrationDriftState;
}

function perDimensionMeans<
  TConfig extends ScenarioConfigBase,
  TScenario extends DomainRunnerScenario<TConfig>,
  TTick extends DomainRunnerTick,
>(ensemble: DomainEnsembleRecord<TConfig, TScenario, TTick>): Map<string, number | null> {
  const means = new Map<string, number | null>();
  for (const [dimensionId, value] of Object.entries(
    ensemble.aggregate.expectedScore.perDimension,
  )) {
    means.set(dimensionId, value);
  }
  return means;
}

/**
 * Run the GENERIC calibration (REL-032): the prediction ensemble (clean,
 * seeded `${seed}::calibration:prediction`) against the observation source,
 * the per-dimension comparison, the drift record, and drift detection at
 * the configured threshold. Deterministic from the options — same inputs,
 * deep-equal record and drift state. The default evaluator is DERIVED from
 * the simulation profile (matching the v0 football default exactly).
 */
export function runDomainCalibration<
  TConfig extends ScenarioConfigBase,
  TScenario extends DomainRunnerScenario<TConfig>,
  TTick extends DomainRunnerTick,
>(options: DomainCalibrationRunOptions<TConfig, TScenario, TTick>): CalibrationRunResult {
  if (!Number.isInteger(options.ensembleSize) || options.ensembleSize < 1) {
    throw new LabValidationError("ensembleSize must be an integer >= 1");
  }
  if (options.driftThreshold < 0) {
    throw new LabValidationError("driftThreshold must be >= 0");
  }
  if (options.observation.kind === "provided-scores") {
    const seen = new Set<string>();
    for (const entry of options.observation.observedScores) {
      if (seen.has(entry.dimensionId)) {
        throw new LabValidationError(
          `duplicate observed score for dimension ${entry.dimensionId}`,
          [{ dimensionId: entry.dimensionId }],
        );
      }
      seen.add(entry.dimensionId);
    }
  }
  const evaluator = options.evaluator ?? options.simulationProfile.createLabEvaluator();
  const scenarioConfig = options.domainPack.scenarioGenerator.generate(
    `${options.seed}::calibration:config`,
    options.scenarioConfig,
  ).config;

  const predictionEnsemble = runDomainEnsemble({
    domainPack: options.domainPack,
    simulationProfile: options.simulationProfile,
    organization: options.organization,
    baseSeed: `${options.seed}::calibration:prediction`,
    size: options.ensembleSize,
    scenarioConfig: options.scenarioConfig,
    evaluator,
  });
  const predicted = perDimensionMeans(predictionEnsemble);

  let observed: Map<string, number | null>;
  let observationDescription: string;
  let perturbations: CalibrationPerturbations | null = null;
  if (options.observation.kind === "perturbed-ensemble") {
    perturbations = options.observation.perturbations;
    const observationEnsemble = runDomainEnsemble({
      domainPack: options.domainPack,
      simulationProfile: options.simulationProfile,
      organization: options.organization,
      baseSeed: `${options.seed}::calibration:observation`,
      size: options.ensembleSize,
      scenarioConfig: {
        ...options.scenarioConfig,
        ...options.observation.perturbations.scenarioOverrides,
      } as Partial<TConfig>,
      faultProfile: options.observation.perturbations.faultProfile,
      evaluator,
    });
    observed = perDimensionMeans(observationEnsemble);
    observationDescription =
      `perturbed lab ensemble (seed ${options.seed}::calibration:observation): ` +
      options.observation.perturbations.description;
  } else {
    observed = new Map(
      options.observation.observedScores.map((entry) => [entry.dimensionId, entry.score]),
    );
    observationDescription = options.observation.description;
  }

  const dimensionIds = [...new Set([...predicted.keys(), ...observed.keys()])].sort();
  const comparisons: CalibrationDimensionComparison[] = dimensionIds.map((dimensionId) => {
    const predictedScore = predicted.get(dimensionId) ?? null;
    const observedScore = observed.get(dimensionId) ?? null;
    const error =
      predictedScore !== null && observedScore !== null ? predictedScore - observedScore : null;
    return {
      dimensionId,
      predicted: predictedScore,
      observed: observedScore,
      error,
      absError: error === null ? null : Math.abs(error),
      observationSourceClass: options.observation.sourceClass,
    };
  });
  const comparable = comparisons.filter((comparison) => comparison.absError !== null);
  const measuredDrift =
    comparable.length === 0
      ? null
      : comparable.reduce((sum, comparison) => sum + (comparison.absError ?? 0), 0) /
        comparable.length;

  const record: CalibrationRecord = {
    schemaVersion: "lab-calibration/0.1",
    calibrationId: "",
    evaluator: { evaluatorId: evaluator.evaluatorId, evaluatorVersion: evaluator.version },
    domainPack: {
      domainPackId: options.domainPack.domainPackId,
      domainPackVersion: options.domainPack.version,
    },
    organization: {
      organizationId: options.organization.definition.organizationId,
      version: options.organization.definition.version,
    },
    seed: options.seed,
    prediction: {
      sourceClass: LAB_SIMULATION_PROVENANCE,
      ensembleSize: options.ensembleSize,
      description: `clean lab ensemble (seed ${options.seed}::calibration:prediction)`,
    },
    observation: {
      sourceClass: options.observation.sourceClass,
      kind: options.observation.kind,
      description: observationDescription,
      perturbations,
    },
    dimensions: comparisons,
    drift: {
      measuredDrift,
      comparableDimensions: comparable.length,
      skippedDimensionIds: comparisons
        .filter((comparison) => comparison.absError === null)
        .map((comparison) => comparison.dimensionId),
    },
    timestampWindow: {
      kind: "simulated-clock",
      startMs: 0,
      endMs: scenarioConfig.matchDurationMs,
      note:
        "the simulated match window both ensembles cover — deterministic " +
        "(no wall clock inside a calibration record)",
    },
    provenance: {
      provenanceClass: LAB_SIMULATION_PROVENANCE,
      note:
        "lab-produced calibration evidence — never production truth (ADR-013 §8); " +
        "real-observation inputs are marked per dimension, the record itself stays lab evidence",
    },
  };
  record.calibrationId = contentId({
    kind: "lab-calibration/0.1",
    evaluator: record.evaluator,
    domainPack: record.domainPack,
    organization: record.organization,
    seed: record.seed,
    observation: record.observation,
    dimensions: record.dimensions,
    timestampWindow: record.timestampWindow,
  });
  const frozen = deepFreeze(record);
  const drift = detectCalibrationDrift(frozen, options.driftThreshold);
  return { record: frozen, drift };
}

// ---------------------------------------------------------------------------
// The football facade (the v0 public surface, unchanged)
// ---------------------------------------------------------------------------

function footballDomainOptions(
  options: CalibrationRunOptions,
): DomainCalibrationRunOptions<FootballScenarioConfig, FootballScenarioRecord, SimulatedTick> {
  return {
    domainPack: options.domainPack,
    simulationProfile: footballDomainSimulationProfile,
    organization: options.organization,
    seed: options.seed,
    ensembleSize: options.ensembleSize,
    scenarioConfig: options.scenarioConfig,
    observation: options.observation,
    evaluator: options.evaluator,
    driftThreshold: options.driftThreshold,
  };
}

/**
 * Run the calibration: the prediction ensemble (clean, seeded) against the
 * observation source, the per-dimension comparison, the drift record, and
 * drift detection at the configured threshold. Deterministic from the
 * options — same inputs, deep-equal record and drift state. Delegates to
 * `runDomainCalibration` with the football profile (REL-032 seam) —
 * football behavior stays byte-identical.
 */
export function runCalibration(options: CalibrationRunOptions): CalibrationRunResult {
  return runDomainCalibration<FootballScenarioConfig, FootballScenarioRecord, SimulatedTick>(
    footballDomainOptions(options),
  );
}
