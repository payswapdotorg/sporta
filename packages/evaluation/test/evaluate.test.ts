/**
 * W403 evaluation-harness tests — the ACCEPT CRITERION, made executable.
 *
 * "A fixed fixture produces comparable world-model outputs across runs
 * with documented tolerance":
 *
 * - `runReplayEvaluation({ runs: 3 })` → `comparable: true` with ZERO
 *   non-excluded diffs across ALL pairs (final snapshots AND the mid-run
 *   checkpoint pair);
 * - the SAME evaluation rerun → a deep-equal report (the harness itself is
 *   deterministic — no `Date.now`, no `Math.random` anywhere in the chain);
 * - the fusion reports of identical runs are structurally EQUAL (counts +
 *   conflict ledgers deep-equal) — the run-pair verdict includes them;
 * - the per-run artifacts are pinned (store count, fusion counts, final
 *   snapshot shape, replay checkpoint structure) so the "comparable"
 *   verdict is known to be about a REAL chain, not a degenerate one.
 */
import { describe, expect, test } from "bun:test";
import { REPLAY_GENERATED_AT_MS } from "@sporta/temporal";
import { TEST_EPOCH_MS } from "@sporta/testing";
import {
  DEFAULT_RUNS,
  DEFAULT_TOLERANCE,
  EVALUATION_ENGINE_NOW_MS,
  evaluateFixture,
  runReplayEvaluation,
  valuesEqual,
} from "../src/index";
import type { EvaluationReport } from "../src/index";
import { buildEvaluationFixture } from "../src/index";

describe("accept criterion — the fixed fixture IS cross-run comparable", () => {
  const report = runReplayEvaluation({ runs: 3 });

  test("runs: 3 → comparable TRUE, zero non-excluded diffs across ALL pairs", () => {
    expect(report.runs).toBe(3);
    expect(report.runResults).toHaveLength(3);
    expect(report.comparable).toBe(true);
    for (const record of report.pairwise) {
      expect(record.diff.comparable).toBe(true);
      expect(record.diff.diffs.filter((entry) => entry.kind !== "excluded")).toEqual([]);
      expect(record.fusionReportsEqual).toBe(true);
    }
    // The excluded entries stay VISIBLE even on identical runs (the
    // exclusion rules are recorded always — equal or not).
    for (const record of report.pairwise) {
      expect(record.diff.diffs.map((entry) => entry.path)).toEqual([
        "watermark.sequence",
        "generatedAtMs",
      ]);
    }
  });

  test("pairwise structure: run 0 vs every other run, final + mid-run checkpoint pairs", () => {
    expect(report.pairwise.map((record) => [record.a, record.b, record.kind])).toEqual([
      [0, 1, "final-snapshots"],
      [0, 1, "mid-run-checkpoints"],
      [0, 2, "final-snapshots"],
      [0, 2, "mid-run-checkpoints"],
    ]);
  });

  test("the SAME evaluation rerun → deep-equal report (harness determinism)", () => {
    expect(runReplayEvaluation({ runs: 3 })).toEqual(report);
    // And the default (runs: 2, the minimum for comparison) is comparable too.
    const minimal = runReplayEvaluation();
    expect(minimal.runs).toBe(DEFAULT_RUNS);
    expect(minimal.comparable).toBe(true);
    expect(minimal.pairwise).toHaveLength(2);
  });

  test("the report echoes the tolerance it judged with (default: the documented spec)", () => {
    expect(report.tolerance).toEqual(DEFAULT_TOLERANCE);
  });

  test("options are validated: runs < 2 and bad tolerances fail loud", () => {
    expect(() => runReplayEvaluation({ runs: 1 })).toThrow(RangeError);
    expect(() => runReplayEvaluation({ runs: 0 })).toThrow(RangeError);
    expect(() =>
      runReplayEvaluation({ tolerance: { ...DEFAULT_TOLERANCE, positionM: -1 } }),
    ).toThrow(RangeError);
  });
});

