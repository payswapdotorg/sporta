/**
 * Rights admission tests (W301) — the fail-closed gate, the W101 posture:
 * unauthorized streams are rejected at ADMISSION (before the source is even
 * opened — an unauthorized caller learns nothing about the feed), and a
 * policy that becomes invalid MID-STREAM terminates the session loudly with
 * the `rights-denied` class (defense in depth, the W102 per-call posture) —
 * never a silent mid-stream drop.
 */
import { describe, expect, test } from "bun:test";
import { buildAuthorizationPolicy } from "@sporta/testing";
import type { StageMessage } from "@sporta/contracts";
import { SCHEMA_VERSION } from "@sporta/contracts";
import { BoundedChannel } from "@sporta/transport";
import {
  FixtureLiveSource,
  InvalidLiveSessionStateError,
  RightsDeniedError,
  StreamingIngressService,
  VirtualClock,
} from "../src/index";
import { STREAMING_METRIC_NAMES as METRICS } from "../src/index";
import type { LiveSegment } from "../src/types";
import type { LiveSource, LiveSourceDescription } from "../src/source";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { capturedObservability, drainChannel, drainMicrotasks, videoSegment } from "./helpers";

const SESSION_ID = "sess-w301-rights";

/** An ISO instant 500 ms after the epoch — the mid-stream expiry point. */
const EXPIRY_ISO = new Date(TEST_EPOCH_MS + 500).toISOString();

/** A recording live source: proves whether the service ever OPENED it. */
function recordingSource(schedule: { arrivalMs: number; segment: LiveSegment }[]): LiveSource & {
  opened: () => number;
} {
  let openedCount = 0;
  const inner = {
    description: { label: "recording", mediaKinds: ["video"] } satisfies LiveSourceDescription,
    segments(): AsyncIterable<LiveSegment> {
      openedCount += 1;
      return (async function* () {
        for (const entry of schedule) {
          yield entry.segment;
        }
      })();
    },
    stop() {},
  };
  return Object.assign(inner, { opened: () => openedCount });
}

/** Wires the service over a REAL fixture feed (virtual arrival waits live). */
function wireFixture(input: {
  schedule: { arrivalMs: number; segment: LiveSegment }[];
  policy: ReturnType<typeof buildAuthorizationPolicy>;
  rightsFromClock?: boolean;
}) {
  const clock = new VirtualClock(0);
  const source = new FixtureLiveSource(
    { label: "mid-stream-feed", schedule: input.schedule },
    clock,
  );
  const channel = new BoundedChannel<StageMessage>({ capacity: 16, policy: "block" });
  const service = new StreamingIngressService({
    sessionId: SESSION_ID,
    source,
    authorizationPolicy: input.policy,
    output: channel,
    clock,
    ...(input.rightsFromClock === true ? { rightsNowMs: () => TEST_EPOCH_MS + clock.now() } : {}),
  });
  return { service, channel, clock };
}

type RecordingSource = LiveSource & { opened: () => number };

function wire(input: {
  policy?: ReturnType<typeof buildAuthorizationPolicy> | null;
  rightsNowMs?: number | (() => number);
  schedule?: { arrivalMs: number; segment: LiveSegment }[];
  source?: RecordingSource;
}) {
  const clock = new VirtualClock(0);
  const source: RecordingSource = input.source ?? recordingSource(input.schedule ?? []);
  const channel = new BoundedChannel<StageMessage>({ capacity: 8, policy: "block" });
  const obs = capturedObservability();
  const service = new StreamingIngressService({
    sessionId: SESSION_ID,
    source,
    authorizationPolicy: input.policy === undefined ? buildAuthorizationPolicy() : input.policy,
    output: channel,
    clock,
    observability: obs.options,
    ...(input.rightsNowMs === undefined ? {} : { rightsNowMs: input.rightsNowMs }),
  });
  return { service, channel, obs, clock, source };
}

