/**
 * THE director function (W604): `direct(policy, matchTimeline, events)` →
 * {@link CameraPlan} — PURE and DETERMINISTIC (no clock, no RNG, no I/O;
 * the same inputs yield a deep-equal, JSON-byte-identical plan on every
 * call — pinned by tests).
 *
 * ## The direction algorithm (documented in full; POLICY.md is the normative
 * record, the tests pin each rule)
 *
 * 0. **Fail-closed admission.** The policy re-validates
 *    (`./validate.ts`), the match timeline must be non-empty with finite,
 *    `>= 0`, strictly increasing `atMs` and record-shaped scenes, and every
 *    candidate must carry well-formed W209 fields with UNIQUE candidate
 *    ids (W209's ids are the global "ec-<seq>" sequence — a repeated id
 *    would conflate two candidates' accounting) — anything else throws
 *    `DirectorError` (never a silently partial direction).
 * 1. **Possession-following default.** Per step: the follow reference
 *    (the spec's possession entity id, verbatim → that entity's placed
 *    position; else the ball's placed position; else none) maps through
 *    the policy's zone table (first zone whose closed `[xMin, xMax]`
 *    contains the reference x) to a canonical slot; no reference, an
 *    off-pitch reference, or a disabled follow rule → the documented
 *    fallback slot. A HYSTERESIS walk then produces the default slot
 *    sequence: a desired change at a snapshot boundary cuts only when at
 *    least `hysteresisMs` passed since the previous default cut —
 *    suppressed cuts are ACCOUNTED (`summary.suppressedCuts`).
 * 2. **Event-importance windows.** Every candidate whose W209 type has a
 *    policy rule, whose confidence meets the rule's gate, and whose event
 *    time lies inside the match timeline opens a focus window
 *    `[snapBefore(eventTimeMs), firstBoundaryAtOrAfter(start + holdMs)]`
 *    (both snapshot boundaries — camera changes land at snapshots, never
 *    mid-segment; the pinned hold is a MINIMUM, never shortened), clipped
 *    to the timeline end. The focus slot resolves per the rule's selector
 *    (`nearest-goal` resolves on the follow reference at the event's snap
 *    step; no reference → the fallback slot, never an invented angle).
 * 3. **Overlay.** The live tiling is built from the union of boundary
 *    points (timeline ends, default cuts, focus-window starts/ends). Each
 *    elementary span is governed by the ACTIVE focus window with
 *    `(rule priority ASC, start DESC, eventTimeMs DESC, candidateId DESC)`
 *    — importance first, then recency, then id — else by the default slot.
 *    Adjacent spans with the same governing slot+rule+candidate MERGE.
 *    Losing candidates are accounted `superseded`.
 * 4. **Replay emphasis.** Every governing event window whose rule carries
 *    a replay config is followed (in rundown order) by a REVIEW window
 *    re-presenting `[snapBefore(t_e − lead), firstBoundaryAtOrAfter(t_e +
 *    trail)]` (clipped into the timeline) at the W603 review profile —
 *    existing match time re-rendered, never new content.
 * 5. **Accounting.** Every input candidate appears exactly once in
 *    `summary.eventAccounting` with its verbatim confidence/emphasis and
 *    its total outcome (governed / superseded / below-confidence /
 *    no-rule / outside-timeline).
 *
 * The director is an OFFLINE, HINDSIGHT director: it directs with full
 * knowledge of the timeline and the candidate stream (batch direction for
 * deterministic evaluation — W605), never a live zero-latency one. The
 * focus window START is the last snapshot boundary at-or-before the event
 * time, so the event moment itself renders through the focus slot (the
 * interpolated frames of that segment carry it).
 */
import type { EventCandidate } from "@sporta/commentary-understanding";
import type { AvatarField3dMatchStep } from "@sporta/renderer-3d";
import { DirectorError } from "./errors";
import { isFiniteNumber, isRecord, readFiniteNumber, readNonEmptyString } from "./internal";
import {
  DIRECTOR_VERSION,
  GOAL_SIDE_SPLIT_X_METERS,
  type DirectorPolicy,
  type EventFocusRule,
  type FocusSlotSelector,
} from "./policy";
import { validatePolicy } from "./validate";
import type {
  CameraPlan,
  DirectedWindow,
  EventAccountingEntry,
  EventDecisionRef,
  PossessionDecisionInputs,
  PresentationKind,
  SuppressedCut,
  WindowDecision,
} from "./types";

