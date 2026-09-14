/**
 * @sporta/temporal — the consumer-facing temporal API over the Sports World
 * Model (work item W402).
 *
 * W006 owns the engine primitives (event log, versioned corrections, at-T
 * snapshots) and W401 owns fusion into the engine. This package is the
 * TEMPORAL CONSUMER SURFACE built on those seams — no new state, no new
 * fusion, no persistence:
 *
 * - `query`: `eventWindow` (inclusive event-time windows over the engine's
 *   sequence-indexed stream, input order preserved, superseded events
 *   included) and `stateAt` (the validated at-T snapshot, verbatim)
 * - `replay`: `replayForward` — deterministic bounded forward replay over a
 *   window of stream entries on a fresh engine, with checkpointed snapshots,
 *   explicit supersession/orphan accounting, and enforced limits
 *   (`TemporalLimitsError`, a `RangeError` subclass)
 */
export { TemporalLimitsError } from "./errors";
export type { TemporalLimitKind } from "./errors";
export { eventWindow, stateAt } from "./query";
export type { EventWindow, StateAtResult } from "./query";
export { EMPTY_WINDOW_SESSION_ID, REPLAY_GENERATED_AT_MS, replayForward } from "./replay";
export type { ReplayForwardInput, ReplayLimits, ReplayResult } from "./replay";
