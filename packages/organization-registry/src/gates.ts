/**
 * The promotion eligibility gates (REL-018) — each an explicit,
 * evidence-requiring check over the record, in the frozen pipeline order
 * (docs/contracts/organization-registry-and-promotion.md):
 *
 *   reproducibility -> benchmark -> robustness -> rights/provenance
 *   -> cost/latency -> security/policy -> canary
 *
 * THE HARD RULE is enforced HERE, structurally: the gates read ONLY the six
 * measured evidence objects (+ canary evidence + the record's declared
 * profile). `evidence.simulatorReward` is not an input to any gate — a
 * record whose evidence bundle carries only a simulator-reward score is
 * refused with `missing` results on benchmark/robustness/rights (and every
 * other evidence-requiring gate), and the refusal detail says so in words.
 *
 * Everything here is PURE: (record, policy thresholds) -> results. The
 * thresholds live in the versioned PromotionPolicy (src/promotion.ts) so
 * every bar ever applied is recorded with the transition that applied it.
 */
import type { OrganizationRecord, RobustnessEvidence } from "./domain";

/** The gate vocabulary, in pipeline order. */
export const GATE_IDS = [
  "reproducibility",
  "benchmark",
  "robustness",
  "rights-provenance",
  "cost-latency",
  "security-policy",
  "canary",
] as const;

export type GateId = (typeof GATE_IDS)[number];

/** Type guard for {@link GateId}. */
export function isGateId(value: unknown): value is GateId {
  return typeof value === "string" && (GATE_IDS as readonly string[]).includes(value);
}

/** The outcome of one gate evaluation. */
export interface GateResult {
  gate: GateId;
  /** `missing` = the evidence object is absent (never waved through). */
  status: "pass" | "fail" | "missing";
  /** Auditable, human-readable verdict naming the law and the numbers. */
  detail: string;
  /** JSON-safe measured values, recorded into the transition log entry. */
  measured: Record<string, unknown>;
}

/**
 * The versioned thresholds the policy supplies to the gates. Every field is
 * required (no silent defaults — an incomplete policy fails closed at
 * policy validation time, not mid-promotion).
 */
export interface GatePolicy {
  reproducibility: {
    /** Minimum independent reproduction runs. */
    minReproductionRuns: number;
  };
  benchmark: {
    /** Minimum quality score per axis (the quality bar, by axis). */
    minimumScores: Record<string, number>;
  };
  robustness: {
    minSeedsTested: number;
    /** Minimum out-of-distribution score in [0, 10]. */
    minOutOfDistributionScore: number;
    /** Minimum simulator-model agreement in [0, 1]. */
    minSimulatorModelAgreement: number;
    /** Minimum benchmark corpus coverage in [0, 1]. */
    minBenchmarkCorpusCoverage: number;
  };
  "rights-provenance": {
    /** nothing configurable: an unverified basis always fails */
    readonly [key: string]: never;
  };
  "cost-latency": {
    maxP95LatencyMs: number;
    maxPerRunUsd: number;
    /** Minimum measured samples backing the declared profile. */
    minSampleCount: number;
  };
  "security-policy": {
    /** Check ids the policy demands to have run (all must be present+passed). */
    requiredChecks: string[];
  };
  canary: {
    /** Minimum canary observations before production is even discussable. */
    minCanaryObservations: number;
  };
}

/**
 * The in-words statement of THE HARD RULE, appended to `missing` results on
 * the three mandatory independent inputs when a simulator reward is present
 * — the refusal must teach the caller WHY the shiny score did not count.
 */
function simulatorRewardNote(record: OrganizationRecord, gateLabel: string): string {
  const reward = record.evidence.simulatorReward;
  if (reward === undefined) return "";
  return ` (a simulator reward IS present — rewardVersion ${reward.rewardVersion}, score ${reward.score} — but a simulator-reward score is not ${gateLabel} evidence: the REL-018 hard rule makes benchmark, robustness and rights mandatory INDEPENDENT inputs)`;
}

// ---------------------------------------------------------------------------
// Gate 1 — reproducibility
// ---------------------------------------------------------------------------

