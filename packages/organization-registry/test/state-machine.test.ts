/**
 * REL-018 state-machine tests: the exact legal-edge table, terminal
 * `retired`, typed reasons for illegal jumps and backward attempts.
 */
import { describe, expect, test } from "bun:test";
import {
  LIFECYCLE_EDGES,
  ORGANIZATION_STATUSES,
  forwardTargetFrom,
  illegalTransitionReason,
  isLegalTransition,
  isTerminalStatus,
  legalTargetsFrom,
  lifecycleEdge,
} from "../src";

describe("the frozen lifecycle edge table", () => {
  test("is exactly the seven legal edges (4 forward + 3 rollback)", () => {
    expect(LIFECYCLE_EDGES).toEqual([
      { from: "draft", to: "benchmarked", operation: "promotion" },
      { from: "benchmarked", to: "validated", operation: "promotion" },
      { from: "validated", to: "canary", operation: "promotion" },
      { from: "canary", to: "production", operation: "promotion" },
      { from: "canary", to: "retired", operation: "rollback" },
      { from: "production", to: "retired", operation: "rollback" },
      { from: "production", to: "canary", operation: "rollback" },
    ]);
  });

  test("every edge is between real statuses", () => {
    for (const edge of LIFECYCLE_EDGES) {
      expect(ORGANIZATION_STATUSES).toContain(edge.from);
      expect(ORGANIZATION_STATUSES).toContain(edge.to);
    }
  });

  test("the status vocabulary is the frozen six", () => {
    expect(ORGANIZATION_STATUSES).toEqual([
      "draft",
      "benchmarked",
      "validated",
      "canary",
      "production",
      "retired",
    ]);
  });
});

describe("legal transitions", () => {
  test("the forward path, step by step", () => {
    expect(isLegalTransition("draft", "benchmarked")).toBe(true);
    expect(isLegalTransition("benchmarked", "validated")).toBe(true);
    expect(isLegalTransition("validated", "canary")).toBe(true);
    expect(isLegalTransition("canary", "production")).toBe(true);
  });

  test("rollback edges: retire from canary/production, demote production to canary", () => {
    expect(isLegalTransition("canary", "retired")).toBe(true);
    expect(isLegalTransition("production", "retired")).toBe(true);
    expect(isLegalTransition("production", "canary")).toBe(true);
  });

  test("lifecycleEdge returns the edge (with its operation) for legal pairs", () => {
    expect(lifecycleEdge("validated", "canary")).toEqual({
      from: "validated",
      to: "canary",
      operation: "promotion",
    });
    expect(lifecycleEdge("production", "canary")).toEqual({
      from: "production",
      to: "canary",
      operation: "rollback",
    });
    expect(lifecycleEdge("draft", "production")).toBeNull();
  });
});

describe("illegal transitions (typed refusal machinery)", () => {
  test("every skip is illegal — no state may be jumped", () => {
    const skips: Array<[string, string]> = [
      ["draft", "validated"],
      ["draft", "canary"],
      ["draft", "production"],
      ["benchmarked", "canary"],
      ["benchmarked", "production"],
      ["validated", "production"],
    ];
    for (const [from, to] of skips) {
      expect(isLegalTransition(from as never, to as never)).toBe(false);
    }
  });

  test("every backward edge is illegal except the two rollback demotions/retires", () => {
    expect(isLegalTransition("benchmarked", "draft")).toBe(false);
    expect(isLegalTransition("validated", "benchmarked")).toBe(false);
    expect(isLegalTransition("canary", "validated")).toBe(false);
    expect(isLegalTransition("production", "validated")).toBe(false);
  });

  test("illegalTransitionReason names the skipped state", () => {
    expect(illegalTransitionReason("draft", "validated")).toBe(
      "illegal skip: draft -> validated jumps states (the only forward step from draft is benchmarked)",
    );
  });

  test("illegalTransitionReason names the backward law", () => {
    expect(illegalTransitionReason("validated", "benchmarked")).toBe(
      "illegal backward transition: validated -> benchmarked (rollback can only retire, or demote production to canary)",
    );
  });

  test("legal pairs have no refusal reason", () => {
    expect(illegalTransitionReason("draft", "benchmarked")).toBeNull();
    expect(illegalTransitionReason("production", "canary")).toBeNull();
  });
});

describe("retired is terminal", () => {
  test("retired has NO outgoing legal edge of any kind", () => {
    expect(legalTargetsFrom("retired")).toEqual([]);
    expect(isTerminalStatus("retired")).toBe(true);
  });

  test("every other status has at least one outgoing edge", () => {
    for (const status of ["draft", "benchmarked", "validated", "canary", "production"] as const) {
      expect(isTerminalStatus(status)).toBe(false);
      expect(legalTargetsFrom(status).length).toBeGreaterThan(0);
    }
  });

  test("every transition out of retired is illegal, with the terminal reason", () => {
    for (const to of ["draft", "benchmarked", "validated", "canary", "production"] as const) {
      expect(isLegalTransition("retired", to)).toBe(false);
      expect(illegalTransitionReason("retired", to)).toContain("retired is terminal");
    }
  });
});

describe("forwardTargetFrom (the single-step promotion target)", () => {
  test("maps the forward path", () => {
    expect(forwardTargetFrom("draft")).toBe("benchmarked");
    expect(forwardTargetFrom("benchmarked")).toBe("validated");
    expect(forwardTargetFrom("validated")).toBe("canary");
    expect(forwardTargetFrom("canary")).toBe("production");
  });

  test("production and retired have no forward step", () => {
    expect(forwardTargetFrom("production")).toBeNull();
    expect(forwardTargetFrom("retired")).toBeNull();
  });
});
