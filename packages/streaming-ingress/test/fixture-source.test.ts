/**
 * FixtureLiveSource unit tests (W301): the deterministic simulated live feed
 * — schedule order, virtual arrival waits, natural end-of-feed, orderly
 * `stop()` (idempotent, ends after the in-flight delivery), one-shot
 * semantics, spec validation (fail-loud authoring checks), and replay
 * determinism (a fresh instance of the same spec delivers deep-equal).
 */
import { describe, expect, test } from "bun:test";
import { FixtureLiveSource, VirtualClock } from "../src/index";
import type { LiveSegment } from "../src/types";
import type { LiveSourceDescription } from "../src/source";
import { audioSegment, drainMicrotasks, videoSegment } from "./helpers";

/** A simple 3-entry video schedule with arrivals 100/140/180. */
function simpleSchedule() {
  return [
    { arrivalMs: 100, segment: videoSegment("v0", 0, 0) },
    { arrivalMs: 140, segment: videoSegment("v1", 40, 1) },
    { arrivalMs: 180, segment: videoSegment("v2", 80, 2) },
  ];
}

/** Pulls the whole iterable (optionally with a stop after `stopAfter` items). */
async function collect(
  source: FixtureLiveSource,
  stopAfter?: number,
): Promise<{ segments: LiveSegment[]; times: number[] }> {
  const segments: LiveSegment[] = [];
  const times: number[] = [];
  for await (const segment of source.segments()) {
    segments.push(segment);
    times.push(-1);
    if (stopAfter !== undefined && segments.length === stopAfter) {
      source.stop();
    }
  }
  return { segments, times };
}

describe("FixtureLiveSource — schedule delivery", () => {
  test("delivers the schedule in order and ends naturally", async () => {
    const clock = new VirtualClock(0);
    const source = new FixtureLiveSource({ label: "feed", schedule: simpleSchedule() }, clock);
    const pulled: LiveSegment[] = [];
    const clockAfterEach: number[] = [];
    for await (const segment of source.segments()) {
      pulled.push(segment);
      clockAfterEach.push(clock.now());
    }
    expect(pulled.map((s) => s.segmentId)).toEqual(["v0", "v1", "v2"]);
    // The shared virtual clock advanced to each authored arrival as the
    // generator awaited it — measured arrivals equal authored arrivals.
    expect(clockAfterEach).toEqual([100, 140, 180]);
  });

  test("description announces label and first-appearance media kinds", () => {
    const clock = new VirtualClock(0);
    const source = new FixtureLiveSource(
      {
        label: "av-feed",
        schedule: [
          { arrivalMs: 0, segment: videoSegment("v0", 0, 0) },
          { arrivalMs: 10, segment: audioSegment("a0", 0, 0) },
          { arrivalMs: 20, segment: videoSegment("v1", 40, 1) },
        ],
      },
      clock,
    );
    const description: LiveSourceDescription = source.description;
    expect(description.label).toBe("av-feed");
    expect(description.mediaKinds).toEqual(["video", "audio"]);
  });

  test("an empty schedule is a valid feed that ends immediately", async () => {
    const clock = new VirtualClock(0);
    const source = new FixtureLiveSource({ label: "empty", schedule: [] }, clock);
    const { segments } = await collect(source);
    expect(segments).toEqual([]);
  });
});

describe("FixtureLiveSource — stop()", () => {
  test("stop() ends the iterable after the in-flight delivery", async () => {
    const clock = new VirtualClock(0);
    const source = new FixtureLiveSource({ label: "feed", schedule: simpleSchedule() }, clock);
    const { segments } = await collect(source, 2);
    expect(segments.map((s) => s.segmentId)).toEqual(["v0", "v1"]); // v2 never delivered
  });

  test("stop() before the first pull ends the feed immediately", async () => {
    const clock = new VirtualClock(0);
    const source = new FixtureLiveSource({ label: "feed", schedule: simpleSchedule() }, clock);
    source.stop();
    const { segments } = await collect(source);
    expect(segments).toEqual([]);
  });

  test("stop() is idempotent", async () => {
    const clock = new VirtualClock(0);
    const source = new FixtureLiveSource({ label: "feed", schedule: simpleSchedule() }, clock);
    source.stop();
    source.stop();
    const { segments } = await collect(source);
    expect(segments).toEqual([]);
  });

  test("stop() before segments() is opened suppresses the whole schedule", async () => {
    const clock = new VirtualClock(0);
    const source = new FixtureLiveSource({ label: "feed", schedule: simpleSchedule() }, clock);
    const iterator = source.segments()[Symbol.asyncIterator]();
    source.stop();
    const first = await iterator.next();
    expect(first.done).toBe(true);
  });
});

