/**
 * `resumePipeline` tests (W302) — deliverable 4: "resumePipeline(checkpoint)
 * skips already-processed idempotency keys (counted as duplicates, never
 * silent) or explicitly reprocesses when configured."
 *
 * The streaming-contract Recovery rule proven end-to-end:
 *
 * - `skip` (default): checkpoint-known keys are skipped as COUNTED
 *   duplicates (never re-processed — the stage transform is never invoked
 *   for them, and a dead-lettered key is NOT re-failed); keys NOT in the
 *   checkpoint (in-flight at cut time, or submitted after it) are processed
 *   fresh — at-least-once recovery with downstream dedupe on the key;
 * - `reprocess: true`: the skip rule is deliberately disabled — the full
 *   list is processed again (replay after a stage fix), nothing counted as
 *   a duplicate by the skip rule;
 * - corrupt recovery state is refused LOUDLY before any processing;
 * - the resumed run cuts its own checkpoints (fresh registry seeded with the
 *   preloaded dispositions), uses its own derived session/correlation ids,
 *   and settles with the accounting balance runtime-asserted;
 * - `stopMode: "cancel"` crash-replay abandons everything unresolved with
 *   exact accounting.
 */
import { describe, expect, test } from "bun:test";
import type { StageMessage } from "@sporta/contracts";
import { InvalidCheckpointError } from "../src/errors";
import { ProcessingPipeline } from "../src/pipeline";
import { VirtualProcessingClock } from "../src/clock";
import { resumePipeline } from "../src/resume";
import type { PipelineCheckpoint } from "../src/types";
import { emptyStats } from "../src/types";
import type { PipelineSegment } from "../src/segment";
import type { StageOutcome } from "../src/types";
import {
  identityStage,
  payloadOf,
  segment,
  scriptedStage,
  until,
  wiredPipeline,
  expectBalanced,
} from "./helpers";

const SESSION_ID = "sess-w302-resume";

/** The wiring shape `resumePipeline` takes (everything except sessionId). */
interface Wiring {
  stages: Array<{ stage: string; transform: (seg: PipelineSegment) => Promise<StageOutcome> }>;
  queues: Array<{ capacity: number; policy: "block" | "reject" | "drop-oldest" }>;
  clock: { now(): number; sleep(ms: number): Promise<void> };
  checkpointEveryMs?: number;
}

/** A minimal background output drain. */
async function backgroundDrain(channel: { receive(): Promise<StageMessage> }): Promise<number> {
  let count = 0;
  for (;;) {
    try {
      await channel.receive();
      count += 1;
    } catch {
      return count;
    }
  }
}

/** The original run: 6 emitted segments, watermarks i*50, cuts at k2 and k4. */
async function originalStory(): Promise<{
  checkpoints: PipelineCheckpoint[];
  segments: PipelineSegment[];
  queues: Wiring["queues"];
}> {
  const queues: Wiring["queues"] = [
    { capacity: 16, policy: "block" },
    { capacity: 16, policy: "block" },
  ];
  const { pipeline } = wiredPipeline({
    sessionId: SESSION_ID,
    stages: [identityStage("detect")],
    queues,
    clock: new VirtualProcessingClock(0),
    checkpointEveryMs: 100,
  });
  pipeline.start();
  const consumer = backgroundDrain(pipeline.outputChannel());
  const segments = Array.from({ length: 6 }, (_, i) => segment(`k${i}`, i * 50, i));
  for (const [i, seg] of segments.entries()) {
    await pipeline.submit(seg);
    expect(await until(() => pipeline.stats().distinctProcessed === i + 1)).toBe(true);
  }
  await pipeline.stop();
  await consumer;
  // watermarks 0,50,100,150,200,250: boundary 100 cut at k2 (watermark 100),
  // boundary 200 cut at k4 (watermark 200) — the latest knows k0..k4.
  return { checkpoints: pipeline.checkpoints(), segments, queues };
}

