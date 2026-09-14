/**
 * Deterministic forward replay over a window of world-model events (W402
 * §3.2, pure).
 *
 * W006 owns the engine primitives (event log, corrections, at-T snapshots);
 * W401 owns fusion into the engine. This module is the CONSUMER-FACING
 * forward replay: it rebuilds the engine's EVENT-LOG state from a window of
 * `WorldEventStreamEntry` (§3.1 output or any sequence-numbered entries) on a
 * FRESH engine, with checkpointed snapshots and EXPLICIT, ENFORCED limits. No
 * new state, no new fusion, no persistence.
 *
 * WHAT A REPLAY REBUILDS (documented scope — the honest boundary):
 *
 * - the event log for the window: the same events, applied in the same
 *   SEQUENCE (application) order, reproducing the live engine's sequence
 *   numbering, snapshot-version progression, and supersession structure
 *   exactly (a full-log window replays to the live engine's watermark);
 * - corrections: a correction supersedes its target at the correction's
 *   position, exactly like the engine's append-time semantics.
 *
 * WHAT IT DOES NOT REBUILD (intentional, documented differences — the event
 * stream carries only events):
 *
 * - ENTITY STATE: `EventEnvelope` carries no entity state — entities are
 *   fusion-upserted (W401 `upsertEntity`, W006 versioning) and are NOT
 *   replayable from an event window. The replay's snapshots therefore contain
 *   no entities. Consumers needing entity state at time T use
 *   `stateAt(engine, T)`; consumers needing a full rebuild re-run the
 *   deterministic W401 fusion over the observation store (same store →
 *   deep-equal engine state);
 * - FOOTBALL STATE beyond the seed: clock patches (e.g. the `fulltime`
 *   post-match rule) are football state changes, NOT events — they never
 *   enter the event stream. The replay carries the caller-provided
 *   `init.football` verbatim (the state at the window boundary, as a consumer
 *   checkpointing there would seed it).
 *
 * DETERMINISM (accept criterion): replay output must be byte-reproducible.
 * The replay engine's `now` is FORCED to the constant {@link REPLAY_NOW_MS}
 * (any caller-provided `init.now` is replaced): `WorldSnapshot.generatedAtMs`
 * therefore carries the deterministic constant, never wall-clock. There is no
 * RNG and no clock read anywhere in this module — same input → deep-equal
 * {@link ReplayResult}.
 *
 * LIMITS (fail loud — replay is a BOUNDED operation by design,
 * architecture-lock §8 "bounded everything"):
 *
 * - window span (latest event time − earliest event time across the entries)
 *   beyond `maxSpanMs` → {@link TemporalLimitsError};
 * - events-to-apply count (every entry handed in — each is real engine work:
 *   validation + log insertion, superseded originals included) beyond
 *   `maxEvents` → {@link TemporalLimitsError};
 * - both refusals happen BEFORE any application: a bounded consumer never
 *   does partial work that then throws.
 */
