import { describe, expect, test } from "bun:test";
import { segmentCommentary } from "../src/index";
import { buildMatchUnits } from "./fixtures";
import type { CommentaryUnit } from "../src/types";

/**
 * The timing-sync acceptance criterion (W208): "speech is segmented into
 * synchronized commentary units" — proven on the 30-unit synthetic match
 * fixture (see fixtures.ts for the documented transcript): every emitted
 * unit has startMs < endMs, units are strictly ordered by startMs,
 * consecutive units never overlap (endMs <= next startMs — equal across
 * contiguous window joins, strictly greater across the two silences), and
 * speaker/channel metadata appears exactly where the fixture put it.
 */

/** The expected segmentation of the 30-unit fixture, hand-derived. */
const EXPECTED: ReadonlyArray<{
  unitId: string;
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel?: string;
  channel?: string;
  sourceWindowIds: string[];
}> = [
  {
    unitId: "cu-1",
    startMs: 0,
    endMs: 15000,
    text: "We're underway here at the stadium and the home side attacking down the left in these opening minutes.",
    speakerLabel: "lead",
    channel: "main",
    sourceWindowIds: ["tu-0", "tu-1", "tu-2"],
  },
  {
    unitId: "cu-2",
    startMs: 15000,
    endMs: 25000,
    text: "Number ten collects it on the halfway line and swings it out wide.",
    speakerLabel: "co-analyst",
    channel: "main",
    sourceWindowIds: ["tu-3", "tu-4"],
  },
  {
    unitId: "cu-3",
    startMs: 25000,
    endMs: 30000,
    text: "The full-back is up in support",
    speakerLabel: "co-analyst",
    channel: "main",
    sourceWindowIds: ["tu-5"],
  },
  {
    unitId: "cu-4",
    startMs: 30000,
    endMs: 40000,
    text: "beautiful football from the home side patient build-up play.",
    speakerLabel: "lead",
    channel: "main",
    sourceWindowIds: ["tu-6", "tu-7"],
  },
  {
    unitId: "cu-5",
    startMs: 40000,
    endMs: 50000,
    text: "Half-chance here as the striker peels away on the near post",
    sourceWindowIds: ["tu-8", "tu-9"],
  },
  {
    unitId: "cu-6",
    startMs: 52000,
    endMs: 62000,
    text: "now the tempo drops before the away side regains its shape.",
    sourceWindowIds: ["tu-10", "tu-11"],
  },
  {
    unitId: "cu-7",
    startMs: 62000,
    endMs: 72000,
    text: "You're watching the world feed with analysis from five continents",
    speakerLabel: "co-analyst",
    channel: "intl",
    sourceWindowIds: ["tu-12", "tu-13"],
  },
  {
    unitId: "cu-8",
    startMs: 72000,
    endMs: 77000,
    text: "Let's welcome our special guest pitchside.",
    speakerLabel: "co-analyst",
    channel: "main",
    sourceWindowIds: ["tu-14"],
  },
  {
    unitId: "cu-9",
    startMs: 77000,
    endMs: 87000,
    text: "It's a fascinating tactical setup with both sides pressing high.",
    speakerLabel: "special-guest",
    channel: "main",
    sourceWindowIds: ["tu-15", "tu-16"],
  },
  {
    unitId: "cu-10",
    startMs: 87000,
    endMs: 92000,
    text: "The midfield battle will decide this game",
    speakerLabel: "special-guest",
    channel: "main",
    sourceWindowIds: ["tu-17"],
  },
  {
    unitId: "cu-11",
    startMs: 92000,
    endMs: 102000,
    text: "Back to the world feed after these thoughts from the studio.",
    speakerLabel: "studio-host",
    channel: "intl",
    sourceWindowIds: ["tu-18", "tu-19"],
  },
  {
    unitId: "cu-12",
    startMs: 102000,
    endMs: 112000,
    text: "The away side wins a free-kick thirty yards from goal",
    speakerLabel: "lead",
    channel: "main",
    sourceWindowIds: ["tu-20", "tu-21"],
  },
  {
    unitId: "cu-13",
    startMs: 115000,
    endMs: 125000,
    text: "Here comes the delivery and it's headed clear.",
    speakerLabel: "lead",
    channel: "main",
    sourceWindowIds: ["tu-22", "tu-23"],
  },
  {
    unitId: "cu-14",
    startMs: 125000,
    endMs: 135000,
    text: "Corner kick to the home side in the final minute of the half.",
    speakerLabel: "pitch-reporter",
    channel: "main",
    sourceWindowIds: ["tu-24", "tu-25"],
  },
  {
    unitId: "cu-15",
    startMs: 135000,
    endMs: 145000,
    text: "The corner is swung in and met by the captain",
    speakerLabel: "lead",
    channel: "main",
    sourceWindowIds: ["tu-26", "tu-27"],
  },
  {
    unitId: "cu-16",
    startMs: 145000,
    endMs: 155000,
    text: "What a moment for this club right on the stroke of half-time.",
    speakerLabel: "studio-host",
    channel: "main",
    sourceWindowIds: ["tu-28", "tu-29"],
  },
];

