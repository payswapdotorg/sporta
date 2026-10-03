/**
 * R606 ellipse/circle-constrained calibration — MACHINE MEASUREMENT DRIVER
 * (DEVELOPMENT-TIME EVIDENCE, not a test).
 *
 * Measures SEVEN calibration paths of `BroadcastLineCalibrator` v0.6.0 on
 * bounded frame samples of the committed REAL corpus
 * (`scripts/evidence/spr-corpus-bytes/`, sha-256-verified against
 * `scripts/evidence/spr-wave2-corpus/corpus.json` at startup — the frozen
 * substrate contract):
 *  - (a) the v0.1.0-equivalent LINE-ONLY path (`ellipseConstrained: false`)
 *  - (b) the DEFAULT path (the v0.3.0-exact single-conic surface — the
 *    chain and its v0.4.1 hardening are OPT-IN)
 *  - (c) the explicit v0.3.0-surface control (`ellipseMultiConicSelection:
 *    false`; must be identical to the default — the non-degradation check)
 *  - (d) the v0.4.1 chain (opt-in; carries the validation-gate hardening:
 *    the conic grass-support gate + the projected-grid geometry gate)
 *  - (e) the v0.5.0 OPT-IN anchor conversion on the default single-conic
 *    surface (`ellipseAnchorConversion: true` — the J-orthogonal exact
 *    closure; every enumerated scan solve projected onto the J-orthogonal
 *    class under the admissibility bound / closure self-check / birth
 *    conic guard / conic hard guard, NO refinement, the UNCHANGED
 *    validation bar — the anchors-fight honest refusals)
 *  - (f) the v0.5.0 OPT-IN anchor conversion on the v0.4.1 conic-selection
 *    chain (`ellipseAnchorConversion: true, ellipseMultiConicSelection:
 *    true` — the per-candidate anchor records ride every conicChain entry)
 *  - (g) the v0.6.0 OPT-IN penalty-arc-conic prior on the conic-selection
 *    chain (`ellipseMultiConicSelection: true, penaltyArcPrior: true` —
 *    the fixed-geometry penalty-arc candidate family seeded AFTER every
 *    evidence-derived candidate, each prior-seeded solve gated by the
 *    full machine bar + the prior family's own gates: the E2c grass
 *    gate, the E6b degenerate-grid gate, the geometric quad-containment
 *    gate, and flight 4's world-circle/horizon gate — the 116.5 m class
 *    closure; prior provenance rides every chain entry)
 * per window (multi-frame, the pipeline's real mode) AND per sampled frame
 * (single-frame diagnostics), recording calibrated/refused, confidence,
 * the failure class + measured numbers on refusals, and the fit metrics
 * (lineFit / backward chamfer / ellipse residual) on calibrations. The
 * corpus-wide E4b anchor-record totals (scan solves enumerated / converted,
 * the typed unconvertible-refusal firings) aggregate over every conversion-
 * path conicChain entry.
 *
 * The driver shells out to ffmpeg ONLY for frame extraction (measurement
 * infrastructure); the solve itself is pure deterministic computation —
 * durationMs is the ONLY nondeterministic field in the record (stripped for
 * the two-run deep-equal determinism check).
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

const CORPUS_DIR = path.resolve(import.meta.dir, "../../../scripts/evidence/spr-corpus-bytes");
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
          reject(
            new Error(
              `ffmpeg produced ${buffer.length} bytes, expected ${frameNumbers.length * BYTES_PER_FRAME}`,
            ),
          );
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
  | {
      kind: "calibrated";
      confidence: number;
      correspondenceCount: number;
      /** The solved matrix rides the record (the overlay renderer + the non-degradation byte-equality). */
      homography: number[];
      metrics: Record<string, unknown>;
    }
  | { kind: "refused"; failureClassId: string; details: Record<string, unknown> };

