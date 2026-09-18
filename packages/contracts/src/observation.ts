/**
 * Observation contracts: raw model/sensor observations with provenance.
 *
 * An observation NEVER silently becomes fact (docs/contracts/
 * sports-world-model.md). It records which modality produced it, which
 * component/model, its provenance kind, and — where inference occurs — a
 * confidence in [0, 1]. Event fusion turns observations into derived events
 * that link back to their evidence.
 */
import { z } from "zod";
import { EntityId, LocalEntityRef } from "./identity";
import { IngestedAt, TimelinePoint } from "./timestamps";
import { schemaVersionField } from "./versioning";

/** How a record came to exist (evidence chain: OBSERVED -> DERIVED, optional REPORTED). */
export const ProvenanceKind = z.enum(["OBSERVED", "REPORTED", "DERIVED"]);
export type ProvenanceKind = z.infer<typeof ProvenanceKind>;

/** Which input modality produced an observation. */
export const SourceModality = z.enum(["vision", "audio", "metadata", "commentary"]);
export type SourceModality = z.infer<typeof SourceModality>;

const confidenceField = z.number().min(0).max(1).optional();

/** A 2D point (context-dependent frame; documented per payload kind). */
const Point2D = z.object({
  x: z.number(),
  y: z.number(),
});

/** Bounding box in normalized image coordinates [0, 1]. */
const NormalizedBox = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

/** Object detection payload: a normalized box plus a class label. */
export const DetectionPayload = z.object({
  kind: z.literal("detection"),
  box: NormalizedBox,
  label: z.string().min(1),
});
export type DetectionPayload = z.infer<typeof DetectionPayload>;

/**
 * Track payload: a tracked entity's position (in the pitch frame) plus an
 * optional velocity. The tracked subject is also referenced by
 * `subjectEntityRefs` on the observation.
 */
export const TrackPayload = z.object({
  kind: z.literal("track"),
  entityId: EntityId,
  position: Point2D,
  velocity: z
    .object({
      vx: z.number(),
      vy: z.number(),
    })
    .optional(),
});
export type TrackPayload = z.infer<typeof TrackPayload>;

/** Speech-to-text payload with optional speaker/channel metadata. */
export const TranscriptionPayload = z.object({
  kind: z.literal("transcription"),
  text: z.string(),
  speakerLabel: z.string().min(1).optional(),
  channel: z.string().min(1).optional(),
  asrConfidence: confidenceField,
});
export type TranscriptionPayload = z.infer<typeof TranscriptionPayload>;

/**
 * Field-mapping payload: the four detected pitch corners (image-space order
 * is producer-defined and must be documented by the producer), plus an
 * optional reference to the camera homography used.
 */
export const FieldMappingPayload = z.object({
  kind: z.literal("field-mapping"),
  cameraHomographyRef: z.string().min(1).optional(),
  pitchCorners: z.array(Point2D).length(4),
});
export type FieldMappingPayload = z.infer<typeof FieldMappingPayload>;

/**
 * Generic escape-hatch payload. DISCOURAGED: prefer adding a typed payload
 * variant (minor version bump) so downstream consumers can rely on structure.
 * Use only for provisional/experimental producer output.
 */
export const GenericPayload = z.object({
  kind: z.literal("generic"),
  data: z.unknown(),
});
export type GenericPayload = z.infer<typeof GenericPayload>;

/**
 * Team-assignment payload (R206, the wave's one additive contract change):
 * one team-identity decision for one tracked subject — which team the track
 * was assigned to, with EXPLICIT uncertainty (`teamId: "unknown"` plus LOW
 * confidence is a first-class honest value, never a silent guess) and the
 * documented method id that produced the assignment (e.g. "jersey-color").
 * `confidence` follows the observation-level uncertainty convention (in
 * [0, 1], preserved downstream with no silent collapse).
 */
export const TeamAssignmentPayload = z.object({
  kind: z.literal("team-assignment"),
  trackId: EntityId,
  teamId: z.enum(["home", "away", "unknown"]),
  confidence: z.number().min(0).max(1),
  method: z.string().min(1),
});
export type TeamAssignmentPayload = z.infer<typeof TeamAssignmentPayload>;

/** The discriminated union of observation payload variants. */
export const ObservationPayload = z.discriminatedUnion("kind", [
  DetectionPayload,
  TrackPayload,
  TranscriptionPayload,
  FieldMappingPayload,
  GenericPayload,
  TeamAssignmentPayload,
]);
export type ObservationPayload = z.infer<typeof ObservationPayload>;

/**
 * A raw observation. `eventTimeMs` places it on the canonical media timeline;
 * `ingestTimeMs` is the wall-clock ingestion time where available. `componentId`
 * identifies the producing pipeline component; `modelId` the specific model
 * version where applicable (vendor-neutral identifier).
 */
export const Observation = z.object({
  observationId: z.string().min(1),
  sessionId: z.string().min(1),
  schemaVersion: schemaVersionField,
  eventTimeMs: TimelinePoint.shape.eventTimeMs,
  ingestTimeMs: IngestedAt.shape.ingestTimeMs.optional(),
  modality: SourceModality,
  componentId: z.string().min(1),
  modelId: z.string().min(1).optional(),
  provenance: ProvenanceKind,
  confidence: confidenceField,
  payload: ObservationPayload,
  subjectEntityRefs: z.array(LocalEntityRef),
});
export type Observation = z.infer<typeof Observation>;
