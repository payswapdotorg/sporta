/**
 * Backpressure tests (W301) — bounded delivery through the W104 channel with
 * EXPLICIT policies and honest accounting, never a silent drop:
 *
 * - `block`: the pump parks at the channel bound (bounded memory proof, the
 *   W104 StageRunner pattern); draining releases it and the in-flight send
 *   completes;
 * - `reject`: full-channel sends refuse with a typed resource-limit error;
 *   each refusal is accounted (`rejectedBackpressure`), metered, and the
 *   stream CONTINUES;
 * - `drop-oldest`: the channel owns eviction accounting (`channel.dropped`);
 *   the service counts admissions only — the cross-boundary identity is
 *   `segmentsOut === received + channel.dropped`.
 */
import { describe, expect, test } from "bun:test";
import type { StageMessage } from "@sporta/contracts";
import { STREAMING_METRIC_NAMES as METRICS } from "../src/index";
import type { IngestedLiveSegment } from "../src/types";
import {
  audioSegment,
  burst,
  capturedObservability,
  drainChannel,
  drainMicrotasks,
  until,
  videoSegment,
  wiredService,
} from "./helpers";

const SESSION_ID = "sess-w301-bp";

describe("block policy — natural backpressure, bounded memory", () => {
  test("the pump parks at the channel bound instead of buffering ahead", async () => {
    // 20-segment burst, capacity 4, no consumer: the pump delivers until the
    // channel is full and then parks on the 5th send (bounded memory end to
    // end — architecture-lock §8).
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule: burst(20),
      capacity: 4,
    });
    service.start();
    expect(await until(() => service.stats().segmentsIn === 5 && channel.size === 4)).toBe(true);
    expect(service.stats().segmentsOut).toBe(4);

    // Draining releases the parked send; everything then flows, in order.
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
    expect(await until(() => received.length === 20)).toBe(true);
    expect(result.outcome).toBe("completed");
    expect(result.stats).toMatchObject({
      segmentsIn: 20,
      segmentsOut: 20,
      rejected: 0,
      abandoned: 0,
    });
    expect(received.map((m) => (m.payload as IngestedLiveSegment).segmentId)).toEqual(
      Array.from({ length: 20 }, (_, i) => `v${i}`),
    );
    expect(received.map((m) => m.sequence)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  test("segmentsIn never exceeds segmentsOut + capacity + 1 while parked", async () => {
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule: burst(30),
      capacity: 3,
    });
    service.start();
    expect(await until(() => channel.size === 3)).toBe(true);
    // The pump holds at most one segment IN FLIGHT beyond the queued bound.
    expect(service.stats().segmentsIn - service.stats().segmentsOut).toBeLessThanOrEqual(3 + 1);
    // Drain and confirm the bounded invariant held throughout: nothing lost.
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
    expect(received).toHaveLength(30);
  });
});

