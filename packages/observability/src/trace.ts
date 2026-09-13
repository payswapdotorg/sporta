/**
 * Tracing: per-session span recording and watermark/lag reporting
 * (W007 §3.4, architecture.md §7 — "every stage reports watermark and lag
 * relative to the canonical media timeline").
 *
 * A {@link TraceRecorder} is created once per session with its
 * {@link CorrelationContext}; each pipeline stage records one span
 * (start → end with status), and {@link TraceRecorder.summary} reduces the
 * spans to per-stage latency percentiles. {@link stageLag} and
 * {@link watermarkLagReport} implement the streaming contract's per-stage
 * watermark/lag reporting: lag is positive when a stage's watermark is behind
 * `now` on the canonical media timeline.
 */
import type { CorrelationContext } from "./correlation";
import { assertFiniteNumber, nearestRankPercentile } from "./internal";

/** Terminal status of a span (mirrors the streaming `StageStatus`). */
export type SpanStatus = "ok" | "error" | "degraded";

/** One recorded span: a stage's processing interval for one session. */
export interface Span {
  stage: string;
  correlationId: string;
  traceId: string;
  sessionId: string;
  startMs: number;
  /** Set by {@link TraceRecorder.endSpan}; undefined while in flight. */
  endMs?: number;
  /** `endMs - startMs`; undefined while in flight. */
  latencyMs?: number;
  /** Terminal status; undefined while in flight, `"ok"` by default on end. */
  status?: SpanStatus;
}

/** Options for {@link TraceRecorder.endSpan}. */
export interface EndSpanOptions {
  status?: SpanStatus;
  /** End time in epoch milliseconds (default: `Date.now`). */
  atMs?: number;
}

/** Per-stage reduction in a {@link TraceSummary}. */
export interface StageSummary {
  stage: string;
  count: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  /** Number of completed spans with `status: "error"`. */
  errors: number;
}

/** Summary of a recorder's completed spans (nearest-rank percentiles). */
export interface TraceSummary {
  /** Stages in first-span-start order (only stages with completed spans). */
  stages: StageSummary[];
  /** Total completed spans — always the sum of the per-stage counts. */
  totalSpans: number;
}

/** One stage's watermark position for {@link watermarkLagReport}. */
export interface StageWatermark {
  stage: string;
  /** Canonical media-timeline position the stage has completed through. */
  watermarkMs: number;
}

function assertStageName(stage: string): void {
  if (typeof stage !== "string" || stage.length < 1) {
    throw new RangeError(`stage must be a non-empty string (got ${String(stage)})`);
  }
}

function assertCorrelationContext(ctx: CorrelationContext): void {
  for (const key of ["sessionId", "correlationId", "traceId"] as const) {
    const value = ctx[key];
    if (typeof value !== "string" || value.length < 1) {
      throw new RangeError(`correlation context ${key} must be a non-empty string`);
    }
  }
}

/**
 * Records spans for one media session. Create one per session with the
 * session's {@link CorrelationContext}; every span carries the context ids so
 * the trace joins with the structured logs.
 *
 * Times: `atMs` parameters are explicit epoch milliseconds; when omitted the
 * recorder reads `Date.now()` (tests always inject explicit times per
 * docs/testing/HARNESS.md).
 */
export class TraceRecorder {
  private readonly ctx: CorrelationContext;
  /** Insertion order; `.spans()` sorts by start (stable). */
  private readonly recorded: Span[] = [];

  constructor(ctx: CorrelationContext) {
    assertCorrelationContext(ctx);
    this.ctx = { ...ctx };
  }

  /** The correlation context every span of this recorder carries. */
  get context(): CorrelationContext {
    return { ...this.ctx };
  }

