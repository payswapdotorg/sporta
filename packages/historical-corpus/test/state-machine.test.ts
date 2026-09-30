/**
 * REL-009 acquisition-state-machine tests: the exact legal-edge table, the
 * terminal state, and typed reasons for every illegal jump.
 */
import { describe, expect, test } from "bun:test";
import {
  ACQUISITION_EDGES,
  ACQUISITION_STATES,
  acquisitionEdge,
  illegalAcquisitionTransitionReason,
  isLegalAcquisitionTransition,
  isTerminalAcquisitionState,
  legalAcquisitionTargetsFrom,
} from "../src";

describe("the frozen acquisition edge table", () => {
  test("is exactly the four legal edges of the contract", () => {
    expect(ACQUISITION_EDGES).toEqual([
      { from: "referenced", to: "authorized-for-access", operation: "authorize" },
      { from: "authorized-for-access", to: "acquired", operation: "acquire" },
      { from: "acquired", to: "normalized", operation: "normalize" },
      { from: "normalized", to: "benchmarked", operation: "benchmark" },
    ]);
  });

  test("every edge is between real states", () => {
    for (const edge of ACQUISITION_EDGES) {
      expect(ACQUISITION_STATES).toContain(edge.from);
      expect(ACQUISITION_STATES).toContain(edge.to);
    }
  });

  test("the state vocabulary is the frozen five", () => {
    expect(ACQUISITION_STATES).toEqual([
      "referenced",
      "authorized-for-access",
      "acquired",
      "normalized",
      "benchmarked",
    ]);
  });
});

describe("legal transitions", () => {
  test("the forward path, step by step", () => {
    expect(isLegalAcquisitionTransition("referenced", "authorized-for-access")).toBe(true);
    expect(isLegalAcquisitionTransition("authorized-for-access", "acquired")).toBe(true);
    expect(isLegalAcquisitionTransition("acquired", "normalized")).toBe(true);
    expect(isLegalAcquisitionTransition("normalized", "benchmarked")).toBe(true);
  });

  test("acquisitionEdge returns the edge (with its operation) for legal pairs", () => {
    expect(acquisitionEdge("referenced", "authorized-for-access")).toEqual({
      from: "referenced",
      to: "authorized-for-access",
      operation: "authorize",
    });
    expect(acquisitionEdge("acquired", "normalized")).toEqual({
      from: "acquired",
      to: "normalized",
      operation: "normalize",
    });
    expect(acquisitionEdge("referenced", "acquired")).toBeNull();
  });
});

describe("illegal transitions (the typed refusal machinery)", () => {
  test("every skip is illegal — no state may be jumped", () => {
    const skips: Array<[string, string]> = [
      ["referenced", "acquired"],
      ["referenced", "normalized"],
      ["referenced", "benchmarked"],
      ["authorized-for-access", "normalized"],
      ["authorized-for-access", "benchmarked"],
      ["acquired", "benchmarked"],
    ];
    for (const [from, to] of skips) {
      expect(isLegalAcquisitionTransition(from as never, to as never)).toBe(false);
    }
  });

  test("every backward edge is illegal", () => {
    expect(isLegalAcquisitionTransition("authorized-for-access", "referenced")).toBe(false);
    expect(isLegalAcquisitionTransition("acquired", "authorized-for-access")).toBe(false);
    expect(isLegalAcquisitionTransition("normalized", "acquired")).toBe(false);
    expect(isLegalAcquisitionTransition("benchmarked", "normalized")).toBe(false);
  });

  test("illegalAcquisitionTransitionReason names the skipped state", () => {
    expect(illegalAcquisitionTransitionReason("referenced", "acquired")).toBe(
      "illegal skip: referenced -> acquired jumps states (the only step from referenced is authorized-for-access)",
    );
  });

  test("illegalAcquisitionTransitionReason names the backward law", () => {
    expect(illegalAcquisitionTransitionReason("normalized", "acquired")).toBe(
      "illegal backward transition: normalized -> acquired (acquisition only moves forward: referenced -> authorized-for-access -> acquired -> normalized -> benchmarked)",
    );
  });

  test("legal pairs have no refusal reason", () => {
    expect(illegalAcquisitionTransitionReason("referenced", "authorized-for-access")).toBeNull();
    expect(illegalAcquisitionTransitionReason("normalized", "benchmarked")).toBeNull();
  });
});

describe("benchmarked is terminal", () => {
  test("benchmarked has NO outgoing legal edge of any kind", () => {
    expect(legalAcquisitionTargetsFrom("benchmarked")).toEqual([]);
    expect(isTerminalAcquisitionState("benchmarked")).toBe(true);
  });

  test("every non-terminal state has exactly one outgoing edge", () => {
    for (const state of ACQUISITION_STATES.filter((candidate) => candidate !== "benchmarked")) {
      expect(legalAcquisitionTargetsFrom(state)).toHaveLength(1);
      expect(isTerminalAcquisitionState(state)).toBe(false);
    }
  });

  test("illegalAcquisitionTransitionReason names the terminal law", () => {
    expect(illegalAcquisitionTransitionReason("benchmarked", "referenced")).toBe(
      "benchmarked is terminal: benchmarked -> referenced is not a legal transition (a benchmarked source is frozen evidence)",
    );
  });
});
