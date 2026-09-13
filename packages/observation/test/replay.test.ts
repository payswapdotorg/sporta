import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAX_REORDER_MS,
  EventDerivationService,
  LateEventError,
  ReplayLog,
  replayDeterministic,
} from "../src/index";
import {
  makeDetectionObservation,
  makeEventEnvelope,
  makeInterval,
  makeTranscriptObservation,
  storeWith,
} from "./helpers";

/** Derives a pass event from the given evidence ids at a timeline position. */
function derivePassEvent(
  service: EventDerivationService,
  sessionId: string,
  eventId: string,
  eventTimeMs: number,
  observationIds: string[],
  correctionOf?: string,
) {
  return service.deriveEvent({
    sessionId,
    eventId,
    eventTypeRef: "football/v1/pass",
    interval: makeInterval(Math.max(0, eventTimeMs - 500), eventTimeMs),
    eventTimeMs,
    evidence: { observationIds },
    ...(correctionOf !== undefined ? { correctionOf } : {}),
  });
}

describe("ReplayLog", () => {
  test("appends and returns events in canonical eventTimeMs order", () => {
    const log = new ReplayLog();
    log.append(makeEventEnvelope({ eventId: "evt-b", eventTimeMs: 2000 }));
    log.append(makeEventEnvelope({ eventId: "evt-a", eventTimeMs: 1000 }));
    log.append(makeEventEnvelope({ eventId: "evt-c", eventTimeMs: 3000 }));

    expect(log.asArray().map((event) => event.eventId)).toEqual(["evt-a", "evt-b", "evt-c"]);
    expect(log.events().map((event) => event.eventTimeMs)).toEqual([1000, 2000, 3000]);
  });

  test("events window filters by from/to inclusively", () => {
    const log = new ReplayLog();
    log.append(makeEventEnvelope({ eventId: "evt-a", eventTimeMs: 1000 }));
    log.append(makeEventEnvelope({ eventId: "evt-b", eventTimeMs: 2000 }));
    log.append(makeEventEnvelope({ eventId: "evt-c", eventTimeMs: 3000 }));

    expect(log.events({ from: 1500, to: 2500 }).map((event) => event.eventId)).toEqual(["evt-b"]);
    expect(log.events({ from: 2000 }).map((event) => event.eventId)).toEqual(["evt-b", "evt-c"]);
    expect(log.events({ to: 2000 }).map((event) => event.eventId)).toEqual(["evt-a", "evt-b"]);
    expect(log.events({ from: 2000, to: 2000 }).map((event) => event.eventId)).toEqual(["evt-b"]);
  });

  test("out-of-order appends within the reorder window are accepted", () => {
    const log = new ReplayLog();

    expect(() => {
      log.append(makeEventEnvelope({ eventId: "evt-1", eventTimeMs: 10000 }));
      // 4000ms behind the high-water mark: within the default 5000ms window.
      log.append(makeEventEnvelope({ eventId: "evt-2", eventTimeMs: 6000 }));
      // Exactly maxReorderMs behind (10000 - 5000): still accepted, not beyond.
      log.append(makeEventEnvelope({ eventId: "evt-3", eventTimeMs: 5000 }));
    }).not.toThrow();

    expect(log.asArray().map((event) => event.eventId)).toEqual(["evt-3", "evt-2", "evt-1"]);
  });

  test("out-of-order appends beyond the reorder window throw LateEventError", () => {
    const log = new ReplayLog();
    log.append(makeEventEnvelope({ eventId: "evt-1", eventTimeMs: 10000 }));

    // 5001ms behind the high-water mark: beyond the default 5000ms window.
    let thrown: unknown;
    try {
      log.append(makeEventEnvelope({ eventId: "evt-late", eventTimeMs: 4999 }));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LateEventError);
    const late = thrown as LateEventError;
    expect(late.eventTimeMs).toBe(4999);
    expect(late.highWaterMs).toBe(10000);
    expect(late.latenessMs).toBe(5001);
    expect(late.maxReorderMs).toBe(DEFAULT_MAX_REORDER_MS);
    // The rejected append left the log untouched.
    expect(log.asArray().map((event) => event.eventId)).toEqual(["evt-1"]);
  });

  test("a custom maxReorderMs is honored", () => {
    const log = new ReplayLog({ maxReorderMs: 1000 });
    log.append(makeEventEnvelope({ eventId: "evt-1", eventTimeMs: 10000 }));

    expect(() => log.append(makeEventEnvelope({ eventId: "evt-2", eventTimeMs: 8000 }))).toThrow(
      LateEventError,
    );
    expect(() =>
      log.append(makeEventEnvelope({ eventId: "evt-3", eventTimeMs: 9500 })),
    ).not.toThrow();
  });
});

