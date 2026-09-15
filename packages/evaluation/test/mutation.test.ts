/**
 * W403 negative tests — mutations of the fixed fixture ARE DETECTED.
 *
 * The comparability verdict must be a real measurement, not a tautology:
 *
 * - a mutation ABOVE tolerance (+0.5 m on ONE track observation's position,
 *   via a store rebuilt from the mutated fixture) → the pairwise diff
 *   contains the EXACT entity+slot path with delta ≈ 0.5 (the fusion
 *   carries the position through) and `comparable: false`;
 * - a mutation BELOW tolerance (+1e-12 on the possession winner's last
 *   position) → `comparable` stays TRUE: the position delta sits inside
 *   the 1e-9 position epsilon AND the propagated possession-confidence
 *   delta sits inside the 1e-12 confidence epsilon — tolerance behavior
 *   proven END-TO-END through the real W005→W401 chain.
 *
 * The mutated observation is always the entity's LAST track observation
 * (frame 59): W006 replaces entity state wholesale on upsert, so only the
 * last observation's position survives to the fused entity.
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIDENCE_EPSILON,
  DEFAULT_POSITION_EPSILON_M,
  buildEvaluationFixture,
  compareSnapshots,
  evaluateFixture,
  mutateFixturePosition,
  valuesEqual,
} from "../src/index";

/** Reads a fused entity's position.x from a run's final snapshot (fail loud). */
function fusedPositionX(run: ReturnType<typeof evaluateFixture>, entityId: string): number {
  const entity = run.finalSnapshot.entities.find((candidate) => candidate.entityId === entityId);
  const position = entity?.state.position as { value?: { x?: number } } | undefined;
  const x = position?.value?.x;
  if (typeof x !== "number") {
    throw new Error(`entity ${entityId} carries no numeric position.value.x`);
  }
  return x;
}

describe("negative — a +0.5 m position mutation IS detected (above tolerance)", () => {
  const fixture = buildEvaluationFixture();
  // p3's LAST track observation: the mutation survives the chain, and p3
  // is far from the ball (no possession side effects — a clean single diff).
  const p3LastIndex = fixture.tracks.findIndex(
    (observation) => observation.observationId === "w403-trk-f059-p3",
  );
  const baseline = evaluateFixture(fixture, 0);
  const mutated = mutateFixturePosition(fixture, p3LastIndex, 0.5, 0);
  const mutatedRun = evaluateFixture(mutated, 1);
  const diff = compareSnapshots(baseline.finalSnapshot, mutatedRun.finalSnapshot);

  test("comparable FALSE, with the exact entity+slot path and delta ≈ 0.5", () => {
    expect(diff.comparable).toBe(false);
    const entry = diff.diffs.find(
      (candidate) => candidate.path === "entities[p3].state.position.value.x",
    );
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe("numeric");
    expect(entry!.delta).toBeCloseTo(0.5, 12);
    expect(entry!.tolerance).toBe(DEFAULT_POSITION_EPSILON_M);
    // The fusion carried the mutated position through verbatim: the diff's
    // sides ARE the two runs' fused entity positions.
    expect(entry!.a).toBe(fusedPositionX(baseline, "p3"));
    expect(entry!.b).toBe(fusedPositionX(mutatedRun, "p3"));
  });

  test("the position difference is the ONLY non-excluded diff (a clean signal)", () => {
    expect(
      diff.diffs.filter((entry) => entry.kind !== "excluded").map((entry) => entry.path),
    ).toEqual(["entities[p3].state.position.value.x"]);
  });

  test("the mutation does NOT change the fusion counts (detection is the snapshot's job)", () => {
    // Same upsert/event/patch/possession counts, same (empty) conflict
    // ledger: the reports stay equal — the INCOMPARABILITY comes from the
    // snapshot diff, exactly what the pairwise verdict rule combines.
    expect(valuesEqual(baseline.fusionReport, mutatedRun.fusionReport)).toBe(true);
    expect(mutatedRun.storeCount).toBe(baseline.storeCount);
  });
});

