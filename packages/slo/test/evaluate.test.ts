/**
 * The compliance-evaluation tests: the window verdicts (compliant / at-risk /
 * breached), the summary accounting, the window echo, the fail-loud stage
 * guard, the from-bytes entry point, and the deterministic human summary.
 */
import { describe, expect, test } from "bun:test";
import {
  evaluateSloCompliance,
  evaluateSloComplianceFromValue,
  renderComplianceSummary,
} from "../src/evaluate";
import { parseLatencySloInput, projectBenchmarkReport } from "../src/input";
import { SloStageMissingError } from "../src/errors";
import { ALERT_CATALOG_ID, SLO_SET_ID } from "../src/index";
import { buildInput, buildStructuralReport } from "./helpers";

describe("the compliant window (the W306 baseline)", () => {
  test("16/16 met, zero alerts, verdict compliant", () => {
    const report = evaluateSloCompliance(buildInput());
    expect(report.summary).toEqual({
      sloCount: 16,
      metCount: 16,
      breachedCount: 0,
      warningAlertCount: 0,
      criticalAlertCount: 0,
      verdict: "compliant",
    });
    expect(report.alerts).toEqual([]);
  });

  test("every verdict carries the evidence row (measured == the W306 baseline)", () => {
    const report = evaluateSloCompliance(buildInput());
    for (const verdict of report.verdicts) {
      expect(verdict.status).toBe("met");
      expect(verdict.measuredMs).toBe(verdict.baselineMs);
      expect(verdict.targetMs).toBeGreaterThanOrEqual(verdict.measuredMs);
    }
  });

  test("the window echoes the input identity (domain, fixture, sample counts)", () => {
    const window = evaluateSloCompliance(buildInput()).window;
    expect(window).toEqual({
      clockDomain: "injected-virtual",
      percentileMethod: "nearest-rank",
      fixtureProfileId: "w306-live-fixture",
      batchSampleCount: 140,
      frameSampleCount: 240,
    });
  });

  test("the report carries the set/catalog identities", () => {
    const report = evaluateSloCompliance(buildInput());
    expect(report.sloSetId).toBe(SLO_SET_ID);
    expect(report.alertCatalogId).toBe(ALERT_CATALOG_ID);
  });
});

describe("the at-risk window (warnings, no breach)", () => {
  test("one warning: verdict at-risk, SLOs still all met", () => {
    const report = evaluateSloCompliance(
      buildInput({ batch: { "w303-schedule": { p95Ms: 5001 } } }),
    );
    expect(report.summary.verdict).toBe("at-risk");
    expect(report.summary.breachedCount).toBe(0);
    expect(report.summary.warningAlertCount).toBe(1);
    expect(report.summary.criticalAlertCount).toBe(0);
    expect(report.alerts.map((alert) => alert.alertId)).toEqual([
      "latency.batch.w303-schedule.p95.warning",
    ]);
  });
});

describe("the breached window (objective breach)", () => {
  test("one objective breach: verdict breached, the critical fires, the SLO is not met", () => {
    const report = evaluateSloCompliance(buildInput({ frame: { "end-to-end": { p95Ms: 12501 } } }));
    expect(report.summary.verdict).toBe("breached");
    expect(report.summary.breachedCount).toBe(1);
    expect(report.summary.metCount).toBe(15);
    const breached = report.verdicts.find((verdict) => verdict.status === "breached");
    expect(breached).toBeDefined();
    expect(breached!.sloId).toBe("frame.end-to-end.p95");
    expect(breached!.measuredMs).toBe(12501);
    expect(breached!.targetMs).toBe(12500);
    expect(report.alerts.map((alert) => alert.alertId)).toEqual([
      "latency.frame.end-to-end.p95.critical",
    ]);
  });

  test("multiple breaches accumulate honestly (count + alerts)", () => {
    const report = evaluateSloCompliance(
      buildInput({
        batch: { "swm-to-batch": { p50Ms: 251 }, "end-to-end": { p95Ms: 20000 } },
      }),
    );
    expect(report.summary.breachedCount).toBe(2);
    expect(report.summary.criticalAlertCount).toBe(2);
    expect(report.alerts.map((alert) => alert.alertId)).toEqual([
      "latency.batch.swm-to-batch.p50.critical",
      "latency.batch.end-to-end.p95.critical",
    ]);
  });
});

describe("the breached window (loss invariant, all SLOs met)", () => {
  test("frame loss breaches the window even with 16/16 SLOs met", () => {
    const report = evaluateSloCompliance(
      buildInput({ frames: { framesEmitted: 238, framesDropped: 2 } }),
    );
    expect(report.summary.breachedCount).toBe(0);
    expect(report.summary.criticalAlertCount).toBe(1);
    expect(report.summary.verdict).toBe("breached");
    expect(report.alerts.map((alert) => alert.alertId)).toEqual(["loss.unexpected-frames"]);
  });
});

describe("fail-loud paths", () => {
  test("a missing stage in a smuggled input fails loud (vocabulary lockstep)", () => {
    const smuggled = buildInput();
    delete (smuggled.stages.batch as Record<string, unknown>)["swm-to-batch"];
    expect(() => evaluateSloCompliance(smuggled)).toThrow(SloStageMissingError);
  });

  test("the from-value entry parses + evaluates (JSON bytes → verdict)", () => {
    const projected = projectBenchmarkReport(buildStructuralReport());
    const report = evaluateSloComplianceFromValue(JSON.parse(JSON.stringify(projected)));
    expect(report.summary.verdict).toBe("compliant");
  });

  test("the from-value entry fails loud on garbage (never a partial report)", () => {
    expect(() => evaluateSloComplianceFromValue({ inputSchema: "nope" })).toThrow();
  });
});

describe("determinism + the human summary", () => {
  test("the same input yields the deep-equal report, twice", () => {
    const input = buildInput({ batch: { "batch-queue": { p95Ms: 701 } } });
    expect(evaluateSloCompliance(input)).toEqual(evaluateSloCompliance(input));
  });

  test("the summary renders every SLO row, the alerts, and the verdict", () => {
    const clean = renderComplianceSummary(evaluateSloCompliance(buildInput()));
    expect(clean).toContain("W802 latency SLO compliance");
    expect(clean).toContain("verdict compliant");
    expect(clean).toContain("16/16 SLOs met");
    expect(clean).toContain("alerts: none fired");
    expect(clean).toContain("batch.end-to-end.p95");
    expect(clean).toContain("frame.swm-store-sojourn.p95");

    const breached = renderComplianceSummary(
      evaluateSloCompliance(buildInput({ batch: { "end-to-end": { p95Ms: 20000 } } })),
    );
    expect(breached).toContain("verdict breached");
    expect(breached).toContain("[critical] latency.batch.end-to-end.p95.critical");
  });

  test("parse → project → evaluate composes with the parser in the loop", () => {
    const projected = projectBenchmarkReport(buildStructuralReport());
    const parsed = parseLatencySloInput(projected);
    expect(evaluateSloCompliance(parsed).summary.verdict).toBe("compliant");
  });
});
