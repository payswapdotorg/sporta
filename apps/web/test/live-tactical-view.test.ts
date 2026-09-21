import { describe, expect, test } from "bun:test";
import { createDeterministicLiveSource } from "@sporta/live-source";
import type { LiveObservation, LiveScenarioKind, LiveSourcePort } from "@sporta/live-source";
import { createTacticalFrameProducer } from "../src/server/live/view-model";
import type { LiveWorldFrameDoc } from "../src/lib/live-sse";
import {
  entityMarkerColor,
  entityMarkerLabel,
  frameEventPhrase,
  liveStaleness,
  projectPitchGeometry,
  projectTacticalFrame,
  teamRefOf,
} from "../src/lib/live-tactical-view";

/**
 * THE LIVE TACTICAL VIEW BATTERY (L005 full) — the deterministic test
 * surface the work item requires, in three layers:
 *
 * 1. VIEW-MODEL PROJECTIONS FROM FIXTURES (exact assertions): hand-built
 *    world frames (the W915 `LiveWorldFrameDoc` wire shape — the frozen
 *    live-reality.md §5 semantics as delivered) project to EXACT marker
 *    screen coordinates, colors, identity labels, radii and hollow states;
 *    the pitch geometry is exact; the staleness watchdog math is exact;
 *    the event phrases are the fixed table.
 *
 * 2. TRANSPORT/VIEW-MODEL BEHAVIOR ACROSS THE L002 SCENARIOS: every
 *    delivery scenario (normal / jitter / delay / drop / out-of-order /
 *    reconnect) runs through the REAL deterministic source (read-only) and
 *    the REAL view-model producer, asserting each scenario's honest
 *    signature — at the delivery-plan layer (the source's own plan: ingest
 *    offsets, gaps, swaps) AND at the frame layer (what the renderer sees:
 *    sequence gaps, arrival-order inversions, recovery accounting,
 *    degraded windows).
 *
 * 3. IDENTITY-CONTINUITY PINNING: the entityRef set is invariant across
 *    each scenario's whole window; an undetected entity carries its EXACT
 *    last-detected position (pinned by equality); positions visibly change
 *    across frames (a live view, not a still).
 *
 * REAL-vs-FIXTURE: layer 1 uses hand-built wire-frame FIXTURES (labeled);
 * layers 2-3 run the REAL L002 deterministic source through the REAL
 * view-model producer (no fixtures — the same code the transport serves).
 */

// ---------------------------------------------------------------------------
// Layer 1 — fixture projections (exact math)
// ---------------------------------------------------------------------------

/** One fixture entity (the wire frame's own fields, minimal helper). */
function fixtureEntity(
  entityRef: string,
  overrides: Partial<LiveWorldFrameDoc["entities"][number]> = {},
): LiveWorldFrameDoc["entities"][number] {
  return {
    entityRef,
    kind: "PLAYER",
    teamRef: "team-home",
    xMeters: 52.5,
    yMeters: 34,
    detected: true,
    confidence: 0.9,
    staleForMs: 0,
    ...overrides,
  };
}

