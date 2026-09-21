import { describe, expect, test } from "bun:test";
import type { LiveReplayRecordDoc, LiveWorldFrameDoc } from "../src/lib/live-sse";
import {
  nextReplayCursor,
  replayContinuityFacts,
  replayContinuityVerdict,
} from "../src/lib/live-replay";
import { createSseLiveTransport } from "../src/server/live/transport";
import type { LiveScheduler, LiveSourceRegistration } from "../src/server/live/transport";

/**
 * THE LIVE REPLAY PRESENTATION LIB TESTS (L014, presentation side) — the
 * PURE continuity derivations the replay surface shows:
 *
 * - `replayContinuityVerdict` — the "state versions/timecodes remain
 *   aligned" acceptance as an assertable derivation over the RECORDED
 *   frames (aligned on a well-ordered record; each violation class caught
 *   with its specific honest line — never a bare boolean);
 * - `replayContinuityFacts` — the visible continuity facts (the version/
 *   timecode span, the final watermark, the honest accounting);
 * - `nextReplayCursor` — the pure cursor math (clamped stepping both
 *   directions).
 *
 * REAL-vs-FIXTURE: FIXTURE frame documents (hand-built, deterministic —
 * the wire shape the transport's replay route serves; the transport-level
 * and route-level batteries drive the REAL recordings end-to-end).
 */

/** A deterministic now (the transport's injected clock). */
const NOW_MS = 1_999_999_999_000;

/** Builds one recorded world frame (the wire shape, minimal honest fields). */
function frame(
  overrides: Partial<LiveWorldFrameDoc> & Pick<LiveWorldFrameDoc, "ordinal" | "worldVersion">,
): LiveWorldFrameDoc {
  const { ordinal, worldVersion, ...rest } = overrides;
  return {
    schemaVersion: "sporta.live-tactical/1",
    sessionId: "sess-l014-replay",
    eventTimeMs: ordinal * 100,
    watermark: {
      watermarkMs: (ordinal - 1) * 100,
      sequence: ordinal,
    },
    sourceSequence: ordinal,
    quality: "nominal",
    confidence: { min: 0.8, mean: 0.9 },
    entities: [],
    eventsSincePreviousFrame: [],
    generatedAtMs: 1_888_888_000_000 + ordinal,
    renderDurationMs: 1,
    telemetry: { watermarkLagMs: 0, undetectedEntities: 0, replayCycle: false },
    ...rest,
    ordinal,
    worldVersion,
  } as LiveWorldFrameDoc;
}

/** An aligned three-frame record (the happy continuity). */
function alignedRecord(): LiveReplayRecordDoc {
  return {
    schemaVersion: "sporta.live-replay/1",
    sessionId: "sess-l014-replay",
    state: "complete",
    frames: [
      frame({ ordinal: 1, worldVersion: 1 }),
      frame({ ordinal: 2, worldVersion: 2 }),
      frame({ ordinal: 3, worldVersion: 3 }),
    ],
    meta: {
      label: "the finite window",
      completedAtMs: 1_888_888_888_000,
      cadenceMs: 500,
      deliveredFrames: 3,
      droppedFrames: 0,
      worldVersionFirst: 1,
      worldVersionLast: 3,
      eventTimeFirstMs: 100,
      eventTimeLastMs: 300,
      watermarkFinal: { watermarkMs: 200, sequence: 3 },
    },
  };
}

