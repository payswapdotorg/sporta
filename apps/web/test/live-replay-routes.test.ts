import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { createSseLiveTransport } from "../src/server/live/transport";
import type { LiveScheduler, LiveTransport } from "../src/server/live/transport";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { GET as liveListRoute } from "../src/app/api/live/route";
import { GET as liveStreamRoute } from "../src/app/api/live/[sessionId]/route";
import { GET as replayRoute } from "../src/app/api/live/[sessionId]/replay/route";
import { createSseParser, ssePayloadOf } from "../src/lib/live-sse";
import type {
  LiveCloseDoc,
  LiveHelloDoc,
  LiveReplayRecordDoc,
  LiveWorldFrameDoc,
  SseEvent,
} from "../src/lib/live-sse";
import { replayContinuityVerdict } from "../src/lib/live-replay";

/**
 * THE LIVE/REPLAY CONTINUITY ROUTE TESTS (L014, presentation side) — the
 * full presentation-continuity journey over the REAL seeded finite-window
 * session, through the REAL routes and the REAL SSE transport (manual
 * scheduler — deterministic cadence, interleaved fire/read so no bounded
 * buffer ever drops):
 *
 *   live window (hello → world frames → `live-window-complete` close)
 *     → the replay record route serves the RECORDED frames VERBATIM
 *     → the recorded timeline is ALIGNED (the pure continuity verdict)
 *     → the stream route answers 410 Gone + points at the replay
 *
 * plus the replay route's own fail-closed ladder (auth-before-bytes: the
 * anonymous 401, the unknown session 404, the rights-denied 403, the
 * no-source 404, the honest no-record 200).
 *
 * REAL-vs-FIXTURE: the session, the transport, the routes, and the recorded
 * frames are all REAL (the dev seed's L002 deterministic source projected
 * by the live view-model; the recorded frames are the transport's own
 * recording of what it emitted). Only the scheduler is manual (determinism).
 */

const NOW_MS = 1_999_999_999_000;

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

const scheduler = manualScheduler();
let server: SportaServer;
let liveTransport: LiveTransport;
let cookie: string;
let finiteSessionId = "";
let otherTacticalSessionId = "";

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

  const registered = await server.auth.register({
    username: "l014-route-user",
    password: "a-real-l014-password",
    roles: ["viewer"],
  });
  cookie = (await server.auth.issueSession({ userId: registered.userId })).token;

  // The seeded finite-window continuity session + one cycling scenario
  // session (the transport's own registrations — the seed's data).
  const sources = liveTransport.listSources();
  const finite = sources.find((source) => source.tactical?.finiteWindow === true);
  expect(finite).toBeDefined();
  finiteSessionId = finite!.sessionId;
  const cycling = sources.find(
    (source) => source.tactical !== undefined && source.tactical.finiteWindow !== true,
  );
  expect(cycling).toBeDefined();
  otherTacticalSessionId = cycling!.sessionId;
});

afterAll(() => {
  liveTransport.closeAll();
});

function authorized(path: string): Request {
  return new Request(`http://sporta.test${path}`, {
    headers: { cookie: `${SPORTA_SESSION_COOKIE}=${cookie}` },
  });
}

/** Reads SSE events from the route's stream until `count` arrive (never a hang). */
async function readSseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  parser: ReturnType<typeof createSseParser>,
  count: number,
): Promise<SseEvent[]> {
  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  let attempts = 0;
  while (events.length < count && attempts < 400) {
    attempts += 1;
    const chunk = await Promise.race([
      reader.read(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 25)),
    ]);
    if (chunk === undefined) continue;
    if (chunk.done) break;
    events.push(...parser.write(decoder.decode(chunk.value, { stream: true })));
  }
  return events;
}

