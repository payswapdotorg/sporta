/**
 * Telemetry sink tests (W706): the in-memory sink (ordered, validating,
 * isolated), the JSONL file sink (ordered writes, deterministic ids,
 * EXPLICIT flush semantics, fail-loud close), and the HTTP bridge sink
 * (ordered POSTs with deterministic request ids, fire-and-forget failure
 * accounting). The privacy boundary is enforced at EVERY sink: a smuggled
 * sensitive field is rejected before anything is stored or sent.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryTelemetrySink } from "../src/telemetry-sink.ts";
import { createJsonlTelemetryFileSink } from "../src/telemetry-file-sink.ts";
import { createHttpTelemetrySink } from "../src/telemetry-http-sink.ts";
import { parseTelemetryLine, serializeTelemetryEvent } from "../src/telemetry-events.ts";
import type { ViewerTelemetryEvent } from "../src/telemetry-events.ts";

/** One deterministic event builder (hand-authored, non-uniform facts). */
function eventOf(sequence: number, kind: ViewerTelemetryEvent["kind"]): ViewerTelemetryEvent {
  const base = {
    schemaVersion: 1 as const,
    sequence,
    atMs: 1_736_164_800_000 + sequence,
    sessionId: sequence % 2 === 0 ? null : "sess-1",
  };
  switch (kind) {
    case "state-transition":
      return { ...base, kind, from: "connecting", to: "browsing-sessions" };
    case "operation-timing":
      return { ...base, kind, operation: "connect", durationMs: 25 * sequence };
    case "error-occurred":
      return {
        ...base,
        kind,
        operation: "selectRender",
        failureClass: "media-invalid",
        message: `deterministic failure ${String(sequence)}`,
        remediationHint:
          "The request or the stored output was rejected as invalid. Try a different renderer/profile or re-render; if it persists, the artifact may be corrupt.",
      };
    case "rebuffer-stall":
      return {
        ...base,
        kind,
        frameIndex: sequence % 6,
        frameCount: 6,
        availableFrames: sequence % 7,
      };
    case "integrity-verified":
      return { ...base, kind, byteLength: 1_000 + sequence, frameCount: 6 };
    case "user-feedback":
      return { ...base, kind, feedback: "playback-good" };
  }
}

/** The temp directory root for the file-sink tests (cleaned in afterAll). */
const TEMP_ROOT = join(tmpdir(), "sporta-w706-telemetry-sink-test");
/** Deterministic per-test directories (a counter — no Math.random). */
let dirCounter = 0;
function tempPath(name: string): string {
  const dir = join(TEMP_ROOT, name);
  mkdirSync(dir, { recursive: true });
  return join(dir, "telemetry.jsonl");
}
function nextTempPath(): string {
  dirCounter += 1;
  return tempPath(`case-${String(dirCounter)}`);
}

