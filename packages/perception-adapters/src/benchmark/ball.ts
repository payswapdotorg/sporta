/**
 * Deterministic ball-tracking-family benchmark (R204): runs both
 * candidates (the W202-wrapping nearest-box baseline over the degraded
 * DETECTION stream, and the pixel-space color-blob candidate over the
 * actual FRAME PIXELS — it ignores the annotations by design) against the
 * committed synthetic-diagnostic fixtures, and emits frozen-contract
 * `BenchmarkRun` records.
 *
 * METRICS (mirroring W202's benchmark semantics on this package's fixture
 * types): `coverage` (detected points / visible frames), `idSwitches`
 * (track count - 1 — every additional track is a switch by W202's id
 * scheme), `positionRmse` (normalized units, detected points vs ground
 * truth on visible frames), `interpolatedPoints`, `bridgedGaps`,
 * `falseDetections` (detected points on frames where the ball was NOT
 * visible — clutter honestly counted).
 */
import type { BenchmarkRun as BenchmarkRunType } from "@sporta/contracts";
import type { DetectedBox, DetectorFrameInput } from "@sporta/perception-detection";
import { NearestBoxBallTrackerAdapter } from "../ball/nearest-box-adapter";
import {
  NEAREST_BOX_BALL_TRACKER_ADAPTER_VERSION,
  NEAREST_BOX_BALL_TRACKER_ID,
  NEAREST_BOX_BALL_TRACKER_VERSION,
} from "../ball/nearest-box-adapter";
import type { NearestBoxBallTrackerAdapterOptions } from "../ball/nearest-box-adapter";
import { ColorBlobBallTracker } from "../ball/color-blob";
import {
  COLOR_BLOB_BALL_TRACKER_ADAPTER_VERSION,
  COLOR_BLOB_BALL_TRACKER_ID,
  COLOR_BLOB_BALL_TRACKER_VERSION,
} from "../ball/color-blob";
import type { ColorBlobBallTrackerOptions } from "../ball/color-blob";
import { BallBlobDetector, ModelBackedBallDetector } from "../ball/ball-blob-detector";
import {
  BALL_BLOB_DETECTOR_ADAPTER_VERSION,
  BALL_BLOB_DETECTOR_ID,
  BALL_BLOB_DETECTOR_VERSION,
} from "../ball/ball-blob-detector";
import type {
  BallBlobDetectorOptions,
  ModelBackedBallDetectorOptions,
} from "../ball/ball-blob-detector";
import {
  MODEL_BACKED_BALL_DETECTOR_ADAPTER_VERSION,
  MODEL_BACKED_BALL_DETECTOR_ID,
  MODEL_BACKED_BALL_DETECTOR_VERSION,
} from "../ball/ball-blob-detector";
import type { BallTrackingAdapter, DetectionSequenceFrame } from "../adapter";
import { isPerceptionAdapterError } from "../errors";
import { FIXTURE_SET_VERSION, generateBallFixture, type BallFixtureSpec } from "./fixtures";
import {
  DEFAULT_BENCHMARK_CLOCK,
  buildBenchmarkRun,
  loadSpecFile,
  metricDeltaPct,
  type BenchmarkClock,
} from "./run";

/** Options for {@link runBallFamilyBenchmark}; every field is optional. */
export interface BallFamilyBenchmarkOptions {
  /** Scenario specs (default: the committed ball-scenarios.json set). */
  readonly scenarios?: readonly BallFixtureSpec[];
  readonly nearestBoxOptions?: NearestBoxBallTrackerAdapterOptions;
  readonly colorBlobOptions?: ColorBlobBallTrackerOptions;
  /** Injected clock (default: the deterministic constant clock). */
  readonly clock?: BenchmarkClock;
}

interface BallOutcome {
  readonly metrics: Record<string, number>;
  readonly resourceUsage: Record<string, number>;
  readonly failures: number;
  readonly failureExamples: readonly string[];
}

