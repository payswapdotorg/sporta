import { describe, expect, test } from "bun:test";
import { runSegmentationBenchmark } from "../src/index";
import type { SegmentationBenchmarkReport, SegmentationScenario } from "../src/index";
import { buildControlledConservationUnits, buildMatchUnits, makeUnit } from "./fixtures";

/**
 * Benchmark scenario fixtures (documented per docs/testing/HARNESS.md):
 * every report below is hand-counted — exact integers, exact ratios, no
 * tolerances. `characterConservation` must satisfy `0.9 < c <= 1` in every
 * scenario: only trim/join whitespace may be lost (architecture-lock §3:
 * segmentation must never drop text).
 */
const SCENARIOS: SegmentationScenario[] = [
  {
    // One sentence across three contiguous windows, closing on the third's
    // terminator: 1 unit, 3-window span, 2 inserted joins, no losses.
    name: "cross-window continuation",
    units: [
      makeUnit({ text: "he takes the" }),
      makeUnit({ unitId: "tu-1", startMs: 5000, endMs: 10000, text: "corner kick now" }),
      makeUnit({ unitId: "tu-2", startMs: 10000, endMs: 15000, text: "towards the far post." }),
    ],
  },
  {
    // Speaker switch (lead->co-analyst) and channel switch (main->intl),
    // both mid-speech: 4 units, one speaker-split and one channel-split,
    // two terminator closes.
    name: "speaker and channel switches",
    units: [
      makeUnit({ text: "The center back steps in", speakerLabel: "lead", channel: "main" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "and clears the danger.",
        speakerLabel: "co-analyst",
        channel: "main",
      }),
      makeUnit({
        unitId: "tu-2",
        startMs: 10000,
        endMs: 15000,
        text: "It's a World Feed switch",
        speakerLabel: "co-analyst",
        channel: "main",
      }),
      makeUnit({
        unitId: "tu-3",
        startMs: 15000,
        endMs: 20000,
        text: "mid-sentence.",
        speakerLabel: "co-analyst",
        channel: "intl",
      }),
    ],
  },
  {
    // A 2000ms silence (gap > 1500 default) between two windows:
    // one gap-split, then a terminator close.
    name: "gap split",
    units: [
      makeUnit({ text: "The ball goes out" }),
      makeUnit({ unitId: "tu-1", startMs: 7000, endMs: 12000, text: "for a throw-in." }),
    ],
  },
  {
    // A whitespace-only window between two sentences: skipped entirely
    // (no unit, no boundary); its 3 characters are the only whitespace loss,
    // so conservation lands strictly between 0.9 and 1.
    name: "empty unit skipped",
    units: [
      makeUnit({ text: "First sentence." }),
      makeUnit({ unitId: "tu-1", startMs: 5000, endMs: 10000, text: "   " }),
      makeUnit({ unitId: "tu-2", startMs: 10000, endMs: 15000, text: "He takes the" }),
      makeUnit({ unitId: "tu-3", startMs: 15000, endMs: 20000, text: "corner kick." }),
    ],
  },
  {
    // The 30-unit acceptance fixture (fixtures.ts documents the transcript):
    // 16 units, 13 multi-window, 3 speaker / 1 channel / 2 gap / 10
    // terminator closes, exact 9375ms mean span, perfect conservation.
    name: "thirty-unit match fixture",
    units: buildMatchUnits(),
  },
  {
    // The hand-counted conservation case (fixtures.ts documents the
    // arithmetic): 114 chars in, 3 trimmed, 2 inserted joins excluded from
    // the output count -> 111 chars out.
    name: "controlled conservation",
    units: buildControlledConservationUnits(),
  },
  { name: "empty", units: [] },
];

