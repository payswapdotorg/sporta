/**
 * SQLITE adapter for the LIVE REPLAY RECORD store (L014 platform side —
 * the J014 identity-plane discipline applied to the live/replay
 * continuity state).
 *
 * WHY THIS EXISTS: L014's platform acceptance is that the completed live
 * window's RECORDED world frames survive reload/restart/redeploy — the
 * transport's in-memory record dies with the process, so after a restart
 * the replay route would honestly answer `no-record` and the stream route
 * would re-open a second live window over a session that already
 * completed one (a second canonical window — the exact anti-pattern
 * L014/L017 forbid). This adapter mirrors the J014 `SqliteSessionStore`
 * discipline: one local sqlite file under the real Bun runtime
 * (`SPORTA_LIVE_REPLAY_DB`, default `db/live-replay.db`), WAL +
 * busy-timeout, frames stored VERBATIM as the wire documents (never
 * re-stamped), deep-clone-on-read (a JSON parse per frame — no shared
 * references into the store), only genuinely completed windows served.
 *
 * THE COMPLETION AUTHORITY: `markWindowComplete` is the single flip. The
 * channel that emitted the frames calls it through the transport's
 * `recordSink` at the `live-window-complete` moment — rows without it are
 * INTERRUPTED windows (honest provenance, never served, visible through
 * `listInterruptedWindows` for the operator surfaces).
 *
 * The bundled Node runtime cannot construct this store (the W911 shim
 * refusal) — the composition catches that specific refusal and falls
 * back to the transport's own in-memory record with the honest banner
 * (the per-instance posture of today, never silently undurable).
 */
import type { LiveReplayRecordDoc, LiveWorldFrameDoc } from "@/lib/live-sse";
import type { LiveReplayPersistence } from "@/server/live/persistence";
import { Database } from "bun:sqlite";

const CREATE_WINDOWS_SQL = `
  CREATE TABLE IF NOT EXISTS sporta_live_replay_windows (
    session_id          TEXT PRIMARY KEY,
    state               TEXT NOT NULL CHECK (state IN ('recording', 'complete')),
    label               TEXT,
    cadence_ms          INTEGER,
    completed_at_ms     INTEGER,
    delivered_frames    INTEGER,
    dropped_frames      INTEGER,
    world_version_first INTEGER,
    world_version_last  INTEGER,
    event_time_first_ms INTEGER,
    event_time_last_ms  INTEGER,
    watermark_ms         INTEGER,
    watermark_sequence   INTEGER,
    frame_count         INTEGER NOT NULL DEFAULT 0,
    recorded_at_ms      INTEGER NOT NULL
  );
`;

const CREATE_FRAMES_SQL = `
  CREATE TABLE IF NOT EXISTS sporta_live_replay_frames (
    session_id  TEXT NOT NULL,
    ordinal     INTEGER NOT NULL,
    frame_json  TEXT NOT NULL,
    PRIMARY KEY (session_id, ordinal)
  );
`;

/** One persisted window row (the sqlite naming). */
interface WindowRow {
  session_id: string;
  state: "recording" | "complete";
  label: string | null;
  cadence_ms: number | null;
  completed_at_ms: number | null;
  delivered_frames: number | null;
  dropped_frames: number | null;
  world_version_first: number | null;
  world_version_last: number | null;
  event_time_first_ms: number | null;
  event_time_last_ms: number | null;
  watermark_ms: number | null;
  watermark_sequence: number | null;
  frame_count: number;
}

/** `LiveReplayPersistence` over the real `bun:sqlite` engine (L014). */
export class SqliteLiveReplayStore implements LiveReplayPersistence {
  readonly providerName = "sqlite" as const;

  readonly #db: Database;
  #closed = false;

  constructor(dbOrPath: Database | string) {
    // `bun:sqlite` resolves to the W911 shim under the bundled Node
    // runtime; constructing it there fails loudly with the shim's message
    // (the composition catches that specific refusal and falls back
    // honestly to the per-instance in-memory record).
    this.#db = typeof dbOrPath === "string" ? new Database(dbOrPath) : dbOrPath;
    this.#db.run("PRAGMA journal_mode = WAL;");
    this.#db.run("PRAGMA busy_timeout = 5000;");
    this.#db.exec(CREATE_WINDOWS_SQL);
    this.#db.exec(CREATE_FRAMES_SQL);
  }

