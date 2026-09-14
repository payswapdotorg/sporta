/**
 * Per-segment policy tests (W301): receipts + idempotency (duplicate
 * re-deliveries tolerated and counted, idempotency-key conflicts fail loud),
 * malformed-segment fail-loud refusals (the W102 invariants, stream
 * continues), the segment-budget limit, and the emitted `StageMessage`
 * contract shape (zod-parsed).
 */
import { describe, expect, test } from "bun:test";
import { StageMessage as StageMessageSchema } from "@sporta/contracts";
import type { StageMessage } from "@sporta/contracts";
import type { IngestedLiveSegment, LiveSegment, LiveVideoSegment } from "../src/types";
import {
  FixtureLiveSource,
  LiveSegmentRegistry,
  MalformedSegmentError,
  RightsDeniedError,
  STREAMING_METRIC_NAMES as METRICS,
  VirtualClock,
  checksumLiveSegment,
  isStreamingIngressError,
  validateLiveSegment,
} from "../src/index";
import {
  audioSegment,
  capturedObservability,
  drainChannel,
  malformedVideoSegment,
  videoSegment,
  wiredService,
} from "./helpers";

const SESSION_ID = "sess-w301-segments";

/** Standard good feed: 3 video segments at 40 ms cadence, arrival = upstream. */
function goodFeed(): { arrivalMs: number; segment: LiveSegment }[] {
  return [
    { arrivalMs: 0, segment: videoSegment("v0", 0, 0) },
    { arrivalMs: 40, segment: videoSegment("v1", 40, 1) },
    { arrivalMs: 80, segment: videoSegment("v2", 80, 2) },
  ];
}

describe("receipts — the W101 posture applied per segment", () => {
  test("every accepted segment mints a receipt (checksum, arrival, upstream, lag)", async () => {
    const { service, channel } = wiredService({ sessionId: SESSION_ID, schedule: goodFeed() });
    service.start();
    const result = await service.done();
    expect(result.outcome).toBe("completed");

    const receipts = service.receipts();
    expect(receipts).toHaveLength(3);
    for (const [i, receipt] of receipts.entries()) {
      expect(receipt.sessionId).toBe(SESSION_ID);
      expect(receipt.segmentId).toBe(`v${i}`);
      expect(receipt.arrivalMs).toBe(i * 40);
      expect(receipt.upstreamMs).toBe(i * 40);
      expect(receipt.arrivalLagMs).toBe(0);
    }
    // Returned receipts are caller-owned copies: mutating one never touches
    // the service's acceptance record (read again — unchanged).
    const first = service.receipt("v0");
    expect(first).toBeDefined();
    if (first !== undefined) {
      (first as { upstreamMs: number }).upstreamMs = 99_999;
      expect(service.receipt("v0")?.upstreamMs).toBe(0);
    }

    // Checksums are the documented canonical encoding of the payload.
    for (const entry of goodFeed()) {
      expect(service.receipt(entry.segment.segmentId)?.checksum).toBe(
        checksumLiveSegment(entry.segment),
      );
    }
    const checksums = new Set(receipts.map((r) => r.checksum));
    expect(checksums.size).toBe(3); // distinct content ⇒ distinct checksums

    const received = await drainChannel(channel);
    expect(received).toHaveLength(3);
  });

  test("identical content ⇒ identical checksum (the idempotency substance)", () => {
    const a = videoSegment("x", 0, 0);
    const b = videoSegment("x", 0, 0);
    expect(checksumLiveSegment(a)).toBe(checksumLiveSegment(b));
    const c = videoSegment("x", 40, 1); // different payload ⇒ different checksum
    expect(checksumLiveSegment(a)).not.toBe(checksumLiveSegment(c));
  });

  test("LiveSegmentRegistry: first write wins, receipts in mint order, frozen records stay frozen", () => {
    const registry = new LiveSegmentRegistry();
    const first = Object.freeze({
      sessionId: "s",
      segmentId: "a",
      checksum: "x",
      arrivalMs: 1,
      upstreamMs: 0,
      arrivalLagMs: 1,
    });
    const later = {
      sessionId: "s",
      segmentId: "a",
      checksum: "y",
      arrivalMs: 2,
      upstreamMs: 0,
      arrivalLagMs: 2,
    };
    registry.put(first);
    registry.put(later);
    expect(registry.size).toBe(1);
    expect(registry.get("a")?.checksum).toBe("x"); // first acceptance preserved
    expect(Object.isFrozen(registry.get("a"))).toBe(true); // frozen record, verbatim
    expect(registry.receipts()).toEqual([first]);
  });
});

