/**
 * Unit tests for the deterministic retry engine (W104 §3.2).
 *
 * The clock is ALWAYS an injected recording fake: the sleep sequence is
 * asserted exactly (pure arithmetic `base * multiplier^(attempt-1)`), so the
 * tests prove the engine never touches real timers. Builders with fixed
 * seeds; explicit watermarks; no Date.now, no Math.random.
 */
import { describe, expect, test } from "bun:test";
import { buildStageMessage } from "@sporta/testing";
import type { StageMessage, StageResult } from "@sporta/contracts";
import {
  validateRetryOptions,
  withRetries,
  type RetryClock,
  type RetryOptions,
} from "../src/retry";

const SEED = 2_025_010_610;
const MESSAGE: StageMessage = buildStageMessage(
  { sessionId: "sess-retry", sequence: 7, watermark: { watermarkMs: 280, sequence: 7 } },
  SEED,
);

/** A recording fake clock — sleeps are recorded, never really slept. */
function recordingClock(): { clock: RetryClock; sleeps: number[] } {
  const sleeps: number[] = [];
  return {
    clock: {
      sleep: (ms: number) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    },
    sleeps,
  };
}

/** Options with the retry-test defaults; per-test overrides win. */
function opts(overrides: Partial<RetryOptions> = {}): RetryOptions {
  return { maxAttempts: 3, baseDelayMs: 5, backoffMultiplier: 2, ...overrides };
}

function okResult(): StageResult {
  return {
    sessionId: MESSAGE.sessionId,
    stage: "retry-test",
    status: "ok",
    watermarkAfter: { watermarkMs: 320, sequence: 8 },
    latencyMs: 1,
    retryable: false,
  };
}

function failedResult(overrides: Partial<StageResult> = {}): StageResult {
  return {
    sessionId: MESSAGE.sessionId,
    stage: "retry-test",
    status: "failed",
    watermarkAfter: MESSAGE.watermark,
    latencyMs: 1,
    retryable: true,
    errorClass: "transient",
    ...overrides,
  };
}

function degradedResult(): StageResult {
  return {
    sessionId: MESSAGE.sessionId,
    stage: "retry-test",
    status: "degraded",
    watermarkAfter: { watermarkMs: 300, sequence: 8 },
    latencyMs: 1,
    retryable: false,
    errorClass: "partial",
  };
}

