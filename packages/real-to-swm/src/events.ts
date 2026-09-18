/**
 * Vision-derived event candidates (R207 emit stage).
 *
 * HONESTY CONTRACT (architecture-lock §4/§6; the R208 gate acceptance):
 * event candidates are TYPED, carry CONFIDENCE propagated only from their
 * supporting evidence, and link every candidate to its evidence
 * observations — never invented beyond what perception produced. Two
 * vocabularies, kept strictly apart:
 *
 * - **Canonical football events** (`football/v1/possession-change`, from the
 *   frozen FOOTBALL_EVENT_TYPES taxonomy): applied to the world-model event
 *   log through the W005 `EventDerivationService` (which resolves every
 *   evidence id in the store and validates the envelope). Only derivable
 *   when pitch-space positions exist (calibration succeeded) — possession is
 *   a pitch-meters concept (the W401 fusion module itself refuses possession
 *   in image frame), so an image-frame run emits NONE and records why.
 * - **Pipeline-level candidates** (`real-to-swm/v1/ball-impulse`): honest
 *   statements about the ball's IMAGE-SPACE motion only — a sustained speed
 *   discontinuity or direction reversal between consecutive DETECTED ball
 *   points. They claim nothing about who or what caused the impulse, and are
 *   recorded in the artifact's candidate list, NOT applied to the engine
 *   (the W209 pattern: candidates remain candidates until a fusion rule
 *   maps them; no such rule exists for vision impulses today).
 */
import type { Observation } from "@sporta/contracts";
import type { BallImpulseGates } from "./config";

/** The pipeline-level candidate record carried in the artifact. */
export interface EventCandidateRecord {
  /** Deterministic candidate id. */
  readonly candidateId: string;
  /** The candidate's typed vocabulary entry. */
  readonly eventTypeRef: string;
  /** The impulse/reversal interval on the media timeline. */
  readonly interval: { readonly startTimeMs: number; readonly endTimeMs: number };
  /** The candidate's timeline position (the discontinuity instant). */
  readonly eventTimeMs: number;
  /** Evidence-propagated confidence in [0, 1] (never invented). */
  readonly confidence: number;
  /** Evidence chain: observation ids in the store (every id resolves). */
  readonly evidence: readonly string[];
  /** Deterministic detail string. */
  readonly detail: string;
}

/**
 * Non-max suppression over the raw impulse candidates: candidates within
 * `windowMs` of their cluster's FIRST candidate collapse to the cluster's
 * HIGHEST-confidence member (ties → the earliest). Deterministic (a pure
 * function of the ascending-time candidate list), applied uniformly — the
 * documented way bursty tracker jitter becomes one candidate per physical
 * impulse. Returns the kept candidates plus the suppressed count.
 */
export function clusterImpulseCandidates(
  candidates: readonly EventCandidateRecord[],
  windowMs: number,
): { kept: EventCandidateRecord[]; suppressed: number } {
  const kept: EventCandidateRecord[] = [];
  let suppressed = 0;
  let clusterStartMs: number | undefined;
  let clusterBest: EventCandidateRecord | undefined;
  for (const candidate of candidates) {
    if (
      clusterStartMs !== undefined &&
      clusterBest !== undefined &&
      candidate.eventTimeMs - clusterStartMs < windowMs
    ) {
      // Inside the open cluster: keep the best (confidence, then earliest).
      if (
        candidate.confidence > clusterBest.confidence ||
        (candidate.confidence === clusterBest.confidence &&
          candidate.eventTimeMs < clusterBest.eventTimeMs)
      ) {
        clusterBest = candidate;
      }
      suppressed += 1;
      continue;
    }
    if (clusterBest !== undefined) kept.push(clusterBest);
    clusterStartMs = candidate.eventTimeMs;
    clusterBest = candidate;
  }
  if (clusterBest !== undefined) kept.push(clusterBest);
  return { kept, suppressed };
}

/** One ball point the impulse detector consumes. */
export interface BallPointEvidence {
  readonly observationId: string;
  readonly presentationMs: number;
  /** Normalized image-space center of the observed ball box. */
  readonly x: number;
  readonly y: number;
  /** Detection confidence in [0, 1] (detected points only enter here). */
  readonly confidence: number;
}

