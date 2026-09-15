/**
 * The nearest-rank percentile core, test-pinned (the W306 method contract —
 * SLOs.md documents the method; these tests make it unfalsifiable in CI).
 */
import { describe, expect, test } from "bun:test";
import { InvalidBenchmarkOptionsError } from "../src/errors";
import { isLatencyBenchmarkError } from "../src/errors";
import { latencyStats, nearestRankPercentile, PERCENTILE_POINTS } from "../src/percentiles";

describe("nearestRankPercentile", () => {
  test("p50/p95 of 1..100 are the 50th/95th samples (the NIST worked example)", () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(nearestRankPercentile(samples, 50)).toBe(50);
    expect(nearestRankPercentile(samples, 95)).toBe(95);
    expect(nearestRankPercentile(samples, 100)).toBe(100);
    expect(nearestRankPercentile(samples, 1)).toBe(1);
  });

  test("with 20 samples, rank(95) = ceil(19) = 19 → the second-largest sample", () => {
    const samples = Array.from({ length: 20 }, (_, i) => (i + 1) * 10); // 10..200
    expect(nearestRankPercentile(samples, 95)).toBe(190);
    expect(nearestRankPercentile(samples, 50)).toBe(100); // rank 10
  });

  test("a single sample is every percentile (the clamp)", () => {
    expect(nearestRankPercentile([123], 50)).toBe(123);
    expect(nearestRankPercentile([123], 95)).toBe(123);
    expect(nearestRankPercentile([123], 100)).toBe(123);
  });

  test("unsorted input is handled (sorted internally, never trusted)", () => {
    expect(
      nearestRankPercentile(
        [200, 10, 190, 20, 180, 30, 170, 40, 160, 50, 150, 60, 140, 70, 130, 80, 120, 90, 110, 100],
        95,
      ),
    ).toBe(190);
    expect(nearestRankPercentile([3, 1, 2], 50)).toBe(2);
  });

  test("the input array is never mutated", () => {
    const samples = [30, 10, 20];
    nearestRankPercentile(samples, 95);
    expect(samples).toEqual([30, 10, 20]);
  });

  test("duplicates resolve deterministically (ties are real samples)", () => {
    expect(nearestRankPercentile([5, 5, 5, 5], 95)).toBe(5);
    expect(nearestRankPercentile([1, 5, 5, 9], 50)).toBe(5); // rank 2
    expect(nearestRankPercentile([1, 5, 5, 9], 95)).toBe(9); // rank ceil(3.8) = 4
  });

  test("empty input fails loud (typed), never a silent 0", () => {
    expect(() => nearestRankPercentile([], 50)).toThrow(InvalidBenchmarkOptionsError);
    try {
      nearestRankPercentile([], 50);
      expect.unreachable();
    } catch (err) {
      expect(isLatencyBenchmarkError(err)).toBe(true);
      expect((err as { code: string }).code).toBe("invalid-benchmark-options");
    }
  });

  test("malformed p fails loud", () => {
    for (const bad of [0, -1, 100.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => nearestRankPercentile([1, 2], bad)).toThrow(InvalidBenchmarkOptionsError);
    }
  });

  test("malformed samples fail loud (negative, non-finite)", () => {
    expect(() => nearestRankPercentile([1, -1, 3], 50)).toThrow(InvalidBenchmarkOptionsError);
    expect(() => nearestRankPercentile([1, Number.NaN, 3], 50)).toThrow(
      InvalidBenchmarkOptionsError,
    );
    expect(() => nearestRankPercentile([1, Number.POSITIVE_INFINITY, 3], 50)).toThrow(
      InvalidBenchmarkOptionsError,
    );
  });
});

describe("latencyStats", () => {
  test("count/min/max/p50/p95, hand-computed", () => {
    const stats = latencyStats([400, 100, 300, 200, 500]);
    expect(stats).toEqual({ count: 5, minMs: 100, maxMs: 500, p50Ms: 300, p95Ms: 500 });
  });

  test("an even count follows nearest-rank exactly (no interpolation)", () => {
    // sorted: 10,20,30,40 → rank(50)=2 → 20; rank(95)=ceil(3.8)=4 → 40
    expect(latencyStats([40, 10, 30, 20])).toEqual({
      count: 4,
      minMs: 10,
      maxMs: 40,
      p50Ms: 20,
      p95Ms: 40,
    });
  });

  test("empty input fails loud", () => {
    expect(() => latencyStats([])).toThrow(InvalidBenchmarkOptionsError);
  });

  test("the benchmark's fixed percentile set is exactly {50, 95} (the work item's ask)", () => {
    expect(PERCENTILE_POINTS).toEqual([50, 95]);
  });
});
