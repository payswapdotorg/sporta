/**
 * W913 INTEGRATION TESTS — the REAL Upstash Redis (REST API).
 *
 * ENV-GATED, LOUD: these tests run ONLY when BOTH Upstash bindings are
 * present (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — see
 * docs/deployment/DEPLOYMENT.md §W913). Without them the suite SKIPS with a
 * banner so the root `bun test` battery stays green in every environment
 * that has no reachable database (the honest local posture — connectivity is
 * NEVER faked).
 *
 * What is proven (W913 acceptance — bounded queue/cache state round-trips
 * through the real hosted transient state):
 * 1. PING: the REST client reaches the database and it answers PONG.
 * 2. QUEUE ROUND-TRIP: `offer` (RPUSH) + depth (LLEN) + `take` (LRANGE +
 *    LTRIM) drain FIFO; `release` (LREM) removes exactly its record; the
 *    hard depth bound refuses against the REAL database.
 * 3. COUNTER WINDOWS: INCR counts; EXPIRE arms a TTL that a real (short)
 *    wait observes lapsed — the quota window semantics the guard relies on.
 * 4. CACHE HIT/MISS: the TtlCache round-trips a value and its TTL lapses.
 *
 * Every key lives under a per-run random prefix and is deleted afterwards.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { UpstashRestRedis } from "../../src/server/platform/upstash/redis";
import { BoundedJobQueue } from "../../src/server/platform/upstash/queue";
import { TtlCache } from "../../src/server/platform/upstash/cache";
import { QuotaGuard } from "../../src/server/platform/upstash/quotas";

const url = process.env["UPSTASH_REDIS_REST_URL"];
const token = process.env["UPSTASH_REDIS_REST_TOKEN"];
const gate = url !== undefined && token !== undefined;

if (!gate) {
  console.warn(
    [
      "",
      "======================================================================",
      " W913 UPSTASH INTEGRATION TESTS — SKIPPED (env-gated, loud by design)",
      "----------------------------------------------------------------------",
      " No UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN pair in this",
      " environment, so no real Upstash Redis is reachable (the provisioned",
      " token is DB-scoped and its REST URL is not provisioned here — see",
      " DEPLOYMENT.md §W913 for the discovery record). NOTHING is faked: run",
      " with both bindings set to execute the real round-trips.",
      "======================================================================",
      "",
    ].join("\n"),
  );
}

const PREFIX = `sporta:test:w913:${Math.random().toString(36).slice(2, 10)}`;
const redis: UpstashRestRedis | null = gate ? new UpstashRestRedis({ url: url!, token: token! }) : null;
const createdKeys: string[] = [];

afterAll(async () => {
  if (redis === null) return;
  for (const key of createdKeys) {
    try {
      await redis.del(key);
    } catch {
      // Best-effort cleanup; the keys are TTL-bounded anyway.
    }
  }
});

describe.skipIf(!gate)("W913 integration — the real Upstash Redis (REST)", () => {
  test("PING answers PONG (reachability + auth)", async () => {
    expect(await redis!.ping()).toBe("PONG");
  });

  test("counter INCR counts and the quota window's EXPIRE lapses for real", async () => {
    const key = `${PREFIX}:counter`;
    createdKeys.push(key);
    expect(await redis!.incr(key)).toBe(1);
    expect(await redis!.incr(key)).toBe(2);
    expect(await redis!.get(key)).toBe("2");
    expect(await redis!.expire(key, 1)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    expect(await redis!.get(key)).toBe(null); // the window really elapsed
  });

  test("the bounded queue round-trips (offer/depth/take FIFO/release)", async () => {
    const key = `${PREFIX}:queue`;
    createdKeys.push(key);
    const queue = new BoundedJobQueue({ redis: redis!, key, maxDepth: 3 });
    const job = (jobId: string) => ({ jobId, userId: "u", kind: "render", payloadJson: "{}" });
    expect((await queue.offer(job("a"))).accepted).toBe(true);
    await queue.offer(job("b"));
    await queue.offer(job("c"));
    // At the hard bound: fail-closed admission against the REAL database.
    expect(await queue.offer(job("d"))).toEqual({
      accepted: false,
      reason: "queue-full",
      depth: 3,
      maxDepth: 3,
    });
    // release() removes exactly its record; a slot frees.
    expect(await queue.release("b")).toBe(true);
    expect(await queue.release("b")).toBe(false);
    expect(await queue.depth()).toBe(2);
    // take() drains OLDEST FIRST (the FIFO shape).
    const batch = await queue.take();
    expect(batch.map((entry) => entry.jobId)).toEqual(["a", "c"]);
    expect(await queue.depth()).toBe(0);
  });

  test("the quota guard consumes against the real counters", async () => {
    const quota = {
      quotaId: `${PREFIX}:quota`,
      scope: "user" as const,
      limit: 2,
      windowSeconds: 60,
    };
    const guard = new QuotaGuard({ redis: redis! });
    expect((await guard.consume(quota, "integration-user")).allowed).toBe(true);
    expect((await guard.consume(quota, "integration-user")).allowed).toBe(true);
    const refused = await guard.consume(quota, "integration-user");
    expect(refused.allowed).toBe(false);
    expect(refused.state.reasonCode).toBe("quota-exhausted");
    expect((await guard.peek(quota, "integration-user")).used).toBe(2);
  });

  test("the TtlCache hit/miss round-trips with a real TTL", async () => {
    const cache = new TtlCache({ redis: redis!, namespace: `${PREFIX}:cache`, ttlSeconds: 1 });
    await cache.set("k", { hello: "upstash" });
    expect(await cache.get<{ hello: string }>("k")).toEqual({ hello: "upstash" });
    expect(await cache.get("missing")).toBe(null);
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    expect(await cache.get("k")).toBe(null); // the TTL really elapsed
  });
});
