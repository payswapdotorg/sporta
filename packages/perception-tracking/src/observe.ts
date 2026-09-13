/**
 * Track observation emission (W204).
 *
 * Architecture-lock §6: perception components EMIT observations; storing them
 * is the pipeline's job. This module turns one frame's tracked boxes into
 * contract `Observation` records — one per tracked box — carrying the
 * persistent track id as the payload `entityId` and (when the label maps) a
 * `subjectEntityRefs` entry. Confidence is the tracker's per-detection
 * passthrough, preserved VERBATIM (no silent confidence collapse).
 *
 * Timeline semantics (same convention as W201/W203): `eventTimeMs` is the
 * frame's `presentationMs` — FRAME-NATIVE time on the normalized media
 * timeline. Mapping to a session timeline (clock offsets, W103) is the
 * caller's job when one exists; the emitted records are otherwise
 * store-compatible as-is (validated here). `ingestTimeMs` is deliberately
 * NOT set: wall-clock ingestion time belongs to the pipeline, and this
 * package is deterministic (no clock reads).
 *
 * TL decision — position frame (documented): the payload position is the box
 * CENTER in normalized IMAGE space [0, 1] — `x = box.x + box.w / 2`,
 * `y = box.y + box.h / 2`. Pitch-frame conversion is applied DOWNSTREAM via
 * the W203 homography plus W206 fusion; `Point2D` is unitless, so emitting
 * image-space centers is schema-valid today and unambiguous (this module
 * documents the frame it emits in).
 *
 * Scope boundary — NO velocity (documented): the `TrackPayload` contract has
 * an optional velocity, but state ESTIMATION (position filtering, velocity
 * derivation) is W205/W206's concern, not the association tracker's. This
 * module never sets `velocity`; a velocity-bearing track observation will be
 * produced by the state-estimation stage once it exists.
 */
import { Observation as ObservationSchema, SCHEMA_VERSION } from "@sporta/contracts";
import type { EntityKind, Observation } from "@sporta/contracts";
import type { TrackerFrameInput, TrackedBox } from "./tracker";

/**
 * Default label -> `EntityKind` map for football detections: the kind a
 * `subjectEntityRef` gets for a tracked box's label. Deliberately
 * conservative — a label with no mapping gets NO ref (see
 * {@link emitTrackObservations}) rather than an invented kind.
 */
export const FOOTBALL_LABEL_KINDS: Readonly<Record<string, EntityKind>> = {
  player: "participant",
  ball: "ball",
  official: "official",
  referee: "official",
};

/** Input for {@link emitTrackObservations}: one frame's worth of work. */
export interface EmitTrackInput {
  /** Session the observations belong to (observations are session-scoped). */
  readonly sessionId: string;
  /** Producing component id (typically the tracker's `trackerId`). */
  readonly componentId: string;
  /** The frame the tracks were assigned on (id + timeline position). */
  readonly frame: TrackerFrameInput;
  /** The frame's tracked boxes, in emission (detection) order. */
  readonly tracks: readonly TrackedBox[];
  /**
   * OPTIONAL full OVERRIDE of {@link FOOTBALL_LABEL_KINDS}: when provided, it
   * is used INSTEAD of the default map (replacement, not merge — two active
   * maps would make label semantics ambiguous). Labels absent from the
   * provided map get no entity ref, exactly like with the default map.
   */
  readonly labelToKind?: Readonly<Record<string, EntityKind>>;
}

/**
 * Emits one contract `Observation` per tracked box:
 *
 * - `observationId = "trk-<frameId>-<index>"` (index = position in `tracks`,
 *   so ids are unique per frame as long as frame ids are);
 * - `eventTimeMs = frame.presentationMs` (frame-native time — see module
 *   docs);
 * - `modality: "vision"`, `provenance: "OBSERVED"`, `componentId` from the
 *   input;
 * - `confidence` passed through verbatim from the tracked box (which itself
 *   passed the detection's confidence through);
 * - `payload = { kind: "track", entityId: trackId, position: boxCenter }`
 *   with the position in normalized image space and NO velocity (scope
 *   boundary — see module docs); the payload position object is freshly
 *   computed so the record never aliases caller-owned boxes;
 * - `subjectEntityRefs`: `[{ entityId: trackId, kind }]` where `kind` comes
 *   from `labelToKind` (when given) or {@link FOOTBALL_LABEL_KINDS}. A label
 *   with NO mapping gets `subjectEntityRefs: []` — NO ref rather than an
 *   invented kind (identity is never guessed);
 * - `schemaVersion` from the contracts constants.
 */
export function emitTrackObservations(input: EmitTrackInput): Observation[] {
  const labelToKind = input.labelToKind ?? FOOTBALL_LABEL_KINDS;
  return input.tracks.map((track, index) => {
    const kind = labelToKind[track.label];
    return {
      observationId: `trk-${input.frame.frameId}-${index}`,
      sessionId: input.sessionId,
      schemaVersion: SCHEMA_VERSION,
      eventTimeMs: input.frame.presentationMs,
      modality: "vision",
      componentId: input.componentId,
      provenance: "OBSERVED",
      confidence: track.confidence,
      payload: {
        kind: "track",
        entityId: track.trackId,
        position: {
          x: track.box.x + track.box.w / 2,
          y: track.box.y + track.box.h / 2,
        },
      },
      subjectEntityRefs: kind === undefined ? [] : [{ entityId: track.trackId, kind }],
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
