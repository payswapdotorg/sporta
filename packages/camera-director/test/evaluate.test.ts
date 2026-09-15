/**
 * The evaluation surface (`src/evaluate.ts` `planDecisionRecords`): the
 * per-window decision records W605 will score against — a pure 1:1
 * projection of the plan's own windows (which rule fired, which event
 * drove it with confidence/emphasis verbatim, what was directed and for
 * how long).
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_DIRECTOR_POLICY } from "../src/policy";
import { direct } from "../src/direct";
import { planDecisionRecords } from "../src/evaluate";
import { buildCandidate, buildDirectorMatch } from "./helpers";

describe("planDecisionRecords — the W605 evaluation surface", () => {
  test("one record per window, rundown order, fields verbatim", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 5_500,
        eventType: "goal",
        confidence: 0.86,
        emphasis: 0.9,
      }),
      buildCandidate({
        candidateId: "ec-2",
        eventTimeMs: 3_200,
        eventType: "shot",
        confidence: 0.7,
        emphasis: 0.5,
      }),
    ]);
    const records = planDecisionRecords(plan);
    expect(records).toHaveLength(plan.windows.length);
    for (let i = 0; i < records.length; i += 1) {
      const record = records[i]!;
      const window = plan.windows[i]!;
      expect(record.windowIndex).toBe(window.index);
      expect(record.kind).toBe(window.kind);
      expect(record.source).toEqual(window.source);
      expect(record.cameraSlotId).toBe(window.cameraSlotId);
      expect(record.decision).toEqual(window.decision);
    }
  });

  test("each record answers: which rule fired, which event drove it (verbatim), what was directed", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 5_500,
        eventType: "goal",
        confidence: 0.86,
        emphasis: 0.9,
      }),
    ]);
    const records = planDecisionRecords(plan);
    const [possession, focus, review] = records;
    // The default window: rule + follow inputs, no event.
    expect(possession!.decision.ruleId).toBe("possession-follow");
    expect(possession!.decision.event).toBeUndefined();
    expect(possession!.decision.possession!.followX).toBe(50);
    // The event window: the verbatim candidate drove the slot choice.
    expect(focus!.decision.ruleId).toBe("event-focus");
    expect(focus!.decision.event).toEqual({
      candidateId: "ec-1",
      eventType: "goal",
      eventTimeMs: 5_500,
      confidence: 0.86,
      emphasis: 0.9,
    });
    expect(focus!.decision.holdMs).toBe(4_000);
    expect(focus!.cameraSlotId).toBe("behind-goal-x105");
    // The replay: same verbatim event, the review range as source.
    expect(review!.decision.ruleId).toBe("replay-emphasis");
    expect(review!.decision.event!.confidence).toBe(0.86);
    expect(review!.source).toEqual({ startMs: 3_000, endMs: 7_000 });
    expect(review!.kind).toBe("review");
  });

  test("the projection is pure: the plan is never mutated", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), []);
    const before = JSON.stringify(plan);
    const records = planDecisionRecords(plan);
    records[0]!.cameraSlotId = "aerial-tactical";
    expect(JSON.stringify(plan)).toBe(before);
  });
});
