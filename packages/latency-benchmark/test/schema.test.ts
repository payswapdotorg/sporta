/**
 * The versioned report schema: the machine-readable report is VALIDATED, never
 * trusted — a real report parses; every structural mutation (unknown keys,
 * wrong types, negative latencies, tag mismatches, unbalanced accounting,
 * non-monotonic clock reads, trace-length divergences) is refused with the
 * typed {@link LatencyReportValidationError} carrying the JSON paths.
 *
 * The base report comes from ONE memoized REAL benchmark run over a small live
 * fixture (fast, still the full W304 pipeline); the mutations are deep-cloned
 * tampering (the W801 golden-test pattern).
 */
import { describe, expect, test } from "bun:test";
import { runLatencyBenchmark } from "../src/benchmark";
import type { LatencyBenchmarkRun } from "../src/benchmark";
import { LIVE_FIXTURE_PROFILE } from "../src/fixture";
import { parseLatencyReport, REPORT_SCHEMA_TAG } from "../src/schema";
import type { LatencyBenchmarkReport } from "../src/schema";
import { LatencyReportValidationError } from "../src/errors";
import type { Mutable } from "./helpers";

/** The small live profile the schema tests run (fast, one burst). */
const schemaProfile = {
  ...LIVE_FIXTURE_PROFILE,
  profileId: "w306-schema-fixture",
  seed: "w306-schema-seed",
  seconds: 12,
  burstEventFromMs: 4_000,
  burstEventToMs: 6_000,
  burstUpdatesPerSecond: 4,
};

/** The memoized base run (ONE benchmark execution shared by this file). */
let memo: LatencyBenchmarkRun | undefined;

function baseRun(): LatencyBenchmarkRun {
  if (memo === undefined) {
    // Synchronous assignment from an async factory is impossible — so the
    // memo is primed by the first test (tests in a file run sequentially).
    throw new Error("schema.test.ts: baseRun() called before the priming test ran");
  }
  return memo;
}

/** Primes the memoized base run and returns its parsed report. */
async function primeBaseReport(): Promise<LatencyBenchmarkReport> {
  const run = await runLatencyBenchmark({ profile: schemaProfile });
  memo = run;
  return JSON.parse(run.serialized) as LatencyBenchmarkReport;
}

/** A deep-mutable clone of the real report (tamper side). */
function clone(): Mutable<LatencyBenchmarkReport> {
  return JSON.parse(JSON.stringify(baseRun().report)) as Mutable<LatencyBenchmarkReport>;
}

describe("parseLatencyReport (the versioned schema)", () => {
  test("a real report parses and carries the schema tag, domain, and method", async () => {
    const report = await primeBaseReport();
    const parsed = parseLatencyReport(report);
    expect(parsed.reportSchema).toBe(REPORT_SCHEMA_TAG);
    expect(REPORT_SCHEMA_TAG).toBe("sporta/latency-benchmark/report@1");
    expect(parsed.benchmark.clockDomain).toBe("injected-virtual");
    expect(parsed.benchmark.percentileMethod).toBe("nearest-rank");
    // The schema test pins the exact stage vocabularies (the report vocabulary
    // and the SLO candidate table must stay in lockstep — see slo.ts).
    expect(Object.keys(parsed.stages.batch).sort()).toEqual([
      "batch-queue",
      "end-to-end",
      "finish-to-emit",
      "render-execution",
      "swm-to-batch",
      "w303-schedule",
    ]);
    expect(Object.keys(parsed.stages.frame).sort()).toEqual(["end-to-end", "swm-store-sojourn"]);
    expect(parsed.accounting.frames.balanced).toBe(true);
    expect(parsed.stages.sourceModel.authoredNotMeasured).toBe(true);
  });

  test("the serialized bytes round-trip: parse(serialized) deep-equals the report", () => {
    const run = baseRun();
    expect(parseLatencyReport(JSON.parse(run.serialized))).toEqual(run.report);
  });

  test("a wrong reportSchema tag is refused", () => {
    const mutated = clone();
    (mutated as Record<string, unknown>).reportSchema = "sporta/latency-benchmark/report@0";
    expect(() => parseLatencyReport(mutated)).toThrow(LatencyReportValidationError);
  });

  test("an unknown top-level key is refused", () => {
    const mutated = clone() as unknown as Record<string, unknown>;
    mutated.extra = "silence";
    expect(() => parseLatencyReport(mutated)).toThrow(LatencyReportValidationError);
  });

  test("an unknown pipeline key is refused", () => {
    const mutated = clone();
    (mutated.benchmark.pipeline as unknown as Record<string, unknown>).gpuVendor = "nvidia";
    expect(() => parseLatencyReport(mutated)).toThrow(LatencyReportValidationError);
  });

  test("a negative latency in the stage table is refused", () => {
    const mutated = clone();
    mutated.stages.batch["swm-to-batch"]!.p50Ms = -1;
    expect(() => parseLatencyReport(mutated)).toThrow(LatencyReportValidationError);
  });

  test("a negative trace timestamp is refused", () => {
    const mutated = clone();
    mutated.trace.batches[0]!.cutAtMs = -5;
    expect(() => parseLatencyReport(mutated)).toThrow(LatencyReportValidationError);
  });

  test("an unknown batch-stage key is refused (the vocabulary is closed)", () => {
    const mutated = clone();
    mutated.stages.batch = {
      ...mutated.stages.batch,
      "ice-stun-network": mutated.stages.batch["end-to-end"]!,
    } as typeof mutated.stages.batch;
    expect(() => parseLatencyReport(mutated)).toThrow(LatencyReportValidationError);
  });

  test("an unbalanced frames accounting block is refused at PARSE time (consumers re-verify)", () => {
    const mutated = clone();
    mutated.accounting.frames.framesDropped += 1; // framesIn no longer equals the bucket sum
    expect(() => parseLatencyReport(mutated)).toThrow(/does not balance/);
    try {
      parseLatencyReport(mutated);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LatencyReportValidationError);
      expect((err as { code: string }).code).toBe("latency-report-validation");
    }
  });

  test("trace.frames length diverging from framesIn is refused", () => {
    const mutated = clone();
    mutated.trace.frames = mutated.trace.frames.slice(1); // a frame row vanished
    expect(() => parseLatencyReport(mutated)).toThrow(/trace.frames length/);
  });

  test("trace.batches length diverging from batchesIn is refused", () => {
    const mutated = clone();
    mutated.trace.batches = mutated.trace.batches.slice(1);
    expect(() => parseLatencyReport(mutated)).toThrow(/trace.batches length/);
  });

  test("non-monotonic benchmark clock reads are refused", () => {
    const mutated = clone();
    // Both values stay non-negative (schema-valid individually); only the
    // cross-consistency check catches the regression.
    mutated.benchmark.clockStartMs = 5;
    mutated.benchmark.clockEndMs = 4;
    expect(() => parseLatencyReport(mutated)).toThrow(/non-monotonic/);
  });

  test("a wrong clock-domain literal is refused (the report is injected-domain ONLY)", () => {
    const mutated = clone();
    (mutated.benchmark as Record<string, unknown>).clockDomain = "wall-clock";
    expect(() => parseLatencyReport(mutated)).toThrow(LatencyReportValidationError);
  });

  test("the error is a typed latency-benchmark error", () => {
    const mutated = clone();
    (mutated as Record<string, unknown>).reportSchema = "bogus";
    try {
      parseLatencyReport(mutated);
      expect.unreachable();
    } catch (err) {
      expect((err as { scope?: string }).scope).toBe("latency-benchmark");
    }
  });
});
