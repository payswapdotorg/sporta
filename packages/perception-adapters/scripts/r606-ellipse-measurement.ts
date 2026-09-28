/**
 * R606 ellipse/circle-constrained calibration — MACHINE MEASUREMENT DRIVER
 * (DEVELOPMENT-TIME EVIDENCE, not a test).
 *
 * Measures BOTH calibration paths of `BroadcastLineCalibrator` v0.2.0 on
 * bounded frame samples of the committed REAL corpus
 * (`scripts/evidence/spr-corpus-bytes/`, sha-256-verified against
 * `scripts/evidence/spr-wave2-corpus/corpus.json` at startup — the frozen
 * substrate contract):
 *  - (a) the v0.1.0-equivalent LINE-ONLY path (`ellipseConstrained: false`)
 *  - (b) the v0.2.0 ELLIPSE-CONSTRAINED path (default)
 * per window (multi-frame, the pipeline's real mode) AND per sampled frame
 * (single-frame diagnostics), recording calibrated/refused, confidence,
 * the failure class + measured numbers on refusals, and the fit metrics
 * (lineFit / backward chamfer / ellipse residual) on calibrations.
 *
 * The driver shells out to ffmpeg ONLY for frame extraction (measurement
 * infrastructure); the solve itself is pure deterministic computation.
 *
 * Outputs (into scripts/evidence/r606-ellipse-constrained/):
 *  - measurement.json   — the full per-window / per-frame / aggregate record
 *    (calibrations carry the solved homography for the overlays)
 *  - frames/<window>.rgb — the anchor frame (raw rgb24) for the overlays
 *
 * Overlays: render_overlays.py (python + cv2, same directory) reads the
 * JSON + raw frames and draws the fitted ellipse + the solved pitch grids.
 *
 * Run: cd packages/perception-adapters && bun run scripts/r606-ellipse-measurement.ts
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  BroadcastLineCalibrator,
  evaluateBroadcastLineFit,
  fitBroadcastEllipseEvidence,
} from "../src/calibration/broadcast-line";
import { makeDetectorFrameInput } from "../src/index";
import type { DetectorFrameInput } from "../src/index";
import { CandidateFailureError } from "../src/errors";

// ---------------------------------------------------------------------------
// The frozen substrate (sha-256 verified at startup).
// ---------------------------------------------------------------------------

const WIDTH = 640;
const HEIGHT = 360;
const BYTES_PER_FRAME = WIDTH * HEIGHT * 3;

interface ClipSpec {
  readonly clipId: string;
  readonly file: string;
  readonly sha256: string;
  readonly mediaTimeStartSec: number;
  readonly frameCount: number;
}

const CORPUS_DIR = path.resolve(
  import.meta.dir,
  "../../../scripts/evidence/spr-corpus-bytes",
);
const EVIDENCE_DIR = path.resolve(
  import.meta.dir,
  "../../../scripts/evidence/r606-ellipse-constrained",
);
const FRAMES_DIR = path.join(EVIDENCE_DIR, "frames");

const CLIPS: readonly ClipSpec[] = [
  {
    clipId: "sprclip-b8-inplay-original",
    file: "b8p3.mp4",
    sha256: "969af7c6fdb172091ff00705b25fa37b7073f4332d722416b9754a4a7579917a",
    mediaTimeStartSec: 1803.84,
    frameCount: 1190,
  },
  {
    clipId: "sprclip-b1-wide-broadcast",
    file: "clip-b1-wide-broadcast.mp4",
    sha256: "3a3c249ef351aaffca5c23fde0aa7efceb920c3d40a0b0a1b317e24fc7c01307",
    mediaTimeStartSec: 1803.84,
    frameCount: 751,
  },
  {
    clipId: "clip-b3-fast-action",
    file: "clip-b3-fast-action.mp4",
    sha256: "f88e3bd5f88f047bf1ef1d5515dc7d7ee19a680c2bc2050d51385f7589e00aeb",
    mediaTimeStartSec: 2046.0,
    frameCount: 300,
  },
  {
    clipId: "clip-b5-camera-move",
    file: "clip-b5-camera-move.mp4",
    sha256: "349a37eeb7fc1374ed8179804fe7ad4888f66a3d9748246e80fdfba30318593a",
    mediaTimeStartSec: 1987.0,
    frameCount: 300,
  },
];

// ---------------------------------------------------------------------------
// The measurement windows (~6 sampled frames each, bounded; b8p3 windows
// avoid the recorded cut frames 189/475/550/862/979/982; b1's first window
// duplicates b8p3's content byte-for-byte — recorded as a cross-clip
// determinism check, not an independent sample).
// ---------------------------------------------------------------------------

interface WindowSpec {
  readonly id: string;
  readonly clipId: string;
  readonly firstFrame: number;
  readonly stride: number;
  readonly count: number;
}

const WINDOWS: readonly WindowSpec[] = [
  // v0.1.0 calibrates (the non-degradation sample).
  { id: "b8p3-c", clipId: "sprclip-b8-inplay-original", firstFrame: 600, stride: 20, count: 6 },
  { id: "b8p3-d", clipId: "sprclip-b8-inplay-original", firstFrame: 1040, stride: 20, count: 6 },
  // Panning cameras (both paths refuse identically).
  { id: "b8p3-a", clipId: "sprclip-b8-inplay-original", firstFrame: 40, stride: 20, count: 6 },
  // The arc-window class (v0.1.0 refuses): the ellipse path's evidence
  // spectrum — quota fails, quota passes + validation near-miss, quota
  // passes + validation far.
  { id: "b8p3-b", clipId: "sprclip-b8-inplay-original", firstFrame: 220, stride: 20, count: 6 },
  { id: "b8p3-e", clipId: "sprclip-b8-inplay-original", firstFrame: 245, stride: 20, count: 6 },
  { id: "b8p3-f", clipId: "sprclip-b8-inplay-original", firstFrame: 270, stride: 20, count: 6 },
  { id: "b8p3-g", clipId: "sprclip-b8-inplay-original", firstFrame: 295, stride: 20, count: 6 },
  { id: "b3-a", clipId: "clip-b3-fast-action", firstFrame: 20, stride: 20, count: 6 },
  { id: "b5-a", clipId: "clip-b5-camera-move", firstFrame: 20, stride: 20, count: 6 },
  { id: "b5-b", clipId: "clip-b5-camera-move", firstFrame: 120, stride: 20, count: 6 },
  // Cross-clip determinism checks: b1 is a byte-exact prefix of b8p3, so
  // b1@40 ≡ b8p3@40 and b1@245 ≡ b8p3@245 must produce IDENTICAL records.
  { id: "b1-a", clipId: "sprclip-b1-wide-broadcast", firstFrame: 40, stride: 20, count: 6 },
  { id: "b1-b", clipId: "sprclip-b1-wide-broadcast", firstFrame: 245, stride: 20, count: 6 },
];

// ---------------------------------------------------------------------------
// Frame extraction (ffmpeg rawvideo rgb24; exact frame numbers via select).
// ---------------------------------------------------------------------------

function extractFrames(clipPath: string, frameNumbers: readonly number[]): Promise<Uint8Array[]> {
  const select = frameNumbers.map((n) => `eq(n,${n})`).join("+");
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      clipPath,
      "-vf",
      `select='${select}'`,
      "-vsync",
      "0",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ]);
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 400)}`));
        return;
      }
      const buffer = Buffer.concat(chunks);
      const frames: Uint8Array[] = [];
      for (let i = 0; i < frameNumbers.length; i += 1) {
        const start = i * BYTES_PER_FRAME;
        if (start + BYTES_PER_FRAME > buffer.length) {
          reject(new Error(`ffmpeg produced ${buffer.length} bytes, expected ${frameNumbers.length * BYTES_PER_FRAME}`));
          return;
        }
        frames.push(new Uint8Array(buffer.subarray(start, start + BYTES_PER_FRAME)));
      }
      resolve(frames);
    });
  });
}

// ---------------------------------------------------------------------------
// The measurement.
// ---------------------------------------------------------------------------

type Outcome =
  | { kind: "calibrated"; confidence: number; correspondenceCount: number; metrics: Record<string, unknown> }
  | { kind: "refused"; failureClassId: string; details: Record<string, unknown> };

function measurePath(
  frames: readonly DetectorFrameInput[],
  ellipseConstrained: boolean,
  ellipseMultiConicSelection?: boolean,
): Outcome {
  const calibrator = new BroadcastLineCalibrator({
    ellipseConstrained,
    ...(ellipseMultiConicSelection !== undefined ? { ellipseMultiConicSelection } : {}),
  });
  try {
    const result = calibrator.calibrate({ frames: [...frames] });
    const metrics = evaluateBroadcastLineFit({ frames: [...frames] }, result.homography);
    return {
      kind: "calibrated",
      confidence: result.confidence,
      correspondenceCount: result.correspondenceCount,
      // The solved matrix rides the record so the overlay renderer can
      // draw the grid (and any reader can re-verify the metrics).
      homography: result.homography,
      metrics: {
        lineFit: metrics.lineFit,
        backwardPx: metrics.backwardPx,
        scoredPixels: metrics.scoredPixels,
        ...(metrics.ellipseMeanPx !== undefined
          ? { ellipseMeanPx: metrics.ellipseMeanPx }
          : {}),
        ...(metrics.ellipseSupportPx !== undefined
          ? { ellipseSupportPx: metrics.ellipseSupportPx }
          : {}),
        ...(metrics.ellipseCoverageBins !== undefined
          ? { ellipseCoverageBins: metrics.ellipseCoverageBins }
          : {}),
      },
    };
  } catch (error) {
    if (error instanceof CandidateFailureError) {
      return {
        kind: "refused",
        failureClassId: error.details.failureClassId as string,
        details: error.details as Record<string, unknown>,
      };
    }
    throw error;
  }
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (v === undefined ? null : v)),
  );
}

async function main(): Promise<void> {
  // -- 0. Verify the frozen substrate. -------------------------------------
  for (const clip of CLIPS) {
    const clipPath = path.join(CORPUS_DIR, clip.file);
    if (!existsSync(clipPath)) {
      throw new Error(`missing corpus file: ${clipPath}`);
    }
    const sha256 = createHash("sha256").update(readFileSync(clipPath)).digest("hex");
    if (sha256 !== clip.sha256) {
      throw new Error(
        `sha-256 mismatch for ${clip.file}: got ${sha256}, expected ${clip.sha256} — the frozen substrate contract is violated; refusing to measure`,
      );
    }
  }
  console.log("corpus sha-256 verified: 4/4 clips byte-exact");

  mkdirSync(FRAMES_DIR, { recursive: true });

  const record = {
    schemaVersion: "1.0",
    driver: "packages/perception-adapters/scripts/r606-ellipse-measurement.ts",
    substrateVerification: CLIPS.map((clip) => ({
      clipId: clip.clipId,
      file: clip.file,
      sha256: clip.sha256,
      verified: true,
    })),
    paths: {
      v010LineOnly: "BroadcastLineCalibrator({ ellipseConstrained: false }) — the v0.1.0 behavior surface",
      v020EllipseConstrained: "BroadcastLineCalibrator() — the v0.4.0 DEFAULT (opt-in chain OFF: the v0.3.0-exact single-conic surface — the b3-a visual-gate FAIL keeps the chain opt-in)",
      v030Surface: "BroadcastLineCalibrator({ ellipseMultiConicSelection: false }) — the v0.3.0 single-conic surface (identical to the default; the explicit control)",
      v040Chain: "BroadcastLineCalibrator({ ellipseMultiConicSelection: true }) — the OPT-IN conic-selection chain (the measured increment: b3-a machine-recovers at lineFit 0.731, VLM visual gate FAIL — the goal-structure conic class)",
    },
    windows: [] as unknown[],
    aggregate: {} as Record<string, unknown>,
  };

  let v010Calibrated = 0;
  let v020Calibrated = 0;
  let v020CalibratedWhereV010Refused = 0;
  let v020RefusedWhereV010Calibrated = 0;
  let v030Calibrated = 0;
  // v0.3.0 vs v0.4.0 non-degradation: every window the v0.3.0 surface
  // calibrated must calibrate IDENTICALLY (confidence + homography) on the
  // v0.4.0 default; the count of violations must be 0.
  let v040DegradedVsV030 = 0;
  let v040NewlyCalibrated = 0;
  let v040ChainCalibrated = 0;
  let v040ChainNewlyCalibrated = 0;

  for (const window of WINDOWS) {
    const clip = CLIPS.find((c) => c.clipId === window.clipId)!;
    const clipPath = path.join(CORPUS_DIR, clip.file);
    const frameNumbers = Array.from(
      { length: window.count },
      (_, k) => window.firstFrame + k * window.stride,
    );
    if (frameNumbers[frameNumbers.length - 1]! >= clip.frameCount) {
      throw new Error(`window ${window.id} exceeds ${clip.clipId}'s frame count`);
    }
    const t0 = Date.now();
    const rawFrames = await extractFrames(clipPath, frameNumbers);
    const frames = rawFrames.map((bytes, k) =>
      makeDetectorFrameInput({
        bytes,
        width: WIDTH,
        height: HEIGHT,
        decodeOrder: frameNumbers[k]!,
        presentationMs: frameNumbers[k]! * 40,
      }),
    );
    // The anchor frame for the overlay renderer.
    const anchorIndex = Math.floor((frames.length - 1) / 2);
    writeFileSync(
      path.join(FRAMES_DIR, `${window.id}.rgb`),
      Buffer.from(rawFrames[anchorIndex]!),
    );

    const v010 = measurePath(frames, false);
    const v020 = measurePath(frames, true);
    const ellipseEvidence = (() => {
      try {
        // The chain-opt-in diagnostics: records the FULL candidate chain
        // (the primary + the quota-passing alternatives); the primary
        // fields are identical to the default surface's.
        return jsonSafe(
          fitBroadcastEllipseEvidence(
            { frames: [...frames] },
            { ellipseMultiConicSelection: true },
          ),
        );
      } catch (error) {
        if (error instanceof CandidateFailureError) {
          return { stage: error.details.failureClassId };
        }
        throw error;
      }
    })();

    const perFrame = frames.map((frame, k) => ({
      frame: frameNumbers[k]!,
      mediaTimeSec: +(clip.mediaTimeStartSec + frameNumbers[k]! / 25).toFixed(2),
      v010: jsonSafe(measurePath([frame], false)),
      v020: jsonSafe(measurePath([frame], true)),
    }));

    const v030 = measurePath(frames, true, false);
    const v040 = measurePath(frames, true, true);
    if (v010.kind === "calibrated") v010Calibrated += 1;
    if (v020.kind === "calibrated") v020Calibrated += 1;
    if (v030.kind === "calibrated") v030Calibrated += 1;
    if (v010.kind === "refused" && v020.kind === "calibrated") v020CalibratedWhereV010Refused += 1;
    if (v010.kind === "calibrated" && v020.kind === "refused") v020RefusedWhereV010Calibrated += 1;
    // Non-degradation check: every window the v0.3.0 surface CALIBRATED
    // must calibrate identically on the v0.4.0 default (confidence +
    // homography byte-equal). A v0.3.0 REFUSAL improving to a v0.4.0
    // calibration is the increment's purpose, not a degradation (counted
    // separately as newly-calibrated).
    if (
      v030.kind === "calibrated" &&
      (v020.kind === "refused" ||
        (v020.kind === "calibrated" &&
          (v030.confidence !== v020.confidence ||
            JSON.stringify(v030.homography) !== JSON.stringify(v020.homography))))
    ) {
      v040DegradedVsV030 += 1;
    }
    if (v030.kind === "refused" && v020.kind === "calibrated") v040NewlyCalibrated += 1;
    if (v040.kind === "calibrated") v040ChainCalibrated += 1;
    if (v030.kind === "refused" && v040.kind === "calibrated") v040ChainNewlyCalibrated += 1;

    record.windows.push({
      id: window.id,
      clipId: window.clipId,
      frames: frameNumbers,
      mediaTimesSec: frameNumbers.map(
        (n) => +(clip.mediaTimeStartSec + n / 25).toFixed(2),
      ),
      anchorFrame: frameNumbers[anchorIndex]!,
      durationMs: Date.now() - t0,
      v010LineOnly: jsonSafe(v010),
      v020EllipseConstrained: jsonSafe(v020),
      v030Surface: jsonSafe(v030),
      v040Chain: jsonSafe(v040),
      ellipseEvidence,
      perFrame,
    });
    console.log(
      `[${window.id}] v0.1.0: ${v010.kind === "calibrated" ? `CALIBRATED conf=${v010.confidence.toFixed(3)}` : `REFUSED ${v010.failureClassId}`}` +
        ` | v0.4.0: ${v020.kind === "calibrated" ? `CALIBRATED conf=${v020.confidence.toFixed(3)} lineFit=${(v020.metrics.lineFit as number).toFixed(3)}` : `REFUSED ${v020.failureClassId}`}` +
        ` | v0.3.0: ${v030.kind === "calibrated" ? `CALIBRATED conf=${v030.confidence.toFixed(3)}` : `REFUSED ${v030.failureClassId}`}` +
        ` | v0.4.0 chain(opt-in): ${v040.kind === "calibrated" ? `CALIBRATED conf=${v040.confidence.toFixed(3)} lineFit=${(v040.metrics.lineFit as number).toFixed(3)}` : `REFUSED ${v040.failureClassId}`}` +
        ` (${Date.now() - t0}ms)`,
    );
  }

  record.aggregate = {
    windows: WINDOWS.length,
    v010Calibrated,
    v010Refused: WINDOWS.length - v010Calibrated,
    v030Calibrated,
    v040NonDegradationViolations: v040DegradedVsV030,
    v040NewlyCalibratedWhereV030Refused: v040NewlyCalibrated,
    v040ChainOptInCalibrated: v040ChainCalibrated,
    v040ChainOptInNewlyCalibratedWhereV030Refused: v040ChainNewlyCalibrated,
    v020Calibrated,
    v020Refused: WINDOWS.length - v020Calibrated,
    v020CalibratedWhereV010Refused,
    v020RefusedWhereV010Calibrated,
  };
  writeFileSync(path.join(EVIDENCE_DIR, "measurement.json"), JSON.stringify(record, null, 1));
  console.log("wrote measurement.json");
  console.log("aggregate:", JSON.stringify(record.aggregate));
}

await main();
