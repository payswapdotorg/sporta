/**
 * Calibration tests (REL-008, §7 rung "prediction-vs-observation
 * calibration"): the deterministic driver with known injected perturbations,
 * the three observation source classes (lab-simulation / historical-replay /
 * real-observation) distinguished per dimension, and drift detection that
 * fires EXACTLY at/beyond the configured threshold, never below — a
 * recorded state, never an exception. Drift numbers pinned below were
 * MEASURED on this branch (the comments derive them by hand).
 */
import { describe, expect, test } from "bun:test";
import {
  FOOTBALL_FAULT_PROFILES,
  createCalibrationPort,
  createFootballCandidateSpace,
  defaultFootballCandidateSpaceConfig,
  detectCalibrationDrift,
  footballDomainPack,
  runCalibration,
  type CalibrationObservationSource,
  type CalibrationRecord,
  type CalibrationRunOptions,
  type CandidateSpaceConfig,
} from "../src";
import { SMALL_SCENARIO } from "./fixtures";

function spaceConfig(): CandidateSpaceConfig {
  return {
    ...defaultFootballCandidateSpaceConfig(),
    maxBodyCount: 3,
    latencyBudgetsMs: [1000, 2000],
  };
}

function calibrationOptions(
  observation: CalibrationObservationSource,
  driftThreshold: number,
): CalibrationRunOptions {
  const space = createFootballCandidateSpace(spaceConfig());
  const baseline = space.materialize(space.generalistBaselinePoint());
  return {
    domainPack: footballDomainPack,
    organization: baseline.bundle,
    seed: "cal-test",
    ensembleSize: 2,
    scenarioConfig: SMALL_SCENARIO,
    observation,
    driftThreshold,
  };
}

/** A synthetic record with exact, hand-checkable per-dimension drifts. */
function syntheticRecord(absErrors: Record<string, number | null>): CalibrationRecord {
  const dimensions = Object.entries(absErrors).map(([dimensionId, absError]) => ({
    dimensionId,
    predicted: absError === null ? null : 0.5 + absError,
    observed: absError === null ? null : 0.5,
    error: absError === null ? null : absError,
    absError,
    observationSourceClass: "lab-simulation" as const,
  }));
  const comparable = dimensions.filter((dimension) => dimension.absError !== null);
  const measuredDrift =
    comparable.length === 0
      ? null
      : comparable.reduce((sum, dimension) => sum + (dimension.absError ?? 0), 0) /
        comparable.length;
  return {
    schemaVersion: "lab-calibration/0.1",
    calibrationId: "synthetic",
    evaluator: { evaluatorId: "e", evaluatorVersion: "1" },
    domainPack: { domainPackId: "football", domainPackVersion: "0.1.0" },
    organization: { organizationId: "org", version: 1 },
    seed: "synthetic",
    prediction: { sourceClass: "lab-simulation", ensembleSize: 1, description: "" },
    observation: {
      sourceClass: "lab-simulation",
      kind: "perturbed-ensemble",
      description: "",
      perturbations: null,
    },
    dimensions,
    drift: {
      measuredDrift,
      comparableDimensions: comparable.length,
      skippedDimensionIds: dimensions
        .filter((dimension) => dimension.absError === null)
        .map((dimension) => dimension.dimensionId),
    },
    timestampWindow: { kind: "simulated-clock", startMs: 0, endMs: 20_000, note: "" },
    provenance: { provenanceClass: "lab-simulation", note: "" },
  };
}

