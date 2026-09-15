/**
 * The replay/evaluation harness (W403, pure + deterministic).
 *
 * This module RUNS THE WHOLE CHAIN repeatedly on ONE fixed fixture and
 * proves the outputs are COMPARABLE across runs — field by field, under the
 * DOCUMENTED tolerance ({@link ./tolerance.ts}). No new fusion, no new
 * replay semantics, no persistence: it consumes the delivered public seams
 * exactly (W005 `InMemoryObservationStore`, W401 `runWorldFusion`, W006
 * `WorldModelEngine`, W402 `eventWindow` + `replayForward`).
 *
 * ONE RUN (the chain every `runIndex` executes identically — see
 * {@link evaluateFixture}):
 *
 * 1. `buildEvaluationFixture()` — the frozen fixed fixture (a fresh call per
 *    run; the builds are deep-equal by construction);
 * 2. a fresh `InMemoryObservationStore` with EVERY observation appended
 *    (tracks + candidates — 241 records);
 * 3. a fresh `WorldModelEngine` with the documented initial football state
 *    ({@link EVALUATION_FOOTBALL_INIT}) and a DETERMINISTIC clock:
 *    `now: () => EVALUATION_ENGINE_NOW_MS` (TEST_EPOCH_MS — the live path's
 *    `generatedAtMs` constant; it is deliberately different from W402's
 *    `REPLAY_GENERATED_AT_MS` (0) so the excluded `generatedAtMs` diff is
 *    VISIBLE in replay-vs-live comparisons). No `Date.now`, no
 *    `Math.random` anywhere in the chain;
 * 4. `runWorldFusion` (W401) — one pass, default `trackFrame: "pitch"` (the
 *    fixture's tracks are W206 pitch-meter observations);
 * 5. `engine.snapshot()` — the run's FINAL live snapshot (fused entities +
 *    football state; deep-frozen by the engine);
 * 6. a FULL-SPAN `replayForward` (W402): `eventWindow` over
 *    `engine.eventsSince(0)` covering the whole event span
 *    `[0, lastEventMs]` (inclusive — every log entry), replayed with
 *    {@link REPLAY_LIMITS}. The replay carries NO caller-pinned `init`
 *    football state — the evaluation replay is the PURE event-derived
 *    reconstruction (pinning the live engine's final football into the
 *    replay, the W402 consumer convenience pattern, would compare a
 *    snapshot against itself for that subtree; the honest evaluation
 *    compares what the events alone rebuild);
 * 7. collect: store count, the fusion report serialized to a plain
 *    comparable shape, the final snapshot, and the replay's checkpoints.
 *
 * PAIRWISE COMPARISON (run 0 vs every other run): each pair yields TWO
 * records, in this order — (1) `kind: "final-snapshots"`: the runs' FINAL
 * snapshots; (2) `kind: "mid-run-checkpoints"`: the runs' MID-RUN REPLAY
 * CHECKPOINT pair (index `floor((len-1)/2)` of each run's
 * `replayCheckpoints` — for the fixed fixture: index 2, the post-goal
 * checkpoint at 15000 ms), each compared with {@link compareSnapshots}
 * under the run's tolerance. Additionally each record carries
 * `fusionReportsEqual` — exact structural equality of the two runs'
 * serialized fusion reports (counts, conflict ledger, warnings): a run pair
 * whose conflict ledgers differ is NOT comparable.
 * `EvaluationReport.comparable` is `true` iff EVERY pairwise record is
 * green (`diff.comparable && fusionReportsEqual`).
 *
 * DETERMINISM: the harness itself is pure — the same options produce a
 * deep-equal `EvaluationReport` on every call (pinned by test), because
 * every input is a fixed constant and every clock is injected.
 */
import {
  PITCH_AXES,
  PITCH_LENGTH_AXIS_METERS,
  PITCH_ORIGIN,
  PITCH_WIDTH_AXIS_METERS,
} from "@sporta/contracts";
import type { WorldSnapshot } from "@sporta/contracts";
import { runWorldFusion } from "@sporta/fusion";
import type { FusionReport } from "@sporta/fusion";
import { InMemoryObservationStore } from "@sporta/observation";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { eventWindow, replayForward } from "@sporta/temporal";
import type { ReplayLimits } from "@sporta/temporal";
import { WorldModelEngine } from "@sporta/world-model";
import type { FootballState } from "@sporta/world-model";
import { valuesEqual } from "./compare";
import type { SnapshotDiff } from "./compare";
import { compareSnapshots } from "./compare";
import type { EvaluationFixture } from "./fixture";
import { buildEvaluationFixture } from "./fixture";
import type { ToleranceSpec } from "./tolerance";
import { DEFAULT_TOLERANCE, validateToleranceSpec } from "./tolerance";

