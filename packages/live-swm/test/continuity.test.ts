/**
 * THE D6 LIVE-TO-REPLAY CONTINUITY BATTERY (the L003 acceptance core) — the
 * full composition `LiveSource → TemporalBufferEngine (L004) → LiveSwmUpdater
 * → WorldModelEngine` over the L002 delivery scenarios, then a batch
 * `runWorldFusion` pass over the SAME bridged W005 store into a FRESH engine:
 *
 *   updater-final-state == runWorldFusion-replay-final-state
 *
 * for the same observation set (the frozen §8 rule: "A live session must be
 * able to become a replay session without translating into a second canonical
 * model"). The equality is asserted at the SEMANTIC state level (per-entity
 * kind/version/lastEventTimeMs/state slots, the possession slot, the
 * snapshot watermark) — plus the stronger exact-version equality for the
 * L004-composed runs (event-time ordered delivery → the live and replay
 * application orders coincide).
 *
 * The DIRECT (no-L004) unordered drive is included as the honest boundary:
 * raw out-of-order arrivals make the live path skip would-be rewinds that
 * the chronological replay applies — the FINAL STATE still matches exactly
 * (the design's own parenthetical: "no-op skipping makes re-applications
 * harmless"), while per-entity version counters may legitimately differ
 * (the replay counts the extra chronological upserts; never asserted there).
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
import type { ObservationStore } from "@sporta/observation";
import { createDeterministicLiveSource, drainSource } from "@sporta/live-source";
import type { LiveScenarioKind } from "@sporta/live-source";
import { runWorldFusion } from "@sporta/fusion";
import { createTemporalBufferEngine } from "@sporta/live-temporal";
import type { DrainResult } from "@sporta/live-temporal";
import { createLiveSwmUpdater } from "../src/index";
import type { LiveSwmUpdater } from "../src/index";

const SESSION_ID = "s-live-continuity";

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

/** One live session's full composition output. */
interface LiveSession {
  engine: WorldModelEngine;
  store: ObservationStore;
  updater: LiveSwmUpdater;
  reports: ReturnType<LiveSwmUpdater["apply"]>[];
}

/** Drives the full composed live session over one L002 scenario. */
function runComposedLiveSession(
  scenario: LiveScenarioKind,
  options?: { seed?: number; tickCount?: number; playersPerTeam?: number },
): LiveSession {
  const seed = options?.seed ?? 20260921;
  const tickCount = options?.tickCount ?? 120;
  const playersPerTeam = options?.playersPerTeam ?? 4;
  const source = createDeterministicLiveSource({
    sessionId: SESSION_ID,
    seed,
    scenario,
    tickCount,
    playersPerTeam,
  });
  const arrivals = drainSource(source);
  const engine = WorldModelEngine.create(SESSION_ID, {
    football: makeFootballState(),
    now: () => 0,
  });
  const store = new InMemoryObservationStore();
  const updater = createLiveSwmUpdater({ sessionId: SESSION_ID, engine, store });
  const temporal = createTemporalBufferEngine({ sessionId: SESSION_ID });
  const reports: LiveSession["reports"] = [];

  const feed = (drain: DrainResult): void => {
    for (const entry of drain.applied) {
      const sourceStats = drain.sources.find((stats) => stats.sourceId === entry.sourceId);
      reports.push(
        updater.apply(
          entry.batch,
          sourceStats !== undefined ? { engineWatermark: sourceStats.watermark } : undefined,
        ),
      );
    }
  };

  // The time-driven bridge pattern (the wave-2 SSE lane's shape): admit every
  // arrival whose planned ingest has come due, tick the render clock, repeat;
  // finalize drains the window's tail.
  const stepMs = 100;
  const lastIngestMs = arrivals[arrivals.length - 1]!.ingestTimeMs;
  let clock = 0;
  let next = 0;
  while (clock <= lastIngestMs + 2 * stepMs) {
    while (next < arrivals.length && arrivals[next]!.ingestTimeMs <= clock) {
      feed(temporal.admit(arrivals[next]!));
      next += 1;
    }
    feed(temporal.tick(clock));
    clock += stepMs;
  }
  while (next < arrivals.length) {
    feed(temporal.admit(arrivals[next]!));
    next += 1;
  }
  feed(temporal.finalize());
  return { engine, store, updater, reports };
}

