/**
 * The W209 extraction pipeline — pure.
 *
 * `extractEventCandidates` turns W208 {@link CommentaryUnit}s into
 * {@link EventCandidate}s. DETERMINISTIC pattern matching only — no
 * language model, no RNG, no clock: the same input always yields a
 * deep-equal output (the benchmark's exact reproducibility rests on this).
 *
 * ## Algorithm (documented in full — the tests assert each rule)
 *
 * 1. **Sentence scan**. Each unit's text is split into sentences with the
 *    W208 terminator rule, reused verbatim: a `.`, `!` or `?` followed by
 *    whitespace or end-of-text closes a sentence at that character (so
 *    "3.5" and "Dr.Smith" do not split, "Dr. Smith" does — W208's
 *    documented abbreviation limitation carries over). Inter-sentence
 *    whitespace belongs to no sentence; empty-after-trim sentences are
 *    skipped. W208 units are already sentence-level, so in practice a
 *    unit yields one sentence — the split exists because the seam accepts
 *    any `CommentaryUnit`-shaped producer, and the multi-sentence unit is
 *    an asserted test case.
 * 2. **Left-to-right, non-overlapping span sweep (per unit)**. Every
 *    compiled lexicon pattern runs over every sentence (`matchAll`); all
 *    matches are collected with unit-text offsets, then sorted by
 *    (start, type priority, lexicon pattern index) — a total order, so
 *    the sweep is deterministic regardless of sort stability — and kept
 *    greedily: a match survives iff it starts at or after the previous
 *    KEPT match's end. Earlier-starting matches win contended spans; at
 *    equal starts the higher-priority type wins ("free kick-off" is a
 *    free-kick, not a kickoff); within one type the earlier-listed (more
 *    specific) pattern wins ("shot on target" over bare "shot").
 * 3. **Scoring-attempt absorption (per unit)** — the `goal > save > shot`
 *    priority chain: if any kept match of the unit is a `goal`, that
 *    unit's kept `save` and `shot` matches are dropped; else if any kept
 *    match is a `save`, its `shot` matches are dropped. One scoring
 *    attempt is reported by its OUTCOME ("He shoots... GOAL!" is one
 *    goal candidate, not a shot plus a goal). All other types coexist —
 *    a foul and the free-kick awarded for it are two events.
 * 4. **Per-candidate fields**. `eventTimeMs` = the unit's `startMs`
 *    (passthrough); `eventPhrase` = the exact matched span (verbatim);
 *    subjects are extracted from the CONTAINING sentence (agent/patient
 *    by text order — see `subjects.ts`); emphasis is the containing
 *    sentence's score; confidence per `confidence.ts`.
 * 5. **Ordering and ids**. Candidates are ordered by
 *    `(eventTimeMs, unit input index, sentence index, scan position)` —
 *    time first; the remaining keys make equal-time candidates fully
 *    deterministic — and `candidateId = "ec-<seq>"` is assigned AFTER
 *    ordering, from 1, so the sequence is gap-free and reproducible.
 */
import type { CommentaryUnit } from "@sporta/commentary-segmentation";
import { SCORING_FAMILY, COMPILED_EVENT_PATTERNS } from "./lexicon";
import type { CompiledEventPattern } from "./lexicon";
import { extractSubjects } from "./subjects";
import type { KnownEntityLexicon } from "./subjects";
import { emphasisScore } from "./emphasis";
import { candidateConfidence } from "./confidence";
import type { EventCandidate } from "./types";

/** Input for {@link extractEventCandidates}. */
export interface ExtractEventCandidatesInput {
  /** W208 commentary units, any order (output ordering is total). */
  readonly units: readonly CommentaryUnit[];
  /**
   * Fixture-scoped entity vocabulary for subject extraction. Omitted or
   * empty → no subjects, never name guessing.
   */
  readonly lexicon?: KnownEntityLexicon;
}

/** One sentence of a unit's text, with its offset into the unit text. */
export interface SentenceSpan {
  /** The sentence's text (terminator included when present). */
  readonly text: string;
  /** Character offset of the sentence's first character in the unit text. */
  readonly startOffset: number;
}

/** Whitespace test (ECMAScript `\s`) — the W208 terminator rule. */
const WS = /\s/;

/**
 * Splits text into sentences with the W208 terminator rule (see module
 * docs, rule 1). Exported because the tests assert the split directly.
 * Pure and deterministic.
 */
export function splitSentences(text: string): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  let pos = 0;
  while (pos < text.length) {
    // Inter-sentence whitespace belongs to no sentence.
    while (pos < text.length && WS.test(text[pos] as string)) pos += 1;
    if (pos >= text.length) break;

    // First closeable terminator from pos: . ! ? followed by whitespace/end.
    let close = -1;
    for (let index = pos; index < text.length; index += 1) {
      const ch = text[index] as string;
      if (ch === "." || ch === "!" || ch === "?") {
        const next = text[index + 1];
        if (next === undefined || WS.test(next)) {
          close = index;
          break;
        }
      }
    }
    const hardEnd = close === -1 ? text.length : close + 1;
    let end = hardEnd;
    if (close === -1) {
      // Unterminated tail: trim trailing whitespace (W208 flush behavior).
      while (end > pos && WS.test(text[end - 1] as string)) end -= 1;
    }
    const sentenceText = text.slice(pos, end);
    if (sentenceText.trim() !== "") out.push({ text: sentenceText, startOffset: pos });
    pos = hardEnd;
  }
  return out;
}

