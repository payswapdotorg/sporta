import { describe, expect, test } from "bun:test";
import {
  SSE_KEEPALIVE,
  createSseParser,
  encodeSseEvent,
  encodeSseJson,
  ssePayloadOf,
} from "../src/lib/live-sse";
import type { LiveFrameDoc, LiveHelloDoc } from "../src/lib/live-sse";

/**
 * LIVE SSE WIRE-FORMAT TESTS (W915) — the grammar every side shares: the
 * server encoder, the parser the tests/evidence use, and (through the same
 * bytes) the browser's native EventSource. What curl reads is what the
 * browser reads — pinned here.
 */

test("a JSON event encodes as the exact SSE block (event + id + data + blank line)", () => {
  const block = encodeSseJson("hello", "sess-1", { sessionId: "sess-1", cadenceMs: 500 });
  expect(block).toBe(
    `event: hello\nid: sess-1\ndata: ${JSON.stringify({ sessionId: "sess-1", cadenceMs: 500 })}\n\n`,
  );
});

test("an event without an id omits the id line", () => {
  const block = encodeSseEvent({ event: "close", data: "{}" });
  expect(block).toBe('event: close\ndata: {}\n\n');
});

test("multi-line payloads split into consecutive data lines (SSE spec)", () => {
  const block = encodeSseEvent({ event: "frame", id: "3", data: "line1\nline2\nline3" });
  expect(block).toBe("event: frame\nid: 3\ndata: line1\ndata: line2\ndata: line3\n\n");
});

test("the keepalive is a comment block (ignored by consumers)", () => {
  expect(SSE_KEEPALIVE).toBe(": keepalive\n\n");
  const parser = createSseParser();
  expect(parser.write(SSE_KEEPALIVE)).toEqual([]);
});

test("a complete stream round-trips: hello + frames + close", () => {
  const parser = createSseParser();
  const hello: LiveHelloDoc = {
    schemaVersion: "sporta.live-sse/1",
    sessionId: "sess-x",
    label: "Derby night",
    storyKey: "derby",
    cadenceMs: 250,
    bufferDepth: 8,
    openedAtMs: 1_000,
  };
  const frame: LiveFrameDoc = {
    schemaVersion: "sporta.live-sse/1",
    sessionId: "sess-x",
    ordinal: 1,
    storyStepIndex: 0,
    storyAtMs: 1_000,
    svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
    byteLength: 45,
    generatedAtMs: 1_250,
    renderDurationMs: 3,
  };
  const wire =
    encodeSseJson("hello", "sess-x", hello) +
    encodeSseJson("frame", "1", frame) +
    encodeSseJson("close", undefined, { reason: "transport-closed", deliveredFrames: 1, droppedFrames: 0 });

  const events = parser.write(wire);
  expect(events.map((event) => event.event)).toEqual(["hello", "frame", "close"]);
  expect(events[0]!.id).toBe("sess-x");
  expect(events[1]!.id).toBe("1");
  expect(events[2]!.id).toBeUndefined();
  expect(ssePayloadOf<LiveHelloDoc>(events[0]!)).toEqual(hello);
  expect(ssePayloadOf<LiveFrameDoc>(events[1]!)).toEqual(frame);
});

test("chunked delivery reassembles blocks split at arbitrary byte offsets", () => {
  const parser = createSseParser();
  const wire =
    encodeSseJson("frame", "1", { svg: "a\nb", ordinal: 1 }) +
    encodeSseJson("frame", "2", { svg: "c", ordinal: 2 });
  // Split mid-token at 7, then 40 — nothing is lost or duplicated.
  const first = parser.write(wire.slice(0, 7));
  expect(first).toEqual([]);
  const second = parser.write(wire.slice(7, 40));
  const third = parser.write(wire.slice(40));
  const events = [...second, ...third];
  expect(events.map((event) => event.event)).toEqual(["frame", "frame"]);
  expect(events.map((event) => event.id)).toEqual(["1", "2"]);
  expect(ssePayloadOf<{ svg: string }>(events[0]!).svg).toBe("a\nb"); // data lines rejoined
});

test("a trailing block without its blank line is emitted only at end()", () => {
  const parser = createSseParser();
  expect(parser.write('event: close\ndata: {"reason":"transport-closed"}')).toEqual([]);
  const trailing = parser.end();
  expect(trailing).toHaveLength(1);
  expect(trailing[0]!.event).toBe("close");
});

test("CR-LF line endings are handled (the SSE grammar strips the CR)", () => {
  const parser = createSseParser();
  const events = parser.write('event: frame\r\nid: 1\r\ndata: {"a":1}\r\n\r\n');
  expect(events).toHaveLength(1);
  expect(events[0]!.event).toBe("frame");
  expect(events[0]!.id).toBe("1");
  expect(events[0]!.data).toBe('{"a":1}');
});

describe("createSseParser", () => {
  test("comment lines and blank blocks produce no events (never a guess)", () => {
    const parser = createSseParser();
    expect(parser.write(": heartbeat\n\n\n\n: another\n\n")).toEqual([]);
    expect(parser.end()).toEqual([]);
  });
});
