import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CandidateFailureError,
  HeuristicColorDetector,
  ModelBackedDetector,
  SyntheticFrame,
  generateDetectionFixture,
  makeDetectorFrameInput,
} from "../src/index";
import type { DetectionFixtureSpec, ModelInferenceBackend, WeightsStatus } from "../src/index";

const OPEN_PLAY_SPEC: DetectionFixtureSpec = {
  specId: "test-open-play",
  seed: 7,
  width: 160,
  height: 120,
  frameCount: 4,
  frameIntervalMs: 40,
  players: [
    {
      gtId: "p1",
      jersey: { r: 180, g: 30, b: 30 },
      from: { x: 0.3, y: 0.4 },
      to: { x: 0.4, y: 0.45 },
      boxW: 0.06,
      boxH: 0.12,
    },
    {
      gtId: "p2",
      jersey: { r: 30, g: 60, b: 200 },
      from: { x: 0.7, y: 0.6 },
      to: { x: 0.6, y: 0.55 },
      boxW: 0.06,
      boxH: 0.12,
    },
  ],
  ball: { from: { x: 0.2, y: 0.8 }, to: { x: 0.5, y: 0.3 }, radiusPx: 3 },
  paintPitchLines: true,
};

const CROWDED_SPEC: DetectionFixtureSpec = {
  specId: "test-crowded",
  seed: 8,
  width: 160,
  height: 120,
  frameCount: 4,
  frameIntervalMs: 40,
  players: [
    {
      gtId: "p1",
      jersey: { r: 180, g: 30, b: 30 },
      from: { x: 0.45, y: 0.5 },
      to: { x: 0.46, y: 0.5 },
      boxW: 0.06,
      boxH: 0.12,
    },
    {
      gtId: "p2",
      jersey: { r: 30, g: 60, b: 200 },
      from: { x: 0.51, y: 0.5 },
      to: { x: 0.5, y: 0.5 },
      boxW: 0.06,
      boxH: 0.12,
    },
  ],
  ball: null,
  paintPitchLines: false,
};

describe("HeuristicColorDetector (R202 candidate 1)", () => {
  test("runs on the actual bytes pixels and emits contract-shaped boxes", () => {
    const detector = new HeuristicColorDetector();
    const frames = generateDetectionFixture(OPEN_PLAY_SPEC);
    for (const { frame, groundTruth } of frames) {
      const detections = detector.detect(frame);
      // Both players are found; the white ball and lines are suppressed.
      expect(detections.length).toBe(2);
      for (const detection of detections) {
        expect(detection.label).toBe("player");
        expect(detection.confidence).toBeGreaterThan(0);
        expect(detection.confidence).toBeLessThanOrEqual(1);
        for (const field of [
          detection.box.x,
          detection.box.y,
          detection.box.w,
          detection.box.h,
        ] as const) {
          expect(field).toBeGreaterThanOrEqual(0);
          expect(field).toBeLessThanOrEqual(1);
        }
      }
      // Each detection overlaps its ground-truth player.
      for (const detection of detections) {
        const overlap = groundTruth.some((gt) => {
          const x1 = Math.max(detection.box.x, gt.box.x);
          const x2 = Math.min(detection.box.x + detection.box.w, gt.box.x + gt.box.w);
          const y1 = Math.max(detection.box.y, gt.box.y);
          const y2 = Math.min(detection.box.y + detection.box.h, gt.box.y + gt.box.h);
          return (x2 - x1) * (y2 - y1) > 0;
        });
        expect(overlap).toBe(true);
      }
    }
  });

  test("deterministic on identical inputs (deep-equal)", () => {
    const detector = new HeuristicColorDetector();
    const frames = generateDetectionFixture(OPEN_PLAY_SPEC);
    for (const { frame } of frames) {
      expect(detector.detect(frame)).toEqual(detector.detect(frame));
    }
  });

  test("adjacent players MERGE — the documented weak-detector undercount", () => {
    const detector = new HeuristicColorDetector();
    const frames = generateDetectionFixture(CROWDED_SPEC);
    for (const { frame } of frames) {
      const detections = detector.detect(frame);
      // Two overlapping players become ONE blob (honest documented limit).
      expect(detections.length).toBe(1);
    }
  });

  test("a green frame yields no detections (suppression works)", () => {
    const detector = new HeuristicColorDetector();
    const canvas = new SyntheticFrame(64, 48);
    canvas.fillRect(0, 0, 63, 47, { r: 70, g: 130, b: 60 });
    const frame = makeDetectorFrameInput({
      bytes: canvas.bytes,
      width: 64,
      height: 48,
      decodeOrder: 0,
      presentationMs: 0,
    });
    expect(detector.detect(frame)).toEqual([]);
  });

  test("constructor validates the geometric gates", () => {
    expect(() => new HeuristicColorDetector({ minBlobArea: -1 })).toThrow(RangeError);
    expect(() => new HeuristicColorDetector({ minBlobArea: 500, maxBlobArea: 10 })).toThrow(
      RangeError,
    );
    expect(() => new HeuristicColorDetector({ detectorId: "" })).toThrow(RangeError);
  });
});

