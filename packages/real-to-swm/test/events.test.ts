/**
 * Event-candidate derivation tests (R207 emit stage): the ball-impulse
 * detector, the non-max suppression clustering, and the possession sampling
 * + change derivation — deterministic pure functions over synthetic point
 * streams.
 */
import { describe, expect, test } from "bun:test";
import {
  clusterImpulseCandidates,
  deriveBallImpulseCandidates,
  derivePossessionChangeInputs,
  samplePossession,
} from "../src/index";
import type { BallPointEvidence, EventCandidateRecord } from "../src/index";
import type { Observation } from "@sporta/contracts";

const GATES = { minSpeedRatio: 3, minSpeedGain: 0.1, minReversalSpeed: 0.15, clusterWindowMs: 240 };

/** Builds a synthetic detected-ball point stream. */
function point(
  index: number,
  x: number,
  y: number,
  confidence = 0.8,
  stepMs = 40,
): BallPointEvidence {
  return {
    observationId: `obs-bt-${index}`,
    presentationMs: index * stepMs,
    x,
    y,
    confidence,
  };
}

describe("ball-impulse derivation (image-space, honest)", () => {
  test("a clean constant-speed track yields NO candidates (no invention)", () => {
    const points: BallPointEvidence[] = [];
    for (let i = 0; i < 20; i += 1) points.push(point(i, 0.1 + i * 0.01, 0.5));
    expect(deriveBallImpulseCandidates(points, GATES)).toEqual([]);
  });

  test("a hard speed discontinuity yields one candidate with evidence + min confidence", () => {
    const points: BallPointEvidence[] = [];
    // Slow approach (0.005/frame); the STRIKE CENTER is point index 5 (its
    // confidence 0.5 — a marginal detection at the strike instant).
    for (let i = 0; i < 6; i += 1) points.push(point(i, 0.1 + i * 0.005, 0.5, i === 5 ? 0.5 : 0.9));
    // Fast flight (0.05/frame — a 10x discontinuity across point 5).
    for (let i = 6; i < 10; i += 1)
      points.push(point(i, 0.1 + 6 * 0.005 + (i - 5) * 0.05, 0.5, 0.9));
    const candidates = deriveBallImpulseCandidates(points, GATES);
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.eventTimeMs).toBe(200);
    for (const candidate of candidates) {
      expect(candidate.eventTypeRef).toBe("real-to-swm/v1/ball-impulse");
      expect(candidate.evidence.length).toBe(3);
      // Confidence is the MIN of the supporting evidence (0.5 at the strike
      // point) — propagated, never inflated.
      expect(candidate.confidence).toBeLessThanOrEqual(0.5);
    }
  });

  test("a direction reversal at real speed yields a candidate; micro-jitter does not", () => {
    const moving: BallPointEvidence[] = [
      point(0, 0.2, 0.5),
      point(1, 0.24, 0.5),
      point(2, 0.28, 0.5),
      point(3, 0.24, 0.5), // reversed at 0.04/frame = 1.0 units/s > 0.15
      point(4, 0.2, 0.5),
    ];
    expect(deriveBallImpulseCandidates(moving, GATES).length).toBeGreaterThan(0);
    const jitter: BallPointEvidence[] = [
      point(0, 0.2, 0.5),
      point(1, 0.201, 0.5),
      point(2, 0.202, 0.5),
      point(3, 0.201, 0.5), // reversed at 0.001/frame = 0.025 units/s < 0.15
      point(4, 0.2, 0.5),
    ];
    expect(deriveBallImpulseCandidates(jitter, GATES)).toEqual([]);
  });

  test("deterministic: same points → deep-equal candidates", () => {
    const points: BallPointEvidence[] = [];
    for (let i = 0; i < 10; i += 1) points.push(point(i, 0.1 + (i % 2) * 0.08, 0.5));
    expect(deriveBallImpulseCandidates(points, GATES)).toEqual(
      deriveBallImpulseCandidates(points, GATES),
    );
  });
});

describe("impulse non-max suppression (deterministic clustering)", () => {
  const candidate = (timeMs: number, confidence: number): EventCandidateRecord => ({
    candidateId: `cand-${timeMs}`,
    eventTypeRef: "real-to-swm/v1/ball-impulse",
    interval: { startTimeMs: timeMs - 40, endTimeMs: timeMs + 40 },
    eventTimeMs: timeMs,
    confidence,
    evidence: ["a", "b", "c"],
    detail: "test",
  });

  test("bursty candidates collapse to the highest-confidence member per window", () => {
    const burst = [
      candidate(1000, 0.5),
      candidate(1040, 0.7),
      candidate(1080, 0.6),
      candidate(2000, 0.55),
      candidate(2080, 0.6),
    ];
    const { kept, suppressed } = clusterImpulseCandidates(burst, 240);
    expect(kept.length).toBe(2);
    expect(kept[0]!.eventTimeMs).toBe(1040); // highest confidence in window 1
    expect(kept[0]!.confidence).toBe(0.7);
    expect(kept[1]!.eventTimeMs).toBe(2080); // highest confidence in window 2
    expect(suppressed).toBe(3);
  });

  test("ties keep the earliest candidate (deterministic)", () => {
    const burst = [candidate(1000, 0.6), candidate(1040, 0.6), candidate(1080, 0.6)];
    const { kept } = clusterImpulseCandidates(burst, 240);
    expect(kept.length).toBe(1);
    expect(kept[0]!.eventTimeMs).toBe(1000);
  });
});

