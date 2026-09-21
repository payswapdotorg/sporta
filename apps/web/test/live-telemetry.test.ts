/**
 * THE LIVE TELEMETRY PLUMBING TESTS (L006) — the §9 counters collected at
 * the REAL pipeline seams over the REAL composition, served through the
 * OPERATOR route:
 *
 * - the transport DECORATOR injects the per-session probe into tactical
 *   registrations (the view-model producer reports its stage boundaries);
 * - every consumer-pulled world frame is stamped at the delivery boundary
 *   (the true end-to-end);
 * - the channel's own counted drop-oldest losses reconcile into the
 *   renderer-frame-drops counter;
 * - the OPERATOR route serves the §9 snapshots operator-gated (anonymous
 *   401, non-operator 403, operator 200) with the frozen counter ids;
 * - story-timeline channels carry NO probe — the honest absence, never an
 *   invented entry;
 * - DETERMINISM: the stepping clock + the manual scheduler make the stage
 *   spans exact (the same battery style as the collector's own core tests).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { createSseLiveTransport } from "../src/server/live/transport";
import type { LiveScheduler, LiveTransport } from "../src/server/live/transport";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { GET as liveTelemetryRoute } from "../src/app/api/operations/live-telemetry/route";
import { createSseParser, ssePayloadOf } from "../src/lib/live-sse";
import type { LiveHelloDoc, LiveWorldFrameDoc } from "../src/lib/live-sse";
import { InMemoryRedis } from "../src/server/platform/upstash/redis";

// ---------------------------------------------------------------------------
// The rig (module scope: one manual scheduler + one stepping clock)
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

/** The deterministic stepping clock (17ms per call — the repo's rig style). */
function steppingClock(): () => number {
  let current = 1_899_999_999_000;
  return () => {
    current += 17;
    return current;
  };
}

const scheduler = manualScheduler();
const clock = steppingClock();

function withCookie(token: string | null, path: string): Request {
  return new Request(`http://sporta.test${path}`, {
    headers: token === null ? {} : { cookie: `${SPORTA_SESSION_COOKIE}=${token}` },
  });
}

let server: SportaServer;
let liveTransport: LiveTransport;
let operatorToken = "";
let viewerToken = "";
let tacticalSessionId = "";

beforeAll(async () => {
  liveTransport = createSseLiveTransport({ active: true, nowMs: clock, scheduler });
  server = createSportaServer({
    nowMs: clock,
    passwordHasher: createDeterministicTestHasher(),
    transient: { redis: new InMemoryRedis(clock), provider: "in-memory" },
    seed: true,
    liveTransport,
  });
  installSportaServerForTests(server);
  await server.ready;

  // Self-registration cannot mint the operator grant (operator-assigned);
  // create the account directly in the store, exactly as provisioning would.
  const operator = await server.accounts.create({
    username: "l006-operator",
    email: undefined,
    passwordHash: "not-a-login-path",
    roles: ["operator", "viewer"],
    createdAtIso: new Date(clock()).toISOString(),
  });
  operatorToken = (await server.auth.issueSession({ userId: operator.userId })).token;
  const viewer = await server.auth.register({
    username: "l006-viewer",
    password: "another-real-l006-password",
    roles: ["viewer"],
  });
  viewerToken = (await server.auth.issueSession({ userId: viewer.userId })).token;

  const sources = server.live.listSources();
  const tactical = sources.find((source) => source.tactical !== undefined);
  expect(tactical).toBeDefined();
  tacticalSessionId = tactical!.sessionId;
});

afterAll(() => {
  liveTransport.closeAll();
});

/** Pulls world-event source sequences until `want` frames arrived (or bail). */
async function pullWorldSequences(
  subscriber: { nextEvent(): Promise<string | null> },
  want: number,
): Promise<number[]> {
  const parser = createSseParser();
  const sequences: number[] = [];
  let attempts = 0;
  while (sequences.length < want && attempts < want * 20) {
    attempts += 1;
    const block = await Promise.race([
      subscriber.nextEvent(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5)),
    ]);
    if (block === null) continue;
    for (const event of parser.write(block)) {
      if (event.event === "world") {
        sequences.push(ssePayloadOf<LiveWorldFrameDoc>(event).sourceSequence);
      }
    }
  }
  return sequences;
}

