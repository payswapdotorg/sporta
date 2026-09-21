/**
 * THE L012 FUSION ENGINE BATTERY — the deterministic arbitration, fallback
 * and source-loss acceptance over the FULL composition
 * `LiveFusionEngine → TemporalBufferEngine (L004) → LiveSwmUpdater (L003) →
 * WorldModelEngine`:
 *
 * - D1 coexistence: sources with no co-observation pass VERBATIM (Wave 2
 *   behavior preserved — batch identity, provenance, engine state);
 * - D2/D3/D4/D5 conflicts + arbitration: beyond-tolerance disagreement mints
 *   the batch-shaped ConflictRecord; same-time ties are decided by the
 *   CANONICAL REPLAY ORDER (the (sourceId, sequence) total order — the row
 *   the W005 store's batch replay applies LAST), losers WITHHELD (counted,
 *   ledger-recorded, never bridged), the survivor applied VERBATIM (never
 *   averaged); the operator's precedence preference is REPORTED on every
 *   decision (never overriding the survivor); the decision is EXPLICIT;
 * - D5 event-time authority: different-time conflicting rows both apply
 *   (sequential updates — the later row is the engine state);
 * - D5 cross-drain ties: a later-arriving same-time row can never become a
 *   silent winner by arrival order (the canonical-max of arrived tied rows
 *   is arrival-order-free; a late non-max is withheld);
 * - D6 source loss + fallback: the L004 STALLED latch consumed VERBATIM
 *   (source-lost/source-recovered events, fallbackActive, the surviving
 *   source carries the world);
 * - D8 replay equality: the arbitrated stream IS the stored stream (a batch
 *   runWorldFusion replay reproduces the live final state);
 * - D9 suppressed batches: a batch whose rows were ALL withheld never
 *   produces an invalid document;
 * - determinism: the same inputs → identical canonical reports.
 *
 * DRIVING MODEL (the L004 release semantics, honestly): a batch releases
 * from the reorder buffer only when its source's watermark window has
 * passed it — a LATER arrival from the SAME source (or the stall/finalize
 * flush). The tests therefore drive each source as a real stream: the
 * batch under test + a trailing batch that releases it (the continuity
 * battery's pattern), with the render clock advancing alongside. For the
 * ONE-DRAIN arbitration cases the finalize flush is used (it releases the
 * whole remaining buffer in one drain).
 */
import { describe, expect, test } from "bun:test";
import type { LiveObservation } from "@sporta/live-source";
import { batchConfidenceOf } from "@sporta/live-source";
import {
  PITCH_AXES,
  PITCH_LENGTH_AXIS_METERS,
  PITCH_ORIGIN,
  PITCH_WIDTH_AXIS_METERS,
} from "@sporta/contracts";
import { WorldModelEngine } from "@sporta/world-model";
import type { FootballState } from "@sporta/world-model";
import { InMemoryObservationStore } from "@sporta/observation";
import type { ObservationStore } from "@sporta/observation";
import { runWorldFusion } from "@sporta/fusion";
import { createTemporalBufferEngine } from "@sporta/live-temporal";
import { createLiveSwmUpdater } from "@sporta/live-swm";
import {
  canonicalFusionReportJson,
  createLiveFusionEngine,
  LiveFusionEngineValidationError,
  type LiveFusionEngine,
  type FusionReport,
} from "../src/index";

const SESSION_ID = "s-fusion-engine";

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

/** One hand-built entity row (the minimal honest shape). */
function rowOf(input: {
  entityRef: string;
  x: number;
  y: number;
  observedAtMs: number;
  confidence?: number;
  kind?: "PLAYER" | "BALL";
  detected?: boolean;
}) {
  return {
    entityRef: input.entityRef,
    kind: input.kind ?? "PLAYER",
    position: { xMeters: input.x, yMeters: input.y },
    detected: input.detected ?? true,
    confidence: input.confidence ?? 0.9,
    observedAtMs: input.observedAtMs,
  };
}

/**
 * One hand-built LiveObservation batch (the frozen shape, minimal). The
 * emission watermark is the batch's own event time — the conservative
 * self-guarantee (the L007 replay convention); the REORDER WINDOW (L004)
 * holds the batch until the source's stream advances past it.
 */
