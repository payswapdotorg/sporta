/**
 * The alert-catalog tests: completeness (every SLO carries both tiers), the
 * boundary pins (compliant / warning / critical — the exact threshold
 * semantics, `>` fires, `<=` does not), the subsumption rule (critical
 * subsumes warning), the loss alert's calibrated conditions, determinism,
 * and the SLOs.md §4 doc pin (row-for-row, both directions).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALERT_CATALOG,
  ALERT_CATALOG_ID,
  LATENCY_ALERTS,
  LOSS_ALERT,
  evaluateAlerts,
  evaluateLatencyAlerts,
  evaluateLossAlert,
  warnThresholdMs,
  type FiredLatencyAlert,
} from "../src/alerts";
import { SLO_DEFINITIONS, sloById } from "../src/slos";
import { buildInput, withStageMetric } from "./helpers";

const DOC: string = readFileSync(join(import.meta.dir, "..", "SLOs.md"), "utf8");

/** One row of the SLOs.md §4 alert table. */
interface DocAlertRow {
  alertId: string;
  severity: string;
  threshold: string;
}

/** Parses the §4 alert-catalog rows. */
function parseDocAlertRows(doc: string): DocAlertRow[] {
  const rows: DocAlertRow[] = [];
  for (const line of doc.split("\n")) {
    const match = /^\|\s*((?:latency|loss)\.[a-z0-9.-]+)\s*\|/.exec(line);
    if (match === null) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    rows.push({ alertId: cells[1]!, severity: cells[2]!, threshold: cells[3]! });
  }
  return rows;
}

describe("catalog completeness", () => {
  test("33 definitions: 32 latency (2 per SLO) + the loss alert", () => {
    expect(LATENCY_ALERTS).toHaveLength(32);
    expect(ALERT_CATALOG).toHaveLength(33);
    expect(ALERT_CATALOG_ID).toBe("w802-alerts-v1");
    expect(new Set(ALERT_CATALOG.map((alert) => alert.alertId)).size).toBe(33);
  });

  test("every SLO carries exactly one warning and one critical row", () => {
    for (const slo of SLO_DEFINITIONS) {
      const rows = LATENCY_ALERTS.filter((alert) => alert.sloId === slo.sloId);
      expect(rows).toHaveLength(2);
      expect(rows.filter((alert) => alert.severity === "warning")).toHaveLength(1);
      expect(rows.filter((alert) => alert.severity === "critical")).toHaveLength(1);
      expect(rows.map((alert) => alert.alertId).sort()).toEqual(
        [`latency.${slo.sloId}.critical`, `latency.${slo.sloId}.warning`].sort(),
      );
    }
  });

  test("every critical threshold is the SLO target; every warning is the half-headroom ceil", () => {
    for (const alert of LATENCY_ALERTS) {
      const slo = sloById(alert.sloId);
      if (alert.severity === "critical") {
        expect(alert.thresholdMs).toBe(slo.targetMs);
      } else {
        expect(alert.thresholdMs).toBe(warnThresholdMs(slo));
      }
      expect(alert.comparator).toBe("greater-than");
    }
  });

  test("every warning threshold sits strictly between baseline and target", () => {
    for (const slo of SLO_DEFINITIONS) {
      const threshold = warnThresholdMs(slo);
      expect(threshold).toBeGreaterThan(slo.baselineMs);
      expect(threshold).toBeLessThan(slo.targetMs);
    }
  });

  test("the warning thresholds are the documented values (spot pins)", () => {
    expect(warnThresholdMs(sloById("batch.swm-to-batch.p95"))).toBe(5239);
    expect(warnThresholdMs(sloById("batch.end-to-end.p95"))).toBe(10425);
    expect(warnThresholdMs(sloById("batch.end-to-end.p50"))).toBe(2515);
    expect(warnThresholdMs(sloById("batch.batch-queue.p50"))).toBe(25);
    expect(warnThresholdMs(sloById("frame.swm-store-sojourn.p50"))).toBe(2561);
    expect(warnThresholdMs(sloById("frame.end-to-end.p95"))).toBe(10790);
  });
});

describe("boundary pins: the exact firing semantics (all 16 SLOs, systematic)", () => {
  const firedIdsFor = (input: ReturnType<typeof buildInput>): string[] =>
    evaluateLatencyAlerts(input).map((alert) => alert.alertId);

  test("measured == baseline → no alert fires (the W306 evidence window is clean)", () => {
    expect(evaluateLatencyAlerts(buildInput())).toEqual([]);
  });

  test("measured == warning threshold → NO warning (strictly greater fires)", () => {
    for (const slo of SLO_DEFINITIONS) {
      const input = buildInput(withStageMetric(slo.scope, slo.stage, slo.metric, warnThresholdMs(slo)));
      expect(firedIdsFor(input)).toEqual([]);
    }
  });

  test("warning threshold + 1 → exactly one warning, per SLO", () => {
    for (const slo of SLO_DEFINITIONS) {
      const input = buildInput(
        withStageMetric(slo.scope, slo.stage, slo.metric, warnThresholdMs(slo) + 1),
      );
      expect(firedIdsFor(input)).toEqual([`latency.${slo.sloId}.warning`]);
    }
  });

  test("measured == target → warning only (objective met at the boundary; headroom exhausted)", () => {
    for (const slo of SLO_DEFINITIONS) {
      const input = buildInput(withStageMetric(slo.scope, slo.stage, slo.metric, slo.targetMs));
      expect(firedIdsFor(input)).toEqual([`latency.${slo.sloId}.warning`]);
    }
  });

  test("target + 1 → critical ONLY (critical subsumes warning — one row per indicator)", () => {
    for (const slo of SLO_DEFINITIONS) {
      const input = buildInput(withStageMetric(slo.scope, slo.stage, slo.metric, slo.targetMs + 1));
      expect(firedIdsFor(input)).toEqual([`latency.${slo.sloId}.critical`]);
    }
  });

  test("the fired alert carries the evidence (measured, threshold, message)", () => {
    const input = buildInput({ batch: { "swm-to-batch": { p95Ms: 6001 } } });
    const [alert] = evaluateLatencyAlerts(input) as FiredLatencyAlert[];
    expect(alert).toMatchObject({
      alertId: "latency.batch.swm-to-batch.p95.critical",
      severity: "critical",
      sloId: "batch.swm-to-batch.p95",
      measuredMs: 6001,
      thresholdMs: 6000,
      kind: "latency",
    });
    expect(alert.message).toContain("SLO objective breached");
    expect(alert.message).toContain("batch.swm-to-batch.p95");
  });
});

