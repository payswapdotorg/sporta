/**
 * `RealToSwmPipeline` (R207): the ONE deterministic composition that turns a
 * real MP4 clip into canonical Sports World Model snapshots and events.
 *
 * COMPOSITION ORDER (documented; each stage's record is appended to the
 * degradation ledger in this order):
 *
 * 1. **decode** — the W102 boundary: `DecodingService` over the REAL
 *    `FfmpegDecoderAdapter` (bounded, honest limits; rights gate re-asserted
 *    fail-closed on every call). Fail-closed admission: empty/unrecognized
 *    bytes or a stream with no video track refuse with a typed error —
 *    never a partial fake pipeline.
 * 2. **detect** — the player-detection family chain (default:
 *    model-backed → heuristic-color). A candidate that cannot run refuses
 *    with its OWN documented failure class (probed on the first frame); the
 *    refusal is RECORDED and the next candidate runs — degradation, never a
 *    silent skip, never a faked success.
 * 3. **track** — the player-tracking family chain (default: greedy-iou, the
 *    W204 baseline) over the decode-ordered detection sequence; then the
 *    minimum-lifetime gate (tracks shorter than `minTrackFrames` frames are
 *    excluded from SWM projection and counted in the ledger).
 * 4. **ball** — the ball-detection family chain (model-backed → ball-blob),
 *    then the ball-tracking family chain (color-blob → nearest-box over the
 *    ball detections). Interpolated occlusion points are counted (honest
 *    W202 gap semantics).
 * 5. **calibrate** — the pitch-calibration family chain (line-based →
 *    homography-with-supplied-corners). A calibration refusal (e.g. no
 *    pitch-green region — beach sand, archival film) is recorded verbatim
 *    and the pipeline degrades to IMAGE-FRAME tracks (never a guessed
 *    mapping).
 * 6. **team** — the team-identity family (jersey-color, seeded): per-track
 *    assignments with explicit uncertainty (`unknown` is first-class).
 * 7. **bridge** — the observation bridge into a W005 store (track,
 *    field-mapping, team-assignment, and — config-gated — detection
 *    packets), confidence preserved verbatim (image frame) or discounted by
 *    the calibration confidence (pitch frame).
 * 8. **fuse** — the W401 `runWorldFusion` pass into a W006
 *    `WorldModelEngine` (football state initialized with documented
 *    no-evidence defaults so possession CAN be set when pitch evidence
 *    exists). The fusion report is carried verbatim.
 * 9. **emit** — the SWM timeline: canonical `football/v1/possession-change`
 *    events where pitch-space evidence supports them (W005
 *    EventDerivationService; evidence chains resolve in the store), the
 *    pipeline-level ball-impulse candidates (image-space honest statements),
 *    and snapshots at the configured cadence plus the final state.
 *
 * DETERMINISM: same clip + same config → byte-identical artifact content
 * hash. No wall-clock in the core (the clock is injected; default 0), no
 * unseeded randomness (the only RNG consumer takes its seed from the
 * config), every collection iterated in a deterministic order (sorted ids
 * or production order), and the canonical serializer sorts object keys.
 */
import { PITCH_LENGTH_AXIS_METERS, PITCH_WIDTH_AXIS_METERS } from "@sporta/contracts";
import type { WorldSnapshot, WorldEventStreamEntry } from "@sporta/contracts";
import { DecodingService, FfmpegDecoderAdapter, isDecodeError } from "@sporta/decoding";
import type { NormalizedVideoFrame } from "@sporta/decoding";
import { InMemoryObservationStore } from "@sporta/observation";
import type { ObservationStore } from "@sporta/observation";
import { EventDerivationService } from "@sporta/observation";
import {
  BallBlobDetector,
  ColorBlobBallTracker,
  GreedyIouTrackerAdapter,
  HeuristicColorDetector,
  HomographyFieldCalibratorAdapter,
  JerseyColorTeamAssigner,
  LineBasedFieldCalibrator,
  ModelBackedBallDetector,
  ModelBackedDetector,
  NearestBoxBallTrackerAdapter,
  TwoStageHungarianTracker,
  isPerceptionAdapterError,
} from "@sporta/perception-adapters";

/**
 * The documented failure class id of a perception-adapter refusal (both
 * `CandidateFailureError` and `InvalidAdapterInputError` carry it in their
 * structured details), or a clearly-labeled fallback marker.
 */
function failureClassOf(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "details" in error &&
    error.details !== null &&
    typeof error.details === "object"
  ) {
    const failureClassId = (error.details as Record<string, unknown>).failureClassId;
    if (typeof failureClassId === "string") return failureClassId;
  }
  return "adapter-refusal-without-failure-class";
}
import type {
  BallDetectionAdapter,
  BallTrack,
  BallTrackingAdapter,
  CalibrationResult,
  DetectionSequenceFrame,
  DetectedBox,
  DetectorFrameInput,
  PitchCalibrationAdapter,
  PlayerDetectionAdapter,
  PlayerTrackingAdapter,
  PlayerTrackingResult,
  TeamAssignment,
  TrackSequenceFrame,
  TrackedBox,
} from "@sporta/perception-adapters";
import { runWorldFusion } from "@sporta/fusion";
import type { FusionReport } from "@sporta/fusion";
import { WorldModelEngine } from "@sporta/world-model";
import { buildDecodeSourceInput, sniffAdmittedContainer, withSessionId } from "./clip";
import type { ClipSource } from "./clip";
import { resolveConfig } from "./config";
import type { RealToSwmPipelineConfig, ResolvedPipelineConfig } from "./config";
import {
  bridgeBallTracks,
  bridgeDetections,
  bridgeFieldMapping,
  bridgePlayerTracks,
  bridgeTeamAssignments,
} from "./bridge";
import {
  clusterImpulseCandidates,
  deriveBallImpulseCandidates,
  derivePossessionChangeInputs,
  samplePossession,
} from "./events";
import type { BallPointEvidence, EventCandidateRecord } from "./events";
import { PipelineAdmissionError } from "./errors";
import { StageRecordBuilder, buildLedger, summarizeConfidence } from "./ledger";
import type { AttemptedCandidate, DegradationLedger, PipelineStageId } from "./ledger";

