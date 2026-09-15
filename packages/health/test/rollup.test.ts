/**
 * The health rollup pins: the truth table of domain health from verdicts,
 * the worst-first lattice (down > degraded > unknown > healthy), unknown
 * propagation (a domain without evidence can never certify overall health),
 * fail-closed input validation, and purity.
 */
import { describe, expect, test } from "bun:test";
import { MetricsRegistry } from "@sporta/observability";
import { ALERT_CATALOG, type AlertDefinition } from "../src/alerts";
import { evaluateAlert } from "../src/evaluate";
import type { AlertVerdict } from "../src/evaluate";
import { HEALTH_DOMAIN_IDS, type HealthDomainId } from "../src/domains";
import {
  domainHealthFromVerdicts,
  postureFromSnapshot,
  rollupHealth,
  type DomainHealth,
  type HealthStatus,
} from "../src/rollup";

function verdictOf(alert: AlertDefinition, status: AlertVerdict["status"], observed = 1): AlertVerdict {
  return {
    alertId: alert.id,
    domain: alert.domain,
    severity: alert.severity,
    status,
    observedValue: observed,
    observed: "test fixture verdict",
    summary: alert.summary,
  };
}

function alertOf(id: string, domain: HealthDomainId, severity: AlertDefinition["severity"]): AlertDefinition {
  return {
    id,
    domain,
    severity,
    title: `test ${id}`,
    summary: `${id} test`,
    expression: { kind: "counter-above", metric: "ingest_rejected_total", threshold: 0 },
    derivation: "test fixture",
    runbook: "docs/observability/PRODUCTION.md#runbook-test",
  };
}

function healthyDomains(): DomainHealth[] {
  return HEALTH_DOMAIN_IDS.map((domain): DomainHealth => ({
    domain,
    status: "healthy",
    reasons: [],
  }));
}

/** All domains healthy except `domain`, which carries `status`/`reasons`. */
function withStatus(
  domain: HealthDomainId,
  status: HealthStatus,
  reasons: string[] = [],
): DomainHealth[] {
  return healthyDomains().map((entry): DomainHealth =>
    entry.domain === domain ? { ...entry, status, reasons } : entry,
  );
}

describe("domainHealthFromVerdicts — the truth table", () => {
  const domain: HealthDomainId = "media";

  test("an empty verdict list is unknown, with an honest reason", () => {
    const health = domainHealthFromVerdicts(domain, []);
    expect(health.status).toBe("unknown");
    expect(health.reasons.join(" ")).toContain("no alert evaluated");
  });

  test("a critical firing verdict is down", () => {
    const health = domainHealthFromVerdicts(domain, [
      verdictOf(alertOf("a", domain, "critical"), "firing"),
    ]);
    expect(health.status).toBe("down");
  });

  test("a warning firing verdict is degraded", () => {
    const health = domainHealthFromVerdicts(domain, [
      verdictOf(alertOf("a", domain, "warning"), "firing"),
    ]);
    expect(health.status).toBe("degraded");
  });

  test("critical beats warning: mixed severities firing is down", () => {
    const health = domainHealthFromVerdicts(domain, [
      verdictOf(alertOf("a", domain, "warning"), "firing"),
      verdictOf(alertOf("b", domain, "critical"), "firing"),
    ]);
    expect(health.status).toBe("down");
  });

  test("all-ok verdicts are healthy with no reasons", () => {
    const health = domainHealthFromVerdicts(domain, [
      verdictOf(alertOf("a", domain, "warning"), "ok", 0),
      verdictOf(alertOf("b", domain, "critical"), "ok", 0),
    ]);
    expect(health.status).toBe("healthy");
    expect(health.reasons).toEqual([]);
  });

  test("ok + no-data is unknown — partial evidence cannot certify health", () => {
    const health = domainHealthFromVerdicts(domain, [
      verdictOf(alertOf("a", domain, "warning"), "ok", 0),
      verdictOf(alertOf("b", domain, "warning"), "no-data"),
    ]);
    expect(health.status).toBe("unknown");
    expect(health.reasons.join(" ")).toContain("test fixture verdict");
  });

  test("a firing verdict outranks no-data: firing wins", () => {
    const health = domainHealthFromVerdicts(domain, [
      verdictOf(alertOf("a", domain, "warning"), "firing"),
      verdictOf(alertOf("b", domain, "warning"), "no-data"),
    ]);
    expect(health.status).toBe("degraded");
  });

  test("a foreign-domain verdict fails loud (never guessed)", () => {
    expect(() =>
      domainHealthFromVerdicts(domain, [verdictOf(alertOf("a", "queue", "warning"), "ok", 0)]),
    ).toThrow(RangeError);
  });
});

