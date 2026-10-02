/**
 * Robustness benchmark tests (REL-025): the completed architecture §9
 * record — every field present and MEASURED; determinism (same seed +
 * config ⇒ deep-equal); the failure envelope firing exactly at its
 * measured boundary (a constructed drop-triggered fabricating model);
 * the OOD family distinct from the standard family; simulator-model
 * agreement recording a CONSTRUCTED disagreement instead of hiding it;
 * cost/latency from simulated fields only; and the REL-003 aggregate
 * reused verbatim (same object references).
 */
import { describe, expect, test } from "bun:test";
import { BASKETBALL_SMALL_SCENARIO, basketballGeneralistBundle } from "./fixtures";
import {
  basketballDomainPack,
  runRobustnessBenchmark,
  type LabBodyInput,
  type LabBodyOutput,
  createScriptedModelRuntime,
  type FaultProfile,
} from "../src";
import { basketballDomainSimulationProfile } from "../src/simulation/basketball-simulator";

/** The generalist benchmark options (basketball, the second domain). */
function generalistOptions() {
  const { bundle } = basketballGeneralistBundle();
  return {
    domainPack: basketballDomainPack,
    simulationProfile: basketballDomainSimulationProfile,
    organization: bundle,
    baseSeed: "bench-rel025",
    ensembleSize: 2,
    scenarioConfig: BASKETBALL_SMALL_SCENARIO,
    ood: { scenarioOverrides: { sourceProfile: "degraded" as const } },
    severities: [1, 2] as const,
    sweepSize: 1,
  };
}

describe("the §9 record — every field present and measured", () => {
  test("expected score, uncertainty, seed robustness, agreement, OOD, distributions, envelope, coverage", () => {
    const record = runRobustnessBenchmark(generalistOptions());

    // expected score + uncertainty + variance (REL-003 aggregate, reused).
    expect(record.expectedScore.overall).not.toBeNull();
    expect(record.variance.overall).not.toBeNull();
    expect(record.uncertainty.overall.mean).not.toBeNull();
    expect(record.uncertainty.overall.min).not.toBeNull();
    expect(record.uncertainty.overall.max).not.toBeNull();
    // seed robustness (measured over the standard ensemble).
    expect(record.seedRobustness.seedsTested).toBe(2);
    expect(record.seedRobustness.validFraction).toBe(1);
    expect(record.seedRobustness.distinctTrajectoryHashes).toBe(2);
    // simulator-model agreement (measured claim-by-claim).
    expect(record.simulatorModelAgreement.claimsExamined).toBeGreaterThan(0);
    expect(record.simulatorModelAgreement.agreed).toBe(
      record.simulatorModelAgreement.claimsExamined,
    );
    expect(record.simulatorModelAgreement.kindDisagreements).toBe(0);
    expect(record.simulatorModelAgreement.unmatchedClaims).toBe(0);
    expect(record.simulatorModelAgreement.perClaim.length).toBe(
      record.simulatorModelAgreement.claimsExamined,
    );
    // OOD family (measured fault-tick distinction + score comparison).
    expect(record.outOfDistribution.family.faultProfileId).toBe("basketball-adversarial");
    expect(record.outOfDistribution.faultTicksStandard).toBe(0);
    expect(record.outOfDistribution.faultTicksOod).toBeGreaterThan(0);
    expect(record.outOfDistribution.overallScoreOod).not.toBeNull();
    expect(record.outOfDistribution.scoreDelta).not.toBeNull();
    // cost/latency distribution (simulated fields, per-run).
    expect(record.costLatencyDistribution.standard.perRun).toHaveLength(2);
    expect(record.costLatencyDistribution.ood.perRun).toHaveLength(2);
    for (const family of [
      record.costLatencyDistribution.standard,
      record.costLatencyDistribution.ood,
    ]) {
      for (const entry of family.perRun) {
        expect(entry.costUsd).toBeGreaterThan(0);
        expect(entry.meanLatencyMs).not.toBeNull();
      }
      expect(family.costUsd.mean).not.toBeNull();
      expect(family.meanLatencyMs.mean).not.toBeNull();
    }
    // known failure envelope (measured rows; honest none-within-swept-range
    // for the clean generalist — the constructed model below fires it).
    expect(record.knownFailureEnvelope.severities).toHaveLength(2);
    for (const row of record.knownFailureEnvelope.severities) {
      expect(row.validFraction).toBe(1);
      expect(row.runIds.length).toBe(1);
      expect(row.derivedProfileId.length).toBeGreaterThan(0);
    }
    expect(record.knownFailureEnvelope.boundarySeverity).toBeNull();
    expect(record.knownFailureEnvelope.note).toContain("none-within-swept-range");
    // corpus coverage (versioned, honest not-covered list).
    expect(record.benchmarkCorpusCoverage.coverageVersion).toBe("robustness-corpus/0.1");
    expect(record.benchmarkCorpusCoverage.families).toHaveLength(4);
    expect(record.benchmarkCorpusCoverage.families.map((family) => family.familyId)).toEqual([
      "standard-clean",
      "simulator-model-agreement",
      "out-of-distribution",
      "failure-envelope-sweep",
    ]);
    expect(record.benchmarkCorpusCoverage.covered.length).toBeGreaterThan(0);
    expect(record.benchmarkCorpusCoverage.notCovered.length).toBeGreaterThan(0);
    expect(record.benchmarkCorpusCoverage.notCovered.join(" ")).toContain("wall-clock");
    // identity + provenance.
    expect(record.schemaVersion).toBe("lab-robustness/0.1");
    expect(record.benchmarkId.length).toBeGreaterThan(0);
    expect(record.provenance.provenanceClass).toBe("lab-simulation");
  });

  test("the REL-003 aggregate is REUSED VERBATIM — same object references, never re-derived", () => {
    const record = runRobustnessBenchmark(generalistOptions());
    expect(record.expectedScore).toBe(record.ensemble.aggregate.expectedScore);
    expect(record.variance).toBe(record.ensemble.aggregate.variance);
    expect(record.uncertainty).toBe(record.ensemble.aggregate.uncertainty);
    expect(record.seedRobustness).toBe(record.ensemble.aggregate.seedRobustness);
  });

  test("determinism: same seed + config ⇒ deep-equal record (no wall clock anywhere)", () => {
    const first = runRobustnessBenchmark(generalistOptions());
    const second = runRobustnessBenchmark(generalistOptions());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.benchmarkId).toBe(second.benchmarkId);
    // No wall-clock leakage: the record embeds deterministic run views only.
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain("startedAtEpochMs");
    expect(serialized).not.toContain('"execution"');
    expect(serialized).not.toContain('durationMs":');
  });

  test("cost/latency come from the scripted runtimes' simulated constants", () => {
    const record = runRobustnessBenchmark(generalistOptions());
    // The generalist scripted runtime models 120ms per call — every run's
    // mean action latency IS that constant (measured: the distribution's
    // per-run values equal the modeled value exactly).
    for (const entry of record.costLatencyDistribution.standard.perRun) {
      expect(entry.meanLatencyMs).toBe(120);
    }
    expect(record.costLatencyDistribution.standard.note).toContain("never wall-clock");
  });

  test("the OOD family is DISTINCT from the standard family", () => {
    const record = runRobustnessBenchmark(generalistOptions());
    expect(record.outOfDistribution.ensemble.ensembleId).not.toBe(record.ensemble.ensembleId);
    expect(record.outOfDistribution.ensemble.faultProfileId).toBe("basketball-adversarial");
    expect(record.ensemble.faultProfileId).toBeNull();
    expect(record.outOfDistribution.faultTicksOod).toBeGreaterThan(
      record.outOfDistribution.faultTicksStandard,
    );
    // Distinct run ids across the families (seeded families never collide).
    const standardIds = new Set(record.ensemble.runs.map((run) => run.runId));
    for (const run of record.outOfDistribution.ensemble.runs) {
      expect(standardIds.has(run.runId)).toBe(false);
    }
  });
});