/** Builds a pitch-space track observation (the frozen payload shape). */
function trackObservation(
  observationId: string,
  entityId: string,
  kind: "participant" | "ball",
  x: number,
  y: number,
  eventTimeMs: number,
  confidence = 0.8,
): Observation {
  return {
    observationId,
    sessionId: "sess-test",
    schemaVersion: "1.1",
    eventTimeMs,
    ingestTimeMs: 0,
    modality: "vision",
    componentId: "test-component",
    provenance: "OBSERVED",
    confidence,
    payload: { kind: "track", entityId, position: { x, y } },
    subjectEntityRefs: [{ entityId, kind }],
  };
}

describe("possession sampling + change derivation (pitch space)", () => {
  test("nearest participant within radius wins; outside radius yields none", () => {
    const ball = [trackObservation("b1", "bt-1", "ball", 10, 10, 100)];
    const near = [trackObservation("p1", "t1", "participant", 10.5, 10, 100)];
    const samples = samplePossession(ball, near, 2);
    expect(samples.length).toBe(1);
    expect(samples[0]!.possessor?.observationId).toBe("p1");
    expect(samples[0]!.distanceM).toBeCloseTo(0.5, 9);

    const far = [trackObservation("p1", "t1", "participant", 30, 10, 100)];
    const none = samplePossession(ball, far, 2);
    expect(none[0]!.possessor).toBeNull();
  });

  test("equidistant participants produce NO possessor (no silent winner)", () => {
    const ball = [trackObservation("b1", "bt-1", "ball", 10, 10, 100)];
    const tied = [
      trackObservation("p1", "t1", "participant", 11, 10, 100),
      trackObservation("p2", "t2", "participant", 9, 10, 100),
    ];
    const samples = samplePossession(ball, tied, 2);
    expect(samples[0]!.possessor).toBeNull();
  });

  test("identity transitions (none→X, X→Y, Y→none) each derive one change", () => {
    const ball = [
      trackObservation("b0", "bt-1", "ball", 10, 10, 0),
      trackObservation("b1", "bt-1", "ball", 10, 10, 100),
      trackObservation("b2", "bt-1", "ball", 10, 10, 200),
      trackObservation("b3", "bt-1", "ball", 10, 10, 300),
    ];
    // t1 near at 100ms then MOVED AWAY by 200ms; t2 near at 200ms; nobody
    // within radius at 300ms (t3 is far). "Latest position per participant"
    // is the sampling rule, so t1's 200ms position is the far one.
    const participants = [
      trackObservation("p1a", "t1", "participant", 10.5, 10, 100),
      trackObservation("p1b", "t1", "participant", 30, 30, 200),
      trackObservation("p2a", "t2", "participant", 9, 10, 200),
      trackObservation("p2b", "t2", "participant", 30, 30, 300),
      trackObservation("p3a", "t3", "participant", 40, 40, 300),
    ];
    const samples = samplePossession(ball, participants, 2);
    const changes = derivePossessionChangeInputs(samples, 2);
    const transitions = changes.map((c) => c.detail);
    expect(transitions.length).toBe(3);
    expect(transitions[0]).toContain("none -> t1");
    expect(transitions[1]).toContain("t1 -> t2");
    expect(transitions[2]).toContain("t2 -> none");
    // Evidence chains include the ball + the possessors involved.
    expect(changes[0]!.evidence).toContain("b1");
    expect(changes[0]!.evidence).toContain("p1a");
    // The previous possessor's evidence is its observation FROM THE SAMPLE
    // WHERE IT HELD POSSESSION (p1a at 100ms), and the new possessor's is
    // its own observation (p2a at 200ms).
    expect(changes[1]!.evidence).toContain("p1a");
    expect(changes[1]!.evidence).toContain("p2a");
    expect(changes[2]!.evidence).toContain("p2a");
    // Confidence is evidence-bounded (min of involved confidences × proximity).
    for (const change of changes) {
      expect(change.confidence).toBeGreaterThan(0);
      expect(change.confidence).toBeLessThanOrEqual(0.8);
    }
  });
});
