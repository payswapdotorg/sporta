/**
 * THE LIVE ENTITY PROJECTION (L003 design D2/D3) — one live entity observation
 * → one upsert-ready `WorldEntity`, plus the W005 bridge envelope (D6).
 *
 * NO DUPLICATE PROJECTION SEMANTICS (the D4 constraint): this module MIRRORS
 * `@sporta/fusion`'s `projectTrackEntity` conventions exactly — the same
 * `UncertainValue` slots (`position` uncertain + the row's confidence
 * verbatim, `spatialFrame` known, `lastSeenMs` known), the same identity
 * passthrough (`entityId = entityRef`, never re-mapped — ids are hypotheses),
 * the same `version: 1` (the ENGINE owns bumps), and the same honest skips:
 * rows whose kind has no SWM participant/ball semantics project NO entity (no
 * kind is invented — the batch pass's `trackSubjectKind` rule, applied to the
 * live vocabulary).
 *
 * The differences from the batch projection are all DATA-level and documented:
 * - the spatial frame is "pitch" BY LIVE-CONTRACT (the frozen live-reality §2:
 *   "Pitch coordinates use the Sporta canonical field coordinate contract") —
 *   not caller-declared as in batch fusion (W204 image vs W206 pitch);
 * - `lastEventTimeMs` is the ROW's own `observedAtMs` (the live dual-clock
 *   convention; a row may be older than its batch);
 * - `zMeters` and `velocity` are NOT projected — the frozen W005 `TrackPayload`
 *   and the batch projection's state map carry neither (velocity fusion is
 *   W205's ball-state territory; z is dropped at the same seam
 *   `packages/real-to-swm/src/bridge.ts` drops it) — projecting them here
 *   would FORK the live and replay semantics.
 */
import type { Observation, WorldEntity } from "@sporta/contracts";
import { SCHEMA_VERSION } from "@sporta/contracts";
import type { EntityKind } from "@sporta/contracts";
import type { LiveEntityObservation, LiveObservation } from "@sporta/live-source";

/** The honest kind map: live vocabulary → SWM entity kinds (no inventions). */
export function liveKindToEntityKind(kind: LiveEntityObservation["kind"]): EntityKind | undefined {
  switch (kind) {
    case "PLAYER":
      return "participant";
    case "BALL":
      return "ball";
    // REFEREE rows carry no participant/ball semantics in today's SWM state
    // map (the batch pass's official-track skip, mirrored); OTHER rows have
    // no honest EntityKind at all — both are counted, never guessed.
    default:
      return undefined;
  }
}

/** The honest kind map for W005 bridge refs (REFEREE → "official" is honest). */
export function liveKindToBridgeKind(kind: LiveEntityObservation["kind"]): EntityKind | undefined {
  switch (kind) {
    case "PLAYER":
      return "participant";
    case "BALL":
      return "ball";
    case "REFEREE":
      return "official";
    default:
      return undefined; // OTHER has no honest EntityKind — never bridged
  }
}

/** A live entity observation projected into an upsert-ready world entity. */
export interface LiveEntityProjection {
  /** The projected entity (upsert-ready; the engine owns version bumps). */
  entity: WorldEntity;
  /** Whether the row was an honest carry (`detected: false`) — extrapolation marking. */
  carried: boolean;
}

/**
 * Projects one live entity observation into a {@link WorldEntity}. Returns
 * `undefined` for rows whose kind has no SWM semantics (REFEREE/OTHER — the
 * batch pass's skip rule, mirrored; the caller counts them, never invents a
 * kind).
 *
 * The projected entity's state slots (the batch projection's conventions,
 * verbatim):
 *
 * - `"position"`: `{ status: "uncertain", value: {x, y} }` plus the row's
 *   `confidence` VERBATIM (never floored, never averaged — architecture-lock
 *   §6). A carried row's position IS the source's own last-known carry with
 *   its reduced confidence — the projection never invents one;
 * - `"spatialFrame"`: `{ status: "known", value: "pitch" }` — by live
 *   contract (see the module doc);
 * - `"lastSeenMs"`: `{ status: "known", value: observedAtMs }` — the ROW's
 *   own event time.
 */
export function projectLiveEntity(row: LiveEntityObservation): LiveEntityProjection | undefined {
  const kind = liveKindToEntityKind(row.kind);
  if (kind === undefined) return undefined;
  return {
    entity: {
      entityId: row.entityRef,
      kind,
      version: 1,
      lastEventTimeMs: row.observedAtMs,
      state: {
        position: {
          status: "uncertain",
          value: { x: row.position.xMeters, y: row.position.yMeters },
          confidence: row.confidence,
        },
        spatialFrame: { status: "known", value: "pitch" },
        lastSeenMs: { status: "known", value: row.observedAtMs },
      },
    },
    carried: !row.detected,
  };
}

/**
 * The zero-padded sequence field for bridge observation ids: fixed-width
 * (12 digits) so the lexicographic `observationId` order of same-time rows
 * reproduces the per-source SEQUENCE order — the property the replay-equality
 * test (D6) depends on when the batch pass breaks event-time ties by id.
 */
function paddedSequence(sequence: number): string {
  return String(sequence).padStart(12, "0");
}

/**
 * Builds one W005 `Observation` bridge envelope from a live entity row (the
 * D6 continuity rule: live observations append to the SAME store the batch
 * path reads — the `packages/real-to-swm/src/bridge.ts` pattern, never a
 * second store). Deterministic + injective per (source, sequence, entity):
 * `lo-<sourceId>-<zero-padded sequence>-<entityRef>`.
 *
 * Honest losses (mirrored at both seams, never forked): `zMeters` and
 * `velocity` are not representable in the frozen `TrackPayload` — they are
 * dropped here exactly as the batch bridge drops them.
 */
export function bridgeLiveEntity(
  batch: LiveObservation,
  row: LiveEntityObservation,
): Observation | undefined {
  const kind = liveKindToBridgeKind(row.kind);
  if (kind === undefined) return undefined; // OTHER — no honest kind, never bridged
  return {
    observationId: `lo-${batch.sourceId}-${paddedSequence(batch.sequence)}-${row.entityRef}`,
    sessionId: batch.sessionId,
    schemaVersion: SCHEMA_VERSION,
    eventTimeMs: row.observedAtMs,
    ingestTimeMs: batch.ingestTimeMs,
    modality: "vision",
    componentId: batch.sourceId,
    provenance: batch.provenance,
    confidence: row.confidence,
    payload: {
      kind: "track",
      entityId: row.entityRef,
      position: { x: row.position.xMeters, y: row.position.yMeters },
    },
    subjectEntityRefs: [{ entityId: row.entityRef, kind }],
  };
}

/**
 * The canonical per-batch application order (D2.1): the batch's entity
 * observations sorted by `(observedAtMs, entityRef)` — the stable total order
 * mirroring `runWorldFusion`'s `(eventTimeMs, observationId)` rule
 * (`entityRef` is the batch-local tiebreak because live batches carry no
 * observation ids).
 */
export function sortedByTimeThenEntityRef(
  rows: readonly LiveEntityObservation[],
): LiveEntityObservation[] {
  return [...rows].sort(
    (a, b) => a.observedAtMs - b.observedAtMs || (a.entityRef < b.entityRef ? -1 : 1),
  );
}