describe("timing sync on the 30-unit match fixture (accept criterion)", () => {
  const units = buildMatchUnits();
  const commentary = segmentCommentary(units);

  test("segments into the sixteen hand-derived commentary units, exactly", () => {
    expect(units).toHaveLength(30);
    expect(commentary).toHaveLength(16);
    // Field-by-field (toEqual on the projection): ids, exact spans, exact
    // texts, metadata exactly where the fixture put it, window provenance.
    expect(commentary).toEqual(EXPECTED.map((row) => ({ ...row })));
  });

  test("every unit satisfies startMs < endMs", () => {
    for (const unit of commentary) {
      expect(unit.startMs).toBeLessThan(unit.endMs);
    }
  });

  test("units are strictly ordered by startMs", () => {
    for (let index = 1; index < commentary.length; index += 1) {
      const previous = commentary[index - 1];
      const current = commentary[index];
      if (previous === undefined || current === undefined) throw new Error("unreachable");
      expect(current.startMs).toBeGreaterThan(previous.startMs);
    }
  });

  test("no overlap: each endMs <= next startMs (equal on joins, strict on gaps)", () => {
    for (let index = 1; index < commentary.length; index += 1) {
      const previous = commentary[index - 1];
      const current = commentary[index];
      if (previous === undefined || current === undefined) throw new Error("unreachable");
      expect(previous.endMs).toBeLessThanOrEqual(current.startMs);
    }
    // Join boundaries are equal: cu-1|cu-2 share 15000, cu-7|cu-8 share 72000.
    expect(commentary[0]?.endMs).toBe(commentary[1]?.startMs);
    expect(commentary[6]?.endMs).toBe(commentary[7]?.startMs);
    // Gap boundaries are strict: cu-5 -> cu-6 spans the 2000ms silence,
    // cu-12 -> cu-13 spans the 3000ms silence.
    expect(commentary[4]?.endMs).toBeLessThan(commentary[5]?.startMs ?? Number.NaN);
    expect(commentary[5]?.startMs).toBe(52000);
    expect(commentary[11]?.endMs).toBeLessThan(commentary[12]?.startMs ?? Number.NaN);
    expect(commentary[12]?.startMs).toBe(115000);
  });

  test("speaker/channel metadata is present exactly where the fixture put it", () => {
    // 14 of the 16 units carry speaker+channel; cu-5 and cu-6 come from the
    // unlabeled world-feed insert (units 8-11) and carry NEITHER key.
    for (const unit of commentary) {
      const unlabeled = unit.unitId === "cu-5" || unit.unitId === "cu-6";
      expect("speakerLabel" in unit).toBe(!unlabeled);
      expect("channel" in unit).toBe(!unlabeled);
    }
    expect(commentary[6]?.speakerLabel).toBe("co-analyst"); // cu-7 on intl
    expect(commentary[6]?.channel).toBe("intl");
    expect(commentary[10]?.channel).toBe("intl"); // cu-11 on intl
    expect(commentary[7]?.channel).toBe("main"); // cu-8 back on main
  });

  test("timestamps are pure passthrough of the contributing window times", () => {
    const byId = new Map(units.map((unit) => [unit.unitId, unit]));
    for (const unit of commentary) {
      const first = byId.get(unit.sourceWindowIds[0] ?? "");
      const last = byId.get(unit.sourceWindowIds[unit.sourceWindowIds.length - 1] ?? "");
      if (first === undefined || last === undefined) throw new Error("bad provenance");
      expect(unit.startMs).toBe(first.startMs);
      expect(unit.endMs).toBe(last.endMs);
    }
  });

  test("deterministic: the fixture segments deep-equal, twice", () => {
    const again: CommentaryUnit[] = segmentCommentary(buildMatchUnits());
    expect(again).toEqual(commentary);
  });
});
