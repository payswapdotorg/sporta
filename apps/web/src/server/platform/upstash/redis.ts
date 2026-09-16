/**
 * The Redis port + Upstash REST client + in-memory fallback (W913).
 *
 * DISCOVERY RECORD (2026-09-15 + re-probed this flight): the provisioned
 * `UPSTASH_REDIS_REST_TOKEN` is a 36-character UUID-shaped token with NO
 * companion `UPSTASH_REDIS_REST_URL`. Probed (both flights):
 * - Upstash management API `https://api.upstash.com/v2/redis/databases` —
 *   rejects the token as `Authorization: Bearer` (401, "token contains an
 *   invalid number of segments" — management keys are JWT-shaped), and as
 *   both Basic-auth halves (401) → it is NOT a management API key;
 * - it is a database-scoped REST token, which is only usable against the
 *   REST URL of the database it belongs to — and that URL is not
 *   provisioned anywhere reachable from this environment.
 *
 * CONSEQUENCE (honest boundary): no real Upstash Redis is reachable from
 * this sandbox. The layer below is therefore a PORT with two backends:
 * `UpstashRestRedis` (the real REST client — fetch-based, zero deps, exactly
 * the client shape Upstash documents) and `InMemoryRedis` (the fallback).
 * When `UPSTASH_REDIS_REST_URL` + token are both present, the REAL client is
 * used automatically; integration tests against it are env-gated and skip
 * LOUDLY otherwise. Nothing in this module fakes Upstash connectivity.
 */
import { upstashRedisToken, upstashRedisUrl } from "../env";

/** The commands this platform needs (queue/cache/quotas — nothing more). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<"OK" | null>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  rpush(key: string, value: string): Promise<number>;
  lrem(key: string, count: number, value: string): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<"OK" | null>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  llen(key: string): Promise<number>;
  ping(): Promise<"PONG" | null>;
}

// ---------------------------------------------------------------------------
// Upstash REST client (the real backend)
// ---------------------------------------------------------------------------

/**
 * Upstash Redis over the REST API (fetch only — the Upstash client shape).
 * Commands are POSTed as JSON arrays; errors throw (fail-loud — a quota/queue
 * layer must never treat a Redis outage as "no limit").
 */
export class UpstashRestRedis implements RedisLike {
  readonly #url: string;
  readonly #token: string;
  readonly #fetchImpl: typeof fetch;

  constructor(options: { url: string; token: string; fetchImpl?: typeof fetch }) {
    this.#url = options.url.replace(/\/$/, "");
    this.#token = options.token;
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  async #command<T>(command: (string | number)[]): Promise<T> {
    const response = await this.#fetchImpl(this.#url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    });
    if (!response.ok) {
      throw new Error(`upstash rest: HTTP ${response.status} for ${command[0]}`);
    }
    const payload = (await response.json()) as { result: T };
    return payload.result;
  }

  async get(key: string): Promise<string | null> {
    return this.#command<string | null>(["GET", key]);
  }

  async set(key: string, value: string, opts?: { ex?: number }): Promise<"OK" | null> {
    const command: (string | number)[] = ["SET", key, value];
    if (opts?.ex !== undefined) command.push("EX", opts.ex);
    return this.#command<"OK" | null>(command);
  }

  async del(key: string): Promise<number> {
    return this.#command<number>(["DEL", key]);
  }

  async incr(key: string): Promise<number> {
    return this.#command<number>(["INCR", key]);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.#command<number>(["EXPIRE", key, seconds]);
  }

  async rpush(key: string, value: string): Promise<number> {
    return this.#command<number>(["RPUSH", key, value]);
  }

  async lrem(key: string, count: number, value: string): Promise<number> {
    return this.#command<number>(["LREM", key, count, value]);
  }

  async ltrim(key: string, start: number, stop: number): Promise<"OK" | null> {
    return this.#command<"OK" | null>(["LTRIM", key, start, stop]);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.#command<string[]>(["LRANGE", key, start, stop]);
  }

  async llen(key: string): Promise<number> {
    return this.#command<number>(["LLEN", key]);
  }

  async ping(): Promise<"PONG" | null> {
    return this.#command<"PONG" | null>(["PING"]);
  }
}

// ---------------------------------------------------------------------------
// In-memory fallback (local dev / unconfigured preview)
// ---------------------------------------------------------------------------

/** A faithful in-memory `RedisLike` (TTLs included). NOT a shared store: per process. */
export class InMemoryRedis implements RedisLike {
  readonly #map = new Map<string, { value: string; expiresAtMs: number | null }>();
  readonly #lists = new Map<string, string[]>();
  #nowMs: () => number;