// ---------------------------------------------------------------------------
// Input admission (fail-closed, defense in depth)
// ---------------------------------------------------------------------------

/** Admits (and normalizes) the match timeline: the W603 match steps. */
function admitTimeline(steps: readonly AvatarField3dMatchStep[]): number[] {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new DirectorError(
      "timeline-invalid",
      "direct requires a non-empty array of match steps",
      {
        stepCount: Array.isArray(steps) ? steps.length : -1,
      },
    );
  }
  const times: number[] = [];
  let previous: number | undefined;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!isRecord(step)) {
      throw new DirectorError("timeline-invalid", `match steps[${i}] must be an object`, {
        index: i,
      });
    }
    const atMs = step.atMs;
    if (!isFiniteNumber(atMs) || atMs < 0) {
      throw new DirectorError(
        "timeline-invalid",
        `match steps[${i}].atMs must be a finite number >= 0`,
        { index: i, atMs: String(atMs) },
      );
    }
    if (previous !== undefined && atMs <= previous) {
      throw new DirectorError(
        "timeline-invalid",
        `match steps must have strictly increasing atMs (steps[${i}].atMs ${atMs} <= ${previous})`,
        { index: i, atMs, previous },
      );
    }
    if (
      !isRecord(step.scene) ||
      !Array.isArray(step.scene.entities) ||
      !isRecord(step.scene.scoreClock)
    ) {
      throw new DirectorError(
        "timeline-invalid",
        `match steps[${i}].scene must be a SceneSpecification record (entities array + scoreClock object)`,
        { index: i },
      );
    }
    previous = atMs;
    times.push(atMs);
  }
  return times;
}

/** Admits (and clones) the W209 candidate stream. */
function admitCandidates(candidates: readonly unknown[]): EventCandidate[] {
  if (!Array.isArray(candidates)) {
    throw new DirectorError("candidates-invalid", "direct requires an array of event candidates");
  }
  const admitted: EventCandidate[] = [];
  const firstSeenIndex = new Map<string, number>();
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (!isRecord(candidate)) {
      throw new DirectorError("candidates-invalid", `candidates[${i}] must be an object`, {
        index: i,
      });
    }
    const candidateId = readNonEmptyString(candidate.candidateId);
    if (candidateId !== undefined) {
      // W209 guarantees gap-free UNIQUE ids ("ec-<seq>", the global
      // sequence) — a stream with a repeated id is not a well-formed W209
      // stream, and admitting it would CONFLATE the two candidates (one
      // map key, one accounting outcome, ambiguous replay lookups) — a
      // never-silent-accounting violation, refused here instead.
      const firstIndex = firstSeenIndex.get(candidateId);
      if (firstIndex !== undefined) {
        throw new DirectorError(
          "candidates-invalid",
          `candidates[${i}].candidateId "${candidateId}" is a DUPLICATE (first seen at index ${firstIndex}) — W209 candidate ids are unique ("ec-<seq>", the global sequence); a repeated id would conflate the two candidates' accounting`,
          { index: i, firstIndex, candidateId },
        );
      }
      firstSeenIndex.set(candidateId, i);
    }
    const eventTimeMs = readFiniteNumber(candidate.eventTimeMs);
    const eventType = readNonEmptyString(candidate.eventType);
    const confidence = readFiniteNumber(candidate.confidence);
    const emphasis = readFiniteNumber(candidate.emphasis);
    const subjects = candidate.subjects;
    const eventPhrase = readNonEmptyString(candidate.eventPhrase);
    const unitId = readNonEmptyString(candidate.unitId);
    if (
      candidateId === undefined ||
      eventTimeMs === undefined ||
      eventTimeMs < 0 ||
      eventType === undefined ||
      confidence === undefined ||
      confidence < 0 ||
      confidence > 1 ||
      emphasis === undefined ||
      emphasis < 0 ||
      emphasis > 1 ||
      eventPhrase === undefined ||
      unitId === undefined ||
      !Array.isArray(subjects)
    ) {
      throw new DirectorError(
        "candidates-invalid",
        `candidates[${i}] is not a well-formed W209 EventCandidate (candidateId/unitId/eventPhrase non-empty strings, eventTimeMs finite >= 0, eventType a non-empty string, confidence/emphasis finite in [0, 1], subjects an array)`,
        { index: i, candidateId: candidateId ?? "<missing>" },
      );
    }
    admitted.push({
      candidateId,
      unitId,
      eventTimeMs,
      eventType: eventType as EventCandidate["eventType"],
      eventPhrase,
      subjects: subjects as EventCandidate["subjects"],
      emphasis,
      confidence,
    });
  }
  return admitted;
}

