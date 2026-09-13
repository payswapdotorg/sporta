import { describe, expect, test } from "bun:test";
import type { EventEnvelope } from "@sporta/contracts";
import {
  CorrectionTargetNotFoundError,
  DuplicateEventError,
  EventSessionMismatchError,
  InvalidEntityIdError,
  InvalidEventError,
  LateEventError,
  WorldModelEngine,
  auditTrail,
} from "../src/index";
import { SESSION_ID, makeEntity, makeEvent } from "./helpers";

describe("event application (in-order)", () => {
  test("events append in order with increasing sequences and versions", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    const first = engine.applyEvent(makeEvent({ eventId: "evt_1", eventTimeMs: 1_000 }));
    const second = engine.applyEvent(makeEvent({ eventId: "evt_2", eventTimeMs: 2_000 }));
    expect(first.sequence).toBe(1);
    expect(first.snapshotVersionAfter).toBe(2);
    expect(second.sequence).toBe(2);
    expect(second.snapshotVersionAfter).toBe(3);
    expect(engine.eventCount).toBe(2);
  });

  test("eventsSince(0) returns everything in event-time order", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.applyEvent(makeEvent({ eventId: "evt_1", eventTimeMs: 1_000 }));
    engine.applyEvent(makeEvent({ eventId: "evt_2", eventTimeMs: 2_000 }));
    engine.applyEvent(makeEvent({ eventId: "evt_3", eventTimeMs: 3_000 }));
    expect(engine.eventsSince(0).map((entry) => entry.event.eventId)).toEqual([
      "evt_1",
      "evt_2",
      "evt_3",
    ]);
  });

  test("eventsSince is exclusive of the checkpoint sequence", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.applyEvent(makeEvent({ eventId: "evt_1", eventTimeMs: 1_000 }));
    engine.applyEvent(makeEvent({ eventId: "evt_2", eventTimeMs: 2_000 }));
    expect(engine.eventsSince(1).map((entry) => entry.event.eventId)).toEqual(["evt_2"]);
    expect(engine.eventsSince(2)).toEqual([]);
  });

  test("future event times are accepted and move the high-water forward", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.applyEvent(makeEvent({ eventId: "evt_1", eventTimeMs: 10_000 }));
    engine.applyEvent(makeEvent({ eventId: "evt_2", eventTimeMs: 60_000 }));
    expect(engine.eventCount).toBe(2);
    expect(engine.snapshot().watermark.watermarkMs).toBe(60_000);
  });

  test("events are validated against the EventEnvelope contract", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    expect(() =>
      engine.applyEvent(
        makeEvent({ evidence: { observationIds: [] } }) as unknown as EventEnvelope,
      ),
    ).toThrow(InvalidEventError);
    expect(() => engine.applyEvent(makeEvent({ eventTimeMs: -1 }))).toThrow(InvalidEventError);
    expect(engine.eventCount).toBe(0);
  });

  test("an event from another session is rejected", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    expect(() => engine.applyEvent(makeEvent({ sessionId: "sess_other" }))).toThrow(
      EventSessionMismatchError,
    );
  });

  test("duplicate event ids are rejected", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.applyEvent(makeEvent({ eventId: "evt_dup", eventTimeMs: 1_000 }));
    expect(() => engine.applyEvent(makeEvent({ eventId: "evt_dup", eventTimeMs: 1_500 }))).toThrow(
      DuplicateEventError,
    );
    expect(engine.eventCount).toBe(1);
  });

  test("the applied event is stored as a clone of the caller's input", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    const event = makeEvent({ eventId: "evt_iso" });
    engine.applyEvent(event);
    event.confidence = 0.01;
    event.evidence.observationIds.push("obs_late");
    const stored = engine.eventsSince(0).find((entry) => entry.event.eventId === "evt_iso");
    expect(stored?.event.confidence).toBe(0.8);
    expect(stored?.event.evidence.observationIds).toEqual(["obs_001", "obs_002"]);
  });

  test("applyEvent returns a frozen stream entry", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    const entry = engine.applyEvent(makeEvent({ eventId: "evt_ret" }));
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.event)).toBe(true);
    expect(() => {
      entry.sequence = 99;
    }).toThrow(TypeError);
  });

  test("plain events do not bump entity versions", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_p" }));
    engine.applyEvent(makeEvent({ eventId: "evt_plain", eventTimeMs: 1_500 }), {
      affectedEntityIds: ["ent_p"],
    });
    expect(engine.entityAt("ent_p")?.version).toBe(1);
  });
});

