/**
 * Core W209 types: the event candidate that leaves this package.
 *
 * W208 delivers sentence-level {@link CommentaryUnit}s; W209 extracts
 * STRUCTURED EVENT CANDIDATES from them — deterministic pattern matching
 * over text (lexicons + grammatical templates), NO language model (that
 * arrives with the later GPU/agent-protocol items). Every extraction is a
 * pure function of the input text, so the benchmark is exactly reproducible.
 *
 * The candidate stream is commentary-derived EVIDENCE, never fact
 * (architecture-lock §4: explicit uncertainty rather than invented
 * certainty; §7: commentary may influence event confidence but never
 * overwrite higher-confidence visual evidence). W401's multimodal fusion
 * is the consumer that turns candidates into versioned SWM state — hence:
 *
 * - every candidate carries an honest per-candidate `confidence` in
 *   [0, 1] derived from pattern strength, subject corroboration, and an
 *   excitement discount (see `confidence.ts`);
 * - `subjects` may be EMPTY — no subject found is a valid, honest result;
 * - `candidateId` is assigned AFTER deterministic ordering, so the same
 *   input always yields the same gap-free id sequence.
 */

import type { CommentaryUnit } from "@sporta/commentary-segmentation";

/**
 * The football event types W209 can extract deterministically.
 *
 * Aligned with the `FOOTBALL_EVENT_TYPES` naming conventions in
 * `@sporta/contracts` (kebab-case, lowercase) where the two vocabularies
 * overlap (`pass`, `shot`, `save`, `goal`, `card`, `substitution`,
 * `offside`, `kickoff`). Types that exist here but not in the canonical
 * taxonomy yet (`corner`, `foul`, `free-kick`, `throw-in`, `fulltime`)
 * are restart/stoppage detail the taxonomy models via `restart` /
 * `referee-decision` plus its own `commentary-emphasis` channel; the
 * mapping to canonical `eventTypeRef` strings is W401 fusion territory,
 * not this package's.
 *
 * `"other"` is RESERVED: no deterministic pattern maps to it (the lexicon
 * carries no `other` entry). It exists so later LLM-based understanding
 * items can classify commentary spans no template matches without a
 * breaking change to this type.
 */
export type CommentaryEventType =
  | "pass"
  | "shot"
  | "goal"
  | "save"
  | "corner"
  | "foul"
  | "free-kick"
  | "offside"
  | "throw-in"
  | "substitution"
  | "card"
  | "kickoff"
  | "fulltime"
  | "other";

/**
 * One mention of a known entity (player or team) in the sentence containing
 * an event phrase. Names are NEVER invented: a mention exists only for a
 * whole-word (or documented partial-surname) match against the
 * fixture-scoped {@link KnownEntityLexicon}.
 */
export interface SubjectMention {
  /** The matched text span, verbatim (trimmed) — the name AS SAID on air. */
  name: string;
  /**
   * Who did it vs whom it affected — a TEXT-ORDER heuristic, not syntax
   * analysis (documented limitation): `"agent"` when the mention appears
   * before the event phrase in the same sentence, `"patient"` when after
   * it AND the event type carries a patient slot (pass/save/substitution —
   * the "to/for" recipient template), else `"unspecified"`.
   */
  role: "agent" | "patient" | "unspecified";
  /**
   * Vocabulary match strength: 1.0 for an exact whole-word lexicon match,
   * 0.6 for a documented partial-surname match (see `subjects.ts`).
   */
  nameConfidence: number;
}

/** One extracted event candidate — the atomic commentary evidence unit. */
export interface EventCandidate {
  /**
   * Candidate id: `"ec-<seq>"` where `<seq>` is the GLOBAL sequence starting
   * at 1, assigned after the deterministic output ordering (time, sentence
   * index, scan position) — so ids are gap-free and reproducible.
   */
  candidateId: string;
  /** Provenance: the W208 commentary unit the candidate was extracted from. */
  unitId: CommentaryUnit["unitId"];
  /** Session-timeline time (milliseconds) — PASSTHROUGH of the unit's `startMs`. */
  eventTimeMs: number;
  /** The event type resolved by the documented priority order (`lexicon.ts`). */
  eventType: CommentaryEventType;
  /** The matched text span, VERBATIM (exact substring of the unit's text). */
  eventPhrase: string;
  /**
   * Entity mentions in the containing sentence. May be empty — honest: no
   * lexicon name appeared. Commentary may name several players.
   */
  subjects: SubjectMention[];
  /** Excitement of the containing sentence in [0, 1] (see `emphasis.ts`). */
  emphasis: number;
  /** Honest per-candidate confidence in [0, 1] (see `confidence.ts`). */
  confidence: number;
}
