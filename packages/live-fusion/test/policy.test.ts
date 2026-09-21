/**
 * THE L012 POLICY BATTERY — the deterministic arbitration policy (D5):
 * validation (fail-loud), precedence ranks, the lexicographic total-order
 * tiebreak, and `arbitratesOver`'s antisymmetry/totality (the property the
 * "deterministic tie/fallback policy" acceptance stands on).
 */
import { describe, expect, test } from "bun:test";
import {
  arbitratesOver,
  DEFAULT_BALL_MAX_SPEED_MPS,
  DEFAULT_CONFLICT_TOLERANCE_M,
  DEFAULT_MAX_SPEED_MPS,
  defaultFusionPolicy,
  FusionPolicyValidationError,
  parseFusionPolicy,
  precedenceRankOf,
} from "../src/index";

describe("the fusion policy (D5)", () => {
  test("the defaults are the documented values", () => {
    const policy = defaultFusionPolicy();
    expect(policy.sourcePrecedence).toEqual([]);
    expect(policy.conflictToleranceM).toBe(DEFAULT_CONFLICT_TOLERANCE_M);
    expect(policy.conflictToleranceM).toBe(1.0);
    expect(policy.maxSpeedMps).toBe(DEFAULT_MAX_SPEED_MPS);
    expect(policy.maxSpeedMps).toBe(12);
    expect(policy.ballMaxSpeedMps).toBe(DEFAULT_BALL_MAX_SPEED_MPS);
    expect(policy.ballMaxSpeedMps).toBe(35);
    expect(policy.conflictWindowMs).toBe(250); // the L004 reorder window default
  });

  test("a partial policy merges onto the defaults", () => {
    const policy = parseFusionPolicy({ sourcePrecedence: ["tracking-a"] });
    expect(policy.sourcePrecedence).toEqual(["tracking-a"]);
    expect(policy.conflictToleranceM).toBe(1.0);
  });

  test("malformed policies refuse fail-loud (never a silent default patch)", () => {
    expect(() => parseFusionPolicy({ conflictToleranceM: 0 })).toThrow(FusionPolicyValidationError);
    expect(() => parseFusionPolicy({ conflictToleranceM: Number.NaN })).toThrow(
      FusionPolicyValidationError,
    );
    expect(() => parseFusionPolicy({ maxSpeedMps: -1 })).toThrow(FusionPolicyValidationError);
    expect(() => parseFusionPolicy({ conflictWindowMs: 0 })).toThrow(FusionPolicyValidationError);
    expect(() => parseFusionPolicy({ sourcePrecedence: ["a", "a"] })).toThrow(
      FusionPolicyValidationError,
    );
    expect(() => parseFusionPolicy({ sourcePrecedence: ["a", ""] })).toThrow(
      FusionPolicyValidationError,
    );
    expect(() => parseFusionPolicy({ sourcePrecedence: "tracking-a" as never })).toThrow(
      FusionPolicyValidationError,
    );
  });

  test("precedence ranks: listed sources rank by index; unlisted sources rank after ALL listed ones", () => {
    const policy = parseFusionPolicy({ sourcePrecedence: ["broadcast-1", "tracking-a"] });
    expect(precedenceRankOf(policy, "broadcast-1").rank).toBe(0);
    expect(precedenceRankOf(policy, "tracking-a").rank).toBe(1);
    expect(precedenceRankOf(policy, "open-data-9").rank).toBe(2); // after every listed source
    expect(precedenceRankOf(policy, "aaa-open-data").rank).toBe(2); // even lexicographically first
  });

  test("arbitratesOver is a strict total order on distinct sources (deterministic ties, D5 rule 2)", () => {
    const policy = parseFusionPolicy({ sourcePrecedence: ["broadcast-1", "tracking-a"] });
    // Precedence beats everything below it.
    expect(arbitratesOver(policy, "broadcast-1", "tracking-a")).toBe(true);
    expect(arbitratesOver(policy, "tracking-a", "broadcast-1")).toBe(false);
    // Unlisted sources lose to every listed one.
    expect(arbitratesOver(policy, "tracking-a", "zzz-other")).toBe(true);
    expect(arbitratesOver(policy, "zzz-other", "tracking-a")).toBe(false);
    // Two unlisted sources: the lexicographic sourceId decides (the final
    // deterministic tiebreak — a total order, no arrival-order dependence).
    expect(arbitratesOver(policy, "source-b", "source-c")).toBe(true);
    expect(arbitratesOver(policy, "source-c", "source-b")).toBe(false);
    // Reflexivity: never over itself.
    expect(arbitratesOver(policy, "broadcast-1", "broadcast-1")).toBe(false);
  });

  test("with an empty precedence, the lexicographic sourceId is the whole order (documented default)", () => {
    const policy = defaultFusionPolicy();
    expect(arbitratesOver(policy, "a-tracking", "b-perception")).toBe(true);
    expect(arbitratesOver(policy, "b-perception", "a-tracking")).toBe(false);
  });

  test("arbitratesOver is total: for any two distinct sources exactly one direction holds", () => {
    const policy = parseFusionPolicy({ sourcePrecedence: ["c", "a"] });
    const sources = ["a", "b", "c", "d", "e"];
    for (const x of sources) {
      for (const y of sources) {
        if (x === y) continue;
        const xy = arbitratesOver(policy, x, y);
        const yx = arbitratesOver(policy, y, x);
        expect(xy === !yx).toBe(true); // exactly one direction
      }
    }
  });
});
