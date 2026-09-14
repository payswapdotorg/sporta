import { describe, expect, test } from "bun:test";
import { segmentWithCloseCauses } from "../src/segment";
import { DEFAULT_MAX_GAP_MS, segmentCommentary } from "../src/index";
import { makeUnit } from "./fixtures";

describe("sentence splitting (terminators)", () => {
  test("one window with two sentences -> two units, exact texts, shared window", () => {
    // Both sentences share the window: intra-unit character timing is NOT
    // modeled — window-level granularity only (documented limitation).
    const units = [makeUnit({ text: "Great pass. And another chance!" })];
    const commentary = segmentCommentary(units);
    expect(commentary.map((unit) => unit.text)).toEqual(["Great pass.", "And another chance!"]);
    for (const unit of commentary) {
      expect(unit.startMs).toBe(0);
      expect(unit.endMs).toBe(5000);
      expect(unit.sourceWindowIds).toEqual(["tu-0"]);
    }
    expect(commentary[0]?.unitId).toBe("cu-1");
    expect(commentary[1]?.unitId).toBe("cu-2");
  });

  test("a terminator at buffer end, without trailing whitespace, still closes", () => {
    const commentary = segmentCommentary([makeUnit({ text: "He scores!" })]);
    expect(commentary).toHaveLength(1);
    expect(commentary[0]?.text).toBe("He scores!");
  });

  test("text is trimmed; leading/trailing terminators are kept", () => {
    const commentary = segmentCommentary([makeUnit({ text: "  Great save!  " })]);
    expect(commentary).toHaveLength(1);
    expect(commentary[0]?.text).toBe("Great save!");
  });

  test("terminators inside numbers do not close (documented limitation)", () => {
    // "3.5" — the '.' is followed by "5", not whitespace/end: no close.
    const commentary = segmentCommentary([
      makeUnit({ unitId: "tu-0", text: "The distance is 3.5 metres" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "from the edge of the box.",
      }),
    ]);
    expect(commentary).toHaveLength(1);
    expect(commentary[0]?.text).toBe("The distance is 3.5 metres from the edge of the box.");
  });

  test("a window ending mid-sentence continues the sentence across the boundary", () => {
    const commentary = segmentCommentary([
      makeUnit({ text: "It's a brilliant move" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "that started on the right wing.",
      }),
    ]);
    expect(commentary).toHaveLength(1);
    expect(commentary[0]?.startMs).toBe(0);
    expect(commentary[0]?.endMs).toBe(10000);
    expect(commentary[0]?.text).toBe("It's a brilliant move that started on the right wing.");
    expect(commentary[0]?.sourceWindowIds).toEqual(["tu-0", "tu-1"]);
  });

  test("a sentence closed mid-window re-opens on the SAME unit's whole window", () => {
    // "three." closes inside tu-1; the remainder "Four five" starts mid-tu-1
    // and continues into tu-2 — intra-unit timing is unmodeled, so cu-2 keeps
    // tu-1's whole window as its start (window-level granularity).
    const commentary = segmentCommentary([
      makeUnit({ text: "One two" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "three. Four five",
      }),
      makeUnit({
        unitId: "tu-2",
        startMs: 10000,
        endMs: 15000,
        text: "six.",
      }),
    ]);
    expect(commentary.map((unit) => unit.text)).toEqual(["One two three.", "Four five six."]);
    expect(commentary[0]?.sourceWindowIds).toEqual(["tu-0", "tu-1"]);
    expect(commentary[0]?.startMs).toBe(0);
    expect(commentary[0]?.endMs).toBe(10000);
    expect(commentary[1]?.sourceWindowIds).toEqual(["tu-1", "tu-2"]);
    expect(commentary[1]?.startMs).toBe(5000);
    expect(commentary[1]?.endMs).toBe(15000);
  });
});

describe("cross-window sentences", () => {
  test("three windows, no terminator until the third -> one unit spanning all three", () => {
    const units = [
      makeUnit({ text: "he takes the" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "corner kick now",
      }),
      makeUnit({
        unitId: "tu-2",
        startMs: 10000,
        endMs: 15000,
        text: "towards the far post.",
      }),
    ];
    const commentary = segmentCommentary(units);
    expect(commentary).toHaveLength(1);
    expect(commentary[0]?.text).toBe("he takes the corner kick now towards the far post.");
    expect(commentary[0]?.startMs).toBe(0); // first unit's startMs
    expect(commentary[0]?.endMs).toBe(15000); // third unit's endMs
    expect(commentary[0]?.sourceWindowIds).toEqual(["tu-0", "tu-1", "tu-2"]);
  });
});

