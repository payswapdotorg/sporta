/**
 * Deterministic player-tracking-family benchmark (R203): runs both
 * candidates (the W204-wrapping greedy-IoU baseline and the two-stage
 * Hungarian tracker) over SEEDED-degraded detection sequences derived from
 * the committed synthetic-diagnostic fixtures, and emits frozen-contract
 * `BenchmarkRun` records.
 *
 * METRICS (MOTA-style counting, correspondence via W201's
 * `matchDetections` — wrapped, never re-implemented):
 *
 * - `truePositives` / `misses` / `falsePositives`: per-frame one-to-one
 *   IoU-0.5 matching of tracked output against the fixtures' ground-truth
 *   player boxes;
 * - `gtIdentitySwitches`: per ground-truth player, the number of times the
 *   track id matched to that player CHANGES across consecutive matched
 *   frames — the evaluative switch count (the fixtures know identity);
 * - `apparentIdentitySwitches`: the adapters' own honest proxy count
 *   (adapter-level, no ground truth) — reported alongside for comparison;
 * - `fragmentationMean`: mean number of DISTINCT track ids per
 *   ground-truth player over the run;
 * - `mota` = 1 - (misses + falsePositives + gtIdentitySwitches) / gtBoxes.
 */
import { matchDetections } from "@sporta/perception-detection";
import type { DetectedBox, LabeledGroundTruth } from "@sporta/perception-detection";
import type { BenchmarkRun as BenchmarkRunType } from "@sporta/contracts";
import { GreedyIouTrackerAdapter } from "../tracking/greedy-iou-adapter";
import {
  GREEDY_IOU_TRACKER_ADAPTER_VERSION,
  GREEDY_IOU_TRACKER_ID,
  GREEDY_IOU_TRACKER_VERSION,
} from "../tracking/greedy-iou-adapter";
import type { GreedyIouTrackerAdapterOptions } from "../tracking/greedy-iou-adapter";
import { TwoStageHungarianTracker } from "../tracking/hungarian";
import {
  HUNGARIAN_TRACKER_ADAPTER_VERSION,
  HUNGARIAN_TRACKER_ID,
  HUNGARIAN_TRACKER_VERSION,
} from "../tracking/hungarian";
import type { TwoStageHungarianTrackerOptions } from "../tracking/hungarian";
import type { PlayerTrackingAdapter } from "../adapter";
import {
  FIXTURE_SET_VERSION,
  detectionSequenceFromFixture,
  generateDetectionFixture,
  type DetectionFixtureSpec,
  type TrackingDegradeSpec,
} from "./fixtures";
import {
  DEFAULT_BENCHMARK_CLOCK,
  buildBenchmarkRun,
  loadSpecFile,
  metricDeltaPct,
  type BenchmarkClock,
} from "./run";

/** One committed tracking scenario: a detection spec + its degrade. */
export interface TrackingScenarioSpec {
  readonly detection: DetectionFixtureSpec;
  readonly degrade: TrackingDegradeSpec;
}

/** Options for {@link runTrackingFamilyBenchmark}; every field is optional. */
export interface TrackingFamilyBenchmarkOptions {
  /** Scenarios (default: the committed tracking-scenarios.json set). */
  readonly scenarios?: readonly TrackingScenarioSpec[];
  readonly greedyOptions?: GreedyIouTrackerAdapterOptions;
  readonly hungarianOptions?: TwoStageHungarianTrackerOptions;
  /** Injected clock (default: the deterministic constant clock). */
  readonly clock?: BenchmarkClock;
}

interface TrackingOutcome {
  readonly metrics: Record<string, number>;
  readonly resourceUsage: Record<string, number>;
  readonly failures: number;
  readonly failureExamples: readonly string[];
}

