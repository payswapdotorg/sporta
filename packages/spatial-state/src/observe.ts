/**
 * SWM-facing spatial observation emission (W206).
 *
 * Architecture-lock §6: perception components EMIT observations; storing them
 * is the pipeline's job. This module turns a {@link SpatialStateSeries} into
 * contract `Observation` records — one per fused point, payload
 * `kind: "track"` — which is the W206 accept criterion made VISIBLE in the
 * stream: player locations in canonical pitch space, time-aligned to the
 * session timeline.
 *
 * HONESTY RULES (documented; the tests pin them):
 *
 * - **PROVENANCE: always `DERIVED`.** A projected position is INFERENCE built
 *   from OBSERVED corners (W203) plus OBSERVED tracks (W204) — the homography
 *   projection is not sensor evidence. Emitting it as OBSERVED would be
 *   invented certainty, exactly what architecture-lock §4 forbids. (This
 *   differs deliberately from W201/W204/W203, which emit raw perception as
 *   OBSERVED.)
 * - **TIME: `eventTimeMs = point.sessionMs`** — the SESSION-canonical
 *   timeline (W103-aligned). This differs from W201/W203/W204's frame-native
 *   convention (`eventTimeMs = presentationMs`): those streams are
 *   pre-alignment perception; this one is the fused, timeline-aligned product
 *   the SWM ingests. `ingestTimeMs` is deliberately NOT set (wall-clock
 *   ingestion belongs to the pipeline; this package is deterministic).
 * - **POSITION: pitch METERS in the unitless `Point2D` slot** (tech-lead
 *   decision, documented): pitch-space is now the canonical spatial frame for
 *   SWM ingestion; the image-space ancestors remain in the W204/W201 streams
 *   (and in the W203 corner observations), so no information is lost. The
 *   payload position object is freshly copied — emitted records never alias
 *   caller-owned objects.
 * - **NO VELOCITY** (scope boundary): the `TrackPayload` contract has an
 *   optional velocity, but velocity estimation is W205's ball-state concern /
 *   later fusion — this module NEVER sets the key.
 * - **CONFIDENCE: passthrough** of the fused confidence; the raw
 *   `sourceConfidences` stay on the series' points (not part of the contract
 *   payload) for downstream re-fusion.
 * - **IDENTITY: `entityId = trackId`** (W204 passthrough — ids are
 *   hypotheses, never re-mapped). `subjectEntityRefs` carries the exact
 *   `LocalEntityRef` shape (`entityId` + `kind` fields ONLY, matching
 *   `packages/contracts/src/identity.ts`): the kind is
 *   `FOOTBALL_LABEL_KINDS[label]` from W204 when the point carries a label;
 *   an UNMAPPED label gets NO ref (`[]` — identity is never guessed); a point
 *   WITHOUT a label (hand-built series) gets the documented W206 default
 *   `participant` (this package tracks players, per W204's player tracking).
 */
import {
  Observation as ObservationSchema,
  SCHEMA_VERSION,
  ENTITY_ID_PATTERN,
} from "@sporta/contracts";
import type { Observation, TrackPayload } from "@sporta/contracts";
import { FOOTBALL_LABEL_KINDS } from "@sporta/perception-tracking";
import type { SpatialStatePoint, SpatialStateSeries } from "./state";

/** The documented default entity kind for unlabeled spatial points. */
export const DEFAULT_SPATIAL_ENTITY_KIND = "participant";

/** Input for {@link emitSpatialObservations}. */
export interface EmitSpatialInput {
  /** Session the observations belong to (observations are session-scoped). */
  readonly sessionId: string;
  /** Producing component id (the spatial-state estimator component). */
  readonly componentId: string;
  /** The fused series to emit (typically {@link estimateSpatialState} output). */
  readonly series: SpatialStateSeries;
}

