/**
 * W401 §3.1 tests: the data-pure commentary → football mapping, the W209
 * candidate payload parser, the candidate → EventEnvelope builder, and the
 * fulltime → FootballStatePatch clock builder.
 */
import { describe, expect, test } from "bun:test";
import { EventEnvelope } from "@sporta/contracts";
import type { Observation } from "@sporta/contracts";
import { buildObservation } from "@sporta/testing";
import {
  FOOTBALL_EVENT_MAP,
  buildClockPatch,
  buildEventEnvelope,
  parseCandidatePayload,
} from "../src/index";
import { SESSION_ID, makeCandidateObservation } from "./helpers";

/** The W209 CommentaryEventType vocabulary (pinned from types.ts). */
const COMMENTARY_EVENT_TYPES = [
  "pass",
  "shot",
  "goal",
  "save",
  "corner",
  "foul",
  "free-kick",
  "offside",
  "throw-in",
  "substitution",
  "card",
  "kickoff",
  "fulltime",
  "other",
] as const;

describe("FOOTBALL_EVENT_MAP (data-pure, test-pinned)", () => {
  test("every CommentaryEventType has exactly one entry", () => {
    for (const eventType of COMMENTARY_EVENT_TYPES) {
      expect(FOOTBALL_EVENT_MAP[eventType]).toBeDefined();
    }
    expect(Object.keys(FOOTBALL_EVENT_MAP).sort()).toEqual([...COMMENTARY_EVENT_TYPES].sort());
  });

  test("1:1 renames map to the same-named football event", () => {
    for (const eventType of [
      "pass",
      "shot",
      "goal",
      "save",
      "offside",
      "substitution",
      "card",
      "kickoff",
    ] as const) {
      expect(FOOTBALL_EVENT_MAP[eventType]).toEqual({ event: eventType });
    }
  });

  test("set-piece restarts map to restart", () => {
    for (const eventType of ["corner", "throw-in", "free-kick"] as const) {
      expect(FOOTBALL_EVENT_MAP[eventType]).toEqual({ event: "restart" });
    }
  });

  test("foul maps to referee-decision", () => {
    expect(FOOTBALL_EVENT_MAP.foul).toEqual({ event: "referee-decision" });
  });

  test("fulltime maps to NO event and the post-match clock rule", () => {
    expect(FOOTBALL_EVENT_MAP.fulltime).toEqual({ clockRule: "post-match" });
  });

  test("'other' maps to NO event and NO clock rule (insufficient specificity)", () => {
    expect(FOOTBALL_EVENT_MAP.other).toEqual({});
  });

  test("unknown event types are absent from the map (no event, fusion warns)", () => {
    expect(FOOTBALL_EVENT_MAP["replay-cue"]).toBeUndefined();
    expect(FOOTBALL_EVENT_MAP["nonsense"]).toBeUndefined();
  });
});

describe("parseCandidatePayload", () => {
  test("parses a W209-shaped candidate into the structural subset", () => {
    const candidate = makeCandidateObservation({
      candidateId: "ec-1",
      eventType: "goal",
      t: 6_000,
      confidence: 0.95,
      subjects: [{ name: "Salah", role: "agent", nameConfidence: 1 }],
    });
    expect(parseCandidatePayload(candidate)).toEqual({
      eventType: "goal",
      eventPhrase: "phrase",
      subjects: [{ name: "Salah" }],
      emphasis: 0.5,
      unitId: "cu-1",
    });
  });

  test("non-generic payloads are not candidates", () => {
    const detection = buildObservation({ sessionId: SESSION_ID });
    expect(parseCandidatePayload(detection)).toBeNull();
  });

  test("malformed generic data is not a candidate", () => {
    const malformed: Observation = {
      ...makeCandidateObservation({ candidateId: "ec-x", eventType: "goal", t: 1_000 }),
      payload: { kind: "generic", data: { noEventTypeHere: true } },
    };
    expect(parseCandidatePayload(malformed)).toBeNull();
  });
});

