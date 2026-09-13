/**
 * SWM-facing ball state emission (W205).
 *
 * Architecture-lock §6: perception components EMIT observations; storing them
 * is the pipeline's job. This module turns a {@link BallStateSeries} into
 * contract `Observation` records — one per state point, payload
 * `kind: "track"` — so the ball state can feed the Sports World Model
 * (the W205 acceptance criterion).
 *
 * HONESTY RULES (documented; the tests pin them):
 *
 * - PROVENANCE: `source === "detected"` maps to `"OBSERVED"`,
 *   `source === "interpolated"` maps to `"DERIVED"`. An interpolated state
 *   point is INFERENCE (the W202 bridging model's linear interpolation with
 *   discounted confidence), not sensor evidence — emitting it as OBSERVED
 *   would be invented certainty, exactly what architecture-lock §4 forbids.
 * - VELOCITY: the payload's `velocity` key is PRESENT only when the state
 *   point defines it; when undefined the key is omitted entirely (zod
 *   `.optional()`), never zero-filled.
 * - CONFIDENCE: passthrough verbatim from the state point.
 * - IDENTITY: `subjectEntityRefs` is exactly one `LocalEntityRef`
 *   `{ entityId: "ball", kind: "ball" }` (fields `entityId` and `kind` ONLY
 *   — no label field, matching the contracts shape exactly). See the
 *   package README for the tech-lead decision on the canonical ball entity:
 *   W202 track fragmentation remains visible per point via the emission
 *   INPUT's `trackId` (not part of the observation payload); how to weigh
 *   that conflict evidence is SWM fusion (W401) territory.
 *
 * Timeline semantics (mirroring W202's emission): `eventTimeMs` is the
 * point's `presentationMs` — frame-native time on the normalized media
 * timeline. `ingestTimeMs` is deliberately NOT set: wall-clock ingestion
 * time belongs to the pipeline, and this package is deterministic (no clock
 * reads).
 *
 * Positions are emitted in IMAGE space (W202's domain), documented per the
 * `TrackPayload` `Point2D` convention ("context-dependent frame; documented
 * per payload kind"): pitch-frame projection is W206/W401 territory.
 */
import { Observation as ObservationSchema, SCHEMA_VERSION } from "@sporta/contracts";
import type { Observation, TrackPayload } from "@sporta/contracts";
import type { BallStateSeries } from "./state";
import { BALL_ENTITY_ID } from "./state";

/** Input for {@link emitBallStateObservations}. */
export interface EmitBallStateInput {
  /** Session the observations belong to (observations are session-scoped). */
  readonly sessionId: string;
  /** Producing component id (the ball-state estimator component). */
  readonly componentId: string;
  /** The state series to emit (typically {@link estimateBallState}'s output). */
  readonly series: BallStateSeries;
}

/**
 * Fails loud on malformed emission input (the repo convention — nothing is
 * fabricated to make an invalid record emit): non-empty `sessionId` /
 * `componentId`, a ball series (`entityId === "ball"`), and contract-shaped
 * points (non-empty frameId, non-negative finite presentation time, valid
 * source, confidence in [0, 1], finite position and velocity).
 */
