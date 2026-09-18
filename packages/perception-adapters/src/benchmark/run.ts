/**
 * Benchmark-run assembly helpers (R201-R206) — the shared machinery behind
 * every family's deterministic benchmark module.
 *
 * HONESTY RULES (mirroring the frozen `BenchmarkRun` contract docs):
 *
 * - `costEstimateUsd` is ALWAYS `null` in these modules — the runs execute
 *   on local CPU inside a test/benchmark process and cannot be metered
 *   honestly; a fabricated zero would be worse than an honest null.
 * - `runtimeSeconds` is derived from the INJECTED clock, with a documented
 *   1 ms GRANULARITY FLOOR: a real wall-clock pair of `now()` reads can land
 *   in the same millisecond, and the frozen schema requires a positive
 *   runtime — sub-millisecond runs report 0.001 (clock granularity), never
 *   a fabricated zero. The shipped DEFAULT clock is the deterministic
 *   constant clock (call-count-derived, identical across reruns — this is
 *   what makes whole records deep-equal across two runs). REAL wall-clock
 *   measurement requires injecting {@link realClock} (or any
 *   `() => Date.now()` clock); the modules never secretly substitute one.
 * - `reproducibility.deterministic: true` is backed by an ACTUAL internal
 *   rerun: every family module computes its metrics twice and records the
 *   observed maximum metric delta as `rerunDeltaPct` (0 for these
 *   deterministic candidates — measured, not assumed).
 * - Records are zod-PARSED against the frozen `BenchmarkRun` schema before
 *   being returned: conformance is verified, never asserted loosely.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BenchmarkRun } from "@sporta/contracts";
import type { BenchmarkRun as BenchmarkRunType } from "@sporta/contracts";

/** An injected monotonic clock (millisecond epoch values). */
export interface BenchmarkClock {
  now(): number;
}

/**
 * The deterministic constant clock: every `now()` call advances `stepMs`
 * from `baseMs`. The default clock of every benchmark module — identical
 * call sequences yield identical timestamps, so whole run records are
 * deep-equal across reruns.
 */
export function constantClock(baseMs: number, stepMs: number = 1): BenchmarkClock {
  let current = baseMs;
  return {
    now: () => {
      current += stepMs;
      return current;
    },
  };
}

/**
 * A REAL wall-clock (opt-in): `Date.now()` under the hood. Tests never use
 * it (docs/testing/HARNESS.md — no `Date.now` in tests); production
 * measurement paths inject it for honest runtime seconds.
 */
export function realClock(): BenchmarkClock {
  return { now: () => Date.now() };
}

/** The default clock every family benchmark uses when none is injected. */
export const DEFAULT_BENCHMARK_CLOCK = (): BenchmarkClock => constantClock(1_736_164_800_000, 1);

/**
 * Assembles and VALIDATES one {@link BenchmarkRun} record: the record is
 * zod-parsed against the frozen schema and returned typed — a malformed
 * record throws instead of silently conforming.
 */
export function buildBenchmarkRun(input: {
  runId: string;
  technologyId: string;
  technologyVersion: string;
  adapterVersion: string;
  task: BenchmarkRunType["task"];
  fixtureSetVersion: string;
  startedAtMs: number;
  completedAtMs: number;
  metrics: Record<string, number>;
  resourceUsage: Record<string, number>;
  failureSummary: { failures: number; failureExamples: readonly string[] };
  seed: string;
  rerunDeltaPct: number;
  licenseCheck: BenchmarkRunType["licenseCheck"];
  artifactRefs: readonly string[];
}): BenchmarkRunType {
  // 1 ms granularity floor (see the module docs): a real-clock pair of
  // reads can land in the same millisecond; the frozen schema requires a
  // positive runtime — sub-millisecond runs report 0.001, never zero.
  const runtimeSeconds = Math.max((input.completedAtMs - input.startedAtMs) / 1000, 0.001);
  const record: BenchmarkRunType = {
    schemaVersion: "1.1",
    runId: input.runId,
    technologyId: input.technologyId,
    technologyVersion: input.technologyVersion,
    adapterVersion: input.adapterVersion,
    task: input.task,
    fixtureSetVersion: input.fixtureSetVersion,
    startedAtMs: input.startedAtMs,
    completedAtMs: input.completedAtMs,
    metrics: input.metrics,
    resourceUsage: input.resourceUsage,
    runtimeSeconds,
    costEstimateUsd: null,
    failureSummary: {
      failures: input.failureSummary.failures,
      failureExamples: [...input.failureSummary.failureExamples],
    },
    reproducibility: {
      deterministic: true,
      rerunDeltaPct: input.rerunDeltaPct,
      seed: input.seed,
    },
    licenseCheck: input.licenseCheck,
    artifactRefs: [...input.artifactRefs],
  };
  const parsed = BenchmarkRun.safeParse(record);
  if (!parsed.success) {
    throw new RangeError(
      `benchmark run record does not conform to the frozen BenchmarkRun schema: ` +
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  return parsed.data;
}

/**
 * The maximum relative metric delta across two metric maps, in percent —
 * the `rerunDeltaPct` evidence (0 for deterministic candidates). Keys union
 * is considered; a missing key counts as 0.
 */
export function metricDeltaPct(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): number {
  let max = 0;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[key] ?? 0;
    const vb = b[key] ?? 0;
    const denominator = Math.max(Math.abs(va), Math.abs(vb), 1e-12);
    max = Math.max(max, (Math.abs(va - vb) / denominator) * 100);
  }
  return max;
}

/** Reads and JSON-parses a committed fixture spec file (sync, no network). */
export function loadSpecFile<T>(fileName: string): T {
  const path = join(import.meta.dir, "..", "..", "fixtures", fileName);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