function evaluateBallTracker(
  scenarios: readonly BallFixtureSpec[],
  adapter: BallTrackingAdapter,
  useDetections: boolean,
): BallOutcome {
  let visibleFrames = 0;
  let detectedPoints = 0;
  let falseDetections = 0;
  let idSwitches = 0;
  let interpolatedPoints = 0;
  let bridgedGaps = 0;
  let squaredErrorSum = 0;
  let frames = 0;
  let pixels = 0;
  for (const scenario of scenarios) {
    const fixtureFrames = generateBallFixture(scenario);
    const sequence: DetectionSequenceFrame[] = fixtureFrames.map(({ frame, detection }) => ({
      frame,
      // The nearest-box candidate consumes the degraded DETECTION stream;
      // the color-blob candidate ignores it by design (its evidence is the
      // pixels), so both get the same input shape.
      detections: useDetections && detection !== null ? [detection] : [],
    }));
    const tracks = adapter.track(sequence);
    idSwitches += Math.max(0, tracks.length - 1);
    for (const track of tracks) {
      interpolatedPoints += track.points.filter((point) => point.source === "interpolated").length;
      bridgedGaps += track.occlusionGaps.filter((gap) => gap.bridged).length;
    }
    const gtByFrameId = new Map<string, { center: { x: number; y: number }; visible: boolean }>();
    for (const { frame, gt } of fixtureFrames) {
      frames += 1;
      pixels += frame.width * frame.height;
      if (gt !== null && gt.visible) {
        visibleFrames += 1;
        gtByFrameId.set(frame.frameId, { center: gt.center, visible: true });
      } else {
        gtByFrameId.set(frame.frameId, { center: { x: 0, y: 0 }, visible: false });
      }
    }
    for (const track of tracks) {
      for (const point of track.points) {
        if (point.source !== "detected" || point.box === undefined) continue;
        detectedPoints += 1;
        const gt = gtByFrameId.get(point.frameId);
        if (gt === undefined || !gt.visible) {
          falseDetections += 1;
          continue;
        }
        const dx = point.box.x + point.box.w / 2 - gt.center.x;
        const dy = point.box.y + point.box.h / 2 - gt.center.y;
        squaredErrorSum += dx * dx + dy * dy;
      }
    }
  }
  const measured = detectedPoints - falseDetections;
  return {
    metrics: {
      coverage: visibleFrames > 0 ? detectedPoints / visibleFrames : 0,
      idSwitches,
      positionRmse: measured > 0 ? Math.sqrt(squaredErrorSum / measured) : 0,
      interpolatedPoints,
      bridgedGaps,
      falseDetections,
      visibleFrames,
    },
    resourceUsage: { framesProcessed: frames, pixelsProcessed: pixels },
    failures: 0,
    failureExamples: [],
  };
}

/**
 * Runs the ball-family benchmark over the committed scenario set (or the
 * given scenarios) and returns one frozen-contract `BenchmarkRun` per
 * candidate (nearest-box baseline first, color-blob second). Two calls
 * with the same options produce deep-equal records.
 */
