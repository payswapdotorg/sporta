/**
 * J012b unit tests: `ContrastContextDetector` — the license-clean
 * production-path candidate. Every test pins a documented contract of the
 * algorithm (surface-agnosticism, the honest gates, determinism, the
 * constructor validation).
 */
import { describe, expect, test } from "bun:test";
import {
  CandidateFailureError,
  CONTRAST_CONTEXT_DETECTOR_FAILURE_CLASSES,
  CONTRAST_CONTEXT_DETECTOR_ID,
  CONTRAST_CONTEXT_DETECTOR_LICENSE,
  ContrastContextDetector,
  SYNTH_BACKGROUND,
  SYNTH_LINE_WHITE,
  SYNTH_PITCH_GREEN,
  SYNTH_WHITE,
  SyntheticFrame,
  defaultBlockSizePx,
  defaultContrastRadiusPx,
  generateDetectionFixture,
  makeDetectorFrameInput,
} from "../src/index";
import type { DetectionFixtureSpec } from "../src/index";

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

describe("ContrastContextDetector (J012 production path)", () => {
  test("detects players on GREEN pitch pixels with contract-shaped boxes", () => {
    const detector = new ContrastContextDetector();
    const frames = generateDetectionFixture(OPEN_PLAY_SPEC);
    for (const { frame, groundTruth } of frames) {
      const detections = detector.detect(frame);
      // Both players found; the white ball and the pitch lines are excluded
      // (lines by the erosion + shape gates, the ball by area).
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
      // Every detection overlaps its ground-truth player.
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

  test("SURFACE-AGNOSTIC: detects the same players on SAND and FILM-GRAY surfaces", () => {
    // The J012 core claim: players are local-contrast outliers on ANY
    // uniform surface. Paint the same two players over (a) beach sand and
    // (b) newsreel gray and require the same two detections.
    const paintScenario = (surface: { r: number; g: number; b: number }): void => {
      const canvas = new SyntheticFrame(160, 120, surface);
      canvas.fillRect(0, 0, 159, 119, surface);
      // Two player blobs, kit colors with real surface contrast.
      canvas.fillRect(40, 40, 51, 59, { r: 180, g: 30, b: 30 });
      canvas.fillRect(100, 55, 111, 74, { r: 30, g: 30, b: 190 });
      const frame = makeDetectorFrameInput({
        bytes: canvas.bytes,
        width: 160,
        height: 120,
        decodeOrder: 0,
        presentationMs: 0,
      });
      const detector = new ContrastContextDetector();
      const detections = detector.detect(frame);
      expect(detections.length).toBe(2);
      for (const detection of detections) {
        expect(detection.confidence).toBeGreaterThan(0);
      }
    };
    paintScenario({ r: 220, g: 200, b: 160 }); // beach sand
    paintScenario({ r: 120, g: 120, b: 120 }); // film gray
  });

  test("a fully-cluttered frame (no dominant surface) REFUSES with the documented class", () => {
    // The off-envelope posture: a frame where every block is dense
    // foreground (a tight crowd shot / clutter pattern) is a REFUSAL that
    // engages the chain's fallback — the ledger records it — never a
    // fabricated empty that would strand the chain.
    const canvas = new SyntheticFrame(160, 120);
    for (let y = 0; y < 120; y += 6) {
      for (let x = 0; x < 160; x += 6) {
        const dark = (Math.floor(x / 6) + Math.floor(y / 6)) % 2 === 0;
        canvas.fillRect(
          x,
          y,
          x + 5,
          y + 5,
          dark ? { r: 40, g: 40, b: 40 } : { r: 240, g: 240, b: 240 },
        );
      }
    }
    const frame = makeDetectorFrameInput({
      bytes: canvas.bytes,
      width: 160,
      height: 120,
      decodeOrder: 0,
      presentationMs: 0,
    });
    const detector = new ContrastContextDetector();
    try {
      detector.detect(frame);
      expect.unreachable("must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(CandidateFailureError);
      expect((error as CandidateFailureError).details.failureClassId).toBe(
        "contrast-context.off-envelope-framing",
      );
    }
  });

  test("a uniform frame yields NO detections (honest empty, no fabrication)", () => {
    const detector = new ContrastContextDetector();
    for (const surface of [SYNTH_PITCH_GREEN, SYNTH_BACKGROUND, { r: 220, g: 200, b: 160 }]) {
      const canvas = new SyntheticFrame(64, 48);
      canvas.fillRect(0, 0, 63, 47, surface);
      const frame = makeDetectorFrameInput({
        bytes: canvas.bytes,
        width: 64,
        height: 48,
        decodeOrder: 0,
        presentationMs: 0,
      });
      expect(detector.detect(frame)).toEqual([]);
    }
  });

  test("a degenerate size or short byte buffer yields NO detections, never a crash", () => {
    const detector = new ContrastContextDetector();
    expect(
      detector.detect({
        frameId: "f",
        presentationMs: 0,
        width: 0,
        height: 0,
        bytes: new Uint8Array(0),
        decodeOrder: 0,
        streamIndex: 0,
      }),
    ).toEqual([]);
    expect(
      detector.detect({
        frameId: "f",
        presentationMs: 0,
        width: 64,
        height: 48,
        bytes: new Uint8Array(10),
        decodeOrder: 0,
        streamIndex: 0,
      }),
    ).toEqual([]);
  });

  test("deterministic on identical inputs (deep-equal, repeated)", () => {
    const detector = new ContrastContextDetector();
    const frames = generateDetectionFixture(OPEN_PLAY_SPEC);
    for (const { frame } of frames) {
      const first = detector.detect(frame);
      const second = detector.detect(frame);
      const third = detector.detect(frame);
      expect(second).toEqual(first);
      expect(third).toEqual(first);
    }
  });

  test("pitch LINES are excluded by the documented gates (erosion + shape)", () => {
    // A marked pitch: white boundary + halfway line, no players.
    const canvas = new SyntheticFrame(160, 120);
    canvas.fillRect(0, 0, 159, 119, SYNTH_PITCH_GREEN);
    canvas.fillRect(0, 0, 159, 2, SYNTH_LINE_WHITE);
    canvas.fillRect(0, 117, 159, 119, SYNTH_LINE_WHITE);
    canvas.fillRect(0, 0, 2, 119, SYNTH_LINE_WHITE);
    canvas.fillRect(157, 0, 159, 119, SYNTH_LINE_WHITE);
    canvas.fillRect(79, 0, 81, 119, SYNTH_LINE_WHITE);
    const frame = makeDetectorFrameInput({
      bytes: canvas.bytes,
      width: 160,
      height: 120,
      decodeOrder: 0,
      presentationMs: 0,
    });
    const detector = new ContrastContextDetector();
    expect(detector.detect(frame)).toEqual([]);
  });

  test("a player-like blob OFF the dominant surface is dropped by the ring gate", () => {
    // Left half: uniform sand (the dominant surface). Right half: high
    // contrast clutter (a "crowd" of alternating blocks). A player blob
    // inside the clutter fails the ring-context gate; the same blob on the
    // sand passes.
    const canvas = new SyntheticFrame(160, 120);
    canvas.fillRect(0, 0, 79, 119, { r: 220, g: 200, b: 160 });
    for (let y = 0; y < 120; y += 6) {
      for (let x = 80; x < 160; x += 6) {
        const dark = (Math.floor(x / 6) + Math.floor(y / 6)) % 2 === 0;
        canvas.fillRect(
          x,
          y,
          x + 5,
          y + 5,
          dark ? { r: 40, g: 40, b: 40 } : { r: 240, g: 240, b: 240 },
        );
      }
    }
    // The same kit blob twice: once on the sand, once deep in the clutter.
    canvas.fillRect(30, 50, 41, 69, { r: 180, g: 30, b: 30 });
    canvas.fillRect(110, 50, 121, 69, { r: 180, g: 30, b: 30 });
    const frame = makeDetectorFrameInput({
      bytes: canvas.bytes,
      width: 160,
      height: 120,
      decodeOrder: 0,
      presentationMs: 0,
    });
    const detector = new ContrastContextDetector();
    const detections = detector.detect(frame);
    // Exactly the on-sand blob survives; the clutter blob is ring-gated.
    expect(detections.length).toBe(1);
    expect(detections[0]!.box.x).toBeLessThan(0.5);
  });

  test("the BALL is excluded by the area gate", () => {
    // One player-sized blob plus a small white ball on green.
    const canvas = new SyntheticFrame(160, 120);
    canvas.fillRect(0, 0, 159, 119, SYNTH_PITCH_GREEN);
    canvas.fillRect(60, 40, 71, 59, { r: 180, g: 30, b: 30 });
    canvas.fillEllipse(120, 90, 4, 4, SYNTH_WHITE);
    const frame = makeDetectorFrameInput({
      bytes: canvas.bytes,
      width: 160,
      height: 120,
      decodeOrder: 0,
      presentationMs: 0,
    });
    const detector = new ContrastContextDetector();
    const detections = detector.detect(frame);
    expect(detections.length).toBe(1);
    // The surviving detection is the player: its box CENTER sits on the
    // player's center column (the ball is at x=120).
    const center = detections[0]!.box.x + detections[0]!.box.w / 2;
    expect(center).toBeGreaterThan(60 / 160);
    expect(center).toBeLessThan(72 / 160);
  });

  test("confidence is compactness x ring fraction — thin rings read lower", () => {
    // A blob at the frame edge has out-of-frame ring positions (counted as
    // NON-surface) → a lower ring fraction and therefore a lower confidence
    // than the same blob mid-surface. (Frame-edge proximity exercises the
    // ring without the window-interaction pathologies of adjacency cases.)
    const build = (blobX0: number): number => {
      const canvas = new SyntheticFrame(160, 120);
      canvas.fillRect(0, 0, 159, 119, { r: 220, g: 200, b: 160 });
      canvas.fillRect(blobX0, 50, blobX0 + 11, 69, { r: 180, g: 30, b: 30 });
      const frame = makeDetectorFrameInput({
        bytes: canvas.bytes,
        width: 160,
        height: 120,
        decodeOrder: 0,
        presentationMs: 0,
      });
      const detector = new ContrastContextDetector();
      const detections = detector.detect(frame);
      expect(detections.length).toBe(1);
      return detections[0]!.confidence;
    };
    const midSurface = build(40);
    const atFrameEdge = build(148); // ring extends past the right frame edge
    expect(midSurface).toBeGreaterThan(0);
    expect(atFrameEdge).toBeGreaterThan(0);
    // Honest monotonicity: the frame-edge blob cannot read MORE confident
    // than the mid-surface one (its ring counts out-of-frame positions).
    expect(atFrameEdge).toBeLessThan(midSurface);
  });

  test("adaptive scale helpers clamp into the documented envelope", () => {
    expect(defaultContrastRadiusPx(640, 360)).toBe(20);
    expect(defaultContrastRadiusPx(160, 120)).toBe(12);
    expect(defaultContrastRadiusPx(64, 48)).toBe(12);
    expect(defaultContrastRadiusPx(1280, 720)).toBe(20);
    expect(defaultBlockSizePx(640, 360)).toBe(18);
    expect(defaultBlockSizePx(160, 120)).toBe(6);
    expect(defaultBlockSizePx(64, 48)).toBe(6);
    expect(defaultBlockSizePx(1280, 720)).toBe(18);
  });

  test("constructor validates the documented gates (fail loud, repo style)", () => {
    expect(() => new ContrastContextDetector({ contrastThreshold: -1 })).toThrow(RangeError);
    expect(() => new ContrastContextDetector({ minBlobArea: 500, maxBlobArea: 10 })).toThrow(
      RangeError,
    );
    expect(() => new ContrastContextDetector({ detectorId: "" })).toThrow(RangeError);
    expect(() => new ContrastContextDetector({ aspectMin: 5, aspectMax: 2 })).toThrow(RangeError);
    expect(() => new ContrastContextDetector({ surfaceMaxForegroundFraction: 1.5 })).toThrow(
      RangeError,
    );
    expect(() => new ContrastContextDetector({ contrastRadiusPx: 0 })).toThrow(RangeError);
    expect(() => new ContrastContextDetector({ blockSizePx: 0 })).toThrow(RangeError);
  });

  test("registry-binding honesty: identity, license, and failure classes", () => {
    const detector = new ContrastContextDetector();
    expect(detector.descriptor.technologyId).toBe(CONTRAST_CONTEXT_DETECTOR_ID);
    expect(detector.descriptor.task).toBe("perception.player-detection");
    // The zero-external-component license record: code component only.
    expect(CONTRAST_CONTEXT_DETECTOR_LICENSE.model).toBeUndefined();
    expect(CONTRAST_CONTEXT_DETECTOR_LICENSE.dataset).toBeUndefined();
    expect(CONTRAST_CONTEXT_DETECTOR_LICENSE.assets).toBeUndefined();
    expect(detector.license).toBe(CONTRAST_CONTEXT_DETECTOR_LICENSE);
    expect(detector.failureClasses).toBe(CONTRAST_CONTEXT_DETECTOR_FAILURE_CLASSES);
    expect(detector.failureClasses.map((f) => f.failureClassId)).toEqual([
      "contrast-context.merged-players",
      "contrast-context.suppressed-low-contrast-kit",
      "contrast-context.off-envelope-framing",
    ]);
    expect(detector.resourceRequirements.gpuRequired).toBe(false);
  });

  test("large figures become boundary RINGS and still detect with the right box", () => {
    // A broadcast-scale close-up (640x360, a 120x180 figure vs the 41x41
    // local-mean window): the interior collapses to the local mean, the
    // boundary stays foreground — the ring-shaped blob must still produce
    // ONE detection with the correct bounding box.
    const canvas = new SyntheticFrame(640, 360);
    canvas.fillRect(0, 0, 639, 359, { r: 220, g: 200, b: 160 });
    canvas.fillRect(240, 80, 359, 259, { r: 25, g: 25, b: 190 });
    const frame = makeDetectorFrameInput({
      bytes: canvas.bytes,
      width: 640,
      height: 360,
      decodeOrder: 0,
      presentationMs: 0,
    });
    const detector = new ContrastContextDetector();
    const detections = detector.detect(frame);
    expect(detections.length).toBe(1);
    expect(detections[0]!.box.w).toBeGreaterThan(100 / 640);
    expect(detections[0]!.box.h).toBeGreaterThan(150 / 360);
  });
});
