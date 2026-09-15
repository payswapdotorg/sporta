/**
 * Result emission (W304): the SERIALIZED in-order drain chain — outputs emit
 * in watermark order (== batch-ordinal order) through ONE chain, so the sink
 * is called one record at a time, awaited, strictly in order, even when jobs
 * complete out of order or the sink's own promises resolve out of order.
 * Plus the reorder-bound honesty (overflow drops the INCOMING output) and
 * the sink-failure posture (a throwing sink rejects `done()` — the affected
 * batch never lands a lying disposition; the settle-time in-flight assertion
 * is the backstop).
 */
import { describe, expect, test } from "bun:test";
import { VirtualGpuClock } from "@sporta/gpu-worker";
import { createAnimeRenderBatchExecutor } from "../src/executor";
import type { RenderBatchOutcome } from "../src/types";
import {
  FixtureSwmStore,
  buildSwmStory,
  capturedObservability,
  drainMicrotasks,
  expectBalanced,
  wiredOrchestrator,
} from "./helpers";

const SESSION = "sess-emission";

/** An executor whose ordinal-1 render is slow in MICROTASKS (not clock). */
function slowFirstExecutor(ticks: number): ReturnType<typeof createAnimeRenderBatchExecutor> {
  const real = createAnimeRenderBatchExecutor();
  return {
    execute: async (batch, request, context): Promise<RenderBatchOutcome> => {
      if (batch.ordinal === 1) {
        await drainMicrotasks(ticks);
      }
      return real.execute(batch, request, context);
    },
  };
}

describe("watermark-ordered emission (the serialized drain chain)", () => {
  test("a job that completes OUT OF ORDER waits in the bounded reorder and emits in order", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 2 });
    const store = new FixtureSwmStore(updates);
    const orchestrator = wiredOrchestrator(
      {
        store,
        clock,
        sessionId: SESSION,
        executor: slowFirstExecutor(100),
        workers: [{ workerId: "w0", maxConcurrentJobs: 2 }],
      },
      obs,
    );
    await orchestrator.start();
    const result = await orchestrator.done();
    // Job 2 finished first (job 1 held 100 microtask hops) and waited in the
    // reorder buffer — the emission order is STILL watermark order.
    expect(result.outputs.map((r) => r.provenance.batchOrdinal)).toEqual([1, 2]);
    expect(result.stats.peakReorderSize).toBeGreaterThanOrEqual(1);
    expect(result.stats.batchesRendered).toBe(2);
    expectBalanced(result);
  });

  test("an async sink that resolves out of order still observes strictly ordered, never-concurrent calls", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(updates);
    const sinkCalls: number[] = [];
    let sinkDepth = 0;
    let maxSinkDepth = 0;
    const orchestrator = wiredOrchestrator(
      {
        store,
        clock,
        sessionId: SESSION,
        executor: createAnimeRenderBatchExecutor(),
        // Later records' promises resolve EARLIER (fewer hops) — the chain
        // still calls the sink strictly in ordinal order, one at a time.
        onOutput: async (record) => {
          sinkDepth += 1;
          maxSinkDepth = Math.max(maxSinkDepth, sinkDepth);
          sinkCalls.push(record.provenance.batchOrdinal);
          await drainMicrotasks(20 - record.provenance.batchOrdinal);
          sinkDepth -= 1;
        },
      },
      obs,
    );
    await orchestrator.start();
    const result = await orchestrator.done();
    expect(sinkCalls).toEqual([1, 2, 3, 4, 5, 6]);
    expect(maxSinkDepth).toBe(1);
    expect(result.outputs.map((r) => r.provenance.batchOrdinal)).toEqual([1, 2, 3, 4, 5, 6]);
    expectBalanced(result);
  });

  test("the direct-handoff path keeps the in-queue ledger exact (ledger marked BEFORE the send)", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(updates);
    const orchestrator = wiredOrchestrator(
      { store, clock, sessionId: SESSION, executor: createAnimeRenderBatchExecutor() },
      obs,
    );
    await orchestrator.start();
    const result = await orchestrator.done();
    // The scheduler always re-parks on receive() before the consumer's next
    // cut (the fast-render shape), so every send hands the message STRAIGHT
    // to the parked receiver — the dequeue continuation runs before the
    // send's continuation. Marking the batch queued BEFORE the send is what
    // keeps the FIFO ledger exact on that path: a stale entry would break
    // the settle-time in-queue drain proof (a RangeError, never a lie).
    expect(result.stats.peakQueuedNow).toBe(0);
    expect(result.stats.queuedNow).toBe(0);
    expect(result.stats.batchesReceivedFromQueue).toBe(6);
    expect(result.stats.batchesSentToQueue).toBe(6);
    expectBalanced(result);
  });
});

