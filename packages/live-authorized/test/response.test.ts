/**
 * THE L009 RECORDED-RESPONSE BATTERY — the authorized API's page envelope
 * and frame core, pinned by FORMAT-FIXTURES (the recorded schema with
 * SYNTHETIC values — sample data is NEVER committed, the L007 convention).
 *
 * The fixtures encode:
 * - the DRF list envelope `{count, next, previous, results}` (recorded
 *   from the provider SDK's pagination.py, fetched 2026-09-21);
 * - the provider's published tracking frame core (the opendata schema of
 *   record): frame/timestamp/period/ball_data/player_data;
 * - the authorized-shape doctrine: strict on consumed fields, COUNTING the
 *   unmapped and the unknown.
 */
import { describe, expect, test } from "bun:test";
import {
  SkillCornerAuthorizedFormatError,
  parseSkillCornerAuthorizedPage,
  parseSkillCornerAuthorizedFrame,
  parseSkillCornerAuthorizedTimestampMs,
  SKILLCORNER_AUTHORIZED_CONSUMED_FIELDS,
  SKILLCORNER_AUTHORIZED_UNMAPPED_FIELDS,
} from "../src/skillcorner/response";

/** One synthetic frame in the RECORDED shape (format-fixture, not data). */
function fixtureFrame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    frame: 28203,
    timestamp: "00:42:49.30",
    period: 1,
    ball_data: { x: -9.54, y: -33.08, z: 1.84, is_detected: false },
    player_data: [
      { x: -44.62, y: -8.31, player_id: 51678, is_detected: false },
      { x: 12.4, y: 3.1, player_id: 51679, is_detected: true },
    ],
    // Recorded-but-unmapped provider fields (counted, dropped):
    possession: { player_id: 51679, group: "home" },
    image_corners_projection: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    ...overrides,
  };
}

/** One synthetic DRF page in the RECORDED envelope. */
function fixturePage(
  results: Record<string, unknown>[],
  next: string | null = null,
): Record<string, unknown> {
  return { count: results.length, next, previous: null, results };
}

describe("L009 — the recorded DRF envelope (strict, never a partial page)", () => {
  test("a well-formed page parses: count/next/previous/results + the frame cores in order", () => {
    const parsed = parseSkillCornerAuthorizedPage(
      fixturePage(
        [fixtureFrame(), fixtureFrame({ frame: 28204 })],
        "https://skillcorner.com/api/match/1/tracking?page=2",
      ),
    );
    expect(parsed.page.count).toBe(2);
    expect(parsed.page.next).toBe("https://skillcorner.com/api/match/1/tracking?page=2");
    expect(parsed.frames.map((frame) => frame.frame)).toEqual([28203, 28204]);
    expect(parsed.parsedFrames).toBe(2);
    expect(parsed.refusedFrames).toBe(0);
  });

  test("a payload outside the recorded envelope REFUSES loudly (the typed failure class)", () => {
    expect(() => parseSkillCornerAuthorizedPage({ results: "not-an-array" })).toThrow(
      SkillCornerAuthorizedFormatError,
    );
    expect(() => parseSkillCornerAuthorizedPage([1, 2, 3])).toThrow(
      SkillCornerAuthorizedFormatError,
    );
    expect(() => parseSkillCornerAuthorizedPage({ count: 1, results: [] })).toThrow(
      /next: Invalid input.*previous: Invalid input/,
    );
  });
});

describe("L009 — the frame core (strict on the consumed fields)", () => {
  test("the consumed projection validates and carries the recorded fields", () => {
    const parsed = parseSkillCornerAuthorizedFrame(fixtureFrame());
    if ("refused" in parsed) throw new Error(`should have parsed: ${parsed.refused}`);
    expect(parsed.frame.frame).toBe(28203);
    expect(parsed.frame.period).toBe(1);
    expect(parsed.frame.player_data).toHaveLength(2);
    expect(parsed.frame.ball_data.z).toBe(1.84);
  });

  test("a CONSUMED field with the wrong shape refuses (never a partial frame)", () => {
    const bad = parseSkillCornerAuthorizedFrame(fixtureFrame({ frame: "twenty-eight" }));
    expect("refused" in bad).toBe(true);

    const badBall = parseSkillCornerAuthorizedFrame(
      fixtureFrame({ ball_data: { x: "nope", y: 0, z: 0, is_detected: true } }),
    );
    expect("refused" in badBall).toBe(true);

    const badPlayer = parseSkillCornerAuthorizedFrame(
      fixtureFrame({ player_data: [{ x: 1, y: 2, is_detected: true }] }),
    );
    expect("refused" in badPlayer).toBe(true);
  });

  test("a page MIXING good and bad frames counts the refusals and keeps the valid cores", () => {
    const parsed = parseSkillCornerAuthorizedPage(
      fixturePage([fixtureFrame(), fixtureFrame({ period: 3 as unknown as 1 })]),
    );
    expect(parsed.parsedFrames).toBe(1);
    expect(parsed.refusedFrames).toBe(1);
    expect(parsed.frames).toHaveLength(1);
  });
});

describe("L009 — the honest field accounting (isolation made visible)", () => {
  test("recorded-but-unmapped provider fields are COUNTED, never forwarded", () => {
    const parsed = parseSkillCornerAuthorizedPage(fixturePage([fixtureFrame()]));
    // One occurrence per unmapped FIELD per frame: possession + image_corners_projection.
    expect(parsed.knownUnmappedFieldRows).toBe(2);
    expect(SKILLCORNER_AUTHORIZED_UNMAPPED_FIELDS).toContain("possession");
  });

  test("fields BEYOND the recorded format are collected BY NAME (the verification hook)", () => {
    const parsed = parseSkillCornerAuthorizedPage(
      fixturePage([
        fixtureFrame({ speed: 7.9, optical_tracking_quality: 0.42 }),
        fixtureFrame({ frame: 28204, speed: 8.1 }),
      ]),
    );
    expect(parsed.unknownFieldKinds).toEqual(["optical_tracking_quality", "speed"]);
    // and nothing unknown is retained in the parsed cores:
    const flat = JSON.stringify(parsed.frames);
    expect(flat).not.toContain("speed");
    expect(flat).not.toContain("optical_tracking_quality");
  });

  test("the consumed-field list is exactly the recorded five (a pinned contract)", () => {
    expect([...SKILLCORNER_AUTHORIZED_CONSUMED_FIELDS]).toEqual([
      "frame",
      "timestamp",
      "period",
      "ball_data",
      "player_data",
    ]);
  });
});

describe("L009 — the recorded timestamp clock (HH:MM:SS.ss within the period)", () => {
  test("parses the recorded form; null and malformed stay null", () => {
    expect(parseSkillCornerAuthorizedTimestampMs("00:42:49.30")).toBe(2569300);
    expect(parseSkillCornerAuthorizedTimestampMs("01:00:00.00")).toBe(3600000);
    expect(parseSkillCornerAuthorizedTimestampMs(null)).toBeNull();
    expect(parseSkillCornerAuthorizedTimestampMs("42:49")).toBeNull();
    expect(parseSkillCornerAuthorizedTimestampMs("00:99:00.00")).toBeNull();
  });
});
