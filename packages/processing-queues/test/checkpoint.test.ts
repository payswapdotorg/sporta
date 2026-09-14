/**
 * Watermark-boundary checkpoint tests (W302) — deliverable 4 of the brief:
 * "pipeline checkpoints at watermark boundaries ... `resumePipeline(checkpoint)`
 * skips already-processed idempotency keys".
 *
 * - `CheckpointTracker`: boundary arithmetic (a disposition crosses when its
 *   watermark reaches the next boundary), 1-based cut ordinals, boundary
 *   advancement to `crossing + interval` (monotone — out-of-order later
 *   watermarks cannot un-cut a checkpoint), cumulative processedKeys copies,
 *   and the stats/atMs snapshot carried on the checkpoint;
 * - pipeline integration: emissions AND dead-letters both cut checkpoints;
 *   `checkpoints()`/`latestCheckpoint()` observation; the
 *   `processing_checkpoints_total` metric; one info log line per cut;
 * - `validateCheckpoint`: fail-loud on every corrupt shape (the recovery
 *   state is DATA — corrupt recovery state is refused loudly, never
 *   silently replayed from).
 */
import { describe, expect, test } from "bun:test";
import { InvalidCheckpointError, isProcessingQueuesError } from "../src/errors";
import { CheckpointTracker, validateCheckpoint } from "../src/checkpoint";
import type { PipelineCheckpoint } from "../src/types";
import { PROCESSING_METRIC_NAMES as METRICS } from "../src/types";
import { emptyStats } from "../src/types";
import { VirtualProcessingClock } from "../src/clock";
import {
  capturedObservability,
  drainOutput,
  identityStage,
  segment,
  scriptedStage,
  until,
  wiredPipeline,
  expectBalanced,
} from "./helpers";

const SESSION_ID = "sess-w302-cp";