function batchOf(input: {
  sourceId: string;
  sequence: number;
  eventTimeMs: number;
  rows: ReturnType<typeof rowOf>[];
}): LiveObservation {
  return {
    schemaVersion: "sporta.live-observation/1",
    sessionId: SESSION_ID,
    sourceId: input.sourceId,
    sourceType: "TRACKING",
    sequence: input.sequence,
    eventTimeMs: input.eventTimeMs,
    ingestTimeMs: input.eventTimeMs + 40,
    watermark: { watermarkMs: input.eventTimeMs, sequence: input.sequence },
    entityObservations: input.rows,
    confidence: batchConfidenceOf(input.rows),
    provenance: "DERIVED",
    quality: "nominal",
  };
}

/** The full composed fusion session under test. */
interface FusionSession {
  engine: WorldModelEngine;
  store: ObservationStore;
  fusion: LiveFusionEngine;
  reports: FusionReport[];
}

function createSession(
  policy?: Parameters<typeof createLiveFusionEngine>[0]["policy"],
): FusionSession {
  const engine = WorldModelEngine.create(SESSION_ID, {
    football: makeFootballState(),
    now: () => 0,
  });
  const store = new InMemoryObservationStore();
  const updater = createLiveSwmUpdater({ sessionId: SESSION_ID, engine, store });
  const temporal = createTemporalBufferEngine({ sessionId: SESSION_ID });
  const fusion = createLiveFusionEngine({
    sessionId: SESSION_ID,
    temporal,
    updater,
    ...(policy !== undefined ? { policy } : {}),
  });
  return { engine, store, fusion, reports: [] };
}

/** Admits one batch and records the report. */
function admit(session: FusionSession, document: LiveObservation): FusionReport {
  const report = session.fusion.admit(document);
  session.reports.push(report);
  return report;
}

/** Ticks the render clock and records the report. */
function tick(session: FusionSession, clockMs: number): FusionReport {
  const report = session.fusion.tick(clockMs);
  session.reports.push(report);
  return report;
}

/** The engine's current position slot for one entity (assertion helper). */
function positionOf(
  engine: WorldModelEngine,
  entityId: string,
): { x: number; y: number; c: number } | undefined {
  const entity = engine.entityAt(entityId);
  if (entity === undefined) return undefined;
  const slot = entity.state.position;
  if (slot === undefined || slot.status !== "uncertain") return undefined;
  return {
    x: (slot.value as { x: number }).x,
    y: (slot.value as { y: number }).y,
    c: slot.confidence ?? -1,
  };
}

// ---------------------------------------------------------------------------

describe("the fusion engine composition (D1 — fail-loud seams)", () => {
  test("refuses a session-mismatched temporal engine or updater (fail-loud)", () => {
    const engine = WorldModelEngine.create(SESSION_ID, { now: () => 0 });
    const temporal = createTemporalBufferEngine({ sessionId: "other-session" });
    const updater = createLiveSwmUpdater({ sessionId: SESSION_ID, engine });
    expect(() => createLiveFusionEngine({ sessionId: SESSION_ID, temporal, updater })).toThrow(
      LiveFusionEngineValidationError,
    );
    const temporalOk = createTemporalBufferEngine({ sessionId: SESSION_ID });
    expect(() =>
      createLiveFusionEngine({
        sessionId: SESSION_ID,
        temporal: temporalOk,
        updater: createLiveSwmUpdater({
          sessionId: "other-session",
          engine: WorldModelEngine.create("other-session", { now: () => 0 }),
        }),
      }),
    ).toThrow(LiveFusionEngineValidationError);
  });

  test("refuses wrong-session admissions BEFORE delegating (never partially applied)", () => {
    const session = createSession();
    const wrongSession = {
      ...batchOf({
        sourceId: "a",
        sequence: 1,
        eventTimeMs: 0,
        rows: [rowOf({ entityRef: "p-1", x: 1, y: 1, observedAtMs: 0 })],
      }),
      sessionId: "s-other",
    };
    expect(() => session.fusion.admit(wrongSession as LiveObservation)).toThrow(
      LiveFusionEngineValidationError,
    );
    expect(session.fusion.stats().batchesApplied).toBe(0);
  });
});

