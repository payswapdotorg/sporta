/**
 * The orchestrator core (W304): incremental consumption, batch honesty,
 * job scheduling through the W303 protocol, capacity refusals, deadline
 * timeouts, retries, and the byte-budget policies — every story settled
 * with the accounting balance asserted.
 */
import { describe, expect, test } from "bun:test";
import { VirtualGpuClock } from "@sporta/gpu-worker";
import { createAnimeRenderBatchExecutor } from "../src/executor";
import { RenderOrchestrator } from "../src/orchestrator";
import { emptyStats } from "../src/types";
import {
  FixtureSwmStore,
  buildSwmStory,
  capturedObservability,
  drainMicrotasks,
  expectBalanced,
  scriptedRenderExecutor,
  until,
  wiredOrchestrator,
} from "./helpers";
import type {
  RenderBatchOutcome,
  RenderCheckpoint,
  RenderOrchestrationResult,
  SwmUpdateStore,
} from "../src/types";

const SESSION = "sess-render-story";

/** The default happy-path wiring: 6 updates, real anime renders, 1 worker. */
async function happyRun(overrides: { renderDurationMs?: number; seconds?: number } = {}): Promise<{
  result: RenderOrchestrationResult;
  orchestrator: RenderOrchestrator;
  store: FixtureSwmStore;
  clock: VirtualGpuClock;
}> {
  const clock = new VirtualGpuClock(0);
  const obs = capturedObservability();
  const { updates } = buildSwmStory({
    sessionId: SESSION,
    seconds: overrides.seconds ?? 6,
  });
  const store = new FixtureSwmStore(updates);
  const orchestrator = wiredOrchestrator(
    {
      store,
      clock,
      executor: createAnimeRenderBatchExecutor({
        renderDurationMs: overrides.renderDurationMs ?? 100,
      }),
    },
    obs,
  );
  await orchestrator.start();
  const result = await orchestrator.done();
  return { result, orchestrator, store, clock };
}

describe("happy path (real anime plugin, complete stream)", () => {
  test("every batch renders, emits in watermark order, and the accounting closes", async () => {
    const { result } = await happyRun();
    expect(result.outcome).toBe("completed");
    expect(result.stats).toEqual({
      ...emptyStats(),
      batchesIn: 6,
      batchesRendered: 6,
      batchesSentToQueue: 6,
      batchesReceivedFromQueue: 6,
      renderJobsSubmitted: 6,
      outputsEmitted: 6,
      checkpointsCut: 6,
      // A later batch can complete before an earlier one (two concurrent
      // jobs) and waits in the bounded reorder — the peak is the honest
      // bounded-reorder evidence, not zero (determinism.test.ts pins the
      // exact value).
      peakBatchesInSystem: expect.any(Number),
      peakReorderSize: expect.any(Number),
      maxEmissionLagMs: expect.any(Number),
    });
    expect(result.outputs).toHaveLength(6);
    // Watermark order, verbatim per batch.
    const watermarks = result.outputs.map(
      (record) => record.provenance.sourceWatermark.watermarkMs,
    );
    expect(watermarks).toEqual([1_000, 2_000, 3_000, 4_000, 5_000, 6_000]);
  });

  test("every output is the REAL W502 anime render of its batch", async () => {
    const { result } = await happyRun();
    for (const [index, record] of result.outputs.entries()) {
      expect(record.output.manifest.renderer.rendererId).toBe("anime.prototype");
      expect(record.output.manifest.renderer.rendererVersion).toBe("0.1.0");
      // One update per batch → one frame per output.
      expect(record.output.frames).toHaveLength(1);
      expect(record.output.frames[0]!.outputTimestampMs).toBe((index + 1) * 1_000);
      // The manifest echoes the batch window verbatim.
      expect(record.output.manifest.frames[0]!.windowMs).toEqual({
        startMs: (index + 1) * 1_000,
        endMs: (index + 2) * 1_000,
      });
    }
  });

  test("per-output provenance carries the batch, the job, and the renderer identity", async () => {
    const { result, orchestrator } = await happyRun();
    for (const [index, record] of result.outputs.entries()) {
      const ordinal = index + 1;
      expect(record.provenance.sessionId).toBe(SESSION);
      expect(record.provenance.batchId).toBe(`render-batch-${SESSION}-${ordinal}`);
      expect(record.provenance.batchOrdinal).toBe(ordinal);
      expect(record.provenance.sourceWatermark).toEqual({
        watermarkMs: ordinal * 1_000,
        sequence: expect.any(Number),
      });
      expect(record.provenance.jobId).toBe(`render-job-${SESSION}-${ordinal}`);
      expect(record.provenance.rendererId).toBe("anime.prototype");
      expect(record.provenance.rendererVersion).toBe("0.1.0");
      expect(record.provenance.jobTiming.submittedAtMs).toBeTypeOf("number");
    }
    // The W303 job-level ledger agrees: 6 admitted, 6 succeeded.
    const dispatchStats = orchestrator.dispatchStats();
    expect(dispatchStats.admitted).toBe(6);
    expect(dispatchStats.succeeded).toBe(6);
    expect(dispatchStats.duplicates).toBe(0);
  });

  test("the ledger records EXACTLY ONE terminal entry per batch, in terminal order", async () => {
    const { result } = await happyRun();
    expect(result.ledger).toHaveLength(6);
    const seen = new Set<string>();
    for (const entry of result.ledger) {
      expect(seen.has(entry.batchId)).toBe(false);
      seen.add(entry.batchId);
      expect(entry.disposition).toBe("rendered");
      expect(entry.watermark.watermarkMs).toBe(entry.ordinal * 1_000);
    }
    expect(result.channelDropped).toBe(0);
    expect(result.stats.batchesQueueEvicted).toBe(0);
  });

  test("checkpoints are cut at watermark boundaries, anchored at the crossing batch", async () => {
    const { result } = await happyRun();
    expect(result.checkpoints).toHaveLength(6);
    for (const [index, checkpoint] of result.checkpoints.entries()) {
      const ordinal = index + 1;
      expect(checkpoint.index).toBe(ordinal);
      expect(checkpoint.watermark.watermarkMs).toBe(ordinal * 1_000);
      expect(checkpoint.consumedThroughSequence).toBe(ordinal - 1);
      expect(checkpoint.nextBatchOrdinal).toBe(ordinal + 1);
      expect(checkpoint.nextBoundaryMs).toBe((ordinal + 1) * 1_000);
      expect(checkpoint.nextWindowStartMs).toBe(ordinal * 1_000);
      // The skip set at cut time covers exactly the terminal keys so far.
      expect(checkpoint.processedKeys).toHaveLength(ordinal);
    }
  });
});