/** Admits (and clones) the policy document (re-validated, defense in depth). */
function admitPolicy(policy: unknown): DirectorPolicy {
  const validation = validatePolicy(policy);
  if (!validation.ok) {
    throw new DirectorError("policy-invalid", "the policy document failed validation", {
      issues: validation.issues,
    });
  }
  return validation.value;
}

// ---------------------------------------------------------------------------
// Possession-following default (rule 1)
// ---------------------------------------------------------------------------

/** The follow reference of one step's scene: the possessor's, else the ball's, placed pitch x. */
function followReferenceOfStep(step: AvatarField3dMatchStep): {
  entityId?: string;
  followX?: number;
} {
  const scene = step.scene;
  const scoreClock = scene.scoreClock as Record<string, unknown>;
  const possession = isRecord(scoreClock.possession) ? scoreClock.possession : undefined;
  const possessionValue =
    possession !== undefined && isRecord(possession.value) ? possession.value : undefined;
  const possessingEntityId =
    possessionValue !== undefined ? readNonEmptyString(possessionValue.entityId) : undefined;
  const entities = scene.entities as unknown[];
  // The possessor first: its placed position (projected or
  // projected-out-of-bounds — the TRUE x either way, never clamped).
  if (possessingEntityId !== undefined) {
    for (const entity of entities) {
      if (!isRecord(entity) || readNonEmptyString(entity.entityId) !== possessingEntityId) continue;
      const position = isRecord(entity.position) ? entity.position : undefined;
      const x = position !== undefined ? readFiniteNumber(position.x) : undefined;
      if (x !== undefined) return { entityId: possessingEntityId, followX: x };
    }
  }
  // No usable possessor position → the ball's placed position.
  for (const entity of entities) {
    if (!isRecord(entity) || entity.kind !== "ball") continue;
    const position = isRecord(entity.position) ? entity.position : undefined;
    const x = position !== undefined ? readFiniteNumber(position.x) : undefined;
    if (x !== undefined) return { followX: x };
  }
  return {};
}

/** The first zone (declared order) whose closed [xMin, xMax] contains `x`. */
function matchZone(
  policy: DirectorPolicy,
  x: number,
): { slotId: string; zone: { xMin: number; xMax: number } } | undefined {
  for (const zone of policy.possessionFollow.zones) {
    if (x >= zone.xMin && x <= zone.xMax) {
      return { slotId: zone.slotId, zone: { xMin: zone.xMin, xMax: zone.xMax } };
    }
  }
  return undefined;
}

/**
 * Resolves a focus/replay slot selector on one reference x (the follow
 * reference at the event's snap step). `nearest-goal` splits the pitch at
 * the halfway x ({@link GOAL_SIDE_SPLIT_X_METERS}); a missing reference
 * degrades HONESTLY to the fallback slot (never an invented angle).
 */
function resolveSelector(
  selector: FocusSlotSelector,
  fallbackSlotId: string,
  referenceX: number | undefined,
): string {
  if (selector === "nearest-goal") {
    if (referenceX === undefined) return fallbackSlotId;
    return referenceX <= GOAL_SIDE_SPLIT_X_METERS ? "behind-goal-x0" : "behind-goal-x105";
  }
  return selector;
}