describe("D1 — coexistence: non-co-observing sources pass VERBATIM", () => {
  test("two sources with disjoint entities: every batch applies, no conflicts, both sources' entities in the ONE engine", () => {
    const session = createSession();
    // The streams: the batch under test + a trailing batch that releases it.
    admit(session, batchOf({ sourceId: "tracking-a", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-home-01", x: 10, y: 10, observedAtMs: 0 })] }));
    admit(session, batchOf({ sourceId: "broadcast-1", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "track-3", x: 50, y: 30, observedAtMs: 0 })] }));
    admit(session, batchOf({ sourceId: "tracking-a", sequence: 2, eventTimeMs: 400, rows: [rowOf({ entityRef: "p-home-01", x: 11, y: 10, observedAtMs: 400 })] }));
    admit(session, batchOf({ sourceId: "broadcast-1", sequence: 2, eventTimeMs: 400, rows: [rowOf({ entityRef: "track-3", x: 51, y: 30, observedAtMs: 400 })] }));
    tick(session, 450);
    const finalized = session.fusion.finalize();
    // Every one of the four batches applied (two admissions + finalize flush).
    const appliedReports = [...session.reports, finalized].flatMap((report) => report.batchReports);
    expect(appliedReports.length).toBe(4);
    expect(appliedReports.every((report) => report.outcome === "applied")).toBe(true);
    expect(
      [...session.reports, finalized].every((report) => report.conflicts.length === 0),
    ).toBe(true);
    // The canonical application order: the t=400 rows are the engine state.
    expect(positionOf(session.engine, "p-home-01")).toEqual({ x: 11, y: 10, c: 0.9 });
    expect(positionOf(session.engine, "track-3")).toEqual({ x: 51, y: 30, c: 0.9 });
    // The bridge store carries BOTH sources' observations with per-source
    // component identity + provenance VERBATIM (D2).
    const bridged = session.store.all();
    expect(bridged.filter((obs) => obs.componentId === "tracking-a").length).toBe(2);
    expect(bridged.filter((obs) => obs.componentId === "broadcast-1").length).toBe(2);
    expect(bridged.every((obs) => obs.provenance === "DERIVED")).toBe(true);
    // Per-source summaries cover BOTH sources with their L004 counters.
    const summary = finalized.sourceSummary.map((s) => s.sourceId).sort();
    expect(summary).toEqual(["broadcast-1", "tracking-a"]);
  });

  test("corroboration: co-observed agreement within tolerance is counted, never a conflict record", () => {
    const session = createSession();
    admit(session, batchOf({ sourceId: "tracking-a", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 0 })] }));
    admit(session, batchOf({ sourceId: "broadcast-1", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 10.6, y: 10.2, observedAtMs: 0, confidence: 0.7 })] }));
    admit(session, batchOf({ sourceId: "tracking-a", sequence: 2, eventTimeMs: 400, rows: [rowOf({ entityRef: "p-1", x: 11, y: 10, observedAtMs: 400 })] }));
    // B(0) releases with A(0) already in the arbitration memory: an agreeing
    // co-observation — the drain row corroborates (counted, no record).
    const bRelease = admit(session, batchOf({ sourceId: "broadcast-1", sequence: 2, eventTimeMs: 400, rows: [rowOf({ entityRef: "p-1", x: 11.5, y: 10.2, observedAtMs: 400, confidence: 0.7 })] }));
    expect(bRelease.conflicts).toEqual([]);
    expect(bRelease.conflictRowsWithheld).toBe(0);
    expect(bRelease.corroborationRows).toBe(1);
    expect(bRelease.batchReports.length).toBe(1); // the agreeing row APPLIES
    session.fusion.finalize(); // the t=400 pair: also agreeing
    expect(session.fusion.stats().corroborationRows).toBe(3); // 1 + the 2-row t=400 group
    expect(session.fusion.stats().conflicts).toBe(0);
    expect(session.fusion.stats().conflictRowsWithheld).toBe(0);
    expect(bRelease.sourceSummary.find((s) => s.sourceId === "broadcast-1")!.rowsCorroborating).toBeGreaterThanOrEqual(1);
  });
});

