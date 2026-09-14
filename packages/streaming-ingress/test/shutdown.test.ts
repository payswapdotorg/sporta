/**
 * Shutdown accounting tests (W301) — orderly `stop()` with EXPLICIT
 * abandonment: in-flight segments complete (when the send was admitted) or
 * are accounted as abandoned (when the channel closed under them) — never a
 * silent loss. Also: the external-channel-close path, idempotent stop, and
 * the never-settling-less guarantee that every session end asserts the
 * accounting balance.
 */
import { describe, expect, test } from "bun:test";
import type { StageMessage } from "@sporta/contracts";
import {
  STREAMING_METRIC_NAMES as METRICS,
  assertAccountingBalance,
  emptyStats,
} from "../src/index";
import type { IngestedLiveSegment } from "../src/types";
import {
  burst,
  capturedObservability,
  drainChannel,
  drainMicrotasks,
  malformedVideoSegment,
  until,
  videoSegment,
  wiredService,
} from "./helpers";

const SESSION_ID = "sess-w301-stop";

describe("stop() while a send is parked — explicit abandonment", () => {
  test("blocked send at stop: the segment is accounted ABANDONED, never lost silently", async () => {
    const obs = capturedObservability();
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule: burst(8),
      capacity: 2,
      observability: obs.options,
    });
    service.start();
    // Park the pump: channel full (2 queued), the third send is in flight.
    expect(await until(() => service.stats().segmentsIn === 3 && channel.size === 2)).toBe(true);

    const result = await service.stop();
    expect(result.outcome).toBe("stopped");
    expect(result.stats).toMatchObject({
      segmentsIn: 3,
      segmentsOut: 2,
      rejected: 0,
      duplicates: 0,
      abandoned: 1,
    });

    // The abandoned segment left ALL the evidence: ledger, warn log, metric.
    expect(service.rejections()).toHaveLength(1);
    expect(service.rejections()[0]).toMatchObject({
      segmentId: "v2",
      failureClass: "internal",
      reason: "abandoned-stop-closed-output",
    });
    const warn = obs.records().find((r) => r.msg === "live segment abandoned at shutdown");
    expect(warn).toMatchObject({ level: "warn", sessionId: SESSION_ID });
    const abandonedMetric = obs.metrics
      .snapshot()
      .counters.find((c) => c.name === METRICS.abandonedTotal);
    expect(abandonedMetric?.value).toBe(1);

    // Queued messages stay receivable after close (W104 no-loss contract).
    const received = await drainChannel(channel);
    expect(received.map((m) => (m.payload as IngestedLiveSegment).segmentId)).toEqual(["v0", "v1"]);
  });

  test("a receipt exists for the abandoned segment (accepted, never delivered)", async () => {
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule: burst(8),
      capacity: 2,
    });
    service.start();
    expect(await until(() => service.stats().segmentsIn === 3)).toBe(true);
    await service.stop();
    expect(service.receipt("v2")).toMatchObject({
      segmentId: "v2",
      arrivalMs: 80,
      upstreamMs: 80,
    });
    await drainChannel(channel);
  });
});

describe("stop() ordering — in-flight completion when admitted", () => {
  test("drain-then-complete: the parked send completes and the session ends naturally", async () => {
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule: burst(5),
      capacity: 2,
    });
    service.start();
    expect(await until(() => service.stats().segmentsIn === 3 && channel.size === 2)).toBe(true);
    // A consumer arrives: the parked send (v2) is admitted, the feed flows on.
    const received = await (async () => {
      const items: StageMessage[] = [];
      (async () => {
        for (;;) {
          try {
            items.push(await channel.receive());
          } catch {
            return;
          }
        }
      })();
      await service.done();
      await drainMicrotasks(50);
      return items;
    })();
    expect(received).toHaveLength(5);
    // Natural end-of-feed ⇒ completed, zero abandoned (all in-flight completed).
    const result = await service.stop(); // idempotent post-completion
    expect(result.outcome).toBe("completed");
    expect(result.stats).toMatchObject({ segmentsIn: 5, segmentsOut: 5, abandoned: 0 });
  });
});