describe("the tactical view projection (L005 — fixture frames, exact math)", () => {
  const CANVAS = { width: 840, height: 544 } as const;

  test("projects entity positions to exact canvas coordinates (105×68 → 840×544)", () => {
    const { markers } = projectTacticalFrame(
      [
        fixtureEntity("p-home-01", { xMeters: 0, yMeters: 0 }),
        fixtureEntity("p-away-11", { xMeters: 105, yMeters: 68 }),
        fixtureEntity("ball-1", {
          kind: "BALL",
          teamRef: undefined,
          xMeters: 52.5,
          yMeters: 34,
        }),
      ],
      CANVAS,
    );
    expect(markers).toHaveLength(3);
    // (0,0) m → (0,0) px; (105,68) m → (840,544) px; center → center.
    expect(markers[0]).toMatchObject({ x: 0, y: 0 });
    expect(markers[1]).toMatchObject({ x: 840, y: 544 });
    expect(markers[2]).toMatchObject({ x: 420, y: 272 });
    // The verbatim meters ride along (never clamped, never rounded).
    expect(markers[1]!.xMeters).toBe(105);
    expect(markers[1]!.yMeters).toBe(68);
  });

  test("the marker radii are the documented presentation constants", () => {
    const { markers } = projectTacticalFrame(
      [
        fixtureEntity("p-home-01"),
        fixtureEntity("ball-1", { kind: "BALL", teamRef: undefined }),
        fixtureEntity("ref-1", { kind: "REFEREE", teamRef: undefined }),
      ],
      CANVAS,
    );
    const playerRadius = Math.max(4, 840 / 64); // 13.125
    expect(markers[0]!.radius).toBe(playerRadius);
    expect(markers[1]!.radius).toBe(Math.max(2.5, playerRadius * 0.55));
    expect(markers[2]!.radius).toBe(playerRadius);
    // A tiny canvas floors the radii (readability, documented).
    const tiny = projectTacticalFrame([fixtureEntity("p-home-01")], { width: 120, height: 78 });
    expect(tiny.markers[0]!.radius).toBe(4);
  });

  test("the colors follow the frozen teamRef vocabulary (never a wrong split)", () => {
    expect(entityMarkerColor(fixtureEntity("p-home-01"))).toBe("#e879b9");
    expect(entityMarkerColor(fixtureEntity("p-away-01", { teamRef: "team-away" }))).toBe("#34d399");
    expect(entityMarkerColor(fixtureEntity("ball-1", { kind: "BALL", teamRef: undefined }))).toBe(
      "#f8fafc",
    );
    expect(entityMarkerColor(fixtureEntity("ref-1", { kind: "REFEREE", teamRef: undefined }))).toBe(
      "#fbbf24",
    );
    // An UNKNOWN team ref falls back to neutral — never a guessed split.
    expect(entityMarkerColor(fixtureEntity("p-mystery", { teamRef: "team-zzz" }))).toBe("#94a3b8");
    expect(entityMarkerColor(fixtureEntity("p-nobody"))).toBe("#e879b9"); // team-home still wins
    expect(teamRefOf("team-home")).toBe("team-home");
    expect(teamRefOf("team-away")).toBe("team-away");
    expect(teamRefOf(undefined)).toBeNull();
    expect(teamRefOf("team-zzz")).toBeNull();
  });

  test("the identity labels are STABLE pure functions of the entityRef", () => {
    expect(entityMarkerLabel("p-home-01")).toBe("H01");
    expect(entityMarkerLabel("p-home-7")).toBe("H7");
    expect(entityMarkerLabel("p-away-11")).toBe("A11");
    expect(entityMarkerLabel("ref-1")).toBe("R1");
    expect(entityMarkerLabel("ball-1")).toBe("●");
    expect(entityMarkerLabel("something-else")).toBe("else");
    expect(entityMarkerLabel("plain")).toBe("plain");
    // The SAME ref → the SAME label on every frame (identity continuity).
    for (let index = 0; index < 25; index += 1) {
      expect(entityMarkerLabel("p-away-09")).toBe("A09");
    }
  });

  test("the projection carries the honest detection state verbatim", () => {
    const { markers } = projectTacticalFrame(
      [
        fixtureEntity("p-home-05", { detected: true, staleForMs: 0, confidence: 0.93 }),
        fixtureEntity("p-away-05", {
          detected: false,
          staleForMs: 700,
          confidence: 0.31,
          xMeters: 12.25,
          yMeters: 61.75,
        }),
      ],
      CANVAS,
    );
    expect(markers[0]!.detected).toBe(true);
    expect(markers[0]!.staleForMs).toBe(0);
    expect(markers[0]!.confidence).toBe(0.93);
    // The honest carry: last-known position, detected false, staleness kept.
    expect(markers[1]!.detected).toBe(false);
    expect(markers[1]!.staleForMs).toBe(700);
    expect(markers[1]!.confidence).toBe(0.31);
    expect(markers[1]!.xMeters).toBe(12.25);
    expect(markers[1]!.yMeters).toBe(61.75);
  });

  test("the pitch geometry is the canonical 105×68 markings, exact", () => {
    const pitch = projectPitchGeometry(CANVAS);
    expect(pitch.boundary).toEqual({ x: 0, y: 0, w: 840, h: 544 });
    expect(pitch.halfwayLine).toEqual({ x1: 420, y1: 0, x2: 420, y2: 544 });
    expect(pitch.centerCircle).toEqual({ cx: 420, cy: 272, r: (9.15 / 105) * 840 });
    // Penalty areas: 16.5 deep × 40.32 wide, both sides.
    expect(pitch.penaltyAreas[0]).toEqual({
      x: 0,
      y: ((68 - 40.32) / 2 / 68) * 544,
      w: (16.5 / 105) * 840,
      h: (40.32 / 68) * 544,
    });
    expect(pitch.penaltyAreas[1]).toEqual({
      x: 840 - (16.5 / 105) * 840,
      y: ((68 - 40.32) / 2 / 68) * 544,
      w: (16.5 / 105) * 840,
      h: (40.32 / 68) * 544,
    });
    // Goal areas: 5.5 deep × 18.32 wide.
    expect(pitch.goalAreas[0]).toEqual({
      x: 0,
      y: ((68 - 18.32) / 2 / 68) * 544,
      w: (5.5 / 105) * 840,
      h: (18.32 / 68) * 544,
    });
    // Penalty spots at 11 m from each goal line, on the width midpoint.
    expect(pitch.penaltySpots).toEqual([
      { cx: (11 / 105) * 840, cy: 272 },
      { cx: 840 - (11 / 105) * 840, cy: 272 },
    ]);
  });

  test("the staleness watchdog is exact (never a frozen live picture)", () => {
    const cadenceMs = 500;
    // No frame yet: the honest awaiting state.
    expect(
      liveStaleness({
        lastFrameReceivedAtMs: null,
        lastWorldVersion: null,
        nowMs: 10_000,
        cadenceMs,
      }),
    ).toEqual({ state: "awaiting-first-frame" });
    // Inside the tolerance (2.5 × cadence = 1250 ms): current.
    expect(
      liveStaleness({
        lastFrameReceivedAtMs: 9_000,
        lastWorldVersion: 42,
        nowMs: 10_000,
        cadenceMs,
      }),
    ).toEqual({ state: "current" });
    expect(
      liveStaleness({
        lastFrameReceivedAtMs: 8_750,
        lastWorldVersion: 42,
        nowMs: 10_000,
        cadenceMs,
      }),
    ).toEqual({ state: "current" });
    // Past the tolerance: stalled, with the counted gap + the labeled version.
    expect(
      liveStaleness({
        lastFrameReceivedAtMs: 8_749,
        lastWorldVersion: 42,
        nowMs: 10_000,
        cadenceMs,
      }),
    ).toEqual({ state: "stalled", stalledForMs: 1_251, lastWorldVersion: 42 });
    // A slower cadence widens the tolerance honestly.
    expect(
      liveStaleness({
        lastFrameReceivedAtMs: 8_000,
        lastWorldVersion: 7,
        nowMs: 10_000,
        cadenceMs: 2_000,
      }),
    ).toEqual({ state: "current" });
  });

  test("the event phrases are the fixed table (never invented prose)", () => {
    expect(
      frameEventPhrase({
        type: "source-recovery",
        atMs: 1,
        detail: { missedUpdates: 8, gapDurationMs: 800 },
      }),
    ).toBe("source reconnect — 8 updates missed (0.8s gap, accounted)");
    expect(frameEventPhrase({ type: "quality-degraded", atMs: 1 })).toBe(
      "source quality degraded (honest state, shown)",
    );
    expect(frameEventPhrase({ type: "quality-nominal", atMs: 1 })).toBe(
      "source quality back to nominal",
    );
    expect(
      frameEventPhrase({ type: "entity-appeared", atMs: 1, detail: { entityRef: "p-home-03" } }),
    ).toBe("entity appeared p-home-03");
    expect(
      frameEventPhrase({ type: "entity-lost", atMs: 1, detail: { entityRef: "ball-1" } }),
    ).toBe("entity lost from the batch ball-1 (carried last-known)");
    expect(
      frameEventPhrase({ type: "entity-regained", atMs: 1, detail: { entityRef: "ref-1" } }),
    ).toBe("entity regained ref-1");
  });
});