describe("incremental consumption (never whole-history re-reads)", () => {
  test("each store query returns a bounded slice; the totals prove no re-read", async () => {
    const { result, store } = await happyRun();
    // 6 batches were cut from 6 updates with bounded queries; every update
    // was materialized EXACTLY once across ALL queries (a whole-history
    // re-read per batch would materialize 1+2+…+6 = 21 entries).
    expect(store.materializedEntries).toBe(6);
    expect(store.queryCount).toBeGreaterThanOrEqual(6);
    expect(result.stats.batchesIn).toBe(6);
  });

  test("size-limit splits: a window longer than maxUpdatesPerBatch continues in the next batch", async () => {
    // 10 updates at 100ms steps inside one 1000ms window, max 4 per batch.
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 10 });
    // Re-time the story updates onto a 100ms grid within one window.
    const retime = updates.map((update, index) => ({
      ...update,
      watermark: { ...update.watermark, watermarkMs: (index + 1) * 100 },
    }));
    const store = new FixtureSwmStore(retime);
    const orchestrator = wiredOrchestrator(
      {
        store,
        clock,
        executor: createAnimeRenderBatchExecutor(),
        limits: { maxUpdatesPerBatch: 4 },
      },
      obs,
    );
    await orchestrator.start();
    const result = await orchestrator.done();
    // The single 1000ms window splits into 3 batches (4 + 4 + 2), then the
    // final flush closes the stream.
    expect(result.stats.batchSplits).toBeGreaterThanOrEqual(2);
    expect(result.stats.batchesIn).toBe(3);
    const closedBy = result.ledger.map((entry) => entry.disposition);
    expect(closedBy.every((disposition) => disposition === "rendered")).toBe(true);
    // Every batch's watermark is its last update's watermark, verbatim.
    expect(result.outputs.map((r) => r.provenance.sourceWatermark.watermarkMs)).toEqual([
      400, 800, 1_000,
    ]);
    expect(store.materializedEntries).toBe(10);
  });

  test("stream-complete flush: updates beyond the last boundary close honestly", async () => {
    // 6 updates on the 1000ms grid + one at 6_500 (past the 6_000 boundary
    // after the last window): the final flush cuts it with closedBy
    // stream-complete.
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({
      sessionId: SESSION,
      seconds: 6,
      extra: { watermarkMs: 6_500, byteSize: 2_048 },
    });
    const store = new FixtureSwmStore(updates);
    const orchestrator = wiredOrchestrator(
      { store, clock, executor: createAnimeRenderBatchExecutor() },
      obs,
    );
    await orchestrator.start();
    const result = await orchestrator.done();
    expect(result.stats.batchesIn).toBe(7);
    expect(result.stats.batchesRendered).toBe(7);
    expect(result.outputs).toHaveLength(7);
    // The flushed tail keeps its OWN verbatim watermark — never re-stamped to
    // a grid boundary — and the W502 manifest carries the step's own
    // presentation window [atMs, atMs+1000) (the renderer's convention for
    // every output, not the batch's consumption window).
    const tail = result.outputs[6]!;
    expect(tail.provenance.sourceWatermark.watermarkMs).toBe(6_500);
    expect(tail.output.frames[0]!.outputTimestampMs).toBe(6_500);
    expect(tail.output.manifest.frames[0]!.windowMs).toEqual({ startMs: 6_500, endMs: 7_500 });
    expect(result.ledger[6]!.watermark.watermarkMs).toBe(6_500);
    expect(result.ledger[6]!.disposition).toBe("rendered");
  });

  test("an empty store completes immediately with zero batches (honest, not failed)", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const store = new FixtureSwmStore([]);
    const orchestrator = wiredOrchestrator(
      { store, clock, executor: createAnimeRenderBatchExecutor() },
      obs,
    );
    await orchestrator.start();
    const result = await orchestrator.done();
    expect(result.outcome).toBe("completed");
    expect(result.stats).toEqual(emptyStats());
    expect(result.outputs).toHaveLength(0);
  });
});

