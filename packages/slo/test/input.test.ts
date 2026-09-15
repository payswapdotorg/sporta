/**
 * The input-schema tests: the versioned, strict, exhaustive validation of
 * the latency-SLO input (the structural projection of a W306 report).
 *
 * Fail-loud is the contract: unknown keys, wrong types, negative latencies,
 * non-integer counts, MISSING stage keys (the zod records are exhaustive
 * over the stage vocabularies), foreign clock domains, and unbalanced frame
 * accounting all throw — never a partial parse.
 */
import { describe, expect, test } from "bun:test";
import {
  LATENCY_SLO_INPUT_SCHEMA_TAG,
  parseLatencySloInput,
  projectBenchmarkReport,
  type LatencySloInput,
} from "../src/input";
import { SloInputValidationError, isSloError } from "../src/errors";
import { buildInput, buildStructuralReport } from "./helpers";

describe("parseLatencySloInput (acceptance)", () => {
  test("the W306 baseline input parses (the real projection shape)", () => {
    const input = buildInput();
    expect(parseLatencySloInput(input)).toEqual(input);
  });

  test("a JSON round-trip does not change acceptance", () => {
    const input = buildInput();
    expect(parseLatencySloInput(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });

  test("the input tag is versioned and required", () => {
    expect(LATENCY_SLO_INPUT_SCHEMA_TAG).toBe("sporta/slo/input@1");
    const wrongTag = { ...buildInput(), inputSchema: "sporta/slo/input@0" };
    expect(() => parseLatencySloInput(wrongTag)).toThrow(SloInputValidationError);
  });
});

describe("parseLatencySloInput (fail-loud: shape)", () => {
  test("an unknown top-level key is rejected (strict, every level)", () => {
    const extra = { ...buildInput(), extra: true } as unknown;
    expect(() => parseLatencySloInput(extra)).toThrow(/extra/);
  });

  test("a missing top-level key is rejected (no defaults)", () => {
    const { pipeline, ...withoutPipeline } = buildInput();
    expect(() => parseLatencySloInput(withoutPipeline)).toThrow(/pipeline/);
    expect(pipeline).toBeDefined();
  });

  test("a foreign clock domain is rejected (the honest-domain pin)", () => {
    const wallClock = buildInput();
    (wallClock.domain as { clockDomain: string }).clockDomain = "wall-clock";
    expect(() => parseLatencySloInput(wallClock)).toThrow(/clockDomain/);
  });

  test("a foreign percentile method is rejected", () => {
    const interpolated = buildInput();
    (interpolated.domain as { percentileMethod: string }).percentileMethod = "linear-interpolation";
    expect(() => parseLatencySloInput(interpolated)).toThrow(/percentileMethod/);
  });
});

describe("parseLatencySloInput (fail-loud: stages)", () => {
  test("a MISSING batch stage key fails (the records are exhaustive)", () => {
    const missingStage = buildInput();
    delete (missingStage.stages.batch as Record<string, unknown>)["swm-to-batch"];
    expect(() => parseLatencySloInput(missingStage)).toThrow(/swm-to-batch/);
  });

  test("a missing frame stage key fails", () => {
    const missingStage = buildInput();
    delete (missingStage.stages.frame as Record<string, unknown>)["swm-store-sojourn"];
    expect(() => parseLatencySloInput(missingStage)).toThrow(/swm-store-sojourn/);
  });

  test("an UNKNOWN stage key fails (vocabulary lockstep)", () => {
    const unknownStage = buildInput();
    (unknownStage.stages.batch as Record<string, unknown>)["network-ingest"] = {
      count: 1,
      minMs: 0,
      maxMs: 0,
      p50Ms: 0,
      p95Ms: 0,
    };
    expect(() => parseLatencySloInput(unknownStage)).toThrow(/network-ingest/);
  });

  test("a negative latency fails", () => {
    const negative = buildInput({ batch: { "batch-queue": { p95Ms: -1 } } });
    expect(() => parseLatencySloInput(negative)).toThrow(/p95Ms/);
  });

  test("a non-integer sample count fails", () => {
    const fractional = buildInput({ batch: { "batch-queue": { count: 1.5 } } });
    expect(() => parseLatencySloInput(fractional)).toThrow(/count/);
  });

  test("a missing stats field fails (no partial stage summaries)", () => {
    const partial = buildInput();
    delete (partial.stages.batch["batch-queue"] as Record<string, unknown>).maxMs;
    expect(() => parseLatencySloInput(partial)).toThrow(/maxMs/);
  });

  test("mutating a built input never corrupts the shared baseline (fresh objects per build)", () => {
    // The inherited draft's helper shallow-copied the stat rows, so this very
    // file's delete above corrupted BASELINE_BATCH_STATS for every LATER test
    // in the process (cross-test pollution; five failures). buildInput now
    // clones the nested rows — pinned here.
    const mutated = buildInput();
    delete (mutated.stages.batch["batch-queue"] as Record<string, unknown>).maxMs;
    expect(mutated.stages.batch["batch-queue"].maxMs).toBeUndefined();
    const fresh = buildInput();
    expect(fresh.stages.batch["batch-queue"].maxMs).toBe(400);
    expect(() => parseLatencySloInput(fresh)).not.toThrow();
  });
});

describe("parseLatencySloInput (fail-loud: accounting)", () => {
  test("an unbalanced frame accounting fails (never-silent extends here)", () => {
    const unbalanced = buildInput({ frames: { framesDropped: 1 } });
    // framesIn 240 !== emitted 240 + dropped 1 + ... — loud.
    expect(() => parseLatencySloInput(unbalanced)).toThrow(/does not balance/);
  });

  test("a balanced-but-lossy accounting parses (loss is a VALID window; it alerts, not fails)", () => {
    const lossy = buildInput({ frames: { framesEmitted: 239, framesDropped: 1 } });
    expect(parseLatencySloInput(lossy).accounting.frames.framesDropped).toBe(1);
  });
});

describe("parseLatencySloInput (fail-loud: pipeline vocabulary)", () => {
  test("an unknown backpressure policy fails", () => {
    const bogus = buildInput();
    (bogus.pipeline as { backpressure: string }).backpressure = "shed";
    expect(() => parseLatencySloInput(bogus)).toThrow(/backpressure/);
  });

  test("an unknown degradation kind fails", () => {
    const bogus = buildInput();
    (bogus.pipeline as { degradation: { kind: string } }).degradation = { kind: "drop-stale" };
    expect(() => parseLatencySloInput(bogus)).toThrow(/degradation/);
  });

  test("skip-stale degradation parses with its bound", () => {
    const enabled = buildInput({ degradation: { kind: "skip-stale", maxWatermarkLagMs: 5000 } });
    expect(parseLatencySloInput(enabled).pipeline.degradation).toEqual({
      kind: "skip-stale",
      maxWatermarkLagMs: 5000,
    });
  });
});

describe("projectBenchmarkReport (the structural projector)", () => {
  test("projects exactly the SLO evidence fields, verbatim", () => {
    const report = buildStructuralReport();
    const input = projectBenchmarkReport(report);
    expect(input).toEqual(buildInput());
    expect(input.inputSchema).toBe(LATENCY_SLO_INPUT_SCHEMA_TAG);
  });

  test("the projection validates through the parser (the round trip)", () => {
    const input = projectBenchmarkReport(buildStructuralReport());
    expect(parseLatencySloInput(input)).toEqual(input);
  });

  test("overrides flow through the projector (stages + accounting + pipeline)", () => {
    const report = buildStructuralReport({
      batch: { "w303-schedule": { p95Ms: 7000 } },
      frames: { framesEmitted: 238, framesSkippedStale: 2 },
      degradation: { kind: "skip-stale", maxWatermarkLagMs: 2500 },
      backpressure: "reject",
    });
    const input = projectBenchmarkReport(report);
    expect(input.stages.batch["w303-schedule"].p95Ms).toBe(7000);
    expect(input.accounting.frames.framesSkippedStale).toBe(2);
    expect(input.pipeline.degradation).toEqual({ kind: "skip-stale", maxWatermarkLagMs: 2500 });
    expect(input.pipeline.backpressure).toBe("reject");
  });

  test("a projector output from a lossy report parses (240 = 238 + 2)", () => {
    const report = buildStructuralReport({ frames: { framesEmitted: 238, framesSkippedStale: 2 } });
    const parsed = parseLatencySloInput(projectBenchmarkReport(report));
    expect(parsed.accounting.frames.framesEmitted).toBe(238);
  });
});

describe("the typed error surface", () => {
  test("SloInputValidationError is a SloError with the code + issues", () => {
    try {
      parseLatencySloInput({ inputSchema: "nope" });
      expect.unreachable();
    } catch (error) {
      expect(isSloError(error)).toBe(true);
      const sloError = error as SloInputValidationError;
      expect(sloError.code).toBe("slo-input-invalid");
      expect(sloError.issues).toContain("inputSchema");
    }
  });

  test("the input type is exported (compile-time contract)", () => {
    const input: LatencySloInput = buildInput();
    expect(input.stages.batch["end-to-end"].count).toBe(140);
  });
});
