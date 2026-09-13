/**
 * @sporta/observation — observation storage, evidence-linked event
 * derivation, and deterministic replay over the `@sporta/contracts`
 * observation/event contracts (work item W005).
 *
 * Module map:
 *
 * - `store`: `ObservationStore` interface + in-memory implementation
 *   (validated, duplicate-idempotent appends; deterministic time-window
 *   queries)
 * - `derive`: `EventDerivationService` — `deriveEvent` (evidence-resolved,
 *   min-confidence propagation) and `deriveCommentaryEvent` (regex rule,
 *   commentary weight); `MissingEvidenceError`
 * - `replay`: `ReplayLog` (append-only, bounded reorder window),
 *   `replayDeterministic` (evidence-linked re-materialization with explicit
 *   skipping and correction supersession); `LateEventError`
 *
 * Confidence defaults are exported as constants so downstream stages
 * (W201-W206, W401) rely on documented behavior, not magic numbers.
 */
export {
  COMMENTARY_CONFIDENCE_WEIGHT,
  DEFAULT_MAX_REORDER_MS,
  MISSING_CONFIDENCE_DEFAULT,
} from "./internal";
export { InMemoryObservationStore } from "./store";
export type { ObservationAppendResult, ObservationQuery, ObservationStore } from "./store";
export { EventDerivationService, MissingEvidenceError } from "./derive";
export type { CommentaryMatchRule, DeriveEventInput } from "./derive";
export { LateEventError, ReplayLog, replayDeterministic } from "./replay";
export type {
  ReplayLogOptions,
  ReplayLogWindow,
  ReplayResult,
  ReplayWindow,
  SkippedEvent,
} from "./replay";
