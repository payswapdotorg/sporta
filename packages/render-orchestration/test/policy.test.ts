/**
 * The skip-stale degradation policy (W304) — pure decisions, no state.
 */
import { describe, expect, test } from "bun:test";
import { evaluateStaleSkip } from "../src/policy";
import type { DegradationPolicy } from "../src/types";

const HEAD = { watermarkMs: 10_000, sequence: 40 };

describe("evaluateStaleSkip", () => {
  test("disabled is the honest baseline: nothing is ever skipped", () => {
    const policy: DegradationPolicy = { skipStale: "disabled" };
    const decision = evaluateStaleSkip(policy, 0, HEAD);
    expect(decision.stale).toBe(false);
    expect(decision.lagMs).toBe(10_000);
    expect(decision.head).toEqual(HEAD);
  });

  test("a batch is stale only when the lag is STRICTLY more than the bound", () => {
    const policy: DegradationPolicy = { skipStale: { maxWatermarkLagMs: 5_000 } };
    // lag 5_000 exactly (batch wm 5_000, head 10_000): NOT stale.
    expect(evaluateStaleSkip(policy, 5_000, HEAD).stale).toBe(false);
    // lag 5_001 (batch wm 4_999): stale.
    expect(evaluateStaleSkip(policy, 4_999, HEAD).stale).toBe(true);
    // lag 4_999 (batch wm 5_001): not stale.
    expect(evaluateStaleSkip(policy, 5_001, HEAD).stale).toBe(false);
  });

  test("the measured lag and head evidence travel with the decision (never just a boolean)", () => {
    const policy: DegradationPolicy = { skipStale: { maxWatermarkLagMs: 5_000 } };
    const decision = evaluateStaleSkip(policy, 2_500, HEAD);
    expect(decision.lagMs).toBe(7_500);
    expect(decision.head).toEqual(HEAD);
    expect(decision.stale).toBe(true);
  });

  test("the head is copied verbatim (mutating the input head cannot re-write history)", () => {
    const policy: DegradationPolicy = { skipStale: { maxWatermarkLagMs: 5_000 } };
    const head = { watermarkMs: 10_000, sequence: 40 };
    const decision = evaluateStaleSkip(policy, 2_500, head);
    head.watermarkMs = 0;
    expect(decision.head.watermarkMs).toBe(10_000);
  });

  test("purity: the same triple always yields the same decision", () => {
    const policy: DegradationPolicy = { skipStale: { maxWatermarkLagMs: 5_000 } };
    expect(evaluateStaleSkip(policy, 2_500, HEAD)).toEqual(evaluateStaleSkip(policy, 2_500, HEAD));
  });
});