export function runBallFamilyBenchmark(
  options: BallFamilyBenchmarkOptions = {},
): readonly BenchmarkRunType[] {
  const clock = options.clock ?? DEFAULT_BENCHMARK_CLOCK();
  const scenarios = options.scenarios ?? loadCommittedBallScenarios();
  const seed = `ball:${scenarios.map((scenario) => scenario.seed).join("+")}`;

  const nearestBox = new NearestBoxBallTrackerAdapter(options.nearestBoxOptions);
  const colorBlob = new ColorBlobBallTracker(options.colorBlobOptions);

  const nearestBoxStartedAtMs = clock.now();
  const nearestBoxOutcome = evaluateBallTracker(scenarios, nearestBox, true);
  const nearestBoxCompletedAtMs = clock.now();
  const colorBlobStartedAtMs = clock.now();
  const colorBlobOutcome = evaluateBallTracker(scenarios, colorBlob, false);
  const colorBlobCompletedAtMs = clock.now();
  const nearestBoxRerun = evaluateBallTracker(scenarios, nearestBox, true);
  const colorBlobRerun = evaluateBallTracker(scenarios, colorBlob, false);

  return [
    buildBenchmarkRun({
      runId: `ball/${NEAREST_BOX_BALL_TRACKER_ID}/${FIXTURE_SET_VERSION}`,
      technologyId: NEAREST_BOX_BALL_TRACKER_ID,
      technologyVersion: NEAREST_BOX_BALL_TRACKER_VERSION,
      adapterVersion: NEAREST_BOX_BALL_TRACKER_ADAPTER_VERSION,
      task: "perception.ball-tracking",
      fixtureSetVersion: FIXTURE_SET_VERSION,
      startedAtMs: nearestBoxStartedAtMs,
      completedAtMs: nearestBoxCompletedAtMs,
      metrics: nearestBoxOutcome.metrics,
      resourceUsage: nearestBoxOutcome.resourceUsage,
      failureSummary: {
        failures: nearestBoxOutcome.failures,
        failureExamples: nearestBoxOutcome.failureExamples,
      },
      seed,
      rerunDeltaPct: metricDeltaPct(nearestBoxOutcome.metrics, nearestBoxRerun.metrics),
      licenseCheck: "not-applicable",
      artifactRefs: [
        "fixtures/ball-scenarios.json",
        "packages/perception-adapters/src/benchmark/ball.ts",
      ],
    }),
    buildBenchmarkRun({
      runId: `ball/${COLOR_BLOB_BALL_TRACKER_ID}/${FIXTURE_SET_VERSION}`,
      technologyId: COLOR_BLOB_BALL_TRACKER_ID,
      technologyVersion: COLOR_BLOB_BALL_TRACKER_VERSION,
      adapterVersion: COLOR_BLOB_BALL_TRACKER_ADAPTER_VERSION,
      task: "perception.ball-tracking",
      fixtureSetVersion: FIXTURE_SET_VERSION,
      startedAtMs: colorBlobStartedAtMs,
      completedAtMs: colorBlobCompletedAtMs,
      metrics: colorBlobOutcome.metrics,
      resourceUsage: colorBlobOutcome.resourceUsage,
      failureSummary: {
        failures: colorBlobOutcome.failures,
        failureExamples: colorBlobOutcome.failureExamples,
      },
      seed,
      rerunDeltaPct: metricDeltaPct(colorBlobOutcome.metrics, colorBlobRerun.metrics),
      licenseCheck: "not-applicable",
      artifactRefs: [
        "fixtures/ball-scenarios.json",
        "packages/perception-adapters/src/benchmark/ball.ts",
      ],
    }),
  ];
}

function loadCommittedBallScenarios(): readonly BallFixtureSpec[] {
  const file = loadSpecFile<{ scenarios: readonly BallFixtureSpec[] }>("ball-scenarios.json");
  return file.scenarios;
}

// ---------------------------------------------------------------------------
// Ball DETECTION family (R201 BallDetectionAdapter candidates)
// ---------------------------------------------------------------------------

/** Options for {@link runBallDetectionFamilyBenchmark}; all fields optional. */
export interface BallDetectionFamilyBenchmarkOptions {
  /** Scenario specs (default: the committed ball-scenarios.json set). */
  readonly scenarios?: readonly BallFixtureSpec[];
  readonly blobOptions?: BallBlobDetectorOptions;
  readonly modelBackedOptions?: ModelBackedBallDetectorOptions;
  /** Injected clock (default: the deterministic constant clock). */
  readonly clock?: BenchmarkClock;
}

function evaluateBallDetector(
  scenarios: readonly BallFixtureSpec[],
  detect: (frame: DetectorFrameInput) => readonly DetectedBox[],
): BallOutcome {
  let visibleFrames = 0;
  let detectedPoints = 0;
  let falseDetections = 0;
  let squaredErrorSum = 0;
  let frames = 0;
  let pixels = 0;
  let failures = 0;
  const failureClasses = new Map<string, number>();
  for (const scenario of scenarios) {
    const fixtureFrames = generateBallFixture(scenario);
    for (const { frame, gt } of fixtureFrames) {
      frames += 1;
      pixels += frame.width * frame.height;
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
      if (gt !== null && gt.visible) {
        visibleFrames += 1;
      }
      for (const box of boxes) {
        detectedPoints += 1;
        if (gt === null || !gt.visible) {
          falseDetections += 1;
          continue;
        }
        const dx = box.box.x + box.box.w / 2 - gt.center.x;
        const dy = box.box.y + box.box.h / 2 - gt.center.y;
        squaredErrorSum += dx * dx + dy * dy;
      }
    }
  }
  const measured = detectedPoints - falseDetections;
  return {
    metrics: {
      coverage: visibleFrames > 0 ? measured / visibleFrames : 0,
      idSwitches: 0,
      positionRmse: measured > 0 ? Math.sqrt(squaredErrorSum / measured) : 0,
      interpolatedPoints: 0,
      bridgedGaps: 0,
      falseDetections,
      visibleFrames,
    },
    resourceUsage: { framesProcessed: frames, pixelsProcessed: pixels },
    failures,
    failureExamples: [...failureClasses.entries()].map(
      ([failureClassId, count]) => `${failureClassId}: ${count} frames refused`,
    ),
  };
}

