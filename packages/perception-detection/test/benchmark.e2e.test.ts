import { describe, expect, test } from "bun:test";
import { Observation } from "@sporta/contracts";
import { InMemoryObservationStore } from "@sporta/observation";
import type { DetectedBox, DetectorFrameInput, NormalizedBox } from "../src/detector";
import { FixtureDetectorAdapter } from "../src/fixture-detector";
import { emitDetectionObservations, iou, runDetectionBenchmark, validateObservation } from "../src";
import type { LabeledGroundTruth } from "../src";

/**
 * W201 accept-criteria proof (end-to-end): a 100-frame synthetic scene,
 * ground truth from the fixture detector, predictions degraded by a
 * deterministic transform, and a benchmark report with hand-derived expected
 * counts. No `Date.now`, no `Math.random` — every number below is a
 * constant.
 *
 * SCENE: 100 frames (decodeOrder 0..99, 25 fps -> presentationMs = 40 * d),
 * 160x90 rgb24 frames (pixel content is irrelevant: the fixture detector
 * ignores bytes), 3 label specs -> 3 detections per frame -> 300 GT boxes
 * (200 "player", 100 "ball").
 *
 * DEGRADATION (deterministic transform of the GT stream; flat detection
 * index i = 3 * frame + slot, slot 0 = player #1, slot 1 = player #2,
 * slot 2 = ball):
 *
 * 1. DROP every 7th detection (1-based: i % 7 === 6) -> i in
 *    {6, 13, ..., 293} -> 42 drops. Per slot: i = 3f + k ≡ 6 (mod 7) gives
 *    f ≡ 2 (slot 0), f ≡ 4 (slot 1), f ≡ 6 (slot 2) (mod 7), i.e. 14 drops
 *    per slot: player label 28 FN, ball label 14 FN.
 * 2. FALSE POSITIVE on every 13th frame (1-based: f % 13 === 12 ->
 *    f in {12, 25, 38, 51, 64, 77, 90}) -> 7 FPs, label "ball", box
 *    (0.9, 0.02, 0.05, 0.05): y-extent [0.02, 0.07] is disjoint from every
 *    GT ball y-extent (GT ball centers have y in [0.2, 0.5], half-height
 *    0.075 -> y-extent within [0.125, 0.575]), so every FP has IoU 0 with
 *    every same-label GT box and can never match.
 * 3. JITTER every 3rd detection (1-based: i % 3 === 2 -> always slot 2, the
 *    ball) by +0.02 on x and -0.02 on y (kept detections only: 100 ball
 *    detections, 14 of them also dropped -> 86 jittered). A 0.15-square
 *    shifted by (0.02, -0.02) has IoU (0.13 * 0.13) / (2 * 0.0225 - 0.0169)
 *    = 0.0169 / 0.0281 = 0.6014 >= 0.5, so every jittered prediction still
 *    matches its GT box ("still >= threshold IoU").
 *
 * EXPECTED (hand-derived): TP = 300 - 42 = 258 (player 172, ball 86);
 * FP = 7 (all "ball"); FN = 42 (player 28, ball 14); total predictions =
 * 258 + 7 = 265. Global: precision = 258/265, recall = 258/300 = 0.86,
 * f1 = 2PR/(P + R). Per-label "player": 172/0/28 -> precision 1,
 * recall 0.86, f1 = 1.72/1.86. Per-label "ball": 86/7/14 -> precision
 * 86/93, recall 0.86, f1 = 2 * (86/93) * 0.86 / ((86/93) + 0.86).
 *
 * BAND NOTE (documented deviation): the assignment's suggested precision
 * band (~0.88-0.93) is unreachable with "one false positive every 13th
 * frame": 100 frames yield only 7 FPs against 258 TPs, so precision is
 * 258/265 ~ 0.974 — the band would require ~20-35 FPs (e.g. one FP on every
 * 13th DETECTION of the 300-detection stream, ~23). Per the brief's
 * operative instruction ("compute the exact expected values in the test and
 * assert tight ranges; document the arithmetic") the exact values from the
 * literal degradation rules are asserted below; recall (0.86) lands inside
 * the suggested 0.83-0.88 band, precision does not, and the discrepancy is
 * flagged in the worker report for tech-lead review.
 */

