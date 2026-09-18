/**
 * Deterministic calibration-family benchmark (R205): runs both candidates
 * (the W203-DLT-wrapping homography baseline over the externally-supplied
 * TRUE corner sets — its documented input; and the pixel-driven
 * line-based calibrator over the actual frame pixels) against the
 * committed synthetic-diagnostic fixtures, and emits frozen-contract
 * `BenchmarkRun` records.
 *
 * METRICS: `cornerRmseMeters` (the solved homography applied to the four
 * TRUE canonical-corner image positions vs the canonical pitch corners,
 * RMSE in meters — the honest accuracy number), `solvedScenarios`,
 * `refusedScenarios`, `correspondenceCountMean`, `meanConfidence`. A
 * scenario where a candidate REFUSES (the line-based candidate's
 * documented degenerate/insufficient-evidence refusals) counts as a
 * failure with its failure class and contributes NO accuracy metrics —
 * refused is refused, never a fabricated mapping.
 */
import { CANONICAL_PITCH_CORNERS, applyHomography } from "@sporta/field-mapping";
import type { BenchmarkRun as BenchmarkRunType } from "@sporta/contracts";
import type { Homography } from "@sporta/field-mapping";
import { HomographyFieldCalibratorAdapter } from "../calibration/homography-adapter";
import {
  HOMOGRAPHY_FIELD_CALIBRATOR_ADAPTER_VERSION,
  HOMOGRAPHY_FIELD_CALIBRATOR_ID,
  HOMOGRAPHY_FIELD_CALIBRATOR_VERSION,
} from "../calibration/homography-adapter";
import type { HomographyFieldCalibratorOptions } from "../calibration/homography-adapter";
import { LineBasedFieldCalibrator } from "../calibration/line-based";
import {
  LINE_BASED_FIELD_CALIBRATOR_ADAPTER_VERSION,
  LINE_BASED_FIELD_CALIBRATOR_ID,
  LINE_BASED_FIELD_CALIBRATOR_VERSION,
} from "../calibration/line-based";
import type { LineBasedFieldCalibratorOptions } from "../calibration/line-based";
import type { PitchCalibrationAdapter } from "../adapter";
import { isPerceptionAdapterError } from "../errors";
import {
  FIXTURE_SET_VERSION,
  generateCalibrationFixture,
  type CalibrationFixtureFrame,
  type CalibrationFixtureSpec,
} from "./fixtures";
import {
  DEFAULT_BENCHMARK_CLOCK,
  buildBenchmarkRun,
  loadSpecFile,
  metricDeltaPct,
  type BenchmarkClock,
} from "./run";

/** Options for {@link runCalibrationFamilyBenchmark}; every field is optional. */
export interface CalibrationFamilyBenchmarkOptions {
  /** Scenario specs (default: the committed calibration-scenarios.json set). */
  readonly scenarios?: readonly CalibrationFixtureSpec[];
  readonly homographyOptions?: HomographyFieldCalibratorOptions;
  readonly lineBasedOptions?: LineBasedFieldCalibratorOptions;
  /** Injected clock (default: the deterministic constant clock). */
  readonly clock?: BenchmarkClock;
}

interface CalibrationOutcome {
  readonly metrics: Record<string, number>;
  readonly resourceUsage: Record<string, number>;
  readonly failures: number;
  readonly failureExamples: readonly string[];
}

function cornerRmseMeters(
  homography: Homography,
  fixtureFrames: readonly CalibrationFixtureFrame[],
): number {
  const gtCornerSet = fixtureFrames[0]?.gtCornerSet;
  if (gtCornerSet === undefined) return 0;
  let squaredSum = 0;
  for (const [index, imageCorner] of gtCornerSet.corners.entries()) {
    const projected = applyHomography(homography, imageCorner);
    const expected = CANONICAL_PITCH_CORNERS[index]!;
    squaredSum += (projected.x - expected.x) ** 2 + (projected.y - expected.y) ** 2;
  }
  return Math.sqrt(squaredSum / 4);
}

function evaluateCalibrator(
  scenarios: readonly CalibrationFixtureSpec[],
  adapter: PitchCalibrationAdapter,
  supplyCornerSet: boolean,
): CalibrationOutcome {
  let solved = 0;
  let refused = 0;
  let squaredRmseSum = 0;
  let confidenceSum = 0;
  let correspondenceSum = 0;
  let frames = 0;
  let pixels = 0;
  const failureClasses = new Map<string, number>();
  for (const scenario of scenarios) {
    const fixtureFrames = generateCalibrationFixture(scenario);
    for (const { frame } of fixtureFrames) {
      frames += 1;
      pixels += frame.width * frame.height;
    }
    const cornerSet = fixtureFrames[0]?.gtCornerSet;
    try {
      const result = adapter.calibrate({
        frames: fixtureFrames.map(({ frame }) => frame),
        cornerSet: supplyCornerSet ? cornerSet : undefined,
      });
      solved += 1;
      squaredRmseSum += cornerRmseMeters(result.homography, fixtureFrames) ** 2;
      confidenceSum += result.confidence;
      correspondenceSum += result.correspondenceCount;
    } catch (error) {
      if (isPerceptionAdapterError(error)) {
        refused += 1;
        const failureClassId = String(error.details.failureClassId ?? "unknown");
        failureClasses.set(failureClassId, (failureClasses.get(failureClassId) ?? 0) + 1);
      } else {
        throw error;
      }
    }
  }
  return {
    metrics: {
      cornerRmseMeters: solved > 0 ? Math.sqrt(squaredRmseSum / solved) : 0,
      solvedScenarios: solved,
      refusedScenarios: refused,
      meanConfidence: solved > 0 ? confidenceSum / solved : 0,
      correspondenceCountMean: solved > 0 ? correspondenceSum / solved : 0,
    },
    resourceUsage: { framesProcessed: frames, pixelsProcessed: pixels },
    failures: refused,
    failureExamples: [...failureClasses.entries()].map(
      ([failureClassId, count]) => `${failureClassId}: ${count} scenarios refused`,
    ),
  };
}

