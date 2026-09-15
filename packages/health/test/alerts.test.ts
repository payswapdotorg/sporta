/**
 * The alert catalog pins: zod validity, uniqueness, runbook anchors that
 * exist in PRODUCTION.md, and the doc pin — the catalog table in
 * PRODUCTION.md must list every alert row-for-row (the W503
 * THRESHOLDS.md both-directions precedent).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  ALERT_CATALOG,
  ALERT_SEVERITIES,
  AlertCatalogSchema,
  alertIds,
  findAlert,
} from "../src/alerts";
import {
  findRegistrySeam,
  HEALTH_DOMAIN_IDS,
  HEALTH_DOMAIN_MAP,
  type RegistrySeam,
} from "../src/domains";

const REPO_ROOT = join(dirname(import.meta.dir), "..", "..");
const DOC_PATH = join(REPO_ROOT, "docs", "observability", "PRODUCTION.md");

describe("alert catalog — schema and structure", () => {
  test("the shipped catalog parses against its zod schema", () => {
    expect(() => AlertCatalogSchema.parse(ALERT_CATALOG)).not.toThrow();
  });

  test("alert ids are unique and findable", () => {
    const ids = alertIds(ALERT_CATALOG);
    expect(ids.length).toBe(new Set(ids).size);
    for (const id of ids) {
      expect(findAlert(ALERT_CATALOG, id)?.id).toBe(id);
    }
  });

  test("the catalog size and per-domain coverage are pinned", () => {
    expect(ALERT_CATALOG.alerts).toHaveLength(24);
    // Initialized over ALL domains so the model: 0 pin is explicit — a
    // domain with no alerts must appear as 0, never silently vanish.
    const perDomain: Record<string, number> = Object.fromEntries(
      HEALTH_DOMAIN_IDS.map((domain) => [domain, 0]),
    );
    for (const alert of ALERT_CATALOG.alerts) {
      perDomain[alert.domain] = (perDomain[alert.domain] ?? 0) + 1;
    }
    expect(perDomain).toEqual({
      media: 3,
      queue: 4,
      model: 0, // no seams exist — no alert can honestly be defined (the gap)
      renderer: 4,
      delivery: 5,
      infrastructure: 8,
    });
  });

  test("every expression references a real registry seam of the matching kind", () => {
    for (const alert of ALERT_CATALOG.alerts) {
      const expression = alert.expression;
      const referenced: Array<[string, RegistrySeam["kind"]]> =
        expression.kind === "counter-ratio-above"
          ? [
              [expression.numerator, "counter"],
              [expression.denominator, "counter"],
            ]
          : expression.kind === "counter-above"
            ? [[expression.metric, "counter"]]
            : [[expression.metric, "histogram"]];
      for (const [metricName, expectedKind] of referenced) {
        const seam = findRegistrySeam(HEALTH_DOMAIN_MAP, metricName);
        expect(seam, `alert ${alert.id}: seam ${metricName}`).toBeDefined();
        expect(seam!.kind, `alert ${alert.id}: seam ${metricName} kind`).toBe(expectedKind);
      }
    }
  });

  test("exactly two latency alerts exist, both W306-derived and metric-generic", () => {
    const latencyAlerts = ALERT_CATALOG.alerts.filter(
      (alert) =>
        alert.expression.kind === "histogram-p95-above" ||
        alert.expression.kind === "histogram-p50-above",
    );
    expect(latencyAlerts.map((alert) => alert.id).sort()).toEqual([
      "queue-gpu-queue-wait-p95",
      "renderer-gpu-job-latency-p95",
    ]);
    for (const alert of latencyAlerts) {
      expect(alert.derivation).toContain("W306");
      // metric-generic: the seam, never a sibling worktree's internals
      expect(alert.derivation).not.toContain("@sporta/slo");
    }
  });

  test("severities are from the closed vocabulary; the only critical alert is delivery", () => {
    const critical = ALERT_CATALOG.alerts.filter((alert) => alert.severity === "critical");
    expect(critical.map((alert) => alert.id)).toEqual(["delivery-windows-failed"]);
    for (const alert of ALERT_CATALOG.alerts) {
      expect((ALERT_SEVERITIES as readonly string[]).includes(alert.severity)).toBe(true);
    }
  });
});

describe("alert catalog — doc pins (PRODUCTION.md matches the catalog)", () => {
  const doc = readFileSync(DOC_PATH, "utf8");

  test("the catalog table lists every alert row-for-row (id, domain, severity, expression)", () => {
    const tableIndex = doc.indexOf("### The catalog table");
    expect(tableIndex).toBeGreaterThanOrEqual(0);
    const after = doc.slice(tableIndex);
    // The next heading of level >= 2 ends the section (a `\n# `-only search
    // matches H1 alone, which never recurs — the section then spills into
    // §4-§10 and swallows the rollup truth-table rows as fake alerts).
    const nextHeading = after.slice(1).search(/\n#{2,6} /);
    const section = nextHeading < 0 ? after : after.slice(0, nextHeading + 1);
    const rows = section
      .split("\n")
      .filter(
        (line) => line.startsWith("| ") && !line.startsWith("| id ") && !/^\|[-\s|]+\|$/.test(line),
      )
      .map((line) =>
        line
          .slice(1, -1)
          .split("|")
          .map((cell) => cell.trim()),
      );
    expect(rows.length, "the doc table and the catalog must have the same row count").toBe(
      ALERT_CATALOG.alerts.length,
    );
    expect(rows.map((row) => row[0])).toEqual(ALERT_CATALOG.alerts.map((alert) => alert.id));
    expect(rows.map((row) => row[1])).toEqual(ALERT_CATALOG.alerts.map((alert) => alert.domain));
    expect(rows.map((row) => row[2])).toEqual(ALERT_CATALOG.alerts.map((alert) => alert.severity));
    expect(rows.map((row) => row[3])).toEqual(ALERT_CATALOG.alerts.map((alert) => alert.summary));
  });

  test("every alert's runbook section exists in PRODUCTION.md", () => {
    for (const alert of ALERT_CATALOG.alerts) {
      const heading = `### Runbook: ${alert.id}`;
      expect(
        doc.includes(heading),
        `PRODUCTION.md is missing the runbook section "${heading}"`,
      ).toBe(true);
      expect(alert.runbook).toBe(`docs/observability/PRODUCTION.md#runbook-${alert.id}`);
    }
  });
});
