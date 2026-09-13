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