describe("resumePipeline — skip mode (default)", () => {
  test("checkpoint-known keys are COUNTED duplicates, never re-processed; the rest are fresh work", async () => {
    const story = await originalStory();
    expect(story.checkpoints).toHaveLength(2);
    const latest = story.checkpoints[1]!;
    expect(latest.processedKeys).toHaveLength(5); // k0..k4

    // A call-counting stage proves the skip: preloaded keys never invoke it.
    const invoked: string[] = [];
    const counting = {
      stage: "detect",
      transform: async (seg: PipelineSegment): Promise<StageOutcome> => {
        invoked.push(seg.idempotencyKey);
        return { status: "emitted", segment: seg };
      },
    };
    const outcome = await resumePipeline(latest, story.segments, {
      stages: [counting],
      queues: story.queues,
      clock: new VirtualProcessingClock(0),
      checkpointEveryMs: 100,
    });

    // The exact accounting: 6 in = 1 out (k5, the only unprocessed key) +
    // 5 duplicates (k0..k4 — counted, skipped, never silent).
    expectBalanced(outcome.result, { segmentsIn: 6, segmentsOut: 1, duplicates: 5 });
    expect(outcome.submitOutcomes.map((o) => o.disposition)).toEqual([
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
      "admitted",
    ]);
    for (const o of outcome.submitOutcomes.slice(0, 5)) {
      expect(o).toMatchObject({ disposition: "duplicate", firstDisposition: "emitted" });
    }
    // The stage was invoked ONLY for the unprocessed key.
    expect(invoked).toEqual(["k5"]);
    expect(outcome.emitted.map((m) => payloadOf(m).idempotencyKey)).toEqual(["k5"]);
    expect(outcome.deadLetters).toEqual([]);
  });

  test("a mid-run checkpoint is at-least-once: keys disposed AFTER the cut are re-processed (not duplicates)", async () => {
    const story = await originalStory();
    const mid = story.checkpoints[0]!; // cut at k2: knows k0..k2 only

    const outcome = await resumePipeline(mid, story.segments, {
      stages: [identityStage("detect")],
      queues: story.queues,
      clock: new VirtualProcessingClock(0),
      checkpointEveryMs: 100,
    });

    // k0..k2 were terminally disposed before the cut → duplicates; k3..k5
    // were IN FLIGHT at cut time → fresh work (at-least-once recovery —
    // downstream stages dedupe on the idempotency key).
    expectBalanced(outcome.result, { segmentsIn: 6, segmentsOut: 3, duplicates: 3 });
    expect(outcome.emitted.map((m) => payloadOf(m).idempotencyKey)).toEqual(["k3", "k4", "k5"]);
  });

  test("a dead-lettered key in the checkpoint is skipped, NOT re-failed", async () => {
    // Watermarks i*25: k0..k3 (0..75) below the first boundary; k4's
    // dead-letter at 100 IS the first crossing → the cut carries k4 as
    // terminally failed.
    const queues: Wiring["queues"] = [
      { capacity: 16, policy: "block" },
      { capacity: 16, policy: "block" },
    ];
    const { pipeline } = wiredPipeline({
      sessionId: SESSION_ID,
      stages: [
        scriptedStage("detect", {
          k4: { retryable: false, errorClass: "media-invalid", message: "corrupt", times: 99 },
        }).spec,
      ],
      queues,
      clock: new VirtualProcessingClock(0),
      checkpointEveryMs: 100,
    });
    pipeline.start();
    const consumer = backgroundDrain(pipeline.outputChannel());
    const segments = Array.from({ length: 9 }, (_, i) => segment(`k${i}`, i * 25, i));
    for (const [i, seg] of segments.entries()) {
      await pipeline.submit(seg);
      expect(await until(() => pipeline.stats().distinctProcessed === i + 1)).toBe(true);
    }
    await pipeline.stop();
    await consumer;
    const cp = pipeline.checkpoints()[0]!;
    expect(cp.processedKeys[4]).toEqual({ key: "k4", disposition: "dead-lettered" });

    // Resume from the dead-letter boundary with a FRESH scripted stage that
    // still carries k4's failure script: k4 is skipped as a duplicate — the
    // stage is never invoked for it and the DLQ stays empty in the resumed
    // run (recovery does NOT reprocess terminal failures).
    const resumedScripted = scriptedStage("detect", {
      k4: { retryable: false, errorClass: "media-invalid", message: "corrupt", times: 99 },
    });
    const outcome = await resumePipeline(cp, segments, {
      stages: [resumedScripted.spec],
      queues,
      clock: new VirtualProcessingClock(0),
      checkpointEveryMs: 100,
    });

    expectBalanced(outcome.result, { segmentsIn: 9, segmentsOut: 4, duplicates: 5 });
    expect(resumedScripted.calls("k4")).toBe(0);
    expect(outcome.deadLetters).toEqual([]);
    expect(outcome.emitted.map((m) => payloadOf(m).idempotencyKey)).toEqual([
      "k5",
      "k6",
      "k7",
      "k8",
    ]);
  });

  test("the resumed run uses its own session/correlation ids and cuts its own checkpoints", async () => {
    const story = await originalStory();
    const outcome = await resumePipeline(story.checkpoints[1]!, story.segments, {
      stages: [identityStage("detect")],
      queues: story.queues,
      clock: new VirtualProcessingClock(0),
      checkpointEveryMs: 100,
    });
    expect(outcome.result.sessionId).toBe("resumed-2");
    expect(outcome.emitted[0]).toMatchObject({
      sessionId: "resumed-2",
      correlationId: "corr-pipe-resumed-2",
      traceId: "trace-pipe-resumed-2",
    });
    // The resumed registry is SEEDED with the 5 preloaded dispositions, so
    // its first cut (boundary 100, crossed by k5's watermark 250) carries
    // 6 keys: the preloaded k0..k4 plus the freshly emitted k5.
    expect(outcome.checkpoints).toHaveLength(1);
    expect(outcome.checkpoints[0]!.processedKeys).toHaveLength(6);
    expect(outcome.checkpoints[0]!.processedKeys[5]).toEqual({ key: "k5", disposition: "emitted" });
    expect(outcome.checkpoints[0]!.watermark).toEqual({ watermarkMs: 250, sequence: 0 });
    // The pipeline input sequence: duplicates skip sequence assignment, so
    // k5 (the first PROCESSED submit) carries sequence 0.
    expect(outcome.checkpoints[0]!.sequence).toBe(0);
  });

  test("an explicit sessionId overrides the derived default", async () => {
    const story = await originalStory();
    const outcome = await resumePipeline(
      story.checkpoints[1]!,
      story.segments,
      {
        stages: [identityStage("detect")],
        queues: story.queues,
        clock: new VirtualProcessingClock(0),
      },
      { sessionId: "sess-w302-recovered" },
    );
    expect(outcome.result.sessionId).toBe("sess-w302-recovered");
    expect(outcome.emitted[0]!.sessionId).toBe("sess-w302-recovered");
  });
});

