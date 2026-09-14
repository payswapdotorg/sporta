/**
 * Dead-letter queue tests (W302): every terminal failure is retained with
 * its full evidence (segment, stage, error class, clock timestamp), the DLQ
 * is itself BOUNDED, and overflow is counted + logged + metered — never
 * silent.
 */
import { describe, expect, test } from "bun:test";
import { DeadLetterQueue } from "../src/dlq";
import type { DeadLetterEntry } from "../src/types";
import { PROCESSING_METRIC_NAMES as METRICS } from "../src/types";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import type { LogRecord } from "@sporta/observability";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { segment } from "./helpers";

/** Captured logger + metrics for DLQ evidence assertions. */
function captured(): { lines: LogRecord[]; metrics: MetricsRegistry; queue: DeadLetterQueue } {
  const lines: LogRecord[] = [];
  const metrics = new MetricsRegistry();
  const logger = createLogger({
    sink: (line) => lines.push(JSON.parse(line) as LogRecord),
    now: () => TEST_EPOCH_MS,
  });
  const queue = new DeadLetterQueue(2, logger, metrics);
  return { lines, metrics, queue };
}

function entry(key: string, atMs: number): DeadLetterEntry {
  return {
    idempotencyKey: key,
    stage: "detect",
    errorClass: "transient",
    message: `failure for ${key}`,
    terminal: "retry-exhausted",
    attempts: 3,
    retriesUsed: 2,
    atMs,
    segment: segment(key, 0),
    sequence: 0,
    correlationId: "corr-1",
    traceId: "trace-1",
  };
}

describe("DeadLetterQueue", () => {
  test("records entries in occurrence order", () => {
    const { queue } = captured();
    queue.record(entry("k0", 10));
    queue.record(entry("k1", 20));
    expect(queue.list().map((e) => e.idempotencyKey)).toEqual(["k0", "k1"]);
    expect(queue.size).toBe(2);
    expect(queue.overflow).toBe(0);
  });

  test("entries are frozen (evidence cannot be mutated after the fact)", () => {
    const { queue } = captured();
    queue.record(entry("k0", 10));
    expect(() => {
      (queue.list()[0] as { errorClass: string }).errorClass = "tampered";
    }).toThrow();
  });

  test("each record logs one warn line and bumps the metrics", () => {
    const { queue, lines, metrics } = captured();
    queue.record(entry("k0", 10));
    expect(lines.filter((l) => l.msg === "segment dead-lettered")).toHaveLength(1);
    // The DLQ logger is a plain logger: stage/error class ride the `fields`
    // payload (only a bound child logger promotes `stage` to the record top
    // level — the pipeline's per-segment lines do that).
    expect(lines[0]).toMatchObject({ level: "warn" });
    expect(lines[0]!.fields).toMatchObject({ stage: "detect", errorClass: "transient" });
    const snapshot = metrics.snapshot();
    expect(snapshot.counters.find((c) => c.name === METRICS.deadLetteredTotal)?.value).toBe(1);
    expect(
      snapshot.counters.find(
        (c) => c.name === METRICS.dlqEntriesTotal && c.labels.terminal === "retry-exhausted",
      )?.value,
    ).toBe(1);
  });

  test("the queue is bounded: overflow entries are counted, logged, metered — not retained", () => {
    const { queue, lines, metrics } = captured();
    queue.record(entry("k0", 10));
    queue.record(entry("k1", 20));
    queue.record(entry("k2", 30)); // beyond the bound of 2
    queue.record(entry("k3", 40)); // and one more
    expect(queue.size).toBe(2);
    expect(queue.list().map((e) => e.idempotencyKey)).toEqual(["k0", "k1"]);
    expect(queue.overflow).toBe(2);
    // Every overflow left evidence: one warn line each, never silent.
    expect(
      lines.filter((l) => l.msg === "dead-letter queue overflow (entry counted, not retained)"),
    ).toHaveLength(2);
    const snapshot = metrics.snapshot();
    expect(snapshot.counters.find((c) => c.name === METRICS.deadLetteredTotal)?.value).toBe(4);
    expect(snapshot.counters.find((c) => c.name === METRICS.dlqEntriesTotal)?.value).toBe(4);
  });

  test("constructor fails loud on an invalid bound", () => {
    const logger = createLogger({ minLevel: "error", sink: () => {} });
    expect(() => new DeadLetterQueue(0, logger, new MetricsRegistry())).toThrow(RangeError);
    expect(() => new DeadLetterQueue(1.5, logger, new MetricsRegistry())).toThrow(RangeError);
  });

  test("list() returns a fresh array (caller-owned)", () => {
    const { queue } = captured();
    queue.record(entry("k0", 10));
    const first = queue.list();
    first.pop();
    expect(queue.size).toBe(1);
  });
});
