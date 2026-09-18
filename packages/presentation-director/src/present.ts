/**
 * THE presentation director function (R305): `present(policy, steps,
 * candidates)` → {@link PresentationPlan} — PURE and DETERMINISTIC (no
 * clock, no RNG, no I/O; the same inputs yield a JSON-byte-identical plan
 * on every call — pinned by tests).
 *
 * ## The presentation algorithm (documented in full; README.md is the
 * normative record, the tests pin each rule)
 *
 * 0. **Fail-closed admission.** The presentation policy re-validates
 *    (`./validate.ts`, which delegates the camera layer to the wrapped
 *    W604 `validatePolicy`). The steps and candidates flow into the
 *    WRAPPED director `direct(policy.camera, steps, candidates)` whose own
 *    admission is the deep validator (a malformed timeline or candidate
 *    stream throws the W604 `DirectorError` verbatim — the wrapped seam's
 *    error for the wrapped seam's input).
 * 1. **Wrap.** The wrapped `CameraPlan` rides in the presentation plan
 *    VERBATIM — every window, slot, decision record, suppressed cut, and
 *    candidate accounting entry preserved (deep-cloned once so consumers
 *    can never mutate the wrapped seam's output).
 * 2. **Presentation kinds.** Every wrapped window classifies over its OWN
 *    fields (never re-derived): a `review` window is `replay`; a `live`
 *    possession-follow window is `live-follow`; a `live` event-focus
 *    window is its slot's framing class (`wide` / `tight` from the policy
 *    table — a slot with no framing row is REFUSED `framing-gap`, never
 *    defaulted). A `live` window carrying a `replay-emphasis` decision is
 *    refused (plan-invalid, defense in depth).
 * 3. **Importance trace.** Every window's trace is complete:
 *    - an event-driven window (event-focus / replay-emphasis) traces to
 *      the event-importance row of its governing candidate's event type
 *      (which event, which row, what weight) and to the W209 candidate
 *      itself (candidateId + the matched text span VERBATIM + emphasis +
 *      confidence VERBATIM);
 *    - a possession-follow window traces to the policy-declared baseline
 *      (the honest no-event floor — never an invented score);
 *    - the combined score is `importanceWeight·weight + (emphasisWeight·
 *      emphasis + confidenceWeight·confidence)` over the verbatim inputs
 *      — a number in `[0, 1]` recorded per window.
 * 4. **Candidate scoring.** EVERY input candidate appears exactly once in
 *    `summary.candidateScoring` with its verbatim fields, its WRAPPED-plan
 *    outcome (governed / superseded / below-confidence / no-rule /
 *    outside-timeline, verbatim), its importance row + combined score when
 *    the policy has a row for its type (absent otherwise — an honest
 *    unscored entry, never a half-scored one), and the window indices it
 *    drove.
 * 5. **Accounting.** The presentation counts recompute from the windows,
 *    the candidate scoring mirrors the wrapped plan's accounting (same
 *    order, same outcomes), and the wrapped plan's own summary counts are
 *    quoted verbatim (reconciliation evidence).
 *
 * The director is an OFFLINE, HINDSIGHT presenter (it explains and
 * classifies a fully-directed batch plan for deterministic evaluation —
 * the W604 posture), never a live one.
 */
import {
  direct,
  type CameraPlan,
  type DirectorRuleId,
  type EventAccountingEntry,
  type EventCandidateOutcome,
  type PresentationKind,
} from "@sporta/camera-director";
import type { EventCandidate } from "@sporta/commentary-understanding";
import { PresentationError } from "./errors";
import { cloneJson, isRecord, readNonEmptyString } from "./internal";
import {
  DEFAULT_PRESENTATION_POLICY,
  PRESENTATION_DIRECTOR_VERSION,
  type FramingClass,
  type PresentationKindClass,
  type PresentationPolicy,
  type PresentationRuleId,
} from "./policy";
import { validatePresentationPolicy } from "./validate";
import type {
  CandidatePresentationEntry,
  PresentationKindDecision,
  PresentationPlan,
  PresentationPlanSummary,
  PresentationWindow,
  WindowImportanceTrace,
} from "./types";