import type { WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import {
  CorrectionTargetNotFoundError,
  DuplicateEventError,
  WorldModelEngine,
} from "@sporta/world-model";
import type { WorldModelEngineInit } from "@sporta/world-model";

/**
 * The forced deterministic wall-clock constant for replays: every snapshot a
 * replay produces carries `generatedAtMs === 0` (pinned by tests). Replays
 * must never leak wall-clock time into their output.
 */
export const REPLAY_NOW_MS = 0;

/**
 * Deterministic placeholder session id for the EMPTY window: with zero
 * entries there is no session evidence to derive a session from, and the
 * `WorldSnapshot` contract requires a non-empty `sessionId`. The placeholder
 * is a fixed constant — never clock- or RNG-derived — and is pinned by tests.
 */
export const EMPTY_REPLAY_SESSION_ID = "sporta-temporal-empty-replay";

/** Enforced replay limits (all validated; all echoed in the result). */
export interface ReplayLimits {
  /**
   * Events applied per replay (fail loud beyond). The bound counts every
   * entry handed in — the replay refuses oversized windows wholesale before
   * any application.
   */
  maxEvents: number;
  /** Maximum window span in ms (latest − earliest entry event time). */
  maxSpanMs: number;
  /** Snapshot cadence in ms (>= 1): a checkpoint per crossed boundary. */
  checkpointEveryMs: number;
}

/** The deterministic result of one forward replay. */
export interface ReplayResult {
  /**
   * Snapshots at each checkpoint position PLUS the final snapshot (always
   * present, even with zero events). Each is a deep-frozen engine clone —
   * the engine already returns frozen snapshots (verified and pinned by
   * tests).
   */
  checkpoints: readonly WorldSnapshot[];
  /** The final snapshot (identical to the last element of `checkpoints`). */
  final: WorldSnapshot;
  /**
   * Entries whose application counts as effective evidence: applied to the
   * replay engine and NOT superseded, NOT duplicate, NOT orphaned.
   */
  eventsApplied: number;
  /** Among the applied entries, those carrying `correctionOf`. */
  correctionsApplied: number;
  /**
   * Superseded entries: an entry whose `eventId` appears as some LATER
   * entry's `correctionOf` within the window. The entry is still ENGINE-LOGGED
   * (the engine requires the target in its log to record the supersession,
   * and the live log keeps superseded events queryable — the honest evidence
   * record) but is NOT counted as applied: counting both the original and its
   * correction would DOUBLE-COUNT evidence. The corrected value replays at
   * the correction's position; the net supersession effect matches the live
   * engine's.
   */
  supersededSkipped: number;
  /**
   * Corrections whose target is NOT in the window before them (nor already
   * applied): the engine refuses them (`CorrectionTargetNotFound`) and the
   * replay skips and counts them — an orphaned correction cannot honestly
   * apply mid-window; it stays counted, never silent.
   */
  correctionsOrphaned: number;
  /**
   * Duplicate event ids within the window: the engine refuses re-application
   * (`DuplicateEventError`) and the replay counts and skips them (idempotent
   * inputs). Mirrors W401's `eventsDeduplicated` reporting.
   */
  eventsDeduplicated: number;
  /** The limits this replay ran under, echoed verbatim (as a copy). */
  limits: ReplayLimits;
}

/**
 * A replay limit was exceeded — replay is a BOUNDED operation by design.
 * `RangeError` subclass (fail loud, repo style).
 */
export class TemporalLimitsError extends RangeError {
  /** Which enforced limit was exceeded. */
  readonly exceeded: "maxEvents" | "maxSpanMs";
  /** The offending observed value (span in ms, or entry count). */
  readonly actual: number;
  /** The configured limit value. */
  readonly limit: number;

  constructor(exceeded: "maxEvents" | "maxSpanMs", actual: number, limit: number) {
    super(
      exceeded === "maxSpanMs"
        ? `replayForward: window span ${actual}ms exceeds maxSpanMs ${limit}ms`
        : `replayForward: events-to-apply count ${actual} exceeds maxEvents ${limit}`,
    );
    this.name = "TemporalLimitsError";
    this.exceeded = exceeded;
    this.actual = actual;
    this.limit = limit;
  }
}

/** Validates the limits object (malformed limits are a programming error). */
function validateLimits(limits: ReplayLimits): void {
  if (limits === null || typeof limits !== "object") {
    throw new RangeError(
      "replayForward: limits must be an object with maxEvents, maxSpanMs, checkpointEveryMs",
    );
  }
  if (
    typeof limits.maxEvents !== "number" ||
    !Number.isFinite(limits.maxEvents) ||
    limits.maxEvents < 0
  ) {
    throw new RangeError(
      `replayForward: maxEvents must be a finite number >= 0 (got ${String(limits.maxEvents)})`,
    );
  }
  if (
    typeof limits.maxSpanMs !== "number" ||
    !Number.isFinite(limits.maxSpanMs) ||
    limits.maxSpanMs < 0
  ) {
    throw new RangeError(
      `replayForward: maxSpanMs must be a finite number >= 0 (got ${String(limits.maxSpanMs)})`,
    );
  }
  if (
    typeof limits.checkpointEveryMs !== "number" ||
    !Number.isFinite(limits.checkpointEveryMs) ||
    limits.checkpointEveryMs < 1
  ) {
    throw new RangeError(
      `replayForward: checkpointEveryMs must be a finite number >= 1 (got ${String(limits.checkpointEveryMs)})`,
    );
  }
}

/**
 * Validates the per-entry shape this module itself reads: `sequence` (the
 * sort/application-order key) and `event.eventTimeMs` / `event.eventId` (the
 * span, checkpoint, and supersession keys). Full envelope validation stays
 * owned by the W006 engine (`applyEvent` → `InvalidEventError`).
 */
function validateEntries(entries: readonly WorldEventStreamEntry[]): void {
  if (!Array.isArray(entries)) {
    throw new RangeError("replayForward: entries must be an array of WorldEventStreamEntry");
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (
      entry === null ||
      typeof entry !== "object" ||
      entry.event === null ||
      typeof entry.event !== "object"
    ) {
      throw new RangeError(
        `replayForward: entries[${index}] must be a WorldEventStreamEntry with an event object`,
      );
    }
    if (
      typeof entry.sequence !== "number" ||
      !Number.isInteger(entry.sequence) ||
      entry.sequence < 0
    ) {
      throw new RangeError(
        `replayForward: entries[${index}].sequence must be an integer >= 0 (got ${String(entry.sequence)})`,
      );
    }
    if (typeof entry.event.eventId !== "string" || entry.event.eventId.length < 1) {
      throw new RangeError(
        `replayForward: entries[${index}].event.eventId must be a non-empty string`,
      );
    }
    const eventTimeMs = entry.event.eventTimeMs;
    if (typeof eventTimeMs !== "number" || !Number.isFinite(eventTimeMs) || eventTimeMs < 0) {
      throw new RangeError(
        `replayForward: entries[${index}].event.eventTimeMs must be a finite number >= 0 ` +
          `(got ${String(eventTimeMs)})`,
      );
    }
  }
}

/**
 * Computes, for each position in the SEQUENCE-ORDERED window, whether the
 * entry is superseded: its `eventId` appears as some LATER entry's
 * `correctionOf` within the window. Later = later in sequence (application)
 * order, matching the engine's append-time semantics (a correction supersedes
 * an already-applied target; a forward-referencing "correction" is an orphan,
 * not a supersession).
 */
function supersededFlags(sorted: readonly WorldEventStreamEntry[]): boolean[] {
  const flags = new Array<boolean>(sorted.length).fill(false);
  const supersededLater = new Set<string>();
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const entry = sorted[index]!;
    if (supersededLater.has(entry.event.eventId)) {
      flags[index] = true;
    }
    const correctionOf = entry.event.correctionOf;
    if (correctionOf !== undefined) {
      supersededLater.add(correctionOf);
    }
  }
  return flags;
}