/**
 * The deterministic engine clock for every harness run: TEST_EPOCH_MS
 * (2025-01-06T12:00:00.000Z in epoch ms — the shared test epoch from
 * `@sporta/testing`, HARNESS rule 2). Distinct from W402's forced replay
 * constant `REPLAY_GENERATED_AT_MS` (0) — that difference is exactly the
 * documented, excluded `generatedAtMs` field.
 */
export const EVALUATION_ENGINE_NOW_MS = TEST_EPOCH_MS;

/** Default number of runs (the minimum for a pairwise comparison). */
export const DEFAULT_RUNS = 2;

/**
 * The enforced bounds of the harness's full-span replay: at least the
 * fixture's whole event span (20000 ms across 5 events) with generous
 * documented headroom, checkpoints every 5000 ms (aligned with the
 * fixture's 5 s candidate grid → one checkpoint per crossed grid
 * boundary).
 */
const REPLAY_LIMITS: ReplayLimits = {
  maxEvents: 32,
  maxSpanMs: 30_000,
  checkpointEveryMs: 5_000,
};

/**
 * The documented initial football state every harness engine starts from
 * (the canonical pitch frame, a first-half zeroed clock, an unknown score
 * and possession — never invented — and the v1 event taxonomy). Fusion's
 * fulltime candidate patches the period to `"post-match"`; fusion's
 * possession step sets the p1 candidate; the clock value stays pinned to
 * the football timeline position (W401's documented honest behavior).
 * Exported so tests can rebuild the LIVE engine through the exact chain
 * the harness runs (the replay-vs-live reconciliation).
 */
export const EVALUATION_FOOTBALL_INIT: FootballState = {
  pitch: {
    lengthAxisMeters: PITCH_LENGTH_AXIS_METERS,
    widthAxisMeters: PITCH_WIDTH_AXIS_METERS,
    origin: PITCH_ORIGIN,
    axes: PITCH_AXES,
  },
  clock: { period: "first-half", clockMs: 0, stoppage: false },
  score: { home: 0, away: 0, status: { status: "unknown" } },
  possession: { status: "unknown" },
  eventTaxonomyVersion: "v1",
};

/** The result of ONE harness run over the fixture. */
export interface EvaluationRunResult {
  /** The run's index (0-based; run 0 is the pairwise baseline). */
  runIndex: number;
  /** Observations appended into the run's store (tracks + candidates). */
  storeCount: number;
  /** The run's W401 fusion report, serialized to a plain comparable shape. */
  fusionReport: FusionReport;
  /** The run's final live snapshot (`engine.snapshot()` after fusion). */
  finalSnapshot: WorldSnapshot;
  /** The run's full-span `replayForward` checkpoints (final included, last). */
  replayCheckpoints: readonly WorldSnapshot[];
}

/** Which snapshot pair one pairwise record compared. */
export type PairwiseKind = "final-snapshots" | "mid-run-checkpoints";

/**
 * One pairwise comparison record. Records come in PAIRS per (run 0, run j):
 * first the FINAL-snapshot comparison (`kind: "final-snapshots"`), then the
 * MID-RUN CHECKPOINT pair (`kind: "mid-run-checkpoints"`) — both in that
 * documented order, both carrying the pair's fusion-report equality.
 */
export interface PairwiseRecord {
  /** The baseline run index (always 0). */
  a: number;
  /** The compared run index (1..runs-1). */
  b: number;
  /** Which snapshot pair this record compared (documented above). */
  kind: PairwiseKind;
  /** The snapshot comparison under the report's tolerance. */
  diff: SnapshotDiff;
  /**
   * Exact structural equality of the two runs' serialized fusion reports
   * (counts + conflict ledger + warnings). A pair whose conflict ledgers
   * differ is NOT comparable.
   */
  fusionReportsEqual: boolean;
}

