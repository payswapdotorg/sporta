/**
 * W209 subject tests: lexicon matching, roles by text order, partial
 * surnames, and the never-invent-names rule.
 */
import { describe, expect, test } from "bun:test";
import { extractSubjects } from "../src/subjects";
import { extractEventCandidates } from "../src/index";
import type { CommentaryUnit } from "@sporta/commentary-segmentation";

function unit(startMs: number, text: string): CommentaryUnit {
  return { unitId: "cu-1", startMs, endMs: startMs + 500, text, sourceWindowIds: ["tu-0"] };
}

describe("subject extraction", () => {
  test("'Salah passes to Mane': Salah agent (before phrase), Mane patient (after, pass patient slot)", () => {
    // The event phrase is the starter's "passes" match; Salah ends before
    // it starts (agent), Mane starts after it ends and pass carries the
    // "to <recipient>" patient slot.
    const subjects = extractSubjects({
      sentence: "Salah passes to Mane.",
      phraseStart: 6,
      phraseEnd: 12,
      eventType: "pass",
      lexicon: { players: ["Salah", "Mane"], teams: [] },
    });
    expect(subjects).toEqual([
      { name: "Salah", role: "agent", nameConfidence: 1 },
      { name: "Mane", role: "patient", nameConfidence: 1 },
    ]);
  });

  test("agent/patient via the full pipeline (same expectations, end to end)", () => {
    const candidates = extractEventCandidates({
      units: [unit(10_000, "Salah passes to Mane.")],
      lexicon: { players: ["Salah", "Mane"], teams: [] },
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.subjects).toEqual([
      { name: "Salah", role: "agent", nameConfidence: 1 },
      { name: "Mane", role: "patient", nameConfidence: 1 },
    ]);
  });

  test("empty lexicon -> subjects [] and confidence reflects hasSubjects = false", () => {
    const candidates = extractEventCandidates({
      units: [unit(11_000, "Salah passes to Mane.")],
      lexicon: { players: [], teams: [] },
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.subjects).toEqual([]);
    // Hand-computed: 0.5 * 0.7 (pass strength) + 0.3 * 0.4 (no subjects)
    // + 0.2 * (1 - 0) = 0.35 + 0.12 + 0.2 = 0.67.
    expect(candidates[0]?.confidence).toBeCloseTo(0.67, 12);
  });

  test("partial surname 'K. Salah' lexicon entry matches on-air 'Salah' at 0.6", () => {
    // Rule: token "Salah" is fully contained in the lexicon name "K. Salah"
    // (and the shorter side, "Salah", is >= 4 chars) -> nameConfidence 0.6.
    // The exact-match branch never fires ("K. Salah" is not in the text).
    const candidates = extractEventCandidates({
      units: [unit(12_000, "Salah shoots and scores.")],
      lexicon: { players: ["K. Salah"], teams: [] },
    });
    // "shoots" is absorbed by the goal ("scores") — one goal candidate.
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.eventType).toBe("goal");
    expect(candidates[0]?.subjects).toEqual([
      { name: "Salah", role: "agent", nameConfidence: 0.6 },
    ]);
  });

  test("no invented names: unknown words are never subjects", () => {
    const candidates = extractEventCandidates({
      units: [unit(13_000, "Henderson crosses it deep.")],
      lexicon: { players: ["Salah"], teams: [] },
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.subjects).toEqual([]);
  });

  test("teams match too; after-phrase mentions of non-patient-slot types are 'unspecified'", () => {
    const subjects = extractSubjects({
      sentence: "Corner to City.",
      phraseStart: 0,
      phraseEnd: 6,
      eventType: "corner",
      lexicon: { players: [], teams: ["City"] },
    });
    expect(subjects).toEqual([{ name: "City", role: "unspecified", nameConfidence: 1 }]);
  });

  test("case-insensitive exact match keeps the verbatim (spoken) casing", () => {
    const subjects = extractSubjects({
      sentence: "salah PASSES to mane.",
      phraseStart: 6,
      phraseEnd: 12,
      eventType: "pass",
      lexicon: { players: ["Salah", "Mane"], teams: [] },
    });
    expect(subjects).toEqual([
      { name: "salah", role: "agent", nameConfidence: 1 },
      { name: "mane", role: "patient", nameConfidence: 1 },
    ]);
  });

  test("duplicate (name, role) pairs dedupe; same name in two roles is kept", () => {
    // Salah appears twice before the phrase -> ONE (agent) mention after
    // dedupe; the after-phrase Salah is a (patient) mention — different
    // role, so both survive.
    const subjects = extractSubjects({
      sentence: "Salah and Salah passes to Salah.",
      phraseStart: 16,
      phraseEnd: 22,
      eventType: "pass",
      lexicon: { players: ["Salah", "Mane"], teams: [] },
    });
    expect(subjects).toEqual([
      { name: "Salah", role: "agent", nameConfidence: 1 },
      { name: "Salah", role: "patient", nameConfidence: 1 },
    ]);
  });

  test("exact match requires whole word: 'Salah' inside 'Salahsson' is only the 0.6 partial", () => {
    // The exact branch (1.0) needs a whole-word occurrence — "Salah" is
    // glued into "Salahsson", so it does NOT fire. The documented partial
    // rule does ("Salah" fully contained in the token "Salahsson", shorter
    // side 5 >= 4 chars): a 0.6-confidence mention named by the verbatim
    // token.
    const subjects = extractSubjects({
      sentence: "Salahsson passes.",
      phraseStart: 10,
      phraseEnd: 16,
      eventType: "pass",
      lexicon: { players: ["Salah"], teams: [] },
    });
    expect(subjects).toEqual([{ name: "Salahsson", role: "agent", nameConfidence: 0.6 }]);
  });
});