describe("rollupHealth — the worst-first lattice", () => {
  test("all-healthy domains roll up healthy", () => {
    expect(rollupHealth(healthyDomains()).status).toBe("healthy");
  });

  test("each single domain degraded alone degrades the whole posture", () => {
    for (const domain of HEALTH_DOMAIN_IDS) {
      expect(rollupHealth(withStatus(domain, "degraded", ["x fired"])).status).toBe("degraded");
    }
  });

  test("each single domain down alone downs the whole posture", () => {
    for (const domain of HEALTH_DOMAIN_IDS) {
      expect(rollupHealth(withStatus(domain, "down", ["x fired"])).status).toBe("down");
    }
  });

  test("a single unknown domain makes the overall posture unknown (never-silent)", () => {
    const rollup = rollupHealth(withStatus("model", "unknown", ["no seams"]));
    expect(rollup.status).toBe("unknown");
  });

  test("precedence: down beats degraded beats unknown beats healthy", () => {
    const base: DomainHealth[] = HEALTH_DOMAIN_IDS.map((domain): DomainHealth => ({
      domain,
      status:
        domain === "delivery" ? "down" : domain === "queue" ? "degraded" : domain === "model" ? "unknown" : "healthy",
      reasons: [],
    }));
    expect(rollupHealth(base).status).toBe("down");
    const withoutDown: DomainHealth[] = base.map((entry): DomainHealth =>
      entry.status === "down" ? { ...entry, status: "degraded" } : entry,
    );
    expect(rollupHealth(withoutDown).status).toBe("degraded");
    const withoutDegraded: DomainHealth[] = withoutDown.map((entry): DomainHealth =>
      entry.status === "degraded" ? { ...entry, status: "unknown" } : entry,
    );
    expect(rollupHealth(withoutDegraded).status).toBe("unknown");
  });

  test("domains are always emitted in HEALTH_DOMAIN_IDS order with merged reasons", () => {
    const rollup = rollupHealth(withStatus("delivery", "degraded", ["windows failed"]));
    expect(rollup.domains.map((entry) => entry.domain)).toEqual([...HEALTH_DOMAIN_IDS]);
    expect(rollup.reasons).toEqual(["[delivery] windows failed"]);
  });

  test("malformed input fails loud: missing, duplicated, or foreign domains throw", () => {
    expect(() => rollupHealth(healthyDomains().slice(0, 5))).toThrow(RangeError);
    expect(() => rollupHealth([...healthyDomains(), healthyDomains()[0]!])).toThrow(RangeError);
    expect(() =>
      rollupHealth([
        ...healthyDomains().slice(0, 5),
        { domain: "nope" as unknown as HealthDomainId, status: "healthy", reasons: [] },
      ]),
    ).toThrow(RangeError);
  });

  test("the input array is never mutated (purity)", () => {
    const domains = healthyDomains();
    const before = JSON.stringify(domains);
    rollupHealth(domains);
    expect(JSON.stringify(domains)).toBe(before);
  });
});

