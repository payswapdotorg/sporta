/**
 * W913 UNIT TESTS — the transient-state port over the IN-MEMORY backing.
 *
 * Everything here runs hermetically (no network, deterministic clocks via
 * the port's injectable `nowMs`): the RedisLike semantics the queue/quota/
 * cache layers rely on, the Upstash REST client's WIRE FORMAT (against a
 * fake `fetch` — no connectivity is ever faked), the bounded job queue's
 * fail-closed admission, the quota guard's windows + rollback + fail-closed
 * unreadable counters, the TTL cache's expiry, and the guard subjects.
 *
 * The REAL-Upstash round-trips are the env-gated integration suite
 * (./upstash-integration.test.ts) — never faked here.
 */
import { describe, expect, test } from "bun:test";
import {
  InMemoryRedis,
  UpstashRestRedis,
  type RedisLike,
} from "../../src/server/platform/upstash/redis";
import { BoundedJobQueue } from "../../src/server/platform/upstash/queue";
import { QuotaGuard } from "../../src/server/platform/upstash/quotas";
import { TtlCache } from "../../src/server/platform/upstash/cache";
import { attemptSubject, retryAfterSeconds } from "../../src/server/platform/upstash/guards";

/** A controllable clock (ms). */
function clock(startMs: number): { now: () => number; advance: (ms: number) => void } {
  let current = startMs;
  return { now: () => current, advance: (ms) => (current += ms) };
}

// ---------------------------------------------------------------------------
// InMemoryRedis — the fallback's RedisLike semantics
// ---------------------------------------------------------------------------

describe("InMemoryRedis", () => {
  test("SET/GET/DEL round-trip and DEL counts", async () => {
    const redis = new InMemoryRedis();
    expect(await redis.set("k", "v")).toBe("OK");
    expect(await redis.get("k")).toBe("v");
    expect(await redis.del("k")).toBe(1);
    expect(await redis.get("k")).toBe(null);
    expect(await redis.del("k")).toBe(0);
  });

  test("SET with EX expires (TTL honored by the injected clock)", async () => {
    const { now, advance } = clock(1_000_000);
    const redis = new InMemoryRedis(now);
    await redis.set("ttl", "gone", { ex: 10 });
    expect(await redis.get("ttl")).toBe("gone");
    advance(10_001);
    expect(await redis.get("ttl")).toBe(null);
  });

  test("EXPIRE arms a TTL on an existing key and misses an absent one", async () => {
    const { now, advance } = clock(1_000_000);
    const redis = new InMemoryRedis(now);
    await redis.set("k", "v");
    expect(await redis.expire("k", 5)).toBe(1);
    advance(5_001);
    expect(await redis.get("k")).toBe(null);
    expect(await redis.expire("missing", 5)).toBe(0);
  });

  test("INCR counts from empty and preserves the armed TTL", async () => {
    const { now, advance } = clock(1_000_000);
    const redis = new InMemoryRedis(now);
    expect(await redis.incr("hits")).toBe(1);
    expect(await redis.incr("hits")).toBe(2);
    await redis.expire("hits", 5);
    expect(await redis.incr("hits")).toBe(3);
    advance(5_001);
    expect(await redis.get("hits")).toBe(null);
    expect(await redis.incr("hits")).toBe(1);
  });

  test("RPUSH appends in order; LRANGE windows; LREM removes by value", async () => {
    const redis = new InMemoryRedis();
    expect(await redis.rpush("q", "a")).toBe(1);
    await redis.rpush("q", "b");
    await redis.rpush("q", "c");
    expect(await redis.llen("q")).toBe(3);
    expect(await redis.lrange("q", 0, -1)).toEqual(["a", "b", "c"]);
    expect(await redis.lrange("q", 0, 1)).toEqual(["a", "b"]);
    expect(await redis.lrem("q", 1, "b")).toBe(1);
    expect(await redis.lrange("q", 0, -1)).toEqual(["a", "c"]);
    expect(await redis.lrem("q", 1, "missing")).toBe(0);
    await redis.rpush("q", "a");
    await redis.rpush("q", "a");
    expect(await redis.lrem("q", 0, "a")).toBe(3);
    expect(await redis.llen("q")).toBe(1);
  });

  test("LTRIM keeps the window (negative-index semantics)", async () => {
    const redis = new InMemoryRedis();
    for (const value of ["a", "b", "c", "d"]) await redis.rpush("q", value);
    expect(await redis.ltrim("q", 1, -1)).toBe("OK");
    expect(await redis.lrange("q", 0, -1)).toEqual(["b", "c", "d"]);
    expect(await redis.ltrim("q", 0, -2)).toBe("OK");
    expect(await redis.lrange("q", 0, -1)).toEqual(["b", "c"]);
  });

  test("PING answers PONG", async () => {
    expect(await new InMemoryRedis().ping()).toBe("PONG");
  });
});

