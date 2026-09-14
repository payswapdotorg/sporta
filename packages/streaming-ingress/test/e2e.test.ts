/**
 * End-to-end tests (W301): a FULL simulated live session — W004 session
 * admission → live streaming → orderly stop — with the total accounting
 * balance asserted exactly:
 *
 *   segmentsIn === segmentsOut + rejected + duplicates + abandoned
 *
 * every delivered segment landing in EXACTLY one bucket (the honest-
 * accounting constitution; the service runtime-asserts this before settling
 * and `result.balanced === true` proves it). The live session is wired into
 * the W004 session-model posture: the media-session document advances
 * `created → authorized → ingesting` through the same fail-closed rights
 * gate the service applies, an orderly stop settles as idempotent
 * cancellation, and a live terminal failure is recorded on the session with
 * the boundary's classified `terminalFailureClass`.
 */
import { describe, expect, test } from "bun:test";
import type { AuthorizationPolicy, MediaSession } from "@sporta/contracts";
import { SessionLifecycle, newSession } from "@sporta/session";
import type { SourceMedia } from "@sporta/contracts";
import { buildAuthorizationPolicy, TEST_EPOCH_MS } from "@sporta/testing";
import { BoundedChannel } from "@sporta/transport";
import { FixtureLiveSource, StreamingIngressService, VirtualClock } from "../src/index";
import { STREAMING_METRIC_NAMES as METRICS } from "../src/index";
import type { IngestedLiveSegment, LiveSegment } from "../src/types";
import {
  audioSegment,
  capturedObservability,
  drainChannel,
  malformedVideoSegment,
  payloadOf,
  until,
  videoSegment,
  wiredService,
} from "./helpers";

const SESSION_ID = "sess-w301-e2e";

/** Fixed creation time for the W004 media-session document (injected epoch). */
const CREATED_AT = new Date(TEST_EPOCH_MS);

/** A stream-kind source record for the W004 media session. */
function streamSource(policyId: string): SourceMedia {
  return {
    sourceId: "live-fixture-feed",
    kind: "stream",
    videoStreams: 1,
    audioStreams: 1,
    declaredRightsPolicyId: policyId,
  };
}

/** Builds the W004 media session at `created`, with the lifecycle service. */
function mediaSession(policyId: string): { session: MediaSession; lifecycle: SessionLifecycle } {
  const lifecycle = new SessionLifecycle({ now: () => new Date(TEST_EPOCH_MS) });
  const session = newSession(
    {
      sessionId: SESSION_ID,
      authorizationPolicyId: policyId,
      sources: [streamSource(policyId)],
    },
    CREATED_AT,
  );
  return { session, lifecycle };
}

