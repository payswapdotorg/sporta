/**
 * @sporta/latency-benchmark — the W306 end-to-end latency benchmark (M4).
 *
 * THE WORK ITEM, MADE EXECUTABLE: "p50/p95 stage and end-to-end latency
 * measured on a controlled fixture/stream; target SLOs are documented from
 * evidence."
 *
 * ONE run drives the REAL W304 streaming pipeline — `RenderOrchestrator`
 * over the W303 gpu-worker protocol, through the REAL W502 anime executor
 * (`createAnimeRenderBatchExecutor`) — on a controlled, checked-in,
 * deterministic live-stream fixture (a seeded schedule of real W006/W402
 * SWM updates whose arrivals advance the ONE injected `VirtualGpuClock`),
 * instruments every stage boundary IN THE INJECTED CLOCK DOMAIN, and emits
 * a versioned, zod-validated, machine-readable report plus a deterministic
 * human summary.
 *
 * ## The honest boundary (read this before quoting any number)
 *
 * ALL timings are readings of the shared injected VIRTUAL clock. They
 * characterize the pipeline's ALGORITHMIC latency structure on the
 * controlled fixture — batching-grid waits, bounded-queue sojourns under
 * the embedded burst, the W303 dispatch wait, the authored render-duration
 * model, and the reorder hold — NOT wall-clock or real-network SLOs. Real
 * ICE/STUN/network latency is out of scope exactly as W305 documented the
 * same boundary for its in-process transport seams; W802 owns formalizing
 * SLOs/alerting from this evidence.
 *
 * ## Never-silent accounting
 *
 * `frames in === frames emitted + frames skipped-stale + frames dropped +
 * frames cancelled + frames duplicate` — runtime-asserted (typed error, full
 * breakdown), ON TOP of the W304 orchestrator's own batch identities, which
 * are re-asserted over the settled result. Nothing disappears silently.
 *
 * ## Module map
 *
 * - `fixture`: the checked-in live-stream profile + schedule (seeded, real
 *   W006 engine through the W402 seams);
 * - `store`: the growing `SwmUpdateStore` + the clock-driving live source;
 * - `instrument`: executor and output-tap wrappers (clock reads only);
 * - `trace`: the per-frame/per-batch evidence + the pure batch-cut replay;
 * - `percentiles`: the nearest-rank percentile core (test-pinned);
 * - `accounting`: the frame/batch identities (fail-loud);
 * - `schema`: the versioned zod report schema + fail-loud parse;
 * - `report`: report construction, canonical bytes, human summary, the
 *   pipeline config, and the SLO candidates (see SLOs.md);
 * - `benchmark`: `runLatencyBenchmark` — the whole run, start to report.
 *
 * Constitution: zero wall-clock reads (`Date.now`/`performance.now`/`new
 * Date` appear nowhere), zero `Math.random` (the fixture's PRNG is the
 * seeded `@sporta/testing` mulberry32), zero external runtime dependencies
 * beyond zod (the @sporta/contracts precedent) and `@sporta/*` workspace
 * packages.
 */
export { LIVE_FIXTURE_PROFILE, buildLiveFixture } from "./fixture";
export type { LiveFixture, LiveFixtureProfile, LiveSourceStep } from "./fixture";
export { LiveSwmStore, driveLiveSource } from "./store";
export { instrumentedExecutor, outputTap } from "./instrument";
export type { EmissionRecord, ExecutorInvocation } from "./instrument";
export {
  BATCH_STAGE_KEYS,
  FRAME_STAGE_KEYS,
  STAGE_DEFINITIONS,
  assembleTrace,
  computeStageStats,
  replayBatchCuts,
} from "./trace";
export type {
  BatchStageKey,
  BatchTraceRow,
  FrameStageKey,
  FrameTraceRow,
  LatencyStageStats,
  LatencyTrace,
  TraceEvidence,
} from "./trace";
export { PERCENTILE_POINTS, latencyStats, nearestRankPercentile } from "./percentiles";
export type { LatencyStats } from "./percentiles";
export { assertLatencyAccounting, buildAccounting } from "./accounting";
export type { FrameAccounting, LatencyAccounting } from "./accounting";
export { parseLatencyReport, REPORT_SCHEMA_TAG } from "./schema";
export type { LatencyBenchmarkReport } from "./schema";
export {
  BENCHMARK_PIPELINE,
  buildLatencyReport,
  renderHumanSummary,
  serializeLatencyReport,
} from "./report";
export type { BenchmarkPipelineConfig, ReportInputs } from "./report";
export { SLO_CANDIDATES, SLO_CANDIDATE_PROFILE_ID, checkSloCandidates } from "./slo";
export type { SloCandidateVerdict } from "./slo";
export { benchmarkRenderRequest, runLatencyBenchmark } from "./benchmark";
export type { LatencyBenchmarkOptions, LatencyBenchmarkRun } from "./benchmark";
export {
  IncompleteBenchmarkRunError,
  InvalidBenchmarkOptionsError,
  LatencyAccountingError,
  LatencyFixtureError,
  LatencyReportValidationError,
  isLatencyBenchmarkError,
} from "./errors";
export type { LatencyBenchmarkError, LatencyErrorCode } from "./errors";
