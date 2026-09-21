/**
 * THE L003 UPDATER BATTERY — determinism, idempotence, rewind protection,
 * honesty (confidence/provenance/uncertainty/extrapolation), possession, the
 * D5 report, and the D7 fail-closed admission rules — hand-built precision
 * batches (exact control over every field).
 */
import { describe, expect, test } from "bun:test";
import {
  PITCH_AXES,
  PITCH_LENGTH_AXIS_METERS,
  PITCH_ORIGIN,
  PITCH_WIDTH_AXIS_METERS,
} from "@sporta/contracts";
import type { FootballState } from "@sporta/world-model";
import { WorldModelEngine } from "@sporta/world-model";
import { InMemoryObservationStore } from "@sporta/observation";
import { createDeterministicLiveSource, drainSource } from "@sporta/live-source";
import { jsonDeepEqual } from "@sporta/fusion";
import {
  canonicalReportJson,
  createLiveSwmUpdater,
  LiveSwmUpdater,
  type LiveUpdateReport,
} from "../src/index";
import type { LiveEntityObservation, LiveObservation } from "@sporta/live-source";

const SESSION_ID = "s-live-updater";

/** The minimal valid football state (the fusion test convention, mirrored). */
function makeFootballState(): FootballState {
  return {
    pitch: {
      lengthAxisMeters: PITCH_LENGTH_AXIS_METERS,
      widthAxisMeters: PITCH_WIDTH_AXIS_METERS,
      origin: PITCH_ORIGIN,
      axes: PITCH_AXES,
    },
    clock: { period: "first-half", clockMs: 0, stoppage: false },
    score: { home: 0, away: 0, status: { status: "unknown" } },
    possession: { status: "unknown" },
    eventTaxonomyVersion: "1",
  };
}

/** One entity row for hand-built batches. */
function row(input: {
  entityRef: string;
  kind?: LiveEntityObservation["kind"];
  x: number;
  y: number;
  observedAtMs: number;
  detected?: boolean;
  confidence?: number;
  velocity?: boolean;
}): LiveEntityObservation {
  return {
    entityRef: input.entityRef,
    kind: input.kind ?? "PLAYER",
    position: { xMeters: input.x, yMeters: input.y },
    ...(input.velocity ? { velocity: { vxMps: 1.5, vyMps: -0.5 } } : {}),
    detected: input.detected ?? true,
    confidence: input.confidence ?? 0.9,
    observedAtMs: input.observedAtMs,
  };
}

/** One hand-built batch. */
function batch(input: {
  sequence: number;
  eventTimeMs?: number;
  rows: readonly LiveEntityObservation[];
  sourceId?: string;
  watermark?: { watermarkMs: number; sequence: number };
  recovery?: LiveObservation["recovery"];
}): LiveObservation {
  const eventTimeMs = input.eventTimeMs ?? input.sequence * 100;
  return {
    schemaVersion: "sporta.live-observation/1",
    sessionId: SESSION_ID,
    sourceId: input.sourceId ?? "synthetic-tracking-1",
    sourceType: "TRACKING",
    sequence: input.sequence,
    eventTimeMs,
    ingestTimeMs: eventTimeMs + 120,
    watermark: input.watermark ?? { watermarkMs: eventTimeMs, sequence: input.sequence },
    entityObservations: [...input.rows],
    confidence: 0.9,
    provenance: "DERIVED",
    quality: "nominal",
    ...(input.recovery !== undefined ? { recovery: input.recovery } : {}),
  };
}

/** One baseline batch (the D5/D6/determinism tests' shared shape). */
const base = () =>
  batch({ sequence: 5, rows: [row({ entityRef: "p-1", x: 10, y: 20, observedAtMs: 500 })] });

/** A fresh updater + engine + store (football state by default). */
function makeUpdater(options?: { football?: boolean; store?: boolean }) {
  const engine = WorldModelEngine.create(SESSION_ID, {
    ...(options?.football === false ? {} : { football: makeFootballState() }),
    now: () => 0, // deterministic snapshots
  });
  const store = options?.store === false ? undefined : new InMemoryObservationStore();
  const updater = createLiveSwmUpdater({
    sessionId: SESSION_ID,
    engine,
    ...(store !== undefined ? { store } : {}),
  });
  return { engine, store, updater };
}

