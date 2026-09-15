/**
 * The batch registry (W304): payload resolution behind the W303 `payloadRef`
 * seam + the in-queue FIFO ledger for channel-eviction attribution.
 */
import { describe, expect, test } from "bun:test";
import { BatchRegistry } from "../src/registry";
import { cutBatch } from "../src/batch";
import { RenderOutputInvalidError } from "../src/errors";
import type { SwmUpdate } from "../src/types";

function update(sequence: number, watermarkMs: number): SwmUpdate {
  return {
    sequence,
    watermark: { watermarkMs, sequence },
    snapshot: {
      sessionId: "sess",
      schemaVersion: "1.0",
      entities: [],
      watermark: { watermarkMs, sequence },
      generatedAtMs: 0,
    },
    events: [],
    byteSize: 100,
  };
}

function batchOf(ordinal: number): ReturnType<typeof cutBatch> {
  return cutBatch({
    sessionId: "sess",
    ordinal,
    windowMs: { startMs: (ordinal - 1) * 1_000, endMs: ordinal * 1_000 },
    updates: [update(ordinal, ordinal * 1_000)],
    closedBy: "watermark-boundary",
  });
}

describe("BatchRegistry.resolve (the payloadRef seam)", () => {
  test("registers and resolves batches by id, with or without the prefix", () => {
    const registry = new BatchRegistry();
    const batch = batchOf(1);
    registry.register(batch);
    expect(registry.resolve(`render-batch:${batch.batchId}`)).toBe(batch);
    expect(registry.resolve(batch.batchId)).toBe(batch);
  });

  test("an unknown payloadRef THROWS (an internal fault, never a silent skip)", () => {
    const registry = new BatchRegistry();
    try {
      registry.resolve("render-batch:render-batch-sess-99");
      expect.unreachable("expected resolve of unknown ref to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RenderOutputInvalidError);
      const error = err as RenderOutputInvalidError;
      expect(error.terminalFailureClass).toBe("internal");
      expect(error.details.payloadRef).toBe("render-batch:render-batch-sess-99");
    }
  });

  test("register is idempotent overwrite (deterministic resume replays)", () => {
    const registry = new BatchRegistry();
    const first = batchOf(1);
    const replay = batchOf(1);
    registry.register(first);
    registry.register(replay);
    expect(registry.registeredCount).toBe(1);
    expect(registry.resolve(first.batchId)).toBe(replay);
  });
});

describe("BatchRegistry in-queue ledger (eviction attribution)", () => {
  test("markQueued/markDequeued track the FIFO order", () => {
    const registry = new BatchRegistry();
    const batches = [batchOf(1), batchOf(2), batchOf(3)];
    for (const batch of batches) {
      registry.register(batch);
      registry.markQueued(batch.batchId);
    }
    expect(registry.queuedCount).toBe(3);
    registry.markDequeued(batches[0]!.batchId);
    expect(registry.queuedCount).toBe(2);
    registry.markDequeued(batches[2]!.batchId);
    expect(registry.queuedCount).toBe(1);
  });

  test("markDequeued of an unknown id is a no-op (the pre-send removal path)", () => {
    const registry = new BatchRegistry();
    registry.markDequeued("render-batch-sess-404");
    expect(registry.queuedCount).toBe(0);
  });

  test("takeEvicted attributes the OLDEST queued batches, in eviction order", () => {
    const registry = new BatchRegistry();
    const batches = [batchOf(1), batchOf(2), batchOf(3), batchOf(4)];
    for (const batch of batches) {
      registry.register(batch);
      registry.markQueued(batch.batchId);
    }
    const evicted = registry.takeEvicted(2);
    expect(evicted).toEqual([batches[0]!.batchId, batches[1]!.batchId]);
    expect(registry.queuedCount).toBe(2);
    // Dequeue order after eviction is the survivors, oldest first.
    registry.markDequeued(batches[2]!.batchId);
    const next = registry.takeEvicted(1);
    expect(next).toEqual([batches[3]!.batchId]);
  });

  test("takeEvicted returns fewer only when the ledger is exhausted (the settle assertion catches the imbalance)", () => {
    const registry = new BatchRegistry();
    const batch = batchOf(1);
    registry.register(batch);
    registry.markQueued(batch.batchId);
    expect(registry.takeEvicted(3)).toEqual([batch.batchId]);
    expect(registry.queuedCount).toBe(0);
    expect(registry.takeEvicted(1)).toEqual([]);
  });
});
