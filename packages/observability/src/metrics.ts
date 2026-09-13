/**
 * In-memory metrics registry: counters and histograms with nearest-rank
 * percentiles, zero dependencies (W007 §3.3).
 *
 * The registry is generic; the recommended metric-name vocabulary below is
 * aligned with the architecture-lock §12 observability requirements
 * (throughput, dropped frames, queue depth, model latency, renderer latency,
 * end-to-end latency, ...). Stage owners register what their stage measures;
 * `snapshot()` yields a plain, JSON-safe object for reporting (W805 dashboards
 * will read exactly this shape via an exporter).
 */
import { assertFiniteNumber, summarizeNumbers } from "./internal";

/** Percentile-style summary of a histogram sample (nearest-rank p50/p95). */
export interface HistogramStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
}

/**
 * Recommended metric names, aligned with the architecture-lock §12 vocabulary
 * (`frames_dropped`, `queue_depth`, `stage_latency_ms`, `model_latency_ms`,
 * `renderer_latency_ms`, `e2e_latency_ms`). The registry itself is generic —
 * these constants exist so stages and dashboards agree on the names.
 */
export const METRIC_NAMES = {
  framesDropped: "frames_dropped",
  queueDepth: "queue_depth",
  stageLatencyMs: "stage_latency_ms",
  modelLatencyMs: "model_latency_ms",
  rendererLatencyMs: "renderer_latency_ms",
  e2eLatencyMs: "e2e_latency_ms",
} as const;

/** A monotonically increasing counter handle. */
export interface Counter {
  /** Increments the counter by 1 (or by `n`; negative `n` throws). */
  inc(n?: number): void;
}

/** A latency/value histogram handle. */
export interface Histogram {
  /** Records one observation (must be a finite number). */
  observe(value: number): void;
  /** Current summary (empty series: all-zero stats with `count: 0`). */
  stats(): HistogramStats;
}

/** One counter series in a {@link MetricsSnapshot}. */
export interface CounterSnapshot {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/** One histogram series in a {@link MetricsSnapshot}. */
export interface HistogramSnapshot {
  name: string;
  stats: HistogramStats;
}

/** Plain, JSON-safe dump of every series, deterministically ordered. */
export interface MetricsSnapshot {
  counters: CounterSnapshot[];
  histograms: HistogramSnapshot[];
}

interface CounterCell {
  labels: Record<string, string>;
  value: number;
}

interface HistogramCell {
  values: number[];
}

/** Canonical label key: sorted `k=v` pairs, so label order never matters. */
function seriesKey(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([key, value]) => `${key}=${value}`).join(",");
}

function assertMetricName(name: string): void {
  if (typeof name !== "string" || name.length < 1) {
    throw new RangeError(`metric name must be a non-empty string (got ${String(name)})`);
  }
}

function assertLabels(labels: Record<string, string>): void {
  for (const [key, value] of Object.entries(labels)) {
    if (typeof value !== "string" || value.length < 1) {
      throw new TypeError(
        `metric label "${key}" must be a non-empty string (got ${String(value)})`,
      );
    }
  }
}

/**
 * The in-memory metrics registry. Handles are get-or-create views: calling
 * `counter(name, labels)` twice with the same arguments returns handles for
 * the SAME series, and handles obtained before {@link MetricsRegistry.reset}
 * keep working afterwards (their next use re-creates the series). All state
 * lives per registry instance — one process, no external backend, by design.
 */
export class MetricsRegistry {
  /** name -> seriesKey -> counter cell */
  private readonly counters = new Map<string, Map<string, CounterCell>>();
  /** name -> histogram cell */
  private readonly histograms = new Map<string, HistogramCell>();

  /**
   * Returns the counter handle for `name` (+ optional labels). Same name and
   * same labels always address the same series; label key order is ignored.
   */
  counter(name: string, labels: Record<string, string> = {}): Counter {
    assertMetricName(name);
    assertLabels(labels);
    const frozen = { ...labels };
    const key = seriesKey(frozen);
    return {
      inc: (n: number = 1): void => {
        if (!Number.isInteger(n) || n < 0) {
          throw new RangeError(`counter.inc requires a non-negative integer (got ${String(n)})`);
        }
        let series = this.counters.get(name);
        if (series === undefined) {
          series = new Map<string, CounterCell>();
          this.counters.set(name, series);
        }
        let cell = series.get(key);
        if (cell === undefined) {
          cell = { labels: frozen, value: 0 };
          series.set(key, cell);
        }
        cell.value += n;
      },
    };
  }

  /** Returns the histogram handle for `name` (get-or-create, no labels). */
  histogram(name: string): Histogram {
    assertMetricName(name);
    return {
      observe: (value: number): void => {
        assertFiniteNumber(value, `histogram "${name}" observe`);
        let cell = this.histograms.get(name);
        if (cell === undefined) {
          cell = { values: [] };
          this.histograms.set(name, cell);
        }
        cell.values.push(value);
      },
      stats: (): HistogramStats => {
        const cell = this.histograms.get(name);
        return cell === undefined ? summarizeNumbers([]) : summarizeNumbers(cell.values);
      },
    };
  }

  /**
   * A plain, JSON-safe object of every series: counters sorted by name then
   * series key, histograms sorted by name — deterministic across calls.
   */
  snapshot(): MetricsSnapshot {
    const counters: CounterSnapshot[] = [];
    const names = [...this.counters.keys()].sort();
    for (const name of names) {
      const series = this.counters.get(name);
      if (series === undefined) continue; // defensive: names came from the map
      const cells = [...series.values()].sort((a, b) =>
        seriesKey(a.labels) < seriesKey(b.labels) ? -1 : 1,
      );
      for (const cell of cells) {
        counters.push({ name, labels: { ...cell.labels }, value: cell.value });
      }
    }
    const histograms: HistogramSnapshot[] = [...this.histograms.keys()].sort().map((name) => {
      const cell = this.histograms.get(name);
      const values = cell === undefined ? [] : cell.values;
      return { name, stats: summarizeNumbers(values) };
    });
    return { counters, histograms };
  }

  /**
   * Clears every series. Previously obtained handles stay usable — their next
   * increment/observation re-creates the series (get-or-create semantics).
   */
  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }
}
