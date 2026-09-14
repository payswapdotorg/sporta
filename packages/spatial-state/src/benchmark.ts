/**
 * Spatial consistency benchmark (W206) — the "spatial state estimation is
 * coherent under representative camera motion" instrument.
 *
 * Per scenario, the benchmark drives the FULL delivered pipeline end-to-end
 * (consume only, never re-implement):
 *
 * ```text
 *   W204 generateFixtureFrames          (ground truth + tracker frames)
 *   -> per frame: W203 FixtureFieldCalibrator(camera) cornerSet
 *      + W204 detectionsFromGroundTruth -> GreedyIouTracker boxes
 *   -> W206 estimateSpatialState(frames, { clock })     (the fusion under test)
 *   -> metrics
 * ```
 *
 * Identity-level metrics (identitySwitches, coverage) are delegated
 * VERBATIM to W204's `runTrackingBenchmark` — the correspondence (W201's
 * `matchDetections`, label-gated, IoU >= 0.5 inclusive) and the walk-based
 * switch counting are W204's delivered semantics; this module never
 * re-derives them.
 *
 * Determinism: pure — no RNG, no clock reads, no I/O. The same scenarios
 * always produce a deep-equal report array. The fixture camera ignores
 * pixel content (documented in W203), so the calibration is a pure
 * function of (spec, decodeOrder); the tracker is a pure state machine.
 */
import { FixtureFieldCalibrator } from "@sporta/field-mapping";
import type { CalibratorFrameInput, FixtureCameraSpec } from "@sporta/field-mapping";
import {
  GreedyIouTracker,
  detectionsFromGroundTruth,
  generateFixtureFrames,
  runTrackingBenchmark,
} from "@sporta/perception-tracking";
import type { FixtureTrackSpec, GroundTruthFrame, TrackedBox } from "@sporta/perception-tracking";
import type { TrackClock } from "@sporta/timeline";
import { estimateSpatialState } from "./state";
import type { SpatialFrame, SpatialStatePoint, SpatialStateSeries } from "./state";

/**
 * The W204 fixture motion spec (W201's `MotionSpec` — linear or static box
 * CENTER motion over the fixture's frame span). Derived TYPE-ONLY from the
 * exported `FixtureTrackSpec` (perception-tracking does not re-export
 * `MotionSpec` itself): this IS the same type, obtained without adding a
 * dependency beyond the W206 brief's list.
 */
export type MotionSpec = FixtureTrackSpec["motion"];

/**
 * One benchmark scenario. The sketch fields are the brief's; the two
 * OPTIONAL fields are documented extensions the brief's own tests require
 * (a static camera cannot express the e2e pan sweep, and a cut scenario
 * needs a cut marker):
 *
 * - `panTo`: when present, the camera PANS across the scenario — frame
 *   `d`'s pan is `camera.pan + (panTo - camera.pan) * t` with
 *   `t = d / max(frames - 1, 1)` (the W204 fixture interpolation law), so
 *   frame 0 uses `camera.pan` and the last frame uses `panTo`. The corner
 *   set (and therefore the homography) then differs PER FRAME — the
 *   per-frame calibration path the fusion exists for. Must be in [0, 1].
 * - `sceneCutFrames`: decode orders marked as hard camera cuts (passed
 *   through to W204's `generateFixtureFrames`; with the tracker's default
 *   `onSceneCut: "close-all"` every active track closes at the cut and
 *   post-cut detections open FRESH ids).
 */
export interface SpatialBenchmarkScenario {
  /** Scenario label (report `scenario` field). */
  readonly name: string;
  /** The fixture camera (W203 `FixtureCameraSpec`: pan, zoom, jitter). */
  readonly camera: FixtureCameraSpec;
  /** The scene's players: label + motion (boxes get the default size below). */
  readonly players: ReadonlyArray<{ readonly label: string; readonly motion: MotionSpec }>;
  /** Number of frames (drives the motion parameter `t`); integer >= 1. */
  readonly frames: number;
  /** Optional W103 clock for the fusion (default: the identity clock). */
  readonly clock?: TrackClock;
  /** Optional camera pan-sweep endpoint — see interface docs. */
  readonly panTo?: number;
  /** Optional hard scene-cut decode orders — see interface docs. */
  readonly sceneCutFrames?: ReadonlySet<number>;
}

