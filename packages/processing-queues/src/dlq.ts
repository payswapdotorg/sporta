/**
 * The bounded dead-letter queue (W302).
 *
 * Terminally failed segments (non-retryable, retry-exhausted, internal) land
 * here — the streaming contract's explicit-failure posture: the final error
 * is never swallowed (W104 retry rule), and every entry carries the
 * segment, the stage id, the error class, and the injected clock's
 * timestamp.
 *
 * The DLQ is itself BOUNDED (architecture-lock §13): beyond
 * `maxDeadLetterEntries` retained entries, failures are still counted,
 * logged, and metered (`dlqOverflow`) — never silent — but not retained.
 * The pipeline-level `deadLettered` counter counts ALL terminal failures;
 * `deadLetters()` returns only the retained window.
 */
import type { DeadLetterEntry } from "./types";
import { PROCESSING_METRIC_NAMES as METRICS } from "./types";
import type { Logger, MetricsRegistry } from "@sporta/observability";

/**
 * The bounded dead-letter ledger. Construct with the retention bound and
 * the observability seams; `record` appends one entry (or counts overflow).
 */
export class DeadLetterQueue {
  private readonly entries: DeadLetterEntry[] = [];
  private overflowed = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly logger: Logger,
    private readonly metrics: MetricsRegistry,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError(
        `DeadLetterQueue maxEntries must be an integer >= 1 (got ${String(maxEntries)})`,
      );
    }
  }

  /** Retained entries, in occurrence order (the entries themselves are frozen). */
  list(): DeadLetterEntry[] {
    return [...this.entries];
  }

  /** Retained entry count. */
  get size(): number {
    return this.entries.length;
  }

  /** Entries beyond the retention bound (counted + logged + metered, never silent). */
  get overflow(): number {
    return this.overflowed;
  }

  /** Records one terminal failure (frozen entry, warn log, metrics). */
  record(entry: DeadLetterEntry): void {
    this.metrics.counter(METRICS.deadLetteredTotal).inc();
    this.metrics.counter(METRICS.dlqEntriesTotal, { terminal: entry.terminal }).inc();
    if (this.entries.length >= this.maxEntries) {
      this.overflowed += 1;
      this.logger.warn("dead-letter queue overflow (entry counted, not retained)", {
        stage: entry.stage,
        idempotencyKey: entry.idempotencyKey,
        errorClass: entry.errorClass,
        terminal: entry.terminal,
        overflow: this.overflowed,
        maxEntries: this.maxEntries,
        correlationId: entry.correlationId,
        traceId: entry.traceId,
      });
      return;
    }
    this.entries.push(Object.freeze(entry));
    this.logger.warn("segment dead-lettered", {
      stage: entry.stage,
      idempotencyKey: entry.idempotencyKey,
      errorClass: entry.errorClass,
      terminal: entry.terminal,
      attempts: entry.attempts,
      retriesUsed: entry.retriesUsed,
      atMs: entry.atMs,
      sequence: entry.sequence,
      correlationId: entry.correlationId,
      traceId: entry.traceId,
    });
  }
}