  /**
   * Starts a span for `stage` at `atMs` (default: now). The span is returned
   * by reference — complete it with {@link endSpan}. Spans may overlap and may
   * start out of call order; {@link spans} orders by start time.
   */
  startSpan(stage: string, atMs: number = Date.now()): Span {
    assertStageName(stage);
    assertFiniteNumber(atMs, `startSpan("${stage}")`);
    const span: Span = {
      stage,
      correlationId: this.ctx.correlationId,
      traceId: this.ctx.traceId,
      sessionId: this.ctx.sessionId,
      startMs: atMs,
    };
    this.recorded.push(span);
    return span;
  }

  /**
   * Completes a span: sets `endMs`, `latencyMs`, and `status` (default
   * `"ok"`), in place, and returns it. Ending a span twice throws — the
   * recorder's history is append-only.
   */
  endSpan(span: Span, options: EndSpanOptions = {}): Span {
    if (span.endMs !== undefined || span.latencyMs !== undefined) {
      throw new Error(`span for stage "${span.stage}" is already ended`);
    }
    const endMs = options.atMs ?? Date.now();
    assertFiniteNumber(endMs, `endSpan("${span.stage}")`);
    span.endMs = endMs;
    span.latencyMs = endMs - span.startMs;
    span.status = options.status ?? "ok";
    return span;
  }

  /**
   * All spans (in flight included) ordered by `startMs`, ascending, with
   * insertion order preserved for ties. The array is fresh; the span objects
   * are the recorder's own — treat them as read-only.
   */
  spans(): Span[] {
    return [...this.recorded].sort((a, b) => a.startMs - b.startMs);
  }

  /**
   * Per-stage latency summary over COMPLETED spans (in-flight spans have no
   * latency yet and are excluded; `totalSpans` is the sum of the per-stage
   * counts). Stages appear in first-span-start order; percentiles are
   * nearest-rank (p50/p95) over each stage's completed latencies.
   */
  summary(): TraceSummary {
    const completed = this.spans().filter((span) => span.latencyMs !== undefined);
    const stageOrder: string[] = [];
    const byStage = new Map<string, { latencies: number[]; errors: number }>();
    for (const span of completed) {
      let bucket = byStage.get(span.stage);
      if (bucket === undefined) {
        bucket = { latencies: [], errors: 0 };
        byStage.set(span.stage, bucket);
        stageOrder.push(span.stage);
      }
      bucket.latencies.push(span.latencyMs as number);
      if (span.status === "error") bucket.errors += 1;
    }
    const stages: StageSummary[] = stageOrder.map((stage) => {
      const bucket = byStage.get(stage);
      const latencies = bucket === undefined ? [] : bucket.latencies;
      const sorted = [...latencies].sort((a, b) => a - b);
      return {
        stage,
        count: latencies.length,
        p50LatencyMs: sorted.length === 0 ? 0 : nearestRankPercentile(sorted, 50),
        p95LatencyMs: sorted.length === 0 ? 0 : nearestRankPercentile(sorted, 95),
        errors: bucket?.errors ?? 0,
      };
    });
    return { stages, totalSpans: completed.length };
  }
}

/**
 * The lag of one stage: `nowMs - watermarkMs`, POSITIVE when the stage's
 * watermark is behind `now` on the canonical media timeline (architecture.md
 * §7). Both inputs are explicit milliseconds — callers own the clock.
 */
export function stageLag(stage: string, watermarkMs: number, nowMs: number): number {
  assertStageName(stage);
  assertFiniteNumber(watermarkMs, `stageLag("${stage}") watermarkMs`);
  assertFiniteNumber(nowMs, `stageLag("${stage}") nowMs`);
  return nowMs - watermarkMs;
}

/**
 * The per-stage watermark/lag report of the streaming contract: a map of
 * stage name to {@link stageLag} against one shared `nowMs`. Later entries
 * for the same stage win; lag values are positive when a stage is behind.
 */
export function watermarkLagReport(
  stages: readonly StageWatermark[],
  nowMs: number,
): Record<string, number> {
  assertFiniteNumber(nowMs, "watermarkLagReport nowMs");
  const report: Record<string, number> = {};
  for (const entry of stages) {
    report[entry.stage] = stageLag(entry.stage, entry.watermarkMs, nowMs);
  }
  return report;
}