describe("FixtureLiveSource — one-shot semantics + validation", () => {
  test("segments() is one-shot: a second call fails loud", async () => {
    const clock = new VirtualClock(0);
    const source = new FixtureLiveSource({ label: "feed", schedule: simpleSchedule() }, clock);
    const first = await source.segments()[Symbol.asyncIterator]().next();
    expect(first.done).toBe(false);
    expect(() => source.segments()).toThrow(/one-shot live feed/);
  });

  test("rejects an empty label", () => {
    const clock = new VirtualClock(0);
    expect(() => new FixtureLiveSource({ label: "", schedule: [] }, clock)).toThrow(RangeError);
  });

  test("rejects non-finite and negative arrival times", () => {
    const clock = new VirtualClock(0);
    expect(
      () =>
        new FixtureLiveSource(
          { label: "f", schedule: [{ arrivalMs: Number.NaN, segment: videoSegment("v", 0, 0) }] },
          clock,
        ),
    ).toThrow(RangeError);
    expect(
      () =>
        new FixtureLiveSource(
          { label: "f", schedule: [{ arrivalMs: -1, segment: videoSegment("v", 0, 0) }] },
          clock,
        ),
    ).toThrow(RangeError);
  });

  test("rejects decreasing arrival times (a live wire is monotone in arrival)", () => {
    const clock = new VirtualClock(0);
    expect(
      () =>
        new FixtureLiveSource(
          {
            label: "f",
            schedule: [
              { arrivalMs: 100, segment: videoSegment("v0", 0, 0) },
              { arrivalMs: 99, segment: videoSegment("v1", 40, 1) },
            ],
          },
          clock,
        ),
    ).toThrow(/non-decreasing/);
  });

  test("rejects entries without a segment id or with an unknown kind", () => {
    const clock = new VirtualClock(0);
    expect(
      () =>
        new FixtureLiveSource(
          {
            label: "f",
            schedule: [
              {
                arrivalMs: 0,
                segment: { segmentId: "", kind: "video", frame: videoSegment("v", 0, 0).frame },
              },
            ],
          },
          clock,
        ),
    ).toThrow(/segmentId/);
    expect(
      () =>
        new FixtureLiveSource(
          {
            label: "f",
            schedule: [
              { arrivalMs: 0, segment: { segmentId: "x", kind: "data" } as unknown as LiveSegment },
            ],
          },
          clock,
        ),
    ).toThrow(/kind/);
  });
});

describe("FixtureLiveSource — replay determinism", () => {
  test("fresh instances of the same spec deliver deep-equal sequences", async () => {
    const schedule = [
      { arrivalMs: 0, segment: videoSegment("v0", 0, 0) },
      { arrivalMs: 40, segment: audioSegment("a0", 0, 0) },
      { arrivalMs: 80, segment: videoSegment("v1", 40, 1) },
      { arrivalMs: 120, segment: audioSegment("a1", 100, 1) },
    ];
    const first: LiveSegment[] = [];
    const second: LiveSegment[] = [];
    for await (const segment of new FixtureLiveSource(
      { label: "r", schedule },
      new VirtualClock(),
    ).segments()) {
      first.push(segment);
    }
    for await (const segment of new FixtureLiveSource(
      { label: "r", schedule },
      new VirtualClock(),
    ).segments()) {
      second.push(segment);
    }
    expect(first).toEqual(second);
    expect(first.map((s) => s.segmentId)).toEqual(["v0", "a0", "v1", "a1"]);
  });

  test("waiting is virtual: no real time passes (microtask draining suffices)", async () => {
    const clock = new VirtualClock(0);
    const source = new FixtureLiveSource(
      {
        label: "far-future",
        schedule: [{ arrivalMs: 1_000_000, segment: videoSegment("v0", 0, 0) }],
      },
      clock,
    );
    // 200 microtask ticks, zero real waiting — the far-future arrival is
    // reached the moment its wait registers.
    await drainMicrotasks(200);
    const first = await source.segments()[Symbol.asyncIterator]().next();
    expect(first.done).toBe(false);
    expect(clock.now()).toBe(1_000_000);
  });
});
