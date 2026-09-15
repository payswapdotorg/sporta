/**
 * The W802 ALERT CATALOG — the machine-readable threshold definitions with
 * severity tiers, and the pure evaluation that decides which alerts fire over
 * one latency-SLO input (one compliance window = one benchmark run).
 *
 * ## The two families
 *
 * - **latency alerts** (two per SLO): the severity tiers of one indicator.
 *   - `…warning` — "headroom half-consumed": the measured percentile exceeds
 *     `ceil(baseline + (target − baseline) / 2)` while the objective still
 *     holds. An early operator signal: the documented headroom between the
 *     W306 evidence baseline and the objective is being eaten.
 *   - `…critical` — "objective breached": the measured percentile exceeds
 *     the objective target; the indicator's error budget for the window is
 *     exhausted. Per SLO only the HIGHEST applicable severity fires
 *     (critical subsumes warning) — one row per indicator, never noise.
 * - **loss.unexpected-frames** (critical, one definition): the never-silent
 *   accounting made operational — frames that left the pipeline without being
 *   emitted (dropped, cancelled, or skipped-stale while the degradation was
 *   disabled), calibrated to the W306 baseline run where every one of those
 *   counters measured ZERO. Duplicate frames are NOT loss (the idempotency
 *   dedupe is correct behavior — the first instance was emitted).
 *
 * Every threshold is either adopted verbatim from the W306 candidate table
 * (the objectives) or DERIVED from it by a documented formula (the warning
 * midpoints) — no judgment calls, no unexplained numbers. SLOs.md §Alert
 * catalog mirrors this table and is pinned row-for-row by
 * `test/alerts.test.ts` (the W503 THRESHOLDS.md both-directions convention).
 */
import { SloStageMissingError } from "./errors";
import type { LatencySloInput } from "./input";
import { SLO_DEFINITIONS, assertSloTableInvariants, type SloDefinition } from "./slos";

/** The alert catalog's identity (echoed by every compliance evaluation). */
export const ALERT_CATALOG_ID = "w802-alerts-v1";

export type AlertSeverity = "warning" | "critical";
export type AlertKind = "latency" | "loss";

/** One latency alert threshold (the executable catalog row). */
export interface LatencyAlertDefinition {
  /** Stable machine-readable id, e.g. `"latency.batch.swm-to-batch.p95.critical"`. */
  readonly alertId: string;
  readonly kind: "latency";
  readonly severity: AlertSeverity;
  /** The SLO this alert watches (must exist — consistency-checked by tests). */
  readonly sloId: string;
  /** The firing threshold, injected-clock ms (`measured > threshold` fires). */
  readonly thresholdMs: number;
  readonly comparator: "greater-than";
  readonly derivation: string;
}

/** The loss-integrity alert (the never-silent accounting made operational). */
export interface LossAlertDefinition {
  readonly alertId: "loss.unexpected-frames";
  readonly kind: "loss";
  readonly severity: "critical";
  readonly derivation: string;
}

/** The warning threshold of one SLO: half the documented headroom, ceil'd. */
export function warnThresholdMs(slo: SloDefinition): number {
  return Math.ceil(slo.baselineMs + (slo.targetMs - slo.baselineMs) / 2);
}

/** Builds one SLO's two alert rows (warning + critical), derivation included. */
function latencyAlertsForSlo(slo: SloDefinition): readonly LatencyAlertDefinition[] {
  const warningThreshold = warnThresholdMs(slo);
  return [
    {
      alertId: `latency.${slo.sloId}.warning`,
      kind: "latency",
      severity: "warning",
      sloId: slo.sloId,
      thresholdMs: warningThreshold,
      comparator: "greater-than",
      derivation:
        `headroom half-consumed: ceil(baseline ${String(slo.baselineMs)} ms + ` +
        `(target ${String(slo.targetMs)} ms − baseline) / 2) = ${String(warningThreshold)} ms — ` +
        "fires while the objective still holds (an early operator signal, never a verdict)",
    },
    {
      alertId: `latency.${slo.sloId}.critical`,
      kind: "latency",
      severity: "critical",
      sloId: slo.sloId,
      thresholdMs: slo.targetMs,
      comparator: "greater-than",
      derivation:
        `objective breach: measured ${slo.metric} > target ${String(slo.targetMs)} ms — the ` +
        `indicator's error budget (${String(slo.allowedExceedanceFraction * 100)}% of window ` +
        "samples permitted above the target) is exhausted",
    },
  ];
}

/** The latency alert rows, in SLO-table order (warning then critical per SLO). */
export const LATENCY_ALERTS: readonly LatencyAlertDefinition[] =
  SLO_DEFINITIONS.flatMap(latencyAlertsForSlo);

/** The one loss-integrity alert. */
export const LOSS_ALERT: LossAlertDefinition = {
  alertId: "loss.unexpected-frames",
  kind: "loss",
  severity: "critical",
  derivation:
    "calibrated to the W306 baseline run (backpressure block, skip-stale disabled): measured " +
    "dropped = 0, cancelled = 0, skipped-stale = 0 — any occurrence is a structural loss " +
    "(queue refusal/eviction, reorder overflow, render failure, mid-run stop). Skipped-stale " +
    "counts as loss ONLY while the degradation is disabled: under an enabled skip-stale " +
    "policy the skipping is the deliberate, accounted trade (W304). Duplicate frames are NOT " +
    "loss (idempotency dedupe — the first instance was emitted)",
};

