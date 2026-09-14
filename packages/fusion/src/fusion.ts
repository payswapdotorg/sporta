/**
 * The deterministic multimodal fusion pass (W401 §3.4).
 *
 * W401 is the FUSION LAYER: it reads a W005 `ObservationStore` (read-only)
 * and drives a W006 `WorldModelEngine` deterministically — entities, events,
 * football state — never inventing values, never collapsing conflicts, and
 * keeping an explicit, queryable conflict ledger. No new perception, no new
 * understanding, no new storage.
 *
 * PASS ORDER (documented; same input → deep-equal report AND deep-equal
 * engine state — no `Date.now`, no `Math.random`, no ambient state):
 *
 * 1. `store.query({ sessionId })` sorted by (eventTimeMs, observationId) —
 *    the stable total order. The observationId tiebreak matters because the
 *    store's own query order breaks event-time ties by APPEND order, an
 *    ingestion artifact that is not a function of record content; sorting
 *    here makes the pass a pure function of the SET of stored observations.
 * 2. ENTITIES: every `kind: "track"` observation is projected
 *    (`projectTrackEntity`) and upserted in order — the engine owns
 *    versioning. Track observations whose refs carry no participant/ball
 *    kind (W204 official/referee tracks, unmapped labels) are SKIPPED with
 *    an aggregate warning — no kind is invented. An upsert that would only
 *    rewind an already-later entity state (or re-apply an identical one) is
 *    skipped: W006's `upsertEntity` REPLACES state wholesale, so replaying
 *    history would move positions backwards — and skipping keeps re-fusion
 *    idempotent (see `upsertWouldBeNoOp`).
 * 3. EVENTS: every W209 commentary candidate (modality "commentary", generic
 *    payload parsing as `CandidatePayload`) with a mapped football event is
 *    turned into an envelope (`buildEventEnvelope`), derived through the
 *    W005 `EventDerivationService` (evidence must resolve in the store — the
 *    W005 seam), and applied to the engine. `DuplicateEventError` → skip +
 *    count (idempotent re-fusion: the deterministic `fe-<observationId>`
 *    event id is what the engine deduplicates on). `LateEventError` → a
 *    warning string (bounded reorder honored — never silent; late events are
 *    counted as warnings because the report schema has no dedicated field).
 *    `fulltime` candidates carry no event: they yield a clock patch
 *    (`buildClockPatch`, `clockMs` pinned to the engine's current football
 *    timeline position) applied via `applyFootballState`; a patch whose
 *    period and stoppage are already installed and whose clock would not
 *    regress is a re-application no-op and is skipped (the `clockMs` input is
 *    re-derived caller context, not evidence — its drift between runs must
 *    not re-bump the snapshot version). `other` candidates map to no event:
 *    counted in an aggregate warning, NOT applied — the candidate REMAINS in
 *    the observation stream. Unknown event types (outside the W209
 *    vocabulary) are skipped with an aggregate warning listing them.
 * 4. POSSESSION (documented, honest, deterministic): the LATEST ball track
 *    observation plus the LATEST per-entity participant positions from the
 *    same stream, when the pass's track frame is "pitch". The nearest
 *    participant within `possessionRadiusM` (Euclidean pitch meters,
 *    `Math.sqrt(dx*dx + dy*dy)` — not `Math.hypot`, whose exact rounding is
 *    implementation-defined) wins:
 *    `confidence = ballConfidence * trackConfidence * (1 - distance / radius)`
 *    (all three factors documented; distance 0 → the full product; exactly at
 *    the radius → 0). A missing ball/track confidence contributes W005's
 *    exported `MISSING_CONFIDENCE_DEFAULT` (0.5) — the documented
 *    absent-evidence default, never an invented 1.0. When two or more
 *    participants tie within `POSSESSION_AMBIGUITY_EPSILON` (1e-9) of the
 *    minimum distance, NO possession is set — the tie is recorded as a
 *    "possession" `ConflictRecord` listing EVERY tied participant
 *    observation, and the engine slot stays untouched (no silent winner).
 *    When the pass's track frame is "image", possession is skipped with a
 *    warning (possession needs pitch meters). Absent ball or participant
 *    tracks, or no participant within the radius, simply leave the slot
 *    untouched (absence of evidence is not a state change). Re-applying the
 *    SAME possession value is skipped (idempotence).
 * 5. CONFLICTS: `detectSlotConflicts` runs on the clock-period slot
 *    (period-implying candidates; conflicting period patches within the
 *    engine's reorder window). The possession slot's conflict IS the step-4
 *    tie record, constructed through `detectSlotConflicts` over the tied
 *    records — running it over ALL proximity records would misfire on
 *    normal multi-player proximity. Score fusion is OUT OF SCOPE (no honest
 *    scorer-side resolution exists yet — known limitation; do NOT invent
 *    one). Conflict ids are minted per report in merge order: gap-free
 *    `cf-1, cf-2, …` across slots.
 * 6. `snapshotVersionAfter = engine.snapshotVersion`.
 */