describe("postureFromSnapshot — the one-call honest pipeline", () => {
  test("an empty snapshot yields every domain unknown and the overall posture unknown", () => {
    const posture = postureFromSnapshot(ALERT_CATALOG, { counters: [], histograms: [] });
    for (const entry of posture.rollup.domains) {
      expect(entry.status, `domain ${entry.domain}`).toBe("unknown");
    }
    expect(posture.rollup.status).toBe("unknown");
  });

  test("a real healthy registry snapshot still reports the model domain unknown", () => {
    const registry = new MetricsRegistry();
    // Every alert metric of the five seam-bearing domains, measured healthy:
    for (const name of [
      "ingest_rejected_total",
      "decode_failures_total",
      "timeline_sync_failures_total",
      "processing_dead_lettered_total",
      "gpu_jobs_dead_lettered_total",
      "gpu_refused_submissions_total",
      "render_failures_total",
      "render_batches_dropped_total",
      "render_batches_skipped_stale_total",
      "live_output_windows_failed_total",
      "live_output_windows_dropped_by_policy_total",
      "live_output_windows_refused_total",
      "live_output_windows_skipped_at_reconnect_total",
      "live_output_windows_skipped_stale_total",
      "gpu_worker_heartbeats_rejected_total",
      "gpu_lease_expiries_total",
      "gpu_stale_workers_total",
      "gpu_late_results_total",
      "gpu_job_timeouts_total",
      "timeline_sync_drift_anomalies_total",
      "control_failures_total",
      "transport_failures_total",
    ]) {
      registry.counter(name).inc(0);
    }
    registry.histogram("gpu_job_queue_wait_ms").observe(100);
    registry.histogram("gpu_job_latency_ms").observe(100);
    const posture = postureFromSnapshot(ALERT_CATALOG, registry.snapshot());
    const statuses = new Map(posture.rollup.domains.map((entry) => [entry.domain, entry.status]));
    expect(statuses.get("media")).toBe("healthy");
    expect(statuses.get("queue")).toBe("healthy");
    expect(statuses.get("renderer")).toBe("healthy");
    expect(statuses.get("delivery")).toBe("healthy");
    expect(statuses.get("infrastructure")).toBe("healthy");
    expect(statuses.get("model")).toBe("unknown"); // no seams exist — never silently healthy
    expect(posture.rollup.status).toBe("unknown");
  });

  test("a firing critical delivery alert downs the whole posture", () => {
    const registry = new MetricsRegistry();
    registry.counter("live_output_windows_failed_total").inc(1);
    const posture = postureFromSnapshot(ALERT_CATALOG, registry.snapshot());
    expect(posture.rollup.status).toBe("down");
    const delivery = posture.rollup.domains.find((entry) => entry.domain === "delivery");
    expect(delivery?.status).toBe("down");
    expect(posture.rollup.reasons.join(" ")).toContain("delivery-windows-failed");
  });

  test("the verdicts behind the posture are the catalog's, in order", () => {
    const posture = postureFromSnapshot(ALERT_CATALOG, { counters: [], histograms: [] });
    expect(posture.verdicts.map((verdict) => verdict.alertId)).toEqual(
      ALERT_CATALOG.alerts.map((alert) => alert.id),
    );
  });

  test("evaluateAlert and the pipeline agree on a single firing alert", () => {
    const registry = new MetricsRegistry();
    registry.counter("gpu_stale_workers_total").inc(2);
    const snapshot = registry.snapshot();
    const posture = postureFromSnapshot(ALERT_CATALOG, snapshot);
    const verdict = posture.verdicts.find((entry) => entry.alertId === "infra-gpu-stale-workers");
    const alert = ALERT_CATALOG.alerts.find(
      (candidate) => candidate.id === "infra-gpu-stale-workers",
    );
    expect(alert).toBeDefined();
    expect(verdict).toEqual(evaluateAlert(alert!, snapshot));
    expect(posture.rollup.status).toBe("degraded"); // warning-severity firing
  });
});