  appendRecordedFrame(sessionId: string, frame: LiveWorldFrameDoc): void {
    this.#assertOpen();
    if (frame.ordinal === 1) {
      // A NEW window supersedes the session's old rows honestly (the
      // newest window the transport actually served is the record).
      this.#db
        .query("DELETE FROM sporta_live_replay_windows WHERE session_id = ?")
        .run(sessionId);
      this.#db
        .query("DELETE FROM sporta_live_replay_frames WHERE session_id = ?")
        .run(sessionId);
    }
    this.#db
      .query(
        `INSERT INTO sporta_live_replay_windows
           (session_id, state, frame_count, recorded_at_ms)
         VALUES (?, 'recording', 0, ?)
         ON CONFLICT(session_id) DO NOTHING`,
      )
      .run(sessionId, frame.generatedAtMs);
    this.#db
      .query(
        `INSERT INTO sporta_live_replay_frames (session_id, ordinal, frame_json)
         VALUES (?, ?, ?)
         ON CONFLICT(session_id, ordinal) DO UPDATE SET frame_json = excluded.frame_json`,
      )
      .run(sessionId, frame.ordinal, JSON.stringify(frame));
    this.#db
      .query(
        `UPDATE sporta_live_replay_windows
         SET frame_count = (SELECT COUNT(*) FROM sporta_live_replay_frames WHERE session_id = ?)
         WHERE session_id = ?`,
      )
      .run(sessionId, sessionId);
  }

  markWindowComplete(
    sessionId: string,
    meta: NonNullable<LiveReplayRecordDoc["meta"]>,
  ): void {
    this.#assertOpen();
    const result = this.#db
      .query(
        `UPDATE sporta_live_replay_windows
         SET state = 'complete', label = ?, cadence_ms = ?, completed_at_ms = ?,
             delivered_frames = ?, dropped_frames = ?,
             world_version_first = ?, world_version_last = ?,
             event_time_first_ms = ?, event_time_last_ms = ?,
             watermark_ms = ?, watermark_sequence = ?,
             frame_count = (SELECT COUNT(*) FROM sporta_live_replay_frames WHERE session_id = ?)
         WHERE session_id = ?`,
      )
      .run(
        meta.label,
        meta.cadenceMs,
        meta.completedAtMs,
        meta.deliveredFrames,
        meta.droppedFrames,
        meta.worldVersionFirst,
        meta.worldVersionLast,
        meta.eventTimeFirstMs,
        meta.eventTimeLastMs,
        meta.watermarkFinal.watermarkMs,
        meta.watermarkFinal.sequence,
        sessionId,
        sessionId,
      );
    if (result.changes === 0) {
      // A completion for a window nobody recorded (no append ever ran) is
      // a contract violation of the transport's sink — loud, never a
      // fabricated record.
      throw new Error(`live replay store: completion without a recorded window '${sessionId}'`);
    }
  }

  findCompleteRecord(sessionId: string): LiveReplayRecordDoc | null {
    this.#assertOpen();
    const row = this.#db
      .query("SELECT * FROM sporta_live_replay_windows WHERE session_id = ? AND state = 'complete'")
      .get(sessionId) as WindowRow | null;
    if (row === null) return null;
    const frameRows = this.#db
      .query(
        "SELECT frame_json FROM sporta_live_replay_frames WHERE session_id = ? ORDER BY ordinal ASC",
      )
      .all(sessionId) as { frame_json: string }[];
    // Deep-clone-on-read: every parse is a fresh object graph — the served
    // record can never be mutated into the store's state (the J014
    // store's deep-clone-on-read rule, same reason).
    const frames = frameRows.map((frameRow) =>
      JSON.parse(frameRow.frame_json) as LiveWorldFrameDoc,
    );
    return {
      schemaVersion: "sporta.live-replay/1",
      sessionId,
      state: "complete",
      frames,
      meta: {
        label: row.label ?? sessionId,
        completedAtMs: row.completed_at_ms ?? 0,
        cadenceMs: row.cadence_ms ?? 0,
        deliveredFrames: row.delivered_frames ?? frames.length,
        droppedFrames: row.dropped_frames ?? 0,
        worldVersionFirst: row.world_version_first ?? 0,
        worldVersionLast: row.world_version_last ?? 0,
        eventTimeFirstMs: row.event_time_first_ms ?? 0,
        eventTimeLastMs: row.event_time_last_ms ?? 0,
        watermarkFinal: {
          watermarkMs: row.watermark_ms ?? 0,
          sequence: row.watermark_sequence ?? 0,
        },
      },
    };
  }

  listInterruptedWindows(): { sessionId: string; frames: number }[] {
    this.#assertOpen();
    const rows = this.#db
      .query("SELECT session_id, frame_count FROM sporta_live_replay_windows WHERE state != 'complete'")
      .all() as { session_id: string; frame_count: number }[];
    return rows.map((row) => ({ sessionId: row.session_id, frames: row.frame_count }));
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("the sqlite live replay store is closed");
  }
}
