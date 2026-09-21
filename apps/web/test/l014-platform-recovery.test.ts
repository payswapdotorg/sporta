/**
 * THE LIVE/REPLAY CONTINUITY RECOVERY BATTERY (L014, PLATFORM side) — REAL
 * PROCESSES, the J014 three-process pattern applied to the live lane.
 *
 * This battery closes the honest boundary Worker C's L014 presentation
 * side recorded ("the record is the transport's own in-memory record of
 * THIS instance's window; durable persistence and reload/redeploy recovery
 * are Worker B's platform lane"):
 *
 * - the LIVE process creates TWO real live-authorized sessions through the
 *   REAL upload route, registers their finite live sources, streams one
 *   window to its honest completion through the REAL SSE route (recording
 *   the wire frames), partially streams the second (long) window, and DIES
 *   mid-window (explicit exit);
 * - the RESTARTED process (no shared memory, a genuinely cold boot over
 *   the same files) must:
 *   1. resolve the OLD login token (the durable identity — J014's plane,
 *      re-proven on the live lane);
 *   2. answer the completed session's STREAM route with the honest 410 +
 *      replay pointer — NEVER a second live window over a session that
 *      already completed one (no silent replay-as-live, no second
 *      canonical window);
 *   3. serve the completed session's PERSISTED replay record with the
 *      frames VERBATIM (the exact wire frames the live process recorded —
 *      ordinals/world versions/watermarks/event times never re-stamped);
 *   4. answer the INTERRUPTED session's replay route with the honest
 *      no-record (partial frames never serve as a complete record), and
 *      open a FRESH window honestly once its source is re-registered (the
 *      recovery of the live view — ordinals restart from 1).
 *
 * The battery runs SERVER + TESTS IN ONE INVOCATION (each child is spawned
 * and awaited by this test file). Everything is asserted from the
 * children's recorded reports PLUS direct reads of the REAL sqlite file
 * (the replay-record rows on disk — bytes, not in-process claims).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const JOURNEY = join(import.meta.dir, "helpers", "l014-recovery-journey.ts");
const WEB_ROOT = join(import.meta.dir, "..");

let scratch = "";

interface LivePhaseReport {
  phase: "live";
  token: string;
  username: string;
  completedSessionId: string;
  interruptedSessionId: string;
  wireFrames: { ordinal: number; worldVersion: number; eventTimeMs: number }[];
  recordMeta: Record<string, unknown> | null;
  interruptedFramesSeen: number;
}

interface RestartedPhaseReport {
  phase: "restarted";
  meStatus: number;
  streamStatus: number;
  streamFailureClass: string | null;
  streamReplayPath: string | null;
  streamWorldVersionLast: number | null;
  replayStatus: number;
  replayState: string | null;
  replayFramesLength: number;
  replayFramesEqual: boolean;
  replayMeta: Record<string, unknown> | null;
  interruptedReplayStatus: number;
  interruptedReplayState: string | null;
  freshWindowStatus: number;
  freshWindowOrdinals: number[];
}

/** Spawns ONE real child process and returns its recorded report. */
async function runPhase<T>(phase: "live" | "restarted"): Promise<T> {
  const reportPath = join(scratch, `report-${phase}.json`);
  const proc = Bun.spawn({
    cmd: ["bun", JOURNEY, phase, scratch, reportPath],
    cwd: WEB_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    console.error(`--- l014 phase ${phase} child stderr ---\n${stderr}\n---`);
  }
  expect(code, `the phase-${phase} child process exited 0`).toBe(0);
  return JSON.parse(await Bun.file(reportPath).text()) as T;
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "sporta-l014-recovery-"));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("L014 platform — the live/replay record survives a REAL process restart", () => {
  let live: LivePhaseReport;

  test("the LIVE process: a real completed window + a mid-window death", async () => {
    live = await runPhase<LivePhaseReport>("live");
    expect(live.completedSessionId).not.toBe(live.interruptedSessionId);
    // The completed window recorded 24 wire frames (the finite window's
    // own scripted length) with the honest aligned semantics: world
    // versions advance with ordinals and event times are non-decreasing
    // (the first observation's event time is the timeline's 0 — the meta's
    // own eventTimeFirstMs).
    expect(live.wireFrames).toHaveLength(24);
    for (let index = 0; index < live.wireFrames.length; index += 1) {
      const frame = live.wireFrames[index]!;
      expect(frame.worldVersion).toBe(frame.ordinal); // versions advance with ordinals
      if (index > 0) {
        expect(frame.eventTimeMs).toBeGreaterThanOrEqual(live.wireFrames[index - 1]!.eventTimeMs);
      }
    }
    expect(live.interruptedFramesSeen).toBeGreaterThanOrEqual(4);
  }, 240_000);

  test("the RESTARTED process: the 410 (never a second window) + the persisted record VERBATIM", async () => {
    const b = await runPhase<RestartedPhaseReport>("restarted");
    // 0. The durable identity (J014's plane, re-proven on the live lane).
    expect(b.meStatus).toBe(200);
    // 1. THE NO-SECOND-WINDOW RULE: the stream route answers 410 with the
    //    typed failure class + the replay pointer + the recorded final
    //    world version — never a fresh SSE stream.
    expect(b.streamStatus).toBe(410);
    expect(b.streamFailureClass).toBe("live-window-complete");
    expect(b.streamReplayPath).toBe(`/api/live/${live.completedSessionId}/replay`);
    expect(b.streamWorldVersionLast).toBe(24);
    // 2. THE PERSISTED RECORD: the replay route serves the completed record
    //    with the frames VERBATIM (the exact wire frames of the dead
    //    process's live window) and the same honest meta.
    expect(b.replayStatus).toBe(200);
    expect(b.replayState).toBe("complete");
    expect(b.replayFramesLength).toBe(24);
    expect(b.replayFramesEqual).toBe(true);
    expect(b.replayMeta).toEqual(live.recordMeta);
  }, 240_000);

  test("the RESTARTED process: the interrupted window is honest (no-record, then a FRESH window)", async () => {
    const b = await runPhase<RestartedPhaseReport>("restarted");
    // 3. THE INTERRUPTED WINDOW: partial frames NEVER serve as a record.
    expect(b.interruptedReplayStatus).toBe(200);
    expect(b.interruptedReplayState).toBe("no-record");
    // And the live view recovers: the re-registered source opens a FRESH
    // window honestly (ordinals from 1 — a new window, visibly not a
    // continuation and never the completed record served as live).
    expect(b.freshWindowStatus).toBe(200);
    expect(b.freshWindowOrdinals.length).toBeGreaterThanOrEqual(3);
    expect(b.freshWindowOrdinals[0]).toBe(1);
    expect(b.freshWindowOrdinals).toEqual(b.freshWindowOrdinals.map((_, index) => index + 1));
  }, 240_000);

  test("the durable replay record is REAL BYTES on disk (the sqlite rows)", async () => {
    const db = new Database(join(scratch, "live-replay.db"));
    const windows = db
      .query(
        "SELECT session_id, state, frame_count FROM sporta_live_replay_windows ORDER BY session_id",
      )
      .all() as { session_id: string; state: string; frame_count: number }[];
    const completed = windows.find((row) => row.session_id === live.completedSessionId);
    expect(completed?.state).toBe("complete");
    expect(completed?.frame_count).toBe(24);
    const interrupted = windows.find((row) => row.session_id === live.interruptedSessionId);
    // The interrupted window's rows exist (honest provenance) but never
    // carry the completion — OR the fresh window's ordinal-1 reset already
    // superseded them (both honest; the phase asserts the SERVED contract).
    if (interrupted !== undefined) {
      expect(interrupted.state === "recording").toBe(true);
    }
    const frameRows = db
      .query(
        "SELECT ordinal, frame_json FROM sporta_live_replay_frames WHERE session_id = ? ORDER BY ordinal",
      )
      .all(live.completedSessionId) as { ordinal: number; frame_json: string }[];
    expect(frameRows).toHaveLength(24);
    // The stored frames ARE the wire frames (byte-for-byte documents).
    expect(frameRows.map((row) => JSON.parse(row.frame_json))).toEqual(live.wireFrames);
    db.close();
  }, 240_000);
});
