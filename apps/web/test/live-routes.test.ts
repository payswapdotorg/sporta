import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { createSseLiveTransport } from "../src/server/live/transport";
import type { LiveScheduler, LiveTransport } from "../src/server/live/transport";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { POST as registerRoute } from "../src/app/api/auth/register/route";
import { POST as loginRoute } from "../src/app/api/auth/login/route";
import { GET as capabilityRoute } from "../src/app/api/capability/route";
import { GET as liveListRoute } from "../src/app/api/live/route";
import { GET as liveStreamRoute } from "../src/app/api/live/[sessionId]/route";
import { createSseParser, ssePayloadOf } from "../src/lib/live-sse";
import type { LiveFrameDoc, LiveHelloDoc } from "../src/lib/live-sse";

/**
 * LIVE ROUTE TESTS (W915) — the two /api/live endpoints, driven as real
 * route functions over real `Request`s against a hermetic composition whose
 * SSE transport is ACTIVE (manual scheduler — deterministic cadence).
 *
 * These are the AUTH-BEFORE-BYTES tests: not one SSE byte may leave the
 * route before the transport state, the identity, the session, and the
 * live-delivery rights ALL pass (each failure answers its honest typed JSON
 * instead — a JSON content type IS the "no bytes" proof, since an opened
 * stream would answer `text/event-stream`).
 *
 * The wiring tests pin the capability response + the sources list to the
 * transport's REAL state in every configuration: active-with-source
 * (`live-network`), active-without-source (honest unavailable), and
 * inactive (the Simulation F in-process state).
 */

const NOW_MS = 1_777_777_777_000;

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
let derbySessionId: string | null = null;
let trainingSessionId: string | null = null;

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

  // The real seeded catalog: find the derby (live-authorized) and training
  // (rights-denied for live) sessions through the real story index.
  for (const sessionId of server.storyIndex.keys()) {
    const story = server.storyIndex.get(sessionId);
    if (story?.storyKey === "derby") derbySessionId = sessionId;
    if (story?.storyKey === "training") trainingSessionId = sessionId;
  }
  expect(derbySessionId).not.toBeNull();
  expect(trainingSessionId).not.toBeNull();

  // A real registered account (the viewer the stream must authorize).
  await registerRoute(
    jsonRequest("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "w915-route-user",
        password: "route-test-password-1",
        roles: ["viewer"],
      }),
    }),
  );
  const login = await loginRoute(
    jsonRequest("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "w915-route-user", password: "route-test-password-1" }),
    }),
  );
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!;
  expect(cookie).toContain(`${SPORTA_SESSION_COOKIE}=`);
});

afterAll(() => {
  // No orphaned tick loops survive the file.
  liveTransport.closeAll();
});

function jsonRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`http://sporta.test${path}`, init);
}

function withCookie(path: string, init: RequestInit = {}): Request {
  return new Request(`http://sporta.test${path}`, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      cookie,
    },
  });
}

function streamRequest(sessionId: string, signal: AbortSignal): Request {
  return new Request(`http://sporta.test/api/live/${sessionId}`, { signal, headers: { cookie } });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function liveContext(sessionId: string): { params: Promise<{ sessionId: string }> } {
  return { params: Promise.resolve({ sessionId }) };
}

/** A read that FAILS the test if nothing arrives in time (never a hang). */
async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms = 2_000,
): Promise<Uint8Array> {
  const result = await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("no SSE bytes arrived within the test timeout")), ms);
    }),
  ]);
  if (result.done) throw new Error("the SSE stream ended earlier than the test expected");
  return result.value;
}

// ---------------------------------------------------------------------------
// The fail-closed ladder (auth-before-bytes) — every refusal is JSON, never SSE
// ---------------------------------------------------------------------------

