/**
 * Integration tests (W301): fixture live source → streaming ingest service →
 * normalized segment stream. THE acceptance-criterion test class:
 *
 * for every fixture segment, the normalized output payload DEEP-EQUALS the
 * authored upstream segment — timestamps VERBATIM (byte-for-byte frames,
 * element-exact audio samples, every field unchanged). The service MEASURES
 * the arrival-clock vs upstream-timestamp relationship (`arrivalLagMs`,
 * reported on the receipt and in the arrival-lag histogram) but never
 * rewrites upstream time; W103 timeline correlation is downstream territory.
 *
 * Also: bounded-channel behavior under burst (block policy, parked pump,
 * bounded memory, in-order verbatim delivery).
 */
import { describe, expect, test } from "bun:test";
import { StageMessage as StageMessageSchema } from "@sporta/contracts";
import type { StageMessage } from "@sporta/contracts";
import { STREAMING_METRIC_NAMES as METRICS } from "../src/index";
import type {
  IngestedLiveAudioSegment,
  IngestedLiveSegment,
  IngestedLiveVideoSegment,
  LiveSegment,
} from "../src/types";
import {
  audioSegment,
  capturedObservability,
  drainChannel,
  laggedFeed,
  payloadOf,
  scheduleOf,
  until,
  videoSegment,
  wiredService,
} from "./helpers";

const SESSION_ID = "sess-w301-integration";

/** A constant live-arrival lag: arrivals authored `LAG_MS` after upstream. */
const LAG_MS = 1_500;

/**
 * A 12-entry mixed A/V feed, arrivals = upstream + 1500 ms, with ONE entry
 * whose upstream timestamp is EARLIER than a previously delivered segment's
 * (multi-track interleave: an audio chunk at 60 arrives after a video frame
 * at 80 — realistic, and proof that upstream ordering is never "fixed").
 */
function mixedFeed(): { arrivalMs: number; segment: LiveSegment }[] {
  const segments: LiveSegment[] = [
    videoSegment("v0", 0, 0),
    videoSegment("v1", 40, 1),
    audioSegment("a0", 60, 0),
    videoSegment("v2", 80, 2),
    videoSegment("v3", 120, 3),
    audioSegment("a1", 140, 1),
    videoSegment("v4", 160, 4),
    videoSegment("v5", 200, 5),
    audioSegment("a2", 220, 2),
    videoSegment("v6", 240, 6),
    videoSegment("v7", 280, 7),
    audioSegment("a3", 300, 3),
  ];
  const upstreamTimes = [0, 40, 60, 80, 120, 140, 160, 200, 220, 240, 280, 300];
  return laggedFeed(segments, LAG_MS, upstreamTimes);
}

/** The upstream timestamp a segment was authored with. */
function authoredUpstreamMs(segment: LiveSegment): number {
  return segment.kind === "video" ? segment.frame.presentationMs : segment.chunk.startMs;
}