// ---------------------------------------------------------------------------
// Candidate registry: technology id → zero-arg factory (the adapter plane's
// own default constructions; options pass-through arrives per family below).
// ---------------------------------------------------------------------------

const PLAYER_DETECTION_FACTORIES: Record<string, () => PlayerDetectionAdapter> = {
  "model-backed-detector": () => new ModelBackedDetector(),
  "heuristic-color-detector": () => new HeuristicColorDetector(),
};

const BALL_DETECTION_FACTORIES: Record<string, () => BallDetectionAdapter> = {
  "model-backed-ball-detector": () => new ModelBackedBallDetector(),
  "ball-blob-detector": () => new BallBlobDetector(),
};

const PLAYER_TRACKING_FACTORIES: Record<string, () => PlayerTrackingAdapter> = {
  "greedy-iou-tracker": () => new GreedyIouTrackerAdapter(),
  "hungarian-tracker": () => new TwoStageHungarianTracker(),
};

const BALL_TRACKING_FACTORIES: Record<string, () => BallTrackingAdapter> = {
  "color-blob-ball-tracker": () => new ColorBlobBallTracker(),
  "nearest-box-ball-tracker": () => new NearestBoxBallTrackerAdapter(),
};

const CALIBRATION_FACTORIES: Record<string, () => PitchCalibrationAdapter> = {
  "line-based-field-calibrator": () => new LineBasedFieldCalibrator(),
  "homography-field-calibrator": () => new HomographyFieldCalibratorAdapter(),
};

/** The plausible upper bound of humans in a football frame (22 players + officials). */
const PLAUSIBLE_PLAYER_ENVELOPE = 25;

/** How many frames the calibration stage subsamples (every Nth frame). */
const CALIBRATION_SUBSAMPLE_STRIDE = 25;

/** One resolved family candidate record (echoed into the artifact). */
export interface ResolvedCandidate {
  /** The perception family the candidate belongs to. */
  readonly family: string;
  /** The ordered chain as configured. */
  readonly chain: readonly string[];
  /** The candidate that produced the stage output (null when all refused). */
  readonly usedTechnologyId: string | null;
  /** The attempt outcomes in chain order (append-only). */
  readonly attempted: readonly AttemptedCandidate[];
}

/** Per-entity provenance carried into the artifact. */
export interface EntityProvenance {
  readonly entityId: string;
  readonly kind: "participant" | "ball";
  /** Number of observations supporting the entity. */
  readonly observationCount: number;
  readonly firstSeenMs: number;
  readonly lastSeenMs: number;
  readonly meanConfidence: number;
  readonly minConfidence: number;
  /** Producing component technology ids (sorted). */
  readonly producedBy: readonly string[];
  /** Team assignment when one exists (explicit uncertainty preserved). */
  readonly team?: { teamId: string; confidence: number; method: string };
}

/** The pipeline result: everything the artifact needs (plus live handles). */
export interface PipelineResult {
  readonly sessionId: string;
  /** The clip summary (identity + decode shape). */
  readonly clip: {
    readonly clipId: string;
    readonly filename: string;
    readonly byteLength: number;
    readonly contentSha256: string;
    readonly container: string;
    readonly durationMs: number;
    readonly frameCount: number;
    readonly width: number;
    readonly height: number;
    readonly fps: number;
    readonly firstFrameMs: number;
    readonly lastFrameMs: number;
  };
  readonly config: ResolvedPipelineConfig;
  readonly candidates: readonly ResolvedCandidate[];
  readonly ledger: DegradationLedger;
  readonly fusion: FusionReport;
  readonly snapshots: readonly WorldSnapshot[];
  readonly events: readonly WorldEventStreamEntry[];
  readonly eventCandidates: readonly EventCandidateRecord[];
  readonly provenance: readonly EntityProvenance[];
  readonly observationCounts: {
    readonly playerTracks: number;
    readonly ballTracks: number;
    readonly teamAssignments: number;
    readonly fieldMappings: number;
    readonly detections: number;
  };
  /** Live handles for evidence inspection (NOT part of the artifact). */
  readonly store: ObservationStore;
  readonly engine: WorldModelEngine;
}

/** Optional stage hooks (observability only — never part of the artifact). */
export interface PipelineHooks {
  onStageStart?: (stage: PipelineStageId, order: number) => void;
  onStageComplete?: (stage: PipelineStageId, order: number) => void;
}

/** The pipeline input: the real clip source plus the configuration. */
export interface RealToSwmPipelineInput {
  readonly source: ClipSource;
  readonly config: RealToSwmPipelineConfig;
}

const emptyHook: PipelineHooks = {};

/**
 * The R207 real-to-SWM pipeline. One instance per run (constructed per
 * clip; the composition is stateless between `run` calls only if the caller
 * reuses neither store nor engine — a fresh run builds fresh ones).
 */
