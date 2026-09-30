/**
 * REL-012 state-machine tests: the exact 16-edge legal-transition table,
 * the terminal states, and typed reasons for illegal jumps.
 */
import { describe, expect, test } from "bun:test";
import {
  JOB_EDGES,
  JOB_STATES,
  illegalJobTransitionReason,
  isLegalJobTransition,
  isTerminalState,
  jobEdge,
  legalJobTargetsFrom,
} from "../src";

describe("the frozen job edge table", () => {
  test("is exactly the sixteen legal edges (the §12 contract)", () => {
    expect(JOB_EDGES).toEqual([
      { from: "queued", to: "leased", operation: "acquire" },
      { from: "leased", to: "running", operation: "start" },
      { from: "running", to: "checkpointed", operation: "checkpoint" },
      { from: "checkpointed", to: "running", operation: "resume" },
      { from: "running", to: "completed", operation: "complete" },
      { from: "checkpointed", to: "completed", operation: "complete" },
      { from: "running", to: "failed", operation: "fail" },
      { from: "checkpointed", to: "failed", operation: "fail" },
      { from: "failed", to: "queued", operation: "retry" },
      { from: "leased", to: "queued", operation: "requeue-takeover" },
      { from: "running", to: "queued", operation: "requeue-takeover" },
      { from: "checkpointed", to: "queued", operation: "requeue-takeover" },
      { from: "queued", to: "cancelled", operation: "cancel" },
      { from: "leased", to: "cancelled", operation: "cancel" },
      { from: "running", to: "cancelled", operation: "cancel" },
      { from: "checkpointed", to: "cancelled", operation: "cancel" },
    ]);
  });

  test("every edge is between real states", () => {
    for (const edge of JOB_EDGES) {
      expect(JOB_STATES).toContain(edge.from);
      expect(JOB_STATES).toContain(edge.to);
    }
  });

  test("the state vocabulary is the frozen seven", () => {
    expect(JOB_STATES).toEqual([
      "queued",
      "leased",
      "running",
      "checkpointed",
      "completed",
      "failed",
      "cancelled",
    ]);
  });
});

describe("legal transitions", () => {
  test("the happy path, step by step", () => {
    expect(isLegalJobTransition("queued", "leased")).toBe(true);
    expect(isLegalJobTransition("leased", "running")).toBe(true);
    expect(isLegalJobTransition("running", "checkpointed")).toBe(true);
    expect(isLegalJobTransition("checkpointed", "running")).toBe(true);
    expect(isLegalJobTransition("running", "completed")).toBe(true);
  });

  test("jobEdge returns the edge (with its operation) for legal pairs", () => {
    expect(jobEdge("failed", "queued")).toEqual({
      from: "failed",
      to: "queued",
      operation: "retry",
    });
    expect(jobEdge("running", "queued")).toEqual({
      from: "running",
      to: "queued",
      operation: "requeue-takeover",
    });
    expect(jobEdge("queued", "running")).toBeNull();
  });
});

describe("illegal transitions (the typed refusal machinery)", () => {
  test("every jump past the lease is illegal", () => {
    const jumps: Array<[string, string]> = [
      ["queued", "running"],
      ["queued", "completed"],
      ["queued", "failed"],
    ];
    for (const [from, to] of jumps) {
      expect(isLegalJobTransition(from as never, to as never)).toBe(false);
    }
  });

  test("the edge-table terminal states have no outgoing edges; failed carries the retry edge", () => {
    for (const state of ["completed", "cancelled"] as const) {
      expect(legalJobTargetsFrom(state)).toEqual([]);
      expect(isTerminalState(state)).toBe(true);
    }
    // `failed` is NOT edge-terminal: the bounded retry requeues it.
    expect(legalJobTargetsFrom("failed")).toEqual(["queued"]);
    expect(isTerminalState("failed")).toBe(false);
  });

  test("the checkpoint pair is exclusive to running<->checkpointed", () => {
    expect(isLegalJobTransition("leased", "checkpointed")).toBe(false);
    expect(isLegalJobTransition("queued", "checkpointed")).toBe(false);
    expect(isLegalJobTransition("failed", "running")).toBe(false);
  });

  test("illegalJobTransitionReason names the queued law", () => {
    expect(illegalJobTransitionReason("queued", "running")).toBe(
      "illegal jump from queued: queued -> running (a job must be leased by a worker before it can run; the only other edge from queued is cancellation)",
    );
  });

  test("illegalJobTransitionReason names the terminal law", () => {
    expect(illegalJobTransitionReason("completed", "queued")).toBe(
      "completed is terminal: completed -> queued is not a legal transition (terminal records are frozen evidence; the journal preserves the history)",
    );
  });

  test("illegalJobTransitionReason names the requeue law", () => {
    expect(illegalJobTransitionReason("completed", "queued")).toContain("terminal");
    expect(illegalJobTransitionReason("cancelled", "queued")).toContain("terminal");
  });

  test("legal pairs have no refusal reason", () => {
    expect(illegalJobTransitionReason("queued", "leased")).toBeNull();
    expect(illegalJobTransitionReason("failed", "queued")).toBeNull();
    expect(illegalJobTransitionReason("checkpointed", "cancelled")).toBeNull();
  });
});
