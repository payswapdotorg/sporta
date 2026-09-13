/**
 * Deterministic sequence tests (W003): timelines spread across the canonical
 * media timeline, alternating modalities/event types, schema-valid by
 * construction, and stable per seed.
 */
import { describe, expect, test } from "bun:test";
import { EventEnvelope, Observation } from "@sporta/contracts";
import {
  DEFAULT_EVENT_TYPE_REFS,
  DEFAULT_MODALITIES,
  eventSequence,
  observationTimeline,
} from "../src/sequences";

const SEED_A = 42;
const SEED_B = 43;

describe("observationTimeline", () => {
  test("places observations at fromMs + i * stepMs on the timeline", () => {
    const timeline = observationTimeline({ count: 4, fromMs: 1000, stepMs: 500 });
    expect(timeline.map((observation) => observation.eventTimeMs)).toEqual([
      1000, 1500, 2000, 2500,
    ]);
  });

  test("uses readable zero-padded ids in timeline order", () => {
    const timeline = observationTimeline({ count: 3, fromMs: 0, stepMs: 10 });
    expect(timeline.map((observation) => observation.observationId)).toEqual([
      "obs-0000",
      "obs-0001",
      "obs-0002",
    ]);
  });

  test("every observation is schema-valid with provenance observed", () => {
    const timeline = observationTimeline({ count: 6, fromMs: 0, stepMs: 100, seed: SEED_A });
    for (const observation of timeline) {
      expect(Observation.safeParse(observation).success).toBe(true);
      expect(observation.provenance).toBe("OBSERVED");
      expect(observation.sessionId).toMatch(/^sess-/);
    }
  });

  test("default modality cycle alternates vision/audio/metadata", () => {
    const timeline = observationTimeline({ count: 7, fromMs: 0, stepMs: 100 });
    expect(timeline.map((observation) => observation.modality)).toEqual([
      "vision",
      "audio",
      "metadata",
      "vision",
      "audio",
      "metadata",
      "vision",
    ]);
    expect(DEFAULT_MODALITIES).toEqual(["vision", "audio", "metadata"]);
  });

  test("payload kind follows the modality", () => {
    const timeline = observationTimeline({ count: 3, fromMs: 0, stepMs: 100, seed: SEED_A });
    const kinds = timeline.map((observation) => observation.payload.kind);
    expect(kinds).toEqual(["detection", "transcription", "generic"]);
    const audio = timeline[1];
    if (audio?.payload.kind === "transcription") {
      expect(typeof audio.payload.asrConfidence).toBe("number");
    } else {
      throw new Error("expected a transcription payload for the audio modality");
    }
  });

  test("custom modalities are respected (single-modality commentary timeline)", () => {
    const timeline = observationTimeline({
      count: 3,
      fromMs: 0,
      stepMs: 100,
      modalities: ["commentary"],
    });
    for (const observation of timeline) {
      expect(observation.modality).toBe("commentary");
      expect(observation.payload.kind).toBe("transcription");
    }
  });

  test("sessionId option stamps every observation", () => {
    const timeline = observationTimeline({
      count: 3,
      fromMs: 0,
      stepMs: 100,
      sessionId: "sess-e2e",
    });
    for (const observation of timeline) {
      expect(observation.sessionId).toBe("sess-e2e");
    }
  });

  test("same options produce deep-equal timelines; different seeds differ", () => {
    const options = { count: 5, fromMs: 0, stepMs: 250, sessionId: "sess-x" };
    expect(observationTimeline({ ...options, seed: SEED_A })).toEqual(
      observationTimeline({ ...options, seed: SEED_A }),
    );
    expect(observationTimeline({ ...options, seed: SEED_A })).not.toEqual(
      observationTimeline({ ...options, seed: SEED_B }),
    );
  });

  test("count 0 produces an empty timeline", () => {
    expect(observationTimeline({ count: 0, fromMs: 0, stepMs: 100 })).toEqual([]);
  });

  test("rejects invalid options (fail loud, not fail silently)", () => {
    expect(() => observationTimeline({ count: -1, fromMs: 0, stepMs: 1 })).toThrow(RangeError);
    expect(() => observationTimeline({ count: 1.5, fromMs: 0, stepMs: 1 })).toThrow(RangeError);
    expect(() => observationTimeline({ count: 1, fromMs: -1, stepMs: 1 })).toThrow(RangeError);
    expect(() => observationTimeline({ count: 1, fromMs: 0, stepMs: -1 })).toThrow(RangeError);
    expect(() => observationTimeline({ count: 1, fromMs: 0, stepMs: 1, modalities: [] })).toThrow(
      RangeError,
    );
  });
});