/**
 * Runs the ball-DETECTION family benchmark (the R201 `BallDetectionAdapter`
 * candidates) over the committed ball scenario set: per-frame ball-box
 * precision against the fixtures' visible-ball ground truth. Two calls
 * with the same options produce deep-equal records.
 */
export function runBallDetectionFamilyBenchmark(
  options: BallDetectionFamilyBenchmarkOptions = {},
): readonly BenchmarkRunType[] {
  const clock = options.clock ?? DEFAULT_BENCHMARK_CLOCK();
  const scenarios = options.scenarios ?? loadCommittedBallScenarios();
  const seed = `ball-detection:${scenarios.map((scenario) => scenario.seed).join("+")}`;

  const blob = new BallBlobDetector(options.blobOptions);
  const modelBacked = new ModelBackedBallDetector(options.modelBackedOptions);

  const blobStartedAtMs = clock.now();
  const blobOutcome = evaluateBallDetector(scenarios, (frame) => blob.detect(frame));
  const blobCompletedAtMs = clock.now();
  const modelBackedStartedAtMs = clock.now();
  const modelBackedOutcome = evaluateBallDetector(scenarios, (frame) => modelBacked.detect(frame));
  const modelBackedCompletedAtMs = clock.now();
  const blobRerun = evaluateBallDetector(scenarios, (frame) => blob.detect(frame));
  const modelBackedRerun = evaluateBallDetector(scenarios, (frame) => modelBacked.detect(frame));

  return [
    buildBenchmarkRun({
      runId: `ball-detection/${BALL_BLOB_DETECTOR_ID}/${FIXTURE_SET_VERSION}`,
      technologyId: BALL_BLOB_DETECTOR_ID,
      technologyVersion: BALL_BLOB_DETECTOR_VERSION,
      adapterVersion: BALL_BLOB_DETECTOR_ADAPTER_VERSION,
      task: "perception.ball-detection",
      fixtureSetVersion: FIXTURE_SET_VERSION,
      startedAtMs: blobStartedAtMs,
      completedAtMs: blobCompletedAtMs,
      metrics: blobOutcome.metrics,
      resourceUsage: blobOutcome.resourceUsage,
      failureSummary: {
        failures: blobOutcome.failures,
        failureExamples: blobOutcome.failureExamples,
      },
      seed,
      rerunDeltaPct: metricDeltaPct(blobOutcome.metrics, blobRerun.metrics),
      licenseCheck: "not-applicable",
      artifactRefs: [
        "fixtures/ball-scenarios.json",
        "packages/perception-adapters/src/benchmark/ball.ts",
      ],
    }),
    buildBenchmarkRun({
      runId: `ball-detection/${MODEL_BACKED_BALL_DETECTOR_ID}/${FIXTURE_SET_VERSION}`,
      technologyId: MODEL_BACKED_BALL_DETECTOR_ID,
      technologyVersion: MODEL_BACKED_BALL_DETECTOR_VERSION,
      adapterVersion: MODEL_BACKED_BALL_DETECTOR_ADAPTER_VERSION,
      task: "perception.ball-detection",
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
        "fixtures/ball-scenarios.json",
        "packages/perception-adapters/src/benchmark/ball.ts",
        "packages/perception-adapters/assets/README.md",
      ],
    }),
  ];
}
