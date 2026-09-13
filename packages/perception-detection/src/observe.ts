/**
 * Detection observation emission (W201).
 *
 * Architecture-lock §6: perception components EMIT observations; storing them
 * is the pipeline's job. This module turns a frame's detections into
 * contract `Observation` records — one per detection — preserving confidence
 * and provenance verbatim (no silent confidence collapse).
 *
 * Timeline semantics: `eventTimeMs` is set to the frame's `presentationMs`,
 * i.e. W201 emits in FRAME-NATIVE time on the normalized media timeline.
 * Mapping to a session timeline (clock offsets, W103) is the caller's job
 * when one exists; the emitted records are otherwise store-compatible as-is
 * (validated here, and exercisable against `@sporta/observation`'s
 * `InMemoryObservationStore` in the tests).
 *
 * Identity: `subjectEntityRefs` is always empty — a detection carries no
 * identity. Attaching detections to entities is W204 (player identity
 * tracking), not W201.
 */
import { Observation as ObservationSchema, SCHEMA_VERSION } from "@sporta/contracts";
import type { Observation } from "@sporta/contracts";
import type { DetectedBox, DetectorFrameInput } from "./detector";

/** Input for {@link emitDetectionObservations}: one frame's worth of work. */
export interface EmitDetectionInput {
  /** Session the observations belong to (observations are session-scoped). */
  readonly sessionId: string;
  /** Producing component id (typically the adapter's `detectorId`). */
  readonly componentId: string;
  /** The frame the detections came from (id + timeline position). */
  readonly frame: DetectorFrameInput;
  /** The frame's detections, in emission order. */
  readonly detections: readonly DetectedBox[];
}

/**
 * Emits one contract `Observation` per detection:
 *
 * - `observationId = "det-<frameId>-<index>"` (index = position in
 *   `detections`, so ids are unique per frame as long as frame ids are);
 * - `eventTimeMs = frame.presentationMs` (frame-native time — see module
 *   docs);
 * - `modality: "vision"`, `provenance: "OBSERVED"`;
 * - `confidence` and the `detection` payload (box + label) passed through
 *   verbatim;
 * - `subjectEntityRefs: []` (no identity at detection level);
 * - `schemaVersion` from the contracts constants.
 *
 * `ingestTimeMs` is deliberately NOT set: wall-clock ingestion time is
 * assigned by the pipeline when records are actually ingested, and this
 * package is deterministic (no clock reads).
 *
 * The payload box is shallow-copied so emitted records never alias
 * detector-owned mutable boxes.
 */
export function emitDetectionObservations(input: EmitDetectionInput): Observation[] {
  return input.detections.map((detection, index) => ({
    observationId: `det-${input.frame.frameId}-${index}`,
    sessionId: input.sessionId,
    schemaVersion: SCHEMA_VERSION,
    eventTimeMs: input.frame.presentationMs,
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
  }));
}

/**
 * Zod-parse helper: `true` iff `obs` parses against the contracts
 * `Observation` schema. Tests use it to prove every emitted record is
 * contract-valid; production callers may use it as a cheap boundary check.
 */
export function validateObservation(obs: unknown): boolean {
  return ObservationSchema.safeParse(obs).success;
}