/** Evaluates the reproducibility gate (deterministic lab-run reproduction). */
export function evaluateReproducibilityGate(
  record: OrganizationRecord,
  policy: GatePolicy["reproducibility"],
): GateResult {
  const evidence = record.evidence.reproducibility;
  if (evidence === undefined) {
    return {
      gate: "reproducibility",
      status: "missing",
      detail:
        "no reproducibility evidence on the record: the lab run must be reproduced from seed + configuration before any promotion" +
        simulatorRewardNote(record, "reproducibility"),
      measured: {},
    };
  }
  const measured = {
    labRunId: evidence.labRunId,
    configurationVersion: evidence.configurationVersion,
    reproductionRuns: evidence.reproductionRuns,
    identicalRuns: evidence.identicalRuns,
    minReproductionRuns: policy.minReproductionRuns,
  };
  if (evidence.reproductionRuns < policy.minReproductionRuns) {
    return {
      gate: "reproducibility",
      status: "fail",
      detail: `reproducibility failed: ${evidence.reproductionRuns} reproduction runs < policy minimum ${policy.minReproductionRuns}`,
      measured,
    };
  }
  if (evidence.identicalRuns !== evidence.reproductionRuns) {
    return {
      gate: "reproducibility",
      status: "fail",
      detail: `reproducibility failed: only ${evidence.identicalRuns}/${evidence.reproductionRuns} runs reproduced identical trajectories`,
      measured,
    };
  }
  const createdFrom = record.provenance.createdFrom;
  if (createdFrom !== null && createdFrom.labRunId !== evidence.labRunId) {
    return {
      gate: "reproducibility",
      status: "fail",
      detail: `reproducibility failed: the record was created from lab run ${createdFrom.labRunId} but the reproduction evidence covers lab run ${evidence.labRunId}`,
      measured,
    };
  }
  return {
    gate: "reproducibility",
    status: "pass",
    detail: `reproducibility passed: ${evidence.reproductionRuns}/${evidence.reproductionRuns} runs reproduced identically from configuration ${evidence.configurationVersion} (lab run ${evidence.labRunId})`,
    measured,
  };
}

// ---------------------------------------------------------------------------
// Gate 2 — benchmark (a mandatory independent input under THE HARD RULE)
// ---------------------------------------------------------------------------

/** One axis verdict inside the benchmark gate result. */
interface BenchmarkAxisVerdict {
  axis: string;
  value: number | null;
  minimum: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  passed: boolean;
}

/** Evaluates the benchmark gate (measured on the frozen corpus, not the simulator). */
export function evaluateBenchmarkGate(
  record: OrganizationRecord,
  policy: GatePolicy["benchmark"],
): GateResult {
  const evidence = record.evidence.benchmark;
  if (evidence === undefined) {
    return {
      gate: "benchmark",
      status: "missing",
      detail:
        "no benchmark evidence on the record: expected quality metrics + uncertainty measured on a frozen benchmark corpus are mandatory for promotion" +
        simulatorRewardNote(record, "benchmark"),
      measured: {},
    };
  }
  const verdicts: BenchmarkAxisVerdict[] = [];
  for (const axis of Object.keys(policy.minimumScores)) {
    const minimum = policy.minimumScores[axis];
    if (minimum === undefined) {
      // Unreachable when the policy is a well-formed Record — fail closed.
      verdicts.push({
        axis,
        value: Number.NaN,
        minimum: null,
        ciLow: null,
        ciHigh: null,
        passed: false,
      });
      continue;
    }
    const metric = evidence.metrics.find((m) => m.axis === axis);
    const uncertainty = evidence.uncertainty.find((u) => u.axis === axis);
    const value = metric?.value ?? null;
    const ciLow = uncertainty?.ciLow ?? null;
    const ciHigh = uncertainty?.ciHigh ?? null;
    const passed =
      metric !== undefined &&
      value !== null &&
      value >= minimum &&
      uncertainty !== undefined &&
      ciLow !== null &&
      ciHigh !== null &&
      ciLow <= value &&
      value <= ciHigh;
    verdicts.push({ axis, value, minimum, ciLow, ciHigh, passed });
  }
  const failed = verdicts.filter((v) => !v.passed);
  const measured = {
    corpusVersion: evidence.corpusVersion,
    evaluatorVersion: evidence.evaluatorVersion,
    axes: verdicts,
  };
  if (failed.length > 0) {
    return {
      gate: "benchmark",
      status: "fail",
      detail: `benchmark failed on ${failed.length} axis(es): ${failed
        .map(
          (v) =>
            `${v.axis}=${v.value} (minimum ${v.minimum}, uncertainty ${
              v.ciLow !== null && v.ciHigh !== null ? `[${v.ciLow}, ${v.ciHigh}]` : "absent"
            })`,
        )
        .join("; ")}`,
      measured,
    };
  }
  return {
    gate: "benchmark",
    status: "pass",
    detail: `benchmark passed on ${verdicts.length} axis(es) against corpus ${evidence.corpusVersion} (evaluator ${evidence.evaluatorVersion})`,
    measured,
  };
}