const FRAME_COUNT = 100;
const FRAME_MS = 40; // 25 fps
const FRAME_W = 160;
const FRAME_H = 90;
const SESSION_ID = "sess-w201-e2e";
const DETECTOR_ID = "fixture-detector-e2e";

function makeFrame(decodeOrder: number): DetectorFrameInput {
  return {
    frameId: `f-0-${decodeOrder}`,
    presentationMs: decodeOrder * FRAME_MS,
    width: FRAME_W,
    height: FRAME_H,
    // rgb24 volume (unchecked here — decoding validated it upstream); the
    // fixture detector ignores pixel content.
    bytes: new Uint8Array(FRAME_W * FRAME_H * 3),
    decodeOrder,
    streamIndex: 0,
  };
}

const SCENE_SPEC = {
  detectorId: DETECTOR_ID,
  frames: FRAME_COUNT,
  labels: [
    {
      label: "player",
      confidence: 0.92,
      motion: { kind: "linear", from: { x: 0.3, y: 0.7 }, to: { x: 0.7, y: 0.3 } },
      size: { w: 0.2, h: 0.2 },
    },
    {
      label: "player",
      confidence: 0.88,
      motion: { kind: "static", at: { x: 0.5, y: 0.5 } },
      size: { w: 0.18, h: 0.22 },
    },
    {
      label: "ball",
      confidence: 0.75,
      motion: { kind: "linear", from: { x: 0.2, y: 0.2 }, to: { x: 0.6, y: 0.5 } },
      size: { w: 0.15, h: 0.15 },
    },
  ],
} as const;

const FRAMES = Array.from({ length: FRAME_COUNT }, (_, d) => makeFrame(d));
const DETECTOR = new FixtureDetectorAdapter(SCENE_SPEC);

/** Ground truth: the fixture detector's output per frame. */
function groundTruthByFrame(): Map<string, readonly DetectedBox[]> {
  const gt = new Map<string, readonly DetectedBox[]>();
  for (const frame of FRAMES) {
    // Deterministic: two calls on the same frame deep-equal (asserted below).
    gt.set(frame.frameId, DETECTOR.detect(frame));
  }
  return gt;
}

const FALSE_POSITIVE_BOX: NormalizedBox = { x: 0.9, y: 0.02, w: 0.05, h: 0.05 };

interface Degradation {
  predicted: Map<string, readonly DetectedBox[]>;
  droppedFlatIndices: number[];
  jitteredPairs: Array<{ source: NormalizedBox; jittered: NormalizedBox }>;
  falsePositiveFrameIds: string[];
}

/** The deterministic degradation transform (see the file-level docs). */
function degrade(gt: Map<string, readonly DetectedBox[]>): Degradation {
  const predicted = new Map<string, DetectedBox[]>();
  const droppedFlatIndices: number[] = [];
  const jitteredPairs: Array<{ source: NormalizedBox; jittered: NormalizedBox }> = [];
  const falsePositiveFrameIds: string[] = [];

  for (const frame of FRAMES) {
    const frameDetections = gt.get(frame.frameId) ?? [];
    const kept: DetectedBox[] = [];
    for (const [slot, detection] of frameDetections.entries()) {
      const flatIndex = 3 * frame.decodeOrder + slot;
      if (flatIndex % 7 === 6) {
        droppedFlatIndices.push(flatIndex);
        continue;
      }
      if (flatIndex % 3 === 2) {
        const jittered: DetectedBox = {
          ...detection,
          box: {
            x: detection.box.x + 0.02,
            y: detection.box.y - 0.02,
            w: detection.box.w,
            h: detection.box.h,
          },
        };
        jitteredPairs.push({ source: detection.box, jittered: jittered.box });
        kept.push(jittered);
      } else {
        kept.push({ ...detection, box: { ...detection.box } });
      }
    }
    if (frame.decodeOrder % 13 === 12) {
      falsePositiveFrameIds.push(frame.frameId);
      kept.push({ box: FALSE_POSITIVE_BOX, label: "ball", confidence: 0.4 });
    }
    predicted.set(frame.frameId, kept);
  }

  return { predicted, droppedFlatIndices, jitteredPairs, falsePositiveFrameIds };
}

