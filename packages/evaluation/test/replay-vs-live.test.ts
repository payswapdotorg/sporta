/**
 * W403 replay-vs-live tests — the W402 reconciliation.
 *
 * The W402-documented replay-vs-live differences are EXACTLY the excluded
 * fields, and this file proves it end-to-end: run-0's `replayForward` final
 * snapshot compared (under the default tolerance) against the live
 * engine's event-horizon state is COMPARABLE, with the documented excluded
 * fields — `generatedAtMs` (engine clock vs `REPLAY_GENERATED_AT_MS`) and
 * `watermark.sequence` (replay-local counter) — as the ONLY diffs.
 *
 * WHY THE EVENT HORIZON: W402 documents THREE replay-vs-live differences —
 * the two excluded fields, plus "entities are not reconstructible from
 * event windows" (an event-only replay rebuilds only event-derived state:
 * `replayForward` applies log entries to a FRESH engine whose `init`
 * carries no entities, and the W403 harness deliberately passes no
 * caller-pinned football either). The live state that is honestly
 * comparable to that reconstruction is the live engine queried AT THE LAST
 * EVENT's timeline position (`stateAt(engine, 20000)`, the save — the
 * fixture's event horizon): entities and football state established after
 * the horizon (the vision tracks at 20400+, the fulltime clock patch at
 * 25000) are excluded by the at-T contract for the same documented reason
 * the replay cannot reconstruct them. The FULL `engine.snapshot()`, by
 * contrast, additionally carries them — comparing IT against the replay
 * fails on exactly those W402-documented non-reconstructible subtrees,
 * which the last test pins as the honest boundary of the comparison.
 */
import { describe, expect, test } from "bun:test";
import { InMemoryObservationStore } from "@sporta/observation";
import { REPLAY_GENERATED_AT_MS, stateAt } from "@sporta/temporal";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { runWorldFusion } from "@sporta/fusion";
import { WorldModelEngine } from "@sporta/world-model";
import {
  EVALUATION_ENGINE_NOW_MS,
  EVALUATION_FOOTBALL_INIT,
  EVALUATION_LAST_EVENT_TIME_MS,
  buildEvaluationFixture,
  compareSnapshots,
  evaluateFixture,
} from "../src/index";
import type { SnapshotDiff } from "../src/index";
import type { EvaluationFixture } from "../src/index";

/**
 * Rebuilds run-0's LIVE engine through the exact chain the harness runs
 * (fixture -> store -> fresh engine with the documented football init and
 * deterministic clock -> one W401 fusion pass). The rebuilt engine is
 * deep-equal in behavior to the harness's run-0 engine — pinned by the
 * first test — so the `stateAt` pin below is the live side of run-0's
 * replay-vs-live comparison.
 */
function rebuildRun0Engine(fixture: EvaluationFixture): WorldModelEngine {
  const store = new InMemoryObservationStore();
  for (const observation of [...fixture.tracks, ...fixture.candidates]) {
    store.append(observation);
  }
  const engine = WorldModelEngine.create(fixture.sessionId, {
    football: EVALUATION_FOOTBALL_INIT,
    now: () => EVALUATION_ENGINE_NOW_MS,
  });
  runWorldFusion({ store, engine, sessionId: fixture.sessionId });
  return engine;
}

/** The non-excluded diffs (the only ones that can fail comparability). */
function nonExcluded(diff: SnapshotDiff) {
  return diff.diffs.filter((entry) => entry.kind !== "excluded");
}

describe("replay-vs-live — the documented differences are the ONLY diffs", () => {
  const fixture = buildEvaluationFixture();
  const run0 = evaluateFixture(fixture, 0);
  const engine = rebuildRun0Engine(fixture);
  const liveAtEventHorizon = stateAt(engine, EVALUATION_LAST_EVENT_TIME_MS).snapshot;
  const replayFinal = run0.replayCheckpoints.at(-1)!;

  test("the rebuilt engine IS run-0's engine (the chain equivalence is pinned)", () => {
    expect(engine.snapshot()).toEqual(run0.finalSnapshot);
  });

  test("comparable TRUE: only generatedAtMs and watermark.sequence differ", () => {
    const diff = compareSnapshots(liveAtEventHorizon, replayFinal);
    expect(diff.comparable).toBe(true);
    expect(nonExcluded(diff)).toEqual([]);
    expect(diff.diffs.map((entry) => entry.path)).toEqual(["watermark.sequence", "generatedAtMs"]);
    expect(diff.diffs.every((entry) => entry.kind === "excluded")).toBe(true);
  });

  test("the excluded entries carry the documented W402 values", () => {
    const diff = compareSnapshots(liveAtEventHorizon, replayFinal);
    const sequence = diff.diffs.find((entry) => entry.path === "watermark.sequence");
    // Replay-local counter vs the live log's sequence — equal here (the
    // fixture replays the full span in order), still EXCLUDED BY RULE and
    // visible: the rule is not "different", the rule is "not comparable".
    expect(sequence?.a).toBe(5);
    expect(sequence?.b).toBe(5);
    const generated = diff.diffs.find((entry) => entry.path === "generatedAtMs");
    expect(generated?.a).toBe(TEST_EPOCH_MS);
    expect(generated?.b).toBe(REPLAY_GENERATED_AT_MS);
    expect(generated?.delta).toBe(TEST_EPOCH_MS - REPLAY_GENERATED_AT_MS);
  });

  test("both sides of the honest comparison are event-derived (the third W402 difference)", () => {
    // Entities are NOT reconstructible from event windows (W402): the
    // replay's entities are empty, and the live state AT THE EVENT HORIZON
    // excludes the post-horizon vision tracks for the same reason.
    expect(replayFinal.entities).toEqual([]);
    expect(liveAtEventHorizon.entities).toEqual([]);
    expect(replayFinal.football).toBeUndefined();
    expect(liveAtEventHorizon.football).toBeUndefined();
    // The FULL live snapshot, by contrast, carries the track-derived
    // entities and the post-fulltime football state.
    expect(run0.finalSnapshot.entities).toHaveLength(4);
    expect(run0.finalSnapshot.football?.clock.period).toBe("post-match");
  });
});

describe("replay-vs-live — the honest boundary (full snapshot vs replay)", () => {
  test("the FULL live snapshot is NOT replay-comparable: exactly the non-reconstructible subtrees", () => {
    const fixture = buildEvaluationFixture();
    const run0 = evaluateFixture(fixture, 0);
    const replayFinal = run0.replayCheckpoints.at(-1)!;
    const diff = compareSnapshots(run0.finalSnapshot, replayFinal);
    expect(diff.comparable).toBe(false);
    // Every non-excluded diff is a W402-documented non-reconstructible
    // subtree: the four track-derived entities, the football state
    // (carried by the live engine's init, absent in the evaluation
    // replay), and the watermark position (the live watermark includes
    // the football timeline at 25000; the replay's stops at the last
    // event, 20000).
    expect(
      nonExcluded(diff)
        .map((entry) => entry.path)
        .sort(),
    ).toEqual([
      "entities[ball]",
      "entities[p1]",
      "entities[p2]",
      "entities[p3]",
      "football",
      "watermark.watermarkMs",
    ]);
  });
});
