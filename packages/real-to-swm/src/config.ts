/**
 * The R207 pipeline configuration: candidate chains per family, decode
 * window/bounds, tracking gates, emit cadence, and the deterministic clock.
 *
 * The config is PURE DATA (JSON-safe) and is echoed verbatim — defaults
 * resolved — into the reconstruction artifact, so an artifact fully
 * documents the run that produced it. No clocks, no randomness: the only
 * RNG consumer in the composition (the jersey-color assigner's first-center
 * draw) takes its seed from here.
 */
import type { FieldCornerSet } from "@sporta/perception-adapters";

/** Ordered candidate ids for one perception family (first = preferred). */
export type CandidateChain = readonly string[];

/** The ball-impulse candidate gates (documented, deterministic constants). */
export interface BallImpulseGates {
  /**
   * Minimum speed RATIO between the ball's consecutive inter-point velocities
   * for an impulse candidate (default 3 — a tripling of image-space speed).
   */
  readonly minSpeedRatio: number;
  /**
   * Minimum ABSOLUTE speed gain in normalized image units per second
   * (default 0.1 — a tenth of the frame width per second) — suppresses
   * micro-speed noise on a near-stationary ball.
   */
  readonly minSpeedGain: number;
  /**
   * Minimum per-leg speed in normalized units/second for the direction
   * REVERSAL branch (default 0.15) — a bounce must actually move, not
   * jitter; sub-0.15 reversals are blob-tracker noise on static balls.
   */
  readonly minReversalSpeed: number;
  /**
   * Non-max suppression window in milliseconds over the RAW impulse
   * candidates (default 240 = 6 frames at 25 fps): candidates inside one
   * window collapse to the highest-confidence member — bursty tracker
   * jitter becomes one candidate per physical impulse.
   */
  readonly clusterWindowMs: number;
}

/** The decode window + budget passed to the W102 boundary. */
export interface DecodeWindowConfig {
  /** Inclusive window start in milliseconds (default 0). */
  readonly fromMs?: number;
  /** Exclusive window end in milliseconds (default: end of stream). */
  readonly toMs?: number;
  /**
   * Per-call cumulative decoded-byte budget. REQUIRED to be set explicitly
   * (the W102 default of 256 MiB covers ~395 frames at 640x360 rgb24; the
   * 20 s gate clip decodes 500 frames = 345.6 MB). The pipeline refuses an
   * unset budget so the bound is always a deliberate decision, recorded in
   * the ledger.
   */
  readonly maxTotalBytes: number;
}

/** The full R207 pipeline configuration (all fields optional except none). */
export interface RealToSwmPipelineConfig {
  /** The media session id (required, non-empty). */
  readonly sessionId: string;
  /**
   * Player-detection candidate chain (default: contrast-context,
   * model-backed, heuristic — the J012 license-clean production path first;
   * the model-backed candidate keeps its honest refusal posture, the color
   * baseline stays the final fallback).
   */
  readonly playerDetection?: CandidateChain;
  /** Player-tracking candidate chain (default: greedy-iou baseline). */
  readonly playerTracking?: CandidateChain;
  /** Ball-detection candidate chain (default: model-backed, ball-blob). */
  readonly ballDetection?: CandidateChain;
  /** Ball-tracking candidate chain (default: color-blob, nearest-box). */
  readonly ballTracking?: CandidateChain;
  /** Pitch-calibration candidate chain (default: line-based, homography). */
  readonly calibration?: CandidateChain;
  /**
   * Operator-supplied corner correspondences for the homography calibrator
   * (the R205 baseline is correspondence-driven). Absent on real footage —
   * recorded honestly when the candidate therefore refuses.
   */
  readonly calibrationCornerSet?: FieldCornerSet;
  /** The jersey-color assigner's clustering seed (default its own). */
  readonly teamSeed?: string;
  /** Minimum track lifetime in frames for SWM entity projection (default 5). */
  readonly minTrackFrames?: number;
  /** Snapshot cadence in milliseconds for the emitted timeline (default 1000). */
  readonly snapshotCadenceMs?: number;
  /** Possession radius in canonical pitch meters (default 2 — W401's). */
  readonly possessionRadiusM?: number;
  /** The ball-impulse candidate gates (documented defaults). */
  readonly ballImpulse?: BallImpulseGates;
  /** The decode window + budget (REQUIRED: the bound is a decision). */
  readonly decode?: DecodeWindowConfig;
  /**
   * Deterministic clock for receipt/ingest times and snapshot
   * `generatedAtMs` (default 0 — the repo-wide clock-injection rule; never
   * wall-clock in the pipeline core).
   */
  readonly nowMs?: number;
  /**
   * Whether raw detection observations are bridged into the observation
   * store (default false: track observations carry the per-entity evidence;
   * detection counts and confidence summaries live in the ledger).
   */
  readonly bridgeDetections?: boolean;
}

/** The config with every default resolved (echoed into the artifact). */
export interface ResolvedPipelineConfig {
  readonly sessionId: string;
  readonly playerDetection: CandidateChain;
  readonly playerTracking: CandidateChain;
  readonly ballDetection: CandidateChain;
  readonly ballTracking: CandidateChain;
  readonly calibration: CandidateChain;
  readonly teamSeed: string;
  readonly minTrackFrames: number;
  readonly snapshotCadenceMs: number;
  readonly possessionRadiusM: number;
  readonly ballImpulse: BallImpulseGates;
  readonly decode: DecodeWindowConfig;
  readonly nowMs: number;
  readonly bridgeDetections: boolean;
}

