/**
 * Field-mapping observation emission (W203).
 *
 * Architecture-lock §6: perception components EMIT observations; storing them
 * is the pipeline's job. This module turns one frame's corner set into a
 * contract `Observation` with the `field-mapping` payload — the four image
 * corners as emitted by the calibrator, plus a stable `cameraHomographyRef`
 * documenting that the solved homography is recoverable from the corner set
 * (pair the corners with the canonical pitch corners and run
 * `solveHomography`).
 *
 * Timeline semantics (mirroring W201): `eventTimeMs` is the frame's
 * `presentationMs` — frame-native time on the normalized media timeline.
 * `ingestTimeMs` is deliberately NOT set: wall-clock ingestion time belongs
 * to the pipeline, and this package is deterministic (no clock reads).
 *
 * Identity: `subjectEntityRefs` is always empty — a field mapping carries no
 * subject. Attaching positions to entities is W204/W206, not W203.
 */
import { Observation as ObservationSchema, SCHEMA_VERSION } from "@sporta/contracts";
import type { Observation } from "@sporta/contracts";
import type { FieldCornerSet } from "./calibrator";

/** Input for {@link emitFieldMappingObservation}: one frame's worth of work. */
export interface EmitFieldMappingInput {
  /** Session the observation belongs to (observations are session-scoped). */
  readonly sessionId: string;
  /** Producing component id (typically the adapter's `calibratorId`). */
  readonly componentId: string;
  /** The frame the corner set came from (id + timeline position). */
  readonly frame: {
    readonly frameId: string;
    readonly presentationMs: number;
  };
  /** The frame's calibrated corner set. */
  readonly cornerSet: FieldCornerSet;
}

/**
 * Emits one contract `Observation` for a frame's field mapping:
 *
 * - `observationId = "fm-<frameId>"` (one per frame — stable across emissions
 *   for the same frame id);
 * - `cameraHomographyRef = "homography-<sessionId>-<frameId>"` — a stable
 *   identifier for the homography recoverable from the corner set;
 * - `eventTimeMs = frame.presentationMs` (frame-native time);
 * - `modality: "vision"`, `provenance: "OBSERVED"`;
 * - `confidence = cornerSet.confidence` passed through verbatim;
 * - `payload.pitchCorners` carries the image-space corners as emitted by
 *   the calibrator (shallow-copied per point so the record never aliases
 *   calibrator-owned objects);
 * - `subjectEntityRefs: []` (no subject at field-mapping level);
 * - `schemaVersion` from the contracts constants.
 */
export function emitFieldMappingObservation(input: EmitFieldMappingInput): Observation {
  const [c0, c1, c2, c3] = input.cornerSet.corners;
  return {
    observationId: `fm-${input.frame.frameId}`,
    sessionId: input.sessionId,
    schemaVersion: SCHEMA_VERSION,
    eventTimeMs: input.frame.presentationMs,
    modality: "vision",
    componentId: input.componentId,
    provenance: "OBSERVED",
    confidence: input.cornerSet.confidence,
    payload: {
      kind: "field-mapping",
      pitchCorners: [{ ...c0 }, { ...c1 }, { ...c2 }, { ...c3 }],
      cameraHomographyRef: `homography-${input.sessionId}-${input.frame.frameId}`,
    },
    subjectEntityRefs: [],
  };
}

/**
 * Zod-parse helper: `true` iff `obs` parses against the contracts
 * `Observation` schema. Tests use it to prove every emitted record is
 * contract-valid; production callers may use it as a cheap boundary check.
 */
export function validateFieldMappingObservation(obs: unknown): boolean {
  return ObservationSchema.safeParse(obs).success;
}