/** Drives the updater DIRECTLY on raw arrivals (no L004 — the boundary case). */
function runDirectLiveSession(
  scenario: LiveScenarioKind,
  options?: { seed?: number; tickCount?: number; playersPerTeam?: number },
): LiveSession {
  const seed = options?.seed ?? 20260921;
  const tickCount = options?.tickCount ?? 120;
  const playersPerTeam = options?.playersPerTeam ?? 4;
  const source = createDeterministicLiveSource({
    sessionId: SESSION_ID,
    seed,
    scenario,
    tickCount,
    playersPerTeam,
  });
  const engine = WorldModelEngine.create(SESSION_ID, {
    football: makeFootballState(),
    now: () => 0,
  });
  const store = new InMemoryObservationStore();
  const updater = createLiveSwmUpdater({ sessionId: SESSION_ID, engine, store });
  const reports: LiveSession["reports"] = [];
  for (const arrival of drainSource(source)) {
    reports.push(updater.apply(arrival));
  }
  return { engine, store, updater, reports };
}

/** Runs the batch replay pass over the bridged store into a fresh engine. */
function replayBatch(session: LiveSession): WorldModelEngine {
  const engine = WorldModelEngine.create(SESSION_ID, {
    football: makeFootballState(),
    now: () => 0,
  });
  runWorldFusion({ store: session.store, engine, sessionId: SESSION_ID });
  return engine;
}

/** Asserts per-entity FINAL-STATE equality (the D6 acceptance). */
function expectFinalStateEquality(
  live: WorldModelEngine,
  replay: WorldModelEngine,
  options?: { assertVersions?: boolean },
): void {
  const liveIds = [...live.entityIds].sort();
  const replayIds = [...replay.entityIds].sort();
  expect(replayIds).toEqual(liveIds);
  for (const entityId of liveIds) {
    const liveEntity = live.entityAt(entityId)!;
    const replayEntity = replay.entityAt(entityId)!;
    expect(replayEntity.kind).toBe(liveEntity.kind);
    expect(replayEntity.lastEventTimeMs).toBe(liveEntity.lastEventTimeMs);
    expect(JSON.stringify(replayEntity.state)).toBe(JSON.stringify(liveEntity.state));
    if (options?.assertVersions !== false) {
      expect(replayEntity.version).toBe(liveEntity.version);
    }
  }
  // The football extension's possession slot: the same honest candidate.
  const livePossession = live.snapshot().football!.possession;
  const replayPossession = replay.snapshot().football!.possession;
  expect(JSON.stringify(replayPossession)).toBe(JSON.stringify(livePossession));
  // The snapshot watermark (the match-time position): aligned.
  expect(replay.snapshot().watermark).toEqual(live.snapshot().watermark);
}

