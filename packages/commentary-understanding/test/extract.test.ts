/**
 * W209 extraction pipeline tests: multi-sentence units, ordering,
 * candidateId sequence, and determinism.
 */
import { describe, expect, test } from "bun:test";
import { extractEventCandidates, splitSentences } from "../src/index";
import type { CommentaryUnit } from "@sporta/commentary-segmentation";

function unit(unitId: string, startMs: number, text: string): CommentaryUnit {
  return { unitId, startMs, endMs: startMs + 500, text, sourceWindowIds: ["tu-0"] };
}

describe("sentence splitting (W208 terminator rule, reused)", () => {
  test("terminator followed by whitespace or end closes; '3.5' does not", () => {
    expect(splitSentences("He shoots... GOAL!")).toEqual([
      { text: "He shoots...", startOffset: 0 },
      { text: "GOAL!", startOffset: 13 },
    ]);
    expect(splitSentences("It's 3.5 metres to the mark.")).toEqual([
      { text: "It's 3.5 metres to the mark.", startOffset: 0 },
    ]);
  });

  test("an unterminated tail is its own sentence, trimmed", () => {
    expect(splitSentences("One. two three   ")).toEqual([
      { text: "One.", startOffset: 0 },
      { text: "two three", startOffset: 5 },
    ]);
  });
});

describe("extraction pipeline", () => {
  test("multi-sentence unit: each sentence scanned independently", () => {
    // Sentence 1 yields the shot; sentence 2 yields the corner. Two
    // candidates, one unit, same eventTimeMs, ordered by sentence index.
    const candidates = extractEventCandidates({
      units: [unit("cu-1", 10_000, "He shoots wide. Then a corner comes in.")],
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.eventType).toBe("shot");
    expect(candidates[0]?.eventPhrase).toBe("shoots");
    expect(candidates[1]?.eventType).toBe("corner");
    expect(candidates[1]?.eventPhrase).toBe("corner");
    expect(candidates[0]?.unitId).toBe("cu-1");
    expect(candidates[1]?.unitId).toBe("cu-1");
  });

  test("candidates ordered by eventTimeMs regardless of input unit order", () => {
    // Units handed over out of time order: the later-starting unit's
    // candidates still come out in time order.
    const candidates = extractEventCandidates({
      units: [unit("cu-2", 20_000, "A corner."), unit("cu-1", 10_000, "A pass.")],
    });
    expect(candidates.map((c) => c.eventType)).toEqual(["pass", "corner"]);
    expect(candidates.map((c) => c.candidateId)).toEqual(["ec-1", "ec-2"]);
  });

  test("same-time candidates order by unit input index, then scan position", () => {
    const candidates = extractEventCandidates({
      units: [unit("cu-1", 10_000, "A foul and a free-kick."), unit("cu-2", 10_000, "Offside.")],
    });
    expect(candidates.map((c) => c.eventPhrase)).toEqual(["foul", "free-kick", "Offside"]);
    expect(candidates.map((c) => c.candidateId)).toEqual(["ec-1", "ec-2", "ec-3"]);
  });

  test("candidateId sequence is global, gap-free, assigned after ordering", () => {
    const candidates = extractEventCandidates({
      units: [
        unit("cu-1", 10_000, "He shoots wide."),
        unit("cu-2", 12_000, "It's a goal!"),
        unit("cu-3", 14_000, "Then another goal!"),
      ],
    });
    expect(candidates.map((c) => c.candidateId)).toEqual(["ec-1", "ec-2", "ec-3"]);
  });

  test("determinism: same input twice -> deep-equal output", () => {
    const input = {
      units: [
        unit("cu-1", 10_000, "Salah passes to Mane. Mane crosses."),
        unit("cu-2", 12_000, "GOAL! What a finish!"),
      ],
      lexicon: { players: ["Salah", "Mane"], teams: [] },
    };
    expect(extractEventCandidates(input)).toEqual(extractEventCandidates(input));
  });

  test("empty input -> empty output; eventTimeMs is the unit startMs passthrough", () => {
    expect(extractEventCandidates({ units: [] })).toEqual([]);
    const candidates = extractEventCandidates({
      units: [unit("cu-9", 77_777, "Free-kick.")],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.eventTimeMs).toBe(77_777);
  });
});
