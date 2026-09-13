import { describe, expect, test } from "bun:test";
import {
  BALL_BOX_SIZE,
  BALL_DETECTION_CONFIDENCE,
  BALL_LABEL,
  generateScenarioFrames,
} from "../src/scenario";
import type { BallScenarioSpec } from "../src/scenario";

const LINEAR_SPEC: BallScenarioSpec = {
  label: "scenario-linear",
  fps: 25,
  durationMs: 2000,
  flight: { kind: "linear", from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 } },
  occlusions: [],
  detectionNoise: 0,
  dropRate: 0,
};

/** Parabolic spec whose apex lands exactly on a frame (41 frames, t=k/40). */
const PARABOLIC_SPEC: BallScenarioSpec = {
  label: "scenario-parabolic",
  fps: 25,
  durationMs: 1640, // 41 frames at 40 ms
  flight: { kind: "parabolic", from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 }, apex: 0.2 },
  occlusions: [],
  detectionNoise: 0,
  dropRate: 0,
};

function detectionCenter(frame: {
  detections: readonly { box: { x: number; y: number; w: number; h: number } }[];
}): {
  x: number;
  y: number;
} {
  const detection = frame.detections[0];
  if (detection === undefined) throw new Error("frame has no detection");
  return { x: detection.box.x + detection.box.w / 2, y: detection.box.y + detection.box.h / 2 };
}

