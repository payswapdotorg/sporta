/**
 * Per-user / per-job quota counters with hard limits + degraded-state
 * emission (W913).
 *
 * Counters live in the `RedisLike` port (INCR + EXPIRE per fixed window).
 * Rules:
 *
 * - FAIL-CLOSED on unreadable counters: if the counter cannot be read, the
 *   quota is reported EXHAUSTED with reason `quota-counter-invalid` (the
 *   `@sporta/capability` `QuotaState` vocabulary — unreadable capacity admits
 *   no new work; Simulation E admission-stop);
 * - a consume past the limit REFUSES the increment (rolls it back) and
 *   returns the exhausted state — the caller emits the degraded state;
 * - the emitted shape IS the W901 `QuotaState` (`quotaId`, `scope`, `used`,
 *   `limit`, `remaining`, `exhausted`, `reasonCode`) so the capability surface
 *   (W904/W908) can carry it verbatim.
 */
import type { RedisLike } from "./redis";

/** The quota scopes (the W901 vocabulary). */
export type QuotaScope = "user" | "job";

/** The W901 quota reason codes. */
export type QuotaReasonCode = "ok" | "quota-exhausted" | "quota-counter-invalid";

/** The W901 `QuotaState` shape, emitted by every guard operation. */
export interface PlatformQuotaState {
  quotaId: string;
  scope: QuotaScope | null;
  used: number | null;
  limit: number | null;
  remaining: number | null;
  exhausted: boolean;
  reasonCode: QuotaReasonCode;
}

/** The outcome of a consume attempt. */
export type QuotaConsumeOutcome =
  | { allowed: true; state: PlatformQuotaState }
  | { allowed: false; state: PlatformQuotaState };

/** One quota definition (id + hard limit). */
export interface QuotaDefinition {
  quotaId: string;
  scope: QuotaScope;
  limit: number;
  /** Fixed window seconds (default 3600 — one hour). */
  windowSeconds?: number;
}

/** Options for {@link QuotaGuard}. */
export interface QuotaGuardOptions {
  redis: RedisLike;
  /** Wall clock for window keying (default: real time). */
  nowMs?: () => number;
}

/** A hard-limit quota guard over the `RedisLike` port. */
export class QuotaGuard {
  readonly #redis: RedisLike;
  readonly #nowMs: () => number;

  constructor(options: QuotaGuardOptions) {
    this.#redis = options.redis;
    this.#nowMs = options.nowMs ?? Date.now;
  }

  #counterKey(quota: QuotaDefinition, subjectId: string): string {
    const windowSeconds = quota.windowSeconds ?? 3600;
    const windowIndex = Math.floor(this.#nowMs() / (windowSeconds * 1000));
    return `quota:${quota.quotaId}:${subjectId}:${windowIndex}`;
  }

  /** Reads the current state without consuming. */
  async peek(quota: QuotaDefinition, subjectId: string): Promise<PlatformQuotaState> {
    let used: number | null = null;
    try {
      const raw = await this.#redis.get(this.#counterKey(quota, subjectId));
      const parsed = raw === null ? 0 : Number(raw);
      used = Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
    } catch {
      used = null;
    }
    if (used === null) {
      return {
        quotaId: quota.quotaId,
        scope: quota.scope,
        used: null,
        limit: null,
        remaining: null,
        exhausted: true,
        reasonCode: "quota-counter-invalid",
      };
    }
    const exhausted = used >= quota.limit;
    return {
      quotaId: quota.quotaId,
      scope: quota.scope,
      used,
      limit: quota.limit,
      remaining: Math.max(0, quota.limit - used),
      exhausted,
      reasonCode: exhausted ? "quota-exhausted" : "ok",
    };
  }

  /**
   * Consumes one unit if capacity remains; REFUSES (and rolls the counter
   * back) when the limit is hit. Fail-closed on counter errors.
   */
  async consume(quota: QuotaDefinition, subjectId: string): Promise<QuotaConsumeOutcome> {
    const key = this.#counterKey(quota, subjectId);
    let next: number;
    try {
      next = await this.#redis.incr(key);
    } catch {
      return { allowed: false, state: await this.failedRead(quota) };
    }
    if (!Number.isFinite(next)) {
      return { allowed: false, state: await this.failedRead(quota) };
    }
    const windowSeconds = quota.windowSeconds ?? 3600;
    if (next === 1) {
      try {
        await this.#redis.expire(key, windowSeconds);
      } catch {
        // Counter works, TTL set failed: the hard limit still bounds growth.
      }
    }
    if (next > quota.limit) {
      // Roll the over-limit increment back, then refuse (fail-closed).
      await this.#decrement(key, windowSeconds);
      return {
        allowed: false,
        state: {
          quotaId: quota.quotaId,
          scope: quota.scope,
          used: Math.min(next - 1, quota.limit),
          limit: quota.limit,
          remaining: 0,
          exhausted: true,
          reasonCode: "quota-exhausted",
        },
      };
    }
    return {
      allowed: true,
      state: {
        quotaId: quota.quotaId,
        scope: quota.scope,
        used: next,
        limit: quota.limit,
        remaining: quota.limit - next,
        exhausted: next === quota.limit,
        reasonCode: next === quota.limit ? "quota-exhausted" : "ok",
      },
    };
  }

  /** A fail-closed unreadable-counter state (the W901 `quota-counter-invalid`). */
  private async failedRead(quota: QuotaDefinition): Promise<PlatformQuotaState> {
    return {
      quotaId: quota.quotaId,
      scope: quota.scope,
      used: null,
      limit: null,
      remaining: null,
      exhausted: true,
      reasonCode: "quota-counter-invalid",
    };
  }

  async #decrement(key: string, windowSeconds: number): Promise<void> {
    try {
      // The port exposes no DECR; a best-effort SET of the decremented value
      // (with the window TTL re-armed) rolls our own over-limit increment
      // back. The refusal is already fail-closed regardless of this rollback.
      const value = await this.#redis.get(key);
      if (value === null) return;
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) {
        await this.#redis.set(key, String(parsed - 1), { ex: windowSeconds });
      }
    } catch {
      // Best-effort rollback; the refusal stands.
    }
  }
}
