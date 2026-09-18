/**
 * The evaluation runner (R003): executes a registered adapter task's
 * evaluation callback against each fixture of a frozen fixture set and
 * produces a frozen `BenchmarkRun` contract record (ADR-009 Benchmark
 * contract).
 *
 * Determinism contract:
 *
 * - Same profile + fixture set + seed => the same per-fixture runner
 *   context seeds => (for a deterministic callback) identical metrics. The
 *   default seed is derived from the technology identity + fixture-set
 *   version, NOT from the run id, so two runs of the same evaluation see
 *   the same inputs.
 * - No `Math.random` and no `Date.now` inside the runner: time comes from
 *   an injected `clock` (tests inject a deterministic fake; production
 *   injects `Date.now`), ids from an explicit `runId` parameter.
 *
 * Honesty rules (technology-evaluation.ts):
 *
 * - `costEstimateUsd` is `null` unless EVERY fixture outcome could be
 *   metered — never a fabricated zero or partial sum.
 * - metric key sets must be IDENTICAL across fixture outcomes (a runner
 *   that omits a metric on some fixtures would silently skew an average);
 *   the same applies to `resourceUsage` when present.
 * - failures > 0 requires at least one failure example.
 * - `reproducibility.deterministic` on a single run is only a CLAIM
 *   (`claimedDeterministic`, default `false` — unproven); the measured
 *   truth comes from {@link rerunBenchmark}, which backs the flag with a
 *   `rerunDeltaPct`.
 */
import type { TechnologyProfile } from "@sporta/contracts";
import { BenchmarkRun } from "@sporta/contracts";
import { seedFromString } from "@sporta/testing";
import type { FixtureEntry, FixtureSet } from "../fixtures/fixture-set";
import { EvaluationValidationError } from "../errors";

/** Per-fixture context handed to the evaluation callback. */
export interface FixtureRunnerContext {
  runId: string;
  /** Deterministic per-fixture seed (`seed` split by fixture id). */
  seed: string;
  fixtureId: string;
  entry: FixtureEntry;
}

/** What an evaluation callback reports for ONE fixture entry. */
export interface FixtureExecutionOutcome {
  /** Task-specific metric values. Keys must be identical across entries. */
  metrics: Record<string, number>;
  /** Measured resource usage (e.g. gpuSeconds, cpuMs, peakVramGb). */
  resourceUsage?: Record<string, number>;
  /** Wall-clock runtime for this fixture, in seconds (> 0). */
  runtimeSeconds: number;
  /** Estimated cost in USD; absent/null = honestly unmetered. */
  costEstimateUsd?: number | null;
  /** Counted failures for this fixture. */
  failures?: number;
  /** At least one example per failure class when failures > 0. */
  failureExamples?: string[];
  licenseCheck?: "pass" | "fail" | "not-applicable";
  /** References to raw result artifacts (never inline payloads). */
  artifactRefs?: string[];
}

/** The evaluation callback: pure function of (entry, seed) ideally. */
export type AdapterRunner = (
  ctx: FixtureRunnerContext,
) => FixtureExecutionOutcome | Promise<FixtureExecutionOutcome>;

/** Parameters for {@link runBenchmark}. */
export interface RunBenchmarkParams {
  /** The registered profile being evaluated. */
  profile: TechnologyProfile;
  /** The frozen fixture set to evaluate against. */
  fixtureSet: FixtureSet;
  /** The evaluation callback. */
  runner: AdapterRunner;
  /** Identifier for the produced run record. */
  runId: string;
  /**
   * Explicit seed. Defaults to a deterministic derivation from the
   * technology triple + fixture-set version (run-id INdependent, so reruns
   * see identical inputs).
   */
  seed?: string;
  /** Millisecond clock; defaults to `Date.now` (tests inject a fake). */
  clock?: () => number;
  /** The runner's determinism CLAIM for a single run (unproven until a rerun). */
  claimedDeterministic?: boolean;
}

function assertFiniteRecord(record: Record<string, number>, label: string, where: string): void {
  for (const [key, value] of Object.entries(record)) {
    if (!Number.isFinite(value)) {
      throw new EvaluationValidationError(
        `${where}: ${label} '${key}' is not a finite number (${String(value)})`,
      );
    }
  }
}

