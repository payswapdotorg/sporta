/**
 * THE LIVE TELEMETRY CORE TESTS (L006) — the frozen live-reality.md §9
 * counters, driven DETERMINISTICALLY: a pinned injectable clock with
 * scenario-shaped stage delays produces EXACT counter values (the acceptance
 * battery — no wall clock, no fabricated timestamps, every number derived
 * from the seams' own reports).
 *
 * THE DRIVEN PIPELINE (exactly the seams the plumbing wires):
 * ```
 * noteIngested(pulledAtMs → ingestedAtMs)
 *   → noteWorldStateUpdated(swmAtMs)
 *   → noteFrameRendered(renderedAtMs)
 *   → noteFramePresented(presentedAtMs)
 * ```
 * fed by REAL L002 observations per scenario (normal / drop / reconnect /
 * out-of-order / jitter / delay) — the same deterministic sequences the
 * source's own battery pins.
 */
import { describe, expect, test } from "bun:test";
import {
  LIVE_TELEMETRY_COUNTER_IDS,
  LiveTelemetryCollector,
  createDeterministicLiveSource,
  drainSource,
} from "../src/index";
import type { LiveObservation, LiveTelemetrySnapshot } from "../src/index";

const BASE = {
  sessionId: "sess-l006-telemetry",
  seed: 4242,
  tickCount: 120,
  rateMs: 100,
  playersPerTeam: 6,
  referees: 1,
} as const;