describe("D1 — one canonical engine, no second world model", () => {
  test("the updater drives the INJECTED engine and owns no world state", () => {
    const { engine, updater } = makeUpdater();
    expect(updater.worldEngine).toBe(engine); // the same instance, driven not owned
    expect(updater.sessionId).toBe(SESSION_ID);
    updater.apply(
      batch({ sequence: 1, rows: [row({ entityRef: "p-1", x: 10, y: 20, observedAtMs: 100 })] }),
    );
    // The state lives in the ENGINE (the canonical SWM), versioned there.
    expect(engine.entityIds).toEqual(["p-1"]);
    expect(engine.snapshotVersion).toBeGreaterThan(1);
  });

  test("a session-mismatched engine is refused at construction (fail-loud)", () => {
    const engine = WorldModelEngine.create("s-other", { now: () => 0 });
    expect(() => createLiveSwmUpdater({ sessionId: SESSION_ID, engine })).toThrow(
      /does not match updater session/,
    );
  });
});

describe("D2/D3 — application, honesty, and versioning", () => {
  test("rows apply in (observedAtMs, entityRef) order with verbatim confidence + uncertain positions", () => {
    const { engine, updater } = makeUpdater();
    const report = updater.apply(
      batch({
        sequence: 1,
        rows: [
          row({ entityRef: "p-b", x: 30, y: 40, observedAtMs: 200, confidence: 0.42 }),
          row({ entityRef: "p-a", x: 10, y: 20, observedAtMs: 200, confidence: 0.87 }),
          row({ entityRef: "p-c", x: 50, y: 60, observedAtMs: 100, confidence: 0.5 }),
        ],
      }),
    );
    expect(report.outcome).toBe("applied");
    expect(report.entitiesUpserted).toBe(3);
    // Engine insertion order = the canonical (observedAtMs, entityRef) order.
    expect(engine.entityIds).toEqual(["p-c", "p-a", "p-b"]);
    const entity = engine.entityAt("p-a")!;
    expect(entity.kind).toBe("participant");
    expect(entity.version).toBe(1);
    expect(entity.state.position!).toEqual({
      status: "uncertain",
      value: { x: 10, y: 20 },
      confidence: 0.87, // verbatim, never floored, never averaged
    });
    expect(entity.state.spatialFrame).toEqual({ status: "known", value: "pitch" });
    expect(entity.state.lastSeenMs).toEqual({ status: "known", value: 200 });
  });

  test("version strictly advances on real changes; a no-op re-application does not bump", () => {
    const { engine, updater } = makeUpdater();
    updater.apply(
      batch({ sequence: 1, rows: [row({ entityRef: "p-1", x: 10, y: 20, observedAtMs: 100 })] }),
    );
    const afterFirst = engine.snapshotVersion;
    // Identical content, NEW sequence: an idempotent no-op (no version bump).
    const noOp = updater.apply(
      batch({ sequence: 2, rows: [row({ entityRef: "p-1", x: 10, y: 20, observedAtMs: 100 })] }),
    );
    expect(noOp.entitiesSkippedNoOp).toBe(1);
    expect(noOp.entitiesUpserted).toBe(0);
    expect(engine.snapshotVersion).toBe(afterFirst);
    // A real change at a later time: applied, version bumps, entity version 2.
    const changed = updater.apply(
      batch({ sequence: 3, rows: [row({ entityRef: "p-1", x: 12, y: 22, observedAtMs: 300 })] }),
    );
    expect(changed.entitiesUpserted).toBe(1);
    expect(engine.snapshotVersion).toBeGreaterThan(afterFirst);
    expect(engine.entityAt("p-1")!.version).toBe(2);
    expect(changed.snapshotVersionAfter).toBe(engine.snapshotVersion);
  });

  test("velocity and zMeters are never projected (the batch seam's own drops, mirrored)", () => {
    const { engine, updater } = makeUpdater();
    updater.apply(
      batch({
        sequence: 1,
        rows: [row({ entityRef: "p-1", x: 10, y: 20, observedAtMs: 100, velocity: true })],
      }),
    );
    const state = engine.entityAt("p-1")!.state;
    expect(Object.keys(state).sort()).toEqual(["lastSeenMs", "position", "spatialFrame"]);
    expect(state.position!.value).toEqual({ x: 10, y: 20 });
  });
});

