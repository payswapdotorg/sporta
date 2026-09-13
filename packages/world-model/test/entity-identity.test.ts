import { describe, expect, test } from "bun:test";
import type { WorldEntity } from "@sporta/contracts";
import {
  EntityKindChangeError,
  InvalidEntityError,
  WorldModelEngine,
  auditTrail,
  known,
} from "../src/index";
import { SESSION_ID, makeEntity } from "./helpers";

describe("entity identity (upsert)", () => {
  test("a new entityId inserts with version 1 (caller version ignored)", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    const stored = engine.upsertEntity(makeEntity({ entityId: "ent_new", version: 9 }));
    expect(stored.version).toBe(1);
    expect(engine.entityAt("ent_new")?.version).toBe(1);
  });

  test("an existing entityId updates with version + 1", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_up" }));
    engine.upsertEntity(makeEntity({ entityId: "ent_up", lastEventTimeMs: 2_000 }));
    const second = engine.upsertEntity(makeEntity({ entityId: "ent_up", lastEventTimeMs: 3_000 }));
    expect(second.version).toBe(3);
  });

  test("updates replace state wholesale", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_state", state: { teamRole: known("home") } }));
    engine.upsertEntity(
      makeEntity({
        entityId: "ent_state",
        lastEventTimeMs: 2_000,
        state: { jerseyNumber: known(7) },
      }),
    );
    const stored = engine.entityAt("ent_state");
    expect(stored?.state).toEqual({ jerseyNumber: { status: "known", value: 7 } });
  });

  test("changing kind is rejected (identity stability)", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_kind" }));
    let caught: unknown;
    try {
      engine.upsertEntity(makeEntity({ entityId: "ent_kind", kind: "ball" }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EntityKindChangeError);
    const kindError = caught as EntityKindChangeError;
    expect(kindError.entityId).toBe("ent_kind");
    expect(kindError.previousKind).toBe("participant");
    expect(kindError.attemptedKind).toBe("ball");
    // the entity keeps its original kind and version
    expect(engine.entityAt("ent_kind")?.kind).toBe("participant");
    expect(engine.entityAt("ent_kind")?.version).toBe(1);
  });

  test("lastEventTimeMs stays monotonic when an update regresses", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_t", lastEventTimeMs: 2_000 }));
    const updated = engine.upsertEntity(makeEntity({ entityId: "ent_t", lastEventTimeMs: 1_000 }));
    expect(updated.lastEventTimeMs).toBe(2_000);
    expect(updated.version).toBe(2);
  });

  test("lastEventTimeMs moves forward with later updates", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_f", lastEventTimeMs: 1_000 }));
    const updated = engine.upsertEntity(makeEntity({ entityId: "ent_f", lastEventTimeMs: 4_000 }));
    expect(updated.lastEventTimeMs).toBe(4_000);
  });

  test("invalid entities are rejected by the contract schema", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    expect(() =>
      engine.upsertEntity(makeEntity({ kind: "manager" as unknown as WorldEntity["kind"] })),
    ).toThrow(InvalidEntityError);
    expect(() => engine.upsertEntity(makeEntity({ version: 0 }))).toThrow(InvalidEntityError);
    expect(() => engine.upsertEntity(makeEntity({ entityId: "bad id!" }))).toThrow(
      InvalidEntityError,
    );
    expect(() => engine.upsertEntity(makeEntity({ state: { role: { status: "known" } } }))).toThrow(
      InvalidEntityError,
    );
    expect(engine.entityIds).toEqual([]);
  });

  test("the returned entity is a frozen clone", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    const stored = engine.upsertEntity(makeEntity({ entityId: "ent_c" }));
    expect(Object.isFrozen(stored)).toBe(true);
    expect(() => {
      stored.version = 5;
    }).toThrow(TypeError);
    expect(engine.entityAt("ent_c")?.version).toBe(1);
  });

  test("mutating the caller's input after upsert does not affect the engine", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    const input = makeEntity({ entityId: "ent_iso" });
    engine.upsertEntity(input);
    input.version = 42;
    input.state["teamRole"] = { status: "unknown" };
    const stored = engine.entityAt("ent_iso");
    expect(stored?.version).toBe(1);
    expect(stored?.state["teamRole"]).toEqual({ status: "known", value: "home" });
  });

  test("every upsert bumps the snapshot version", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    expect(engine.snapshotVersion).toBe(1);
    engine.upsertEntity(makeEntity({ entityId: "ent_v" }));
    expect(engine.snapshotVersion).toBe(2);
    engine.upsertEntity(makeEntity({ entityId: "ent_v" }));
    expect(auditTrail(engine).snapshotVersion).toBe(3);
  });
});

describe("entityAt", () => {
  test("returns the entity and undefined for unknown ids", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_at" }));
    expect(engine.entityAt("ent_at")?.entityId).toBe("ent_at");
    expect(engine.entityAt("ent_missing")).toBeUndefined();
  });

  test("at-T queries exclude entities updated after atMs", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_at", lastEventTimeMs: 2_000 }));
    expect(engine.entityAt("ent_at", 1_999)).toBeUndefined();
    expect(engine.entityAt("ent_at", 2_000)).toBeDefined();
    expect(engine.entityAt("ent_at")).toBeDefined();
  });

  test("the returned entity is frozen and isolated from the engine", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_fr" }));
    const entity = engine.entityAt("ent_fr");
    expect(entity).toBeDefined();
    if (entity === undefined) throw new Error("entity expected");
    expect(Object.isFrozen(entity)).toBe(true);
    expect(() => {
      entity.lastEventTimeMs = 99_999;
    }).toThrow(TypeError);
    expect(engine.entityAt("ent_fr")?.lastEventTimeMs).toBe(1_000);
  });
});

describe("entityIds accessor", () => {
  test("lists ids in insertion order as a fresh array", () => {
    const engine = WorldModelEngine.create(SESSION_ID);
    engine.upsertEntity(makeEntity({ entityId: "ent_a" }));
    engine.upsertEntity(makeEntity({ entityId: "ent_b" }));
    expect(engine.entityIds).toEqual(["ent_a", "ent_b"]);
    const ids = engine.entityIds;
    ids.push("ent_fake");
    expect(engine.entityIds).toEqual(["ent_a", "ent_b"]);
  });
});
