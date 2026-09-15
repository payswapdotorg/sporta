/**
 * The alert EVALUATION ENGINE (W805) — pure and deterministic.
 *
 * Input: an alert definition + a `MetricsSnapshot` — exactly the shape
 * `@sporta/observability`'s `MetricsRegistry.snapshot()` produces (counters
 * sorted by name then series key, histograms sorted by name; the engine does
 * not care about order, it only reads). Output: one verdict per alert.
 *
 * NEVER-SILENT semantics (test-pinned):
 *
 * - `firing` — the threshold expression is strictly exceeded;
 * - `ok` — measured, and at-or-below threshold;
 * - `no-data` — the metric is absent from the snapshot, a histogram has zero
 *   observations, or a ratio's denominator is zero. Absence of evidence is
 *   NOT health: `no-data` never becomes `ok`, and the rollup propagates it as
 *   `unknown`.
 *
 * Counter values are SUMMED across label series (a rejection is a rejection
 * whatever its failure_class label); histograms are matched by name.
 */
import type { MetricsSnapshot } from "@sporta/observability";
import type { AlertCatalog, AlertDefinition } from "./alerts";
import { assertNonNegativeFinite } from "./internal";

/** The verdict statuses (the never-silent tri-state). */
export const ALERT_EVAL_STATUSES = ["firing", "ok", "no-data"] as const;

export type AlertEvalStatus = (typeof ALERT_EVAL_STATUSES)[number];

/** One alert's evaluation result against one snapshot. */
export interface AlertVerdict {
  alertId: string;
  domain: AlertDefinition["domain"];
  severity: AlertDefinition["severity"];
  status: AlertEvalStatus;
  /** The measured value the decision was made on; null iff `no-data`. */
  observedValue: number | null;
  /** What was measured, human-readable (deterministic string). */
  observed: string;
  /** The expression summary from the definition (echoed for consumers). */
  summary: string;
}

/** Sum of every counter series named `metric` (labels ignored). */
function counterSum(snapshot: MetricsSnapshot, metric: string): number | null {
  let total: number | null = null;
  for (const series of snapshot.counters) {
    if (series.name === metric) {
      total = (total ?? 0) + series.value;
    }
  }
  return total;
}

/** The histogram series named `metric`, or undefined. */
function findHistogram(
  snapshot: MetricsSnapshot,
  metric: string,
): { count: number; p50: number; p95: number } | undefined {
  for (const series of snapshot.histograms) {
    if (series.name === metric) {
      return series.stats;
    }
  }
  return undefined;
}

function verdict(
  alert: AlertDefinition,
  status: AlertEvalStatus,
  observedValue: number | null,
  observed: string,
): AlertVerdict {
  return {
    alertId: alert.id,
    domain: alert.domain,
    severity: alert.severity,
    status,
    observedValue,
    observed,
    summary: alert.summary,
  };
}

/**
 * Evaluates ONE alert against one snapshot. Pure: the snapshot is read,
 * never mutated (pinned by test).
 */
export function evaluateAlert(alert: AlertDefinition, snapshot: MetricsSnapshot): AlertVerdict {
  switch (alert.expression.kind) {
    case "counter-above": {
      const { metric, threshold } = alert.expression;
      assertNonNegativeFinite(threshold, `alert "${alert.id}" threshold`);
      const value = counterSum(snapshot, metric);
      if (value === null) {
        return verdict(alert, "no-data", null, `counter "${metric}" absent from snapshot`);
      }
      return value > threshold
        ? verdict(alert, "firing", value, `counter "${metric}" summed ${value} > ${threshold}`)
        : verdict(alert, "ok", value, `counter "${metric}" summed ${value} <= ${threshold}`);
    }
    case "counter-ratio-above": {
      const { numerator, denominator, threshold } = alert.expression;
      assertNonNegativeFinite(threshold, `alert "${alert.id}" threshold`);
      const numeratorValue = counterSum(snapshot, numerator);
      const denominatorValue = counterSum(snapshot, denominator);
      if (numeratorValue === null) {
        return verdict(alert, "no-data", null, `counter "${numerator}" absent from snapshot`);
      }
      if (denominatorValue === null) {
        return verdict(alert, "no-data", null, `counter "${denominator}" absent from snapshot`);
      }
      if (denominatorValue === 0) {
        // Never-silent: a zero denominator means nothing was measured —
        // an undefined ratio is `no-data`, never a healthy zero.
        return verdict(
          alert,
          "no-data",
          null,
          `ratio "${numerator}/${denominator}" undefined: denominator summed 0`,
        );
      }
      const ratio = numeratorValue / denominatorValue;
      return ratio > threshold
        ? verdict(
            alert,
            "firing",
            ratio,
            `ratio ${numeratorValue}/${denominatorValue} = ${ratio} > ${threshold}`,
          )
        : verdict(
            alert,
            "ok",
            ratio,
            `ratio ${numeratorValue}/${denominatorValue} = ${ratio} <= ${threshold}`,
          );
    }
    case "histogram-p95-above":
    case "histogram-p50-above": {
      const percentile = alert.expression.kind === "histogram-p95-above" ? "p95" : "p50";
      const { metric, thresholdMs } = alert.expression;
      assertNonNegativeFinite(thresholdMs, `alert "${alert.id}" thresholdMs`);
      const stats = findHistogram(snapshot, metric);
      if (stats === undefined) {
        return verdict(alert, "no-data", null, `histogram "${metric}" absent from snapshot`);
      }
      if (stats.count === 0) {
        // An empty histogram observed nothing — no-data, not a healthy zero.
        return verdict(alert, "no-data", null, `histogram "${metric}" has 0 observations`);
      }
      const value = percentile === "p95" ? stats.p95 : stats.p50;
      return value > thresholdMs
        ? verdict(
            alert,
            "firing",
            value,
            `histogram "${metric}" ${percentile} ${value} > ${thresholdMs}`,
          )
        : verdict(
            alert,
            "ok",
            value,
            `histogram "${metric}" ${percentile} ${value} <= ${thresholdMs}`,
          );
    }
  }
}

/** The result of evaluating a whole catalog against one snapshot. */
export interface CatalogEvaluation {
  /** The evaluated catalog's identity (echoed). */
  schemaVersion: number;
  /** One verdict per alert, in catalog order (deterministic). */
  verdicts: AlertVerdict[];
  /** Verdict counts by status (never-silent accounting of the run itself). */
  counts: { firing: number; ok: number; "no-data": number };
}

/**
 * Evaluates EVERY alert of a catalog against one snapshot, in catalog
 * order. Pure and deterministic: same catalog + same snapshot in, same
 * verdicts out (pinned by test).
 */
export function evaluateCatalog(
  catalog: AlertCatalog,
  snapshot: MetricsSnapshot,
): CatalogEvaluation {
  const verdicts = catalog.alerts.map((alert) => evaluateAlert(alert, snapshot));
  const counts = { firing: 0, ok: 0, "no-data": 0 };
  for (const entry of verdicts) {
    counts[entry.status] += 1;
  }
  return { schemaVersion: catalog.schemaVersion, verdicts, counts };
}