describe("D2.3 — the per-entity replay frontier (rewind protection)", () => {
  test("a BEYOND-WINDOW late update drops with the explicit counter — never a position rewind", () => {
    const { engine, updater } = makeUpdater();
    updater.apply(
      batch({ sequence: 1, rows: [row({ entityRef: "p-1", x: 50, y: 60, observedAtMs: 2000 })] }),
    );
    const report = updater.apply(
      batch({
        sequence: 2,
        eventTimeMs: 2100,
        rows: [row({ entityRef: "p-1", x: 10, y: 20, observedAtMs: 1000 })], // 1000 ms late > 250 window
      }),
    );
    expect(report.lateUpdateDropped).toBe(1);
    expect(report.entitiesUpserted).toBe(0);
    expect(engine.entityAt("p-1")!.state.position!.value).toEqual({ x: 50, y: 60 }); // NOT rewound
  });

  test("a WITHIN-WINDOW late that would rewind is an idempotent skip (counted, never rewound)", () => {
    const { engine, updater } = makeUpdater();
    updater.apply(
      batch({ sequence: 1, rows: [row({ entityRef: "p-1", x: 50, y: 60, observedAtMs: 2000 })] }),
    );
    const report = updater.apply(
      batch({
        sequence: 2,
        eventTimeMs: 2100,
        rows: [row({ entityRef: "p-1", x: 11, y: 21, observedAtMs: 1900 })], // 100 ms late < 250 window
      }),
    );
    // The design's own authority (fusion pass 2: idempotent upserts, no
    // rewinds): the no-op guard skips it — the position never moves back.
    expect(report.entitiesSkippedNoOp).toBe(1);
    expect(report.lateUpdateDropped).toBe(0);
    expect(report.lateUpdatesInWindow).toBe(0);
    expect(engine.entityAt("p-1")!.state.position!.value).toEqual({ x: 50, y: 60 });
  });

  test("a SAME-TIME correction applies (a versioned correction, not a rewind)", () => {
    const { engine, updater } = makeUpdater();
    updater.apply(
      batch({ sequence: 1, rows: [row({ entityRef: "p-1", x: 50, y: 60, observedAtMs: 2000 })] }),
    );
    const report = updater.apply(
      batch({
        sequence: 2,
        eventTimeMs: 2100,
        rows: [row({ entityRef: "p-1", x: 51, y: 61, observedAtMs: 2000 })], // same time, new state
      }),
    );
    expect(report.entitiesUpserted).toBe(1);
    expect(engine.entityAt("p-1")!.state.position!.value).toEqual({ x: 51, y: 61 });
    expect(engine.entityAt("p-1")!.version).toBe(2);
  });
});

describe("D3 — extrapolation marking (detected: false)", () => {
  test("a carried row applies the source's own carry with reduced confidence, NO velocity, counted", () => {
    const { engine, updater } = makeUpdater();
    const report = updater.apply(
      batch({
        sequence: 1,
        rows: [
          row({ entityRef: "p-1", x: 10, y: 20, observedAtMs: 100 }),
          row({
            entityRef: "p-2",
            x: 30,
            y: 40,
            observedAtMs: 100,
            detected: false, // the honest carry
            confidence: 0.2,
            velocity: true, // a misbehaving carry's velocity — must NOT be projected anyway
          }),
        ],
      }),
    );
    expect(report.extrapolatedObservations).toBe(1);
    const carried = engine.entityAt("p-2")!;
    expect(carried.state.position!).toEqual({
      status: "uncertain",
      value: { x: 30, y: 40 }, // the source's own last-known carry, applied verbatim
      confidence: 0.2,
    });
    expect(Object.keys(carried.state).includes("velocity")).toBe(false); // never invented
    expect(updater.stats().extrapolatedObservations).toBe(1); // the session aggregate
  });
});