describe("growing stream (the W402 consumption posture)", () => {
  test("batches arrive as the clock crosses growth steps, then the run completes", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(
      updates,
      [
        { atMs: 0, upToIndex: 1 },
        { atMs: 5_000, upToIndex: 5 },
      ],
      clock,
    );
    const orchestrator = wiredOrchestrator(
      { store, clock, executor: createAnimeRenderBatchExecutor({ renderDurationMs: 100 }) },
      obs,
    );
    await orchestrator.start();
    await drainMicrotasks(50);
    // First growth step: two batches have been consumed and rendered.
    expect(orchestrator.stats().batchesIn).toBe(2);
    expect(orchestrator.stats().batchesRendered).toBe(2);
    expect(store.revealedCount).toBe(2);
    // Advance past the second growth step: the consumer wakes, cuts the
    // rest, the run completes.
    clock.advanceTo(5_000);
    const result = await orchestrator.done();
    expect(result.outcome).toBe("completed");
    expect(result.stats.batchesIn).toBe(6);
    expect(result.stats.batchesRendered).toBe(6);
    expect(store.revealedCount).toBe(6);
  });

  test("a stalled store (neither complete nor growing) settles honestly as stopped", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    // Growth schedule that never completes: the final step reveals only the
    // first half of the stream and announces nothing further — the store is
    // neither complete nor growing after it (the `stalled` fixture posture).
    const stalled = new FixtureSwmStore(
      updates,
      [
        { atMs: 0, upToIndex: 1 },
        { atMs: 2_000, upToIndex: 3 },
      ],
      clock,
      { stalled: true },
    );
    const orchestrator = wiredOrchestrator(
      { store: stalled, clock, executor: createAnimeRenderBatchExecutor() },
      obs,
    );
    await orchestrator.start();
    await drainMicrotasks(20);
    clock.advanceTo(2_000);
    await drainMicrotasks(50);
    const result = await orchestrator.done();
    // The stall is honest: "stopped", never a fabricated "completed".
    expect(result.outcome).toBe("stopped");
    expect(result.stats.batchesIn).toBe(4);
    expect(result.stats.batchesRendered).toBe(4);
    // The stall is LOUD: a warn line names it.
    const stallLine = obs
      .records()
      .find((record) => record.msg.includes("stalled: store announces no further growth"));
    expect(stallLine).toBeDefined();
  });

  test("a store announcing a non-future growth time fails LOUD (the spin guard)", async () => {
    const clock = new VirtualGpuClock(5_000);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    // An adversarial LYING store (authored inline — the honest fixture can
    // never produce this posture, it reveals past steps eagerly): the head
    // sits behind the next boundary, nothing is consumable, and the store
    // announces a growth time that is NOT strictly in the future. The
    // consumer's spin guard must refuse LOUD (it would loop forever).
    const lyingStore: SwmUpdateStore = {
      availableWatermark: () => updates[0]!.watermark,
      isComplete: () => false,
      updatesAfter: () => ({ updates: [], more: false }),
      hasUpdatesAfter: () => false,
      nextGrowthAtMs: () => 4_000,
    };
    const orchestrator = wiredOrchestrator(
      { store: lyingStore, clock, executor: createAnimeRenderBatchExecutor() },
      obs,
    );
    await orchestrator.start();
    const result = await orchestrator.done();
    expect(result.outcome).toBe("failed");
    expect(result.terminalFailureClass).toBe("internal");
    expect(result.error).toContain("spin");
  });
});

