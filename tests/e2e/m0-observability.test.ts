/**
 * M0 observability e2e — the W007 acceptance proof (sibling of the W003
 * harness template `tests/e2e/m0-pipeline.test.ts`, which it follows without
 * editing).
 *
 * ONE session, traced across EVERY pipeline stage of architecture-lock §12:
 *
 *   ingestion -> perception -> fusion -> world-model -> rendering -> delivery
 *
 * Each stage runs the REAL packages (@sporta/session lifecycle,
 * @sporta/observation store/derivation, @sporta/world-model engine) through
 * the @sporta/testing deterministic fixtures, and every stage records its
 * span, its structured log line, and its metrics under ONE correlation
 * context. The final section then proves the acceptance criterion — "a
 * single session can be traced conceptually across every stage":
 *
 * - every collected log line parses as JSON and carries the SAME
 *   correlationId/traceId/sessionId;
 * - the recorder's spans cover all 6 stages, in order, under the same ids;
 * - the trace summary contains p50/p95 latency per stage;
 * - the metrics counters match the counts the slice actually produced;
 * - a final `stageLag` report over the stage watermarks computes
 *   non-negative lags against the canonical media timeline.
 *
 * HARNESS RULES (docs/testing/HARNESS.md):
 *
 * - every random value comes from `@sporta/testing` seeded builders —
 *   no `Math.random`, no `Date.now`;
 * - every span start/end and every log `ts` is an EXPLICIT millisecond
 *   constant (the logger and span times use injected fixed clocks);
 * - only PUBLIC package APIs are exercised.
 */
import { describe, expect, test } from "bun:test";
import {
  METRIC_NAMES,
  MetricsRegistry,
  TraceRecorder,
  bindLogger,
  createCorrelationContext,
  createLogger,
  fromStageMessage,
  stageLag,
  watermarkLagReport,
} from "@sporta/observability";
import type { LogRecord, Span } from "@sporta/observability";
import {
  EventDerivationService,
  InMemoryObservationStore,
  MISSING_CONFIDENCE_DEFAULT,
} from "@sporta/observation";
import { RightsDeniedError, SessionLifecycle } from "@sporta/session";
import { WorldModelEngine, auditTrail, uncertain, unknownValue } from "@sporta/world-model";
import {
  TEST_EPOCH_MS,
  buildAuthorizationPolicy,
  buildMediaSession,
  buildRenderRequest,
  buildStageMessage,
  buildWorldSnapshot,
  observationTimeline,
  seedFromString,
} from "@sporta/testing";
import type { Observation, WorldEntity } from "@sporta/contracts";

// --- Fixed slice constants -------------------------------------------------

/** Named seed: every builder below draws from this one reproducible seed. */
const E2E_SEED = seedFromString("m0-observability");
const SESSION_ID = "sess-m0-obs";
const POLICY_ID = "policy-m0-obs";
const SOURCE_ID = "src-m0-cam-1";

/** Deterministic observation timeline: 12 observations, one per second. */
const TIMELINE_COUNT = 12;
const TIMELINE_STEP_MS = 1_000;

/** The goal under test: seen between 2.0s and 2.5s on the canonical timeline. */
const GOAL_START_MS = 2_000;
const GOAL_END_MS = 2_500;

/** Media-timeline position of the last appended observation (0..11s). */
const LAST_OBSERVATION_MS = 11_000;

/**
 * The six stages of the traced slice, in pipeline order — the exact list the
 * acceptance assertions check spans, logs, and lag against.
 */
const STAGES = [
  "ingestion",
  "perception",
  "fusion",
  "world-model",
  "rendering",
  "delivery",
] as const;

// --- Fixed processing-clock constants (deterministic ms, no Date.now) ------

const T_INGESTION_START = 1_000;
const T_INGESTION_END = 1_080; // latency 80ms
const T_PERCEPTION_START = 1_200;
const T_PERCEPTION_END = 1_560; // latency 360ms (model inference proxy)
const T_FUSION_START = 1_700;
const T_FUSION_END = 1_780; // latency 80ms
const T_WORLD_MODEL_START = 1_900;
const T_WORLD_MODEL_END = 2_140; // latency 240ms
const T_RENDERING_START = 2_300;
const T_RENDERING_END = 2_900; // latency 600ms
const T_DELIVERY_START = 3_000;
const T_DELIVERY_END = 3_080; // latency 80ms