describe("GET /api/live/[sessionId] — the fail-closed ladder", () => {
  test("an anonymous request is 401 JSON before any byte (no EventSource without identity)", async () => {
    const response = await liveStreamRoute(
      jsonRequest(`/api/live/${derbySessionId}`),
      liveContext(derbySessionId!),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await bodyOf(response)) as { error: { failureClass: string } };
    expect(body.error.failureClass).toBe("auth-required");
  });

  test("a presented-but-unusable token is 401 auth-invalid (never anonymous live)", async () => {
    const response = await liveStreamRoute(
      new Request(`http://sporta.test/api/live/${derbySessionId}`, {
        headers: { cookie: `${SPORTA_SESSION_COOKIE}=not-a-real-token` },
      }),
      liveContext(derbySessionId!),
    );
    expect(response.status).toBe(401);
    const body = (await bodyOf(response)) as { error: { failureClass: string } };
    expect(body.error.failureClass).toBe("auth-invalid");
  });

  test("an unknown session answers the control plane's own 404 (JSON)", async () => {
    const response = await liveStreamRoute(
      withCookie("/api/live/no-such-session"),
      liveContext("no-such-session"),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  test("a session whose policy denies live delivery is 403 rights-denied (JSON, no bytes)", async () => {
    const response = await liveStreamRoute(
      withCookie(`/api/live/${trainingSessionId}`),
      liveContext(trainingSessionId!),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await bodyOf(response)) as {
      error: { failureClass: string; message: string };
    };
    expect(body.error.failureClass).toBe("rights-denied");
    expect(body.error.message).toContain("before any byte");
  });

  test("a live-rights session with no registered source is 404 live-source-unknown", async () => {
    // Remove the derby registration (the transport stays active): the route
    // must answer the honest 404 instead of streaming or pretending.
    const [registration] = liveTransport.listSources();
    expect(registration?.sessionId).toBe(derbySessionId!);
    liveTransport.removeSource(derbySessionId!);
    try {
      const response = await liveStreamRoute(
        withCookie(`/api/live/${derbySessionId}`),
        liveContext(derbySessionId!),
      );
      expect(response.status).toBe(404);
      const body = (await bodyOf(response)) as { error: { failureClass: string } };
      expect(body.error.failureClass).toBe("live-source-unknown");
    } finally {
      liveTransport.registerSource(registration!); // restore for the tests below
    }
  });
});

// ---------------------------------------------------------------------------
// The stream itself (real SSE bytes through the real route handler)
// ---------------------------------------------------------------------------

describe("GET /api/live/[sessionId] — the stream", () => {
  test("answers text/event-stream, hello first, real frames per tick, clean abort", async () => {
    const controller = new AbortController();
    const response = await liveStreamRoute(
      streamRequest(derbySessionId!, controller.signal),
      liveContext(derbySessionId!),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(response.body).not.toBeNull();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const parser = createSseParser();
    const events = [];

    // hello arrives immediately (the stream opens with the session meta).
    events.push(...parser.write(decoder.decode(await readWithTimeout(reader))));
    // The tick loop started with THIS subscriber (first subscriber).
    expect(scheduler.active()).toBe(1);

    // Two real cadence ticks → two real frame events.
    scheduler.fire();
    scheduler.fire();
    await sleep(10); // let the pump's awaited race resolve + enqueue
    events.push(...parser.write(decoder.decode(await readWithTimeout(reader))));
    events.push(...parser.write(decoder.decode(await readWithTimeout(reader))));

    const names = events.map((event) => event.event);
    expect(names[0]).toBe("hello");
    expect(names.slice(1)).toEqual(["frame", "frame"]);

    const hello = ssePayloadOf<LiveHelloDoc>(events[0]!);
    expect(hello.sessionId).toBe(derbySessionId!);
    expect(hello.schemaVersion).toBe("sporta.live-sse/1");
    expect(hello.cadenceMs).toBe(500); // the transport's real cadence (default)
    expect(hello.openedAtMs).toBe(NOW_MS); // the injected clock at stream open

    for (const [index, event] of events.slice(1).entries()) {
      // The wire grammar: the frame's id line IS the ordinal.
      expect(event.id).toBe(String(index + 1));
      const frame = ssePayloadOf<LiveFrameDoc>(event);
      expect(frame.ordinal).toBe(index + 1);
      expect(frame.sessionId).toBe(derbySessionId!);
      expect(frame.svg.trimStart().startsWith("<svg")).toBe(true);
      expect(frame.byteLength).toBe(frame.svg.length);
      // The honest server timestamps the transport's real (injected) clock.
      expect(frame.generatedAtMs).toBe(NOW_MS);
      expect(frame.renderDurationMs).toBeGreaterThanOrEqual(0);
    }

    // The consumer leaving (abort) closes the subscriber and stops the tick
    // loop — no orphaned generation.
    controller.abort();
    await sleep(10);
    expect(scheduler.active()).toBe(0);
    await reader.cancel().catch(() => undefined);
  });
});

// ---------------------------------------------------------------------------
// The sources list + the capability wiring (active-with-source)
// ---------------------------------------------------------------------------

describe("the active transport's wiring", () => {
  test("GET /api/live lists the real source with live-network evidence", async () => {
    const response = await liveListRoute();
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      available: boolean;
      transportKind: string;
      detail: string;
      sources: {
        sessionId: string;
        label: string;
        storyKey: string;
        sourceKind?: string;
        sourceNote?: string;
      }[];
    };
    expect(body.available).toBe(true);
    expect(body.transportKind).toBe("live-network");
    expect(body.detail).toContain("SSE live transport");
    // L005: the seed now registers TWO live sources — the derby story
    // timeline AND the live tactical view-model's session.
    expect(body.sources).toHaveLength(2);
    const derby = body.sources.find((source) => source.sessionId === derbySessionId!);
    expect(derby).toBeDefined();
    expect(derby!.storyKey).toBe("derby");
    expect(derby!.sourceKind).toBe("story");
    const tactical = body.sources.find((source) => source.sourceKind === "tactical");
    expect(tactical).toBeDefined();
    expect(tactical!.storyKey).toBe("live-tactical-synthetic");
    expect(tactical!.sourceNote).toContain("L002");
  });

  test("the capability response reports modes.live available over live-network", async () => {
    const response = await capabilityRoute(withCookie("/api/capability"));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      modes: { live: { availability: string; reasonCode: string; transportKind: string } };
      providers: { kind: string; health: string }[];
    };
    // Simulation F satisfied the REAL way: available requires live-network.
    expect(body.modes.live).toEqual({
      availability: "available",
      reasonCode: "ok",
      transportKind: "live-network",
    });
    // The queue-cache provider feed is REAL (ok) ONLY while the transport is
    // active — it backs the live mode's bounded frame buffers.
    const queueCache = body.providers.find((provider) => provider.kind === "queue-cache");
    expect(queueCache?.health).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// The honest degraded configurations (never a claimed live)
// ---------------------------------------------------------------------------

describe("an active transport with NO registered source", () => {
  let emptySourceServer: SportaServer;
  let emptySourceCookie: string;

  beforeAll(async () => {
    emptySourceServer = createSportaServer({
      nowMs: () => NOW_MS,
      passwordHasher: createDeterministicTestHasher(),
      // The REAL seed (so the control plane genuinely holds the live-rights
      // derby session), but the transport's source registration is REMOVED
      // after seeding — active transport, real session, honestly no source.
      seed: true,
      liveTransport: createSseLiveTransport({ active: true, nowMs: () => NOW_MS }),
    });
    installSportaServerForTests(emptySourceServer);
    await emptySourceServer.ready;
    for (const source of emptySourceServer.live.listSources()) {
      emptySourceServer.live.removeSource(source.sessionId);
    }
    expect(emptySourceServer.live.listSources()).toEqual([]);

    // This composition has its OWN identity stores: authorize a viewer here.
    await registerRoute(
      jsonRequest("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "w915-empty-source-user",
          password: "route-test-password-1",
          roles: ["viewer"],
        }),
      }),
    );
    const login = await loginRoute(
      jsonRequest("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "w915-empty-source-user",
          password: "route-test-password-1",
        }),
      }),
    );
    expect(login.status).toBe(200);
    emptySourceCookie = login.headers.get("set-cookie")!;
  });

  test("the sources list answers honestly unavailable (no source to serve)", async () => {
    const response = await liveListRoute();
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      available: boolean;
      transportKind: string;
      sources: unknown[];
    };
    expect(body.available).toBe(false);
    expect(body.transportKind).toBe("none");
    expect(body.sources).toEqual([]);
  });

  test("the capability response stays honestly unavailable (never a claimed live)", async () => {
    const response = await capabilityRoute(jsonRequest("/api/capability"));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      modes: { live: { availability: string; reasonCode: string; transportKind: string } };
    };
    expect(body.modes.live.availability).toBe("unavailable");
    expect(body.modes.live.transportKind).toBe("none");
  });

  test("a stream request for any session answers the honest 404 (no source)", async () => {
    const response = await liveStreamRoute(
      new Request(`http://sporta.test/api/live/${derbySessionId}`, {
        headers: { cookie: emptySourceCookie },
      }),
      liveContext(derbySessionId!),
    );
    expect(response.status).toBe(404);
    const body = (await bodyOf(response)) as { error: { failureClass: string } };
    expect(body.error.failureClass).toBe("live-source-unknown");
  });
});