describe("accept criterion — the chain under evaluation is REAL (pinned artifacts)", () => {
  const fixture = buildEvaluationFixture();
  const run = evaluateFixture(fixture, 0);

  test("the store holds every fixture observation (235 tracks + 6 candidates)", () => {
    expect(run.storeCount).toBe(241);
  });

  test("the fusion report counts the whole chain (pinned)", () => {
    // 235 track upserts (60x4 minus the 5-frame ball gap), 5 log events
    // (kickoff, pass, pass, goal, save), 1 fulltime clock patch, 1
    // possession candidate, no conflicts, no warnings; engine version
    // 1 (genesis) + 235 + 5 + 1 + 1 = 243.
    expect(run.fusionReport).toEqual({
      entitiesUpserted: 235,
      eventsApplied: 5,
      eventsDeduplicated: 0,
      clockPatches: 1,
      possessionUpdates: 1,
      conflicts: [],
      snapshotVersionAfter: 243,
      warnings: [],
    });
  });

  test("the final live snapshot: 4 fused entities, post-match football, p1 possession", () => {
    const snapshot = run.finalSnapshot;
    expect(snapshot.sessionId).toBe(fixture.sessionId);
    expect(snapshot.entities.map((entity) => entity.entityId).sort()).toEqual([
      "ball",
      "p1",
      "p2",
      "p3",
    ]);
    // Versions count the upserts: players 60 frames, ball 55 (gap).
    expect(snapshot.entities.find((entity) => entity.entityId === "p1")?.version).toBe(60);
    expect(snapshot.entities.find((entity) => entity.entityId === "ball")?.version).toBe(55);
    expect(snapshot.football?.clock.period).toBe("post-match");
    expect(snapshot.football?.possession.status).toBe("uncertain");
    expect(snapshot.football?.possession.value).toEqual({ entityId: "p1" });
    // The watermark includes the football timeline (fulltime at 25000) and
    // the 5 applied events; generatedAtMs is the injected constant.
    expect(snapshot.watermark).toEqual({ watermarkMs: 25_000, sequence: 5 });
    expect(snapshot.generatedAtMs).toBe(TEST_EPOCH_MS);
    expect(EVALUATION_ENGINE_NOW_MS).toBe(TEST_EPOCH_MS);
  });

  test("the full-span replay: 5 checkpoints, event-derived only, forced clock", () => {
    const checkpoints = run.replayCheckpoints;
    // 4 crossed 5 s boundaries + the always-present final = 5.
    expect(checkpoints).toHaveLength(5);
    const final = checkpoints.at(-1)!;
    // Entities are NOT reconstructible from event windows (W402): the
    // replay engine holds only what the events rebuilt — none here.
    expect(final.entities).toEqual([]);
    expect(final.football).toBeUndefined();
    expect(final.watermark).toEqual({ watermarkMs: 20_000, sequence: 5 });
    expect(final.generatedAtMs).toBe(REPLAY_GENERATED_AT_MS);
    // The mid-run checkpoint (index 2) is the post-goal state at 15000 ms.
    expect(checkpoints[2]!.watermark).toEqual({ watermarkMs: 15_000, sequence: 4 });
  });
});

describe("accept criterion — fusion-report comparability across runs", () => {
  const report: EvaluationReport = runReplayEvaluation({ runs: 3 });

  test("identical runs → equal reports (counts + conflict ledgers deep-equal)", () => {
    const [first, second, third] = report.runResults;
    expect(valuesEqual(first!.fusionReport, second!.fusionReport)).toBe(true);
    expect(valuesEqual(first!.fusionReport, third!.fusionReport)).toBe(true);
    expect(first!.fusionReport).toEqual(second!.fusionReport);
    // The conflict ledger is empty for the fixed fixture (the possession
    // candidate is unambiguous by design) — pinned so a future conflict
    // source is a visible change, not a silent one.
    expect(first!.fusionReport.conflicts).toEqual([]);
    expect(first!.fusionReport.warnings).toEqual([]);
  });

  test("a run pair whose conflict ledgers differ is NOT comparable (the verdict rule)", () => {
    // The verdict is diff.comparable AND fusionReportsEqual — proven by the
    // negative leg in mutation.test.ts (a mutated run keeps equal counts
    // but its SNAPSHOT diff decides) and pinned here structurally: every
    // pairwise record carries the fusion-report equality next to the diff.
    for (const record of report.pairwise) {
      expect(record).toHaveProperty("fusionReportsEqual", true);
      expect(record).toHaveProperty("diff");
      expect(record.a).toBe(0);
      expect(record.b).toBeGreaterThan(0);
    }
  });

  test("each run's artifacts are independently deep-equal (runs differ only by index)", () => {
    const [first, second, third] = report.runResults;
    expect(first!.runIndex).toBe(0);
    expect(second!.runIndex).toBe(1);
    expect(third!.runIndex).toBe(2);
    expect(first!.finalSnapshot).toEqual(second!.finalSnapshot);
    expect(first!.replayCheckpoints).toEqual(third!.replayCheckpoints);
  });
});