// ---------------------------------------------------------------------------
// UpstashRestRedis — the real client's wire format (fake fetch, no network)
// ---------------------------------------------------------------------------

describe("UpstashRestRedis (wire format over a fake fetch)", () => {
  interface CapturedCall {
    url: string;
    init: RequestInit;
  }

  function fakeFetch(result: unknown, status = 200) {
    const calls: CapturedCall[] = [];
    const impl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ result }), { status });
    };
    return { calls, impl };
  }

  test("GET posts the JSON command array with the Bearer token", async () => {
    const { calls, impl } = fakeFetch("the-value");
    const redis = new UpstashRestRedis({
      url: "https://example.upstash.io/",
      token: "tok",
      fetchImpl: impl as unknown as typeof fetch,
    });
    expect(await redis.get("k")).toBe("the-value");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://example.upstash.io");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>)["authorization"]).toBe("Bearer tok");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(["GET", "k"]);
  });

  test("SET with EX appends the expiry argument", async () => {
    const { calls, impl } = fakeFetch("OK");
    const redis = new UpstashRestRedis({
      url: "https://example.upstash.io",
      token: "tok",
      fetchImpl: impl as unknown as typeof fetch,
    });
    await redis.set("k", "v", { ex: 60 });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(["SET", "k", "v", "EX", 60]);
  });

  test("RPUSH/LREM/LRANGE/LLEN/INCR/EXPIRE/DEL/PING command shapes", async () => {
    const { calls, impl } = fakeFetch(1);
    const redis = new UpstashRestRedis({
      url: "https://example.upstash.io",
      token: "tok",
      fetchImpl: impl as unknown as typeof fetch,
    });
    await redis.rpush("q", "job");
    await redis.lrem("q", 1, "job");
    await redis.lrange("q", 0, -1);
    await redis.llen("q");
    await redis.incr("hits");
    await redis.expire("hits", 3600);
    await redis.del("hits");
    await redis.ping();
    const commands = calls.map((call) => JSON.parse(String(call.init.body))[0]);
    expect(commands).toEqual(["RPUSH", "LREM", "LRANGE", "LLEN", "INCR", "EXPIRE", "DEL", "PING"]);
  });

  test("an HTTP error FAILS LOUD (a quota layer must never treat an outage as no limit)", async () => {
    const impl = async (): Promise<Response> => new Response("nope", { status: 500 });
    const redis = new UpstashRestRedis({
      url: "https://example.upstash.io",
      token: "tok",
      fetchImpl: impl as unknown as typeof fetch,
    });
    await expect(redis.get("k")).rejects.toThrow("upstash rest: HTTP 500 for GET");
  });
});

// ---------------------------------------------------------------------------
// BoundedJobQueue — fail-closed bounded admission
// ---------------------------------------------------------------------------

