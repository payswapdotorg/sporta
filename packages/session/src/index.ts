/**
 * @sporta/session — media session model (W004).
 *
 * Session, source, authorization-policy, timeline, and processing-state
 * models for the Sporta platform, consuming the zod contracts from
 * `@sporta/contracts` (W002). Module map:
 *
 * - `lifecycle`: the session status machine with fail-closed rights gates
 *   (analysis at `authorized`, transformation at `rendering`), idempotent
 *   cancellation, and classified terminal failures;
 * - `repository`: the `MediaSessionRepository` port plus in-memory and
 *   `bun:sqlite` implementations storing the full vendor-neutral, validated
 *   `MediaSession` JSON document;
 * - `timeline`: canonical timeline offsets/drift math and processing-state
 *   services (monotonic watermarks, error notes, failure classification);
 * - `validation`: shared `MediaSession` document validation used on every
 *   read and write path.
 */
export {
  InvalidTransitionError,
  RightsDeniedError,
  SESSION_PIPELINE_STATUSES,
  TERMINAL_SESSION_STATUSES,
  SessionLifecycle,
  assertAuthorized,
  canTransition,
  isTerminalStatus,
  newSession,
} from "./lifecycle";
export type {
  NewSessionInput,
  PolicyResolver,
  RightsDenialReason,
  SessionLifecycleOptions,
  TransitionMeta,
} from "./lifecycle";
export {
  InMemorySessionRepository,
  SessionConflictError,
  SessionNotFoundError,
  SqliteSessionRepository,
} from "./repository";
export type { MediaSessionRepository } from "./repository";
export {
  MediaInvalidError,
  ProcessingStateService,
  ResourceLimitError,
  SessionTimelineService,
  WatermarkRegressionError,
} from "./timeline";
export type { CalibrateInput, TimelineClock } from "./timeline";
export { SessionDocumentValidationError, parseSessionDocument } from "./validation";
// The rights domain (J008/J009 — Wave 3, Worker A): durable effective-policy
// + audit stores, the grant/widen/narrow/revoke editor service, and the
// role-gated audit discoverability query seam.
export {
  effectiveCapabilitiesOf,
  InMemoryEffectivePolicyStore,
  InMemoryRightsAuditStore,
  RightsStoreValidationError,
  SqliteRightsStore,
} from "./rights-store";
export type {
  EffectivePolicyStore,
  PolicyChangeKind,
  RightsAuditEntry,
  RightsAuditStore,
  RightsEditKind,
} from "./rights-store";
export { createRightsEditor, RightsEditorValidationError } from "./rights-editor";
export type {
  RightsEditor,
  RightsEditorActor,
  RightsEditorOptions,
  RightsEditResult,
  RightsStateView,
  SessionLookup,
} from "./rights-editor";
export {
  createRightsAuditQueryService,
  RightsAuditQueryValidationError,
} from "./rights-audit-query";
export type {
  AuditQueryAccount,
  RightsAuditQueryOptions,
  RightsAuditQueryResult,
  RightsAuditQueryService,
} from "./rights-audit-query";
// The analyst annotations domain (J010 — Wave 3, Worker A): media-time
// markers/clips saved where backed by REAL session timelines, notes
// attached, revisitable — never fake clip bytes.
export {
  createAnalystAnnotationService,
  AnalystAnnotationValidationError,
  InMemoryAnalystAnnotationStore,
  SqliteAnalystAnnotationStore,
} from "./analyst-annotations";
export type {
  AnalystAccount,
  AnalystAnnotationRefusal,
  AnalystAnnotationResult,
  AnalystAnnotationService,
  AnalystAnnotationServiceOptions,
  AnalystAnnotationStore,
  AnalystMarker,
  AnalystMarkerBacking,
  AnalystNote,
  RenderOutputLookup,
  SessionTimelineLookup,
} from "./analyst-annotations";