describe("W303 job scheduling (the protocol seam)", () => {
  test("a duplicate re-submission of the same watermark NEVER double-executes", async () => {
    // Reprocess-mode resume over the SAME in-process dispatcher: every
    // re-cut batch carries the original idempotency key → the dispatcher
    // resolves duplicates (counted), and the executor is never re-invoked.
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(updates);
    const scripted = scriptedRenderExecutor(clock, {});
    const orchestrator = wiredOrchestrator({ store, clock, executor: scripted.executor }, obs);
    await orchestrator.start();
    const first = await orchestrator.done();
    expect(first.stats.batchesRendered).toBe(6);
    const checkpoint = first.checkpoints[2]!;
    await orchestrator.resume({ checkpoint, mode: "reprocess" });
    const second = await orchestrator.done();
    // Re-cut batches 4..6 (ordinal >= 4): all known keys → duplicates.
    expect(second.stats.batchesIn).toBe(3);
    expect(second.stats.batchesDuplicateSkips).toBe(3);
    expect(second.stats.batchesDuplicateSubmits).toBe(3);
    expect(second.stats.renderJobsDuplicate).toBe(3);
    expect(second.stats.batchesRendered).toBe(0);
    // NEVER double-executed: one invocation per batch ordinal, total.
    for (let ordinal = 1; ordinal <= 6; ordinal += 1) {
      expect(scripted.invocations(ordinal)).toBe(1);
    }
    // The dispatcher's own accounting agrees (its ledger is the registry).
    expect(orchestrator.dispatchStats().duplicates).toBe(3);
  });

  test("a non-retryable render failure drops the batch with its terminal class (never silent)", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(updates);
    // Batch 4 fails non-retryably; every other batch renders for real.
    const scripted = scriptedRenderExecutor(clock, {
      4: [{ result: { errorClass: "render-refused", message: "boom", retryable: false } }],
    });
    const orchestrator = wiredOrchestrator({ store, clock, executor: scripted.executor }, obs);
    await orchestrator.start();
    const result = await orchestrator.done();
    expect(result.outcome).toBe("completed");
    expect(result.stats.batchesRenderFailed).toBe(1);
    expect(result.stats.batchesDropped).toBe(1);
    expect(result.stats.batchesRendered).toBe(5);
    const failed = result.ledger.find((entry) => entry.disposition === "dropped");
    expect(failed?.dropReason).toBe("render-failed");
    expect(failed?.terminalClass).toBe("non-retryable");
    expect(failed?.jobId).toBe(`render-job-${SESSION}-4`);
    // The failure is LOUD: warn line + dropped metric with the reason.
    expect(
      obs
        .records()
        .some(
          (record) =>
            record.msg.includes("dropped (policy") && record.fields?.reason === "render-failed",
        ),
    ).toBe(true);
    // Outputs still emit in order around the hole.
    expect(result.outputs.map((r) => r.provenance.batchOrdinal)).toEqual([1, 2, 3, 5, 6]);
  });

  test("a retryable failure retries within the claim (the inherited W104 loop)", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(updates);
    // Batch 2 fails retryably once, then succeeds.
    const scripted = scriptedRenderExecutor(clock, {
      2: [
        { result: { errorClass: "transient", message: "flake", retryable: true } },
        { result: "succeed" },
      ],
    });
    const orchestrator = wiredOrchestrator(
      {
        store,
        clock,
        executor: scripted.executor,
        executorRetry: { maxAttempts: 2, baseDelayMs: 10, backoffMultiplier: 2 },
      },
      obs,
    );
    await orchestrator.start();
    const result = await orchestrator.done();
    expect(result.stats.batchesRendered).toBe(6);
    expect(scripted.invocations(2)).toBe(2);
  });

  test("a whole-job deadline breach classifies timeout and drops the batch (fail-loud)", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(updates);
    const scripted = scriptedRenderExecutor(clock, {
      3: [{ sleepMs: 5_000, result: "succeed" }],
    });
    const orchestrator = wiredOrchestrator(
      { store, clock, executor: scripted.executor, renderDeadlineMs: 1_000 },
      obs,
    );
    await orchestrator.start();
    const result = await orchestrator.done();
    expect(result.stats.batchesRenderFailed).toBe(1);
    const failed = result.ledger.find((entry) => entry.disposition === "dropped");
    expect(failed?.dropReason).toBe("render-failed");
    expect(failed?.terminalClass).toBe("timeout");
    expect(result.stats.batchesRendered).toBe(5);
  });

  test("ready-queue capacity refuses with the typed resource-limit class (the stream continues)", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 12 });
    const store = new FixtureSwmStore(updates);
    const scripted = scriptedRenderExecutor(clock, {});
    const orchestrator = wiredOrchestrator(
      { store, clock, executor: scripted.executor, limits: { maxQueuedRenderJobs: 1 } },
      obs,
    );
    await orchestrator.start();
    const result = await orchestrator.done();
    // Refusals are counted drops with the reason; the run still completes
    // and balances (the W104 reject posture — loud, bounded, continuing).
    expect(result.stats.batchesRenderQueueRefused).toBeGreaterThan(0);
    expect(result.stats.batchesDropped).toBe(result.stats.batchesRenderQueueRefused);
    expect(result.outcome).toBe("completed");
    const refused = result.ledger.filter((entry) => entry.dropReason === "render-queue-refused");
    expect(refused.length).toBe(result.stats.batchesRenderQueueRefused);
  });

  test("admitted-budget exhaustion terminates the run LOUD with the resource-limit class", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 8 });
    const store = new FixtureSwmStore(updates);
    const scripted = scriptedRenderExecutor(clock, {});
    const orchestrator = wiredOrchestrator(
      { store, clock, executor: scripted.executor, limits: { maxAdmittedJobs: 2 } },
      obs,
    );
    await orchestrator.start();
    const result = await orchestrator.done();
    expect(result.outcome).toBe("failed");
    expect(result.terminalFailureClass).toBe("resource-limit");
    // Every batch still lands in exactly one bucket.
    expect(
      result.stats.batchesRendered + result.stats.batchesDropped + result.stats.batchesCancelled,
    ).toBe(result.stats.batchesIn);
  });
});