/** Default candidate chains (the shipped, always-available compositions). */
export const DEFAULT_PLAYER_DETECTION_CHAIN: CandidateChain = [
  "contrast-context-detector",
  "model-backed-detector",
  "heuristic-color-detector",
];
export const DEFAULT_PLAYER_TRACKING_CHAIN: CandidateChain = ["greedy-iou-tracker"];
export const DEFAULT_BALL_DETECTION_CHAIN: CandidateChain = [
  "model-backed-ball-detector",
  "ball-blob-detector",
];
export const DEFAULT_BALL_TRACKING_CHAIN: CandidateChain = [
  "color-blob-ball-tracker",
  "nearest-box-ball-tracker",
];
export const DEFAULT_CALIBRATION_CHAIN: CandidateChain = [
  "line-based-field-calibrator",
  "homography-field-calibrator",
];

/** Default ball-impulse gates (documented constants, no per-clip tuning). */
export const DEFAULT_BALL_IMPULSE_GATES: BallImpulseGates = {
  minSpeedRatio: 3,
  minSpeedGain: 0.1,
  minReversalSpeed: 0.15,
  clusterWindowMs: 240,
};

/** Resolves a config against defaults, validating fail-closed (repo style). */
export function resolveConfig(config: RealToSwmPipelineConfig): ResolvedPipelineConfig {
  if (typeof config.sessionId !== "string" || config.sessionId.length < 1) {
    throw new RangeError("RealToSwmPipeline: sessionId must be a non-empty string");
  }
  const decode = config.decode;
  if (decode === undefined) {
    throw new RangeError(
      "RealToSwmPipeline: config.decode is required (the decoded-byte budget must be a " +
        "deliberate, recorded decision — see DecodeWindowConfig.maxTotalBytes)",
    );
  }
  if (
    typeof decode.maxTotalBytes !== "number" ||
    !Number.isFinite(decode.maxTotalBytes) ||
    decode.maxTotalBytes <= 0
  ) {
    throw new RangeError(
      `RealToSwmPipeline: decode.maxTotalBytes must be a finite number > 0 (got ${decode.maxTotalBytes})`,
    );
  }
  if (decode.fromMs !== undefined && (!Number.isFinite(decode.fromMs) || decode.fromMs < 0)) {
    throw new RangeError("RealToSwmPipeline: decode.fromMs must be a finite number >= 0");
  }
  if (decode.toMs !== undefined && (!Number.isFinite(decode.toMs) || decode.toMs <= 0)) {
    throw new RangeError("RealToSwmPipeline: decode.toMs must be a finite number > 0");
  }
  if (decode.fromMs !== undefined && decode.toMs !== undefined && decode.toMs <= decode.fromMs) {
    throw new RangeError("RealToSwmPipeline: decode.toMs must be greater than decode.fromMs");
  }
  const minTrackFrames = config.minTrackFrames ?? 5;
  if (!Number.isInteger(minTrackFrames) || minTrackFrames < 1) {
    throw new RangeError(
      `RealToSwmPipeline: minTrackFrames must be an integer >= 1 (got ${minTrackFrames})`,
    );
  }
  const snapshotCadenceMs = config.snapshotCadenceMs ?? 1000;
  if (!Number.isFinite(snapshotCadenceMs) || snapshotCadenceMs <= 0) {
    throw new RangeError(
      `RealToSwmPipeline: snapshotCadenceMs must be a finite number > 0 (got ${snapshotCadenceMs})`,
    );
  }
  const possessionRadiusM = config.possessionRadiusM ?? 2;
  if (!Number.isFinite(possessionRadiusM) || possessionRadiusM <= 0) {
    throw new RangeError(
      `RealToSwmPipeline: possessionRadiusM must be a finite number > 0 (got ${possessionRadiusM})`,
    );
  }
  const gates = { ...DEFAULT_BALL_IMPULSE_GATES, ...config.ballImpulse };
  for (const [name, value] of Object.entries(gates)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(`RealToSwmPipeline: ballImpulse.${name} must be a finite number > 0`);
    }
  }
  const chains = {
    playerDetection: config.playerDetection ?? DEFAULT_PLAYER_DETECTION_CHAIN,
    playerTracking: config.playerTracking ?? DEFAULT_PLAYER_TRACKING_CHAIN,
    ballDetection: config.ballDetection ?? DEFAULT_BALL_DETECTION_CHAIN,
    ballTracking: config.ballTracking ?? DEFAULT_BALL_TRACKING_CHAIN,
    calibration: config.calibration ?? DEFAULT_CALIBRATION_CHAIN,
  };
  for (const [name, chain] of Object.entries(chains)) {
    if (chain.length === 0) {
      throw new RangeError(`RealToSwmPipeline: ${name} candidate chain must not be empty`);
    }
    for (const technologyId of chain) {
      if (typeof technologyId !== "string" || technologyId.length < 1) {
        throw new RangeError(`RealToSwmPipeline: ${name} chain entries must be non-empty strings`);
      }
    }
  }
  return {
    sessionId: config.sessionId,
    ...chains,
    teamSeed: config.teamSeed ?? "jersey-color-default-seed",
    minTrackFrames,
    snapshotCadenceMs,
    possessionRadiusM,
    ballImpulse: gates,
    decode: {
      ...(decode.fromMs !== undefined ? { fromMs: decode.fromMs } : {}),
      ...(decode.toMs !== undefined ? { toMs: decode.toMs } : {}),
      maxTotalBytes: decode.maxTotalBytes,
    },
    nowMs: config.nowMs ?? 0,
    bridgeDetections: config.bridgeDetections ?? false,
  };
}
