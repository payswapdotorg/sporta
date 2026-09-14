import { describe, expect, test } from "bun:test";
import {
  CAMERA_LABEL_PREFIX,
  EVENT_PHRASES,
  PERIOD_PHRASES,
  SCORE_UNCONFIRMED_MARK,
  STATUS_SEPARATOR,
  STOPPAGE_MARK,
  cameraLabel,
  eventChipText,
  eventPhrase,
  formatClock,
  scorePart,
  statusLine,
} from "../src/index";
import type { Score } from "@sporta/contracts";
import type { SceneScoreClock } from "@sporta/scene-projection";

/** A `Score` helper (the contracts uncertain-slot shape). */
function score(
  home: number,
  away: number,
  status: "known" | "uncertain",
  value: "confirmed" | "provisional",
): Score {
  return { home, away, status: { status, value } };
}

/** A minimal score/clock block (the SceneScoreClock shape). */
function block(overrides: Partial<SceneScoreClock>): SceneScoreClock {
  return {
    footballState: true,
    score: score(2, 1, "known", "confirmed"),
    clock: { period: "second-half", clockMs: 2_704_000, stoppage: false },
    ...overrides,
  };
}

describe("eventPhrase / eventChipText — fixed phrases + verbatim fallback", () => {
  test("the phrase table covers the football/v1 taxonomy with fixed strings", () => {
    expect(EVENT_PHRASES).toMatchObject({
      kickoff: "Kick-off",
      pass: "Pass",
      goal: "GOAL!",
      shot: "Shot!",
      save: "Save!",
    });
    expect(Object.keys(EVENT_PHRASES)).toHaveLength(16);
  });

  test("eventPhrase resolves football/v1 refs and rejects other namespaces", () => {
    expect(eventPhrase("football/v1/goal")).toBe("GOAL!");
    expect(eventPhrase("football/v1/pass")).toBe("Pass");
    expect(eventPhrase("football/v9/goal")).toBeUndefined(); // version drift: not v1
    expect(eventPhrase("hockey/v1/goal")).toBeUndefined(); // other taxonomy
    expect(eventPhrase("goal")).toBeUndefined(); // bare type, no namespace
  });

  test("eventChipText: known → phrase, unknown → the VERBATIM ref (never invented)", () => {
    expect(eventChipText("football/v1/goal")).toBe("GOAL!");
    expect(eventChipText("football/v9/variant-unknown")).toBe("football/v9/variant-unknown");
    expect(eventChipText("corner/v2/tifo")).toBe("corner/v2/tifo");
  });
});

describe("formatClock — fixed MM:SS template over verbatim milliseconds", () => {
  test("zero, minute, and sub-minute clocks", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(1)).toBe("00:00"); // sub-second truncates (floor)
    expect(formatClock(59_999)).toBe("00:59");
    expect(formatClock(60_000)).toBe("01:00");
  });

  test("the fixture clock: 2 704 000 ms → 45:04", () => {
    expect(formatClock(2_704_000)).toBe("45:04");
  });

  test("minutes are unbounded (a 95th-minute clock never clamps)", () => {
    expect(formatClock(95 * 60_000)).toBe("95:00");
    expect(formatClock(123 * 60_000 + 59_000)).toBe("123:59");
  });
});

describe("scorePart — verbatim score with honest uncertainty marking", () => {
  test("known + confirmed → the asserted score", () => {
    expect(scorePart(score(2, 1, "known", "confirmed"))).toBe("2-1");
    expect(scorePart(score(0, 0, "known", "confirmed"))).toBe("0-0");
  });

  test("provisional or uncertain → the candidate score visibly marked", () => {
    expect(scorePart(score(2, 1, "known", "provisional"))).toBe(`2-1${SCORE_UNCONFIRMED_MARK}`);
    expect(scorePart(score(2, 1, "uncertain", "provisional"))).toBe("2-1?");
  });

  test("unknown status or a valueless slot → undefined (never invented)", () => {
    expect(scorePart({ home: 2, away: 1, status: { status: "unknown" } })).toBeUndefined();
    expect(scorePart({ home: 2, away: 1, status: { status: "known" } })).toBeUndefined();
  });
});

describe("statusLine — fixed template, verbatim parts", () => {
  test("the fixture line: Second half · 45:04 · 2-1", () => {
    expect(statusLine(block({}))).toBe(`Second half${STATUS_SEPARATOR}45:04${STATUS_SEPARATOR}2-1`);
  });

  test("an unestablished score is omitted, never invented", () => {
    const line = statusLine(block({ score: { home: 2, away: 1, status: { status: "unknown" } } }));
    expect(line).toBe("Second half · 45:04");
  });

  test("stoppage appends the fixed mark (joined as its own part)", () => {
    const line = statusLine(
      block({ clock: { period: "stoppage", clockMs: 2_800_000, stoppage: true } }),
    );
    expect(line).toBe(
      `Stoppage${STATUS_SEPARATOR}46:40${STATUS_SEPARATOR}2-1${STATUS_SEPARATOR}${STOPPAGE_MARK}`,
    );
  });

  test("an unknown period falls back to the verbatim period string", () => {
    // period is a zod enum in the contracts; a future/unknown period value
    // in a hand-authored block still renders verbatim, never a guess.
    const line = statusLine(
      block({ clock: { period: "extra-time" as never, clockMs: 0, stoppage: false } }),
    );
    expect(line).toContain("extra-time");
  });

  test("no football state → undefined (honest omission)", () => {
    expect(statusLine({ footballState: false })).toBeUndefined();
  });

  test("football state with neither clock nor usable score → undefined", () => {
    expect(
      statusLine({
        footballState: true,
        score: { home: 0, away: 0, status: { status: "unknown" } },
      }),
    ).toBeUndefined();
  });

  test("the period phrase table covers every contracts MatchPeriod member", () => {
    // The contracts MatchPeriod enum (v1): the table must cover it exactly.
    const periods = [
      "pre-match",
      "first-half",
      "stoppage",
      "half-time",
      "second-half",
      "post-match",
    ];
    expect(Object.keys(PERIOD_PHRASES).sort()).toEqual(periods.slice().sort());
  });
});

describe("cameraLabel — the slot annotation", () => {
  test("the slot id is verbatim behind the fixed prefix", () => {
    expect(cameraLabel("main-touchline")).toBe(`${CAMERA_LABEL_PREFIX}main-touchline`);
    expect(cameraLabel("aerial-tactical")).toBe("CAM · aerial-tactical");
    expect(cameraLabel("behind-goal-x105")).toBe("CAM · behind-goal-x105");
  });
});