describe("byte-budget admission (W104 verbatim, all three policies)", () => {
  function oversizedStore(): FixtureSwmStore {
    // 6 regular updates + one update whose byteSize alone exceeds any
    // reasonable whole-queue budget.
    const { updates } = buildSwmStory({
      sessionId: SESSION,
      seconds: 6,
      extra: { watermarkMs: 6_500, byteSize: 99_999 },
    });
    return new FixtureSwmStore(updates);
  }

  test("drop-oldest: the oversized incoming is dropped by the channel and attributed exactly", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const orchestrator = wiredOrchestrator(
      {
        store: oversizedStore(),
        clock,
        executor: createAnimeRenderBatchExecutor(),
        limits: { maxQueuedBatchBytes: 10_000 },
        backpressure: "drop-oldest",
      },
      obs,
    );
    await orchestrator.start();
    const result = await orchestrator.done();
    expect(result.stats.batchesIn).toBe(7);
    expect(result.stats.batchesQueueEvicted).toBe(1);
    expect(result.stats.batchesDropped).toBe(1);
    // The channel's OWN drop counter agrees (the cross-boundary identity).
    expect(result.channelDropped).toBe(1);
    expect(result.stats.batchesQueueEvicted).toBe(result.channelDropped);
    const evicted = result.ledger.find((entry) => entry.disposition === "dropped");
    expect(evicted?.dropReason).toBe("queue-evicted");
    expect(result.stats.batchesRendered).toBe(6);
    expect(result.outcome).toBe("completed");
  });

  test("block: the oversized incoming is refused with the typed error (never an infinite park)", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const orchestrator = wiredOrchestrator(
      {
        store: oversizedStore(),
        clock,
        executor: createAnimeRenderBatchExecutor(),
        limits: { maxQueuedBatchBytes: 10_000 },
        backpressure: "block",
      },
      obs,
    );
    await orchestrator.start();
    const result = await orchestrator.done();
    expect(result.stats.batchesQueueRefused).toBe(1);
    expect(result.stats.batchesDropped).toBe(1);
    expect(result.stats.batchesRendered).toBe(6);
    const refused = result.ledger.find((entry) => entry.disposition === "dropped");
    expect(refused?.dropReason).toBe("queue-refused");
    expect(result.outcome).toBe("completed");
  });

  test("reject: the same typed refusal under the reject policy", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const orchestrator = wiredOrchestrator(
      {
        store: oversizedStore(),
        clock,
        executor: createAnimeRenderBatchExecutor(),
        limits: { maxQueuedBatchBytes: 10_000 },
        backpressure: "reject",
      },
      obs,
    );
    await orchestrator.start();
    const result = await orchestrator.done();
    expect(result.stats.batchesQueueRefused).toBe(1);
    expect(result.stats.batchesDropped).toBe(1);
    expect(result.stats.batchesRendered).toBe(6);
  });
});

describe("skip-stale degradation (the explicit policy)", () => {
  test("batches older than the configured lag are SKIPPED at admission with their original watermark", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    // The complete store's head is 6_000 from the start: every batch whose
    // watermark lags by STRICTLY more than 3_000 (the policy's bound, pinned
    // by policy.test.ts) is skipped at admission — batches 1 (lag 5_000) and
    // 2 (lag 4_000); batch 3 (lag exactly 3_000) is NOT skipped.
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(updates);
    const orchestrator = wiredOrchestrator(
      {
        store,
        clock,
        executor: createAnimeRenderBatchExecutor(),
        degradation: { skipStale: { maxWatermarkLagMs: 3_000 } },
      },
      obs,
    );
    await orchestrator.start();
    const result = await orchestrator.done();
    expect(result.outcome).toBe("completed");
    expect(result.stats.batchesSkippedStale).toBe(2);
    expect(result.stats.batchesSkippedStaleAtAdmission).toBe(2);
    expect(result.stats.batchesSkippedStaleInQueue).toBe(0);
    expect(result.stats.batchesRendered).toBe(4);
    // The skips are LOUD and NEVER re-stamped: the ledger keeps the ORIGINAL
    // watermarks; the log line carries the measured lag + head evidence.
    const skipped = result.ledger.filter((entry) => entry.disposition === "skipped-stale");
    expect(skipped.map((entry) => entry.watermark.watermarkMs)).toEqual([1_000, 2_000]);
    for (const entry of skipped) {
      expect(entry.skipPhase).toBe("admission");
    }
    const skipLines = obs.records().filter((record) => record.msg.includes("skipped (stale"));
    expect(skipLines).toHaveLength(2);
    const first = skipLines[0]!.fields as Record<string, unknown>;
    expect(first.lagMs).toBe(5_000);
    expect(first.phase).toBe("admission");
    // Rendered outputs are the fresh tail, in order.
    expect(result.outputs.map((r) => r.provenance.sourceWatermark.watermarkMs)).toEqual([
      3_000, 4_000, 5_000, 6_000,
    ]);
  });

  test("the disabled default never skips (the honest baseline)", async () => {
    const { result } = await happyRun();
    expect(result.stats.batchesSkippedStale).toBe(0);
  });

  test("the skip is metered: render_batches_skipped_stale_total counts by phase", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(updates);
    const orchestrator = wiredOrchestrator(
      {
        store,
        clock,
        executor: createAnimeRenderBatchExecutor(),
        degradation: { skipStale: { maxWatermarkLagMs: 3_000 } },
      },
      obs,
    );
    await orchestrator.start();
    await orchestrator.done();
    const snapshot = obs.metrics.snapshot();
    const series = snapshot.counters.find(
      (counter) => counter.name === "render_batches_skipped_stale_total",
    );
    expect(series?.labels.phase).toBe("admission");
    expect(series?.value).toBe(2);
  });
});