function evaluateTracker(
  scenarios: readonly TrackingScenarioSpec[],
  adapter: PlayerTrackingAdapter,
): TrackingOutcome {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let gtBoxes = 0;
  let gtSwitches = 0;
  let apparentSwitches = 0;
  let frames = 0;
  let detections = 0;
  let fragmentationSum = 0;
  let fragmentedPlayers = 0;
  for (const scenario of scenarios) {
    // Per-scenario identity bookkeeping: identities do not cross scenario
    // boundaries (each scenario is its own session).
    const fragmentation = new Map<string, Set<string>>();
    const fixtureFrames = generateDetectionFixture(scenario.detection);
    const sequence = detectionSequenceFromFixture(
      fixtureFrames,
      scenario.degrade,
      scenario.detection.seed,
    );
    const result = adapter.track(sequence);
    apparentSwitches += result.identitySwitches;
    frames += fixtureFrames.length;
    for (const frame of sequence) {
      detections += frame.detections.length;
    }
    // Per-frame correspondence: tracked output vs ground truth.
    const lastTrackIdByGt = new Map<string, string>();
    for (const [frameIndex, fixtureFrame] of fixtureFrames.entries()) {
      const gtBoxesFrame: LabeledGroundTruth = {
        frameId: fixtureFrame.frame.frameId,
        boxes: fixtureFrame.groundTruth.map((entry) => ({ box: entry.box, label: "player" })),
      };
      const trackedBoxes = result.perFrame[frameIndex] ?? [];
      const trackedAsDetections: DetectedBox[] = trackedBoxes.map((tracked) => ({
        box: tracked.box,
        label: tracked.label,
        confidence: tracked.confidence,
      }));
      gtBoxes += gtBoxesFrame.boxes.length;
      const match = matchDetections(gtBoxesFrame, trackedAsDetections);
      tp += match.truePositives;
      fp += match.falsePositives;
      fn += match.falseNegatives;
      for (const pair of match.matched) {
        const gtEntry = fixtureFrame.groundTruth[pair.gtIndex];
        const tracked = trackedBoxes[pair.predictedIndex];
        if (gtEntry === undefined || tracked === undefined) continue;
        let trackIds = fragmentation.get(gtEntry.gtId);
        if (trackIds === undefined) {
          trackIds = new Set<string>();
          fragmentation.set(gtEntry.gtId, trackIds);
        }
        trackIds.add(tracked.trackId);
        const previous = lastTrackIdByGt.get(gtEntry.gtId);
        if (previous !== undefined && previous !== tracked.trackId) {
          gtSwitches += 1;
        }
        lastTrackIdByGt.set(gtEntry.gtId, tracked.trackId);
      }
      // Frames where a gt player went unmatched break the switch chain
      // (no id evidence) — honest: unmatched frames carry no comparison.
      for (const unmatchedGtIndex of match.unmatchedGroundTruthIndices) {
        const gtEntry = fixtureFrame.groundTruth[unmatchedGtIndex];
        if (gtEntry !== undefined) lastTrackIdByGt.delete(gtEntry.gtId);
      }
    }
    // Fragmentation is measured per scenario (per identity label), then
    // averaged over players — cross-scenario accumulation would conflate
    // sessions.
    for (const trackIds of fragmentation.values()) {
      fragmentationSum += trackIds.size;
      fragmentedPlayers += 1;
    }
  }
  const mota = gtBoxes > 0 ? 1 - (fn + fp + gtSwitches) / gtBoxes : 0;
  const fragmentationMean = fragmentedPlayers > 0 ? fragmentationSum / fragmentedPlayers : 0;
  return {
    metrics: {
      mota,
      truePositives: tp,
      misses: fn,
      falsePositives: fp,
      gtIdentitySwitches: gtSwitches,
      apparentIdentitySwitches: apparentSwitches,
      fragmentationMean,
      gtBoxes,
    },
    resourceUsage: { framesProcessed: frames, detectionsProcessed: detections },
    failures: 0,
    failureExamples: [],
  };
}

