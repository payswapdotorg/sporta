import { describe, expect, test } from "bun:test";
import {
  BALL_DETECTION_LABEL,
  BallBlobDetector,
  ColorBlobBallTracker,
  InvalidAdapterInputError,
  NearestBoxBallTrackerAdapter,
  generateBallFixture,
} from "../src/index";
import type { BallFixtureSpec, BallTrack } from "../src/index";

const BALL_SPEC: BallFixtureSpec = {
  specId: "test-ball",
  seed: 91,
  width: 160,
  height: 120,
  frameCount: 10,
  frameIntervalMs: 40,
  flight: { from: { x: 0.2, y: 0.7 }, to: { x: 0.8, y: 0.3 } },
  ballRadiusPx: 3,
  occlusionWindows: [{ fromFrame: 4, toFrame: 6 }],
  clutter: true,
  detectionDegrade: { missProbability: 0, jitter: 0 },
};

describe("BallBlobDetector (ball-detection candidate 1)", () => {
  test("finds the ball on visible frames, ball-label only, and refuses nothing on occluded frames", () => {
    const detector = new BallBlobDetector();
    const frames = generateBallFixture(BALL_SPEC);
    let visibleFrames = 0;
    let detectedOnVisible = 0;
    for (const { frame, gt } of frames) {
      const detections = detector.detect(frame);
      for (const detection of detections) {
        expect(detection.label).toBe(BALL_DETECTION_LABEL);
      }
      if (gt !== null && gt.visible) {
        visibleFrames += 1;
        if (detections.length >= 1) detectedOnVisible += 1;
        if (detections.length >= 1) {
          const box = detections[0]!.box;
          const dx = box.x + box.w / 2 - gt.center.x;
          const dy = box.y + box.h / 2 - gt.center.y;
          expect(Math.hypot(dx, dy)).toBeLessThan(0.05);
        }
      }
    }
    // The clutter lines are rejected; the visible ball is found on most
    // frames (frames where the ball overlaps a line can merge — honest).
    expect(detectedOnVisible).toBeGreaterThanOrEqual(visibleFrames - 2);
  });

  test("deterministic on identical frames", () => {
    const detector = new BallBlobDetector();
    const frames = generateBallFixture(BALL_SPEC);
    for (const { frame } of frames) {
      expect(detector.detect(frame)).toEqual(detector.detect(frame));
    }
  });
});

describe("both ball-tracking candidates conform (R204)", () => {
  const candidates = [
    ["nearest-box-ball-tracker", () => new NearestBoxBallTrackerAdapter()],
    ["color-blob-ball-tracker", () => new ColorBlobBallTracker()],
  ] as const;

  for (const [name, construct] of candidates) {
    test(`${name}: emits W202-shaped BallTracks with honest edges`, () => {
      const adapter = construct();
      const frames = generateBallFixture(BALL_SPEC);
      const sequence = frames.map(({ frame, detection }) => ({
        frame,
        detections: detection !== null ? [detection] : [],
      }));
      const tracks: BallTrack[] = adapter.track(sequence);
      expect(tracks.length).toBeGreaterThanOrEqual(1);
      for (const track of tracks) {
        expect(track.trackId).toMatch(/^bt-\d+-\d+$/);
        // Tracks start and end on OBSERVED boxes (never extrapolated).
        expect(track.points[0]!.source).toBe("detected");
        expect(track.points[track.points.length - 1]!.source).toBe("detected");
        for (const point of track.points) {
          expect(point.source === "detected" || point.source === "interpolated").toBe(true);
          expect(point.confidence).toBeGreaterThan(0);
          expect(point.confidence).toBeLessThanOrEqual(1);
        }
        // Presentation ordering holds.
        const times = track.points.map((point) => point.presentationMs);
        expect([...times].sort((a, b) => a - b)).toEqual(times);
      }
    });

    test(`${name}: the short occlusion is bridged with DISCOUNTED confidence`, () => {
      const adapter = construct();
      const frames = generateBallFixture(BALL_SPEC);
      const sequence = frames.map(({ frame, detection }) => ({
        frame,
        detections: detection !== null ? [detection] : [],
      }));
      const tracks = adapter.track(sequence);
      const bridged = tracks.some((track) => track.occlusionGaps.some((gap) => gap.bridged));
      expect(bridged).toBe(true);
      for (const track of tracks) {
        for (const point of track.points) {
          if (point.source === "interpolated") {
            // Discounted: strictly below the fixture's 0.9 detection confidence.
            expect(point.confidence).toBeLessThan(0.9);
          }
        }
      }
    });

    test(`${name}: malformed input is refused loudly`, () => {
      const adapter = construct();
      const frames = generateBallFixture(BALL_SPEC);
      const sequence = frames.map(({ frame, detection }) => ({
        frame,
        detections: detection !== null ? [detection] : [],
      }));
      const outOfOrder = [sequence[1]!, sequence[0]!];
      expect(() => adapter.track(outOfOrder)).toThrow(InvalidAdapterInputError);
    });

    test(`${name}: deterministic — two runs deep-equal`, () => {
      const adapter = construct();
      const frames = generateBallFixture(BALL_SPEC);
      const sequence = frames.map(({ frame, detection }) => ({
        frame,
        detections: detection !== null ? [detection] : [],
      }));
      expect(adapter.track(sequence)).toEqual(adapter.track(sequence));
    });
  }
});

describe("the two ball-tracking candidates are materially different (R204 acceptance)", () => {
  test("the color-blob candidate ignores the annotation stream (pixel evidence only)", () => {
    const frames = generateBallFixture(BALL_SPEC);
    // Give the trackers a POISONED annotation stream: detections pointing
    // somewhere the ball never is. The nearest-box candidate follows them;
    // the color-blob candidate's tracks are unchanged by the poison.
    const poisoned = frames.map(({ frame }) => ({
      frame,
      detections: [
        {
          box: { x: 0.02, y: 0.02, w: 0.05, h: 0.05 },
          label: "ball",
          confidence: 0.9,
        },
      ],
    }));
    const clean = frames.map(({ frame, detection }) => ({
      frame,
      detections: detection !== null ? [detection] : [],
    }));
    const blob = new ColorBlobBallTracker();
    expect(blob.track(poisoned)).toEqual(blob.track(clean));
    const nearest = new NearestBoxBallTrackerAdapter();
    expect(nearest.track(poisoned)).not.toEqual(nearest.track(clean));
  });
});