describe("full simulated live session — admission → stream → stop, exact accounting", () => {
  test("every accounting bucket in one session; in = out + rejected + duplicate + abandoned", async () => {
    const policy: AuthorizationPolicy = buildAuthorizationPolicy({
      policyId: `${SESSION_ID}-policy`,
    });
    const obs = capturedObservability();
    const { session: initialSession, lifecycle } = mediaSession(policy.policyId);

    // --- W004 admission: created → authorized (the same fail-closed gate the
    // service applies; the same policy object feeds both) → ingesting.
    const authorized = lifecycle.transition(initialSession, "authorized", { policy });
    expect(authorized.status).toBe("authorized");
    const ingesting = lifecycle.transition(authorized, "ingesting");
    expect(ingesting.status).toBe("ingesting");
    expect(ingesting.processingState.stage).toBe("ingesting");

    // --- the live feed: good, good, duplicate, malformed, then a good one
    // that parks (capacity-2 block channel, downstream stalled — no consumer).
    const schedule: { arrivalMs: number; segment: LiveSegment }[] = [
      { arrivalMs: 0, segment: videoSegment("v0", 0, 0) }, // admitted
      { arrivalMs: 40, segment: videoSegment("v1", 40, 1) }, // admitted (channel now full)
      { arrivalMs: 60, segment: videoSegment("v0", 0, 0) }, // idempotent duplicate
      { arrivalMs: 70, segment: malformedVideoSegment("bad", 80) }, // malformed refusal
      { arrivalMs: 80, segment: videoSegment("v2", 80, 2) }, // parks on the full channel
    ];
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule,
      capacity: 2,
      authorizationPolicy: policy,
      observability: obs.options,
    });

    service.start(); // the boundary's own admission gate passes (same policy)
    // The pump parks: 2 queued, v2's send in flight, the rest never pulled.
    expect(await until(() => service.stats().segmentsIn === 5 && channel.size === 2)).toBe(true);

    // --- orderly stop: the parked send is closed under, v2 accounted ABANDONED.
    const result = await service.stop();
    expect(result.outcome).toBe("stopped");
    expect(result.balanced).toBe(true);

    // --- THE balance, exact numbers (all four buckets in one session):
    // in 5 = out 2 (v0, v1) + rejected 1 (bad) + duplicate 1 (v0) + abandoned 1 (v2).
    const stats = result.stats;
    expect(stats).toEqual({
      segmentsIn: 5,
      segmentsOut: 2,
      rejected: 1,
      rejectedRights: 0,
      rejectedMalformed: 1,
      rejectedBackpressure: 0,
      rejectedLimit: 0,
      duplicates: 1,
      abandoned: 1,
      distinctSegments: 3,
    });
    expect(stats.segmentsIn).toBe(
      stats.segmentsOut + stats.rejected + stats.duplicates + stats.abandoned,
    );

    // --- the two admitted segments still carry their authored payloads
    // VERBATIM (the acceptance criterion holds on the e2e path too).
    const received = await drainChannel(channel);
    expect(received.map((m) => payloadOf(m).segmentId)).toEqual(["v0", "v1"]);
    expect(received.map((m) => m.watermark?.watermarkMs)).toEqual([0, 40]);
    for (const [index, message] of received.entries()) {
      const payload: IngestedLiveSegment = payloadOf(message);
      const authored = schedule[index]!.segment;
      if (payload.kind === "video" && authored.kind === "video") {
        expect(payload.frame).toEqual(authored.frame);
        expect(payload.frame).toBe(authored.frame);
      }
    }

    // --- both refusals left structured evidence (fail-loud ledger).
    expect(service.rejections()).toHaveLength(2);
    expect(service.rejections()[0]).toMatchObject({
      segmentId: "bad",
      failureClass: "media-invalid",
      reason: "rgb24-byte-mismatch",
    });
    expect(service.rejections()[1]).toMatchObject({
      segmentId: "v2",
      failureClass: "internal",
      reason: "abandoned-stop-closed-output",
    });

    // --- observability cross-check: the counters equal the accounting.
    const counters = obs.metrics.snapshot().counters;
    expect(counters.find((c) => c.name === METRICS.segmentsIn)?.value).toBe(5);
    expect(counters.find((c) => c.name === METRICS.segmentsOut)?.value).toBe(2);
    expect(
      counters.find(
        (c) => c.name === METRICS.rejectedTotal && c.labels.failure_class === "media-invalid",
      )?.value,
    ).toBe(1);
    expect(counters.find((c) => c.name === METRICS.duplicatesTotal)?.value).toBe(1);
    expect(counters.find((c) => c.name === METRICS.abandonedTotal)?.value).toBe(1);
    expect(counters.find((c) => c.name === METRICS.backpressureTotal)).toBeUndefined();

    // --- W004 settlement: an orderly stop is idempotent CANCELLATION (the
    // streaming contract's lifecycle posture); the stage stays "ingesting".
    const cancelled = lifecycle.cancel(ingesting);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.processingState.stage).toBe("ingesting");
    expect(cancelled.processingState.terminalFailureClass).toBeUndefined(); // stopped ≠ failed
    expect(lifecycle.cancel(cancelled)).toEqual(cancelled); // idempotent

    // --- every log line is correlated with the session + stage (W007).
    const records = obs.records();
    expect(records.length).toBeGreaterThanOrEqual(7);
    for (const record of records) {
      expect(record.sessionId).toBe(SESSION_ID);
      expect(record.stage).toBe("streaming-ingress");
      expect(record.traceId).toBe(`trace-live-${SESSION_ID}`);
      expect(record.correlationId).toBe(`corr-live-${SESSION_ID}`);
    }
    expect(records.map((r) => r.msg)).toContain("live session admitted");
    expect(records.map((r) => r.msg)).toContain("live segment re-delivered (idempotent duplicate)");
    expect(records.map((r) => r.msg)).toContain("live segment rejected");
    expect(records.map((r) => r.msg)).toContain("live segment abandoned at shutdown");
    expect(records.map((r) => r.msg)).toContain("live session ended");
  });

  test("a live terminal failure records its classified class on the W004 session", async () => {
    // Six segments at 0..500; the policy expires exactly at virtual +500, so
    // the per-segment rights re-check denies the sixth (fail-closed defense
    // in depth — LOUD termination, never a silent mid-stream drop).
    const policy = buildAuthorizationPolicy({
      policyId: `${SESSION_ID}-fail-policy`,
      expiresAtIso: new Date(TEST_EPOCH_MS + 500).toISOString(),
    });
    const { session: initialSession, lifecycle } = mediaSession(policy.policyId);
    const authorized = lifecycle.transition(initialSession, "authorized", { policy });
    const ingesting = lifecycle.transition(authorized, "ingesting");

    const schedule = Array.from({ length: 6 }, (_, i) => ({
      arrivalMs: i * 100,
      segment: i % 2 === 0 ? videoSegment(`v${i}`, i * 100, i) : audioSegment(`a${i}`, i * 100, i),
    }));
    const clock = new VirtualClock(0);
    const source = new FixtureLiveSource({ label: `${SESSION_ID}-fail-feed`, schedule }, clock);
    const channel = new BoundedChannel({ capacity: 16, policy: "block" });
    const service = new StreamingIngressService({
      sessionId: SESSION_ID,
      source,
      authorizationPolicy: policy,
      output: channel,
      clock,
      // The rights gate re-evaluates as virtual arrival time advances.
      rightsNowMs: () => TEST_EPOCH_MS + clock.now(),
    });

    service.start();
    const result = await service.done();
    expect(result.outcome).toBe("failed");
    expect(result.terminalFailureClass).toBe("rights-denied");
    expect(result.stats).toEqual({
      segmentsIn: 6,
      segmentsOut: 5,
      rejected: 1,
      rejectedRights: 1,
      rejectedMalformed: 0,
      rejectedBackpressure: 0,
      rejectedLimit: 0,
      duplicates: 0,
      abandoned: 0,
      distinctSegments: 5,
    });
    expect(result.stats.segmentsIn).toBe(
      result.stats.segmentsOut +
        result.stats.rejected +
        result.stats.duplicates +
        result.stats.abandoned,
    );

    // The five authorized segments flowed (mixed kinds, verbatim):
    const received = await drainChannel(channel);
    expect(received.map((m) => payloadOf(m).segmentId)).toEqual(["v0", "a1", "v2", "a3", "v4"]);
    expect(received.map((m) => m.watermark?.watermarkMs)).toEqual([0, 100, 200, 300, 400]);

    // W004 settlement: the boundary's classified failure lands on the session.
    const failed = lifecycle.fail(ingesting, result.terminalFailureClass!, result.error);
    expect(failed.status).toBe("failed");
    expect(failed.processingState.terminalFailureClass).toBe("rights-denied");
    expect(failed.processingState.lastError).toBe(result.error);
    expect(failed.processingState.stage).toBe("ingesting"); // where it stopped
    expect(lifecycle.fail(failed, "internal")).toEqual(failed); // first classification wins
  });
});