describe("speaker switches", () => {
  test("label change flushes; each unit carries its speaker's label", () => {
    const commentary = segmentCommentary([
      makeUnit({ text: "He shapes to shoot", speakerLabel: "lead" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "and drags it wide",
        speakerLabel: "lead",
      }),
      makeUnit({
        unitId: "tu-2",
        startMs: 10000,
        endMs: 15000,
        text: "such a waste",
        speakerLabel: "co",
      }),
    ]);
    expect(commentary).toHaveLength(2);
    expect(commentary[0]?.speakerLabel).toBe("lead");
    expect(commentary[0]?.text).toBe("He shapes to shoot and drags it wide");
    expect(commentary[0]?.endMs).toBe(10000);
    expect(commentary[1]?.speakerLabel).toBe("co");
    expect(commentary[1]?.text).toBe("such a waste");
    expect(commentary[1]?.startMs).toBe(10000);
  });

  test("undefined -> defined speaker change also splits", () => {
    const commentary = segmentCommentary([
      makeUnit({ text: "Goal kick announced" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "here we go",
        speakerLabel: "lead",
      }),
    ]);
    expect(commentary).toHaveLength(2);
    expect("speakerLabel" in (commentary[0] ?? {})).toBe(false);
    expect(commentary[1]?.speakerLabel).toBe("lead");
  });

  test("defined -> undefined speaker change splits too", () => {
    const commentary = segmentCommentary([
      makeUnit({ text: "Here we go", speakerLabel: "lead" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "whistle sounds",
      }),
    ]);
    expect(commentary).toHaveLength(2);
    expect(commentary[0]?.speakerLabel).toBe("lead");
    expect("speakerLabel" in (commentary[1] ?? {})).toBe(false);
  });
});

describe("channel switches", () => {
  test("channel change flushes even with the same speaker", () => {
    const commentary = segmentCommentary([
      makeUnit({ text: "You're watching the world feed", channel: "main", speakerLabel: "lead" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "with highlights to follow",
        channel: "intl",
        speakerLabel: "lead",
      }),
    ]);
    expect(commentary).toHaveLength(2);
    expect(commentary[0]?.channel).toBe("main");
    expect(commentary[1]?.channel).toBe("intl");
    // Same speaker on both sides — the CHANNEL alone split them.
    expect(commentary[0]?.speakerLabel).toBe("lead");
    expect(commentary[1]?.speakerLabel).toBe("lead");
  });
});

describe("gap splits", () => {
  test("2000ms gap splits (default maxGapMs is 1500)", () => {
    expect(DEFAULT_MAX_GAP_MS).toBe(1500);
    const commentary = segmentCommentary([
      makeUnit({ text: "The ball goes out" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 7000, // 5000 + 2000ms gap
        endMs: 12000,
        text: "for a throw-in",
      }),
    ]);
    expect(commentary).toHaveLength(2);
    expect(commentary[0]?.endMs).toBe(5000);
    expect(commentary[1]?.startMs).toBe(7000);
  });

  test("800ms gap does not split", () => {
    const commentary = segmentCommentary([
      makeUnit({ text: "The ball goes out" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5800, // 800ms gap
        endMs: 10800,
        text: "for a throw-in",
      }),
    ]);
    expect(commentary).toHaveLength(1);
    expect(commentary[0]?.text).toBe("The ball goes out for a throw-in");
  });

  test("custom maxGapMs 500 is honored (800ms gap splits)", () => {
    const commentary = segmentCommentary(
      [
        makeUnit({ text: "The ball goes out" }),
        makeUnit({
          unitId: "tu-1",
          startMs: 5800,
          endMs: 10800,
          text: "for a throw-in",
        }),
      ],
      { maxGapMs: 500 },
    );
    expect(commentary).toHaveLength(2);
  });

  test("exactly maxGapMs does not split (strictly-greater rule)", () => {
    const commentary = segmentCommentary(
      [
        makeUnit({ text: "The ball goes out" }),
        makeUnit({
          unitId: "tu-1",
          startMs: 6500, // exactly 1500ms gap
          endMs: 11500,
          text: "for a throw-in",
        }),
      ],
      { maxGapMs: 1500 },
    );
    expect(commentary).toHaveLength(1);
  });

  test("a non-finite or negative maxGapMs is rejected loudly", () => {
    expect(() => segmentCommentary([], { maxGapMs: Number.NaN })).toThrow(RangeError);
    expect(() => segmentCommentary([], { maxGapMs: -1 })).toThrow(RangeError);
  });
});