describe("withRetries", () => {
  test("ok on the first try: attempts 1, no sleeps", async () => {
    const { clock, sleeps } = recordingClock();
    let calls = 0;
    const outcome = await withRetries(
      MESSAGE,
      async () => {
        calls += 1;
        return okResult();
      },
      { ...opts(), clock },
    );
    expect(calls).toBe(1);
    expect(outcome.attempts).toBe(1);
    expect(outcome.retriesUsed).toBe(0);
    expect(outcome.status).toBe("ok");
    expect(sleeps).toEqual([]);
  });

  test("fails then succeeds: attempts 2, retriesUsed 1, sleep sequence exactly [base]", async () => {
    const { clock, sleeps } = recordingClock();
    let calls = 0;
    const outcome = await withRetries(
      MESSAGE,
      async () => {
        calls += 1;
        return calls === 1 ? failedResult() : okResult();
      },
      { ...opts(), clock },
    );
    expect(outcome.attempts).toBe(2);
    expect(outcome.retriesUsed).toBe(1);
    expect(outcome.status).toBe("ok");
    expect(outcome.watermarkAfter).toEqual({ watermarkMs: 320, sequence: 8 });
    expect(sleeps).toEqual([5]);
  });

  test("non-retryable failure returns immediately: attempts 1, no sleeps", async () => {
    const { clock, sleeps } = recordingClock();
    let calls = 0;
    const outcome = await withRetries(
      MESSAGE,
      async () => {
        calls += 1;
        return failedResult({ retryable: false, errorClass: "permanent" });
      },
      { ...opts(), clock },
    );
    expect(calls).toBe(1);
    expect(outcome.attempts).toBe(1);
    expect(outcome.retriesUsed).toBe(0);
    expect(outcome.status).toBe("failed");
    expect(sleeps).toEqual([]);
  });

  test("exponential backoff: sleep sequence is exactly [b, b*m, b*m^2]", async () => {
    const { clock, sleeps } = recordingClock();
    let calls = 0;
    const outcome = await withRetries(
      MESSAGE,
      async () => {
        calls += 1;
        return failedResult();
      },
      { maxAttempts: 4, baseDelayMs: 5, backoffMultiplier: 3, clock },
    );
    expect(outcome.attempts).toBe(4);
    expect(calls).toBe(4);
    expect(sleeps).toEqual([5, 15, 45]);
  });

  test("zero base delay sleeps [0] per retry (pure arithmetic, no special cases)", async () => {
    const { clock, sleeps } = recordingClock();
    let calls = 0;
    const outcome = await withRetries(
      MESSAGE,
      async () => {
        calls += 1;
        return calls === 1 ? failedResult() : okResult();
      },
      { ...opts({ baseDelayMs: 0, backoffMultiplier: 2 }), clock },
    );
    expect(outcome.status).toBe("ok");
    expect(sleeps).toEqual([0]);
  });

  test("maxAttempts exhaustion returns the LAST StageResult verbatim", async () => {
    const { clock, sleeps } = recordingClock();
    let calls = 0;
    const last = () => failedResult({ errorClass: `attempt-${calls}` });
    const outcome = await withRetries(
      MESSAGE,
      async () => {
        calls += 1;
        return last();
      },
      { ...opts({ maxAttempts: 3, backoffMultiplier: 2 }), clock },
    );
    expect(calls).toBe(3);
    expect(outcome).toMatchObject({
      status: "failed",
      attempts: 3,
      retriesUsed: 2,
      errorClass: "attempt-3", // the LAST failure, never swallowed
      latencyMs: 1,
    });
    expect(outcome.watermarkAfter).toEqual(MESSAGE.watermark);
    expect(sleeps).toEqual([5, 10]);
  });

  test("degraded is success class: returned immediately, never retried", async () => {
    const { clock, sleeps } = recordingClock();
    let calls = 0;
    const outcome = await withRetries(
      MESSAGE,
      async () => {
        calls += 1;
        return degradedResult();
      },
      { ...opts(), clock },
    );
    expect(calls).toBe(1);
    expect(outcome.attempts).toBe(1);
    expect(outcome.retriesUsed).toBe(0);
    expect(outcome.status).toBe("degraded");
    expect(sleeps).toEqual([]);
  });

  test("the retryable predicate overrides the result's own retryable flag", async () => {
    const { clock, sleeps } = recordingClock();
    // retryable: true on the result, but the predicate refuses → no retry.
    let calls = 0;
    const refused = await withRetries(
      MESSAGE,
      async () => {
        calls += 1;
        return failedResult({ retryable: true });
      },
      { ...opts(), clock, retryable: () => false },
    );
    expect(refused.attempts).toBe(1);
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
    // retryable: false on the result, but the predicate insists → retried.
    const { clock: clock2, sleeps: sleeps2 } = recordingClock();
    let calls2 = 0;
    const insisted = await withRetries(
      MESSAGE,
      async () => {
        calls2 += 1;
        return calls2 === 1 ? failedResult({ retryable: false }) : okResult();
      },
      { ...opts(), clock: clock2, retryable: () => true },
    );
    expect(insisted.attempts).toBe(2);
    expect(insisted.status).toBe("ok");
    expect(sleeps2).toEqual([5]);
  });

  test("the stage receives the same message object on every attempt", async () => {
    const { clock } = recordingClock();
    const seen: StageMessage[] = [];
    await withRetries(
      MESSAGE,
      async (msg) => {
        seen.push(msg);
        return failedResult();
      },
      { ...opts({ maxAttempts: 2 }), clock },
    );
    expect(seen).toEqual([MESSAGE, MESSAGE]);
  });

  test("invalid options fail loud (pre-validation and at the engine boundary)", async () => {
    expect(() => validateRetryOptions(opts({ maxAttempts: 0 }))).toThrow(RangeError);
    expect(() => validateRetryOptions(opts({ baseDelayMs: -1 }))).toThrow(RangeError);
    expect(() => validateRetryOptions(opts({ backoffMultiplier: 0.5 }))).toThrow(RangeError);
    await expect(
      withRetries(MESSAGE, async () => okResult(), opts({ maxAttempts: 0 })),
    ).rejects.toThrow(RangeError);
  });
});
