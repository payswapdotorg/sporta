import { describe, expect, test } from "bun:test";
import { createSseLiveTransport } from "../src/server/live/transport";
import type { LiveScheduler, LiveSourceRegistration } from "../src/server/live/transport";
import { createSseParser, ssePayloadOf } from "../src/lib/live-sse";
import type { LiveCloseDoc, LiveFrameDoc, LiveHelloDoc } from "../src/lib/live-sse";
import { DERBY_STORY, SEED_POLICIES, runFixtureStory } from "../src/server/dev-story";

/**
 * LIVE TRANSPORT TESTS (W915) — the state machine, the channel lifecycle,
 * the bounded buffers, and the close semantics. The frames are REAL: the
 * test story runs through the REAL M1→M3 chain (`runFixtureStory`) and the
 * transport renders each tick through the REAL W502 anime renderer.
 */

/** A manual scheduler: tests fire ticks explicitly (deterministic cadence). */
function manualScheduler(): LiveScheduler & { fire(): void; active(): number } {
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
    active: () => timers.size,
  };
}

/** The REAL derby story run (the live source the dev seed registers). */
function derbySource(): LiveSourceRegistration {
  const run = runFixtureStory("sess-live-test", DERBY_STORY, () => 1_777_777_777_000);
  return {
    sessionId: "sess-live-test",
    label: "Derby night at Kings Park — test",
    storyKey: "derby",
    steps: run.steps,
    policy: SEED_POLICIES.derby,
    snapshotVersion: run.engine.snapshotVersion,
    watermarkSequence: run.engine.snapshot().watermark.sequence,
  };
}

