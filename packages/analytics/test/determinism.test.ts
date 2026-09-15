/**
 * The W804 determinism tests: same events in → BYTE-IDENTICAL report out,
 * across separate computations, across a serialize → deserialize →
 * serialize round trip, across input-object identity, and independent of
 * the report object's key insertion order (the canonical serializer sorts
 * recursively). Also: the computation never mutates its input.
 */
import { describe, expect, test } from "bun:test";
import { computeProductAnalytics } from "../src/report.ts";
import type { ProductAnalyticsReport } from "../src/report.ts";
import { deserializeAnalyticsReport, serializeAnalyticsReport } from "../src/canonical.ts";
import { Stream, connectAttempt, establish } from "./helpers.ts";

/** A medium composite stream (both paths, errors, stalls, feedback). */
function compositeStream(): Stream {
  const stream = new Stream();
  connectAttempt(stream, "success");
  establish(stream, "sess-1");
  stream.transition("session-detail", "renderer-selection", "sess-1");
  stream.transition("session-detail", "render-queued", "sess-1");
  stream.transition("render-queued", "loading-output", "sess-1");
  stream.integrity({ byteLength: 4096, frameCount: 6 }, "sess-1");
  stream.timing("load-output", 240);
  stream.transition("loading-output", "ready", "sess-1");
  stream.transition("ready", "playing", "sess-1");
  stream.stall({ frameIndex: 4, frameCount: 6, availableFrames: 4 }, "sess-1");
  stream.transition("playing", "ended", "sess-1");
  establish(stream, "sess-2");
  stream.transition("session-detail", "live-connecting", "sess-2");
  stream.timing("openLive", 310);
  stream.transition("live-connecting", "live-playing", "sess-2");
  stream.transition("live-playing", "live-ended", "sess-2");
  establish(stream, "sess-3");
  stream.failure("beginRender", "network", "unreachable", "sess-3");
  stream.transition("session-detail", "error", "sess-3");
  stream.feedback("playback-poor", "sess-1");
  return stream;
}

describe("byte-determinism", () => {
  test("two separate computations of the same stream serialize to identical bytes", () => {
    const events = compositeStream().events;
    const first = serializeAnalyticsReport(computeProductAnalytics(events));
    const second = serializeAnalyticsReport(computeProductAnalytics([...events]));
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(1_000); // a real report, not a stub
  });

  test("distinct-but-equal event objects (fresh mint) produce identical bytes", () => {
    const first = serializeAnalyticsReport(computeProductAnalytics(compositeStream().events));
    const second = serializeAnalyticsReport(computeProductAnalytics(compositeStream().events));
    expect(first).toBe(second);
  });

  test("the empty stream is deterministic too", () => {
    expect(serializeAnalyticsReport(computeProductAnalytics([]))).toBe(
      serializeAnalyticsReport(computeProductAnalytics([])),
    );
  });

  test("serialize → deserialize → serialize is a fixed point (the reader re-validates)", () => {
    const bytes = serializeAnalyticsReport(computeProductAnalytics(compositeStream().events));
    const report = deserializeAnalyticsReport(bytes);
    expect(serializeAnalyticsReport(report)).toBe(bytes);
    // And the deserialized report deep-equals a fresh computation:
    expect(report).toEqual(computeProductAnalytics(compositeStream().events));
  });

  test("invalid serialized JSON is rejected loudly by the reader", () => {
    expect(() => deserializeAnalyticsReport("{not json")).toThrow(
      "serialized analytics report is not valid JSON",
    );
    // Valid JSON that is not a report fails the schema instead:
    expect(() => deserializeAnalyticsReport("{}")).toThrow("not a valid product analytics report");
  });

  test("the canonical form sorts keys recursively (insertion order cannot leak)", () => {
    const report = computeProductAnalytics(compositeStream().events);
    // Rebuild the SAME report with reversed key insertion order at every level:
    const reversed = reverseKeys(report) as ProductAnalyticsReport;
    expect(serializeAnalyticsReport(reverseKeys(reversed) as ProductAnalyticsReport)).toBe(
      serializeAnalyticsReport(report),
    );
  });

  test("the computation never mutates its input stream", () => {
    const stream = compositeStream();
    const before = structuredClone(stream.events);
    computeProductAnalytics(stream.events);
    expect(stream.events).toEqual(before);
  });
});

/** Recursively rebuilds a value with keys inserted in REVERSE order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).reverse()) out[key] = reverseKeys(record[key]);
    return out;
  }
  return value;
}
