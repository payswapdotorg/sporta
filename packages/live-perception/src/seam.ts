/**
 * THE BROADCAST-PERCEPTION → LIVE-OBSERVATION RUNTIME SEAM (L011) — the
 * per-frame bridge from the perception chain's outputs (tracked player
 * boxes, optional ball detections, the pitch calibration) into the FROZEN
 * `LiveObservation` contract with `sourceType: "BROADCAST_PERCEPTION"` (the
 * frozen §1 vocabulary member this seam exists to feed):
 *
 * ```text
 * decode → detect → track → calibrate → THIS SEAM → LiveObservation
 *   → TemporalBufferEngine (L004) → LiveSwmUpdater (L003) → WorldModelEngine
 * ```
 *
 * THE ACCEPTANCE PINS (L011): broadcast perception feeds the SAME live
 * observation contract — NO renderer changes (the seam emits observations
 * only; the L005 renderer keeps consuming the live view), NO second SWM (the
 * batches flow through the SAME L004 → L003 composition into the SAME
 * canonical `WorldModelEngine` the batch path drives — proven by the
 * integration test over a decoded clip).
 *
 * NO FORKED PROJECTION SEMANTICS: the position projection is
 * `bridgedPosition` IMPORTED from `@sporta/real-to-swm` — the exact
 * arithmetic the batch bridge uses (the box center through the calibration
 * homography, confidence DISCOUNTED by the calibration confidence because a
 * projected position is inference, off-pitch projections flagged and
 * counted, projections at infinity dropped and counted). A clip processed
 * through the batch bridge and the same clip through this seam produce the
 * same entity ids (the tracker's `trackId` passes through VERBATIM — the
 * batch convention) and the same position semantics.
 *
 * HONEST MAPPINGS (each documented, none fabricated):
 *
 * - POSITIONS are PITCH METERS by contract (the frozen §2: "Pitch
 *   coordinates use the Sporta canonical field coordinate contract") — a
 *   calibration is REQUIRED; without one the seam refuses (never an
 *   image-space position smuggled into the pitch contract);
 * - `detected: true` for tracked boxes and detected balls — the perception
 *   chain's per-frame output IS frame evidence (a tracker's interpolated
 *   associations carry their confidence verbatim; the tracker exposes no
 *   carry flag, and none is invented);
 * - the ball row is the frame's HIGHEST-CONFIDENCE ball detection (a
 *   missing ball = no ball row — the ball is unobserved that frame; the
 *   possession recompute simply does not run, honestly);
 * - NO velocity (the perception chain emits none — never invented);
 * - event time = the frame's `presentationMs` (the canonical media
 *   timeline); sequence = the caller's 1-based emission tick; the emission
 *   watermark is conservative at the frame's own time (the L004 engine owns
 *   the windowing).
 */
import { batchConfidenceOf } from "@sporta/live-source";
import type { LiveEntityObservation, LiveObservation } from "@sporta/live-source";
import type {
  DetectedBox,
  DetectorFrameInput,
  TrackedBox,
  CalibrationResult,
} from "@sporta/perception-adapters";
import { bridgedPosition } from "@sporta/real-to-swm";

/** The seam's identity constants (honest naming). */
export const BROADCAST_PERCEPTION_ADAPTER_ID = "live-perception.broadcast-seam";
export const BROADCAST_PERCEPTION_ADAPTER_VERSION = "0.1.0";
export const BROADCAST_PERCEPTION_DEFAULT_SOURCE_ID = "broadcast-perception-1";

/** The default replay ingest offset every batch carries (ms). */
export const BROADCAST_PERCEPTION_DEFAULT_BASE_LATENCY_MS = 120;

/** The seam's static configuration (per live session). */
export interface BroadcastPerceptionSeamConfig {
  /** The session the seam feeds (rides every batch). */
  sessionId: string;
  /** The source identity (default `broadcast-perception-1`). */
  sourceId?: string;
  /** The replay ingest offset (ms; default 120). */
  baseLatencyMs?: number;
}

/** One frame's perception outputs (the seam's input — all injected). */
export interface BroadcastPerceptionFrame {
  /** The decoded frame (identity, timeline position, dimensions, pixels). */
  readonly frame: DetectorFrameInput;
  /** This frame's tracked player boxes (the tracker's per-frame output). */
  readonly trackedPlayers: readonly TrackedBox[];
  /** This frame's ball detections (optional; the best one becomes the ball row). */
  readonly ballDetections?: readonly DetectedBox[];
  /**
   * The image → pitch calibration (REQUIRED — the frozen pitch-coordinate
   * contract; the batch path's own calibrators or an operator-injected
   * mapping provide it).
   */
  readonly calibration: CalibrationResult;
}

