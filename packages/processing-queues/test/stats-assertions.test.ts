/**
 * Balance-assertion tests (W302) — the teeth of the never-silent
 * constitution, proven DIRECTLY (mutation-detection style, the W403/W503
 * posture): `assertAccountingBalance` and `reconcileStageFlows` run inside
 * the pipeline before EVERY settle, and an imbalance rejects the done()
 * promise instead of returning a lying result. The pipeline-level suites
 * exercise them implicitly on balanced stories; here every invariant is
 * BROKEN one at a time and each must throw `RangeError` with the exact
 * breakdown — a silent pass would mean the fail-loud guarantee itself is
 * untested.
 */
import { describe, expect, test } from "bun:test";
import {
  assertAccountingBalance,
  emptyStageStats,
  emptyStats,
  reconcileStageFlows,
} from "../src/types";
import type { PipelineStats, StageStats } from "../src/types";

/**
 * A balanced 2-stage snapshot: 10 in = 7 out + 1 rejected + 1 duplicate +
 * 1 dead-lettered; 8 admitted (1 input refusal + 1 duplicate never entered).
 */
function balancedStats(): PipelineStats {
  return {
    ...emptyStats([0, 0, 0]),
    segmentsIn: 10,
    admitted: 8,
    segmentsOut: 7,
    rejected: 1,
    rejectedBackpressure: 1,
    duplicates: 1,
    deadLettered: 1,
    dlqRetained: 1,
    distinctProcessed: 8,
  };
}

/** Balanced stage stats for the snapshot above: stage a emits 8, stage b emits 7 + 1 DLQ. */
function balancedStages(): StageStats[] {
  return [
    { ...emptyStageStats("a"), received: 8, emitted: 8 },
    { ...emptyStageStats("b"), received: 8, emitted: 7, failed: 1 },
  ];
}

describe("assertAccountingBalance — balanced snapshots pass, every imbalance throws", () => {
  test("the balanced reference snapshot passes", () => {
    expect(() => assertAccountingBalance(balancedStats())).not.toThrow();
  });

  test("an all-zero snapshot is balanced (the empty pipeline)", () => {
    expect(() => assertAccountingBalance(emptyStats())).not.toThrow();
  });

  test("invariant 1: rejected sub-counters must sum to the total", () => {
    const stats = balancedStats();
    stats.rejectedMalformed = 1; // sub-sum 2 != total 1
    expect(() => assertAccountingBalance(stats)).toThrow(/rejected sub-counters do not sum/);
    expect(() => assertAccountingBalance(stats)).toThrow(/1 != 1 malformed \+ 1 backpressure/);
  });

  test("invariant 2: abandoned sub-counters must sum to the total", () => {
    const stats = balancedStats();
    stats.abandoned = 1; // 1 != 0 admission + 0 processing
    expect(() => assertAccountingBalance(stats)).toThrow(/abandoned sub-counters do not sum/);
  });

  test("invariant 3: segmentsIn must equal the terminal buckets (the brief's formula)", () => {
    const stats = balancedStats();
    stats.segmentsOut = 9; // 12 accounted != 10 in
    expect(() => assertAccountingBalance(stats)).toThrow(
      /processing-queues accounting does not balance/,
    );
    expect(() => assertAccountingBalance(stats)).toThrow(/segmentsIn 10 !=/);
    expect(() => assertAccountingBalance(stats)).toThrow(/accounted: 12/);
  });

  test("invariant 3 includes the dropped term: a counted drop closes the loop, an uncounted one throws", () => {
    // 8 admitted: 6 out + 1 dead-lettered + 1 dropped (input-queue eviction);
    // invariant 3: 10 in = 6 + 1 + 1 + 1 + 0 + 1.
    const stats = {
      ...balancedStats(),
      segmentsOut: 6,
      dropped: 1,
    };
    expect(() => assertAccountingBalance(stats)).not.toThrow();
    // The same snapshot with the drop erased from every bucket is imbalanced —
    // an eviction can never vanish silently.
    const silent = { ...stats, dropped: 0 };
    expect(() => assertAccountingBalance(silent)).toThrow(/does not balance/);
  });

  test("invariant 4: admitted must equal what terminally left the pipeline", () => {
    const stats = balancedStats();
    stats.admitted = 10; // 10 admitted != 7 out + 1 dead + 0 + 0 + 0
    expect(() => assertAccountingBalance(stats)).toThrow(/admitted segments do not balance/);
    expect(() => assertAccountingBalance(stats)).toThrow(/admitted 10 !=/);
  });

  test("invariant 5: deadLettered must match the DLQ ledger (retained + overflow)", () => {
    // Same balance as the reference but the ledger claims 2 retained for 1
    // dead letter — only invariant 5 can catch the lie.
    const ledgerOnly: PipelineStats = {
      ...balancedStats(),
      dlqRetained: 2,
    };
    expect(() => assertAccountingBalance(ledgerOnly)).toThrow(/does not match the DLQ ledger/);
    expect(() => assertAccountingBalance(ledgerOnly)).toThrow(/deadLettered 1 !=/);
  });

  test("a lying snapshot (everything zero but one segment out) fails", () => {
    const lying = { ...emptyStats(), segmentsOut: 1 };
    expect(() => assertAccountingBalance(lying)).toThrow(RangeError);
  });
});