describe("D2 — non-projectable kinds (no kind invented)", () => {
  test("REFEREE and OTHER rows are counted + warned, never projected", () => {
    const { engine, updater } = makeUpdater();
    const report = updater.apply(
      batch({
        sequence: 1,
        rows: [
          row({ entityRef: "p-1", x: 10, y: 20, observedAtMs: 100 }),
          row({ entityRef: "ref-1", kind: "REFEREE", x: 52, y: 34, observedAtMs: 100 }),
          row({ entityRef: "x-1", kind: "OTHER", x: 52, y: 34, observedAtMs: 100 }),
        ],
      }),
    );
    expect(report.nonProjectableRows).toBe(2);
    expect(report.entitiesUpserted).toBe(1);
    expect(report.warnings.join(" ")).toContain("no entity kind invented");
    expect(engine.entityIds).toEqual(["p-1"]);
  });
});

describe("D4 — the incremental possession recompute", () => {
  test("a ball-bearing batch sets the nearest participant with the batch formula", () => {
    const { engine, updater } = makeUpdater();
    updater.apply(
      batch({
        sequence: 1,
        rows: [
          row({ entityRef: "p-near", x: 52, y: 35, observedAtMs: 100, confidence: 0.9 }),
          row({ entityRef: "p-far", x: 20, y: 10, observedAtMs: 100, confidence: 0.9 }),
        ],
      }),
    );
    const report = updater.apply(
      batch({
        sequence: 2,
        eventTimeMs: 200,
        rows: [
          row({
            entityRef: "ball-1",
            kind: "BALL",
            x: 52.5,
            y: 35.5,
            observedAtMs: 200,
            confidence: 0.8,
          }),
        ],
      }),
    );
    expect(report.possessionUpdates).toBe(1);
    const possession = engine.snapshot().football!.possession;
    // ballConfidence(0.8) * trackConfidence(0.9) * (1 - distance/2):
    const distance = Math.sqrt(0.5 ** 2 + 0.5 ** 2);
    expect(possession).toEqual({
      status: "uncertain",
      value: { entityId: "p-near" },
      confidence: 0.8 * 0.9 * (1 - distance / 2),
    });
  });

  test("an equidistant tie is an explicit conflict AND clears the previous candidate — no silent winner", () => {
    const { engine, updater } = makeUpdater();
    // First: an unambiguous winner exists (p-left nearer).
    updater.apply(
      batch({
        sequence: 1,
        rows: [
          row({ entityRef: "p-left", x: 51, y: 34, observedAtMs: 100 }),
          row({ entityRef: "p-right", x: 54, y: 34, observedAtMs: 100 }),
          row({ entityRef: "ball-1", kind: "BALL", x: 52, y: 34, observedAtMs: 100 }), // nearer p-left
        ],
      }),
    );
    expect(engine.snapshot().football!.possession.value).toEqual({ entityId: "p-left" });
    // Then: the ball moves to exactly between them → a tie: the conflict is
    // explicit, the slot returns to unknown (memoryless — never a stale or
    // silent winner).
    const report = updater.apply(
      batch({
        sequence: 2,
        eventTimeMs: 200,
        rows: [row({ entityRef: "ball-1", kind: "BALL", x: 52.5, y: 34, observedAtMs: 200 })], // exactly equidistant
      }),
    );
    expect(report.possessionUpdates).toBe(0);
    expect(report.possessionCleared).toBe(1);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]!.slotKey).toBe("possession");
    expect(report.conflicts[0]!.resolution).toBe("none");
    expect([...report.conflicts[0]!.values.map((entry) => entry.value)].sort()).toEqual([
      "p-left",
      "p-right",
    ]);
    expect(engine.snapshot().football!.possession).toEqual({ status: "unknown" }); // no winner
  });

  test("no participant within the radius clears an existing candidate (memoryless — never a stale possessor)", () => {
    const { engine, updater } = makeUpdater();
    // First: a ball near a participant → the slot sets.
    const near = updater.apply(
      batch({
        sequence: 1,
        rows: [
          row({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 100 }),
          row({ entityRef: "ball-1", kind: "BALL", x: 10.5, y: 10.5, observedAtMs: 100 }),
        ],
      }),
    );
    expect(near.possessionUpdates).toBe(1);
    expect(engine.snapshot().football!.possession.value).toEqual({ entityId: "p-1" });
    // Then: the ball moves far away → the honest slot returns to unknown
    // (holding p-1 would be fabricated certainty).
    const far = updater.apply(
      batch({
        sequence: 2,
        eventTimeMs: 200,
        rows: [row({ entityRef: "ball-1", kind: "BALL", x: 90, y: 60, observedAtMs: 200 })],
      }),
    );
    expect(far.possessionUpdates).toBe(0);
    expect(far.possessionCleared).toBe(1);
    expect(engine.snapshot().football!.possession).toEqual({ status: "unknown" });
    // A ball-less batch never touches the slot.
    const ballless = updater.apply(
      batch({
        sequence: 3,
        eventTimeMs: 300,
        rows: [row({ entityRef: "p-1", x: 10.2, y: 10.2, observedAtMs: 300 })],
      }),
    );
    expect(ballless.possessionUpdates).toBe(0);
    expect(ballless.possessionCleared).toBe(0);
  });

  test("no football state: possession skipped with an honest warning (never fabricated)", () => {
    const { updater } = makeUpdater({ football: false });
    const report = updater.apply(
      batch({
        sequence: 1,
        rows: [
          row({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 100 }),
          row({ entityRef: "ball-1", kind: "BALL", x: 10.5, y: 10.5, observedAtMs: 100 }),
        ],
      }),
    );
    expect(report.possessionUpdates).toBe(0);
    expect(report.warnings.join(" ")).toContain("no football state");
  });
});

