/**
 * Deterministic bounded forward replay over a window of W006 stream entries
 * (W402 §3.2, pure).
 *
 * W006 owns the engine primitives (event log, corrections, at-T snapshots)
 * and W401 owns fusion into the engine. This module is the CONSUMER-FACING
 * replay: it rebuilds the EVENT-DERIVED world state from a window of stream
 * entries on a FRESH engine, with checkpointed snapshots and EXPLICIT,
 * enforced limits. No new state, no new fusion, no persistence.
 *
 * DETERMINISM CONTRACT (the accept criterion): `replayForward` is a pure
 * function of its input. The replay engine's clock is FORCED to the fixed
 * constant {@link REPLAY_GENERATED_AT_MS} — `init.now` is ignored — so every
 * `WorldSnapshot.generatedAtMs` (checkpoints and final alike) carries that
 * constant, never a wall-clock read. There is no RNG and no ambient state:
 * the same input window plus the same limits produce a deep-equal
 * {@link ReplayResult} on every run.
 *
 * APPLICATION ORDER: entries are applied in SEQUENCE order (the order the
 * live engine applied them in), not in the input array's order and not in
 * event-time order. The engine's log is event-time-ordered, so a
 * `eventsSince(0)` window can carry a bounded-late entry (higher sequence,
 * earlier event time); replaying in sequence order reproduces the engine's
 * own application order, which is the only order whose intermediate states
 * are states the live engine actually had. (Applying a subsequence of an
 * accepted arrival order can never violate the engine's bounded-reorder
 * window: the replay high-water at each step is at most the live high-water
 * the event was originally accepted against.)
 *
 * SUPERSESSION SEMANTICS (the net-effect rule): an entry whose `eventId` is
 * corrected by some LATER entry in the window is SKIPPED — the corrected
 * value replays at the CORRECTION's position, and the superseded original
 * must not also apply (that would double-count evidence). The live engine
 * handles superseding at append time; a replay over a window reconstructs
 * the same net effect: for `X` corrected by `C`, only `C`'s content lands in
 * the replayed state. Because the fresh engine has never seen `X` (it was
 * skipped), `C`'s `correctionOf` link cannot resolve inside the replay
 * engine — the replay therefore applies the correction's content WITHOUT
 * the link, and the supersession itself is accounted by the skip plus the
 * `supersededSkipped` counter (the honest record). A correction whose target
 * is NOT in the window at an earlier application position cannot honestly
 * apply mid-window either — the engine's `CorrectionTargetNotFoundError` is
 * caught, the correction is skipped, and the `correctionsOrphaned` counter
 * records it. Nothing is ever silently dropped.
 */
import { WorldEventStreamEntry } from "@sporta/contracts";
import type { EventEnvelope, WorldSnapshot } from "@sporta/contracts";
import {
  CorrectionTargetNotFoundError,
  DuplicateEventError,
  WorldModelEngine,
} from "@sporta/world-model";
import type { WorldModelEngineInit } from "@sporta/world-model";
import { TemporalLimitsError } from "./errors";

/**
 * The deterministic `generatedAtMs` every replay snapshot carries. The
 * replay's clock is forced to this constant regardless of `init.now` —
 * replay output must be byte-reproducible.
 */
export const REPLAY_GENERATED_AT_MS = 0;

/**
 * The session id a replay of an EMPTY window belongs to. An empty window
 * carries no session evidence to inherit; a fixed constant keeps the result
 * reproducible (the engine requires a non-empty session id).
 */
export const EMPTY_WINDOW_SESSION_ID = "sporta-replay";

/** The enforced bounds of a replay (fail loud beyond — bounded by design). */
export interface ReplayLimits {
  /** Maximum events to apply per replay; beyond it `TemporalLimitsError`. */
  maxEvents: number;
  /** Maximum window span (`max - min` event time) in ms; beyond it, fail loud. */
  maxSpanMs: number;
  /** Checkpoint cadence in ms (>= 1): a snapshot at each crossed boundary. */
  checkpointEveryMs: number;
}

/** Input for {@link replayForward}. */
export interface ReplayForwardInput {
  /** The window to replay (§3.1 output or any stream entries). */
  entries: readonly WorldEventStreamEntry[];
  /** The enforced bounds (echoed in the result). */
  limits: ReplayLimits;
  /**
   * Engine init carried into the replay engine — football state etc. The
   * `now` field is IGNORED and forced deterministic (see module docs).
   */
  init?: WorldModelEngineInit;
}

