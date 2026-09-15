/**
 * The batch registry (W304): the payload-resolution table behind the W303
 * `payloadRef` seam plus the in-queue FIFO ledger that attributes the W104
 * channel's own `drop-oldest` evictions to specific batches.
 *
 * Two honest duties, no clocks, no I/O:
 *
 * - `register`/`resolve`: the orchestrator registers every cut batch; the
 *   internal W303 job adapter resolves `payloadRef → batch` through this
 *   table (an unknown ref THROWS — a job naming an unknown batch is an
 *   internal fault, never silently skipped);
 * - `enqueueLedger`: the orchestrator appends every admitted-to-channel
 *   batch id and removes it at dequeue; when the channel's own
 *   `dropped` counter advances (the channel owns its eviction accounting —
 *   W104 verbatim), `takeEvicted` attributes the delta to the SPECIFIC
 *   oldest queued batches, so every eviction lands in the batch ledger with
 *   its own record (never a silent lump). The cross-boundary identity
 *   `sum(evictions attributed) === channel.dropped` is asserted at settle.
 */
import type { RenderBatch } from "./types";
import { RenderOutputInvalidError } from "./errors";

/** Payload resolution + queue-eviction attribution for one orchestrator. */
export class BatchRegistry {
  private readonly batches = new Map<string, RenderBatch>();
  private readonly queue: string[] = [];

  /** Registers one cut batch (idempotent overwrite for deterministic resume replays). */
  register(batch: RenderBatch): void {
    this.batches.set(batch.batchId, batch);
  }

  /**
   * Resolves the W303 `payloadRef` (`render-batch:<batchId>`) to its batch.
   * Fail-loud: an unknown reference is an internal protocol fault.
   */
  resolve(payloadRef: string): RenderBatch {
    const batchId = payloadRef.startsWith("render-batch:")
      ? payloadRef.slice("render-batch:".length)
      : payloadRef;
    const batch = this.batches.get(batchId);
    if (batch === undefined) {
      throw new RenderOutputInvalidError(
        `render job payloadRef '${payloadRef}' names an unknown batch`,
        { payloadRef },
      );
    }
    return batch;
  }

  /** Records a batch admitted to the channel (the FIFO tail). */
  markQueued(batchId: string): void {
    this.queue.push(batchId);
  }

  /** Records a batch dequeued from the channel (removed wherever it sits). */
  markDequeued(batchId: string): void {
    const index = this.queue.indexOf(batchId);
    if (index >= 0) {
      this.queue.splice(index, 1);
    }
  }

  /**
   * Attributes up to `count` channel-owned evictions to the OLDEST still-ledgered
   * queued batches (the drop-oldest policy evicts the oldest first). Returns
   * the evicted batch ids in eviction order; shorter than `count` only when
   * the ledger is exhausted (an imbalance the settle-time cross-boundary
   * assertion catches).
   */
  takeEvicted(count: number): string[] {
    const evicted: string[] = [];
    for (let i = 0; i < count && this.queue.length > 0; i += 1) {
      const batchId = this.queue.shift();
      if (batchId === undefined) break;
      evicted.push(batchId);
    }
    return evicted;
  }

  /** Batch ids currently believed queued (test observability). */
  get queuedCount(): number {
    return this.queue.length;
  }

  /** Number of registered batches (test observability). */
  get registeredCount(): number {
    return this.batches.size;
  }
}
