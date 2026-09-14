/**
 * Inline typed fixtures for the W208 tests (the docs/testing/HARNESS.md
 * pattern: small local factories, only the fields under test varied, no
 * `Math.random`, no clock reads — every value is a fixed function of the
 * arguments).
 */

import type { TranscriptionUnit } from "@sporta/asr";

/** A small factory base: one 5-second window worth of speech. */
export function makeUnit(overrides: Partial<TranscriptionUnit> = {}): TranscriptionUnit {
  return {
    unitId: "tu-0",
    startMs: 0,
    endMs: 5000,
    text: "what a strike",
    ...overrides,
  };
}

/**
 * ## The 30-unit synthetic match fixture (acceptance evidence)
 *
 * A documented transcript shaped like real W207 output: thirty 5-second
 * transcription windows, FIVE speakers (lead, co-analyst, pitch-reporter,
 * special-guest, studio-host) taking turns in blocks, TWO channels ("main"
 * and the "intl" world feed for units 12-13 and 18-19), TWO long silences
 * (2000ms before unit 10, 3000ms before unit 22 — both beyond the 1500ms
 * default gap), and four unlabeled windows (units 8-11: a raw world-feed
 * insert without diarization, so speaker/channel absence is exercised).
 *
 * Transcript (one row per 5s window; text is the window's STT output):
 *
 * ```text
 *  0 lead          main  "We're underway here at the stadium"
 *  1 lead          main  "and the home side attacking down the left"
 *  2 lead          main  "in these opening minutes."
 *  3 co-analyst    main  "Number ten collects it on the halfway line"
 *  4 co-analyst    main  "and swings it out wide."
 *  5 co-analyst    main  "The full-back is up in support"
 *  6 lead          main  "beautiful football from the home side"
 *  7 lead          main  "patient build-up play."
 *  8 —             —     "Half-chance here as the striker peels away"
 *  9 —             —     "on the near post"
 * 10 —             —     "now the tempo drops"                (2s silence before)
 * 11 —             —     "before the away side regains its shape."
 * 12 co-analyst    intl  "You're watching the world feed"
 * 13 co-analyst    intl  "with analysis from five continents"
 * 14 co-analyst    main  "Let's welcome our special guest pitchside."
 * 15 special-guest main  "It's a fascinating tactical setup"
 * 16 special-guest main  "with both sides pressing high."
 * 17 special-guest main  "The midfield battle will decide this game"
 * 18 studio-host   intl  "Back to the world feed"
 * 19 studio-host   intl  "after these thoughts from the studio."
 * 20 lead          main  "The away side wins a free-kick"
 * 21 lead          main  "thirty yards from goal"
 * 22 lead          main  "Here comes the delivery"            (3s silence before)
 * 23 lead          main  "and it's headed clear."
 * 24 pitch-reporter main "Corner kick to the home side"
 * 25 pitch-reporter main "in the final minute of the half."
 * 26 lead          main  "The corner is swung in"
 * 27 lead          main  "and met by the captain"
 * 28 studio-host   main  "What a moment for this club"
 * 29 studio-host   main  "right on the stroke of half-time."
 * ```
 *
 * Window discipline (why this transcript segmentation-checks cleanly): no
 * window's text contains a terminator anywhere except as its FINAL character,
 * so no commentary unit is ever closed mid-window — consecutive units relate
 * as `endMs <= next startMs` with equality across contiguous joins and
 * strict inequality across the two gaps (the documented timing acceptance).
 */

/** One row of the match-fixture transcript (a 5s STT window's output). */
export interface MatchRow {
  readonly text: string;
  readonly speakerLabel?: string;
  readonly channel?: string;
}