describe("generateScenarioFrames", () => {
  test("frame count, ids, and timeline positions follow the documented formulas", () => {
    const { frames, groundTruth } = generateScenarioFrames(LINEAR_SPEC);
    expect(frames).toHaveLength(50); // ceil(2000 / 40)
    expect(groundTruth).toHaveLength(50);
    for (const [k, frame] of frames.entries()) {
      expect(frame.frameId).toBe(`f-0-${k}`);
      expect(frame.decodeOrder).toBe(k);
      expect(frame.presentationMs).toBe(k * 40);
      expect(frame.detections).toHaveLength(1); // visible, not dropped
    }
    // Ground truth covers every frame, in frame order.
    expect(groundTruth[49]?.presentationMs).toBe(1960);
    expect(groundTruth[49]?.frameId).toBe("f-0-49");
  });

  test("linear flight math: centers interpolate from -> to exactly", () => {
    const { frames, groundTruth } = generateScenarioFrames(LINEAR_SPEC);
    for (const [k, truth] of groundTruth.entries()) {
      const t = k / 49;
      expect(truth.center.x).toBeCloseTo(0.2 + 0.6 * t, 15);
      expect(truth.center.y).toBeCloseTo(0.5, 15);
    }
    // Noise 0: the detection's box is the fixed 0.04x0.04 square around the
    // truth center, so the detected center equals the truth center.
    for (const [k, frame] of frames.entries()) {
      const detection = frame.detections[0];
      const truth = groundTruth[k];
      if (detection === undefined || truth === undefined) throw new Error("missing");
      expect(detection.label).toBe(BALL_LABEL);
      expect(detection.confidence).toBe(BALL_DETECTION_CONFIDENCE);
      expect(detection.box.w).toBeCloseTo(BALL_BOX_SIZE, 15);
      expect(detection.box.h).toBeCloseTo(BALL_BOX_SIZE, 15);
      const center = detectionCenter(frame);
      expect(center.x).toBeCloseTo(truth.center.x, 12);
      expect(center.y).toBeCloseTo(truth.center.y, 12);
    }
  });

  test("parabolic flight math: apex exactly at the parameter midpoint", () => {
    const { groundTruth } = generateScenarioFrames(PARABOLIC_SPEC);
    // 41 frames: t_k = k / 40, so k = 20 is t = 0.5 exactly.
    // y(t) = from.y + (to.y - from.y) * t + apex * sin(pi * t)
    //      = 0.5 + 0.2 * sin(pi * t)  here (flat linear y).
    const mid = groundTruth[20];
    if (mid === undefined) throw new Error("midpoint missing");
    expect(mid.center.x).toBeCloseTo(0.5, 12); // x is linear: 0.2 + 0.6 * 0.5
    expect(mid.center.y).toBeCloseTo(0.5 + 0.2 * 1, 12); // sin(pi/2) = 1 -> apex
    // The apex is the maximum and the flight is symmetric about it.
    for (const [k, truth] of groundTruth.entries()) {
      const mirror = groundTruth[40 - k];
      if (mirror === undefined) throw new Error("mirror missing");
      expect(truth.center.y).toBeCloseTo(mirror.center.y, 12);
      expect(truth.center.y).toBeLessThanOrEqual(mid.center.y + 1e-12);
      // Formula check at every frame: y = 0.5 + 0.2 sin(pi k / 40).
      expect(truth.center.y).toBeCloseTo(0.5 + 0.2 * Math.sin((Math.PI * k) / 40), 15);
      expect(truth.center.x).toBeCloseTo(0.2 + 0.6 * (k / 40), 15);
    }
  });

  test("noise: deterministic pseudo-noise offsets both center coordinates", () => {
    const spec: BallScenarioSpec = { ...LINEAR_SPEC, detectionNoise: 0.01 };
    const { frames, groundTruth } = generateScenarioFrames(spec);
    // n_k = ((k * 37 + 11) % 100) / 100 * noise, applied to x AND y.
    const expectedNoise = (k: number): number => (((k * 37 + 11) % 100) / 100) * 0.01;
    expect(expectedNoise(0)).toBeCloseTo(0.0011, 15); // (0*37+11) % 100 = 11
    expect(expectedNoise(1)).toBeCloseTo(0.0048, 15); // 48
    expect(expectedNoise(2)).toBeCloseTo(0.0085, 15); // 85
    expect(expectedNoise(3)).toBeCloseTo(0.0022, 15); // 122 % 100 = 22
    for (const [k, frame] of frames.entries()) {
      const truth = groundTruth[k];
      if (truth === undefined) throw new Error("truth missing");
      const center = detectionCenter(frame);
      expect(center.x).toBeCloseTo(truth.center.x + expectedNoise(k), 12);
      expect(center.y).toBeCloseTo(truth.center.y + expectedNoise(k), 12);
    }
    // Ground truth stays pre-noise.
    expect(groundTruth[0]?.center.x).toBeCloseTo(0.2, 15);
  });

  test("determinism: a seed-free spec reproduces identical frames and truth", () => {
    const spec: BallScenarioSpec = {
      ...LINEAR_SPEC,
      occlusions: [{ fromMs: 200, toMs: 600 }],
      detectionNoise: 0.01,
      dropRate: 5,
    };
    expect(generateScenarioFrames(spec)).toEqual(generateScenarioFrames(spec));
  });

  test("dropRate: every dropRate-th frame (1-based) is dropped, others keep detections", () => {
    const spec: BallScenarioSpec = { ...LINEAR_SPEC, dropRate: 5 };
    const { frames } = generateScenarioFrames(spec);
    for (const [k, frame] of frames.entries()) {
      const dropped = k % 5 === 4; // 0-based indices 4, 9, ..., 49
      expect(frame.detections).toHaveLength(dropped ? 0 : 1);
    }
    expect(frames.filter((frame) => frame.detections.length === 0)).toHaveLength(10);
  });

  test("occlusion: frames inside a half-open [fromMs, toMs) window carry no detections", () => {
    const spec: BallScenarioSpec = {
      ...LINEAR_SPEC,
      occlusions: [{ fromMs: 200, toMs: 600 }],
    };
    const { frames, groundTruth } = generateScenarioFrames(spec);
    for (const [k, frame] of frames.entries()) {
      const ms = k * 40;
      const occluded = ms >= 200 && ms < 600;
      expect(frame.detections).toHaveLength(occluded ? 0 : 1);
      // Ground truth exists for occluded frames too (exact, pre-noise).
      expect(groundTruth[k]?.center).toBeDefined();
    }
    // Boundaries: ms 200 is occluded (inclusive), ms 600 is not (exclusive).
    expect(frames[5]?.detections).toHaveLength(0);
    expect(frames[15]?.detections).toHaveLength(1);
  });

  test("spec validation fails loud (repo convention)", () => {
    expect(() => generateScenarioFrames({ ...LINEAR_SPEC, label: "" })).toThrow(RangeError);
    expect(() => generateScenarioFrames({ ...LINEAR_SPEC, fps: 0 })).toThrow(RangeError);
    expect(() => generateScenarioFrames({ ...LINEAR_SPEC, durationMs: -1 })).toThrow(RangeError);
    expect(() => generateScenarioFrames({ ...LINEAR_SPEC, detectionNoise: -0.1 })).toThrow(
      RangeError,
    );
    expect(() => generateScenarioFrames({ ...LINEAR_SPEC, dropRate: 1 })).toThrow(RangeError);
    expect(() => generateScenarioFrames({ ...LINEAR_SPEC, dropRate: 2.5 })).toThrow(RangeError);
    expect(() =>
      generateScenarioFrames({
        ...LINEAR_SPEC,
        occlusions: [{ fromMs: 600, toMs: 200 }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      generateScenarioFrames({
        ...LINEAR_SPEC,
        flight: {
          kind: "parabolic",
          from: { x: 0.2, y: 0.5 },
          to: { x: 0.8, y: 0.5 },
          apex: Number.NaN,
        },
      }),
    ).toThrow(RangeError);
  });
});
