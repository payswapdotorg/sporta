/**
 * The observation bridge (R207 stage 7): perception outputs → observation
 * packets appended to a W005 `ObservationStore`. CONSUMES the existing
 * bridge shapes — the frozen `Observation` contract payloads (detection,
 * track, field-mapping, team-assignment) — and never re-declares them. The
 * store's own `append` validates every packet against the zod contract
 * (fail-closed on any malformed bridge output).
 *
 * EVIDENCE DISCIPLINE: every track observation carries the producing
 * component id, the perception confidence VERBATIM (no silent collapse,
 * architecture-lock §6), and — when positions were projected to pitch space
 * through the calibration homography — a confidence DISCOUNTED by the
 * calibration confidence (projected positions are inference, and the
 * observation never claims detection-grade certainty for them).
 */
import type { Observation } from "@sporta/contracts";
import { SCHEMA_VERSION } from "@sporta/contracts";
import type { DetectedBox, DetectionSequenceFrame, TrackedBox } from "@sporta/perception-adapters";
import type { BallTrack, CalibrationResult, TeamAssignment } from "@sporta/perception-adapters";
import type { Homography } from "@sporta/perception-adapters";
import type { ObservationStore } from "@sporta/observation";
import { PipelineAdmissionError } from "./errors";

/** The frame id → box-center helper (deterministic, pure). */
function boxCenter(box: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/**
 * Applies the calibration homography to a normalized image point — the
 * standard homogeneous-coordinate projection with `h[8] = 1` (the exact W203
 * `applyHomography` arithmetic; the projector function itself is not
 * re-exported by the adapter plane, so the documented formula is applied
 * here). Returns `undefined` when the projection divides by ~zero (a point
 * at infinity — the caller records the drop, never a silent clamp).
 */
export function projectToPitch(
  homography: Homography,
  point: { x: number; y: number },
): { x: number; y: number } | undefined {
  const h = homography;
  const numeratorX = h[0]! * point.x + h[1]! * point.y + h[2]!;
  const numeratorY = h[3]! * point.x + h[4]! * point.y + h[5]!;
  const denominator = h[6]! * point.x + h[7]! * point.y + h[8]!;
  if (Math.abs(denominator) <= 1e-12) return undefined;
  return { x: numeratorX / denominator, y: numeratorY / denominator };
}

/** One projected player/ball position with its honest confidence. */
export interface BridgedTrackPosition {
  /** The position to emit (image-space center or pitch-space projection). */
  readonly position: { x: number; y: number };
  /** Confidence: verbatim for image frame; × calibration confidence for pitch. */
  readonly confidence: number;
  /** Whether the position is pitch-space (projected through the homography). */
  readonly pitchSpace: boolean;
  /** Whether the projected point landed outside the canonical pitch bounds. */
  readonly offPitch: boolean;
}

/**
 * Projects one tracked box through the calibration when available: the box
 * center in normalized image space → pitch meters. Off-pitch projections are
 * flagged (never clamped — the W203 inBounds semantics); a projection at
 * infinity yields `undefined` (the caller records the drop).
 */
export function bridgedPosition(
  box: TrackedBox["box"],
  confidence: number,
  calibration: CalibrationResult | undefined,
): BridgedTrackPosition | undefined {
  const center = boxCenter(box);
  if (calibration === undefined) {
    return { position: center, confidence, pitchSpace: false, offPitch: false };
  }
  const projected = projectToPitch(calibration.homography, center);
  if (projected === undefined) return undefined;
  const offPitch = projected.x < 0 || projected.x > 105 || projected.y < 0 || projected.y > 68;
  return {
    position: projected,
    // Projected positions are inference: discount by the calibration's own
    // honest confidence — never claim detection-grade certainty.
    confidence: confidence * calibration.confidence,
    pitchSpace: true,
    offPitch,
  };
}

/** Builds one track observation (player or ball) — the frozen payload shape. */
function trackObservation(input: {
  observationId: string;
  sessionId: string;
  componentId: string;
  eventTimeMs: number;
  entityId: string;
  kind: "participant" | "ball";
  position: { x: number; y: number };
  confidence: number;
  nowMs: number;
}): Observation {
  return {
    observationId: input.observationId,
    sessionId: input.sessionId,
    schemaVersion: SCHEMA_VERSION,
    eventTimeMs: input.eventTimeMs,
    ingestTimeMs: input.nowMs,
    modality: "vision",
    componentId: input.componentId,
    provenance: "OBSERVED",
    confidence: input.confidence,
    payload: {
      kind: "track",
      entityId: input.entityId,
      position: { x: input.position.x, y: input.position.y },
    },
    subjectEntityRefs: [{ entityId: input.entityId, kind: input.kind }],
  };
}

/** The bridge result summary (counts for the ledger). */
export interface BridgeSummary {
  readonly playerTrackObservations: number;
  readonly ballTrackObservations: number;
  readonly teamAssignmentObservations: number;
  readonly fieldMappingObservations: number;
  readonly detectionObservations: number;
  readonly offPitchProjections: number;
  readonly droppedInfiniteProjections: number;
}

/** Mutable bridge state appended to the store through this module. */
export interface BridgeContext {
  readonly store: ObservationStore;
  readonly sessionId: string;
  readonly nowMs: number;
}

/**
 * Bridges the surviving player tracks: one track observation per (frame,
 * tracked box) for tracks whose lifetime reached the minimum. The frame's
 * tracked boxes come from the tracking stage (decode-ordered); observation
 * time is the frame's presentation time. Positions project through the
 * calibration when available (confidence discounted, off-pitch flagged).
 */
export function bridgePlayerTracks(
  ctx: BridgeContext,
  frames: readonly DetectionSequenceFrame[],
  trackedPerFrame: readonly (readonly TrackedBox[])[],
  trackerId: string,
  calibration: CalibrationResult | undefined,
): {
  summary: BridgeSummary;
  observationIdsByTrack: Map<string, string[]>;
  droppedInfinite: number;
  offPitch: number;
} {
  let offPitch = 0;
  let droppedInfinite = 0;
  const observationIdsByTrack = new Map<string, string[]>();
  let count = 0;
  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i]!;
    const tracked = trackedPerFrame[i] ?? [];
    for (const box of tracked) {
      const bridged = bridgedPosition(box.box, box.confidence, calibration);
      if (bridged === undefined) {
        droppedInfinite += 1;
        continue;
      }
      if (bridged.offPitch) offPitch += 1;
      const observationId = `obs-pt-${frame.frame.decodeOrder}-${box.trackId}`;
      const observation = trackObservation({
        observationId,
        sessionId: ctx.sessionId,
        componentId: trackerId,
        eventTimeMs: frame.frame.presentationMs,
        entityId: box.trackId,
        kind: "participant",
        position: bridged.position,
        confidence: bridged.confidence,
        nowMs: ctx.nowMs,
      });
      appendObservation(ctx, observation);
      count += 1;
      const list = observationIdsByTrack.get(box.trackId) ?? [];
      list.push(observationId);
      observationIdsByTrack.set(box.trackId, list);
    }
  }
  return {
    summary: {
      playerTrackObservations: count,
      ballTrackObservations: 0,
      teamAssignmentObservations: 0,
      fieldMappingObservations: 0,
      detectionObservations: 0,
      offPitchProjections: offPitch,
      droppedInfiniteProjections: droppedInfinite,
    },
    observationIdsByTrack,
    droppedInfinite,
    offPitch,
  };
}