/**
 * Runs the calibration-family benchmark over the committed scenario set
 * (or the given scenarios) and returns one frozen-contract `BenchmarkRun`
 * per candidate (homography baseline first, line-based second). Two calls
 * with the same options produce deep-equal records.
 */
export function runCalibrationFamilyBenchmark(
  options: CalibrationFamilyBenchmarkOptions = {},
): readonly BenchmarkRunType[] {
  const clock = options.clock ?? DEFAULT_BENCHMARK_CLOCK();
  const scenarios = options.scenarios ?? loadCommittedCalibrationScenarios();
  const seed = `calibration:${scenarios.map((scenario) => scenario.seed).join("+")}`;

  const homography = new HomographyFieldCalibratorAdapter(options.homographyOptions);
  const lineBased = new LineBasedFieldCalibrator(options.lineBasedOptions);

  const homographyStartedAtMs = clock.now();
  const homographyOutcome = evaluateCalibrator(scenarios, homography, true);
  const homographyCompletedAtMs = clock.now();
  const lineBasedStartedAtMs = clock.now();
  const lineBasedOutcome = evaluateCalibrator(scenarios, lineBased, false);
  const lineBasedCompletedAtMs = clock.now();
  const homographyRerun = evaluateCalibrator(scenarios, homography, true);
  const lineBasedRerun = evaluateCalibrator(scenarios, lineBased, false);

  return [
    buildBenchmarkRun({
      runId: `calibration/${HOMOGRAPHY_FIELD_CALIBRATOR_ID}/${FIXTURE_SET_VERSION}`,
      technologyId: HOMOGRAPHY_FIELD_CALIBRATOR_ID,
      technologyVersion: HOMOGRAPHY_FIELD_CALIBRATOR_VERSION,
      adapterVersion: HOMOGRAPHY_FIELD_CALIBRATOR_ADAPTER_VERSION,
      task: "perception.pitch-calibration",
      fixtureSetVersion: FIXTURE_SET_VERSION,
      startedAtMs: homographyStartedAtMs,
      completedAtMs: homographyCompletedAtMs,
      metrics: homographyOutcome.metrics,
      resourceUsage: homographyOutcome.resourceUsage,
      failureSummary: {
        failures: homographyOutcome.failures,
        failureExamples: homographyOutcome.failureExamples,
      },
      seed,
      rerunDeltaPct: metricDeltaPct(homographyOutcome.metrics, homographyRerun.metrics),
      licenseCheck: "not-applicable",
      artifactRefs: [
        "fixtures/calibration-scenarios.json",
        "packages/perception-adapters/src/benchmark/calibration.ts",
      ],
    }),
    buildBenchmarkRun({
      runId: `calibration/${LINE_BASED_FIELD_CALIBRATOR_ID}/${FIXTURE_SET_VERSION}`,
      technologyId: LINE_BASED_FIELD_CALIBRATOR_ID,
      technologyVersion: LINE_BASED_FIELD_CALIBRATOR_VERSION,
      adapterVersion: LINE_BASED_FIELD_CALIBRATOR_ADAPTER_VERSION,
      task: "perception.pitch-calibration",
      fixtureSetVersion: FIXTURE_SET_VERSION,
      startedAtMs: lineBasedStartedAtMs,
      completedAtMs: lineBasedCompletedAtMs,
      metrics: lineBasedOutcome.metrics,
      resourceUsage: lineBasedOutcome.resourceUsage,
      failureSummary: {
        failures: lineBasedOutcome.failures,
        failureExamples: lineBasedOutcome.failureExamples,
      },
      seed,
      rerunDeltaPct: metricDeltaPct(lineBasedOutcome.metrics, lineBasedRerun.metrics),
      licenseCheck: "not-applicable",
      artifactRefs: [
        "fixtures/calibration-scenarios.json",
        "packages/perception-adapters/src/benchmark/calibration.ts",
      ],
    }),
  ];
}

function loadCommittedCalibrationScenarios(): readonly CalibrationFixtureSpec[] {
  const file = loadSpecFile<{ scenarios: readonly CalibrationFixtureSpec[] }>(
    "calibration-scenarios.json",
  );
  return file.scenarios;
}