  constructor(nowMs: () => number = Date.now) {
    this.#nowMs = nowMs;
  }

  #live(key: string): { value: string; expiresAtMs: number | null } | undefined {
    const entry = this.#map.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAtMs !== null && entry.expiresAtMs <= this.#nowMs()) {
      this.#map.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.#live(key)?.value ?? null;
  }

  async set(key: string, value: string, opts?: { ex?: number }): Promise<"OK" | null> {
    const expiresAtMs = opts?.ex !== undefined ? this.#nowMs() + opts.ex * 1000 : null;
    this.#map.set(key, { value, expiresAtMs });
    return "OK";
  }

  async del(key: string): Promise<number> {
    const existed = this.#live(key) !== undefined;
    this.#map.delete(key);
    this.#lists.delete(key);
    return existed ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    const current = this.#live(key);
    const next = current === undefined ? 1 : Number(current.value) + 1;
    if (!Number.isFinite(next)) throw new Error(`INCR: value at '${key}' is not an integer`);
    this.#map.set(key, { value: String(next), expiresAtMs: current?.expiresAtMs ?? null });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.#live(key);
    if (entry === undefined) return 0;
    entry.expiresAtMs = this.#nowMs() + seconds * 1000;
    return 1;
  }

  async rpush(key: string, value: string): Promise<number> {
    const list = this.#lists.get(key) ?? [];
    list.push(value);
    this.#lists.set(key, list);
    return list.length;
  }

  async lrem(key: string, count: number, value: string): Promise<number> {
    const list = this.#lists.get(key);
    if (list === undefined) return 0;
    let removed = 0;
    if (count === 0) {
      // Remove EVERY occurrence (Redis semantics).
      const kept = list.filter((entry) => {
        if (entry === value) {
          removed += 1;
          return false;
        }
        return true;
      });
      this.#lists.set(key, kept);
    } else {
      // count > 0: from head; count < 0: from tail (Redis semantics).
      const from = count > 0;
      const max = Math.abs(count);
      const kept = [...list];
      if (from) {
        for (let i = 0; i < kept.length && removed < max; i += 1) {
          if (kept[i] === value) {
            kept.splice(i, 1);
            removed += 1;
            i -= 1;
          }
        }
      } else {
        for (let i = kept.length - 1; i >= 0 && removed < max; i -= 1) {
          if (kept[i] === value) {
            kept.splice(i, 1);
            removed += 1;
          }
        }
      }
      this.#lists.set(key, kept);
    }
    return removed;
  }

  async ltrim(key: string, start: number, stop: number): Promise<"OK" | null> {
    const list = this.#lists.get(key);
    if (list === undefined) return "OK";
    // Redis index semantics: negative = from the end.
    const resolve = (index: number, length: number): number =>
      index < 0 ? Math.max(length + index, 0) : index;
    const from = resolve(start, list.length);
    const toInclusive = resolve(stop, list.length);
    this.#lists.set(key, from <= toInclusive ? list.slice(from, toInclusive + 1) : []);
    return "OK";
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.#lists.get(key) ?? [];
    const resolve = (index: number, length: number): number =>
      index < 0 ? Math.max(length + index, 0) : index;
    const from = resolve(start, list.length);
    const toInclusive = resolve(stop, list.length);
    return from <= toInclusive ? list.slice(from, toInclusive + 1) : [];
  }

  async llen(key: string): Promise<number> {
    return this.#lists.get(key)?.length ?? 0;
  }

  async ping(): Promise<"PONG" | null> {
    return "PONG";
  }
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** What the transient-state composition exposes. */
export interface HostedTransientState {
  redis: RedisLike;
  provider: "upstash" | "in-memory";
}

let hosted: HostedTransientState | null = null;

/**
 * The process-wide transient state: REAL Upstash REST when both bindings are
 * present, otherwise the in-memory fallback (per-instance — documented
 * boundary: without a shared Redis, quotas/queue bounds are enforced
 * per-instance only).
 */
export function getHostedTransientState(): HostedTransientState {
  if (hosted !== null) return hosted;
  const url = upstashRedisUrl();
  const token = upstashRedisToken();
  if (url !== undefined && token !== undefined) {
    hosted = { redis: new UpstashRestRedis({ url, token }), provider: "upstash" };
  } else {
    hosted = { redis: new InMemoryRedis(), provider: "in-memory" };
  }
  return hosted;
}