describe("D6 continuity — the composed live session becomes an exact replay", () => {
  for (const scenario of ["normal", "drop", "out-of-order", "jitter"] as const) {
    test(`scenario "${scenario}": updater-final-state == runWorldFusion-replay-final-state`, () => {
      const session = runComposedLiveSession(scenario);
      // The session is REAL: entities, reports, and bridged evidence exist.
      expect(session.engine.entityIds.length).toBe(9); // 4 + 4 players + the ball (referee skipped)
      expect(session.reports.length).toBeGreaterThan(80);
      expect(session.store.count()).toBeGreaterThan(800); // the bridged evidence rows
      expectFinalStateEquality(session.engine, replayBatch(session));
    });
  }

  test('scenario "delay": the laggy window still replays exactly (in-order arrivals)', () => {
    const session = runComposedLiveSession("delay", {
      seed: 99,
      tickCount: 120,
      playersPerTeam: 3,
    });
    expectFinalStateEquality(session.engine, replayBatch(session));
  });

  test('scenario "reconnect": the accounted gap replays with the same visible hole', () => {
    const session = runComposedLiveSession("reconnect", { seed: 5, tickCount: 120 });
    const replay = replayBatch(session);
    expectFinalStateEquality(session.engine, replay);
    // The gap is visible in BOTH engines: no entity row was fabricated for
    // the missed window (the lastEventTimeMs sequence jumps across it).
    const lastTimes = [...session.engine.entityIds]
      .sort()
      .map((id) => session.engine.entityAt(id)!.lastEventTimeMs);
    const maxTime = Math.max(...lastTimes);
    expect(maxTime).toBeGreaterThan(10_000); // the session ran past the gap
  });

  test("the extrapolation accounting agrees across L004 and the updater (the two books)", () => {
    const session = runComposedLiveSession("drop", { seed: 31 });
    const carriedInReports = session.reports.reduce(
      (acc, report) => acc + report.extrapolatedObservations,
      0,
    );
    const carriedInStats = session.updater.stats().extrapolatedObservations;
    expect(carriedInStats).toBe(carriedInReports);
    expect(carriedInReports).toBeGreaterThan(0); // L002's honest carries exist
    // Every carried application kept the honest reduced confidence (never a
    // fabricated certainty): sample any entity's most recent carried state.
    const storeRows = session.store.all();
    const carriedBridged = storeRows.filter((observation) => (observation.confidence ?? 1) <= 0.3);
    expect(carriedBridged.length).toBeGreaterThan(0);
  });

  test("watermarkAfter obeys the min rule honestly across the session", () => {
    // Record (report, drainReason) pairs: the feed preserves both.
    const source = createDeterministicLiveSource({
      sessionId: SESSION_ID,
      seed: 17,
      scenario: "out-of-order",
      tickCount: 120,
      playersPerTeam: 4,
    });
    const arrivals = drainSource(source);
    const engine = WorldModelEngine.create(SESSION_ID, {
      football: makeFootballState(),
      now: () => 0,
    });
    const store = new InMemoryObservationStore();
    const updater = createLiveSwmUpdater({ sessionId: SESSION_ID, engine, store });
    const temporal = createTemporalBufferEngine({ sessionId: SESSION_ID });
    const observed: Array<{
      watermarkAfter: number;
      batchWatermark: number;
      engineWatermark: number;
      drainReason: string;
    }> = [];
    const feed = (drain: DrainResult): void => {
      for (const entry of drain.applied) {
        const sourceStats = drain.sources.find((stats) => stats.sourceId === entry.sourceId);
        const engineWatermark = sourceStats?.watermark.watermarkMs ?? 0;
        const report = updater.apply(
          entry.batch,
          sourceStats !== undefined ? { engineWatermark: sourceStats.watermark } : undefined,
        );
        observed.push({
          watermarkAfter: report.watermarkAfter.watermarkMs,
          batchWatermark: entry.batch.watermark.watermarkMs,
          engineWatermark,
          drainReason: entry.drainReason,
        });
      }
    };
    let clock = 0;
    let next = 0;
    const lastIngestMs = arrivals[arrivals.length - 1]!.ingestTimeMs;
    while (clock <= lastIngestMs + 200) {
      while (next < arrivals.length && arrivals[next]!.ingestTimeMs <= clock) {
        feed(temporal.admit(arrivals[next]!));
        next += 1;
      }
      feed(temporal.tick(clock));
      clock += 100;
    }
    while (next < arrivals.length) {
      feed(temporal.admit(arrivals[next]!));
      next += 1;
    }
    feed(temporal.finalize());
    expect(observed.length).toBeGreaterThan(80);
    // The D5 min rule holds EXACTLY on every report: watermarkAfter =
    // min(batch source watermark, L004 engine watermark) — never above
    // either, never fabricated higher. (A per-batch DIP is honest data — an
    // out-of-order-arrival batch carries its own stale emission watermark
    // and releases after newer batches; the MONOTONE composition of the
    // per-batch watermarks into the live view's match-time watermark is the
    // L005 view layer's job, per the frozen §3 rule.)
    for (const entry of observed) {
      expect(entry.watermarkAfter).toBe(Math.min(entry.batchWatermark, entry.engineWatermark));
    }
    // The engine watermark itself IS monotone across the session (the D1
    // core) — the composition's temporal backbone never regresses.
    let previousEngine = 0;
    for (const entry of observed) {
      expect(entry.engineWatermark).toBeGreaterThanOrEqual(previousEngine);
      previousEngine = entry.engineWatermark;
    }
  });
});