import type { Observation } from "@sporta/contracts";
import { MISSING_CONFIDENCE_DEFAULT, EventDerivationService } from "@sporta/observation";
import type { ObservationStore } from "@sporta/observation";
import {
  ClockRegressionError,
  DuplicateEventError,
  FootballStateMissingError,
  LateEventError,
} from "@sporta/world-model";
import type { WorldModelEngine } from "@sporta/world-model";
import { buildConflictRecord, detectSlotConflicts } from "./conflicts";
import type { ConflictRecord } from "./conflicts";
import { projectTrackEntity, trackSubjectKind, upsertWouldBeNoOp } from "./entities";
import type { TrackFrame } from "./entities";
import {
  FOOTBALL_EVENT_MAP,
  buildClockPatch,
  buildEventEnvelope,
  parseCandidatePayload,
} from "./events";
import { jsonDeepEqual, sortedByTimeThenObservationId } from "./internal";

/** Default possession radius in canonical pitch meters (W401 spec). */
export const DEFAULT_POSSESSION_RADIUS_M = 2;

/**
 * Two participants whose distances to the ball differ by at most this
 * epsilon (1e-9 pitch meters) are treated as EQUIDISTANT: no winner is
 * picked, the tie becomes an explicit possession conflict.
 */
export const POSSESSION_AMBIGUITY_EPSILON = 1e-9;

/** Input for {@link runWorldFusion}. */
export interface FusionInput {
  /** The W005 observation store (read-only: the fusion never appends). */
  store: ObservationStore;
  /** The W006 world-model engine this pass drives. */
  engine: WorldModelEngine;
  /** The media session both store contents and engine belong to. */
  sessionId: string;
  /**
   * The spatial frame of this pass's track stream (default `"pitch"` — the
   * W206 stream). The observation itself cannot prove its frame; the CALLER
   * states it per stream.
   */
  trackFrame?: TrackFrame;
  /** Possession radius in canonical pitch meters (default 2). */
  possessionRadiusM?: number;
}

/** The deterministic result of one fusion pass. */
export interface FusionReport {
  /** Track observations projected and upserted (engine-versioned). */
  entitiesUpserted: number;
  /** Commentary candidate events applied to the engine's event log. */
  eventsApplied: number;
  /** `DuplicateEventError` occurrences — skipped (idempotent re-fusion). */
  eventsDeduplicated: number;
  /** Fulltime clock patches applied via `applyFootballState`. */
  clockPatches: number;
  /** Possession candidates set via `setPossession`. */
  possessionUpdates: number;
  /** The explicit conflict ledger (possession ties, clock-period conflicts). */
  conflicts: readonly ConflictRecord[];
  /** The engine's snapshot version after the pass. */
  snapshotVersionAfter: number;
  /**
   * Human-readable, deterministic warnings — e.g. dropped `"other"`
   * candidates, unmapped event types, late events rejected by the bounded
   * reorder window, skipped phases (image-frame possession, missing
   * football state).
   */
  warnings: readonly string[];
}

/** The implied period of a period-establishing candidate, else `undefined`. */
function impliedPeriodOf(observation: Observation): string | undefined {
  const data = parseCandidatePayload(observation);
  if (data === null) return undefined;
  return FOOTBALL_EVENT_MAP[data.eventType]?.clockRule;
}

