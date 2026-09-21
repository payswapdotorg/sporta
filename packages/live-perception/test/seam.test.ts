/**
 * THE L011 SEAM UNIT BATTERY — hand-built frames, tracked boxes, ball
 * detections and calibrations (exact arithmetic control; no ffmpeg here —
 * the integration test covers the decoded-clip path).
 *
 * Pins: the frozen `BROADCAST_PERCEPTION` source type, the batch-bridge
 * projection arithmetic (imported, not forked), the confidence discount, the
 * off-pitch flagging + counting, the infinite-projection drop, the ball-row
 * selection, the honest empty frame, and determinism.
 */
import { describe, expect, test } from "bun:test";
import { parseLiveObservation } from "@sporta/live-source";
import type { DetectedBox, DetectorFrameInput, TrackedBox } from "@sporta/perception-adapters";
import type { CalibrationResult } from "@sporta/perception-adapters";
import { createBroadcastPerceptionSeam } from "../src/index";

const SESSION_ID = "s-perception-seam";

/** A hand-built frame (identity + timeline position only — the seam reads no pixels). */
function frame(presentationMs: number, decodeOrder: number): DetectorFrameInput {
  return {
    frameId: `f-0-${decodeOrder}`,
    streamIndex: 0,
    presentationMs,
    decodeOrder,
    width: 320,
    height: 240,
    bytes: new Uint8Array(320 * 240 * 3),
  };
}

/** A tracked player box. */
function trackedBox(input: {
  trackId: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  confidence: number;
}): TrackedBox {
  return {
    box: { x: input.x, y: input.y, w: input.w ?? 0.05, h: input.h ?? 0.1 },
    label: "player",
    confidence: input.confidence,
    trackId: input.trackId,
  };
}

/** A ball detection box. */
function ballBox(x: number, y: number, confidence: number): DetectedBox {
  return { box: { x, y, w: 0.02, h: 0.02 }, label: "ball", confidence };
}

/**
 * The identity-scale calibration: the full frame IS the pitch — normalized
 * (x, y) → (105x, 68y). The test's KNOWN geometry (never a fabricated
 * calibration result).
 */
function fullFrameCalibration(confidence = 1): CalibrationResult {
  return {
    mapping: {
      kind: "field-mapping",
      pitchCorners: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    },
    homography: [105, 0, 0, 0, 68, 0, 0, 0, 1],
    cornerSet: {
      corners: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      cornerOrder: "tl, tr, br, bl",
      confidence,
    },
    confidence,
    correspondenceCount: 4,
  };
}