describe("ModelBackedDetector (R202 candidate 2)", () => {
  test("without weights: weightsStatus not-downloaded and detect fails closed with the documented class", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "sporta-weights-empty-"));
    try {
      const detector = new ModelBackedDetector({ weightsDir: emptyDir });
      expect(detector.weightsStatus).toBe("not-downloaded" satisfies WeightsStatus);
      const frame = generateDetectionFixture(OPEN_PLAY_SPEC)[0]!.frame;
      expect(() => detector.detect(frame)).toThrow(CandidateFailureError);
      try {
        detector.detect(frame);
      } catch (error) {
        expect((error as CandidateFailureError).details.failureClassId).toBe(
          "model-backed.weights-unavailable",
        );
      }
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test("with weights but no backend: the documented pre-W303 refusal", () => {
    const weightsDir = mkdtempSync(join(tmpdir(), "sporta-weights-present-"));
    try {
      writeFileSync(join(weightsDir, "yolov8n.pt"), "stub-weights");
      const detector = new ModelBackedDetector({ weightsDir });
      expect(detector.weightsStatus).toBe("downloaded" satisfies WeightsStatus);
      expect(detector.weightsPath).toBeDefined();
      const frame = generateDetectionFixture(OPEN_PLAY_SPEC)[0]!.frame;
      expect(() => detector.detect(frame)).toThrow(CandidateFailureError);
      try {
        detector.detect(frame);
      } catch (error) {
        expect((error as CandidateFailureError).details.failureClassId).toBe(
          "model-backed.inference-backend-not-wired",
        );
      }
    } finally {
      rmSync(weightsDir, { recursive: true, force: true });
    }
  });

  test("with weights AND a backend: the exact integration point runs (stub backend proves the seam)", () => {
    const weightsDir = mkdtempSync(join(tmpdir(), "sporta-weights-backend-"));
    try {
      writeFileSync(join(weightsDir, "yolov5nu.onnx"), "stub-weights");
      const seenPaths: string[] = [];
      const backend: ModelInferenceBackend = {
        backendId: "stub-backend",
        infer: (frame, weightsPath) => {
          expect(frame.width).toBe(160);
          seenPaths.push(weightsPath);
          return [
            {
              box: { x: 0.4, y: 0.3, w: 0.06, h: 0.12 },
              label: "player",
              confidence: 0.8,
            },
          ];
        },
      };
      const detector = new ModelBackedDetector({ weightsDir, backend });
      const frames = generateDetectionFixture(OPEN_PLAY_SPEC);
      for (const { frame } of frames) {
        const detections = detector.detect(frame);
        expect(detections.length).toBe(1);
        expect(detections[0]!.label).toBe("player");
      }
      expect(seenPaths.length).toBe(4);
      expect(seenPaths[0]).toContain("yolov5nu.onnx");
    } finally {
      rmSync(weightsDir, { recursive: true, force: true });
    }
  });

  test("the default weights dir is the package assets dir (provenance-checked, not committed)", () => {
    const detector = new ModelBackedDetector();
    expect(
      detector.weightsPath === undefined ||
        detector.weightsPath.endsWith(".pt") ||
        detector.weightsPath.endsWith(".onnx"),
    ).toBe(true);
  });
});
