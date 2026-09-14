/**
 * @sporta/renderer-evaluation — the W503 temporal consistency evaluation
 * harness (work item W503: "identity flicker, geometry drift, and temporal
 * artifacts are measured on fixtures").
 *
 * Pure measurement functions over a W502 rendered clip manifest
 * (`@sporta/renderer-anime` `AnimeRenderOutput.manifest`):
 *
 * - `validate`: fail-loud structural validation — malformed manifests
 *   (missing fields, non-monotone frames, unknown dispositions) throw
 *   `TemporalEvaluationError` with the JSON path, never a silent skip;
 * - `identity`: identity flicker — unexplained entity absence (drawn at
 *   frame N, vanished at N+1 with NO justified disposition), per-entity
 *   presence series, and style stability (manifest style tokens +, when
 *   SVG frames are supplied, byte-level marker-group stability). Justified
 *   omissions (out-of-play, no-position, invalid-position, kind) are
 *   honest accounting, never flicker;
 * - `drift`: geometry drift — per-entity consecutive-position displacement
 *   against the documented plausibility bound (player/ball physical speed
 *   ceilings × Δt + numerical epsilon). Honest gaps: frames without a
 *   recorded position break the series and are accounted, never
 *   interpolated;
 * - `artifacts`: temporal artifacts — caption-window overlaps and
 *   anomalies, watermark monotonicity violations, applied-event-sequence
 *   gaps and duplicates, disposition flapping, kind changes, possession
 *   display consistency;
 * - `report`: `evaluateTemporalConsistency` / `evaluateRenderOutput` — the
 *   deterministic `TemporalConsistencyReport` with exact measured values
 *   and a PASS/FAIL verdict from the documented thresholds;
 * - `fixture`: the clean W502 fixture clip (replicated in this package,
 *   driven through the REAL renderer) plus one injector per defect class —
 *   the detection proof: every metric must detect its injected defect or
 *   be rejected.
 *
 * Thresholds: every threshold's value and derivation is documented in
 * `packages/renderer-evaluation/THRESHOLDS.md` and pinned row-for-row to
 * `src/thresholds.ts` by `test/thresholds-doc.test.ts` (the W403
 * TOLERANCE.md convention).
 *
 * Package boundary: runtime dependencies are `@sporta/renderer-anime`,
 * `@sporta/renderer-contract`, `@sporta/contracts`, and `@sporta/testing`
 * only — no external deps, no clock reads, no RNG (pure functions
 * throughout; deep-equal reruns pinned by tests).
 */
export { TemporalEvaluationError } from "./errors";
export type { TemporalEvaluationErrorCode } from "./errors";
export { ENTITY_DISPOSITIONS, validateManifest } from "./validate";
export { THRESHOLDS } from "./thresholds";
export type { Thresholds } from "./thresholds";
export { isDrawnDisposition, measureIdentityFlicker, measureStyleByteStability } from "./identity";
export type {
  IdentityEntitySeries,
  IdentityFlickerMetrics,
  StyleByteEntitySeries,
  StyleByteStability,
} from "./identity";
export { driftBoundFor, measureGeometryDrift } from "./drift";
export type { GeometryDriftMetrics, GeometryEntitySeries, GeometryStep } from "./drift";
export { measureTemporalArtifacts } from "./artifacts";
export type { TemporalAnomaly, TemporalArtifactMetrics } from "./artifacts";
export { REPORT_SCHEMA_TAG, evaluateRenderOutput, evaluateTemporalConsistency } from "./report";
export type {
  TemporalConsistencyReport,
  TemporalEvaluationInput,
  TemporalVerdict,
  ThresholdCheck,
} from "./report";
export {
  W503_ALLOW_ALL,
  W503_SESSION_ID,
  buildW503ClipSteps,
  buildW503Event,
  buildW503EventStream,
  buildW503RenderRequest,
  buildW503Snapshot,
  injectAppliedSequenceGap,
  injectDispositionFlap,
  injectDuplicateEventAttribution,
  injectGeometryTeleport,
  injectStyleByteInstability,
  injectStyleInstability,
  injectUnexplainedAbsence,
  injectWatermarkRegression,
  injectWindowOverlap,
  renderW503CleanFixture,
} from "./fixture";