describe("bounded reorder", () => {
  test("an event within the reorder window is accepted and kept sorted", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.applyEvent(makeEvent({ eventId: "evt_1", eventTimeMs: 10_000 }));
    engine.applyEvent(makeEvent({ eventId: "evt_2", eventTimeMs: 5_000 }));
    expect(engine.eventCount).toBe(2);
    expect(engine.eventsSince(0).map((entry) => entry.event.eventId)).toEqual(["evt_2", "evt_1"]);
  });

  test("an event exactly at the window edge is accepted", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.applyEvent(makeEvent({ eventId: "evt_1", eventTimeMs: 10_000 }));
    engine.applyEvent(makeEvent({ eventId: "evt_2", eventTimeMs: 5_000 }));
    expect(engine.eventCount).toBe(2);
  });

  test("an event older than the window throws LateEventError", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.applyEvent(makeEvent({ eventId: "evt_1", eventTimeMs: 10_000 }));
    let caught: unknown;
    try {
      engine.applyEvent(makeEvent({ eventId: "evt_2", eventTimeMs: 4_999 }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LateEventError);
    const late = caught as LateEventError;
    expect(late.eventTimeMs).toBe(4_999);
    expect(late.logHighWaterMs).toBe(10_000);
    expect(late.maxReorderMs).toBe(5_000);
    expect(engine.eventCount).toBe(1);
  });

  test("the window is configurable at create time", () => {
    const wide = WorldModelEngine.create(SESSION_ID, { maxReorderMs: 60_000 });
    wide.applyEvent(makeEvent({ eventId: "evt_1", eventTimeMs: 100_000 }));
    wide.applyEvent(makeEvent({ eventId: "evt_2", eventTimeMs: 50_000 }));
    expect(wide.eventCount).toBe(2);

    const strict = WorldModelEngine.create(SESSION_ID, { maxReorderMs: 0 });
    strict.applyEvent(makeEvent({ eventId: "evt_1", eventTimeMs: 1_000 }));
    expect(() => strict.applyEvent(makeEvent({ eventId: "evt_2", eventTimeMs: 999 }))).toThrow(
      LateEventError,
    );
  });

  test("malformed affectedEntityIds are rejected", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    expect(() =>
      engine.applyEvent(makeEvent({ eventId: "evt_1" }), {
        affectedEntityIds: ["bad id!"],
      }),
    ).toThrow(InvalidEntityIdError);
    expect(engine.eventCount).toBe(0);
  });
});

describe("corrections (versioned supersession)", () => {
  test("a correction bumps the target entity's version and is recorded", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_p1", lastEventTimeMs: 1_000 }));
    engine.applyEvent(makeEvent({ eventId: "evt_orig", eventTimeMs: 1_500 }), {
      affectedEntityIds: ["ent_p1"],
    });
    const correction = engine.applyEvent(
      makeEvent({ eventId: "evt_corr", eventTimeMs: 2_000, correctionOf: "evt_orig" }),
    );
    expect(correction.sequence).toBe(2);
    const entity = engine.entityAt("ent_p1");
    expect(entity?.version).toBe(2);
    expect(entity?.lastEventTimeMs).toBe(2_000);
  });

  test("superseded events stay queryable, never silently rewritten", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.applyEvent(makeEvent({ eventId: "evt_orig", eventTimeMs: 1_000 }));
    engine.applyEvent(
      makeEvent({ eventId: "evt_corr", eventTimeMs: 1_200, correctionOf: "evt_orig" }),
    );
    const entries = engine.eventsSince(0);
    expect(entries.map((entry) => entry.event.eventId)).toEqual(["evt_orig", "evt_corr"]);
    const original = entries.find((entry) => entry.event.eventId === "evt_orig");
    expect(original?.event.correctionOf).toBeUndefined();
    expect(original?.event.eventTimeMs).toBe(1_000);
    const correcting = entries.find((entry) => entry.event.eventId === "evt_corr");
    expect(correcting?.event.correctionOf).toBe("evt_orig");
  });

  test("a correction bumps the snapshot version even without associations", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.applyEvent(makeEvent({ eventId: "evt_a", eventTimeMs: 1_000 }));
    const before = engine.snapshotVersion;
    engine.applyEvent(makeEvent({ eventId: "evt_b", eventTimeMs: 1_200, correctionOf: "evt_a" }));
    expect(engine.snapshotVersion).toBe(before + 1);
  });

  test("a correction's own affectedEntityIds also bump versions", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_c1" }));
    engine.applyEvent(makeEvent({ eventId: "evt_x", eventTimeMs: 1_000 }));
    engine.applyEvent(makeEvent({ eventId: "evt_xc", eventTimeMs: 1_100, correctionOf: "evt_x" }), {
      affectedEntityIds: ["ent_c1"],
    });
    expect(engine.entityAt("ent_c1")?.version).toBe(2);
  });

  test("associations referencing unknown entities are tolerated", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.applyEvent(makeEvent({ eventId: "evt_ghost", eventTimeMs: 1_000 }), {
      affectedEntityIds: ["ent_ghost"],
    });
    const before = engine.snapshotVersion;
    engine.applyEvent(
      makeEvent({ eventId: "evt_ghost_c", eventTimeMs: 1_100, correctionOf: "evt_ghost" }),
    );
    expect(engine.snapshotVersion).toBe(before + 1);
    expect(engine.eventCount).toBe(2);
  });

  test("a correction for an unknown target is rejected", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    expect(() =>
      engine.applyEvent(makeEvent({ eventId: "evt_c", correctionOf: "evt_missing" })),
    ).toThrow(CorrectionTargetNotFoundError);
    expect(engine.eventCount).toBe(0);
  });

  test("auditTrail reflects the corrected state", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_trail", lastEventTimeMs: 1_000 }));
    engine.applyEvent(makeEvent({ eventId: "evt_1", eventTimeMs: 1_500 }), {
      affectedEntityIds: ["ent_trail"],
    });
    engine.applyEvent(makeEvent({ eventId: "evt_2", eventTimeMs: 2_000, correctionOf: "evt_1" }));
    expect(auditTrail(engine)).toEqual({
      snapshotVersion: 4,
      events: 2,
      entities: [
        {
          entityId: "ent_trail",
          kind: "participant",
          version: 2,
          lastEventTimeMs: 2_000,
        },
      ],
    });
  });
});