/** Validates one point's emission surface; throws `RangeError` (fail loud). */
function validatePoint(point: SpatialStatePoint, where: string): void {
  if (
    typeof point.trackId !== "string" ||
    point.trackId.length < 1 ||
    !ENTITY_ID_PATTERN.test(point.trackId)
  ) {
    throw new RangeError(
      `spatial state emission: ${where}.trackId must match the contracts EntityId pattern ` +
        `[A-Za-z0-9_-]{1,64} (got ${String(point.trackId)}) — the record could not parse otherwise`,
    );
  }
  if (typeof point.frameId !== "string" || point.frameId.length < 1) {
    throw new RangeError(`spatial state emission: ${where}.frameId must be a non-empty string`);
  }
  if (typeof point.sessionMs !== "number" || !Number.isFinite(point.sessionMs)) {
    throw new RangeError(`spatial state emission: ${where}.sessionMs must be finite`);
  }
  // The contracts TimelinePoint requires eventTimeMs >= 0; emitting a record
  // that cannot parse would fabricate nothing and help nobody — fail loud
  // instead, and let the caller fix the clock/series.
  if (point.sessionMs < 0) {
    throw new RangeError(
      `spatial state emission: ${where}.sessionMs must be >= 0 for contract emission ` +
        `(the canonical session timeline is non-negative; got ${point.sessionMs})`,
    );
  }
  if (point.pitch === null || typeof point.pitch !== "object") {
    throw new RangeError(`spatial state emission: ${where}.pitch must be an object`);
  }
  if (!Number.isFinite(point.pitch.x) || !Number.isFinite(point.pitch.y)) {
    throw new RangeError(`spatial state emission: ${where}.pitch coordinates must be finite`);
  }
  if (typeof point.confidence !== "number" || !Number.isFinite(point.confidence)) {
    throw new RangeError(`spatial state emission: ${where}.confidence must be finite`);
  }
  if (point.confidence < 0 || point.confidence > 1) {
    throw new RangeError(
      `spatial state emission: ${where}.confidence must be in [0, 1] (got ${point.confidence})`,
    );
  }
  if (point.label !== undefined && (typeof point.label !== "string" || point.label.length < 1)) {
    throw new RangeError(
      `spatial state emission: ${where}.label must be a non-empty string when provided`,
    );
  }
}

/** Validates the emission input; throws `RangeError` (fail loud, repo style). */
function validateEmissionInput(input: EmitSpatialInput): void {
  if (input === null || typeof input !== "object") {
    throw new RangeError("spatial state emission: input must be an object");
  }
  if (typeof input.sessionId !== "string" || input.sessionId.length < 1) {
    throw new RangeError("spatial state emission: sessionId must be a non-empty string");
  }
  if (typeof input.componentId !== "string" || input.componentId.length < 1) {
    throw new RangeError("spatial state emission: componentId must be a non-empty string");
  }
  const series = input.series;
  if (series === null || typeof series !== "object") {
    throw new RangeError("spatial state emission: series must be a SpatialStateSeries");
  }
  if (typeof series.frames !== "number" || !Number.isInteger(series.frames) || series.frames < 0) {
    throw new RangeError("spatial state emission: series.frames must be a non-negative integer");
  }
  if (!Array.isArray(series.points)) {
    throw new RangeError("spatial state emission: series.points must be an array");
  }
  for (const [index, point] of series.points.entries()) {
    validatePoint(point, `series.points[${index}]`);
  }
}

/**
 * Emits one contract `Observation` per fused point, in series order:
 *
 * - `observationId = "sp-<frameId>-<trackId>"`. Frame ids + track ids are
 *   unique per session in pipeline data; if a hand-built series repeats the
 *   pair, the SECOND and later occurrences get `-<index>` appended (the
 *   point's 0-based index), so ids never collide;
 * - `eventTimeMs = point.sessionMs` (SESSION timeline — see module docs);
 * - `modality: "vision"`, `provenance: "DERIVED"` (see module docs);
 * - `confidence`: the fused confidence, passthrough;
 * - `payload`: `{ kind: "track", entityId: trackId, position: pitch meters }`
 *   — NO velocity key, ever;
 * - `subjectEntityRefs`: `[{ entityId: trackId, kind }]` with the kind from
 *   W204's `FOOTBALL_LABEL_KINDS` when the point carries a mapped label; `[]`
 *   for an unmapped label; the `participant` default for a label-less point —
 *   exact `LocalEntityRef` shape (`entityId` + `kind` only);
 * - `schemaVersion` from the contracts constants; `ingestTimeMs` unset.
 */
export function emitSpatialObservations(input: EmitSpatialInput): Observation[] {
  validateEmissionInput(input);

  const emitted: Observation[] = [];
  const seenIds = new Set<string>();

  for (const [index, point] of input.series.points.entries()) {
    const baseId = `sp-${point.frameId}-${point.trackId}`;
    const observationId = seenIds.has(baseId) ? `${baseId}-${index}` : baseId;
    seenIds.add(baseId);

    const kind =
      point.label === undefined ? DEFAULT_SPATIAL_ENTITY_KIND : FOOTBALL_LABEL_KINDS[point.label];
    const payload: TrackPayload = {
      kind: "track",
      entityId: point.trackId,
      position: { x: point.pitch.x, y: point.pitch.y },
    };

    emitted.push({
      observationId,
      sessionId: input.sessionId,
      schemaVersion: SCHEMA_VERSION,
      eventTimeMs: point.sessionMs,
      modality: "vision",
      componentId: input.componentId,
      provenance: "DERIVED",
      confidence: point.confidence,
      payload,
      subjectEntityRefs: kind === undefined ? [] : [{ entityId: point.trackId, kind }],
    });
  }

  return emitted;
}

/**
 * Zod-parse helper: `true` iff `obs` parses against the contracts
 * `Observation` schema. Tests use it to prove every emitted record is
 * contract-valid; production callers may use it as a cheap boundary check.
 */
export function validateObservation(obs: unknown): boolean {
  return ObservationSchema.safeParse(obs).success;
}