/**
 * Derives ball-impulse candidates from the ball track's DETECTED points
 * (interpolated points are excluded — only observed evidence counts).
 *
 * An impulse fires at point k when the two consecutive inter-point velocities
 * v1 (k-1 → k) and v2 (k → k+1), in normalized image units per second,
 * satisfy EITHER:
 *
 * - SPEED DISCONTINUITY: `|v2| / max(|v1|, 1e-9) >= minSpeedRatio` AND
 *   `|v2| - |v1| >= minSpeedGain`, or
 * - DIRECTION REVERSAL: `dot(v1, v2) < 0` with both legs at least
 *   `minReversalSpeed` (a bounce).
 *
 * Confidence is the MINIMUM of the three supporting point confidences — pure
 * evidence propagation, no inflation. Deterministic: a pure function of the
 * point list and the gates.
 */
export function deriveBallImpulseCandidates(
  points: readonly BallPointEvidence[],
  gates: BallImpulseGates,
): EventCandidateRecord[] {
  const candidates: EventCandidateRecord[] = [];
  for (let k = 1; k + 1 < points.length; k += 1) {
    const a = points[k - 1]!;
    const b = points[k]!;
    const c = points[k + 1]!;
    const dt1 = (b.presentationMs - a.presentationMs) / 1000;
    const dt2 = (c.presentationMs - b.presentationMs) / 1000;
    if (dt1 <= 0 || dt2 <= 0) continue;
    const v1x = (b.x - a.x) / dt1;
    const v1y = (b.y - a.y) / dt1;
    const v2x = (c.x - b.x) / dt2;
    const v2y = (c.y - b.y) / dt2;
    const speed1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const speed2 = Math.sqrt(v2x * v2x + v2y * v2y);
    const ratio = speed2 / Math.max(speed1, 1e-9);
    const speedDiscontinuity =
      ratio >= gates.minSpeedRatio && speed2 - speed1 >= gates.minSpeedGain;
    const dot = v1x * v2x + v1y * v2y;
    const directionReversal =
      dot < 0 && speed1 >= gates.minReversalSpeed && speed2 >= gates.minReversalSpeed;
    if (!speedDiscontinuity && !directionReversal) continue;
    const confidence = Math.min(a.confidence, b.confidence, c.confidence);
    const speedDiscontinuityDetail =
      `ball speed-discontinuity at ${b.presentationMs}ms: ` +
      `${speed1.toFixed(3)} -> ${speed2.toFixed(3)} normalized units/s ` +
      `(ratio ${ratio.toFixed(2)}, gain ${(speed2 - speed1).toFixed(3)})`;
    const reversalDetail =
      `ball direction-reversal at ${b.presentationMs}ms: both legs above ` +
      `${gates.minReversalSpeed} normalized units/s ` +
      `(${speed1.toFixed(3)}, ${speed2.toFixed(3)})`;
    candidates.push({
      candidateId: `cand-bi-${b.observationId}`,
      eventTypeRef: "real-to-swm/v1/ball-impulse",
      interval: { startTimeMs: a.presentationMs, endTimeMs: c.presentationMs },
      eventTimeMs: b.presentationMs,
      confidence,
      evidence: [a.observationId, b.observationId, c.observationId],
      detail: speedDiscontinuity ? speedDiscontinuityDetail : reversalDetail,
    });
  }
  return candidates;
}

/** One possession sample: the computed possessor at one ball observation. */
export interface PossessionSample {
  /** The ball track observation the sample was computed at. */
  readonly ballObservation: Observation;
  /** Nearest participant within the radius, or null (none within / tie). */
  readonly possessor: Observation | null;
  /** The possessor's pitch-space distance to the ball (when possessor set). */
  readonly distanceM: number | undefined;
}

/**
 * Samples possession at every pitch-space ball observation: the possessor is
 * the participant whose LATEST pitch-space track position at-or-before the
 * ball's time is nearest, within `radiusM` (Euclidean pitch meters, the W401
 * rule). Ties within 1e-9 meters produce NO possessor (the W401 ambiguity
 * rule — no silent winner). Deterministic order: ball observations ascending.
 */
