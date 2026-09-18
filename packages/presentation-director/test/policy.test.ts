/**
 * The default-policy pins: every value of DEFAULT_PRESENTATION_POLICY is
 * pinned by test AND by the committed golden
 * `fixtures/golden/default-presentation-policy.json` (the camera-director
 * golden convention — a change to either side without the other fails).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_DIRECTOR_POLICY } from "@sporta/camera-director";
import { EVENT_TYPE_PRIORITY } from "@sporta/commentary-understanding";
import {
  DEFAULT_PRESENTATION_POLICY,
  PRESENTATION_DIRECTOR_VERSION,
  PRESENTATION_POLICY_VERSION,
} from "../src/index";

describe("the default policy (broadcast-classic-presentation)", () => {
  test("carries the versioned identity", () => {
    expect(DEFAULT_PRESENTATION_POLICY.policyId).toBe("broadcast-classic-presentation");
    expect(DEFAULT_PRESENTATION_POLICY.policyVersion).toBe(PRESENTATION_POLICY_VERSION);
    expect(PRESENTATION_POLICY_VERSION).toBe("presentation-director.policy@1");
    expect(PRESENTATION_DIRECTOR_VERSION).toBe("presentation-director@1");
  });

  test("the camera layer IS the W604 default director policy, verbatim", () => {
    expect(DEFAULT_PRESENTATION_POLICY.camera).toEqual(DEFAULT_DIRECTOR_POLICY);
  });

  test("the event-importance table covers the FULL W209 vocabulary in W209's own priority order", () => {
    expect(DEFAULT_PRESENTATION_POLICY.eventImportance.map((row) => row.eventType)).toEqual([
      ...EVENT_TYPE_PRIORITY,
    ]);
  });

  test("every importance weight is pinned", () => {
    expect(DEFAULT_PRESENTATION_POLICY.eventImportance).toEqual([
      { eventType: "goal", weight: 1 },
      { eventType: "save", weight: 0.8 },
      { eventType: "shot", weight: 0.7 },
      { eventType: "free-kick", weight: 0.6 },
      { eventType: "card", weight: 0.6 },
      { eventType: "corner", weight: 0.5 },
      { eventType: "foul", weight: 0.3 },
      { eventType: "offside", weight: 0.3 },
      { eventType: "throw-in", weight: 0.2 },
      { eventType: "substitution", weight: 0.3 },
      { eventType: "kickoff", weight: 0.4 },
      { eventType: "fulltime", weight: 0.7 },
      { eventType: "pass", weight: 0.1 },
      { eventType: "other", weight: 0.05 },
    ]);
  });

  test("the semantic blend weights are pinned and sum to exactly 1", () => {
    expect(DEFAULT_PRESENTATION_POLICY.semantics).toEqual({
      importanceWeight: 0.5,
      emphasisWeight: 0.3,
      confidenceWeight: 0.2,
    });
    const { importanceWeight, emphasisWeight, confidenceWeight } =
      DEFAULT_PRESENTATION_POLICY.semantics;
    expect(importanceWeight + emphasisWeight + confidenceWeight).toBe(1);
  });

  test("the baseline floor values are pinned", () => {
    expect(DEFAULT_PRESENTATION_POLICY.baselineImportance).toBe(0.1);
    expect(DEFAULT_PRESENTATION_POLICY.baselineSemanticScore).toBe(0.2);
  });

  test("the framing table classifies all five canonical W601 slots (no duplicates)", () => {
    expect(DEFAULT_PRESENTATION_POLICY.framing).toEqual([
      { slotId: "main-touchline", framing: "wide" },
      { slotId: "opposite-touchline", framing: "wide" },
      { slotId: "aerial-tactical", framing: "wide" },
      { slotId: "behind-goal-x0", framing: "tight" },
      { slotId: "behind-goal-x105", framing: "tight" },
    ]);
    const slots = DEFAULT_PRESENTATION_POLICY.framing.map((row) => row.slotId);
    expect(new Set(slots).size).toBe(slots.length);
  });

  test("the committed golden matches the default policy byte-for-byte", () => {
    const golden = readFileSync(
      join(import.meta.dir, "..", "fixtures", "golden", "default-presentation-policy.json"),
      "utf8",
    );
    expect(golden).toBe(`${JSON.stringify(DEFAULT_PRESENTATION_POLICY, null, 2)}\n`);
  });
});