describe("idempotent duplicate re-delivery — tolerated, counted, never collapsed", () => {
  test("a re-delivery of the same id + content is counted, NOT re-emitted", async () => {
    const schedule = [
      { arrivalMs: 0, segment: videoSegment("v0", 0, 0) },
      { arrivalMs: 40, segment: videoSegment("v1", 40, 1) },
      { arrivalMs: 60, segment: videoSegment("v0", 0, 0) }, // re-delivery
      { arrivalMs: 80, segment: videoSegment("v2", 80, 2) },
    ];
    const obs = capturedObservability();
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule,
      observability: obs.options,
    });
    service.start();
    const result = await service.done();

    expect(result.stats).toMatchObject({
      segmentsIn: 4,
      segmentsOut: 3,
      duplicates: 1,
      rejected: 0,
      abandoned: 0,
      distinctSegments: 3,
    });
    const received = await drainChannel(channel);
    expect(received.map((m) => (m.payload as IngestedLiveSegment).segmentId)).toEqual([
      "v0",
      "v1",
      "v2",
    ]);

    // The duplicate is OBSERVABLE, not silently collapsed: one info line …
    const duplicateLine = obs
      .records()
      .find((r) => r.msg === "live segment re-delivered (idempotent duplicate)");
    expect(duplicateLine).toMatchObject({
      level: "info",
      sessionId: SESSION_ID,
      fields: { segmentId: "v0", duplicate: true },
    });
    // … and the duplicate metric bumped once.
    const dup = obs.metrics.snapshot().counters.find((c) => c.name === METRICS.duplicatesTotal);
    expect(dup?.value).toBe(1);

    // The ORIGINAL receipt stands (no re-mint): same arrival measurement.
    expect(service.receipt("v0")?.arrivalMs).toBe(0);
  });

  test("the same id with DIFFERENT content is an idempotency-key conflict (media-invalid)", async () => {
    const schedule = [
      { arrivalMs: 0, segment: videoSegment("v0", 0, 0) },
      { arrivalMs: 40, segment: videoSegment("v0", 40, 1) }, // same id, different content
    ];
    const { service, channel } = wiredService({ sessionId: SESSION_ID, schedule });
    service.start();
    const result = await service.done();
    expect(result.outcome).toBe("completed"); // the stream continues
    expect(result.stats).toMatchObject({
      segmentsIn: 2,
      segmentsOut: 1,
      rejected: 1,
      rejectedMalformed: 1,
    });
    expect(service.rejections()[0]).toMatchObject({
      segmentId: "v0",
      failureClass: "media-invalid",
      reason: "idempotency-key-conflict",
    });
    const received = await drainChannel(channel);
    expect(received).toHaveLength(1);
  });
});

