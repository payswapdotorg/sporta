/**
 * Determinism tests (W301): rerunning the SAME authored live session
 * (fresh source/clock/service/observability each time) produces DEEP-EQUAL
 * results — emitted stage messages (payloads byte-for-byte), receipts,
 * accounting stats, rejection ledger, log lines, and metric snapshots.
 *
 * No wall clocks anywhere (VirtualClock + TEST_EPOCH_MS), no Math.random;
 * the authored schedule IS the wire. Both session shapes are pinned: a
 * natural-completion session exercising duplicates/malformed/backpressure
 * refusals, and an orderly-stop session with an abandoned in-flight send.
 */
import { describe, expect, test } from "bun:test";
import type { StageMessage } from "@sporta/contracts";
import type {
  LiveSegment,
  LiveSegmentReceipt,
  LiveSessionResult,
  RejectionRecord,
} from "../src/types";
import type { MetricsSnapshot } from "@sporta/observability";
import {
  capturedObservability,
  drainChannel,
  malformedVideoSegment,
  payloadOf,
  until,
  videoSegment,
  wiredService,
} from "./helpers";

const SESSION_ID = "sess-w301-determinism";

/** One session run: everything observable, collected after settle. */
interface RunEvidence {
  result: LiveSessionResult;
  received: StageMessage[];
  receipts: LiveSegmentReceipt[];
  rejections: RejectionRecord[];
  logLines: string[];
  metricSnapshot: MetricsSnapshot;
}

/** The refusal-rich schedule (fresh objects every call). */
function refusalSchedule(): { arrivalMs: number; segment: LiveSegment }[] {
  return [
    { arrivalMs: 0, segment: videoSegment("v0", 0, 0) },
    { arrivalMs: 40, segment: videoSegment("v1", 40, 1) },
    { arrivalMs: 60, segment: videoSegment("v0", 0, 0) }, // duplicate
    { arrivalMs: 80, segment: malformedVideoSegment("bad", 80) },
    { arrivalMs: 120, segment: videoSegment("v2", 120, 2) }, // refused (channel full)
    { arrivalMs: 160, segment: videoSegment("v3", 160, 3) }, // refused
    { arrivalMs: 200, segment: videoSegment("v4", 200, 4) }, // refused
  ];
}

/** Runs the refusal-rich natural-completion session once (fresh objects). */
async function runRefusalSession(): Promise<RunEvidence> {
  const obs = capturedObservability();
  const { service, channel } = wiredService({
    sessionId: SESSION_ID,
    schedule: refusalSchedule(),
    capacity: 2,
    policy: "reject",
    observability: obs.options,
  });
  service.start();
  const result = await service.done();
  const received = await drainChannel(channel);
  return {
    result,
    received,
    receipts: service.receipts(),
    rejections: service.rejections(),
    logLines: obs.lines(),
    metricSnapshot: obs.metrics.snapshot(),
  };
}

/** Runs the orderly-stop session once (fresh objects; abandoned in flight). */
async function runStopSession(): Promise<RunEvidence> {
  const schedule = Array.from({ length: 8 }, (_, i) => ({
    arrivalMs: i * 40,
    segment: videoSegment(`v${i}`, i * 40, i),
  }));
  const obs = capturedObservability();
  const { service, channel } = wiredService({
    sessionId: SESSION_ID,
    schedule,
    capacity: 2,
    observability: obs.options,
  });
  service.start();
  // Park the pump (2 queued, third send in flight), then stop.
  expect(await until(() => service.stats().segmentsIn === 3 && channel.size === 2)).toBe(true);
  const result = await service.stop();
  const received = await drainChannel(channel);
  return {
    result,
    received,
    receipts: service.receipts(),
    rejections: service.rejections(),
    logLines: obs.lines(),
    metricSnapshot: obs.metrics.snapshot(),
  };
}