/** The deterministic result of one bounded forward replay. */
export interface ReplayResult {
  /**
   * A snapshot after each applied event whose `eventTimeMs` crossed the next
   * `checkpointEveryMs` boundary, in application order — plus the FINAL
   * snapshot (always present, even with zero events). Every checkpoint is a
   * deep-frozen engine clone (the W006 engine returns frozen snapshots).
   */
  checkpoints: readonly WorldSnapshot[];
  /** The state after the last applied event (deep-frozen; also `checkpoints`' last element). */
  final: WorldSnapshot;
  /** Events actually applied to the replay engine. */
  eventsApplied: number;
  /** Applied events that carried a `correctionOf` (including link-stripped ones). */
  correctionsApplied: number;
  /** Superseded entries skipped — their corrected value replays at the correction's position. */
  supersededSkipped: number;
  /** Corrections whose target is outside the window (or not yet applied) — skipped, counted, never silent. */
  correctionsOrphaned: number;
  /** Duplicate `eventId` inputs skipped (idempotent inputs — the engine's `DuplicateEventError`). */
  duplicatesSkipped: number;
  /** The limits this replay enforced (echoed for consumer audit). */
  limits: ReplayLimits;
}

/** Formats zod issues as `path: message; ...` (structural, like the engine's own taxonomy). */
function issuesOf(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

/** Validates the limits object; throws `RangeError` (fail loud, repo style). */
function validateLimits(limits: ReplayLimits): ReplayLimits {
  if (limits === null || typeof limits !== "object") {
    throw new RangeError("replayForward: limits must be a ReplayLimits object");
  }
  const { maxEvents, maxSpanMs, checkpointEveryMs } = limits;
  if (typeof maxEvents !== "number" || !Number.isInteger(maxEvents) || maxEvents < 1) {
    throw new RangeError(
      `replayForward: maxEvents must be an integer >= 1 (got ${String(maxEvents)})`,
    );
  }
  if (typeof maxSpanMs !== "number" || !Number.isFinite(maxSpanMs) || maxSpanMs < 0) {
    throw new RangeError(
      `replayForward: maxSpanMs must be a finite number >= 0 (got ${String(maxSpanMs)})`,
    );
  }
  if (
    typeof checkpointEveryMs !== "number" ||
    !Number.isInteger(checkpointEveryMs) ||
    checkpointEveryMs < 1
  ) {
    throw new RangeError(
      `replayForward: checkpointEveryMs must be an integer >= 1 (got ${String(checkpointEveryMs)})`,
    );
  }
  return limits;
}

/** The outcome of trying to apply one window entry to the replay engine. */
type ApplyOutcome = "applied" | "duplicate" | "orphaned";

/**
 * Applies one event to the replay engine under the replay's skip semantics.
 *
 * - the event is tried AS RECORDED first, so a correction whose target IS
 *   applied (e.g. a window with duplicate target entries) uses the engine's
 *   own native supersession;
 * - `DuplicateEventError` → skip (idempotent inputs — the caller counts it);
 * - `CorrectionTargetNotFoundError` with the target present in the window at
 *   an EARLIER application position → the target was provably skipped as
 *   superseded, so the correction's content applies WITHOUT the link (see
 *   module docs: the supersession is accounted by the skip + counter);
 * - `CorrectionTargetNotFoundError` otherwise (target outside the window, or
 *   only later in it) → orphaned: skipped and counted, never silent;
 * - every other engine error (e.g. `LateEventError` on an incoherent
 *   hand-built window) propagates — fail loud.
 */
function applyForReplay(
  engine: WorldModelEngine,
  event: EventEnvelope,
  targetEarlierInWindow: boolean,
): ApplyOutcome {
  try {
    engine.applyEvent(event);
    return "applied";
  } catch (error) {
    if (error instanceof DuplicateEventError) {
      return "duplicate";
    }
    if (error instanceof CorrectionTargetNotFoundError) {
      if (targetEarlierInWindow && event.correctionOf !== undefined) {
        // The corrected value replays at the correction's position: apply
        // the correction's content without the (unresolvable) link. The
        // engine re-validates the envelope; only the link is dropped.
        const standalone: EventEnvelope = { ...event };
        delete standalone.correctionOf;
        return applyForReplay(engine, standalone, false);
      }
      return "orphaned";
    }
    throw error;
  }
}

/**
 * Replays a window of stream events forward on a FRESH engine,
 * deterministically, with checkpointed snapshots and enforced limits.
 *
 * See the module docs for the determinism, application-order, and
 * supersession contracts. Limits are enforced BEFORE any application:
 * the replay is bounded by design, so a violating window is refused
 * outright — a partial replay is never returned for a limit violation.
 *
 * The `events to apply` bound is checked against the provable upper bound —
 * every NON-superseded entry (superseded entries are provably never applied;
 * duplicates and orphaned corrections discovered at application time only
 * reduce the count further).
 */
export function replayForward(input: ReplayForwardInput): ReplayResult {
  if (input === null || typeof input !== "object") {
    throw new RangeError("replayForward: input must be a ReplayForwardInput object");
  }
  if (!Array.isArray(input.entries)) {
    throw new RangeError("replayForward: entries must be an array of WorldEventStreamEntry");
  }
  const limits = validateLimits(input.limits);

  // Fail loud on malformed entries BEFORE any application (partial replays
  // are never returned for malformed input either).
  const entries: WorldEventStreamEntry[] = [];
  for (let i = 0; i < input.entries.length; i += 1) {
    const check = WorldEventStreamEntry.safeParse(input.entries[i]);
    if (!check.success) {
      throw new RangeError(
        `replayForward: entries[${i}] is not a valid WorldEventStreamEntry: ${issuesOf(check.error)}`,
      );
    }
    entries.push(input.entries[i]!);
  }

  // One replay belongs to one engine session (the entries all carry one).
  const firstSession = entries[0]?.event.sessionId;
  for (const entry of entries) {
    if (entry.event.sessionId !== firstSession) {
      throw new RangeError(
        `replayForward: entries span multiple sessions ("${firstSession}" and ` +
          `"${entry.event.sessionId}"): a replay window belongs to one engine session`,
      );
    }
  }

  // Canonical application order: SEQUENCE ascending (the live engine's own
  // application order). Array#sort is stable, so equal sequences keep the
  // input order — deterministic for any input.
  const ordered = [...entries].sort((a, b) => a.sequence - b.sequence);

  // Static supersession analysis: entry i is superseded iff some LATER entry
  // (in application order) carries correctionOf === its eventId. Scanning
  // from the end accumulates exactly the ids corrected by a later entry.
  const correctedByLater = new Set<string>();
  const superseded: boolean[] = new Array<boolean>(ordered.length).fill(false);
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    superseded[i] = correctedByLater.has(ordered[i]!.event.eventId);
    const target = ordered[i]!.event.correctionOf;
    if (target !== undefined) {
      correctedByLater.add(target);
    }
  }

  // -- Limit enforcement (fail loud, before any application) ---------------
  const eventsToApply = superseded.reduce(
    (count, isSuperseded) => count + (isSuperseded ? 0 : 1),
    0,
  );
  if (eventsToApply > limits.maxEvents) {
    throw new TemporalLimitsError({
      limitKind: "maxEvents",
      limit: limits.maxEvents,
      actual: eventsToApply,
    });
  }
  let minMs = Number.POSITIVE_INFINITY;
  let maxMs = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    minMs = Math.min(minMs, entry.event.eventTimeMs);
    maxMs = Math.max(maxMs, entry.event.eventTimeMs);
  }
  const spanMs = entries.length >= 2 ? maxMs - minMs : 0;
  if (spanMs > limits.maxSpanMs) {
    throw new TemporalLimitsError({
      limitKind: "maxSpanMs",
      limit: limits.maxSpanMs,
      actual: spanMs,
    });
  }

  // First application position of each event id (for orphan-recovery checks).
  const firstIndexOf = new Map<string, number>();
  for (let i = 0; i < ordered.length; i += 1) {
    const id = ordered[i]!.event.eventId;
    if (!firstIndexOf.has(id)) {
      firstIndexOf.set(id, i);
    }
  }

  // -- The replay engine: fresh, with the caller's init and a FORCED clock --
  const engine = WorldModelEngine.create(firstSession ?? EMPTY_WINDOW_SESSION_ID, {
    ...(input.init ?? {}),
    now: () => REPLAY_GENERATED_AT_MS,
  });

  const checkpoints: WorldSnapshot[] = [];
  let eventsApplied = 0;
  let correctionsApplied = 0;
  let supersededSkipped = 0;
  let correctionsOrphaned = 0;
  let duplicatesSkipped = 0;
  // The next uncrossed checkpoint boundary. Boundaries are multiples of the
  // cadence; an applied event checkpoints when its event time REACHES the
  // next uncrossed boundary, and the boundary then jumps past that time
  // (all boundaries <= the event's time are considered crossed — one
  // checkpoint per triggering event, never one per boundary skipped over).
  let nextBoundaryMs = limits.checkpointEveryMs;

  for (let i = 0; i < ordered.length; i += 1) {
    const entry = ordered[i]!;
    if (superseded[i]) {
      supersededSkipped += 1;
      continue;
    }
    const target = entry.event.correctionOf;
    const targetEarlierInWindow =
      target !== undefined && (firstIndexOf.get(target) ?? Number.POSITIVE_INFINITY) < i;
    const outcome = applyForReplay(engine, entry.event, targetEarlierInWindow);
    if (outcome === "applied") {
      eventsApplied += 1;
      if (target !== undefined) {
        correctionsApplied += 1;
      }
      if (entry.event.eventTimeMs >= nextBoundaryMs) {
        checkpoints.push(engine.snapshot());
        nextBoundaryMs =
          Math.floor(entry.event.eventTimeMs / limits.checkpointEveryMs) *
            limits.checkpointEveryMs +
          limits.checkpointEveryMs;
      }
    } else if (outcome === "duplicate") {
      duplicatesSkipped += 1;
    } else {
      correctionsOrphaned += 1;
    }
  }

  // The final snapshot is ALWAYS pushed (even with zero applied events).
  const final = engine.snapshot();
  checkpoints.push(final);

  return {
    checkpoints,
    final,
    eventsApplied,
    correctionsApplied,
    supersededSkipped,
    correctionsOrphaned,
    duplicatesSkipped,
    limits: Object.freeze({ ...limits }),
  };
}