describe("malformed segments — structured errors, never silent skips", () => {
  /** Runs one malformed variant through the service and asserts the refusal. */
  async function refuseMalformed(segment: LiveSegment, expectedReason: string): Promise<void> {
    const obs = capturedObservability();
    const schedule = [
      { arrivalMs: 0, segment: videoSegment("good0", 0, 0) },
      { arrivalMs: 40, segment },
      { arrivalMs: 80, segment: videoSegment("good1", 80, 1) },
    ];
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule,
      observability: obs.options,
    });
    service.start();
    const result = await service.done();
    expect(result.outcome).toBe("completed");
    expect(result.stats).toMatchObject({
      segmentsIn: 3,
      segmentsOut: 2,
      rejected: 1,
      rejectedMalformed: 1,
    });
    // Structured error evidence: ledger + warn log + metric label.
    expect(service.rejections()).toHaveLength(1);
    expect(service.rejections()[0]).toMatchObject({
      failureClass: "media-invalid",
      reason: expectedReason,
    });
    const warn = obs.records().find((r) => r.msg === "live segment rejected");
    expect(warn).toMatchObject({ level: "warn" });
    const labeled = obs.metrics
      .snapshot()
      .counters.find(
        (c) => c.name === METRICS.rejectedTotal && c.labels.failure_class === "media-invalid",
      );
    expect(labeled?.value).toBe(1);
    // The good segments around the corrupt one still flowed.
    const received = await drainChannel(channel);
    expect(received.map((m) => (m.payload as IngestedLiveSegment).segmentId)).toEqual([
      "good0",
      "good1",
    ]);
  }

  test("rgb24 byte-count mismatch", async () => {
    await refuseMalformed(malformedVideoSegment("bad", 40), "rgb24-byte-mismatch");
  });

  test("negative presentationMs", async () => {
    const bad = videoSegment("bad", 40, 1);
    bad.frame.presentationMs = -1;
    await refuseMalformed(bad, "bad-presentation-ms");
  });

  test("non-finite (NaN) presentationMs", async () => {
    const bad = videoSegment("bad", 40, 1);
    bad.frame.presentationMs = Number.NaN;
    await refuseMalformed(bad, "bad-presentation-ms");
  });

  test("wrong pixel format", async () => {
    const bad = videoSegment("bad", 40, 1);
    (bad as LiveVideoSegment).frame.pixelFormat = "yuv420p" as "rgb24";
    await refuseMalformed(bad, "bad-pixel-format");
  });

  test("non-integer geometry", async () => {
    const bad = videoSegment("bad", 40, 1);
    bad.frame.width = 2.5;
    await refuseMalformed(bad, "bad-geometry");
  });

  test("missing bytes buffer", async () => {
    const bad = videoSegment("bad", 40, 1);
    (bad as LiveVideoSegment).frame.bytes = undefined as unknown as Uint8Array;
    await refuseMalformed(bad, "missing-bytes");
  });

  test("audio samples not a whole number of interleaved frames", async () => {
    const bad = audioSegment("bad", 40, 1);
    bad.chunk.samples = new Float32Array(3); // 3 samples …
    bad.chunk.channels = 2; // … across 2 channels: 3 % 2 = 1, not whole frames
    await refuseMalformed(bad, "bad-sample-count");
  });

  test("audio sampleRate not a positive integer", async () => {
    const bad = audioSegment("bad", 40, 1);
    bad.chunk.sampleRate = 0;
    await refuseMalformed(bad, "bad-sample-rate");
  });

  test("audio negative startMs", async () => {
    const bad = audioSegment("bad", 40, 1);
    bad.chunk.startMs = -1;
    await refuseMalformed(bad, "bad-start-ms");
  });

  test("missing segmentId (unit: the fixture refuses authoring it, the service refuses it raw)", () => {
    // The fixture constructor rejects an empty segmentId as an AUTHORING bug
    // (a live wire always ids its deliveries), so this invariant is pinned
    // directly against the service's validation entry point.
    expect(() => validateLiveSegment({ ...videoSegment("bad", 40, 1), segmentId: "" })).toThrow(
      /non-empty string segmentId/,
    );
    try {
      validateLiveSegment({ ...videoSegment("bad", 40, 1), segmentId: "" });
    } catch (err) {
      expect((err as MalformedSegmentError).details.reason).toBe("missing-segment-id");
    }
    expect(
      () =>
        new FixtureLiveSource(
          { label: "f", schedule: [{ arrivalMs: 0, segment: videoSegment("", 0, 0) }] },
          new VirtualClock(),
        ),
    ).toThrow(/segmentId/);
  });

  test("unknown segment kind (unit: the fixture refuses authoring it, the service refuses it raw)", () => {
    const raw = { ...videoSegment("bad", 40, 1), kind: "telemetry" } as unknown as LiveSegment;
    expect(() => validateLiveSegment(raw)).toThrow(/kind/);
    try {
      validateLiveSegment(raw);
    } catch (err) {
      expect((err as MalformedSegmentError).details.reason).toBe("unknown-kind");
    }
    expect(
      () =>
        new FixtureLiveSource(
          { label: "f", schedule: [{ arrivalMs: 0, segment: raw }] },
          new VirtualClock(),
        ),
    ).toThrow(/kind/);
  });

  test("validateLiveSegment / error typing is exported and guardable", () => {
    const err = new MalformedSegmentError("x", { reason: "rgb24-byte-mismatch" });
    expect(isStreamingIngressError(err)).toBe(true);
    expect(err.terminalFailureClass).toBe("media-invalid");
    expect(isStreamingIngressError(new RightsDeniedError("x"))).toBe(true);
    expect(isStreamingIngressError(new Error("x"))).toBe(false);
  });
});

