/**
 * Deterministic detection-family benchmark (R202): runs each candidate
 * (heuristic color detector + model-backed detector) against the committed
 * synthetic-diagnostic scenario specs and emits frozen-contract
 * `BenchmarkRun` records.
 *
 * METRICS (wrapped from W201's `runDetectionBenchmark` — the repo's own
 * matcher, never re-implemented): precision, recall, f1 at IoU 0.5 against
 * the fixtures' ground-truth player boxes, plus meanConfidence and the
 * frame/box counts. The model-backed candidate WITHOUT a wired backend
 * refuses per frame with its documented failure class — counted honestly
 * in `failureSummary` (and its quality metrics stay the honest zeros of
 * "nothing was detected", never fabricated); WITH a backend injected it is
 * scored by exactly the same pipeline as the heuristic candidate.
 */
import { runDetectionBenchmark } from "@sporta/perception-detection";
import type { DetectedBox, LabeledGroundTruth } from "@sporta/perception-detection";
import type { BenchmarkRun as BenchmarkRunType } from "@sporta/contracts";
import { HeuristicColorDetector } from "../detection/heuristic-color";
import {
  HEURISTIC_COLOR_DETECTOR_ADAPTER_VERSION,
  HEURISTIC_COLOR_DETECTOR_ID,
  HEURISTIC_COLOR_DETECTOR_VERSION,
} from "../detection/heuristic-color";
import type { HeuristicColorDetectorOptions } from "../detection/heuristic-color";
import { ModelBackedDetector } from "../detection/model-backed";
import {
  MODEL_BACKED_DETECTOR_ADAPTER_VERSION,
  MODEL_BACKED_DETECTOR_ID,
  MODEL_BACKED_DETECTOR_VERSION,
} from "../detection/model-backed";
import type { ModelBackedDetectorOptions } from "../detection/model-backed";
import { isPerceptionAdapterError } from "../errors";
import {
  FIXTURE_SET_VERSION,
  generateDetectionFixture,
  type DetectionFixtureSpec,
} from "./fixtures";
import {
  DEFAULT_BENCHMARK_CLOCK,
  buildBenchmarkRun,
  loadSpecFile,
  metricDeltaPct,
  type BenchmarkClock,
} from "./run";

/** Options for {@link runDetectionFamilyBenchmark}; every field is optional. */
export interface DetectionFamilyBenchmarkOptions {
  /** Scenario specs (default: the committed detection-scenarios.json set). */
  readonly scenarios?: readonly DetectionFixtureSpec[];
  readonly heuristicOptions?: HeuristicColorDetectorOptions;
  readonly modelBackedOptions?: ModelBackedDetectorOptions;
  /** Injected clock (default: the deterministic constant clock). */
  readonly clock?: BenchmarkClock;
}

interface CandidateOutcome {
  readonly metrics: Record<string, number>;
  readonly resourceUsage: Record<string, number>;
  readonly failures: number;
  readonly failureExamples: readonly string[];
}

/** Scores one per-frame detect callable against the fixtures' ground truth. */
function evaluateDetectCallable(
  scenarios: readonly DetectionFixtureSpec[],
  detect: (frame: Parameters<HeuristicColorDetector["detect"]>[0]) => readonly DetectedBox[],
): CandidateOutcome {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let confidenceSum = 0;
  let detections = 0;
  let frames = 0;
  let pixels = 0;
  let failures = 0;
  const failureClasses = new Map<string, number>();
  for (const scenario of scenarios) {
    const fixtureFrames = generateDetectionFixture(scenario);
    const groundTruth: LabeledGroundTruth[] = [];
    const predicted = new Map<string, readonly DetectedBox[]>();
    for (const { frame, groundTruth: gt } of fixtureFrames) {
      frames += 1;
      pixels += frame.width * frame.height;
      groundTruth.push({
        frameId: frame.frameId,
        boxes: gt.map((entry) => ({ box: entry.box, label: "player" })),
      });
      let boxes: readonly DetectedBox[];
      try {
        boxes = detect(frame);
      } catch (error) {
        if (isPerceptionAdapterError(error)) {
          failures += 1;
          const failureClassId = String(error.details.failureClassId ?? "unknown");
          failureClasses.set(failureClassId, (failureClasses.get(failureClassId) ?? 0) + 1);
          boxes = [];
        } else {
          throw error;
        }
      }
      predicted.set(frame.frameId, boxes);
      for (const box of boxes) {
        confidenceSum += box.confidence;
        detections += 1;
      }
    }
    const report = runDetectionBenchmark({ groundTruth, predicted });
    tp += report.truePositives;
    fp += report.falsePositives;
    fn += report.falseNegatives;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    metrics: {
      precision,
      recall,
      f1,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      meanConfidence: detections > 0 ? confidenceSum / detections : 0,
    },
    resourceUsage: { framesProcessed: frames, pixelsProcessed: pixels },
    failures,
    failureExamples: [...failureClasses.entries()].map(
      ([failureClassId, count]) => `${failureClassId}: ${count} frames refused`,
    ),
  };
}

