/**
 * Organization search tests (REL-006, gate REL-A3): determinism, the
 * ALWAYS-included mandatory baseline, the REL-A3 minimum metrics (quality,
 * hard-gate validity, cost, latency), the documented ranking order, and the
 * three BOUNDS (max candidates / budget ceiling / latency ceiling) —
 * enforced, with honest truncation records. Numbers pinned below are
 * MEASURED on this branch (see the test bodies for how each is derived).
 */
import { describe, expect, test } from "bun:test";
import {
  createFootballCandidateSpace,
  defaultFootballCandidateSpaceConfig,
  footballDomainPack,
  rankCandidateEvaluations,
  runOrganizationSearch,
  type CandidateEvaluation,
  type CandidateSpaceConfig,
  type OrganizationSearchOptions,
} from "../src";
import { SMALL_SCENARIO } from "./fixtures";

function smallSpaceConfig(): CandidateSpaceConfig {
  return {
    ...defaultFootballCandidateSpaceConfig(),
    maxBodyCount: 3,
    maxDelegationDepth: 2,
    latencyBudgetsMs: [1000, 2000],
  };
}

function searchOptions(
  overrides: Partial<OrganizationSearchOptions> = {},
): OrganizationSearchOptions {
  return {
    domainPack: footballDomainPack,
    space: createFootballCandidateSpace(smallSpaceConfig()),
    seed: "search-test",
    mode: "exhaustive-bounded",
    maxCandidates: 5,
    ensembleSize: 2,
    budgetCeilingUsd: 100,
    latencyCeilingMs: 10_000,
    scenarioConfig: SMALL_SCENARIO,
    ...overrides,
  };
}

describe("search determinism", () => {
  test("same seed + config ⇒ byte-identical search record (no wall clock inside)", () => {
    const first = runOrganizationSearch(searchOptions());
    const second = runOrganizationSearch(searchOptions());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.searchId).toBe(second.searchId);
    // There is genuinely nothing wall-clock-shaped in the record (the
    // scenario's matchDurationMs is SIMULATED clock, not wall clock).
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain("startedAtEpochMs");
    expect(serialized).not.toContain('"execution"');
    expect(serialized).not.toContain("Date.now");
  }, 60_000);
  test("a different seed ⇒ a different record", () => {
    const first = runOrganizationSearch(searchOptions({ mode: "sampled" }));
    const second = runOrganizationSearch(
      searchOptions({ mode: "sampled", seed: "search-test-other" }),
    );
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
  }, 60_000);
  test("the record is deeply frozen (immutable evidence)", () => {
    const record = runOrganizationSearch(searchOptions());
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.candidates)).toBe(true);
    expect(Object.isFrozen(record.candidates[0])).toBe(true);
    expect(Object.isFrozen(record.ranking)).toBe(true);
    expect(Object.isFrozen(record.truncation)).toBe(true);
  });
});

describe("the mandatory baseline is ALWAYS included (contract §Required baselines)", () => {
  test("exhaustive mode carries the baseline candidate, first and identified", () => {
    const record = runOrganizationSearch(searchOptions());
    const baseline = record.candidates.find(
      (candidate) => candidate.familyId === "generalist-baseline",
    );
    expect(baseline).toBeDefined();
    const space = createFootballCandidateSpace(smallSpaceConfig());
    expect(baseline?.point).toEqual(space.generalistBaselinePoint());
    expect(record.baseline.baselineCandidateId).toBe(baseline!.candidateId);
  });

  test("sampled mode carries it too", () => {
    const record = runOrganizationSearch(searchOptions({ mode: "sampled", seed: "sampled-1" }));
    expect(
      record.candidates.some((candidate) => candidate.familyId === "generalist-baseline"),
    ).toBe(true);
  });

  test("even a brutally tight budget ceiling cannot skip the baseline", () => {
    // Baseline cost is measured: 200 ticks x $0.001 x 2 runs = $0.40.
    const record = runOrganizationSearch(searchOptions({ budgetCeilingUsd: 0.001 }));
    expect(record.candidatesEvaluated).toBe(1);
    expect(record.candidates[0]?.familyId).toBe("generalist-baseline");
  });
});