describe("the deterministic calibration driver", () => {
  test("same inputs ⇒ deep-equal record AND drift state", () => {
    const observation: CalibrationObservationSource = {
      sourceClass: "lab-simulation",
      kind: "perturbed-ensemble",
      perturbations: {
        description: "adversarial faults + degraded sources",
        faultProfile: FOOTBALL_FAULT_PROFILES.find((p) => p.profileId === "football-adversarial"),
        scenarioOverrides: { sourceProfile: "degraded" },
      },
    };
    const first = runCalibration(calibrationOptions(observation, 0.05));
    const second = runCalibration(calibrationOptions(observation, 0.05));
    expect(JSON.stringify(first.record)).toBe(JSON.stringify(second.record));
    expect(first.record.calibrationId).toBe(second.record.calibrationId);
    expect(JSON.stringify(first.drift)).toBe(JSON.stringify(second.drift));
    // No wall clock inside the record.
    expect(JSON.stringify(first.record)).not.toContain("startedAtEpochMs");
  });

  test("the record carries evaluator + pack versions, window, and lab provenance", () => {
    const result = runCalibration(
      calibrationOptions(
        {
          sourceClass: "lab-simulation",
          kind: "perturbed-ensemble",
          perturbations: { description: "longer observed window" },
        },
        0.05,
      ),
    );
    const record = result.record;
    expect(record.schemaVersion).toBe("lab-calibration/0.1");
    expect(record.evaluator.evaluatorId).toBe("football-lab-evaluator");
    expect(record.evaluator.evaluatorVersion).toBe("0.2.0");
    expect(record.domainPack).toEqual({ domainPackId: "football", domainPackVersion: "0.1.0" });
    expect(record.timestampWindow).toEqual({
      kind: "simulated-clock",
      startMs: 0,
      endMs: 20_000,
      note: expect.stringContaining("no wall clock"),
    });
    expect(record.provenance.provenanceClass).toBe("lab-simulation");
    expect(record.prediction.sourceClass).toBe("lab-simulation");
    expect(Object.isFrozen(record)).toBe(true);
  });

  test("MEASURED: fault perturbations leave comparable dims identical (drift 0, reliability skipped)", () => {
    // Honest measured outcome: under adversarial faults + a degraded source,
    // the generalist baseline's evidence-backed scripted policy scores
    // IDENTICALLY on every dimension measurable in BOTH ensembles — the only
    // fault-sensitive dimension (reliability) is unmeasurable clean-side, so
    // it is LISTED as skipped, never imputed.
    const adversarial = FOOTBALL_FAULT_PROFILES.find((p) => p.profileId === "football-adversarial");
    const result = runCalibration(
      calibrationOptions(
        {
          sourceClass: "lab-simulation",
          kind: "perturbed-ensemble",
          perturbations: {
            description: "adversarial faults + degraded source",
            faultProfile: adversarial,
            scenarioOverrides: { sourceProfile: "degraded" },
          },
        },
        0.05,
      ),
    );
    expect(result.record.drift.measuredDrift).toBe(0);
    expect(result.record.drift.comparableDimensions).toBe(6);
    expect(result.record.drift.skippedDimensionIds).toContain("reliability");
    expect(result.record.drift.skippedDimensionIds).toContain("motion-fidelity");
    expect(result.drift.status).toBe("calibrated"); // 0 < 0.05
    // The observation side is honestly labeled lab-simulation on every dim.
    expect(
      result.record.dimensions.every(
        (dimension) => dimension.observationSourceClass === "lab-simulation",
      ),
    ).toBe(true);
  });

  test("MEASURED: a duration perturbation drifts cost/compute — hand-checkable MAE = 1/15", () => {
    // Doubling the observed window doubles the run's calls/cost:
    //   compute-usage 200/600 -> 400/600: |0.6667 - 0.3333| = 1/3
    //   cost 1 - 0.2/3 -> 1 - 0.4/3: |0.9333 - 0.8667| = 1/15
    //   every other comparable dim is unperturbed (0)
    // MAE over 6 comparable dims = (1/3 + 1/15)/6 = 1/15 ~= 0.0667.
    const result = runCalibration(
      calibrationOptions(
        {
          sourceClass: "lab-simulation",
          kind: "perturbed-ensemble",
          perturbations: {
            description: "observed window is twice as long (40s vs 20s)",
            scenarioOverrides: { matchDurationMs: 40_000 },
          },
        },
        0.05,
      ),
    );
    expect(result.record.drift.comparableDimensions).toBe(6);
    expect(result.record.drift.measuredDrift).toBeCloseTo(1 / 15, 12);
    const compute = result.record.dimensions.find((d) => d.dimensionId === "compute-usage");
    const cost = result.record.dimensions.find((d) => d.dimensionId === "cost");
    expect(compute?.absError).toBeCloseTo(1 / 3, 12);
    expect(cost?.absError).toBeCloseTo(1 / 15, 12);
    // Drift detection fires exactly per the configured threshold.
    expect(result.drift.status).toBe("drift-exceeded"); // 0.0667 >= 0.05
    const calm = runCalibration(
      calibrationOptions(
        {
          sourceClass: "lab-simulation",
          kind: "perturbed-ensemble",
          perturbations: {
            description: "observed window is twice as long (40s vs 20s)",
            scenarioOverrides: { matchDurationMs: 40_000 },
          },
        },
        0.1, // above the measured drift
      ),
    );
    expect(calm.drift.status).toBe("calibrated"); // 0.0667 < 0.1
    expect(calm.record.drift.measuredDrift).toBe(result.record.drift.measuredDrift);
  });
});