/**
 * Replays the window's events forward on a FRESH `WorldModelEngine`,
 * deterministically, within the enforced limits.
 *
 * Pass order (documented; same input → deep-equal result):
 *
 * 1. VALIDATE: malformed input (non-object input, malformed limits, malformed
 *    entries) throws `RangeError` — a programming error fails loudest, before
 *    any bound is even considered.
 * 2. ENFORCE LIMITS (before any application — bounded means no
 *    partial-then-throw work): entry count beyond `maxEvents` and event-time
 *    span beyond `maxSpanMs` throw {@link TemporalLimitsError}.
 * 3. ORDER: entries are applied IN SEQUENCE ORDER (`sequence` ascending, ties
 *    broken by input order via stable sort). Sequence is the engine's actual
 *    application order — replaying in it reproduces the live engine's
 *    sequence numbering, version progression, and supersession effects; the
 *    input array is never mutated (the replay sorts a copy).
 * 4. APPLY per entry, catching exactly the two refusal errors the engine
 *    defines for idempotent/underspecified input (everything else —
 *    `LateEventError`, `EventSessionMismatchError`, `InvalidEventError`, … —
 *    propagates, fail loud):
 *    - `DuplicateEventError` → `eventsDeduplicated` + skip (idempotent
 *      inputs);
 *    - `CorrectionTargetNotFoundError` → `correctionsOrphaned` + skip (an
 *      orphaned correction cannot honestly apply mid-window; it stays
 *      counted, never silent);
 *    - success → the entry is in the replay engine's log; if it is
 *      superseded within the window it counts ONLY as `supersededSkipped`
 *      (never also as `eventsApplied` — that would double-count evidence);
 *      otherwise it counts as `eventsApplied` (and `correctionsApplied` when
 *      it carries `correctionOf`).
 * 5. CHECKPOINTS: after each successful engine application (superseded
 *    originals included — they are real log entries), if the event's
 *    `eventTimeMs` reached or crossed the next pending
 *    `checkpointEveryMs` boundary, ONE `engine.snapshot()` is pushed and the
 *    pending boundary advances to the first boundary STRICTLY AFTER that
 *    event's time (a sparse event that jumps several boundaries collapses
 *    them into one checkpoint — the intermediate boundaries saw no state
 *    change). The FIRST pending boundary is `checkpointEveryMs` itself (a
 *    boundary at 0 would be the pre-replay state, which is nothing).
 * 6. FINAL: a final `engine.snapshot()` is ALWAYS pushed (even with zero
 *    events) and is both the last checkpoint and the `final` field.
 *
 * The fresh engine is created from `init` (football state, reorder window)
 * with `now` FORCED to {@link REPLAY_NOW_MS}; its session is the first sorted
 * entry's event session (entries with other sessions fail loud via the
 * engine's `EventSessionMismatchError` during application; an empty window
 * uses the documented {@link EMPTY_REPLAY_SESSION_ID} placeholder).
 */