describe("D5 — the report + the watermarkAfter min rule", () => {
  test("watermarkAfter = the batch's own watermark when no engine watermark is given", () => {
    const { updater } = makeUpdater();
    const report = updater.apply(base());
    expect(report.watermarkAfter).toEqual({ watermarkMs: 500, sequence: 5 });
    expect(report.appliedSequence).toBe(5);
    expect(report.sourceId).toBe("synthetic-tracking-1");
  });

  test("the smaller of (source, L004 engine) watermarks wins (ties → the engine's)", () => {
    const { updater } = makeUpdater();
    // Engine watermark SMALLER: the min picks the engine's.
    const smaller = updater.apply(base(), { engineWatermark: { watermarkMs: 300, sequence: 3 } });
    expect(smaller.watermarkAfter).toEqual({ watermarkMs: 300, sequence: 3 });
    // Engine watermark LARGER: the min picks the batch's own source watermark.
    const larger = updater.apply(
      batch({ sequence: 6, rows: [row({ entityRef: "p-1", x: 11, y: 21, observedAtMs: 600 })] }),
      { engineWatermark: { watermarkMs: 900, sequence: 9 } },
    );
    expect(larger.watermarkAfter).toEqual({ watermarkMs: 600, sequence: 6 });
    // Equal: the engine's (the conservative pick, documented).
    const tie = updater.apply(
      batch({
        sequence: 7,
        rows: [row({ entityRef: "p-1", x: 12, y: 22, observedAtMs: 700 })],
        watermark: { watermarkMs: 650, sequence: 7 },
      }),
      { engineWatermark: { watermarkMs: 650, sequence: 4 } },
    );
    expect(tie.watermarkAfter).toEqual({ watermarkMs: 650, sequence: 4 });
  });
});

describe("D7 — fail-closed admission", () => {
  test("an invalid batch is refused with the typed error and counted (never partially applied)", () => {
    const { engine, updater } = makeUpdater();
    const invalid = { ...base(), entityObservations: [] }; // min(1) violated
    expect(() => updater.apply(invalid as never)).toThrow();
    expect(updater.stats().invalidBatches).toBe(1);
    expect(engine.entityIds).toHaveLength(0);
  });

  test("a wrong-session batch is refused and counted (never partially applied)", () => {
    const { updater } = makeUpdater();
    const wrong = { ...base(), sessionId: "s-other" };
    expect(() => updater.apply(wrong)).toThrow(/wrongSession/);
    expect(updater.stats().wrongSession).toBe(1);
  });

  test("a duplicate/replayed sequence is an idempotent no-op report (counted, not applied)", () => {
    const { engine, updater } = makeUpdater();
    updater.apply(base());
    const before = engine.snapshotVersion;
    const duplicate = updater.apply(base()); // same sequence 5
    expect(duplicate.outcome).toBe("duplicate");
    expect(duplicate.entitiesUpserted).toBe(0);
    expect(engine.snapshotVersion).toBe(before);
    expect(updater.stats().duplicateSequence).toBe(1);
    // An out-of-order sequence BELOW the frontier is also a duplicate.
    const replayed = updater.apply(
      batch({ sequence: 4, rows: [row({ entityRef: "p-9", x: 1, y: 1, observedAtMs: 400 })] }),
    );
    expect(replayed.outcome).toBe("duplicate");
    expect(engine.entityIds).not.toContain("p-9");
  });

  test("engine errors propagate typed (the updater never catches-and-guesses)", () => {
    const { updater } = makeUpdater();
    updater.apply(
      batch({ sequence: 1, rows: [row({ entityRef: "e-1", x: 1, y: 1, observedAtMs: 100 })] }),
    );
    // The same entityRef as a BALL: a kind change — the ENGINE's typed error.
    expect(() =>
      updater.apply(
        batch({
          sequence: 2,
          rows: [row({ entityRef: "e-1", kind: "BALL", x: 2, y: 2, observedAtMs: 200 })],
        }),
      ),
    ).toThrow();
  });
});