/** The evaluation report: every run's artifacts plus the pairwise verdict. */
export interface EvaluationReport {
  /** How many runs were executed. */
  runs: number;
  /** The tolerance spec every pairwise comparison used. */
  tolerance: ToleranceSpec;
  /** Every run's artifacts, in run order. */
  runResults: readonly EvaluationRunResult[];
  /**
   * Pairwise comparisons (run 0 vs every other run): per pair, the
   * final-snapshot record followed by the mid-run checkpoint record.
   */
  pairwise: readonly PairwiseRecord[];
  /**
   * `true` iff every pairwise record is green (diffs within tolerance AND
   * fusion reports equal).
   */
  comparable: boolean;
}

/** Options for {@link runReplayEvaluation}. */
export interface EvaluationOptions {
  /** Runs to execute (default 2 — the minimum for comparison). */
  runs?: number;
  /** Tolerance spec for every pairwise comparison (default DEFAULT_TOLERANCE). */
  tolerance?: ToleranceSpec;
}

/**
 * Serializes a W401 `FusionReport` into a plain comparable shape: a
 * canonical JSON round-trip detaches the report from the live engine state
 * (deep copy, plain objects/arrays) so run reports compare structurally
 * with plain deep equality. Deterministic: the same report serializes
 * deep-equal every time.
 */
function serializeFusionReport(report: FusionReport): FusionReport {
  return JSON.parse(JSON.stringify(report)) as FusionReport;
}

/** Validates a fixture handed to {@link evaluateFixture} (fail loud). */
function validateFixture(fixture: EvaluationFixture): void {
  if (fixture === null || typeof fixture !== "object") {
    throw new RangeError("evaluateFixture: fixture must be an EvaluationFixture object");
  }
  if (typeof fixture.sessionId !== "string" || fixture.sessionId.length < 1) {
    throw new RangeError("evaluateFixture: fixture.sessionId must be a non-empty string");
  }
  if (!Array.isArray(fixture.tracks) || !Array.isArray(fixture.candidates)) {
    throw new RangeError("evaluateFixture: fixture.tracks and fixture.candidates must be arrays");
  }
  // Every observation must belong to the fixture's session: a foreign
  // observation would silently vanish from the fusion's session query.
  for (const observation of [...fixture.tracks, ...fixture.candidates]) {
    if (observation.sessionId !== fixture.sessionId) {
      throw new RangeError(
        `evaluateFixture: observation ${observation.observationId ?? "<unknown>"} belongs to ` +
          `session "${observation.sessionId}", not "${fixture.sessionId}"`,
      );
    }
  }
}

/**
 * Runs the WHOLE harness chain ONCE over the given fixture (the exact chain
 * `runReplayEvaluation` runs per run index — exported so the negative
 * mutation tests can drive the REAL chain over a mutated fixture instead of
 * a re-implementation). See the module docblock's ONE RUN for the steps.
 */
export function evaluateFixture(
  fixture: EvaluationFixture,
  runIndex: number = 0,
): EvaluationRunResult {
  validateFixture(fixture);
  if (!Number.isInteger(runIndex) || runIndex < 0) {
    throw new RangeError(
      `evaluateFixture: runIndex must be a non-negative integer (got ${String(runIndex)})`,
    );
  }

  // 2. The store: every observation, appended in fixture order.
  const store = new InMemoryObservationStore();
  for (const observation of [...fixture.tracks, ...fixture.candidates]) {
    store.append(observation);
  }

  // 3. The fresh engine: documented football init + the deterministic clock.
  const engine = WorldModelEngine.create(fixture.sessionId, {
    football: EVALUATION_FOOTBALL_INIT,
    now: () => EVALUATION_ENGINE_NOW_MS,
  });

  // 4. W401 fusion (one deterministic pass; the fixture's tracks are
  //    pitch-framed W206 observations — the default trackFrame).
  const fusionReport = serializeFusionReport(
    runWorldFusion({ store, engine, sessionId: fixture.sessionId }),
  );

  // 5. The final live snapshot.
  const finalSnapshot = engine.snapshot();

  // 6. The full-span replay: every log entry, no caller-pinned init (see
  //    the module docblock for the documented rationale).
  const entries = engine.eventsSince(0);
  const lastEventMs = entries.reduce(
    (maximum, entry) => Math.max(maximum, entry.event.eventTimeMs),
    0,
  );
  const fullSpan = eventWindow(entries, { fromMs: 0, toMs: lastEventMs });
  const replay = replayForward({ entries: fullSpan, limits: REPLAY_LIMITS });

  // 7. Collect.
  return Object.freeze({
    runIndex,
    storeCount: store.count(),
    fusionReport,
    finalSnapshot,
    replayCheckpoints: Object.freeze([...replay.checkpoints]),
  });
}