/** Per-scenario spatial consistency report (all values pure functions of the scenario). */
export interface SpatialBenchmarkReport {
  /** The scenario's label. */
  readonly scenario: string;
  /** Number of fused frames. */
  readonly frames: number;
  /** Total spatial points (one per tracked box per frame). */
  readonly points: number;
  /** Points with `inBounds === false` (flagged, never clamped). */
  readonly outOfBounds: number;
  /**
   * Max pitch-space distance (meters, Euclidean) ANY track moves between
   * its consecutive points in the series (appearance order — a gap spans
   * the missing frames). 0 when no track has two points. Smooth projected
   * motion keeps this small; the e2e accept bound is < 3 m.
   */
  readonly maxPerFrameJump: number;
  /** Mean fused confidence over all points (0 when there are none). */
  readonly meanConfidence: number;
  /**
   * Identity switches per W204 semantics: the walk-based count from W204's
   * `runTrackingBenchmark` over the GT-vs-track correspondence (IoU 0.5).
   * In the fixture scenarios this equals the per-object reading "distinct
   * track ids seen per ground-truth object minus 1", summed over objects
   * (fixture ids never oscillate, so the walk and fragment counts agree).
   */
  readonly identitySwitches: number;
  /**
   * Matched ground-truth entries / total ground-truth entries (via the
   * same W204 correspondence; 0 when the scenario has no GT entries — the
   * documented zero-denominator convention, never NaN).
   */
  readonly coverage: number;
}

/** A prepared scenario: the fused input frames plus the ground truth they came from. */
export interface SpatialScenarioFrames {
  /** Fused input frames (tracker frame + corner set + tracked boxes), decode order. */
  readonly frames: readonly SpatialFrame[];
  /** The W204 fixture ground truth (per-frame GT entries, spec order). */
  readonly groundTruth: readonly GroundTruthFrame[];
}

/**
 * Box size every scenario player gets (center-based, normalized image
 * units — mirrors the W204 `FixtureTrackSpec.size` grammar). The scenario
 * sketch carries label + motion only; the size is the benchmark's
 * documented constant.
 */
export const BENCHMARK_PLAYER_SIZE: { readonly w: number; readonly h: number } = { w: 0.1, h: 0.1 };

/** Dummy frame dimensions for the calibrator input (the fixture ignores pixels). */
const BENCHMARK_FRAME_WIDTH = 160;
const BENCHMARK_FRAME_HEIGHT = 90;

/** Tracker id for every scenario run (valid W204 id; fresh instance per scenario). */
const BENCHMARK_TRACKER_ID = "spatial-benchmark-tracker";

function validateScenario(scenario: SpatialBenchmarkScenario): void {
  if (typeof scenario.name !== "string" || scenario.name.length < 1) {
    throw new RangeError(
      `spatial benchmark scenario: name must be a non-empty string (got ${String(scenario.name)})`,
    );
  }
  if (
    typeof scenario.frames !== "number" ||
    !Number.isInteger(scenario.frames) ||
    scenario.frames < 1
  ) {
    throw new RangeError(
      `spatial benchmark scenario "${scenario.name}": frames must be an integer >= 1 ` +
        `(got ${String(scenario.frames)})`,
    );
  }
  if (
    scenario.panTo !== undefined &&
    (typeof scenario.panTo !== "number" ||
      !Number.isFinite(scenario.panTo) ||
      scenario.panTo < 0 ||
      scenario.panTo > 1)
  ) {
    throw new RangeError(
      `spatial benchmark scenario "${scenario.name}": panTo must be a finite number in [0, 1] ` +
        `(got ${String(scenario.panTo)})`,
    );
  }
  if (!Array.isArray(scenario.players)) {
    throw new RangeError(`spatial benchmark scenario "${scenario.name}": players must be an array`);
  }
}

function calibratorFrameFor(gtFrame: GroundTruthFrame, bytes: Uint8Array): CalibratorFrameInput {
  // Pixel content, width, and height are IGNORED by the fixture calibrator
  // (documented W203 behavior) — the bytes exist only to satisfy the
  // CalibratorFrameInput shape and are shared across the scenario's frames.
  return {
    frameId: gtFrame.frame.frameId,
    presentationMs: gtFrame.frame.presentationMs,
    width: BENCHMARK_FRAME_WIDTH,
    height: BENCHMARK_FRAME_HEIGHT,
    bytes,
    decodeOrder: gtFrame.frame.decodeOrder,
  };
}

/**
 * Builds one scenario's fused input frames: the W204 fixture ground truth,
 * per-frame W203 fixture calibration (static camera, or the documented
 * pan sweep when `panTo` is set), and the W204 tracker's boxes.
 *
 * Players map to `FixtureTrackSpec`s in array order with deterministic
 * ground-truth ids `p1`, `p2`, … and {@link BENCHMARK_PLAYER_SIZE} boxes.
 * A fresh `GreedyIouTracker` (defaults: IoU 0.5, gap 0, "close-all" on
 * scene cuts) runs the scenario, so post-cut detections open fresh ids.
 *
 * Exported (not just internal) so tests can obtain the SERIES for
 * per-point accept checks the report does not carry — the report
 * summarizes; the frames are the evidence. Pure and deterministic.
 */