describe("the seam — the frozen BROADCAST_PERCEPTION contract", () => {
  test("a frame's tracked players + best ball become one contract-valid batch", () => {
    const seam = createBroadcastPerceptionSeam({ sessionId: SESSION_ID });
    const batch = seam.observation(
      {
        frame: frame(1000, 0),
        trackedPlayers: [
          trackedBox({ trackId: "t-1", x: 0.4, y: 0.5, confidence: 0.9 }),
          trackedBox({ trackId: "t-2", x: 0.7, y: 0.3, confidence: 0.75 }),
        ],
        ballDetections: [
          ballBox(0.5, 0.5, 0.6),
          ballBox(0.52, 0.51, 0.8), // the higher-confidence ball wins
        ],
        calibration: fullFrameCalibration(),
      },
      1,
    );
    expect(batch).not.toBeNull();
    expect(() => parseLiveObservation(batch!)).not.toThrow();
    expect(batch!.sourceType).toBe("BROADCAST_PERCEPTION");
    expect(batch!.sessionId).toBe(SESSION_ID);
    expect(batch!.sequence).toBe(1);
    expect(batch!.eventTimeMs).toBe(1000); // the frame's presentation time
    expect(batch!.watermark).toEqual({ watermarkMs: 1000, sequence: 1 });
    expect(batch!.provenance).toBe("DERIVED");
    expect(batch!.entityObservations).toHaveLength(3);
    // Identity passthrough VERBATIM (the batch convention).
    expect(batch!.entityObservations.map((row) => row.entityRef)).toEqual(["t-1", "t-2", "ball"]);
    // The identity-scale projection: box CENTER through the homography.
    // t-1 center = (0.4 + 0.025, 0.5 + 0.05) = (0.425, 0.55) → (44.625, 37.4).
    const player = batch!.entityObservations[0]!;
    expect(player.position.xMeters).toBeCloseTo(44.625, 9);
    expect(player.position.yMeters).toBeCloseTo(37.4, 9);
    expect(player.kind).toBe("PLAYER");
    expect(player.detected).toBe(true);
    expect(player.confidence).toBe(0.9); // verbatim × calibration confidence 1
    const ball = batch!.entityObservations[2]!;
    expect(ball.kind).toBe("BALL");
    expect(ball.confidence).toBe(0.8);
    expect(ball.position.xMeters).toBeCloseTo(105 * 0.53, 9);
    expect(ball.position.yMeters).toBeCloseTo(68 * 0.52, 9);
  });

  test("projected positions are inference: the confidence is discounted by the calibration's", () => {
    const seam = createBroadcastPerceptionSeam({ sessionId: SESSION_ID });
    const batch = seam.observation(
      {
        frame: frame(1000, 0),
        trackedPlayers: [trackedBox({ trackId: "t-1", x: 0.4, y: 0.5, confidence: 0.9 })],
        calibration: fullFrameCalibration(0.5),
      },
      1,
    );
    expect(batch!.entityObservations[0]!.confidence).toBeCloseTo(0.45, 10);
  });

  test("off-pitch projections are kept, flagged and counted (never clamped)", () => {
    const seam = createBroadcastPerceptionSeam({ sessionId: SESSION_ID });
    const batch = seam.observation(
      {
        frame: frame(1000, 0),
        // Center x > 1 → projected x > 105 (off the pitch).
        trackedPlayers: [trackedBox({ trackId: "t-out", x: 0.99, y: 0.5, confidence: 0.9 })],
        calibration: fullFrameCalibration(),
      },
      1,
    );
    const row = batch!.entityObservations[0]!;
    expect(row.position.xMeters).toBeGreaterThan(105); // kept honest, never clamped
    expect(seam.stats().offPitchRows).toBe(1);
  });

  test("a projection at infinity is dropped and counted (never a fabricated position)", () => {
    const seam = createBroadcastPerceptionSeam({ sessionId: SESSION_ID });
    // A degenerate homography: the denominator vanishes at the box CENTER —
    // the trackedBox center is (0.5 + 0.025, 0.5 + 0.05) = (0.525, 0.55), so
    // h6*x + h7*y + h8 = 1*0.525 + 0*0.55 - 0.525 = 0: the point is at
    // infinity.
    const degenerate = fullFrameCalibration();
    const batch = seam.observation(
      {
        frame: frame(1000, 0),
        trackedPlayers: [trackedBox({ trackId: "t-inf", x: 0.5, y: 0.5, confidence: 0.9 })],
        calibration: {
          ...degenerate,
          homography: [1, 0, 0, 0, 1, 0, 1, 0, -0.525],
        },
      },
      1,
    );
    expect(batch).toBeNull(); // no rows survived — the honest empty frame
    expect(seam.stats().droppedInfiniteProjections).toBe(1);
    expect(seam.stats().framesWithoutRows).toBe(1);
  });

  test("a frame with no tracked players and no ball yields NO batch (counted)", () => {
    const seam = createBroadcastPerceptionSeam({ sessionId: SESSION_ID });
    const batch = seam.observation(
      {
        frame: frame(1041, 1),
        trackedPlayers: [],
        calibration: fullFrameCalibration(),
      },
      2,
    );
    expect(batch).toBeNull();
    expect(seam.stats().framesProcessed).toBe(1);
    expect(seam.stats().framesWithoutRows).toBe(1);
  });

  test("no velocity is ever invented; the seam's accounting is complete", () => {
    const seam = createBroadcastPerceptionSeam({ sessionId: SESSION_ID });
    const batch = seam.observation(
      {
        frame: frame(1000, 0),
        trackedPlayers: [trackedBox({ trackId: "t-1", x: 0.4, y: 0.5, confidence: 0.9 })],
        ballDetections: [ballBox(0.5, 0.5, 0.7)],
        calibration: fullFrameCalibration(),
      },
      1,
    );
    for (const row of batch!.entityObservations) {
      expect(row.velocity).toBeUndefined();
    }
    const stats = seam.stats();
    expect(stats).toEqual({
      framesProcessed: 1,
      batchesEmitted: 1,
      framesWithoutRows: 0,
      playerRowsEmitted: 1,
      ballRowsEmitted: 1,
      offPitchRows: 0,
      droppedInfiniteProjections: 0,
    });
  });

  test("determinism: the same inputs produce byte-identical batches", () => {
    const build = (): string => {
      const seam = createBroadcastPerceptionSeam({ sessionId: SESSION_ID });
      const batch = seam.observation(
        {
          frame: frame(1000, 0),
          trackedPlayers: [trackedBox({ trackId: "t-1", x: 0.4, y: 0.5, confidence: 0.9 })],
          ballDetections: [ballBox(0.5, 0.5, 0.7)],
          calibration: fullFrameCalibration(0.8),
        },
        1,
      );
      return JSON.stringify(batch);
    };
    expect(build()).toBe(build());
  });

  test("a bad configuration is refused fail-loud", () => {
    expect(() => createBroadcastPerceptionSeam({ sessionId: "" })).toThrow();
  });
});
