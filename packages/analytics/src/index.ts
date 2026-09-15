/**
 * @sporta/analytics — the W804 product analytics package.
 *
 * The product funnel and failure metrics, computed OFFLINE as a PURE,
 * DETERMINISTIC derivation over RECORDED W706 viewer telemetry event streams
 * (`@sporta/viewer-shell`'s privacy-scoped event model — schema version 1).
 * The normative funnel definition, the metric catalog with formulas, the
 * privacy scope, and the honest boundaries live in `../FUNNEL.md` (the
 * package's authority document).
 *
 * Module map:
 *
 * - `funnel`: the NORMATIVE funnel definition — the closed stage set, the
 *   evidence rules (the W706 `state-transition` targets), the ordered
 *   boundary table with its attribution rules, and the owner/actionability
 *   notes per failure class;
 * - `input`: the W706 input boundary — the REAL W706 validator is the ONE
 *   gate (wider events fail loudly, naming the field);
 * - `percentiles`: deterministic nearest-rank timing statistics (the repo's
 *   pinned method — W007/W306 precedent);
 * - `report`: the report types + `computeProductAnalytics` (the pure
 *   computation with never-silent accounting) + `analyzeRecordedStream`;
 * - `schema`: the versioned zod report schema + `parseAnalyticsReport`
 *   (reports are VALIDATED, never trusted);
 * - `canonical`: byte-deterministic report serialization + the reader;
 * - `errors`: the fail-loud error model.
 *
 * Constitution: no collection, no network, no clocks, no randomness in this
 * package — analytics is a pure function of what was already recorded.
 */
export {
  ANALYTICS_REPORT_SCHEMA_VERSION,
  analyzeRecordedStream,
  computeProductAnalytics,
} from "./report.ts";
export type {
  AccountingBlock,
  BoundaryRow,
  ConnectionBlock,
  DropOffAttributionRow,
  FailureClassBucket,
  FunnelSection,
  FunnelStageRow,
  PlaybackHealthBlock,
  ProductAnalyticsReport,
  SessionOutcomeRow,
} from "./report.ts";
export {
  parseRecordedEvents,
  parseRecordedJsonl,
  validateRecordedEvent,
} from "./input.ts";
export {
  AnalyticsAccountingError,
  AnalyticsInputError,
  AnalyticsReportValidationError,
} from "./errors.ts";
export {
  BATCH_STAGES,
  BOUNDARIES,
  FAILURE_CLASSES,
  FUNNEL_SPEC_VERSION,
  FUNNEL_STAGE_IDS,
  LIVE_STAGES,
  OWNER_NOTES,
  STAGE_EVIDENCE_TARGET,
  isEstablishmentEvidence,
  stageOfTransitionTarget,
} from "./funnel.ts";
export type {
  DropOffAttributionKind,
  FunnelBoundary,
  FunnelStageId,
  SessionOutcomeKind,
} from "./funnel.ts";
export { timingStats } from "./percentiles.ts";
export type { TimingStats } from "./percentiles.ts";
export {
  ANALYTICS_REPORT_SCHEMA_TAG,
  ProductAnalyticsReportSchema,
  parseAnalyticsReport,
} from "./schema.ts";
export {
  deserializeAnalyticsReport,
  serializeAnalyticsReport,
} from "./canonical.ts";
