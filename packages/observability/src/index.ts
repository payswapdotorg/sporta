/**
 * @sporta/observability — structured logs, metrics, traces, and correlation
 * ids for the Sporta platform (work item W007).
 *
 * The observability foundation behind architecture-lock §12 ("every media
 * session must be traceable across ingestion, perception, event fusion,
 * world-model updates, rendering, and delivery"). Zero runtime dependencies by
 * design so the primitives can map onto OpenTelemetry later without dragging
 * vendor SDKs into domain packages (see docs/observability/FOUNDATION.md).
 *
 * Module map:
 *
 * - `logger`: `createLogger` — one JSON line per call, level filtering,
 *   `child()` bindings, safe stringify (never throws)
 * - `correlation`: `CorrelationContext`, `createCorrelationContext` (injectable
 *   id factory, deterministic counter default), `fromStageMessage`,
 *   `bindLogger`
 * - `metrics`: `MetricsRegistry` — get-or-create counters and histograms with
 *   nearest-rank p50/p95, `snapshot()`, `reset()`, plus the §12-aligned
 *   `METRIC_NAMES` vocabulary
 * - `trace`: `TraceRecorder` — per-session spans (`startSpan`/`endSpan`),
 *   per-stage `summary()` percentiles, and the streaming contract's
 *   `stageLag`/`watermarkLagReport` watermark-lag reporting
 */
export {
  createLogger,
  safeStringify,
  type LogRecord,
  type Logger,
  type LoggerOptions,
  type LogLevel,
} from "./logger";
export {
  bindLogger,
  createCorrelationContext,
  fromStageMessage,
  type CorrelationContext,
  type IdFactory,
} from "./correlation";
export {
  METRIC_NAMES,
  MetricsRegistry,
  type Counter,
  type CounterSnapshot,
  type Histogram,
  type HistogramSnapshot,
  type HistogramStats,
  type MetricsSnapshot,
} from "./metrics";
export {
  TraceRecorder,
  stageLag,
  watermarkLagReport,
  type EndSpanOptions,
  type Span,
  type SpanStatus,
  type StageSummary,
  type StageWatermark,
  type TraceSummary,
} from "./trace";