describe("simulator-model agreement — a constructed disagreement is RECORDED, not hidden", () => {
  test("a wrong-kind model shows kindDisagreements = claims, agreed = 0", () => {
    const { bundle, body } = basketballGeneralistBundle();
    const wrongKind = createScriptedModelRuntime({
      modelId: "wrong-kind-policy",
      modelVersion: "0.1.0",
      handler: (input: LabBodyInput): LabBodyOutput => ({
        actions: input.observations
          .filter((observation) => observation.kindId === "event-record")
          .map((observation) => {
            const payload = observation.payload as { eventId: string; eventKindId: string };
            return {
              actionId: "emit-canonical-event" as const,
              claimId: `claim-wrong-${payload.eventId}`,
              // The evidence is REAL (received) but the claimed kind is
              // WRONG — a kind OUTSIDE the pack's taxonomy, so no claim
              // can coincide with the world's recorded kind.
              eventKindId: "hoop-trick",
              evidenceRef: observation.observationId,
              clockMs: observation.clockMs,
            };
          }),
      }),
    });
    const definition = {
      ...bundle.definition,
      nodes: bundle.definition.nodes.map((node) => ({
        ...node,
        binding: {
          ...node.binding,
          modelId: "wrong-kind-policy",
          modelVersion: "0.1.0",
          runtimeId: wrongKind.runtimeId,
        },
      })),
    };
    const record = runRobustnessBenchmark({
      ...generalistOptions(),
      organization: {
        definition,
        bodies: [body],
        runtimes: new Map([[wrongKind.runtimeId, wrongKind]]),
      },
    });
    const agreement = record.simulatorModelAgreement;
    // MEASURED: every claim disagreed on kind; every claim still resolved
    // to a real sim event (the evidence is honest; the model path is not).
    expect(agreement.claimsExamined).toBeGreaterThan(0);
    expect(agreement.kindDisagreements).toBe(agreement.claimsExamined);
    expect(agreement.agreed).toBe(0);
    expect(agreement.unmatchedClaims).toBe(0);
    for (const claim of agreement.perClaim) {
      expect(claim.claimedEventKindId).toBe("hoop-trick");
      expect(claim.groundTruthEventKindId).not.toBeNull();
      expect(claim.groundTruthEventKindId).not.toBe("hoop-trick");
      expect(claim.agreed).toBe(false);
    }
  });
});

