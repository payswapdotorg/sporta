/**
 * @sporta/commentary-understanding — deterministic football commentary
 * understanding (work item W209).
 *
 * The third commentary-chain stage (architecture-lock §3 and §7): W208
 * sentence-level commentary units in; structured EVENT CANDIDATES out —
 * the commentary evidence stream W401 fuses with vision observations.
 * Module map:
 *
 * - `types`: `CommentaryEventType`, `SubjectMention`, `EventCandidate` —
 *   the extracted evidence with subjects, emphasis, and honest confidence
 * - `lexicon`: `EVENT_PATTERNS` (starter set + documented extensions),
 *   `EVENT_TYPE_PRIORITY` (the written-out resolution order),
 *   `compileEventPatterns` / `COMPILED_EVENT_PATTERNS` (precompiled once
 *   at module load — no runtime regex construction from input)
 * - `subjects`: `KnownEntityLexicon`, `extractSubjects` — fixture-scoped
 *   name matching (exact 1.0 / partial-surname 0.6), agent/patient by
 *   text order, never name guessing
 * - `emphasis`: `emphasisScore` + the exported rule table — how excited
 *   the sentence is (exclamation, caps, intensifiers; capped at 1)
 * - `confidence`: `candidateConfidence` — the documented formula fusing
 *   pattern strength, subject corroboration, and the capped emotion
 *   discount
 * - `extract`: `extractEventCandidates` — the pure pipeline (W208-style
 *   sentence split, left-to-right non-overlapping span sweep, type
 *   priority, goal > save > shot absorption, deterministic ordering and
 *   gap-free `ec-<seq>` ids), plus `splitSentences`
 * - `observe`: `emitEventCandidateObservations` — one contract
 *   `Observation` per candidate (commentary modality / DERIVED, generic
 *   payload, `subjectEntityRefs: []` — identity resolution is W401's
 *   job), plus the `validateObservation` zod-parse helper
 * - `benchmark`: `runExtractionBenchmark` + `BENCHMARK_FIXTURES` — the
 *   acceptance evidence (hand-annotated precision/recall/f1)
 *
 * Architecture-lock conformance: commentary is a first-class semantic
 * input — every extraction is a pure function of the input text (no
 * language model in this item, so the benchmark is exactly reproducible),
 * every candidate carries explicit confidence, and no subject is ever
 * invented (an empty lexicon yields empty subjects, never guesses).
 */
export type { CommentaryEventType, EventCandidate, SubjectMention } from "./types";
export {
  COMPILED_EVENT_PATTERNS,
  EVENT_PATTERNS,
  EVENT_TYPE_PRIORITY,
  SCORING_FAMILY,
  compileEventPatterns,
} from "./lexicon";
export type { CompiledEventPattern, EventPattern, EventTypePatterns } from "./lexicon";
export { EMPTY_LEXICON, PATIENT_SLOT_EVENT_TYPES, extractSubjects } from "./subjects";
export type { KnownEntityLexicon } from "./subjects";
export {
  CAPS_WORD_WEIGHT,
  EMPHASIS_MAX,
  EMPHASIS_RULES,
  EXCLAMATION_WEIGHT,
  INTENSIFIER_WEIGHT,
  INTENSIFIERS,
  emphasisScore,
} from "./emphasis";
export {
  EMOTION_DISCOUNT_FACTOR,
  EMOTION_WEIGHT,
  NO_SUBJECT_FACTOR,
  PATTERN_WEIGHT,
  SUBJECT_WEIGHT,
  candidateConfidence,
} from "./confidence";
export { extractEventCandidates, splitSentences } from "./extract";
export type { ExtractEventCandidatesInput, SentenceSpan } from "./extract";
export { emitEventCandidateObservations, validateObservation } from "./observe";
export type { EmitEventCandidatesInput } from "./observe";
export { BENCHMARK_FIXTURES, runExtractionBenchmark } from "./benchmark";
export type { ExtractionBenchmarkReport, ExtractionScenario } from "./benchmark";
