import { describe, expect, test } from "bun:test";
import { FOOTBALL_EVENT_TYPES } from "@sporta/contracts";
import {
  EVENT_PHRASES,
  PERIOD_PHRASES,
  SCORE_UNCONFIRMED_MARK,
  STATUS_SEPARATOR,
  STOPPAGE_MARK,
  captionForEvent,
  formatClock,
  scorePart,
  statusLine,
} from "../src/index";
import type { Score } from "@sporta/contracts";

/** A score slot helper ( UncertainValue<ScoreStatusValue> shapes). */
function score(home: number, away: number, slot: Score["status"]): Score {
  return {
    home,
    away,
    status: slot,
  };
}

describe("EVENT_PHRASES — the DATA-pure phrase table", () => {
  test("covers the ENTIRE football v1 taxonomy (no missing caption type)", () => {
    for (const type of FOOTBALL_EVENT_TYPES) {
      expect(EVENT_PHRASES[type], `phrase for ${type}`).toMatch(/^[A-Za-z][A-Za-z !-]*$/);
    }
    expect(Object.keys(EVENT_PHRASES)).toHaveLength(FOOTBALL_EVENT_TYPES.length);
  });

  test("phrases are pinned verbatim (no invented text can drift in)", () => {
    expect(EVENT_PHRASES.goal).toBe("GOAL!");
    expect(EVENT_PHRASES.save).toBe("Save!");
    expect(EVENT_PHRASES.shot).toBe("Shot!");
    expect(EVENT_PHRASES.pass).toBe("Pass");
    expect(EVENT_PHRASES.kickoff).toBe("Kick-off");
    expect(EVENT_PHRASES["possession-change"]).toBe("Possession change");
    expect(EVENT_PHRASES["referee-decision"]).toBe("Referee decision");
    expect(EVENT_PHRASES.substitution).toBe("Substitution");
  });
});

describe("captionForEvent — verbatim lookup, no invention", () => {
  test("football/v1/<known type> maps to the fixed phrase", () => {
    expect(captionForEvent("football/v1/goal")).toBe("GOAL!");
    expect(captionForEvent("football/v1/pass")).toBe("Pass");
    expect(captionForEvent("football/v1/save")).toBe("Save!");
  });

  test("unknown football types are NOT captioned (undefined — accounted upstream)", () => {
    expect(captionForEvent("football/v1/variant-unknown")).toBeUndefined();
    expect(captionForEvent("football/v1/")).toBeUndefined();
  });

  test("other taxonomies/sports are NOT captioned (no cross-taxonomy guessing)", () => {
    expect(captionForEvent("football/v2/goal")).toBeUndefined();
    expect(captionForEvent("basketball/v1/goal")).toBeUndefined();
    expect(captionForEvent("goal")).toBeUndefined();
    expect(captionForEvent("")).toBeUndefined();
  });
});

describe("formatClock — MM:SS, verbatim, never clamped", () => {
  test("zero and simple values", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(59_000)).toBe("00:59");
    expect(formatClock(60_000)).toBe("01:00");
    expect(formatClock(754_000)).toBe("12:34");
  });

  test("seconds are zero-padded to 2; minutes are not capped (no 90:00 clamp)", () => {
    expect(formatClock(5_000)).toBe("00:05");
    expect(formatClock(3_725_000)).toBe("62:05"); // 62nd minute
    expect(formatClock(5_700_000)).toBe("95:00"); // 95th minute stoppage time
  });

  test("sub-second truncation is floor, not rounding (documented)", () => {
    expect(formatClock(59_999)).toBe("00:59");
    expect(formatClock(4_999)).toBe("00:04");
  });
});

describe("scorePart — honest score display", () => {
  test("known + confirmed → plain score", () => {
    expect(scorePart(score(1, 0, { status: "known", value: "confirmed" }))).toBe("1-0");
    expect(scorePart(score(2, 3, { status: "known", value: "confirmed" }))).toBe("2-3");
  });

  test("known + provisional → visibly marked candidate", () => {
    expect(scorePart(score(1, 0, { status: "known", value: "provisional" }))).toBe(
      `1-0${SCORE_UNCONFIRMED_MARK}`,
    );
    expect(scorePart(score(1, 0, { status: "known", value: "provisional" }))).toBe("1-0?");
  });

  test("uncertain (candidate with confidence) → visibly marked", () => {
    expect(
      scorePart(score(1, 0, { status: "uncertain", value: "provisional", confidence: 0.8 })),
    ).toBe("1-0?");
  });

  test("status unknown → OMITTED (never display an unestablished candidate)", () => {
    expect(scorePart(score(0, 0, { status: "unknown" }))).toBeUndefined();
  });

  test("a known/uncertain slot without a value → omitted (honest)", () => {
    expect(scorePart(score(0, 0, { status: "known" }))).toBeUndefined();
    expect(scorePart(score(0, 0, { status: "uncertain", confidence: 0.5 }))).toBeUndefined();
  });
});

describe("statusLine — fixed template assembly", () => {
  const football = {
    clock: { period: "first-half" as const, clockMs: 754_000, stoppage: false },
    score: score(1, 0, { status: "uncertain", value: "provisional", confidence: 0.8 }),
  };

  test("period phrase · clock · score, joined by the fixed separator", () => {
    expect(statusLine(football)).toBe(`First half · 12:34 · 1-0${SCORE_UNCONFIRMED_MARK}`);
    expect(statusLine(football)).toBe("First half · 12:34 · 1-0?");
    expect(STATUS_SEPARATOR).toBe(" · ");
  });

  test("unestablished score is omitted from the line (no invented score)", () => {
    const line = statusLine({
      clock: football.clock,
      score: score(0, 0, { status: "unknown" }),
    });
    expect(line).toBe("First half · 12:34");
  });

  test("stoppage flag appends the fixed +stoppage mark", () => {
    const line = statusLine({
      clock: { period: "second-half", clockMs: 2_820_000, stoppage: true },
      score: score(1, 1, { status: "known", value: "confirmed" }),
    });
    expect(line).toBe(`Second half · 47:00 · 1-1 · ${STOPPAGE_MARK}`);
    expect(STOPPAGE_MARK).toBe("+stoppage");
  });

  test("every match period has a fixed phrase (table coverage)", () => {
    for (const period of Object.keys(PERIOD_PHRASES) as Array<keyof typeof PERIOD_PHRASES>) {
      expect(PERIOD_PHRASES[period].length).toBeGreaterThan(0);
    }
    expect(PERIOD_PHRASES["first-half"]).toBe("First half");
    expect(PERIOD_PHRASES["post-match"]).toBe("Full time");
    expect(PERIOD_PHRASES.stoppage).toBe("Stoppage");
  });
});