describe("reconcileStageFlows — per-stage flow identities, fail-loud", () => {
  test("the balanced reference stages pass", () => {
    expect(() => reconcileStageFlows(balancedStats(), balancedStages(), [0, 0])).not.toThrow();
  });

  test("stage 0 inflow is `admitted`: a lost input segment throws", () => {
    const stages = balancedStages();
    stages[0]!.received = 7; // 8 admitted != 7 received + 0 dropped + 0 swept
    expect(() => reconcileStageFlows(balancedStats(), stages, [0, 0])).toThrow(
      /stage-flow identity broken at stage 'a'/,
    );
    expect(() => reconcileStageFlows(balancedStats(), stages, [0, 0])).toThrow(/inflow 8 !=/);
  });

  test("input-queue evictions count as stage-0 inflow (dropped reconciled)", () => {
    // 8 admitted, 7 received by stage a, 1 evicted by drop-oldest: balanced.
    const stats = { ...balancedStats(), dropped: 1 };
    const stages = [
      { ...emptyStageStats("a"), received: 7, emitted: 7 },
      { ...emptyStageStats("b"), received: 7, emitted: 7 },
    ];
    expect(() => reconcileStageFlows(stats, stages, [1, 0])).not.toThrow();
    // Claim no eviction → the flow breaks (the drop cannot vanish silently).
    expect(() => reconcileStageFlows(stats, stages, [0, 0])).toThrow(/inflow 8 !=/);
  });

  test("stage j inflow is stage j-1 emitted: a gap between stages throws", () => {
    const stages = balancedStages();
    stages[1]!.received = 7; // 8 emitted by a != 7 received by b
    expect(() => reconcileStageFlows(balancedStats(), stages, [0, 0])).toThrow(
      /stage-flow identity broken at stage 'b'/,
    );
  });

  test("the cancel-semantics snapshot balances: swept queues are abandonedQueued", () => {
    // One stage, cancel: 9 admitted; 3 received (1 emitted, 1 dead-lettered,
    // 1 abandoned in-flight); 6 swept from the input queue. The whole-pipeline
    // stats balance too (assertAccountingBalance passes on the same numbers).
    const stats: PipelineStats = {
      ...emptyStats([0, 0]),
      segmentsIn: 9,
      admitted: 9,
      segmentsOut: 1,
      deadLettered: 1,
      dlqRetained: 1,
      abandoned: 7,
      abandonedProcessing: 7,
      distinctProcessed: 2,
    };
    expect(() => assertAccountingBalance(stats)).not.toThrow();
    const stages: StageStats[] = [
      {
        ...emptyStageStats("a"),
        received: 3,
        emitted: 1,
        failed: 1,
        abandonedInFlight: 1,
        abandonedQueued: 6,
      },
    ];
    expect(() => reconcileStageFlows(stats, stages, [0])).not.toThrow();
    // Undercount the sweep → 3 received + 5 swept = 8 != 9 admitted: throws.
    const lying = [{ ...stages[0]!, abandonedQueued: 5 }];
    expect(() => reconcileStageFlows(stats, lying, [0])).toThrow(
      /stage-flow identity broken at stage 'a'/,
    );
    expect(() => reconcileStageFlows(stats, lying, [0])).toThrow(/outflow 8/);
  });

  test("the per-stage disposition identity: received must equal emitted+failed+refused+abandoned+inFlight", () => {
    const stages = balancedStages();
    stages[1]!.emitted = 8; // 8 emitted + 1 failed != 8 received
    expect(() => reconcileStageFlows(balancedStats(), stages, [0, 0])).toThrow(
      /stage disposition identity broken at stage 'b'/,
    );
    expect(() => reconcileStageFlows(balancedStats(), stages, [0, 0])).toThrow(
      /received 8 != emitted 8 \+ failed 1/,
    );
  });

  test("stage stats beyond the channel array default to zero dropped (defensive)", () => {
    expect(() => reconcileStageFlows(balancedStats(), balancedStages(), [])).not.toThrow();
  });
});

describe("snapshot helpers", () => {
  test("emptyStats is all-zero with a caller-owned queueDepths copy", () => {
    const depths = [1, 2];
    const stats = emptyStats(depths);
    expect(stats.queueDepths).toEqual([1, 2]);
    depths.push(3);
    expect(stats.queueDepths).toEqual([1, 2]);
    for (const [key, value] of Object.entries(stats)) {
      if (key !== "queueDepths") expect(value).toBe(0);
    }
  });

  test("emptyStageStats is all-zero for the named stage", () => {
    const stage = emptyStageStats("x");
    expect(stage.stage).toBe("x");
    for (const [key, value] of Object.entries(stage)) {
      if (key !== "stage") expect(value).toBe(0);
    }
  });
});