describe("CheckpointTracker — boundary arithmetic", () => {
  test("a disposition crosses the next boundary at exactly the boundary (inclusive)", () => {
    const tracker = new CheckpointTracker(100);
    expect(tracker.crossesBoundary(0)).toBe(false);
    expect(tracker.crossesBoundary(99)).toBe(false);
    expect(tracker.crossesBoundary(100)).toBe(true);
    expect(tracker.crossesBoundary(101)).toBe(true);
    expect(tracker.cuts).toBe(0);
  });

  test("cut() mints a 1-ordinal checkpoint carrying the crossing disposition verbatim", () => {
    const tracker = new CheckpointTracker(100);
    const cp = tracker.cut({
      watermarkMs: 240,
      sequence: 9,
      processedKeys: [
        { key: "k0", disposition: "emitted" },
        { key: "k4", disposition: "dead-lettered" },
      ],
      stats: { ...emptyStats([1, 2, 0]), segmentsOut: 5, deadLettered: 1 },
      atMs: 123,
    });
    expect(cp).toEqual({
      index: 1,
      watermark: { watermarkMs: 240, sequence: 9 },
      sequence: 9,
      processedKeys: [
        { key: "k0", disposition: "emitted" },
        { key: "k4", disposition: "dead-lettered" },
      ],
      stats: { ...emptyStats([1, 2, 0]), segmentsOut: 5, deadLettered: 1 },
      atMs: 123,
    });
    expect(tracker.cuts).toBe(1);
  });

  test("the checkpoint owns COPIES: mutating the cut inputs afterwards changes nothing", () => {
    const tracker = new CheckpointTracker(100);
    const keys = [{ key: "k0", disposition: "emitted" as const }];
    const stats = { ...emptyStats([1]), segmentsOut: 3 };
    const cp = tracker.cut({
      watermarkMs: 100,
      sequence: 1,
      processedKeys: keys,
      stats,
      atMs: 5,
    });
    // Tamper with every input AFTER the cut: the frozen evidence is immune.
    keys.push({ key: "late", disposition: "dead-lettered" });
    stats.segmentsOut = 99;
    stats.queueDepths.push(7);
    expect(cp.processedKeys).toEqual([{ key: "k0", disposition: "emitted" }]);
    expect(cp.stats.segmentsOut).toBe(3);
    expect(cp.stats.queueDepths).toEqual([1]);
  });

  test("boundaries advance to crossing + interval: later, smaller watermarks cannot un-cut", () => {
    const tracker = new CheckpointTracker(100);
    // A big crossing at 1000 jumps the boundary to 1100.
    tracker.cut({
      watermarkMs: 1000,
      sequence: 5,
      processedKeys: [],
      stats: emptyStats(),
      atMs: 0,
    });
    expect(tracker.crossesBoundary(1050)).toBe(false); // would have crossed 200
    // The next crossing only at 1100+.
    expect(tracker.crossesBoundary(1100)).toBe(true);
    tracker.cut({
      watermarkMs: 1100,
      sequence: 6,
      processedKeys: [],
      stats: emptyStats(),
      atMs: 0,
    });
    expect(tracker.cuts).toBe(2);
  });

  test("cut ordinals are 1-based and strictly increasing", () => {
    const tracker = new CheckpointTracker(10);
    const first = tracker.cut({
      watermarkMs: 10,
      sequence: 0,
      processedKeys: [],
      stats: emptyStats(),
      atMs: 0,
    });
    const second = tracker.cut({
      watermarkMs: 25,
      sequence: 1,
      processedKeys: [],
      stats: emptyStats(),
      atMs: 1,
    });
    const third = tracker.cut({
      watermarkMs: 40,
      sequence: 2,
      processedKeys: [],
      stats: emptyStats(),
      atMs: 2,
    });
    expect([first.index, second.index, third.index]).toEqual([1, 2, 3]);
  });

  test("constructor fails loud on a non-positive or non-finite interval, and a bad start", () => {
    expect(() => new CheckpointTracker(0)).toThrow(RangeError);
    expect(() => new CheckpointTracker(-10)).toThrow(RangeError);
    expect(() => new CheckpointTracker(Number.NaN)).toThrow(RangeError);
    expect(() => new CheckpointTracker(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => new CheckpointTracker(100, Number.NaN)).toThrow(RangeError);
  });
});

describe("validateCheckpoint — corrupt recovery state is refused loudly", () => {
  const valid: PipelineCheckpoint = {
    index: 1,
    watermark: { watermarkMs: 240, sequence: 9 },
    sequence: 9,
    processedKeys: [
      { key: "k0", disposition: "emitted" },
      { key: "k4", disposition: "dead-lettered" },
    ],
    stats: emptyStats(),
    atMs: 0,
  };

  test("a well-formed checkpoint passes", () => {
    expect(() => validateCheckpoint(valid)).not.toThrow();
  });

  test("refuses a non-object / non-integer / zero index", () => {
    const cases: Array<[unknown, string]> = [
      [null, "checkpoint-not-object"],
      [42, "checkpoint-not-object"],
      [{ ...valid, index: 0 }, "index-invalid"],
      [{ ...valid, index: -1 }, "index-invalid"],
      [{ ...valid, index: 1.5 }, "index-invalid"],
    ];
    for (const [candidate, reason] of cases) {
      try {
        validateCheckpoint(candidate as PipelineCheckpoint);
        throw new Error(`expected InvalidCheckpointError for ${reason}`);
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidCheckpointError);
        expect((err as InvalidCheckpointError).details.reason).toBe(reason);
        expect((err as InvalidCheckpointError).terminalFailureClass).toBe("media-invalid");
        expect(isProcessingQueuesError(err)).toBe(true);
      }
    }
  });

  test("refuses a missing/invalid watermark", () => {
    for (const watermark of [
      null,
      {},
      { watermarkMs: -1, sequence: 0 },
      { watermarkMs: 10, sequence: -1 },
      { watermarkMs: 10, sequence: 0.5 },
    ] as const) {
      expect(() =>
        validateCheckpoint({ ...valid, watermark: watermark as PipelineCheckpoint["watermark"] }),
      ).toThrow(/watermark/);
    }
  });

  test("refuses malformed processedKeys (bad entry, bad disposition, duplicate key)", () => {
    expect(() => validateCheckpoint({ ...valid, processedKeys: "nope" as unknown as [] })).toThrow(
      /processedKeys must be an array/,
    );
    expect(() =>
      validateCheckpoint({ ...valid, processedKeys: [null as never, ...valid.processedKeys] }),
    ).toThrow(/processedKeys entries must be objects/);
    expect(() =>
      validateCheckpoint({
        ...valid,
        processedKeys: [{ key: "k9", disposition: "refused" as never }],
      }),
    ).toThrow(/disposition/);
    expect(() =>
      validateCheckpoint({
        ...valid,
        processedKeys: [
          { key: "k0", disposition: "emitted" },
          { key: "k0", disposition: "emitted" },
        ],
      }),
    ).toThrow(/duplicate key 'k0'/);
  });

  test("refuses a non-finite atMs", () => {
    expect(() => validateCheckpoint({ ...valid, atMs: Number.NaN })).toThrow(/atMs/);
  });
});

