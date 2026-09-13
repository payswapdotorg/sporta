import { describe, expect, test } from "bun:test";
import { describeProvenance, auditTrail, WorldModelEngine } from "../src/index";
import { SESSION_ID, makeEntity, makeEvent } from "./helpers";

describe("describeProvenance", () => {
  test("renders the evidence chain: event -> observationIds -> provenance", () => {
    const event = makeEvent({
      eventId: "evt_prov",
      confidence: 0.77,
      evidence: { observationIds: ["obs_10", "obs_11"], reportedBy: "commentary-fusion" },
    });
    const text = describeProvenance(event);
    expect(text).toContain("evt_prov");
    expect(text).toContain("obs_10");
    expect(text).toContain("obs_11");
    expect(text).toContain("provenance=DERIVED");
    expect(text).toContain("confidence=0.77");
    expect(text).toContain("reportedBy=commentary-fusion");
  });

  test("includes the session, type and event time", () => {
    const text = describeProvenance(makeEvent());
    expect(text).toContain(`session=${SESSION_ID}`);
    expect(text).toContain("type=football/v1/pass");
    expect(text).toContain("eventTimeMs=1000");
  });

  test("optional fields are omitted when absent", () => {
    const bare = makeEvent({
      confidence: undefined,
      evidence: { observationIds: ["obs_1"] },
    });
    const text = describeProvenance(bare);
    expect(text).toContain("obs_1");
    expect(text).not.toContain("confidence=");
    expect(text).not.toContain("reportedBy=");
    expect(text).not.toContain("corrects=");
    expect(text).not.toContain("interval=");
  });

  test("spanning intervals and corrections are rendered", () => {
    const spanned = makeEvent({ interval: { startTimeMs: 1_000, endTimeMs: 2_500 } });
    expect(describeProvenance(spanned)).toContain("interval=[1000ms..2500ms]");
    const correction = makeEvent({ eventId: "evt_prov_c", correctionOf: "evt_prov" });
    expect(describeProvenance(correction)).toContain("corrects=evt_prov");
  });
});

describe("auditTrail", () => {
  test("summarizes an empty engine", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    expect(auditTrail(engine)).toEqual({
      snapshotVersion: 1,
      events: 0,
      entities: [],
    });
  });

  test("summarizes entities, events and the snapshot version", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_1", lastEventTimeMs: 1_000 }));
    engine.upsertEntity(makeEntity({ entityId: "ent_2", lastEventTimeMs: 2_500, kind: "ball" }));
    engine.applyEvent(makeEvent({ eventId: "evt_1", eventTimeMs: 1_500 }));
    const trail = auditTrail(engine);
    expect(trail.snapshotVersion).toBe(4);
    expect(trail.events).toBe(1);
    expect(trail.entities).toEqual([
      { entityId: "ent_1", kind: "participant", version: 1, lastEventTimeMs: 1_000 },
      { entityId: "ent_2", kind: "ball", version: 1, lastEventTimeMs: 2_500 },
    ]);
  });
});