/**
 * Bridges the ball tracks: one track observation per ball track point that
 * carries a box (detected OR interpolated — the W202 honest gap semantics
 * already discount interpolated confidences), projected through the
 * calibration when available.
 */
export function bridgeBallTracks(
  ctx: BridgeContext,
  ballTracks: readonly BallTrack[],
  ballTrackerId: string,
  framesByPresentationMs: Map<number, { frameId: string; decodeOrder: number }>,
  calibration: CalibrationResult | undefined,
): {
  summary: BridgeSummary;
  detectedPointEvidence: {
    observationId: string;
    presentationMs: number;
    x: number;
    y: number;
    confidence: number;
    source: string;
  }[];
  offPitch: number;
  droppedInfinite: number;
  observationsByTrackId: Map<string, string[]>;
} {
  let offPitch = 0;
  let droppedInfinite = 0;
  let count = 0;
  const detectedPointEvidence: {
    observationId: string;
    presentationMs: number;
    x: number;
    y: number;
    confidence: number;
    source: string;
  }[] = [];
  const observationsByTrackId = new Map<string, string[]>();
  for (const track of ballTracks) {
    for (const point of track.points) {
      if (point.box === undefined) continue; // track edges without a box (never invented)
      const bridged = bridgedPosition(point.box, point.confidence, calibration);
      if (bridged === undefined) {
        droppedInfinite += 1;
        continue;
      }
      if (bridged.offPitch) offPitch += 1;
      const observationId = `obs-bt-${track.trackId}-${point.frameId}`;
      const observation = trackObservation({
        observationId,
        sessionId: ctx.sessionId,
        componentId: ballTrackerId,
        eventTimeMs: point.presentationMs,
        entityId: track.trackId,
        kind: "ball",
        position: bridged.position,
        confidence: bridged.confidence,
        nowMs: ctx.nowMs,
      });
      appendObservation(ctx, observation);
      count += 1;
      const list = observationsByTrackId.get(track.trackId) ?? [];
      list.push(observationId);
      observationsByTrackId.set(track.trackId, list);
      detectedPointEvidence.push({
        observationId,
        presentationMs: point.presentationMs,
        x: boxCenter(point.box).x,
        y: boxCenter(point.box).y,
        confidence: point.confidence,
        source: point.source,
      });
    }
  }
  return {
    summary: {
      playerTrackObservations: 0,
      ballTrackObservations: count,
      teamAssignmentObservations: 0,
      fieldMappingObservations: 0,
      detectionObservations: 0,
      offPitchProjections: offPitch,
      droppedInfiniteProjections: droppedInfinite,
    },
    detectedPointEvidence,
    offPitch,
    droppedInfinite,
    observationsByTrackId,
  };
}

