/**
 * W919 COST/USAGE GUARDRAILS TESTS — the ledger, the usage meter, the spend
 * alarms, and the fail-closed admission over REAL seams:
 *
 * UNIT (hermetic `GuardrailsService` over an `InMemoryRedis` + injected
 * seam accessors):
 * 1. LEDGER: the documented defaults; env overrides applied (and INVALID
 *    overrides FAIL LOUD); the warning-ratio override (and >= 1 rejected);
 *    the classification boundaries under/approaching/reached/exceeded;
 * 2. USAGE METER: per-job usage aggregated into the per-user daily window
 *    (two jobs sum), attributed per unit, idempotent per job, skipped for
 *    unattributed jobs, window-keyed by UTC day (a rolled clock counts into
 *    the NEXT day's key);
 * 3. COMMAND METER: the MeteredRedis wrapper counts every command issued
 *    through the port, and the buffered flush converges (each flush adds
 *    exactly its own GET+SET — no runaway inflation);
 * 4. QUOTA STATES: absent counter = zero usage (ok), exhausted at the
 *    threshold, corrupt counter = the fail-closed `quota-counter-invalid`;
 * 5. ADMISSION: typed 503 refusals with the REAL reason at each limit type
 *    (per-user cpu-ms, per-user artifact-bytes, global R2 storage, global
 *    Upstash command budget), fail-closed on unreadable counters, and a
 *    pass-through when everything is under the thresholds;
 * 6. ALARMS: window-scoped transitions persisted (under → approaching →
 *    reached), stable observations write nothing, recovery is a transition.
 *
 * ROUTE (hermetic compositions + the REAL route handlers):
 * 7. USAGE-COUNTER SNAPSHOT FROM REAL SEAMS: a real studio dispatch through
 *    the in-process compute adapter → the terminal poll notes the metered
 *    usage → the capability quotas[] surfaces the per-user daily usage
 *    counters and the console panels surface the ledger evaluation;
 * 8. LIMIT-CROSSED → CAPABILITY DEGRADED: with the cpu-ms threshold
 *    configured at 1ms (the ledger's documented configurability), one real
 *    render's metered usage EXCEEDS it → the capability response carries the
 *    exhausted quota entry and degrades (`quota-exhausted`, Simulation E);
 * 9. ADMISSION REFUSAL WITH THE REAL REASON: the next dispatch is refused
 *    503 `capacity-exceeded` BEFORE the provider runs (queue depth
 *    unchanged, the caller's render-requests quota NOT charged — reads
 *    before writes), with the limit id/used/limit in the body;
 * 10. PLAYBACK UNAFFECTED (Simulation E's last rule): the SAME composition
 *    still serves the seeded session's playback bytes after the refusal.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { InMemoryRedis } from "../src/server/platform/upstash/redis";
import type { RedisLike } from "../src/server/platform/upstash/redis";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import {
  CommandCounter,
  GuardrailsService,
  MeteredRedis,
  alarmKey,
  calendarDayKey,
  calendarMonthKey,
  classifyUsage,
  limitEnvName,
  monthlyCommandsKey,
  readUserDailyUsage,
  resolveLedger,
  userDailyUsageKey,
} from "../src/server/platform/guardrails";
import type { MeteredJobUsageRecord } from "../src/server/platform/guardrails";
import { RENDER_REQUESTS_QUOTA } from "../src/server/platform/upstash/hosted";

// The routes under test.
import { GET as capabilityRoute } from "../src/app/api/capability/route";
import { GET as operationsHealthRoute } from "../src/app/api/operations/health/route";
import { GET as operationsProvidersRoute } from "../src/app/api/operations/providers/route";
import { POST as createSessionRoute } from "../src/app/api/create/sessions/route";
import { POST as dispatchRoute } from "../src/app/api/create/sessions/[sessionId]/renders/route";
import { GET as jobRoute } from "../src/app/api/create/sessions/[sessionId]/jobs/[jobId]/route";
import { GET as watchOutputRoute } from "../src/app/api/watch/[sessionId]/renders/[renderId]/outputs/[segmentId]/route";

const BASE_MS = 1_777_777_777_000;

/** A clock that advances 17ms per read (deterministic, never crosses midnight). */
function steppingClock(): () => number {
  let current = BASE_MS;
  return () => {
    current += 17;
    return current;
  };
}

function withCookie(token: string | null, path: string, init: RequestInit = {}): Request {
  return new Request(`http://sporta.test${path}`, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      ...(token === null ? {} : { cookie: `${SPORTA_SESSION_COOKIE}=${token}` }),
    },
  });
}