/**
 * The match timeline step, as this package accepts it: a structural mirror
 * of the W603 match step the wrapped W604 director consumes. The wrapped
 * director's own fail-closed admission (`admitTimeline`) validates the
 * scene documents deeply (record shape, entities array, scoreClock
 * object) — this layer reads NOTHING from the scene itself. A real
 * `AvatarField3dMatchStep` is assignable to this type (pinned by test over
 * the real `projectScene` documents).
 */
export interface MatchTimelineStep {
  /** The step's position on the canonical media timeline (milliseconds). */
  atMs: number;
  /** The step's scene document (validated by the wrapped director's admission). */
  scene: unknown;
  /** When `true`, the boundary INTO this step is a hard scene cut. */
  sceneCutBefore?: boolean;
}

/** The wrapped director's own match-timeline input type (referenced through the seam). */
type WrappedSteps = Parameters<typeof direct>[1];

/** The closed classification-rule vocabulary of the presentation layer. */
const CLASSIFICATION_RULES = ["review-window", "possession-default", "event-framing"] as const;

/** Admits (and clones) the presentation policy document (re-validated, defense in depth). */
function admitPolicy(policy: unknown): PresentationPolicy {
  const validation = validatePresentationPolicy(policy);
  if (!validation.ok) {
    throw new PresentationError("policy-invalid", "the policy document failed validation", {
      issues: validation.issues,
    });
  }
  return validation.value;
}

/** Admits the candidate stream for the presentation layer (phrase lookups). */
function admitCandidateIndex(candidates: readonly EventCandidate[]): Map<string, EventCandidate> {
  if (!Array.isArray(candidates)) {
    throw new PresentationError("candidates-invalid", "present requires an array of event candidates");
  }
  const byId = new Map<string, EventCandidate>();
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (!isRecord(candidate)) {
      throw new PresentationError("candidates-invalid", `candidates[${i}] must be an object`, {
        index: i,
      });
    }
    const candidateId = readNonEmptyString(candidate.candidateId);
    if (candidateId === undefined) {
      // The wrapped director's admission is the deep validator; a missing
      // id is surfaced HERE only because the presentation layer needs the
      // id for its own phrase-index (fail-closed either way).
      throw new PresentationError(
        "candidates-invalid",
        `candidates[${i}].candidateId must be a non-empty string`,
        { index: i },
      );
    }
    byId.set(candidateId, candidate as unknown as EventCandidate);
  }
  return byId;
}

/** The framing class of one camera slot (fail-closed on a framing gap). */
function framingOf(policy: PresentationPolicy, slotId: string): FramingClass {
  for (const row of policy.framing) {
    if (row.slotId === slotId) return row.framing;
  }
  throw new PresentationError(
    "framing-gap",
    `the policy has no framing row for camera slot "${slotId}" — every canonical slot a plan directs must be classified (never defaulted)`,
    { slotId, framingRows: policy.framing.map((row) => row.slotId) },
  );
}

/** The importance row of one event type, or `undefined` when the policy has no row (an honest unscored candidate). */
function findImportanceRow(
  policy: PresentationPolicy,
  eventType: string,
): { ruleIndex: number; weight: number } | undefined {
  for (let i = 0; i < policy.eventImportance.length; i += 1) {
    const row = policy.eventImportance[i]!;
    if (row.eventType === eventType) return { ruleIndex: i, weight: row.weight };
  }
  return undefined;
}

/**
 * The STRICT row lookup for event-driven WINDOWS (fail-closed): the
 * cross-layer validation guarantees every camera-ruled type a row, so a
 * governing window without one is a policy/plan inconsistency — refused.
 */
function importanceRowOfStrict(
  policy: PresentationPolicy,
  eventType: string,
): { ruleIndex: number; weight: number } {
  const row = findImportanceRow(policy, eventType);
  if (row === undefined) {
    throw new PresentationError(
      "importance-gap",
      `the policy has no importance row for event type "${eventType}" (a window-governing type must be weighted)`,
      { eventType },
    );
  }
  return row;
}