describe("admission — fail closed, before the source is opened", () => {
  test("a missing policy DENIES: start() throws and the source is never opened", () => {
    const { service, obs, source } = wire({ policy: null });
    expect(() => service.start()).toThrow(RightsDeniedError);
    expect(source.opened()).toBe(0);
    expect(service.stats()).toEqual({
      segmentsIn: 0,
      segmentsOut: 0,
      rejected: 0,
      rejectedRights: 0,
      rejectedMalformed: 0,
      rejectedBackpressure: 0,
      rejectedLimit: 0,
      duplicates: 0,
      abandoned: 0,
      distinctSegments: 0,
    });
    // One warn line with the session package's structured reason.
    const records = obs.records();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "warn",
      msg: "live session admission denied",
      stage: "streaming-ingress",
      sessionId: SESSION_ID,
      fields: {
        failureClass: "rights-denied",
        reason: "missing-policy",
        requiredOperation: "analysis",
      },
    });
  });

  test("an expired policy DENIES (rights epoch injected)", () => {
    const policy = buildAuthorizationPolicy({
      policyId: "policy-expired",
      expiresAtIso: new Date(TEST_EPOCH_MS - 1).toISOString(),
    });
    const { service } = wire({ policy, rightsNowMs: TEST_EPOCH_MS });
    expect(() => service.start()).toThrow(RightsDeniedError);
    try {
      service.start();
    } catch (err) {
      expect(err).toBeInstanceOf(RightsDeniedError);
      const details = (err as RightsDeniedError).details;
      expect(details.reason).toBe("expired-policy");
      expect(details.policyId).toBe("policy-expired");
    }
  });

  test("a policy without `analysis` DENIES (missing-operation)", () => {
    const policy = buildAuthorizationPolicy({
      policyId: "policy-no-analysis",
      allowedOperations: ["storage"],
    });
    const { service } = wire({ policy, rightsNowMs: TEST_EPOCH_MS });
    expect(() => service.start()).toThrow(RightsDeniedError);
    try {
      service.start();
    } catch (err) {
      expect((err as RightsDeniedError).details.reason).toBe("missing-operation");
    }
  });

  test("denial metrics bump the rejection counter with the rights label", () => {
    const { service, obs } = wire({ policy: null });
    expect(() => service.start()).toThrow();
    const counter = obs.metrics
      .snapshot()
      .counters.find(
        (c) => c.name === METRICS.rejectedTotal && c.labels.failure_class === "rights-denied",
      );
    expect(counter?.value).toBe(1);
    const total = obs.metrics
      .snapshot()
      .counters.find((c) => c.name === METRICS.rejectedTotal && Object.keys(c.labels).length === 0);
    expect(total?.value).toBe(1);
  });

  test("a valid policy admits: one info line, source opened once, streaming phase", () => {
    const policy = buildAuthorizationPolicy({ policyId: "policy-ok" });
    const { service, obs, source } = wire({ policy, rightsNowMs: TEST_EPOCH_MS });
    service.start();
    expect(source.opened()).toBe(1);
    expect(service.currentPhase).toBe("streaming");
    const records = obs.records();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "info",
      msg: "live session admitted",
      fields: { sourceLabel: "recording", mediaKinds: ["video"], policyId: "policy-ok" },
    });
  });
});

describe("admission — API misuse fails loud (no terminal media class)", () => {
  test("start() twice throws InvalidLiveSessionStateError", () => {
    const { service } = wire({ policy: buildAuthorizationPolicy() });
    service.start();
    expect(() => service.start()).toThrow(InvalidLiveSessionStateError);
  });

  test("stop() before start() throws", async () => {
    const { service } = wire({ policy: buildAuthorizationPolicy() });
    await expect(service.stop()).rejects.toThrow(InvalidLiveSessionStateError);
  });

  test("done() before start() throws", () => {
    const { service } = wire({ policy: buildAuthorizationPolicy() });
    expect(() => service.done()).toThrow(InvalidLiveSessionStateError);
  });

  test("start() after the session ended throws", async () => {
    const { service } = wire({ policy: buildAuthorizationPolicy() });
    service.start();
    const result = await service.done();
    expect(result.outcome).toBe("completed");
    expect(() => service.start()).toThrow(InvalidLiveSessionStateError);
  });
});