export function replayForward(input: {
  entries: readonly WorldEventStreamEntry[];
  limits: ReplayLimits;
  init?: WorldModelEngineInit;
}): ReplayResult {
  if (input === null || typeof input !== "object") {
    throw new RangeError("replayForward: input must be an object with entries and limits");
  }
  validateLimits(input.limits);
  validateEntries(input.entries);

  const limits = input.limits;
  const entries = input.entries;

  if (entries.length > limits.maxEvents) {
    throw new TemporalLimitsError("maxEvents", entries.length, limits.maxEvents);
  }
  let earliestMs = Infinity;
  let latestMs = -Infinity;
  for (const entry of entries) {
    earliestMs = Math.min(earliestMs, entry.event.eventTimeMs);
    latestMs = Math.max(latestMs, entry.event.eventTimeMs);
  }
  const spanMs = entries.length === 0 ? 0 : latestMs - earliestMs;
  if (spanMs > limits.maxSpanMs) {
    throw new TemporalLimitsError("maxSpanMs", spanMs, limits.maxSpanMs);
  }

  // Sequence order = the engine's actual application order. Stable sort on a
  // copy: the caller's array is never mutated, and equal sequences keep the
  // input order (deterministic for any input).
  const sorted = [...entries].sort((a, b) => a.sequence - b.sequence);
  const superseded = supersededFlags(sorted);

  const sessionId = sorted[0]?.event.sessionId ?? EMPTY_REPLAY_SESSION_ID;
  const engine = WorldModelEngine.create(sessionId, {
    ...input.init,
    now: () => REPLAY_NOW_MS,
  });

  const checkpoints: WorldSnapshot[] = [];
  let nextBoundaryMs = limits.checkpointEveryMs;
  let eventsApplied = 0;
  let correctionsApplied = 0;
  let supersededSkipped = 0;
  let correctionsOrphaned = 0;
  let eventsDeduplicated = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    const entry = sorted[index]!;
    try {
      engine.applyEvent(entry.event);
    } catch (error) {
      if (error instanceof DuplicateEventError) {
        eventsDeduplicated += 1;
        continue;
      }
      if (error instanceof CorrectionTargetNotFoundError) {
        correctionsOrphaned += 1;
        continue;
      }
      throw error;
    }

    if (superseded[index] === true) {
      supersededSkipped += 1;
    } else {
      eventsApplied += 1;
      if (entry.event.correctionOf !== undefined) {
        correctionsApplied += 1;
      }
    }

    const eventTimeMs = entry.event.eventTimeMs;
    if (eventTimeMs >= nextBoundaryMs) {
      checkpoints.push(engine.snapshot());
      nextBoundaryMs =
        Math.floor(eventTimeMs / limits.checkpointEveryMs) * limits.checkpointEveryMs +
        limits.checkpointEveryMs;
    }
  }

  const final = engine.snapshot();
  checkpoints.push(final);

  return {
    checkpoints,
    final,
    eventsApplied,
    correctionsApplied,
    supersededSkipped,
    correctionsOrphaned,
    eventsDeduplicated,
    limits: {
      maxEvents: limits.maxEvents,
      maxSpanMs: limits.maxSpanMs,
      checkpointEveryMs: limits.checkpointEveryMs,
    },
  };
}