describe("REL-A3 minimum candidate metrics (quality, hard-gate validity, cost, latency)", () => {
  test("the baseline's measured metrics: quality ~= 0.9459, valid, $0.20/run, 120ms mean latency", () => {
    const record = runOrganizationSearch(searchOptions());
    const baseline = record.candidates.find(
      (candidate) => candidate.familyId === "generalist-baseline",
    );
    expect(baseline).toBeDefined();
    // The generalist runs one $0.001 call per 100ms tick for 200 ticks,
    // each action's simulated latency exactly 120ms (scripted constants).
    expect(baseline?.metrics.quality).not.toBeNull();
    expect(baseline?.metrics.quality).toBeGreaterThan(0.9);
    expect(baseline?.metrics.hardGateValid).toBe(true);
    expect(baseline?.metrics.validRunsFraction).toBe(1);
    expect(baseline?.metrics.costUsd).toBeCloseTo(0.2, 10);
    expect(baseline?.metrics.meanLatencyMs).toBe(120);
    expect(baseline?.metrics.latencyCeilingExceeded).toBe(false);
    // Every candidate carries the ensemble reproduction reference.
    expect(baseline?.ensembleRef.size).toBe(2);
    expect(baseline?.ensembleRef.baseSeed).toContain("search-test::cand:");
  });

  test("specialist candidates differ from the baseline on cost and latency (real tradeoffs)", () => {
    const record = runOrganizationSearch({
      ...searchOptions(),
      // Force specialist candidates in: sample the whole grid widely.
      mode: "sampled",
      seed: "tradeoff-seed",
      maxCandidates: 12,
    });
    const baseline = record.candidates.find(
      (candidate) => candidate.familyId === "generalist-baseline",
    );
    expect(baseline).toBeDefined();
    const specialist = record.candidates.find(
      (candidate) =>
        candidate.point.roleMix === "specialist-roles" && candidate.point.bodyCount >= 2,
    );
    expect(specialist).toBeDefined();
    // Measured on this branch: a 3-specialist pipeline spends ~$0.74/run
    // (more nodes, more calls) but its action mix is faster (~60ms mean).
    expect(specialist?.metrics.costUsd).toBeGreaterThan(baseline?.metrics.costUsd ?? 0);
    expect(specialist?.metrics.meanLatencyMs ?? 0).toBeLessThan(
      baseline?.metrics.meanLatencyMs ?? Number.POSITIVE_INFINITY,
    );
  }, 60_000);
});

