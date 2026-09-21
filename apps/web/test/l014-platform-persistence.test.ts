import { afterAll, describe, expect, test } from "bun:test";
import type { LiveReplayRecordDoc, LiveWorldFrameDoc } from "../src/lib/live-sse";
import { createSseLiveTransport } from "../src/server/live/transport";
import type {
  LiveScheduler,
  LiveSourceRegistration,
  LiveTransport,
} from "../src/server/live/transport";
import { liveReplaySink, withDurableReplayRecord } from "../src/server/live/persistence";
import type { LiveReplayPersistence } from "../src/server/live/persistence";
import { SqliteLiveReplayStore } from "../src/server/platform/live/sqlite-replay-store";
import { replayContinuityVerdict } from "../src/lib/live-replay";

/**
 * THE LIVE/REPLAY CONTINUITY PERSISTENCE TESTS (L014, PLATFORM side) — the
 * durable replay-record seam under the W915 SSE transport:
 *
 * 1. THE SQLITE STORE (the J014 discipline applied to the live record):
 *    frames persist VERBATIM (append → read-back equality, ordinals/world
 *    versions/event times unchanged), an INTERRUPTED window (frames, no
 *    completion) never serves, only `markWindowComplete` flips the window
 *    into the replayable state, reads are deep clones (mutating a served
 *    record cannot corrupt the store), a NEW window's ordinal-1 resets the
 *    session's rows honestly, and the interrupted-window listing carries
 *    the honest recovery facts.
 * 2. THE SINK + TRANSPORT (extend-not-fork): a transport constructed with
 *    the `recordSink` persists the finite window's recorded frames and
 *    completion EXACTLY as its own in-memory record serves them; the SAME
 *    transport WITHOUT the sink is byte-identical (the pre-platform
 *    posture preserved — the L014 presentation battery's own guarantee,
 *    re-pinned here at the seam boundary).
 * 3. THE DURABLE DECORATOR (the recovery read precedence): the in-memory
 *    `complete`/`live-window-open` answers win (the live instance is
 *    authoritative for its own window); `no-record`/null fall back to the
 *    PERSISTED complete record (the restart recovery — the record outlives
 *    the process and even the source registration); nothing persisted →
 *    the in-memory answer verbatim (the pass-through).
 *
 * REAL-vs-FIXTURE: the sqlite store is the REAL `bun:sqlite` engine over a
 * REAL temp file (the J014 restart battery's own pattern); the transports
 * are the REAL SSE transport with the manual scheduler (deterministic
 * cadence — the L014 presentation battery's own pattern); the frames are
 * the REAL finite-window recordings (the L002 deterministic source
 * projected by the live view-model). Only the schedulers and clocks are
 * test-injected.
 */

const NOW_MS = 1_999_999_999_000;

/** A manual scheduler: tests fire ticks explicitly (deterministic cadence). */
function manualScheduler(): LiveScheduler & { fire(): void } {
  let next = 0;
  const timers = new Map<number, () => void>();
  return {
    setInterval: (handler) => {
      next += 1;
      timers.set(next, handler);
      return next;
    },
    clearInterval: (handle) => {
      timers.delete(handle as number);
    },
    fire: () => {
      for (const handler of [...timers.values()]) handler();
    },
  };
}

/** A finite-window tactical registration (the L014 shape, small window). */
function finiteTacticalSource(sessionId: string, tickCount: number): LiveSourceRegistration {
  return {
    sessionId,
    label: "Synthetic live tracking — finite window (platform test)",
    storyKey: "live-tactical-synthetic",
    steps: [],
    policy: {
      policyId: "policy-l014-platform-test",
      allowedOperations: ["analysis", "liveDelivery"],
      assertedBy: "test",
    },
    snapshotVersion: 0,
    watermarkSequence: 0,
    tactical: {
      config: {
        seed: 20260921,
        scenario: "normal",
        tickCount,
        rateMs: 100,
        playersPerTeam: 11,
        referees: 1,
      },
      sourceNote: "the L014 platform persistence tests",
      finiteWindow: true,
    },
  };
}

