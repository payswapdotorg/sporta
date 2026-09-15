/**
 * `src/validate.ts` `validatePolicy`: fail-closed structural validation of
 * direction policy DOCUMENTS. Every documented rule has a positive pin and
 * a negative fixture (the exact issue path is asserted); unknown keys are
 * ignored (forward-compatible config data); the returned value is a FRESH
 * normalized document (consumers can never reach the exported constant).
 *
 * This file also pins the flight-2 fix of the inherited bug: the replay
 * branch referenced an undefined identifier (`replaySlotSelector` vs the
 * validated local `replaySelector`) — every policy with a replay config
 * (including the DEFAULT policy) crashed before the fix.
 */
import { describe, expect, test } from "bun:test";
import { CAMERA_SLOT_IDS } from "@sporta/scene-projection";
import { DEFAULT_DIRECTOR_POLICY } from "../src/policy";
import type { DirectorPolicy, EventFocusRule } from "../src/policy";
import { validatePolicy } from "../src/validate";

/** The issues of a refused value (fails if the value was admitted). */
function issuesOf(value: unknown): string[] {
  const validation = validatePolicy(value);
  expect(validation.ok).toBe(false);
  if (validation.ok) throw new Error("unreachable");
  return validation.issues;
}

/** A deep JSON clone of the default policy (mutation base for negatives). */
function policyClone(): DirectorPolicy {
  return JSON.parse(JSON.stringify(DEFAULT_DIRECTOR_POLICY)) as DirectorPolicy;
}

/** The single issue of a refused policy (fails if there isn't exactly one). */
function singleIssue(value: unknown): string {
  const validation = validatePolicy(value);
  expect(validation.ok).toBe(false);
  if (validation.ok) throw new Error("unreachable");
  expect(validation.issues).toHaveLength(1);
  return validation.issues[0]!;
}

describe("validatePolicy — positives", () => {
  test("the DEFAULT policy validates; the value round-trips deep-equal", () => {
    const validation = validatePolicy(DEFAULT_DIRECTOR_POLICY);
    expect(validation.ok).toBe(true);
    if (validation.ok) expect(validation.value).toEqual(DEFAULT_DIRECTOR_POLICY);
  });

  test("an EMPTY event-rule array is valid (a pure possession-follow policy)", () => {
    const policy = policyClone();
    policy.eventRules = [];
    const validation = validatePolicy(policy);
    expect(validation.ok).toBe(true);
    if (validation.ok) expect(validation.value.eventRules).toEqual([]);
  });

  test("a replay-carrying rule validates and its replay is admitted INTACT (the flight-1 ReferenceError pin)", () => {
    const policy = policyClone();
    policy.eventRules = [
      {
        eventType: "goal",
        minConfidence: 0.5,
        focusSlotSelector: "nearest-goal",
        holdMs: 4_000,
        replay: { replaySlotSelector: "opposite-touchline", leadMs: 1_000, trailMs: 500 },
      },
    ];
    const validation = validatePolicy(policy);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.value.eventRules[0]!.replay).toEqual({
        replaySlotSelector: "opposite-touchline",
        leadMs: 1_000,
        trailMs: 500,
      });
    }
  });

  test("unknown top-level AND nested keys are ignored (forward-compatible documents)", () => {
    const policy = policyClone() as unknown as Record<string, unknown>;
    policy.futureField = { nested: true };
    const validation = validatePolicy(policy);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect("futureField" in validation.value).toBe(false);
    }
  });

  test("the returned document is FRESH: mutating it never reaches the exported constant", () => {
    const validation = validatePolicy(DEFAULT_DIRECTOR_POLICY);
    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error("unreachable");
    const frozen = JSON.stringify(DEFAULT_DIRECTOR_POLICY);
    validation.value.possessionFollow.zones[0]!.slotId = "aerial-tactical";
    (validation.value.eventRules as EventFocusRule[]).pop();
    expect(JSON.stringify(DEFAULT_DIRECTOR_POLICY)).toBe(frozen);
  });
});

describe("validatePolicy — top-level negatives", () => {
  test("not an object", () => {
    expect(issuesOf(null)).toEqual(["policy: must be an object"]);
    expect(issuesOf("goal-first")).toEqual(["policy: must be an object"]);
  });

  test("policyId / policyVersion must be non-empty strings", () => {
    const policy = policyClone();
    policy.policyId = "";
    expect(singleIssue(policy)).toBe("policy.policyId: must be a non-empty string");
    const policy2 = policyClone();
    delete (policy2 as unknown as Record<string, unknown>).policyVersion;
    expect(singleIssue(policy2)).toBe("policy.policyVersion: must be a non-empty string");
  });
});