/** Per-stage latencies implied by the constants above (asserted later). */
const EXPECTED_LATENCY_MS: Record<(typeof STAGES)[number], number> = {
  ingestion: T_INGESTION_END - T_INGESTION_START,
  perception: T_PERCEPTION_END - T_PERCEPTION_START,
  fusion: T_FUSION_END - T_FUSION_START,
  "world-model": T_WORLD_MODEL_END - T_WORLD_MODEL_START,
  rendering: T_RENDERING_END - T_RENDERING_START,
  delivery: T_DELIVERY_END - T_DELIVERY_START,
};

/** The "now" the final watermark-lag report is computed against. */
const REPORT_NOW_MS = 12_000;

describe("M0 observability e2e: one session traced across every stage", () => {
  test("full deterministic trace over the real pipeline packages", () => {
    // -----------------------------------------------------------------------
    // Section 0 — observability wiring: correlation, logger, recorder, metrics.
    // -----------------------------------------------------------------------

    // ONE correlation context for the whole session: default counter ids
    // (deterministic); a deployment would inject uuids here.
    const ctx = createCorrelationContext(SESSION_ID);
    expect(ctx.sessionId).toBe(SESSION_ID);

    // Log lines are collected by an array sink; the clock is a fixed
    // TEST_EPOCH_MS-derived sequence so every `ts` is deterministic.
    const lines: string[] = [];
    let logClock = TEST_EPOCH_MS;
    const logger = createLogger({
      minLevel: "debug",
      sink: (line) => lines.push(line),
      now: () => {
        logClock += 1;
        return logClock;
      },
    });

    const recorder = new TraceRecorder(ctx);
    const metrics = new MetricsRegistry();

    /** Ends a stage span at a fixed time and records its latency metric. */
    const completeStage = (span: Span, atMs: number): void => {
      recorder.endSpan(span, { atMs });
      if (span.latencyMs === undefined) {
        throw new Error(`span for stage "${span.stage}" was not completed`);
      }
      metrics.histogram(METRIC_NAMES.stageLatencyMs).observe(span.latencyMs);
    };

    /** Stage-bound structured logger: one line per stage, all carrying ctx. */
    const stageLog = (stage: (typeof STAGES)[number]) => bindLogger(logger, ctx, stage);

    // -----------------------------------------------------------------------
    // Section 1 — stage `ingestion`: session created/authorized (session
    // lifecycle), span started/ended, structured log line with stage+ctx.
    // -----------------------------------------------------------------------

    const spanIngestion = recorder.startSpan("ingestion", T_INGESTION_START);

    const policy = buildAuthorizationPolicy(
      {
        policyId: POLICY_ID,
        allowedOperations: ["analysis", "transformation", "storage"],
      },
      E2E_SEED,
    );

    const created = buildMediaSession(
      {
        sessionId: SESSION_ID,
        authorizationPolicyId: POLICY_ID,
        sources: [
          {
            sourceId: SOURCE_ID,
            kind: "file",
            container: "mp4",
            videoStreams: 1,
            audioStreams: 1,
            durationMs: 60_000,
            declaredRightsPolicyId: POLICY_ID,
          },
        ],
      },
      E2E_SEED,
    );
    expect(created.status).toBe("created");

    const NOW = new Date(TEST_EPOCH_MS);
    const lifecycle = new SessionLifecycle({ now: () => NOW });

    // Fail-closed first: no policy, no authorization (architecture-lock §11).
    expect(() =>
      new SessionLifecycle({ now: () => NOW }).transition(created, "authorized"),
    ).toThrow(RightsDeniedError);

    const authorized = lifecycle.transition(created, "authorized", { policy });
    expect(authorized.status).toBe("authorized");

    const ingesting = lifecycle.transition(authorized, "ingesting");
    expect(ingesting.status).toBe("ingesting");
    expect(ingesting.sessionId).toBe(SESSION_ID);

    metrics.counter("sessions_authorized").inc();
    stageLog("ingestion").info("session authorized and ingesting", {
      stageStatus: ingesting.processingState.stage,
      sources: 1,
    });
    completeStage(spanIngestion, T_INGESTION_END);

    // -----------------------------------------------------------------------
    // Section 2 — stage `perception`: observation timeline appended to the
    // store; span + log + metrics (observations counter, model latency).
    // -----------------------------------------------------------------------

    const spanPerception = recorder.startSpan("perception", T_PERCEPTION_START);

    const observations = observationTimeline({
      count: TIMELINE_COUNT,
      fromMs: 0,
      stepMs: TIMELINE_STEP_MS,
      sessionId: SESSION_ID,
      seed: E2E_SEED,
    });
    expect(observations).toHaveLength(TIMELINE_COUNT);

    const observationAt = (index: number): Observation => {
      const observation = observations[index];
      if (observation === undefined) {
        throw new Error(`fixture observation ${index} missing from the timeline`);
      }
      return observation;
    };

    const store = new InMemoryObservationStore();
    for (const observation of observations) {
      expect(store.append(observation)).toBe("appended");
    }
    expect(store.count()).toBe(TIMELINE_COUNT);

    metrics.counter("observations_ingested").inc(TIMELINE_COUNT);
    metrics.histogram(METRIC_NAMES.modelLatencyMs).observe(T_PERCEPTION_END - T_PERCEPTION_START);
    stageLog("perception").info("observation timeline appended", {
      observations: store.count(),
      throughMs: observationAt(TIMELINE_COUNT - 1).eventTimeMs,
    });
    completeStage(spanPerception, T_PERCEPTION_END);

    // -----------------------------------------------------------------------
    // Section 3 — stage `fusion`: event derived (+ versioned correction);
    // span + log + events counter.
    // -----------------------------------------------------------------------

    const spanFusion = recorder.startSpan("fusion", T_FUSION_START);

    const derivation = new EventDerivationService(store);
    const evidenceIds = [observationAt(2).observationId, observationAt(3).observationId];
    const goalDerivation = {
      sessionId: SESSION_ID,
      eventId: "evt-m0-obs-goal",
      eventTypeRef: "football/v1/goal",
      interval: { startTimeMs: GOAL_START_MS, endTimeMs: GOAL_END_MS },
      eventTimeMs: GOAL_END_MS,
      evidence: { observationIds: evidenceIds },
    };

    const goalEvent = derivation.deriveEvent(goalDerivation);
    expect(goalEvent.provenance).toBe("DERIVED");
    expect(goalEvent.sessionId).toBe(SESSION_ID);
    const expectedConfidence = Math.min(
      ...evidenceIds.map((id) => store.byId(id)?.confidence ?? MISSING_CONFIDENCE_DEFAULT),
    );
    expect(goalEvent.confidence).toBe(expectedConfidence);

    const goalCorrection = derivation.deriveEvent({
      ...goalDerivation,
      eventId: "evt-m0-obs-goal-v2",
      correctionOf: "evt-m0-obs-goal",
      confidence: 0.95,
    });
    expect(goalCorrection.correctionOf).toBe("evt-m0-obs-goal");

    metrics.counter("events_derived").inc(2);
    stageLog("fusion").info("goal event derived from evidence", {
      evidence: evidenceIds.length,
      confidence: goalEvent.confidence,
    });
    completeStage(spanFusion, T_FUSION_END);

    // -----------------------------------------------------------------------
    // Section 4 — stage `world-model`: entities upserted + events applied +
    // snapshot; span + log.
    // -----------------------------------------------------------------------

    const spanWorldModel = recorder.startSpan("world-model", T_WORLD_MODEL_START);

    const snapshotFixture = buildWorldSnapshot(undefined, E2E_SEED);
    const initialFootball = snapshotFixture.football;
    if (initialFootball === undefined) {
      throw new Error("fixture snapshot is missing its football state");
    }

    const engine = WorldModelEngine.create(SESSION_ID, {
      now: () => TEST_EPOCH_MS,
      football: initialFootball,
    });

    const ball: WorldEntity = {
      entityId: "ball-1",
      kind: "ball",
      version: 1,
      lastEventTimeMs: 1_000,
      state: { pitchPosition: uncertain({ x: 52.5, y: 34 }, 0.8) },
    };
    expect(engine.upsertEntity(ball).version).toBe(1);
    expect(
      engine.upsertEntity({
        ...ball,
        lastEventTimeMs: 4_000,
        state: { pitchPosition: uncertain({ x: 60, y: 30 }, 0.75) },
      }).version,
    ).toBe(2);
    engine.upsertEntity({
      entityId: "player-7",
      kind: "participant",
      version: 1,
      lastEventTimeMs: 1_500,
      state: { pitchPosition: unknownValue() },
    });

    const goalEntry = engine.applyEvent(goalEvent, { affectedEntityIds: ["ball-1"] });
    expect(goalEntry.sequence).toBe(1);
    const correctionEntry = engine.applyEvent(goalCorrection, {
      affectedEntityIds: ["ball-1"],
    });
    expect(correctionEntry.sequence).toBe(2);

    engine.setScore(1, 0);
    engine.setPossession("player-7", 0.7);

    const finalSnapshot = engine.snapshot();
    expect(finalSnapshot.sessionId).toBe(SESSION_ID);
    expect(finalSnapshot.watermark).toEqual({ watermarkMs: 4_000, sequence: 2 });

    const trail = auditTrail(engine);
    expect(trail.events).toBe(2);

    stageLog("world-model").info("world model updated", {
      entities: trail.entities.length,
      events: trail.events,
      watermarkMs: finalSnapshot.watermark.watermarkMs,
    });
    completeStage(spanWorldModel, T_WORLD_MODEL_END);

    // -----------------------------------------------------------------------
    // Section 5 — stage `rendering` (simulated): render request built from the
    // engine state, stage message emitted with the SAME correlation context;
    // span + log + renderer latency metric.
    // -----------------------------------------------------------------------

    const spanRendering = recorder.startSpan("rendering", T_RENDERING_START);

    const renderRequest = buildRenderRequest(
      {
        sessionId: SESSION_ID,
        snapshotVersion: engine.snapshotVersion,
        eventsSinceSequence: correctionEntry.sequence,
      },
      E2E_SEED,
    );
    expect(renderRequest.sessionId).toBe(SESSION_ID);

    // The stage message carries the correlation context across the stage
    // boundary (streaming contract); the receiving side re-extracts it.
    const renderMessage = buildStageMessage(
      {
        sessionId: SESSION_ID,
        sequence: 1,
        watermark: finalSnapshot.watermark,
        payload: { kind: "render-request", renderRequest },
        correlationId: ctx.correlationId,
        traceId: ctx.traceId,
      },
      E2E_SEED,
    );
    expect(fromStageMessage(renderMessage)).toEqual(ctx);

    metrics.histogram(METRIC_NAMES.rendererLatencyMs).observe(T_RENDERING_END - T_RENDERING_START);
    stageLog("rendering").info("render request built and stage message emitted", {
      rendererId: renderRequest.rendererId,
      snapshotVersion: renderRequest.snapshotVersion,
    });
    completeStage(spanRendering, T_RENDERING_END);

    // -----------------------------------------------------------------------
    // Section 6 — stage `delivery` (simulated): rendered segment handed to the
    // delivery surface; span + log + e2e latency metric (ingestion start ->
    // delivery end, the glass-to-glass proxy).
    // -----------------------------------------------------------------------

    const spanDelivery = recorder.startSpan("delivery", T_DELIVERY_START);

    metrics.histogram(METRIC_NAMES.e2eLatencyMs).observe(T_DELIVERY_END - T_INGESTION_START);
    stageLog("delivery").info("rendered segment delivered", {
      segments: 1,
      manifestReady: true,
    });
    completeStage(spanDelivery, T_DELIVERY_END);

    // -----------------------------------------------------------------------
    // Section 7 — ACCEPTANCE: the single session is traceable across every
    // stage (architecture-lock §12, work item W007).
    // -----------------------------------------------------------------------

    // 7a. Every collected log line parses as JSON and carries the SAME
    // correlation id, trace id, and session id — one line per stage.
    expect(lines).toHaveLength(STAGES.length);
    const records: LogRecord[] = [];
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      records.push(JSON.parse(line) as LogRecord);
    }
    expect(records.map((record) => record.stage)).toEqual([...STAGES]);
    for (const record of records) {
      expect(record.sessionId).toBe(ctx.sessionId);
      expect(record.correlationId).toBe(ctx.correlationId);
      expect(record.traceId).toBe(ctx.traceId);
      expect(record.msg.length).toBeGreaterThan(0);
    }
    // The injected fixed clock made every `ts` deterministic.
    const expectedTs = Array.from({ length: STAGES.length }, (_, i) => TEST_EPOCH_MS + i + 1);
    expect(records.map((record) => record.ts)).toEqual(expectedTs);

    // 7b. Spans cover all six stages, in pipeline order, all under ctx.
    const spans = recorder.spans();
    expect(spans.map((span) => span.stage)).toEqual([...STAGES]);
    for (const span of spans) {
      expect(span.sessionId).toBe(ctx.sessionId);
      expect(span.correlationId).toBe(ctx.correlationId);
      expect(span.traceId).toBe(ctx.traceId);
      expect(span.endMs).toBeDefined();
      expect(span.status).toBe("ok");
    }

    // 7c. The summary contains p50/p95 latency per stage (count 1 each, so
    // both percentiles equal the fixed stage latency).
    const summary = recorder.summary();
    expect(summary.totalSpans).toBe(STAGES.length);
    expect(summary.stages.map((stage) => stage.stage)).toEqual([...STAGES]);
    for (const stage of summary.stages) {
      const expected = EXPECTED_LATENCY_MS[stage.stage as (typeof STAGES)[number]];
      expect(stage.count).toBe(1);
      expect(stage.errors).toBe(0);
      expect(stage.p50LatencyMs).toBe(expected);
      expect(stage.p95LatencyMs).toBe(expected);
    }

    // 7d. Metrics counters match the counts the slice actually produced.
    const snapshot = metrics.snapshot();
    const counterValue = (name: string): number =>
      snapshot.counters
        .filter((counter) => counter.name === name)
        .reduce((sum, counter) => sum + counter.value, 0);
    expect(counterValue("sessions_authorized")).toBe(1);
    expect(counterValue("observations_ingested")).toBe(TIMELINE_COUNT);
    expect(counterValue("events_derived")).toBe(2);

    const histogramStats = (name: string) =>
      snapshot.histograms.find((histogram) => histogram.name === name)?.stats;
    expect(histogramStats(METRIC_NAMES.stageLatencyMs)).toEqual({
      // sorted latencies [60, 80, 80, 240, 360, 600]:
      // p50 = ceil(0.5 * 6) = 3rd -> 80; p95 = ceil(5.7) = 6th -> 600.
      count: 6,
      min: EXPECTED_LATENCY_MS.fusion,
      max: EXPECTED_LATENCY_MS.rendering,
      mean:
        (EXPECTED_LATENCY_MS.ingestion +
          EXPECTED_LATENCY_MS.perception +
          EXPECTED_LATENCY_MS.fusion +
          EXPECTED_LATENCY_MS["world-model"] +
          EXPECTED_LATENCY_MS.rendering +
          EXPECTED_LATENCY_MS.delivery) /
        6,
      p50: 80,
      p95: 600,
    });
    expect(histogramStats(METRIC_NAMES.modelLatencyMs)).toEqual({
      count: 1,
      min: EXPECTED_LATENCY_MS.perception,
      max: EXPECTED_LATENCY_MS.perception,
      mean: EXPECTED_LATENCY_MS.perception,
      p50: EXPECTED_LATENCY_MS.perception,
      p95: EXPECTED_LATENCY_MS.perception,
    });
    expect(histogramStats(METRIC_NAMES.rendererLatencyMs)).toEqual({
      count: 1,
      min: EXPECTED_LATENCY_MS.rendering,
      max: EXPECTED_LATENCY_MS.rendering,
      mean: EXPECTED_LATENCY_MS.rendering,
      p50: EXPECTED_LATENCY_MS.rendering,
      p95: EXPECTED_LATENCY_MS.rendering,
    });
    expect(histogramStats(METRIC_NAMES.e2eLatencyMs)).toEqual({
      count: 1,
      min: T_DELIVERY_END - T_INGESTION_START,
      max: T_DELIVERY_END - T_INGESTION_START,
      mean: T_DELIVERY_END - T_INGESTION_START,
      p50: T_DELIVERY_END - T_INGESTION_START,
      p95: T_DELIVERY_END - T_INGESTION_START,
    });

    // 7e. A final stageLag report over the stage watermarks computes
    // NON-NEGATIVE lags against one canonical "now" (streaming contract /
    // architecture.md §7). Watermarks reflect what each stage consumed:
    // ingestion and perception the full 11s timeline, fusion the evidence
    // horizon, the SWM-consuming stages the snapshot watermark.
    const stageWatermarks = [
      { stage: "ingestion", watermarkMs: LAST_OBSERVATION_MS },
      { stage: "perception", watermarkMs: LAST_OBSERVATION_MS },
      { stage: "fusion", watermarkMs: observationAt(3).eventTimeMs },
      { stage: "world-model", watermarkMs: finalSnapshot.watermark.watermarkMs },
      { stage: "rendering", watermarkMs: finalSnapshot.watermark.watermarkMs },
      { stage: "delivery", watermarkMs: finalSnapshot.watermark.watermarkMs },
    ];
    const lagReport = watermarkLagReport(stageWatermarks, REPORT_NOW_MS);
    expect(Object.keys(lagReport).sort()).toEqual([...STAGES].sort());
    for (const lag of Object.values(lagReport)) {
      expect(lag).toBeGreaterThanOrEqual(0);
    }
    expect(lagReport).toEqual({
      ingestion: 1_000,
      perception: 1_000,
      fusion: 9_000,
      "world-model": 8_000,
      rendering: 8_000,
      delivery: 8_000,
    });
    expect(stageLag("perception", LAST_OBSERVATION_MS, REPORT_NOW_MS)).toBe(1_000);
  });
});
