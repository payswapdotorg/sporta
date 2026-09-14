/**
 * End-to-end story tests (W302) — the W301 evidence pattern: ONE deterministic
 * multi-stage story with EVERY accounting bucket exercised and every number
 * hand-derived, then RECOVERY from the story's own checkpoint.
 *
 * Story A (the live run): 12 paced segments through
 * `detect -> enrich -> pack` over 4 bounded block queues (count AND bytes
 * limits, capacity 3/2/2/4, 24-byte input budget), with
 *
 * - k4 failing non-retryably at `detect` (DLQ, never retried);
 * - watermark-boundary checkpoints every 100 ms (cuts at k4's dead-letter
 *   and at k8's emission — hand-derived below);
 * - a duplicate re-submission of k0 (counted, skipped);
 * - one malformed segment (refused loud, counted, pipeline continues).
 *
 * Story B (the recovery): `resumePipeline` from the checkpoint cut AT k4's
 * dead-letter — the crash point: k0..k4 are skipped as counted duplicates
 * (the dead-lettered k4 is NOT re-failed), k5..k11 are processed fresh
 * (at-least-once), and the resumed run settles with its own exact balance.
 *
 * The burst/bounded-memory proofs live in backpressure.test.ts; this file
 * pins the whole-ledger arithmetic of a complete session.
 */
import { describe, expect, test } from "bun:test";
import type { StageMessage } from "@sporta/contracts";
import { MalformedSegmentError } from "../src/errors";
import { VirtualProcessingClock } from "../src/clock";
import { resumePipeline } from "../src/resume";
import type { PipelineSegment } from "../src/segment";
import type { StageOutcome } from "../src/types";
import {
  backgroundConsumer,
  capturedObservability,
  identityStage,
  markingStage,
  payloadOf,
  segment,
  scriptedStage,
  until,
  wiredPipeline,
  expectBalanced,
} from "./helpers";

const SESSION_ID = "sess-w302-e2e";

/** The story's 12 segments: watermarks i*30, 12 declared bytes each. */
function storySegments(): PipelineSegment[] {
  return Array.from({ length: 12 }, (_, i) => segment(`k${i}`, i * 30, i, 12));
}

/** The story's stage chain: fresh instances per run. */
function storyStages(): Array<{
  stage: string;
  transform: (seg: PipelineSegment) => Promise<StageOutcome>;
}> {
  return [
    scriptedStage("detect", {
      k4: { retryable: false, errorClass: "media-invalid", message: "corrupt payload", times: 99 },
    }).spec,
    markingStage("enrich", "enriched"),
    identityStage("pack"),
  ];
}

/** The story's bounded wiring: count AND byte limits on every channel. */
const STORY_QUEUES = [
  { capacity: 3, policy: "block" as const, maxBytes: 24 },
  { capacity: 2, policy: "block" as const, maxBytes: 24 },
  { capacity: 2, policy: "block" as const, maxBytes: 24 },
  { capacity: 4, policy: "block" as const, maxBytes: 48 },
];