describe("validatePolicy — possession-follow negatives", () => {
  test("possessionFollow must be an object", () => {
    const policy = policyClone();
    (policy as unknown as Record<string, unknown>).possessionFollow = "follow";
    expect(singleIssue(policy)).toBe("policy.possessionFollow: must be an object");
  });

  test("enabled must be a boolean", () => {
    const policy = policyClone();
    policy.possessionFollow.enabled = 1 as unknown as boolean;
    expect(singleIssue(policy)).toBe("policy.possessionFollow.enabled: must be a boolean");
  });

  test("zones must be a non-empty array", () => {
    const policy = policyClone();
    policy.possessionFollow.zones = [];
    expect(singleIssue(policy)).toBe("policy.possessionFollow.zones: must be a non-empty array");
  });

  test("zone xMax must be >= xMin", () => {
    const policy = policyClone();
    policy.possessionFollow.zones = [{ xMin: 30, xMax: 20, slotId: "main-touchline" }];
    expect(singleIssue(policy)).toBe(
      "policy.possessionFollow.zones[0]: xMax (20) must be >= xMin (30)",
    );
  });

  test("zone bounds must be finite numbers", () => {
    const policy = policyClone();
    policy.possessionFollow.zones = [{ xMin: Number.NaN, xMax: 105, slotId: "main-touchline" }];
    expect(singleIssue(policy)).toBe(
      "policy.possessionFollow.zones[0]: xMin and xMax must be finite numbers",
    );
  });

  test("zone slotId must be a CANONICAL slot (an invented angle is refused)", () => {
    const policy = policyClone();
    policy.possessionFollow.zones = [{ xMin: 0, xMax: 105, slotId: "spidercam" }];
    expect(singleIssue(policy)).toBe(
      `policy.possessionFollow.zones[0]: slotId must be one of the canonical camera slots (${CAMERA_SLOT_IDS.join(", ")})`,
    );
  });

  test("zones must cover the WHOLE pitch x span [0, 105] — edge gaps refused", () => {
    const policy = policyClone();
    policy.possessionFollow.zones = [{ xMin: 10, xMax: 105, slotId: "main-touchline" }];
    expect(singleIssue(policy)).toBe(
      "policy.possessionFollow.zones: must cover the canonical pitch x span [0, 105] (covered: [10, 105])",
    );
    const policy2 = policyClone();
    policy2.possessionFollow.zones = [{ xMin: 0, xMax: 90, slotId: "main-touchline" }];
    expect(singleIssue(policy2)).toBe(
      "policy.possessionFollow.zones: must cover the canonical pitch x span [0, 105] (covered: [0, 90])",
    );
  });

  test("zones must have NO interior hole (a hole is a policy bug, not an honest unknown)", () => {
    const policy = policyClone();
    policy.possessionFollow.zones = [
      { xMin: 0, xMax: 20, slotId: "behind-goal-x0" },
      { xMin: 40, xMax: 105, slotId: "main-touchline" },
    ];
    expect(singleIssue(policy)).toBe(
      "policy.possessionFollow.zones: must have no interior hole between [0, 20] and [40, 105]",
    );
  });

  test("overlapping zones are LEGAL (declared order decides — first match wins)", () => {
    const policy = policyClone();
    policy.possessionFollow.zones = [
      { xMin: 0, xMax: 60, slotId: "behind-goal-x0" },
      { xMin: 40, xMax: 105, slotId: "main-touchline" },
    ];
    expect(validatePolicy(policy).ok).toBe(true);
  });

  test("fallbackSlotId must be a canonical slot", () => {
    const policy = policyClone();
    policy.possessionFollow.fallbackSlotId = "crowd-pleaser";
    expect(singleIssue(policy)).toBe(
      `policy.possessionFollow.fallbackSlotId: must be one of the canonical camera slots (${CAMERA_SLOT_IDS.join(", ")})`,
    );
  });

  test("hysteresisMs must be a finite number >= 0", () => {
    const policy = policyClone();
    policy.possessionFollow.hysteresisMs = -1;
    expect(singleIssue(policy)).toBe(
      "policy.possessionFollow.hysteresisMs: must be a finite number >= 0",
    );
    const policy2 = policyClone();
    policy2.possessionFollow.hysteresisMs = "3s" as unknown as number;
    expect(singleIssue(policy2)).toBe(
      "policy.possessionFollow.hysteresisMs: must be a finite number >= 0",
    );
  });
});

