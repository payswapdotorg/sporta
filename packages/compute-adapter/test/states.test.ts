/**
 * Lifecycle state-machine tests (W914 Wave 1): the closed vocabulary, the
 * 14-edge legal transition table, terminality, and the fail-loud rejection
 * of illegal transitions (the adapter can never record an illegal change
 * silently — `assertComputeTransition` throws).
 */
import { describe, expect, it } from "bun:test";
import {
  COMPUTE_JOB_STATES,
  COMPUTE_LIVE_STATES,
  COMPUTE_TERMINAL_DISPOSITIONS,
  COMPUTE_TRANSITIONS,
  assertComputeTransition,
  canTransitionComputeJob,
  isTerminalComputeState,
} from "../src/states";

describe("the closed state vocabulary", () => {
  it("contains exactly the 8 aligned states", () => {
    expect(COMPUTE_JOB_STATES).toEqual([
      "admitted",
      "dispatched",
      "queued",
      "in-flight",
      "succeeded",
      "failed",
      "cancelled",
      "dead-lettered",
    ]);
  });

  it("terminal dispositions are the W303 GpuTerminalDisposition members verbatim", () => {
    expect(COMPUTE_TERMINAL_DISPOSITIONS).toEqual([
      "succeeded",
      "failed",
      "cancelled",
      "dead-lettered",
    ]);
  });

  it("live states are the four pre-terminal states", () => {
    expect(COMPUTE_LIVE_STATES).toEqual(["admitted", "dispatched", "queued", "in-flight"]);
  });

  it("the transition table covers every state exactly once", () => {
    expect(Object.keys(COMPUTE_TRANSITIONS).sort()).toEqual([...COMPUTE_JOB_STATES].sort());
  });
});

describe("legal transitions (the 14-edge table)", () => {
  it("admitted starts the lifecycle", () => {
    expect(canTransitionComputeJob("admitted", "dispatched")).toBe(true);
    expect(canTransitionComputeJob("admitted", "queued")).toBe(true);
    expect(canTransitionComputeJob("admitted", "cancelled")).toBe(true);
    expect(canTransitionComputeJob("admitted", "succeeded")).toBe(false);
    expect(canTransitionComputeJob("admitted", "failed")).toBe(false);
    expect(canTransitionComputeJob("admitted", "dead-lettered")).toBe(false);
    expect(canTransitionComputeJob("admitted", "in-flight")).toBe(false);
  });

  it("dispatched resolves to queued (ack) or failed (refusal) or cancelled", () => {
    expect(canTransitionComputeJob("dispatched", "queued")).toBe(true);
    expect(canTransitionComputeJob("dispatched", "failed")).toBe(true);
    expect(canTransitionComputeJob("dispatched", "cancelled")).toBe(true);
    expect(canTransitionComputeJob("dispatched", "succeeded")).toBe(false);
    expect(canTransitionComputeJob("dispatched", "in-flight")).toBe(false);
    expect(canTransitionComputeJob("dispatched", "dead-lettered")).toBe(false);
  });

  it("queued starts execution or fails determinately", () => {
    expect(canTransitionComputeJob("queued", "in-flight")).toBe(true);
    expect(canTransitionComputeJob("queued", "failed")).toBe(true);
    expect(canTransitionComputeJob("queued", "dead-lettered")).toBe(true);
    expect(canTransitionComputeJob("queued", "cancelled")).toBe(true);
    expect(canTransitionComputeJob("queued", "succeeded")).toBe(false);
    expect(canTransitionComputeJob("queued", "dispatched")).toBe(false);
  });

  it("in-flight requeues on recovery and resolves to any terminal", () => {
    expect(canTransitionComputeJob("in-flight", "queued")).toBe(true);
    expect(canTransitionComputeJob("in-flight", "succeeded")).toBe(true);
    expect(canTransitionComputeJob("in-flight", "failed")).toBe(true);
    expect(canTransitionComputeJob("in-flight", "dead-lettered")).toBe(true);
    expect(canTransitionComputeJob("in-flight", "cancelled")).toBe(true);
    expect(canTransitionComputeJob("in-flight", "admitted")).toBe(false);
    expect(canTransitionComputeJob("in-flight", "dispatched")).toBe(false);
  });

  it("terminal states are terminal — exactly one disposition per job", () => {
    for (const terminal of COMPUTE_TERMINAL_DISPOSITIONS) {
      expect(COMPUTE_TRANSITIONS[terminal]).toEqual([]);
      expect(isTerminalComputeState(terminal)).toBe(true);
      for (const target of COMPUTE_JOB_STATES) {
        expect(canTransitionComputeJob(terminal, target)).toBe(false);
      }
    }
  });

  it("isTerminalComputeState is false for every live state", () => {
    for (const state of COMPUTE_LIVE_STATES) {
      expect(isTerminalComputeState(state)).toBe(false);
    }
  });
});

describe("the fail-loud transition assertion", () => {
  it("accepts every legal edge", () => {
    for (const [from, targets] of Object.entries(COMPUTE_TRANSITIONS)) {
      for (const to of targets) {
        expect(() => assertComputeTransition(from as never, to)).not.toThrow();
      }
    }
  });

  it("throws a RangeError naming both states and the legal successors", () => {
    let error: unknown;
    try {
      assertComputeTransition("succeeded", "failed");
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(RangeError);
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("'succeeded' -> 'failed'");
    expect(message).toContain("terminal state");
  });

  it("rejects skipped phases (admitted cannot resolve directly)", () => {
    expect(() => assertComputeTransition("admitted", "succeeded")).toThrow(RangeError);
    expect(() => assertComputeTransition("queued", "dead-lettered")).not.toThrow();
    expect(() => assertComputeTransition("queued", "in-flight")).not.toThrow();
    expect(() => assertComputeTransition("cancelled", "queued")).toThrow(RangeError);
    expect(() => assertComputeTransition("dead-lettered", "requeued" as never)).toThrow(RangeError);
  });
});