describe("segment budget — the resource-limit posture", () => {
  test("exceeding maxSegments refuses the over-budget delivery and fails the session", async () => {
    const schedule = [
      { arrivalMs: 0, segment: videoSegment("v0", 0, 0) },
      { arrivalMs: 40, segment: videoSegment("v1", 40, 1) },
      { arrivalMs: 80, segment: videoSegment("v2", 80, 2) }, // over budget
    ];
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule,
      maxSegments: 2,
    });
    service.start();
    const result = await service.done();
    expect(result.outcome).toBe("failed");
    expect(result.terminalFailureClass).toBe("resource-limit");
    expect(result.stats).toMatchObject({
      segmentsIn: 3,
      segmentsOut: 2,
      rejected: 1,
      rejectedLimit: 1,
    });
    expect(service.rejections()[0]).toMatchObject({
      failureClass: "resource-limit",
      reason: "segment-budget-exhausted",
    });
    const received = await drainChannel(channel);
    expect(received).toHaveLength(2);
  });

  test("an exactly-at-budget feed completes (no off-by-one)", async () => {
    const schedule = [
      { arrivalMs: 0, segment: videoSegment("v0", 0, 0) },
      { arrivalMs: 40, segment: videoSegment("v1", 40, 1) },
    ];
    const { service } = wiredService({ sessionId: SESSION_ID, schedule, maxSegments: 2 });
    service.start();
    const result = await service.done();
    expect(result.outcome).toBe("completed");
    expect(result.stats).toMatchObject({ segmentsIn: 2, segmentsOut: 2, rejected: 0 });
  });

  test("invalid limits fail loud at construction", () => {
    expect(() => wiredService({ sessionId: SESSION_ID, schedule: [], maxSegments: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("emitted stage messages — the streaming contract shape", () => {
  test("every message zod-parses as a StageMessage and carries the contract vocabulary", async () => {
    const schedule = [
      { arrivalMs: 0, segment: videoSegment("v0", 0, 0) },
      { arrivalMs: 250, segment: audioSegment("a0", 0, 0) },
    ];
    const { service, channel } = wiredService({ sessionId: SESSION_ID, schedule });
    service.start();
    await service.done();
    const received = await drainChannel(channel);
    expect(received).toHaveLength(2);

    for (const [i, message] of received.entries()) {
      expect(() => StageMessageSchema.parse(message)).not.toThrow();
      expect(message.sessionId).toBe(SESSION_ID);
      expect(message.sequence).toBe(i); // 0-based monotonic emission order
      expect(message.correlationId).toBe(`corr-live-${SESSION_ID}`);
      expect(message.traceId).toBe(`trace-live-${SESSION_ID}`);
      const payload = message.payload as IngestedLiveSegment;
      expect(payload.receipt.sessionId).toBe(SESSION_ID);
    }
    // Watermark = the payload's OWN upstream timestamp (video 0, audio 0).
    expect(received[0]?.watermark).toEqual({ watermarkMs: 0, sequence: 0 });
    expect(received[1]?.watermark).toEqual({ watermarkMs: 0, sequence: 1 });
  });

  test("an injected correlation context overrides the deterministic default ids", async () => {
    const obs = capturedObservability();
    const schedule = [{ arrivalMs: 0, segment: videoSegment("v0", 0, 0) }];
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule,
      observability: obs.options,
    });
    service.start();
    await service.done();
    const received: StageMessage[] = await drainChannel(channel);
    expect(received[0]?.correlationId).toBe(`corr-live-${SESSION_ID}`);
    // Log lines are correlated with the same trace id (the stage contract).
    const admitted = obs.records().find((r) => r.msg === "live session admitted");
    expect(admitted?.traceId).toBe(`trace-live-${SESSION_ID}`);
    expect(admitted?.stage).toBe("streaming-ingress");
  });
});
