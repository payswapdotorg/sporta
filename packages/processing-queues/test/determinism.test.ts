/**
 * Determinism tests (W302) — the constitution's deep-equal rerun proof:
 * "Tests prove deep-equal rerun (whole story ×2: all artifacts/stats/reports
 * deep-equal)."
 *
 * One whole story — a 3-stage pipeline with a retryable failure (deterministic
 * backoff through the injected clock), a non-retryable failure (DLQ), a
 * throwing transform (internal DLQ), a duplicate re-submission, a malformed
 * submit, watermark-boundary checkpoints, and captured observability — is run
 * TWICE with completely fresh objects (fresh clock, fresh stages, fresh
 * registry, fresh logger/metrics). EVERY artifact must deep-equal:
 *
 * - the settled result (outcome + full stats + per-stage stats);
 * - the dead-letter entries, the checkpoints, the rejection ledger;
 * - the emitted output messages (payload, watermark, correlation ids);
 * - the submit outcomes;
 * - the metrics snapshot (counters AND histogram stats);
 * - the full log-record sequence (ts pinned to TEST_EPOCH_MS by the injected
 *   logger clock — line ORDER included);
 * - the retry-backoff sleeps recorded by the injected processing clock.
 *
 * No `Math.random`, no `Date.now`, no real timers anywhere: the story's
 * interleaving is pure microtask scheduling, which is deterministic for the
 * same program, and every timestamp in the artifacts comes from the injected
 * clocks.
 */
import { describe, expect, test } from "bun:test";
import type { StageMessage } from "@sporta/contracts";
import { MalformedSegmentError } from "../src/errors";
import type { PipelineResult } from "../src/types";
import type { MetricsSnapshot, LogRecord } from "@sporta/observability";
import { VirtualProcessingClock } from "../src/clock";
import {
  backgroundConsumer,
  capturedObservability,
  payloadOf,
  segment,
  scriptedStage,
  slowIdentityStage,
  until,
  wiredPipeline,
  expectBalanced,
  RecordingClock,
} from "./helpers";

const SESSION_ID = "sess-w302-det";

/** One complete run of the story; everything the run produced. */
interface StoryArtifacts {
  result: PipelineResult;
  deadLetters: ReturnType<ReturnType<typeof wiredPipeline>["pipeline"]["deadLetters"]>;
  checkpoints: ReturnType<ReturnType<typeof wiredPipeline>["pipeline"]["checkpoints"]>;
  rejections: ReturnType<ReturnType<typeof wiredPipeline>["pipeline"]["rejections"]>;
  emitted: StageMessage[];
  outcomes: Array<{ disposition: string }>;
  metrics: MetricsSnapshot;
  records: LogRecord[];
  sleeps: number[];
}

async function runStory(): Promise<StoryArtifacts> {
  const obs = capturedObservability();
  const clock = new RecordingClock(new VirtualProcessingClock(0));
  const detect = scriptedStage(
    "detect",
    {
      // k1 fails once retryably, then succeeds (deterministic backoff 40).
      k1: { retryable: true, errorClass: "transient", message: "model timeout", times: 1 },
      // k4 fails terminally non-retryably — DLQ, never retried.
      k4: { retryable: false, errorClass: "media-invalid", message: "corrupt payload", times: 99 },
    },
    { maxAttempts: 3, baseDelayMs: 40, backoffMultiplier: 2 },
  );
  // enrich THROWS on k6 — an internal bug, DLQ'd, the pipeline continues;
  // every other segment is payload-marked while its timing stays VERBATIM.
  const enrichThrowing = {
    stage: "enrich",
    transform: async (seg: import("../src/segment").PipelineSegment) => {
      if (seg.idempotencyKey === "k6") {
        throw new Error("null pointer in enrich");
      }
      const payload = seg.payload as Record<string, unknown>;
      return {
        status: "emitted" as const,
        segment: {
          idempotencyKey: seg.idempotencyKey,
          watermark: seg.watermark,
          byteSize: seg.byteSize,
          payload: { ...payload, enriched: true },
        },
      };
    },
  };
  const { pipeline, output } = wiredPipeline({
    sessionId: SESSION_ID,
    stages: [detect.spec, enrichThrowing, slowIdentityStage("pack", 1)],
    queues: [
      { capacity: 3, policy: "block" },
      { capacity: 2, policy: "block" },
      { capacity: 2, policy: "block" },
      { capacity: 4, policy: "block" },
    ],
    clock,
    checkpointEveryMs: 100,
    observability: obs.options,
  });
  pipeline.start();
  const received: StageMessage[] = [];
  const consumer = backgroundConsumer(output, received);

  const outcomes: Array<{ disposition: string }> = [];
  for (let i = 0; i < 8; i += 1) {
    outcomes.push(await pipeline.submit(segment(`k${i}`, i * 40, i)));
  }
  // A duplicate re-submission AFTER k0 reached its terminal disposition.
  expect(await until(() => pipeline.stats().distinctProcessed >= 1)).toBe(true);
  outcomes.push(await pipeline.submit(segment("k0", 0, 0)));
  // A malformed segment (negative watermark) — counted, ledgered, refused.
  try {
    await pipeline.submit(segment("bad", -1));
  } catch (err) {
    if (!(err instanceof MalformedSegmentError)) throw err;
  }

  const result = await pipeline.stop();
  await consumer.done;

  return {
    result,
    deadLetters: pipeline.deadLetters(),
    checkpoints: pipeline.checkpoints(),
    rejections: pipeline.rejections(),
    emitted: received.map((m) => m),
    outcomes,
    metrics: obs.metrics.snapshot(),
    records: obs.records(),
    sleeps: [...clock.sleeps],
  };
}