describe("buildEventEnvelope", () => {
  test("output parses against the contracts EventEnvelope schema", () => {
    const candidate = makeCandidateObservation({
      candidateId: "ec-2",
      eventType: "pass",
      t: 3_000,
      confidence: 0.8,
    });
    const envelope = buildEventEnvelope({
      sessionId: SESSION_ID,
      candidate,
      evidence: { observationIds: [] },
    });
    expect(EventEnvelope.safeParse(envelope).success).toBe(true);
  });

  test("eventId is fe-<observationId>; point interval at the candidate time", () => {
    const candidate = makeCandidateObservation({
      candidateId: "ec-3",
      eventType: "goal",
      t: 6_000,
      confidence: 0.95,
    });
    const envelope = buildEventEnvelope({
      sessionId: SESSION_ID,
      candidate,
      evidence: { observationIds: [] },
    });
    expect(envelope.eventId).toBe("fe-ceu-ec-3");
    expect(envelope.interval).toEqual({ startTimeMs: 6_000, endTimeMs: 6_000 });
    expect(envelope.eventTimeMs).toBe(6_000);
  });

  test("provenance is DERIVED; confidence passes through; absent stays absent", () => {
    const withConfidence = buildEventEnvelope({
      sessionId: SESSION_ID,
      candidate: makeCandidateObservation({
        candidateId: "ec-1",
        eventType: "shot",
        t: 1_000,
        confidence: 0.7,
      }),
      evidence: { observationIds: [] },
    });
    expect(withConfidence.provenance).toBe("DERIVED");
    expect(withConfidence.confidence).toBe(0.7);

    const withoutConfidence = buildEventEnvelope({
      sessionId: SESSION_ID,
      candidate: makeCandidateObservation({ candidateId: "ec-9", eventType: "shot", t: 1_000 }),
      evidence: { observationIds: [] },
    });
    expect("confidence" in withoutConfidence).toBe(false);
  });

  test("evidence chains the candidate id first, then additional ids, deduplicated", () => {
    const candidate = makeCandidateObservation({
      candidateId: "ec-4",
      eventType: "save",
      t: 2_000,
      confidence: 0.6,
    });
    const envelope = buildEventEnvelope({
      sessionId: SESSION_ID,
      candidate,
      evidence: {
        observationIds: ["obs-extra-1", "ceu-ec-4", "obs-extra-2"],
        reportedBy: "commentary",
      },
    });
    expect(envelope.evidence.observationIds).toEqual(["ceu-ec-4", "obs-extra-1", "obs-extra-2"]);
    expect(envelope.evidence.reportedBy).toBe("commentary");
  });

  test("throws on non-candidate observations and unmapped event types", () => {
    const detection = buildObservation({ sessionId: SESSION_ID });
    expect(() =>
      buildEventEnvelope({
        sessionId: SESSION_ID,
        candidate: detection,
        evidence: { observationIds: [] },
      }),
    ).toThrow(RangeError);
    for (const eventType of ["fulltime", "other", "replay-cue"]) {
      const candidate = makeCandidateObservation({ candidateId: "ec-x", eventType, t: 1_000 });
      expect(() =>
        buildEventEnvelope({ sessionId: SESSION_ID, candidate, evidence: { observationIds: [] } }),
      ).toThrow(RangeError);
    }
  });
});

describe("buildClockPatch", () => {
  test("fulltime yields the post-match patch with the caller-passed timeline clock", () => {
    const candidate = makeCandidateObservation({
      candidateId: "ec-4",
      eventType: "fulltime",
      t: 5_400_000,
      confidence: 0.99,
    });
    expect(buildClockPatch(candidate, 1_234)).toEqual({
      atMs: 5_400_000,
      clock: { period: "post-match", clockMs: 1_234, stoppage: false },
    });
  });

  test("every other candidate type yields null", () => {
    for (const eventType of COMMENTARY_EVENT_TYPES.filter((t) => t !== "fulltime")) {
      const candidate = makeCandidateObservation({ candidateId: "ec-x", eventType, t: 1_000 });
      expect(buildClockPatch(candidate, 0)).toBeNull();
    }
    expect(
      buildClockPatch(
        makeCandidateObservation({ candidateId: "ec-y", eventType: "replay-cue", t: 1_000 }),
        0,
      ),
    ).toBeNull();
  });
});