describe("the three observation source classes, distinguished", () => {
  test("historical-replay: provided scores carry the class on every dimension", () => {
    const result = runCalibration(
      calibrationOptions(
        {
          sourceClass: "historical-replay",
          kind: "provided-scores",
          description: "replayed 2023 fixture window",
          observedScores: [
            { dimensionId: "event-source-fidelity", score: 0.7 },
            { dimensionId: "identity-continuity", score: 1.0 },
          ],
        },
        0.05,
      ),
    );
    expect(result.record.observation.sourceClass).toBe("historical-replay");
    expect(result.record.observation.kind).toBe("provided-scores");
    expect(
      result.record.dimensions.every(
        (dimension) => dimension.observationSourceClass === "historical-replay",
      ),
    ).toBe(true);
    // Only the provided dims comparable prediction-side count:
    // |1.0 - 0.7|/2 + |1.0 - 1.0|/2 = 0.15.
    expect(result.record.drift.comparableDimensions).toBe(2);
    expect(result.record.drift.measuredDrift).toBeCloseTo(0.15, 12);
    expect(result.drift.status).toBe("drift-exceeded");
  });

  test("real-observation: the same scores are a DIFFERENT, distinguished class", () => {
    const result = runCalibration(
      calibrationOptions(
        {
          sourceClass: "real-observation",
          kind: "provided-scores",
          description: "actually-observed production measurements",
          observedScores: [{ dimensionId: "event-source-fidelity", score: 0.7 }],
        },
        0.05,
      ),
    );
    expect(result.record.observation.sourceClass).toBe("real-observation");
    expect(
      result.record.dimensions.every(
        (dimension) => dimension.observationSourceClass === "real-observation",
      ),
    ).toBe(true);
    expect(result.record.drift.comparableDimensions).toBe(1);
    expect(result.record.drift.measuredDrift).toBeCloseTo(0.3, 12); // |1.0 - 0.7|
    // The record itself is still LAB evidence (ADR-013 §8).
    expect(result.record.provenance.provenanceClass).toBe("lab-simulation");
  });

  test("duplicate provided scores are refused with a typed error", () => {
    expect(() =>
      runCalibration(
        calibrationOptions(
          {
            sourceClass: "real-observation",
            kind: "provided-scores",
            description: "bad input",
            observedScores: [
              { dimensionId: "cost", score: 0.5 },
              { dimensionId: "cost", score: 0.6 },
            ],
          },
          0.05,
        ),
      ),
    ).toThrow(/duplicate observed score/);
  });

  test("invalid options are refused (ensemble size, threshold)", () => {
    expect(() =>
      runCalibration({
        ...calibrationOptions(
          {
            sourceClass: "lab-simulation",
            kind: "perturbed-ensemble",
            perturbations: { description: "x" },
          },
          0.05,
        ),
        ensembleSize: 0,
      }),
    ).toThrow(/ensembleSize/);
    expect(() =>
      runCalibration({
        ...calibrationOptions(
          {
            sourceClass: "lab-simulation",
            kind: "perturbed-ensemble",
            perturbations: { description: "x" },
          },
          -1,
        ),
      }),
    ).toThrow(/driftThreshold/);
  });
});