describe("D3/D4/D5 — same-time conflicts: explicit ledger + deterministic arbitration (never a silent winner/average)", () => {
  test("within ONE drain (the finalize flush): the canonical survivor applies verbatim, the loser is withheld + ledger-recorded", () => {
    const session = createSession({ sourcePrecedence: ["broadcast-1", "tracking-a"] });
    admit(session, batchOf({ sourceId: "tracking-a", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 0, confidence: 0.9 })] }));
    admit(session, batchOf({ sourceId: "broadcast-1", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 16, y: 12, observedAtMs: 0, confidence: 0.55 })] }));
    const drain = session.fusion.finalize(); // BOTH t=0 rows flush in ONE drain
    // The conflict record: BOTH values with confidences, resolution "none".
    expect(drain.conflicts.length).toBe(1);
    const record = drain.conflicts[0]!;
    expect(record.slotKey).toBe("live-position:p-1");
    expect([...record.observationIds].sort()).toEqual([
      "lo-broadcast-1-000000000001-p-1",
      "lo-tracking-a-000000000001-p-1",
    ]);
    expect(record.values).toHaveLength(2);
    expect(record.resolution).toBe("none");
    // The arbitration decision: the CANONICAL survivor is tracking-a
    // ("lo-tracking-a-…" sorts after "lo-broadcast-1-…" — the replay order);
    // the operator's precedence preference (broadcast-1) is REPORTED and
    // HONESTLY flagged as not matching the survivor.
    expect(drain.arbitrationDecisions.length).toBe(1);
    const decision = drain.arbitrationDecisions[0]!;
    expect(decision.survivorSourceId).toBe("tracking-a");
    expect(decision.withheldSourceIds).toEqual(["broadcast-1"]);
    expect(decision.rule).toBe("canonical-source-order");
    expect(decision.precedencePreferredSourceId).toBe("broadcast-1");
    expect(decision.precedenceMatchesSurvivor).toBe(false);
    expect(decision.conflictId).toBe(record.conflictId);
    // Withheld accounting: broadcast-1's batch had ONLY that row → suppressed.
    expect(drain.conflictRowsWithheld).toBe(1);
    expect(drain.suppressedBatches).toBe(1);
    expect(drain.batchReports.length).toBe(1); // ONLY the survivor's batch reached the updater
    // The engine's position is the SURVIVOR's row VERBATIM (never averaged).
    expect(positionOf(session.engine, "p-1")).toEqual({ x: 10, y: 10, c: 0.9 });
    // The withheld row NEVER bridged (the store holds only the survivor's row).
    const bridged = session.store.all();
    expect(bridged.filter((obs) => obs.componentId === "tracking-a").length).toBe(1);
    expect(bridged.filter((obs) => obs.componentId === "broadcast-1").length).toBe(0);
  });

  test("the canonical source order decides every same-time tie (the documented deterministic rule)", () => {
    const session = createSession(); // no precedence configured
    admit(session, batchOf({ sourceId: "source-b", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 0 })] }));
    admit(session, batchOf({ sourceId: "source-a", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 20, y: 20, observedAtMs: 0 })] }));
    const drain = session.fusion.finalize();
    expect(drain.arbitrationDecisions[0]!.survivorSourceId).toBe("source-b"); // "b" > "a"
    expect(drain.arbitrationDecisions[0]!.rule).toBe("canonical-source-order");
    expect(drain.arbitrationDecisions[0]!.precedencePreferredSourceId).toBeNull(); // no preference configured
    expect(drain.arbitrationDecisions[0]!.precedenceMatchesSurvivor).toBe(false);
    expect(drain.conflictRowsWithheld).toBe(1);
    expect(positionOf(session.engine, "p-1")).toEqual({ x: 10, y: 10, c: 0.9 });
  });

  test("same-source same-time rows are the source's OWN sequential updates (no cross-source conflict; the newer emission is the canonical survivor in live AND replay)", () => {
    const session = createSession();
    admit(session, batchOf({ sourceId: "source-a", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 0 })] }));
    admit(session, batchOf({ sourceId: "source-a", sequence: 2, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 20, y: 20, observedAtMs: 0 })] }));
    const drain = session.fusion.finalize();
    // Same-source pairs never form a co-observation group (a source's own
    // corrections are its own sequential updates — never a cross-source conflict).
    expect(drain.arbitrationDecisions).toEqual([]);
    expect(drain.conflicts).toEqual([]);
    expect(drain.batchReports.length).toBe(2); // both apply (sequential)
    // The canonical batch order (sequence asc) applies the NEWER emission
    // last — exactly the row the store's replay ends on (the id scheme).
    expect(positionOf(session.engine, "p-1")).toEqual({ x: 20, y: 20, c: 0.9 });
  });

  test("event-time authority: a DIFFERENT-time conflicting row applies (the later row is newer evidence — no rewind)", () => {
    const session = createSession({ sourcePrecedence: ["tracking-a", "broadcast-1"] });
    admit(session, batchOf({ sourceId: "tracking-a", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 0 })] }));
    admit(session, batchOf({ sourceId: "broadcast-1", sequence: 1, eventTimeMs: 120, rows: [rowOf({ entityRef: "p-1", x: 30, y: 30, observedAtMs: 120 })] }));
    // The trailing batches release the pair (same positions as their sources' rows).
    const aDrain = admit(session, batchOf({ sourceId: "tracking-a", sequence: 2, eventTimeMs: 500, rows: [rowOf({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 500 })] }));
    const bDrain = admit(session, batchOf({ sourceId: "broadcast-1", sequence: 2, eventTimeMs: 600, rows: [rowOf({ entityRef: "p-1", x: 30, y: 30, observedAtMs: 600 })] }));
    // The t=0/t=120 conflict is recorded at B's release drain (beyond
    // tolerance: ~28.3m >> 1.0 + 1.2).
    expect(bDrain.conflicts.length).toBe(1);
    // But NO arbitration: different times are sequential updates — both apply.
    expect(bDrain.arbitrationDecisions).toEqual([]);
    expect(bDrain.conflictRowsWithheld).toBe(0);
    expect(aDrain.batchReports.length).toBe(1);
    expect(bDrain.batchReports.length).toBe(1);
    // The engine's position is the LATER row (event-time authority).
    expect(positionOf(session.engine, "p-1")).toEqual({ x: 30, y: 30, c: 0.9 });
  });

  test("cross-drain ties: a later-arriving same-time row never becomes a silent winner by arrival order", () => {
    // The arrival-order trap WITHOUT fusion: A(t) applies; B(t) applies after
    // → the engine holds B by ARRIVAL ORDER. WITH fusion: the canonical rule
    // decides — the late row is withheld unless it is the canonical-max.
    const session = createSession({ sourcePrecedence: ["tracking-a", "broadcast-1"] });
    // A drains FIRST (its own trailing batch releases it, alone).
    admit(session, batchOf({ sourceId: "tracking-a", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 0 })] }));
    admit(session, batchOf({ sourceId: "tracking-a", sequence: 2, eventTimeMs: 400, rows: [rowOf({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 400 })] }));
    tick(session, 450);
    expect(positionOf(session.engine, "p-1")).toEqual({ x: 10, y: 10, c: 0.9 });
    // B arrives LATER at the SAME event time with a conflicting position.
    admit(session, batchOf({ sourceId: "broadcast-1", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 24, y: 24, observedAtMs: 0 })] }));
    // B(0) releases at B(400)'s admission: the tie {stored A(0), drain B(0)}
    // is decided by the canonical order — A is the canonical-max → B withheld.
    const drain = admit(session, batchOf({ sourceId: "broadcast-1", sequence: 2, eventTimeMs: 400, rows: [rowOf({ entityRef: "p-1", x: 24, y: 24, observedAtMs: 400 })] }));
    // The conflict is EXPLICIT (the ledger across the arbitration memory).
    expect(drain.conflicts.length).toBe(1);
    expect(drain.conflicts[0]!.values).toHaveLength(2);
    expect(drain.arbitrationDecisions.length).toBe(1);
    expect(drain.arbitrationDecisions[0]!.survivorSourceId).toBe("tracking-a");
    expect(drain.arbitrationDecisions[0]!.withheldSourceIds).toEqual(["broadcast-1"]);
    expect(drain.arbitrationDecisions[0]!.precedenceMatchesSurvivor).toBe(true); // preference agrees here
    expect(drain.conflictRowsWithheld).toBe(1);
    expect(positionOf(session.engine, "p-1")).toEqual({ x: 10, y: 10, c: 0.9 }); // NOT 24,24
  });

  test("cross-drain ties: a late-arriving CANONICAL-MAX applies on top (the engine converges arrival-order-free)", () => {
    const session = createSession();
    admit(session, batchOf({ sourceId: "broadcast-1", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 0 })] }));
    admit(session, batchOf({ sourceId: "broadcast-1", sequence: 2, eventTimeMs: 400, rows: [rowOf({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 400 })] }));
    tick(session, 450);
    expect(positionOf(session.engine, "p-1")).toEqual({ x: 10, y: 10, c: 0.9 });
    // "tracking-a" is the canonical-max of the tie: its late arrival APPLIES
    // on top (the canonical order — exactly what the store replay would end on).
    admit(session, batchOf({ sourceId: "tracking-a", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 25, y: 25, observedAtMs: 0 })] }));
    const drain = admit(session, batchOf({ sourceId: "tracking-a", sequence: 2, eventTimeMs: 400, rows: [rowOf({ entityRef: "p-1", x: 25, y: 25, observedAtMs: 400 })] }));
    expect(drain.arbitrationDecisions[0]!.survivorSourceId).toBe("tracking-a");
    expect(drain.arbitrationDecisions[0]!.withheldSourceIds).toEqual([]); // the survivor IS the drain row
    expect(drain.conflictRowsWithheld).toBe(0); // nothing withheld: the incumbent was already applied
    expect(drain.conflicts.length).toBe(1); // the disagreement is still recorded
    expect(drain.batchReports.length).toBe(1); // the survivor's row applies on top
    expect(positionOf(session.engine, "p-1")).toEqual({ x: 25, y: 25, c: 0.9 });
  });

  test("the survivor's row applies VERBATIM — never averaged into the loser's", () => {
    const session = createSession({ sourcePrecedence: ["hi", "lo"] });
    admit(session, batchOf({ sourceId: "hi", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 0, y: 0, observedAtMs: 0, confidence: 0.8 })] }));
    admit(session, batchOf({ sourceId: "lo", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 10, y: 0, observedAtMs: 0, confidence: 0.4 })] }));
    const drain = session.fusion.finalize();
    // The canonical survivor is "lo" ("lo-lo…" > "lo-hi…"): its row, verbatim.
    expect(drain.arbitrationDecisions[0]!.survivorSourceId).toBe("lo");
    expect(drain.arbitrationDecisions[0]!.precedencePreferredSourceId).toBe("hi");
    expect(drain.arbitrationDecisions[0]!.precedenceMatchesSurvivor).toBe(false);
    expect(positionOf(session.engine, "p-1")).toEqual({ x: 10, y: 0, c: 0.4 });
    expect(drain.batchReports.length).toBe(1);
  });
});

