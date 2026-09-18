import { describe, expect, test } from "bun:test";
import { createRng } from "@sporta/testing";
import { FORBIDDEN_COST, assignmentTotalCost, solveHungarianAssignment } from "../src/index";

/**
 * Brute-force reference: the lexicographically best (cardinality, cost)
 * over matchings built from ALLOWED pairs only (sentinel pairs are
 * forbidden — they match nothing). Mirrors the solver's documented
 * semantics exactly.
 */
function bruteForceBest(cost: readonly (readonly number[])[]): {
  cardinality: number;
  cost: number;
} {
  const n = cost.length;
  const m = n === 0 ? 0 : cost[0]!.length;
  let bestCardinality = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  const visit = (row: number, used: boolean[], total: number, matched: number): void => {
    if (row === n) {
      if (matched > bestCardinality || (matched === bestCardinality && total < bestCost)) {
        bestCardinality = matched;
        bestCost = total;
      }
      return;
    }
    for (let column = 0; column < m; column += 1) {
      if (used[column]) continue;
      if (cost[row]![column]! >= FORBIDDEN_COST / 2) continue;
      used[column] = true;
      visit(row + 1, used, total + cost[row]![column]!, matched + 1);
      used[column] = false;
    }
    visit(row + 1, used, total, matched);
  };
  visit(0, new Array<boolean>(m).fill(false), 0, 0);
  return {
    cardinality: Math.max(bestCardinality, 0),
    cost: bestCost === Number.POSITIVE_INFINITY ? 0 : bestCost,
  };
}

describe("the own O(n^3) Hungarian solver (R203)", () => {
  test("empty inputs are well-defined", () => {
    expect(solveHungarianAssignment([])).toEqual([]);
    expect(solveHungarianAssignment([[]])).toEqual([-1]);
    expect(solveHungarianAssignment([[], []])).toEqual([-1, -1]);
  });

  test("solves the classic textbook assignment optimally", () => {
    // Classic example: minimum total cost 10 (0->2, 1->0, 2->1 style).
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const assignment = solveHungarianAssignment(cost);
    expect(assignmentTotalCost(cost, assignment)).toBe(5);
  });

  test("matches brute force on seeded random matrices (square, rectangular, gated)", () => {
    const rng = createRng(987654321);
    for (let trial = 0; trial < 300; trial += 1) {
      const n = 1 + Math.floor(rng() * 4);
      const m = 1 + Math.floor(rng() * 4);
      const gated = rng() < 0.3;
      const cost: number[][] = [];
      for (let i = 0; i < n; i += 1) {
        const row: number[] = [];
        for (let j = 0; j < m; j += 1) {
          row.push(gated && rng() < 0.35 ? FORBIDDEN_COST : Math.floor(rng() * 20));
        }
        cost.push(row);
      }
      const assignment = solveHungarianAssignment(cost);
      const solverCost = assignmentTotalCost(cost, assignment);
      const solverCardinality = assignment.filter((column) => column !== -1).length;
      const brute = bruteForceBest(cost);
      expect(solverCardinality).toBe(brute.cardinality);
      expect(solverCost).toBe(brute.cost);
      // Determinism: solving twice yields the identical assignment.
      expect(solveHungarianAssignment(cost)).toEqual(assignment);
      // Structural validity: injective, in range.
      const used = new Set<number>();
      for (const column of assignment) {
        if (column === -1) continue;
        expect(column).toBeGreaterThanOrEqual(0);
        expect(column).toBeLessThan(m);
        expect(used.has(column)).toBe(false);
        used.add(column);
      }
    }
  });

  test("forbidden (sentinel) pairs are never forced", () => {
    // Track 0 can only pair with detection 1; track 1 only with detection 0
    // — the solver must take both allowed pairs despite the huge sentinel.
    const cost = [
      [FORBIDDEN_COST, 1],
      [2, FORBIDDEN_COST],
    ];
    expect(solveHungarianAssignment(cost)).toEqual([1, 0]);
    // Fully forbidden: everyone unmatched.
    const allForbidden = [
      [FORBIDDEN_COST, FORBIDDEN_COST],
      [FORBIDDEN_COST, FORBIDDEN_COST],
    ];
    expect(solveHungarianAssignment(allForbidden)).toEqual([-1, -1]);
  });

  test("more rows than columns leaves the surplus rows unmatched (no forced pairing)", () => {
    const cost = [
      [1, 5],
      [5, 1],
      [1, 1],
    ];
    const assignment = solveHungarianAssignment(cost);
    // Two of three rows get the two columns; one stays unmatched.
    const matched = assignment.filter((column) => column !== -1);
    expect(matched.length).toBe(2);
    expect(assignmentTotalCost(cost, assignment)).toBe(2);
  });

  test("deterministic ties resolve to the lowest indices (no RNG involved)", () => {
    const cost = [
      [1, 1],
      [1, 1],
    ];
    expect(solveHungarianAssignment(cost)).toEqual([0, 1]);
    expect(solveHungarianAssignment(cost)).toEqual([0, 1]);
  });
});
