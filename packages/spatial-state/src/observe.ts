/**
 * SWM-facing spatial observation emission (W206).
 *
 * Architecture-lock §6: perception components EMIT observations; storing
 * them is the pipeline's job. This module turns a {@link SpatialStateSeries}
 * into contract `Observation` records — one per point — so player
 * pitch-space positions can feed the Sports World Model (the W206
 * acceptance criterion: "player locations/projected coordinates are
 * time-aligned").
 *
 * HONESTY RULES (documented; the tests pin them):
 *
 * - TIMELINE: `eventTimeMs` is the point's `sessionMs` — the SESSION
 *   timeline position (W103 clock mapping). This is THE W206 difference
 *   from the image-space ancestors: W201/W203/W204/W205 all emit the
 *   frame-native `presentationMs`. The time-alignment accept criterion is
 *   made visible in the stream itself. `ingestTimeMs` is deliberately NOT
 *   set: wall-clock ingestion time belongs to the pipeline, and this
 *   package is deterministic (no clock reads).
 * - PROVENANCE: `"DERIVED"`. A pitch-space position is INFERENCE from
 *   OBSERVED evidence (W203's observed corner sets + W204's observed
 *   tracks, combined through a homography). Emitting it as OBSERVED would
 *   be invented certainty — exactly what architecture-lock §4 forbids. The
 *   image-space ancestors remain in the W201/W204 observation streams with
 *   their own OBSERVED provenance; the evidence chain stays honest.
 * - POSITION FRAME: the payload position is the point's PITCH position in
 *   METERS, in the unitless contracts `Point2D` slot. TL decision
 *   (documented): pitch-space is now the canonical spatial frame for SWM
 *   ingestion; the `Point2D` frame is "context-dependent, documented per
 *   payload kind", and THIS module documents it as canonical-pitch-meters.
 * - NO VELOCITY: the payload never sets `velocity` — velocity state
 *   estimation is W205's ball-state concern / later fusion, not spatial
 *   fusion's.
 * - CONFIDENCE: the fused point confidence, passthrough (the fusion rule
 *   and its raw sources live on the point — see `./state`).
 * - IDENTITY: `subjectEntityRefs` entries are EXACTLY the contracts
 *   `LocalEntityRef` shape — fields `entityId` + `kind` ONLY. The kind
 *   comes from W204's `FOOTBALL_LABEL_KINDS` when the point carries a
 *   label; a label with NO mapping gets NO ref (identity is never guessed);
 *   a point with NO label (hand-built input) defaults to "participant" —
 *   W206 is the player-position stream, and estimator output always
 *   carries the true label so the map governs in practice.
 */
import { Observation as ObservationSchema, SCHEMA_VERSION } from "@sporta/contracts";
import type { Observation } from "@sporta/contracts";
import { FOOTBALL_LABEL_KINDS } from "@sporta/perception-tracking";
import type { SpatialStatePoint, SpatialStateSeries } from "./state";

/** Input for {@link emitSpatialObservations}. */
export interface EmitSpatialInput {
  /** Session the observations belong to (observations are session-scoped). */
  readonly sessionId: string;
  /** Producing component id (the spatial-state estimator component). */
  readonly componentId: string;
  /** The fused series to emit (typically {@link estimateSpatialState}'s output). */
  readonly series: SpatialStateSeries;
}

/** Fails loud on malformed emission input (nothing is fabricated to emit). */
function validateEmissionInput(input: EmitSpatialInput): void {
  if (typeof input.sessionId !== "string" || input.sessionId.length < 1) {
    throw new RangeError(
      `emitSpatialObservations: sessionId must be a non-empty string (got ${String(input.sessionId)})`,
    );
  }
  if (typeof input.componentId !== "string" || input.componentId.length < 1) {
    throw new RangeError(
      `emitSpatialObservations: componentId must be a non-empty string ` +
        `(got ${String(input.componentId)})`,
    );
  }
}

/**
 * Fails loud on a point that cannot become a contract-valid observation:
 * the contracts require a non-negative finite `eventTimeMs`
 * (`TimelinePoint`), and the payload's `entityId`/observation ids need
 * non-empty frame/track ids. A negative sessionMs (a hand-built clock can
 * produce one) is REJECTED here rather than silently emitted as a
 * zod-invalid record.
 */