export function buildSpatialScenarioFrames(
  scenario: SpatialBenchmarkScenario,
): SpatialScenarioFrames {
  validateScenario(scenario);
  // Constructed eagerly: validates the camera spec fail-loud before any
  // frame exists. Reused as-is for the whole scenario when not sweeping.
  const staticCalibrator = new FixtureFieldCalibrator(scenario.camera);

  const specs: FixtureTrackSpec[] = scenario.players.map((player, index) => ({
    gtId: `p${index + 1}`,
    label: player.label,
    motion: player.motion,
    size: BENCHMARK_PLAYER_SIZE,
  }));
  const groundTruth = generateFixtureFrames(specs, {
    frames: scenario.frames,
    ...(scenario.sceneCutFrames !== undefined ? { sceneCutFrames: scenario.sceneCutFrames } : {}),
  });

  const bytes = new Uint8Array(BENCHMARK_FRAME_WIDTH * BENCHMARK_FRAME_HEIGHT * 3);
  const tracker = new GreedyIouTracker({}, BENCHMARK_TRACKER_ID);
  const frames: SpatialFrame[] = [];
  for (const gtFrame of groundTruth) {
    let cornerSet;
    if (scenario.panTo === undefined) {
      cornerSet = staticCalibrator.calibrate(calibratorFrameFor(gtFrame, bytes));
    } else {
      // Camera pan sweep: pan(d) = pan + (panTo - pan) * t, with the W204
      // fixture interpolation law t = d / max(frames - 1, 1). A per-frame
      // calibrator means a per-frame homography — the calibration-varying
      // path the fusion exists for. (FixtureFieldCalibrator re-validates
      // each spec; rounding of the interpolated pan stays far inside [0, 1]
      // for sweep endpoints inside it.)
      const t = gtFrame.frame.decodeOrder / Math.max(scenario.frames - 1, 1);
      const pan = scenario.camera.pan + (scenario.panTo - scenario.camera.pan) * t;
      cornerSet = new FixtureFieldCalibrator({ ...scenario.camera, pan }).calibrate(
        calibratorFrameFor(gtFrame, bytes),
      );
    }
    const tracks = tracker.assign(gtFrame.frame, detectionsFromGroundTruth(gtFrame));
    frames.push({ frame: gtFrame.frame, cornerSet, tracks });
  }
  return { frames, groundTruth };
}

/** Max consecutive-point pitch distance per track, in series order (meters). */
function maxPerFrameJumpOf(series: SpatialStateSeries): number {
  const byTrack = new Map<string, SpatialStatePoint[]>();
  for (const point of series.points) {
    const list = byTrack.get(point.trackId);
    if (list === undefined) {
      byTrack.set(point.trackId, [point]);
    } else {
      list.push(point);
    }
  }
  let max = 0;
  for (const trackPoints of byTrack.values()) {
    for (let i = 1; i < trackPoints.length; i += 1) {
      const dx = trackPoints[i]!.pitch.x - trackPoints[i - 1]!.pitch.x;
      const dy = trackPoints[i]!.pitch.y - trackPoints[i - 1]!.pitch.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > max) max = distance;
    }
  }
  return max;
}

/**
 * Runs the spatial consistency benchmark over the scenarios, in order.
 * Per scenario: build the fused frames ({@link buildSpatialScenarioFrames}),
 * fuse them ({@link estimateSpatialState} with the scenario's clock or the
 * identity default), and compute the report — identitySwitches and
 * coverage delegated to W204's `runTrackingBenchmark`. Pure and
 * deterministic: the same scenarios always produce a deep-equal array.
 */
export function runSpatialBenchmark(
  scenarios: readonly SpatialBenchmarkScenario[],
): SpatialBenchmarkReport[] {
  return scenarios.map((scenario) => {
    const { frames, groundTruth } = buildSpatialScenarioFrames(scenario);
    const series = estimateSpatialState(
      frames,
      scenario.clock === undefined ? undefined : { clock: scenario.clock },
    );

    // Identity-level metrics: W204's delivered benchmark, verbatim.
    const predicted = new Map<string, readonly TrackedBox[]>();
    for (const frame of frames) {
      predicted.set(frame.frame.frameId, frame.tracks);
    }
    const tracking = runTrackingBenchmark({ groundTruth, predicted });

    let confidenceSum = 0;
    for (const point of series.points) confidenceSum += point.confidence;
    const meanConfidence = series.points.length > 0 ? confidenceSum / series.points.length : 0;

    const gtEntries = tracking.matchedDetections + tracking.missedDetections;
    const coverage = gtEntries > 0 ? tracking.matchedDetections / gtEntries : 0;

    return {
      scenario: scenario.name,
      frames: series.frames,
      points: series.points.length,
      outOfBounds: series.outOfBounds,
      maxPerFrameJump: maxPerFrameJumpOf(series),
      meanConfidence,
      identitySwitches: tracking.identitySwitches,
      coverage,
    };
  });
}
