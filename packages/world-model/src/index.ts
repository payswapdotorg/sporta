/**
 * @sporta/world-model — the Sports World Model engine over @sporta/contracts
 * (work item W006: generic temporal SWM schema plus the football extension).
 *
 * The canonical representation stays in `@sporta/contracts` (ADR-001); this
 * package is the domain engine that owns state transitions and queries:
 *
 * - `world-model`: the `WorldModelEngine` — versioned entities with stable
 *   identity, an event log ordered by event time then sequence with a
 *   bounded reorder window, versioned corrections, immutable at-T snapshots,
 *   and the optional football extension state
 * - `uncertainty`: constructors (`known`, `unknownValue`, `uncertain`) and
 *   the `resolveUncertain` reader for the `UncertainValue` pattern
 * - `provenance`: `describeProvenance` (evidence-chain rendering) and
 *   `auditTrail` (engine state summary for tests and observability)
 * - `errors`: the error taxonomy (`EntityKindChangeError`, `LateEventError`,
 *   and the other fail-loud guarantees)
 */
export {
  WorldModelEngine,
  DEFAULT_MAX_REORDER_MS,
  type ApplyEventOptions,
  type FootballState,
  type FootballStatePatch,
  type SetScoreOptions,
  type WorldModelEngineInit,
} from "./world-model";
export {
  auditTrail,
  describeProvenance,
  type AuditTrail,
  type AuditTrailEntity,
} from "./provenance";
export { known, resolveUncertain, uncertain, unknownValue } from "./uncertainty";
export {
  ClockRegressionError,
  CorrectionTargetNotFoundError,
  DuplicateEventError,
  EntityKindChangeError,
  EventSessionMismatchError,
  FootballStateMissingError,
  InvalidEngineConfigError,
  InvalidEntityError,
  InvalidEntityIdError,
  InvalidEventError,
  InvalidFootballStateError,
  InvalidTimelineQueryError,
  InvalidUncertainValueError,
  LateEventError,
  SnapshotIntegrityError,
  WorldModelError,
} from "./errors";
