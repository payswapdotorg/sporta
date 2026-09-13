# Observability Foundation (W007)

Status: implemented by `packages/observability` (`@sporta/observability`).
Authority: [`docs/architecture/architecture-lock.md`](../architecture/architecture-lock.md) §12
("every media session must be traceable across ingestion, perception, event
fusion, world-model updates, rendering, and delivery"), the streaming stage
contract ([`docs/contracts/streaming.md`](../contracts/streaming.md)), and the
work item W007 entry in
[`docs/work-items/work-items.md`](../work-items/work-items.md).

This document describes the foundation's API surface, its zero-dependency
design, the OpenTelemetry-compatibility mapping plan, and the M0 acceptance
proof.

## 1. The model: one session, one correlation context

The unit of traceability is the media session. A session gets one
`CorrelationContext`:

```ts
import { createCorrelationContext } from "@sporta/observability";

const ctx = createCorrelationContext("sess-123");
// { sessionId: "sess-123", correlationId: "corr-42", traceId: "trace-43" }
```

- `sessionId` — the media session (the unit of processing).
- `correlationId` — ties work to its triggering request.
- `traceId` — spans the observable processing chain.

The default id factory is a deterministic counter (`corr-<n>`/`trace-<n>`) so
tests are reproducible; a deployment injects a uuid factory:
`createCorrelationContext(sessionId, () => crypto.randomUUID())`. The context
is exactly the id triple every `StageMessage` already carries
(`packages/contracts/src/streaming.ts`), so it survives stage boundaries:
`fromStageMessage(msg)` re-extracts it on the receiving side, and the pipeline
continues the same trace instead of starting a new one.

## 2. API surface

### 2.1 Structured logging — `src/logger.ts`

```ts
const logger = createLogger({ minLevel: "info", sink: (line) => ship(line) });
logger.info("session authorized", { stageStatus: "authorized" });
// one JSON line: {"ts":1736164800000,"level":"info","msg":"session authorized","fields":{...}}
```

- One call → **one JSON line** (`LogRecord`: `ts`, `level`, `msg`, optional
  `sessionId`/`correlationId`/`traceId`/`stage`, `fields`), serialized with a
  safe stringifier that can never throw: circular references become
  `"[Circular]"`, bigint/function/symbol values are coerced to strings. A
  logger must never take the pipeline down with it.
- Level filtering by `minLevel` (default `"info"`; `debug < info < warn < error`).
- `child(bindings)` returns a logger whose every line carries the bound
  correlation fields; `bindLogger(logger, ctx, stage?)` (correlation module)
  is the standard "bind once at stage entry, log freely" wrapper.
- `sink` defaults to `console.log`; `now` (default `Date.now`) is injectable —
  the same clock-injection rule the whole repo follows
  (`docs/testing/HARNESS.md`).

### 2.2 Correlation — `src/correlation.ts`

`createCorrelationContext(sessionId, idFactory?)` (injectable ids,
deterministic counter default), `fromStageMessage(msg)` (extract from a
`StageMessage` at a stage boundary), `bindLogger(logger, ctx, stage?)`
(stage-bound child logger).

### 2.3 Metrics — `src/metrics.ts`

An in-memory `MetricsRegistry`:

```ts
const metrics = new MetricsRegistry();
metrics.counter("frames_dropped", { stage: "perception" }).inc();
metrics.histogram("stage_latency_ms").observe(80);
metrics.histogram("stage_latency_ms").stats(); // { count, min, max, mean, p50, p95 }
metrics.snapshot(); // plain, JSON-safe, deterministically ordered
metrics.reset();
```

- `counter(name, labels?)` → `.inc(n?)`; same name + same labels (key order
  ignored) address one series; get-or-create handles keep working after
  `reset()`.
- `histogram(name)` → `.observe(value)` / `.stats()` with **nearest-rank**
  percentiles (rank = `ceil(p/100 * n)`, no interpolation, no dependencies).
  An empty series reports all-zero stats with `count: 0` rather than throwing.
- `snapshot()` → `{ counters, histograms }`, sorted by name (then series key)
  — stable across calls and JSON round-trips. This is the shape W805
  dashboards/exporters will read.
- `METRIC_NAMES` exports the architecture-lock §12-aligned vocabulary:
  `frames_dropped`, `queue_depth`, `stage_latency_ms`, `model_latency_ms`,
  `renderer_latency_ms`, `e2e_latency_ms`. The registry itself is generic;
  the constants exist so stages and dashboards agree on the names.

### 2.4 Tracing — `src/trace.ts`

```ts
const recorder = new TraceRecorder(ctx);
const span = recorder.startSpan("perception", startMs);
recorder.endSpan(span, { atMs: endMs, status: "ok" });
recorder.spans();   // all spans ordered by startMs (in flight included)
recorder.summary(); // per-stage { count, p50LatencyMs, p95LatencyMs, errors } + totalSpans
```

- Spans carry the full correlation context, so traces join with the logs.
- `summary()` covers **completed** spans; `totalSpans` is the sum of per-stage
  counts; percentiles are the same nearest-rank math as histograms. Ending a
  span twice throws (append-only history).
- Watermark/lag reporting (streaming contract, architecture.md §7):
  `stageLag(stage, watermarkMs, nowMs)` = `nowMs - watermarkMs` — **positive
  when a stage is behind** the canonical media timeline — and
  `watermarkLagReport(stages, nowMs)` reduces a per-stage watermark list to a
  lag map.

## 3. Zero-dependency design and the OpenTelemetry mapping

The package has **no runtime dependencies** (only type-only imports of
`@sporta/contracts` and test-only use of `@sporta/testing`, both dev
dependencies). Domain packages must not drag an SDK into their import graph;
instead the primitives are shaped so an OpenTelemetry adapter can translate
them later without touching call sites:

| `@sporta/observability` | OpenTelemetry mapping (planned adapter point) |
| --- | --- |
| `LogRecord.{ts, level, msg, fields}` | LogRecord: `timestamp` (ms → ns), `severityText`/`severityNumber` (debug/info/warn/error → 5–17), `body` = `msg`, `attributes` = `fields` |
| `LogRecord.{sessionId, correlationId, traceId, stage}` | resource/span attributes: `session.id`, `correlation.id`, W3C `traceparent` trace id, span-name scope per stage |
| `sink: (line) => void` | swap for an OTLP log exporter; JSON-line format already matches OTel's JSON log encoding shape |
| `MetricsRegistry` counter/histogram | OTel `Counter` / `Histogram` with explicit-bucket views; `snapshot()` is the collector-side read point |
| `Span { stage, startMs, endMs, status, … }` | OTel Span: name = `stage`, start/end (ms → ns), status (ok/error/degraded → Unset/Error + degradation attribute) |
| `stageLag` / `watermarkLagReport` | exported as a gauge per stage (`stage_watermark_lag_ms`) — the streaming contract's per-stage lag report |

Field-naming alignment is already in place where it is cheap: snake_case
metric names, one JSON object per log line, and ids (`sessionId`,
`correlationId`, `traceId`) that map 1:1 onto OTel attribute conventions. The
adapter itself (an OTLP exporter behind the `sink`/`snapshot` seams) is M7
W805 scope; nothing in this package blocks it.

## 4. M0 acceptance proof

The acceptance criterion — *a single session can be traced conceptually
across every stage* — is proven end-to-end by
`tests/e2e/m0-observability.test.ts` (sibling of the W003 harness template,
same rules: seeded builders, explicit millisecond constants, no clock reads).
It drives the real packages — `@sporta/session` lifecycle (fail-closed rights
gate included), `@sporta/observation` store + derivation,
`@sporta/world-model` engine, simulated rendering/delivery via the
`@sporta/testing` `buildRenderRequest`/`buildStageMessage` builders — through
the six stages `ingestion → perception → fusion → world-model → rendering →
delivery`, all under one correlation context, and asserts:

1. every collected log line parses as JSON and carries the **same**
   `correlationId`/`traceId`/`sessionId`, one line per stage;
2. the recorder's spans cover **all six stages in pipeline order**, all
   carrying the context ids;
3. the trace summary contains **p50/p95 latency per stage** (fixed constants);
4. the metrics counters match the counts the slice actually produced
   (`observations_ingested` = 12, `events_derived` = 2,
   `sessions_authorized` = 1) and the §12-named latency histograms
   (`stage_latency_ms`, `model_latency_ms`, `renderer_latency_ms`,
   `e2e_latency_ms`) match the fixed stage timings;
5. a final `watermarkLagReport` over the stage watermarks computes
   **non-negative lags** against one canonical `now`.

## 5. Known limitations

- In-memory, per-process, per-instance: no cross-process aggregation, no
  persistence — W805 adds exporters/dashboards on top of `snapshot()`/`sink`.
- Histograms keep every observation (no bucketing): fine for the M0/M1 scale
  the foundation serves; bounded buckets arrive with the OTel adapter.
- The trace recorder is single-session by design; cross-session correlation
  is a control-plane concern, not a stage-telemetry one.
- `degraded` span status is recorded but not yet surfaced in summaries (only
  `error` counts); a degradation-specific view belongs to W802 latency SLOs.