describe("empty and whitespace-only units", () => {
  test("whitespace-only unit between two closed sentences emits nothing, splits nothing", () => {
    const commentary = segmentCommentary([
      makeUnit({ text: "First sentence." }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "   ",
      }),
      makeUnit({
        unitId: "tu-2",
        startMs: 10000,
        endMs: 15000,
        text: "Second sentence.",
      }),
    ]);
    expect(commentary.map((unit) => unit.text)).toEqual(["First sentence.", "Second sentence."]);
    expect(commentary[1]?.sourceWindowIds).toEqual(["tu-2"]);
  });

  test("whitespace-only unit inside one sentence neither splits nor contributes", () => {
    // Contributing windows u0 and u2 are 500ms apart — under the gap
    // threshold, so the sentence continues THROUGH the empty unit.
    const commentary = segmentCommentary([
      makeUnit({ text: "He takes the" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 5500,
        text: "\t\n ",
      }),
      makeUnit({
        unitId: "tu-2",
        startMs: 5500,
        endMs: 6000,
        text: "corner kick.",
      }),
    ]);
    expect(commentary).toHaveLength(1);
    expect(commentary[0]?.text).toBe("He takes the corner kick.");
    expect(commentary[0]?.sourceWindowIds).toEqual(["tu-0", "tu-2"]);
  });

  test("a silence long enough for the gap rule still splits through an empty unit", () => {
    // The empty unit is skipped entirely — but the REAL silence between the
    // surrounding contributing units (here 5000ms) is gap-rule input.
    const commentary = segmentCommentary([
      makeUnit({ text: "He takes the" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "   ",
      }),
      makeUnit({
        unitId: "tu-2",
        startMs: 10000,
        endMs: 15000,
        text: "corner kick.",
      }),
    ]);
    // 10000 - 5000 = 5000 > 1500: the gap between contributing speech splits.
    expect(commentary).toHaveLength(2);
    expect(commentary[0]?.text).toBe("He takes the");
    expect(commentary[1]?.text).toBe("corner kick.");
  });

  test("empty input -> empty output", () => {
    expect(segmentCommentary([])).toEqual([]);
  });

  test("input with only whitespace-only units -> empty output", () => {
    expect(
      segmentCommentary([
        makeUnit({ text: "  " }),
        makeUnit({ unitId: "tu-1", startMs: 5000, endMs: 10000, text: "\t" }),
      ]),
    ).toEqual([]);
  });
});

describe("asrConfidence aggregation", () => {
  test("single window: verbatim passthrough", () => {
    const commentary = segmentCommentary([makeUnit({ text: "A goal!", asrConfidence: 0.9 })]);
    expect(commentary[0]?.asrConfidence).toBe(0.9);
  });

  test("multi-window sentence: minimum of the contributing confidences", () => {
    // A sentence is only as reliable as its least-reliable window; the
    // minimum is one of the input values (never invented).
    const commentary = segmentCommentary([
      makeUnit({ text: "He takes the", asrConfidence: 0.9 }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "corner kick.",
        asrConfidence: 0.7,
      }),
    ]);
    expect(commentary[0]?.asrConfidence).toBe(0.7);
  });

  test("absent window confidences do not lower the minimum", () => {
    const commentary = segmentCommentary([
      makeUnit({ text: "He takes the" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "corner kick.",
        asrConfidence: 0.8,
      }),
    ]);
    expect(commentary[0]?.asrConfidence).toBe(0.8);
  });

  test("no contributing confidence -> key absent, never defaulted", () => {
    const commentary = segmentCommentary([makeUnit({ text: "A goal!" })]);
    expect(commentary[0]?.asrConfidence).toBeUndefined();
    expect("asrConfidence" in (commentary[0] ?? {})).toBe(false);
  });
});

describe("ordering and ids", () => {
  test("input order is irrelevant: units are processed by startMs", () => {
    const ordered = [
      makeUnit({ text: "he takes the" }),
      makeUnit({ unitId: "tu-1", startMs: 5000, endMs: 10000, text: "corner kick now" }),
      makeUnit({
        unitId: "tu-2",
        startMs: 10000,
        endMs: 15000,
        text: "towards the far post.",
      }),
    ];
    const reversed = segmentCommentary([...ordered].reverse());
    expect(reversed).toEqual(segmentCommentary(ordered));
    expect(reversed[0]?.text).toBe("he takes the corner kick now towards the far post.");
  });

  test("equal startMs ties break on unitId (code-unit order, documented)", () => {
    // "tu-10" sorts before "tu-2" lexicographically — deterministic beats numeric.
    const commentary = segmentCommentary([
      makeUnit({ unitId: "tu-2", text: "second fragment" }),
      makeUnit({ unitId: "tu-10", text: "first fragment" }),
    ]);
    expect(commentary).toHaveLength(1);
    expect(commentary[0]?.text).toBe("first fragment second fragment");
    expect(commentary[0]?.sourceWindowIds).toEqual(["tu-10", "tu-2"]);
  });

  test("unit ids are cu-<seq>, globally sequenced from 1, gap-free", () => {
    const commentary = segmentCommentary([
      makeUnit({ text: "One. Two." }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "Three",
        speakerLabel: "co",
      }),
    ]);
    expect(commentary.map((unit) => unit.unitId)).toEqual(["cu-1", "cu-2", "cu-3"]);
  });
});

describe("determinism (no RNG, no clocks)", () => {
  test("same input -> deep-equal output, twice", () => {
    const units = [
      makeUnit({ text: "Great pass. And another chance!", speakerLabel: "lead", channel: "main" }),
      makeUnit({
        unitId: "tu-1",
        startMs: 5000,
        endMs: 10000,
        text: "What a half of football",
        speakerLabel: "co",
        channel: "intl",
        asrConfidence: 0.75,
      }),
      makeUnit({
        unitId: "tu-2",
        startMs: 15000,
        endMs: 20000,
        text: "this has been.",
        speakerLabel: "co",
        channel: "intl",
        asrConfidence: 0.6,
      }),
    ];
    expect(segmentCommentary(units)).toEqual(segmentCommentary(units));
    expect(segmentWithCloseCauses(units)).toEqual(segmentWithCloseCauses(units));
  });
});