/** The seam's honest accounting (never a silent anything). */
export interface BroadcastPerceptionSeamStats {
  framesProcessed: number;
  batchesEmitted: number;
  framesWithoutRows: number;
  playerRowsEmitted: number;
  ballRowsEmitted: number;
  offPitchRows: number;
  droppedInfiniteProjections: number;
}

/** The seam's per-session accumulator (built by {@link broadcastPerceptionObservation}). */
export interface BroadcastPerceptionSeam {
  /** The seam's configuration (echoed for reports). */
  readonly config: Readonly<BroadcastPerceptionSeamConfig & { baseLatencyMs: number }>;
  /** The honest accounting (live). */
  stats(): BroadcastPerceptionSeamStats;
  /**
   * Builds one LiveObservation batch from a frame's perception outputs (or
   * `null` when the frame yields no rows — counted, never a fake batch).
   * `sequence` is the 1-based emission tick (the caller's counter).
   */
  observation(frame: BroadcastPerceptionFrame, sequence: number): LiveObservation | null;
}

/** Creates the broadcast-perception seam for one live session. */
export function createBroadcastPerceptionSeam(
  config: BroadcastPerceptionSeamConfig,
): BroadcastPerceptionSeam {
  if (typeof config.sessionId !== "string" || config.sessionId.length === 0) {
    throw new RangeError("createBroadcastPerceptionSeam: sessionId must be a non-empty string");
  }
  const baseLatencyMs = config.baseLatencyMs ?? BROADCAST_PERCEPTION_DEFAULT_BASE_LATENCY_MS;
  const sourceId = config.sourceId ?? BROADCAST_PERCEPTION_DEFAULT_SOURCE_ID;
  const state: BroadcastPerceptionSeamStats = {
    framesProcessed: 0,
    batchesEmitted: 0,
    framesWithoutRows: 0,
    playerRowsEmitted: 0,
    ballRowsEmitted: 0,
    offPitchRows: 0,
    droppedInfiniteProjections: 0,
  };
  return {
    config: Object.freeze({ ...config, sourceId, baseLatencyMs }),
    stats: () => ({ ...state }),
    observation(frame, sequence) {
      state.framesProcessed += 1;
      const eventTimeMs = frame.frame.presentationMs;
      const rows: LiveEntityObservation[] = [];

      for (const tracked of frame.trackedPlayers) {
        const bridged = bridgedPosition(tracked.box, tracked.confidence, frame.calibration);
        if (bridged === undefined) {
          state.droppedInfiniteProjections += 1; // the projection divides by ~zero — dropped, counted
          continue;
        }
        if (bridged.offPitch) state.offPitchRows += 1; // flagged + counted, never clamped
        rows.push({
          entityRef: tracked.trackId, // VERBATIM — the batch bridge's identity passthrough
          kind: "PLAYER",
          position: { xMeters: bridged.position.x, yMeters: bridged.position.y },
          detected: true,
          sourceLocalTrackId: tracked.trackId,
          confidence: bridged.confidence, // the detection's × the calibration's (inference discount)
          observedAtMs: eventTimeMs,
        });
      }

      const ballDetections = frame.ballDetections ?? [];
      if (ballDetections.length > 0) {
        // The frame's best ball detection (highest confidence; ties → the
        // first in box order — deterministic).
        let best = ballDetections[0]!;
        for (const candidate of ballDetections) {
          if (candidate.confidence > best.confidence) best = candidate;
        }
        const bridged = bridgedPosition(best.box, best.confidence, frame.calibration);
        if (bridged === undefined) {
          state.droppedInfiniteProjections += 1;
        } else {
          if (bridged.offPitch) state.offPitchRows += 1;
          rows.push({
            entityRef: "ball",
            kind: "BALL",
            position: { xMeters: bridged.position.x, yMeters: bridged.position.y },
            detected: true,
            sourceLocalTrackId: "ball-detection",
            confidence: bridged.confidence,
            observedAtMs: eventTimeMs,
          });
        }
      }

      if (rows.length === 0) {
        state.framesWithoutRows += 1;
        return null;
      }
      state.batchesEmitted += 1;
      state.playerRowsEmitted += rows.filter((row) => row.kind === "PLAYER").length;
      state.ballRowsEmitted += rows.filter((row) => row.kind === "BALL").length;
      return {
        schemaVersion: "sporta.live-observation/1",
        sessionId: config.sessionId,
        sourceId,
        sourceType: "BROADCAST_PERCEPTION", // the frozen §1 member this seam exists to feed
        sequence,
        eventTimeMs,
        ingestTimeMs: eventTimeMs + baseLatencyMs,
        watermark: { watermarkMs: eventTimeMs, sequence }, // conservative at emission
        entityObservations: rows,
        confidence: batchConfidenceOf(rows),
        provenance: "DERIVED", // CV/ML perception over broadcast frames
        quality: "nominal",
      };
    },
  };
}