describe("fixture source → service → normalized stream — timestamps VERBATIM", () => {
  test("every fixture segment's normalized output deep-equals the authored upstream segment", async () => {
    const schedule = mixedFeed();
    const { service, channel } = wiredService({ sessionId: SESSION_ID, schedule });
    service.start();
    const result = await service.done();
    expect(result.outcome).toBe("completed");
    expect(result.stats).toMatchObject({ segmentsIn: 12, segmentsOut: 12, rejected: 0 });

    const received = await drainChannel(channel);
    expect(received).toHaveLength(12);
    // Delivery order = authored schedule order, ids intact.
    expect(received.map((m) => payloadOf(m).segmentId)).toEqual([
      "v0",
      "v1",
      "a0",
      "v2",
      "v3",
      "a1",
      "v4",
      "v5",
      "a2",
      "v6",
      "v7",
      "a3",
    ]);

    // THE acceptance criterion, per segment: the normalized payload is the
    // authored upstream payload, DEEP-EQUAL — timestamps and all. Bun's
    // toEqual compares Uint8Array/Float32Array by CONTENT, so this proves
    // byte-for-byte frame equality and element-exact sample equality.
    for (const [index, message] of received.entries()) {
      const authored = schedule[index]!.segment;
      const payload = payloadOf(message);
      expect(payload.segmentId).toBe(authored.segmentId);
      expect(payload.kind).toBe(authored.kind);
      if (payload.kind === "video" && authored.kind === "video") {
        const ingested: IngestedLiveVideoSegment["frame"] = payload.frame;
        expect(ingested).toEqual(authored.frame);
        // The strongest form of verbatim: the very same frame object (no
        // defensive copy, no re-stamp, no rebuild anywhere on the path).
        expect(ingested).toBe(authored.frame);
        // The accept criterion, spelled out: the upstream timestamp field of
        // the emitted segment IS the authored value, exactly.
        expect(ingested.presentationMs).toBe(authored.frame.presentationMs);
      } else if (payload.kind === "audio" && authored.kind === "audio") {
        const ingested: IngestedLiveAudioSegment["chunk"] = payload.chunk;
        expect(ingested).toEqual(authored.chunk);
        expect(ingested).toBe(authored.chunk);
        expect(ingested.startMs).toBe(authored.chunk.startMs);
      } else {
        throw new Error(`kind mismatch at index ${index}: ${String(payload.kind)}`);
      }
      // The stage message's watermark is the payload's OWN upstream position.
      expect(message.watermark?.watermarkMs).toBe(authoredUpstreamMs(authored));
      // The receipt's upstream timestamp is the same verbatim value.
      expect(payload.receipt.upstreamMs).toBe(authoredUpstreamMs(authored));
      // Contract shape still holds for every emitted message.
      expect(() => StageMessageSchema.parse(message)).not.toThrow();
    }
  });

  test("upstream timestamps stay verbatim even when they arrive out of order", async () => {
    // a0 carries upstream 60 but arrives AFTER v2 (upstream 80): the service
    // delivers both verbatim — no reordering, no clamping, no re-stamping to
    // force monotone upstream time (that is downstream W004/W103 territory).
    const schedule = mixedFeed();
    const { service, channel } = wiredService({ sessionId: SESSION_ID, schedule });
    service.start();
    await service.done();
    const received = await drainChannel(channel);
    const a0 = received.find((m) => payloadOf(m).segmentId === "a0");
    const v2 = received.find((m) => payloadOf(m).segmentId === "v2");
    expect(a0).toBeDefined();
    expect(v2).toBeDefined();
    if (a0 !== undefined && v2 !== undefined) {
      const a0Payload = payloadOf(a0);
      expect(a0Payload.kind).toBe("audio");
      if (a0Payload.kind === "audio") {
        expect(a0Payload.chunk.startMs).toBe(60);
      }
      const v2Payload = payloadOf(v2);
      expect(v2Payload.kind).toBe("video");
      if (v2Payload.kind === "video") {
        expect(v2Payload.frame.presentationMs).toBe(80);
      }
    }
    // Watermarks follow each payload's OWN time (80 then 60 — not forced
    // monotone by the boundary):
    expect(received.map((m) => m.watermark?.watermarkMs)).toEqual([
      0, 40, 60, 80, 120, 140, 160, 200, 220, 240, 280, 300,
    ]);
  });

  test("arrival lag is MEASURED and reported per segment — never corrected", async () => {
    const schedule = mixedFeed();
    const obs = capturedObservability();
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule,
      observability: obs.options,
    });
    service.start();
    const result = await service.done();

    const received = await drainChannel(channel);

    // Every receipt reports the authored relationship exactly: arrival =
    // upstream + 1500, upstream VERBATIM (never rewritten to arrival time).
    for (const [index, entry] of schedule.entries()) {
      const receipt = service.receipt(entry.segment.segmentId);
      expect(receipt).toBeDefined();
      if (receipt === undefined) continue;
      expect(receipt.upstreamMs).toBe(authoredUpstreamMs(entry.segment));
      expect(receipt.arrivalMs).toBe(authoredUpstreamMs(entry.segment) + LAG_MS);
      expect(receipt.arrivalLagMs).toBe(LAG_MS);
      expect(receipt.arrivalMs).not.toBe(receipt.upstreamMs); // measurement ≠ re-stamp
      // …and the emitted payload still carries the ORIGINAL time (the lag was
      // reported, not applied).
      const message = received[index];
      expect(message).toBeDefined();
      if (message !== undefined) {
        expect(payloadOf(message).receipt).toEqual(receipt);
        if (entry.segment.kind === "video") {
          const payload = payloadOf(message);
          if (payload.kind === "video") {
            expect(payload.frame.presentationMs).toBe(entry.segment.frame.presentationMs);
          }
        }
      }
    }
    expect(result.stats.segmentsOut).toBe(12);

    // The arrival-lag histogram observed every accepted segment with the
    // measured value (12 observations, min = max = 1500 — authored).
    const histogram = obs.metrics
      .snapshot()
      .histograms.find((h) => h.name === METRICS.arrivalLagMs);
    expect(histogram?.stats.count).toBe(12);
    expect(histogram?.stats.min).toBe(LAG_MS);
    expect(histogram?.stats.max).toBe(LAG_MS);
  });

  test("jittered arrival lag is measured per segment (no constant-lag assumption)", async () => {
    // Varying per-segment lag — the classic live-ingress jitter profile.
    const segments: LiveSegment[] = [
      videoSegment("v0", 0, 0),
      videoSegment("v1", 40, 1),
      videoSegment("v2", 80, 2),
    ];
    const arrivals = [1_500, 1_550, 1_570]; // lags 1500 / 1510 / 1490
    const schedule = segments.map((segment, index) => ({
      arrivalMs: arrivals[index]!,
      segment,
    }));
    const { service } = wiredService({ sessionId: SESSION_ID, schedule });
    service.start();
    await service.done();
    expect(service.receipt("v0")?.arrivalLagMs).toBe(1_500);
    expect(service.receipt("v1")?.arrivalLagMs).toBe(1_510);
    expect(service.receipt("v2")?.arrivalLagMs).toBe(1_490);
    // Upstream time untouched through the jitter:
    expect(service.receipt("v1")?.upstreamMs).toBe(40);
  });
});