// ---------------------------------------------------------------------------
// Boundary helpers (pure arithmetic over the step atMs list)
// ---------------------------------------------------------------------------

/** The largest step atMs `<= t`, or `undefined` when `t` precedes the timeline. */
function snapBefore(times: readonly number[], t: number): number | undefined {
  let result: number | undefined;
  for (const time of times) {
    if (time <= t) result = time;
    else break;
  }
  return result;
}

/** The smallest step atMs `>= t`, or `undefined` when `t` exceeds the timeline. */
function boundaryAtOrAfter(times: readonly number[], t: number): number | undefined {
  for (const time of times) {
    if (time >= t) return time;
  }
  return undefined;
}

/** The index of the largest step with `atMs <= t` (t must be within the timeline). */
function stepIndexAtOrBefore(times: readonly number[], t: number): number {
  let index = 0;
  for (let i = 0; i < times.length; i += 1) {
    if (times[i]! <= t) index = i;
    else break;
  }
  return index;
}

// ---------------------------------------------------------------------------
// The director
// ---------------------------------------------------------------------------

/** One admitted event-focus window (before the overlay). */
interface FocusWindow {
  /** The rule's index in `policy.eventRules` — the event-importance priority. */
  ruleIndex: number;
  rule: EventFocusRule;
  candidate: EventCandidate;
  /** The snap boundary at-or-before the candidate's event time (a step atMs). */
  startMs: number;
  /** The first boundary at-or-after `startMs + holdMs`, clipped to the timeline end (a step atMs). */
  endMs: number;
  /** The resolved focus slot. */
  slotId: string;
  /** The follow reference x the selector resolved on (the snap step's state). */
  referenceX: number | undefined;
  /** Filled by the overlay: this window drove at least one live span. */
  governed: boolean;
  /** Filled by the overlay: the candidate that beat this one (first loss). */
  supersededBy: string | undefined;
}

/** One elementary span of the live tiling (before merging). */
interface LiveSpan {
  startMs: number;
  endMs: number;
  slotId: string;
  decision: WindowDecision;
}

/** Builds the possession decision record of the default governing `stepIndex`. */
function possessionDecision(
  policy: DirectorPolicy,
  steps: readonly AvatarField3dMatchStep[],
  stepIndex: number,
  slotId: string,
): WindowDecision {
  if (!policy.possessionFollow.enabled) {
    return {
      ruleId: "possession-follow",
      possession: { fallback: true, desiredSlotId: policy.possessionFollow.fallbackSlotId },
      reason: `possession-follow: disabled → fallback slot ${policy.possessionFollow.fallbackSlotId}`,
    };
  }
  const reference = followReferenceOfStep(steps[stepIndex]!);
  const zoneMatch =
    reference.followX !== undefined ? matchZone(policy, reference.followX) : undefined;
  const desiredSlotId = zoneMatch?.slotId ?? policy.possessionFollow.fallbackSlotId;
  const possession: PossessionDecisionInputs = {
    fallback: reference.followX === undefined,
    ...(reference.entityId !== undefined ? { entityId: reference.entityId } : {}),
    ...(reference.followX !== undefined
      ? {
          followX: reference.followX,
          ...(zoneMatch !== undefined ? { zone: zoneMatch.zone } : {}),
        }
      : {}),
    desiredSlotId,
  };
  // The fixed-template explanation (all four cases explicit — a template
  // interpolation over an ABSENT zone would render "undefined", never an
  // honest report).
  let reason: string;
  if (reference.followX === undefined) {
    reason = `possession-follow: no usable follow reference → fallback slot ${desiredSlotId}`;
  } else if (zoneMatch === undefined) {
    reason =
      desiredSlotId === slotId
        ? `possession-follow: followX ${reference.followX} matches no zone → fallback slot ${desiredSlotId}`
        : `possession-follow: followX ${reference.followX} matches no zone, fallback ${desiredSlotId} desired, hysteresis holds ${slotId}`;
  } else if (desiredSlotId === slotId) {
    reason = `possession-follow: followX ${reference.followX} in zone [${zoneMatch.zone.xMin}, ${zoneMatch.zone.xMax}] → ${slotId}`;
  } else {
    reason = `possession-follow: followX ${reference.followX} in zone [${zoneMatch.zone.xMin}, ${zoneMatch.zone.xMax}] desires ${desiredSlotId}, hysteresis holds ${slotId}`;
  }
  return { ruleId: "possession-follow", possession, reason };
}