describe("determinism — the same authored session reruns deep-equal", () => {
  test("natural completion with duplicate + malformed + backpressure refusals", async () => {
    const first = await runRefusalSession();
    const second = await runRefusalSession();

    // Session results (outcome, stats — every bucket):
    expect(second.result).toEqual(first.result);
    expect(first.result.outcome).toBe("completed");
    expect(first.result.stats).toMatchObject({
      segmentsIn: 7,
      segmentsOut: 2,
      duplicates: 1,
      rejectedMalformed: 1,
      rejectedBackpressure: 3,
      abandoned: 0,
    });

    // Emitted stage messages: same count, same order — deep-equal including
    // the frame bytes (typed arrays compare by content).
    expect(second.received).toEqual(first.received);
    expect(first.received).toHaveLength(2);
    expect(first.received.map((m) => payloadOf(m).segmentId)).toEqual(["v0", "v1"]);
    // …and the payload bytes equal a FRESHLY-authored schedule (byte-for-byte
    // identity with the fixture math, not a stale shared reference).
    const fresh = refusalSchedule();
    for (const [index, message] of first.received.entries()) {
      const payload = payloadOf(message);
      const authored = fresh[index]!.segment;
      expect(payload.segmentId).toBe(authored.segmentId);
      if (payload.kind === "video" && authored.kind === "video") {
        expect(payload.frame.bytes).toEqual(authored.frame.bytes);
        expect(payload.frame.presentationMs).toBe(authored.frame.presentationMs);
      }
    }

    // Receipts (checksums, arrival measurements, mint order). Receipts mint
    // at ACCEPTANCE (rights + validation + idempotency passed): the three
    // backpressure-REFUSED segments keep theirs (their delivery fate lives in
    // the stats/ledger — same principle as the abandoned segment's receipt).
    expect(second.receipts).toEqual(first.receipts);
    expect(first.receipts.map((r) => r.segmentId)).toEqual(["v0", "v1", "v2", "v3", "v4"]);
    expect(first.result.stats.distinctSegments).toBe(5);
    // The rejection ledger (reasons, classes, clock readings):
    expect(second.rejections).toEqual(first.rejections);
    // The full log stream (deterministic ts via the injected clock):
    expect(second.logLines).toEqual(first.logLines);
    // The metric snapshot (counters + histograms, deterministically ordered):
    expect(second.metricSnapshot).toEqual(first.metricSnapshot);
  });

  test("orderly stop with an abandoned in-flight send", async () => {
    const first = await runStopSession();
    const second = await runStopSession();

    expect(second.result).toEqual(first.result);
    expect(first.result.outcome).toBe("stopped");
    expect(first.result.stats).toMatchObject({
      segmentsIn: 3,
      segmentsOut: 2,
      abandoned: 1,
    });
    // The abandonment evidence is identical run-to-run, clock reading and all:
    expect(second.rejections).toEqual(first.rejections);
    expect(first.rejections).toHaveLength(1);
    expect(first.rejections[0]).toMatchObject({
      segmentId: "v2",
      reason: "abandoned-stop-closed-output",
      atMs: 80,
    });
    expect(second.received).toEqual(first.received);
    expect(second.receipts).toEqual(first.receipts);
    expect(second.logLines).toEqual(first.logLines);
    expect(second.metricSnapshot).toEqual(first.metricSnapshot);
  });

  test("triple-run pairwise equality (natural completion)", async () => {
    const runs = [await runRefusalSession(), await runRefusalSession(), await runRefusalSession()];
    expect(runs[1]!.result).toEqual(runs[0]!.result);
    expect(runs[2]!.result).toEqual(runs[0]!.result);
    expect(runs[1]!.received).toEqual(runs[0]!.received);
    expect(runs[2]!.received).toEqual(runs[0]!.received);
    // And the balance invariant held every time:
    for (const run of runs) {
      expect(run.result.balanced).toBe(true);
      expect(run.result.stats.segmentsIn).toBe(
        run.result.stats.segmentsOut +
          run.result.stats.rejected +
          run.result.stats.duplicates +
          run.result.stats.abandoned,
      );
    }
  });
});