describe("D9 — suppressed batches (all rows withheld)", () => {
  test("a batch whose ONLY row is withheld is suppressed (never an invalid empty document)", () => {
    const session = createSession();
    // "z-incumbent" is the canonical-max ("lo-z-…" sorts last); the LATER
    // "a-late" row is NOT the canonical survivor → withheld → its whole
    // batch is suppressed.
    admit(session, batchOf({ sourceId: "z-incumbent", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 0 })] }));
    admit(session, batchOf({ sourceId: "z-incumbent", sequence: 2, eventTimeMs: 400, rows: [rowOf({ entityRef: "p-2", x: 12, y: 10, observedAtMs: 400 })] }));
    tick(session, 450);
    admit(session, batchOf({ sourceId: "a-late", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 40, y: 40, observedAtMs: 0 })] }));
    const drain = admit(session, batchOf({ sourceId: "a-late", sequence: 2, eventTimeMs: 400, rows: [rowOf({ entityRef: "p-1", x: 41, y: 40, observedAtMs: 400 })] }));
    expect(drain.batchReports.length).toBe(0); // nothing from a-late reached the updater
    expect(drain.suppressedBatches).toBe(1);
    expect(session.fusion.stats().batchesSuppressed).toBe(1);
    expect(session.fusion.stats().batchesApplied).toBe(1); // the updater never saw an invalid document
  });
});

