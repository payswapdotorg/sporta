/**
 * Degradation-ledger unit tests (R207 hard rule): append-only stage records,
 * confidence summaries, and the per-kind summary — plus the honesty checks
 * that every degradation kind the real clips produce is expressible.
 */
import { describe, expect, test } from "bun:test";
import {
  DEGRADATION_EVIDENCE_LIMIT,
  PIPELINE_STAGE_IDS,
  StageRecordBuilder,
  buildLedger,
  buildLedgerSummary,
  summarizeConfidence,
} from "../src/index";

describe("the degradation ledger", () => {
  test("the nine documented stages exist in execution order", () => {
    expect(PIPELINE_STAGE_IDS).toEqual([
      "decode",
      "detect",
      "track",
      "ball",
      "calibrate",
      "team",
      "bridge",
      "fuse",
      "emit",
    ]);
  });

  test("stage records are append-only and freeze on build", () => {
    const builder = new StageRecordBuilder("decode", 1);
    builder.attempt({ technologyId: "x", adapterVersion: "0.1.0", outcome: "used" });
    builder.degrade("candidate-fallback", 1, "fell back", ["e1", "e2"]);
    builder.note("a note");
    const record = builder.build(250, 250, 250, summarizeConfidence([0.5, 1]));
    expect(record.stage).toBe("decode");
    expect(record.order).toBe(1);
    expect(record.attempted.length).toBe(1);
    expect(record.degradations.length).toBe(1);
    expect(record.degradations[0]!.evidence).toEqual(["e1", "e2"]);
    expect(record.notes).toEqual(["a note"]);
    expect(record.confidence).toEqual({ count: 2, min: 0.5, mean: 0.75, max: 1 });
    // Built records are frozen: appending to the builder afterwards does not
    // mutate the built record (the arrays were copied).
    builder.degrade("off-envelope-detection", 3, "late");
    expect(record.degradations.length).toBe(1);
  });

  test("evidence lists are bounded (DEGRADATION_EVIDENCE_LIMIT)", () => {
    const builder = new StageRecordBuilder("detect", 2);
    const manyIds = Array.from({ length: 100 }, (_, i) => `f-0-${i}`);
    builder.degrade("frame-without-output", 100, "none", manyIds);
    const record = builder.build(100, 0, 0);
    expect(record.degradations[0]!.evidence!.length).toBe(DEGRADATION_EVIDENCE_LIMIT);
  });

  test("empty confidence lists carry NO summary (never an invented 0)", () => {
    expect(summarizeConfidence([])).toBeUndefined();
    expect(summarizeConfidence([0.25])).toEqual({ count: 1, min: 0.25, mean: 0.25, max: 0.25 });
  });

  test("the summary aggregates entries per kind, sorted deterministically", () => {
    const first = new StageRecordBuilder("detect", 1);
    first.degrade("off-envelope-detection", 5, "a");
    first.degrade("candidate-unavailable", 1, "b");
    const second = new StageRecordBuilder("calibrate", 2);
    second.degrade("off-envelope-detection", 1, "c");
    second.degrade("calibration-unavailable", 1, "d");
    const { summary, totalEntries } = buildLedgerSummary([
      first.build(10, 10, 10),
      second.build(10, 0, 0),
    ]);
    expect(totalEntries).toBe(4);
    expect(summary.map((s) => s.kind)).toEqual([
      "calibration-unavailable",
      "candidate-unavailable",
      "off-envelope-detection",
    ]);
    const ledger = buildLedger([first.build(10, 10, 10), second.build(10, 0, 0)]);
    expect(ledger.stages.length).toBe(2);
    expect(ledger.totalEntries).toBe(4);
  });
});