describe("the replay route's fail-closed ladder (auth-before-bytes)", () => {
  test("an anonymous request is 401 JSON (identity before any record)", async () => {
    const response = await replayRoute(
      new Request(`http://sporta.test/api/live/${finiteSessionId}/replay`),
      { params: Promise.resolve({ sessionId: finiteSessionId }) },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { error: { failureClass: string } };
    expect(body.error.failureClass).toBe("auth-required");
  });

  test("an unknown session answers the control plane's own 404", async () => {
    const response = await replayRoute(authorized("/api/live/sess-does-not-exist/replay"), {
      params: Promise.resolve({ sessionId: "sess-does-not-exist" }),
    });
    expect(response.status).toBe(404);
  });

  test("a session with no registered live source is 404 live-source-unknown", async () => {
    // Remove a live-rights registration (the transport stays active): the
    // replay route must answer the honest 404 instead of serving or
    // pretending. (The cycling scenario session is re-registered after.)
    const registration = liveTransport
      .listSources()
      .find((source) => source.sessionId === otherTacticalSessionId)!;
    liveTransport.removeSource(otherTacticalSessionId);
    try {
      const response = await replayRoute(authorized(`/api/live/${otherTacticalSessionId}/replay`), {
        params: Promise.resolve({ sessionId: otherTacticalSessionId }),
      });
      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: { failureClass: string } };
      expect(body.error.failureClass).toBe("live-source-unknown");
    } finally {
      liveTransport.registerSource(registration);
    }
  });

  test("a session whose policy denies live delivery is 403 rights-denied", async () => {
    const training = [...server.storyIndex.keys()].find(
      (sessionId) => server.storyIndex.get(sessionId)?.storyKey === "training",
    );
    expect(training).toBeDefined();
    const response = await replayRoute(authorized(`/api/live/${training}/replay`), {
      params: Promise.resolve({ sessionId: training! }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { failureClass: string } };
    expect(body.error.failureClass).toBe("rights-denied");
  });

  test("a finite window that has not run yet answers the honest no-record 200", async () => {
    const response = await replayRoute(authorized(`/api/live/${finiteSessionId}/replay`), {
      params: Promise.resolve({ sessionId: finiteSessionId }),
    });
    expect(response.status).toBe(200);
    const record = (await response.json()) as LiveReplayRecordDoc;
    expect(record.state).toBe("no-record");
    expect(record.frames).toEqual([]);
  });

  test("a CYCLING source answers no-record (replay is not its contract)", async () => {
    const response = await replayRoute(authorized(`/api/live/${otherTacticalSessionId}/replay`), {
      params: Promise.resolve({ sessionId: otherTacticalSessionId }),
    });
    expect(response.status).toBe(200);
    const record = (await response.json()) as LiveReplayRecordDoc;
    expect(record.state).toBe("no-record");
  });

  test("the sources list carries the finite-window flag (honest labeling)", async () => {
    const response = await liveListRoute();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sources: { sessionId: string; finiteWindow?: boolean; sourceNote?: string }[];
    };
    const finite = body.sources.find((source) => source.sessionId === finiteSessionId);
    expect(finite?.finiteWindow).toBe(true);
    expect(finite?.sourceNote).toContain("finite");
    const cycling = body.sources.find((source) => source.sessionId === otherTacticalSessionId);
    expect(cycling?.finiteWindow).toBeUndefined();
  });
});

describe("the live window → replay continuity journey (the L014 acceptance, presentation side)", () => {
  test("the live window streams, ENDS honestly, and the recorded session replays VERBATIM through the routes", async () => {
    const parser = createSseParser();

    // 1. THE LIVE WINDOW: the stream opens (hello) and the world frames
    //    flow per tick until the scripted window exhausts — the channel
    //    ends with the honest `live-window-complete` close. Interleaved
    //    fire/read (the bounded subscriber buffer never drops).
    const response = await liveStreamRoute(authorized(`/api/live/${finiteSessionId}`), {
      params: Promise.resolve({ sessionId: finiteSessionId }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();

    // The hello arrives first (the stream's own framing).
    const helloEvents = await readSseEvents(reader, parser, 1);
    const hello = ssePayloadOf<LiveHelloDoc>(helloEvents[0]!);
    expect(hello.sourceKind).toBe("tactical");
    expect(hello.sessionId).toBe(finiteSessionId);

    // 24 scripted ticks: fire in batches of 4, read each batch (no drops).
    const wireFrames: LiveWorldFrameDoc[] = [];
    for (let batch = 0; batch < 6; batch += 1) {
      scheduler.fire();
      scheduler.fire();
      scheduler.fire();
      scheduler.fire();
      const events = await readSseEvents(reader, parser, 4);
      for (const event of events) {
        if (event.event === "world") wireFrames.push(ssePayloadOf<LiveWorldFrameDoc>(event));
      }
    }
    expect(wireFrames).toHaveLength(24);

    // The 25th tick: the window exhausts — the terminal close event.
    scheduler.fire();
    const closeEvents = await readSseEvents(reader, parser, 1);
    const close = closeEvents
      .filter((event) => event.event === "close")
      .map((event) => ssePayloadOf<LiveCloseDoc>(event))[0];
    expect(close).toBeDefined();
    expect(close!.reason).toBe("live-window-complete");
    expect(close!.deliveredFrames).toBe(24);
    await reader.cancel().catch(() => undefined);

    // 2. THE REPLAY RECORD: the route serves the RECORDED frames —
    //    VERBATIM (the same ordinals, world versions, watermarks and
    //    event times the live window emitted; never re-stamped).
    const replayResponse = await replayRoute(authorized(`/api/live/${finiteSessionId}/replay`), {
      params: Promise.resolve({ sessionId: finiteSessionId }),
    });
    expect(replayResponse.status).toBe(200);
    const record = (await replayResponse.json()) as LiveReplayRecordDoc;
    expect(record.state).toBe("complete");
    expect(record.frames).toHaveLength(24);
    expect(record.frames).toEqual(wireFrames); // VERBATIM — the continuity proof
    expect(record.meta?.worldVersionFirst).toBe(1);
    expect(record.meta?.worldVersionLast).toBe(24);
    expect(record.meta?.deliveredFrames).toBe(24);
    expect(record.meta?.droppedFrames).toBe(0);

    // 3. THE ALIGNMENT: the recorded timeline's state versions/timecodes
    //    remain aligned (the pure verdict — the acceptance, asserted).
    const verdict = replayContinuityVerdict(record.frames);
    expect(verdict.aligned).toBe(true);
    expect(verdict.problems).toEqual([]);

    // 4. THE HONEST TERMINAL: the stream route answers 410 Gone and
    //    points at the replay (the live window is over — never a zombie
    //    stream, never a silent re-run).
    const after = await liveStreamRoute(authorized(`/api/live/${finiteSessionId}`), {
      params: Promise.resolve({ sessionId: finiteSessionId }),
    });
    expect(after.status).toBe(410);
    expect(after.headers.get("content-type")).toContain("application/json");
    const afterBody = (await after.json()) as {
      error: { failureClass: string; replayPath: string; deliveredFrames: number };
    };
    expect(afterBody.error.failureClass).toBe("live-window-complete");
    expect(afterBody.error.replayPath).toBe(`/api/live/${finiteSessionId}/replay`);
    expect(afterBody.error.deliveredFrames).toBe(24);
  }, 20_000);
});
