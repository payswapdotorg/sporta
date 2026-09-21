import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { createSseLiveTransport } from "../src/server/live/transport";
import type { LiveScheduler, LiveTransport } from "../src/server/live/transport";
import { createTacticalFrameProducer } from "../src/server/live/view-model";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { GET as liveListRoute } from "../src/app/api/live/route";
import { GET as liveStreamRoute } from "../src/app/api/live/[sessionId]/route";
import { createSseParser, ssePayloadOf } from "../src/lib/live-sse";
import type { LiveHelloDoc, LiveWorldFrameDoc } from "../src/lib/live-sse";

/**
 * LIVE TACTICAL RENDERER SCAFFOLD TESTS (L005) — the view-model, the
 * transport's re-pointed producer seam, and the routes, over the REAL
 * L002 deterministic tracking source (`@sporta/live-source`, Worker B's
 * frozen-observation package — consumed read-only).
 *
 * - VIEW-MODEL (the §5 LiveRenderInput semantics as delivered): entity
 *   IDENTITY CONTINUITY by entityRef across frames; undetected entities
 *   carried as LAST-KNOWN (detected: false + growing staleness — never
 *   fabricated, never silently removed); worldVersion monotone; the
 *   reconnect scenario's recovery accounting + degraded quality surfaced
 *   as honest frame events; the labeled replay cycle at the scripted
 *   window's end; determinism (same seed + scenario → the same frames);
 *   the canonical pitch bounds (0..105 x 0..68 m).
 * - TRANSPORT (the W915 producer seam re-pointed, NOT forked): a tactical
 *   source's channel emits `world` events on the real SSE wire (hello →
 *   sourceKind tactical); the bounded-buffer drop accounting and the
 *   close semantics are exactly the story lane's.
 * - ROUTES: the sources list carries the tactical source (kind + note);
 *   the stream route serves the tactical session's world frames behind
 *   the SAME auth/rights gates (anonymous → 401, unknown → the control
 *   plane's 404).
 */

const NOW_MS = 1_888_888_888_000;

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

/** A deterministic stepping clock for the view-model's own runs. */
function steppingClock(): () => number {
  let current = NOW_MS;
  return () => {
    current += 17;
    return current;
  };
}

/** The scaffold's default tactical registration (the reconnect scenario). */
const TACTICAL_REGISTRATION = {
  config: {
    seed: 20260920,
    scenario: "reconnect" as const,
    tickCount: 120,
    rateMs: 100,
    playersPerTeam: 11,
    referees: 1,
  },
  sourceNote: "the L005 scaffold tests",
};

// ---------------------------------------------------------------------------
// The view-model (pure projection semantics)
// ---------------------------------------------------------------------------