describe("bounded channel under burst — verbatim in-order delivery, bounded memory", () => {
  test("a 60-segment burst through a capacity-8 block channel: all delivered, all verbatim", async () => {
    const count = 60;
    const schedule = Array.from({ length: count }, (_, i) => ({
      arrivalMs: i * 40,
      segment: videoSegment(`v${i}`, i * 40, i),
    }));
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule,
      capacity: 8,
    });
    service.start();

    // The consumer drains concurrently (as a real downstream stage would);
    // the pump still parks whenever it gets 8+1 ahead of the consumer.
    const received: StageMessage[] = [];
    (async () => {
      for (;;) {
        try {
          received.push(await channel.receive());
        } catch {
          return;
        }
      }
    })();

    const result = await service.done();
    expect(await until(() => received.length === count)).toBe(true);
    expect(result.outcome).toBe("completed");
    expect(result.stats).toMatchObject({
      segmentsIn: count,
      segmentsOut: count,
      rejected: 0,
      abandoned: 0,
    });

    // In-order, monotone sequences, and EVERY payload verbatim.
    expect(received.map((m) => payloadOf(m).segmentId)).toEqual(
      Array.from({ length: count }, (_, i) => `v${i}`),
    );
    expect(received.map((m) => m.sequence)).toEqual(Array.from({ length: count }, (_, i) => i));
    for (const [index, message] of received.entries()) {
      const payload = payloadOf(message);
      if (payload.kind !== "video") throw new Error("burst feed is video-only");
      expect(payload.frame.presentationMs).toBe(index * 40);
      expect(payload.frame.bytes).toEqual(schedule[index]!.segment.frame.bytes);
    }
  });

  test("with no consumer at all, the pump holds at capacity+1 in flight — never buffering ahead", async () => {
    const count = 60;
    const schedule = Array.from({ length: count }, (_, i) => ({
      arrivalMs: i * 40,
      segment: videoSegment(`v${i}`, i * 40, i),
    }));
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule,
      capacity: 8,
    });
    service.start();
    // Parked: 8 queued + 1 in-flight send; the other 51 schedule entries are
    // never even pulled (bounded memory end to end, architecture-lock §8).
    expect(await until(() => service.stats().segmentsIn === 9 && channel.size === 8)).toBe(true);
    expect(service.stats().segmentsOut).toBe(8);
    expect(service.stats().segmentsIn - service.stats().segmentsOut).toBe(1);
    const result = await service.stop();
    expect(result.outcome).toBe("stopped");
    expect(result.stats).toMatchObject({
      segmentsIn: 9,
      segmentsOut: 8,
      abandoned: 1,
    });
    // The 8 admitted segments stay receivable after close — verbatim.
    const received = await drainChannel(channel);
    expect(received.map((m) => payloadOf(m).segmentId)).toEqual(
      Array.from({ length: 8 }, (_, i) => `v${i}`),
    );
  });
});

describe("the full feed spec is consumable through the source seam directly", () => {
  test("scheduleOf + FixtureLiveSource + service: 12/12 verbatim (the wiring as a caller uses it)", async () => {
    const schedule = mixedFeed();
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule: scheduleOf(schedule).schedule,
    });
    service.start();
    const result = await service.done();
    expect(result.stats.segmentsOut).toBe(12);
    const received = await drainChannel(channel);
    for (const [index, message] of received.entries()) {
      const payload: IngestedLiveSegment = payloadOf(message);
      const authored = schedule[index]!.segment;
      if (payload.kind === "video" && authored.kind === "video") {
        expect(payload.frame).toEqual(authored.frame);
      } else if (payload.kind === "audio" && authored.kind === "audio") {
        expect(payload.chunk).toEqual(authored.chunk);
      }
    }
  });
});
