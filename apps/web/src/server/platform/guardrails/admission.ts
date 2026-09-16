/**
 * FAIL-CLOSED PROVIDER-CAPACITY ADMISSION (W919) — the guardrail rung the
 * studio's dispatch ladder gains BEFORE the provider is asked to run an
 * expensive job (Simulation E: stop admitting before the hard failure).
 *
 * Checked at admission (per the ledger's `admissionEnforced` flags):
 *
 * - PER-USER: the daily metered-compute quotas (`compute.cpu-ms-day`,
 *   `compute.artifact-bytes-day`) — the dispatching user's already-metered
 *   usage for today;
 * - GLOBAL: the R2 storage allowance (`r2.storage-bytes` — a new job stores
 *   more bytes; at the allowance the store would hard-fail) and the Upstash
 *   command budget (`upstash.commands` — the shared admission state itself
 *   is out of budget);
 * - Neon storage is metered and ALARMED but not admission-enforced (render
 *   jobs do not write to Neon); the queue's own hard depth bound stays the
 *   W913 rung it already was.
 *
 * FAIL-CLOSED: an admission-enforced counter that cannot be READ refuses
 * admission with the `limit-check-unreadable` reason (unreadable capacity
 * admits no new work — the same posture as the W913 quota guard).
 *
 * The refusal carries the REAL reason: the limit id, the provider, the
 * measured usage vs the threshold, and the window the retry-after hints at.
 * EXISTING AUTHORIZED PLAYBACK IS UNAFFECTED (Simulation E's last rule): the
 * check runs on the dispatch path only — watch/playback routes never consult
 * it.
 */

import type { LimitEvaluation } from "./ledger";

/** The refusal's scope: whose capacity ran out. */
export type AdmissionRefusalScope = "user" | "provider";

/** Why admission was refused (the closed reason vocabulary). */
export type AdmissionRefusalReason =
  | "limit-reached"
  | "limit-exceeded"
  | "limit-check-unreadable";

/** Seconds until the next UTC midnight (min 1 — an honest hint). */
export function secondsUntilNextUtcDay(nowMs: number): number {
  const dayMs = 24 * 3600 * 1000;
  const intoDay = ((nowMs % dayMs) + dayMs) % dayMs;
  return Math.max(1, Math.ceil((dayMs - intoDay) / 1000));
}

/** Seconds until the next UTC month start (min 1 — an honest hint). */
export function secondsUntilNextUtcMonth(nowMs: number): number {
  const now = new Date(nowMs);
  const nextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  return Math.max(1, Math.ceil((nextMonth.getTime() - nowMs) / 1000));
}

/** The retry-after for one limit's window (stocks re-observe — 60s hint). */
export function admissionRetryAfterSeconds(
  window: "calendar-day" | "calendar-month" | "stock",
  nowMs: number,
): number {
  if (window === "calendar-day") return secondsUntilNextUtcDay(nowMs);
  if (window === "calendar-month") return secondsUntilNextUtcMonth(nowMs);
  return 60;
}

/**
 * The typed provider-capacity refusal (HTTP 503 + Retry-After): capacity,
 * not the caller's fault — but with the real reason attached.
 */
export class ProviderCapacityLimitError extends Error {
  readonly status = 503;
  readonly failureClass = "capacity-exceeded";
  readonly scope: AdmissionRefusalScope;
  readonly reasonCode: AdmissionRefusalReason;
  readonly evaluation: LimitEvaluation;
  readonly retryAfterSeconds: number;

  constructor(input: {
    scope: AdmissionRefusalScope;
    reasonCode: AdmissionRefusalReason;
    evaluation: LimitEvaluation;
    retryAfterSeconds: number;
  }) {
    const { evaluation } = input;
    const usageLine =
      input.reasonCode === "limit-check-unreadable"
        ? "usage could not be read (fail-closed: unreadable capacity admits no new work)"
        : `${evaluation.used} of ${evaluation.limit} ${evaluation.unit}`;
    super(
      input.scope === "user"
        ? `admission refused: the per-user limit '${evaluation.limitId}' is ${evaluation.state} for this window (${usageLine})`
        : `admission refused: the provider limit '${evaluation.limitId}' is ${evaluation.state} (${usageLine}) — the refusal precedes the provider's own hard failure`,
    );
    this.name = "ProviderCapacityLimitError";
    this.scope = input.scope;
    this.reasonCode = input.reasonCode;
    this.evaluation = evaluation;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }
}