function validateOutcome(outcome: FixtureExecutionOutcome, fixtureId: string): void {
  if (Object.keys(outcome.metrics).length === 0) {
    throw new EvaluationValidationError(`fixture '${fixtureId}': metrics must not be empty`);
  }
  assertFiniteRecord(outcome.metrics, "metric", `fixture '${fixtureId}'`);
  if (outcome.resourceUsage !== undefined) {
    assertFiniteRecord(outcome.resourceUsage, "resourceUsage", `fixture '${fixtureId}'`);
  }
  if (!Number.isFinite(outcome.runtimeSeconds) || outcome.runtimeSeconds <= 0) {
    throw new EvaluationValidationError(
      `fixture '${fixtureId}': runtimeSeconds must be a positive number (got ${String(
        outcome.runtimeSeconds,
      )})`,
    );
  }
  const failures = outcome.failures ?? 0;
  if (!Number.isInteger(failures) || failures < 0) {
    throw new EvaluationValidationError(
      `fixture '${fixtureId}': failures must be a non-negative integer (got ${String(failures)})`,
    );
  }
  if (failures > 0 && (outcome.failureExamples ?? []).length === 0) {
    throw new EvaluationValidationError(
      `fixture '${fixtureId}': ${failures} failure(s) reported without a failure example`,
    );
  }
  if (outcome.costEstimateUsd !== undefined && outcome.costEstimateUsd !== null) {
    if (!Number.isFinite(outcome.costEstimateUsd) || outcome.costEstimateUsd < 0) {
      throw new EvaluationValidationError(
        `fixture '${fixtureId}': costEstimateUsd must be a non-negative number or null`,
      );
    }
  }
}

function defaultSeedFor(params: { profile: TechnologyProfile; fixtureSet: FixtureSet }): string {
  // FNV-1a hash of the identity inputs, rendered as a stable hex string: the
  // same technology + fixture set always yields the same seed, independent
  // of the run id (so reruns see identical inputs).
  const hash = seedFromString(
    `${params.profile.technologyId}@${params.profile.technologyVersion}+${params.profile.adapterVersion}|${params.fixtureSet.fixtureSetVersion}`,
  );
  return `derived-${hash.toString(16)}`;
}

/**
 * Execute the evaluation callback against every fixture entry and fold the
 * outcomes into ONE frozen `BenchmarkRun` record:
 *
 * - `metrics` / `resourceUsage`: the per-fixture MEAN per key (comparable
 *   across fixture sets of different sizes; totals are derivable by
 *   multiplying by the entry count);
 * - `runtimeSeconds`: the SUM across fixtures (the run's total work);
 * - `costEstimateUsd`: the SUM, or `null` when ANY fixture was unmetered;
 * - `failureSummary`: summed counts + every collected example;
 * - `licenseCheck`: `fail` if any fixture failed, else `pass` if any
 *   passed, else `not-applicable`;
 * - `artifactRefs`: the concatenation, in fixture order.
 */
export async function runBenchmark(params: RunBenchmarkParams): Promise<BenchmarkRun> {
  const clock = params.clock ?? Date.now;
  const baseSeed = params.seed ?? defaultSeedFor(params);
  const startedAtMs = clock();

  const outcomes: Array<{ entry: FixtureEntry; outcome: FixtureExecutionOutcome }> = [];
  for (const entry of params.fixtureSet.entries) {
    const ctx: FixtureRunnerContext = {
      runId: params.runId,
      seed: `${baseSeed}:${entry.fixtureId}`,
      fixtureId: entry.fixtureId,
      entry,
    };
    const outcome = await params.runner(ctx);
    validateOutcome(outcome, entry.fixtureId);
    outcomes.push({ entry, outcome });
  }

  if (outcomes.length === 0) {
    throw new EvaluationValidationError("fixture set has no entries to evaluate");
  }

  // Metric/resource key sets must be identical across fixtures.
  const metricKeys = Object.keys(outcomes[0]!.outcome.metrics).sort();
  const resourceKeys =
    outcomes[0]!.outcome.resourceUsage !== undefined
      ? Object.keys(outcomes[0]!.outcome.resourceUsage).sort()
      : undefined;
  for (const { entry, outcome } of outcomes) {
    const keys = Object.keys(outcome.metrics).sort();
    if (keys.join("\u0000") !== metricKeys.join("\u0000")) {
      throw new EvaluationValidationError(
        `fixture '${entry.fixtureId}': metric keys [${keys.join(", ")}] differ from the first ` +
          `fixture's [${metricKeys.join(", ")}] — every fixture must report the same metrics`,
      );
    }
    if (resourceKeys === undefined && outcome.resourceUsage !== undefined) {
      throw new EvaluationValidationError(
        `fixture '${entry.fixtureId}': reported resourceUsage but the first fixture did not; ` +
          `report it for every fixture or none`,
      );
    }
    if (resourceKeys !== undefined) {
      if (outcome.resourceUsage === undefined) {
        throw new EvaluationValidationError(
          `fixture '${entry.fixtureId}': missing resourceUsage (the first fixture reported it)`,
        );
      }
      const keys = Object.keys(outcome.resourceUsage).sort();
      if (keys.join("\u0000") !== resourceKeys.join("\u0000")) {
        throw new EvaluationValidationError(
          `fixture '${entry.fixtureId}': resourceUsage keys [${keys.join(", ")}] differ from ` +
            `the first fixture's [${resourceKeys.join(", ")}]`,
        );
      }
    }
  }

  const mean = (values: number[]): number => {
    const total = values.reduce((sum, value) => sum + value, 0);
    return total / values.length;
  };

  const metrics: Record<string, number> = {};
  for (const key of metricKeys) {
    metrics[key] = mean(outcomes.map(({ outcome }) => outcome.metrics[key]!));
  }
  const resourceUsage: Record<string, number> = {};
  if (resourceKeys !== undefined) {
    for (const key of resourceKeys) {
      resourceUsage[key] = mean(outcomes.map(({ outcome }) => outcome.resourceUsage![key]!));
    }
  }

  const runtimeSeconds = outcomes.reduce((sum, { outcome }) => sum + outcome.runtimeSeconds, 0);
  const costs = outcomes.map(({ outcome }) => outcome.costEstimateUsd ?? null);
  const costEstimateUsd = costs.every((cost) => cost !== null)
    ? costs.reduce((sum, cost) => sum + (cost as number), 0)
    : null;

  const failures = outcomes.reduce((sum, { outcome }) => sum + (outcome.failures ?? 0), 0);
  const failureExamples = outcomes.flatMap(({ outcome }) => outcome.failureExamples ?? []);
  const licenseChecks = outcomes.map(({ outcome }) => outcome.licenseCheck ?? "not-applicable");
  const licenseCheck: BenchmarkRun["licenseCheck"] = licenseChecks.includes("fail")
    ? "fail"
    : licenseChecks.includes("pass")
      ? "pass"
      : "not-applicable";
  const artifactRefs = outcomes.flatMap(({ outcome }) => outcome.artifactRefs ?? []);

  const completedAtMs = clock();

  const run: BenchmarkRun = {
    schemaVersion: "1.1",
    runId: params.runId,
    technologyId: params.profile.technologyId,
    technologyVersion: params.profile.technologyVersion,
    adapterVersion: params.profile.adapterVersion,
    task: params.profile.task,
    fixtureSetVersion: params.fixtureSet.fixtureSetVersion,
    startedAtMs,
    completedAtMs,
    metrics,
    resourceUsage,
    runtimeSeconds: Number(runtimeSeconds.toFixed(9)),
    costEstimateUsd,
    failureSummary: { failures, failureExamples },
    reproducibility: {
      deterministic: params.claimedDeterministic ?? false,
      seed: baseSeed,
    },
    licenseCheck,
    artifactRefs,
  };
  return BenchmarkRun.parse(run);
}