function validatePointForEmission(point: SpatialStatePoint): void {
  if (typeof point.trackId !== "string" || point.trackId.length < 1) {
    throw new RangeError(
      `emitSpatialObservations: trackId must be a non-empty string (got ${String(point.trackId)})`,
    );
  }
  if (typeof point.frameId !== "string" || point.frameId.length < 1) {
    throw new RangeError(
      `emitSpatialObservations: frameId must be a non-empty string (got ${String(point.frameId)})`,
    );
  }
  if (
    typeof point.sessionMs !== "number" ||
    !Number.isFinite(point.sessionMs) ||
    point.sessionMs < 0
  ) {
    throw new RangeError(
      `emitSpatialObservations: sessionMs must be a finite number >= 0 ` +
        `(got ${String(point.sessionMs)} for trackId "${point.trackId}") — the contracts ` +
        `eventTimeMs is non-negative`,
    );
  }
  if (
    typeof point.confidence !== "number" ||
    !Number.isFinite(point.confidence) ||
    point.confidence < 0 ||
    point.confidence > 1
  ) {
    throw new RangeError(
      `emitSpatialObservations: confidence must be a finite number in [0, 1] ` +
        `(got ${String(point.confidence)} for trackId "${point.trackId}")`,
    );
  }
  if (
    typeof point.pitch.x !== "number" ||
    !Number.isFinite(point.pitch.x) ||
    typeof point.pitch.y !== "number" ||
    !Number.isFinite(point.pitch.y)
  ) {
    throw new RangeError(
      `emitSpatialObservations: pitch position must be finite (got x ${String(point.pitch.x)}, ` +
        `y ${String(point.pitch.y)} for trackId "${point.trackId}")`,
    );
  }
}

/**
 * Emits one contract `Observation` per spatial point:
 *
 * - `observationId = "sp-<frameId>-<trackId>"` — unique as long as
 *   (frameId, trackId) pairs are unique in the series (always true for
 *   single-video estimator output: a track absorbs at most one detection
 *   per frame; a multi-source fused series with colliding frame ids is the
 *   caller's responsibility to disambiguate — same convention as W204);
 * - `eventTimeMs = point.sessionMs` (SESSION timeline — see module docs);
 * - `modality: "vision"`, `provenance: "DERIVED"`, `componentId` from the
 *   input (see module docs for the honesty rules);
 * - `confidence: point.confidence` (the fused value, passthrough);
 * - `payload = { kind: "track", entityId: point.trackId, position:
 *   { x: pitch.x, y: pitch.y } }` — pitch METERS, NO velocity; the position
 *   object is freshly built so the record never aliases the point;
 * - `subjectEntityRefs`: from `FOOTBALL_LABEL_KINDS[point.label]` when a
 *   label is carried (unmapped label -> `[]` — no invented kind; no label
 *   -> the "participant" default documented in the module docs);
 * - `schemaVersion` from the contracts constants.
 */
export function emitSpatialObservations(input: EmitSpatialInput): Observation[] {
  validateEmissionInput(input);
  return input.series.points.map((point) => {
    validatePointForEmission(point);
    const kind = point.label === undefined ? "participant" : FOOTBALL_LABEL_KINDS[point.label];
    return {
      observationId: `sp-${point.frameId}-${point.trackId}`,
      sessionId: input.sessionId,
      schemaVersion: SCHEMA_VERSION,
      eventTimeMs: point.sessionMs,
      modality: "vision",
      componentId: input.componentId,
      provenance: "DERIVED",
      confidence: point.confidence,
      payload: {
        kind: "track",
        entityId: point.trackId,
        position: { x: point.pitch.x, y: point.pitch.y },
      },
      subjectEntityRefs: kind === undefined ? [] : [{ entityId: point.trackId, kind }],
    };
  });
}

/**
 * Zod-parse helper: `true` iff `obs` parses against the contracts
 * `Observation` schema. Tests use it to prove every emitted record is
 * contract-valid; production callers may use it as a cheap boundary check.
 */
export function validateObservation(obs: unknown): boolean {
  return ObservationSchema.safeParse(obs).success;
}