describe("validatePolicy — event-rule negatives", () => {
  test("eventRules must be an array", () => {
    const policy = policyClone();
    (policy as unknown as Record<string, unknown>).eventRules = { goal: {} };
    expect(singleIssue(policy)).toBe("policy.eventRules: must be an array (may be empty)");
  });

  test("eventType must be a W209 event type (the W209 vocabulary is authoritative)", () => {
    const policy = policyClone();
    policy.eventRules = [
      {
        eventType: "penalty-shootout" as never,
        minConfidence: 0.5,
        focusSlotSelector: "main-touchline",
        holdMs: 1_000,
      },
    ];
    expect(singleIssue(policy)).toBe(
      "policy.eventRules[0].eventType: must be one of the W209 event types (goal, save, shot, free-kick, card, corner, foul, offside, throw-in, substitution, kickoff, fulltime, pass, other)",
    );
  });

  test("NO duplicate rules per event type (first-match semantics must be unambiguous)", () => {
    const policy = policyClone();
    policy.eventRules = [
      { eventType: "goal", minConfidence: 0.5, focusSlotSelector: "main-touchline", holdMs: 1_000 },
      {
        eventType: "goal",
        minConfidence: 0.9,
        focusSlotSelector: "aerial-tactical",
        holdMs: 2_000,
      },
    ];
    expect(singleIssue(policy)).toBe(
      'policy.eventRules: duplicate rule for event type "goal" (one rule per type)',
    );
  });

  test("minConfidence must be in [0, 1]", () => {
    const policy = policyClone();
    policy.eventRules = [
      { eventType: "goal", minConfidence: 1.5, focusSlotSelector: "main-touchline", holdMs: 1_000 },
    ];
    expect(singleIssue(policy)).toBe(
      "policy.eventRules[0].minConfidence: must be a finite number in [0, 1]",
    );
    const policy2 = policyClone();
    policy2.eventRules = [
      {
        eventType: "goal",
        minConfidence: -0.1,
        focusSlotSelector: "main-touchline",
        holdMs: 1_000,
      },
    ];
    expect(singleIssue(policy2)).toBe(
      "policy.eventRules[0].minConfidence: must be a finite number in [0, 1]",
    );
  });

  test("focusSlotSelector must be in the selector vocabulary", () => {
    const policy = policyClone();
    policy.eventRules = [
      {
        eventType: "goal",
        minConfidence: 0.5,
        focusSlotSelector: "drone-follow" as never,
        holdMs: 1_000,
      },
    ];
    expect(singleIssue(policy)).toBe(
      "policy.eventRules[0].focusSlotSelector: must be one of (nearest-goal, main-touchline, opposite-touchline, aerial-tactical)",
    );
  });

  test("holdMs must be > 0 (a zero hold is a degenerate window)", () => {
    const policy = policyClone();
    policy.eventRules = [
      { eventType: "goal", minConfidence: 0.5, focusSlotSelector: "main-touchline", holdMs: 0 },
    ];
    expect(singleIssue(policy)).toBe("policy.eventRules[0].holdMs: must be a finite number > 0");
  });

  test("replay: selector must be in the vocabulary", () => {
    const policy = policyClone();
    policy.eventRules = [
      {
        eventType: "goal",
        minConfidence: 0.5,
        focusSlotSelector: "main-touchline",
        holdMs: 1_000,
        replay: { replaySlotSelector: "slow-mo-cam" as never, leadMs: 1_000, trailMs: 1_000 },
      },
    ];
    expect(singleIssue(policy)).toBe(
      "policy.eventRules[0].replay.replaySlotSelector: must be one of (nearest-goal, main-touchline, opposite-touchline, aerial-tactical)",
    );
  });

  test("replay: leadMs and trailMs must be finite >= 0", () => {
    const policy = policyClone();
    policy.eventRules = [
      {
        eventType: "goal",
        minConfidence: 0.5,
        focusSlotSelector: "main-touchline",
        holdMs: 1_000,
        replay: { replaySlotSelector: "main-touchline", leadMs: -100, trailMs: 1_000 },
      },
    ];
    expect(singleIssue(policy)).toBe(
      "policy.eventRules[0].replay.leadMs: must be a finite number >= 0",
    );
    const policy2 = policyClone();
    policy2.eventRules = [
      {
        eventType: "goal",
        minConfidence: 0.5,
        focusSlotSelector: "main-touchline",
        holdMs: 1_000,
        replay: {
          replaySlotSelector: "main-touchline",
          leadMs: 1_000,
          trailMs: Number.POSITIVE_INFINITY,
        },
      },
    ];
    expect(singleIssue(policy2)).toBe(
      "policy.eventRules[0].replay.trailMs: must be a finite number >= 0",
    );
  });

  test("replay must be an object when present", () => {
    const policy = policyClone();
    policy.eventRules = [
      {
        eventType: "goal",
        minConfidence: 0.5,
        focusSlotSelector: "main-touchline",
        holdMs: 1_000,
        replay: "yes" as unknown as never,
      },
    ];
    expect(singleIssue(policy)).toBe("policy.eventRules[0].replay: must be an object");
  });

  test("a rule must be an object", () => {
    const policy = policyClone();
    policy.eventRules = ["goal"] as unknown as DirectorPolicy["eventRules"];
    expect(singleIssue(policy)).toBe("policy.eventRules[0]: must be an object");
  });
});
