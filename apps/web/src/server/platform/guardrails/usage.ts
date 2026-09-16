/**
 * THE PROVIDER USAGE METER (W919) — per-provider usage records with windows
 * (daily per-user + calendar-month global), aggregated from REAL seams only
 * and persisted through the Upstash port (the `RedisLike`; in-memory
 * fallback with the honest per-instance boundary — same posture as W913).
 *
 * SEAMS METERED HERE (nothing is fabricated):
 *
 * - COMPUTE: the compute adapter's per-job usage records (cpu-ms /
 *   render-requests / artifact-bytes — the W914 metering the studio notes at
 *   the terminal poll seam, attributed to the dispatching user). The counter
 *   keys are per-user per-calendar-day: the admission quotas' windows.
 * - UPSTASH COMMANDS: `MeteredRedis` counts EVERY command this application
 *   issues through the port (get/set/del/incr/expire/rpush/lrem/ltrim/
 *   lrange/llen/ping), buffered in-process and flushed into the shared
 *   calendar-month counter. The flush's own commands are counted too (they
 *   are real commands) — each flush adds exactly its own GET+SET, so the
 *   counter converges instead of runaway-inflating.
 *
 * NOT metered here (honest `unmeasured` in the ledger): R2 Class A/B
 * operations (no counter at the store seam), Upstash data bytes (no INFO over
 * the REST port), Neon CU-hours (no counter over our seam). R2 stored bytes
 * and Neon storage are STOCKS read live by the guardrails snapshot, not
 * windowed counters.
 *
 * PERSISTENCE BOUNDARY (documented): the port exposes INCR (+1) but no
 * INCRBY, and per-command INCRs would double command usage for the counter
 * they maintain — so multi-unit writes (job usage, command flushes) are
 * read-modify-write SETs keyed by the exact window. Two concurrent writers
 * can interleave and undercount (last-write-wins); with the in-memory
 * fallback the counters are per-instance anyway. Admission stays fail-closed
 * regardless: an UNREADABLE counter refuses (never a stale zero).
 */

import type { RedisLike } from "../upstash/redis";

/** The wall-clock reading a window key is derived from. */
export interface UsageClock {
  nowMs(): number;
}

/** UTC calendar-day key (`YYYY-MM-DD`) for the daily windows. */
export function calendarDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** UTC calendar-month key (`YYYY-MM`) for the monthly windows. */
export function calendarMonthKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

/** TTL for daily counters (a week of history, then they expire). */
export const DAILY_COUNTER_TTL_SECONDS = 7 * 24 * 3600;

/** TTL for monthly counters (a year of history, then they expire). */
export const MONTHLY_COUNTER_TTL_SECONDS = 366 * 24 * 3600;

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** The per-user daily compute-usage counter key (one per unit). */
export function userDailyUsageKey(unitId: string, userId: string, dayKey: string): string {
  return `usage:compute:${unitId}:user:${userId}:d:${dayKey}`;
}

/** The global monthly command counter key. */
export function monthlyCommandsKey(monthKey: string): string {
  return `usage:upstash:commands:global:m:${monthKey}`;
}

// ---------------------------------------------------------------------------
// Reads / writes (read-modify-write SET — see module docs for the boundary)
// ---------------------------------------------------------------------------

/** Adds `delta` to a numeric counter key (creating it), re-arming the TTL. */
export async function addToCounter(
  redis: RedisLike,
  key: string,
  delta: number,
  ttlSeconds: number,
): Promise<void> {
  if (delta <= 0) return;
  const raw = await redis.get(key);
  const current = raw === null ? 0 : Number(raw);
  const base = Number.isFinite(current) && current >= 0 ? current : 0;
  await redis.set(key, String(base + delta), { ex: ttlSeconds });
}

/**
 * Reads a counter. Absent key = null (zero usage so far). A failed read or
 * a corrupt value THROWS (unreadable — the caller decides fail-closed
 * behavior; an unreadable counter must never masquerade as zero).
 */
export async function readCounter(redis: RedisLike, key: string): Promise<number | null> {
  const raw = await redis.get(key);
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`counter '${key}' holds a non-numeric value ('${raw}')`);
  }
  return parsed;
}

/** Writes a counter to an absolute value (the flush path), re-arming the TTL. */
export async function writeCounter(
  redis: RedisLike,
  key: string,
  value: number,
  ttlSeconds: number,
): Promise<void> {
  await redis.set(key, String(value), { ex: ttlSeconds });
}

// ---------------------------------------------------------------------------
// MeteredRedis — the command-counting wrapper over the port
// ---------------------------------------------------------------------------

/**
 * A `RedisLike` decorator that counts every command issued through it. The
 * composition's queue/quota/cache objects issue their commands through this
 * wrapper, so the counted volume IS the command usage this application
 * generates (with the in-memory fallback, the volume it WOULD generate on
 * Upstash — the honest per-instance note the health surfaces).
 */
export class MeteredRedis implements RedisLike {
  readonly #inner: RedisLike;
  readonly #onCommand: () => void;

  constructor(inner: RedisLike, onCommand: () => void) {
    this.#inner = inner;
    this.#onCommand = onCommand;
  }

