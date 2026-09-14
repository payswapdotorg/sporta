/**
 * In-memory live-segment receipt registry (W301) — the per-segment analog of
 * the W101 `SourceRegistry`: upstream `segmentId` (the idempotency key) →
 * receipt. Re-delivering the same segment id returns the ORIGINAL receipt
 * ("duplicate messages are tolerated through idempotency keys" —
 * docs/contracts/streaming.md); no duplicate receipt is ever minted and no
 * re-delivery is silently collapsed (duplicates are counted by the service).
 *
 * First write wins; receipts are frozen on creation so returned references
 * cannot be mutated. Share one registry per session (the service always does
 * — the registry is an internal organ exposed read-only for tests and
 * telemetry).
 */
import type { LiveSegmentReceipt } from "./types";

/** Maps upstream segment ids to the receipt minted at first acceptance. */
export class LiveSegmentRegistry {
  private readonly bySegmentId = new Map<string, LiveSegmentReceipt>();

  /** Number of distinct receipted segments. */
  get size(): number {
    return this.bySegmentId.size;
  }

  /** The receipt previously minted for `segmentId`, if any. */
  get(segmentId: string): LiveSegmentReceipt | undefined {
    return this.bySegmentId.get(segmentId);
  }

  /**
   * Registers `receipt` under its segment id. First write wins: a later put
   * for the same id is a no-op, preserving the original acceptance record.
   */
  put(receipt: LiveSegmentReceipt): void {
    if (!this.bySegmentId.has(receipt.segmentId)) {
      this.bySegmentId.set(receipt.segmentId, receipt);
    }
  }

  /** All receipts in mint order, as fresh copies owned by the caller. */
  receipts(): LiveSegmentReceipt[] {
    return [...this.bySegmentId.values()].map((receipt) => ({ ...receipt }));
  }
}
