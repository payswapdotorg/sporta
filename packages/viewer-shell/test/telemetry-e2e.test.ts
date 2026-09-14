/**
 * W706 telemetry E2E — the REAL browser composition, headless: the viewer
 * core emits its events into the HTTP telemetry bridge sink, which POSTs
 * them to the dev viewer server's own `/telemetry` route, which validates
 * every event against the closed vocabulary and writes it through the REAL
 * JSONL file sink under a declared path. This pins the exact wiring
 * `web/bootstrap.ts` composes (modulo the same-origin URLs the browser
 * uses), the route's typed refusals, and end-to-end determinism ×2.
 *
 * Constitution: no `Date.now`/`Math.random`; the clock is the injected
 * fake; temp dirs use a deterministic counter; `setTimeout(0)` is a
 * macrotask yield (loopback HTTP resolution), not a wall-clock read.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveViewer } from "../src/serve.ts";
import type { ViewerServer } from "../src/serve.ts";
import { createHttpControlClient } from "../src/http-client.ts";
import { createHttpPlaybackProvider } from "../src/playback-provider.ts";
import { createHttpTelemetrySink } from "../src/telemetry-http-sink.ts";
import { createViewerCore } from "../src/viewer-core.ts";
import type { ViewerCore } from "../src/viewer-core.ts";
import { parseTelemetryLine } from "../src/telemetry-events.ts";
import type { ViewerTelemetryEvent } from "../src/telemetry-events.ts";
import { fakeClock, fullAllowPolicy } from "./helpers.ts";

/** Yields the event loop until `predicate` holds (bounded macrotask turns). */
async function settleUntil(predicate: () => boolean, maxYields = 400): Promise<void> {
  for (let i = 0; i < maxYields; i += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/** The temp root for the e2e telemetry files (deterministic names, cleaned). */
const TEMP_ROOT = join(tmpdir(), "sporta-w706-telemetry-e2e-test");
let dirCounter = 0;
function nextTelemetryPath(): string {
  dirCounter += 1;
  const dir = join(TEMP_ROOT, `case-${String(dirCounter)}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, "viewer-telemetry.jsonl");
}

/** The browser composition over a real server (the bootstrap's wiring). */
function makeCore(server: ViewerServer): ViewerCore {
  const client = createHttpControlClient({ baseUrl: `${server.url}/control` });
  const output = createHttpPlaybackProvider({ baseUrl: `${server.url}/control` });
  const telemetrySink = createHttpTelemetrySink({ baseUrl: `${server.url}/telemetry` });
  // One injected fake clock per core (constant TEST_EPOCH_MS — deterministic
  // atMs; the timing durations read as 0 ms, honestly).
  const clock = fakeClock();
  return createViewerCore({
    client,
    output,
    telemetrySink,
    nowMs: () => clock.now(),
  });
}

/** The scripted golden walk (real chain: session → render → ready → feedback). */
async function goldenWalk(core: ViewerCore): Promise<void> {
  core.dispatch({ type: "connect" });
  await settleUntil(() => core.view().status === "browsing-sessions");
  core.dispatch({
    type: "createSession",
    policy: fullAllowPolicy,
    sourceLabel: "telemetry-e2e",
  });
  // Wait for the session to be LISTED (the createSession operation still
  // runs after the status returns to browsing-sessions — a later command
  // dispatched too early would be dropped by the single-in-flight rule).
  await settleUntil(
    () => core.view().status === "browsing-sessions" && core.view().sessions.length === 1,
  );
  core.dispatch({ type: "openSession", sessionId: "sess-1" });
  await settleUntil(() => core.view().status === "session-detail");
  core.dispatch({ type: "beginRender" });
  await settleUntil(() => core.view().status === "renderer-selection");
  core.dispatch({ type: "createRender", rendererId: "anime.prototype" });
  await settleUntil(() => core.view().status === "ready");
  core.dispatch({ type: "play" });
  await settleUntil(() => core.view().status === "playing");
  core.dispatch({ type: "sendFeedback", feedback: "playback-good" });
}

afterAll(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

describe("W706 telemetry e2e — the real bridge → route → file sink chain", () => {
  test("the golden walk lands every emitted event as a valid JSONL line, in sequence order", async () => {
    const telemetryPath = nextTelemetryPath();
    const server = serveViewer({ port: 0, telemetryPath });
    try {
      const core = makeCore(server);
      await goldenWalk(core);
      // 13 events expected (see the kinds pin below); wait for the file.
      await settleUntil(() => (server.telemetry?.status().linesWritten ?? 0) >= 13);

      const content = readFileSync(telemetryPath, "utf8");
      const lines = content.split("\n").filter((line) => line.length > 0);
      expect(lines).toHaveLength(13);
      const events = lines.map((line) => {
        const outcome = parseTelemetryLine(line);
        expect(outcome.ok).toBe(true);
        return outcome.ok ? outcome.event : null;
      }) as ViewerTelemetryEvent[];
      // Deterministic ids: the emitter's 1-based counter, in order.
      expect(events.map((event) => event.sequence)).toEqual(
        Array.from({ length: 13 }, (_, index) => index + 1),
      );
      expect(events.map((event) => event.kind)).toEqual([
        "state-transition", // 1: disconnected → connecting
        "operation-timing", // 2: connect (fake clock: 0 ms)
        "state-transition", // 3: connecting → browsing-sessions
        "state-transition", // 4: browsing-sessions → session-detail
        "state-transition", // 5: session-detail → renderer-selection
        "state-transition", // 6: renderer-selection → session-detail
        "state-transition", // 7: session-detail → render-queued
        "state-transition", // 8: render-queued → loading-output
        "integrity-verified", // 9: the REAL W504 seam (sha-256 + byte length)
        "state-transition", // 10: loading-output → ready
        "operation-timing", // 11: load-output
        "state-transition", // 12: ready → playing
        "user-feedback", // 13: the structured feedback command
      ]);
      // Correlation: the opaque session id from the open onward.
      expect(events.slice(3).map((event) => event.sessionId)).toEqual(
        Array.from({ length: 10 }, () => "sess-1"),
      );
      // The real-seam facts are the real ones (6-frame W502 single-snapshot
      // clip; the encoded document's measured byte length).
      const integrity = events[8];
      if (integrity === undefined || integrity.kind !== "integrity-verified") {
        throw new Error("event 9 was expected to be the integrity-verified event");
      }
      expect(integrity.frameCount).toBe(6);
      expect(integrity.byteLength).toBeGreaterThan(0);
      // The file itself is privacy-clean: every line parses (the closed
      // vocabulary accepted every stored fact — nothing else is on disk).
      expect(content).toContain('"user-feedback"');
    } finally {
      server.stop();
    }
  });

  test("determinism ×2: two fresh servers + cores produce byte-equal telemetry files", async () => {
    async function run(): Promise<string> {
      const telemetryPath = nextTelemetryPath();
      const server = serveViewer({ port: 0, telemetryPath });
      try {
        const core = makeCore(server);
        await goldenWalk(core);
        await settleUntil(() => (server.telemetry?.status().linesWritten ?? 0) >= 13);
        return readFileSync(telemetryPath, "utf8");
      } finally {
        server.stop();
      }
    }
    expect(await run()).toEqual(await run());
  });
});

describe("W706 telemetry e2e — the /telemetry routes' typed answers", () => {
  test("a smuggled sensitive field is refused 400 with the exact reason; garbage is 400; status answers counters", async () => {
    const server = serveViewer({ port: 0, telemetryPath: nextTelemetryPath() });
    try {
      // A well-formed event with a planted authorization policy field.
      const smuggled = {
        schemaVersion: 1,
        kind: "user-feedback",
        sequence: 99,
        atMs: 0,
        sessionId: null,
        feedback: "playback-good",
        authorizationPolicy: { allowedOperations: ["sharing"] },
      };
      const refused = await fetch(`${server.url}/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(smuggled),
      });
      expect(refused.status).toBe(400);
      const refusal = (await refused.json()) as {
        error: { failureClass: string; message: string };
      };
      expect(refusal.error.failureClass).toBe("validation");
      expect(refusal.error.message).toContain("authorizationPolicy");

      const garbage = await fetch(`${server.url}/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json at all",
      });
      expect(garbage.status).toBe(400);

      const status = await fetch(`${server.url}/telemetry`);
      expect(status.status).toBe(200);
      const statusBody = (await status.json()) as {
        enabled: boolean;
        path: string;
        buffered: number;
        linesWritten: number;
      };
      expect(statusBody.enabled).toBe(true);
      expect(statusBody.linesWritten).toBe(0); // the refusals stored nothing
      expect(statusBody.buffered).toBe(0);

      const flush = await fetch(`${server.url}/telemetry/flush`, { method: "POST" });
      expect(flush.status).toBe(200);
      expect(await flush.json()).toEqual({ flushed: 0 });

      // The honest 405 fallback for an unmatched method/sub-path combo.
      const wrongMethod = await fetch(`${server.url}/telemetry/flush`);
      expect(wrongMethod.status).toBe(405);
      const wrongBody = (await wrongMethod.json()) as {
        error: { failureClass: string; message: string };
      };
      expect(wrongBody.error.failureClass).toBe("method-not-allowed");
      expect(wrongBody.error.message).toContain("GET /telemetry");
    } finally {
      server.stop();
    }
  });

  test("a valid hand-POSTed event lands on disk through the route (accepted + flushed)", async () => {
    const telemetryPath = nextTelemetryPath();
    const server = serveViewer({ port: 0, telemetryPath });
    try {
      const event = {
        schemaVersion: 1,
        kind: "state-transition",
        sequence: 1,
        atMs: 1_736_164_800_000,
        sessionId: "sess-1",
        from: "disconnected",
        to: "connecting",
      };
      const accepted = await fetch(`${server.url}/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toEqual({ accepted: true, flushed: 1 });
      const content = readFileSync(telemetryPath, "utf8");
      expect(content).toBe(`${JSON.stringify(event)}\n`);
    } finally {
      server.stop();
    }
  });

  test("telemetryPath: null disables the routes (honest typed 501)", async () => {
    const server = serveViewer({ port: 0, telemetryPath: null });
    try {
      expect(server.telemetry).toBeNull();
      const post = await fetch(`${server.url}/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(post.status).toBe(501);
      const body = (await post.json()) as { error: { failureClass: string } };
      expect(body.error.failureClass).toBe("unsupported-output");
      const get = await fetch(`${server.url}/telemetry`);
      expect(get.status).toBe(501);
    } finally {
      server.stop();
    }
  });
});

describe("W706 telemetry e2e — serveViewer.stop() closes the file sink (flush + seal)", () => {
  test("a programmatically recorded (unflushed) event lands on disk at stop; the sink is sealed after", () => {
    const telemetryPath = nextTelemetryPath();
    const server = serveViewer({ port: 0, telemetryPath });
    const event = {
      schemaVersion: 1,
      kind: "user-feedback",
      sequence: 1,
      atMs: 1_736_164_800_000,
      sessionId: "sess-1",
      feedback: "playback-good",
    } as const;
    // The direct host-side use of the exposed sink (the routes flush per
    // event; this leg records WITHOUT flushing, then stops the server).
    server.telemetry?.record(event);
    expect(server.telemetry?.status().buffered).toBe(1);
    server.stop();
    expect(readFileSync(telemetryPath, "utf8")).toBe(`${JSON.stringify(event)}\n`);
    // Sealed: a later record through the same sink throws fail-loud.
    expect(() => server.telemetry?.record(event)).toThrow(RangeError);
  });
});

describe("W706 telemetry e2e — the default path is outside the repo (dev-grade)", () => {
  test("the default-enabled server exposes its declared path through the status route", async () => {
    // One server with the DEFAULT telemetry path (undefined = default tmp
    // path): the status route answers the honest dev-grade document. The
    // file itself lives outside the repository (no git dirt from tests).
    const server = serveViewer({ port: 0 });
    try {
      const status = await fetch(`${server.url}/telemetry`);
      expect(status.status).toBe(200);
      const body = (await status.json()) as { enabled: boolean; path: string };
      expect(body.enabled).toBe(true);
      expect(body.path).toContain("viewer-telemetry.jsonl");
      expect(body.path.startsWith(tmpdir())).toBe(true);
    } finally {
      server.stop();
    }
  });
});
