/**
 * Bounded dead-letter queue tests (W303): the W302 posture verbatim —
 * retained entries frozen, overflow counted + logged + metered (never
 * silent), constructor fail-loud.
 */
import { describe, expect, test } from "bun:test";
import { GpuDeadLetterQueue } from "../src/dlq";
import { GPU_METRIC_NAMES as METRICS } from "../src/types";
import type { GpuDeadLetterEntry } from "../src/types";
import { capturedObservability, job } from "./helpers";

function entry(jobId: string): GpuDeadLetterEntry {
  return {
    jobId,
    idempotencyKey: `key-${jobId}`,
    errorClass: "transient",
    message: `scripted failure for ${jobId}`,
    terminal: "retry-exhausted",
    attempts: 2,
    claims: 1,
    retriesUsed: 1,
    atMs: 500,
    job: job(jobId),
    correlationId: "corr-1",
    traceId: "trace-1",
  };
}

describe("GpuDeadLetterQueue", () => {
  test("constructor fails loud on a non-positive bound", () => {
    const { logger, metrics, records } = capturedObservability();
    expect(() => new GpuDeadLetterQueue(0, logger, metrics)).toThrow(RangeError);
    expect(() => new GpuDeadLetterQueue(1.5, logger, metrics)).toThrow(RangeError);
    expect(records()).toHaveLength(0);
  });

  test("records retained entries in occurrence order, frozen", () => {
    const { logger, metrics } = capturedObservability();
    const dlq = new GpuDeadLetterQueue(10, logger, metrics);
    dlq.record(entry("j1"));
    dlq.record(entry("j2"));
    expect(dlq.size).toBe(2);
    const list = dlq.list();
    expect(list.map((e) => e.jobId)).toEqual(["j1", "j2"]);
    expect(Object.isFrozen(list[0])).toBe(true);
    // list() returns a fresh array: mutating it cannot reach the queue.
    list.push(entry("j3"));
    expect(dlq.size).toBe(2);
  });

  test("every record is counted + metered (dead-lettered and terminal-labeled series)", () => {
    const { logger, metrics } = capturedObservability();
    const dlq = new GpuDeadLetterQueue(10, logger, metrics);
    dlq.record(entry("j1"));
    dlq.record({ ...entry("j2"), terminal: "internal", errorClass: "internal" });
    const snapshot = metrics.snapshot();
    const deadLettered = snapshot.counters.find((c) => c.name === METRICS.deadLettered);
    expect(deadLettered?.value).toBe(2);
    const retryExhausted = snapshot.counters.find(
      (c) => c.name === METRICS.dlqEntries && c.labels.terminal === "retry-exhausted",
    );
    const internal = snapshot.counters.find(
      (c) => c.name === METRICS.dlqEntries && c.labels.terminal === "internal",
    );
    expect(retryExhausted?.value).toBe(1);
    expect(internal?.value).toBe(1);
  });

  test("overflow beyond the bound is counted + warned, NOT retained (never silent)", () => {
    const { logger, metrics, records } = capturedObservability();
    const dlq = new GpuDeadLetterQueue(1, logger, metrics);
    dlq.record(entry("j1"));
    dlq.record(entry("j2")); // overflow
    dlq.record(entry("j3")); // overflow
    expect(dlq.size).toBe(1);
    expect(dlq.overflow).toBe(2);
    expect(dlq.list().map((e) => e.jobId)).toEqual(["j1"]);
    const overflowLogs = records().filter((r) => r.msg.includes("overflow"));
    expect(overflowLogs).toHaveLength(2);
    expect(overflowLogs[0]?.fields).toMatchObject({ jobId: "j2", overflow: 1, maxEntries: 1 });
    expect(overflowLogs[1]?.fields).toMatchObject({ jobId: "j3", overflow: 2 });
    // Overflow still counts the dead-lettered series (all terminal failures).
    const snapshot = metrics.snapshot();
    expect(snapshot.counters.find((c) => c.name === METRICS.deadLettered)?.value).toBe(3);
  });

  test("retention warns with the full accounting evidence", () => {
    const { logger, metrics, records } = capturedObservability();
    const dlq = new GpuDeadLetterQueue(10, logger, metrics);
    dlq.record(entry("j1"));
    const warned = records().filter((r) => r.msg === "gpu job dead-lettered");
    expect(warned).toHaveLength(1);
    expect(warned[0]?.fields).toMatchObject({
      jobId: "j1",
      errorClass: "transient",
      terminal: "retry-exhausted",
      attempts: 2,
      claims: 1,
      retriesUsed: 1,
      atMs: 500,
    });
    expect(warned[0]?.level).toBe("warn");
    expect(warned[0]?.stage).toBeUndefined();
  });
});