/** Builds the event decision ref (the candidate's fields, VERBATIM). */
function eventRefOf(candidate: EventCandidate): EventDecisionRef {
  return {
    candidateId: candidate.candidateId,
    eventType: candidate.eventType,
    eventTimeMs: candidate.eventTimeMs,
    confidence: candidate.confidence,
    emphasis: candidate.emphasis,
  };
}

/**
 * THE director function: pure `direct(policy, matchTimeline, events)` →
 * {@link CameraPlan}. Deterministic — the same inputs yield a deep-equal
 * plan on every call (JSON-byte-identical, test-pinned).
 *
 * @param policy the direction policy document (re-validated; data, not code).
 * @param steps the W603 match timeline (`AvatarField3dMatchStep[]` — the
 *   same steps a `render3dMatch` call would consume; the director reads
 *   `atMs`, the possession block, and entity positions, all verbatim).
 * @param candidates the W209 event-candidate stream (commentary-derived
 *   evidence, verbatim).
 * @throws {@link DirectorError} on malformed policy / timeline / candidates.
 */
export function direct(
  policy: DirectorPolicy,
  steps: readonly AvatarField3dMatchStep[],
  candidates: readonly EventCandidate[],
): CameraPlan {
  const admittedPolicy = admitPolicy(policy);
  const times = admitTimeline(steps);
  const admittedCandidates = admitCandidates(candidates);
  const startMs = times[0]!;
  const endMs = times[times.length - 1]!;
  const fallbackSlotId = admittedPolicy.possessionFollow.fallbackSlotId;

  // --- Rule 1: the possession-following default (per step), then the
  // hysteresis walk over the step sequence.
  const references = steps.map((step) => followReferenceOfStep(step));
  // The zone rule's answer for step `index`'s follow state: the first zone
  // containing the reference x; an absent or off-pitch reference (matches
  // no zone) → the fallback slot (the honest no-data default).
  const desiredSlotAt = (index: number): string => {
    if (!admittedPolicy.possessionFollow.enabled) return fallbackSlotId;
    const reference = references[index]!;
    if (reference.followX === undefined) return fallbackSlotId;
    return matchZone(admittedPolicy, reference.followX)?.slotId ?? fallbackSlotId;
  };
  const held: string[] = [desiredSlotAt(0)];
  const defaultCutAtMs: number[] = [];
  const suppressedCuts: SuppressedCut[] = [];
  let lastCutMs = startMs;
  for (let i = 1; i < times.length; i += 1) {
    const desiredSlot = desiredSlotAt(i);
    const current = held[i - 1]!;
    if (desiredSlot === current) {
      held.push(current);
      continue;
    }
    if (times[i]! - lastCutMs >= admittedPolicy.possessionFollow.hysteresisMs) {
      held.push(desiredSlot);
      lastCutMs = times[i]!;
      defaultCutAtMs.push(times[i]!);
    } else {
      held.push(current);
      suppressedCuts.push({
        atMs: times[i]!,
        desiredSlotId: desiredSlot,
        heldSlotId: current,
        msSincePreviousCut: times[i]! - lastCutMs,
      });
    }
  }

  // --- Rule 2: event-importance windows.
  const focusWindows: FocusWindow[] = [];
  const accounting: EventAccountingEntry[] = [];
  for (const candidate of admittedCandidates) {
    const ruleIndex = admittedPolicy.eventRules.findIndex(
      (rule) => rule.eventType === candidate.eventType,
    );
    const entry: EventAccountingEntry = { ...eventRefOf(candidate), outcome: "no-rule" };
    const rule = ruleIndex >= 0 ? admittedPolicy.eventRules[ruleIndex] : undefined;
    if (rule === undefined) {
      accounting.push(entry);
      continue;
    }
    if (candidate.eventTimeMs < startMs || candidate.eventTimeMs > endMs) {
      entry.outcome = "outside-timeline";
      accounting.push(entry);
      continue;
    }
    if (candidate.confidence < rule.minConfidence) {
      entry.outcome = "below-confidence";
      accounting.push(entry);
      continue;
    }
    const snap = snapBefore(times, candidate.eventTimeMs)!; // >= startMs (inside timeline)
    const rawEnd = snap + rule.holdMs;
    const boundaryEnd = boundaryAtOrAfter(times, rawEnd);
    const focusEnd = Math.min(boundaryEnd ?? endMs, endMs);
    const snapStepIndex = stepIndexAtOrBefore(times, snap);
    const referenceX = references[snapStepIndex]!.followX;
    const slotId = resolveSelector(rule.focusSlotSelector, fallbackSlotId, referenceX);
    focusWindows.push({
      ruleIndex,
      rule,
      candidate,
      startMs: snap,
      endMs: focusEnd,
      slotId,
      referenceX,
      governed: false,
      supersededBy: undefined,
    });
    accounting.push(entry); // outcome finalized after the overlay
  }

  // --- Rule 3: the overlay — elementary spans over the union of boundary
  // points, each governed by the active focus window (importance, then
  // recency, then id) or the possession-following default.
  const boundarySet = new Set<number>([startMs, endMs]);
  for (const cut of defaultCutAtMs) boundarySet.add(cut);
  for (const focus of focusWindows) {
    boundarySet.add(focus.startMs);
    boundarySet.add(focus.endMs);
  }
  const boundaries = [...boundarySet].sort((a, b) => a - b);
  const spans: { startMs: number; endMs: number }[] = [];
  for (let k = 0; k + 1 < boundaries.length; k += 1) {
    spans.push({ startMs: boundaries[k]!, endMs: boundaries[k + 1]! });
  }
  spans.push({ startMs: endMs, endMs: endMs }); // the timeline-end point (the last window's own)

  const liveSpans: LiveSpan[] = spans.map((span) => {
    const active = focusWindows.filter(
      (focus) => focus.startMs <= span.startMs && focus.endMs >= span.endMs,
    );
    if (active.length > 0) {
      const governor = [...active].sort((a, b) => {
        if (a.ruleIndex !== b.ruleIndex) return a.ruleIndex - b.ruleIndex;
        if (a.startMs !== b.startMs) return b.startMs - a.startMs;
        if (a.candidate.eventTimeMs !== b.candidate.eventTimeMs) {
          return b.candidate.eventTimeMs - a.candidate.eventTimeMs;
        }
        // Final tie-break: DESCENDING candidate id in CODEPOINT order — a
        // plain `<`/`>` comparison, never `localeCompare` (collation is
        // ICU/locale-dependent and would break cross-runtime determinism).
        const aId = a.candidate.candidateId;
        const bId = b.candidate.candidateId;
        if (aId !== bId) return aId > bId ? -1 : 1;
        return 0;
      })[0]!;
      governor.governed = true;
      for (const loser of active) {
        if (loser !== governor && loser.supersededBy === undefined) {
          loser.supersededBy = governor.candidate.candidateId;
        }
      }
      const decision: WindowDecision = {
        ruleId: "event-focus",
        event: eventRefOf(governor.candidate),
        holdMs: governor.rule.holdMs,
        reason: `event-focus: ${governor.candidate.eventType} (confidence ${governor.candidate.confidence}, emphasis ${governor.candidate.emphasis}) at ${governor.candidate.eventTimeMs} → ${governor.slotId} for ${governor.rule.holdMs} ms`,
      };
      return { startMs: span.startMs, endMs: span.endMs, slotId: governor.slotId, decision };
    }
    const stepIndex = stepIndexAtOrBefore(times, span.startMs);
    const slotId = span.startMs === endMs ? held[held.length - 1]! : held[stepIndex]!;
    const decision = possessionDecision(admittedPolicy, steps, stepIndex, slotId);
    return { startMs: span.startMs, endMs: span.endMs, slotId, decision };
  });

  // Merge adjacent spans with the same governing slot + rule + candidate.
  const mergedLive: LiveSpan[] = [];
  for (const span of liveSpans) {
    const previous = mergedLive[mergedLive.length - 1];
    const sameGoverning =
      previous !== undefined &&
      previous.slotId === span.slotId &&
      previous.decision.ruleId === span.decision.ruleId &&
      previous.decision.event?.candidateId === span.decision.event?.candidateId;
    if (sameGoverning) {
      previous.endMs = span.endMs;
    } else {
      mergedLive.push({ ...span });
    }
  }

  // Finalize the candidate accounting (governed / superseded).
  const focusByCandidateId = new Map(
    focusWindows.map((focus) => [focus.candidate.candidateId, focus]),
  );
  for (const entry of accounting) {
    const focus = focusByCandidateId.get(entry.candidateId);
    if (focus === undefined) continue; // no-rule / below-confidence / outside-timeline already set
    if (focus.governed) {
      entry.outcome = "governed";
    } else {
      entry.outcome = "superseded";
      if (focus.supersededBy !== undefined) entry.supersededBy = focus.supersededBy;
    }
  }

  // --- Rule 4: replay emphasis — a review window after each governing
  // event window whose rule carries a replay config.
  const windows: DirectedWindow[] = [];
  const appendWindow = (
    kind: PresentationKind,
    source: { startMs: number; endMs: number },
    cameraSlotId: string,
    decision: WindowDecision,
  ): void => {
    windows.push({
      index: windows.length,
      kind,
      source,
      cameraSlotId,
      decision,
    });
  };

  for (const live of mergedLive) {
    appendWindow("live", { startMs: live.startMs, endMs: live.endMs }, live.slotId, live.decision);
    const governingCandidateId = live.decision.event?.candidateId;
    if (live.decision.ruleId !== "event-focus" || governingCandidateId === undefined) continue;
    const focus = focusByCandidateId.get(governingCandidateId);
    if (focus === undefined || focus.rule.replay === undefined || !focus.governed) continue;
    const replay = focus.rule.replay;
    const reviewStart = Math.max(
      snapBefore(times, focus.candidate.eventTimeMs - replay.leadMs) ?? startMs,
      startMs,
    );
    const rawReviewEnd = focus.candidate.eventTimeMs + replay.trailMs;
    const reviewEnd = Math.min(boundaryAtOrAfter(times, rawReviewEnd) ?? endMs, endMs);
    const reviewSlotId = resolveSelector(
      replay.replaySlotSelector,
      fallbackSlotId,
      focus.referenceX,
    );
    appendWindow("review", { startMs: reviewStart, endMs: reviewEnd }, reviewSlotId, {
      ruleId: "replay-emphasis",
      event: eventRefOf(focus.candidate),
      holdMs: reviewEnd - reviewStart,
      reason: `replay-emphasis: ${focus.candidate.eventType} review of [${reviewStart}, ${reviewEnd}] (confidence ${focus.candidate.confidence}) at the W603 review profile from ${reviewSlotId}`,
    });
  }

  // --- Rule 5: the summary (accounting + counts).
  let cutCount = 0;
  for (let i = 1; i < windows.length; i += 1) {
    if (windows[i - 1]!.cameraSlotId !== windows[i]!.cameraSlotId) cutCount += 1;
  }
  const liveWindowCount = windows.filter((window) => window.kind === "live").length;
  const reviewWindowCount = windows.length - liveWindowCount;

  return {
    directorVersion: DIRECTOR_VERSION,
    policy: { policyId: admittedPolicy.policyId, policyVersion: admittedPolicy.policyVersion },
    timeline: { startMs, endMs },
    windows,
    summary: {
      windowCount: windows.length,
      liveWindowCount,
      reviewWindowCount,
      cutCount,
      suppressedCuts,
      eventAccounting: accounting,
    },
  };
}