function groundTruthList(gt: Map<string, readonly DetectedBox[]>): LabeledGroundTruth[] {
  return FRAMES.map((frame) => ({
    frameId: frame.frameId,
    boxes: (gt.get(frame.frameId) ?? []).map((d) => ({ box: d.box, label: d.label })),
  }));
}

describe("end-to-end benchmark — 100-frame synthetic scene", () => {
  const gt = groundTruthByFrame();
  const groundTruth = groundTruthList(gt);
  const degradation = degrade(gt);

  test("fixture detector is deterministic across the scene", () => {
    const frame = FRAMES[50]!;
    expect(DETECTOR.detect(frame)).toEqual(DETECTOR.detect(frame));
    const fresh = new FixtureDetectorAdapter(SCENE_SPEC);
    expect(fresh.detect(frame)).toEqual(DETECTOR.detect(frame));
  });

  test("scene sanity: 300 GT boxes, all in normalized range", () => {
    const all = [...gt.values()].flat();
    expect(all).toHaveLength(300);
    for (const detection of all) {
      for (const value of [detection.box.x, detection.box.y, detection.box.w, detection.box.h]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  test("degradation mechanics: 42 drops, 7 FPs, 86 jittered, 265 predictions", () => {
    expect(degradation.droppedFlatIndices).toHaveLength(42);
    expect(degradation.falsePositiveFrameIds).toHaveLength(7);
    expect(degradation.jitteredPairs).toHaveLength(86);
    expect([...degradation.predicted.values()].flat()).toHaveLength(258 + 7);

    // Spot checks (documented in the file header):
    // f=2: flat indices 6,7,8 -> i=6 dropped (slot 0); no FP -> 2 predictions.
    expect(degradation.predicted.get("f-0-2")).toHaveLength(2);
    // f=12: no drop (36,37,38 mod 7 in {1,2,3}); ball jittered; FP added -> 4.
    expect(degradation.predicted.get("f-0-12")).toHaveLength(4);
    // f=90: ball dropped (272 mod 7 = 6); FP added -> 2 players + 1 FP = 3.
    expect(degradation.predicted.get("f-0-90")).toHaveLength(3);
  });

  test("jittered boxes still match: IoU >= 0.5 against their source GT box", () => {
    for (const { source, jittered } of degradation.jitteredPairs) {
      expect(iou(source, jittered)).toBeGreaterThanOrEqual(0.5);
    }
    // Hand-computed: 0.0169 / 0.0281 = 0.6014... for the 0.15-square ball.
    expect(degradation.jitteredPairs).not.toHaveLength(0);
    const { source, jittered } = degradation.jitteredPairs[0]!;
    expect(iou(source, jittered)).toBeCloseTo(0.0169 / 0.0281, 12);
  });

  test("false positives can never match: IoU 0 with every same-label GT box", () => {
    for (const frameId of degradation.falsePositiveFrameIds) {
      const sameLabelGt = (gt.get(frameId) ?? []).filter((d) => d.label === "ball");
      expect(sameLabelGt).not.toHaveLength(0);
      for (const detection of sameLabelGt) {
        expect(iou(detection.box, FALSE_POSITIVE_BOX)).toBe(0);
      }
    }
  });

  test("benchmark report: exact hand-derived counts and metrics", () => {
    const report = runDetectionBenchmark({
      groundTruth,
      predicted: degradation.predicted,
    });

    expect(report.iouThreshold).toBe(0.5);
    expect(report.truePositives).toBe(258);
    expect(report.falsePositives).toBe(7);
    expect(report.falseNegatives).toBe(42);

    // precision = TP / (TP + FP) = 258 / 265
    expect(report.precision).toBeCloseTo(258 / 265, 12);
    // recall = TP / (TP + FN) = 258 / 300 = 0.86
    expect(report.recall).toBeCloseTo(0.86, 12);
    // f1 = 2PR / (P + R)
    const expectedF1 = (2 * (258 / 265) * 0.86) / (258 / 265 + 0.86);
    expect(report.f1).toBeCloseTo(expectedF1, 12);

    // Per-label: player 172 TP / 0 FP / 28 FN.
    expect(report.perLabel.player?.precision).toBe(1);
    expect(report.perLabel.player?.recall).toBeCloseTo(0.86, 12);
    expect(report.perLabel.player?.f1).toBeCloseTo(1.72 / 1.86, 12);

    // Per-label: ball 86 TP / 7 FP / 14 FN.
    expect(report.perLabel.ball?.precision).toBeCloseTo(86 / 93, 12);
    expect(report.perLabel.ball?.recall).toBeCloseTo(0.86, 12);
    const ballF1 = (2 * (86 / 93) * 0.86) / (86 / 93 + 0.86);
    expect(report.perLabel.ball?.f1).toBeCloseTo(ballF1, 12);

    // The brief's recall band holds (0.83-0.88); the precision band cannot
    // (see the BAND NOTE in the file header — 7 FPs cannot move precision
    // below ~0.97 against 258 TPs).
    expect(report.recall).toBeGreaterThanOrEqual(0.83);
    expect(report.recall).toBeLessThanOrEqual(0.88);
  });

  test("benchmark is pure: rebuilding the scene produces a deep-equal report", () => {
    const first = runDetectionBenchmark({
      groundTruth,
      predicted: degradation.predicted,
    });
    const second = runDetectionBenchmark({
      groundTruth: groundTruthList(groundTruthByFrame()),
      predicted: degrade(groundTruthByFrame()).predicted,
    });
    expect(first).toEqual(second);
  });

  test("emits normalized observations for the whole scene (store-compatible)", () => {
    const observations = FRAMES.flatMap((frame) =>
      emitDetectionObservations({
        sessionId: SESSION_ID,
        componentId: DETECTOR_ID,
        frame,
        detections: gt.get(frame.frameId) ?? [],
      }),
    );

    // 3 detections x 100 frames.
    expect(observations).toHaveLength(300);
    // ALL records parse against the contracts Observation schema.
    for (const observation of observations) {
      expect(() => Observation.parse(observation)).not.toThrow();
      expect(validateObservation(observation)).toBe(true);
    }
    // observationId uniqueness across the whole scene.
    expect(new Set(observations.map((o) => o.observationId)).size).toBe(300);
    // Detection-level fields.
    for (const observation of observations) {
      expect(observation.modality).toBe("vision");
      expect(observation.provenance).toBe("OBSERVED");
      expect(observation.componentId).toBe(DETECTOR_ID);
      expect(observation.subjectEntityRefs).toEqual([]);
    }

    // Store compatibility (W201 EMITS; storing is the pipeline's job — the
    // emitted records must still be storable as-is).
    const store = new InMemoryObservationStore();
    for (const observation of observations) {
      expect(store.append(observation)).toBe("appended");
    }
    expect(store.count()).toBe(300);
    const queried = store.query({ sessionId: SESSION_ID, kind: "detection" });
    expect(queried).toHaveLength(300);
    // Canonical eventTimeMs order: frame 0 first (0 ms), frame 99 last (3960 ms).
    expect(queried[0]?.eventTimeMs).toBe(0);
    expect(queried[299]?.eventTimeMs).toBe(99 * FRAME_MS);
  });
});