/** The result of {@link rerunBenchmark}. */
export interface RerunBenchmarkResult {
  first: BenchmarkRun;
  second: BenchmarkRun;
  /** The measured metric delta between the two runs, in percent (0 = identical). */
  rerunDeltaPct: number;
}

/**
 * Run the SAME evaluation twice (identical seed; the second run gets its own
 * run id) and measure the metric delta. Both returned runs carry the
 * MEASURED reproducibility verdict — `deterministic` is `true` only when
 * the delta is 0, backed by `rerunDeltaPct` — so a promotion can rely on it
 * (the honesty rule from technology-evaluation.ts).
 */
export async function rerunBenchmark(
  params: RunBenchmarkParams & { rerunId?: string },
): Promise<RerunBenchmarkResult> {
  const first = await runBenchmark(params);
  const second = await runBenchmark({
    ...params,
    runId: params.rerunId ?? `${params.runId}#rerun`,
  });
  const rerunDeltaPct = computeRerunDeltaPct(first, second);
  const measured = { deterministic: rerunDeltaPct === 0, rerunDeltaPct };
  return {
    first: { ...first, reproducibility: { ...first.reproducibility, ...measured } },
    second: { ...second, reproducibility: { ...second.reproducibility, ...measured } },
    rerunDeltaPct,
  };
}

/**
 * The maximum relative metric delta between two runs, in percent:
 * `|a - b| / max(|a|, |b|) * 100` per shared metric key (both zero -> 0),
 * and 100 for a key present in only one run (a metric that appeared or
 * disappeared IS a 100% difference). Empty metrics on both sides -> 0.
 */
export function computeRerunDeltaPct(a: BenchmarkRun, b: BenchmarkRun): number {
  return metricDeltaPct(a.metrics, b.metrics);
}

/** The pure metric-delta kernel shared by the rerun helpers. */
export function metricDeltaPct(a: Record<string, number>, b: Record<string, number>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let maxDelta = 0;
  for (const key of keys) {
    const inA = Object.prototype.hasOwnProperty.call(a, key);
    const inB = Object.prototype.hasOwnProperty.call(b, key);
    if (inA !== inB) {
      maxDelta = Math.max(maxDelta, 100);
      continue;
    }
    const va = a[key]!;
    const vb = b[key]!;
    const denominator = Math.max(Math.abs(va), Math.abs(vb));
    if (denominator === 0) continue; // both zero -> no difference
    maxDelta = Math.max(maxDelta, (Math.abs(va - vb) / denominator) * 100);
  }
  return maxDelta;
}
