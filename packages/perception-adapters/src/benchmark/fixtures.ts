/**
 * Synthetic-diagnostic benchmark fixtures (R201-R206) — the PROCEDURAL
 * generators behind the committed JSON scenario specs under `fixtures/`.
 *
 * HONESTY BOUNDARY (stated once, applying to every fixture this module can
 * generate): these are SYNTHETIC-DIAGNOSTIC sequences — flat-colored rgb24
 * rasters painted deterministically from a spec, with exact ground truth by
 * construction. They are NOT real video. They exist so the benchmark
 * modules can measure candidate behavior end-to-end BEFORE any real-media
 * fixture set exists; quality numbers against them are diagnostic of the
 * ALGORITHMS, not of production accuracy.
 *
 * Determinism: painting order is fixed (background, grass, lines, blobs,
 * ball), all scenario randomness (jitter, misses) draws from the SEEDED
 * `createRng` with the spec's seed, and there is no clock and no I/O beyond
 * reading the committed spec files. Same spec in, deep-equal fixture out.
 */
import { createRng } from "@sporta/testing";
import type { EntityId } from "@sporta/contracts";
import { PITCH_LENGTH_AXIS_METERS, PITCH_WIDTH_AXIS_METERS } from "@sporta/contracts";
import type { DetectedBox, DetectorFrameInput, NormalizedBox } from "@sporta/perception-detection";
import type { TrackedBox } from "@sporta/perception-tracking";
import type { FieldCornerSet, Homography } from "@sporta/field-mapping";
import {
  SYNTH_BACKGROUND,
  SYNTH_LINE_WHITE,
  SYNTH_PITCH_GREEN,
  SYNTH_WHITE,
  SyntheticFrame,
  makeDetectorFrameInput,
} from "../synth";
import type { Rgb } from "../pixels";

/** The fixture-set version every committed scenario spec belongs to. */
export const FIXTURE_SET_VERSION = "perception-adapters.synthetic-diagnostic@1";

/** A 2D point in normalized image coordinates. */
export interface FixturePoint {
  readonly x: number;
  readonly y: number;
}