/** One raw pattern match, positioned in the UNIT text, pre-resolution. */
interface RawMatch {
  readonly pattern: CompiledEventPattern;
  /** Match start, as an offset into the unit text. */
  readonly start: number;
  /** Match end (exclusive), as an offset into the unit text. */
  readonly end: number;
  readonly sentenceIndex: number;
  readonly unitIndex: number;
}

/**
 * The left-to-right non-overlapping span sweep over one unit's matches
 * (rule 2): sort by (start, type priority, pattern index) — a total
 * order — then keep greedily.
 */
function sweep(matches: readonly RawMatch[]): RawMatch[] {
  const ordered = [...matches].sort(
    (a, b) =>
      a.start - b.start ||
      a.pattern.priority - b.pattern.priority ||
      a.pattern.patternIndex - b.pattern.patternIndex,
  );
  const kept: RawMatch[] = [];
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (const match of ordered) {
    if (match.start >= lastEnd) {
      kept.push(match);
      lastEnd = match.end;
    }
  }
  return kept;
}

/**
 * The scoring-attempt absorption (rule 3): within the unit, the
 * highest-priority SCORING_FAMILY member that matched (lowest rank) is
 * kept and absorbs the lower-priority ones (goal > save > shot).
 */
function absorbScoringAttempts(kept: readonly RawMatch[]): RawMatch[] {
  let best: number | undefined;
  for (const match of kept) {
    const rank = SCORING_FAMILY.indexOf(match.pattern.eventType);
    if (rank !== -1 && (best === undefined || rank < best)) best = rank;
  }
  if (best === undefined) return [...kept];
  const absorbed = SCORING_FAMILY.slice(best + 1); // strictly lower priority
  return kept.filter((match) => !absorbed.includes(match.pattern.eventType));
}

/**
 * Extracts event candidates from commentary units (see the module docs
 * for the full documented algorithm). Pure: same input → deep-equal
 * output; `[]` in, `[]` out.
 */
export function extractEventCandidates(input: ExtractEventCandidatesInput): EventCandidate[] {
  const collected: Array<
    Omit<EventCandidate, "candidateId"> & { order: [number, number, number, number] }
  > = [];

  input.units.forEach((unit, unitIndex) => {
    const sentences = splitSentences(unit.text);
    const matches: RawMatch[] = [];
    sentences.forEach((sentence, sentenceIndex) => {
      for (const pattern of COMPILED_EVENT_PATTERNS) {
        for (const match of sentence.text.matchAll(pattern.regex)) {
          if (match.index === undefined) continue;
          matches.push({
            pattern,
            start: sentence.startOffset + match.index,
            end: sentence.startOffset + match.index + (match[0] as string).length,
            sentenceIndex,
            unitIndex,
          });
        }
      }
    });

    const resolved = absorbScoringAttempts(sweep(matches));
    for (const match of resolved) {
      const sentence = sentences[match.sentenceIndex] as SentenceSpan;
      const phraseStart = match.start - sentence.startOffset;
      const phraseEnd = match.end - sentence.startOffset;
      const subjects = extractSubjects({
        sentence: sentence.text,
        phraseStart,
        phraseEnd,
        eventType: match.pattern.eventType,
        lexicon: input.lexicon,
      });
      const emphasis = emphasisScore(sentence.text);
      collected.push({
        unitId: unit.unitId,
        eventTimeMs: unit.startMs,
        eventType: match.pattern.eventType,
        eventPhrase: unit.text.slice(match.start, match.end),
        subjects,
        emphasis,
        confidence: candidateConfidence(match.pattern.strength, emphasis, subjects.length > 0),
        order: [unit.startMs, unitIndex, match.sentenceIndex, match.start],
      });
    }
  });

  // Rule 5: total-order the candidates, then assign ids after ordering.
  collected.sort((a, b) => {
    for (let index = 0; index < 4; index += 1) {
      const av = a.order[index] as number;
      const bv = b.order[index] as number;
      if (av !== bv) return av - bv;
    }
    return 0;
  });
  return collected.map((candidate, index) => ({
    candidateId: `ec-${index + 1}`,
    unitId: candidate.unitId,
    eventTimeMs: candidate.eventTimeMs,
    eventType: candidate.eventType,
    eventPhrase: candidate.eventPhrase,
    subjects: candidate.subjects,
    emphasis: candidate.emphasis,
    confidence: candidate.confidence,
  }));
}