describe("resumePipeline — reprocess mode", () => {
  test("reprocess: true disables the skip rule: everything runs again, zero skip-duplicates", async () => {
    const story = await originalStory();
    const scripted = scriptedStage("detect", {});
    const outcome = await resumePipeline(
      story.checkpoints[1]!,
      story.segments,
      {
        stages: [scripted.spec],
        queues: story.queues,
        clock: new VirtualProcessingClock(0),
        checkpointEveryMs: 100,
      },
      { reprocess: true },
    );

    // The FULL list was processed again: 6 in = 6 out, 0 skip-duplicates,
    // and every key invoked exactly once by the stage.
    expectBalanced(outcome.result, { segmentsIn: 6, segmentsOut: 6, duplicates: 0 });
    for (const key of ["k0", "k1", "k2", "k3", "k4", "k5"]) {
      expect(scripted.calls(key)).toBe(1);
    }
    expect(outcome.emitted.map((m) => payloadOf(m).idempotencyKey)).toEqual([
      "k0",
      "k1",
      "k2",
      "k3",
      "k4",
      "k5",
    ]);
  });
});

describe("resumePipeline — corrupt recovery state and cancel replay", () => {
  const validCheckpoint: PipelineCheckpoint = {
    index: 1,
    watermark: { watermarkMs: 100, sequence: 0 },
    sequence: 0,
    processedKeys: [{ key: "k0", disposition: "emitted" }],
    stats: emptyStats(),
    atMs: 0,
  };
  const wiring = {
    stages: [identityStage("detect")],
    queues: [
      { capacity: 8, policy: "block" },
      { capacity: 8, policy: "block" },
    ] as Wiring["queues"],
    clock: new VirtualProcessingClock(0),
  };

  test("a corrupt checkpoint rejects BEFORE any processing (fail-loud recovery)", async () => {
    await expect(
      resumePipeline({ ...validCheckpoint, index: 0 }, [segment("k0", 0)], wiring),
    ).rejects.toThrow(InvalidCheckpointError);
    await expect(
      resumePipeline(
        {
          ...validCheckpoint,
          processedKeys: [
            { key: "k0", disposition: "emitted" },
            { key: "k0", disposition: "emitted" },
          ],
        },
        [segment("k0", 0)],
        wiring,
      ),
    ).rejects.toThrow(/duplicate key 'k0'/);
  });

  test("stopMode cancel abandons everything unresolved with exact accounting", async () => {
    // A slow first stage: after all submits resolve, k0 is still mid-flight.
    const slowStage = {
      stage: "detect",
      transform: async (seg: PipelineSegment): Promise<StageOutcome> => {
        for (let i = 0; i < 60; i += 1) await Promise.resolve();
        return { status: "emitted", segment: seg };
      },
    };
    const checkpoint: PipelineCheckpoint = { ...validCheckpoint, processedKeys: [] };
    const segments = Array.from({ length: 6 }, (_, i) => segment(`k${i}`, i * 50, i));

    const outcome = await resumePipeline(
      checkpoint,
      segments,
      {
        stages: [slowStage],
        queues: [
          { capacity: 16, policy: "block" },
          { capacity: 16, policy: "block" },
        ],
        clock: new VirtualProcessingClock(0),
      },
      { stopMode: "cancel" },
    );

    // 6 in = 0 out + 6 abandoned: the in-flight k0 completed its transform
    // but could not deliver; the queued k1..k5 were swept — all accounted.
    expectBalanced(outcome.result, { segmentsIn: 6, segmentsOut: 0, abandoned: 6 });
    expect(outcome.result.stats.abandonedAdmission).toBe(0);
    expect(outcome.result.stats.abandonedProcessing).toBe(6);
    expect(outcome.emitted).toEqual([]);
  });
});