// ---------------------------------------------------------------------------
// Layers 2+3 — the REAL source + view-model across every L002 scenario
// ---------------------------------------------------------------------------

/** A deterministic stepping clock for the view-model's own runs. */
function steppingClock(): () => number {
  let current = 1_888_888_888_000;
  return () => {
    current += 17;
    return current;
  };
}

/** Runs ONE scenario's whole scripted window through the view-model. */
function runScenarioWindow(scenario: LiveScenarioKind, tickCount = 160): LiveWorldFrameDoc[] {
  const producer = createTacticalFrameProducer({
    sessionId: `sess-l005-${scenario}`,
    nowMs: steppingClock(),
    config: {
      seed: 20260920,
      scenario,
      tickCount,
      rateMs: 100,
      playersPerTeam: 11,
      referees: 1,
    },
    sourceNote: "the L005 view battery",
  });
  const frames: LiveWorldFrameDoc[] = [];
  for (let ordinal = 1; ordinal <= tickCount * 2; ordinal += 1) {
    const { frame, replayCycle } = producer.next({ sessionId: `sess-l005-${scenario}`, ordinal });
    if (replayCycle) break; // the scripted window ended — stop at the boundary
    frames.push(frame);
  }
  expect(frames.length).toBeGreaterThan(0);
  return frames;
}