describe("e2e story A — the live run (every bucket, exact arithmetic)", () => {
  test("12 segments + 1 duplicate + 1 malformed through 3 stages: 14 = 11 + 1 + 1 + 1", async () => {
    const obs = capturedObservability();
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: storyStages(),
      queues: STORY_QUEUES,
      clock: new VirtualProcessingClock(0),
      checkpointEveryMs: 100,
      observability: obs.options,
    });
    pipeline.start();
    const received: StageMessage[] = [];
    const consumer = backgroundConsumer(output, received);

    // Paced producer: each segment reaches its terminal disposition before
    // the next submit, so every ledger number below is exactly derivable.
    const segments = storySegments();
    for (const [i, seg] of segments.entries()) {
      await pipeline.submit(seg);
      expect(await until(() => pipeline.stats().distinctProcessed === i + 1)).toBe(true);
    }

    // k0 is terminally emitted by now — its re-submission is a DUPLICATE.
    const duplicate = await pipeline.submit(segment("k0", 0, 0, 12));
    expect(duplicate).toEqual({
      disposition: "duplicate",
      idempotencyKey: "k0",
      firstDisposition: "emitted",
    });
    // One malformed segment: refused loud, the stream continues.
    await expect(pipeline.submit(segment("bad", -1))).rejects.toThrow(MalformedSegmentError);

    const result = await pipeline.stop();
    await consumer.done;

    // THE BALANCE: 14 in = 11 out + 1 rejected + 1 duplicate + 1 dead-lettered.
    expectBalanced(result, {
      segmentsIn: 14,
      segmentsOut: 11,
      rejected: 1,
      duplicates: 1,
      deadLettered: 1,
    });
    expect(result.stats.rejectedMalformed).toBe(1);
    expect(result.stats.abandoned).toBe(0);
    expect(result.stats.dropped).toBe(0);
    expect(result.outcome).toBe("stopped");

    // Per-stage flow identities, pinned: detect 12 in / 11 emitted / 1 DLQ;
    // enrich and pack see only the 11 survivors.
    expect(result.stages).toEqual([
      {
        stage: "detect",
        received: 12,
        emitted: 11,
        failed: 1,
        refused: 0,
        retries: 0,
        inFlight: 0,
        abandonedInFlight: 0,
        abandonedQueued: 0,
      },
      {
        stage: "enrich",
        received: 11,
        emitted: 11,
        failed: 0,
        refused: 0,
        retries: 0,
        inFlight: 0,
        abandonedInFlight: 0,
        abandonedQueued: 0,
      },
      {
        stage: "pack",
        received: 11,
        emitted: 11,
        failed: 0,
        refused: 0,
        retries: 0,
        inFlight: 0,
        abandonedInFlight: 0,
        abandonedQueued: 0,
      },
    ]);

    // The emitted stream: k0..k11 minus k4, IN ORDER, watermarks VERBATIM
    // (the segment's own authored values, never re-stamped), payloads
    // transformed by enrich and carried by pack.
    expect(received.map((m) => payloadOf(m).idempotencyKey)).toEqual([
      "k0",
      "k1",
      "k2",
      "k3",
      "k5",
      "k6",
      "k7",
      "k8",
      "k9",
      "k10",
      "k11",
    ]);
    expect(received.map((m) => payloadOf(m).watermark.watermarkMs)).toEqual([
      0, 30, 60, 90, 150, 180, 210, 240, 270, 300, 330,
    ]);
    expect(received.map((m) => m.sequence)).toEqual([0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11]);
    for (const message of received) {
      const payload = payloadOf(message).payload as { value: number; enriched: boolean };
      expect(payload.enriched).toBe(true);
      expect(message.correlationId).toBe(`corr-pipe-${SESSION_ID}`);
      expect(message.traceId).toBe(`trace-pipe-${SESSION_ID}`);
    }

    // The dead letter: full evidence — segment, stage, error class, the
    // injected clock's timestamp, correlation ids.
    expect(pipeline.deadLetters()).toHaveLength(1);
    expect(pipeline.deadLetters()[0]).toMatchObject({
      idempotencyKey: "k4",
      stage: "detect",
      errorClass: "media-invalid",
      terminal: "non-retryable",
      attempts: 1,
      retriesUsed: 0,
      atMs: 0,
      sequence: 4,
    });
    expect(pipeline.deadLetters()[0]!.segment).toBe(segments[4]!); // VERBATIM reference

    // The malformed refusal left its ledger record (never silent).
    expect(pipeline.rejections()).toHaveLength(1);
    expect(pipeline.rejections()[0]).toMatchObject({
      bucket: "rejected",
      failureClass: "media-invalid",
      idempotencyKey: "bad",
      stage: null,
    });

    // Checkpoint arithmetic (watermarks i*30, interval 100): the first
    // boundary 100 is crossed by k4's DEAD-LETTER (watermark 120) — the cut
    // carries k0..k3 emitted + k4 dead-lettered; the boundary advances to
    // 220, crossed by k8's emission (240).
    const checkpoints = pipeline.checkpoints();
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]).toMatchObject({
      index: 1,
      watermark: { watermarkMs: 120, sequence: 4 },
      sequence: 4,
      atMs: 0,
    });
    expect(checkpoints[0]!.processedKeys).toEqual([
      { key: "k0", disposition: "emitted" },
      { key: "k1", disposition: "emitted" },
      { key: "k2", disposition: "emitted" },
      { key: "k3", disposition: "emitted" },
      { key: "k4", disposition: "dead-lettered" },
    ]);
    expect(checkpoints[0]!.stats).toMatchObject({ segmentsOut: 4, deadLettered: 1 });
    expect(checkpoints[1]).toMatchObject({
      index: 2,
      watermark: { watermarkMs: 240, sequence: 8 },
    });
    expect(checkpoints[1]!.processedKeys).toHaveLength(9);
    expect(checkpoints[1]!.stats).toMatchObject({ segmentsOut: 8, deadLettered: 1 });

    // Observability never silent: every duplicate, rejection, dead letter,
    // and checkpoint left its log line and metric.
    expect(
      obs.records().filter((r) => r.msg === "pipeline segment re-submitted (idempotent duplicate)"),
    ).toHaveLength(1);
    expect(
      obs.records().filter((r) => r.msg === "pipeline segment refused or abandoned"),
    ).toHaveLength(1);
    expect(obs.records().filter((r) => r.msg === "segment dead-lettered")).toHaveLength(1);
    expect(obs.records().filter((r) => r.msg === "pipeline checkpoint cut")).toHaveLength(2);

    // The latest checkpoint is the last cut (index 2, at k8's emission).
    expect(pipeline.latestCheckpoint()).toMatchObject({
      index: 2,
      watermark: { watermarkMs: 240 },
    });
  });
});