/** A pinned clock the stage drives explicitly (deterministic by construction). */
class PinnedClock {
  current = 1_000_000;
  nowMs(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

/** The deterministic per-stage delay profile (the scenario-shaped plumbing). */
interface StageDelays {
  /** Ingest seam work per observation (source-to-ingest span). */
  ingestMs: number;
  /** The world-state update per observation (ingest-to-SWM span). */
  swmMs: number;
  /** The frame render per observation (SWM-to-render span). */
  renderMs: number;
  /** The transport delivery per frame (render-to-presented span). */
  presentMs: number;
}

const ZERO_DELAYS: StageDelays = { ingestMs: 0, swmMs: 0, renderMs: 0, presentMs: 0 };

/**
 * Drives the FULL pipeline over every observation of one scenario with the
 * given stage delays — the exact sequence of collector calls the apps/web
 * plumbing makes per frame.
 */
function drivePipeline(
  observations: readonly LiveObservation[],
  delays: StageDelays,
  sessionId = BASE.sessionId,
): LiveTelemetrySnapshot {
  const clock = new PinnedClock();
  const collector = new LiveTelemetryCollector({ sessionId, nowMs: () => clock.nowMs() });
  for (const observation of observations) {
    const pulledAtMs = clock.nowMs();
    clock.advance(delays.ingestMs);
    const ingestedAtMs = clock.nowMs();
    collector.noteIngested({ observation, pulledAtMs, ingestedAtMs });
    clock.advance(delays.swmMs);
    collector.noteWorldStateUpdated(observation, { swmAtMs: clock.nowMs() });
    clock.advance(delays.renderMs);
    collector.noteFrameRendered(observation, { renderedAtMs: clock.nowMs() });
    clock.advance(delays.presentMs);
    collector.noteFramePresented(observation, { presentedAtMs: clock.nowMs() });
  }
  return collector.snapshot();
}

function observationsOf(
  scenario: Parameters<typeof createDeterministicLiveSource>[0]["scenario"],
): LiveObservation[] {
  return drainSource(createDeterministicLiveSource({ ...BASE, scenario }));
}

describe("the §9 vocabulary (the frozen contract's own names)", () => {
  test("the counter ids are exactly the frozen §9 list, verbatim", () => {
    expect(LIVE_TELEMETRY_COUNTER_IDS).toEqual([
      "source-to-ingest-latency",
      "ingest-to-swm-latency",
      "swm-to-render-latency",
      "end-to-end-presentation-latency",
      "watermark-lag",
      "dropped-observations",
      "extrapolated-observations",
      "identity-switches",
      "reconnects",
      "renderer-frame-drops",
      "effective-update-rate",
    ]);
  });

  test("every snapshot member is keyed by a frozen counter id", () => {
    const snapshot = drivePipeline(observationsOf("normal").slice(0, 5), ZERO_DELAYS);
    const counterIds = new Set<string>(LIVE_TELEMETRY_COUNTER_IDS);
    const seen: string[] = [
      snapshot.latencies.sourceToIngest.counterId,
      snapshot.latencies.ingestToSwm.counterId,
      snapshot.latencies.swmToRender.counterId,
      snapshot.latencies.endToEndPresentation.counterId,
      snapshot.watermarkLag.counterId,
      snapshot.droppedObservations.counterId,
      snapshot.extrapolatedObservations.counterId,
      snapshot.identitySwitches.counterId,
      snapshot.reconnects.counterId,
      snapshot.frameDrops.counterId,
      snapshot.effectiveUpdateRate.counterId,
    ];
    expect(seen.length).toBe(LIVE_TELEMETRY_COUNTER_IDS.length);
    for (const id of seen) expect(counterIds.has(id)).toBe(true);
  });
});

describe("the stage latencies (exact values under a pinned clock)", () => {
  const delays: StageDelays = { ingestMs: 3, swmMs: 11, renderMs: 7, presentMs: 19 };
  const observations = observationsOf("normal");
  const snapshot = drivePipeline(observations, delays);

  test("source-to-ingest is exactly the ingest seam's span, per observation", () => {
    expect(snapshot.latencies.sourceToIngest.stats.count).toBe(observations.length);
    expect(snapshot.latencies.sourceToIngest.stats.sumMs).toBe(
      delays.ingestMs * observations.length,
    );
    expect(snapshot.latencies.sourceToIngest.stats.minMs).toBe(delays.ingestMs);
    expect(snapshot.latencies.sourceToIngest.stats.maxMs).toBe(delays.ingestMs);
    expect(snapshot.latencies.sourceToIngest.stats.lastMs).toBe(delays.ingestMs);
  });

  test("ingest-to-SWM is exactly the world-state update span", () => {
    expect(snapshot.latencies.ingestToSwm.stats.count).toBe(observations.length);
    expect(snapshot.latencies.ingestToSwm.stats.sumMs).toBe(delays.swmMs * observations.length);
    expect(snapshot.latencies.ingestToSwm.stats.maxMs).toBe(delays.swmMs);
  });

  test("SWM-to-render is exactly the frame render span", () => {
    expect(snapshot.latencies.swmToRender.stats.count).toBe(observations.length);
    expect(snapshot.latencies.swmToRender.stats.sumMs).toBe(delays.renderMs * observations.length);
  });

  test("end-to-end presentation is the full pipeline span (pull → consumer)", () => {
    const perFrame = delays.ingestMs + delays.swmMs + delays.renderMs + delays.presentMs;
    expect(snapshot.latencies.endToEndPresentation.stats.count).toBe(observations.length);
    expect(snapshot.latencies.endToEndPresentation.stats.sumMs).toBe(
      perFrame * observations.length,
    );
    expect(snapshot.latencies.endToEndPresentation.stats.maxMs).toBe(perFrame);
  });

  test("an unentered stage reports count 0 with null statistics — never a fake 0ms", () => {
    const clock = new PinnedClock();
    const collector = new LiveTelemetryCollector({
      sessionId: BASE.sessionId,
      nowMs: () => clock.nowMs(),
    });
    const snapshot = collector.snapshot();
    for (const stage of [
      snapshot.latencies.sourceToIngest,
      snapshot.latencies.ingestToSwm,
      snapshot.latencies.swmToRender,
      snapshot.latencies.endToEndPresentation,
    ]) {
      expect(stage.stats.count).toBe(0);
      expect(stage.stats.sumMs).toBe(0);
      expect(stage.stats.minMs).toBeNull();
      expect(stage.stats.maxMs).toBeNull();
      expect(stage.stats.lastMs).toBeNull();
    }
    expect(snapshot.effectiveUpdateRate.hz).toBeNull();
    expect(snapshot.effectiveUpdateRate.spanMs).toBeNull();
    expect(snapshot.window.firstIngestedAtMs).toBeNull();
  });

  test("varying stage delays keep exact min/max/last statistics", () => {
    const clock = new PinnedClock();
    const collector = new LiveTelemetryCollector({
      sessionId: BASE.sessionId,
      nowMs: () => clock.nowMs(),
    });
    const observations = observationsOf("normal").slice(0, 4);
    const swmSpans = [5, 2, 9, 2];
    observations.forEach((observation, index) => {
      const pulledAtMs = clock.nowMs();
      collector.noteIngested({ observation, pulledAtMs, ingestedAtMs: pulledAtMs });
      clock.advance(swmSpans[index]!);
      collector.noteWorldStateUpdated(observation, { swmAtMs: clock.nowMs() });
      collector.noteFrameRendered(observation, { renderedAtMs: clock.nowMs() });
      collector.noteFramePresented(observation, { presentedAtMs: clock.nowMs() });
    });
    const stats = collector.snapshot().latencies.ingestToSwm.stats;
    expect(stats.count).toBe(4);
    expect(stats.sumMs).toBe(5 + 2 + 9 + 2);
    expect(stats.minMs).toBe(2);
    expect(stats.maxMs).toBe(9);
    expect(stats.lastMs).toBe(2);
  });
});

describe("the effective update rate (delivered frames over the real span)", () => {
  test("the rate is (frames − 1) over the first→last presentation span", () => {
    const clock = new PinnedClock();
    const collector = new LiveTelemetryCollector({
      sessionId: BASE.sessionId,
      nowMs: () => clock.nowMs(),
    });
    const observations = observationsOf("normal").slice(0, 11);
    for (const observation of observations) {
      const pulledAtMs = clock.nowMs();
      collector.noteIngested({ observation, pulledAtMs, ingestedAtMs: pulledAtMs });
      collector.noteWorldStateUpdated(observation, { swmAtMs: pulledAtMs });
      collector.noteFrameRendered(observation, { renderedAtMs: pulledAtMs });
      clock.advance(100); // 10 Hz presentation cadence
      collector.noteFramePresented(observation, { presentedAtMs: clock.nowMs() });
    }
    const rate = collector.snapshot().effectiveUpdateRate;
    expect(rate.presentedFrames).toBe(11);
    // Presentations land at t=100,200,…,1100 → the first→last span is 1000ms.
    expect(rate.spanMs).toBe(1000);
    // (11 − 1) frames across the 1.0 s span = exactly 10 Hz.
    expect(rate.hz).toBe(10);
  });

  test("fewer than two presentations answer null — never a fabricated rate", () => {
    const clock = new PinnedClock();
    const collector = new LiveTelemetryCollector({
      sessionId: BASE.sessionId,
      nowMs: () => clock.nowMs(),
    });
    const observation = observationsOf("normal")[0]!;
    collector.noteIngested({ observation, pulledAtMs: clock.nowMs(), ingestedAtMs: clock.nowMs() });
    collector.noteWorldStateUpdated(observation, { swmAtMs: clock.nowMs() });
    collector.noteFrameRendered(observation, { renderedAtMs: clock.nowMs() });
    collector.noteFramePresented(observation, { presentedAtMs: clock.nowMs() });
    expect(collector.snapshot().effectiveUpdateRate.hz).toBeNull();
  });
});

describe("scenario 'drop' — dropped observations are visible, counted, gapped", () => {
  const source = createDeterministicLiveSource({ ...BASE, scenario: "drop" });
  const observations = drainSource(source);
  const snapshot = drivePipeline(observations, ZERO_DELAYS);

  test("the counter equals the source's own dropped-tick count (one truth)", () => {
    expect(snapshot.droppedObservations.count).toBe(source.stats().droppedTicks);
    expect(snapshot.droppedObservations.count).toBeGreaterThan(0);
  });

  test("every gap window is the exact missed sequence range", () => {
    const delivered = new Set(observations.map((observation) => observation.sequence));
    const expectedGaps: { fromSequence: number; toSequence: number; missed: number }[] = [];
    let run: number[] = [];
    for (let sequence = 1; sequence <= BASE.tickCount; sequence += 1) {
      if (delivered.has(sequence)) {
        if (run.length > 0) {
          expectedGaps.push({
            fromSequence: run[0]!,
            toSequence: run[run.length - 1]!,
            missed: run.length,
          });
          run = [];
        }
      } else {
        run.push(sequence);
      }
    }
    expect(snapshot.droppedObservations.gaps).toEqual(expectedGaps);
    const totalMissed = expectedGaps.reduce((sum, gap) => sum + gap.missed, 0);
    expect(snapshot.droppedObservations.count).toBe(totalMissed);
  });

  test("every observation still delivers its full stage accounting", () => {
    expect(snapshot.latencies.endToEndPresentation.stats.count).toBe(observations.length);
    expect(snapshot.window.ingestedObservations).toBe(observations.length);
  });
});

describe("scenario 'reconnect' — reconnects and their missed windows", () => {
  const source = createDeterministicLiveSource({ ...BASE, scenario: "reconnect" });
  const observations = drainSource(source);
  const snapshot = drivePipeline(observations, ZERO_DELAYS);

  test("the reconnect count equals the recovery members the stream carried", () => {
    const recoveries = observations.filter((observation) => observation.recovery !== undefined);
    expect(snapshot.reconnects.count).toBe(recoveries.length);
    expect(snapshot.reconnects.count).toBeGreaterThan(0);
  });

  test("the missed-update total is the recovery members' own accounting", () => {
    const expected = observations.reduce(
      (sum, observation) => sum + (observation.recovery?.missedUpdates ?? 0),
      0,
    );
    expect(snapshot.reconnects.missedUpdates).toBe(expected);
    expect(snapshot.reconnects.missedUpdates).toBeGreaterThan(0);
  });

  test("the reconnect gap windows ride the dropped-observations ledger too", () => {
    const gapMissed = snapshot.droppedObservations.gaps.reduce((sum, gap) => sum + gap.missed, 0);
    // On the pure reconnect scenario the missed window is exactly the
    // recovery member's window (no scattered drops ahead of it).
    expect(gapMissed).toBe(snapshot.reconnects.missedUpdates);
  });

  test("the post-reconnect degraded window shows up as extrapolated carries", () => {
    // The reconnect scenario's degraded window emits undetected carries —
    // the extrapolated-observations counter is the honest record of them.
    expect(snapshot.extrapolatedObservations.observations).toBeGreaterThan(0);
    expect(snapshot.extrapolatedObservations.entityRows).toBeGreaterThan(0);
  });
});

describe("watermark lag (the observation's own dual-clock data)", () => {
  test("the normal scenario carries zero lag", () => {
    const snapshot = drivePipeline(observationsOf("normal"), ZERO_DELAYS);
    expect(snapshot.watermarkLag.lastMs).toBe(0);
    expect(snapshot.watermarkLag.maxMs).toBe(0);
    expect(snapshot.watermarkLag.observationsWithLag).toBe(0);
  });

  test("the out-of-order scenario's held watermark lags — last and max are the real data", () => {
    const observations = observationsOf("out-of-order");
    let maxLag = 0;
    let lastLag = 0;
    let withLag = 0;
    for (const observation of observations) {
      const lag = Math.max(0, observation.eventTimeMs - observation.watermark.watermarkMs);
      maxLag = Math.max(maxLag, lag);
      lastLag = lag;
      if (lag > 0) withLag += 1;
    }
    const snapshot = drivePipeline(observations, ZERO_DELAYS);
    expect(snapshot.watermarkLag.lastMs).toBe(lastLag);
    expect(snapshot.watermarkLag.maxMs).toBe(maxLag);
    expect(snapshot.watermarkLag.observationsWithLag).toBe(withLag);
    expect(maxLag).toBeGreaterThan(0);
  });
});

describe("extrapolated observations (the honest undetected carries)", () => {
  test("the counter matches the stream's own undetected rows", () => {
    const observations = observationsOf("reconnect");
    const expectedObservations = observations.filter((observation) =>
      observation.entityObservations.some((row) => !row.detected),
    ).length;
    const expectedRows = observations.reduce(
      (sum, observation) =>
        sum + observation.entityObservations.filter((row) => !row.detected).length,
      0,
    );
    const snapshot = drivePipeline(observations, ZERO_DELAYS);
    expect(snapshot.extrapolatedObservations.observations).toBe(expectedObservations);
    expect(snapshot.extrapolatedObservations.entityRows).toBe(expectedRows);
  });

  test("the SWM stage's own carry accounting refines the count (never adds)", () => {
    const clock = new PinnedClock();
    const collector = new LiveTelemetryCollector({
      sessionId: BASE.sessionId,
      nowMs: () => clock.nowMs(),
    });
    const observation = observationsOf("normal")[0]!;
    const pulledAtMs = clock.nowMs();
    collector.noteIngested({ observation, pulledAtMs, ingestedAtMs: pulledAtMs });
    // The stage counts 1 carry row (its own authoritative number).
    collector.noteWorldStateUpdated(observation, {
      swmAtMs: pulledAtMs,
      extrapolatedEntityRows: 1,
    });
    collector.noteFrameRendered(observation, { renderedAtMs: pulledAtMs });
    collector.noteFramePresented(observation, { presentedAtMs: pulledAtMs });
    const snapshot = collector.snapshot();
    expect(snapshot.extrapolatedObservations.entityRows).toBe(1);
  });
});

describe("identity switches (track-id rebindings, counted)", () => {
  function observationOver(overrides: {
    sequence: number;
    trackId: string;
    entityRef: string;
  }): LiveObservation {
    const base = observationsOf("normal")[0]!;
    return {
      ...base,
      sequence: overrides.sequence,
      entityObservations: base.entityObservations.slice(0, 1).map((row) => ({
        ...row,
        entityRef: overrides.entityRef,
        sourceLocalTrackId: overrides.trackId,
      })),
    };
  }

  test("a stable binding counts zero switches", () => {
    const clock = new PinnedClock();
    const collector = new LiveTelemetryCollector({
      sessionId: BASE.sessionId,
      nowMs: () => clock.nowMs(),
    });
    for (const sequence of [1, 2, 3]) {
      const observation = observationOver({ sequence, trackId: "track-7", entityRef: "entity-a" });
      collector.noteIngested({
        observation,
        pulledAtMs: clock.nowMs(),
        ingestedAtMs: clock.nowMs(),
      });
    }
    expect(collector.snapshot().identitySwitches.count).toBe(0);
  });

  test("one track rebinding onto another entity counts exactly one switch", () => {
    const clock = new PinnedClock();
    const collector = new LiveTelemetryCollector({
      sessionId: BASE.sessionId,
      nowMs: () => clock.nowMs(),
    });
    const first = observationOver({ sequence: 1, trackId: "track-7", entityRef: "entity-a" });
    collector.noteIngested({
      observation: first,
      pulledAtMs: clock.nowMs(),
      ingestedAtMs: clock.nowMs(),
    });
    const rebound = observationOver({ sequence: 2, trackId: "track-7", entityRef: "entity-b" });
    collector.noteIngested({
      observation: rebound,
      pulledAtMs: clock.nowMs(),
      ingestedAtMs: clock.nowMs(),
    });
    const snapshot = collector.snapshot();
    expect(snapshot.identitySwitches.count).toBe(1);
  });
});

describe("renderer frame drops (the counted transport losses)", () => {
  test("drops accumulate exactly as counted", () => {
    const clock = new PinnedClock();
    const collector = new LiveTelemetryCollector({
      sessionId: BASE.sessionId,
      nowMs: () => clock.nowMs(),
    });
    collector.noteFrameDrops(0);
    collector.noteFrameDrops(3);
    collector.noteFrameDrops(1);
    expect(collector.snapshot().frameDrops.count).toBe(4);
  });

  test("a negative or fractional drop count fails loud (never a wrong counter)", () => {
    const collector = new LiveTelemetryCollector({
      sessionId: BASE.sessionId,
      nowMs: () => 0,
    });
    expect(() => collector.noteFrameDrops(-1)).toThrow();
    expect(() => collector.noteFrameDrops(1.5)).toThrow();
  });
});

describe("plumbing integrity (fail-loud on a broken pipeline)", () => {
  test("a stage report for an unknown observation fails loud", () => {
    const collector = new LiveTelemetryCollector({
      sessionId: BASE.sessionId,
      nowMs: () => 0,
    });
    const observation = observationsOf("normal")[0]!;
    expect(() => collector.noteWorldStateUpdated(observation, { swmAtMs: 0 })).toThrow();
  });

  test("a render report without its SWM-stage record fails loud (a skipped stage is never 0ms)", () => {
    const collector = new LiveTelemetryCollector({
      sessionId: BASE.sessionId,
      nowMs: () => 0,
    });
    const observation = observationsOf("normal")[0]!;
    collector.noteIngested({ observation, pulledAtMs: 0, ingestedAtMs: 0 });
    expect(() => collector.noteFrameRendered(observation, { renderedAtMs: 5 })).toThrow();
  });

  test("a presentation report for an already-released observation fails loud", () => {
    const collector = new LiveTelemetryCollector({
      sessionId: BASE.sessionId,
      nowMs: () => 0,
    });
    const observation = observationsOf("normal")[0]!;
    collector.noteIngested({ observation, pulledAtMs: 0, ingestedAtMs: 0 });
    collector.noteWorldStateUpdated(observation, { swmAtMs: 0 });
    collector.noteFrameRendered(observation, { renderedAtMs: 0 });
    collector.noteFramePresented(observation, { presentedAtMs: 0 });
    expect(() => collector.noteFramePresented(observation, { presentedAtMs: 1 })).toThrow();
  });

  test("a clock-inverted ingest report fails loud", () => {
    const collector = new LiveTelemetryCollector({
      sessionId: BASE.sessionId,
      nowMs: () => 0,
    });
    const observation = observationsOf("normal")[0]!;
    expect(() =>
      collector.noteIngested({ observation, pulledAtMs: 10, ingestedAtMs: 5 }),
    ).toThrow();
  });
});

describe("mixed drop-then-reconnect accounting (the edge the ledger must not miss)", () => {
  test("scattered drops ahead of a reconnect window are counted separately from the recovery", () => {
    const clock = new PinnedClock();
    const collector = new LiveTelemetryCollector({
      sessionId: BASE.sessionId,
      nowMs: () => clock.nowMs(),
    });
    const base = observationsOf("normal")[0]!;
    const at = (sequence: number, recovery?: LiveObservation["recovery"]): LiveObservation => ({
      ...base,
      sequence,
      ...(recovery !== undefined ? { recovery } : {}),
    });
    // Sequences 1..3 delivered; 4..5 scattered drops; 6..8 the reconnect
    // window (accounted by the recovery member on 9); 9 delivered.
    collector.noteIngested({
      observation: at(1),
      pulledAtMs: clock.nowMs(),
      ingestedAtMs: clock.nowMs(),
    });
    collector.noteIngested({
      observation: at(2),
      pulledAtMs: clock.nowMs(),
      ingestedAtMs: clock.nowMs(),
    });
    collector.noteIngested({
      observation: at(3),
      pulledAtMs: clock.nowMs(),
      ingestedAtMs: clock.nowMs(),
    });
    collector.noteIngested({
      observation: at(9, {
        reason: "reconnect",
        fromSequence: 6,
        toSequence: 8,
        missedUpdates: 3,
        gapDurationMs: 300,
      }),
      pulledAtMs: clock.nowMs(),
      ingestedAtMs: clock.nowMs(),
    });
    const snapshot = collector.snapshot();
    // The scattered drops (4..5) fall to the general counter; the reconnect
    // window (6..8) is the recovery member's own accounting.
    expect(snapshot.droppedObservations.count).toBe(2);
    expect(snapshot.reconnects.count).toBe(1);
    expect(snapshot.reconnects.missedUpdates).toBe(3);
  });
});