/** Runs ONE scenario's whole window against the RAW source (read-only). */
function runSourceWindow(
  scenario: LiveScenarioKind,
  tickCount = 160,
): {
  observations: LiveObservation[];
  source: LiveSourcePort;
} {
  const source = createDeterministicLiveSource({
    sessionId: `sess-l005-src-${scenario}`,
    seed: 20260920,
    scenario,
    tickCount,
    rateMs: 100,
    playersPerTeam: 11,
    referees: 1,
  });
  const observations: LiveObservation[] = [];
  for (let index = 0; index < tickCount * 2; index += 1) {
    const observation = source.next();
    if (observation === null) break;
    observations.push(observation);
  }
  source.close();
  return { observations, source };
}

describe("the L002 scenario signatures through the real source + view-model (L005)", () => {
  test("normal: every tick in order, contiguous sequences, nominal quality, no events", () => {
    const { observations, source } = runSourceWindow("normal");
    const frames = runScenarioWindow("normal");
    // The delivery plan: base latency only, order preserved, nothing lost.
    const stats = source.stats();
    expect(stats.plannedTicks).toBe(160);
    expect(stats.emitted).toBe(160);
    expect(stats.droppedTicks).toBe(0);
    expect(stats.reconnectGapTicks).toBe(0);
    expect(stats.reconnects).toBe(0);
    expect(stats.degradedObservations).toBe(0);
    // The frames: contiguous sequences, nominal quality, and NO delivery-
    // accounting events (no source-recovery, no degraded transitions — the
    // per-entity appeared/regained/lost honesty and the INITIAL
    // quality-nominal announcement are allowed in every scenario).
    expect(frames).toHaveLength(160);
    expect(
      frames[0]!.eventsSincePreviousFrame.filter((event) => event.type === "entity-appeared")
        .length,
    ).toBeGreaterThanOrEqual(20);
    for (let index = 0; index < frames.length; index += 1) {
      expect(frames[index]!.sourceSequence).toBe(index + 1);
      expect(frames[index]!.quality).toBe("nominal");
      for (const event of frames[index]!.eventsSincePreviousFrame) {
        expect(
          event.type === "entity-appeared" ||
            event.type === "entity-regained" ||
            event.type === "entity-lost" ||
            event.type === "quality-nominal",
        ).toBe(true);
      }
      expect(frames[index]!.telemetry.replayCycle).toBe(false);
    }
    expect(observations).toHaveLength(160);
  });

  test("jitter: irregular ingest offsets, arrival ORDER preserved (plan-level honesty)", () => {
    const { observations, source } = runSourceWindow("jitter");
    const frames = runScenarioWindow("jitter");
    // The plan: per-tick jittered offsets (bounded < rateMs) — irregular
    // inter-arrival WITHOUT reordering (the scenario's own contract).
    const stats = source.stats();
    expect(stats.droppedTicks).toBe(0);
    expect(stats.reconnects).toBe(0);
    // At least one pair of consecutive ingest stamps is NOT rateMs apart
    // (the jitter is real), and the ingest order matches event order.
    let irregular = 0;
    for (let index = 1; index < observations.length; index += 1) {
      const previous = observations[index - 1]!;
      const current = observations[index]!;
      expect(current.ingestTimeMs).toBeGreaterThanOrEqual(previous.ingestTimeMs);
      if (current.ingestTimeMs - previous.ingestTimeMs !== 100) irregular += 1;
    }
    expect(irregular).toBeGreaterThan(0);
    // The frames: order still preserved (sequences strictly ascending).
    for (let index = 1; index < frames.length; index += 1) {
      expect(frames[index]!.sourceSequence).toBeGreaterThan(frames[index - 1]!.sourceSequence);
    }
  });

  test("delay: the delay window's ingest stamps jump by the configured delay (plan-level)", () => {
    const { observations, source } = runSourceWindow("delay");
    const frames = runScenarioWindow("delay");
    expect(source.stats().droppedTicks).toBe(0);
    // The delay window (default: ticks 30..34, +1500 ms): those ticks'
    // ingest stamps carry the extra latency; ORDER stays intact.
    const inWindow = observations.filter((observation, index) => index >= 30 && index < 35);
    const beforeWindow = observations[29]!;
    for (const observation of inWindow) {
      expect(observation.ingestTimeMs).toBeGreaterThan(beforeWindow.ingestTimeMs + 1_000);
    }
    // The frames: contiguous, nominal, no DELIVERY-accounting events (the
    // per-entity honesty + the initial quality announcement are allowed;
    // delay is a latency distortion, not a loss — the data is complete).
    for (let index = 0; index < frames.length; index += 1) {
      expect(frames[index]!.quality).toBe("nominal");
      for (const event of frames[index]!.eventsSincePreviousFrame) {
        expect(
          event.type === "entity-appeared" ||
            event.type === "entity-regained" ||
            event.type === "entity-lost" ||
            event.type === "quality-nominal",
        ).toBe(true);
      }
    }
    for (let index = 1; index < frames.length; index += 1) {
      expect(frames[index]!.sourceSequence).toBe(frames[index - 1]!.sourceSequence + 1);
    }
  });

  test("drop: visible sequence gaps + doubled event-time steps in the frames (never smoothed)", () => {
    const { source } = runSourceWindow("drop");
    const frames = runScenarioWindow("drop");
    const stats = source.stats();
    expect(stats.droppedTicks).toBeGreaterThan(0);
    expect(stats.reconnects).toBe(0); // scattered drops are NOT reconnects
    expect(frames.length).toBe(160 - stats.droppedTicks);
    // The renderer sees the gaps: sourceSequence jumps, and the event-time
    // step doubles across a dropped tick (the missed tick is DATA).
    const sequenceGaps = frames.filter(
      (frame, index) => index > 0 && frame.sourceSequence > frames[index - 1]!.sourceSequence + 1,
    );
    expect(sequenceGaps.length).toBeGreaterThan(0);
    const doubledSteps = frames.filter(
      (frame, index) => index > 0 && frame.eventTimeMs - frames[index - 1]!.eventTimeMs >= 200,
    );
    expect(doubledSteps.length).toBeGreaterThan(0);
    // No recovery events (drops are accounted by the gap, not a reconnect).
    expect(
      frames.some((frame) =>
        frame.eventsSincePreviousFrame.some((event) => event.type === "source-recovery"),
      ),
    ).toBe(false);
  });

  test("out-of-order: adjacent arrival-order inversions the renderer honestly receives", () => {
    const frames = runScenarioWindow("out-of-order");
    // The renderer receives the swaps VERBATIM: at least one consecutive
    // pair arrives with the LATER sequence first (a real reorder, bounded
    // to depth one — never a shuffle).
    const inversions = frames.filter(
      (frame, index) => index > 0 && frame.sourceSequence < frames[index - 1]!.sourceSequence,
    );
    expect(inversions.length).toBeGreaterThan(0);
    // Bounded reorder depth: an inversion step is exactly -1 (adjacent swap).
    for (let index = 1; index < frames.length; index += 1) {
      const step = frames[index]!.sourceSequence - frames[index - 1]!.sourceSequence;
      expect(step).toBeGreaterThanOrEqual(-1);
    }
    // Every sequence still arrives exactly once over the window.
    const sequences = frames.map((frame) => frame.sourceSequence).sort((a, b) => a - b);
    for (let index = 0; index < sequences.length; index += 1) {
      expect(sequences[index]).toBe(index + 1);
    }
  });

  test("reconnect: the recovery accounting + degraded window ride the frames honestly", () => {
    const { source } = runSourceWindow("reconnect");
    const frames = runScenarioWindow("reconnect");
    const stats = source.stats();
    expect(stats.reconnects).toBe(1);
    expect(stats.reconnectGapTicks).toBe(8); // the default gap window
    expect(stats.degradedObservations).toBeGreaterThan(0);
    expect(frames.length).toBe(160 - 8);
    // ONE recovery event with the exact missed-window accounting.
    const recoveryFrames = frames.filter((frame) =>
      frame.eventsSincePreviousFrame.some((event) => event.type === "source-recovery"),
    );
    expect(recoveryFrames).toHaveLength(1);
    const recoveryEvent = recoveryFrames[0]!.eventsSincePreviousFrame.find(
      (event) => event.type === "source-recovery",
    )!;
    expect(recoveryEvent.detail?.missedUpdates).toBe(8);
    expect(recoveryEvent.detail?.gapDurationMs).toBe(800); // 8 ticks × 100 ms
    // The degraded window follows the reconnect (quality transitions are
    // honest EVENTS, never hidden flips).
    const degradedFrames = frames.filter((frame) => frame.quality === "degraded");
    expect(degradedFrames.length).toBeGreaterThan(0);
    expect(
      frames.some((frame) =>
        frame.eventsSincePreviousFrame.some((event) => event.type === "quality-degraded"),
      ),
    ).toBe(true);
    expect(
      frames.some((frame) =>
        frame.eventsSincePreviousFrame.some((event) => event.type === "quality-nominal"),
      ),
    ).toBe(true);
    // The sequence jump across the gap is visible (never renumbered).
    const gapStep =
      recoveryFrames[0]!.sourceSequence -
      frames[frames.indexOf(recoveryFrames[0]!) - 1]!.sourceSequence;
    expect(gapStep).toBe(9); // 8 missed + 1
  });

  test("determinism: the same scenario replays byte-identically (the replay guarantee)", () => {
    const a = runScenarioWindow("drop", 80);
    const b = runScenarioWindow("drop", 80);
    expect(a.length).toBe(b.length);
    for (let index = 0; index < a.length; index += 1) {
      expect(b[index]!.entities).toEqual(a[index]!.entities);
      expect(b[index]!.sourceSequence).toBe(a[index]!.sourceSequence);
      expect(b[index]!.eventTimeMs).toBe(a[index]!.eventTimeMs);
      expect(b[index]!.eventsSincePreviousFrame).toEqual(a[index]!.eventsSincePreviousFrame);
    }
  });
});