/**
 * Runs the replay/evaluation: `runs` independent executions of the whole
 * chain over the FIXED fixture, pairwise-compared (run 0 vs every other
 * run — final snapshots AND the mid-run checkpoint pair, plus exact
 * fusion-report equality) under the given tolerance. `comparable` is the
 * W403 accept criterion made executable: `true` iff every pairwise record
 * is green.
 *
 * Deterministic: the same options produce a deep-equal report (no
 * `Date.now`, no `Math.random`, no ambient state anywhere in the chain).
 * Throws `RangeError` for fewer than 2 runs or an invalid tolerance.
 */
export function runReplayEvaluation(options?: EvaluationOptions): EvaluationReport {
  const runs = options?.runs ?? DEFAULT_RUNS;
  if (typeof runs !== "number" || !Number.isInteger(runs) || runs < 2) {
    throw new RangeError(
      `runReplayEvaluation: runs must be an integer >= 2 (the minimum for a pairwise ` +
        `comparison; got ${String(runs)})`,
    );
  }
  const tolerance = validateToleranceSpec(options?.tolerance ?? DEFAULT_TOLERANCE);

  const runResults: EvaluationRunResult[] = [];
  for (let runIndex = 0; runIndex < runs; runIndex += 1) {
    // 1. A fresh fixture build per run (deep-equal to every other build).
    runResults.push(evaluateFixture(buildEvaluationFixture(), runIndex));
  }

  const baseline = runResults[0]!;
  // The mid-run checkpoint pair: the middle checkpoint of each run's replay
  // trajectory (documented; for the fixed fixture: index 2, the post-goal
  // checkpoint at 15000 ms).
  const midCheckpointIndex = Math.floor((baseline.replayCheckpoints.length - 1) / 2);

  const pairwise: PairwiseRecord[] = [];
  for (let j = 1; j < runs; j += 1) {
    const compared = runResults[j]!;
    const fusionReportsEqual = valuesEqual(baseline.fusionReport, compared.fusionReport);

    // (1) The runs' final snapshots.
    pairwise.push(
      Object.freeze({
        a: 0,
        b: j,
        kind: "final-snapshots" as const,
        diff: compareSnapshots(baseline.finalSnapshot, compared.finalSnapshot, tolerance),
        fusionReportsEqual,
      }),
    );

    // (2) The runs' mid-run replay checkpoint pair.
    const checkpointA = baseline.replayCheckpoints[midCheckpointIndex];
    const checkpointB = compared.replayCheckpoints[midCheckpointIndex];
    const checkpointDiff: SnapshotDiff =
      checkpointA !== undefined && checkpointB !== undefined
        ? compareSnapshots(checkpointA, checkpointB, tolerance)
        : Object.freeze({
            // Deterministic same-fixture runs always have equal checkpoint
            // counts; this guard keeps a malformed pair REPORTED, never
            // silently green (no throw on difference).
            comparable: false,
            diffs: Object.freeze([
              Object.freeze({
                path: `replayCheckpoints[${midCheckpointIndex}]`,
                kind: "structural" as const,
                a: checkpointA,
                b: checkpointB,
                tolerance: "exact" as const,
              }),
            ]),
          });
    pairwise.push(
      Object.freeze({
        a: 0,
        b: j,
        kind: "mid-run-checkpoints" as const,
        diff: checkpointDiff,
        fusionReportsEqual,
      }),
    );
  }

  const comparable = pairwise.every(
    (record) => record.diff.comparable && record.fusionReportsEqual,
  );
  return Object.freeze({
    runs,
    tolerance,
    runResults: Object.freeze(runResults),
    pairwise: Object.freeze(pairwise),
    comparable,
  });
}
