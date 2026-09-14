/**
 * Emphasis scoring (W209) — pure.
 *
 * `emphasisScore(text)` measures how EXCITED the commentary sentence is —
 * not what happened, but how loudly it was said. Architecture-lock §7:
 * commentary may influence event confidence AND presentation intensity;
 * this score is the honest, deterministic input to both uses (it is also
 * mirrored into each emitted observation's generic payload for W401 and
 * downstream presentation-intensity work).
 *
 * ## The rule table (each contribution documented; exported for tests)
 *
 * | id            | weight | condition                                                     |
 * |---------------|-------|---------------------------------------------------------------|
 * | exclamation   | 0.4   | the text contains at least one `!`                             |
 * | caps-word     | 0.2   | at least one ALL-CAPS word of ≥ 3 letters (`\b[A-Z]{3,}\b`)    |
 * | intensifier   | 0.2   | PER OCCURRENCE of an intensifier from the documented list below |
 *
 * - The intensifier list (case-insensitive substring counting):
 *   "what a", "incredible", "unbelievable", "sensational", "brilliant",
 *   "superb", "amazing", "fantastic".
 * - The total is CAPPED at 1: "UNBELIEVABLE! WHAT A GOAL! Sensational!"
 *   would score 0.4 + 0.2 + 0.6 = 1.2 uncapped, and reports 1.
 * - Determinism is trivial: pure string inspection, no RNG, no clock.
 */

/**
 * The documented intensifier list (case-insensitive, counted per
 * occurrence). Exported so tests assert the exact vocabulary.
 */
export const INTENSIFIERS: readonly string[] = [
  "what a",
  "incredible",
  "unbelievable",
  "sensational",
  "brilliant",
  "superb",
  "amazing",
  "fantastic",
];

/**
 * The emphasis rule table (id, weight, human-readable condition) —
 * exported for tests. `intensifier` applies per occurrence.
 */
export const EMPHASIS_RULES: ReadonlyArray<{
  readonly id: "exclamation" | "caps-word" | "intensifier";
  readonly weight: number;
  readonly condition: string;
}> = [
  { id: "exclamation", weight: 0.4, condition: "text contains at least one '!'" },
  { id: "caps-word", weight: 0.2, condition: "at least one all-caps word of >= 3 letters" },
  { id: "intensifier", weight: 0.2, condition: "per occurrence of a listed intensifier" },
];

/** Exclamation contribution: 0.4 iff the text contains `!`. */
export const EXCLAMATION_WEIGHT = 0.4;
/** Caps-word contribution: 0.2 iff an all-caps word (≥ 3 letters) occurs. */
export const CAPS_WORD_WEIGHT = 0.2;
/** Per-intensifier-occurrence contribution. */
export const INTENSIFIER_WEIGHT = 0.2;
/** Total cap. */
export const EMPHASIS_MAX = 1;

/** Module-level constant — at least one ALL-CAPS word of ≥ 3 letters. */
const CAPS_WORD = /\b[A-Z]{3,}\b/;

/** Case-insensitive occurrence count of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const index = haystack.toLowerCase().indexOf(needle.toLowerCase(), from);
    if (index === -1) break;
    count += 1;
    from = index + needle.length; // non-overlapping, deterministic
  }
  return count;
}

/**
 * The emphasis score of one commentary sentence in [0, 1] — see the module
 * docs for the exact rule table. Pure: same text → same score.
 */
export function emphasisScore(text: string): number {
  let score = 0;
  if (text.includes("!")) score += EXCLAMATION_WEIGHT;
  if (CAPS_WORD.test(text)) score += CAPS_WORD_WEIGHT;
  for (const intensifier of INTENSIFIERS) {
    score += INTENSIFIER_WEIGHT * countOccurrences(text, intensifier);
  }
  return Math.min(score, EMPHASIS_MAX);
}