describe("the L006 plumbing over the real composition", () => {
  test("the decorator instruments the tactical source's producer (exact stage spans)", async () => {
    const parser = createSseParser();
    const subscriber = server.live.subscribe(tacticalSessionId)!;
    expect(subscriber).not.toBeNull();

    // The hello rides first (the tactical source's honest kind).
    const helloBlock = await subscriber.nextEvent();
    const helloEvents = parser.write(helloBlock!);
    expect(helloEvents).toHaveLength(1);
    expect(ssePayloadOf<LiveHelloDoc>(helloEvents[0]!).sourceKind).toBe("tactical");

    // Pull 5 world frames: each tick is one producer pass + one delivery.
    const worldSequences: number[] = [];
    for (let tick = 0; tick < 5; tick += 1) {
      scheduler.fire();
      worldSequences.push(...(await pullWorldSequences(subscriber, 1)));
    }
    expect(worldSequences).toHaveLength(5);

    const snapshot = server.liveTelemetry.snapshot(tacticalSessionId)!;
    expect(snapshot).not.toBeNull();
    // The §9 stage counts: every frame reported every stage.
    expect(snapshot.latencies.sourceToIngest.stats.count).toBe(5);
    expect(snapshot.latencies.ingestToSwm.stats.count).toBe(5);
    expect(snapshot.latencies.swmToRender.stats.count).toBe(5);
    expect(snapshot.latencies.endToEndPresentation.stats.count).toBe(5);
    // The stepping clock's exact spans: the producer's stage calls are
    // pull → ingest → swm → render (one 17ms step each — the pinned rig).
    expect(snapshot.latencies.sourceToIngest.stats.lastMs).toBe(17);
    expect(snapshot.latencies.ingestToSwm.stats.lastMs).toBe(17);
    expect(snapshot.latencies.swmToRender.stats.lastMs).toBe(17);
    // The end-to-end spans are positive multiples of the clock step and at
    // least the four in-process stages (pull→ingest→swm→render→deliver).
    const e2e = snapshot.latencies.endToEndPresentation.stats.lastMs!;
    expect(e2e % 17).toBe(0);
    expect(e2e).toBeGreaterThanOrEqual(4 * 17);
    expect(snapshot.window.ingestedObservations).toBe(5);
    subscriber.close();
  });

  test("the channel's counted drop-oldest losses reconcile into renderer-frame-drops", async () => {
    // A fresh channel on the same source (its own subscriber + buffer).
    const subscriber = server.live.subscribe(tacticalSessionId)!;
    await subscriber.nextEvent(); // the hello

    // Fire ticks WITHOUT pulling: the bounded buffer (depth 8) overflows
    // and the channel COUNTS the losses (drop-oldest, visible gaps).
    for (let tick = 0; tick < 12; tick += 1) {
      scheduler.fire();
      await Bun.sleep(1);
    }
    const status = server.live.status(tacticalSessionId)!;
    expect(status.framesEmitted).toBeGreaterThan(0);

    const snapshot = server.liveTelemetry.snapshot(tacticalSessionId)!;
    // The §9 frame-drop counter is the channel's own honest accounting
    // (every drop the bounded buffer counted — visible to operators).
    expect(snapshot.frameDrops.count).toBe(status.droppedFrames);
    subscriber.close();
  });

  test("story-timeline channels carry NO probe — the honest absence", () => {
    const storySource = server.live
      .listSources()
      .find((source) => source.tactical === undefined && source.steps.length > 0);
    expect(storySource).toBeDefined();
    // A story session has no collector: no invented telemetry, ever.
    expect(server.liveTelemetry.snapshot(storySource!.sessionId)).toBeNull();
  });
});

describe("GET /api/operations/live-telemetry (the operator surface)", () => {
  test("anonymous callers get the real 401", async () => {
    const response = await liveTelemetryRoute(withCookie(null, "/api/operations/live-telemetry"));
    expect(response.status).toBe(401);
  });

  test("non-operators get the real typed 403", async () => {
    const response = await liveTelemetryRoute(
      withCookie(viewerToken, "/api/operations/live-telemetry"),
    );
    expect(response.status).toBe(403);
  });

  test("operators get the §9 snapshots with the frozen counter vocabulary", async () => {
    const response = await liveTelemetryRoute(
      withCookie(operatorToken, "/api/operations/live-telemetry"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      counters: string[];
      transport: { state: string; detail: string };
      sessions: {
        sessionId: string;
        snapshot: {
          latencies: {
            sourceToIngest: { counterId: string; stats: { count: number } };
            ingestToSwm: { counterId: string; stats: { count: number } };
            swmToRender: { counterId: string; stats: { count: number } };
            endToEndPresentation: { counterId: string; stats: { count: number } };
          };
          watermarkLag: { counterId: string };
          droppedObservations: { counterId: string };
          extrapolatedObservations: { counterId: string };
          identitySwitches: { counterId: string };
          reconnects: { counterId: string };
          frameDrops: { counterId: string; count: number };
          effectiveUpdateRate: { counterId: string; hz: number | null };
        };
      }[];
    };
    // The frozen §9 vocabulary, verbatim.
    expect(body.counters).toEqual([
      "source-to-ingest-latency",
      "ingest-to-swm-latency",
      "swm-to-render-latency",
      "end-to-end-presentation-latency",
      "watermark-lag",
      "dropped-observations",
      "extrapolated-observations",
      "identity-switches",
      "reconnects",
      "renderer-frame-drops",
      "effective-update-rate",
    ]);
    expect(body.transport.state).toBe("active");
    const entry = body.sessions.find((row) => row.sessionId === tacticalSessionId);
    expect(entry).toBeDefined();
    const snapshot = entry!.snapshot;
    expect(snapshot.latencies.sourceToIngest.counterId).toBe("source-to-ingest-latency");
    expect(snapshot.latencies.sourceToIngest.stats.count).toBeGreaterThan(0);
    expect(snapshot.latencies.ingestToSwm.counterId).toBe("ingest-to-swm-latency");
    expect(snapshot.latencies.swmToRender.counterId).toBe("swm-to-render-latency");
    expect(snapshot.latencies.endToEndPresentation.counterId).toBe(
      "end-to-end-presentation-latency",
    );
    expect(snapshot.watermarkLag.counterId).toBe("watermark-lag");
    expect(snapshot.droppedObservations.counterId).toBe("dropped-observations");
    expect(snapshot.extrapolatedObservations.counterId).toBe("extrapolated-observations");
    expect(snapshot.identitySwitches.counterId).toBe("identity-switches");
    expect(snapshot.reconnects.counterId).toBe("reconnects");
    expect(snapshot.frameDrops.counterId).toBe("renderer-frame-drops");
    expect(snapshot.effectiveUpdateRate.counterId).toBe("effective-update-rate");
    // The effective update rate is a real measured number once two frames
    // were delivered (never null with deliveries on record).
    expect(snapshot.effectiveUpdateRate.hz).not.toBeNull();
  });
});