const MATCH_ROWS: readonly MatchRow[] = [
  { text: "We're underway here at the stadium", speakerLabel: "lead", channel: "main" },
  { text: "and the home side attacking down the left", speakerLabel: "lead", channel: "main" },
  { text: "in these opening minutes.", speakerLabel: "lead", channel: "main" },
  {
    text: "Number ten collects it on the halfway line",
    speakerLabel: "co-analyst",
    channel: "main",
  },
  { text: "and swings it out wide.", speakerLabel: "co-analyst", channel: "main" },
  { text: "The full-back is up in support", speakerLabel: "co-analyst", channel: "main" },
  { text: "beautiful football from the home side", speakerLabel: "lead", channel: "main" },
  { text: "patient build-up play.", speakerLabel: "lead", channel: "main" },
  { text: "Half-chance here as the striker peels away" },
  { text: "on the near post" },
  { text: "now the tempo drops" },
  { text: "before the away side regains its shape." },
  { text: "You're watching the world feed", speakerLabel: "co-analyst", channel: "intl" },
  {
    text: "with analysis from five continents",
    speakerLabel: "co-analyst",
    channel: "intl",
  },
  {
    text: "Let's welcome our special guest pitchside.",
    speakerLabel: "co-analyst",
    channel: "main",
  },
  { text: "It's a fascinating tactical setup", speakerLabel: "special-guest", channel: "main" },
  { text: "with both sides pressing high.", speakerLabel: "special-guest", channel: "main" },
  {
    text: "The midfield battle will decide this game",
    speakerLabel: "special-guest",
    channel: "main",
  },
  { text: "Back to the world feed", speakerLabel: "studio-host", channel: "intl" },
  { text: "after these thoughts from the studio.", speakerLabel: "studio-host", channel: "intl" },
  { text: "The away side wins a free-kick", speakerLabel: "lead", channel: "main" },
  { text: "thirty yards from goal", speakerLabel: "lead", channel: "main" },
  { text: "Here comes the delivery", speakerLabel: "lead", channel: "main" },
  { text: "and it's headed clear.", speakerLabel: "lead", channel: "main" },
  { text: "Corner kick to the home side", speakerLabel: "pitch-reporter", channel: "main" },
  { text: "in the final minute of the half.", speakerLabel: "pitch-reporter", channel: "main" },
  { text: "The corner is swung in", speakerLabel: "lead", channel: "main" },
  { text: "and met by the captain", speakerLabel: "lead", channel: "main" },
  { text: "What a moment for this club", speakerLabel: "studio-host", channel: "main" },
  { text: "right on the stroke of half-time.", speakerLabel: "studio-host", channel: "main" },
];

/** Transcription window length in the match fixture (milliseconds). */
export const MATCH_WINDOW_MS = 5000;

/** Silence injected BEFORE the given unit index (milliseconds). */
const MATCH_GAPS: ReadonlyMap<number, number> = new Map([
  [10, 2000],
  [22, 3000],
]);

/**
 * Builds the 30-unit match fixture as W207-shaped `TranscriptionUnit`s:
 * window i spans 5000ms, windows are contiguous except for the documented
 * silences before units 10 (2000ms) and 22 (3000ms), ids are `tu-<i>`.
 */
export function buildMatchUnits(): TranscriptionUnit[] {
  const units: TranscriptionUnit[] = [];
  let cursorMs = 0;
  MATCH_ROWS.forEach((row, index) => {
    if (index > 0) cursorMs += MATCH_GAPS.get(index) ?? 0;
    units.push({
      unitId: `tu-${index}`,
      startMs: cursorMs,
      endMs: cursorMs + MATCH_WINDOW_MS,
      text: row.text,
      ...(row.speakerLabel !== undefined ? { speakerLabel: row.speakerLabel } : {}),
      ...(row.channel !== undefined ? { channel: row.channel } : {}),
    });
    cursorMs += MATCH_WINDOW_MS;
  });
  return units;
}

/**
 * ## The controlled character-conservation fixture (hand-counted)
 *
 * Three contiguous 5-second windows, one speaker-less sentence closing at
 * the third window's terminator. The raw texts carry exactly THREE
 * whitespace characters to trim (two leading on tu-0, one trailing on tu-0)
 * and the segmenter inserts exactly TWO join spaces (tu-0|tu-1 and tu-1|tu-2):
 *
 * ```text
 * raw lengths:   "  He takes the ball on the halfway line " -> 40 chars
 *                "and drives forward into the penalty area"   -> 40 chars
 *                "where the defender challenges him."         -> 34 chars
 * textCharsIn  = 40 + 40 + 34 = 114
 * trimmed       = 37 + 40 + 34 = 111 (114 - 3 whitespace lost)
 * CU text       = 111 + 2 join spaces = 113 chars
 * textCharsOut = 113 - 2 (inserted joins excluded) = 111
 * conservation = 111 / 114
 * ```
 *
 * Every surviving character is traceable to an input character; the only
 * losses are the three trimmed whitespace characters.
 */
export function buildControlledConservationUnits(): TranscriptionUnit[] {
  return [
    { unitId: "tu-0", startMs: 0, endMs: 5000, text: "  He takes the ball on the halfway line " },
    {
      unitId: "tu-1",
      startMs: 5000,
      endMs: 10000,
      text: "and drives forward into the penalty area",
    },
    {
      unitId: "tu-2",
      startMs: 10000,
      endMs: 15000,
      text: "where the defender challenges him.",
    },
  ];
}