  /** The wrapped backing (for callers that must bypass counting — none today). */
  get inner(): RedisLike {
    return this.#inner;
  }

  async get(key: string): Promise<string | null> {
    this.#onCommand();
    return this.#inner.get(key);
  }

  async set(key: string, value: string, opts?: { ex?: number }): Promise<"OK" | null> {
    this.#onCommand();
    return this.#inner.set(key, value, opts);
  }

  async del(key: string): Promise<number> {
    this.#onCommand();
    return this.#inner.del(key);
  }

  async incr(key: string): Promise<number> {
    this.#onCommand();
    return this.#inner.incr(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.#onCommand();
    return this.#inner.expire(key, seconds);
  }

  async rpush(key: string, value: string): Promise<number> {
    this.#onCommand();
    return this.#inner.rpush(key, value);
  }

  async lrem(key: string, count: number, value: string): Promise<number> {
    this.#onCommand();
    return this.#inner.lrem(key, count, value);
  }

  async ltrim(key: string, start: number, stop: number): Promise<"OK" | null> {
    this.#onCommand();
    return this.#inner.ltrim(key, start, stop);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    this.#onCommand();
    return this.#inner.lrange(key, start, stop);
  }

  async llen(key: string): Promise<number> {
    this.#onCommand();
    return this.#inner.llen(key);
  }

  async ping(): Promise<"PONG" | null> {
    this.#onCommand();
    return this.#inner.ping();
  }
}

// ---------------------------------------------------------------------------
// The command buffer (flushed through the port — see module docs)
// ---------------------------------------------------------------------------

/** How many buffered commands trigger an immediate flush. */
export const COMMAND_FLUSH_THRESHOLD = 64;

/**
 * The in-process command buffer. Commands are counted per call and flushed
 * to the shared monthly counter every {@link COMMAND_FLUSH_THRESHOLD} and on
 * every snapshot (a crash can lose at most the unflushed buffer — honest,
 * bounded, and the flushed part survives in the shared backing).
 */
export class CommandCounter {
  #buffered = 0;
  #lastFlushedTotal = 0;

  /** Counts one issued command. */
  note(): void {
    this.#buffered += 1;
  }

  /** Commands counted since the last flush. */
  get buffered(): number {
    return this.#buffered;
  }

  /**
   * Flushes the buffer into the monthly counter, returning the counter's new
   * absolute value (the caller's usage read follows the same write).
   */
  async flush(
    redis: RedisLike,
    monthKey: string,
    nowMs: number,
  ): Promise<{ total: number; flushed: number } | null> {
    const key = monthlyCommandsKey(monthKey);
    let current: number | null;
    try {
      current = await readCounter(redis, key);
    } catch {
      // Unreadable shared counter: keep the buffer (retry on the next
      // observation) and report no total — never a fabricated zero.
      return null;
    }
    // An absent key is a legitimate zero (no commands persisted yet).
    const total = current ?? 0;
    // Snapshot the flushed portion BEFORE the read: the flush's own GET+SET
    // are counted by the MeteredRedis wrapper into the REMAINING buffer (the
    // next flush persists them — each flush adds exactly its own commands, so
    // the total converges with no runaway inflation).
    const flushed = this.#buffered;
    if (flushed === 0) {
      return { total, flushed: 0 };
    }
    const next = total + flushed;
    await writeCounter(redis, key, next, MONTHLY_COUNTER_TTL_SECONDS);
    this.#buffered -= flushed;
    this.#lastFlushedTotal = next;
    return { total: next, flushed };
  }

  /** The last flushed absolute total (0 before the first flush). */
  get lastFlushedTotal(): number {
    return this.#lastFlushedTotal;
  }
}

// ---------------------------------------------------------------------------
// The per-user compute usage recorder
// ---------------------------------------------------------------------------

/** One metered cost quantity (the compute adapter's own vocabulary). */
export interface MeteredCostUnit {
  unitId: string;
  quantity: number;
}

/** Records one job's metered usage into the per-user daily windows. */
export async function recordUserDailyUsage(
  redis: RedisLike,
  userId: string,
  costUnits: readonly MeteredCostUnit[],
  nowMs: number,
): Promise<void> {
  const dayKey = calendarDayKey(nowMs);
  for (const unit of costUnits) {
    if (!(unit.quantity > 0)) continue;
    // Integer units only (the capability quota counters are integers —
    // metered milliseconds round to the nearest whole ms).
    const quantity = Math.max(0, Math.round(unit.quantity));
    if (quantity === 0) continue;
    await addToCounter(
      redis,
      userDailyUsageKey(unit.unitId, userId, dayKey),
      quantity,
      DAILY_COUNTER_TTL_SECONDS,
    );
  }
}

/** Reads one per-user daily usage counter (null when unreadable/absent). */
export async function readUserDailyUsage(
  redis: RedisLike,
  unitId: string,
  userId: string,
  nowMs: number,
): Promise<number | null> {
  return readCounter(redis, userDailyUsageKey(unitId, userId, calendarDayKey(nowMs)));
}
