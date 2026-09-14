/**
 * Track observations → versioned SWM entities (W401 §3.2, pure).
 *
 * W204 emits image-space track observations and W206 emits pitch-space track
 * observations — both with `payload.kind === "track"`, `entityId = trackId`
 * (identity passthrough) and `subjectEntityRefs` carrying the tracked
 * subject's session-local kind (W204's `FOOTBALL_LABEL_KINDS`). This module
 * projects ONE such observation into an upsert-ready `WorldEntity`:
 *
 * - **identity**: `entityId = payload.entityId` — the track id, never
 *   re-mapped (ids are hypotheses; identity resolution is not W401's);
 * - **kind**: from the observation's `subjectEntityRefs` — the FIRST ref
 *   whose kind is `participant` or `ball` decides (W204/W206 emit exactly one
 *   ref; for multi-ref observations the first participant-or-ball ref wins,
 *   documented). No other kinds are invented: an observation whose refs
 *   carry neither (e.g. W204's `official`/`referee` tracks, or an unmapped
 *   label's `[]`) projects NO entity — {@link projectTrackEntity} throws and
 *   the fusion pass pre-filters with {@link trackSubjectKind};
 * - **spatial frame**: the CALLER states the frame (`"image" | "pitch"`).
 *   The observation itself cannot prove its frame — W206 carries pitch-meter
 *   positions but the `Point2D` slot is frame-less — so the fusion pass
 *   passes the frame per stream and the projection records it as a `known`
 *   slot;
 * - **honesty**: `position` is an `uncertain` candidate (track positions are
 *   perception-derived, and W206's are projected inference), carrying the
 *   observation's confidence when present and NEVER inventing one when
 *   absent; `lastSeenMs` is `known` (the observation's session-timeline
 *   position — distinct from frame-native time: W204/W206 align to the
 *   session timeline via W103 before SWM ingestion);
 * - **versioning**: the projection carries `version: 1`; the ENGINE owns
 *   version bumps on upsert (W006's `upsertEntity` ignores the caller's
 *   version for new entities and sets `existing.version + 1` on updates);
 * - **boundary**: a payload `velocity` key is IGNORED here if present —
 *   velocity fusion is a later stage's concern (W205's ball-state territory),
 *   and projecting it would silently widen W401's scope.
 */
import type { EntityKind, Observation, WorldEntity } from "@sporta/contracts";
import { jsonDeepEqual } from "./internal";

/** The spatial frames a fusion pass can declare for its track stream. */
export type TrackFrame = "image" | "pitch";

/**
 * Resolves the world-model entity kind for a track observation: the FIRST
 * `subjectEntityRefs` entry whose kind is `"participant"` or `"ball"`, or
 * `undefined` when the refs carry neither (official/referee tracks, or an
 * unmapped label's empty refs — identity is never guessed).
 */
export function trackSubjectKind(track: Observation): EntityKind | undefined {
  for (const ref of track.subjectEntityRefs) {
    if (ref.kind === "participant" || ref.kind === "ball") return ref.kind;
  }
  return undefined;
}

/** A track observation projected into an upsert-ready world entity. */
export interface EntityProjection {
  /** The projected entity (upsert-ready; the engine owns version bumps). */
  entity: WorldEntity;
  /** The track observation the projection came from — the evidence link. */
  fromObservationId: string;
}

/**
 * Projects one `kind: "track"` observation into a {@link WorldEntity}.
 *
 * Throws a `RangeError` (fail loud, repo style) when the observation is not
 * a track payload, its `entityId` is not a projection of the tracked subject
 * (the payload contract guarantees the `EntityId` pattern, so this cannot
 * fire for contract-valid records), or its refs carry no participant/ball
 * kind (see {@link trackSubjectKind} — the fusion pre-filters those).
 *
 * The projected entity's state slots (all `UncertainValue`):
 *
 * - `"position"`: `{ status: "uncertain", value: payload.position }` plus the
 *   observation's `confidence` when present (absent confidence stays
 *   confidence-less — never invented);
 * - `"spatialFrame"`: `{ status: "known", value: frame }` — the caller-declared
 *   frame (the observation cannot prove its own frame);
 * - `"lastSeenMs"`: `{ status: "known", value: eventTimeMs }` — the SESSION
 *   timeline position (frame-native time is a perception-internal convention).
 */
export function projectTrackEntity(track: Observation, frame: TrackFrame): EntityProjection {
  if (track.payload.kind !== "track") {
    throw new RangeError(
      `projectTrackEntity: observation "${track.observationId}" has payload kind ` +
        `"${track.payload.kind}" (requires "track")`,
    );
  }
  const kind = trackSubjectKind(track);
  if (kind === undefined) {
    throw new RangeError(
      `projectTrackEntity: track observation "${track.observationId}" carries no ` +
        "participant/ball subjectEntityRef — no entity kind can be projected without " +
        "inventing one (use trackSubjectKind to pre-filter)",
    );
  }
  return {
    entity: {
      entityId: track.payload.entityId,
      kind,
      version: 1,
      lastEventTimeMs: track.eventTimeMs,
      state: {
        position: {
          status: "uncertain",
          value: { ...track.payload.position },
          ...(track.confidence !== undefined ? { confidence: track.confidence } : {}),
        },
        spatialFrame: { status: "known", value: frame },
        lastSeenMs: { status: "known", value: track.eventTimeMs },
      },
    },
    fromObservationId: track.observationId,
  };
}

/**
 * Guards an upsert against re-application: `true` when the engine's stored
 * entity already holds this projection's state, or holds a LATER state whose
 * replay the upsert would rewind (W006's `upsertEntity` REPLACES state
 * wholesale and only clamps `lastEventTimeMs` monotonically — upserting an
 * older observation would move the position back in time).
 *
 * This is the fusion pass's entity idempotence rule (documented):
 * re-running fusion over the same engine+store must leave the entity map and
 * the snapshot version untouched, while a first run over a time-ordered
 * stream applies every projection in order.
 */
export function upsertWouldBeNoOp(
  existing: WorldEntity | undefined,
  projected: WorldEntity,
): boolean {
  if (existing === undefined) return false;
  if (existing.lastEventTimeMs > projected.lastEventTimeMs) return true;
  if (existing.lastEventTimeMs === projected.lastEventTimeMs) {
    return jsonDeepEqual(existing.state, projected.state);
  }
  return false;
}