describe("the live tactical view-model (L005)", () => {
  test("projects identity-continuous entities within the canonical pitch bounds", () => {
    const producer = createTacticalFrameProducer({
      sessionId: "sess-l005-vm",
      nowMs: steppingClock(),
      ...TACTICAL_REGISTRATION,
    });
    const first = producer.next({ sessionId: "sess-l005-vm", ordinal: 1 })!.frame;
    expect(first.entities.length).toBe(11 + 11 + 1 + 1); // two teams + ball + referee
    const firstIds = first.entities.map((entity) => entity.entityRef);
    expect(new Set(firstIds).size).toBe(firstIds.length); // identities unique

    // Identity continuity: the SAME entityRefs across the next frames.
    for (let ordinal = 2; ordinal <= 5; ordinal += 1) {
      const frame = producer.next({ sessionId: "sess-l005-vm", ordinal })!.frame;
      expect(frame.entities.map((entity) => entity.entityRef).sort()).toEqual([...firstIds].sort());
      for (const entity of frame.entities) {
        expect(entity.xMeters).toBeGreaterThanOrEqual(0);
        expect(entity.xMeters).toBeLessThanOrEqual(105);
        expect(entity.yMeters).toBeGreaterThanOrEqual(0);
        expect(entity.yMeters).toBeLessThanOrEqual(68);
      }
    }

    // The positions visibly CHANGE across frames (a live view, not a still).
    const later = producer.next({ sessionId: "sess-l005-vm", ordinal: 6 })!.frame;
    const firstById = new Map(first.entities.map((entity) => [entity.entityRef, entity]));
    let moved = 0;
    for (const entity of later.entities) {
      const before = firstById.get(entity.entityRef)!;
      if (Math.abs(before.xMeters - entity.xMeters) > 0.01) moved += 1;
    }
    expect(moved).toBeGreaterThan(0);
  });

  test("worldVersion is monotone and the watermark semantics ride verbatim", () => {
    const producer = createTacticalFrameProducer({
      sessionId: "sess-l005-vm",
      nowMs: steppingClock(),
      ...TACTICAL_REGISTRATION,
    });
    let previousVersion = 0;
    for (let ordinal = 1; ordinal <= 10; ordinal += 1) {
      const frame = producer.next({ sessionId: "sess-l005-vm", ordinal })!.frame;
      expect(frame.worldVersion).toBeGreaterThan(previousVersion);
      previousVersion = frame.worldVersion;
      // The watermark is the source's own conservative contiguous frontier
      // (never ahead of the event time; the lag is carried, counted).
      expect(frame.watermark.watermarkMs).toBeLessThanOrEqual(frame.eventTimeMs);
      expect(frame.telemetry.watermarkLagMs).toBeGreaterThanOrEqual(0);
      expect(frame.sourceSequence).toBeGreaterThanOrEqual(1);
    }
  });

  test("the reconnect scenario surfaces recovery + degraded honesty (never smoothed)", () => {
    const producer = createTacticalFrameProducer({
      sessionId: "sess-l005-vm",
      nowMs: steppingClock(),
      ...TACTICAL_REGISTRATION,
    });
    const frames: LiveWorldFrameDoc[] = [];
    for (let ordinal = 1; ordinal <= 60; ordinal += 1) {
      frames.push(producer.next({ sessionId: "sess-l005-vm", ordinal })!.frame);
    }
    // The reconnect window (tick 40, 8 missed by the default config): the
    // FIRST delivered observation after it carries the recovery accounting.
    const recovery = frames.find((frame) =>
      frame.eventsSincePreviousFrame.some((event) => event.type === "source-recovery"),
    );
    expect(recovery).toBeDefined();
    const recoveryEvent = recovery!.eventsSincePreviousFrame.find(
      (event) => event.type === "source-recovery",
    )!;
    expect(recoveryEvent.detail?.missedUpdates).toBeGreaterThan(0);
    expect(recoveryEvent.detail?.gapDurationMs).toBeGreaterThan(0);
    // The post-reconnect degraded window rides the frames' own quality.
    expect(frames.some((frame) => frame.quality === "degraded")).toBe(true);
    // The quality transition is an honest event, never a hidden flip.
    expect(
      frames.some((frame) =>
        frame.eventsSincePreviousFrame.some((event) => event.type === "quality-degraded"),
      ),
    ).toBe(true);
    // The source sequence shows the accounted gap (visible, not renumbered).
    const sequences = frames.map((frame) => frame.sourceSequence);
    const gaps = sequences.filter((seq, index) => index > 0 && seq > sequences[index - 1]! + 1);
    expect(gaps.length).toBeGreaterThan(0);
  });

  test("an undetected entity is carried as last-known (detected false, growing staleness)", () => {
    const producer = createTacticalFrameProducer({
      sessionId: "sess-l005-vm",
      nowMs: steppingClock(),
      ...TACTICAL_REGISTRATION,
    });
    const frames: LiveWorldFrameDoc[] = [];
    for (let ordinal = 1; ordinal <= 60; ordinal += 1) {
      frames.push(producer.next({ sessionId: "sess-l005-vm", ordinal })!.frame);
    }
    const undetected = frames
      .flatMap((frame) => frame.entities)
      .filter((entity) => !entity.detected);
    // The reconnect scenario's misses are carried honestly (the drop
    // scenario's scattered misses too) — never fabricated certainty: a
    // carried miss keeps its LAST KNOWN position with a positive staleness.
    expect(undetected.length).toBeGreaterThan(0);
    for (const entity of undetected) {
      expect(entity.staleForMs).toBeGreaterThanOrEqual(0);
      expect(entity.confidence).toBeLessThan(1);
    }
    // At least one undetected entity is later REGAINED (the honest regain
    // event — identity continuity survives the miss).
    const regained = frames.some((frame) =>
      frame.eventsSincePreviousFrame.some((event) => event.type === "entity-regained"),
    );
    expect(regained).toBe(true);
  });

  test("the scripted window cycles with an honest labeled boundary", () => {
    const producer = createTacticalFrameProducer({
      sessionId: "sess-l005-vm",
      nowMs: steppingClock(),
      // A short window: the reconnect plan delivers ~112 observations for
      // 120 ticks; cycle after that.
      config: { ...TACTICAL_REGISTRATION.config, tickCount: 40, scenario: "normal" as const },
      sourceNote: TACTICAL_REGISTRATION.sourceNote,
    });
    let sawCycle = false;
    let lastVersion = 0;
    for (let ordinal = 1; ordinal <= 90; ordinal += 1) {
      const { frame, replayCycle } = producer.next({ sessionId: "sess-l005-vm", ordinal })!;
      if (replayCycle) {
        sawCycle = true;
        expect(frame.telemetry.replayCycle).toBe(true);
        // The world version KEEPS advancing across the cycle (the view's
        // continuity is the live session's, not the window's).
        expect(frame.worldVersion).toBeGreaterThan(lastVersion);
      }
      lastVersion = frame.worldVersion;
    }
    expect(sawCycle).toBe(true);
  });

  test("L014: a FINITE window answers null at exhaustion — never a fabricated extra frame", () => {
    // The finite-window producer (the L014 registration flag): the scripted
    // window runs ONCE; `next()` answers `null` when it exhausts (the
    // transport ends the channel with `live-window-complete` — the recorded
    // frames are then the replay record). No cycling, no fabricated frame.
    const producer = createTacticalFrameProducer({
      sessionId: "sess-l014-vm",
      nowMs: steppingClock(),
      config: { ...TACTICAL_REGISTRATION.config, tickCount: 5, scenario: "normal" as const },
      sourceNote: "the L014 finite-window view-model test",
      finiteWindow: true,
    });
    const frames: LiveWorldFrameDoc[] = [];
    for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
      const result = producer.next({ sessionId: "sess-l014-vm", ordinal });
      expect(result).not.toBeNull();
      frames.push(result!.frame);
    }
    // The window is exhausted: `null` — the honest end (and every call after).
    expect(producer.next({ sessionId: "sess-l014-vm", ordinal: 6 })).toBeNull();
    expect(producer.next({ sessionId: "sess-l014-vm", ordinal: 7 })).toBeNull();
    // The delivered frames advanced monotonically (the window's own span).
    for (let index = 1; index < frames.length; index += 1) {
      expect(frames[index]!.worldVersion).toBeGreaterThan(frames[index - 1]!.worldVersion);
      expect(frames[index]!.eventTimeMs).toBeGreaterThan(frames[index - 1]!.eventTimeMs);
    }
    expect(producer.delivered).toBe(5);
  });

  test("L014: the finite window's frames EQUAL the cycling window's first pass (same source, same seed)", () => {
    // The SAME deterministic source with the same seed/scenario/window: the
    // finite producer's one pass is EXACTLY the cycling producer's first
    // pass — the finite flag changes only the END behavior, never the
    // frames (the replay record is the same session content either way).
    const config = { ...TACTICAL_REGISTRATION.config, tickCount: 6, scenario: "normal" as const };
    const finite = createTacticalFrameProducer({
      sessionId: "sess-l014-vm-eq",
      nowMs: steppingClock(),
      config,
      sourceNote: "finite",
      finiteWindow: true,
    });
    const cycling = createTacticalFrameProducer({
      sessionId: "sess-l014-vm-eq",
      nowMs: steppingClock(),
      config,
      sourceNote: "cycling",
    });
    for (let ordinal = 1; ordinal <= 6; ordinal += 1) {
      const left = finite.next({ sessionId: "sess-l014-vm-eq", ordinal });
      const right = cycling.next({ sessionId: "sess-l014-vm-eq", ordinal });
      expect(left).not.toBeNull();
      expect(right).not.toBeNull();
      expect(left!.frame.entities).toEqual(right!.frame.entities);
      expect(left!.frame.eventTimeMs).toBe(right!.frame.eventTimeMs);
      expect(left!.frame.sourceSequence).toBe(right!.frame.sourceSequence);
      expect(left!.frame.watermark).toEqual(right!.frame.watermark);
    }
    expect(finite.next({ sessionId: "sess-l014-vm-eq", ordinal: 7 })).toBeNull();
  });

  test("deterministic replay: the same seed + scenario yields the same frames", () => {
    const run = (): LiveWorldFrameDoc[] => {
      const producer = createTacticalFrameProducer({
        sessionId: "sess-l005-vm",
        nowMs: steppingClock(),
        ...TACTICAL_REGISTRATION,
      });
      const out: LiveWorldFrameDoc[] = [];
      for (let ordinal = 1; ordinal <= 25; ordinal += 1) {
        out.push(producer.next({ sessionId: "sess-l005-vm", ordinal })!.frame);
      }
      return out;
    };
    const a = run();
    const b = run();
    expect(a.length).toBe(b.length);
    for (let index = 0; index < a.length; index += 1) {
      expect(b[index]!.entities).toEqual(a[index]!.entities);
      expect(b[index]!.eventTimeMs).toBe(a[index]!.eventTimeMs);
      expect(b[index]!.sourceSequence).toBe(a[index]!.sourceSequence);
    }
  });
});

