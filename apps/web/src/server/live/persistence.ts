/**
 * THE LIVE/REPLAY CONTINUITY PERSISTENCE (L014, platform side) — the
 * durable replay-record seam for the W915 SSE live transport.
 *
 * WHAT THIS MODULE OWES (the boundary Worker C's presentation side
 * recorded in three places — the replay route's comment, the
 * `LiveReplayRecordDoc` doc, and the L014 research note):
 *
 * > the record is the transport's own in-memory record of THIS instance's
 * > window — durable persistence of live observations/world versions keyed
 * > to the session, and reload/redeploy recovery of the replayable state,
 * > are the PLATFORM side of L014 (Worker B's lane).
 *
 * This module delivers that platform side as THREE additive pieces — no
 * route changes, no wire changes, no forked transport (the W915
 * extend-not-fork discipline):
 *
 * 1. {@link LiveReplayPersistence} — the PORT: append recorded frames
 *    incrementally, mark windows complete, serve ONLY genuinely completed
 *    records (deep-clone-on-read). The sqlite adapter
 *    (`server/platform/live/sqlite-replay-store.ts`) implements it with
 *    the J014 identity-plane discipline (WAL + busy-timeout; the W911 shim
 *    refusal propagates for the composition to catch honestly).
 *
 * 2. {@link liveReplaySink} — the SINK adapter that feeds the transport's
 *    own recording events (the additive `recordSink` option) into the
 *    persistence: every frame the channel records, and the window's
 *    completion with the honest meta. The sink receives EXACTLY the
 *    frames and meta the in-memory replay record serves — one source of
 *    truth, two sinks, never a re-stamped byte.
 *
 * 3. {@link withDurableReplayRecord} — the DECORATOR (the same pattern as
 *    `withLiveTelemetry`) that answers `replayRecord` from the PLATFORM
 *    state when the transport's own memory cannot: after a restart (the
 *    channel and its record died with the process), the persisted
 *    complete record is the answer — the same session, the same world
 *    versions/timecodes, served verbatim.
 *
 * RECOVERY PRECEDENCE (the honest state machine — no silent replay-as-live,
 * no second canonical window):
 *
 * - the in-memory answer `complete` → returned (the sink already persisted
 *   it — the live instance is authoritative for its own window);
 * - the in-memory answer `live-window-open` → returned (a window is
 *   streaming NOW — the honest 409 posture; a genuinely re-opened window
 *   takes precedence while it is live, and its completion supersedes the
 *   persisted rows);
 * - `no-record`/`null` → the PERSISTED complete record when one exists
 *   (the recovery read: the record outlives the process AND the source
 *   registration), else the in-memory answer verbatim.
 *
 * An INTERRUPTED window (process death mid-window) never serves partial
 * frames as a complete record: the port's read only answers rows whose
 * window row was genuinely marked complete by the channel that emitted
 * the frames. The partial rows are retained as honest provenance; the
 * live view honestly restarts (the L002 deterministic source re-runs the
 * same scripted window).
 *
 * PURITY: no wall-clock reads, no env reads, no network I/O. The store's
 * own errors are the transport's failure classes — never swallowed into a
 * fabricated record.
 */
import type { LiveReplayRecordDoc, LiveWorldFrameDoc } from "@/lib/live-sse";
import type { LiveTransport } from "./transport";
import type { LiveRecordedWindowSink } from "./transport";

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * The durable replay-record persistence port (L014 platform side).
 *
 * Implementations MUST: serve only genuinely completed windows
 * (`markWindowComplete` is the single completion authority — the channel
 * that emitted the frames), keep the persisted frames VERBATIM (never
 * re-stamped), hand out deep clones (no shared references into a store),
 * and treat `appendRecordedFrame` as idempotent per (sessionId, ordinal).
 */
export interface LiveReplayPersistence {
  /** The structural provider marker (health/banner surfaces may read it). */
  readonly providerName: string;
  /**
   * Appends one recorded world frame (incremental crash-safety). A frame
   * with ordinal 1 RESETS the session's rows first — a new window
   * supersedes the old record honestly (the newest window the transport
   * actually served is the session's record).
   */
  appendRecordedFrame(sessionId: string, frame: LiveWorldFrameDoc): void;
  /**
   * Marks the session's window COMPLETE with the honest meta (the same
   * meta the in-memory replay record serves — verbatim). Idempotent.
   */
  markWindowComplete(sessionId: string, meta: NonNullable<LiveReplayRecordDoc["meta"]>): void;
  /**
   * The persisted COMPLETE record (`null` when the session has no
   * genuinely completed window persisted — partial/interrupted windows
   * never serve).
   */
  findCompleteRecord(sessionId: string): LiveReplayRecordDoc | null;
  /**
   * The honest interrupted-window facts (recovery visibility): sessions
   * with persisted frames but NO completion — the platform state an
   * operator should see after a mid-window process death (never served,
   * never lost silently).
   */
  listInterruptedWindows(): { sessionId: string; frames: number }[];
  /** Closes the store (idempotent; a closed store refuses loudly). */
  close(): void;
}

// ---------------------------------------------------------------------------
// The sink adapter (the transport's record events → the persistence)
// ---------------------------------------------------------------------------

/**
 * Bridges the transport's additive `recordSink` seam onto the persistence
 * port: every recorded frame appends; the window's completion (with the
 * full record — frames + honest meta) marks the window complete.
 */
export function liveReplaySink(persistence: LiveReplayPersistence): LiveRecordedWindowSink {
  return {
    onRecordedFrame(sessionId, frame) {
      persistence.appendRecordedFrame(sessionId, frame);
    },
    onWindowComplete(sessionId, record) {
      if (record.meta === undefined) return; // never (a complete record carries meta)
      persistence.markWindowComplete(sessionId, record.meta);
    },
  };
}

// ---------------------------------------------------------------------------
// The decorator (the recovery read through the transport seam)
// ---------------------------------------------------------------------------

/**
 * Wraps a live transport with the durable replay-record recovery: the
 * replay-record READ falls back to the persisted platform state when the
 * transport's own memory cannot answer (a restart, a redeploy — the
 * channel and its in-memory record died with the previous process).
 *
 * The wire is untouched: every other method passes through verbatim
 * (telemetry stamping, probe injection, bounded buffers and close
 * semantics keep working exactly as composed — this decorator sits OUTSIDE
 * `withLiveTelemetry`).
 */
export function withDurableReplayRecord(
  inner: LiveTransport,
  persistence: LiveReplayPersistence,
): LiveTransport {
  return {
    state: () => inner.state(),
    detail: () => inner.detail(),
    listSources: () => inner.listSources(),
    registerSource: (source) => inner.registerSource(source),
    removeSource: (sessionId) => {
      // The persisted record OUTLIVES the source registration — that is
      // the platform recovery contract (a session's replayable state does
      // not die with its registration). Only the channel ends here.
      inner.removeSource(sessionId);
    },
    subscribe: (sessionId) => inner.subscribe(sessionId),
    status: (sessionId) => inner.status(sessionId),
    replayRecord(sessionId) {
      const memory = inner.replayRecord(sessionId);
      if (memory !== null && (memory.state === "complete" || memory.state === "live-window-open")) {
        // The live instance is authoritative for its own window: a
        // complete window it served (the sink already persisted it), or a
        // window it is streaming right now (the honest 409 posture).
        return memory;
      }
      // `no-record` (or no source at all): the platform state answers.
      const persisted = persistence.findCompleteRecord(sessionId);
      if (persisted !== null) return persisted;
      return memory;
    },
    closeAll: () => inner.closeAll(),
  };
}