function post(payload: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/** A redis whose GET always throws (the fail-closed unreadable counter). */
class UnreadableRedis implements RedisLike {
  async get(): Promise<string | null> {
    throw new Error("unreadable");
  }
  async set(): Promise<"OK" | null> {
    throw new Error("unreadable");
  }
  async del(): Promise<number> {
    throw new Error("unreadable");
  }
  async incr(): Promise<number> {
    throw new Error("unreadable");
  }
  async expire(): Promise<number> {
    throw new Error("unreadable");
  }
  async rpush(): Promise<number> {
    throw new Error("unreadable");
  }
  async lrem(): Promise<number> {
    throw new Error("unreadable");
  }
  async ltrim(): Promise<"OK" | null> {
    throw new Error("unreadable");
  }
  async lrange(): Promise<string[]> {
    throw new Error("unreadable");
  }
  async llen(): Promise<number> {
    throw new Error("unreadable");
  }
  async ping(): Promise<"PONG" | null> {
    throw new Error("unreadable");
  }
}

/** Builds a hermetic unit-scope guardrails service over the given redis. */
function unitService(
  redis: RedisLike,
  nowMs: () => number,
  seams: {
    r2Stats?: () => Promise<{ segments: number; totalBytes: number; duplicateStores: number } | null>;
    computeUsage?: () => Promise<readonly MeteredJobUsageRecord[] | null>;
    ledger?: ReturnType<typeof resolveLedger>;
  } = {},
): GuardrailsService {
  return new GuardrailsService({
    redis,
    commands: new CommandCounter(),
    nowMs,
    ...(seams.ledger !== undefined ? { ledger: seams.ledger } : {}),
    ...(seams.computeUsage !== undefined ? { computeUsage: seams.computeUsage } : {}),
    ...(seams.r2Stats !== undefined ? { r2Stats: seams.r2Stats } : {}),
  });
}

// ---------------------------------------------------------------------------
// 1. The ledger (defaults, overrides, classification)
// ---------------------------------------------------------------------------

describe("the free-tier limit ledger", () => {
  test("carries the documented defaults with checked-date sources", () => {
    const ledger = resolveLedger({});
    const byId = new Map(ledger.limits.map((limit) => [limit.limitId, limit]));
    expect(byId.get("r2.storage-bytes")!.limit).toBe(10 * 1024 * 1024 * 1024);
    expect(byId.get("r2.class-a-operations")!.limit).toBe(1_000_000);
    expect(byId.get("r2.class-b-operations")!.limit).toBe(10_000_000);
    expect(byId.get("upstash.data-bytes")!.limit).toBe(256 * 1024 * 1024);
    expect(byId.get("upstash.commands")!.limit).toBe(500_000);
    expect(byId.get("neon.storage-bytes")!.limit).toBe(512 * 1024 * 1024);
    expect(byId.get("neon.compute-cu-hours")!.limit).toBe(50);
    expect(byId.get("compute.cpu-ms-day")!.limit).toBe(600_000);
    expect(byId.get("compute.artifact-bytes-day")!.limit).toBe(100_000_000);
    // Every limit rides its checked-date source note.
    for (const limit of ledger.limits) {
      expect(limit.source.length).toBeGreaterThan(0);
    }
    // The honest unknowns are marked unmetered; the metered ones name the seam.
    expect(byId.get("neon.compute-cu-hours")!.metered).toBe(false);
    expect(byId.get("r2.class-a-operations")!.metered).toBe(false);
    expect(byId.get("upstash.data-bytes")!.metered).toBe(false);
    expect(byId.get("r2.storage-bytes")!.metered).toBe(true);
    expect(byId.get("upstash.commands")!.metered).toBe(true);
    expect(byId.get("compute.cpu-ms-day")!.metered).toBe(true);
    expect(ledger.warningRatio).toBe(0.8);
    expect(ledger.overrides).toEqual([]);
  });

  test("applies env overrides and fails loud on invalid ones", () => {
    const env = {
      [limitEnvName("compute.cpu-ms-day")]: "1200",
      [limitEnvName("r2.storage-bytes")]: "1073741824",
    };
    const ledger = resolveLedger(env);
    const byId = new Map(ledger.limits.map((limit) => [limit.limitId, limit]));
    expect(byId.get("compute.cpu-ms-day")!.limit).toBe(1200);
    expect(byId.get("r2.storage-bytes")!.limit).toBe(1073741824);
    // Untouched limits keep their defaults.
    expect(byId.get("compute.artifact-bytes-day")!.limit).toBe(100_000_000);
    expect(ledger.overrides).toHaveLength(2);

    expect(() => resolveLedger({ [limitEnvName("compute.cpu-ms-day")]: "not-a-number" })).toThrow(
      /SPORTA_LIMIT_COMPUTE_CPU_MS_DAY/,
    );
    expect(() => resolveLedger({ [limitEnvName("upstash.commands")]: "-5" })).toThrow(
      /positive number/,
    );
  });

  test("applies the warning-ratio override (and rejects >= 1)", () => {
    const ledger = resolveLedger({ SPORTA_LIMIT_WARNING_RATIO: "0.5" });
    expect(ledger.warningRatio).toBe(0.5);
    expect(() => resolveLedger({ SPORTA_LIMIT_WARNING_RATIO: "1" })).toThrow(/below 1/);
    expect(() => resolveLedger({ SPORTA_LIMIT_WARNING_RATIO: "1.5" })).toThrow(/below 1/);
  });

  test("classifies the usage boundaries (under/approaching/reached/exceeded)", () => {
    expect(classifyUsage(0, 100, 0.8)).toBe("under");
    expect(classifyUsage(79, 100, 0.8)).toBe("under");
    expect(classifyUsage(80, 100, 0.8)).toBe("approaching");
    expect(classifyUsage(99, 100, 0.8)).toBe("approaching");
    expect(classifyUsage(100, 100, 0.8)).toBe("reached");
    expect(classifyUsage(101, 100, 0.8)).toBe("exceeded");
  });
});

// ---------------------------------------------------------------------------
// 2-5. The unit-scope guardrails service (usage meter + quotas + admission)
// ---------------------------------------------------------------------------

describe("the usage meter (per-user daily windows over real records)", () => {
  const now = steppingClock();
  const redis = new InMemoryRedis(now);
  const service = unitService(redis, now);

  test("aggregates two jobs' metered usage into the per-user daily window", async () => {
    const recordedA = await service.noteJobUsage("u-1", "job-a", [
      { unitId: "cpu-ms", quantity: 120.4 },
      { unitId: "artifact-bytes", quantity: 2048 },
      { unitId: "render-requests", quantity: 1 },
    ]);
    expect(recordedA).toBe(true);
    const recordedB = await service.noteJobUsage("u-1", "job-b", [
      { unitId: "cpu-ms", quantity: 33.8 },
      { unitId: "artifact-bytes", quantity: 4096 },
    ]);
    expect(recordedB).toBe(true);
    // Quantities round to integer units (the capability counters are ints).
    expect(await readUserDailyUsage(redis, "cpu-ms", "u-1", now())).toBe(154);
    expect(await readUserDailyUsage(redis, "artifact-bytes", "u-1", now())).toBe(6144);
    // Another user's window is independent.
    expect(await readUserDailyUsage(redis, "cpu-ms", "u-2", now())).toBe(null);
  });

  test("is idempotent per job and skips unattributed usage", async () => {
    const again = await service.noteJobUsage("u-1", "job-a", [
      { unitId: "cpu-ms", quantity: 500 },
    ]);
    expect(again).toBe(false);
    expect(await readUserDailyUsage(redis, "cpu-ms", "u-1", now())).toBe(154);
    const unattributed = await service.noteJobUsage(null, "job-c", [
      { unitId: "cpu-ms", quantity: 999 },
    ]);
    expect(unattributed).toBe(true);
    expect(await readUserDailyUsage(redis, "cpu-ms", "u-1", now())).toBe(154);
  });

  test("keys the window by UTC day (a rolled clock is the next day's key)", async () => {
    const dayKey = calendarDayKey(now());
    const nextDayMs = now() + 24 * 3600 * 1000;
    await service.noteJobUsage("u-3", "job-d", [{ unitId: "cpu-ms", quantity: 10 }]);
    expect(
      await redis.get(userDailyUsageKey("cpu-ms", "u-3", calendarDayKey(nextDayMs))),
    ).toBe(null);
  });
});

describe("the command meter (the RedisLike port's own counter)", () => {
  test("counts every command issued through the MeteredRedis wrapper", async () => {
    const inner = new InMemoryRedis();
    const counter = new CommandCounter();
    const metered = new MeteredRedis(inner, () => counter.note());
    await metered.set("k", "1");
    await metered.get("k");
    await metered.incr("k");
    await metered.ping();
    expect(counter.buffered).toBe(4);
  });

  test("flushes into the monthly counter and converges (no runaway)", async () => {
    const inner = new InMemoryRedis();
    const counter = new CommandCounter();
    const metered = new MeteredRedis(inner, () => counter.note());
    const clock = steppingClock();
    // 10 commands through the port.
    for (let index = 0; index < 10; index += 1) {
      await metered.set(`k-${index}`, String(index));
    }
    expect(counter.buffered).toBe(10);
    const first = await counter.flush(metered, calendarMonthKey(clock()), clock());
    // The flush's own GET+SET are counted into the NEXT buffer (+2), and the
    // persisted total is exactly the 10 flushed.
    expect(first).toEqual({ total: 10, flushed: 10 });
    expect(counter.buffered).toBe(2);
    // A second flush persists those 2 (plus its own 2 into the buffer).
    const second = await counter.flush(metered, calendarMonthKey(clock()), clock());
    expect(second).toEqual({ total: 12, flushed: 2 });
    // The monthly key is the documented one.
    expect(await inner.get(monthlyCommandsKey(calendarMonthKey(clock())))).toBe("12");
  });
});

describe("the per-user quota states (the W901 vocabulary)", () => {
  test("absent counter = zero usage (ok); exhausted at the threshold; corrupt = counter-invalid", async () => {
    const now = steppingClock();
    const redis = new InMemoryRedis(now);
    const service = unitService(redis, now);
    const fresh = await service.userQuotaStates("u-fresh");
    expect(fresh.map((state) => state.quotaId).sort()).toEqual([
      "compute.artifact-bytes-day",
      "compute.cpu-ms-day",
    ]);
    expect(fresh[0]).toMatchObject({ used: 0, reasonCode: "ok", exhausted: false });

    await service.noteJobUsage("u-hot", "job-1", [{ unitId: "cpu-ms", quantity: 600_000 }]);
    const hot = await service.userQuotaStates("u-hot");
    const cpu = hot.find((state) => state.quotaId === "compute.cpu-ms-day")!;
    expect(cpu).toMatchObject({
      used: 600_000,
      limit: 600_000,
      remaining: 0,
      exhausted: true,
      reasonCode: "quota-exhausted",
    });

    // A corrupt counter value is the fail-closed counter-invalid entry.
    const clock = steppingClock();
    await redis.set(userDailyUsageKey("cpu-ms", "u-corrupt", calendarDayKey(clock())), "garbage");
    const corruptService = unitService(redis, clock);
    const corrupt = await corruptService.userQuotaStates("u-corrupt");
    expect(corrupt.find((state) => state.quotaId === "compute.cpu-ms-day")).toMatchObject({
      used: null,
      limit: null,
      exhausted: true,
      reasonCode: "quota-counter-invalid",
    });
  });
});

describe("fail-closed provider-capacity admission", () => {
  function lowLedger(overrides: Record<string, string>): ReturnType<typeof resolveLedger> {
    return resolveLedger(overrides);
  }

  test("passes when everything is under the thresholds", async () => {
    const now = steppingClock();
    const service = unitService(new InMemoryRedis(now), now);
    await expect(service.checkAdmission("u-ok")).resolves.toBeUndefined();
  });

  test("refuses at the per-user cpu-ms quota with the real reason (reads, no writes)", async () => {
    const now = steppingClock();
    const redis = new InMemoryRedis(now);
    const ledger = lowLedger({ [limitEnvName("compute.cpu-ms-day")]: "100" });
    const service = unitService(redis, now, { ledger });
    await service.noteJobUsage("u-1", "job-1", [{ unitId: "cpu-ms", quantity: 100 }]);
    let refusal: unknown;
    try {
      await service.checkAdmission("u-1");
      throw new Error("expected a refusal");
    } catch (err) {
      refusal = err;
    }
    const error = refusal as InstanceType<
      typeof import("../src/server/platform/guardrails").ProviderCapacityLimitError
    >;
    expect(error.name).toBe("ProviderCapacityLimitError");
    expect(error.status).toBe(503);
    expect(error.failureClass).toBe("capacity-exceeded");
    expect(error.scope).toBe("user");
    expect(error.reasonCode).toBe("limit-reached");
    expect(error.evaluation.limitId).toBe("compute.cpu-ms-day");
    expect(error.evaluation.used).toBe(100);
    expect(error.evaluation.limit).toBe(100);
    expect(error.evaluation.state).toBe("reached");
    expect(error.message).toContain("compute.cpu-ms-day");
    // The refusal's retry-after is the seconds to the next UTC day (>= 1).
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("refuses at the per-user artifact-bytes quota (exceeded past the threshold)", async () => {
    const now = steppingClock();
    const redis = new InMemoryRedis(now);
    const ledger = lowLedger({ [limitEnvName("compute.artifact-bytes-day")]: "1000" });
    const service = unitService(redis, now, { ledger });
    await service.noteJobUsage("u-2", "job-2", [{ unitId: "artifact-bytes", quantity: 1500 }]);
    await expect(service.checkAdmission("u-2")).rejects.toMatchObject({
      name: "ProviderCapacityLimitError",
      reasonCode: "limit-exceeded",
      evaluation: { limitId: "compute.artifact-bytes-day", state: "exceeded", used: 1500 },
    });
  });

  test("refuses at the GLOBAL R2 storage allowance (a configured store at the threshold)", async () => {
    const now = steppingClock();
    const ledger = lowLedger({ [limitEnvName("r2.storage-bytes")]: "5000" });
    const service = unitService(new InMemoryRedis(now), now, {
      ledger,
      r2Stats: async () => ({ segments: 12, totalBytes: 5000, duplicateStores: 0 }),
    });
    await expect(service.checkAdmission("u-3")).rejects.toMatchObject({
      name: "ProviderCapacityLimitError",
      scope: "provider",
      reasonCode: "limit-reached",
      evaluation: { limitId: "r2.storage-bytes", provider: "r2", used: 5000, limit: 5000 },
    });
    // The refusal's message carries the provider-side reason honestly.
    await expect(service.checkAdmission("u-3")).rejects.toThrow(
      /precedes the provider's own hard failure/,
    );
  });

  test("an UNCONFIGURED store honestly does not apply (no refusal, no fabrication)", async () => {
    const now = steppingClock();
    const service = unitService(new InMemoryRedis(now), now, {
      r2Stats: async () => null,
    });
    await expect(service.checkAdmission("u-4")).resolves.toBeUndefined();
  });

  test("refuses at the GLOBAL Upstash command budget (the shared counter at the threshold)", async () => {
    const now = steppingClock();
    const redis = new InMemoryRedis(now);
    const ledger = lowLedger({ [limitEnvName("upstash.commands")]: "42" });
    // Pre-seed the monthly command counter at its threshold (the port meter's
    // own persistence target).
    await redis.set(monthlyCommandsKey(calendarMonthKey(now())), "42", { ex: 3600 });
    const service = unitService(redis, now, { ledger });
    await expect(service.checkAdmission("u-5")).rejects.toMatchObject({
      name: "ProviderCapacityLimitError",
      scope: "provider",
      evaluation: { limitId: "upstash.commands", used: 42, limit: 42 },
    });
  });

  test("FAIL-CLOSED: an unreadable user counter refuses (limit-check-unreadable)", async () => {
    const now = steppingClock();
    const service = unitService(new UnreadableRedis(), now);
    await expect(service.checkAdmission("u-6")).rejects.toMatchObject({
      name: "ProviderCapacityLimitError",
      reasonCode: "limit-check-unreadable",
      scope: "user",
    });
  });
});

describe("spend alarms (window-scoped, persisted transitions)", () => {
  test("records under → approaching → reached transitions; stable observations write nothing", async () => {
    const now = steppingClock();
    const redis = new InMemoryRedis(now);
    const ledger = resolveLedger({ [limitEnvName("compute.cpu-ms-day")]: "100" });
    const service = unitService(redis, now, { ledger });

    // under (0 usage) — first observation records the state.
    let evaluation = await service.evaluateLimits("u-1");
    let cpuAlarm = evaluation.alarms.find((alarm) => alarm.limitId === "compute.cpu-ms-day")!;
    expect(cpuAlarm.state).toBe("under");
    expect(cpuAlarm.transitioned).toBe(true);
    expect(cpuAlarm.previousState).toBe(null);
    const underStamp = cpuAlarm.changedAtMs;

    // Still under — no transition, no write.
    evaluation = await service.evaluateLimits("u-1");
    cpuAlarm = evaluation.alarms.find((alarm) => alarm.limitId === "compute.cpu-ms-day")!;
    expect(cpuAlarm.transitioned).toBe(false);
    expect(cpuAlarm.changedAtMs).toBe(underStamp);

    // approaching (>= 80% of 100).
    await service.noteJobUsage("u-1", "job-1", [{ unitId: "cpu-ms", quantity: 85 }]);
    evaluation = await service.evaluateLimits("u-1");
    cpuAlarm = evaluation.alarms.find((alarm) => alarm.limitId === "compute.cpu-ms-day")!;
    expect(cpuAlarm.state).toBe("approaching");
    expect(cpuAlarm.transitioned).toBe(true);
    expect(cpuAlarm.previousState).toBe("under");

    // reached (>= 100).
    await service.noteJobUsage("u-1", "job-2", [{ unitId: "cpu-ms", quantity: 15 }]);
    evaluation = await service.evaluateLimits("u-1");
    cpuAlarm = evaluation.alarms.find((alarm) => alarm.limitId === "compute.cpu-ms-day")!;
    expect(cpuAlarm.state).toBe("reached");
    expect(cpuAlarm.previousState).toBe("approaching");

    // The alarm state is PERSISTED at the window-scoped key (read back raw).
    const persisted = await redis.get(alarmKey("compute.cpu-ms-day", calendarDayKey(now())));
    expect(persisted).not.toBe(null);
    expect(JSON.parse(persisted!)).toMatchObject({
      limitId: "compute.cpu-ms-day",
      state: "reached",
      used: 100,
    });
  });

  test("recovery is a transition (the window rolls → the new day's key is under)", async () => {
    const now = steppingClock();
    const redis = new InMemoryRedis(now);
    const ledger = resolveLedger({ [limitEnvName("compute.cpu-ms-day")]: "100" });
    const service = unitService(redis, now, { ledger });
    await service.noteJobUsage("u-2", "job-1", [{ unitId: "cpu-ms", quantity: 100 }]);
    const reached = (await service.evaluateLimits("u-2")).alarms.find(
      (alarm) => alarm.limitId === "compute.cpu-ms-day",
    )!;
    expect(reached.state).toBe("reached");
    // The next UTC day is a NEW window key — a fresh (under) alarm state.
    const nextDayClock = () => now() + 24 * 3600 * 1000;
    const nextDayService = unitService(redis, nextDayClock, { ledger });
    const recovered = (await nextDayService.evaluateLimits("u-2")).alarms.find(
      (alarm) => alarm.limitId === "compute.cpu-ms-day",
    )!;
    expect(recovered.state).toBe("under");
    expect(recovered.transitioned).toBe(true);
  });

  test("unmetered seams evaluate to the honest unmeasured state (never a number)", async () => {
    const now = steppingClock();
    const service = unitService(new InMemoryRedis(now), now, {
      r2Stats: async () => null,
    });
    const evaluation = await service.evaluateLimits();
    const byId = new Map(evaluation.limits.map((limit) => [limit.limitId, limit]));
    expect(byId.get("r2.class-a-operations")).toMatchObject({ state: "unmeasured", used: null });
    expect(byId.get("r2.class-b-operations")).toMatchObject({ state: "unmeasured", used: null });
    expect(byId.get("upstash.data-bytes")).toMatchObject({ state: "unmeasured", used: null });
    expect(byId.get("neon.compute-cu-hours")).toMatchObject({ state: "unmeasured", used: null });
    expect(byId.get("r2.storage-bytes")).toMatchObject({
      state: "unmeasured",
      used: null,
      limit: 10 * 1024 * 1024 * 1024,
    });
  });
});

// ---------------------------------------------------------------------------
// 6-10. Route-level (hermetic compositions over the REAL route handlers)
// ---------------------------------------------------------------------------

/** Polls one dispatched job to a terminal state (the UI's own poll path). */
async function pollToTerminal(
  token: string,
  sessionId: string,
  jobId: string,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await jobRoute(
      withCookie(token, `/api/create/sessions/${sessionId}/jobs/${jobId}`),
      { params: Promise.resolve({ sessionId, jobId }) },
    );
    expect(response.status).toBe(200);
    const job = await bodyOf(response);
    const state = job.state as string;
    if (
      state === "succeeded" ||
      state === "failed" ||
      state === "cancelled" ||
      state === "dead-lettered"
    ) {
      return job;
    }
  }
  throw new Error(`job ${jobId} did not settle`);
}

/** Registers a creator and issues their session token. */
async function creatorOf(server: SportaServer, username: string): Promise<string> {
  const registered = await server.auth.register({
    username,
    password: "a-real-studio-password",
    roles: ["creator", "viewer"],
  });
  return (await server.auth.issueSession({ userId: registered.userId })).token;
}

/** Creates one studio session through the REAL route. */
async function studioSessionOf(token: string): Promise<string> {
  const response = await createSessionRoute(
    withCookie(
      token,
      "/api/create/sessions",
      post({ sourceKey: "derby", operations: ["analysis", "transformation", "storage"] }),
    ),
  );
  expect(response.status).toBe(201);
  return ((await bodyOf(response)) as { sessionId: string }).sessionId;
}

describe("W919 route evidence (default ledger, real seams)", () => {
  let server: SportaServer;
  let creatorToken = "";
  let operatorToken = "";
  let creatorUserId = "";
  let sessionId = "";

  beforeAll(async () => {
    server = createSportaServer({
      nowMs: steppingClock(),
      passwordHasher: createDeterministicTestHasher(),
      transient: { redis: new InMemoryRedis(steppingClock()), provider: "in-memory" },
      seed: true,
    });
    installSportaServerForTests(server);
    await server.ready;
    const registered = await server.auth.register({
      username: "w919-creator",
      password: "a-real-studio-password",
      roles: ["creator", "viewer"],
    });
    creatorUserId = registered.userId;
    creatorToken = (await server.auth.issueSession({ userId: registered.userId })).token;
    const operator = await server.accounts.create({
      username: "w919-operator",
      email: undefined,
      passwordHash: "not-a-login-path",
      roles: ["operator", "viewer"],
      createdAtIso: new Date(BASE_MS).toISOString(),
    });
    operatorToken = (await server.auth.issueSession({ userId: operator.userId })).token;
    sessionId = await studioSessionOf(creatorToken);
  });

  test("a real dispatch's metered usage reaches the capability quotas[] (usage-counter snapshot)", async () => {
    // One REAL render through the full admission ladder.
    const dispatch = await dispatchRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}/renders`, post({
        rendererId: "anime.prototype",
      })),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(dispatch.status).toBe(202);
    const dispatched = (await bodyOf(dispatch)) as { jobId: string };
    const job = await pollToTerminal(creatorToken, sessionId, dispatched.jobId);
    expect(job.state).toBe("succeeded");
    const completion = job.completion as {
      usage: { unitId: string; quantity: number }[];
    } | undefined;
    expect(completion).toBeDefined();
    const units = new Map(completion!.usage.map((unit) => [unit.unitId, unit.quantity]));
    expect(units.get("cpu-ms")!).toBeGreaterThan(0);
    expect(units.get("artifact-bytes")!).toBeGreaterThan(0);

    // The capability response carries the per-user daily usage counters.
    const capability = await capabilityRoute(withCookie(creatorToken, "/api/capability"));
    expect(capability.status).toBe(200);
    const body = (await bodyOf(capability)) as {
      quotas: { quotaId: string; used: number; limit: number; reasonCode: string }[];
      overall: { state: string; reasonCodes: string[] };
    };
    const byId = new Map(body.quotas.map((quota) => [quota.quotaId, quota]));
    expect(byId.get("compute.cpu-ms-day")!.used).toBe(units.get("cpu-ms")!);
    expect(byId.get("compute.artifact-bytes-day")!.used).toBe(units.get("artifact-bytes")!);
    expect(byId.get("compute.cpu-ms-day")!.reasonCode).toBe("ok");
    expect(body.overall.state).toBe("ready");
  });

  test("the console surfaces the ledger evaluation + the persisted alarms", async () => {
    const providers = await operationsProvidersRoute(
      withCookie(operatorToken, "/api/operations/providers"),
    );
    expect(providers.status).toBe(200);
    const providersBody = (await bodyOf(providers)) as {
      providers: {
        provider: string;
        limitStates: { limitId: string; used: number | null; state: string }[];
      }[];
    };
    const compute = providersBody.providers.find((row) => row.provider === "compute")!;
    const states = new Map(compute.limitStates.map((state) => [state.limitId, state]));
    expect(states.get("compute.cpu-ms-day")!.used).toBeGreaterThan(0);
    expect(states.get("compute.cpu-ms-day")!.state).toBe("under");

    const health = await operationsHealthRoute(
      withCookie(operatorToken, "/api/operations/health"),
    );
    expect(health.status).toBe(200);
    const healthBody = (await bodyOf(health)) as {
      spendAlarms: {
        limitId: string;
        provider: string;
        state: string;
        used: number | null;
        unit: string;
      }[];
    };
    const alarm = healthBody.spendAlarms.find((row) => row.limitId === "compute.cpu-ms-day")!;
    expect(alarm.provider).toBe("compute");
    expect(alarm.used).toBeGreaterThan(0);
    expect(alarm.unit).toBe("ms");
    // Every documented limit has an alarm view (honest unmeasured included).
    expect(healthBody.spendAlarms.length).toBe(9);
  });
});

describe("W919 limit-crossed degradation + fail-closed admission (cpu-ms threshold at 1ms)", () => {
  let server: SportaServer;
  let creatorToken = "";
  let creatorUserId = "";
  let sessionId = "";
  let playbackScope: { sessionId: string; renderId: string; segmentId: string };
  /** The seeded playback document BEFORE any limit is crossed (byte-proof). */
  let playbackBefore: string | null = null;

  beforeAll(async () => {
    // The ledger's documented configurability: the cpu-ms admission quota at
    // 1ms (a single real render exceeds it — the usage stays REAL, the
    // THRESHOLD is configured).
    process.env.SPORTA_LIMIT_COMPUTE_CPU_MS_DAY = "1";
    server = createSportaServer({
      nowMs: steppingClock(),
      passwordHasher: createDeterministicTestHasher(),
      transient: { redis: new InMemoryRedis(steppingClock()), provider: "in-memory" },
      seed: true,
    });
    installSportaServerForTests(server);
    await server.ready;
    const registered = await server.auth.register({
      username: "w919-tight-creator",
      password: "a-real-studio-password",
      roles: ["creator", "viewer"],
    });
    creatorUserId = registered.userId;
    creatorToken = (await server.auth.issueSession({ userId: registered.userId })).token;
    sessionId = await studioSessionOf(creatorToken);

    // The seeded session's playback scope (for Simulation E's last rule).
    const { sessions } = await server.control.listSessions();
    outer: for (const entry of sessions) {
      const { renders } = await server.control.listRenders(entry.id);
      for (const render of renders) {
        const outputs = await server.control.listRenderOutputs(entry.id, render.renderId);
        if (outputs.segments.length > 0) {
          playbackScope = {
            sessionId: entry.id,
            renderId: render.renderId,
            segmentId: outputs.segments[0]!.segmentId,
          };
          break outer;
        }
      }
    }
  });

  afterAll(() => {
    delete process.env.SPORTA_LIMIT_COMPUTE_CPU_MS_DAY;
  });

  test("one real render's metered usage crosses the threshold → the capability degrades (Simulation E)", async () => {
    // The seeded playback is available BEFORE the limit is crossed (its
    // bytes are captured for the after-refusal byte-identity proof).
    const before = await watchOutputRoute(
      new Request(
        `http://sporta.test/api/watch/${playbackScope.sessionId}/renders/${playbackScope.renderId}/outputs/${playbackScope.segmentId}`,
      ),
      { params: Promise.resolve(playbackScope) },
    );
    expect(before.status).toBe(200);
    playbackBefore = await before.text();

    const dispatch = await dispatchRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}/renders`, post({
        rendererId: "anime.prototype",
      })),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(dispatch.status).toBe(202);
    const dispatched = (await bodyOf(dispatch)) as { jobId: string };
    const job = await pollToTerminal(creatorToken, sessionId, dispatched.jobId);
    expect(job.state).toBe("succeeded");
    const completion = job.completion as { usage: { unitId: string; quantity: number }[] };
    expect(completion.usage.find((unit) => unit.unitId === "cpu-ms")!.quantity).toBeGreaterThan(1);

    const capability = await capabilityRoute(withCookie(creatorToken, "/api/capability"));
    expect(capability.status).toBe(200);
    const body = (await bodyOf(capability)) as {
      quotas: {
        quotaId: string;
        used: number | null;
        limit: number | null;
        exhausted: boolean;
        reasonCode: string;
      }[];
      overall: { state: string; reasonCodes: string[] };
    };
    const cpu = body.quotas.find((quota) => quota.quotaId === "compute.cpu-ms-day")!;
    expect(cpu.used!).toBeGreaterThan(1);
    expect(cpu.limit).toBe(1);
    expect(cpu.exhausted).toBe(true);
    expect(cpu.reasonCode).toBe("quota-exhausted");
    expect(body.overall.state).toBe("degraded");
    expect(body.overall.reasonCodes).toContain("quota-exhausted");
  });

  test("the next dispatch is REFUSED before the provider runs, with the real reason (Simulation E)", async () => {
    const queueDepthBefore = await server.transientState.queue.depth();
    const renderQuotaBefore = await server.transientState.quotas.peek(
      RENDER_REQUESTS_QUOTA,
      creatorUserId,
    );

    const refusal = await dispatchRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}/renders`, post({
        rendererId: "anime.prototype",
      })),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(refusal.status).toBe(503);
    expect(refusal.headers.get("retry-after")).toMatch(/^\d+$/);
    const body = (await bodyOf(refusal)) as {
      error: {
        failureClass: string;
        message: string;
        details: {
          scope: string;
          reasonCode: string;
          limit: { limitId: string; provider: string; state: string; used: number; limit: number };
        };
      };
    };
    expect(body.error.failureClass).toBe("capacity-exceeded");
    expect(body.error.details.scope).toBe("user");
    expect(body.error.details.reasonCode).toBe("limit-exceeded");
    expect(body.error.details.limit).toMatchObject({
      limitId: "compute.cpu-ms-day",
      provider: "compute",
      state: "exceeded",
      limit: 1,
    });
    expect(body.error.details.limit.used).toBeGreaterThan(1);
    expect(body.error.message).toContain("compute.cpu-ms-day");

    // The refused job never entered the bounded queue.
    expect(await server.transientState.queue.depth()).toBe(queueDepthBefore);
    // Reads before writes: the capacity refusal did NOT charge the caller's
    // render-requests quota (the W913 rung runs only past the W919 rung).
    const renderQuotaAfter = await server.transientState.quotas.peek(
      RENDER_REQUESTS_QUOTA,
      creatorUserId,
    );
    expect(renderQuotaAfter.used).toBe(renderQuotaBefore.used);
  });

  test("existing authorized playback REMAINS AVAILABLE after the admission refusal (Simulation E's last rule)", async () => {
    // Playback serves the REAL segment document (the W504/W902 contract: a
    // 200 JSON document with the artifact-source header — the honest in-memory
    // backing here, R2-presigned bytes when configured).
    const response = await watchOutputRoute(
      new Request(
        `http://sporta.test/api/watch/${playbackScope.sessionId}/renders/${playbackScope.renderId}/outputs/${playbackScope.segmentId}`,
      ),
      { params: Promise.resolve(playbackScope) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-sporta-artifact-source")).toBe("in-memory");
    const playbackAfter = await response.text();
    expect(playbackAfter.length).toBeGreaterThan(0);
    // BYTE-IDENTICAL to the pre-limit playback: the guardrails refuse new
    // expensive work but never touch an authorized read.
    expect(playbackAfter).toBe(playbackBefore!);
  });

  test("the console's alarm view shows the crossed limit (reached/exceeded, window-scoped)", async () => {
    const operator = await server.accounts.create({
      username: "w919-tight-operator",
      email: undefined,
      passwordHash: "not-a-login-path",
      roles: ["operator", "viewer"],
      createdAtIso: new Date(BASE_MS).toISOString(),
    });
    const token = (await server.auth.issueSession({ userId: operator.userId })).token;
    const health = await operationsHealthRoute(withCookie(token, "/api/operations/health"));
    expect(health.status).toBe(200);
    const body = (await bodyOf(health)) as {
      spendAlarms: { limitId: string; state: string; used: number | null }[];
    };
    const cpuAlarm = body.spendAlarms.find((row) => row.limitId === "compute.cpu-ms-day")!;
    expect(cpuAlarm.state).toBe("exceeded");
    expect(cpuAlarm.used!).toBeGreaterThan(1);
  });
});
