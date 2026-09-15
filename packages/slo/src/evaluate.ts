/**
 * The W802 SLO COMPLIANCE EVALUATION — one pure function from a latency-SLO
 * input (one compliance window) to the full machine-readable compliance
 * report: every SLO verdict with its evidence, every fired alert, and the
 * window's summary. Deterministic by construction (no clocks, no RNG — the
 * constitution), fail-loud on vocabulary drift (the stage tables are exact).
 *
 * The verdict vocabulary is THREE states, honestly:
 *
 * - `"compliant"` — every SLO met, no alerts;
 * - `"at-risk"` — every SLO met, but ≥1 warning fired (headroom being
 *   consumed — an operator signal, never a release gate);
 * - `"breached"` — ≥1 SLO objective breached OR the loss-integrity alert
 *   fired (the error budget of at least one indicator, or the frame-loss
 *   invariant, is exhausted for the window).
 */
import { SloStageMissingError } from "./errors";
import type { LatencySloInput } from "./input";
import { parseLatencySloInput } from "./input";
import {
  SLO_DEFINITIONS,
  SLO_SET_ID,
  assertSloTableInvariants,
  type SloDefinition,
} from "./slos";
import {
  ALERT_CATALOG_ID,
  evaluateAlerts,
  type FiredAlert,
} from "./alerts";
import { assertPolicyTableInvariants } from "./policies";

/** One SLO's verdict over the window (evidence, not just a boolean). */
export interface SloVerdict {
  readonly sloId: string;
  readonly scope: "batch" | "frame";
  readonly stage: string;
  readonly metric: "p50" | "p95";
  readonly measuredMs: number;
  readonly baselineMs: number;
  readonly targetMs: number;
  readonly allowedExceedanceFraction: number;
  readonly status: "met" | "breached";
}

/** The window's identity (echoed from the input, verbatim). */
export interface SloComplianceWindow {
  readonly clockDomain: "injected-virtual";
  readonly percentileMethod: "nearest-rank";
  readonly fixtureProfileId: string;
  readonly batchSampleCount: number;
  readonly frameSampleCount: number;
}

/** The machine-readable compliance report. */
export interface SloComplianceReport {
  readonly sloSetId: typeof SLO_SET_ID;
  readonly alertCatalogId: typeof ALERT_CATALOG_ID;
  readonly window: SloComplianceWindow;
  readonly verdicts: readonly SloVerdict[];
  readonly alerts: readonly FiredAlert[];
  readonly summary: {
    readonly sloCount: number;
    readonly metCount: number;
    readonly breachedCount: number;
    readonly warningAlertCount: number;
    readonly criticalAlertCount: number;
    readonly verdict: "compliant" | "at-risk" | "breached";
  };
}

/** Reads one SLO's measured value from the input (fail-loud on drift). */
function measuredMsFor(input: LatencySloInput, slo: SloDefinition): number {
  const table = slo.scope === "batch" ? input.stages.batch : input.stages.frame;
  const stats = (table as Record<string, { p50Ms: number; p95Ms: number }>)[slo.stage];
  if (stats === undefined) {
    throw new SloStageMissingError(slo.stage, slo.scope);
  }
  return slo.metric === "p95" ? stats.p95Ms : stats.p50Ms;
}

/**
 * Evaluates SLO compliance over one parsed input window. PURE and
 * deterministic: the same input always yields the deep-equal report. The
 * SLO table + policy table invariants are asserted on every call (a broken
 * table is a construction bug, never a silently-degraded evaluation).
 */
export function evaluateSloCompliance(input: LatencySloInput): SloComplianceReport {
  assertSloTableInvariants();
  assertPolicyTableInvariants();
  const verdicts: SloVerdict[] = SLO_DEFINITIONS.map((slo) => {
    const measuredMs = measuredMsFor(input, slo);
    return {
      sloId: slo.sloId,
      scope: slo.scope,
      stage: slo.stage,
      metric: slo.metric,
      measuredMs,
      baselineMs: slo.baselineMs,
      targetMs: slo.targetMs,
      allowedExceedanceFraction: slo.allowedExceedanceFraction,
      status: measuredMs <= slo.targetMs ? ("met" as const) : ("breached" as const),
    };
  });
  const alerts = evaluateAlerts(input);
  const breachedCount = verdicts.filter((verdict) => verdict.status === "breached").length;
  const criticalAlertCount = alerts.filter((alert) => alert.severity === "critical").length;
  const warningAlertCount = alerts.filter((alert) => alert.severity === "warning").length;
  const verdict =
    breachedCount > 0 || criticalAlertCount > 0
      ? ("breached" as const)
      : warningAlertCount > 0
        ? ("at-risk" as const)
        : ("compliant" as const);
  return {
    sloSetId: SLO_SET_ID,
    alertCatalogId: ALERT_CATALOG_ID,
    window: {
      clockDomain: input.domain.clockDomain,
      percentileMethod: input.domain.percentileMethod,
      fixtureProfileId: input.domain.fixtureProfileId,
      batchSampleCount: input.stages.batch["end-to-end"].count,
      frameSampleCount: input.stages.frame["end-to-end"].count,
    },
    verdicts,
    alerts,
    summary: {
      sloCount: verdicts.length,
      metCount: verdicts.length - breachedCount,
      breachedCount,
      warningAlertCount,
      criticalAlertCount,
      verdict,
    },
  };
}

/**
 * Parses (fail-loud) + evaluates: `evaluateSloComplianceFromValue(JSON.parse(bytes))`.
 */
export function evaluateSloComplianceFromValue(value: unknown): SloComplianceReport {
  return evaluateSloCompliance(parseLatencySloInput(value));
}

/**
 * Renders the deterministic human summary of one compliance report (the
 * W306 `renderHumanSummary` convention: stable text, no clocks, evidence on
 * every line — the CLI prints it to stderr).
 */
export function renderComplianceSummary(report: SloComplianceReport): string {
  const lines: string[] = [];
  lines.push(
    `W802 latency SLO compliance — ${report.sloSetId} (alerts ${report.alertCatalogId})`,
  );
  lines.push(
    `window: ${report.window.fixtureProfileId} (${report.window.clockDomain} clock, ` +
      `${report.window.percentileMethod}) — ${String(report.window.batchSampleCount)} batches, ` +
      `${String(report.window.frameSampleCount)} frames`,
  );
  lines.push("");
  lines.push("SLO verdicts (injected-clock ms):");
  for (const verdict of report.verdicts) {
    lines.push(
      `  ${verdict.sloId.padEnd(34)} measured ${String(verdict.measuredMs).padStart(6)} ms ` +
        `(baseline ${String(verdict.baselineMs).padStart(6)}) <= target ` +
        `${String(verdict.targetMs).padStart(6)}  [${verdict.status}]`,
    );
  }
  lines.push("");
  if (report.alerts.length === 0) {
    lines.push("alerts: none fired");
  } else {
    lines.push(`alerts (${String(report.alerts.length)} fired):`);
    for (const alert of report.alerts) {
      lines.push(`  [${alert.severity}] ${alert.alertId}: ${alert.message}`);
    }
  }
  lines.push("");
  lines.push(
    `summary: ${String(report.summary.metCount)}/${String(report.summary.sloCount)} SLOs met, ` +
      `${String(report.summary.warningAlertCount)} warning(s), ` +
      `${String(report.summary.criticalAlertCount)} critical — verdict ${report.summary.verdict}`,
  );
  return lines.join("\n");
}
