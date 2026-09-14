/**
 * The terminal-disposition registry (W302) — the idempotency-key record
 * behind duplicate counting and checkpoint/resume recovery.
 *
 * The streaming contract's Recovery rule: "Duplicate messages are tolerated
 * through idempotency keys" (docs/contracts/streaming.md). This registry
 * records, per idempotency key, the FIRST TERMINAL disposition a segment
 * reached in this pipeline — `emitted` (completed the last stage) or
 * `dead-lettered` (terminally failed). Re-submission of a registered key is
 * an idempotent duplicate: counted and skipped, never silently re-processed
 * and never silently collapsed.
 *
 * In-flight keys are deliberately NOT registered: a key is only known once
 * its segment reached a terminal disposition, so a crash mid-flight leaves
 * the key unregistered and `resumePipeline` re-processes it (at-least-once
 * recovery — downstream stages dedupe on the key, exactly the contract's
 * rule). Refused/abandoned/dropped segments are also unregistered: they
 * never completed, so re-delivery is fresh work, not a duplicate.
 *
 * First write wins; records are frozen on creation. `resumePipeline`
 * preloads a fresh registry from a checkpoint so the skip rule applies
 * across process restarts.
 */

/** The terminal disposition recorded for one idempotency key. */
export type TerminalDisposition = "emitted" | "dead-lettered";

/** One frozen registry record. */
export interface TerminalRecord {
  /** The segment's idempotency key. */
  idempotencyKey: string;
  /** The first terminal disposition reached for that key. */
  disposition: TerminalDisposition;
}

/**
 * Maps idempotency keys to their first terminal disposition. One instance
 * per pipeline (internal organ, exposed read-only for tests and telemetry);
 * `resumePipeline` preloads one from a checkpoint before processing begins.
 */
export class TerminalDispositionRegistry {
  private readonly byKey = new Map<string, TerminalRecord>();

  /** Number of distinct terminally-disposed keys. */
  get size(): number {
    return this.byKey.size;
  }

  /** The record previously registered for `idempotencyKey`, if any (frozen). */
  get(idempotencyKey: string): TerminalRecord | undefined {
    return this.byKey.get(idempotencyKey);
  }

  /**
   * Registers `disposition` for `idempotencyKey`. First write wins: a later
   * put for the same key is a no-op preserving the original record. Returns
   * `true` when the record was newly written.
   */
  put(idempotencyKey: string, disposition: TerminalDisposition): boolean {
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1) {
      throw new RangeError(
        `TerminalDispositionRegistry.put requires a non-empty idempotencyKey ` +
          `(got ${String(idempotencyKey)})`,
      );
    }
    if (disposition !== "emitted" && disposition !== "dead-lettered") {
      throw new RangeError(
        `TerminalDispositionRegistry.put disposition must be "emitted" | "dead-lettered" ` +
          `(got ${String(disposition)})`,
      );
    }
    if (this.byKey.has(idempotencyKey)) return false;
    this.byKey.set(idempotencyKey, Object.freeze({ idempotencyKey, disposition }));
    return true;
  }

  /** All records in registration order, as fresh copies owned by the caller. */
  records(): TerminalRecord[] {
    return [...this.byKey.values()].map((record) => ({ ...record }));
  }

  /**
   * The registered keys in registration order with their dispositions — the
   * shape checkpoints persist (`processedKeys`).
   */
  processedKeys(): Array<{ key: string; disposition: TerminalDisposition }> {
    return this.records().map((record) => ({
      key: record.idempotencyKey,
      disposition: record.disposition,
    }));
  }
}
