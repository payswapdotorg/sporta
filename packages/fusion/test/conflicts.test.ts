/**
 * W401 §3.3 tests: the EXPLICIT conflict ledger. Conflicting evidence is
 * never silently collapsed — every conflicting group becomes exactly one
 * record listing every observation, values in canonical order, resolution
 * "none".
 */
import { describe, expect, test } from "bun:test";
import type { Observation } from "@sporta/contracts";
import { detectSlotConflicts } from "../src/index";
import { makeCandidateObservation } from "./helpers";

describe("detectSlotConflicts", () => {
  test("no records, a single record, and agreeing records emit nothing", () => {
    const one = makeCandidateObservation({
      candidateId: "ec-1",
      eventType: "goal",
      t: 1_000,
      confidence: 0.9,
    });
    expect(detectSlotConflicts([], "possession", () => 1)).toEqual([]);
    expect(detectSlotConflicts([one], "possession", () => 1)).toEqual([]);
    const two = makeCandidateObservation({
      candidateId: "ec-2",
      eventType: "goal",
      t: 1_200,
      confidence: 0.8,
    });
    expect(detectSlotConflicts([one, two], "possession", () => "same")).toEqual([]);
  });

  test("two differing records within the window → ONE record, ids in (time, id) order", () => {
    const a = makeCandidateObservation({
      candidateId: "ec-b",
      eventType: "goal",
      t: 1_200,
      confidence: 0.8,
    });
    const b = makeCandidateObservation({
      candidateId: "ec-a",
      eventType: "goal",
      t: 1_200,
      confidence: 0.7,
    });
    const conflicts = detectSlotConflicts([a, b], "possession", (obs) => obs.observationId, 5_000);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      conflictId: "cf-1",
      slotKey: "possession",
      observationIds: ["ceu-ec-a", "ceu-ec-b"],
      values: [
        { value: "ceu-ec-a", confidence: 0.7 },
        { value: "ceu-ec-b", confidence: 0.8 },
      ],
      resolution: "none",
      detectedAtMs: 1_200,
    });
  });

  test("values carry the observation confidence; absent confidence stays absent", () => {
    const withConf = makeCandidateObservation({
      candidateId: "ec-1",
      eventType: "goal",
      t: 1_000,
      confidence: 0.9,
    });
    const withoutConf = makeCandidateObservation({
      candidateId: "ec-2",
      eventType: "goal",
      t: 1_000,
    });
    const conflicts = detectSlotConflicts(
      [withConf, withoutConf],
      "possession",
      (obs) => obs.observationId,
      5_000,
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.values).toEqual([
      { value: "ceu-ec-1", confidence: 0.9 },
      { value: "ceu-ec-2" },
    ]);
    expect("confidence" in conflicts[0]!.values[1]!).toBe(false);
  });

  test("records farther apart than the window are sequential updates, not conflicts", () => {
    const early = makeCandidateObservation({ candidateId: "ec-1", eventType: "fulltime", t: 0 });
    const late = makeCandidateObservation({
      candidateId: "ec-2",
      eventType: "fulltime",
      t: 100_000,
    });
    expect(detectSlotConflicts([early, late], "clock-period", () => "x", 5_000)).toEqual([]);
  });

  test("a chained group within the window is ONE conflict record listing all records", () => {
    const r1 = makeCandidateObservation({
      candidateId: "ec-1",
      eventType: "goal",
      t: 10_000,
      confidence: 0.9,
    });
    const r2 = makeCandidateObservation({
      candidateId: "ec-2",
      eventType: "goal",
      t: 14_000,
      confidence: 0.8,
    });
    const r3 = makeCandidateObservation({
      candidateId: "ec-3",
      eventType: "goal",
      t: 18_000,
      confidence: 0.7,
    });
    // Each consecutive gap is within 5_000, so the three form one group even
    // though r1 and r3 are 8_000 apart (connected-component semantics).
    const conflicts = detectSlotConflicts(
      [r1, r2, r3],
      "score",
      (obs) => (obs.confidence === 0.8 ? "other" : "same"),
      5_000,
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.observationIds).toEqual(["ceu-ec-1", "ceu-ec-2", "ceu-ec-3"]);
    expect(conflicts[0]!.detectedAtMs).toBe(18_000);
  });

  test("two separate conflicting groups → two records with gap-free ids", () => {
    const g1a = makeCandidateObservation({ candidateId: "ec-1", eventType: "goal", t: 10_000 });
    const g1b = makeCandidateObservation({ candidateId: "ec-2", eventType: "goal", t: 11_000 });
    const g2a = makeCandidateObservation({ candidateId: "ec-3", eventType: "goal", t: 100_000 });
    const g2b = makeCandidateObservation({ candidateId: "ec-4", eventType: "goal", t: 101_000 });
    // Differing values inside each 1_000-gap group (odd vs even id); the
    // groups are 89_000 apart, so they cannot be one group.
    const conflicts = detectSlotConflicts(
      [g1a, g1b, g2a, g2b],
      "score",
      (obs) => (obs.observationId.endsWith("1") || obs.observationId.endsWith("3") ? "X" : "Y"),
      5_000,
    );
    expect(conflicts.map((c) => c.conflictId)).toEqual(["cf-1", "cf-2"]);
    expect(conflicts[0]!.observationIds).toEqual(["ceu-ec-1", "ceu-ec-2"]);
    expect(conflicts[0]!.values.map((v) => v.value)).toEqual(["X", "Y"]);
    expect(conflicts[1]!.observationIds).toEqual(["ceu-ec-3", "ceu-ec-4"]);
    expect(conflicts[1]!.values.map((v) => v.value)).toEqual(["X", "Y"]);
  });

  test("startSeq offsets the ledger so merged reports stay gap-free", () => {
    const a = makeCandidateObservation({ candidateId: "ec-1", eventType: "goal", t: 1_000 });
    const b = makeCandidateObservation({ candidateId: "ec-2", eventType: "goal", t: 1_100 });
    const conflicts = detectSlotConflicts(
      [a, b],
      "possession",
      (obs) => obs.observationId,
      5_000,
      5,
    );
    expect(conflicts[0]!.conflictId).toBe("cf-5");
  });

  test("structural JSON equality: key order does not matter; shape does", () => {
    const a = makeCandidateObservation({ candidateId: "ec-1", eventType: "goal", t: 1_000 });
    const b = makeCandidateObservation({ candidateId: "ec-2", eventType: "goal", t: 1_000 });
    // Same structure with different key order → agreeing, no conflict.
    expect(
      detectSlotConflicts([a, b], "score", (obs) =>
        obs.observationId.endsWith("1") ? { x: 1, y: { a: 1, b: 2 } } : { y: { b: 2, a: 1 }, x: 1 },
      ),
    ).toEqual([]);
    // Different structural value → conflict.
    expect(
      detectSlotConflicts([a, b], "score", (obs) =>
        obs.observationId.endsWith("1") ? { x: 1 } : { x: 2 },
      ),
    ).toHaveLength(1);
  });

  test("clock-period mechanism: post-match vs first-half within the window conflicts", () => {
    // The brief's conflicting-clock fixture. NOTE (documented honesty): the
    // delivered W209 vocabulary derives exactly ONE period ("post-match",
    // from fulltime) — no fusion input can produce a "first-half" patch, so
    // the fusion-level clock-period sweep cannot fire today. This test pins
    // the MECHANISM with the valueOf a future period-bearing vocabulary
    // (e.g. kickoff → "first-half") would install.
    const postMatch = makeCandidateObservation({
      candidateId: "ec-1",
      eventType: "fulltime",
      t: 5_400_000,
      confidence: 0.99,
    });
    const firstHalf = makeCandidateObservation({
      candidateId: "ec-2",
      eventType: "kickoff",
      t: 5_401_000,
      confidence: 0.9,
    });
    const impliedPeriod = (obs: Observation): string | undefined => {
      if (obs.payload.kind !== "generic") return undefined;
      const data = obs.payload.data as { eventType?: string };
      if (data.eventType === "fulltime") return "post-match";
      if (data.eventType === "kickoff") return "first-half";
      return undefined;
    };
    const conflicts = detectSlotConflicts(
      [postMatch, firstHalf],
      "clock-period",
      impliedPeriod,
      5_000,
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      conflictId: "cf-1",
      slotKey: "clock-period",
      observationIds: ["ceu-ec-1", "ceu-ec-2"],
      values: [
        { value: "post-match", confidence: 0.99 },
        { value: "first-half", confidence: 0.9 },
      ],
      resolution: "none",
      detectedAtMs: 5_401_000,
    });
  });
});
