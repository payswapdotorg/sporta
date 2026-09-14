/**
 * Job ledger tests (W303): record/event trails, the idempotency-key and
 * job-id indexes, submission order — and the ISOLATION contract
 * (architecture-lock §13: worker output is untrusted; the ledger never hands
 * out a live internal reference — tamper tests prove it).
 */
import { describe, expect, test } from "bun:test";
import { VirtualGpuClock } from "../src/clock";
import { GpuJobLedger } from "../src/ledger";
import { job, requirements } from "./helpers";
import type { LedgerOpenParams } from "../src/ledger";

const OPEN: LedgerOpenParams = {
  sequence: 0,
  submittedAtMs: 100,
  deadlineAtMs: 10_100,
  maxAttempts: 3,
  correlationId: "corr-1",
  traceId: "trace-1",
};

function freshLedger(): { ledger: GpuJobLedger; clock: VirtualGpuClock } {
  const clock = new VirtualGpuClock(100);
  return { ledger: new GpuJobLedger(clock), clock };
}

describe("GpuJobLedger", () => {
  test("open creates a queued record with the submitted event", () => {
    const { ledger } = freshLedger();
    const record = ledger.open(job("j1"), OPEN);
    expect(record.state).toBe("queued");
    expect(record.claims).toBe(0);
    expect(record.attempts).toBe(0);
    expect(record.events).toHaveLength(1);
    expect(record.events[0]?.type).toBe("submitted");
    expect(record.events[0]?.details).toMatchObject({ priority: 0, deadlineMs: 10_000 });
  });

  test("append events are frozen, timestamped on the dispatcher clock, in order", () => {
    const { ledger, clock } = freshLedger();
    const record = ledger.open(job("j1"), OPEN);
    clock.advance(50);
    ledger.append(record, "claimed", { leaseId: 1 });
    clock.advance(25);
    ledger.append(record, "succeeded", { workerId: "w-1" });
    expect(record.events.map((event) => event.type)).toEqual(["submitted", "claimed", "succeeded"]);
    expect(record.events[1]?.atMs).toBe(150);
    expect(record.events[2]?.atMs).toBe(175);
    for (const event of record.events) {
      expect(Object.isFrozen(event)).toBe(true);
      expect(Object.isFrozen(event.details)).toBe(true);
    }
  });

  test("records() returns submission order with isolated copies", () => {
    const { ledger } = freshLedger();
    ledger.open(job("j1"), OPEN);
    ledger.open(job("j2"), { ...OPEN, sequence: 1 });
    const records = ledger.records();
    expect(records.map((record) => record.jobId)).toEqual(["j1", "j2"]);
    // Fresh copies: a second call yields distinct (but deep-equal) objects.
    const again = ledger.records();
    expect(again).toEqual(records);
    expect(again[0]).not.toBe(records[0]);
  });

  test("keyRecord / hasJobId index the two identities", () => {
    const { ledger } = freshLedger();
    ledger.open(job("j1"), OPEN);
    expect(ledger.hasJobId("j1")).toBe(true);
    expect(ledger.hasJobId("j2")).toBe(false);
    expect(ledger.keyRecord("key-j1")?.jobId).toBe("j1");
    expect(ledger.keyRecord("key-nope")).toBeUndefined();
    expect(ledger.jobRecord("j1")?.idempotencyKey).toBe("key-j1");
    expect(ledger.jobRecord("nope")).toBeUndefined();
  });

  test("setState is the dispatcher's single source of truth for state", () => {
    const { ledger } = freshLedger();
    const record = ledger.open(job("j1"), OPEN);
    ledger.setState(record, "in-flight");
    expect(ledger.jobRecord("j1")?.state).toBe("in-flight");
    ledger.setState(record, "succeeded");
    expect(ledger.jobRecord("j1")?.state).toBe("succeeded");
  });

  // --- isolation (the lock §13 untrusted-posture tamper tests) --------------

  test("ISOLATION: open stores a copy — mutating the submitted envelope after submit cannot reach the ledger", () => {
    const { ledger } = freshLedger();
    const envelope = job("j1", { requirements: requirements() });
    ledger.open(envelope, OPEN);
    envelope.priority = 999;
    envelope.requirements!.memoryMb = 999_999;
    envelope.deadlineMs = 1;
    const stored = ledger.envelopeOf("j1");
    expect(stored?.priority).toBe(0);
    expect(stored?.requirements?.memoryMb).toBe(1_024);
    expect(stored?.deadlineMs).toBe(10_000);
    expect(ledger.jobRecord("j1")?.priority).toBe(0);
    expect(ledger.jobRecord("j1")?.requirements?.memoryMb).toBe(1_024);
  });

  test("ISOLATION: envelopeOf returns a fresh copy per call (claims and DLQ entries never share)", () => {
    const { ledger } = freshLedger();
    ledger.open(job("j1", { requirements: requirements() }), OPEN);
    const first = ledger.envelopeOf("j1");
    const second = ledger.envelopeOf("j1");
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    expect(first?.requirements).not.toBe(second?.requirements);
    // Mutating a handed-out envelope does not reach the ledger's storage.
    first!.priority = 77;
    first!.requirements!.modelClass = "tampered";
    expect(ledger.envelopeOf("j1")?.priority).toBe(0);
    expect(ledger.envelopeOf("j1")?.requirements?.modelClass).toBe("encode");
  });

  test("ISOLATION: records() severs the events array, lease, and requirements", () => {
    const { ledger } = freshLedger();
    const internal = ledger.open(job("j1", { requirements: requirements() }), OPEN);
    ledger.setState(internal, "in-flight");
    internal.lease = {
      leaseId: 1,
      workerId: "w-1",
      claimedAtMs: 100,
      leaseExpiresAtMs: 400,
      claimOrdinal: 1,
    };
    const copy = ledger.records()[0]!;
    // Tamper everything the copy exposes:
    copy.events.push({
      type: "succeeded",
      atMs: 0,
      details: { tampered: true },
    } as never);
    copy.lease!.leaseExpiresAtMs = 999_999;
    copy.lease!.workerId = "tampered";
    copy.requirements!.memoryMb = 999_999;
    // The ledger's own state is untouched:
    const internalNow = ledger.jobRecord("j1")!;
    expect(internalNow.events).toHaveLength(1);
    expect(internalNow.lease?.leaseExpiresAtMs).toBe(400);
    expect(internalNow.lease?.workerId).toBe("w-1");
    expect(internalNow.requirements?.memoryMb).toBe(1_024);
  });

  test("the handed-out copies are VALUE-IDENTICAL to the ledger's state", () => {
    const { ledger } = freshLedger();
    const internal = ledger.open(job("j1", { requirements: requirements() }), OPEN);
    ledger.append(internal, "claimed", { leaseId: 1 });
    const copy = ledger.records()[0]!;
    expect(copy).toEqual(internal);
    expect(copy.events).toEqual(internal.events);
    expect(copy.events[0]).toEqual(internal.events[0]);
  });
});