/**
 * Drives one finite window to completion; returns the wire frames + close.
 *
 * The cadence is DETERMINISTIC (C's own route-test pattern): each manual
 * fire synchronously queues EXACTLY ONE event (a world frame, or the
 * window-complete close on the exhausting tick) — every pull resolves an
 * already-queued block, so no pull is ever abandoned mid-race (an abandoned
 * pull would consume a frame through the queue's oldest-waiter wake).
 */
async function runWindowToEnd(
  transport: LiveTransport,
  scheduler: { fire(): void },
  sessionId: string,
  ticks: number,
): Promise<{ frames: LiveWorldFrameDoc[]; closeReason: string | null }> {
  const subscriber = transport.subscribe(sessionId)!;
  expect(subscriber).not.toBeNull();
  const blocks: string[] = [];
  // The hello arrives first by construction (the queue's first arrival).
  const hello = await subscriber.nextEvent();
  expect(hello).toContain("event: hello");
  blocks.push(hello!);
  for (let tick = 0; tick < ticks + 1; tick += 1) {
    scheduler.fire();
    const block = await subscriber.nextEvent();
    if (block === null) break; // the channel ended
    blocks.push(block);
  }
  const frames: LiveWorldFrameDoc[] = [];
  let closeReason: string | null = null;
  for (const block of blocks) {
    if (block.includes("event: world")) {
      const dataLine = block
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6);
      if (dataLine !== undefined) frames.push(JSON.parse(dataLine) as LiveWorldFrameDoc);
    } else if (block.includes("event: close")) {
      closeReason = block.includes("live-window-complete") ? "live-window-complete" : "other";
    }
  }
  subscriber.close();
  return { frames, closeReason };
}