describe("ranking + winner + baseline comparison", () => {
  test("ranking is a permutation of the evaluated candidates; winner is rank 1", () => {
    const record = runOrganizationSearch(searchOptions());
    expect(record.ranking).toHaveLength(record.candidatesEvaluated);
    expect(new Set(record.ranking).size).toBe(record.candidatesEvaluated);
    expect(record.winner?.candidateId).toBe(record.ranking[0]);
    for (const candidate of record.candidates) {
      expect(record.ranking[candidate.rank! - 1]).toBe(candidate.candidateId);
    }
    // Ranks are 1..N over ALL candidates (small search, all valid).
    expect(record.candidates.map((candidate) => candidate.rank).sort((a, b) => a! - b!)).toEqual(
      record.candidates.map((_, index) => index + 1),
    );
  });

  test("the documented total order: valid first, latency-breachers last, quality desc, cost/latency/id tiebreaks", () => {
    const evaluation = (overrides: Partial<CandidateEvaluation>): CandidateEvaluation => ({
      candidateId: "c",
      familyId: null,
      point: createFootballCandidateSpace().generalistBaselinePoint(),
      organizationId: "org",
      organizationVersion: 1,
      ensembleRef: { baseSeed: "s", size: 1 },
      metrics: {
        quality: 0.5,
        hardGateValid: true,
        validRunsFraction: 1,
        costUsd: 1,
        meanLatencyMs: 100,
        expectedScoreOverall: 0.5,
        latencyCeilingExceeded: false,
      },
      notes: [],
      rank: null,
      ...overrides,
    });
    const ranked = rankCandidateEvaluations([
      evaluation({
        candidateId: "b-quality-low",
        metrics: { ...evaluation({}).metrics, quality: 0.4 },
      }),
      evaluation({ candidateId: "a-quality-low-same-id-earlier" }),
      evaluation({
        candidateId: "c-invalid",
        metrics: { ...evaluation({}).metrics, hardGateValid: false },
      }),
      evaluation({
        candidateId: "d-latency-breach",
        metrics: { ...evaluation({}).metrics, latencyCeilingExceeded: true },
      }),
      evaluation({
        candidateId: "e-cheaper-tie",
        metrics: { ...evaluation({}).metrics, quality: 0.5, costUsd: 0.5 },
      }),
      evaluation({
        candidateId: "f-unmeasured-quality",
        metrics: { ...evaluation({}).metrics, quality: null },
      }),
    ]);
    expect(ranked.map((evaluation) => evaluation.candidateId)).toEqual([
      "e-cheaper-tie", // same quality, cheaper
      "a-quality-low-same-id-earlier", // quality 0.5, cost 1, id before b
      "b-quality-low", // quality 0.4
      "f-unmeasured-quality", // null quality ranks below measured
      "d-latency-breach", // breaching ranks last among valid
      "c-invalid", // hard-invalid always last
    ]);
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("the baseline comparison records honest deltas vs the winner", () => {
    const record = runOrganizationSearch(searchOptions());
    const winner = record.candidates.find(
      (candidate) => candidate.candidateId === record.winner?.candidateId,
    );
    const baseline = record.candidates.find(
      (candidate) => candidate.candidateId === record.baseline.baselineCandidateId,
    );
    expect(winner).toBeDefined();
    expect(baseline).toBeDefined();
    const expectedDelta =
      winner!.metrics.quality !== null && baseline!.metrics.quality !== null
        ? winner!.metrics.quality - baseline!.metrics.quality
        : null;
    expect(record.baseline.qualityDelta).toBeCloseTo(expectedDelta ?? 0, 12);
    expect(record.baseline.winnerIsBaseline).toBe(
      record.winner?.candidateId === record.baseline.baselineCandidateId,
    );
    expect(record.baseline.baselineRank).toBe(baseline!.rank!);
    expect(record.baseline.summary.length).toBeGreaterThan(0);
  });
});

describe("the three bounds — enforced, never advisory", () => {
  test("max-candidates: the search stops at the cap and says so", () => {
    const record = runOrganizationSearch(searchOptions({ maxCandidates: 3 }));
    expect(record.candidatesEvaluated).toBe(3);
    expect(record.truncation.truncated).toBe(true);
    expect(record.truncation.reason).toBe("max-candidates");
    expect(record.truncation.evaluated).toBe(3);
    expect(record.truncation.planned).toBe(3);
    // What was bounded, honestly recorded.
    expect(record.availableCandidates).toBeGreaterThan(3);
  });

  test("budget ceiling: stops before the next candidate once cumulative cost exceeds it", () => {
    // Measured: baseline ensemble costs 2 x $0.20 = $0.40; the next candidate
    // would push cumulative to $0.80 — both far above a $0.10 ceiling, so the
    // search stops AFTER the baseline (which always runs).
    const record = runOrganizationSearch(searchOptions({ budgetCeilingUsd: 0.1 }));
    expect(record.candidatesEvaluated).toBe(1);
    expect(record.truncation.truncated).toBe(true);
    expect(record.truncation.reason).toBe("budget-ceiling");
    expect(record.truncation.budget.ceilingUsd).toBe(0.1);
    expect(record.truncation.budget.cumulativeUsd).toBeCloseTo(0.4, 10);
    expect(record.truncation.budget.exceeded).toBe(true);
    expect(record.candidates[0]?.familyId).toBe("generalist-baseline");
  });

  test("budget ceiling mid-search: one candidate past the line, then an honest stop", () => {
    // $0.40 (baseline) <= $0.5, so the second candidate evaluates; cumulative
    // $0.80 > $0.5 stops the search before a third.
    const record = runOrganizationSearch(searchOptions({ budgetCeilingUsd: 0.5 }));
    expect(record.candidatesEvaluated).toBe(2);
    expect(record.truncation.reason).toBe("budget-ceiling");
    expect(record.truncation.budget.cumulativeUsd).toBeCloseTo(0.8, 10);
  });

  test("latency ceiling: the breaching candidate is recorded and the search stops", () => {
    // Measured: the baseline's mean action latency is exactly 120ms — a 70ms
    // ceiling is breached by the very first (baseline) candidate.
    const record = runOrganizationSearch(searchOptions({ latencyCeilingMs: 70 }));
    expect(record.candidatesEvaluated).toBe(1);
    expect(record.truncation.truncated).toBe(true);
    expect(record.truncation.reason).toBe("latency-ceiling");
    expect(record.truncation.latency.breachedByCandidateId).toBe(record.candidates[0]!.candidateId);
    expect(record.truncation.latency.measuredMs).toBe(120);
    expect(record.candidates[0]?.metrics.latencyCeilingExceeded).toBe(true);
    expect(record.candidates[0]?.metrics.meanLatencyMs).toBe(120);
    // The breach is noted on the candidate, honestly.
    expect(record.candidates[0]?.notes.join(" ")).toContain("latency ceiling");
    // The winner still exists (the only candidate), with the breach recorded.
    expect(record.winner?.candidateId).toBe(record.candidates[0]?.candidateId);
  });

  test("no truncation when every available candidate is evaluated (stub space)", () => {
    // The real grid's smallest space is 288 candidates (too many ensembles to
    // evaluate in-test), so the completion path is exercised through a stub
    // space over the real materializer: baseline + ONE extra candidate =
    // the entire "space", evaluated in full.
    const underlying = createFootballCandidateSpace(smallSpaceConfig());
    const extraPoint = underlying
      .enumerate()
      .find(
        (point) => JSON.stringify(point) !== JSON.stringify(underlying.generalistBaselinePoint()),
      );
    expect(extraPoint).toBeDefined();
    const stubSpace = {
      ...underlying,
      count: () => 2,
      enumerate: () => [underlying.generalistBaselinePoint(), extraPoint!],
      iterate: function* () {
        yield underlying.generalistBaselinePoint();
        yield extraPoint!;
      },
      sample: () => [extraPoint!],
    };
    const record = runOrganizationSearch(searchOptions({ space: stubSpace, maxCandidates: 10 }));
    expect(record.candidatesEvaluated).toBe(2);
    expect(record.availableCandidates).toBe(2);
    expect(record.truncation.truncated).toBe(false);
    expect(record.truncation.reason).toBeNull();
    expect(record.truncation.budget.exceeded).toBe(false);
    expect(record.truncation.evaluated).toBe(record.truncation.planned);
    expect(record.ranking).toHaveLength(2);
  });

  test("invalid search options are refused with typed errors", () => {
    expect(() => runOrganizationSearch(searchOptions({ maxCandidates: 0 }))).toThrow(
      /maxCandidates/,
    );
    expect(() => runOrganizationSearch(searchOptions({ ensembleSize: 0 }))).toThrow(/ensembleSize/);
    expect(() => runOrganizationSearch(searchOptions({ budgetCeilingUsd: -1 }))).toThrow(
      /budgetCeilingUsd/,
    );
    expect(() => runOrganizationSearch(searchOptions({ latencyCeilingMs: -1 }))).toThrow(
      /latencyCeilingMs/,
    );
  });
});

describe("provenance (the search is lab evidence, never production state)", () => {
  test("the record carries the lab-simulation provenance class and full versions", () => {
    const record = runOrganizationSearch(searchOptions());
    expect(record.schemaVersion).toBe("lab-org-search/0.1");
    expect(record.provenance.provenanceClass).toBe("lab-simulation");
    expect(record.provenance.note).toContain("never production state");
    expect(record.provenance.versions.domainPackId).toBe("football");
    expect(record.provenance.seed).toBe("search-test");
    expect(record.config.evaluatorId).toBe("football-lab-evaluator");
    expect(record.config.rewardEngineId).toBe("sporta-reward-engine");
    expect(record.config.weightSetId).toBe("football-balanced");
  });
});
