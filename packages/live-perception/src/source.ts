/**
 * THE CLIP-DRIVEN BROADCAST-PERCEPTION LIVE SOURCE (L011) — decode a clip,
 * run the perception chain per frame (the J012 production-path defaults:
 * contrast-context detection, greedy-IoU tracking — the SAME candidate chain
 * the batch pipeline defaults to), and emit per-frame
 * `BROADCAST_PERCEPTION` LiveObservation batches through the seam,
 * pull-based, incrementally:
 *
 * ```text
 * clip bytes → W102 decode → per-frame detect → track → the seam
 *   → next(): one LiveObservation per frame that yields rows
 *   → TemporalBufferEngine (L004) → LiveSwmUpdater (L003) → WorldModelEngine
 * ```
 *
 * HONEST BOUNDARIES (documented, never papered over):
 *
 * - the TRACKER's published API is whole-sequence (`track(frames)`) — the
 *   source runs it as a deterministic pre-pass and emits its PER-FRAME
 *   output through the seam one frame at a time (the incremental property is
 *   the SWM updates: one batch per frame through L004 → L003; a streaming
 *   tracker is the perception lane's future work — the SEAM is per-frame);
 * - the CALIBRATION is an INPUT (injected): the live broadcast path
 *   calibrates through the perception chain's own calibrators upstream; this
 *   source never invents one;
 * - NO ball by default (the production player-detection chain carries no
 *   ball detector — a `ballDetector` can be injected);
 * - frames whose perception yields no rows emit NO batch (counted — never a
 *   fabricated empty observation).
 */
import { DecodingService, FfmpegDecoderAdapter } from "@sporta/decoding";
import type { DecodeSourceInput, NormalizedVideoFrame } from "@sporta/decoding";
import type {
  BallDetectionAdapter,
  DetectedBox,
  PlayerDetectionAdapter,
  PlayerTrackingAdapter,
  PlayerTrackingResult,
  TrackedBox,
} from "@sporta/perception-adapters";
import { ContrastContextDetector, GreedyIouTrackerAdapter } from "@sporta/perception-adapters";
import type { CalibrationResult } from "@sporta/perception-adapters";
import { buildAuthorizationPolicy } from "@sporta/testing";
import type { LiveObservation } from "@sporta/live-source";
import {
  BROADCAST_PERCEPTION_ADAPTER_ID,
  BROADCAST_PERCEPTION_ADAPTER_VERSION,
  createBroadcastPerceptionSeam,
} from "./seam";
import type { BroadcastPerceptionSeam, BroadcastPerceptionSeamStats } from "./seam";

/** The source's configuration (all DATA; the calibration is an INPUT). */
export interface BroadcastPerceptionClipSourceConfig {
  /** The session the source feeds. */
  sessionId: string;
  /** The clip's bytes (real MP4; decoded through the W102 boundary). */
  clipBytes: Uint8Array;
  /** The clip's filename (receipt honesty; default "broadcast-clip.mp4"). */
  filename?: string;
  /** The image → pitch calibration (REQUIRED — see the seam's contract). */
  calibration: CalibrationResult;
  /** The player detector (default: the contrast-context production path). */
  detector?: PlayerDetectionAdapter;
  /** The player tracker (default: the greedy-IoU tracker, the batch default). */
  tracker?: PlayerTrackingAdapter;
  /** An optional ball detector (none by default — honest absence). */
  ballDetector?: BallDetectionAdapter;
  /** The source identity (default `broadcast-perception-1`). */
  sourceId?: string;
  /** The replay ingest offset (ms; default 120). */
  baseLatencyMs?: number;
}

/** The source's honest accounting (the seam's stats + the perception pass). */
export interface BroadcastPerceptionSourceStats extends BroadcastPerceptionSeamStats {
  /** Frames decoded from the clip. */
  framesDecoded: number;
  /** Frames whose detection stage yielded at least one box. */
  framesWithDetections: number;
  /** Total player detections across frames. */
  playerDetections: number;
  /** The tracker's APPARENT identity-switch count (its documented proxy). */
  identitySwitches: number;
  /** The detector/tracker identities actually used (honest labeling). */
  used: { detectorId: string; trackerId: string };
  /** Whether the source is exhausted. */
  exhausted: boolean;
}

/** The fully-resolved internal state (built by the async factory). */
interface ResolvedState {
  seam: BroadcastPerceptionSeam;
  frames: readonly NormalizedVideoFrame[];
  trackedPerFrame: readonly (readonly TrackedBox[])[];
  ballDetectionsPerFrame: readonly (readonly DetectedBox[])[];
  calibration: CalibrationResult;
  framesDecoded: number;
  framesWithDetections: number;
  playerDetections: number;
  identitySwitches: number;
  detectorId: string;
  trackerId: string;
  nextFrameIndex: number;
}

/**
 * The clip-driven broadcast-perception live source (L011). Created through
 * {@link createBroadcastPerceptionClipSource} (the async factory — the
 * decode/detect/track pre-pass completes before the first pull); pull-based:
 * `next()` returns the next frame's batch (or null at exhaustion).
 */
export class BroadcastPerceptionClipSource {
  readonly adapterId = BROADCAST_PERCEPTION_ADAPTER_ID;
  readonly adapterVersion = BROADCAST_PERCEPTION_ADAPTER_VERSION;
  private state: ResolvedState;

  private constructor(state: ResolvedState) {
    this.state = state;
  }

