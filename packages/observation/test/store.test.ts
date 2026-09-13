import { describe, expect, test } from "bun:test";
import type { Observation } from "@sporta/contracts";
import { InMemoryObservationStore } from "../src/store";
import { makeDetectionObservation, makeTranscriptObservation } from "./helpers";

describe("ObservationStore.append", () => {
  test("appends a valid observation, returns appended, and looks it up by id", () => {
    const store = new InMemoryObservationStore();
    const observation = makeDetectionObservation({
      observationId: "obs-1",
      sessionId: "sess-1",
      eventTimeMs: 1000,
      confidence: 0.9,
    });

    expect(store.append(observation)).toBe("appended");
    expect(store.count()).toBe(1);
    expect(store.byId("obs-1")).toEqual(observation);
    expect(store.byId("obs-missing")).toBeUndefined();
  });

  test("rejects invalid observations via the zod schema", () => {
    const store = new InMemoryObservationStore();
    const valid = makeDetectionObservation({
      observationId: "obs-1",
      sessionId: "sess-1",
      eventTimeMs: 1000,
    });

    // Inline invalid fixtures: confidence out of range, negative timeline
    // position, and a corrupted payload. The corrupted fixture is
    // deliberately contract-breaking, hence the explicit cast.
    const outOfRangeConfidence = { ...valid, confidence: 1.5 };
    const negativeEventTime = { ...valid, eventTimeMs: -1 };
    const corruptedPayload = { ...valid, payload: { kind: "detection" } } as unknown as Observation;

    expect(() => store.append(outOfRangeConfidence)).toThrow();
    expect(() => store.append(negativeEventTime)).toThrow();
    expect(() => store.append(corruptedPayload)).toThrow();
    expect(store.count()).toBe(0);
  });

  test("duplicate observationId is an idempotent no-op returning duplicate", () => {
    const store = new InMemoryObservationStore();
    const first = makeDetectionObservation({
      observationId: "obs-1",
      sessionId: "sess-1",
      eventTimeMs: 1000,
      confidence: 0.9,
    });
    // A different record re-using the same observationId (re-delivery with
    // drift): the first stored copy wins.
    const redelivery = makeDetectionObservation({
      observationId: "obs-1",
      sessionId: "sess-1",
      eventTimeMs: 1200,
      confidence: 0.4,
    });

    expect(store.append(first)).toBe("appended");
    expect(store.append(first)).toBe("duplicate");
    expect(store.append(redelivery)).toBe("duplicate");

    expect(store.count()).toBe(1);
    expect(store.all()).toHaveLength(1);
    expect(store.byId("obs-1")).toEqual(first);
  });
});

describe("ObservationStore.query", () => {
  test("filters by sessionId", () => {
    const store = new InMemoryObservationStore();
    store.append(
      makeDetectionObservation({ observationId: "obs-a", sessionId: "sess-1", eventTimeMs: 1000 }),
    );
    store.append(
      makeDetectionObservation({ observationId: "obs-b", sessionId: "sess-2", eventTimeMs: 1100 }),
    );

    expect(store.query({ sessionId: "sess-1" }).map((o) => o.observationId)).toEqual(["obs-a"]);
    expect(store.query({ sessionId: "sess-2" }).map((o) => o.observationId)).toEqual(["obs-b"]);
    expect(store.query({ sessionId: "sess-3" })).toEqual([]);
  });

  test("time window fromMs/toMs is inclusive on both ends", () => {
    const store = new InMemoryObservationStore();
    for (const [id, t] of [
      ["obs-a", 1000],
      ["obs-b", 2000],
      ["obs-c", 3000],
      ["obs-d", 4000],
    ] as const) {
      store.append(
        makeDetectionObservation({ observationId: id, sessionId: "sess-1", eventTimeMs: t }),
      );
    }

    expect(
      store.query({ sessionId: "sess-1", fromMs: 2000, toMs: 3000 }).map((o) => o.observationId),
    ).toEqual(["obs-b", "obs-c"]);
    expect(store.query({ sessionId: "sess-1", fromMs: 2000 }).map((o) => o.observationId)).toEqual([
      "obs-b",
      "obs-c",
      "obs-d",
    ]);
    expect(store.query({ sessionId: "sess-1", toMs: 2000 }).map((o) => o.observationId)).toEqual([
      "obs-a",
      "obs-b",
    ]);
  });

  test("filters by modality", () => {
    const store = new InMemoryObservationStore();
    store.append(
      makeDetectionObservation({
        observationId: "obs-vis",
        sessionId: "sess-1",
        eventTimeMs: 1000,
      }),
    );
    store.append(
      makeTranscriptObservation({
        observationId: "obs-comm",
        sessionId: "sess-1",
        eventTimeMs: 1100,
        text: "Great passage of play",
        asrConfidence: 0.9,
      }),
    );

    expect(
      store.query({ sessionId: "sess-1", modality: "vision" }).map((o) => o.observationId),
    ).toEqual(["obs-vis"]);
    expect(
      store.query({ sessionId: "sess-1", modality: "commentary" }).map((o) => o.observationId),
    ).toEqual(["obs-comm"]);
  });

  test("filters by payload kind", () => {
    const store = new InMemoryObservationStore();
    store.append(
      makeDetectionObservation({
        observationId: "obs-det",
        sessionId: "sess-1",
        eventTimeMs: 1000,
      }),
    );
    store.append(
      makeTranscriptObservation({
        observationId: "obs-tr",
        sessionId: "sess-1",
        eventTimeMs: 1100,
        text: "Goal!",
        asrConfidence: 0.8,
      }),
    );

    expect(
      store.query({ sessionId: "sess-1", kind: "transcription" }).map((o) => o.observationId),
    ).toEqual(["obs-tr"]);
    expect(
      store.query({ sessionId: "sess-1", kind: "detection" }).map((o) => o.observationId),
    ).toEqual(["obs-det"]);
  });

  test("results are sorted by eventTimeMs regardless of append order", () => {
    const store = new InMemoryObservationStore();
    store.append(
      makeDetectionObservation({
        observationId: "obs-late",
        sessionId: "sess-1",
        eventTimeMs: 3000,
      }),
    );
    store.append(
      makeDetectionObservation({
        observationId: "obs-early",
        sessionId: "sess-1",
        eventTimeMs: 1000,
      }),
    );
    store.append(
      makeDetectionObservation({
        observationId: "obs-mid",
        sessionId: "sess-1",
        eventTimeMs: 2000,
      }),
    );

    expect(store.query({ sessionId: "sess-1" }).map((o) => o.observationId)).toEqual([
      "obs-early",
      "obs-mid",
      "obs-late",
    ]);
    expect(store.all().map((o) => o.eventTimeMs)).toEqual([1000, 2000, 3000]);
  });
});

describe("ObservationStore.count and all", () => {
  test("count reflects stored observations and all returns them in canonical order", () => {
    const store = new InMemoryObservationStore();
    expect(store.count()).toBe(0);
    expect(store.all()).toEqual([]);

    store.append(
      makeDetectionObservation({ observationId: "obs-a", sessionId: "sess-1", eventTimeMs: 2000 }),
    );
    store.append(
      makeTranscriptObservation({
        observationId: "obs-b",
        sessionId: "sess-1",
        eventTimeMs: 1000,
        text: "Kick off",
      }),
    );

    expect(store.count()).toBe(2);
    expect(store.all().map((o) => o.observationId)).toEqual(["obs-b", "obs-a"]);
  });
});