describe("drift detection — fires at/beyond the threshold, never below", () => {
  test("absErrors {a: 0.1, b: 0.3} ⇒ drift 0.2: fires at 0.2, not at 0.2+ε", () => {
    const record = syntheticRecord({ a: 0.1, b: 0.3 });
    expect(record.drift.measuredDrift).toBeCloseTo(0.2, 12);
    const drift = record.drift.measuredDrift ?? 0;
    // AT the threshold (exactly equal) — fires.
    expect(detectCalibrationDrift(record, drift).status).toBe("drift-exceeded");
    // A hair below — still fires (it is beyond the threshold).
    expect(detectCalibrationDrift(record, drift - 1e-9).status).toBe("drift-exceeded");
    // A hair above the drift — does NOT fire (below threshold never fires).
    expect(detectCalibrationDrift(record, drift + 1e-9).status).toBe("calibrated");
    // Comfortably above — does not fire.
    expect(detectCalibrationDrift(record, 0.5).status).toBe("calibrated");
  });

  test("zero drift with a zero threshold fires (0 >= 0 — exactly as configured)", () => {
    const record = syntheticRecord({ a: 0, b: 0 });
    expect(record.drift.measuredDrift).toBe(0);
    expect(detectCalibrationDrift(record, 0).status).toBe("drift-exceeded");
    expect(detectCalibrationDrift(record, 0.0001).status).toBe("calibrated");
  });

  test("nothing comparable ⇒ honestly uncalibrated, never a silent zero", () => {
    const record = syntheticRecord({ a: null, b: null });
    const state = detectCalibrationDrift(record, 0.05);
    expect(state.status).toBe("uncalibrated");
    expect(state.measuredDrift).toBeNull();
    expect(state.comparableDimensions).toBe(0);
  });

  test("per-dimension exceeded flags mirror the threshold", () => {
    const record = syntheticRecord({ a: 0.04, b: 0.06, c: 0.05 });
    const state = detectCalibrationDrift(record, 0.05);
    expect(state.status).toBe("drift-exceeded"); // MAE 0.05 >= 0.05
    const flags = new Map(state.perDimension.map((d) => [d.dimensionId, d.exceeded]));
    expect(flags.get("a")).toBe(false); // 0.04 < 0.05
    expect(flags.get("b")).toBe(true); // 0.06 >= 0.05
    expect(flags.get("c")).toBe(true); // 0.05 >= 0.05 (at the threshold)
  });
});

describe("the CalibrationPort adapter", () => {
  test("starts uncalibrated; consuming updates state; latest record wins; never throws", () => {
    const port = createCalibrationPort({ driftThreshold: 0.1 });
    expect(port.state().status).toBe("uncalibrated");
    expect(port.state().recordsConsumed).toBe(0);
    expect(port.state().lastCalibrationId).toBeNull();

    const drifted = syntheticRecord({ a: 0.5 }); // drift 0.5 >= 0.1
    const afterDrift = port.consume(drifted);
    expect(afterDrift.status).toBe("drift-exceeded");
    expect(afterDrift.recordsConsumed).toBe(1);
    expect(afterDrift.lastCalibrationId).toBe(drifted.calibrationId);
    expect(port.state()).toEqual(afterDrift);

    const calm = { ...syntheticRecord({ a: 0.01 }), calibrationId: "calm" }; // drift 0.01 < 0.1
    const afterCalm = port.consume(calm);
    expect(afterCalm.status).toBe("calibrated"); // latest record wins
    expect(afterCalm.recordsConsumed).toBe(2);
    expect(afterCalm.lastCalibrationId).toBe("calm");
    expect(port.state().recordsConsumed).toBe(2);

    // Drift beyond threshold is a RECORDED STATE — consuming never throws.
    expect(() => port.consume(drifted)).not.toThrow();
    expect(port.state().status).toBe("drift-exceeded");
    expect(port.state().recordsConsumed).toBe(3);
  });

  test("a negative threshold is refused with a typed error", () => {
    expect(() => createCalibrationPort({ driftThreshold: -0.1 })).toThrow(/driftThreshold/);
  });
});