export class RealToSwmPipeline {
  /** Runs the full composition. Deterministic for (clip bytes, config). */
  async run(
    input: RealToSwmPipelineInput,
    hooks: PipelineHooks = emptyHook,
  ): Promise<PipelineResult> {
    const config = resolveConfig(input.config);
    const resolvedCornerSet = input.config.calibrationCornerSet;
    const source = input.source;
    const stageRecords: import("./ledger").PipelineStageRecord[] = [];
    let order = 0;
    const beginStage = (stage: PipelineStageId): StageRecordBuilder => {
      order += 1;
      hooks.onStageStart?.(stage, order);
      return new StageRecordBuilder(stage, order);
    };
    const endStage = (
      builder: StageRecordBuilder,
      framesIn: number,
      framesOut: number,
      itemsOut: number,
      confidence?: import("./ledger").ConfidenceSummary,
    ): void => {
      stageRecords.push(builder.build(framesIn, framesOut, itemsOut, confidence));
      hooks.onStageComplete?.(builder.stage, builder.order);
    };

    // ------------------------------------------------------------------ 1. decode
    const decodeBuilder = beginStage("decode");
    decodeBuilder.note(
      `decode budget ${config.decode.maxTotalBytes} bytes` +
        (config.decode.fromMs !== undefined ? ` from ${config.decode.fromMs}ms` : "") +
        (config.decode.toMs !== undefined ? ` to ${config.decode.toMs}ms` : ""),
    );
    const admission = buildDecodeSourceInput(source, config.nowMs);
    const decodeInput = withSessionId(admission.input, config.sessionId);
    const adapter = new FfmpegDecoderAdapter();
    const decoding = new DecodingService({ adapter });
    // Typed W102 refusals (rights/limits/media) propagate unchanged.
    const probe = await decoding.probe(decodeInput);
    const videoTrack = probe.tracks.find((track) => track.kind === "video");
    if (videoTrack === undefined) {
      throw new PipelineAdmissionError(
        "clip carries no video track — refusing to run a fake pipeline",
        { clipId: source.provenance.clipId, trackCount: probe.tracks.length },
      );
    }
    const frames: NormalizedVideoFrame[] = [];
    try {
      for await (const frame of decoding.decodeVideo(decodeInput, videoTrack.streamIndex, {
        ...(config.decode.fromMs !== undefined ? { fromMs: config.decode.fromMs } : {}),
        ...(config.decode.toMs !== undefined ? { toMs: config.decode.toMs } : {}),
        maxTotalBytes: config.decode.maxTotalBytes,
      })) {
        frames.push(frame);
      }
    } catch (error) {
      if (isDecodeError(error)) {
        decodeBuilder.degrade(
          "candidate-refused",
          frames.length,
          `decode refused: ${error.message}`,
        );
      }
      throw error;
    }
    if (frames.length === 0) {
      throw new PipelineAdmissionError(
        "decode yielded zero frames — refusing to run a fake pipeline",
        { clipId: source.provenance.clipId, window: config.decode },
      );
    }
    const firstFrameMs = frames[0]!.presentationMs;
    const lastFrameMs = frames[frames.length - 1]!.presentationMs;
    // Honest fps: the mean frame spacing over the decoded span (frames - 1
    // gaps); a single-frame decode reports the probe track duration instead.
    const gaps = Math.max(frames.length - 1, 1);
    const meanSpacingMs = Math.max((lastFrameMs - firstFrameMs) / gaps, 1e-6);
    const fps = Math.round((1000 / meanSpacingMs) * 1000) / 1000;
    const width = frames[0]!.width;
    const height = frames[0]!.height;
    decodeBuilder.note(
      `decoded ${frames.length} frames @ ${width}x${height}, presentation ` +
        `${firstFrameMs}..${lastFrameMs}ms (fps ${fps})`,
    );
    endStage(decodeBuilder, frames.length, frames.length, frames.length);

    const frameInputs: DetectorFrameInput[] = frames;

    // ------------------------------------------------------------------ 2. detect
    const detectBuilder = beginStage("detect");
    const detectionOutcomes: AttemptedCandidate[] = [];
    let playerDetector: PlayerDetectionAdapter | undefined;
    let usedDetectionId: string | null = null;
    for (const technologyId of config.playerDetection) {
      const factory = PLAYER_DETECTION_FACTORIES[technologyId];
      if (factory === undefined) {
        throw new RangeError(
          `RealToSwmPipeline: unknown player-detection candidate "${technologyId}" ` +
            "(known: model-backed-detector, heuristic-color-detector)",
        );
      }
      const candidate = factory();
      const descriptor = candidate.descriptor;
      try {
        candidate.detect(frameInputs[0]!);
        playerDetector = candidate;
        usedDetectionId = technologyId;
        const outcome: AttemptedCandidate = {
          technologyId,
          adapterVersion: descriptor.adapterVersion,
          outcome: "used",
        };
        detectionOutcomes.push(outcome);
        detectBuilder.attempt(outcome);
        break;
      } catch (error) {
        if (isPerceptionAdapterError(error)) {
          const outcome: AttemptedCandidate = {
            technologyId,
            adapterVersion: descriptor.adapterVersion,
            outcome: "unavailable",
            failureClassId: failureClassOf(error),
          };
          detectionOutcomes.push(outcome);
          detectBuilder.attempt(outcome);
          detectBuilder.degrade(
            "candidate-unavailable",
            1,
            `player-detection candidate "${technologyId}" unavailable: ` +
              `${failureClassOf(error)} (${error.message})`,
          );
          continue;
        }
        throw error;
      }
    }
    if (playerDetector === undefined || usedDetectionId === null) {
      throw new PipelineAdmissionError("no player-detection candidate could run on this clip", {
        chain: config.playerDetection,
      });
    }
    if (usedDetectionId !== config.playerDetection[0]) {
      detectBuilder.degrade(
        "candidate-fallback",
        1,
        `player detection fell back from "${config.playerDetection[0]}" to "${usedDetectionId}"`,
      );
    }
    const detectionsPerFrame: DetectedBox[][] = [];
    const detectionConfidences: number[] = [];
    let framesWithoutDetection = 0;
    const framesWithoutDetectionIds: string[] = [];
    let totalDetections = 0;
    let overEnvelopeFrames = 0;
    for (const frame of frameInputs) {
      const detections = await playerDetector.detect(frame);
      detectionsPerFrame.push([...detections]);
      totalDetections += detections.length;
      if (detections.length === 0) {
        framesWithoutDetection += 1;
        framesWithoutDetectionIds.push(frame.frameId);
      }
      if (detections.length > PLAUSIBLE_PLAYER_ENVELOPE) overEnvelopeFrames += 1;
      for (const detection of detections) detectionConfidences.push(detection.confidence);
    }
    if (framesWithoutDetection > 0) {
      detectBuilder.degrade(
        "frame-without-output",
        framesWithoutDetection,
        `${framesWithoutDetection} frame(s) produced no player detection (detector ` +
          `"${usedDetectionId}"; the detector's own documented limits apply)`,
        framesWithoutDetectionIds,
      );
    }
    if (overEnvelopeFrames > 0) {
      detectBuilder.degrade(
        "off-envelope-detection",
        overEnvelopeFrames,
        `${overEnvelopeFrames} frame(s) exceeded the plausible-player envelope ` +
          `(${PLAUSIBLE_PLAYER_ENVELOPE}/frame): the heuristic candidate's documented ` +
          "off-envelope degradation (heuristic-color.off-envelope-frame) — detections " +
          "carried with their honest confidences, never filtered to look plausible",
      );
    }
    detectBuilder.note(
      `mean detections/frame ${(totalDetections / frames.length).toFixed(2)} ` +
        `over ${frames.length} frames`,
    );
    endStage(
      detectBuilder,
      frames.length,
      frames.length - framesWithoutDetection,
      totalDetections,
      summarizeConfidence(detectionConfidences),
    );

    const detectionSequence: DetectionSequenceFrame[] = frameInputs.map((frame, index) => ({
      frame,
      detections: detectionsPerFrame[index]!,
    }));

    // ------------------------------------------------------------------ 3. track
    const trackBuilder = beginStage("track");
    const trackOutcomes: AttemptedCandidate[] = [];
    let trackingResult: PlayerTrackingResult | undefined;
    let usedTrackingId: string | null = null;
    for (const technologyId of config.playerTracking) {
      const factory = PLAYER_TRACKING_FACTORIES[technologyId];
      if (factory === undefined) {
        throw new RangeError(
          `RealToSwmPipeline: unknown player-tracking candidate "${technologyId}" ` +
            "(known: greedy-iou-tracker, hungarian-tracker)",
        );
      }
      const candidate = factory();
      try {
        trackingResult = candidate.track(detectionSequence);
        usedTrackingId = technologyId;
        const outcome: AttemptedCandidate = {
          technologyId,
          adapterVersion: candidate.descriptor.adapterVersion,
          outcome: "used",
        };
        trackOutcomes.push(outcome);
        trackBuilder.attempt(outcome);
        break;
      } catch (error) {
        if (isPerceptionAdapterError(error)) {
          const outcome: AttemptedCandidate = {
            technologyId,
            adapterVersion: candidate.descriptor.adapterVersion,
            outcome: "refused",
            failureClassId: failureClassOf(error),
          };
          trackOutcomes.push(outcome);
          trackBuilder.attempt(outcome);
          trackBuilder.degrade(
            "candidate-refused",
            1,
            `player-tracking candidate "${technologyId}" refused: ${failureClassOf(error)}`,
          );
          continue;
        }
        throw error;
      }
    }
    if (trackingResult === undefined || usedTrackingId === null) {
      throw new PipelineAdmissionError("no player-tracking candidate could run on this clip", {
        chain: config.playerTracking,
      });
    }
    // Minimum-lifetime gate.
    const lifetimePerTrack = new Map<string, number>();
    for (const perFrame of trackingResult.perFrame) {
      for (const box of perFrame) {
        lifetimePerTrack.set(box.trackId, (lifetimePerTrack.get(box.trackId) ?? 0) + 1);
      }
    }
    const droppedTrackIds = [...lifetimePerTrack.entries()]
      .filter(([, lifetime]) => lifetime < config.minTrackFrames)
      .map(([trackId]) => trackId)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const survivingTrackIds = new Set(
      [...lifetimePerTrack.entries()]
        .filter(([, lifetime]) => lifetime >= config.minTrackFrames)
        .map(([trackId]) => trackId),
    );
    if (droppedTrackIds.length > 0) {
      trackBuilder.degrade(
        "short-track-dropped",
        droppedTrackIds.length,
        `${droppedTrackIds.length} track(s) below the minimum lifetime ` +
          `(${config.minTrackFrames} frames) excluded from SWM projection — ` +
          "per-frame detections remain summarized in the detect stage record",
        droppedTrackIds,
      );
    }
    const trackedPerFrame: TrackedBox[][] = trackingResult.perFrame.map((perFrame) =>
      perFrame.filter((box) => survivingTrackIds.has(box.trackId)),
    );
    let framesWithoutTracked = 0;
    const trackedConfidences: number[] = [];
    for (const perFrame of trackedPerFrame) {
      if (perFrame.length === 0) framesWithoutTracked += 1;
      for (const box of perFrame) trackedConfidences.push(box.confidence);
    }
    if (trackingResult.identitySwitches > 0) {
      trackBuilder.note(
        `apparent identity switches (adapter criterion): ${trackingResult.identitySwitches}`,
      );
    }
    trackBuilder.note(
      `tracks total ${lifetimePerTrack.size}, surviving >= ${config.minTrackFrames} frames: ` +
        `${survivingTrackIds.size}`,
    );
    endStage(
      trackBuilder,
      frames.length,
      frames.length - framesWithoutTracked,
      trackedConfidences.length,
      summarizeConfidence(trackedConfidences),
    );

    // ------------------------------------------------------------------ 4. ball
    const ballBuilder = beginStage("ball");
    // 4a. ball detection family (evidence layer; feeds the nearest-box tracker).
    const ballDetectOutcomes: AttemptedCandidate[] = [];
    let ballDetector: BallDetectionAdapter | undefined;
    let usedBallDetectionId: string | null = null;
    for (const technologyId of config.ballDetection) {
      const factory = BALL_DETECTION_FACTORIES[technologyId];
      if (factory === undefined) {
        throw new RangeError(
          `RealToSwmPipeline: unknown ball-detection candidate "${technologyId}" ` +
            "(known: model-backed-ball-detector, ball-blob-detector)",
        );
      }
      const candidate = factory();
      try {
        candidate.detect(frameInputs[0]!);
        ballDetector = candidate;
        usedBallDetectionId = technologyId;
        const outcome: AttemptedCandidate = {
          technologyId,
          adapterVersion: candidate.descriptor.adapterVersion,
          outcome: "used",
        };
        ballDetectOutcomes.push(outcome);
        ballBuilder.attempt(outcome);
        break;
      } catch (error) {
        if (isPerceptionAdapterError(error)) {
          const outcome: AttemptedCandidate = {
            technologyId,
            adapterVersion: candidate.descriptor.adapterVersion,
            outcome: "unavailable",
            failureClassId: failureClassOf(error),
          };
          ballDetectOutcomes.push(outcome);
          ballBuilder.attempt(outcome);
          ballBuilder.degrade(
            "candidate-unavailable",
            1,
            `ball-detection candidate "${technologyId}" unavailable: ${failureClassOf(error)}`,
          );
          continue;
        }
        throw error;
      }
    }
    const ballDetectionsPerFrame: DetectedBox[][] = [];
    const ballDetectionConfidences: number[] = [];
    if (ballDetector !== undefined && usedBallDetectionId !== null) {
      for (const frame of frameInputs) {
        const detections = await ballDetector.detect(frame);
        ballDetectionsPerFrame.push([...detections]);
        for (const detection of detections) ballDetectionConfidences.push(detection.confidence);
      }
    }
    // 4b. ball tracking family.
    const ballTrackOutcomes: AttemptedCandidate[] = [];
    let ballTracks: BallTrack[] | undefined;
    let usedBallTrackingId: string | null = null;
    const ballSequence: DetectionSequenceFrame[] = frameInputs.map((frame, index) => ({
      frame,
      detections: ballDetectionsPerFrame[index] ?? [],
    }));
    for (const technologyId of config.ballTracking) {
      const factory = BALL_TRACKING_FACTORIES[technologyId];
      if (factory === undefined) {
        throw new RangeError(
          `RealToSwmPipeline: unknown ball-tracking candidate "${technologyId}" ` +
            "(known: color-blob-ball-tracker, nearest-box-ball-tracker)",
        );
      }
      const candidate = factory();
      try {
        ballTracks = candidate.track(ballSequence);
        usedBallTrackingId = technologyId;
        const ballOutcome: AttemptedCandidate = {
          technologyId,
          adapterVersion: candidate.descriptor.adapterVersion,
          outcome: "used",
        };
        ballTrackOutcomes.push(ballOutcome);
        ballBuilder.attempt(ballOutcome);
        break;
      } catch (error) {
        if (isPerceptionAdapterError(error)) {
          const ballOutcome: AttemptedCandidate = {
            technologyId,
            adapterVersion: candidate.descriptor.adapterVersion,
            outcome: "refused",
            failureClassId: failureClassOf(error),
          };
          ballTrackOutcomes.push(ballOutcome);
          ballBuilder.attempt(ballOutcome);
          ballBuilder.degrade(
            "candidate-refused",
            1,
            `ball-tracking candidate "${technologyId}" refused: ${failureClassOf(error)}`,
          );
          continue;
        }
        throw error;
      }
    }
    if (ballTracks === undefined || usedBallTrackingId === null) {
      ballBuilder.degrade(
        "candidate-unavailable",
        frames.length,
        "no ball-tracking candidate produced a ball track — the SWM carries no ball entity",
      );
      ballTracks = [];
    }
    let ballPointCount = 0;
    let interpolatedPoints = 0;
    let detectedPoints = 0;
    const ballConfidences: number[] = [];
    for (const track of ballTracks) {
      for (const point of track.points) {
        if (point.box === undefined) continue;
        ballPointCount += 1;
        ballConfidences.push(point.confidence);
        if (point.source === "interpolated") interpolatedPoints += 1;
        else detectedPoints += 1;
      }
    }
    if (interpolatedPoints > 0) {
      ballBuilder.degrade(
        "interpolated-ball-point",
        interpolatedPoints,
        `${interpolatedPoints} ball point(s) interpolated across occlusion gaps ` +
          "(W202 honest semantics: discounted confidence, never extrapolated edges)",
      );
    }
    const frameIndexByPresentationMs = new Map<number, number>();
    for (const [index, frame] of frames.entries()) {
      frameIndexByPresentationMs.set(frame.presentationMs, index);
    }
    const framesWithBallPoint = new Set<number>();
    for (const track of ballTracks) {
      for (const point of track.points) {
        const frameIndex = frameIndexByPresentationMs.get(point.presentationMs);
        if (frameIndex !== undefined) framesWithBallPoint.add(frameIndex);
      }
    }
    ballBuilder.note(
      `ball detections/frame mean ` +
        `${(ballDetectionConfidences.length / frames.length).toFixed(2)} ` +
        `(candidate ${usedBallDetectionId ?? "none"}); ball tracks ${ballTracks.length} ` +
        `(${detectedPoints} detected + ${interpolatedPoints} interpolated points) ` +
        `from ${usedBallTrackingId ?? "none"}`,
    );
    endStage(
      ballBuilder,
      frames.length,
      framesWithBallPoint.size,
      ballPointCount,
      summarizeConfidence(ballConfidences),
    );

    // ------------------------------------------------------------------ 5. calibrate
    const calibrateBuilder = beginStage("calibrate");
    const calibrationSubsample = frameInputs.filter(
      (_, index) => index % CALIBRATION_SUBSAMPLE_STRIDE === 0,
    );
    const calibrationOutcomes: AttemptedCandidate[] = [];
    let calibration: CalibrationResult | undefined;
    let usedCalibrationId: string | null = null;
    for (const technologyId of config.calibration) {
      const factory = CALIBRATION_FACTORIES[technologyId];
      if (factory === undefined) {
        throw new RangeError(
          `RealToSwmPipeline: unknown calibration candidate "${technologyId}" ` +
            "(known: line-based-field-calibrator, homography-field-calibrator)",
        );
      }
      const candidate = factory();
      try {
        const calibratorInput =
          technologyId === "homography-field-calibrator" && resolvedCornerSet !== undefined
            ? { frames: calibrationSubsample, cornerSet: resolvedCornerSet }
            : { frames: calibrationSubsample };
        calibration = candidate.calibrate(calibratorInput);
        usedCalibrationId = technologyId;
        const outcome: AttemptedCandidate = {
          technologyId,
          adapterVersion: candidate.descriptor.adapterVersion,
          outcome: "used",
        };
        calibrationOutcomes.push(outcome);
        calibrateBuilder.attempt(outcome);
        break;
      } catch (error) {
        if (isPerceptionAdapterError(error)) {
          const outcome: AttemptedCandidate = {
            technologyId,
            adapterVersion: candidate.descriptor.adapterVersion,
            outcome: "refused",
            failureClassId: failureClassOf(error),
          };
          calibrationOutcomes.push(outcome);
          calibrateBuilder.attempt(outcome);
          calibrateBuilder.degrade(
            "candidate-refused",
            1,
            `calibration candidate "${technologyId}" refused: ${failureClassOf(error)} ` +
              `(${error.message})`,
          );
          continue;
        }
        throw error;
      }
    }
    if (calibration === undefined || usedCalibrationId === null) {
      calibrateBuilder.degrade(
        "calibration-unavailable",
        1,
        "no calibration candidate could calibrate this footage — track positions stay in " +
          "the IMAGE frame (possession semantics unavailable; recorded, never guessed)",
      );
    } else {
      calibrateBuilder.note(
        `calibrated via ${usedCalibrationId}: confidence ` +
          `${calibration.confidence.toFixed(3)}, ${calibration.correspondenceCount} anchors`,
      );
    }
    endStage(
      calibrateBuilder,
      calibrationSubsample.length,
      calibration !== undefined ? 1 : 0,
      calibration !== undefined ? 1 : 0,
      calibration !== undefined ? summarizeConfidence([calibration.confidence]) : undefined,
    );

    // ------------------------------------------------------------------ 6. team
    const teamBuilder = beginStage("team");
    const assigner = new JerseyColorTeamAssigner({
      seed: config.teamSeed,
    });
    const trackSequenceFrames: TrackSequenceFrame[] = frameInputs.map((frame, index) => ({
      frame,
      tracked: trackedPerFrame[index] ?? [],
    }));
    let assignments: readonly TeamAssignment[] = [];
    const teamOutcomes: AttemptedCandidate[] = [];
    try {
      assignments = assigner.assign(trackSequenceFrames);
      const teamOutcome: AttemptedCandidate = {
        technologyId: "jersey-color-team-assigner",
        adapterVersion: assigner.descriptor.adapterVersion,
        outcome: "used",
      };
      teamOutcomes.push(teamOutcome);
      teamBuilder.attempt(teamOutcome);
    } catch (error) {
      if (isPerceptionAdapterError(error)) {
        const teamOutcome: AttemptedCandidate = {
          technologyId: "jersey-color-team-assigner",
          adapterVersion: assigner.descriptor.adapterVersion,
          outcome: "refused",
          failureClassId: failureClassOf(error),
        };
        teamOutcomes.push(teamOutcome);
        teamBuilder.attempt(teamOutcome);
        teamBuilder.degrade(
          "candidate-refused",
          1,
          `team-identity candidate refused: ${failureClassOf(error)} — no team assignments ` +
            "carried into the artifact",
        );
      } else {
        throw error;
      }
    }
    const assignmentsByTrack = new Map<string, TeamAssignment>();
    const teamConfidences: number[] = [];
    let unknownAssignments = 0;
    for (const assignment of assignments) {
      assignmentsByTrack.set(assignment.trackId, assignment);
      teamConfidences.push(assignment.confidence);
      if (assignment.teamId === "unknown") unknownAssignments += 1;
    }
    let framesWithTrackedBoxes = 0;
    for (const perFrame of trackedPerFrame) {
      if (perFrame.length > 0) framesWithTrackedBoxes += 1;
    }
    teamBuilder.note(
      `${assignments.length} track assignment(s): ` +
        `${assignments.length - unknownAssignments} team-labeled, ${unknownAssignments} ` +
        "unknown (explicit uncertainty — the jersey-color method's honest output)",
    );
    endStage(
      teamBuilder,
      trackSequenceFrames.length,
      framesWithTrackedBoxes,
      assignments.length,
      summarizeConfidence(teamConfidences),
    );

    // ------------------------------------------------------------------ 7. bridge
    const bridgeBuilder = beginStage("bridge");
    const store: ObservationStore = new InMemoryObservationStore();
    const bridgeCtx = { store, sessionId: config.sessionId, nowMs: config.nowMs };
    if (calibration !== undefined && usedCalibrationId !== null) {
      bridgeFieldMapping(bridgeCtx, calibration, usedCalibrationId, firstFrameMs);
    }
    const playerBridge = bridgePlayerTracks(
      bridgeCtx,
      detectionSequence,
      trackedPerFrame,
      usedTrackingId,
      calibration,
    );
    const framesByPresentationMs = new Map<number, { frameId: string; decodeOrder: number }>();
    for (const frame of frames) {
      framesByPresentationMs.set(frame.presentationMs, {
        frameId: frame.frameId,
        decodeOrder: frame.decodeOrder,
      });
    }
    const ballBridge = bridgeBallTracks(
      bridgeCtx,
      ballTracks,
      usedBallTrackingId ?? "no-ball-tracker",
      framesByPresentationMs,
      calibration,
    );
    bridgeTeamAssignments(bridgeCtx, assignments, assigner.assignerId);
    let bridgedDetections = 0;
    if (config.bridgeDetections) {
      const summary = bridgeDetections(
        bridgeCtx,
        detectionSequence,
        playerDetector.detectorId,
        ballDetector?.detectorId,
        ballDetectionsPerFrame,
      );
      bridgedDetections = summary.detectionObservations;
    } else {
      bridgeBuilder.degrade(
        "detection-observations-not-bridged",
        totalDetections,
        `${totalDetections} raw detection(s) NOT bridged as observations (config default: ` +
          "track observations carry the per-entity evidence; detection counts and " +
          "confidence summaries live in the ledger)",
      );
    }
    if (playerBridge.droppedInfinite > 0) {
      bridgeBuilder.degrade(
        "off-pitch-projection",
        playerBridge.droppedInfinite,
        `${playerBridge.droppedInfinite} track projection(s) at infinity dropped ` +
          "(degenerate homography denominator — recorded, never clamped)",
      );
    }
    if (playerBridge.offPitch + ballBridge.offPitch > 0) {
      bridgeBuilder.degrade(
        "off-pitch-projection",
        playerBridge.offPitch + ballBridge.offPitch,
        `${playerBridge.offPitch + ballBridge.offPitch} projected position(s) landed outside ` +
          "the canonical pitch bounds — carried flagged, never clamped",
      );
    }
    const bridgeConfidences: number[] = [];
    for (const observation of store.all()) {
      if (observation.confidence !== undefined) bridgeConfidences.push(observation.confidence);
    }
    const observationCounts = {
      playerTracks: playerBridge.summary.playerTrackObservations,
      ballTracks: ballBridge.summary.ballTrackObservations,
      teamAssignments: assignments.length,
      fieldMappings: calibration !== undefined ? 1 : 0,
      detections: bridgedDetections,
    };
    endStage(
      bridgeBuilder,
      frames.length,
      frames.length,
      store.count(),
      summarizeConfidence(bridgeConfidences),
    );

    // ------------------------------------------------------------------ 8. fuse
    const fuseBuilder = beginStage("fuse");
    const trackFrame = calibration !== undefined ? "pitch" : "image";
    if (calibration === undefined) {
      fuseBuilder.note(
        "track frame: image (no calibration) — W401 possession semantics require pitch meters",
      );
    } else {
      fuseBuilder.note(
        `track frame: pitch (calibrated via ${usedCalibrationId}, confidence ` +
          `${calibration.confidence.toFixed(3)})`,
      );
    }
    const engine = WorldModelEngine.create(config.sessionId, {
      now: () => config.nowMs,
      football: {
        pitch: {
          lengthAxisMeters: PITCH_LENGTH_AXIS_METERS,
          widthAxisMeters: PITCH_WIDTH_AXIS_METERS,
          origin: "corner",
          axes: "x=touchline, y=goal-line",
        },
        clock: { period: "pre-match", clockMs: 0, stoppage: false },
        score: { home: 0, away: 0, status: { status: "unknown" } },
        possession: { status: "unknown" },
        eventTaxonomyVersion: "v1",
      },
    });
    fuseBuilder.degrade(
      "football-state-defaults",
      1,
      "football state initialized with no-evidence defaults (clock pre-match/0, score 0-0 " +
        "status unknown, possession unknown) — the clip carries no match metadata; slots " +
        "fill only from fusion evidence",
    );
    const fusion = runWorldFusion({
      store,
      engine,
      sessionId: config.sessionId,
      trackFrame,
      possessionRadiusM: config.possessionRadiusM,
    });
    for (const warning of fusion.warnings) {
      fuseBuilder.note(`fusion warning: ${warning}`);
    }
    endStage(
      fuseBuilder,
      frames.length,
      fusion.entitiesUpserted,
      fusion.entitiesUpserted + fusion.eventsApplied + fusion.possessionUpdates,
    );

    // ------------------------------------------------------------------ 9. emit
    const emitBuilder = beginStage("emit");
    // 9a. possession-change canonical events (pitch space only).
    let eventCandidates: EventCandidateRecord[] = [];
    if (trackFrame === "pitch") {
      const allObservations = store.all();
      const pitchBallObservations = allObservations.filter(
        (obs) =>
          obs.payload.kind === "track" && obs.subjectEntityRefs.some((ref) => ref.kind === "ball"),
      );
      const pitchParticipantObservations = allObservations.filter(
        (obs) =>
          obs.payload.kind === "track" &&
          obs.subjectEntityRefs.some((ref) => ref.kind === "participant"),
      );
      const samples = samplePossession(
        pitchBallObservations,
        pitchParticipantObservations,
        config.possessionRadiusM,
      );
      const derivationInputs = derivePossessionChangeInputs(samples, config.possessionRadiusM);
      const derivation = new EventDerivationService(store);
      let appliedPossessionEvents = 0;
      for (const derived of derivationInputs) {
        const envelope = derivation.deriveEvent({
          sessionId: config.sessionId,
          eventId: derived.eventId,
          eventTypeRef: "football/v1/possession-change",
          interval: { startTimeMs: derived.eventTimeMs, endTimeMs: derived.eventTimeMs },
          eventTimeMs: derived.eventTimeMs,
          evidence: { observationIds: [...derived.evidence], reportedBy: "vision-fusion" },
          confidence: derived.confidence,
        });
        engine.applyEvent(envelope);
        appliedPossessionEvents += 1;
      }
      emitBuilder.note(
        `possession-change events applied: ${appliedPossessionEvents} ` +
          `(evidence-resolved through the W005 derivation service)`,
      );
    } else {
      emitBuilder.degrade(
        "event-semantics-unavailable",
        1,
        "possession-change events NOT derived: no pitch calibration, and possession is a " +
          "pitch-meters concept (the W401 rule) — image-frame runs emit no possession claims",
      );
    }
    // 9b. ball-impulse candidates (image-space honest statements).
    const detectedBallEvidence: BallPointEvidence[] = ballBridge.detectedPointEvidence
      .filter((point) => point.source === "detected")
      .map((point) => ({
        observationId: point.observationId,
        presentationMs: point.presentationMs,
        x: point.x,
        y: point.y,
        confidence: point.confidence,
      }));
    const rawImpulseCandidates = deriveBallImpulseCandidates(
      detectedBallEvidence,
      config.ballImpulse,
    );
    const clustered = clusterImpulseCandidates(
      rawImpulseCandidates,
      config.ballImpulse.clusterWindowMs,
    );
    eventCandidates = clustered.kept;
    if (clustered.suppressed > 0) {
      emitBuilder.note(
        `impulse non-max suppression: ${clustered.suppressed} raw candidate(s) inside ` +
          `${config.ballImpulse.clusterWindowMs}ms cluster windows suppressed ` +
          "(highest-confidence member kept per cluster — deterministic)",
      );
    }
    if (eventCandidates.length > 0) {
      emitBuilder.note(
        `ball-impulse candidates: ${eventCandidates.length} of ${rawImpulseCandidates.length} ` +
          "raw (image-space motion evidence only — typed candidates with evidence chains, " +
          "NOT canonical football events)",
      );
    } else {
      emitBuilder.note("ball-impulse candidates: 0 (no gated discontinuity in the ball track)");
    }
    // 9c. snapshots at the configured cadence plus the final state.
    const snapshots: WorldSnapshot[] = [];
    for (
      let atMs = config.snapshotCadenceMs;
      atMs <= lastFrameMs;
      atMs += config.snapshotCadenceMs
    ) {
      snapshots.push(engine.snapshot(atMs));
    }
    snapshots.push(engine.snapshot());
    const events = engine.eventsSince(0);
    emitBuilder.note(
      `emitted ${snapshots.length} snapshot(s) (cadence ${config.snapshotCadenceMs}ms + final) ` +
        `and ${events.length} engine event(s)`,
    );
    const eventConfidences = events
      .map((entry) => entry.event.confidence)
      .filter((confidence): confidence is number => confidence !== undefined);
    endStage(
      emitBuilder,
      frames.length,
      snapshots.length,
      snapshots.length + events.length + eventCandidates.length,
      summarizeConfidence([...eventConfidences, ...eventCandidates.map((c) => c.confidence)]),
    );

    // ------------------------------------------------------------------ provenance
    const provenance: EntityProvenance[] = [];
    const trackKinds: {
      ids: Map<string, string[]>;
      kind: "participant" | "ball";
      producer: string;
    }[] = [
      { ids: playerBridge.observationIdsByTrack, kind: "participant", producer: usedTrackingId },
      {
        ids: ballBridge.observationsByTrackId,
        kind: "ball",
        producer: usedBallTrackingId ?? "none",
      },
    ];
    for (const { ids, kind, producer } of trackKinds) {
      for (const [trackId, observationIds] of [...ids.entries()].sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
      )) {
        const observations = observationIds
          .map((id) => store.byId(id))
          .filter((obs): obs is NonNullable<typeof obs> => obs !== undefined);
        if (observations.length === 0) continue;
        const confidences = observations
          .map((obs) => obs.confidence)
          .filter((confidence): confidence is number => confidence !== undefined);
        const assignment = assignmentsByTrack.get(trackId);
        provenance.push({
          entityId: trackId,
          kind,
          observationCount: observations.length,
          firstSeenMs: observations[0]!.eventTimeMs,
          lastSeenMs: observations[observations.length - 1]!.eventTimeMs,
          meanConfidence:
            confidences.length > 0
              ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
              : 0,
          minConfidence: confidences.length > 0 ? Math.min(...confidences) : 0,
          producedBy:
            kind === "participant"
              ? [
                  producer,
                  ...(assignment !== undefined ? ["jersey-color-team-assigner"] : []),
                ].sort()
              : [producer],
          ...(assignment !== undefined
            ? {
                team: {
                  teamId: assignment.teamId,
                  confidence: assignment.confidence,
                  method: assignment.method,
                },
              }
            : {}),
        });
      }
    }
    provenance.sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));

    const ledger = buildLedger(stageRecords);
    const candidates: ResolvedCandidate[] = [
      {
        family: "perception.player-detection",
        chain: config.playerDetection,
        usedTechnologyId: usedDetectionId,
        attempted: detectionOutcomes,
      },
      {
        family: "perception.player-tracking",
        chain: config.playerTracking,
        usedTechnologyId: usedTrackingId,
        attempted: trackOutcomes,
      },
      {
        family: "perception.ball-detection",
        chain: ["model-backed-ball-detector", "ball-blob-detector"],
        usedTechnologyId: usedBallDetectionId,
        attempted: ballDetectOutcomes,
      },
      {
        family: "perception.ball-tracking",
        chain: config.ballTracking,
        usedTechnologyId: usedBallTrackingId,
        attempted: ballTrackOutcomes,
      },
      {
        family: "perception.pitch-calibration",
        chain: config.calibration,
        usedTechnologyId: usedCalibrationId,
        attempted: calibrationOutcomes,
      },
      {
        family: "perception.team-identity",
        chain: ["jersey-color-team-assigner"],
        usedTechnologyId: teamOutcomes[0]?.outcome === "used" ? "jersey-color-team-assigner" : null,
        attempted: teamOutcomes,
      },
    ];

    return {
      sessionId: config.sessionId,
      clip: {
        clipId: source.provenance.clipId,
        filename: source.filename ?? `${source.provenance.clipId}.mp4`,
        byteLength: source.bytes.byteLength,
        contentSha256: admission.contentSha256,
        container: sniffAdmittedContainer(source.bytes),
        durationMs: videoTrack.durationMs,
        frameCount: frames.length,
        width,
        height,
        fps,
        firstFrameMs,
        lastFrameMs,
      },
      config,
      candidates,
      ledger,
      fusion,
      snapshots,
      events,
      eventCandidates,
      provenance,
      observationCounts,
      store,
      engine,
    };
  }
}