describe("stop modes (drain and cancel)", () => {
  test("drain: no new batches are cut; everything inside completes in order", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 12 });
    // Growth stalls after the first two updates: the consumer parks waiting
    // for growth that never arrives this run.
    const store = new FixtureSwmStore(
      updates,
      [
        { atMs: 0, upToIndex: 1 },
        { atMs: 50_000, upToIndex: 11 },
      ],
      clock,
      { stalled: true },
    );
    const orchestrator = wiredOrchestrator(
      { store, clock, executor: createAnimeRenderBatchExecutor({ renderDurationMs: 100 }) },
      obs,
    );
    await orchestrator.start();
    await drainMicrotasks(50);
    expect(orchestrator.stats().batchesIn).toBe(2);
    const result = await orchestrator.stop({ mode: "drain" });
    // The run settles stopped (never a fabricated completion) with everything
    // INSIDE fully rendered and emitted in order — the drain promise.
    expect(result.outcome).toBe("stopped");
    expect(result.stats.batchesIn).toBe(2);
    expect(result.stats.batchesRendered).toBe(2);
    expect(result.stats.batchesInFlight).toBe(0);
    expect(result.outputs.map((r) => r.provenance.sourceWatermark.watermarkMs)).toEqual([
      1_000, 2_000,
    ]);
  });

  test("cancel: the parked send is abandoned, queued batches cancelled, in-flight job cancelled, outputs still emitted", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 12 });
    const store = new FixtureSwmStore(updates);
    // The comprehensive cancel posture (all deterministic): a slow async sink
    // holds the serialized emission chain, which parks the SCHEDULER inside a
    // refusal's terminal accounting — the consumer fills the 1-capacity
    // channel and its next send PARKS (block). At the stop: the parked send
    // is abandoned, the queued batch is cancelled at the dequeue sweep, the
    // in-flight job is cancelled at the dispatcher, the refused batch is a
    // counted drop, and the outputs already inside the chain still emit.
    const sinkCalls: number[] = [];
    const orchestrator = wiredOrchestrator(
      {
        store,
        clock,
        executor: createAnimeRenderBatchExecutor(),
        limits: { maxQueuedBatches: 1, maxQueuedRenderJobs: 2 },
        workers: [{ workerId: "w0", maxConcurrentJobs: 1 }],
        onOutput: async (record) => {
          sinkCalls.push(record.provenance.batchOrdinal);
          await drainMicrotasks(50);
        },
      },
      obs,
    );
    await orchestrator.start();
    await until(() => orchestrator.stats().consumerSendParkAttempts === 1, {
      label: "consumer parks on the full channel",
    });
    const result = await orchestrator.stop({ mode: "cancel" });
    expect(result.outcome).toBe("cancelled");
    expect(result.stats.batchesIn).toBe(7);
    // Completed work is never thrown away: batches 1-3 were inside the
    // emission chain and emitted IN ORDER through the slow sink.
    expect(result.stats.batchesRendered).toBe(3);
    expect(result.outputs.map((r) => r.provenance.batchOrdinal)).toEqual([1, 2, 3]);
    expect(sinkCalls).toEqual([1, 2, 3]);
    // The exact cancel accounting: batch 7's parked send ABANDONED (W301
    // posture), batch 4 cancelled at the dequeue sweep, batch 6's in-flight
    // job cancelled at the dispatcher, batch 5 a counted refusal drop.
    expect(result.stats.batchesAbandoned).toBe(1);
    expect(result.stats.batchesDropped).toBe(2);
    expect(result.stats.batchesQueueEvicted).toBe(0);
    expect(result.stats.batchesCancelled).toBe(2);
    expect(result.stats.batchesCancelledInQueue).toBe(1);
    expect(result.stats.batchesRenderCancelled).toBe(1);
    expect(result.stats.batchesRenderQueueRefused).toBe(1);
    expect(result.stats.renderJobsSubmitted).toBe(4);
    const abandoned = result.ledger.find((entry) => entry.dropReason === "abandoned-at-stop");
    expect(abandoned?.ordinal).toBe(7);
    const jobCancelled = result.ledger.find((entry) => entry.ordinal === 6);
    expect(jobCancelled?.disposition).toBe("cancelled");
    const sweepCancelled = result.ledger.find((entry) => entry.ordinal === 4);
    expect(sweepCancelled?.disposition).toBe("cancelled");
    expectBalanced(result);
  });

  test("cancel: every in-flight job is cancelled at the dispatcher and accounted render-cancelled", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(updates);
    // Jobs whose execution never settles (authored gates — no timers, no
    // hangs): the whole stream is submitted and parked in the protocol when
    // the cancel lands.
    const neverSettling: Set<number> = new Set([1, 2]);
    const real = createAnimeRenderBatchExecutor();
    const orchestrator = wiredOrchestrator(
      {
        store,
        clock,
        executor: {
          execute: (batch, request, context) =>
            neverSettling.has(batch.ordinal)
              ? new Promise<RenderBatchOutcome>(() => {})
              : real.execute(batch, request, context),
        },
      },
      obs,
    );
    await orchestrator.start();
    await until(
      () => orchestrator.stats().batchesIn === 6 && orchestrator.stats().renderJobsSubmitted === 6,
      { label: "the whole stream submitted" },
    );
    const result = await orchestrator.stop({ mode: "cancel" });
    expect(result.outcome).toBe("cancelled");
    // The dispatcher's cancel resolved all six jobs CANCELLED (the W303
    // "never lost" rule): every batch lands in exactly one bucket.
    expect(result.stats.batchesIn).toBe(6);
    expect(result.stats.batchesRenderCancelled).toBe(6);
    expect(result.stats.batchesCancelled).toBe(6);
    expect(result.stats.batchesCancelledInQueue).toBe(0);
    expect(result.stats.batchesRendered).toBe(0);
    expect(result.stats.batchesDropped).toBe(0);
    expect(result.stats.batchesAbandoned).toBe(0);
    const cancelled = result.ledger.filter((entry) => entry.disposition === "cancelled");
    expect(cancelled.map((entry) => entry.watermark.watermarkMs)).toEqual([
      1_000, 2_000, 3_000, 4_000, 5_000, 6_000,
    ]);
    expectBalanced(result);
  });

  test("cancel: completed outputs still emit (completed work is never thrown away)", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(
      updates,
      [
        { atMs: 0, upToIndex: 1 },
        { atMs: 60_000, upToIndex: 5 },
      ],
      clock,
      { stalled: true },
    );
    const orchestrator = wiredOrchestrator(
      { store, clock, executor: createAnimeRenderBatchExecutor() },
      obs,
    );
    await orchestrator.start();
    await drainMicrotasks(50);
    expect(orchestrator.stats().batchesRendered).toBe(2);
    const result = await orchestrator.stop({ mode: "cancel" });
    // Batches 1-2 completed and emitted BEFORE the cancel; the pending growth
    // is simply never consumed (no batches in flight, nothing to abandon).
    expect(result.outcome).toBe("cancelled");
    expect(result.stats.batchesIn).toBe(2);
    expect(result.stats.batchesRendered).toBe(2);
    expect(result.outputs).toHaveLength(2);
    expectBalanced(result);
  });

  test("stop is idempotent (the second call returns the SAME settled result)", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(updates);
    const orchestrator = wiredOrchestrator(
      { store, clock, executor: createAnimeRenderBatchExecutor() },
      obs,
    );
    await orchestrator.start();
    await drainMicrotasks(20);
    const first = await orchestrator.stop({ mode: "drain" });
    const second = await orchestrator.stop({ mode: "cancel" });
    expect(second).toBe(first);
    // done() still resolves the same settled result after a stop.
    const viaDone = await orchestrator.done();
    expect(viaDone).toBe(first);
  });
});