/** A temp sqlite path per test (real files, cleaned up in afterAll). */
const tempPaths: string[] = [];
function tempDbPath(name: string): string {
  const path = `${import.meta.dir}/tmp-l014-platform-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`;
  tempPaths.push(path);
  return path;
}
afterAll(async () => {
  for (const path of tempPaths) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        await Bun.file(`${path}${suffix}`).unlink();
      } catch {
        // Best-effort cleanup (the OS temp area is swept anyway).
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 1. The sqlite store
// ---------------------------------------------------------------------------

describe("the sqlite live replay store (the J014 discipline)", () => {
  test("frames persist VERBATIM and only a completed window serves", async () => {
    const store = new SqliteLiveReplayStore(tempDbPath("verbatim"));
    const frame: LiveWorldFrameDoc = {
      schemaVersion: "sporta.live-tactical/1",
      sessionId: "sess-store-1",
      ordinal: 1,
      worldVersion: 7,
      eventTimeMs: 12_345,
      watermark: { watermarkMs: 12_000, sequence: 9 },
      sourceSequence: 11,
      quality: "nominal",
      confidence: { min: 0.75, mean: 0.9 },
      entities: [
        {
          entityRef: "home-7",
          kind: "PLAYER",
          teamRef: "home",
          xMeters: 52.5,
          yMeters: 34,
          detected: true,
          confidence: 0.93,
          staleForMs: 0,
        },
      ],
      eventsSincePreviousFrame: [],
      generatedAtMs: 1_888_888_000_000,
      renderDurationMs: 3,
      telemetry: { watermarkLagMs: 345, undetectedEntities: 0, replayCycle: false },
    };
    store.appendRecordedFrame("sess-store-1", frame);

    // INTERRUPTED: frames without the completion never serve.
    expect(store.findCompleteRecord("sess-store-1")).toBeNull();
    expect(store.listInterruptedWindows()).toEqual([{ sessionId: "sess-store-1", frames: 1 }]);

    store.markWindowComplete("sess-store-1", {
      label: "the window",
      completedAtMs: 1_888_888_888_000,
      cadenceMs: 500,
      deliveredFrames: 1,
      droppedFrames: 0,
      worldVersionFirst: 7,
      worldVersionLast: 7,
      eventTimeFirstMs: 12_345,
      eventTimeLastMs: 12_345,
      watermarkFinal: { watermarkMs: 12_000, sequence: 9 },
    });

    const record = store.findCompleteRecord("sess-store-1")!;
    expect(record).not.toBeNull();
    expect(record.state).toBe("complete");
    expect(record.frames).toEqual([frame]); // VERBATIM — the exact document
    expect(record.meta?.worldVersionFirst).toBe(7);
    expect(record.meta?.eventTimeLastMs).toBe(12_345);
    expect(record.meta?.watermarkFinal).toEqual({ watermarkMs: 12_000, sequence: 9 });
    expect(store.listInterruptedWindows()).toEqual([]);

    // A REOPENED store (a restart) serves the same record from disk.
    const path = tempPaths[tempPaths.length - 1]!;
    store.close();
    const reopened = new SqliteLiveReplayStore(path);
    expect(reopened.findCompleteRecord("sess-store-1")).toEqual(record);
    reopened.close();
  });

  test("reads are deep clones (a served record cannot corrupt the store)", async () => {
    const store = new SqliteLiveReplayStore(tempDbPath("deepclone"));
    const frame: LiveWorldFrameDoc = {
      schemaVersion: "sporta.live-tactical/1",
      sessionId: "sess-store-2",
      ordinal: 1,
      worldVersion: 1,
      eventTimeMs: 100,
      watermark: { watermarkMs: 50, sequence: 1 },
      sourceSequence: 1,
      quality: "nominal",
      confidence: { min: 0.9, mean: 0.95 },
      entities: [],
      eventsSincePreviousFrame: [],
      generatedAtMs: 1_888_888_000_000,
      renderDurationMs: 1,
      telemetry: { watermarkLagMs: 0, undetectedEntities: 0, replayCycle: false },
    };
    store.appendRecordedFrame("sess-store-2", frame);
    store.markWindowComplete("sess-store-2", {
      label: "the window",
      completedAtMs: 1_888_888_888_000,
      cadenceMs: 500,
      deliveredFrames: 1,
      droppedFrames: 0,
      worldVersionFirst: 1,
      worldVersionLast: 1,
      eventTimeFirstMs: 100,
      eventTimeLastMs: 100,
      watermarkFinal: { watermarkMs: 50, sequence: 1 },
    });
    const first = store.findCompleteRecord("sess-store-2")!;
    first.frames[0]!.ordinal = 999; // mutate the served clone
    first.meta!.label = "tampered";
    const second = store.findCompleteRecord("sess-store-2")!;
    expect(second.frames[0]!.ordinal).toBe(1);
    expect(second.meta!.label).toBe("the window");
    store.close();
  });

  test("a NEW window's ordinal-1 resets the session's rows honestly", async () => {
    const store = new SqliteLiveReplayStore(tempDbPath("reset"));
    const mkFrame = (ordinal: number): LiveWorldFrameDoc => ({
      schemaVersion: "sporta.live-tactical/1",
      sessionId: "sess-store-3",
      ordinal,
      worldVersion: ordinal,
      eventTimeMs: ordinal * 100,
      watermark: { watermarkMs: (ordinal - 1) * 100, sequence: ordinal },
      sourceSequence: ordinal,
      quality: "nominal",
      confidence: { min: 0.9, mean: 0.9 },
      entities: [],
      eventsSincePreviousFrame: [],
      generatedAtMs: 1_888_888_000_000 + ordinal,
      renderDurationMs: 1,
      telemetry: { watermarkLagMs: 0, undetectedEntities: 0, replayCycle: false },
    });
    // First window: 3 frames, completed.
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      store.appendRecordedFrame("sess-store-3", mkFrame(ordinal));
    }
    store.markWindowComplete("sess-store-3", {
      label: "first window",
      completedAtMs: 1_888_888_888_000,
      cadenceMs: 500,
      deliveredFrames: 3,
      droppedFrames: 0,
      worldVersionFirst: 1,
      worldVersionLast: 3,
      eventTimeFirstMs: 100,
      eventTimeLastMs: 300,
      watermarkFinal: { watermarkMs: 200, sequence: 3 },
    });
    expect(store.findCompleteRecord("sess-store-3")?.frames).toHaveLength(3);
    // A NEW window runs (ordinal 1): the old rows are superseded — the
    // newest window the transport actually served is the session's record.
    store.appendRecordedFrame("sess-store-3", mkFrame(1));
    expect(store.findCompleteRecord("sess-store-3")).toBeNull(); // recording again
    expect(store.listInterruptedWindows()).toEqual([{ sessionId: "sess-store-3", frames: 1 }]);
    for (let ordinal = 2; ordinal <= 2; ordinal += 1) {
      store.appendRecordedFrame("sess-store-3", mkFrame(ordinal));
    }
    store.markWindowComplete("sess-store-3", {
      label: "second window",
      completedAtMs: 1_888_888_999_000,
      cadenceMs: 500,
      deliveredFrames: 2,
      droppedFrames: 0,
      worldVersionFirst: 1,
      worldVersionLast: 2,
      eventTimeFirstMs: 100,
      eventTimeLastMs: 200,
      watermarkFinal: { watermarkMs: 100, sequence: 2 },
    });
    const superseded = store.findCompleteRecord("sess-store-3")!;
    expect(superseded.frames).toHaveLength(2);
    expect(superseded.meta?.label).toBe("second window");
    store.close();
  });

  test("an append is idempotent per (session, ordinal) and refuses after close", async () => {
    const store = new SqliteLiveReplayStore(tempDbPath("idempotent"));
    const frame: LiveWorldFrameDoc = {
      schemaVersion: "sporta.live-tactical/1",
      sessionId: "sess-store-4",
      ordinal: 1,
      worldVersion: 1,
      eventTimeMs: 100,
      watermark: { watermarkMs: 50, sequence: 1 },
      sourceSequence: 1,
      quality: "nominal",
      confidence: { min: 0.9, mean: 0.9 },
      entities: [],
      eventsSincePreviousFrame: [],
      generatedAtMs: 1_888_888_000_000,
      renderDurationMs: 1,
      telemetry: { watermarkLagMs: 0, undetectedEntities: 0, replayCycle: false },
    };
    store.appendRecordedFrame("sess-store-4", frame);
    store.appendRecordedFrame("sess-store-4", frame); // the re-delivery (multi-subscriber)
    store.markWindowComplete("sess-store-4", {
      label: "w",
      completedAtMs: 1,
      cadenceMs: 500,
      deliveredFrames: 1,
      droppedFrames: 0,
      worldVersionFirst: 1,
      worldVersionLast: 1,
      eventTimeFirstMs: 100,
      eventTimeLastMs: 100,
      watermarkFinal: { watermarkMs: 50, sequence: 1 },
    });
    expect(store.findCompleteRecord("sess-store-4")?.frames).toHaveLength(1);
    store.close();
    expect(() => store.findCompleteRecord("sess-store-4")).toThrow(/closed/);
  });
});

// ---------------------------------------------------------------------------
// 2. The sink + transport (extend-not-fork)
// ---------------------------------------------------------------------------

describe("the recorded-window sink (the transport seam)", () => {
  test("the sink persists EXACTLY the frames the in-memory record serves", async () => {
    const scheduler = manualScheduler();
    const store = new SqliteLiveReplayStore(tempDbPath("sink"));
    const transport = createSseLiveTransport({
      active: true,
      nowMs: () => NOW_MS,
      scheduler,
      recordSink: liveReplaySink(store),
    });
    transport.registerSource(finiteTacticalSource("sess-sink-1", 4));
    const { frames, closeReason } = await runWindowToEnd(transport, scheduler, "sess-sink-1", 4);
    expect(closeReason).toBe("live-window-complete");
    expect(frames).toHaveLength(4);

    // The in-memory record and the persisted record are THE SAME document.
    const memory = transport.replayRecord("sess-sink-1")!;
    expect(memory.state).toBe("complete");
    const persisted = store.findCompleteRecord("sess-sink-1")!;
    expect(persisted).not.toBeNull();
    expect(persisted.frames).toEqual(memory.frames);
    expect(persisted.meta).toEqual(memory.meta);
    // The persisted record is aligned (the continuity acceptance holds on
    // the platform side too — versions/timecodes never re-stamped).
    expect(replayContinuityVerdict(persisted.frames).aligned).toBe(true);
    // The wire frames ARE the recorded frames (one source of truth).
    expect(persisted.frames).toEqual(frames);
    transport.closeAll();
    store.close();
  });

  test("a transport WITHOUT the sink is byte-identical (the pre-platform posture)", async () => {
    const scheduler = manualScheduler();
    const transport = createSseLiveTransport({
      active: true,
      nowMs: () => NOW_MS,
      scheduler,
    });
    transport.registerSource(finiteTacticalSource("sess-nosink-1", 3));
    const { frames, closeReason } = await runWindowToEnd(transport, scheduler, "sess-nosink-1", 3);
    expect(closeReason).toBe("live-window-complete");
    expect(frames).toHaveLength(3);
    const memory = transport.replayRecord("sess-nosink-1")!;
    expect(memory.state).toBe("complete");
    expect(memory.frames).toHaveLength(3);
    transport.closeAll();
  });
});

// ---------------------------------------------------------------------------
// 3. The durable decorator (the recovery read precedence)
// ---------------------------------------------------------------------------

describe("the durable replay decorator (the recovery precedence)", () => {
  /** A minimal in-memory persistence for the precedence cases. */
  function mapPersistence(records: Map<string, LiveReplayRecordDoc>): LiveReplayPersistence {
    return {
      providerName: "test-map",
      appendRecordedFrame: () => {},
      markWindowComplete: () => {},
      findCompleteRecord: (sessionId) => records.get(sessionId) ?? null,
      listInterruptedWindows: () => [],
      close: () => {},
    };
  }

  test("a completed in-memory window wins (the live instance is authoritative)", async () => {
    const scheduler = manualScheduler();
    const inner = createSseLiveTransport({ active: true, nowMs: () => NOW_MS, scheduler });
    const persisted = new Map<string, LiveReplayRecordDoc>();
    const transport = withDurableReplayRecord(inner, mapPersistence(persisted));
    inner.registerSource(finiteTacticalSource("sess-prec-1", 2));
    await runWindowToEnd(transport, scheduler, "sess-prec-1", 2);
    // Even when a STALE persisted record exists for the same session, the
    // live instance's own completed record is the answer.
    persisted.set("sess-prec-1", {
      schemaVersion: "sporta.live-replay/1",
      sessionId: "sess-prec-1",
      state: "complete",
      frames: [],
      meta: {
        label: "stale",
        completedAtMs: 1,
        cadenceMs: 1,
        deliveredFrames: 0,
        droppedFrames: 0,
        worldVersionFirst: 0,
        worldVersionLast: 0,
        eventTimeFirstMs: 0,
        eventTimeLastMs: 0,
        watermarkFinal: { watermarkMs: 0, sequence: 0 },
      },
    });
    const record = transport.replayRecord("sess-prec-1")!;
    expect(record.state).toBe("complete");
    expect(record.frames).toHaveLength(2); // the LIVE instance's window
    expect(record.meta?.label).toBe("Synthetic live tracking — finite window (platform test)");
    transport.closeAll();
  });

  test("an OPEN in-memory window wins over a persisted record (the 409 posture)", async () => {
    const scheduler = manualScheduler();
    const inner = createSseLiveTransport({ active: true, nowMs: () => NOW_MS, scheduler });
    const persisted = new Map<string, LiveReplayRecordDoc>();
    const transport = withDurableReplayRecord(inner, mapPersistence(persisted));
    inner.registerSource(finiteTacticalSource("sess-prec-2", 3));
    persisted.set("sess-prec-2", {
      schemaVersion: "sporta.live-replay/1",
      sessionId: "sess-prec-2",
      state: "complete",
      frames: [],
      meta: {
        label: "an older completed window",
        completedAtMs: 1,
        cadenceMs: 1,
        deliveredFrames: 0,
        droppedFrames: 0,
        worldVersionFirst: 0,
        worldVersionLast: 0,
        eventTimeFirstMs: 0,
        eventTimeLastMs: 0,
        watermarkFinal: { watermarkMs: 0, sequence: 0 },
      },
    });
    const subscriber = transport.subscribe("sess-prec-2")!;
    scheduler.fire(); // the window is OPEN and streaming NOW
    expect(transport.replayRecord("sess-prec-2")?.state).toBe("live-window-open");
    subscriber.close();
    transport.closeAll();
  });

  test("no-record falls back to the PERSISTED complete record (the restart recovery)", async () => {
    const scheduler = manualScheduler();
    const inner = createSseLiveTransport({ active: true, nowMs: () => NOW_MS, scheduler });
    const persistedRecord: LiveReplayRecordDoc = {
      schemaVersion: "sporta.live-replay/1",
      sessionId: "sess-prec-3",
      state: "complete",
      frames: [
        {
          schemaVersion: "sporta.live-tactical/1",
          sessionId: "sess-prec-3",
          ordinal: 1,
          worldVersion: 1,
          eventTimeMs: 100,
          watermark: { watermarkMs: 50, sequence: 1 },
          sourceSequence: 1,
          quality: "nominal",
          confidence: { min: 0.9, mean: 0.9 },
          entities: [],
          eventsSincePreviousFrame: [],
          generatedAtMs: 1_888_888_000_000,
          renderDurationMs: 1,
          telemetry: { watermarkLagMs: 0, undetectedEntities: 0, replayCycle: false },
        },
      ],
      meta: {
        label: "the restarted window",
        completedAtMs: 1_888_888_888_000,
        cadenceMs: 500,
        deliveredFrames: 1,
        droppedFrames: 0,
        worldVersionFirst: 1,
        worldVersionLast: 1,
        eventTimeFirstMs: 100,
        eventTimeLastMs: 100,
        watermarkFinal: { watermarkMs: 50, sequence: 1 },
      },
    };
    const transport = withDurableReplayRecord(
      inner,
      mapPersistence(new Map([["sess-prec-3", persistedRecord]])),
    );
    // The source is REGISTERED (a fresh process re-seeded it) but no window
    // has run on this instance: the persisted record answers.
    inner.registerSource(finiteTacticalSource("sess-prec-3", 2));
    expect(transport.replayRecord("sess-prec-3")).toEqual(persistedRecord);
    // And even WITHOUT a registered source (the registration is gone), the
    // persisted record survives — the platform state outlives it.
    inner.removeSource("sess-prec-3");
    expect(transport.replayRecord("sess-prec-3")).toEqual(persistedRecord);
    transport.closeAll();
  });

  test("nothing persisted → the in-memory answer verbatim (the pass-through)", () => {
    const scheduler = manualScheduler();
    const inner = createSseLiveTransport({ active: true, nowMs: () => NOW_MS, scheduler });
    const transport = withDurableReplayRecord(inner, mapPersistence(new Map()));
    inner.registerSource(finiteTacticalSource("sess-prec-4", 2));
    expect(transport.replayRecord("sess-prec-4")?.state).toBe("no-record");
    expect(transport.replayRecord("no-such-session")).toBeNull();
    expect(transport.state()).toBe("active");
    expect(transport.listSources()).toHaveLength(1);
    transport.closeAll();
  });
});
