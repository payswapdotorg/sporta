/**
 * W209 confidence tests: the formula, hand-computed case by case.
 *
 *     confidence = 0.5 * patternStrength
 *                + 0.3 * (hasSubjects ? 1 : 0.4)
 *                + 0.2 * (1 - emphasis * 0.5)      clamped to [0, 1]
 */
import { describe, expect, test } from "bun:test";
import { candidateConfidence } from "../src/confidence";

describe("candidate confidence", () => {
  test("case 1: (strength 0.9, emphasis 0, subjects) -> 0.95", () => {
    // Arithmetic: 0.5 * 0.9 = 0.45; subjects present -> 0.3 * 1 = 0.3;
    // 0.2 * (1 - 0 * 0.5) = 0.2. Total: 0.45 + 0.3 + 0.2 = 0.95.
    expect(candidateConfidence(0.9, 0, true)).toBeCloseTo(0.95, 12);
  });

  test("case 2: (strength 0.7, emphasis 0.8, no subjects) -> 0.59", () => {
    // Arithmetic: 0.5 * 0.7 = 0.35; no subjects -> 0.3 * 0.4 = 0.12;
    // 0.2 * (1 - 0.8 * 0.5) = 0.2 * 0.6 = 0.12. Total: 0.35 + 0.12 +
    // 0.12 = 0.59. The emotion discount costs 0.02 — it tempers, never
    // flips, a detection.
    expect(candidateConfidence(0.7, 0.8, false)).toBeCloseTo(0.59, 12);
  });

  test("case 3: clamping boundary — full-evidence input sits exactly at 1", () => {
    // Arithmetic: 0.5 * 1 + 0.3 * 1 + 0.2 * 1 = 1.0 — the boundary value
    // itself, not a clamp. An out-of-range strength pushes the raw sum to
    // 1.25 and the clamp brings it back to 1 (defensive only: lexicon
    // strengths are <= 0.9 and emphasis is capped at 1).
    expect(candidateConfidence(1, 0, true)).toBe(1);
    expect(candidateConfidence(1.5, 0, true)).toBe(1);
    expect(candidateConfidence(-2, 0, false)).toBe(0);
  });

  test("worst honest case stays well above zero (explicit uncertainty, never dismissal)", () => {
    // Weakest realistic inputs: bare-shot strength 0.6, full emphasis, no
    // subjects: 0.3 + 0.12 + 0.2 * 0.5 = 0.52.
    expect(candidateConfidence(0.6, 1, false)).toBeCloseTo(0.52, 12);
  });
});
