import { describe, expect, test } from "bun:test";
import { EventEnvelope } from "@sporta/contracts";
import {
  COMMENTARY_CONFIDENCE_WEIGHT,
  MISSING_CONFIDENCE_DEFAULT,
  EventDerivationService,
  MissingEvidenceError,
} from "../src/index";
import { InMemoryObservationStore } from "../src/store";
import { makeDetectionObservation, makeInterval, makeTranscriptObservation } from "./helpers";

describe("EventDerivationService.deriveEvent", () => {
  test("happy path: derives an event linked to two evidence observations", () => {
    const store = new InMemoryObservationStore();
    store.append(
      makeDetectionObservation({
        observationId: "obs-a",
        sessionId: "sess-1",
        eventTimeMs: 1000,
        confidence: 0.9,
      }),
    );
    store.append(
      makeDetectionObservation({
        observationId: "obs-b",
        sessionId: "sess-1",
        eventTimeMs: 1500,
        confidence: 0.6,
      }),
    );
    const service = new EventDerivationService(store);

    const event = service.deriveEvent({
      sessionId: "sess-1",
      eventId: "evt-1",
      eventTypeRef: "football/v1/pass",
      interval: makeInterval(1000, 1500),
      eventTimeMs: 1500,
      evidence: { observationIds: ["obs-a", "obs-b"] },
    });

    expect(event.eventId).toBe("evt-1");
    expect(event.sessionId).toBe("sess-1");
    expect(event.eventTypeRef).toBe("football/v1/pass");
    expect(event.eventTimeMs).toBe(1500);
    expect(event.interval).toEqual({ startTimeMs: 1000, endTimeMs: 1500 });
    expect(event.provenance).toBe("DERIVED");
    expect(event.evidence.observationIds).toEqual(["obs-a", "obs-b"]);
    expect(event.correctionOf).toBeUndefined();
    // The derived envelope satisfies the contract schema.
    expect(EventEnvelope.safeParse(event).success).toBe(true);
  });

  test("throws MissingEvidenceError when an evidence observation is absent", () => {
    const store = new InMemoryObservationStore();
    store.append(
      makeDetectionObservation({ observationId: "obs-a", sessionId: "sess-1", eventTimeMs: 1000 }),
    );
    const service = new EventDerivationService(store);

    expect(() =>
      service.deriveEvent({
        sessionId: "sess-1",
        eventId: "evt-1",
        eventTypeRef: "football/v1/pass",
        interval: makeInterval(1000),
        eventTimeMs: 1000,
        evidence: { observationIds: ["obs-a", "obs-missing"] },
      }),
    ).toThrow(MissingEvidenceError);

    try {
      service.deriveEvent({
        sessionId: "sess-1",
        eventId: "evt-1",
        eventTypeRef: "football/v1/pass",
        interval: makeInterval(1000),
        eventTimeMs: 1000,
        evidence: { observationIds: ["obs-missing-1", "obs-missing-2"] },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MissingEvidenceError);
      expect((error as MissingEvidenceError).missingObservationIds).toEqual([
        "obs-missing-1",
        "obs-missing-2",
      ]);
    }
  });

  test("propagates the minimum of the supporting observation confidences", () => {
    const store = new InMemoryObservationStore();
    store.append(
      makeDetectionObservation({
        observationId: "obs-a",
        sessionId: "sess-1",
        eventTimeMs: 1000,
        confidence: 0.9,
      }),
    );
    store.append(
      makeDetectionObservation({
        observationId: "obs-b",
        sessionId: "sess-1",
        eventTimeMs: 1100,
        confidence: 0.6,
      }),
    );
    const service = new EventDerivationService(store);

    const event = service.deriveEvent({
      sessionId: "sess-1",
      eventId: "evt-min",
      eventTypeRef: "football/v1/pass",
      interval: makeInterval(1000, 1100),
      eventTimeMs: 1100,
      evidence: { observationIds: ["obs-a", "obs-b"] },
    });
    expect(event.confidence).toBe(0.6);
  });

  test("an observation without confidence contributes the conservative 0.5 default", () => {
    const store = new InMemoryObservationStore();
    store.append(
      makeDetectionObservation({
        observationId: "obs-a",
        sessionId: "sess-1",
        eventTimeMs: 1000,
        confidence: 0.9,
      }),
    );
    // No confidence field on the second observation.
    store.append(
      makeDetectionObservation({ observationId: "obs-b", sessionId: "sess-1", eventTimeMs: 1100 }),
    );
    const service = new EventDerivationService(store);

    const event = service.deriveEvent({
      sessionId: "sess-1",
      eventId: "evt-default",
      eventTypeRef: "football/v1/pass",
      interval: makeInterval(1000, 1100),
      eventTimeMs: 1100,
      evidence: { observationIds: ["obs-a", "obs-b"] },
    });
    expect(event.confidence).toBe(MISSING_CONFIDENCE_DEFAULT);

    // All evidence missing confidence: still the default.
    const onlyDefault = service.deriveEvent({
      sessionId: "sess-1",
      eventId: "evt-default-2",
      eventTypeRef: "football/v1/pass",
      interval: makeInterval(1100),
      eventTimeMs: 1100,
      evidence: { observationIds: ["obs-b"] },
    });
    expect(onlyDefault.confidence).toBe(MISSING_CONFIDENCE_DEFAULT);
  });

  test("an explicit derivation-rule confidence replaces the computed minimum", () => {
    const store = new InMemoryObservationStore();
    store.append(
      makeDetectionObservation({
        observationId: "obs-a",
        sessionId: "sess-1",
        eventTimeMs: 1000,
        confidence: 0.9,
      }),
    );
    const service = new EventDerivationService(store);

    const event = service.deriveEvent({
      sessionId: "sess-1",
      eventId: "evt-rule",
      eventTypeRef: "football/v1/pass",
      interval: makeInterval(1000),
      eventTimeMs: 1000,
      evidence: { observationIds: ["obs-a"] },
      confidence: 0.4,
    });
    expect(event.confidence).toBe(0.4);
  });

  test("rejects empty evidence chains", () => {
    const service = new EventDerivationService(new InMemoryObservationStore());
    expect(() =>
      service.deriveEvent({
        sessionId: "sess-1",
        eventId: "evt-empty",
        eventTypeRef: "football/v1/pass",
        interval: makeInterval(1000),
        eventTimeMs: 1000,
        evidence: { observationIds: [] },
      }),
    ).toThrow(MissingEvidenceError);
  });

  test("invalid construction surfaces the envelope contract error", () => {
    const store = new InMemoryObservationStore();
    store.append(
      makeDetectionObservation({ observationId: "obs-a", sessionId: "sess-1", eventTimeMs: 1000 }),
    );
    const service = new EventDerivationService(store);

    // endTimeMs before startTimeMs violates the Interval contract.
    expect(() =>
      service.deriveEvent({
        sessionId: "sess-1",
        eventId: "evt-bad-interval",
        eventTypeRef: "football/v1/pass",
        interval: { startTimeMs: 2000, endTimeMs: 1000 },
        eventTimeMs: 2000,
        evidence: { observationIds: ["obs-a"] },
      }),
    ).toThrow(/endTimeMs/);
  });
});

describe("EventDerivationService.deriveCommentaryEvent", () => {
  const goalRule = { pattern: /goal/i, eventTypeRef: "football/v1/goal" };

  test("match: derives a commentary-reported event from the transcript", () => {
    const transcript = makeTranscriptObservation({
      observationId: "obs-tr-1",
      sessionId: "sess-1",
      eventTimeMs: 42000,
      text: "What a goal from the striker!",
      asrConfidence: 0.9,
    });
    const service = new EventDerivationService(new InMemoryObservationStore());

    const event = service.deriveCommentaryEvent(transcript, goalRule);
    expect(event).not.toBeNull();

    expect(event?.eventId).toBe("evt-obs-tr-1-football-v1-goal");
    expect(event?.sessionId).toBe("sess-1");
    expect(event?.eventTypeRef).toBe("football/v1/goal");
    expect(event?.eventTimeMs).toBe(42000);
    expect(event?.interval).toEqual({ startTimeMs: 42000, endTimeMs: 42000 });
    expect(event?.provenance).toBe("DERIVED");
    expect(event?.evidence.observationIds).toEqual(["obs-tr-1"]);
    expect(event?.evidence.reportedBy).toBe("commentary");
    expect(event?.confidence).toBe(0.9 * COMMENTARY_CONFIDENCE_WEIGHT);
    expect(EventEnvelope.safeParse(event).success).toBe(true);
  });

  test("no match: returns null", () => {
    const transcript = makeTranscriptObservation({
      observationId: "obs-tr-2",
      sessionId: "sess-1",
      eventTimeMs: 42000,
      text: "Neat interchange in midfield",
      asrConfidence: 0.9,
    });
    const service = new EventDerivationService(new InMemoryObservationStore());

    expect(service.deriveCommentaryEvent(transcript, goalRule)).toBeNull();
  });

  test("missing asrConfidence uses the conservative 0.5 default before the commentary weight", () => {
    const transcript = makeTranscriptObservation({
      observationId: "obs-tr-3",
      sessionId: "sess-1",
      eventTimeMs: 42000,
      text: "GOAL! Straight from the corner",
    });
    const service = new EventDerivationService(new InMemoryObservationStore());

    const event = service.deriveCommentaryEvent(transcript, goalRule);
    expect(event?.confidence).toBe(MISSING_CONFIDENCE_DEFAULT * COMMENTARY_CONFIDENCE_WEIGHT);
  });

  test("rejects non-transcription observations", () => {
    const detection = makeDetectionObservation({
      observationId: "obs-det-1",
      sessionId: "sess-1",
      eventTimeMs: 1000,
    });
    const service = new EventDerivationService(new InMemoryObservationStore());

    expect(() => service.deriveCommentaryEvent(detection, goalRule)).toThrow(TypeError);
  });
});