export function samplePossession(
  ballObservations: readonly Observation[],
  participantObservations: readonly Observation[],
  radiusM: number,
): PossessionSample[] {
  const samples: PossessionSample[] = [];
  // Latest pitch position per participant as of a given time — computed
  // incrementally over the ascending ball-observation times.
  const sortedParticipants = [...participantObservations].sort(
    (a, b) => a.eventTimeMs - b.eventTimeMs || (a.observationId < b.observationId ? -1 : 1),
  );
  let cursor = 0;
  const latestPerParticipant = new Map<string, Observation>();
  for (const ball of ballObservations) {
    while (
      cursor < sortedParticipants.length &&
      sortedParticipants[cursor]!.eventTimeMs <= ball.eventTimeMs
    ) {
      const obs = sortedParticipants[cursor]!;
      if (obs.payload.kind === "track") {
        latestPerParticipant.set(obs.payload.entityId, obs);
      }
      cursor += 1;
    }
    if (ball.payload.kind !== "track") continue;
    const ballPos = ball.payload.position;
    let best: { obs: Observation; entityId: string; distance: number } | undefined;
    let tie = false;
    const ranked: { obs: Observation; entityId: string; distance: number }[] = [];
    for (const [entityId, obs] of latestPerParticipant) {
      if (obs.payload.kind !== "track") continue;
      const dx = ballPos.x - obs.payload.position.x;
      const dy = ballPos.y - obs.payload.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= radiusM) {
        ranked.push({ obs, entityId, distance });
      }
    }
    ranked.sort(
      (a, b) => a.distance - b.distance || (a.obs.observationId < b.obs.observationId ? -1 : 1),
    );
    if (ranked.length > 0) {
      const minDistance = ranked[0]!.distance;
      const tied = ranked.filter((entry) => entry.distance - minDistance <= 1e-9);
      if (tied.length >= 2) {
        tie = true;
      } else {
        best = ranked[0]!;
      }
    }
    samples.push({
      ballObservation: ball,
      possessor: tie ? null : (best?.obs ?? null),
      distanceM: best?.distance,
    });
  }
  return samples;
}

/**
 * Derives `football/v1/possession-change` derivation inputs from possession
 * samples: one candidate per computed-possessor IDENTITY transition
 * (including none → X and X → none). Each input's evidence is the ball
 * observation plus the possessor observations involved; confidence is the
 * minimum evidence confidence times the W401 proximity factor
 * `(1 - distance / radius)` — the same documented formula the fusion pass
 * uses, never more.
 */
export function derivePossessionChangeInputs(
  samples: readonly PossessionSample[],
  radiusM: number,
): {
  readonly eventId: string;
  readonly eventTimeMs: number;
  readonly confidence: number;
  readonly evidence: readonly string[];
  readonly detail: string;
}[] {
  const results: {
    eventId: string;
    eventTimeMs: number;
    confidence: number;
    evidence: string[];
    detail: string;
  }[] = [];
  let previousEntityId: string | null = null;
  let previousObs: Observation | null = null;
  let hasPrevious = false;
  for (const sample of samples) {
    const possessor: Observation | null = sample.possessor ?? null;
    const currentEntityId =
      possessor !== null && possessor.payload.kind === "track" ? possessor.payload.entityId : null;
    if (hasPrevious && currentEntityId !== previousEntityId) {
      const evidence: string[] = [sample.ballObservation.observationId];
      if (previousObs !== null && previousEntityId !== null) {
        evidence.push(previousObs.observationId);
      }
      if (possessor !== null) {
        evidence.push(possessor.observationId);
      }
      const currentConfidence =
        possessor !== null && possessor.confidence !== undefined ? possessor.confidence : 1;
      const previousConfidence =
        previousObs !== null && previousObs.confidence !== undefined ? previousObs.confidence : 1;
      const ballConfidence =
        sample.ballObservation.confidence !== undefined ? sample.ballObservation.confidence : 1;
      const proximity = sample.distanceM !== undefined ? 1 - sample.distanceM / radiusM : 1;
      const confidence = Math.max(
        0,
        Math.min(1, Math.min(ballConfidence, currentConfidence, previousConfidence) * proximity),
      );
      const from = previousEntityId ?? "none";
      const to = currentEntityId ?? "none";
      results.push({
        eventId: `evt-pc-${sample.ballObservation.observationId}`,
        eventTimeMs: sample.ballObservation.eventTimeMs,
        confidence,
        evidence,
        detail: `possession ${from} -> ${to} at ${sample.ballObservation.eventTimeMs}ms`,
      });
    }
    previousEntityId = currentEntityId;
    previousObs = sample.possessor ?? null;
    hasPrevious = true;
  }
  return results;
}