describe("stop() idempotence and lifecycle guards", () => {
  test("stop() twice settles the SAME result object (idempotent cancellation posture)", async () => {
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule: burst(8),
      capacity: 2,
    });
    service.start();
    expect(await until(() => service.stats().segmentsIn === 3)).toBe(true);
    const first = await service.stop();
    const second = await service.stop();
    expect(second).toEqual(first);
    await drainChannel(channel);
  });

  test("stop() after natural completion returns the settled result unchanged", async () => {
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule: burst(3),
      capacity: 8,
    });
    service.start();
    const natural = await service.done();
    expect(natural.outcome).toBe("completed");
    const after = await service.stop();
    expect(after.outcome).toBe("completed");
    expect(after.stats).toEqual(natural.stats);
    await drainChannel(channel);
  });

  test("stop() closes the output channel exactly once; double stop is safe", async () => {
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule: burst(4),
      capacity: 8,
    });
    service.start();
    expect(await until(() => service.stats().segmentsOut === 4)).toBe(true);
    await service.stop();
    expect(() => channel.close()).not.toThrow(); // idempotent at the channel too
  });
});

describe("external channel close mid-stream — loud internal terminal", () => {
  test("an externally closed output abandons the in-flight segment and fails the session", async () => {
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule: burst(6),
      capacity: 1,
    });
    service.start();
    // Park: 1 queued, the second send in flight.
    expect(await until(() => service.stats().segmentsIn === 2 && channel.size === 1)).toBe(true);
    channel.close(); // NOT via stop() — the pipeline owner tore down the output
    const result = await service.done();
    expect(result.outcome).toBe("failed");
    expect(result.terminalFailureClass).toBe("internal");
    expect(result.error).toContain("closed while the live session was streaming");
    expect(result.stats).toMatchObject({
      segmentsIn: 2,
      segmentsOut: 1,
      abandoned: 1,
    });
    expect(service.rejections()[0]).toMatchObject({
      reason: "abandoned-output-closed-externally",
    });
    const received = await drainChannel(channel);
    expect(received).toHaveLength(1);
  });
});

describe("every session end asserts the accounting balance", () => {
  test("assertAccountingBalance throws on imbalance (the exported invariant)", () => {
    expect(() => assertAccountingBalance(emptyStats())).not.toThrow();
    expect(() =>
      assertAccountingBalance({ ...emptyStats(), segmentsIn: 5, segmentsOut: 3 }),
    ).toThrow(/does not balance/);
    expect(() =>
      assertAccountingBalance({ ...emptyStats(), rejected: 1, rejectedMalformed: 2 }),
    ).toThrow(/do not sum/);
  });
});

describe("never a silent loss — combined refusal paths in one session", () => {
  test("duplicate + malformed + backpressure rejection + abandonment all balance", async () => {
    // One session exercising every accounting bucket at once:
    // capacity 2, reject policy, feed = good, duplicate, malformed, 4 more
    // good (of which the channel refuses the ones beyond capacity).
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule: [
        { arrivalMs: 0, segment: videoSegment("g0", 0, 0) },
        { arrivalMs: 10, segment: videoSegment("g0", 0, 0) }, // duplicate
        { arrivalMs: 20, segment: malformedVideoSegment("bad", 40) },
        { arrivalMs: 30, segment: videoSegment("g1", 40, 1) },
        { arrivalMs: 40, segment: videoSegment("g2", 80, 2) },
        { arrivalMs: 50, segment: videoSegment("g3", 120, 3) },
        { arrivalMs: 60, segment: videoSegment("g4", 160, 4) },
      ],
      capacity: 2,
      policy: "reject",
    });
    service.start();
    const result = await service.done();
    // in = 7; duplicate 1; malformed 1; out = 2 (g0, g1 admitted; g2..g4
    // refused by the full channel ⇒ rejectedBackpressure 3).
    expect(result.stats).toMatchObject({
      segmentsIn: 7,
      segmentsOut: 2,
      duplicates: 1,
      rejectedMalformed: 1,
      rejectedBackpressure: 3,
      rejected: 4,
      abandoned: 0,
    });
    const received = await drainChannel(channel);
    expect(received.map((m) => (m.payload as IngestedLiveSegment).segmentId)).toEqual(["g0", "g1"]);
  });
});