describe("D6 — source loss + deterministic fallback (the L004 STALLED latch consumed verbatim)", () => {
  test("a dropped stream is LOST (event + state + fallbackActive); the surviving source carries the world; recovery is recorded", () => {
    const session = createSession({ sourcePrecedence: ["tracking-a", "tracking-b"] });
    // Both sources deliver a few ticks (rate 100ms, releases trail by the window).
    for (let t = 0; t <= 300; t += 100) {
      admit(session, batchOf({ sourceId: "tracking-a", sequence: t / 100 + 1, eventTimeMs: t, rows: [rowOf({ entityRef: "p-a", x: t / 100, y: 0, observedAtMs: t })] }));
      admit(session, batchOf({ sourceId: "tracking-b", sequence: t / 100 + 1, eventTimeMs: t, rows: [rowOf({ entityRef: "p-b", x: 0, y: t / 100, observedAtMs: t })] }));
      tick(session, t + 50);
    }
    // tracking-a DROPS: only tracking-b keeps delivering; the render clock
    // runs past the L004 stall budget (default 3000ms).
    for (let t = 400; t <= 4000; t += 100) {
      admit(session, batchOf({ sourceId: "tracking-b", sequence: t / 100 + 1, eventTimeMs: t, rows: [rowOf({ entityRef: "p-b", x: 0, y: t / 100, observedAtMs: t })] }));
      const report = tick(session, t + 50);
      const a = report.sourceSummary.find((s) => s.sourceId === "tracking-a");
      if (a !== undefined && a.state === "lost") {
        // The loss is EXPLICIT: the event, the state, the fallback flag.
        expect(report.sourceEvents.some((e) => e.kind === "source-lost" && e.sourceId === "tracking-a")).toBe(true);
        expect(report.fallbackActive).toBe(true);
        expect(session.fusion.stats().sourcesLost).toBe(1);
        // The surviving source keeps the world alive (its rows keep applying).
        expect(positionOf(session.engine, "p-b")).toBeDefined();
        // tracking-a recovers: the in-window arrival clears the latch (the
        // recovery event fires on the recovery ADMISSION's drain — the
        // state transition is observed the moment the latch clears).
        const recoveryDrain = admit(session, batchOf({ sourceId: "tracking-a", sequence: 50, eventTimeMs: 4200, rows: [rowOf({ entityRef: "p-a", x: 42, y: 0, observedAtMs: 4200 })] }));
        const after = tick(session, 4300);
        const aAfter = after.sourceSummary.find((s) => s.sourceId === "tracking-a")!;
        expect(aAfter.state).toBe("active");
        expect(
          [...session.reports, recoveryDrain, after].some(
            (report) =>
              report.sourceEvents.some(
                (e) => e.kind === "source-recovered" && e.sourceId === "tracking-a",
              ),
          ),
        ).toBe(true);
        expect(session.fusion.stats().sourceRecoveries).toBe(1);
        expect(session.fusion.stats().sourcesLost).toBe(1); // no double-count
        return;
      }
    }
    throw new Error("the dropped source was never recorded lost within the stall budget (dishonest source-loss accounting)");
  });

  test("per-source summaries carry the L004 counters VERBATIM (§9 — never double-counted)", () => {
    const session = createSession();
    admit(session, batchOf({ sourceId: "tracking-a", sequence: 1, eventTimeMs: 0, rows: [rowOf({ entityRef: "p-1", x: 10, y: 10, observedAtMs: 0 })] }));
    const report = admit(session, batchOf({ sourceId: "tracking-a", sequence: 2, eventTimeMs: 400, rows: [rowOf({ entityRef: "p-1", x: 11, y: 10, observedAtMs: 400 })] }));
    const a = report.sourceSummary.find((s) => s.sourceId === "tracking-a")!;
    expect(a.temporal.appliedBatches).toBe(1); // the L004 counter, verbatim
    expect(a.batchesApplied).toBe(1); // the fusion counter (same value — counted once per layer)
    expect(a.watermark.watermarkMs).toBeGreaterThanOrEqual(0);
    expect(a.state).toBe("active");
  });
});