describe("the loss alert (calibrated conditions)", () => {
  test("the zero-loss baseline window does not fire", () => {
    expect(evaluateLossAlert(buildInput())).toBeNull();
  });

  test("dropped > 0 fires (structural loss)", () => {
    const alert = evaluateLossAlert(
      buildInput({ frames: { framesEmitted: 239, framesDropped: 1 } }),
    );
    expect(alert?.alertId).toBe("loss.unexpected-frames");
    expect(alert?.lostFrames).toEqual({ dropped: 1, cancelled: 0, skippedStale: 0 });
    expect(alert?.degradationKind).toBe("disabled");
    expect(alert?.message).toContain("dropped 1");
  });

  test("cancelled > 0 fires", () => {
    const alert = evaluateLossAlert(
      buildInput({ frames: { framesEmitted: 239, framesCancelled: 1 } }),
    );
    expect(alert?.lostFrames.cancelled).toBe(1);
  });

  test("skipped-stale > 0 fires ONLY while the degradation is disabled", () => {
    const disabled = buildInput({ frames: { framesEmitted: 238, framesSkippedStale: 2 } });
    expect(evaluateLossAlert(disabled)?.lostFrames.skippedStale).toBe(2);
    const enabled = buildInput({
      frames: { framesEmitted: 238, framesSkippedStale: 2 },
      degradation: { kind: "skip-stale", maxWatermarkLagMs: 5000 },
    });
    expect(evaluateLossAlert(enabled)).toBeNull();
  });

  test("duplicate frames are NOT loss (idempotency dedupe)", () => {
    const duplicates = buildInput({
      frames: { framesEmitted: 238, framesDuplicate: 2 },
    });
    expect(evaluateLossAlert(duplicates)).toBeNull();
  });

  test("multiple loss paths are enumerated in the message, in a fixed order", () => {
    const alert = evaluateLossAlert(
      buildInput({ frames: { framesEmitted: 237, framesDropped: 1, framesCancelled: 1, framesSkippedStale: 1 } }),
    );
    expect(alert?.message).toContain("dropped 1 + cancelled 1 + skipped-stale 1");
  });
});

describe("the combined evaluation", () => {
  test("latency alerts come in SLO-table order, then the loss alert", () => {
    const input = buildInput({
      batch: { "end-to-end": { p95Ms: 12001 }, "batch-queue": { p50Ms: 26 } },
      frames: { framesEmitted: 239, framesDropped: 1 },
    });
    const alerts = evaluateAlerts(input);
    expect(alerts.map((alert) => alert.alertId)).toEqual([
      "latency.batch.batch-queue.p50.warning",
      "latency.batch.end-to-end.p95.critical",
      "loss.unexpected-frames",
    ]);
  });

  test("determinism: the same input yields the deep-equal alerts, twice", () => {
    const input = buildInput({
      batch: { "end-to-end": { p95Ms: 12001 }, "w303-schedule": { p50Ms: 26 } },
      frames: { framesEmitted: 239, framesCancelled: 1 },
    });
    expect(evaluateAlerts(input)).toEqual(evaluateAlerts(input));
  });
});

describe("SLOs.md §4 ↔ ALERT_CATALOG (the doc pin, both directions)", () => {
  const rows = parseDocAlertRows(DOC);

  test("the document table is present and complete (33 rows)", () => {
    expect(rows).toHaveLength(33);
  });

  test("every document row matches the code row (severity, threshold)", () => {
    expect(rows.map((row) => row.alertId)).toEqual(ALERT_CATALOG.map((alert) => alert.alertId));
    for (const row of rows) {
      const alert = ALERT_CATALOG.find((candidate) => candidate.alertId === row.alertId);
      expect(alert).toBeDefined();
      expect(row.severity).toBe(alert!.severity);
      if (alert!.kind === "latency") {
        expect(row.threshold).toBe(String(alert!.thresholdMs));
      } else {
        expect(row.threshold).toContain("structural");
      }
    }
  });

  test("every code row appears in the document (both directions)", () => {
    const documented = new Set(rows.map((row) => row.alertId));
    for (const alert of ALERT_CATALOG) {
      expect(documented.has(alert.alertId)).toBe(true);
    }
    expect(LOSS_ALERT.alertId).toBe("loss.unexpected-frames");
  });
});