describe("eventSequence", () => {
  test("places events at fromMs + i * stepMs with instantaneous intervals", () => {
    const events = eventSequence({ count: 4, fromMs: 2000, stepMs: 750 });
    expect(events.map((event) => event.eventTimeMs)).toEqual([2000, 2750, 3500, 4250]);
    for (const event of events) {
      expect(event.interval.startTimeMs).toBe(event.eventTimeMs);
      expect(event.interval.endTimeMs).toBe(event.eventTimeMs);
    }
  });

  test("every event is a schema-valid derived event with evidence", () => {
    const events = eventSequence({ count: 5, fromMs: 0, stepMs: 100, seed: SEED_A });
    for (const event of events) {
      expect(EventEnvelope.safeParse(event).success).toBe(true);
      expect(event.provenance).toBe("DERIVED");
      expect(event.evidence.observationIds.length).toBeGreaterThan(0);
    }
  });

  test("default event types cycle pass/carry/tackle", () => {
    const events = eventSequence({ count: 4, fromMs: 0, stepMs: 100 });
    expect(events.map((event) => event.eventTypeRef)).toEqual([
      "football/v1/pass",
      "football/v1/carry",
      "football/v1/tackle",
      "football/v1/pass",
    ]);
    expect(DEFAULT_EVENT_TYPE_REFS).toEqual([
      "football/v1/pass",
      "football/v1/carry",
      "football/v1/tackle",
    ]);
  });

  test("evidence ids cross-link to the observation timeline with the same shape", () => {
    const shared = { count: 3, fromMs: 0, stepMs: 1000, sessionId: "sess-e2e" };
    const observations = observationTimeline({ ...shared, seed: SEED_A });
    const events = eventSequence({ ...shared, seed: SEED_A });
    expect(events.map((event) => event.evidence.observationIds[0])).toEqual(
      observations.map((observation) => observation.observationId),
    );
  });

  test("custom event type refs are respected", () => {
    const events = eventSequence({
      count: 2,
      fromMs: 0,
      stepMs: 10,
      eventTypeRefs: ["football/v1/goal"],
    });
    for (const event of events) {
      expect(event.eventTypeRef).toBe("football/v1/goal");
    }
  });

  test("same options produce deep-equal sequences; different seeds differ", () => {
    const options = { count: 5, fromMs: 0, stepMs: 250, sessionId: "sess-x" };
    expect(eventSequence({ ...options, seed: SEED_A })).toEqual(
      eventSequence({ ...options, seed: SEED_A }),
    );
    expect(eventSequence({ ...options, seed: SEED_A })).not.toEqual(
      eventSequence({ ...options, seed: SEED_B }),
    );
  });

  test("rejects invalid options (fail loud, not fail silently)", () => {
    expect(() => eventSequence({ count: -1, fromMs: 0, stepMs: 1 })).toThrow(RangeError);
    expect(() => eventSequence({ count: 1, fromMs: 0, stepMs: -1 })).toThrow(RangeError);
    expect(() => eventSequence({ count: 1, fromMs: 0, stepMs: 1, eventTypeRefs: [] })).toThrow(
      RangeError,
    );
  });
});