describe("the bounded reorder buffer", () => {
  test("overflow drops the INCOMING output (never a closer-to-head one) with full accounting", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(updates);
    // Job 1 is slow in microtasks; jobs 2+ complete and hold the 2-slot
    // reorder while the head (1) is missing: every later output (and job 1's
    // own, once it completes against a full buffer) is dropped as
    // `reorder-overflow` — the INCOMING record, never an evicted held one.
    const orchestrator = wiredOrchestrator(
      {
        store,
        clock,
        sessionId: SESSION,
        executor: slowFirstExecutor(200),
        limits: { maxReorderOutputs: 2 },
        workers: [{ workerId: "w0", maxConcurrentJobs: 2 }],
      },
      obs,
    );
    await orchestrator.start();
    const result = await orchestrator.done();
    expect(result.stats.batchesIn).toBe(6);
    expect(result.stats.batchesReorderOverflow).toBe(4);
    expect(result.stats.batchesRendered).toBe(2);
    expect(result.stats.peakReorderSize).toBe(2);
    expect(result.outputs.map((r) => r.provenance.batchOrdinal)).toEqual([2, 3]);
    const overflowed = result.ledger.filter((entry) => entry.dropReason === "reorder-overflow");
    expect(overflowed.map((entry) => entry.ordinal)).toEqual([4, 5, 6, 1]);
    // The drops are LOUD: one warn line per overflowed output.
    const overflowLines = obs
      .records()
      .filter((record) => record.msg.includes("reorder buffer full"));
    expect(overflowLines).toHaveLength(4);
    expectBalanced(result);
  });
});

describe("sink failures (fail-loud, never a lying disposition)", () => {
  test("a throwing sink REJECTS done() and the affected batch never lands a lying rendered disposition", async () => {
    const clock = new VirtualGpuClock(0);
    const obs = capturedObservability();
    const { updates } = buildSwmStory({ sessionId: SESSION, seconds: 6 });
    const store = new FixtureSwmStore(updates);
    const orchestrator = wiredOrchestrator(
      {
        store,
        clock,
        sessionId: SESSION,
        executor: createAnimeRenderBatchExecutor(),
        onOutput: (record) => {
          if (record.provenance.batchOrdinal === 3) {
            throw new Error("sink exploded");
          }
        },
      },
      obs,
    );
    await orchestrator.start();
    // done() REJECTS with the settle-time backstop (a batch that never
    // reached a terminal disposition — an internal fault, never a result
    // with a lying or missing bucket).
    await expect(orchestrator.done()).rejects.toThrow("still in flight at settle");
    // The affected batch is accounted NOWHERE: no ledger entry, no rendered
    // counter — it stays in-flight in the live stats (the evidence).
    const stats = orchestrator.stats();
    expect(stats.batchesIn).toBe(6);
    expect(stats.batchesInFlight).toBe(1);
    expect(stats.outputsEmitted).toBe(5);
    const ledger = orchestrator.ledger();
    expect(ledger.map((entry) => entry.ordinal)).toEqual([1, 2, 4, 5, 6]);
    expect(ledger.every((entry) => entry.disposition === "rendered")).toBe(true);
    // The run's terminal failure is recorded loud in the logs.
    expect(
      obs
        .records()
        .some((record) => record.msg.includes("output sink or render continuation failed")),
    ).toBe(true);
  });
});