/** Validates the fusion input; throws `RangeError` (fail loud, repo style). */
function validateInput(input: FusionInput): TrackFrame {
  if (input === null || typeof input !== "object") {
    throw new RangeError("runWorldFusion: input must be an object");
  }
  if (typeof input.sessionId !== "string" || input.sessionId.length < 1) {
    throw new RangeError("runWorldFusion: sessionId must be a non-empty string");
  }
  if (typeof input.store?.query !== "function" || typeof input.store?.byId !== "function") {
    throw new RangeError("runWorldFusion: store must be an ObservationStore");
  }
  if (typeof input.engine?.upsertEntity !== "function") {
    throw new RangeError("runWorldFusion: engine must be a WorldModelEngine");
  }
  // Entities carry no sessionId of their own — a session-mismatched engine
  // would silently collect another session's entities, so fail loud instead.
  if (input.engine.sessionId !== input.sessionId) {
    throw new RangeError(
      `runWorldFusion: engine session "${input.engine.sessionId}" does not match ` +
        `input session "${input.sessionId}"`,
    );
  }
  const trackFrame = input.trackFrame ?? "pitch";
  if (trackFrame !== "image" && trackFrame !== "pitch") {
    throw new RangeError('runWorldFusion: trackFrame must be "image" or "pitch"');
  }
  const radius = input.possessionRadiusM ?? DEFAULT_POSSESSION_RADIUS_M;
  if (typeof radius !== "number" || !Number.isFinite(radius) || radius <= 0) {
    throw new RangeError(
      `runWorldFusion: possessionRadiusM must be a finite number > 0 (default ` +
        `${DEFAULT_POSSESSION_RADIUS_M})`,
    );
  }
  return trackFrame;
}

/** A participant's latest position plus its distance to the latest ball. */
interface PossessionCandidate {
  observation: Observation;
  entityId: string;
  distance: number;
}

/**
 * Runs the deterministic fusion pass. Pure with respect to ambient state:
 * the report and the resulting engine state are functions of
 * (store contents, engine state, input options) only.
 */