/** Drains a subscriber until it yields N frame events (hello first). */
async function readEvents(
  subscriber: { nextEvent(): Promise<string | null> },
  frames: number,
): Promise<{ hello: LiveHelloDoc; frameDocs: LiveFrameDoc[] }> {
  const parser = createSseParser();
  const frameDocs: LiveFrameDoc[] = [];
  let hello: LiveHelloDoc | null = null;
  let remaining = frames;
  while (remaining >= 0) {
    const block = await subscriber.nextEvent();
    if (block === null) throw new Error("the subscriber ended early");
    for (const event of parser.write(block)) {
      if (event.event === "hello") hello = ssePayloadOf<LiveHelloDoc>(event);
      if (event.event === "frame") {
        frameDocs.push(ssePayloadOf<LiveFrameDoc>(event));
        remaining -= 1;
      }
    }
    if (remaining === 0) break;
  }
  if (hello === null) throw new Error("no hello event arrived");
  return { hello, frameDocs };
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

describe("the live transport state machine", () => {
  test("inactive: unavailable state, honest detail, sources hidden, subscribe refused", () => {
    const transport = createSseLiveTransport({ active: false, nowMs: () => 0 });
    transport.registerSource(derbySource());
    expect(transport.state()).toBe("unavailable");
    expect(transport.detail()).toContain("not configured");
    expect(transport.listSources()).toEqual([]); // never lists what it is not serving
    expect(transport.subscribe("sess-live-test")).toBeNull();
  });

  test("active: state active, the registered source is listed", () => {
    const transport = createSseLiveTransport({ active: true, nowMs: () => 0 });
    const source = derbySource();
    transport.registerSource(source);
    expect(transport.state()).toBe("active");
    expect(transport.listSources()).toHaveLength(1);
    expect(transport.listSources()[0]!.sessionId).toBe("sess-live-test");
  });

  test("subscribe on an unregistered session answers null (the route maps it honestly)", () => {
    const transport = createSseLiveTransport({ active: true, nowMs: () => 0 });
    expect(transport.subscribe("no-such-session")).toBeNull();
    expect(transport.status("no-such-session")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The channel lifecycle + real frames
// ---------------------------------------------------------------------------

describe("the live channel", () => {
  test("the FIRST subscriber starts the tick loop; the LAST leave stops it", () => {
    const scheduler = manualScheduler();
    const transport = createSseLiveTransport({ active: true, nowMs: () => 1_000, scheduler });
    transport.registerSource(derbySource());
    expect(scheduler.active()).toBe(0);

    const first = transport.subscribe("sess-live-test")!;
    expect(scheduler.active()).toBe(1); // ticking
    const second = transport.subscribe("sess-live-test")!;
    expect(scheduler.active()).toBe(1); // ONE channel loop, not two

    first.close();
    expect(scheduler.active()).toBe(1); // still serving the second
    second.close();
    expect(scheduler.active()).toBe(0); // the loop stopped — no orphaned generation

    const third = transport.subscribe("sess-live-test")!;
    expect(scheduler.active()).toBe(1); // reopening restarts it
    third.close();
  });

  test("each tick is a REAL render: complete SVG frames with real timestamps", async () => {
    const scheduler = manualScheduler();
    const clock = 5_000;
    const transport = createSseLiveTransport({ active: true, nowMs: () => clock, scheduler });
    transport.registerSource(derbySource());
    const subscriber = transport.subscribe("sess-live-test")!;

    scheduler.fire();
    scheduler.fire();
    scheduler.fire();
    const { hello, frameDocs } = await readEvents(subscriber, 3);
    expect(hello.sessionId).toBe("sess-live-test");
    expect(hello.storyKey).toBe("derby");
    expect(hello.schemaVersion).toBe("sporta.live-sse/1");

    expect(frameDocs.map((frame) => frame.ordinal)).toEqual([1, 2, 3]);
    // The story timeline advances per tick then cycles (the fixture has 6 waves).
    expect(frameDocs.map((frame) => frame.storyStepIndex)).toEqual([0, 1, 2]);
    for (const frame of frameDocs) {
      expect(frame.svg.trimStart().startsWith("<svg")).toBe(true);
      expect(frame.svg).toContain("http://www.w3.org/2000/svg");
      expect(frame.byteLength).toBe(frame.svg.length);
      expect(frame.generatedAtMs).toBe(clock); // the injected clock read after the render
    }
    // Distinct steps really render distinct frames (fresh generation, not replay).
    expect(frameDocs[0]!.svg).not.toBe(frameDocs[1]!.svg);
    subscriber.close();
  });

  test("the status answers the channel's honest counters", async () => {
    const scheduler = manualScheduler();
    const transport = createSseLiveTransport({ active: true, nowMs: () => 1_000, scheduler });
    transport.registerSource(derbySource());
    const subscriber = transport.subscribe("sess-live-test")!;

    const before = transport.status("sess-live-test")!;
    expect(before.subscribers).toBe(1);
    expect(before.framesEmitted).toBe(0);
    expect(before.lastFrameAtMs).toBeNull();

    scheduler.fire();
    const after = transport.status("sess-live-test")!;
    expect(after.framesEmitted).toBe(1);
    expect(after.lastFrameAtMs).toBe(1_000);
    subscriber.close();
  });
});

// ---------------------------------------------------------------------------
// Bounded buffers (drop-oldest, counted)
// ---------------------------------------------------------------------------

describe("the bounded subscriber buffer", () => {
  test("overflow drops the OLDEST block and COUNTS the loss (visible ordinals)", async () => {
    const scheduler = manualScheduler();
    const transport = createSseLiveTransport({
      active: true,
      nowMs: () => 1_000,
      scheduler,
      bufferDepth: 2,
    });
    transport.registerSource(derbySource());
    const subscriber = transport.subscribe("sess-live-test")!;

    // Fire 5 ticks without pulling: the buffer keeps the LAST 2 frames.
    for (let i = 0; i < 5; i += 1) scheduler.fire();
    const { frameDocs } = await readEvents(subscriber, 2);
    expect(frameDocs.map((frame) => frame.ordinal)).toEqual([4, 5]); // the newest survive
    expect(subscriber.stats().droppedFrames).toBe(3); // 1, 2, 3 — counted, never silent
    expect(transport.status("sess-live-test")!.droppedFrames).toBe(3);
    subscriber.close();
  });
});

// ---------------------------------------------------------------------------
// Close semantics
// ---------------------------------------------------------------------------

describe("close semantics", () => {
  test("subscriber.close() is idempotent and ends only THAT subscriber", async () => {
    const scheduler = manualScheduler();
    const transport = createSseLiveTransport({ active: true, nowMs: () => 1_000, scheduler });
    transport.registerSource(derbySource());
    const one = transport.subscribe("sess-live-test")!;
    const two = transport.subscribe("sess-live-test")!;

    one.close();
    one.close(); // idempotent
    expect(transport.status("sess-live-test")!.subscribers).toBe(1);

    scheduler.fire();
    const { frameDocs } = await readEvents(two, 1);
    expect(frameDocs).toHaveLength(1);
    two.close();
  });

  test("closeAll() ends every channel with the terminal close event + accounting", async () => {
    const scheduler = manualScheduler();
    const transport = createSseLiveTransport({ active: true, nowMs: () => 1_000, scheduler });
    transport.registerSource(derbySource());
    const subscriber = transport.subscribe("sess-live-test")!;
    scheduler.fire();
    scheduler.fire();

    const parser = createSseParser();
    const blocks: string[] = [];
    transport.closeAll();
    // hello + the 2 frames + the terminal close block.
    for (let i = 0; i < 4; i += 1) {
      const block = await subscriber.nextEvent();
      if (block === null) break;
      blocks.push(block);
    }
    const events = blocks.flatMap((block) => parser.write(block));
    const close = events.find((event) => event.event === "close");
    expect(close).toBeDefined();
    expect(ssePayloadOf<LiveCloseDoc>(close!)).toMatchObject({
      reason: "transport-closed",
      deliveredFrames: 2,
    });
    // The stream is terminally ended.
    expect(await subscriber.nextEvent()).toBeNull();
    expect(scheduler.active()).toBe(0);
  });

  test("removeSource() ends its channel with the source-removed reason", async () => {
    const scheduler = manualScheduler();
    const transport = createSseLiveTransport({ active: true, nowMs: () => 1_000, scheduler });
    transport.registerSource(derbySource());
    const subscriber = transport.subscribe("sess-live-test")!;
    transport.removeSource("sess-live-test");
    const parser = createSseParser();
    const blocks: string[] = [];
    // hello + the terminal close block.
    for (let i = 0; i < 2; i += 1) {
      const block = await subscriber.nextEvent();
      if (block === null) break;
      blocks.push(block);
    }
    const events = blocks.flatMap((block) => parser.write(block));
    const close = events.find((event) => event.event === "close");
    expect(ssePayloadOf<LiveCloseDoc>(close!).reason).toBe("source-removed");
    expect(transport.subscribe("sess-live-test")).toBeNull(); // the source is gone
  });
});