describe("mid-stream rights re-check — loud termination, never silent", () => {
  test("a policy expiring mid-stream terminates the session with rights-denied", async () => {
    // Six video segments arriving at 0..500 (step 100); the policy expires at
    // virtual +500. Segments arriving strictly before the expiry flow (5);
    // the segment arriving at 500 is refused by the re-check.
    const schedule = Array.from({ length: 6 }, (_, i) => ({
      arrivalMs: i * 100,
      segment: videoSegment(`v${i}`, i * 100, i),
    }));
    const policy = buildAuthorizationPolicy({
      policyId: "policy-mid-expiry",
      expiresAtIso: EXPIRY_ISO,
    });
    const { service, channel, clock } = wireFixture({ schedule, policy, rightsFromClock: true });
    service.start();
    const result = await service.done();

    expect(result.outcome).toBe("failed");
    expect(result.terminalFailureClass).toBe("rights-denied");
    const stats = result.stats;
    expect(stats.segmentsIn).toBe(6);
    expect(stats.segmentsOut).toBe(5);
    expect(stats.rejectedRights).toBe(1);
    expect(stats.rejected).toBe(1);
    // The refused segment's structured evidence:
    expect(service.rejections()).toHaveLength(1);
    expect(service.rejections()[0]).toMatchObject({
      segmentId: "v5",
      failureClass: "rights-denied",
      reason: "rights-recheck-denied",
    });
    // The five authorized segments were delivered; the clock reached the expiry.
    const received = await drainChannel(channel);
    expect(received).toHaveLength(5);
    expect(clock.now()).toBe(500);
  });

  test("a static rights epoch never expires mid-stream (default-0 inertness documented)", async () => {
    const clock = new VirtualClock(0);
    const schedule = Array.from({ length: 3 }, (_, i) => ({
      arrivalMs: i * 100,
      segment: videoSegment(`s${i}`, i * 100, i),
    }));
    const source = recordingSource(schedule);
    const channel = new BoundedChannel<StageMessage>({ capacity: 16, policy: "block" });
    const service = new StreamingIngressService({
      sessionId: SESSION_ID,
      source,
      authorizationPolicy: buildAuthorizationPolicy({ expiresAtIso: EXPIRY_ISO }),
      output: channel,
      clock,
      rightsNowMs: 0, // the W101/W102 default: the expiry leg is inert
    });
    service.start();
    const result = await service.done();
    expect(result.outcome).toBe("completed");
    expect(result.stats.segmentsOut).toBe(3);
  });
});

describe("mid-stream — the source itself failing is a loud internal terminal", () => {
  test("a throwing iterable fails the session (internal) with zero accounting", async () => {
    const clock = new VirtualClock(0);
    const failing: LiveSource = {
      description: { label: "dies", mediaKinds: ["video"] },
      segments() {
        return (async function* () {
          yield videoSegment("v0", 0, 0);
          throw new Error("upstream connection lost");
        })();
      },
      stop() {},
    };
    const channel = new BoundedChannel<StageMessage>({ capacity: 8, policy: "block" });
    const service = new StreamingIngressService({
      sessionId: SESSION_ID,
      source: failing,
      authorizationPolicy: buildAuthorizationPolicy(),
      output: channel,
      clock,
      rightsNowMs: TEST_EPOCH_MS,
    });
    service.start();
    const result = await service.done();
    expect(result.outcome).toBe("failed");
    expect(result.terminalFailureClass).toBe("internal");
    expect(result.error).toContain("upstream connection lost");
    expect(result.stats.segmentsIn).toBe(1);
    expect(result.stats.segmentsOut).toBe(1);
    const received = await drainChannel(channel);
    expect(received).toHaveLength(1); // the segment before the failure was delivered
  });
});

describe("admission gate ordering — evidence the gate runs before ANY source work", () => {
  test("the recording source stays unopened while every denial path throws", () => {
    for (const policy of [
      null,
      buildAuthorizationPolicy({ allowedOperations: ["storage"] }),
      buildAuthorizationPolicy({ expiresAtIso: new Date(TEST_EPOCH_MS - 1).toISOString() }),
    ]) {
      const { service, source } = wire({ policy, rightsNowMs: TEST_EPOCH_MS });
      expect(() => service.start()).toThrow(RightsDeniedError);
      expect(source.opened()).toBe(0);
    }
  });

  test("denial leaves the caller-owned channel open and usable", async () => {
    const { service, channel } = wire({ policy: null });
    expect(() => service.start()).toThrow();
    // The service never started, so it never owned the channel lifecycle.
    await channel.send({
      sessionId: "other",
      schemaVersion: SCHEMA_VERSION,
      sequence: 0,
      watermark: { watermarkMs: 0, sequence: 0 },
      payload: { kind: "caller-kept-control" },
      correlationId: "corr-x",
      traceId: "trace-x",
    } satisfies StageMessage);
    expect(channel.size).toBe(1);
    channel.close();
    await drainMicrotasks(10);
  });
});
