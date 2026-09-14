/**
 * W209 emphasis tests: each rule's contribution, documented by arithmetic.
 */
import { describe, expect, test } from "bun:test";
import { EMPHASIS_RULES, INTENSIFIERS, emphasisScore } from "../src/emphasis";

describe("emphasis scoring", () => {
  test("'Great save!' -> 0.4 (exclamation only)", () => {
    // "!" -> +0.4; no all-caps word ("Great"/"save" are mixed/lower case);
    // "great" is NOT in the intensifier list (deliberately — see
    // INTENSIFIERS). Total: 0.4.
    expect(emphasisScore("Great save!")).toBe(0.4);
  });

  test("'WHAT A GOAL!' -> 0.8 (exclamation 0.4 + caps 0.2 + 'what a' 0.2)", () => {
    // "!" -> +0.4; "WHAT"/"GOAL" are all-caps >= 3 letters -> +0.2;
    // "what a" (case-insensitive) -> +0.2. Total: 0.8.
    expect(emphasisScore("WHAT A GOAL!")).toBe(0.8);
  });

  test("plain 'He passes.' -> 0 (no rule fires)", () => {
    expect(emphasisScore("He passes.")).toBe(0);
  });

  test("intensifiers count per occurrence (case-insensitive)", () => {
    // "incredible" twice: 2 * 0.2 = 0.4.
    expect(emphasisScore("Incredible play, simply incredible.")).toBe(0.4);
  });

  test("caps word needs >= 3 letters", () => {
    // "GO" is 2 letters — too short; "TV" likewise. No caps contribution.
    expect(emphasisScore("He shoots GO!")).toBe(0.4);
    expect(emphasisScore("on TV tonight")).toBe(0);
  });

  test("total is capped at 1", () => {
    // "!" 0.4 + caps 0.2 + four intensifiers ("unbelievable",
    // "sensational", "what a", "incredible") 0.8 = 1.4 uncapped -> 1.
    expect(emphasisScore("UNBELIEVABLE! SENSATIONAL! WHAT A GOAL! Incredible!")).toBe(1);
  });

  test("the documented rule table and intensifier list are exported", () => {
    expect(EMPHASIS_RULES).toEqual([
      { id: "exclamation", weight: 0.4, condition: "text contains at least one '!'" },
      { id: "caps-word", weight: 0.2, condition: "at least one all-caps word of >= 3 letters" },
      { id: "intensifier", weight: 0.2, condition: "per occurrence of a listed intensifier" },
    ]);
    expect(INTENSIFIERS).toEqual([
      "what a",
      "incredible",
      "unbelievable",
      "sensational",
      "brilliant",
      "superb",
      "amazing",
      "fantastic",
    ]);
  });
});