afterAll(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

describe("in-memory telemetry sink", () => {
  test("records events in order, deep-equal", () => {
    const sink = createInMemoryTelemetrySink();
    const events = [
      eventOf(1, "state-transition"),
      eventOf(2, "operation-timing"),
      eventOf(3, "user-feedback"),
    ];
    for (const event of events) sink.record(event);
    expect(sink.events).toEqual(events);
  });

  test("the stored event is a CLONE — mutating the caller's object cannot rewrite history", () => {
    const sink = createInMemoryTelemetrySink();
    const event = eventOf(1, "state-transition");
    sink.record(event);
    const stored = sink.events[0] as unknown as Record<string, unknown>;
    (event as unknown as Record<string, unknown>).to = "error";
    expect(stored.to).toBe("browsing-sessions");
  });

  test("an event with a smuggled sensitive field is rejected fail-loud, nothing stored", () => {
    const sink = createInMemoryTelemetrySink();
    const smuggled = {
      ...eventOf(1, "state-transition"),
      authorizationPolicy: { allowedOperations: ["sharing"] },
    } as unknown as ViewerTelemetryEvent;
    expect(() => sink.record(smuggled)).toThrow(RangeError);
    expect(() => sink.record(smuggled)).toThrow("authorizationPolicy");
    expect(sink.events).toHaveLength(0);
  });
});

describe("JSONL telemetry file sink — explicit flush semantics", () => {
  test("nothing is on disk until flush; flush writes every buffered line in record order", () => {
    const path = nextTempPath();
    const sink = createJsonlTelemetryFileSink({ path });
    const events = [
      eventOf(1, "state-transition"),
      eventOf(2, "rebuffer-stall"),
      eventOf(3, "integrity-verified"),
    ];
    for (const event of events) sink.record(event);
    expect(sink.status()).toEqual({ path, buffered: 3, linesWritten: 0 });

    const result = sink.flush();
    expect(result).toEqual({ linesWritten: 3 });
    expect(sink.status()).toEqual({ path, buffered: 0, linesWritten: 3 });

    const content = readFileSync(path, "utf8");
    const lines = content.split("\n");
    expect(lines).toHaveLength(4); // 3 lines + the trailing empty split tail
    expect(content.endsWith("\n")).toBe(true);
    const parsed = lines.filter((line) => line.length > 0).map((line) => parseTelemetryLine(line));
    for (const outcome of parsed) expect(outcome.ok).toBe(true);
    expect(parsed.map((outcome) => (outcome.ok ? outcome.event : null))).toEqual(events);
  });

  test("the line form is exactly the event's JSON serialization (byte pin)", () => {
    const path = nextTempPath();
    const sink = createJsonlTelemetryFileSink({ path });
    const event = eventOf(1, "operation-timing");
    sink.record(event);
    sink.flush();
    expect(readFileSync(path, "utf8")).toBe(`${serializeTelemetryEvent(event)}\n`);
  });

  test("flushing an empty buffer writes nothing and reports 0 (idempotent)", () => {
    const path = nextTempPath();
    const sink = createJsonlTelemetryFileSink({ path });
    expect(sink.flush()).toEqual({ linesWritten: 0 });
    expect(sink.flush()).toEqual({ linesWritten: 0 });
    // The file is created by the first flush WITH lines, never before.
    expect(() => readFileSync(path, "utf8")).toThrow();
  });

  test("cumulative appends: flush, record more, flush again — order preserved", () => {
    const path = nextTempPath();
    const sink = createJsonlTelemetryFileSink({ path });
    for (const event of [eventOf(1, "state-transition")]) sink.record(event);
    expect(sink.flush()).toEqual({ linesWritten: 1 });
    for (const event of [eventOf(2, "user-feedback"), eventOf(3, "error-occurred")]) {
      sink.record(event);
    }
    expect(sink.flush()).toEqual({ linesWritten: 2 });
    expect(sink.status()).toEqual({ path, buffered: 0, linesWritten: 3 });
    const lines = readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(3);
    const sequences = lines.map((line) => {
      const outcome = parseTelemetryLine(line);
      return outcome.ok ? outcome.event.sequence : null;
    });
    expect(sequences).toEqual([1, 2, 3]);
  });

  test("close flushes + seals: recording after close throws fail-loud; idempotent", () => {
    const path = nextTempPath();
    const sink = createJsonlTelemetryFileSink({ path });
    sink.record(eventOf(1, "state-transition"));
    expect(sink.close()).toEqual({ linesWritten: 1 });
    expect(() => sink.record(eventOf(2, "state-transition"))).toThrow(RangeError);
    expect(sink.close()).toEqual({ linesWritten: 0 });
    expect(sink.flush()).toEqual({ linesWritten: 0 });
    expect(sink.status()).toEqual({ path, buffered: 0, linesWritten: 1 });
  });

  test("an event with a smuggled sensitive field is rejected before buffering", () => {
    const path = nextTempPath();
    const sink = createJsonlTelemetryFileSink({ path });
    const smuggled = {
      ...eventOf(1, "user-feedback"),
      frames: ["<svg>frame bytes</svg>"],
    } as unknown as ViewerTelemetryEvent;
    expect(() => sink.record(smuggled)).toThrow(RangeError);
    expect(sink.status()).toEqual({ path, buffered: 0, linesWritten: 0 });
  });

  test("creates the declared path's parent directories", () => {
    const root = mkdtempSync(join(tmpdir(), "sporta-w706-nested-"));
    try {
      const path = join(root, "a", "b", "c", "telemetry.jsonl");
      const sink = createJsonlTelemetryFileSink({ path });
      sink.record(eventOf(1, "state-transition"));
      sink.flush();
      expect(readFileSync(path, "utf8")).toContain('"state-transition"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("HTTP telemetry bridge sink (injectable fetch)", () => {
  /** One recorded POST call. */
  interface PostedCall {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  }

  function recordingFetch(outcomes: Array<{ status: number } | { error: Error }>): {
    fetch: typeof fetch;
    calls: PostedCall[];
  } {
    const calls: PostedCall[] = [];
    const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === "string" ? init.body : "",
      });
      const outcome = outcomes.shift() ?? { status: 200 };
      if ("error" in outcome) throw outcome.error;
      return new Response(JSON.stringify({ accepted: true }), {
        status: outcome.status,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return { fetch: doFetch, calls };
  }

  /** Lets the sink's ordered dispatch chain drain. */
  async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  test("records POST each event in order with deterministic request ids and exact bodies", async () => {
    const { fetch, calls } = recordingFetch([{ status: 200 }, { status: 200 }, { status: 200 }]);
    const sink = createHttpTelemetrySink({ baseUrl: "/telemetry", fetch });
    const events = [
      eventOf(1, "state-transition"),
      eventOf(2, "error-occurred"),
      eventOf(3, "user-feedback"),
    ];
    for (const event of events) sink.record(event);
    await settle();
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.method)).toEqual(["POST", "POST", "POST"]);
    expect(calls.map((call) => call.url)).toEqual(["/telemetry", "/telemetry", "/telemetry"]);
    expect(calls.map((call) => call.headers["x-request-id"])).toEqual([
      "viewer-tel-1",
      "viewer-tel-2",
      "viewer-tel-3",
    ]);
    expect(calls.map((call) => call.body)).toEqual(events.map(serializeTelemetryEvent));
    expect(sink.status()).toEqual({ posted: 3, failed: 0, lastFailure: null });
  });

  test("non-2xx answers and network failures are COUNTED, never thrown; playback of events continues", async () => {
    const { fetch, calls } = recordingFetch([
      { status: 503 },
      { error: new Error("connection refused") },
      { status: 200 },
    ]);
    const sink = createHttpTelemetrySink({ baseUrl: "/telemetry", fetch });
    sink.record(eventOf(1, "state-transition"));
    sink.record(eventOf(2, "operation-timing"));
    sink.record(eventOf(3, "state-transition"));
    await settle();
    expect(calls).toHaveLength(3); // fire-and-forget: every event still dispatched
    const status = sink.status();
    expect(status.posted).toBe(1);
    expect(status.failed).toBe(2);
    expect(status.lastFailure).not.toBe(null);
  });

  test("a SYNCHRONOUS throw from the fetch seam is one counted failure — the chain is never poisoned (the next event still dispatches, no unhandled rejection)", async () => {
    // A fetch seam that throws synchronously (e.g. an invalid URL rejected
    // before a promise exists). Before the guard this POISONED the dispatch
    // chain: the throw rejected `chain`, every later event silently never
    // dispatched, and the rejection escaped unhandled (probe-confirmed it
    // could kill the host process — the never-take-the-viewer-down
    // principle violated).
    let calls = 0;
    const syncThrowThenOk = ((): typeof fetch => {
      let thrown = false;
      // NOT async: the first call throws SYNCHRONOUSLY (before any promise
      // exists — the exact poison case); later calls answer 200. The fetch
      // seam's arguments are irrelevant here (the URL is in the closure).
      const doFetch = (() => {
        calls += 1;
        if (!thrown) {
          thrown = true;
          throw new TypeError("Failed to parse URL from /relative");
        }
        return Promise.resolve(new Response(JSON.stringify({ accepted: true }), { status: 200 }));
      }) as unknown as typeof fetch;
      return doFetch;
    })();
    const sink = createHttpTelemetrySink({ baseUrl: "/telemetry", fetch: syncThrowThenOk });
    sink.record(eventOf(1, "state-transition"));
    await settle();
    expect(sink.status()).toEqual({
      posted: 0,
      failed: 1,
      lastFailure: expect.stringContaining("telemetry post threw"),
    });
    // The chain survived: the second event dispatches and posts.
    sink.record(eventOf(2, "user-feedback"));
    await settle();
    expect(calls).toBe(2);
    expect(sink.status()).toEqual({ posted: 1, failed: 1, lastFailure: expect.any(String) });
  });

  test("an invalid event throws BEFORE any wire traffic (the privacy boundary)", () => {
    const { fetch, calls } = recordingFetch([{ status: 200 }]);
    const sink = createHttpTelemetrySink({ baseUrl: "/telemetry", fetch });
    const smuggled = {
      ...eventOf(1, "state-transition"),
      policy: { policyId: "policy-full-allow" },
    } as unknown as ViewerTelemetryEvent;
    expect(() => sink.record(smuggled)).toThrow(RangeError);
    expect(calls).toHaveLength(0);
  });
});
