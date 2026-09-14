/**
 * The bounded dead-letter queue (W303), the W302 posture verbatim.
 *
 * Jobs whose RECOVERY BUDGET ran out — retryable executor failures that
 * consumed the worker retry budget (`retry-exhausted`, the W104 rule: the
 * final failure is never swallowed), lease-expiry requeues that consumed
 * the claim budget (`retry-exhausted` via `lease-expired`), or internal
 * executor faults (`internal`) — land here with the full attempt/claim
 * accounting and the dispatcher-clock timestamp.
 *
 * The DLQ is itself BOUNDED (architecture-lock §13): beyond
 * `maxDlqEntries` retained entries, failures are still counted, logged,
 * and metered (`dlqOverflow` — never silent) but not retained. The
 * dispatcher-level `deadLettered` counter counts ALL dead letters;
 * `list()` returns only the retained window.
 */
import { GPU_METRIC_NAMES as METRICS } from "./types";
import type { GpuDeadLetterEntry } from "./types";
import type { Logger, MetricsRegistry } from "@sporta/observability";

/**
 * The bounded dead-letter ledger. Construct with the retention bound and
 * the observability seams; `record` appends one entry (or counts overflow).
 */
export class GpuDeadLetterQueue {
  private readonly entries: GpuDeadLetterEntry[] = [];
  private overflowed = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly logger: Logger,
    private readonly metrics: MetricsRegistry,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError(
        `GpuDeadLetterQueue maxEntries must be an integer >= 1 (got ${String(maxEntries)})`,
      );
    }
  }

  /** Retained entries, in occurrence order (the entries themselves are frozen). */
  list(): GpuDeadLetterEntry[] {
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

  /** Records one dead letter (frozen entry, warn log, metrics). */
  record(entry: GpuDeadLetterEntry): void {
    this.metrics.counter(METRICS.deadLettered).inc();
    this.metrics.counter(METRICS.dlqEntries, { terminal: entry.terminal }).inc();
    if (this.entries.length >= this.maxEntries) {
      this.overflowed += 1;
      this.logger.warn("gpu dead-letter queue overflow (entry counted, not retained)", {
        jobId: entry.jobId,
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
    this.logger.warn("gpu job dead-lettered", {
      jobId: entry.jobId,
      idempotencyKey: entry.idempotencyKey,
      errorClass: entry.errorClass,
      terminal: entry.terminal,
      attempts: entry.attempts,
      claims: entry.claims,
      retriesUsed: entry.retriesUsed,
      atMs: entry.atMs,
      correlationId: entry.correlationId,
      traceId: entry.traceId,
    });
  }
}