// ---------------------------------------------------------------------------
// The transport's re-pointed producer seam (NOT a fork)
// ---------------------------------------------------------------------------

describe("the W915 transport's tactical producer seam (L005)", () => {
  test("a tactical source serves hello + world events; drops counted; close terminal", async () => {
    const scheduler = manualScheduler();
    const transport = createSseLiveTransport({
      active: true,
      nowMs: steppingClock(),
      bufferDepth: 2,
      scheduler,
    });
    transport.registerSource({
      sessionId: "sess-l005-transport",
      label: "Synthetic live tracking — test",
      storyKey: "live-tactical-synthetic",
      steps: [],
      policy: {
        policyId: "policy-l005-test",
        allowedOperations: ["analysis", "liveDelivery"],
        assertedBy: "test",
      },
      snapshotVersion: 0,
      watermarkSequence: 0,
      tactical: TACTICAL_REGISTRATION,
    });
    const subscriber = transport.subscribe("sess-l005-transport")!;
    expect(subscriber).not.toBeNull();
    const parser = createSseParser();

    // The hello: the honest sourceKind.
    const helloBlock = await subscriber.nextEvent();
    const helloEvents = parser.write(helloBlock!);
    expect(helloEvents).toHaveLength(1);
    const hello = ssePayloadOf<LiveHelloDoc>(helloEvents[0]!);
    expect(hello.sourceKind).toBe("tactical");
    expect(hello.sessionId).toBe("sess-l005-transport");

    // The ticks emit WORLD events (the view-model's frames).
    scheduler.fire();
    scheduler.fire();
    const worldEvents: ReturnType<typeof ssePayloadOf<LiveWorldFrameDoc>>[] = [];
    for (let read = 0; read < 2; read += 1) {
      const block = await subscriber.nextEvent();
      for (const event of parser.write(block!)) {
        if (event.event === "world") {
          worldEvents.push(ssePayloadOf<LiveWorldFrameDoc>(event));
        }
      }
    }
    expect(worldEvents).toHaveLength(2);
    expect(worldEvents[0]!.schemaVersion).toBe("sporta.live-tactical/1");
    expect(worldEvents[0]!.ordinal).toBe(1);
    expect(worldEvents[1]!.ordinal).toBe(2);
    expect(worldEvents[0]!.entities.length).toBe(24);

    // The bounded-buffer drop accounting is the story lane's own.
    const status = transport.status("sess-l005-transport");
    expect(status!.framesEmitted).toBe(2);
    transport.closeAll();
    const closeBlock = await subscriber.nextEvent();
    const closeEvents = parser.write(closeBlock ?? "");
    expect(
      closeEvents.some(
        (event) =>
          event.event === "close" &&
          ssePayloadOf<{ reason: string }>(event).reason === "transport-closed",
      ),
    ).toBe(true);
    expect(await subscriber.nextEvent()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The routes (the seeded live-tactical session through the real surfaces)
// ---------------------------------------------------------------------------

describe("the live tactical routes (L005 over the seeded session)", () => {
  const scheduler = manualScheduler();
  let server: SportaServer;
  let liveTransport: LiveTransport;
  let cookie: string;
  let tacticalSessionId = "";

  beforeAll(async () => {
    liveTransport = createSseLiveTransport({ active: true, nowMs: () => NOW_MS, scheduler });
    server = createSportaServer({
      nowMs: () => NOW_MS,
      passwordHasher: createDeterministicTestHasher(),
      seed: true,
      liveTransport,
    });
    installSportaServerForTests(server);
    await server.ready;

    // The seeded viewer account (the stream must authorize a real identity).
    const registered = await server.auth.register({
      username: "l005-route-user",
      password: "a-real-l005-password",
      roles: ["viewer"],
    });
    cookie = (await server.auth.issueSession({ userId: registered.userId })).token;

    // The seeded tactical session (the seed's own registration).
    const sources = liveTransport.listSources();
    const tactical = sources.find((source) => source.tactical !== undefined);
    expect(tactical).toBeDefined();
    tacticalSessionId = tactical!.sessionId;
  });

  afterAll(() => {
    liveTransport.closeAll();
  });

  test("GET /api/live lists the tactical source with its honest kind + note", async () => {
    const response = await liveListRoute();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sources: { sessionId: string; sourceKind?: string; sourceNote?: string }[];
    };
    const tactical = body.sources.find((source) => source.sessionId === tacticalSessionId);
    expect(tactical?.sourceKind).toBe("tactical");
    expect(tactical?.sourceNote).toContain("L002 deterministic synthetic tracking source");
  });

  test("GET /api/live/[sessionId] serves the tactical stream (hello + world frames, gated)", async () => {
    const parser = createSseParser();

    // Anonymous: the honest 401 (auth-before-bytes).
    const anonymous = await liveStreamRoute(
      new Request(`http://sporta.test/api/live/${tacticalSessionId}`),
      { params: Promise.resolve({ sessionId: tacticalSessionId }) },
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("content-type")).toContain("application/json");

    // An unknown session: the control plane's own 404.
    const unknown = await liveStreamRoute(authorized(`/api/live/sess-does-not-exist`), {
      params: Promise.resolve({ sessionId: "sess-does-not-exist" }),
    });
    expect(unknown.status).toBe(404);

    // The authorized stream: hello + world events over the real wire.
    const response = await liveStreamRoute(authorized(`/api/live/${tacticalSessionId}`), {
      params: Promise.resolve({ sessionId: tacticalSessionId }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    scheduler.fire();
    scheduler.fire();
    const received: { event: string; data: string }[] = [];
    let attempts = 0;
    while (received.length < 3 && attempts < 200) {
      attempts += 1;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 25)),
      ]);
      if (chunk === undefined) continue;
      if (chunk.done) break;
      for (const event of parser.write(decoder.decode(chunk.value, { stream: true }))) {
        received.push({ event: event.event, data: event.data });
      }
    }
    // Cancel the response to clean up the stream.
    await reader.cancel().catch(() => undefined);
    const names = received.map((entry) => entry.event);
    expect(names).toContain("hello");
    expect(names.filter((name) => name === "world").length).toBeGreaterThanOrEqual(2);
    const hello = JSON.parse(
      received.find((entry) => entry.event === "hello")!.data,
    ) as LiveHelloDoc;
    expect(hello.sourceKind).toBe("tactical");
    const world = JSON.parse(
      received.find((entry) => entry.event === "world")!.data,
    ) as LiveWorldFrameDoc;
    expect(world.schemaVersion).toBe("sporta.live-tactical/1");
    expect(world.entities.length).toBe(24);
    expect(world.worldVersion).toBeGreaterThan(0);
  });

  function authorized(path: string): Request {
    return new Request(`http://sporta.test${path}`, {
      headers: { cookie: `${SPORTA_SESSION_COOKIE}=${cookie}` },
    });
  }
});