function measurePath(
  frames: readonly DetectorFrameInput[],
  ellipseConstrained: boolean,
  ellipseMultiConicSelection?: boolean,
  ellipseAnchorConversion?: boolean,
  penaltyArcPrior?: boolean,
): Outcome {
  const calibrator = new BroadcastLineCalibrator({
    ellipseConstrained,
    ...(ellipseMultiConicSelection !== undefined ? { ellipseMultiConicSelection } : {}),
    ...(ellipseAnchorConversion !== undefined ? { ellipseAnchorConversion } : {}),
    ...(penaltyArcPrior !== undefined ? { penaltyArcPrior } : {}),
  });
  try {
    const result = calibrator.calibrate({ frames: [...frames] });
    // v0.6.0: on the prior path the metrics' ellipse-residual measurement
    // is FAMILY-honest (the min-over-chain extends to the prior-seeded
    // candidates, each measured against ITS family's painted marking) —
    // thread the path's own options; every other path measures unchanged.
    const metrics = evaluateBroadcastLineFit(
      { frames: [...frames] },
      result.homography,
      penaltyArcPrior !== undefined
        ? {
            penaltyArcPrior,
            ...(ellipseMultiConicSelection !== undefined ? { ellipseMultiConicSelection } : {}),
          }
        : {},
    );
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
        ...(metrics.ellipseMeanPx !== undefined ? { ellipseMeanPx: metrics.ellipseMeanPx } : {}),
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
  return JSON.parse(JSON.stringify(value, (_key, v) => (v === undefined ? null : v)));
}

/**
 * The corpus-wide E4b anchor-record totals of one conversion-path outcome:
 * the scan solves enumerated / solves converted, summed over every
 * conicChain entry that ran the conversion scan (pre-solve grass refusals
 * and pre-ellipse refusals carry no anchor record and contribute 0), plus
 * the count of candidates that refused with the typed
 * `broadcast-line.ellipse-anchor-unconvertible` class. The FIRST
 * quota-passer's record rides BOTH the top-level details and chain[0] —
 * summing over the chain entries alone counts every candidate exactly once.
 */
function anchorRecordTotals(outcome: Outcome): {
  scanSolves: number;
  converted: number;
  unconvertibleCandidates: number;
} {
  if (outcome.kind !== "refused")
    return { scanSolves: 0, converted: 0, unconvertibleCandidates: 0 };
  const chain = outcome.details.conicChain as ReadonlyArray<Record<string, unknown>> | undefined;
  let scanSolves = 0;
  let converted = 0;
  let unconvertibleCandidates = 0;
  for (const entry of chain ?? []) {
    if (typeof entry.anchorScanSolves === "number") {
      scanSolves += entry.anchorScanSolves;
      if (typeof entry.anchorConverted === "number") converted += entry.anchorConverted;
    }
    if (entry.failureClassId === "broadcast-line.ellipse-anchor-unconvertible") {
      unconvertibleCandidates += 1;
    }
  }
  return { scanSolves, converted, unconvertibleCandidates };
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
    schemaVersion: "1.2",
    driver: "packages/perception-adapters/scripts/r606-ellipse-measurement.ts",
    substrateVerification: CLIPS.map((clip) => ({
      clipId: clip.clipId,
      file: clip.file,
      sha256: clip.sha256,
      verified: true,
    })),
    paths: {
      v010LineOnly:
        "BroadcastLineCalibrator({ ellipseConstrained: false }) — the v0.1.0 behavior surface",
      v020EllipseConstrained:
        "BroadcastLineCalibrator() — the v0.4.0 DEFAULT (opt-in chain OFF: the v0.3.0-exact single-conic surface — the b3-a visual-gate FAIL keeps the chain opt-in)",
      v030Surface:
        "BroadcastLineCalibrator({ ellipseMultiConicSelection: false }) — the v0.3.0 single-conic surface (identical to the default; the explicit control)",
      v040Chain:
        "BroadcastLineCalibrator({ ellipseMultiConicSelection: true }) — the OPT-IN conic-selection chain + the v0.4.1 VALIDATION-GATE HARDENING (chain-only): the conic grass-support gate (broadcast-line.ellipse-conic-off-pitch — the b3-a goal-structure conics measure median interior green 0.000-0.073 vs 0.27-0.79 grass-backed) + the projected-grid geometry gate (broadcast-line.ellipse-degenerate-grid — the containment invariant; the v0.4.0 b3-a solve was a point-collapse at quad/conic 0.0004)",
      v050AnchorConversion:
        "BroadcastLineCalibrator({ ellipseAnchorConversion: true }) — the v0.5.0 OPT-IN J-orthogonal exact closure on the default single-conic surface: the image conic and the world circle canonicalize to the Lorentz form J and every enumerated mixed-DLT scan solve is projected onto the J-orthogonal class under the admissibility bound / closure self-check / birth conic guard / conic hard guard, the finalists run the UNCHANGED validation bar WITHOUT the refinement (61-b: the admissibility bound recalibrated to 0.1 on the measured bimodal deviation distribution — the inherited 1e-2 sat below the fitted-conic noise floor and admitted nothing, see the module's ELLIPSE_ANCHOR_ADMISSIBILITY_BOUND record; the closure is conic-exact by construction and the unchanged bar refuses the globally re-balanced solves — the anchors-fight outcome)",
      v050AnchorConversionChain:
        "BroadcastLineCalibrator({ ellipseAnchorConversion: true, ellipseMultiConicSelection: true }) — the v0.5.0 OPT-IN closure stacked on the v0.4.1 conic-selection chain: every quota-passing, grass-backed candidate's scan solves run through the closure with the per-candidate anchor record (scan solves enumerated / converted) riding every conicChain entry",
      v060PriorPath:
        "BroadcastLineCalibrator({ ellipseMultiConicSelection: true, penaltyArcPrior: true }) — the v0.6.0 OPT-IN penalty-arc-conic prior stacked on the v0.4.1 conic-selection chain (E2d): the FIXED-GEOMETRY penalty-arc candidate family — (image conic, fixed world circle) pairs seeded from the same arc-evidence fit machinery under the penalty-arc FAMILY quota (support >= 90 px + coverage >= 10 bins, the painted \"D\" arc's own span), both ends enumerated, the prior's candidates running AFTER every evidence-derived candidate — each prior-seeded solve through the FULL hypothesis -> refinement -> validation flow with the bar never lowered PLUS the prior family's own gates: the E2c grass gate, the E6b degenerate-grid gate, the geometric quad-containment gate (broadcast-line.ellipse-prior-quad-containment), and flight 4's world-circle/horizon gate (broadcast-line.ellipse-prior-world-circle — the 116.5 m class closure; the world-side probe bar is the calibration's OWN SCORE_RADIUS_M = 1.0 m); prior provenance (prior + priorEnd) rides every chain entry and refusal record",
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
  // v0.4.1 chain non-degradation vs the v0.3.0 surface (the "0 on every
  // path" record: every window a pre-existing path calibrated must
  // calibrate identically on every later path — the line path calibrates
  // those windows first, so the opt-in surfaces never even fire).
  let v040ChainDegradedVsV030 = 0;
  // v0.5.0 (61-b): the conversion-path counters — calibrated / newly
  // calibrated / non-degradation, plus the corpus-wide E4b anchor-record
  // totals and the typed unconvertible-refusal firings.
  let v050Calibrated = 0;
  let v050NewlyCalibrated = 0;
  let v050DegradedVsV030 = 0;
  let v050ChainCalibrated = 0;
  let v050ChainNewlyCalibrated = 0;
  let v050ChainDegradedVsV030 = 0;
  let v050ScanSolves = 0;
  let v050Converted = 0;
  let v050UnconvertibleCandidates = 0;
  let v050UnconvertibleWindows = 0;
  let v050ChainScanSolves = 0;
  let v050ChainConverted = 0;
  let v050ChainUnconvertibleCandidates = 0;
  let v050ChainUnconvertibleWindows = 0;
  // v0.6.0 (62-b, flight 4): the prior-path counters — calibrated / newly
  // calibrated / non-degradation (vs the v0.3.0 surface, the established
  // baseline), plus the corpus-wide prior-family record: the seeded
  // candidate count and the prior-gate typed-refusal firings (world-circle /
  // quad-containment / unevidenced / grass-on-prior), summed over every
  // window's chain entries and window outcome.
  let v060Calibrated = 0;
  let v060NewlyCalibrated = 0;
  let v060DegradedVsV030 = 0;
  let v060SeededCandidates = 0;
  let v060WorldCircleCandidates = 0;
  let v060WorldCircleWindows = 0;
  let v060QuadContainmentCandidates = 0;
  let v060QuadContainmentWindows = 0;
  let v060UnevidencedWindows = 0;
  let v060GrassOnPriorCandidates = 0;

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
    writeFileSync(path.join(FRAMES_DIR, `${window.id}.rgb`), Buffer.from(rawFrames[anchorIndex]!));

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

    // v0.6.0 (flight 4, additive): the PRIOR-seeded candidate record for the
    // overlays — the same diagnostics machinery with the prior option on,
    // recording ONLY the prior-seeded entries (each carries its geometry +
    // family provenance) and the family's best measured numbers. The
    // pre-existing `ellipseEvidence` key above is untouched (byte-identical).
    const priorEvidence = (() => {
      try {
        const diag = fitBroadcastEllipseEvidence(
          { frames: [...frames] },
          { ellipseMultiConicSelection: true, penaltyArcPrior: true },
        );
        const priorCandidates = (diag.conicCandidates ?? []).filter(
          (candidate) => candidate.prior !== undefined,
        );
        return jsonSafe({
          arcPixels: diag.arcPixels,
          priorSeeded: priorCandidates.length,
          ...(priorCandidates.length > 0
            ? {
                priorCandidates: priorCandidates.map((candidate) => ({
                  centerPx: candidate.centerPx,
                  semiMajorPx: candidate.semiMajorPx,
                  semiMinorPx: candidate.semiMinorPx,
                  rotationDeg: candidate.rotationDeg,
                  supportPx: candidate.supportPx,
                  coverageBins: candidate.coverageBins,
                  quotaPassed: candidate.quotaPassed,
                  priorEnd: candidate.priorEnd,
                })),
              }
            : {}),
        });
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
    // v0.5.0 (61-b): the OPT-IN anchor-conversion paths — (e) on the default
    // single-conic surface, (f) stacked on the conic-selection chain.
    const v050 = measurePath(frames, true, undefined, true);
    const v050Chain = measurePath(frames, true, true, true);
    // v0.6.0 (62-b, flight 4): the OPT-IN penalty-arc-conic prior path —
    // stacked on the conic-selection chain (the prior's candidates run
    // AFTER every evidence-derived candidate; every prior-seeded solve
    // gated by the full machine bar + the prior family's own gates).
    const v060 = measurePath(frames, true, true, undefined, true);
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
    const degradedVsV030 = (candidate: Outcome): boolean =>
      v030.kind === "calibrated" &&
      (candidate.kind === "refused" ||
        (candidate.kind === "calibrated" &&
          (candidate.confidence !== v030.confidence ||
            JSON.stringify(candidate.homography) !== JSON.stringify(v030.homography))));
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
    if (degradedVsV030(v040)) v040ChainDegradedVsV030 += 1;
    // v0.5.0: the conversion-path counters.
    if (v050.kind === "calibrated") v050Calibrated += 1;
    if (v030.kind === "refused" && v050.kind === "calibrated") v050NewlyCalibrated += 1;
    if (degradedVsV030(v050)) v050DegradedVsV030 += 1;
    if (v050Chain.kind === "calibrated") v050ChainCalibrated += 1;
    if (v030.kind === "refused" && v050Chain.kind === "calibrated") v050ChainNewlyCalibrated += 1;
    if (degradedVsV030(v050Chain)) v050ChainDegradedVsV030 += 1;
    const v050Totals = anchorRecordTotals(v050);
    v050ScanSolves += v050Totals.scanSolves;
    v050Converted += v050Totals.converted;
    v050UnconvertibleCandidates += v050Totals.unconvertibleCandidates;
    if (
      v050.kind === "refused" &&
      v050.failureClassId === "broadcast-line.ellipse-anchor-unconvertible"
    ) {
      v050UnconvertibleWindows += 1;
    }
    const v050ChainTotals = anchorRecordTotals(v050Chain);
    v050ChainScanSolves += v050ChainTotals.scanSolves;
    v050ChainConverted += v050ChainTotals.converted;
    v050ChainUnconvertibleCandidates += v050ChainTotals.unconvertibleCandidates;
    if (
      v050Chain.kind === "refused" &&
      v050Chain.failureClassId === "broadcast-line.ellipse-anchor-unconvertible"
    ) {
      v050ChainUnconvertibleWindows += 1;
    }
    // v0.6.0: the prior-path counters + the corpus-wide prior-family record.
    if (v060.kind === "calibrated") v060Calibrated += 1;
    if (v030.kind === "refused" && v060.kind === "calibrated") v060NewlyCalibrated += 1;
    if (degradedVsV030(v060)) v060DegradedVsV030 += 1;
    if (v060.kind === "refused" && typeof v060.details.priorSeededCandidates === "number") {
      v060SeededCandidates += v060.details.priorSeededCandidates as number;
    }
    const v060Chain =
      v060.kind === "refused"
        ? (v060.details.conicChain as ReadonlyArray<Record<string, unknown>> | undefined)
        : undefined;
    for (const entry of v060Chain ?? []) {
      if (entry.prior !== "penalty-arc") continue;
      if (entry.failureClassId === "broadcast-line.ellipse-prior-world-circle") {
        v060WorldCircleCandidates += 1;
      }
      if (entry.failureClassId === "broadcast-line.ellipse-prior-quad-containment") {
        v060QuadContainmentCandidates += 1;
      }
      if (entry.failureClassId === "broadcast-line.ellipse-conic-off-pitch") {
        v060GrassOnPriorCandidates += 1;
      }
    }
    if (
      v060.kind === "refused" &&
      v060.failureClassId === "broadcast-line.ellipse-prior-world-circle"
    ) {
      v060WorldCircleWindows += 1;
    }
    if (
      v060.kind === "refused" &&
      v060.failureClassId === "broadcast-line.ellipse-prior-quad-containment"
    ) {
      v060QuadContainmentWindows += 1;
    }
    if (
      v060.kind === "refused" &&
      v060.failureClassId === "broadcast-line.ellipse-penalty-arc-prior-unevidenced"
    ) {
      v060UnevidencedWindows += 1;
    }

    record.windows.push({
      id: window.id,
      clipId: window.clipId,
      frames: frameNumbers,
      mediaTimesSec: frameNumbers.map((n) => +(clip.mediaTimeStartSec + n / 25).toFixed(2)),
      anchorFrame: frameNumbers[anchorIndex]!,
      durationMs: Date.now() - t0,
      v010LineOnly: jsonSafe(v010),
      v020EllipseConstrained: jsonSafe(v020),
      v030Surface: jsonSafe(v030),
      v040Chain: jsonSafe(v040),
      v050AnchorConversion: jsonSafe(v050),
      v050AnchorConversionChain: jsonSafe(v050Chain),
      v060PriorPath: jsonSafe(v060),
      ellipseEvidence,
      priorEvidence,
      perFrame,
    });
    console.log(
      `[${window.id}] v0.1.0: ${v010.kind === "calibrated" ? `CALIBRATED conf=${v010.confidence.toFixed(3)}` : `REFUSED ${v010.failureClassId}`}` +
        ` | v0.4.0: ${v020.kind === "calibrated" ? `CALIBRATED conf=${v020.confidence.toFixed(3)} lineFit=${(v020.metrics.lineFit as number).toFixed(3)}` : `REFUSED ${v020.failureClassId}`}` +
        ` | v0.3.0: ${v030.kind === "calibrated" ? `CALIBRATED conf=${v030.confidence.toFixed(3)}` : `REFUSED ${v030.failureClassId}`}` +
        ` | v0.4.0 chain(opt-in): ${v040.kind === "calibrated" ? `CALIBRATED conf=${v040.confidence.toFixed(3)} lineFit=${(v040.metrics.lineFit as number).toFixed(3)}` : `REFUSED ${v040.failureClassId}`}` +
        ` | v0.5.0 conv(opt-in): ${v050.kind === "calibrated" ? `CALIBRATED conf=${v050.confidence.toFixed(3)}` : `REFUSED ${v050.failureClassId}${v050.kind === "refused" && v050.details.anchorScanSolves !== undefined ? ` [scan ${v050.details.anchorScanSolves}/conv ${v050.details.anchorConverted}]` : ""}`}` +
        ` | v0.5.0 conv+chain(opt-in): ${v050Chain.kind === "calibrated" ? `CALIBRATED conf=${v050Chain.confidence.toFixed(3)}` : `REFUSED ${v050Chain.failureClassId}`}` +
        ` | v0.6.0 prior(opt-in): ${v060.kind === "calibrated" ? `CALIBRATED conf=${v060.confidence.toFixed(3)}` : `REFUSED ${v060.failureClassId}${v060.kind === "refused" && typeof v060.details.priorSeededCandidates === "number" ? ` [prior seeded ${v060.details.priorSeededCandidates}]` : ""}`}` +
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
    v040ChainOptInNonDegradationViolations: v040ChainDegradedVsV030,
    v020Calibrated,
    v020Refused: WINDOWS.length - v020Calibrated,
    v020CalibratedWhereV010Refused,
    v020RefusedWhereV010Calibrated,
    // v0.5.0 (61-b, the E4b anchor conversion — honest fresh numbers):
    v050AnchorConversionCalibrated: v050Calibrated,
    v050AnchorConversionNewlyCalibratedWhereV030Refused: v050NewlyCalibrated,
    v050AnchorConversionNonDegradationViolations: v050DegradedVsV030,
    v050AnchorConversionChainCalibrated: v050ChainCalibrated,
    v050AnchorConversionChainNewlyCalibratedWhereV030Refused: v050ChainNewlyCalibrated,
    v050AnchorConversionChainNonDegradationViolations: v050ChainDegradedVsV030,
    // The corpus-wide E4b anchor records (per conversion path, summed over
    // every conicChain entry that ran the conversion scan — the per-candidate
    // records ride the per-window records):
    v050AnchorConversionScanSolvesEnumerated: v050ScanSolves,
    v050AnchorConversionSolvesConverted: v050Converted,
    v050AnchorConversionConversionRate:
      v050ScanSolves > 0 ? +(v050Converted / v050ScanSolves).toFixed(6) : 0,
    v050AnchorConversionUnconvertibleRefusalCandidates: v050UnconvertibleCandidates,
    v050AnchorConversionUnconvertibleRefusalWindows: v050UnconvertibleWindows,
    v050AnchorConversionChainScanSolvesEnumerated: v050ChainScanSolves,
    v050AnchorConversionChainSolvesConverted: v050ChainConverted,
    v050AnchorConversionChainConversionRate:
      v050ChainScanSolves > 0 ? +(v050ChainConverted / v050ChainScanSolves).toFixed(6) : 0,
    v050AnchorConversionChainUnconvertibleRefusalCandidates: v050ChainUnconvertibleCandidates,
    v050AnchorConversionChainUnconvertibleRefusalWindows: v050ChainUnconvertibleWindows,
    // v0.6.0 (62-b, flight 4 — the OPT-IN penalty-arc-conic prior path,
    // honest fresh numbers):
    v060PriorPathCalibrated: v060Calibrated,
    v060PriorPathNewlyCalibratedWhereV030Refused: v060NewlyCalibrated,
    v060PriorPathNonDegradationViolations: v060DegradedVsV030,
    v060PriorPathSeededCandidates: v060SeededCandidates,
    v060PriorPathWorldCircleRefusalCandidates: v060WorldCircleCandidates,
    v060PriorPathWorldCircleRefusalWindows: v060WorldCircleWindows,
    v060PriorPathQuadContainmentRefusalCandidates: v060QuadContainmentCandidates,
    v060PriorPathQuadContainmentRefusalWindows: v060QuadContainmentWindows,
    v060PriorPathUnevidencedRefusalWindows: v060UnevidencedWindows,
    v060PriorPathGrassOnPriorRefusalCandidates: v060GrassOnPriorCandidates,
  };
  writeFileSync(path.join(EVIDENCE_DIR, "measurement.json"), JSON.stringify(record, null, 1));
  console.log("wrote measurement.json");
  console.log("aggregate:", JSON.stringify(record.aggregate));
}

await main();