describe("replayContinuityVerdict — the alignment derivation", () => {
  test("a well-ordered record is aligned (the acceptance, asserted)", () => {
    const verdict = replayContinuityVerdict(alignedRecord().frames);
    expect(verdict.aligned).toBe(true);
    expect(verdict.problems).toEqual([]);
  });

  test("an empty or single-frame record is trivially aligned", () => {
    expect(replayContinuityVerdict([]).aligned).toBe(true);
    expect(replayContinuityVerdict([frame({ ordinal: 1, worldVersion: 1 })]).aligned).toBe(true);
  });

  test("a non-advancing world version is caught with its specific line", () => {
    const frames = [frame({ ordinal: 1, worldVersion: 1 }), frame({ ordinal: 2, worldVersion: 1 })];
    const verdict = replayContinuityVerdict(frames);
    expect(verdict.aligned).toBe(false);
    expect(verdict.problems).toHaveLength(1);
    expect(verdict.problems[0]).toContain("world version 1 does not advance past 1");
  });

  test("a repeated ordinal is caught (the transport's own guarantee)", () => {
    const frames = [frame({ ordinal: 1, worldVersion: 1 }), frame({ ordinal: 1, worldVersion: 2 })];
    const verdict = replayContinuityVerdict(frames);
    expect(verdict.aligned).toBe(false);
    expect(verdict.problems.some((line) => line.includes("ordinal 1 does not advance"))).toBe(true);
  });

  test("a backwards event time is caught (never a re-stamped timeline)", () => {
    const frames = [
      frame({ ordinal: 1, worldVersion: 1, eventTimeMs: 500 }),
      frame({ ordinal: 2, worldVersion: 2, eventTimeMs: 400 }),
    ];
    const verdict = replayContinuityVerdict(frames);
    expect(verdict.aligned).toBe(false);
    expect(verdict.problems.some((line) => line.includes("event time 400ms went backwards"))).toBe(
      true,
    );
  });

  test("a backwards watermark (sequence or ms) is caught", () => {
    const frames = [
      frame({ ordinal: 1, worldVersion: 1, watermark: { watermarkMs: 100, sequence: 1 } }),
      frame({
        ordinal: 2,
        worldVersion: 2,
        watermark: { watermarkMs: 90, sequence: 0 },
      }),
    ];
    const verdict = replayContinuityVerdict(frames);
    expect(verdict.aligned).toBe(false);
    expect(
      verdict.problems.some((line) => line.includes("watermark sequence 0 went backwards")),
    ).toBe(true);
    expect(verdict.problems.some((line) => line.includes("watermark ms 90 went backwards"))).toBe(
      true,
    );
  });

  test("equal event times are aligned (non-decreasing, not strictly increasing)", () => {
    // A delay-scenario window may deliver equal event times back-to-back —
    // the frozen temporal rules demand NON-DECREASING, never fabrication.
    const frames = [
      frame({ ordinal: 1, worldVersion: 1, eventTimeMs: 400 }),
      frame({ ordinal: 2, worldVersion: 2, eventTimeMs: 400 }),
    ];
    expect(replayContinuityVerdict(frames).aligned).toBe(true);
  });
});

describe("replayContinuityFacts — the visible continuity projection", () => {
  test("the facts carry the recorded span verbatim (meta preferred, frames fallback)", () => {
    const facts = replayContinuityFacts(alignedRecord());
    expect(facts.frameCount).toBe(3);
    expect(facts.ordinalFirst).toBe(1);
    expect(facts.ordinalLast).toBe(3);
    expect(facts.worldVersionFirst).toBe(1);
    expect(facts.worldVersionLast).toBe(3);
    expect(facts.eventTimeFirstMs).toBe(100);
    expect(facts.eventTimeLastMs).toBe(300);
    expect(facts.watermarkFinal).toEqual({ watermarkMs: 200, sequence: 3 });
    expect(facts.cadenceMs).toBe(500);
    expect(facts.deliveredFrames).toBe(3);
    expect(facts.droppedFrames).toBe(0);
  });

  test("an empty record answers nulls honestly (never invented numbers)", () => {
    const facts = replayContinuityFacts({
      schemaVersion: "sporta.live-replay/1",
      sessionId: "sess-l014-replay",
      state: "no-record",
      frames: [],
    });
    expect(facts.frameCount).toBe(0);
    expect(facts.worldVersionFirst).toBeNull();
    expect(facts.worldVersionLast).toBeNull();
    expect(facts.watermarkFinal).toBeNull();
    expect(facts.cadenceMs).toBeNull();
  });

  test("the frames themselves answer when meta is absent", () => {
    const facts = replayContinuityFacts({
      schemaVersion: "sporta.live-replay/1",
      sessionId: "sess-l014-replay",
      state: "complete",
      frames: [frame({ ordinal: 4, worldVersion: 9, eventTimeMs: 700 })],
    });
    expect(facts.worldVersionFirst).toBe(9);
    expect(facts.worldVersionLast).toBe(9);
    expect(facts.eventTimeLastMs).toBe(700);
    expect(facts.ordinalLast).toBe(4);
  });
});

