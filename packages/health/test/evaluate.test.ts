/**
 * The evaluation engine pins: fire/no-fire BOUNDARY cases per expression
 * kind, the never-silent `no-data` semantics, counter label-series summing,
 * real-registry shape compatibility (snapshots come from the REAL
 * `MetricsRegistry`), purity, and determinism.
 */
import { describe, expect, test } from "bun:test";
import { MetricsRegistry } from "@sporta/observability";
import { ALERT_CATALOG, type AlertDefinition } from "../src/alerts";
import { evaluateAlert, evaluateCatalog } from "../src/evaluate";
import type { AlertVerdict } from "../src/evaluate";
import type { MetricsSnapshot } from "@sporta/observability";

function counterAlert(): AlertDefinition {
  const alert = ALERT_CATALOG.alerts.find(
    (candidate) => candidate.id === "media-ingest-rejections",
  );
  if (alert === undefined) throw new Error("catalog alert media-ingest-rejections missing");
  return alert;
}

function histogramAlert(): AlertDefinition {
  const alert = ALERT_CATALOG.alerts.find(
    (candidate) => candidate.id === "queue-gpu-queue-wait-p95",
  );
  if (alert === undefined) throw new Error("catalog alert queue-gpu-queue-wait-p95 missing");
  return alert;
}

function snapshotOf(
  counters: Array<{ name: string; labels?: Record<string, string>; value: number }>,
  histograms: Array<{ name: string; stats: { count: number; p50: number; p95: number } }>,
): MetricsSnapshot {
  return {
    counters: counters.map((entry) => ({
      name: entry.name,
      labels: entry.labels ?? {},
      value: entry.value,
    })),
    histograms: histograms.map((entry) => ({
      name: entry.name,
      stats: { min: 0, max: 0, mean: 0, ...entry.stats },
    })),
  };
}

describe("counter-above evaluation — boundary cases", () => {
  const alert = counterAlert(); // ingest_rejected_total > 0

  test("value 0 at threshold 0 is ok (strictly-above semantics)", () => {
    const verdict = evaluateAlert(
      alert,
      snapshotOf([{ name: "ingest_rejected_total", value: 0 }], []),
    );
    expect(verdict.status).toBe("ok");
    expect(verdict.observedValue).toBe(0);
  });

  test("value 1 fires", () => {
    const verdict = evaluateAlert(
      alert,
      snapshotOf([{ name: "ingest_rejected_total", value: 1 }], []),
    );
    expect(verdict.status).toBe("firing");
    expect(verdict.observedValue).toBe(1);
  });

  test("labeled series are summed (3 + 2 = 5 fires)", () => {
    const verdict = evaluateAlert(
      alert,
      snapshotOf(
        [
          { name: "ingest_rejected_total", labels: { failure_class: "rights-denied" }, value: 3 },
          { name: "ingest_rejected_total", labels: { failure_class: "malformed" }, value: 2 },
        ],
        [],
      ),
    );
    expect(verdict.status).toBe("firing");
    expect(verdict.observedValue).toBe(5);
  });

  test("an absent metric is no-data, never ok (never-silent)", () => {
    const verdict = evaluateAlert(alert, snapshotOf([], []));
    expect(verdict.status).toBe("no-data");
    expect(verdict.observedValue).toBeNull();
    expect(verdict.observed).toContain("absent from snapshot");
  });

  test("unrelated counters are ignored", () => {
    const verdict = evaluateAlert(alert, snapshotOf([{ name: "ingest_accepted", value: 500 }], []));
    expect(verdict.status).toBe("no-data");
  });
});

describe("counter-ratio-above evaluation — boundary cases", () => {
  function ratioAlert(): AlertDefinition {
    return {
      id: "test-ratio",
      domain: "queue",
      severity: "warning",
      title: "test ratio",
      summary: "numerator/denominator > 0.01",
      expression: {
        kind: "counter-ratio-above",
        numerator: "gpu_jobs_failed_total",
        denominator: "gpu_jobs_submitted_total",
        threshold: 0.01,
      },
      derivation: "test fixture",
      runbook: "docs/observability/PRODUCTION.md#runbook-test-ratio",
    };
  }

  test("ratio exactly at threshold is ok (strictly-above)", () => {
    const verdict = evaluateAlert(
      ratioAlert(),
      snapshotOf(
        [
          { name: "gpu_jobs_failed_total", value: 1 },
          { name: "gpu_jobs_submitted_total", value: 100 },
        ],
        [],
      ),
    );
    expect(verdict.status).toBe("ok");
    expect(verdict.observedValue).toBe(0.01);
  });

  test("ratio above threshold fires", () => {
    const verdict = evaluateAlert(
      ratioAlert(),
      snapshotOf(
        [
          { name: "gpu_jobs_failed_total", value: 2 },
          { name: "gpu_jobs_submitted_total", value: 100 },
        ],
        [],
      ),
    );
    expect(verdict.status).toBe("firing");
    expect(verdict.observedValue).toBe(0.02);
  });

  test("zero denominator is no-data, never a healthy zero (never-silent)", () => {
    // The numerator is present (2 attempts failed) but the denominator
    // summed 0 — nothing was ever submitted — so the ratio is undefined:
    // no-data, not a healthy 0/0 = 0.
    const verdict = evaluateAlert(
      ratioAlert(),
      snapshotOf(
        [
          { name: "gpu_jobs_failed_total", value: 2 },
          { name: "gpu_jobs_submitted_total", value: 0 },
        ],
        [],
      ),
    );
    expect(verdict.status).toBe("no-data");
    expect(verdict.observed).toContain("denominator summed 0");
  });

  test("absent numerator is no-data", () => {
    const verdict = evaluateAlert(
      ratioAlert(),
      snapshotOf([{ name: "gpu_jobs_submitted_total", value: 10 }], []),
    );
    expect(verdict.status).toBe("no-data");
  });
});