// ---------------------------------------------------------------------------
// Gate 3 — robustness (a mandatory independent input under THE HARD RULE)
// ---------------------------------------------------------------------------

/** The robustness numbers, extracted for the audit record. */
export function robustnessMeasured(evidence: RobustnessEvidence): Record<string, unknown> {
  return {
    seedsTested: evidence.seedsTested,
    seedsPassed: evidence.seedsPassed,
    outOfDistributionScore: evidence.outOfDistributionScore,
    simulatorModelAgreement: evidence.simulatorModelAgreement,
    benchmarkCorpusCoverage: evidence.benchmarkCorpusCoverage,
    knownFailureEnvelopeEntries: evidence.knownFailureEnvelope.length,
  };
}

/** Evaluates the robustness gate (seed/ood/agreement/coverage/failure envelope). */
export function evaluateRobustnessGate(
  record: OrganizationRecord,
  policy: GatePolicy["robustness"],
): GateResult {
  const evidence = record.evidence.robustness;
  if (evidence === undefined) {
    return {
      gate: "robustness",
      status: "missing",
      detail:
        "no robustness evidence on the record: seed robustness, OOD score, simulator-model agreement, corpus coverage and a declared failure envelope are mandatory for promotion" +
        simulatorRewardNote(record, "robustness"),
      measured: {},
    };
  }
  const measured = robustnessMeasured(evidence);
  const failures: string[] = [];
  if (evidence.seedsTested < policy.minSeedsTested) {
    failures.push(`seedsTested ${evidence.seedsTested} < ${policy.minSeedsTested}`);
  }
  if (evidence.seedsPassed < evidence.seedsTested) {
    failures.push(
      `seedsPassed ${evidence.seedsPassed}/${evidence.seedsTested} — some seeds failed`,
    );
  }
  if (evidence.outOfDistributionScore < policy.minOutOfDistributionScore) {
    failures.push(
      `OOD score ${evidence.outOfDistributionScore} < ${policy.minOutOfDistributionScore}`,
    );
  }
  if (evidence.simulatorModelAgreement < policy.minSimulatorModelAgreement) {
    failures.push(
      `simulator-model agreement ${evidence.simulatorModelAgreement} < ${policy.minSimulatorModelAgreement}`,
    );
  }
  if (evidence.benchmarkCorpusCoverage < policy.minBenchmarkCorpusCoverage) {
    failures.push(
      `corpus coverage ${evidence.benchmarkCorpusCoverage} < ${policy.minBenchmarkCorpusCoverage}`,
    );
  }
  if (failures.length > 0) {
    return {
      gate: "robustness",
      status: "fail",
      detail: `robustness failed: ${failures.join("; ")}`,
      measured,
    };
  }
  return {
    gate: "robustness",
    status: "pass",
    detail: `robustness passed: ${evidence.seedsPassed}/${evidence.seedsTested} seeds, OOD ${evidence.outOfDistributionScore}, agreement ${evidence.simulatorModelAgreement}, coverage ${evidence.benchmarkCorpusCoverage}, failure envelope declared (${evidence.knownFailureEnvelope.length} entr(ies))`,
    measured,
  };
}

// ---------------------------------------------------------------------------
// Gate 4 — rights / provenance (a mandatory independent input under THE HARD RULE)
// ---------------------------------------------------------------------------