  /**
   * Creates the source: decodes the clip (the W102 boundary, rights-gated,
   * budgeted), detects per frame, tracks the sequence (the deterministic
   * pre-pass — see the module doc), and wires the seam.
   */
  static async create(
    config: BroadcastPerceptionClipSourceConfig,
  ): Promise<BroadcastPerceptionClipSource> {
    if (typeof config.sessionId !== "string" || config.sessionId.length === 0) {
      throw new RangeError(
        "createBroadcastPerceptionClipSource: sessionId must be a non-empty string",
      );
    }
    if (!(config.clipBytes.byteLength > 0)) {
      throw new RangeError("createBroadcastPerceptionClipSource: clipBytes must be non-empty");
    }
    const seam = createBroadcastPerceptionSeam({
      sessionId: config.sessionId,
      ...(config.sourceId !== undefined ? { sourceId: config.sourceId } : {}),
      ...(config.baseLatencyMs !== undefined ? { baseLatencyMs: config.baseLatencyMs } : {}),
    });
    const detector = config.detector ?? new ContrastContextDetector();
    const tracker = config.tracker ?? new GreedyIouTrackerAdapter();

    const adapter = new FfmpegDecoderAdapter();
    const decoding = new DecodingService({ adapter });
    const decodeInput: DecodeSourceInput = {
      receipt: {
        sessionId: config.sessionId,
        sourceId: "broadcast-perception-clip",
        checksum: "0".repeat(64), // the in-process receipt convention (no store persistence here)
        container: "mp4",
        byteLength: config.clipBytes.byteLength,
        ingestedAtMs: 0,
        sourceKind: "file",
        filename: config.filename ?? "broadcast-clip.mp4",
      },
      authorizationPolicy: buildAuthorizationPolicy(),
      openBytes: async () => config.clipBytes,
    };
    const probe = await decoding.probe(decodeInput);
    const videoTrack = probe.tracks.find((track) => track.kind === "video");
    if (videoTrack === undefined) {
      throw new RangeError("createBroadcastPerceptionClipSource: the clip carries no video track");
    }
    const frames: NormalizedVideoFrame[] = [];
    for await (const frame of decoding.decodeVideo(decodeInput, videoTrack.streamIndex, {
      maxTotalBytes: 1024 * 1024 * 1024,
    })) {
      frames.push(frame);
    }
    if (frames.length === 0) {
      throw new RangeError("createBroadcastPerceptionClipSource: the clip decoded zero frames");
    }

    const detectionsPerFrame: DetectedBox[][] = [];
    let framesWithDetections = 0;
    let playerDetections = 0;
    for (const frame of frames) {
      const detections = await detector.detect(frame);
      detectionsPerFrame.push([...detections]);
      if (detections.length > 0) framesWithDetections += 1;
      playerDetections += detections.length;
    }

    const ballDetectionsPerFrame: DetectedBox[][] = [];
    if (config.ballDetector !== undefined) {
      for (const frame of frames) {
        const balls = await config.ballDetector.detect(frame);
        ballDetectionsPerFrame.push([...balls]);
      }
    }

    const tracking: PlayerTrackingResult = tracker.track(
      frames.map((frame, index) => ({ frame, detections: detectionsPerFrame[index]! })),
    );

    return new BroadcastPerceptionClipSource({
      seam,
      frames,
      trackedPerFrame: tracking.perFrame,
      ballDetectionsPerFrame,
      calibration: config.calibration,
      framesDecoded: frames.length,
      framesWithDetections,
      playerDetections,
      identitySwitches: tracking.identitySwitches,
      detectorId: detector.detectorId,
      trackerId: tracker.trackerId,
      nextFrameIndex: 0,
    });
  }

  /** The source's honest accounting (live). */
  stats(): BroadcastPerceptionSourceStats {
    return {
      ...this.state.seam.stats(),
      framesDecoded: this.state.framesDecoded,
      framesWithDetections: this.state.framesWithDetections,
      playerDetections: this.state.playerDetections,
      identitySwitches: this.state.identitySwitches,
      used: { detectorId: this.state.detectorId, trackerId: this.state.trackerId },
      exhausted: this.state.nextFrameIndex >= this.state.frames.length,
    };
  }

  /** The next planned arrival's ingest time (the bridge's pacing primitive). */
  plannedIngestTimeMs(): number | null {
    const { state } = this;
    if (state.nextFrameIndex >= state.frames.length) return null;
    const frame = state.frames[state.nextFrameIndex]!;
    return frame.presentationMs + state.seam.config.baseLatencyMs;
  }

  /**
   * The next frame's observation batch (or null at exhaustion). Every batch
   * parses against the frozen LiveObservation contract.
   */
  next(): LiveObservation | null {
    while (this.state.nextFrameIndex < this.state.frames.length) {
      const index = this.state.nextFrameIndex;
      const frame = this.state.frames[index]!;
      this.state.nextFrameIndex += 1;
      const batch = this.state.seam.observation(
        {
          frame,
          trackedPlayers: this.state.trackedPerFrame[index] ?? [],
          ...(this.state.ballDetectionsPerFrame.length > 0
            ? { ballDetections: this.state.ballDetectionsPerFrame[index] ?? [] }
            : {}),
          calibration: this.state.calibration,
        },
        index + 1,
      );
      if (batch === null) continue; // no rows this frame — counted, never faked
      return batch;
    }
    return null;
  }
}

/** Creates the clip-driven broadcast-perception live source (the async factory). */
export function createBroadcastPerceptionClipSource(
  config: BroadcastPerceptionClipSourceConfig,
): Promise<BroadcastPerceptionClipSource> {
  return BroadcastPerceptionClipSource.create(config);
}