describe("D6 — the W005 continuity bridge", () => {
  test("every projectable row bridges with verbatim confidence + the batch's provenance", () => {
    const { store, updater } = makeUpdater();
    updater.apply(
      batch({
        sequence: 1,
        rows: [
          row({ entityRef: "p-1", x: 10, y: 20, observedAtMs: 100, confidence: 0.42 }),
          row({ entityRef: "ref-1", kind: "REFEREE", x: 52, y: 34, observedAtMs: 100 }),
          row({ entityRef: "x-1", kind: "OTHER", x: 52, y: 34, observedAtMs: 100 }),
        ],
      }),
    );
    // PLAYER + REFEREE bridge (official is an honest EntityKind); OTHER does not.
    expect(store!.count()).toBe(2);
    const player = store!.byId("lo-synthetic-tracking-1-000000000001-p-1")!;
    expect(player.eventTimeMs).toBe(100);
    expect(player.ingestTimeMs).toBe(220); // the batch's dual clock
    expect(player.provenance).toBe("DERIVED"); // retained verbatim
    expect(player.confidence).toBe(0.42); // retained verbatim
    expect(player.payload).toEqual({
      kind: "track",
      entityId: "p-1",
      position: { x: 10, y: 20 },
    });
    expect(store!.byId("lo-synthetic-tracking-1-000000000001-ref-1")!.subjectEntityRefs).toEqual([
      { entityId: "ref-1", kind: "official" },
    ]);
    expect(store!.byId("lo-synthetic-tracking-1-000000000001-x-1")).toBeUndefined();
  });

  test("without a store the updater still applies (bridging is optional)", () => {
    const { engine, updater } = makeUpdater({ store: false });
    const report = updater.apply(base());
    expect(report.outcome).toBe("applied");
    expect(engine.entityIds).toEqual(["p-1"]);
  });
});

describe("determinism — the same batches replay byte-identical reports", () => {
  test("a seeded source's reports are byte-identical across runs (canonical JSON)", () => {
    const drive = (): string[] => {
      const source = createDeterministicLiveSource({
        sessionId: SESSION_ID,
        seed: 777,
        scenario: "drop",
        tickCount: 60,
        playersPerTeam: 4,
      });
      const { updater } = makeUpdater();
      const reports: string[] = [];
      for (const observation of drainSource(source)) {
        reports.push(canonicalReportJson(updater.apply(observation)));
      }
      return reports;
    };
    const first = drive();
    const second = drive();
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(40); // a real stream, not a stub
  });

  test("the report type is exported and JSON-safe (no functions, no clock values)", () => {
    const { updater } = makeUpdater();
    const report: LiveUpdateReport = updater.apply(base());
    const serialized = JSON.parse(JSON.stringify(report));
    expect(serialized.appliedSequence).toBe(5);
    expect(typeof serialized.snapshotVersionAfter).toBe("number");
  });
});

describe("the exported class surface (typed consumers)", () => {
  test("LiveSwmUpdater is constructible directly", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { now: () => 0 });
    const updater = new LiveSwmUpdater({ sessionId: SESSION_ID, engine });
    expect(updater).toBeInstanceOf(LiveSwmUpdater);
    expect(updater.stats().invalidBatches).toBe(0);
    expect(jsonDeepEqual(updater.stats(), { ...updater.stats() })).toBe(true);
  });
});