/** Evaluates the rights/provenance gate (ADR-013 #7: no unverified basis). */
export function evaluateRightsProvenanceGate(record: OrganizationRecord): GateResult {
  const evidence = record.evidence.rightsProvenance;
  if (evidence === undefined) {
    return {
      gate: "rights-provenance",
      status: "missing",
      detail:
        "no rights/provenance evidence on the record: a declared rights basis, licenses and provenance lineage are mandatory for promotion" +
        simulatorRewardNote(record, "rights/provenance"),
      measured: {},
    };
  }
  const measured = {
    basisType: evidence.basisType,
    rightsBasisId: evidence.rightsBasisId,
    licenseCount: evidence.licenses.length,
    provenanceLineageCount: evidence.provenanceLineage.length,
  };
  if (evidence.basisType === "unverified") {
    return {
      gate: "rights-provenance",
      status: "fail",
      detail:
        "rights/provenance failed: the declared basis is 'unverified' — a public URL alone never proves transformation rights (ADR-013 #7)",
      measured,
    };
  }
  return {
    gate: "rights-provenance",
    status: "pass",
    detail: `rights/provenance passed: basis '${evidence.basisType}' (${evidence.rightsBasisId}), ${evidence.licenses.length} license(s), lineage depth ${evidence.provenanceLineage.length}`,
    measured,
  };
}

// ---------------------------------------------------------------------------
// Gate 5 — cost / latency (the declared profile vs the policy envelope)
// ---------------------------------------------------------------------------

/** Evaluates the cost/latency gate against the record's declared profile. */
export function evaluateCostLatencyGate(
  record: OrganizationRecord,
  policy: GatePolicy["cost-latency"],
): GateResult {
  const evidence = record.evidence.costLatency;
  if (evidence === undefined) {
    return {
      gate: "cost-latency",
      status: "missing",
      detail:
        "no cost/latency measurement evidence on the record: the declared profile must be backed by measured samples within the policy envelope",
      measured: {},
    };
  }
  const measured = {
    sampleCount: evidence.sampleCount,
    p50Ms: record.profile.latency.p50Ms,
    p95Ms: record.profile.latency.p95Ms,
    p99Ms: record.profile.latency.p99Ms,
    maxP95LatencyMs: policy.maxP95LatencyMs,
    perRunUsd: record.profile.cost.perRunUsd,
    maxPerRunUsd: policy.maxPerRunUsd,
  };
  const failures: string[] = [];
  if (evidence.sampleCount < policy.minSampleCount) {
    failures.push(`sampleCount ${evidence.sampleCount} < ${policy.minSampleCount}`);
  }
  if (record.profile.latency.p95Ms > policy.maxP95LatencyMs) {
    failures.push(
      `p95 latency ${record.profile.latency.p95Ms}ms > policy max ${policy.maxP95LatencyMs}ms`,
    );
  }
  if (record.profile.cost.perRunUsd > policy.maxPerRunUsd) {
    failures.push(
      `per-run cost $${record.profile.cost.perRunUsd} > policy max $${policy.maxPerRunUsd}`,
    );
  }
  if (failures.length > 0) {
    return {
      gate: "cost-latency",
      status: "fail",
      detail: `cost/latency failed: ${failures.join("; ")}`,
      measured,
    };
  }
  return {
    gate: "cost-latency",
    status: "pass",
    detail: `cost/latency passed: p95 ${record.profile.latency.p95Ms}ms <= ${policy.maxP95LatencyMs}ms, $${record.profile.cost.perRunUsd}/run <= $${policy.maxPerRunUsd}, ${evidence.sampleCount} samples`,
    measured,
  };
}

// ---------------------------------------------------------------------------
// Gate 6 — security / policy
// ---------------------------------------------------------------------------

/** Evaluates the security/policy gate (required checks present and passed). */
export function evaluateSecurityPolicyGate(
  record: OrganizationRecord,
  policy: GatePolicy["security-policy"],
): GateResult {
  const evidence = record.evidence.securityPolicy;
  if (evidence === undefined) {
    return {
      gate: "security-policy",
      status: "missing",
      detail:
        "no security/policy evidence on the record: the policy checks that ran (and passed) are mandatory for promotion",
      measured: {},
    };
  }
  const runIds = new Set(evidence.checks.map((c) => c.checkId));
  const missingRequired = policy.requiredChecks.filter((id) => !runIds.has(id));
  const failedChecks = evidence.checks.filter((c) => !c.passed);
  const measured = {
    policyVersion: evidence.policyVersion,
    checksRun: evidence.checks.length,
    checksPassed: evidence.checks.length - failedChecks.length,
    requiredChecks: policy.requiredChecks,
    missingRequiredChecks: missingRequired,
  };
  if (failedChecks.length > 0) {
    return {
      gate: "security-policy",
      status: "fail",
      detail: `security/policy failed: ${failedChecks.length} check(s) failed (${failedChecks
        .map((c) => c.checkId)
        .join(", ")})`,
      measured,
    };
  }
  if (missingRequired.length > 0) {
    return {
      gate: "security-policy",
      status: "fail",
      detail: `security/policy failed: required check(s) never ran (${missingRequired.join(", ")})`,
      measured,
    };
  }
  return {
    gate: "security-policy",
    status: "pass",
    detail: `security/policy passed: ${evidence.checks.length}/${evidence.checks.length} checks passed under policy version ${evidence.policyVersion}`,
    measured,
  };
}