describe("identity-continuity pinning across the scenarios (L005)", () => {
  const SCENARIOS: LiveScenarioKind[] = [
    "normal",
    "jitter",
    "delay",
    "drop",
    "out-of-order",
    "reconnect",
  ];

  for (const scenario of SCENARIOS) {
    test(`${scenario}: the entityRef set is invariant + undetected carries pin exact positions`, () => {
      const frames = runScenarioWindow(scenario);
      // The identity set is INVARIANT from the first frame (the canonical
      // refs never churn — 11 + 11 + 1 referee + 1 ball).
      const firstIds = frames[0]!.entities.map((entity) => entity.entityRef).sort();
      expect(firstIds).toHaveLength(24);
      expect(new Set(firstIds).size).toBe(24);
      for (const frame of frames) {
        expect(frame.entities.map((entity) => entity.entityRef).sort()).toEqual(firstIds);
      }

      // The honest carry, PINNED: an undetected entity's position EQUALS
      // its position in the PREVIOUS frame (the carry is verbatim — never
      // a drift, never a removal; the position only changes on detection).
      for (let index = 0; index < frames.length; index += 1) {
        const frame = frames[index]!;
        if (index === 0) continue; // frame 0 seeds the carried positions
        const previousById = new Map(
          frames[index - 1]!.entities.map((entity) => [entity.entityRef, entity]),
        );
        for (const entity of frame.entities) {
          if (!entity.detected) {
            const previous = previousById.get(entity.entityRef);
            expect(previous).toBeDefined();
            expect(entity.xMeters).toBe(previous!.xMeters);
            expect(entity.yMeters).toBe(previous!.yMeters);
            // A first-appearance miss carries staleForMs 0 (observed now,
            // not detected); a carried miss grows it — both are >= 0.
            expect(entity.staleForMs).toBeGreaterThanOrEqual(0);
            expect(entity.confidence).toBeLessThan(1);
          }
        }
      }
      // Over a full window some honest miss exists in every scenario (the
      // per-entity visibility model), and at least one is REGAINED.
      const undetectedCount = frames.reduce(
        (sum, frame) => sum + frame.entities.filter((entity) => !entity.detected).length,
        0,
      );
      expect(undetectedCount).toBeGreaterThan(0);
      expect(
        frames.some((frame) =>
          frame.eventsSincePreviousFrame.some((event) => event.type === "entity-regained"),
        ),
      ).toBe(true);

      // The view is LIVE, not a still: positions visibly change.
      const first = frames[0]!;
      const later = frames[Math.min(frames.length - 1, 30)]!;
      const firstById = new Map(first.entities.map((entity) => [entity.entityRef, entity]));
      let moved = 0;
      for (const entity of later.entities) {
        const before = firstById.get(entity.entityRef)!;
        if (Math.abs(before.xMeters - entity.xMeters) > 0.01) moved += 1;
      }
      expect(moved).toBeGreaterThan(0);

      // The projection keeps the identity visible: every marker's label is
      // the stable pure function of its ref.
      const { markers } = projectTacticalFrame(later.entities, { width: 840, height: 544 });
      for (const marker of markers) {
        expect(marker.label).toBe(entityMarkerLabel(marker.entityRef));
      }
    });
  }
});
