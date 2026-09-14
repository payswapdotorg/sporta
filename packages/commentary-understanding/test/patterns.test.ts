/**
 * W209 pattern tests: type resolution (priority), the non-overlapping
 * left-to-right scan, case-insensitivity, and the no-match case.
 */
import { describe, expect, test } from "bun:test";
import { extractEventCandidates } from "../src/index";
import type { CommentaryUnit } from "@sporta/commentary-segmentation";

/** One W208-shaped commentary unit (HARNESS.md: fixed values, no RNG). */
function unit(startMs: number, text: string): CommentaryUnit {
  return { unitId: "cu-1", startMs, endMs: startMs + 500, text, sourceWindowIds: ["tu-0"] };
}

describe("event patterns", () => {
  test("goal priority beats shot: 'He shoots... GOAL!' -> single goal candidate", () => {
    // The W208-style sentence split yields ["He shoots...", "GOAL!"] — two
    // sentences, one unit. The shot match in sentence 1 and the goal match
    // in sentence 2 both survive the span sweep; the per-unit scoring-
    // attempt absorption (goal > save > shot) drops the shot: one scoring
    // attempt is reported by its outcome.
    const candidates = extractEventCandidates({
      units: [unit(10_000, "He shoots... GOAL!")],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.eventType).toBe("goal");
    expect(candidates[0]?.eventPhrase).toBe("GOAL");
    expect(candidates[0]?.eventTimeMs).toBe(10_000);
  });

  test("non-overlapping scan: 'foul then free-kick' -> 2 candidates in order", () => {
    // free-kick's pattern matches "kick" (as part of "free-kick"), not
    // "foul" — the two matches do not overlap, so both survive: a foul and
    // the free-kick awarded for it are TWO events (only the scoring family
    // absorbs; foul/free-kick coexist by design).
    const candidates = extractEventCandidates({
      units: [unit(20_000, "That's a foul and then a free-kick.")],
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.eventType).toBe("foul");
    expect(candidates[0]?.eventPhrase).toBe("foul");
    expect(candidates[1]?.eventType).toBe("free-kick");
    expect(candidates[1]?.eventPhrase).toBe("free-kick");
    // Same unit, same sentence: ordered by scan position (foul first).
    expect(candidates[0]?.eventTimeMs).toBe(20_000);
    expect(candidates[1]?.eventTimeMs).toBe(20_000);
    expect(candidates[0]?.candidateId).toBe("ec-1");
    expect(candidates[1]?.candidateId).toBe("ec-2");
  });

  test("case-insensitive matching, verbatim eventPhrase", () => {
    const upper = extractEventCandidates({ units: [unit(30_000, "WHAT A GOAL!")] });
    expect(upper).toHaveLength(1);
    expect(upper[0]?.eventType).toBe("goal");
    expect(upper[0]?.eventPhrase).toBe("GOAL");

    const lower = extractEventCandidates({ units: [unit(31_000, "he scores, it's a goal!")] });
    expect(lower).toHaveLength(2);
    expect(lower[0]?.eventPhrase).toBe("scores");
    expect(lower[1]?.eventPhrase).toBe("goal");
  });

  test("more specific pattern of a type wins contended spans", () => {
    // "shot on target" (0.7) beats the later, weaker bare-"shot" pattern
    // (0.6) at the same start: one candidate, the qualified phrase.
    const candidates = extractEventCandidates({
      units: [unit(40_000, "A shot on target from distance.")],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.eventType).toBe("shot");
    expect(candidates[0]?.eventPhrase).toBe("shot on target");
    expect(candidates[0]?.confidence).toBeCloseTo(0.5 * 0.7 + 0.3 * 0.4 + 0.2, 12);
  });

  test("no match -> 0 candidates", () => {
    const candidates = extractEventCandidates({
      units: [unit(50_000, "The weather is lovely today.")],
    });
    expect(candidates).toHaveLength(0);
  });

  test("equal-start cross-type contention resolves by priority (free-kick over kickoff)", () => {
    // "free kick-off" matches free-kick [0,9) and kickoff [5,13) — the
    // spans overlap, the earlier start wins: free-kick.
    const candidates = extractEventCandidates({
      units: [unit(60_000, "free kick-off taken short.")],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.eventType).toBe("free-kick");
    expect(candidates[0]?.eventPhrase).toBe("free kick");
  });

  test("a goal in a unit absorbs the unit's save and shot matches", () => {
    // No sentence terminators inside: one sentence with shoot + save +
    // score calls; the goal absorbs both lower family members.
    const candidates = extractEventCandidates({
      units: [unit(70_000, "He shoots, the keeper saves, and the rebound is scored!")],
    });
    const types = candidates.map((candidate) => candidate.eventType);
    expect(types).toEqual(["goal"]);
    expect(candidates[0]?.eventPhrase).toBe("scored");
  });
});
