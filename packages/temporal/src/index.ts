/**
 * @sporta/temporal — consumer-facing temporal queries and deterministic
 * forward replay over the Sports World Model (work item W402).
 *
 * W006 owns the engine primitives (snapshot at T, event log, corrections);
 * W401 owns fusion into the engine. This package is the CONSUMER-FACING
 * temporal API on top of both:
 *
 * - `query`: `eventWindow` — the time-windowed event query the
 *   sequence-indexed engine does not have (inclusive event-time bounds, input
 *   order preserved, superseded evidence included) — and `stateAt` — the
 *   validated at-T state query (a thin, pinned surface over
 *   `engine.snapshot(atMs)`);
 * - `replay`: `replayForward` — the deterministic BOUNDED forward replay that
 *   rebuilds the engine's event-log state from an event window (corrections,
 *   supersession, sequence numbering) on a fresh engine with checkpointed
 *   snapshots and enforced limits (`TemporalLimitsError`).
 *
 * Accept criterion (W402): consumers can request state at time T and replay
 * events forward deterministically within defined limits.
 */
export { eventWindow, stateAt } from "./query";
export type { EventWindow, StateAtResult } from "./query";
export {
  EMPTY_REPLAY_SESSION_ID,
  REPLAY_NOW_MS,
  TemporalLimitsError,
  replayForward,
} from "./replay";
export type { ReplayLimits, ReplayResult } from "./replay";