/** Rounds a score to a stable serialization domain (never a float-drift artifact). */
function roundScore(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

/** Classifies one wrapped window's presentation kind (pure; fail-closed on gaps). */
function classifyWindow(
  policy: PresentationPolicy,
  windowIndex: number,
  planKind: PresentationKind,
  directorRuleId: DirectorRuleId,
  cameraSlotId: string,
): PresentationKindDecision {
  let presentationKind: PresentationKindClass;
  let ruleId: PresentationRuleId;
  let framing: FramingClass | undefined;
  let reason: string;
  if (planKind === "review") {
    presentationKind = "replay";
    ruleId = "review-window";
    reason = `review-window: wrapped plan kind "review" → replay presentation from ${cameraSlotId}`;
  } else if (directorRuleId === "possession-follow") {
    presentationKind = "live-follow";
    ruleId = "possession-default";
    reason = `possession-default: live possession-follow window → live-follow presentation from ${cameraSlotId}`;
  } else if (directorRuleId === "event-focus") {
    framing = framingOf(policy, cameraSlotId);
    presentationKind = framing;
    ruleId = "event-framing";
    reason = `event-framing: live event-focus window from ${cameraSlotId} (${framing} framing) → ${framing} presentation`;
  } else {
    // directorRuleId === "replay-emphasis" on a LIVE window — a wrapped-plan
    // shape this layer refuses (defense in depth; the W604 director only
    // emits replay-emphasis decisions on review windows).
    throw new PresentationError(
      "plan-invalid",
      `a live window cannot carry a "${directorRuleId}" decision (replay emphasis is review-window-only)`,
      { windowIndex, planKind, directorRuleId },
    );
  }
  return {
    windowIndex,
    presentationKind,
    ruleId,
    inputs: {
      planKind,
      directorRuleId,
      cameraSlotId,
      ...(framing === undefined ? {} : { framing }),
    },
    reason,
  };
}

/** The combined-score formula, one place (documented in the module docs). */
function combinedScoreOf(policy: PresentationPolicy, weight: number, semanticScore: number): number {
  return roundScore(policy.semantics.importanceWeight * weight + semanticScore);
}

/** Builds one window's complete importance trace (pure; fail-closed on gaps). */
function traceOfWindow(
  policy: PresentationPolicy,
  windowIndex: number,
  decision: Record<string, unknown>,
  candidatesById: ReadonlyMap<string, EventCandidate>,
): WindowImportanceTrace {
  const ruleId = decision.ruleId;
  const eventDriven = ruleId === "event-focus" || ruleId === "replay-emphasis";
  if (eventDriven) {
    const event = isRecord(decision.event) ? decision.event : undefined;
    const candidateId = event !== undefined ? readNonEmptyString(event.candidateId) : undefined;
    const eventType = event !== undefined ? readNonEmptyString(event.eventType) : undefined;
    if (event === undefined || candidateId === undefined || eventType === undefined) {
      throw new PresentationError(
        "plan-invalid",
        `an event-driven window must carry the verbatim candidate in its decision record`,
        { windowIndex, ruleId },
      );
    }
    const candidate = candidatesById.get(candidateId);
    if (candidate === undefined) {
      throw new PresentationError(
        "plan-invalid",
        `window ${windowIndex} cites candidate "${candidateId}" which is absent from the input stream`,
        { windowIndex, candidateId },
      );
    }
    const row = importanceRowOfStrict(policy, eventType);
    const emphasis = candidate.emphasis;
    const confidence = candidate.confidence;
    const semanticScore = roundScore(
      policy.semantics.emphasisWeight * emphasis + policy.semantics.confidenceWeight * confidence,
    );
    const combinedScore = combinedScoreOf(policy, row.weight, semanticScore);
    return {
      windowIndex,
      importance: { source: "event-rule", eventType: candidate.eventType, ruleIndex: row.ruleIndex, weight: row.weight },
      semantics: {
        source: "candidate",
        candidateId,
        eventPhrase: candidate.eventPhrase,
        emphasis,
        confidence,
        score: semanticScore,
      },
      combinedScore,
      reason:
        `importance: ${candidate.eventType} row ${row.ruleIndex} (weight ${row.weight}) + ` +
        `commentary: candidate ${candidateId} "${candidate.eventPhrase}" ` +
        `(emphasis ${emphasis}, confidence ${confidence}) → combined ${combinedScore}`,
    };
  }
  // The possession-following default: the declared baseline (never invented).
  const semanticScore = roundScore(
    (policy.semantics.emphasisWeight + policy.semantics.confidenceWeight) *
      policy.baselineSemanticScore,
  );
  const combinedScore = combinedScoreOf(policy, policy.baselineImportance, semanticScore);
  return {
    windowIndex,
    importance: { source: "baseline", weight: policy.baselineImportance },
    semantics: { source: "baseline", score: semanticScore },
    combinedScore,
    reason:
      `importance: routine-play baseline (weight ${policy.baselineImportance}) + ` +
      `commentary: baseline (score ${semanticScore}) → combined ${combinedScore}`,
  };
}

/** Scores every accounted candidate (verbatim fields + wrapped outcomes + drove windows). */
function scoreCandidates(
  policy: PresentationPolicy,
  cameraPlan: CameraPlan,
  candidatesById: ReadonlyMap<string, EventCandidate>,
): CandidatePresentationEntry[] {
  const droveWindowsByCandidate = new Map<string, number[]>();
  for (const window of cameraPlan.windows) {
    const candidateId = window.decision.event?.candidateId;
    if (candidateId === undefined) continue;
    const list = droveWindowsByCandidate.get(candidateId) ?? [];
    list.push(window.index);
    droveWindowsByCandidate.set(candidateId, list);
  }
  const entries: CandidatePresentationEntry[] = [];
  for (const entry of cameraPlan.summary.eventAccounting) {
    const candidate = candidatesById.get(entry.candidateId);
    if (candidate === undefined) {
      throw new PresentationError(
        "plan-invalid",
        `the wrapped plan accounts candidate "${entry.candidateId}" which is absent from the input stream`,
        { candidateId: entry.candidateId },
      );
    }
    const row = findImportanceRow(policy, entry.eventType);
    if (row === undefined) {
      // An honest unscored entry: the policy has no importance row for this
      // type (validation only guarantees rows for CAMERA-RULED types, and
      // only ruled types can govern windows) — never a half-scored entry.
      entries.push({
        candidateId: entry.candidateId,
        eventType: entry.eventType,
        eventPhrase: candidate.eventPhrase,
        eventTimeMs: entry.eventTimeMs,
        emphasis: entry.emphasis,
        confidence: entry.confidence,
        outcome: entry.outcome,
        ...(entry.supersededBy === undefined ? {} : { supersededBy: entry.supersededBy }),
        droveWindowIndices: droveWindowsByCandidate.get(entry.candidateId) ?? [],
      });
      continue;
    }
    const emphasis = entry.emphasis;
    const confidence = entry.confidence;
    const semanticScore = roundScore(
      policy.semantics.emphasisWeight * emphasis + policy.semantics.confidenceWeight * confidence,
    );
    entries.push({
      candidateId: entry.candidateId,
      eventType: entry.eventType,
      eventPhrase: candidate.eventPhrase,
      eventTimeMs: entry.eventTimeMs,
      emphasis,
      confidence,
      outcome: entry.outcome,
      ...(entry.supersededBy === undefined ? {} : { supersededBy: entry.supersededBy }),
      importanceWeight: row.weight,
      importanceRuleIndex: row.ruleIndex,
      semanticScore,
      combinedScore: combinedScoreOf(policy, row.weight, semanticScore),
      droveWindowIndices: droveWindowsByCandidate.get(entry.candidateId) ?? [],
    });
  }
  return entries;
}

/**
 * THE presentation director function: pure `present(policy, steps,
 * candidates)` → {@link PresentationPlan}. Deterministic — the same inputs
 * yield a deep-equal, JSON-byte-identical plan on every call (pinned).
 *
 * @param policy the presentation policy document (re-validated; data, not code).
 * @param steps the W603 match timeline (admitted + directed by the WRAPPED
 *   W604 director — its `DirectorError` propagates verbatim on malformed input).
 * @param candidates the W209 event-candidate stream (verbatim commentary evidence).
 * @throws {@link PresentationError} on presentation-layer refusals
 *   (policy-invalid / framing-gap / importance-gap / plan-invalid /
 *   candidates-invalid); the wrapped `DirectorError` on camera-layer input.
 */
export function present(
  policy: PresentationPolicy,
  steps: readonly MatchTimelineStep[],
  candidates: readonly EventCandidate[],
): PresentationPlan {
  const admittedPolicy = admitPolicy(policy);
  const candidatesById = admitCandidateIndex(candidates);
  // The wrapped W604 director directs the camera plan (admission included).
  const cameraPlan = direct(
    admittedPolicy.camera,
    steps as unknown as WrappedSteps,
    candidates,
  );
  // Wrap verbatim: a one-time deep clone so consumers can never mutate the
  // wrapped seam's output through the presentation plan.
  const wrappedPlan: CameraPlan = cloneJson(cameraPlan);

  const windows: PresentationWindow[] = wrappedPlan.windows.map((window) => {
    const decision = classifyWindow(
      admittedPolicy,
      window.index,
      window.kind,
      window.decision.ruleId,
      window.cameraSlotId,
    );
    const trace = traceOfWindow(
      admittedPolicy,
      window.index,
      window.decision as unknown as Record<string, unknown>,
      candidatesById,
    );
    return {
      index: window.index,
      presentationKind: decision.presentationKind,
      decision,
      importanceTrace: trace,
    };
  });

  const candidateScoring = scoreCandidates(admittedPolicy, wrappedPlan, candidatesById);

  const presentationCounts = { liveFollow: 0, replay: 0, wide: 0, tight: 0 };
  for (const window of windows) {
    if (window.presentationKind === "live-follow") presentationCounts.liveFollow += 1;
    else if (window.presentationKind === "replay") presentationCounts.replay += 1;
    else if (window.presentationKind === "wide") presentationCounts.wide += 1;
    else presentationCounts.tight += 1;
  }
  let presentationChangeCount = 0;
  for (let i = 1; i < windows.length; i += 1) {
    if (windows[i - 1]!.presentationKind !== windows[i]!.presentationKind) {
      presentationChangeCount += 1;
    }
  }

  const summary: PresentationPlanSummary = {
    windowCount: windows.length,
    presentationCounts,
    presentationChangeCount,
    candidateScoring,
    cameraSummary: {
      windowCount: wrappedPlan.summary.windowCount,
      liveWindowCount: wrappedPlan.summary.liveWindowCount,
      reviewWindowCount: wrappedPlan.summary.reviewWindowCount,
      cutCount: wrappedPlan.summary.cutCount,
    },
  };

  return {
    presentationVersion: PRESENTATION_DIRECTOR_VERSION,
    policy: {
      policyId: admittedPolicy.policyId,
      policyVersion: admittedPolicy.policyVersion,
      cameraPolicyId: wrappedPlan.policy.policyId,
      cameraPolicyVersion: wrappedPlan.policy.policyVersion,
    },
    timeline: { startMs: wrappedPlan.timeline.startMs, endMs: wrappedPlan.timeline.endMs },
    cameraPlan: wrappedPlan,
    windows,
    summary,
  };
}

/** Options for the {@link PresentationDirector} class wrapper. */
export interface PresentationDirectorOptions {
  /** The presentation policy (default: {@link DEFAULT_PRESENTATION_POLICY}). */
  policy?: PresentationPolicy;
}

/**
 * The presentation director (R305): the class wrapper over the pure
 * `present` function, carrying ONE validated policy. The `present` method
 * is pure — the same steps + candidates always yield the same plan (the
 * policy is cloned at construction so later mutations of the caller's
 * document can never leak in).
 */
export class PresentationDirector {
  /** The validated presentation policy (a private clone, never re-mutated). */
  readonly policy: PresentationPolicy;

  constructor(options: PresentationDirectorOptions = {}) {
    this.policy = cloneJson(admitPolicy(options.policy ?? DEFAULT_PRESENTATION_POLICY));
  }

  /**
   * Presents the match: wraps the W604 director's camera plan (directed by
   * this director's validated camera layer) and derives the additive
   * presentation layer (importance trace + presentation kinds + candidate
   * scoring). Pure; deterministic.
   */
  present(steps: readonly MatchTimelineStep[], candidates: readonly EventCandidate[]): PresentationPlan {
    return present(this.policy, steps, candidates);
  }
}