describe("an INACTIVE transport (the env gate absent — Simulation F)", () => {
  beforeAll(async () => {
    // The production default: no SPORTA_LIVE_TRANSPORT in the test env → the
    // composition's env gate resolves unavailable (the real default path).
    installSportaServerForTests(
      createSportaServer({
        nowMs: () => NOW_MS,
        passwordHasher: createDeterministicTestHasher(),
        seed: true,
      }),
    );
  });

  test("the stream route answers the typed 503 — before identity, before bytes", async () => {
    const response = await liveStreamRoute(
      withCookie(`/api/live/${derbySessionId}`),
      liveContext(derbySessionId!),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await bodyOf(response)) as { error: { failureClass: string } };
    expect(body.error.failureClass).toBe("live-transport-not-configured");
  });

  test("the capability response is the honest in-process state (W904 frozen behavior)", async () => {
    const response = await capabilityRoute(jsonRequest("/api/capability"));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      modes: { live: { availability: string; reasonCode: string; transportKind: string } };
      providers: { kind: string; health: string; reasonCode: string; detail?: string }[];
    };
    expect(body.modes.live).toEqual({
      availability: "unavailable",
      reasonCode: "in-process-transport-not-live",
      transportKind: "in-process",
    });
    // W913: the queue-cache provider is REAL even while the live transport
    // is inactive — it backs the bounded render queue + quota counters + TTL
    // cache (per-instance in this composition; no shared redis configured).
    const queueCache = body.providers.find((provider) => provider.kind === "queue-cache");
    expect(queueCache?.health).toBe("ok");
    expect(queueCache?.reasonCode).toBe("ok");
    expect(queueCache?.detail).toContain("in-memory transient state");
  });

  test("the sources list answers unavailable with the honest detail", async () => {
    const response = await liveListRoute();
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      available: boolean;
      transportKind: string;
      detail: string;
      sources: unknown[];
    };
    expect(body.available).toBe(false);
    expect(body.transportKind).toBe("none");
    expect(body.detail).toContain("not configured");
    expect(body.sources).toEqual([]);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