describe("D8 — replay equality: the arbitrated stream IS the stored stream", () => {
  test("a multi-source run with conflicts + withholding replays to the IDENTICAL final state", () => {
    const session = createSession({ sourcePrecedence: ["broadcast-1", "tracking-a"] });
    // A persistent disagreement window: both sources observe p-1 at the same
    // times with positions always beyond tolerance; the canonical survivor is
    // tracking-a ("lo-tracking-a…" > "lo-broadcast-1…"), so every broadcast-1
    // p-1 row is withheld at tied times. Disjoint entities corroborate the
    // coexistence path.
    for (let t = 0; t <= 500; t += 100) {
      admit(session, batchOf({ sourceId: "tracking-a", sequence: t / 100 + 1, eventTimeMs: t, rows: [rowOf({ entityRef: "p-1", x: 10 + t / 100, y: 0, observedAtMs: t })] }));
      admit(session, batchOf({ sourceId: "broadcast-1", sequence: t / 100 + 1, eventTimeMs: t, rows: [rowOf({ entityRef: "p-1", x: 60 + t / 100, y: 5, observedAtMs: t })] }));
      admit(session, batchOf({ sourceId: "broadcast-1", sequence: 1000 + t / 100, eventTimeMs: t, rows: [rowOf({ entityRef: `track-${t}`, x: 3, y: 3, observedAtMs: t })] }));
      tick(session, t + 50);
    }
    session.fusion.finalize();
    expect(session.fusion.stats().conflicts).toBeGreaterThan(0);
    expect(session.fusion.stats().conflictRowsWithheld).toBeGreaterThan(0);

    // The batch replay pass over the SAME bridged store.
    const replayEngine = WorldModelEngine.create(SESSION_ID, {
      football: makeFootballState(),
      now: () => 0,
    });
    runWorldFusion({ store: session.store, engine: replayEngine, sessionId: SESSION_ID });

    const liveIds = [...session.engine.entityIds].sort();
    const replayIds = [...replayEngine.entityIds].sort();
    expect(replayIds).toEqual(liveIds);
    for (const entityId of liveIds) {
      const liveEntity = session.engine.entityAt(entityId)!;
      const replayEntity = replayEngine.entityAt(entityId)!;
      expect(replayEntity.kind).toBe(liveEntity.kind);
      expect(replayEntity.lastEventTimeMs).toBe(liveEntity.lastEventTimeMs);
      expect(JSON.stringify(replayEntity.state)).toBe(JSON.stringify(liveEntity.state));
    }
    // The withheld rows are NOT in the store (the arbitrated stream only):
    // broadcast-1's p-1 rows were all withheld at tied times.
    const bridged = session.store.all();
    expect(
      bridged.filter(
        (obs) => obs.componentId === "broadcast-1" && obs.subjectEntityRefs[0]!.entityId === "p-1",
      ).length,
    ).toBe(0);
    // ...while the survivor's p-1 rows and every coexistence row ARE.
    expect(
      bridged.filter(
        (obs) => obs.componentId === "tracking-a" && obs.subjectEntityRefs[0]!.entityId === "p-1",
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe("determinism (the constitution)", () => {
  test("the same admissions + ticks + policy produce IDENTICAL canonical reports and engine state", () => {
    const run = (): { reportsJson: string; stateJson: string; statsJson: string } => {
      const session = createSession({ sourcePrecedence: ["broadcast-1", "tracking-a"] });
      for (let t = 0; t <= 300; t += 100) {
        admit(session, batchOf({ sourceId: "tracking-a", sequence: t / 100 + 1, eventTimeMs: t, rows: [rowOf({ entityRef: "p-1", x: 10 + t / 100, y: 0, observedAtMs: t })] }));
        admit(session, batchOf({ sourceId: "broadcast-1", sequence: t / 100 + 1, eventTimeMs: t, rows: [rowOf({ entityRef: "p-1", x: 50 + t / 100, y: 5, observedAtMs: t })] }));
        tick(session, t + 50);
      }
      session.fusion.finalize();
      return {
        reportsJson: session.reports.map(canonicalFusionReportJson).join("\n"),
        stateJson: JSON.stringify(session.engine.snapshot()),
        statsJson: JSON.stringify(session.fusion.stats()),
      };
    };
    const first = run();
    const second = run();
    expect(second.reportsJson).toBe(first.reportsJson);
    expect(second.stateJson).toBe(first.stateJson);
    expect(second.statsJson).toBe(first.statsJson);
  });
});
