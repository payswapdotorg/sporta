/**
 * THE SPEND ALARMS (W919) — threshold-crossing alerts over the limit
 * ledger's evaluations, with the alarm STATE persisted window-scoped in the
 * Upstash port (so a crossed limit stays visible across instances and
 * restarts until its window rolls, with the in-memory fallback's honest
 * per-instance boundary).
 *
 * Transitions (the only recorded events — a stable state re-observed writes
 * nothing):
 *
 *   under → approaching   (the WARNING: usage crossed the warning ratio)
 *   *     → reached       (usage hit the limit — the degraded state)
 *   *     → exceeded      (usage passed the limit)
 *   *     → under         (recovery — the window rolled or usage was freed)
 *
 * Evaluation is OBSERVATION-DRIVEN (there is no background scheduler on a
 * serverless host — documented honestly): alarms are evaluated wherever the
 * guardrail state is observed — the capability response builds, the
 * operations console reads, and the admission checks — so every surface that
 * shows a limit state has already recorded the transition it implies.
 */

import type { RedisLike } from "../upstash/redis";
import type { LimitEvaluation, LimitUsageState } from "./ledger";

/** One persisted alarm state (window-scoped). */
export interface PersistedAlarmState {
  limitId: string;
  state: LimitUsageState;
  used: number | null;
  changedAtMs: number;
}

/** The evaluated result of one alarm observation. */
export interface AlarmEvaluation {
  limitId: string;
  provider: string;
  state: LimitUsageState;
  used: number | null;
  limit: number;
  changedAtMs: number;
  /** True when THIS observation changed the persisted state (a transition). */
  transitioned: boolean;
  /** The state before this observation (null on first observation). */
  previousState: LimitUsageState | null;
}

/** TTL for a daily alarm (a week — matches the daily counter TTL). */
const DAILY_ALARM_TTL_SECONDS = 7 * 24 * 3600;

/** TTL for a monthly alarm (a year — matches the monthly counter TTL). */
const MONTHLY_ALARM_TTL_SECONDS = 366 * 24 * 3600;

/** TTL for a stock alarm (a month — stocks re-observe constantly). */
const STOCK_ALARM_TTL_SECONDS = 31 * 24 * 3600;

/** The alarm key for one limit + window key. */
export function alarmKey(limitId: string, windowKey: string): string {
  return `alarm:${limitId}:${windowKey}`;
}

/** The TTL for one limit's alarm state (matches its counter window). */
export function alarmTtlSeconds(window: LimitEvaluation["window"]): number {
  if (window === "calendar-day") return DAILY_ALARM_TTL_SECONDS;
  if (window === "calendar-month") return MONTHLY_ALARM_TTL_SECONDS;
  return STOCK_ALARM_TTL_SECONDS;
}

/** Parses a persisted alarm record (null when absent/corrupt). */
function parseAlarm(raw: string | null): PersistedAlarmState | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedAlarmState>;
    if (
      typeof parsed.limitId === "string" &&
      typeof parsed.state === "string" &&
      typeof parsed.changedAtMs === "number" &&
      (parsed.used === null || typeof parsed.used === "number")
    ) {
      return {
        limitId: parsed.limitId,
        state: parsed.state,
        used: parsed.used ?? null,
        changedAtMs: parsed.changedAtMs,
      };
    }
  } catch {
    // Corrupt alarm record: treated as absent (the current evaluation
    // re-writes it — never silently trusted).
  }
  return null;
}

/**
 * Observes one evaluation against its persisted alarm state: records the
 * transition when the state changed (or on first observation), and returns
 * the alarm view either way.
 */
export async function observeAlarm(
  redis: RedisLike,
  evaluation: LimitEvaluation,
  windowKey: string,
  nowMs: number,
): Promise<AlarmEvaluation> {
  const key = alarmKey(evaluation.limitId, windowKey);
  let raw: string | null = null;
  try {
    raw = await redis.get(key);
  } catch {
    raw = null;
  }
  const persisted = parseAlarm(raw);
  const previousState = persisted?.state ?? null;
  const transitioned = previousState !== evaluation.state;
  if (transitioned) {
    const record: PersistedAlarmState = {
      limitId: evaluation.limitId,
      state: evaluation.state,
      used: evaluation.used,
      changedAtMs: nowMs,
    };
    try {
      await redis.set(key, JSON.stringify(record), {
        ex: alarmTtlSeconds(evaluation.window),
      });
    } catch {
      // The persisted state could not be written: the alarm is still
      // returned for THIS observation; the next one retries the write.
    }
  }
  return {
    limitId: evaluation.limitId,
    provider: evaluation.provider,
    state: evaluation.state,
    used: evaluation.used,
    limit: evaluation.limit,
    changedAtMs: transitioned ? nowMs : (persisted?.changedAtMs ?? nowMs),
    transitioned,
    previousState,
  };
}