/** The full catalog (latency rows in SLO order, then the loss row). */
export const ALERT_CATALOG: readonly (LatencyAlertDefinition | LossAlertDefinition)[] = [
  ...LATENCY_ALERTS,
  LOSS_ALERT,
];

/** One fired latency alert (evidence, not just a boolean). */
export interface FiredLatencyAlert {
  readonly alertId: string;
  readonly kind: "latency";
  readonly severity: AlertSeverity;
  readonly sloId: string;
  readonly measuredMs: number;
  readonly thresholdMs: number;
  readonly message: string;
}

/** The fired loss alert (the counted losses, verbatim). */
export interface FiredLossAlert {
  readonly alertId: "loss.unexpected-frames";
  readonly kind: "loss";
  readonly severity: "critical";
  readonly lostFrames: {
    readonly dropped: number;
    readonly cancelled: number;
    readonly skippedStale: number;
  };
  readonly degradationKind: "disabled" | "skip-stale";
  readonly message: string;
}

export type FiredAlert = FiredLatencyAlert | FiredLossAlert;

/** Reads one stage's stats from the input (fail-loud on vocabulary drift). */
function stageStats(input: LatencySloInput, slo: SloDefinition): { p50Ms: number; p95Ms: number } {
  const table = slo.scope === "batch" ? input.stages.batch : input.stages.frame;
  const stats = (table as Record<string, { p50Ms: number; p95Ms: number }>)[slo.stage];
  if (stats === undefined) {
    throw new SloStageMissingError(slo.stage, slo.scope);
  }
  return stats;
}

/**
 * Evaluates the latency alerts over one input (one compliance window). PURE
 * and deterministic: the same input always yields the same fired alerts, in
 * SLO-table order. Per SLO only the highest applicable severity fires
 * (critical subsumes warning). The SLO table's own invariants are asserted
 * first — a broken table is a construction bug, never a silently-degraded
 * evaluation.
 */
export function evaluateLatencyAlerts(input: LatencySloInput): FiredLatencyAlert[] {
  assertSloTableInvariants();
  const fired: FiredLatencyAlert[] = [];
  for (const slo of SLO_DEFINITIONS) {
    const stats = stageStats(input, slo);
    const measuredMs = slo.metric === "p95" ? stats.p95Ms : stats.p50Ms;
    if (measuredMs > slo.targetMs) {
      fired.push({
        alertId: `latency.${slo.sloId}.critical`,
        kind: "latency",
        severity: "critical",
        sloId: slo.sloId,
        measuredMs,
        thresholdMs: slo.targetMs,
        message:
          `SLO objective breached: ${slo.sloId} measured ${String(measuredMs)} ms > target ` +
          `${String(slo.targetMs)} ms — the error budget ` +
          `(${String(slo.allowedExceedanceFraction * 100)}% of window samples permitted above ` +
          "the target) is exhausted for this window",
      });
    } else if (measuredMs > warnThresholdMs(slo)) {
      fired.push({
        alertId: `latency.${slo.sloId}.warning`,
        kind: "latency",
        severity: "warning",
        sloId: slo.sloId,
        measuredMs,
        thresholdMs: warnThresholdMs(slo),
        message:
          `latency headroom half-consumed: ${slo.sloId} measured ${String(measuredMs)} ms > ` +
          `warning threshold ${String(warnThresholdMs(slo))} ms (objective ` +
          `${String(slo.targetMs)} ms still met)`,
      });
    }
  }
  return fired;
}

/**
 * Evaluates the loss-integrity alert over one input. PURE. Fires iff any
 * frames left the pipeline without being emitted through a loss path that
 * was not the enabled degradation's deliberate trade.
 */
export function evaluateLossAlert(input: LatencySloInput): FiredLossAlert | null {
  const frames = input.accounting.frames;
  const degradationKind = input.pipeline.degradation.kind;
  const dropped = frames.framesDropped;
  const cancelled = frames.framesCancelled;
  const skippedStale = frames.framesSkippedStale;
  const unexpectedSkips = degradationKind === "disabled" ? skippedStale : 0;
  const lost = dropped + cancelled + unexpectedSkips;
  if (lost === 0) {
    return null;
  }
  const parts: string[] = [];
  if (dropped > 0) parts.push(`dropped ${String(dropped)}`);
  if (cancelled > 0) parts.push(`cancelled ${String(cancelled)}`);
  if (unexpectedSkips > 0) {
    parts.push(`skipped-stale ${String(unexpectedSkips)} (degradation disabled)`);
  }
  return {
    alertId: "loss.unexpected-frames",
    kind: "loss",
    severity: "critical",
    lostFrames: { dropped, cancelled, skippedStale: unexpectedSkips },
    degradationKind,
    message:
      `unexpected frame loss in the window: ${parts.join(" + ")} — frames never emitted; ` +
      "triage the degradation playbook (SLOs.md §Degradation playbook); the orchestrator's " +
      "own counters localize the loss path",
  };
}

/** Evaluates the full catalog over one input: latency alerts, then the loss alert. */
export function evaluateAlerts(input: LatencySloInput): FiredAlert[] {
  const fired: FiredAlert[] = [...evaluateLatencyAlerts(input)];
  const loss = evaluateLossAlert(input);
  if (loss !== null) {
    fired.push(loss);
  }
  return fired;
}
