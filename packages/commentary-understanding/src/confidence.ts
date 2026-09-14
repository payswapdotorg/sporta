/**
 * Candidate confidence (W209) — explicit.
 *
 * `candidateConfidence` fuses the three evidence signals a deterministic
 * extraction has, with weights that reflect how much each should move the
 * final number:
 *
 * - **Pattern evidence (weight 0.5)** — the matched pattern's `strength`
 *   (lexicon-curated: "offside" 0.9 is near-unambiguous, bare "shot" 0.6
 *   is not). The dominant term: the pattern IS the extraction.
 * - **Corroborating subject evidence (weight 0.3)** — full credit when the
 *   containing sentence named a known entity, else 0.4 of the term (not
 *   zero: "Free-kick given." with no names is still decent evidence —
 *   penalized, not dismissed).
 * - **Emotion discount (weight 0.2 × (1 − emphasis × 0.5))** — excited
 *   commentators OVER-CLAIM ("UNBELIEVABLE!!!" is often a routine pass).
 *   The discount is capped at half the emphasis (a full 1.0 emphasis costs
 *   only 0.1), so it TEMPERS confidence without ever flipping a detection
 *   decision — the pattern and subject terms dominate by construction
 *   (architecture-lock §4: explicit uncertainty, never invented either
 *   way).
 *
 * Result clamped to [0, 1] (defensive: the lexicon keeps strengths ≤ 0.9
 * and emphasis is capped at 1, so production inputs already land inside).
 * Pure: same arguments → same number.
 */

/** Weight of the pattern-strength evidence term. */
export const PATTERN_WEIGHT = 0.5;
/** Weight of the subject-corroboration evidence term. */
export const SUBJECT_WEIGHT = 0.3;
/** Weight of the emotion term. */
export const EMOTION_WEIGHT = 0.2;
/** Subject-term value when NO subject was found (penalized, not zeroed). */
export const NO_SUBJECT_FACTOR = 0.4;
/** Cap on the emphasis discount inside the emotion term. */
export const EMOTION_DISCOUNT_FACTOR = 0.5;

/**
 * The candidate confidence in [0, 1]:
 *
 *     0.5 * patternStrength
 *   + 0.3 * (hasSubjects ? 1 : 0.4)
 *   + 0.2 * (1 - emphasis * 0.5)
 *
 * clamped to [0, 1]. See the module docs for the rationale.
 */
export function candidateConfidence(
  patternStrength: number,
  emphasis: number,
  hasSubjects: boolean,
): number {
  const raw =
    PATTERN_WEIGHT * patternStrength +
    SUBJECT_WEIGHT * (hasSubjects ? 1 : NO_SUBJECT_FACTOR) +
    EMOTION_WEIGHT * (1 - emphasis * EMOTION_DISCOUNT_FACTOR);
  return Math.min(1, Math.max(0, raw));
}