describe("BoundedJobQueue", () => {
  function queueOf(options: { maxDepth: number; leaseMs?: number }) {
    const { now, advance } = clock(1_000_000);
    const redis = new InMemoryRedis(now);
    const queue = new BoundedJobQueue({
      redis,
      key: "sporta:test:queue",
      maxDepth: options.maxDepth,
      ...(options.leaseMs !== undefined ? { admissionLeaseMs: options.leaseMs } : {}),
      nowMs: now,
    });
    return { queue, redis, advance };
  }

  const job = (jobId: string) => ({
    jobId,
    userId: "user-1",
    kind: "render",
    payloadJson: "{}",
  });

  test("admits below the bound and reports depth", async () => {
    const { queue } = queueOf({ maxDepth: 3 });
    expect(await queue.offer(job("a"))).toEqual({ accepted: true, depth: 1 });
    expect(await queue.offer(job("b"))).toEqual({ accepted: true, depth: 2 });
    expect(await queue.depth()).toBe(2);
  });

  test("REFUSES at the hard bound (fail-closed — Simulation E)", async () => {
    const { queue } = queueOf({ maxDepth: 2 });
    await queue.offer(job("a"));
    await queue.offer(job("b"));
    const refused = await queue.offer(job("c"));
    expect(refused).toEqual({
      accepted: false,
      reason: "queue-full",
      depth: 2,
      maxDepth: 2,
    });
    expect(await queue.depth()).toBe(2);
  });

  test("take() drains OLDEST FIRST (RPUSH-fed FIFO)", async () => {
    const { queue } = queueOf({ maxDepth: 10 });
    await queue.offer(job("first"));
    await queue.offer(job("second"));
    await queue.offer(job("third"));
    const batch = await queue.take();
    expect(batch.map((entry) => entry.jobId)).toEqual(["first", "second", "third"]);
    expect(await queue.depth()).toBe(0);
  });

  test("take() batches (default 10) and leaves the rest", async () => {
    const { queue } = queueOf({ maxDepth: 20 });
    for (let index = 0; index < 13; index += 1) await queue.offer(job(`j${index}`));
    const batch = await queue.take();
    expect(batch).toHaveLength(10);
    expect(batch[0]!.jobId).toBe("j0");
    expect(await queue.depth()).toBe(3);
  });

  test("release() returns a settled job's slot; idempotent", async () => {
    const { queue } = queueOf({ maxDepth: 2 });
    await queue.offer(job("a"));
    await queue.offer(job("b"));
    expect(await queue.release("a")).toBe(true);
    expect(await queue.release("a")).toBe(false);
    expect(await queue.depth()).toBe(1);
    // The freed slot admits new work again.
    expect((await queue.offer(job("c"))).accepted).toBe(true);
  });

  test("the admission LEASE sweeps abandoned records at the next offer", async () => {
    const { queue, advance } = queueOf({ maxDepth: 2, leaseMs: 1_000 });
    await queue.offer(job("stale"));
    advance(1_001);
    // The stale record is swept, so admission succeeds instead of refusing.
    expect((await queue.offer(job("fresh"))).accepted).toBe(true);
    const snapshot = await queue.snapshot();
    expect(snapshot.map((entry) => entry.jobId)).toEqual(["fresh"]);
  });

  test("snapshot() is the per-job state view (order + age)", async () => {
    const { queue, advance } = queueOf({ maxDepth: 5 });
    await queue.offer(job("a"));
    advance(50);
    await queue.offer(job("b"));
    const snapshot = await queue.snapshot();
    expect(snapshot.map((entry) => entry.jobId)).toEqual(["a", "b"]);
    expect(snapshot[0]!.ageMs).toBe(50);
    expect(snapshot[1]!.ageMs).toBe(0);
    expect(snapshot[0]!.kind).toBe("render");
    expect(snapshot[0]!.userId).toBe("user-1");
  });

  test("rejects a non-positive maxDepth (construction is validated)", () => {
    const redis = new InMemoryRedis();
    expect(() => new BoundedJobQueue({ redis, key: "k", maxDepth: 0 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// QuotaGuard — windows, exhaustion, rollback, fail-closed counters
// ---------------------------------------------------------------------------

describe("QuotaGuard", () => {
  const quota = { quotaId: "test-quota", scope: "user" as const, limit: 3, windowSeconds: 600 };

  test("consume under the limit is allowed with the W901 QuotaState shape", async () => {
    const guard = new QuotaGuard({ redis: new InMemoryRedis() });
    const outcome = await guard.consume(quota, "subject-1");
    expect(outcome.allowed).toBe(true);
    expect(outcome.state).toEqual({
      quotaId: "test-quota",
      scope: "user",
      used: 1,
      limit: 3,
      remaining: 2,
      exhausted: false,
      reasonCode: "ok",
    });
  });

  test("the limit-consuming call is ALLOWED but marks exhaustion", async () => {
    const guard = new QuotaGuard({ redis: new InMemoryRedis() });
    for (let index = 0; index < 2; index += 1) await guard.consume(quota, "s");
    const last = await guard.consume(quota, "s");
    expect(last.allowed).toBe(true);
    expect(last.state.exhausted).toBe(true);
    expect(last.state.reasonCode).toBe("quota-exhausted");
    expect(last.state.remaining).toBe(0);
  });

  test("consumption past the limit is REFUSED and the counter rolls back", async () => {
    const { now } = clock(1_000_000);
    const redis = new InMemoryRedis(now);
    const guard = new QuotaGuard({ redis, nowMs: now });
    for (let index = 0; index < 3; index += 1) await guard.consume(quota, "s");
    const refused = await guard.consume(quota, "s");
    expect(refused.allowed).toBe(false);
    expect(refused.state.used).toBe(3);
    expect(refused.state.remaining).toBe(0);
    expect(refused.state.reasonCode).toBe("quota-exhausted");
    // Rollback: the peek still sees the limit (not limit+1).
    expect((await guard.peek(quota, "s")).used).toBe(3);
  });

  test("the fixed window ROLLS OVER with the clock", async () => {
    const { now, advance } = clock(1_000_000);
    const redis = new InMemoryRedis(now);
    const guard = new QuotaGuard({ redis, nowMs: now });
    for (let index = 0; index < 3; index += 1) await guard.consume(quota, "s");
    expect((await guard.consume(quota, "s")).allowed).toBe(false);
    advance(600_001); // past the window: a fresh counter
    expect((await guard.consume(quota, "s")).allowed).toBe(true);
    expect((await guard.peek(quota, "s")).used).toBe(1);
  });

  test("subjects are isolated (per-user counters)", async () => {
    const guard = new QuotaGuard({ redis: new InMemoryRedis() });
    for (let index = 0; index < 3; index += 1) await guard.consume(quota, "user-a");
    expect((await guard.consume(quota, "user-a")).allowed).toBe(false);
    expect((await guard.consume(quota, "user-b")).allowed).toBe(true);
  });

  test("peek reads without consuming", async () => {
    const guard = new QuotaGuard({ redis: new InMemoryRedis() });
    await guard.consume(quota, "s");
    await guard.consume(quota, "s");
    expect((await guard.peek(quota, "s")).used).toBe(2);
    expect((await guard.peek(quota, "s")).used).toBe(2);
  });

  test("FAIL-CLOSED: an unreadable counter refuses with quota-counter-invalid", async () => {
    const boom = async (): Promise<never> => {
      throw new Error("unreadable");
    };
    const broken: RedisLike = {
      get: boom,
      set: boom,
      del: boom,
      incr: boom,
      expire: boom,
      rpush: boom,
      lrem: boom,
      ltrim: boom,
      lrange: boom,
      llen: boom,
      ping: boom,
    };
    const guard = new QuotaGuard({ redis: broken });
    const refused = await guard.consume(quota, "s");
    expect(refused.allowed).toBe(false);
    expect(refused.state.reasonCode).toBe("quota-counter-invalid");
    expect(refused.state.used).toBe(null);
    expect(refused.state.limit).toBe(null);
    expect(refused.state.exhausted).toBe(true);
    const peeked = await guard.peek(quota, "s");
    expect(peeked.reasonCode).toBe("quota-counter-invalid");
    expect(peeked.used).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// TtlCache — small cache with honest TTL semantics
// ---------------------------------------------------------------------------

describe("TtlCache", () => {
  test("set/get round-trip (JSON-safe values); misses are null", async () => {
    const cache = new TtlCache({ redis: new InMemoryRedis(), namespace: "t", ttlSeconds: 60 });
    await cache.set("k", { a: 1 });
    expect(await cache.get<{ a: number }>("k")).toEqual({ a: 1 });
    expect(await cache.get("missing")).toBe(null);
  });

  test("entries expire after the TTL (injected clock)", async () => {
    const { now, advance } = clock(1_000_000);
    const redis = new InMemoryRedis(now);
    const cache = new TtlCache({ redis, namespace: "t", ttlSeconds: 30 });
    await cache.set("k", "v");
    advance(30_001);
    expect(await cache.get("k")).toBe(null);
  });

  test("getOrCompute computes once, then serves the cached value", async () => {
    const { now, advance } = clock(1_000_000);
    const redis = new InMemoryRedis(now);
    const cache = new TtlCache({ redis, namespace: "t", ttlSeconds: 30 });
    let calls = 0;
    const compute = async () => {
      calls += 1;
      return { n: calls };
    };
    expect(await cache.getOrCompute("k", compute)).toEqual({ n: 1 });
    expect(await cache.getOrCompute("k", compute)).toEqual({ n: 1 });
    expect(calls).toBe(1);
    advance(30_001); // expired: NO negative caching — a miss recomputes
    expect(await cache.getOrCompute("k", compute)).toEqual({ n: 2 });
    expect(calls).toBe(2);
  });

  test("drop() removes an entry", async () => {
    const cache = new TtlCache({ redis: new InMemoryRedis(), namespace: "t", ttlSeconds: 60 });
    await cache.set("k", "v");
    await cache.drop("k");
    expect(await cache.get("k")).toBe(null);
  });

  test("requires a positive integer TTL (no unbounded retention)", () => {
    expect(
      () => new TtlCache({ redis: new InMemoryRedis(), namespace: "t", ttlSeconds: 0 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Guards — subjects + retry-after + error shapes
// ---------------------------------------------------------------------------

describe("admission guard helpers", () => {
  test("attemptSubject normalizes the identity charset and buckets the rest", () => {
    expect(attemptSubject("Worker.B")).toBe("worker.b");
    expect(attemptSubject("  Alice-01 ")).toBe("alice-01");
    expect(attemptSubject("bad name!")).toBe("invalid");
    expect(attemptSubject(undefined)).toBe("invalid");
    expect(attemptSubject(42)).toBe("invalid");
    expect(attemptSubject("ab")).toBe("invalid"); // too short per the username rule
  });

  test("retryAfterSeconds stays inside the window and floors at 1", () => {
    expect(retryAfterSeconds(0, 3600)).toBe(3600);
    expect(retryAfterSeconds(1_000, 3600)).toBe(3599); // 1s into the window
    expect(retryAfterSeconds(1_000_000, 3600)).toBe(2600); // 1000s in → 2600s out
    expect(retryAfterSeconds(3_599_999, 3600)).toBe(1);
    expect(retryAfterSeconds(3_600_000, 3600)).toBe(3600); // boundary → next window
  });
});