describe("replayDeterministic", () => {
  test("re-derives the same events from the recorded evidence", () => {
    const store = storeWith(
      makeDetectionObservation({ observationId: "obs-a", sessionId: "sess-1", eventTimeMs: 1000 }),
      makeDetectionObservation({ observationId: "obs-b", sessionId: "sess-1", eventTimeMs: 1500 }),
    );
    const service = new EventDerivationService(store);
    const eventA = derivePassEvent(service, "sess-1", "evt-a", 1500, ["obs-a", "obs-b"]);
    const eventB = derivePassEvent(service, "sess-1", "evt-b", 3000, ["obs-b"]);

    const log = new ReplayLog();
    log.append(eventA);
    log.append(eventB);

    const result = replayDeterministic(log, store);

    expect(result.deterministic).toBe(true);
    expect(result.events).toEqual([eventA, eventB]);
    expect(result.skipped).toEqual([]);
    expect(result.superseded).toEqual([]);

    // Replay is repeatable: the same inputs yield the same output again.
    const again = replayDeterministic(log, store);
    expect(again).toEqual(result);
  });

  test("skips events whose evidence is absent and reports the reason", () => {
    const fullStore = storeWith(
      makeDetectionObservation({ observationId: "obs-a", sessionId: "sess-1", eventTimeMs: 1000 }),
      makeDetectionObservation({ observationId: "obs-b", sessionId: "sess-1", eventTimeMs: 1500 }),
      makeDetectionObservation({ observationId: "obs-c", sessionId: "sess-1", eventTimeMs: 2000 }),
    );
    const service = new EventDerivationService(fullStore);
    const eventAb = derivePassEvent(service, "sess-1", "evt-ab", 1500, ["obs-a", "obs-b"]);
    const eventC = derivePassEvent(service, "sess-1", "evt-c", 2000, ["obs-c"]);

    const log = new ReplayLog();
    log.append(eventAb);
    log.append(eventC);

    // Replay against a store missing obs-b: evt-ab cannot be re-derived.
    const partialStore = storeWith(
      makeDetectionObservation({ observationId: "obs-a", sessionId: "sess-1", eventTimeMs: 1000 }),
      makeDetectionObservation({ observationId: "obs-c", sessionId: "sess-1", eventTimeMs: 2000 }),
    );
    const result = replayDeterministic(log, partialStore);

    expect(result.events).toEqual([eventC]);
    expect(result.skipped).toEqual([{ event: eventAb, reason: "missing-evidence" }]);
    expect(result.superseded).toEqual([]);
  });

  test("a correction supersedes the referenced event, preserved in superseded", () => {
    const store = storeWith(
      makeDetectionObservation({ observationId: "obs-a", sessionId: "sess-1", eventTimeMs: 1000 }),
      makeDetectionObservation({ observationId: "obs-b", sessionId: "sess-1", eventTimeMs: 1200 }),
    );
    const service = new EventDerivationService(store);
    const original = derivePassEvent(service, "sess-1", "evt-original", 1000, ["obs-a"]);
    const correction = derivePassEvent(
      service,
      "sess-1",
      "evt-correction",
      1200,
      ["obs-b"],
      "evt-original",
    );

    const log = new ReplayLog();
    log.append(original);
    log.append(correction);

    const result = replayDeterministic(log, store);

    // Only the correction stays effective; the superseded original keeps its
    // full envelope (provenance preserved, never dropped silently).
    expect(result.events).toEqual([correction]);
    expect(result.events[0]?.correctionOf).toBe("evt-original");
    expect(result.superseded).toEqual([original]);
    expect(result.skipped).toEqual([]);
  });

  test("correction chains resolve to the latest correction", () => {
    const store = storeWith(
      makeDetectionObservation({ observationId: "obs-a", sessionId: "sess-1", eventTimeMs: 1000 }),
      makeDetectionObservation({ observationId: "obs-b", sessionId: "sess-1", eventTimeMs: 1200 }),
      makeDetectionObservation({ observationId: "obs-c", sessionId: "sess-1", eventTimeMs: 1400 }),
    );
    const service = new EventDerivationService(store);
    const first = derivePassEvent(service, "sess-1", "evt-1", 1000, ["obs-a"]);
    const second = derivePassEvent(service, "sess-1", "evt-2", 1200, ["obs-b"], "evt-1");
    const third = derivePassEvent(service, "sess-1", "evt-3", 1400, ["obs-c"], "evt-2");

    const log = new ReplayLog();
    log.append(first);
    log.append(second);
    log.append(third);

    const result = replayDeterministic(log, store);

    expect(result.events).toEqual([third]);
    expect(result.superseded).toEqual([first, second]);
  });

  test("respects the replay window fromMs/toMs", () => {
    const store = storeWith(
      makeDetectionObservation({ observationId: "obs-a", sessionId: "sess-1", eventTimeMs: 1000 }),
      makeDetectionObservation({ observationId: "obs-b", sessionId: "sess-1", eventTimeMs: 2000 }),
      makeDetectionObservation({ observationId: "obs-c", sessionId: "sess-1", eventTimeMs: 3000 }),
    );
    const service = new EventDerivationService(store);
    const eventA = derivePassEvent(service, "sess-1", "evt-a", 1000, ["obs-a"]);
    const eventB = derivePassEvent(service, "sess-1", "evt-b", 2000, ["obs-b"]);
    const eventC = derivePassEvent(service, "sess-1", "evt-c", 3000, ["obs-c"]);

    const log = new ReplayLog();
    log.append(eventA);
    log.append(eventB);
    log.append(eventC);

    expect(replayDeterministic(log, store, { fromMs: 1500, toMs: 2500 }).events).toEqual([eventB]);
    expect(replayDeterministic(log, store, { fromMs: 2000 }).events).toEqual([eventB, eventC]);
    expect(replayDeterministic(log, store, { toMs: 2000 }).events).toEqual([eventA, eventB]);
  });

  test("commentary events replay identically (confidence and reportedBy preserved)", () => {
    const transcript = makeTranscriptObservation({
      observationId: "obs-tr-1",
      sessionId: "sess-1",
      eventTimeMs: 42000,
      text: "What a goal from the striker!",
      asrConfidence: 0.9,
    });
    const store = storeWith(transcript);
    const service = new EventDerivationService(store);
    const goal = service.deriveCommentaryEvent(transcript, {
      pattern: /goal/i,
      eventTypeRef: "football/v1/goal",
    });
    if (goal === null) throw new Error("expected the goal rule to match the transcript");

    const log = new ReplayLog();
    log.append(goal);

    const result = replayDeterministic(log, store);
    expect(result.events).toEqual([goal]);
    expect(result.events[0]?.confidence).toBe(goal.confidence);
    expect(result.events[0]?.evidence.reportedBy).toBe("commentary");
    expect(result.skipped).toEqual([]);
    expect(result.superseded).toEqual([]);
  });
});
