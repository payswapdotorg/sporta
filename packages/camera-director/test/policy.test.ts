/**
 * The direction policy DATA (`src/policy.ts`): the canonical
 * `broadcast-classic` policy is pinned VALUE BY VALUE (every zone bound,
 * gate, hold, and replay config), its event-importance order is proven to
 * inherit W209's own `EVENT_TYPE_PRIORITY` ranking, and the whole document
 * is byte-pinned against the checked-in golden
 * `fixtures/golden/default-policy.json` (the scene-projection
 * golden-enforcement precedent: regenerating the golden is an intentional,
 * reviewed act — drift has teeth).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVENT_TYPE_PRIORITY } from "@sporta/commentary-understanding";
import { CAMERA_SLOT_IDS } from "@sporta/scene-projection";
import {
  DEFAULT_DIRECTOR_POLICY,
  DIRECTOR_POLICY_VERSION,
  DIRECTOR_VERSION,
  FOCUS_SLOT_SELECTORS,
  GOAL_SIDE_SPLIT_X_METERS,
  STATIC_SLOT_SELECTORS,
  validatePolicy,
} from "../src/index";

const GOLDEN_PATH = join(import.meta.dir, "..", "fixtures", "golden", "default-policy.json");

describe("policy — the canonical broadcast-classic document (value pins)", () => {
  test("identity: policyId broadcast-classic, versions pinned", () => {
    expect(DEFAULT_DIRECTOR_POLICY.policyId).toBe("broadcast-classic");
    expect(DEFAULT_DIRECTOR_POLICY.policyVersion).toBe(DIRECTOR_POLICY_VERSION);
    expect(DIRECTOR_POLICY_VERSION).toBe("camera-director.policy@1");
    expect(DIRECTOR_VERSION).toBe("camera-director@1");
  });

  test("possession-follow: enabled, 3 zones covering [0, 105], main-touchline fallback, 3 s hysteresis", () => {
    const follow = DEFAULT_DIRECTOR_POLICY.possessionFollow;
    expect(follow.enabled).toBe(true);
    expect(follow.fallbackSlotId).toBe("main-touchline");
    expect(follow.hysteresisMs).toBe(3_000);
    expect(follow.zones).toHaveLength(3);
    // Declared order: the x0 final third, the x105 final third, the middle.
    expect(follow.zones.map((zone) => zone.slotId)).toEqual([
      "behind-goal-x0",
      "behind-goal-x105",
      "main-touchline",
    ]);
    expect(follow.zones.map((zone) => [zone.xMin, zone.xMax])).toEqual([
      [0, 17.5],
      [87.5, 105],
      [17.5, 87.5],
    ]);
    // Total coverage: the sorted zones span [0, 105] with no interior hole.
    const sorted = [...follow.zones].sort((a, b) => a.xMin - b.xMin);
    expect(sorted[0]!.xMin).toBe(0);
    expect(sorted[sorted.length - 1]!.xMax).toBe(105);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]!.xMin).toBeLessThanOrEqual(sorted[i - 1]!.xMax);
    }
    // Every referenced slot is a canonical W601 slot (G7: nothing invented).
    for (const zone of follow.zones) {
      expect(CAMERA_SLOT_IDS).toContain(zone.slotId);
    }
  });

  test("event-importance table: 8 rules, one per type, priority INHERITS W209's ranking", () => {
    const rules = DEFAULT_DIRECTOR_POLICY.eventRules;
    expect(rules.map((rule) => rule.eventType)).toEqual([
      "goal",
      "save",
      "shot",
      "free-kick",
      "card",
      "corner",
      "kickoff",
      "fulltime",
    ]);
    // The documented alignment: the rule order is ASCENDING in W209's own
    // EVENT_TYPE_PRIORITY ranking (importance inherits the commentary
    // vocabulary's own specificity order — never re-invented here).
    const rankOf = new Map(EVENT_TYPE_PRIORITY.map((type, rank) => [type, rank]));
    const ranks = rules.map((rule) => rankOf.get(rule.eventType));
    expect(ranks).toEqual([0, 1, 2, 3, 4, 5, 10, 11]);
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]!).toBeGreaterThan(ranks[i - 1]!);
    }
    // No duplicate types (validation demands one rule per type).
    expect(new Set(rules.map((rule) => rule.eventType)).size).toBe(rules.length);
  });

  test("routine types carry NO rule (the possession default covers pass/foul/offside/throw-in/substitution/other)", () => {
    const ruled = new Set(DEFAULT_DIRECTOR_POLICY.eventRules.map((rule) => rule.eventType));
    for (const type of ["pass", "foul", "offside", "throw-in", "substitution", "other"] as const) {
      expect(ruled.has(type)).toBe(false);
    }
  });

  test("every rule: gate in [0,1], hold > 0, selector in the vocabulary; pinned gates and holds", () => {
    for (const rule of DEFAULT_DIRECTOR_POLICY.eventRules) {
      expect(rule.minConfidence).toBeGreaterThanOrEqual(0);
      expect(rule.minConfidence).toBeLessThanOrEqual(1);
      expect(rule.holdMs).toBeGreaterThan(0);
      expect(FOCUS_SLOT_SELECTORS).toContain(rule.focusSlotSelector);
    }
    expect(
      DEFAULT_DIRECTOR_POLICY.eventRules.map((rule) => [
        rule.eventType,
        rule.minConfidence,
        rule.holdMs,
        rule.focusSlotSelector,
      ]),
    ).toEqual([
      ["goal", 0.5, 4_000, "nearest-goal"],
      ["save", 0.6, 2_500, "nearest-goal"],
      ["shot", 0.65, 2_000, "nearest-goal"],
      ["free-kick", 0.6, 3_000, "nearest-goal"],
      ["card", 0.6, 3_000, "main-touchline"],
      ["corner", 0.6, 2_500, "nearest-goal"],
      ["kickoff", 0.6, 3_000, "main-touchline"],
      ["fulltime", 0.6, 5_000, "aerial-tactical"],
    ]);
  });

  test("replay-emphasis: exactly goal and save earn reviews, with pinned lead/trail", () => {
    const withReplay = DEFAULT_DIRECTOR_POLICY.eventRules.filter(
      (rule) => rule.replay !== undefined,
    );
    expect(withReplay.map((rule) => rule.eventType)).toEqual(["goal", "save"]);
    expect(DEFAULT_DIRECTOR_POLICY.eventRules[0]!.replay).toEqual({
      replaySlotSelector: "nearest-goal",
      leadMs: 2_000,
      trailMs: 2_000,
    });
    expect(DEFAULT_DIRECTOR_POLICY.eventRules[1]!.replay).toEqual({
      replaySlotSelector: "nearest-goal",
      leadMs: 1_500,
      trailMs: 1_500,
    });
  });

  test("the whole document is valid policy data (validation round-trip)", () => {
    const validation = validatePolicy(DEFAULT_DIRECTOR_POLICY);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.value).toEqual(DEFAULT_DIRECTOR_POLICY);
    }
  });
});

describe("policy — selector vocabulary + module constants", () => {
  test("GOAL_SIDE_SPLIT_X_METERS is the pitch halfway x (105/2, the W601 geometry)", () => {
    expect(GOAL_SIDE_SPLIT_X_METERS).toBe(52.5);
  });

  test("the static selectors name canonical slots directly; nearest-goal is the only dynamic one", () => {
    expect(STATIC_SLOT_SELECTORS).toEqual([
      "main-touchline",
      "opposite-touchline",
      "aerial-tactical",
    ]);
    expect(FOCUS_SLOT_SELECTORS).toEqual([
      "nearest-goal",
      "main-touchline",
      "opposite-touchline",
      "aerial-tactical",
    ]);
  });
});

describe("policy — the golden pin (byte-identical, drift has teeth)", () => {
  test("the checked-in golden equals the exported policy byte for byte", () => {
    const golden = readFileSync(GOLDEN_PATH, "utf8");
    expect(`${JSON.stringify(DEFAULT_DIRECTOR_POLICY, null, 2)}\n`).toBe(golden);
  });

  test("the golden is stable JSON (key order = document order, no hidden fields)", () => {
    const parsed = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      "policyId",
      "policyVersion",
      "possessionFollow",
      "eventRules",
    ]);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(DEFAULT_DIRECTOR_POLICY));
  });
});