describe("preloadedDispositions — the pipeline-level recovery seam", () => {
  test("preloaded keys make re-submissions counted duplicates during the run", async () => {
    const pipeline = new ProcessingPipeline({
      sessionId: SESSION_ID,
      stages: [identityStage("a")],
      queues: [
        { capacity: 4, policy: "block" },
        { capacity: 4, policy: "block" },
      ],
      clock: new VirtualProcessingClock(0),
      preloadedDispositions: [
        { key: "k0", disposition: "emitted" },
        { key: "k1", disposition: "dead-lettered" },
      ],
    });
    pipeline.start();
    const consumer = backgroundDrain(pipeline.outputChannel());
    const first = await pipeline.submit(segment("k0", 0, 0));
    expect(first).toEqual({
      disposition: "duplicate",
      idempotencyKey: "k0",
      firstDisposition: "emitted",
    });
    const second = await pipeline.submit(segment("k1", 10, 1));
    expect(second).toEqual({
      disposition: "duplicate",
      idempotencyKey: "k1",
      firstDisposition: "dead-lettered",
    });
    await pipeline.submit(segment("k2", 20, 2));
    const result = await pipeline.stop();
    await consumer;
    expectBalanced(result, { segmentsIn: 3, segmentsOut: 1, duplicates: 2 });
    expect(result.stats.distinctProcessed).toBe(3); // 2 preloaded + k2
  });

  test("invalid preload entries fail loud at wiring time", () => {
    const clock = { now: () => 0, sleep: async () => {} };
    expect(
      () =>
        new ProcessingPipeline({
          sessionId: SESSION_ID,
          stages: [identityStage("a")],
          clock,
          preloadedDispositions: [{ key: "", disposition: "emitted" }],
        }),
    ).toThrow(/non-empty key/);
    expect(
      () =>
        new ProcessingPipeline({
          sessionId: SESSION_ID,
          stages: [identityStage("a")],
          clock,
          preloadedDispositions: [null as never],
        }),
    ).toThrow(/must be objects/);
    expect(
      () =>
        new ProcessingPipeline({
          sessionId: SESSION_ID,
          stages: [identityStage("a")],
          clock,
          preloadedDispositions: [{ key: "k0", disposition: "refused" as never }],
        }),
    ).toThrow(/disposition/);
  });
});