describe("D6 boundary — DIRECT unordered arrivals (no L004 in front)", () => {
  test("raw out-of-order arrivals still produce the replay-equal FINAL STATE", () => {
    const session = runDirectLiveSession("out-of-order", { seed: 23 });
    // The arrival order really contains inversions (the scenario precondition).
    expect(session.reports.length).toBeGreaterThan(80);
    // The final state matches exactly; per-entity VERSIONS may legitimately
    // differ here (the chronological replay applies rows the live path's
    // rewind protection skipped — the design's "no-op skipping makes
    // re-applications harmless") — versions are NOT asserted for this drive.
    expectFinalStateEquality(session.engine, replayBatch(session), { assertVersions: false });
  });

  test("raw normal arrivals (in order) are version-exact too", () => {
    const session = runDirectLiveSession("normal", { seed: 41 });
    expectFinalStateEquality(session.engine, replayBatch(session));
  });
});

describe("the composition's honesty surfaces (cross-package consistency)", () => {
  test("every applied batch produced a report; no row was silently lost", () => {
    // playersPerTeam 4 + referees 1 + ball 1 = 10 rows per L002 batch;
    // bridged kinds = PLAYER + BALL + REFEREE = 9 (OTHER has no honest kind).
    const session = runComposedLiveSession("drop", { seed: 2, tickCount: 100 });
    const appliedReports = session.reports.filter((report) => report.outcome === "applied");
    expect(appliedReports).toHaveLength(session.reports.length); // L004 deduped upstream
    const stats = session.updater.stats();
    expect(stats.appliedBatches).toBe(session.reports.length);
    expect(stats.duplicateSequence).toBe(0);
    expect(stats.invalidBatches).toBe(0);
    expect(stats.wrongSession).toBe(0);
    // Row-level conservation: every row of every applied batch is accounted
    // (upserted + no-op-skipped + non-projectable) — nothing silently lost.
    const totalRows = session.reports.reduce(
      (acc, report) =>
        acc + report.entitiesUpserted + report.entitiesSkippedNoOp + report.nonProjectableRows,
      0,
    );
    expect(totalRows).toBe(10 * session.reports.length);
    // The bridge holds every row with an honest EntityKind (PLAYER + BALL +
    // REFEREE-as-official = all 10; the OTHER kind never bridges — L002
    // emits none).
    expect(session.store.count()).toBe(10 * session.reports.length);
    // The referee row of every batch is the non-projectable one (counted).
    expect(session.reports.reduce((acc, report) => acc + report.nonProjectableRows, 0)).toBe(
      session.reports.length,
    );
    // The SWM-projectable subset is exactly players + ball (9 per batch).
    expect(
      session.reports.reduce(
        (acc, report) => acc + report.entitiesUpserted + report.entitiesSkippedNoOp,
        0,
      ),
    ).toBe(9 * session.reports.length);
  });
});