/**
 * Runs the detection-family benchmark over the committed scenario set
 * (or the given scenarios) and returns one frozen-contract
 * `BenchmarkRun` per candidate (heuristic first, model-backed second).
 * Two calls with the same options produce deep-equal records
 * (deterministic candidates + default constant clock).
 */
export function runDetectionFamilyBenchmark(
  options: DetectionFamilyBenchmarkOptions = {},
): readonly BenchmarkRunType[] {
  const clock = options.clock ?? DEFAULT_BENCHMARK_CLOCK();
  const scenarios = options.scenarios ?? loadCommittedDetectionScenarios();
  const seed = `detection:${scenarios.map((scenario) => scenario.seed).join("+")}`;

  const heuristic = new HeuristicColorDetector(options.heuristicOptions);
  const modelBacked = new ModelBackedDetector(options.modelBackedOptions);

  const heuristicStartedAtMs = clock.now();
  const heuristicOutcome = evaluateDetectCallable(scenarios, (frame) => heuristic.detect(frame));
  const heuristicCompletedAtMs = clock.now();
  const modelBackedStartedAtMs = clock.now();
  const modelBackedOutcome = evaluateDetectCallable(scenarios, (frame) =>
    modelBacked.detect(frame),
  );
  const modelBackedCompletedAtMs = clock.now();

  // Internal determinism rerun — the honest rerunDeltaPct evidence.
  const heuristicRerun = evaluateDetectCallable(scenarios, (frame) => heuristic.detect(frame));
  const modelBackedRerun = evaluateDetectCallable(scenarios, (frame) => modelBacked.detect(frame));

  return [
    buildBenchmarkRun({
      runId: `detection/${HEURISTIC_COLOR_DETECTOR_ID}/${FIXTURE_SET_VERSION}`,
      technologyId: HEURISTIC_COLOR_DETECTOR_ID,
      technologyVersion: HEURISTIC_COLOR_DETECTOR_VERSION,
      adapterVersion: HEURISTIC_COLOR_DETECTOR_ADAPTER_VERSION,
      task: "perception.player-detection",
      fixtureSetVersion: FIXTURE_SET_VERSION,
      startedAtMs: heuristicStartedAtMs,
      completedAtMs: heuristicCompletedAtMs,
      metrics: heuristicOutcome.metrics,
      resourceUsage: heuristicOutcome.resourceUsage,
      failureSummary: {
        failures: heuristicOutcome.failures,
        failureExamples: heuristicOutcome.failureExamples,
      },
      seed,
      rerunDeltaPct: metricDeltaPct(heuristicOutcome.metrics, heuristicRerun.metrics),
      licenseCheck: "not-applicable",
      artifactRefs: [
        "fixtures/detection-scenarios.json",
        "packages/perception-adapters/src/benchmark/detection.ts",
      ],
    }),
    buildBenchmarkRun({
      runId: `detection/${MODEL_BACKED_DETECTOR_ID}/${FIXTURE_SET_VERSION}`,
      technologyId: MODEL_BACKED_DETECTOR_ID,
      technologyVersion: MODEL_BACKED_DETECTOR_VERSION,
      adapterVersion: MODEL_BACKED_DETECTOR_ADAPTER_VERSION,
      task: "perception.player-detection",
      fixtureSetVersion: FIXTURE_SET_VERSION,
      startedAtMs: modelBackedStartedAtMs,
      completedAtMs: modelBackedCompletedAtMs,
      metrics: modelBackedOutcome.metrics,
      resourceUsage: modelBackedOutcome.resourceUsage,
      failureSummary: {
        failures: modelBackedOutcome.failures,
        failureExamples: modelBackedOutcome.failureExamples,
      },
      seed,
      rerunDeltaPct: metricDeltaPct(modelBackedOutcome.metrics, modelBackedRerun.metrics),
      licenseCheck: "not-applicable",
      artifactRefs: [
        "fixtures/detection-scenarios.json",
        "packages/perception-adapters/src/benchmark/detection.ts",
        "packages/perception-adapters/assets/README.md",
      ],
    }),
  ];
}

function loadCommittedDetectionScenarios(): readonly DetectionFixtureSpec[] {
  const file = loadSpecFile<{ scenarios: readonly DetectionFixtureSpec[] }>(
    "detection-scenarios.json",
  );
  return file.scenarios;
}