describe("pipeline checkpoint integration — emissions and dead-letters both cut", () => {
  test("emissions cut checkpoints at boundary crossings with cumulative processedKeys", async () => {
    const obs = capturedObservability();
    const clock = new VirtualProcessingClock(0);
    const { pipeline, output } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("a"), identityStage("b")],
      // Output capacity 16 > 9 segments so the (later) drain-only consumer
      // never parks the last stage — the test drains at the end.
      queue: { capacity: 16, policy: "block" },
      checkpointEveryMs: 100,
      clock,
      observability: obs.options,
    });
    pipeline.start();
    // Strictly-paced submits (wait for each terminal disposition) so every
    // cut's processedKeys is exactly derivable: watermarks 0..300 step 40.
    for (let i = 0; i < 9; i += 1) {
      await pipeline.submit(segment(`k${i}`, i * 40, i));
      expect(await until(() => pipeline.stats().distinctProcessed === i + 1)).toBe(true);
    }
    const result = await pipeline.stop();
    expectBalanced(result, { segmentsIn: 9, segmentsOut: 9 });

    // Boundary arithmetic: first boundary 100 (start 0 + interval), so the
    // first disposition >= 100 is k3 (watermark 120); the boundary advances
    // to 120+100=220, and the first disposition >= 220 is k6 (240). Two cuts.
    const checkpoints = pipeline.checkpoints();
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]).toMatchObject({
      index: 1,
      watermark: { watermarkMs: 120 },
      sequence: 3,
    });
    expect(checkpoints[0]!.processedKeys).toHaveLength(4); // k0..k3, cumulative
    expect(checkpoints[0]!.stats.segmentsOut).toBe(4);
    expect(checkpoints[1]).toMatchObject({
      index: 2,
      watermark: { watermarkMs: 240 },
      sequence: 6,
    });
    expect(checkpoints[1]!.processedKeys).toHaveLength(7); // k0..k6
    expect(checkpoints[1]!.processedKeys[6]).toEqual({ key: "k6", disposition: "emitted" });
    expect(checkpoints[1]!.stats.segmentsOut).toBe(7);
    expect(pipeline.latestCheckpoint()).toMatchObject({ index: 2 });
    // Never silent: one metric + one info log line per cut, atMs from the
    // injected clock (no processing sleeps happened — 0).
    expect(
      obs.metrics.snapshot().counters.find((c) => c.name === METRICS.checkpointsTotal)?.value,
    ).toBe(2);
    expect(obs.records().filter((r) => r.msg === "pipeline checkpoint cut")).toHaveLength(2);
    expect(checkpoints.every((cp) => cp.atMs === 0)).toBe(true);
    // The consumer got everything (the checkpoints never perturbed the flow).
    const received = await drainOutput(output);
    expect(received).toHaveLength(9);
  });

  test("a dead-letter is a terminal disposition: it crosses and cuts too", async () => {
    const clock = new VirtualProcessingClock(0);
    const scripted = scriptedStage("detect", {
      k4: { retryable: false, errorClass: "media-invalid", message: "corrupt", times: 99 },
    });
    const { pipeline } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [scripted.spec],
      queue: { capacity: 8, policy: "block" },
      checkpointEveryMs: 100,
      clock,
    });
    pipeline.start();
    // Watermarks i*25: k0..k3 (0,25,50,75) stay below the first boundary
    // (100); k4's DEAD-LETTER at watermark 100 is the first crossing
    // disposition — the cut happens at the dead-letter itself.
    for (let i = 0; i < 9; i += 1) {
      await pipeline.submit(segment(`k${i}`, i * 25, i));
      expect(await until(() => pipeline.stats().distinctProcessed === i + 1)).toBe(true);
    }
    const result = await pipeline.stop();
    expectBalanced(result, { segmentsIn: 9, segmentsOut: 8, deadLettered: 1 });

    const checkpoints = pipeline.checkpoints();
    // First cut AT k4's dead-letter (watermark 100, boundary 100); the next
    // boundary is 100+100=200 — k8 (200) crosses it. Two cuts.
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]).toMatchObject({
      index: 1,
      watermark: { watermarkMs: 100 },
      sequence: 4,
    });
    // The dead-lettered key rides processedKeys with its disposition — the
    // resume set says "k4 already terminally failed, do not reprocess it".
    expect(checkpoints[0]!.processedKeys).toHaveLength(5);
    expect(checkpoints[0]!.processedKeys[4]).toEqual({ key: "k4", disposition: "dead-lettered" });
    expect(checkpoints[0]!.stats.segmentsOut).toBe(4);
    expect(checkpoints[0]!.stats.deadLettered).toBe(1);
    expect(checkpoints[1]).toMatchObject({
      index: 2,
      watermark: { watermarkMs: 200 },
      sequence: 8,
    });
    expect(checkpoints[1]!.processedKeys).toHaveLength(9);
    expect(checkpoints[1]!.stats.segmentsOut).toBe(8);
  });
});
