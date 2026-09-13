/**
 * Unit tests for the in-memory metrics registry (W007 §3.3).
 *
 * The histogram math is pinned on a known 100-value series (1..100, observed
 * in DESCENDING order to prove the sort) plus a small 4-value series, so the
 * nearest-rank p50/p95 definition is asserted exactly: rank = ceil(p/100 * n).
 */
import { describe, expect, test } from "bun:test";
import { METRIC_NAMES, MetricsRegistry } from "../src/metrics";
import type { HistogramStats } from "../src/metrics";

/** The known 100-value series: 100..1 so the internal sort is exercised. */
const SERIES_100: number[] = Array.from({ length: 100 }, (_, i) => 100 - i);

describe("metrics registry — counters", () => {
  test("inc() adds 1; inc(n) adds n", () => {
    const registry = new MetricsRegistry();
    const dropped = registry.counter(METRIC_NAMES.framesDropped);
    dropped.inc();
    dropped.inc();
    dropped.inc(5);
    expect(registry.snapshot().counters).toEqual([
      { name: METRIC_NAMES.framesDropped, labels: {}, value: 7 },
    ]);
  });

  test("same name + same labels address one series; label order is ignored", () => {
    const registry = new MetricsRegistry();
    registry.counter("queue_depth", { stage: "perception", shard: "a" }).inc();
    registry.counter("queue_depth", { shard: "a", stage: "perception" }).inc(2);
    registry.counter("queue_depth", { stage: "rendering" }).inc();

    const series = registry.snapshot().counters.filter((counter) => counter.name === "queue_depth");
    expect(series).toHaveLength(2);
    expect(series.find((s) => s.labels.stage === "perception")?.value).toBe(3);
    expect(series.find((s) => s.labels.stage === "rendering")?.value).toBe(1);
  });

  test("invalid inputs fail loud", () => {
    const registry = new MetricsRegistry();
    expect(() => registry.counter("frames_dropped").inc(-1)).toThrow(RangeError);
    expect(() => registry.counter("frames_dropped").inc(1.5)).toThrow(RangeError);
    expect(() => registry.counter("")).toThrow(RangeError);
    expect(() => registry.counter("queue_depth", { stage: "" })).toThrow(TypeError);
    expect(() => registry.counter("queue_depth", { stage: 3 as unknown as string })).toThrow(
      TypeError,
    );
  });
});

describe("metrics registry — histograms", () => {
  test("nearest-rank p50/p95 on the known 100-value series 1..100", () => {
    const registry = new MetricsRegistry();
    const latency = registry.histogram(METRIC_NAMES.stageLatencyMs);
    for (const value of SERIES_100) {
      latency.observe(value);
    }
    // rank(50) = ceil(0.5 * 100) = 50 -> 50; rank(95) = ceil(0.95 * 100) = 95 -> 95.
    expect(latency.stats()).toEqual({
      count: 100,
      min: 1,
      max: 100,
      mean: 50.5,
      p50: 50,
      p95: 95,
    } satisfies HistogramStats);
  });

  test("small series: 4 values [5, 1, 9, 3]", () => {
    const registry = new MetricsRegistry();
    const latency = registry.histogram(METRIC_NAMES.modelLatencyMs);
    for (const value of [5, 1, 9, 3]) {
      latency.observe(value);
    }
    // sorted [1, 3, 5, 9]: rank(50) = ceil(2) = 2 -> 3; rank(95) = ceil(3.8) = 4 -> 9.
    expect(latency.stats()).toEqual({
      count: 4,
      min: 1,
      max: 9,
      mean: 4.5,
      p50: 3,
      p95: 9,
    } satisfies HistogramStats);
  });

  test("an empty series reports count 0, never throws", () => {
    const registry = new MetricsRegistry();
    expect(registry.histogram("never_observed").stats()).toEqual({
      count: 0,
      min: 0,
      max: 0,
      mean: 0,
      p50: 0,
      p95: 0,
    });
    expect(() => registry.histogram("bad").observe(Number.NaN)).toThrow(RangeError);
  });
});

describe("metrics registry — snapshot and reset", () => {
  test("snapshot is a deterministically ordered, JSON-safe plain object", () => {
    const registry = new MetricsRegistry();
    registry.counter("events_derived").inc(2);
    registry.counter(METRIC_NAMES.framesDropped, { stage: "b" }).inc();
    registry.counter(METRIC_NAMES.framesDropped, { stage: "a" }).inc(4);
    registry.histogram(METRIC_NAMES.e2eLatencyMs).observe(2_080);

    const snapshot = registry.snapshot();
    expect(snapshot.counters.map((counter) => counter.name)).toEqual([
      "events_derived",
      "frames_dropped",
      "frames_dropped",
    ]);
    // Within one metric name, series are sorted by canonical series key.
    expect(snapshot.counters[1]?.labels).toEqual({ stage: "a" });
    expect(snapshot.counters[2]?.labels).toEqual({ stage: "b" });
    expect(snapshot.histograms).toEqual([
      {
        name: METRIC_NAMES.e2eLatencyMs,
        stats: { count: 1, min: 2_080, max: 2_080, mean: 2_080, p50: 2_080, p95: 2_080 },
      },
    ]);

    // Plain-object guarantee: the snapshot round-trips through JSON.
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    // Snapshotting twice is stable (no mutation, no ordering drift).
    expect(registry.snapshot()).toEqual(snapshot);
  });

  test("reset clears every series and handles keep working", () => {
    const registry = new MetricsRegistry();
    const dropped = registry.counter(METRIC_NAMES.framesDropped);
    const latency = registry.histogram(METRIC_NAMES.stageLatencyMs);
    dropped.inc(3);
    latency.observe(10);

    registry.reset();
    expect(registry.snapshot()).toEqual({ counters: [], histograms: [] });

    // Get-or-create semantics: old handles re-create their series on next use.
    dropped.inc(1);
    latency.observe(20);
    expect(registry.snapshot().counters).toEqual([
      { name: METRIC_NAMES.framesDropped, labels: {}, value: 1 },
    ]);
    expect(registry.snapshot().histograms[0]?.stats.count).toBe(1);
    expect(registry.snapshot().histograms[0]?.stats.p50).toBe(20);
  });
});