/**
 * Runs the tracking-family benchmark over the committed scenario set (or
 * the given scenarios) and returns one frozen-contract `BenchmarkRun` per
 * candidate (greedy baseline first, Hungarian second). Two calls with the
 * same options produce deep-equal records.
 */
export function runTrackingFamilyBenchmark(
  options: TrackingFamilyBenchmarkOptions = {},
): readonly BenchmarkRunType[] {
  const clock = options.clock ?? DEFAULT_BENCHMARK_CLOCK();
  const scenarios = options.scenarios ?? loadCommittedTrackingScenarios();
  const seed = `tracking:${scenarios.map((scenario) => scenario.detection.seed).join("+")}`;

  const greedy = new GreedyIouTrackerAdapter(options.greedyOptions);
  const hungarian = new TwoStageHungarianTracker(options.hungarianOptions);

  const greedyStartedAtMs = clock.now();
  const greedyOutcome = evaluateTracker(scenarios, greedy);
  const greedyCompletedAtMs = clock.now();
  const hungarianStartedAtMs = clock.now();
  const hungarianOutcome = evaluateTracker(scenarios, hungarian);
  const hungarianCompletedAtMs = clock.now();
  const greedyRerun = evaluateTracker(scenarios, greedy);
  const hungarianRerun = evaluateTracker(scenarios, hungarian);

  return [
    buildBenchmarkRun({
      runId: `tracking/${GREEDY_IOU_TRACKER_ID}/${FIXTURE_SET_VERSION}`,
      technologyId: GREEDY_IOU_TRACKER_ID,
      technologyVersion: GREEDY_IOU_TRACKER_VERSION,
      adapterVersion: GREEDY_IOU_TRACKER_ADAPTER_VERSION,
      task: "perception.player-tracking",
      fixtureSetVersion: FIXTURE_SET_VERSION,
      startedAtMs: greedyStartedAtMs,
      completedAtMs: greedyCompletedAtMs,
      metrics: greedyOutcome.metrics,
      resourceUsage: greedyOutcome.resourceUsage,
      failureSummary: {
        failures: greedyOutcome.failures,
        failureExamples: greedyOutcome.failureExamples,
      },
      seed,
      rerunDeltaPct: metricDeltaPct(greedyOutcome.metrics, greedyRerun.metrics),
      licenseCheck: "not-applicable",
      artifactRefs: [
        "fixtures/tracking-scenarios.json",
        "packages/perception-adapters/src/benchmark/tracking.ts",
      ],
    }),
    buildBenchmarkRun({
      runId: `tracking/${HUNGARIAN_TRACKER_ID}/${FIXTURE_SET_VERSION}`,
      technologyId: HUNGARIAN_TRACKER_ID,
      technologyVersion: HUNGARIAN_TRACKER_VERSION,
      adapterVersion: HUNGARIAN_TRACKER_ADAPTER_VERSION,
      task: "perception.player-tracking",
      fixtureSetVersion: FIXTURE_SET_VERSION,
      startedAtMs: hungarianStartedAtMs,
      completedAtMs: hungarianCompletedAtMs,
      metrics: hungarianOutcome.metrics,
      resourceUsage: hungarianOutcome.resourceUsage,
      failureSummary: {
        failures: hungarianOutcome.failures,
        failureExamples: hungarianOutcome.failureExamples,
      },
      seed,
      rerunDeltaPct: metricDeltaPct(hungarianOutcome.metrics, hungarianRerun.metrics),
      licenseCheck: "not-applicable",
      artifactRefs: [
        "fixtures/tracking-scenarios.json",
        "packages/perception-adapters/src/benchmark/tracking.ts",
        "packages/perception-adapters/src/tracking/hungarian-algorithm.ts",
      ],
    }),
  ];
}

function loadCommittedTrackingScenarios(): readonly TrackingScenarioSpec[] {
  const file = loadSpecFile<{ scenarios: readonly TrackingScenarioSpec[] }>(
    "tracking-scenarios.json",
  );
  return file.scenarios;
}
