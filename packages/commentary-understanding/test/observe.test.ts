/**
 * W209 emission tests: every emitted record is a contract-valid
 * commentary-derived Observation.
 */
import { describe, expect, test } from "bun:test";
import { Observation } from "@sporta/contracts";
import { InMemoryObservationStore } from "@sporta/observation";
import { buildObservation } from "@sporta/testing";
import type { CommentaryUnit } from "@sporta/commentary-segmentation";
import {
  emitEventCandidateObservations,
  extractEventCandidates,
  validateObservation,
} from "../src/index";

const SESSION_ID = "sess-w209-emission";
const COMPONENT_ID = "commentary-understanding-v1";

function unit(startMs: number, text: string): CommentaryUnit {
  return { unitId: "cu-1", startMs, endMs: startMs + 500, text, sourceWindowIds: ["tu-0"] };
}

function extract(texts: Array<[number, string]>) {
  return extractEventCandidates({
    units: texts.map(([startMs, text]) => unit(startMs, text)),
    lexicon: { players: ["Salah", "Mane"], teams: ["Liverpool"] },
  });
}

describe("event-candidate observation emission", () => {
  test("every observation parses with the contracts Observation zod schema", () => {
    const candidates = extract([
      [10_000, "Salah passes to Mane."],
      [12_000, "GOAL! What a finish!"],
      [14_000, "Free-kick given."],
    ]);
    const emitted = emitEventCandidateObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      candidates,
    });
    expect(emitted).toHaveLength(candidates.length);
    for (const observation of emitted) {
      expect(() => Observation.parse(observation)).not.toThrow();
      expect(validateObservation(observation)).toBe(true);
    }
  });

  test("generic payload kind carries the candidate fields; confidence present", () => {
    const [candidate] = extract([[10_000, "Salah passes to Mane."]]);
    if (candidate === undefined) throw new Error("expected one candidate");
    const [observation] = emitEventCandidateObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      candidates: [candidate],
    });
    if (observation === undefined) throw new Error("expected one observation");
    expect(observation.payload.kind).toBe("generic");
    // The payload data mirrors the candidate (typed variant is a future
    // TL-gated minor contracts bump — recorded architectural concern).
    expect(observation.payload).toEqual({
      kind: "generic",
      data: {
        eventType: "pass",
        eventPhrase: "passes",
        subjects: [
          { name: "Salah", role: "agent", nameConfidence: 1 },
          { name: "Mane", role: "patient", nameConfidence: 1 },
        ],
        emphasis: 0,
        unitId: "cu-1",
      },
    });
    expect(observation.confidence).toBe(candidate?.confidence);
    expect(observation.eventTimeMs).toBe(10_000);
    expect(observation.modality).toBe("commentary");
    expect(observation.provenance).toBe("DERIVED");
    expect(observation.schemaVersion).toBe("1.1");
  });

  test("subjectEntityRefs is []: commentary names are not yet entities (W401's job)", () => {
    const emitted = emitEventCandidateObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      candidates: extract([[10_000, "Salah passes to Mane."]]),
    });
    for (const observation of emitted) {
      expect(observation.subjectEntityRefs).toEqual([]);
    }
  });

  test("observationId is 'ceu-<candidateId>' and unique across a batch", () => {
    const candidates = extract([
      [10_000, "A foul and a free-kick."],
      [12_000, "Offside."],
      [14_000, "Another foul."],
    ]);
    const emitted = emitEventCandidateObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      candidates,
    });
    expect(candidates.map((c) => c.candidateId)).toEqual(["ec-1", "ec-2", "ec-3", "ec-4"]);
    expect(emitted.map((observation) => observation.observationId)).toEqual([
      "ceu-ec-1",
      "ceu-ec-2",
      "ceu-ec-3",
      "ceu-ec-4",
    ]);
    expect(new Set(emitted.map((observation) => observation.observationId)).size).toBe(
      emitted.length,
    );
  });

  test("validateObservation rejects contract-invalid records", () => {
    const [valid] = emitEventCandidateObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      candidates: extract([[10_000, "Free-kick given."]]),
    });
    expect(validateObservation(valid)).toBe(true);
    expect(validateObservation({ ...valid, confidence: 1.5 })).toBe(false);
    expect(validateObservation({ ...valid, eventTimeMs: -1 })).toBe(false);
    expect(validateObservation({ ...valid, modality: "haptic" })).toBe(false);
    expect(validateObservation({ ...valid, provenance: "GUESSED" })).toBe(false);
    expect(validateObservation({ ...valid, payload: { kind: "detection" } })).toBe(false);
    expect(validateObservation("not-an-object")).toBe(false);
  });

  test("emitted records are store-compatible and interop with @sporta/testing", () => {
    const store = new InMemoryObservationStore();
    const candidates = extract([
      [10_000, "Salah passes to Mane."],
      [12_000, "It's a goal for Liverpool!"],
      [14_000, "Free-kick in a dangerous area."],
    ]);
    const emitted = emitEventCandidateObservations({
      sessionId: SESSION_ID,
      componentId: COMPONENT_ID,
      candidates,
    });
    for (const observation of emitted) {
      expect(store.append(observation)).toBe("appended");
    }
    expect(store.count()).toBe(candidates.length); // one per candidate

    // A builder-made observation from the shared test harness appends
    // alongside the emitted ones (same schema, same store).
    const builderMade = buildObservation({ sessionId: SESSION_ID, eventTimeMs: 20_000 }, 42);
    expect(store.append(builderMade)).toBe("appended");

    // Re-delivering an emitted observation is the idempotent duplicate NO-OP.
    expect(store.append(emitted[0] as NonNullable<(typeof emitted)[0]>)).toBe("duplicate");
    expect(store.count()).toBe(candidates.length + 1);

    const commentaryDerived = store.query({
      sessionId: SESSION_ID,
      kind: "generic",
      modality: "commentary",
    });
    expect(commentaryDerived).toHaveLength(candidates.length);
    expect(store.byId("ceu-ec-1")).toBeDefined();
  });

  test("empty candidates -> empty observations", () => {
    expect(
      emitEventCandidateObservations({
        sessionId: SESSION_ID,
        componentId: COMPONENT_ID,
        candidates: [],
      }),
    ).toEqual([]);
  });
});
