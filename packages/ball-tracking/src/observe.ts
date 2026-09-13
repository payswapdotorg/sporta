/**
 * Ball detection observation emission (W202).
 *
 * Architecture-lock §6: perception components EMIT observations; storing
 * them is the pipeline's job. This module turns a track's DETECTED points
 * into contract `Observation` records — per-frame ball detections only.
 *
 * SCOPE BOUNDARY (the W202/W205 contract, documented): INTERPOLATED
 * positions are NOT emitted as observations. An interpolated position is
 * honest-but-inferred track structure with explicitly discounted confidence;
 * it is not sensor evidence. It feeds W205's ball state estimator (which
 * owns pitch coordinates, velocity, and the confidence feed into the SWM)
 * through the track structure, not through the observation log. Emitting it
 * as an `OBSERVED` detection would be invented certainty — exactly what
 * architecture-lock §4 forbids. Likewise no `TrackPayload` and no entity
 * refs: `subjectEntityRefs` is always empty (identity is W204/W205
 * territory).
 *
 * Timeline semantics (mirroring W201/W203): `eventTimeMs` is the frame's
 * `presentationMs` — frame-native time on the normalized media timeline.
 * `ingestTimeMs` is deliberately NOT set: wall-clock ingestion time belongs
 * to the pipeline, and this package is deterministic (no clock reads).
 */
import { Observation as ObservationSchema, SCHEMA_VERSION } from "@sporta/contracts";
import type { Observation } from "@sporta/contracts";
import type { DetectedBox } from "@sporta/perception-detection";
import type { BallTrackPoint } from "./tracker";

/** Input for {@link emitBallDetectionObservations}. */
export interface EmitBallDetectionInput {
  /** Session the observations belong to (observations are session-scoped). */
  readonly sessionId: string;
  /** Producing component id (typically the tracker's `trackerId`). */
  readonly componentId: string;
  /**
   * The track points to emit from (any track's points; only
   * `source: "detected"` points are emitted — see module docs).
   */
  readonly points: readonly BallTrackPoint[];
  /**
   * The frame's detections keyed by frameId — the authoritative detection
   * records (box + label + confidence). Every detected point MUST have an
   * entry; a missing entry fails loud rather than emitting a fabricated
   * record.
   */
  readonly boxes: ReadonlyMap<string, DetectedBox>;
}

/**
 * Emits one contract `Observation` per DETECTED track point:
 *
 * - `observationId = "btd-<frameId>"` (unique per call — a duplicate
 *   detected frameId fails loud, since colliding ids would silently
 *   de-duplicate at the observation store);
 * - `eventTimeMs = point.presentationMs` (frame-native time);
 * - `modality: "vision"`, `provenance: "OBSERVED"`;
 * - payload is the frame's `DetectedBox` verbatim: `kind: "detection"`,
 *   the box shallow-copied (emitted records never alias caller-owned
 *   objects), and the detection's label (typically "ball" — the caller
 *   filters ball detections upstream);
 * - `confidence` passes through from the `DetectedBox` — the detector's
 *   value, untouched by tracker arithmetic (architecture-lock §6);
 * - `subjectEntityRefs: []` (no identity — W204/W205 own it);
 * - `schemaVersion` from the contracts constants.
 *
 * Interpolated points are skipped by design (see module docs).
 */
export function emitBallDetectionObservations(input: EmitBallDetectionInput): Observation[] {
  const emitted: Observation[] = [];
  const emittedFrameIds = new Set<string>();

  for (const point of input.points) {
    // Interpolated positions are NOT observations (W205 boundary).
    if (point.source !== "detected") continue;

    const detection = input.boxes.get(point.frameId);
    if (detection === undefined) {
      throw new RangeError(
        `ball tracking emission: no DetectedBox provided for detected point ` +
          `"${point.frameId}" — the observation would have to be fabricated`,
      );
    }
    if (emittedFrameIds.has(point.frameId)) {
      throw new RangeError(
        `ball tracking emission: duplicate detected point for frame "${point.frameId}" ` +
          `— observationIds would collide`,
      );
    }
    emittedFrameIds.add(point.frameId);

    emitted.push({
      observationId: `btd-${point.frameId}`,
      sessionId: input.sessionId,
      schemaVersion: SCHEMA_VERSION,
      eventTimeMs: point.presentationMs,
      modality: "vision",
      componentId: input.componentId,
      provenance: "OBSERVED",
      confidence: detection.confidence,
      payload: {
        kind: "detection",
        box: {
          x: detection.box.x,
          y: detection.box.y,
          w: detection.box.w,
          h: detection.box.h,
        },
        label: detection.label,
      },
      subjectEntityRefs: [],
    });
  }

  return emitted;
}

/**
 * Zod-parse helper: `true` iff `obs` parses against the contracts
 * `Observation` schema. Tests use it to prove every emitted record is
 * contract-valid; production callers may use it as a cheap boundary check.
 */
export function validateBallObservation(obs: unknown): boolean {
  return ObservationSchema.safeParse(obs).success;
}