describe("e2e story B — recovery from the story's own checkpoint", () => {
  test("resumePipeline from the k4 dead-letter cut: 5 counted duplicates + 7 fresh, k4 never re-failed", async () => {
    // Run story A up to the first checkpoint, then "crash" (hard stop).
    const { pipeline } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: storyStages(),
      queues: STORY_QUEUES,
      clock: new VirtualProcessingClock(0),
      checkpointEveryMs: 100,
    });
    pipeline.start();
    const consumer = backgroundConsumer(pipeline.outputChannel(), []);
    const segments = storySegments();
    for (const [i, seg] of segments.entries()) {
      await pipeline.submit(seg);
      expect(await until(() => pipeline.stats().distinctProcessed === i + 1)).toBe(true);
    }
    await pipeline.stop();
    await consumer.done;
    const crashPoint = pipeline.checkpoints()[0]!;
    expect(crashPoint.processedKeys).toHaveLength(5);

    // Recovery: replay the WHOLE segment list from the crash-point checkpoint.
    const resumed = await resumePipeline(crashPoint, segments, {
      stages: storyStages(),
      queues: STORY_QUEUES,
      clock: new VirtualProcessingClock(0),
      checkpointEveryMs: 100,
    });

    // THE RESUMED BALANCE: 12 in = 7 out (k5..k11 fresh) + 5 duplicates
    // (k0..k3 emitted before the cut, k4 DEAD-LETTERED before the cut).
    expectBalanced(resumed.result, { segmentsIn: 12, segmentsOut: 7, duplicates: 5 });
    expect(resumed.result.stats.deadLettered).toBe(0);
    expect(resumed.result.stats.rejected).toBe(0);
    expect(resumed.result.outcome).toBe("stopped");

    // k4 was terminally failed BEFORE the cut: recovery does NOT reprocess
    // it — the DLQ stays empty and the stage never sees it.
    expect(resumed.deadLetters).toEqual([]);
    expect(resumed.submitOutcomes.map((o) => o.disposition)).toEqual([
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
      "admitted",
      "admitted",
      "admitted",
      "admitted",
      "admitted",
      "admitted",
      "admitted",
    ]);
    // The fresh survivors flowed through ALL three stages with their
    // payloads enriched and watermarks verbatim.
    expect(resumed.emitted.map((m) => payloadOf(m).idempotencyKey)).toEqual([
      "k5",
      "k6",
      "k7",
      "k8",
      "k9",
      "k10",
      "k11",
    ]);
    expect(resumed.emitted.map((m) => payloadOf(m).watermark.watermarkMs)).toEqual([
      150, 180, 210, 240, 270, 300, 330,
    ]);
    for (const message of resumed.emitted) {
      const payload = payloadOf(message).payload as { enriched: boolean };
      expect(payload.enriched).toBe(true);
    }
    // Per-stage: only the 7 fresh segments were received.
    expect(resumed.result.stages.map((s) => [s.stage, s.received, s.emitted])).toEqual([
      ["detect", 7, 7],
      ["enrich", 7, 7],
      ["pack", 7, 7],
    ]);
    // The resumed run cut its own checkpoints: boundary 100 crossed by k5's
    // emission (150) with the SEEDED registry (6 keys), boundary 250 crossed
    // by k9's emission (270) with 10 keys.
    expect(resumed.checkpoints).toHaveLength(2);
    expect(resumed.checkpoints[0]!.processedKeys).toHaveLength(6);
    expect(resumed.checkpoints[0]!.processedKeys[5]).toEqual({ key: "k5", disposition: "emitted" });
    expect(resumed.checkpoints[0]!.stats).toMatchObject({ segmentsOut: 1 });
    expect(resumed.checkpoints[1]!.processedKeys).toHaveLength(10);
    expect(resumed.checkpoints[1]!.stats).toMatchObject({ segmentsOut: 5 });
  });
});
