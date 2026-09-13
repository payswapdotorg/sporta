/**
 * Unit tests for the trace recorder and watermark/lag reporting (W007 §3.4).
 *
 * All times are explicit millisecond constants (no clock reads); the span
 * ordering, summary percentile, and lag sign/magnitude behaviors are pinned
 * with fixed numbers.
 */
import { describe, expect, test } from "bun:test";
import { TraceRecorder, stageLag, watermarkLagReport } from "../src/trace";

/** Fixed correlation context for every test below (deterministic ids). */
const FACTORY_CTX = {
  sessionId: "sess-trace-test",
  correlationId: "corr-seeded-1",
  traceId: "trace-seeded-2",
};

function recorder(): TraceRecorder {
  return new TraceRecorder(FACTORY_CTX);
}

describe("trace recorder — spans", () => {
  test("startSpan records the context and start; endSpan completes latency/status", () => {
    const rec = recorder();
    const span = rec.startSpan("ingestion", 1_000);
    expect(span).toEqual({
      stage: "ingestion",
      correlationId: FACTORY_CTX.correlationId,
      traceId: FACTORY_CTX.traceId,
      sessionId: FACTORY_CTX.sessionId,
      startMs: 1_000,
    });
    expect(span.endMs).toBeUndefined();
    expect(span.latencyMs).toBeUndefined();
    expect(span.status).toBeUndefined();

    const ended = rec.endSpan(span, { atMs: 1_080 });
    expect(ended).toBe(span);
    expect(span.endMs).toBe(1_080);
    expect(span.latencyMs).toBe(80);
    expect(span.status).toBe("ok");

    const failed = rec.endSpan(rec.startSpan("perception", 2_000), {
      atMs: 2_400,
      status: "error",
    });
    expect(failed.status).toBe("error");
    expect(failed.latencyMs).toBe(400);
  });

  test("ending a span twice throws (append-only history)", () => {
    const rec = recorder();
    const span = rec.startSpan("fusion", 100);
    rec.endSpan(span, { atMs: 160 });
    expect(() => rec.endSpan(span, { atMs: 200 })).toThrow(/already ended/);
  });

  test("spans() orders by start time, insertion order on ties", () => {
    const rec = recorder();
    rec.startSpan("ingestion", 500);
    rec.startSpan("perception", 200);
    rec.startSpan("fusion", 300);
    const fusionB = rec.startSpan("fusion", 300); // tie: insertion order decides
    rec.startSpan("delivery", 900);

    const ordered = rec.spans();
    expect(ordered.map((span) => span.stage)).toEqual([
      "perception",
      "fusion",
      "fusion",
      "ingestion",
      "delivery",
    ]);
    expect(ordered[2]).toBe(fusionB);

    // The recorder exposes its context as a fresh copy.
    expect(rec.context).toEqual(FACTORY_CTX);
  });

  test("invalid inputs fail loud", () => {
    const rec = recorder();
    expect(() => rec.startSpan("", 100)).toThrow(RangeError);
    expect(() => rec.startSpan("ingestion", Number.NaN)).toThrow(RangeError);
    expect(() => new TraceRecorder({ ...FACTORY_CTX, sessionId: "" })).toThrow(RangeError);
  });
});

describe("trace recorder — summary", () => {
  test("per-stage count, nearest-rank p50/p95, and error counts", () => {
    const rec = recorder();
    // perception: latencies [10, 20, 30, 40] -> p50 = 20, p95 = 40.
    for (const [start, end] of [
      [100, 110],
      [200, 220],
      [300, 330],
      [400, 440],
    ] as const) {
      rec.endSpan(rec.startSpan("perception", start), { atMs: end });
    }
    // rendering: latencies [100, 200], one of them an error.
    rec.endSpan(rec.startSpan("rendering", 1_000), { atMs: 1_100 });
    rec.endSpan(rec.startSpan("rendering", 2_000), { atMs: 2_200, status: "error" });
    // One in-flight span: excluded from the summary entirely.
    rec.startSpan("delivery", 9_000);

    const summary = rec.summary();
    expect(summary.totalSpans).toBe(6);
    expect(summary.stages.map((stage) => stage.stage)).toEqual(["perception", "rendering"]);
    expect(summary.stages[0]).toEqual({
      stage: "perception",
      count: 4,
      p50LatencyMs: 20,
      p95LatencyMs: 40,
      errors: 0,
    });
    expect(summary.stages[1]).toEqual({
      stage: "rendering",
      count: 2,
      p50LatencyMs: 100,
      p95LatencyMs: 200,
      errors: 1,
    });
  });

  test("an empty recorder summarizes to nothing", () => {
    const summary = recorder().summary();
    expect(summary).toEqual({ stages: [], totalSpans: 0 });
  });
});

describe("watermark lag", () => {
  test("stageLag is positive when behind, negative when ahead", () => {
    expect(stageLag("perception", 800, 1_000)).toBe(200); // behind by 200ms
    expect(stageLag("perception", 1_200, 1_000)).toBe(-200); // ahead of now
    expect(stageLag("perception", 1_000, 1_000)).toBe(0); // exactly on time
    expect(() => stageLag("perception", Number.NaN, 1_000)).toThrow(RangeError);
    expect(() => stageLag("", 100, 1_000)).toThrow(RangeError);
  });

  test("watermarkLagReport maps every stage to its lag against one now", () => {
    const report = watermarkLagReport(
      [
        { stage: "ingestion", watermarkMs: 11_000 },
        { stage: "perception", watermarkMs: 10_000 },
        { stage: "fusion", watermarkMs: 3_000 },
      ],
      12_000,
    );
    expect(report).toEqual({
      ingestion: 1_000,
      perception: 2_000,
      fusion: 9_000,
    });
    expect(Object.values(report).every((lag) => lag >= 0)).toBe(true);
  });
});
