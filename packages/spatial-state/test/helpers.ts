/**
 * Shared deterministic test helpers (W206). Fixed constants only — no
 * `Math.random`, no `Date.now` (docs/testing/HARNESS.md). Every expected
 * value in the tests that use these helpers is hand-derived from the
 * documented W203 camera model and W204 fixture laws.
 */
import { FixtureFieldCalibrator } from "@sporta/field-mapping";
import type { FieldCornerSet, FixtureCameraSpec } from "@sporta/field-mapping";
import {
  GreedyIouTracker,
  detectionsFromGroundTruth,
  generateFixtureFrames,
} from "@sporta/perception-tracking";
import type { FixtureTrackSpec, TrackedBox } from "@sporta/perception-tracking";
import { estimateSpatialState } from "../src/state";
import type { SpatialFrame, SpatialStatePoint, SpatialStateSeries } from "../src/state";
import type { SpatialStateOptions } from "../src/state";

/**
 * The identity camera (projection tests): image corners (0,0), (1,0), (1,1),
 * (0,1) in the canonical "tl, tr, br, bl" order map to the pitch corners
 * (0,0), (105,0), (105,68), (0,68) — so the image -> pitch map is exactly
 * `X = 105u`, `Y = 68v`.
 */
export const IDENTITY_CORNER_SET: FieldCornerSet = {
  corners: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
  cornerOrder: "tl, tr, br, bl",
  confidence: 0.9,
};

/** Pixel volume offered to the fixture calibrator (it ignores content). */
const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 90;
const FRAME_BYTES = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT * 3);

/** One W204 tracker frame at the documented fixture cadence (40 ms). */
export function frameOf(frameId: string, presentationMs: number, decodeOrder: number) {
  return { frameId, presentationMs, decodeOrder };
}

/** One tracked box (label defaults to "player", confidence to W204's 0.9). */
export function trackOf(
  trackId: string,
  box: { x: number; y: number; w: number; h: number },
  label = "player",
  confidence = 0.9,
): TrackedBox {
  return { box, label, confidence, trackId };
}

/** The corner set the W203 fixture camera produces for `camera` at `d`. */
export function cornerSetFrom(camera: FixtureCameraSpec, decodeOrder: number): FieldCornerSet {
  return new FixtureFieldCalibrator(camera).calibrate({
    frameId: `f-0-${decodeOrder}`,
    presentationMs: decodeOrder * 40,
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    bytes: FRAME_BYTES,
    decodeOrder,
  });
}

/** A fully-populated hand-built spatial point (sessionMs chosen by the test). */
export function pointWith(sessionMs: number, trackId = "t1", frameId = "f-0-0"): SpatialStatePoint {
  return {
    trackId,
    frameId,
    sessionMs,
    pitch: { x: 52.5, y: 34 },
    inBounds: true,
    confidence: 0.9,
    sourceConfidences: { track: 0.9, corners: 0.9 },
    label: "player",
  };
}

/**
 * Runs the full fused pipeline over a W204 fixture, mirroring the benchmark's
 * documented route (generateFixtureFrames -> detectionsFromGroundTruth ->
 * GreedyIouTracker with default options -> per-frame FixtureFieldCalibrator
 * -> estimateSpatialState). `cameraAt` supplies the per-frame camera (a fixed
 * spec, or the e2e pan sweep). Deterministic end to end.
 */
export function fuseFixtureScenario(input: {
  specs: readonly FixtureTrackSpec[];
  frames: number;
  sceneCutFrames?: ReadonlySet<number>;
  cameraAt: (decodeOrder: number) => FixtureCameraSpec;
  options?: SpatialStateOptions;
}): SpatialStateSeries {
  const groundTruth = generateFixtureFrames(input.specs, {
    frames: input.frames,
    ...(input.sceneCutFrames !== undefined ? { sceneCutFrames: input.sceneCutFrames } : {}),
  });
  const tracker = new GreedyIouTracker({}, "spatial-state-test-tracker");
  const spatialFrames: SpatialFrame[] = [];
  for (const gtFrame of groundTruth) {
    const d = gtFrame.frame.decodeOrder;
    spatialFrames.push({
      frame: gtFrame.frame,
      cornerSet: cornerSetFrom(input.cameraAt(d), d),
      tracks: tracker.assign(gtFrame.frame, detectionsFromGroundTruth(gtFrame)),
    });
  }
  return estimateSpatialState(spatialFrames, input.options);
}