/** Bridges team assignments (the R206 payload) — one per track. */
export function bridgeTeamAssignments(
  ctx: BridgeContext,
  assignments: readonly TeamAssignment[],
  assignerId: string,
): BridgeSummary {
  for (const assignment of assignments) {
    const observation: Observation = {
      observationId: `obs-team-${assignment.trackId}`,
      sessionId: ctx.sessionId,
      schemaVersion: SCHEMA_VERSION,
      eventTimeMs: 0,
      ingestTimeMs: ctx.nowMs,
      modality: "vision",
      componentId: assignerId,
      provenance: "OBSERVED",
      confidence: assignment.confidence,
      payload: {
        kind: "team-assignment",
        trackId: assignment.trackId,
        teamId: assignment.teamId,
        confidence: assignment.confidence,
        method: assignment.method,
      },
      subjectEntityRefs: [{ entityId: assignment.trackId, kind: "participant" }],
    };
    appendObservation(ctx, observation);
  }
  return {
    playerTrackObservations: 0,
    ballTrackObservations: 0,
    teamAssignmentObservations: assignments.length,
    fieldMappingObservations: 0,
    detectionObservations: 0,
    offPitchProjections: 0,
    droppedInfiniteProjections: 0,
  };
}

/** Bridges the calibration result as a field-mapping observation. */
export function bridgeFieldMapping(
  ctx: BridgeContext,
  calibration: CalibrationResult,
  calibratorId: string,
  eventTimeMs: number,
): BridgeSummary {
  const observation: Observation = {
    observationId: `obs-fm-${calibratorId}`,
    sessionId: ctx.sessionId,
    schemaVersion: SCHEMA_VERSION,
    eventTimeMs,
    ingestTimeMs: ctx.nowMs,
    modality: "vision",
    componentId: calibratorId,
    provenance: "OBSERVED",
    confidence: calibration.confidence,
    payload: {
      kind: "field-mapping",
      pitchCorners: calibration.cornerSet.corners.map((corner) => ({ x: corner.x, y: corner.y })),
    },
    subjectEntityRefs: [],
  };
  appendObservation(ctx, observation);
  return {
    playerTrackObservations: 0,
    ballTrackObservations: 0,
    teamAssignmentObservations: 0,
    fieldMappingObservations: 1,
    detectionObservations: 0,
    offPitchProjections: 0,
    droppedInfiniteProjections: 0,
  };
}

/**
 * Bridges raw detection observations (optional, config-gated): one per
 * (frame, detection). Default OFF — the track observations carry the
 * per-entity evidence and the ledger summarizes detection counts/confidence
 * (recorded as a degradation note when off, never a silent skip).
 */
export function bridgeDetections(
  ctx: BridgeContext,
  frames: readonly DetectionSequenceFrame[],
  detectorId: string,
  ballDetectorId: string | undefined,
  ballDetectionsPerFrame: readonly (readonly DetectedBox[])[],
): BridgeSummary {
  let count = 0;
  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i]!;
    const emit = (detection: DetectedBox, index: number, componentId: string) => {
      const observation: Observation = {
        observationId: `obs-det-${frame.frame.decodeOrder}-${index}-${detection.label}`,
        sessionId: ctx.sessionId,
        schemaVersion: SCHEMA_VERSION,
        eventTimeMs: frame.frame.presentationMs,
        ingestTimeMs: ctx.nowMs,
        modality: "vision",
        componentId,
        provenance: "OBSERVED",
        confidence: detection.confidence,
        payload: {
          kind: "detection",
          box: { ...detection.box },
          label: detection.label,
        },
        subjectEntityRefs: [],
      };
      appendObservation(ctx, observation);
      count += 1;
    };
    frames[i]!.detections.forEach((detection, index) => emit(detection, index, detectorId));
    const ballDetections = ballDetectionsPerFrame[i] ?? [];
    if (ballDetectorId !== undefined) {
      ballDetections.forEach((detection, index) =>
        emit(detection, index + frames[i]!.detections.length, ballDetectorId),
      );
    }
  }
  return {
    playerTrackObservations: 0,
    ballTrackObservations: 0,
    teamAssignmentObservations: 0,
    fieldMappingObservations: 0,
    detectionObservations: count,
    offPitchProjections: 0,
    droppedInfiniteProjections: 0,
  };
}

/** Appends one observation, refusing duplicates (id minters must be injective). */
function appendObservation(ctx: BridgeContext, observation: Observation): void {
  const result = ctx.store.append(observation);
  if (result === "duplicate") {
    throw new PipelineAdmissionError(
      `bridge produced a duplicate observation id "${observation.observationId}" — ` +
        "the id minters must be injective over (frame, track)",
      { observationId: observation.observationId },
    );
  }
}