describe("negative — a BELOW-tolerance mutation stays comparable (end-to-end)", () => {
  const fixture = buildEvaluationFixture();
  // p1's LAST track observation: p1 is the possession winner, so the tiny
  // position delta ALSO propagates into football.possession.confidence —
  // both field classes exercised through the real chain.
  const p1LastIndex = fixture.tracks.findIndex(
    (observation) => observation.observationId === "w403-trk-f059-p1",
  );
  const baseline = evaluateFixture(fixture, 0);
  const mutated = mutateFixturePosition(fixture, p1LastIndex, DEFAULT_POSITION_EPSILON_M / 1000, 0);
  const mutatedRun = evaluateFixture(mutated, 1);
  const diff = compareSnapshots(baseline.finalSnapshot, mutatedRun.finalSnapshot);

  test("comparable stays TRUE (the mutation is real but inside tolerance)", () => {
    expect(diff.comparable).toBe(true);
  });

  test("the position delta is recorded, within the 1e-9 position epsilon", () => {
    const position = diff.diffs.find(
      (candidate) => candidate.path === "entities[p1].state.position.value.x",
    );
    expect(position).toBeDefined();
    expect(position!.kind).toBe("numeric");
    expect(position!.delta!).toBeGreaterThan(0);
    expect(position!.delta!).toBeLessThanOrEqual(DEFAULT_POSITION_EPSILON_M);
    expect(position!.tolerance).toBe(DEFAULT_POSITION_EPSILON_M);
  });

  test("the propagated possession-confidence delta is recorded, within the 1e-12 epsilon", () => {
    const confidence = diff.diffs.find(
      (candidate) => candidate.path === "football.possession.confidence",
    );
    expect(confidence).toBeDefined();
    expect(confidence!.kind).toBe("numeric");
    // The confidence = ball x track x (1 - distance / radius) product: a
    // ~1e-12 position shift moves the distance (and so the confidence) by
    // well under 1e-12 — recorded, visible, never a failure.
    expect(confidence!.delta!).toBeGreaterThan(0);
    expect(confidence!.delta!).toBeLessThanOrEqual(DEFAULT_CONFIDENCE_EPSILON);
    expect(confidence!.tolerance).toBe(DEFAULT_CONFIDENCE_EPSILON);
  });

  test("no OTHER field moved (the mutation is surgical end-to-end)", () => {
    expect(
      diff.diffs
        .filter((entry) => entry.kind !== "excluded")
        .map((entry) => entry.path)
        .sort(),
    ).toEqual(["entities[p1].state.position.value.x", "football.possession.confidence"]);
  });
});

describe("negative — a mutation on the ball stream is detected too (the gap survives)", () => {
  test("a +2 m ball mutation flips the possession winner's inputs and is detected", () => {
    const fixture = buildEvaluationFixture();
    // The ball's LAST observation: moving the ball 2 m away from p1 pushes
    // it to the possession-radius edge — the fused ball entity's position
    // diff is the loud, unambiguous signal.
    const ballLastIndex = fixture.tracks.findIndex(
      (observation) => observation.observationId === "w403-trk-f059-ball",
    );
    const baseline = evaluateFixture(fixture, 0);
    const mutatedRun = evaluateFixture(mutateFixturePosition(fixture, ballLastIndex, 2, 2), 1);
    const diff = compareSnapshots(baseline.finalSnapshot, mutatedRun.finalSnapshot);
    expect(diff.comparable).toBe(false);
    expect(
      diff.diffs.find((candidate) => candidate.path === "entities[ball].state.position.value.x"),
    ).toBeDefined();
    expect(
      diff.diffs.find((candidate) => candidate.path === "entities[ball].state.position.value.y"),
    ).toBeDefined();
  });
});