describe("recovery (resume from a checkpoint)", () => {
  test("skip-mode resume: re-cut batches resolve as counted duplicates, never re-executed", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(updates);
    const scripted = scriptedRenderExecutor(clock, {});
    const orchestrator = wiredOrchestrator({ store, clock, executor: scripted.executor }, obs);
    await orchestrator.start();
    const first = await orchestrator.done();
    expect(first.stats.batchesRendered).toBe(6);
    const checkpoint = first.checkpoints[2]!;
    await orchestrator.resume({ checkpoint, mode: "skip" });
    const second = await orchestrator.done();
    // Re-cut batches 4..6 (anchor: batch 3's cut). Their keys resolved AFTER
    // the checkpoint's cut, so they are NOT in the checkpoint's skip set —
    // the Recovery rule's at-least-once path: they are re-submitted, the
    // W303 dispatcher's key registry resolves them as COUNTED duplicates
    // (never double-claimed), and the executor is never re-invoked.
    expect(second.stats.batchesIn).toBe(3);
    expect(second.stats.batchesDuplicateSkips).toBe(3);
    expect(second.stats.batchesDuplicateSubmits).toBe(3);
    expect(second.stats.renderJobsDuplicate).toBe(3);
    expect(second.stats.batchesSentToQueue).toBe(3);
    expect(second.stats.batchesRendered).toBe(0);
    for (const entry of second.ledger) {
      expect(entry.disposition).toBe("duplicate");
    }
    // NEVER double-executed: one invocation per batch ordinal, total.
    for (let ordinal = 1; ordinal <= 6; ordinal += 1) {
      expect(scripted.invocations(ordinal)).toBe(1);
    }
    expectBalanced(second);
  });

  test("skip-mode resume: a checkpointed key is counted a duplicate at CONSUME and never re-submitted", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(updates);
    const scripted = scriptedRenderExecutor(clock, {});
    const orchestrator = wiredOrchestrator({ store, clock, executor: scripted.executor }, obs);
    await orchestrator.start();
    const first = await orchestrator.done();
    // Author the recovery state a durable store would serve: batch 4's key
    // was resolved BEFORE the checkpoint's cut (recorded in processedKeys)
    // even though the anchor sits at batch 3's cut — the skip-set membership
    // is what the Recovery rule dedupes on, wherever the key came from.
    const checkpoint = first.checkpoints[2]!;
    const batch4Key = first.ledger.find((entry) => entry.ordinal === 4)!.idempotencyKey;
    const authored: RenderCheckpoint = {
      ...checkpoint,
      processedKeys: [...checkpoint.processedKeys, { key: batch4Key, disposition: "rendered" }],
    };
    await orchestrator.resume({ checkpoint: authored, mode: "skip" });
    const second = await orchestrator.done();
    // Batch 4 is skipped AT CONSUME (never queued, never submitted); batches
    // 5 and 6 are re-submitted and deduped by the dispatcher's registry.
    expect(second.stats.batchesIn).toBe(3);
    expect(second.stats.batchesDuplicateSkips).toBe(3);
    expect(second.stats.batchesDuplicateSkipsAtConsume).toBe(1);
    expect(second.stats.batchesDuplicateSubmits).toBe(2);
    expect(second.stats.batchesSentToQueue).toBe(2);
    expect(second.stats.renderJobsSubmitted).toBe(0);
    expect(second.stats.batchesRendered).toBe(0);
    const consumeSkipped = second.ledger.find((entry) => entry.idempotencyKey === batch4Key)!;
    expect(consumeSkipped.disposition).toBe("duplicate");
    for (let ordinal = 1; ordinal <= 6; ordinal += 1) {
      expect(scripted.invocations(ordinal)).toBe(1);
    }
    expectBalanced(second);
  });

  test("an interrupted run recovers from its last checkpoint (at-least-once, never double-executed)", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 12 });
    const store = new FixtureSwmStore(
      updates,
      [
        { atMs: 0, upToIndex: 2 },
        { atMs: 60_000, upToIndex: 11 },
      ],
      clock,
      { stalled: true },
    );
    // Batch 3 renders slowly: at the stop it is still in flight — the exact
    // "cut but unresolved at cut time" case the checkpoint anchoring keeps.
    const scripted = scriptedRenderExecutor(clock, {
      3: [{ sleepMs: 5_000, result: "succeed" }],
    });
    const orchestrator = wiredOrchestrator({ store, clock, executor: scripted.executor }, obs);
    await orchestrator.start();
    await drainMicrotasks(50);
    const interrupted = await orchestrator.stop({ mode: "drain" });
    expect(interrupted.outcome).toBe("stopped");
    expect(interrupted.stats.batchesIn).toBe(3);
    // The drain waited for the in-flight batch 3: everything terminal.
    expect(interrupted.stats.batchesInFlight).toBe(0);
    const checkpoint = interrupted.checkpoints[interrupted.checkpoints.length - 1]!;
    // Recovery: the pending growth is revealed now (the store completes).
    clock.advanceTo(60_000);
    await orchestrator.resume({ checkpoint, mode: "skip" });
    const recovered = await orchestrator.done();
    // The recovery run consumed the REST of the stream (batches cut after the
    // checkpoint's consumedThroughSequence anchor) and closed the accounting.
    expect(recovered.outcome).toBe("completed");
    expect(recovered.stats.batchesIn).toBeGreaterThanOrEqual(9);
    expect(recovered.stats.batchesDuplicateSkips).toBe(0);
    expectBalanced(recovered);
    // The deterministic replay re-cut the same keys: the W303 dispatcher's
    // registry (alive in-process) would dedupe any overlap — and the executor
    // never ran twice for one watermark (the re-cut batches after the
    // checkpoint had never been executed).
    for (let ordinal = 4; ordinal <= 12; ordinal += 1) {
      expect(scripted.invocations(ordinal)).toBe(1);
    }
  });

  test("resume refuses a corrupt checkpoint loudly (never a silent replay)", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(updates);
    const orchestrator = wiredOrchestrator(
      { store, clock, executor: createAnimeRenderBatchExecutor() },
      obs,
    );
    await orchestrator.start();
    const first = await orchestrator.done();
    const checkpoint = first.checkpoints[1]!;
    await orchestrator.stop({ mode: "drain" });
    const corrupt = { ...checkpoint, consumedThroughSequence: -1 };
    expect(orchestrator.currentPhase).toBe("stopped");
    await expect(orchestrator.resume({ checkpoint: corrupt, mode: "skip" })).rejects.toThrow();
    // The phase is untouched by the refused resume (the run state is intact).
    expect(orchestrator.currentPhase).toBe("stopped");
  });
});
