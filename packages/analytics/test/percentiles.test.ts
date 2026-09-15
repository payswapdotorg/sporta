/**
 * Deterministic timing statistics tests (W804): the nearest-rank percentile
 * method (the repo's pinned precedent — W007/W306), fail-loud on malformed
 * samples, no input mutation, exact hand-computed values.
 */
import { describe, expect, test } from "bun:test";
import { timingStats } from "../src/percentiles.ts";

describe("timingStats — nearest-rank statistics", () => {
  test("an odd-count sample: every percentile is a value that actually occurred", () => {
    // sorted: [10, 20, 30, 40, 50]; p50 rank = ceil(2.5) = 3 → 30; p95 = ceil(4.75) = 5 → 50.
    const stats = timingStats([30, 10, 50, 20, 40]);
    expect(stats).toEqual({
      count: 5,
      minMs: 10,
      maxMs: 50,
      meanMs: 30,
      p50Ms: 30,
      p95Ms: 50,
    });
  });

  test("an even-count sample: nearest-rank p50 takes the LOWER median (no interpolation)", () => {
    // sorted: [10, 20]; p50 rank = ceil(1) = 1 → 10 (documented: no interpolation).
    const stats = timingStats([20, 10]);
    expect(stats.p50Ms).toBe(10);
    expect(stats.meanMs).toBe(15);
  });

  test("a single sample is every statistic", () => {
    const stats = timingStats([4242]);
    expect(stats).toEqual({
      count: 1,
      minMs: 4242,
      maxMs: 4242,
      meanMs: 4242,
      p50Ms: 4242,
      p95Ms: 4242,
    });
  });

  test("a 20-sample tail: p95 is the 19th value (rank ceil(19)=19), max is the tail", () => {
    const samples = Array.from({ length: 20 }, (_, i) => (i + 1) * 100); // 100..2000
    const stats = timingStats(samples);
    expect(stats.count).toBe(20);
    expect(stats.p50Ms).toBe(1000); // rank ceil(10) = 10 → 10th value
    expect(stats.p95Ms).toBe(1900); // rank ceil(19) = 19 → 19th value
    expect(stats.maxMs).toBe(2000);
    expect(stats.meanMs).toBe(1050);
  });

  test("the input array is never mutated (the caller's order survives)", () => {
    const samples = [9, 1, 5];
    timingStats(samples);
    expect(samples).toEqual([9, 1, 5]);
  });

  test("determinism: identical inputs produce deep-equal stats", () => {
    const samples = [3, 1, 4, 1, 5, 9, 2, 6];
    expect(timingStats(samples)).toEqual(timingStats([...samples]));
  });
});

describe("timingStats — fail loud on malformed input", () => {
  test("an empty array throws (a stage with no samples is absent, never a silent zero)", () => {
    expect(() => timingStats([])).toThrow("requires a non-empty samples array");
  });

  test("a negative sample throws", () => {
    expect(() => timingStats([100, -1])).toThrow("malformed sample: -1");
  });

  test("a non-finite sample throws", () => {
    expect(() => timingStats([Number.NaN])).toThrow("malformed sample: NaN");
    expect(() => timingStats([Number.POSITIVE_INFINITY])).toThrow("malformed sample: Infinity");
  });

  test("a non-number sample throws", () => {
    expect(() => timingStats([100, "fast" as unknown as number])).toThrow("malformed sample: fast");
  });
});