describe("nextReplayCursor — the pure stepping math", () => {
  test("steps forward and backward with clamping at both ends", () => {
    expect(nextReplayCursor(0, 5, 1)).toBe(1);
    expect(nextReplayCursor(4, 5, 1)).toBe(4); // clamped at the last frame
    expect(nextReplayCursor(0, 5, -1)).toBe(0); // clamped at the first frame
    expect(nextReplayCursor(3, 5, -2)).toBe(1);
    expect(nextReplayCursor(2, 5, 10)).toBe(4);
  });

  test("an empty record pins the cursor at 0; a malformed cursor resets", () => {
    expect(nextReplayCursor(3, 0, 1)).toBe(0);
    expect(nextReplayCursor(-2, 5, 1)).toBe(0);
    expect(nextReplayCursor(1.5, 5, 1)).toBe(0);
  });

  test("a zero delta seeks to the same index (clamped)", () => {
    expect(nextReplayCursor(2, 5, 0)).toBe(2);
    expect(nextReplayCursor(99, 5, 0)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// The transport's finite live window (L014 — window semantics + the record)
// ---------------------------------------------------------------------------

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
    label: "Synthetic live tracking — finite window (test)",
    storyKey: "live-tactical-synthetic",
    steps: [],
    policy: {
      policyId: "policy-l014-test",
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
      sourceNote: "the L014 finite-window tests",
      finiteWindow: true,
    },
  };
}

/** The same registration WITHOUT the finite flag (the L005 cycling default). */
function cyclingTacticalSource(sessionId: string): LiveSourceRegistration {
  const { tactical, ...rest } = finiteTacticalSource(sessionId, 4);
  const { finiteWindow: _finite, ...cyclingTactical } = tactical!;
  void _finite;
  return { ...rest, tactical: cyclingTactical };
}

describe("the transport's finite live window (L014)", () => {
  test("the window runs ONCE, ends with live-window-complete, and retains the record", async () => {
    const scheduler = manualScheduler();
    const transport = createSseLiveTransport({ active: true, nowMs: () => NOW_MS, scheduler });
    transport.registerSource(finiteTacticalSource("sess-l014-finite", 3));

    // Before ANY subscriber opens the channel: no-record (honest).
    expect(transport.replayRecord("sess-l014-finite")?.state).toBe("no-record");
    const subscriber = transport.subscribe("sess-l014-finite")!;

    // Mid-window: the record says the window is open (honest 409 posture).
    scheduler.fire();
    expect(transport.replayRecord("sess-l014-finite")?.state).toBe("live-window-open");
    scheduler.fire();
    scheduler.fire(); // the third tick exhausts the scripted window
    scheduler.fire(); // the NEXT tick ends the channel honestly

    // The terminal close with the window's own reason + accounting.
    const blocks: string[] = [];
    for (let read = 0; read < 5; read += 1) {
      const block = await subscriber.nextEvent();
      if (block === null) break;
      blocks.push(block);
    }
    expect(blocks.length).toBeGreaterThanOrEqual(4); // hello + 3 world + close
    const closeBlock = blocks[blocks.length - 1]!;
    expect(closeBlock).toContain("event: close");
    expect(closeBlock).toContain("live-window-complete");

    // The record: complete, with the recorded frames + the honest meta.
    const record = transport.replayRecord("sess-l014-finite")!;
    expect(record.state).toBe("complete");
    expect(record.frames).toHaveLength(3);
    expect(record.meta?.deliveredFrames).toBe(3);
    expect(record.meta?.droppedFrames).toBe(0);
    expect(record.meta?.worldVersionFirst).toBe(1);
    expect(record.meta?.worldVersionLast).toBe(3);
    // The recorded timeline is aligned (the continuity acceptance).
    expect(replayContinuityVerdict(record.frames).aligned).toBe(true);
    // The recorded frames carry the source's canonical semantics.
    for (const frame of record.frames) {
      expect(frame.sessionId).toBe("sess-l014-finite");
      expect(frame.entities.length).toBe(24); // 11 + 11 + ball + referee
      expect(frame.quality).toBe("nominal");
    }
    transport.closeAll();
  });

  test("subscribing to a COMPLETED window is refused (the record is the answer)", async () => {
    const scheduler = manualScheduler();
    const transport = createSseLiveTransport({ active: true, nowMs: () => NOW_MS, scheduler });
    transport.registerSource(finiteTacticalSource("sess-l014-closed", 1));
    const subscriber = transport.subscribe("sess-l014-closed")!;
    scheduler.fire();
    scheduler.fire(); // window exhausts + ends
    await subscriber.nextEvent(); // hello
    await subscriber.nextEvent(); // the one world frame
    await subscriber.nextEvent(); // the close
    expect(await subscriber.nextEvent()).toBeNull();
    expect(transport.replayRecord("sess-l014-closed")?.state).toBe("complete");
    // A NEW subscriber on the completed channel: refused (never a zombie
    // stream — the route answers the 410 + the replay pointer instead).
    expect(transport.subscribe("sess-l014-closed")).toBeNull();
    transport.closeAll();
  });

  test("a CYCLING source never records (replay is not its contract)", () => {
    const scheduler = manualScheduler();
    const transport = createSseLiveTransport({ active: true, nowMs: () => NOW_MS, scheduler });
    transport.registerSource(cyclingTacticalSource("sess-l014-cycling"));
    const subscriber = transport.subscribe("sess-l014-cycling")!;
    for (let tick = 0; tick < 8; tick += 1) scheduler.fire(); // past the window — it cycles
    expect(transport.replayRecord("sess-l014-cycling")?.state).toBe("no-record");
    subscriber.close();
    transport.closeAll();
  });

  test("an unregistered session answers null (the route's 404 posture)", () => {
    const transport = createSseLiveTransport({ active: true, nowMs: () => NOW_MS });
    expect(transport.replayRecord("no-such-session")).toBeNull();
  });

  test("a fresh window on a re-registered source restarts the record honestly", async () => {
    // removeSource ends the channel AND drops the record (the source is
    // gone); re-registering starts a fresh window — never a stale record.
    const scheduler = manualScheduler();
    const transport = createSseLiveTransport({ active: true, nowMs: () => NOW_MS, scheduler });
    const source = finiteTacticalSource("sess-l014-rerun", 2);
    transport.registerSource(source);
    const first = transport.subscribe("sess-l014-rerun")!;
    scheduler.fire();
    scheduler.fire();
    scheduler.fire(); // window completes
    await first.nextEvent(); // hello
    await first.nextEvent(); // frame 1
    await first.nextEvent(); // frame 2
    await first.nextEvent(); // close
    expect(transport.replayRecord("sess-l014-rerun")?.state).toBe("complete");
    transport.removeSource("sess-l014-rerun");
    expect(transport.replayRecord("sess-l014-rerun")).toBeNull();
    transport.registerSource(source);
    expect(transport.replayRecord("sess-l014-rerun")?.state).toBe("no-record");
    transport.closeAll();
  });
});