describe("histogram percentile evaluation — boundary cases", () => {
  const alert = histogramAlert(); // gpu_job_queue_wait_ms p95 > 6000

  test("p95 exactly at threshold is ok (strictly-above)", () => {
    const verdict = evaluateAlert(
      alert,
      snapshotOf(
        [],
        [{ name: "gpu_job_queue_wait_ms", stats: { count: 10, p50: 100, p95: 6000 } }],
      ),
    );
    expect(verdict.status).toBe("ok");
    expect(verdict.observedValue).toBe(6000);
  });

  test("p95 above threshold fires", () => {
    const verdict = evaluateAlert(
      alert,
      snapshotOf(
        [],
        [{ name: "gpu_job_queue_wait_ms", stats: { count: 10, p50: 100, p95: 6001 } }],
      ),
    );
    expect(verdict.status).toBe("firing");
  });

  test("an absent histogram is no-data", () => {
    const verdict = evaluateAlert(alert, snapshotOf([], []));
    expect(verdict.status).toBe("no-data");
    expect(verdict.observed).toContain("absent from snapshot");
  });

  test("a histogram with zero observations is no-data, never a healthy zero", () => {
    const verdict = evaluateAlert(
      alert,
      snapshotOf([], [{ name: "gpu_job_queue_wait_ms", stats: { count: 0, p50: 0, p95: 0 } }]),
    );
    expect(verdict.status).toBe("no-data");
    expect(verdict.observed).toContain("0 observations");
  });

  test("the p50 variant reads the p50 stat", () => {
    const alert50: AlertDefinition = {
      ...histogramAlert(),
      id: "test-p50",
      expression: { kind: "histogram-p50-above", metric: "gpu_job_queue_wait_ms", thresholdMs: 50 },
    };
    const verdict = evaluateAlert(
      alert50,
      snapshotOf([], [{ name: "gpu_job_queue_wait_ms", stats: { count: 10, p50: 51, p95: 9000 } }]),
    );
    expect(verdict.status).toBe("firing");
    expect(verdict.observedValue).toBe(51);
  });
});

describe("real-registry compatibility and purity", () => {
  test("a real MetricsRegistry snapshot feeds the engine (the W007 shape, no adapters)", () => {
    const registry = new MetricsRegistry();
    registry.counter("ingest_rejected_total", { failure_class: "rights-denied" }).inc();
    registry.counter("ingest_rejected_total", { failure_class: "malformed" }).inc(4);
    registry.histogram("gpu_job_queue_wait_ms").observe(4000);
    registry.histogram("gpu_job_queue_wait_ms").observe(5000);
    const snapshot = registry.snapshot();
    expect(evaluateAlert(counterAlert(), snapshot).status).toBe("firing");
    expect(evaluateAlert(counterAlert(), snapshot).observedValue).toBe(5);
    // p95 of [4000, 5000] (nearest-rank, n=2) = 5000 <= 6000 → ok
    expect(evaluateAlert(histogramAlert(), snapshot).status).toBe("ok");
  });

  test("evaluation never mutates the snapshot (purity)", () => {
    const snapshot = snapshotOf(
      [
        { name: "ingest_rejected_total", labels: { failure_class: "rights-denied" }, value: 3 },
        { name: "gpu_jobs_submitted_total", value: 10 },
      ],
      [{ name: "gpu_job_queue_wait_ms", stats: { count: 3, p50: 10, p95: 7000 } }],
    );
    const before = JSON.stringify(snapshot);
    for (const alert of ALERT_CATALOG.alerts) {
      evaluateAlert(alert, snapshot);
    }
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  test("evaluateCatalog is deterministic and its counts balance (never-silent accounting)", () => {
    const snapshot = snapshotOf(
      [
        { name: "ingest_rejected_total", value: 0 },
        { name: "gpu_jobs_dead_lettered_total", value: 1 },
      ],
      [{ name: "gpu_job_queue_wait_ms", stats: { count: 5, p50: 100, p95: 7000 } }],
    );
    const first = evaluateCatalog(ALERT_CATALOG, snapshot);
    const second = evaluateCatalog(ALERT_CATALOG, snapshot);
    expect(first).toEqual(second);
    expect(first.verdicts.map((verdict) => verdict.alertId)).toEqual(
      ALERT_CATALOG.alerts.map((alert) => alert.id),
    );
    expect(first.counts.firing + first.counts.ok + first.counts["no-data"]).toBe(
      ALERT_CATALOG.alerts.length,
    );
    // gpu DLQ (1) + queue-wait p95 7000 > 6000; ingest rejections 0 is ok;
    // the job-latency histogram is absent → no-data.
    expect(first.counts).toEqual({ firing: 2, ok: 1, "no-data": 21 });
  });

  test("the empty snapshot evaluates to all no-data (absence is not health)", () => {
    const evaluation = evaluateCatalog(ALERT_CATALOG, { counters: [], histograms: [] });
    expect(evaluation.counts).toEqual({ firing: 0, ok: 0, "no-data": 24 });
    for (const verdict of evaluation.verdicts) {
      expect(verdict.status).toBe("no-data");
    }
  });

  test("verdicts carry the definition's domain, severity, and summary (evidence shape)", () => {
    const verdict: AlertVerdict = evaluateAlert(
      counterAlert(),
      snapshotOf([{ name: "ingest_rejected_total", value: 2 }], []),
    );
    expect(verdict).toMatchObject({
      alertId: "media-ingest-rejections",
      domain: "media",
      severity: "warning",
      status: "firing",
      summary: "ingest_rejected_total > 0",
    });
  });
});