/** Linear-motion interpolation `from + (to - from) * t`. */
function lerpPoint(from: FixturePoint, to: FixturePoint, t: number): FixturePoint {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** Center-based clamped box (the W201 fixture convention). */
function boxFromCenter(center: FixturePoint, w: number, h: number): NormalizedBox {
  const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
  const left = clamp01(center.x - w / 2);
  const right = clamp01(center.x + w / 2);
  const top = clamp01(center.y - h / 2);
  const bottom = clamp01(center.y + h / 2);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

// ---------------------------------------------------------------------------
// Detection / tracking fixtures
// ---------------------------------------------------------------------------

/** One fixture player: identity, kit color, motion, size. */
export interface FixturePlayerSpec {
  readonly gtId: string;
  readonly jersey: Rgb;
  readonly from: FixturePoint;
  readonly to: FixturePoint;
  readonly boxW: number;
  readonly boxH: number;
}

/** One detection scenario spec (the committed JSON shape). */
export interface DetectionFixtureSpec {
  readonly specId: string;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly frameIntervalMs: number;
  readonly players: readonly FixturePlayerSpec[];
  readonly ball: { from: FixturePoint; to: FixturePoint; radiusPx: number } | null;
  readonly paintPitchLines: boolean;
}

/** One generated frame with its ground-truth player boxes. */
export interface DetectionFixtureFrame {
  readonly frame: DetectorFrameInput;
  readonly groundTruth: readonly { gtId: string; box: NormalizedBox }[];
}

/**
 * Generates the detection fixture frames for a spec: a full-frame green
 * pitch (broadcast close-up convention), optional white pitch lines
 * (clutter the detectors must reject), moving kit-colored player blobs,
 * and an optional white ball. Ground truth = the players' clamped boxes.
 */
export function generateDetectionFixture(
  spec: DetectionFixtureSpec,
): readonly DetectionFixtureFrame[] {
  const frames: DetectionFixtureFrame[] = [];
  for (let frameIndex = 0; frameIndex < spec.frameCount; frameIndex += 1) {
    const t = spec.frameCount > 1 ? frameIndex / (spec.frameCount - 1) : 0;
    const canvas = new SyntheticFrame(spec.width, spec.height, SYNTH_BACKGROUND);
    canvas.fillRect(0, 0, spec.width - 1, spec.height - 1, SYNTH_PITCH_GREEN);
    if (spec.paintPitchLines) {
      // Clutter lines: two vertical, two horizontal, 2px thick.
      for (const u of [0.25, 0.75]) {
        const column = Math.round(u * (spec.width - 1));
        canvas.fillRect(column - 1, 0, column + 1, spec.height - 1, SYNTH_LINE_WHITE);
      }
      for (const v of [0.2, 0.8]) {
        const row = Math.round(v * (spec.height - 1));
        canvas.fillRect(0, row - 1, spec.width - 1, row + 1, SYNTH_LINE_WHITE);
      }
    }
    const groundTruth: Array<{ gtId: string; box: NormalizedBox }> = [];
    for (const player of spec.players) {
      const center = lerpPoint(player.from, player.to, t);
      const box = boxFromCenter(center, player.boxW, player.boxH);
      groundTruth.push({ gtId: player.gtId, box });
      const x0 = Math.round(box.x * spec.width);
      const x1 = Math.round((box.x + box.w) * spec.width) - 1;
      const y0 = Math.round(box.y * spec.height);
      const y1 = Math.round((box.y + box.h) * spec.height) - 1;
      canvas.fillRect(x0, y0, x1, y1, player.jersey);
    }
    if (spec.ball !== null) {
      const center = lerpPoint(spec.ball.from, spec.ball.to, t);
      canvas.fillEllipse(
        center.x * spec.width,
        center.y * spec.height,
        spec.ball.radiusPx,
        spec.ball.radiusPx,
        SYNTH_WHITE,
      );
    }
    frames.push({
      frame: makeDetectorFrameInput({
        bytes: canvas.bytes,
        width: spec.width,
        height: spec.height,
        decodeOrder: frameIndex,
        presentationMs: frameIndex * spec.frameIntervalMs,
      }),
      groundTruth,
    });
  }
  return frames;
}

/** Degrade options for deriving a (detection-sequence) tracker input from gt. */
export interface TrackingDegradeSpec {
  /** Per-frame per-player miss probability (seeded draw). */
  readonly missProbability: number;
  /** Maximum box-center jitter in normalized units (seeded draw). */
  readonly jitter: number;
}

/** One tracking scenario spec (detection spec + identity-relevant degrade). */
export interface TrackingFixtureSpec extends DetectionFixtureSpec {
  readonly degrade: TrackingDegradeSpec;
}

/**
 * Derives the tracker input (a detection sequence) from the fixture's ground
 * truth with SEEDED degradation: per frame and player, the detection is
 * dropped with `missProbability` and otherwise jittered by up to `jitter`
 * (uniform draw per axis, sign from the draw). Confidence is a fixed 0.9
 * (the fixture convention — the benchmark measures association, not
 * detection confidence). Deterministic for a fixed spec seed.
 */
export function detectionSequenceFromFixture(
  frames: readonly DetectionFixtureFrame[],
  degrade: TrackingDegradeSpec,
  seed: number,
): readonly { frame: DetectorFrameInput; detections: readonly DetectedBox[] }[] {
  const rng = createRng(seed);
  return frames.map(({ frame, groundTruth }) => {
    const detections: DetectedBox[] = [];
    for (const gt of groundTruth) {
      if (rng() < degrade.missProbability) continue;
      const dx = (rng() * 2 - 1) * degrade.jitter;
      const dy = (rng() * 2 - 1) * degrade.jitter;
      detections.push({
        box: boxFromCenter(
          { x: gt.box.x + gt.box.w / 2 + dx, y: gt.box.y + gt.box.h / 2 + dy },
          gt.box.w,
          gt.box.h,
        ),
        label: "player",
        confidence: 0.9,
      });
    }
    return { frame, detections };
  });
}

// ---------------------------------------------------------------------------
// Ball fixtures
// ---------------------------------------------------------------------------

/** One ball scenario spec (the committed JSON shape). */
export interface BallFixtureSpec {
  readonly specId: string;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly frameIntervalMs: number;
  /** Linear flight of the ball CENTER in normalized coordinates. */
  readonly flight: { from: FixturePoint; to: FixturePoint };
  /** Ball radius in pixels. */
  readonly ballRadiusPx: number;
  /** Occlusion windows: frames in [fromFrame, toFrame) render NO ball. */
  readonly occlusionWindows: readonly { fromFrame: number; toFrame: number }[];
  /** Paint pitch lines (white clutter for pixel-space candidates). */
  readonly clutter: boolean;
  /** Detection degrade for the detection-driven candidate. */
  readonly detectionDegrade: TrackingDegradeSpec;
}

/** One generated ball fixture frame. */
export interface BallFixtureFrame {
  readonly frame: DetectorFrameInput;
  /** The ball's true center this frame (null when out of frame), + visible. */
  readonly gt: { center: FixturePoint; visible: boolean } | null;
  /** The degraded detection (null when missed or occluded). */
  readonly detection: DetectedBox | null;
}

/**
 * Generates the ball fixture frames: green pitch, optional clutter lines,
 * a white ball on a linear flight with occlusion windows, plus the degraded
 * detection stream (label "ball", fixed 0.9 confidence, seeded miss/jitter
 * degrade applied ONLY on visible frames). Deterministic for a fixed seed.
 */
export function generateBallFixture(spec: BallFixtureSpec): readonly BallFixtureFrame[] {
  const rng = createRng(spec.seed);
  const frames: BallFixtureFrame[] = [];
  for (let frameIndex = 0; frameIndex < spec.frameCount; frameIndex += 1) {
    const t = spec.frameCount > 1 ? frameIndex / (spec.frameCount - 1) : 0;
    const center = lerpPoint(spec.flight.from, spec.flight.to, t);
    const visible =
      center.x >= 0 &&
      center.x <= 1 &&
      center.y >= 0 &&
      center.y <= 1 &&
      !spec.occlusionWindows.some(
        (window) => frameIndex >= window.fromFrame && frameIndex < window.toFrame,
      );
    const canvas = new SyntheticFrame(spec.width, spec.height, SYNTH_BACKGROUND);
    canvas.fillRect(0, 0, spec.width - 1, spec.height - 1, SYNTH_PITCH_GREEN);
    if (spec.clutter) {
      for (const u of [0.25, 0.75]) {
        const column = Math.round(u * (spec.width - 1));
        canvas.fillRect(column - 1, 0, column + 1, spec.height - 1, SYNTH_LINE_WHITE);
      }
      for (const v of [0.2, 0.8]) {
        const row = Math.round(v * (spec.height - 1));
        canvas.fillRect(0, row - 1, spec.width - 1, row + 1, SYNTH_LINE_WHITE);
      }
    }
    if (visible) {
      canvas.fillEllipse(
        center.x * spec.width,
        center.y * spec.height,
        spec.ballRadiusPx,
        spec.ballRadiusPx,
        SYNTH_WHITE,
      );
    }
    let detection: DetectedBox | null = null;
    if (visible && rng() >= spec.detectionDegrade.missProbability) {
      const dx = (rng() * 2 - 1) * spec.detectionDegrade.jitter;
      const dy = (rng() * 2 - 1) * spec.detectionDegrade.jitter;
      const size = (2 * spec.ballRadiusPx + 2) / spec.width;
      const sizeH = (2 * spec.ballRadiusPx + 2) / spec.height;
      detection = {
        box: boxFromCenter(
          {
            x: center.x + dx * spec.detectionDegrade.jitter,
            y: center.y + dy * spec.detectionDegrade.jitter,
          },
          size,
          sizeH,
        ),
        label: "ball",
        confidence: 0.9,
      };
    }
    frames.push({
      frame: makeDetectorFrameInput({
        bytes: canvas.bytes,
        width: spec.width,
        height: spec.height,
        decodeOrder: frameIndex,
        presentationMs: frameIndex * spec.frameIntervalMs,
      }),
      gt: { center, visible },
      detection,
    });
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Calibration fixtures
// ---------------------------------------------------------------------------

/** One calibration scenario spec (the committed JSON shape). */
export interface CalibrationFixtureSpec {
  readonly specId: string;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly frameIntervalMs: number;
  /**
   * The TRUE pitch window visible in the frame (meters; the affine camera):
   * image u = (X - x0) / visLength, v = (Y - y0) / visWidth. Out-of-play
   * margins (x0 < 0, x0 + visLength > 105, ...) put the boundary LINES
   * inside the frame; a zoomed window can exclude them.
   */
  readonly window: {
    x0: number;
    visLength: number;
    y0: number;
    visWidth: number;
  };
  /** What the scenario demonstrates for the line-based candidate. */
  readonly expectedOutcome: "solved" | "refused-insufficient-lines" | "ambiguous-two-line";
}

/** One generated calibration fixture frame. */
export interface CalibrationFixtureFrame {
  readonly frame: DetectorFrameInput;
  /** The TRUE image -> pitch homography (affine; canonical h[8] = 1). */
  readonly gtHomography: Homography;
  /** The TRUE corner set (the baseline candidate's correspondence input). */
  readonly gtCornerSet: FieldCornerSet;
}

/**
 * Generates the calibration fixture frames: full-frame green grass
 * (out-of-play grass surrounds the pitch — the white LINES delimit it, as
 * in a real broadcast view), the pitch line family {x = 0, 52.5, 105} and
 * {y = 0, 68} painted wherever they project INSIDE the frame (2px thick).
 * The true homography and canonical corner set travel with every frame.
 * Deterministic.
 */
export function generateCalibrationFixture(
  spec: CalibrationFixtureSpec,
): readonly CalibrationFixtureFrame[] {
  const frames: CalibrationFixtureFrame[] = [];
  const { x0, visLength, y0, visWidth } = spec.window;
  const uOf = (X: number): number => (X - x0) / visLength;
  const vOf = (Y: number): number => (Y - y0) / visWidth;
  const gtHomography: Homography = [visLength, 0, x0, 0, visWidth, y0, 0, 0, 1];
  const gtCornerSet: FieldCornerSet = {
    corners: [
      { x: uOf(0), y: vOf(0) },
      { x: uOf(PITCH_LENGTH_AXIS_METERS), y: vOf(0) },
      { x: uOf(PITCH_LENGTH_AXIS_METERS), y: vOf(PITCH_WIDTH_AXIS_METERS) },
      { x: uOf(0), y: vOf(PITCH_WIDTH_AXIS_METERS) },
    ],
    cornerOrder: "tl, tr, br, bl",
    confidence: 0.9,
  };
  for (let frameIndex = 0; frameIndex < spec.frameCount; frameIndex += 1) {
    const canvas = new SyntheticFrame(spec.width, spec.height, SYNTH_BACKGROUND);
    canvas.fillRect(0, 0, spec.width - 1, spec.height - 1, SYNTH_PITCH_GREEN);
    // Vertical line family: painted only where inside the frame, spanning
    // the pitch's vertical extent (the touchlines' span).
    const vTop = Math.max(0, vOf(0));
    const vBottom = Math.min(1, vOf(PITCH_WIDTH_AXIS_METERS));
    for (const X of [0, PITCH_LENGTH_AXIS_METERS / 2, PITCH_LENGTH_AXIS_METERS]) {
      const u = uOf(X);
      if (u < 0 || u > 1) continue;
      const column = Math.round(u * (spec.width - 1));
      const rowTop = Math.round(vTop * (spec.height - 1));
      const rowBottom = Math.round(vBottom * (spec.height - 1));
      canvas.fillRect(column - 1, rowTop, column + 1, rowBottom, SYNTH_LINE_WHITE);
    }
    const uLeft = Math.max(0, uOf(0));
    const uRight = Math.min(1, uOf(PITCH_LENGTH_AXIS_METERS));
    for (const Y of [0, PITCH_WIDTH_AXIS_METERS]) {
      const v = vOf(Y);
      if (v < 0 || v > 1) continue;
      const row = Math.round(v * (spec.height - 1));
      const colLeft = Math.round(uLeft * (spec.width - 1));
      const colRight = Math.round(uRight * (spec.width - 1));
      canvas.fillRect(colLeft, row - 1, colRight, row + 1, SYNTH_LINE_WHITE);
    }
    frames.push({
      frame: makeDetectorFrameInput({
        bytes: canvas.bytes,
        width: spec.width,
        height: spec.height,
        decodeOrder: frameIndex,
        presentationMs: frameIndex * spec.frameIntervalMs,
      }),
      gtHomography,
      gtCornerSet,
    });
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Team fixtures
// ---------------------------------------------------------------------------

/** One fixture tracked player: identity, team, kit, motion, size, visibility. */
export interface TeamPlayerSpec {
  readonly trackId: string;
  /** Ground-truth team; keeper/low-signal are EXPECTED-unknown honestly. */
  readonly team: "home" | "away" | "keeper" | "low-signal";
  readonly jersey: Rgb;
  readonly from: FixturePoint;
  readonly to: FixturePoint;
  readonly boxW: number;
  readonly boxH: number;
  /** Visibility window in frames (inclusive; default: all frames). */
  readonly visibleFromFrame?: number;
  readonly visibleToFrame?: number;
}

/** One team scenario spec (the committed JSON shape). */
export interface TeamFixtureSpec {
  readonly specId: string;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly frameIntervalMs: number;
  readonly players: readonly TeamPlayerSpec[];
}

/** One generated team fixture frame. */
export interface TeamFixtureFrame {
  readonly frame: DetectorFrameInput;
  /** Perfect upstream tracking: the visible players' gt boxes with ids. */
  readonly tracked: readonly TrackedBox[];
}

/**
 * Generates the team fixture frames: green pitch, moving kit-colored player
 * blobs, and — as the family input — PERFECT upstream tracked boxes (the
 * family under test is team identity, not tracking; the benchmark isolates
 * the seam). Ground-truth teams travel with the spec (`expectedTeams`).
 * Deterministic.
 */
export function generateTeamFixture(spec: TeamFixtureSpec): readonly TeamFixtureFrame[] {
  const frames: TeamFixtureFrame[] = [];
  for (let frameIndex = 0; frameIndex < spec.frameCount; frameIndex += 1) {
    const t = spec.frameCount > 1 ? frameIndex / (spec.frameCount - 1) : 0;
    const canvas = new SyntheticFrame(spec.width, spec.height, SYNTH_BACKGROUND);
    canvas.fillRect(0, 0, spec.width - 1, spec.height - 1, SYNTH_PITCH_GREEN);
    const tracked: TrackedBox[] = [];
    for (const player of spec.players) {
      const from = player.visibleFromFrame ?? 0;
      const to = player.visibleToFrame ?? spec.frameCount - 1;
      if (frameIndex < from || frameIndex > to) continue;
      const center = lerpPoint(player.from, player.to, t);
      const box = boxFromCenter(center, player.boxW, player.boxH);
      const x0 = Math.round(box.x * spec.width);
      const x1 = Math.round((box.x + box.w) * spec.width) - 1;
      const y0 = Math.round(box.y * spec.height);
      const y1 = Math.round((box.y + box.h) * spec.height) - 1;
      canvas.fillRect(x0, y0, x1, y1, player.jersey);
      tracked.push({
        box,
        label: "player",
        confidence: 0.9,
        trackId: player.trackId as EntityId,
      });
    }
    frames.push({
      frame: makeDetectorFrameInput({
        bytes: canvas.bytes,
        width: spec.width,
        height: spec.height,
        decodeOrder: frameIndex,
        presentationMs: frameIndex * spec.frameIntervalMs,
      }),
      tracked,
    });
  }
  return frames;
}