// ---------------------------------------------------------------------------
// Gate 7 — canary (the canary -> production step, REL-A4 "canary pass")
// ---------------------------------------------------------------------------

/** Evaluates the canary gate (isolated, observable traffic; zero triggers). */
export function evaluateCanaryGate(
  record: OrganizationRecord,
  policy: GatePolicy["canary"],
): GateResult {
  const evidence = record.evidence.canary;
  if (evidence === undefined) {
    return {
      gate: "canary",
      status: "missing",
      detail:
        "no canary evidence on the record: production requires an isolated, observable canary window with SLO verdicts",
      measured: {},
    };
  }
  const failedChecks = evidence.sloChecks.filter((c) => !c.passed);
  const measured = {
    canaryWindowMs: evidence.canaryWindowMs,
    observations: evidence.observations,
    sloChecksTotal: evidence.sloChecks.length,
    sloChecksPassed: evidence.sloChecks.length - failedChecks.length,
    rollbackTriggersObserved: evidence.rollbackTriggersObserved,
    minCanaryObservations: policy.minCanaryObservations,
  };
  const failures: string[] = [];
  if (evidence.observations < policy.minCanaryObservations) {
    failures.push(`observations ${evidence.observations} < ${policy.minCanaryObservations}`);
  }
  if (failedChecks.length > 0) {
    failures.push(
      `${failedChecks.length} SLO check(s) failed (${failedChecks.map((c) => c.checkId).join(", ")})`,
    );
  }
  if (evidence.rollbackTriggersObserved > 0) {
    failures.push(
      `${evidence.rollbackTriggersObserved} rollback trigger(s) observed during canary`,
    );
  }
  if (failures.length > 0) {
    return {
      gate: "canary",
      status: "fail",
      detail: `canary failed: ${failures.join("; ")}`,
      measured,
    };
  }
  return {
    gate: "canary",
    status: "pass",
    detail: `canary passed: ${evidence.observations} observations over ${evidence.canaryWindowMs}ms, ${evidence.sloChecks.length}/${evidence.sloChecks.length} SLO checks passed, zero rollback triggers`,
    measured,
  };
}

// ---------------------------------------------------------------------------
// The dispatcher (fail-closed on unknown gates)
// ---------------------------------------------------------------------------

/** Evaluates one gate by id. Unknown ids fail closed with a typed error result. */
export function evaluateGate(
  gate: GateId,
  record: OrganizationRecord,
  policy: GatePolicy,
): GateResult {
  switch (gate) {
    case "reproducibility":
      return evaluateReproducibilityGate(record, policy.reproducibility);
    case "benchmark":
      return evaluateBenchmarkGate(record, policy.benchmark);
    case "robustness":
      return evaluateRobustnessGate(record, policy.robustness);
    case "rights-provenance":
      return evaluateRightsProvenanceGate(record);
    case "cost-latency":
      return evaluateCostLatencyGate(record, policy["cost-latency"]);
    case "security-policy":
      return evaluateSecurityPolicyGate(record, policy["security-policy"]);
    case "canary":
      return evaluateCanaryGate(record, policy.canary);
  }
}

/**
 * Evaluates the required gates in pipeline order. PURE — no state change,
 * suitable for pre-flight eligibility reads and for the recorded gate
 * results inside a promotion attempt.
 */
export function evaluateGates(
  gates: readonly GateId[],
  record: OrganizationRecord,
  policy: GatePolicy,
): GateResult[] {
  return gates.map((gate) => evaluateGate(gate, record, policy));
}

/** Did every gate pass? (A `missing` or `fail` result is not a pass.) */
export function allGatesPassed(results: readonly GateResult[]): boolean {
  return results.every((result) => result.status === "pass");
}