function validateEmissionInput(input: EmitBallStateInput): void {
  if (input === null || typeof input !== "object") {
    throw new RangeError("ball state emission: input must be an object");
  }
  if (typeof input.sessionId !== "string" || input.sessionId.length < 1) {
    throw new RangeError("ball state emission: sessionId must be a non-empty string");
  }
  if (typeof input.componentId !== "string" || input.componentId.length < 1) {
    throw new RangeError("ball state emission: componentId must be a non-empty string");
  }
  const series = input.series;
  if (series === null || typeof series !== "object") {
    throw new RangeError("ball state emission: series must be a BallStateSeries");
  }
  if (series.entityId !== BALL_ENTITY_ID) {
    throw new RangeError(
      `ball state emission: series.entityId must be "${BALL_ENTITY_ID}" (got ${String(series.entityId)})`,
    );
  }
  if (!Array.isArray(series.points)) {
    throw new RangeError("ball state emission: series.points must be an array");
  }
  for (const [index, point] of series.points.entries()) {
    const where = `series.points[${index}]`;
    if (point === null || typeof point !== "object") {
      throw new RangeError(`ball state emission: ${where} must be an object`);
    }
    if (typeof point.frameId !== "string" || point.frameId.length < 1) {
      throw new RangeError(`ball state emission: ${where} needs a non-empty frameId`);
    }
    if (typeof point.presentationMs !== "number" || !Number.isFinite(point.presentationMs)) {
      throw new RangeError(`ball state emission: ${where}.presentationMs must be finite`);
    }
    if (point.presentationMs < 0) {
      throw new RangeError(
        `ball state emission: ${where}.presentationMs must be >= 0 (got ${point.presentationMs})`,
      );
    }
    if (point.source !== "detected" && point.source !== "interpolated") {
      throw new RangeError(
        `ball state emission: ${where}.source must be "detected" or "interpolated"`,
      );
    }
    if (typeof point.confidence !== "number" || !Number.isFinite(point.confidence)) {
      throw new RangeError(`ball state emission: ${where}.confidence must be finite`);
    }
    if (point.confidence < 0 || point.confidence > 1) {
      throw new RangeError(
        `ball state emission: ${where}.confidence must be in [0, 1] (got ${point.confidence})`,
      );
    }
    const position = point.position;
    if (position === null || typeof position !== "object") {
      throw new RangeError(`ball state emission: ${where}.position must be an object`);
    }
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      throw new RangeError(`ball state emission: ${where}.position must be finite`);
    }
    if (point.velocity !== undefined) {
      const velocity = point.velocity;
      if (velocity === null || typeof velocity !== "object") {
        throw new RangeError(`ball state emission: ${where}.velocity must be an object`);
      }
      if (!Number.isFinite(velocity.vx) || !Number.isFinite(velocity.vy)) {
        throw new RangeError(`ball state emission: ${where}.velocity must be finite`);
      }
    }
  }
}

/**
 * Emits one contract `Observation` per state point, in series order:
 *
 * - `observationId = "bs-<frameId>"`. Frame ids are unique per session in
 *   pipeline data (one point per frame after the W205 merge); if a frameId
 *   repeats in the provided series — which cannot happen for
 *   {@link estimateBallState} output (its deterministic merge is keyed by
 *   presentation time) but stays possible for hand-built series — the
 *   SECOND and later occurrences get `-<index>` appended (the point's
 *   0-based index in the series), so ids never collide.
 * - `eventTimeMs = point.presentationMs` (frame-native time);
 * - `modality: "vision"`;
 * - `provenance`: `detected -> "OBSERVED"`, `interpolated -> "DERIVED"`
 *   (the honesty rule in the module docs);
 * - `confidence`: passthrough verbatim;
 * - `payload`: `{ kind: "track", entityId: "ball", position, velocity? }` —
 *   the `velocity` key is present ONLY when the state point defines it.
 *   Position and velocity objects are COPIED (emitted records never alias
 *   caller-owned objects);
 * - `subjectEntityRefs: [{ entityId: "ball", kind: "ball" }]` — the exact
 *   `LocalEntityRef` shape (`entityId` + `kind` only);
 * - `schemaVersion` from the contracts constants.
 */
export function emitBallStateObservations(input: EmitBallStateInput): Observation[] {
  validateEmissionInput(input);

  const emitted: Observation[] = [];
  const seenFrameIds = new Set<string>();

  for (const [index, point] of input.series.points.entries()) {
    const observationId = seenFrameIds.has(point.frameId)
      ? `bs-${point.frameId}-${index}`
      : `bs-${point.frameId}`;
    seenFrameIds.add(point.frameId);

    const payload: TrackPayload = {
      kind: "track",
      entityId: BALL_ENTITY_ID,
      position: { x: point.position.x, y: point.position.y },
    };
    if (point.velocity !== undefined) {
      payload.velocity = { vx: point.velocity.vx, vy: point.velocity.vy };
    }

    const observation: Observation = {
      observationId,
      sessionId: input.sessionId,
      schemaVersion: SCHEMA_VERSION,
      eventTimeMs: point.presentationMs,
      modality: "vision",
      componentId: input.componentId,
      provenance: point.source === "detected" ? "OBSERVED" : "DERIVED",
      confidence: point.confidence,
      payload,
      subjectEntityRefs: [{ entityId: BALL_ENTITY_ID, kind: "ball" }],
    };
    emitted.push(observation);
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