describe("reject policy — explicit refusal accounting, stream continues", () => {
  test("full-channel sends refuse; each refusal counted and metered; delivery continues", async () => {
    const obs = capturedObservability();
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule: burst(6),
      capacity: 2,
      policy: "reject",
      observability: obs.options,
    });
    service.start();
    const result = await service.done();

    // Capacity 2: v0/v1 admitted; v2..v5 refused (4 explicit backpressure
    // rejections — never dropped silently), then the feed completed.
    expect(result.outcome).toBe("completed");
    expect(result.stats).toMatchObject({
      segmentsIn: 6,
      segmentsOut: 2,
      rejected: 4,
      rejectedBackpressure: 4,
    });
    const received = await drainChannel(channel);
    expect(received.map((m) => (m.payload as IngestedLiveSegment).segmentId)).toEqual(["v0", "v1"]);

    // Every refusal left structured evidence: ledger, warn log, metric.
    expect(service.rejections()).toHaveLength(4);
    for (const record of service.rejections()) {
      expect(record).toMatchObject({
        failureClass: "resource-limit",
        reason: "output-channel-full",
      });
      expect(record.details).toMatchObject({ policy: "reject", capacity: 2 });
    }
    const warnLines = obs.records().filter((r) => r.msg === "live segment rejected");
    expect(warnLines).toHaveLength(4);
    const backpressure = obs.metrics
      .snapshot()
      .counters.find((c) => c.name === METRICS.backpressureTotal);
    expect(backpressure?.value).toBe(4);
    const labeled = obs.metrics
      .snapshot()
      .counters.find(
        (c) => c.name === METRICS.rejectedTotal && c.labels.failure_class === "resource-limit",
      );
    expect(labeled?.value).toBe(4);
  });

  test("a re-delivery of a REFUSED segment is an idempotent duplicate (the receipt is the acceptance record)", async () => {
    // The receipt is the boundary's ACCEPTANCE record (the idempotency key:
    // rights + validation + first delivery), not a delivery guarantee. A
    // segment refused by the output channel keeps its receipt, so a later
    // re-delivery of the same id + content is an idempotent duplicate —
    // counted, logged, NOT re-emitted (docs/contracts/streaming.md Recovery:
    // "Duplicate messages are tolerated through idempotency keys" — the
    // boundary does not re-attempt refused sends; delivery fate belongs to
    // the channel policy and is fully accounted in stats + ledger).
    const schedule = [
      { arrivalMs: 0, segment: videoSegment("v0", 0, 0) },
      { arrivalMs: 40, segment: videoSegment("v1", 40, 1) },
      { arrivalMs: 80, segment: videoSegment("v2", 80, 2) }, // refused (channel full)
      { arrivalMs: 120, segment: videoSegment("v2", 80, 2) }, // re-delivery of the refused one
    ];
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule,
      capacity: 2,
      policy: "reject",
    });
    service.start();
    const result = await service.done();
    expect(result.stats).toMatchObject({
      segmentsIn: 4,
      segmentsOut: 2,
      rejectedBackpressure: 1,
      duplicates: 1,
      rejected: 1,
      abandoned: 0,
    });
    // in 4 = out 2 + rejected 1 + duplicate 1 — balanced, nothing silent.
    expect(result.stats.segmentsIn).toBe(
      result.stats.segmentsOut +
        result.stats.rejected +
        result.stats.duplicates +
        result.stats.abandoned,
    );
    // The refused delivery AND the duplicate are both individually observable.
    expect(service.rejections().map((r) => r.reason)).toEqual(["output-channel-full"]);
    const received = await drainChannel(channel);
    expect(received.map((m) => (m.payload as IngestedLiveSegment).segmentId)).toEqual(["v0", "v1"]);
  });

  test("a burst mixed with audio keeps per-kind FIFO order for the ADMITTED prefix", async () => {
    const schedule = [
      { arrivalMs: 0, segment: videoSegment("v0", 0, 0) },
      { arrivalMs: 40, segment: audioSegment("a0", 0, 0) },
      { arrivalMs: 80, segment: videoSegment("v1", 80, 1) },
      { arrivalMs: 120, segment: audioSegment("a1", 100, 1) },
    ];
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule,
      capacity: 1,
      policy: "reject",
    });
    service.start();
    const result = await service.done();
    expect(result.stats).toMatchObject({ segmentsIn: 4, segmentsOut: 1, rejectedBackpressure: 3 });
    const received = await drainChannel(channel);
    expect(received.map((m) => (m.payload as IngestedLiveSegment).segmentId)).toEqual(["v0"]);
  });
});

describe("drop-oldest policy — channel-owned eviction accounting (never silent)", () => {
  test("segmentsOut === received + channel.dropped (cross-boundary identity)", async () => {
    const { service, channel } = wiredService({
      sessionId: SESSION_ID,
      schedule: burst(6),
      capacity: 2,
      policy: "drop-oldest",
    });
    service.start();
    const result = await service.done();

    // The channel admits every segment (evicting the oldest when full and
    // accounting each eviction itself — W104); the service's `segmentsOut`
    // counts admissions; the consumer sees the survivors.
    expect(result.stats.segmentsOut).toBe(6);
    const received = await drainChannel(channel);
    expect(channel.dropped).toBe(4);
    expect(received.length + channel.dropped).toBe(result.stats.segmentsOut);
    // The survivors are the NEWEST two (drop-oldest semantics), in order.
    expect(received.map((m) => (m.payload as IngestedLiveSegment).segmentId)).toEqual(["v4", "v5"]);
    // The service-level accounting still balances exactly.
    expect(result.stats).toMatchObject({
      segmentsIn: 6,
      rejected: 0,
      abandoned: 0,
      duplicates: 0,
    });
  });
});