/** The exact hand-counted report for each scenario, in scenario order. */
const EXPECTED: ReadonlyArray<SegmentationBenchmarkReport> = [
  {
    // 12 + 15 + 21 = 48 chars in; joined text 50 minus 2 joins = 48 out.
    units: 3,
    commentaryUnits: 1,
    meanUnitMs: 15000,
    multiWindowSentences: 1,
    speakerSwitches: 0,
    channelSwitches: 0,
    gapSplits: 0,
    terminatorSplits: 1,
    textCharsIn: 48,
    textCharsOut: 48,
    characterConservation: 1,
  },
  {
    // 24 + 22 + 24 + 13 = 83 chars in; four single-window units, no loss.
    units: 4,
    commentaryUnits: 4,
    meanUnitMs: 5000,
    multiWindowSentences: 0,
    speakerSwitches: 1,
    channelSwitches: 1,
    gapSplits: 0,
    terminatorSplits: 2,
    textCharsIn: 83,
    textCharsOut: 83,
    characterConservation: 1,
  },
  {
    // 17 + 15 = 32 chars in; two single-window units, no loss.
    units: 2,
    commentaryUnits: 2,
    meanUnitMs: 5000,
    multiWindowSentences: 0,
    speakerSwitches: 0,
    channelSwitches: 0,
    gapSplits: 1,
    terminatorSplits: 1,
    textCharsIn: 32,
    textCharsOut: 32,
    characterConservation: 1,
  },
  {
    // 15 + 3 + 12 + 12 = 42 chars in; the whitespace unit's 3 chars are
    // lost; the joined 2-window sentence contributes 12 + 1 + 12 - 1 = 24.
    units: 4,
    commentaryUnits: 2,
    meanUnitMs: 7500,
    multiWindowSentences: 1,
    speakerSwitches: 0,
    channelSwitches: 0,
    gapSplits: 0,
    terminatorSplits: 2,
    textCharsIn: 42,
    textCharsOut: 39,
    characterConservation: 39 / 42,
  },
  {
    // Hand-derived: 16 units; spans 3x5000 + 12x10000 + 1x15000 = 150000ms;
    // 13 multi-window; 3 speaker + 1 channel + 2 gap + 10 terminator = 16
    // closes; clean texts conserve every character.
    units: 30,
    commentaryUnits: 16,
    meanUnitMs: 9375,
    multiWindowSentences: 13,
    speakerSwitches: 3,
    channelSwitches: 1,
    gapSplits: 2,
    terminatorSplits: 10,
    textCharsIn: 900,
    textCharsOut: 900,
    characterConservation: 1,
  },
  {
    // 40 + 40 + 34 = 114 in; trimmed 37 + 40 + 34 = 111; joined text 113
    // minus 2 inserted joins = 111 out; 111 / 114 (see fixtures.ts).
    units: 3,
    commentaryUnits: 1,
    meanUnitMs: 15000,
    multiWindowSentences: 1,
    speakerSwitches: 0,
    channelSwitches: 0,
    gapSplits: 0,
    terminatorSplits: 1,
    textCharsIn: 114,
    textCharsOut: 111,
    characterConservation: 111 / 114,
  },
  {
    // Vacuously conserved: nothing to lose keeps the <= 1 / > 0.9 invariant.
    units: 0,
    commentaryUnits: 0,
    meanUnitMs: 0,
    multiWindowSentences: 0,
    speakerSwitches: 0,
    channelSwitches: 0,
    gapSplits: 0,
    terminatorSplits: 0,
    textCharsIn: 0,
    textCharsOut: 0,
    characterConservation: 1,
  },
];

describe("runSegmentationBenchmark", () => {
  const reports = runSegmentationBenchmark(SCENARIOS);

  test("reports come back in scenario order with the exact hand-counted values", () => {
    expect(SCENARIOS).toHaveLength(EXPECTED.length);
    expect(reports).toEqual([...EXPECTED]);
  });

  test("character conservation satisfies 0.9 < c <= 1 in every scenario", () => {
    for (const report of reports) {
      expect(report.characterConservation).toBeGreaterThan(0.9);
      expect(report.characterConservation).toBeLessThanOrEqual(1);
    }
  });

  test("close-cause counts never exceed the emitted units (no double counting)", () => {
    for (const report of reports) {
      const accounted =
        report.speakerSwitches +
        report.channelSwitches +
        report.gapSplits +
        report.terminatorSplits;
      expect(accounted).toBeLessThanOrEqual(report.commentaryUnits);
    }
  });

  test("determinism: the same scenarios produce deep-equal reports, twice", () => {
    expect(runSegmentationBenchmark(SCENARIOS)).toEqual(runSegmentationBenchmark(SCENARIOS));
    expect(runSegmentationBenchmark(SCENARIOS)).toEqual(reports);
  });
});

describe("character conservation (accept criterion)", () => {
  test("the 30-unit fixture conserves every character (clean texts)", () => {
    const [report] = runSegmentationBenchmark([
      { name: "thirty-unit match fixture", units: buildMatchUnits() },
    ]);
    expect(report?.textCharsIn).toBe(900);
    expect(report?.textCharsOut).toBe(900);
    expect(report?.characterConservation).toBe(1);
  });

  test("a controlled case with known whitespace loss gives the exact fraction", () => {
    // Hand-count (fixtures.ts documents it character by character):
    //   input : "  He takes the ball on the halfway line " (40)
    //           "and drives forward into the penalty area"   (40)
    //           "where the defender challenges him."         (34)
    //   charsIn = 114; 3 whitespace chars trimmed; 2 join spaces inserted.
    //   joined text = 111 + 2 = 113 chars; output count excludes the 2
    //   inserted joins -> charsOut = 111; conservation = 111/114.
    // Every counted output character is traceable to an input character;
    // the only losses are the three trimmed whitespace characters.
    const [report] = runSegmentationBenchmark([
      { name: "controlled conservation", units: buildControlledConservationUnits() },
    ]);
    expect(report?.textCharsIn).toBe(114);
    expect(report?.textCharsOut).toBe(111);
    expect(report?.characterConservation).toBe(111 / 114);
    expect(report?.characterConservation).toBeGreaterThan(0.9);
    expect(report?.characterConservation).toBeLessThanOrEqual(1);
  });
});
