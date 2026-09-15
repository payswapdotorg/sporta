/**
 * Live backoff tests (W704): the PURE, deterministic reconnect schedule —
 * the documented table itself (the schedule IS the contract), the decision
 * function over `(failureClass, attemptsSoFar)`, the retryability table for
 * EVERY W305 failure class, and the honest refusals (no delay is ever
 * invented for a forbidden attempt).
 */
import { describe, expect, test } from "bun:test";
import {
  LIVE_RECONNECT_BASE_DELAY_MS,
  LIVE_RECONNECT_MAX_ATTEMPTS,
  LIVE_RECONNECT_MAX_DELAY_MS,
  LIVE_RECONNECT_SCHEDULE_MS,
  LIVE_RETRYABLE_FAILURE_CLASSES,
  isLiveRetryableFailureClass,
  liveReconnectDecision,
  liveReconnectDelayMs,
} from "../src/live-backoff.ts";

/** The complete W305 failure-class vocabulary (transport-failed + the verdicts). */
const W305_CLASSES = [
  "rights-denied",
  "rights-lapsed",
  "transport-failed",
  "negotiation-failed",
  "negotiation-violation",
  "integrity-violation",
  "protocol-violation",
] as const;

describe("live-backoff — the documented schedule (test-pinned table)", () => {
  test("the constants are the documented decision", () => {
    expect(LIVE_RECONNECT_BASE_DELAY_MS).toBe(500);
    expect(LIVE_RECONNECT_MAX_DELAY_MS).toBe(4_000);
    expect(LIVE_RECONNECT_MAX_ATTEMPTS).toBe(4);
  });

  test("the schedule is exactly [500, 1000, 2000, 4000] ms (one entry per permitted attempt)", () => {
    expect(LIVE_RECONNECT_SCHEDULE_MS).toEqual([500, 1_000, 2_000, 4_000]);
    expect(LIVE_RECONNECT_SCHEDULE_MS).toHaveLength(LIVE_RECONNECT_MAX_ATTEMPTS);
  });

  test("liveReconnectDelayMs walks the table (attempt 0 is immediate)", () => {
    expect(liveReconnectDelayMs(0)).toBe(0);
    expect(liveReconnectDelayMs(1)).toBe(500);
    expect(liveReconnectDelayMs(2)).toBe(1_000);
    expect(liveReconnectDelayMs(3)).toBe(2_000);
    expect(liveReconnectDelayMs(4)).toBe(4_000);
  });

  test("the delay function refuses forbidden attempts and garbage (never invents a delay)", () => {
    expect(() => liveReconnectDelayMs(5)).toThrow(RangeError);
    expect(() => liveReconnectDelayMs(100)).toThrow(RangeError);
    expect(() => liveReconnectDelayMs(-1)).toThrow(RangeError);
    expect(() => liveReconnectDelayMs(1.5)).toThrow(RangeError);
    expect(() => liveReconnectDelayMs(Number.NaN)).toThrow(RangeError);
  });

  test("determinism: the same attempt always yields the same delay (no jitter, no clock reads)", () => {
    for (let attempt = 1; attempt <= LIVE_RECONNECT_MAX_ATTEMPTS; attempt += 1) {
      const first = liveReconnectDelayMs(attempt);
      for (let i = 0; i < 5; i += 1) expect(liveReconnectDelayMs(attempt)).toBe(first);
    }
  });
});

describe("live-backoff — the retryability table (every W305 class pinned)", () => {
  test("exactly connection-lost and transport-failed reconnect", () => {
    expect([...LIVE_RETRYABLE_FAILURE_CLASSES].sort()).toEqual(["connection-lost", "transport-failed"]);
  });

  test("every W305 class has a pinned verdict (the table is total over the vocabulary)", () => {
    const verdicts: Record<string, boolean> = {
      "connection-lost": true,
      "transport-failed": true,
      "rights-denied": false,
      "rights-lapsed": false,
      "negotiation-failed": false,
      "negotiation-violation": false,
      "integrity-violation": false,
      "protocol-violation": false,
    };
    for (const [failureClass, retryable] of Object.entries(verdicts)) {
      expect(isLiveRetryableFailureClass(failureClass), failureClass).toBe(retryable);
    }
    // The table covers every W305 class exactly (no orphans, no gaps).
    expect(Object.keys(verdicts).sort()).toEqual([...W305_CLASSES, "connection-lost"].sort());
  });

  test("unknown classes are NOT retryable (fail-closed: a foreign class never reconnects)", () => {
    expect(isLiveRetryableFailureClass("unknown-class")).toBe(false);
    expect(isLiveRetryableFailureClass("")).toBe(false);
    expect(isLiveRetryableFailureClass("TRANSPORT-FAILED")).toBe(false);
  });
});

describe("live-backoff — the reconnect decision (pure over class × attempts)", () => {
  test("a retryable class with attempts remaining: the next attempt + its scheduled delay", () => {
    expect(liveReconnectDecision("connection-lost", 0)).toEqual({
      action: "reconnect",
      attempt: 1,
      delayMs: 500,
    });
    expect(liveReconnectDecision("transport-failed", 1)).toEqual({
      action: "reconnect",
      attempt: 2,
      delayMs: 1_000,
    });
    expect(liveReconnectDecision("connection-lost", 2)).toEqual({
      action: "reconnect",
      attempt: 3,
      delayMs: 2_000,
    });
    expect(liveReconnectDecision("transport-failed", 3)).toEqual({
      action: "reconnect",
      attempt: 4,
      delayMs: 4_000,
    });
  });

  test("a retryable class AT the cap: terminal / attempts-exhausted (never a 5th attempt)", () => {
    expect(liveReconnectDecision("connection-lost", 4)).toEqual({
      action: "terminal",
      reason: "attempts-exhausted",
    });
    expect(liveReconnectDecision("transport-failed", 40)).toEqual({
      action: "terminal",
      reason: "attempts-exhausted",
    });
  });

  test("NON-retryable classes are terminal at ANY attempt count (the class check runs first — never a retry storm)", () => {
    // A rights denial at attempt 0 must NOT reconnect even though attempts
    // remain — repeating the request cannot conjure the capability.
    for (const failureClass of [
      "rights-denied",
      "rights-lapsed",
      "negotiation-failed",
      "negotiation-violation",
      "integrity-violation",
      "protocol-violation",
    ] as const) {
      for (const attemptsSoFar of [0, 1, 3]) {
        expect(liveReconnectDecision(failureClass, attemptsSoFar), `${failureClass}@${attemptsSoFar}`).toEqual(
          { action: "terminal", reason: "non-retryable" },
        );
      }
    }
  });

  test("unknown failure classes are terminal / non-retryable (fail-closed)", () => {
    expect(liveReconnectDecision("something-new", 0)).toEqual({
      action: "terminal",
      reason: "non-retryable",
    });
  });

  test("garbage attempt counts are refused loudly (never a silent decision)", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => liveReconnectDecision("connection-lost", bad)).toThrow(RangeError);
    }
  });

  test("purity: the same inputs always yield the deep-equal decision", () => {
    for (const failureClass of ["connection-lost", "transport-failed", "rights-denied"] as const) {
      for (let attempts = 0; attempts <= 5; attempts += 1) {
        const decision = liveReconnectDecision(failureClass, attempts);
        if (decision.action === "reconnect" || decision.reason === "non-retryable" || decision.reason === "attempts-exhausted") {
          expect(liveReconnectDecision(failureClass, attempts)).toEqual(decision);
        }
      }
    }
  });
});