describe("whole-story determinism — the ×2 deep-equal proof", () => {
  test("every artifact of the story deep-equals across two fresh runs", async () => {
    const first = await runStory();
    const second = await runStory();

    expect(second.result).toEqual(first.result);
    expect(second.deadLetters).toEqual(first.deadLetters);
    expect(second.checkpoints).toEqual(first.checkpoints);
    expect(second.rejections).toEqual(first.rejections);
    expect(second.emitted).toEqual(first.emitted);
    expect(second.outcomes).toEqual(first.outcomes);
    expect(second.metrics).toEqual(first.metrics);
    expect(second.records).toEqual(first.records);
    expect(second.sleeps).toEqual(first.sleeps);

    // The story itself is pinned (not just self-consistent): 8 submits +
    // 1 duplicate + 1 malformed = 10 in = 7 out + 1 rejected + 1 duplicate
    // + 1 dead-lettered (k4; k6's throw is also dead-lettered → 2).
    expectBalanced(first.result, {
      segmentsIn: 10,
      segmentsOut: 6,
      rejected: 1,
      duplicates: 1,
      deadLettered: 2,
    });
    // k4 and k6 dead-lettered; k6's failure is the internal class.
    expect(first.deadLetters.map((e) => e.idempotencyKey)).toEqual(["k4", "k6"]);
    expect(first.deadLetters[1]).toMatchObject({ stage: "enrich", errorClass: "internal" });
    // k1's retry backoff is the exact W104 arithmetic (40 * 2^0), the only
    // sleep the story ever takes.
    expect(first.sleeps).toEqual([40]);
    // The emitted stream: k0..k7 minus k4 and k6, payloads enriched, and
    // watermarks VERBATIM (never re-stamped).
    expect(first.emitted.map((m) => payloadOf(m).idempotencyKey)).toEqual([
      "k0",
      "k1",
      "k2",
      "k3",
      "k5",
      "k7",
    ]);
    expect(first.emitted.map((m) => payloadOf(m).watermark.watermarkMs)).toEqual([
      0, 40, 80, 120, 200, 280,
    ]);
    expect(
      first.emitted.every(
        (m) => (payloadOf(m).payload as { enriched?: boolean }).enriched === true,
      ),
    ).toBe(true);
    // The full log sequence is stable AND bounded (no runaway logging).
    expect(first.records.length).toBeGreaterThan(20);
    expect(first.records.length).toBeLessThan(120);
    expect(first.records.every((r) => r.ts === first.records[0]!.ts)).toBe(true);
  });

  test("a cancel-mode story is equally deterministic (recovery replay shape)", async () => {
    const runCancelStory = async (): Promise<{
      result: PipelineResult;
      rejections: ReturnType<ReturnType<typeof wiredPipeline>["pipeline"]["rejections"]>;
      records: LogRecord[];
    }> => {
      const obs = capturedObservability();
      const { pipeline } = wiredPipeline({
        sessionId: "sess-w302-det-cancel",
        stages: [
          {
            stage: "slow",
            transform: async (seg) => {
              for (let i = 0; i < 30; i += 1) await Promise.resolve();
              return { status: "emitted" as const, segment: seg };
            },
          },
        ],
        queue: { capacity: 4, policy: "block" },
        clock: new VirtualProcessingClock(0),
        observability: obs.options,
      });
      pipeline.start();
      for (let i = 0; i < 6; i += 1) {
        await pipeline.submit(segment(`k${i}`, i * 30, i));
      }
      const result = await pipeline.stop({ mode: "cancel" });
      return { result, rejections: pipeline.rejections(), records: obs.records() };
    };
    const a = await runCancelStory();
    const b = await runCancelStory();
    expect(b.result).toEqual(a.result);
    expect(b.rejections).toEqual(a.rejections);
    expect(b.records).toEqual(a.records);
    // Pinned: k0's transform completed and reached the OUTPUT queue before
    // the cancel (terminal `emitted`, delivery pending — queue depth 1),
    // while k1 was still in-flight (abandoned) and k2..k5 were swept:
    // 6 in = 1 out + 5 abandoned. A MIX of terminal and abandoned paths —
    // the honest cancel semantics.
    expect(a.result.stats.segmentsOut).toBe(1);
    expect(a.result.stats.abandoned).toBe(5);
    expect(a.result.stats.abandonedProcessing).toBe(5);
    expect(a.result.stats.queueDepths).toEqual([0, 1]);
  });
});
