/**
 * The small cache layer (W913).
 *
 * A bounded, TTL cache over the `RedisLike` port for the hosted control
 * plane's read-mostly lookups (capability snapshots, renderer catalogs — the
 * shapes W904/W914-hosted consume). Deliberately minimal: `get`/`set`/
 * `getOrCompute` with an explicit TTL; NO negative caching (a miss is a miss —
 * cached denial states would violate the fail-closed capability posture).
 */
import type { RedisLike } from "./redis";

/** Options for {@link TtlCache}. */
export interface TtlCacheOptions {
  redis: RedisLike;
  /** Cache key namespace (keys become `<namespace>:<key>`). */
  namespace: string;
  /** TTL seconds for every entry (required — no unbounded retention). */
  ttlSeconds: number;
}

/** A small TTL cache over a `RedisLike` backend. */
export class TtlCache {
  readonly #redis: RedisLike;
  readonly #namespace: string;
  readonly #ttlSeconds: number;

  constructor(options: TtlCacheOptions) {
    if (!Number.isInteger(options.ttlSeconds) || options.ttlSeconds < 1) {
      throw new Error("TtlCache: ttlSeconds must be a positive integer");
    }
    this.#redis = options.redis;
    this.#namespace = options.namespace;
    this.#ttlSeconds = options.ttlSeconds;
  }

  #key(key: string): string {
    return `${this.#namespace}:${key}`;
  }

  /** The cached value for a key, or null on miss/expiry. */
  async get<T>(key: string): Promise<T | null> {
    const raw = await this.#redis.get(this.#key(key));
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  /** Caches a JSON-safe value under the TTL. */
  async set(key: string, value: unknown): Promise<void> {
    await this.#redis.set(this.#key(key), JSON.stringify(value), { ex: this.#ttlSeconds });
  }

  /** Drops one entry. */
  async drop(key: string): Promise<void> {
    await this.#redis.del(this.#key(key));
  }

  /** Read-through: on miss, computes, stores, and returns the value. */
  async getOrCompute<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const computed = await compute();
    await this.set(key, computed);
    return computed;
  }
}