describe("the known failure envelope — a constructed drop-triggered fabricating model", () => {
  /**
   * The envelope sweep multiplies severity into the fault profile's rates.
   * The constructed profile below (dropped-frames rate 0.005, boost 0.9)
   * MEASURES: severity 1 ⇒ zero dropped broadcast frames on the pinned
   * sweep seed (no fabrication, validFraction stays 1); severity 2 ⇒ one
   * dropped frame (the fabricating model fires, validFraction drops to 0).
   * The boundary is MEASURED at severity 2 with the 1 → 0 transition.
   */
  const envelopeProfile: FaultProfile = {
    profileId: "envelope-drop-trigger",
    description:
      "constructed drop-trigger profile: dropped-frames rate 0.005 (x severity), " +
      "boost 0.9 — severity 1 measures zero drops, severity 2 drops one frame",
    rates: {
      "compute-provider-failure": 0,
      "source-disagreement": 0,
      occlusion: 0,
      "processing-latency": 0,
      "dropped-frames": 0.005,
    },
    params: { "dropped-frames": { dropRateBoost: 0.9, durationTicks: 4 } },
  };

  function dropTriggeredBundle() {
    const { bundle, body } = basketballGeneralistBundle();
    const fabricating = createScriptedModelRuntime({
      modelId: "drop-triggered-fabricator",
      modelVersion: "0.1.0",
      handler: (input: LabBodyInput): LabBodyOutput => ({
        actions: input.observations
          .filter(
            (observation) =>
              observation.kindId === "broadcast-frame" &&
              (observation.payload as { dropped?: unknown }).dropped === true,
          )
          .map((observation) => ({
            actionId: "emit-canonical-event" as const,
            claimId: `claim-fabricated-${observation.observationId}`,
            eventKindId: "pass",
            // The fabrication: evidence the run NEVER provided.
            evidenceRef: "obs-evt-fabricated-never-received",
            clockMs: observation.clockMs,
          })),
      }),
    });
    const definition = {
      ...bundle.definition,
      nodes: bundle.definition.nodes.map((node) => ({
        ...node,
        binding: {
          ...node.binding,
          modelId: "drop-triggered-fabricator",
          modelVersion: "0.1.0",
          runtimeId: fabricating.runtimeId,
        },
      })),
    };
    return {
      definition,
      bodies: [body],
      runtimes: new Map([[fabricating.runtimeId, fabricating]]),
    };
  }

  test("the boundary fires EXACTLY at severity 2: validFraction 1 → 0", () => {
    const record = runRobustnessBenchmark({
      domainPack: basketballDomainPack,
      simulationProfile: basketballDomainSimulationProfile,
      organization: dropTriggeredBundle(),
      baseSeed: "bench-envelope",
      ensembleSize: 1,
      scenarioConfig: BASKETBALL_SMALL_SCENARIO,
      ood: {
        faultProfile: envelopeProfile,
        description: "constructed drop-trigger OOD family",
      },
      severities: [1, 2],
      sweepSize: 1,
    });
    const rows = record.knownFailureEnvelope.severities;
    expect(rows).toHaveLength(2);
    // MEASURED: severity 1 keeps every sweep run valid; severity 2 breaks them.
    expect(rows[0]?.severity).toBe(1);
    expect(rows[0]?.validFraction).toBe(1);
    expect(rows[0]?.faultTicks).toBe(0);
    expect(rows[1]?.severity).toBe(2);
    expect(rows[1]?.validFraction).toBe(0);
    expect(rows[1]?.faultTicks).toBeGreaterThan(0);
    // The boundary is the measured lowest severity with validFraction < 1.
    expect(record.knownFailureEnvelope.boundarySeverity).toBe(2);
    expect(record.knownFailureEnvelope.note).toContain("severity 2");
  });

  test("the boundary is deterministic — the same construct fires at 2 twice", () => {
    const run = () =>
      runRobustnessBenchmark({
        domainPack: basketballDomainPack,
        simulationProfile: basketballDomainSimulationProfile,
        organization: dropTriggeredBundle(),
        baseSeed: "bench-envelope",
        ensembleSize: 1,
        scenarioConfig: BASKETBALL_SMALL_SCENARIO,
        ood: {
          faultProfile: envelopeProfile,
          description: "constructed drop-trigger OOD family",
        },
        severities: [1, 2],
        sweepSize: 1,
      });
    const first = run();
    const second = run();
    expect(first.knownFailureEnvelope.boundarySeverity).toBe(2);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