export function runWorldFusion(input: FusionInput): FusionReport {
  const trackFrame = validateInput(input);
  const possessionRadiusM = input.possessionRadiusM ?? DEFAULT_POSSESSION_RADIUS_M;
  const { store, engine, sessionId } = input;

  // -- Pass order step 1: canonical total order over the session's records.
  const observations = sortedByTimeThenObservationId(store.query({ sessionId }));

  const warnings: string[] = [];
  const conflicts: ConflictRecord[] = [];
  let nextConflictSeq = 1;
  let entitiesUpserted = 0;
  let eventsApplied = 0;
  let eventsDeduplicated = 0;
  let clockPatches = 0;
  let possessionUpdates = 0;

  // -- Pass order step 2: ENTITIES ------------------------------------------
  const trackObservations = observations.filter((obs) => obs.payload.kind === "track");
  let nonProjectableTracks = 0;
  for (const track of trackObservations) {
    if (trackSubjectKind(track) === undefined) {
      nonProjectableTracks += 1;
      continue;
    }
    const projection = projectTrackEntity(track, trackFrame);
    if (upsertWouldBeNoOp(engine.entityAt(projection.entity.entityId), projection.entity)) {
      continue;
    }
    engine.upsertEntity(projection.entity);
    entitiesUpserted += 1;
  }
  if (nonProjectableTracks > 0) {
    warnings.push(
      `skipped ${nonProjectableTracks} track observation(s) without a participant/ball ` +
        "entity ref — no entity kind invented",
    );
  }

  // -- Pass order step 3: EVENTS (commentary candidates) --------------------
  const candidates = observations.filter(
    (obs) => obs.modality === "commentary" && parseCandidatePayload(obs) !== null,
  );
  const derivation = new EventDerivationService(store);
  let otherCandidates = 0;
  let unmappedCandidates = 0;
  const unmappedEventTypes = new Set<string>();
  let clockPatchesWithoutFootballState = 0;

  for (const candidate of candidates) {
    const data = parseCandidatePayload(candidate)!;
    const mapped = FOOTBALL_EVENT_MAP[data.eventType];

    if (mapped === undefined) {
      // Unknown eventType (outside the W209 vocabulary): no event, warned.
      unmappedCandidates += 1;
      unmappedEventTypes.add(data.eventType);
      continue;
    }
    if (mapped.event === undefined) {
      if (mapped.clockRule !== undefined) {
        // fulltime: NO event — a period-establishing clock patch instead.
        const football = engine.snapshot().football;
        if (football === undefined) {
          clockPatchesWithoutFootballState += 1;
          continue;
        }
        const patch = buildClockPatch(candidate, engine.footballTimelineMs);
        if (patch === null || patch.clock === undefined) {
          // Exhaustive-completeness guards only: a clockRule-bearing
          // candidate always yields a patch carrying a clock
          // (buildClockPatch); the FootballStatePatch TYPE allows both
          // absences, so the honest guard replaces a non-null assertion.
          continue;
        }
        const currentClock = football.clock;
        const reapplicationNoOp =
          currentClock.period === patch.clock.period &&
          currentClock.stoppage === patch.clock.stoppage &&
          patch.clock.clockMs >= currentClock.clockMs;
        if (reapplicationNoOp) {
          continue;
        }
        try {
          engine.applyFootballState(patch);
          clockPatches += 1;
        } catch (error) {
          if (error instanceof ClockRegressionError) {
            warnings.push(
              `clock patch at ${patch.atMs}ms rejected by the engine: ${error.message}`,
            );
          } else if (error instanceof FootballStateMissingError) {
            clockPatchesWithoutFootballState += 1;
          } else {
            throw error;
          }
        }
        continue;
      }
      // "other": insufficient specificity — the candidate REMAINS in the
      // observation stream; it is counted, never applied.
      otherCandidates += 1;
      continue;
    }

    const envelope = buildEventEnvelope({
      sessionId,
      candidate,
      evidence: { observationIds: [], reportedBy: "commentary" },
    });
    const derived = derivation.deriveEvent({
      sessionId,
      eventId: envelope.eventId,
      eventTypeRef: envelope.eventTypeRef,
      interval: envelope.interval,
      eventTimeMs: envelope.eventTimeMs,
      evidence: {
        observationIds: [...envelope.evidence.observationIds],
        ...(envelope.evidence.reportedBy !== undefined
          ? { reportedBy: envelope.evidence.reportedBy }
          : {}),
      },
      ...(envelope.confidence !== undefined ? { confidence: envelope.confidence } : {}),
    });
    try {
      engine.applyEvent(derived);
      eventsApplied += 1;
    } catch (error) {
      if (error instanceof DuplicateEventError) {
        // Idempotent re-fusion: the deterministic fe-<observationId> event id
        // already exists in the log — skip and count.
        eventsDeduplicated += 1;
      } else if (error instanceof LateEventError) {
        warnings.push(
          `late event ${derived.eventId} at ${derived.eventTimeMs}ms rejected by the engine ` +
            `(log high-water ${error.logHighWaterMs}ms, maxReorderMs ${error.maxReorderMs}ms) ` +
            "— not applied",
        );
      } else {
        throw error;
      }
    }
  }
  if (otherCandidates > 0) {
    warnings.push(
      `dropped ${otherCandidates} "other" commentary candidate(s) (insufficient specificity ` +
        "— they remain in the observation stream)",
    );
  }
  if (unmappedCandidates > 0) {
    warnings.push(
      `skipped ${unmappedCandidates} commentary candidate(s) with unmapped eventType: ` +
        `${[...unmappedEventTypes].sort().join(", ")}`,
    );
  }
  if (clockPatchesWithoutFootballState > 0) {
    warnings.push(
      `skipped ${clockPatchesWithoutFootballState} fulltime clock patch(es): engine carries ` +
        "no football state",
    );
  }

  // -- Pass order step 4: POSSESSION candidate ------------------------------
  if (trackFrame !== "pitch") {
    warnings.push('possession skipped: track frame is "image" (possession requires pitch meters)');
  } else {
    const footballState = engine.snapshot().football;
    if (footballState === undefined) {
      warnings.push("possession skipped: engine carries no football state");
    } else {
      // The LATEST ball track observation (canonical order's last).
      const ballTracks = trackObservations.filter((obs) => trackSubjectKind(obs) === "ball");
      const latestBall = ballTracks.at(-1);
      // The LATEST per-entity participant positions from the same stream.
      const latestPerParticipant = new Map<string, Observation>();
      for (const obs of trackObservations) {
        if (obs.payload.kind !== "track" || trackSubjectKind(obs) !== "participant") continue;
        latestPerParticipant.set(obs.payload.entityId, obs);
      }

      if (latestBall !== undefined && latestBall.payload.kind === "track") {
        const ballPosition = latestBall.payload.position;
        const ballConfidence = latestBall.confidence ?? MISSING_CONFIDENCE_DEFAULT;
        const withinRadius: PossessionCandidate[] = [];
        for (const [entityId, obs] of latestPerParticipant) {
          if (obs.payload.kind !== "track") continue;
          const dx = ballPosition.x - obs.payload.position.x;
          const dy = ballPosition.y - obs.payload.position.y;
          // Deterministic Euclidean distance (see module docs on hypot).
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance <= possessionRadiusM) {
            withinRadius.push({ observation: obs, entityId, distance });
          }
        }
        withinRadius.sort(
          (a, b) =>
            a.distance - b.distance ||
            (a.observation.observationId < b.observation.observationId ? -1 : 1),
        );

        if (withinRadius.length > 0) {
          const minDistance = withinRadius[0]!.distance;
          const tied = withinRadius.filter(
            (entry) => entry.distance - minDistance <= POSSESSION_AMBIGUITY_EPSILON,
          );

          if (tied.length >= 2) {
            // Ambiguous: NO setPossession — an explicit conflict listing EVERY
            // tied participant observation; the engine slot stays untouched.
            // (Tied candidates are one-per-entity, so their values differ.)
            const tiedObservations = tied.map((entry) => entry.observation);
            const possessorValueOf = (obs: Observation): string | undefined =>
              obs.payload.kind === "track" ? obs.payload.entityId : undefined;
            const detected = detectSlotConflicts(
              tiedObservations,
              "possession",
              possessorValueOf,
              engine.maxReorderMs,
              nextConflictSeq,
            );
            if (detected.length > 0) {
              conflicts.push(...detected);
              nextConflictSeq += detected.length;
            } else {
              // Pathological: the tied records span more than the reorder
              // window (stale-track ties) — still never silent, never a winner.
              conflicts.push(
                buildConflictRecord(
                  "possession",
                  tiedObservations,
                  possessorValueOf,
                  nextConflictSeq,
                ),
              );
              nextConflictSeq += 1;
            }
          } else {
            const winner = withinRadius[0]!;
            const trackConfidence = winner.observation.confidence ?? MISSING_CONFIDENCE_DEFAULT;
            const confidence =
              ballConfidence * trackConfidence * (1 - winner.distance / possessionRadiusM);
            const nextPossession = {
              status: "uncertain" as const,
              value: { entityId: winner.entityId },
              confidence,
            };
            if (!jsonDeepEqual(footballState.possession, nextPossession)) {
              engine.setPossession(winner.entityId, confidence);
              possessionUpdates += 1;
            }
          }
        }
        // No participant within the radius: the slot stays untouched —
        // absence of a possession candidate is not a state change.
      }
      // No ball or no participant tracks: the slot stays untouched (absence
      // of evidence is not an event; documented).
    }
  }

  // -- Pass order step 5: CONFLICTS (slot sweeps) ---------------------------
  // Clock-period slot: period-implying candidates (fulltime → "post-match").
  // With the delivered W209 vocabulary no two DISTINCT periods are derivable
  // (only fulltime carries a clockRule), so this sweep is the mechanism for
  // a future period-implying vocabulary (e.g. kickoff → "first-half"); it
  // cannot fire today, and the tests pin that honesty. The possession slot's
  // conflict was minted above (step 4) — sweeping ALL proximity records
  // would misfire on normal multi-player proximity.
  const clockPeriodRecords = candidates.filter((obs) => impliedPeriodOf(obs) !== undefined);
  if (clockPeriodRecords.length > 0) {
    const clockConflicts = detectSlotConflicts(
      clockPeriodRecords,
      "clock-period",
      (obs) => impliedPeriodOf(obs),
      engine.maxReorderMs,
      nextConflictSeq,
    );
    conflicts.push(...clockConflicts);
    nextConflictSeq += clockConflicts.length;
  }

  // -- Pass order step 6: the resulting snapshot version. -------------------
  return {
    entitiesUpserted,
    eventsApplied,
    eventsDeduplicated,
    clockPatches,
    possessionUpdates,
    conflicts,
    snapshotVersionAfter: engine.snapshotVersion,
    warnings,
  };
}
