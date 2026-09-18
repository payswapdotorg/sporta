/**
 * The presentation-plan self-check harness (R305 evaluation-readiness): a
 * pure, fail-soft invariant checker over a {@link PresentationPlan} + the
 * match timeline it was presented for — the `checkCameraPlan` posture
 * applied to the presentation layer. The director's own tests run it; any
 * composition consuming a presentation plan should run it at admission
 * (fail-closed composition is the consumer's choice; the harness reports,
 * never mutates).
 *
 * The invariants (each check's documented contract):
 *
 * - **plan-shape**: the plan is a record carrying the versioned shape
 *   (`presentationVersion`, policy identity, timeline, cameraPlan,
 *   windows, summary); windows are records with gap-free indices.
 * - **camera-plan-wrapped**: the embedded `cameraPlan` passes the W604
 *   `checkCameraPlan` harness over the same steps (the wrapped seam's own
 *   invariants — delegated, never re-implemented), and the presentation
 *   windows align 1:1 with the camera windows.
 * - **one-selection-per-window**: every window carries EXACTLY ONE
 *   presentation kind from the closed vocabulary and one classification
 *   rule from the closed vocabulary, with the wrapped inputs recorded.
 * - **every-window-traced**: every window's importance trace is complete
 *   (a contribution source, a finite weight/score in `[0, 1]`, a combined
 *   score in `[0, 1]`, a non-empty reason) and CONSISTENT with the
 *   window's own camera decision: event-driven decisions trace to the
 *   verbatim candidate (id, phrase, emphasis, confidence); possession
 *   decisions trace to the declared baseline.
 * - **accounting-reconciled**: the candidate scoring mirrors the wrapped
 *   plan's candidate accounting (same length and order, same verbatim
 *   fields and outcomes, phrase present), `droveWindowIndices` point at
 *   windows whose camera decision cites the same candidate, the
 *   presentation counts recompute, and `cameraSummary` quotes the wrapped
 *   plan's own counts verbatim.
 * - **policy-consistency** (when the policy is supplied): every traced
 *   weight/score/kind recomputes from the policy's own tables (the
 *   importance row's weight at the traced row index, the blend formula,
 *   the framing classification).
 */
import { checkCameraPlan } from "@sporta/camera-director";
import { isFiniteNumber, isRecord } from "./internal";
import type { PresentationPolicy } from "./policy";
import type { PresentationWindow } from "./types";
import type { MatchTimelineStep } from "./present";

/** The presentation-kind vocabulary. */
const PRESENTATION_KINDS = ["live-follow", "replay", "wide", "tight"] as const;

/** The classification-rule vocabulary. */
const CLASSIFICATION_RULES = ["review-window", "possession-default", "event-framing"] as const;

/** The camera-director rule vocabulary (mirrored for input validation only). */
const DIRECTOR_RULES = ["possession-follow", "event-focus", "replay-emphasis"] as const;

/** The camera plan-kind vocabulary. */
const PLAN_KINDS = ["live", "review"] as const;

/** The result of `checkPresentationPlan`: the violations (empty ⇔ ok). */
export interface PresentationCheckResult {
  ok: boolean;
  violations: string[];
}

function isWindowShape(value: unknown): value is PresentationWindow {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.index) &&
    typeof value.presentationKind === "string" &&
    isRecord(value.decision) &&
    typeof value.decision.ruleId === "string" &&
    typeof value.decision.reason === "string" &&
    isRecord(value.importanceTrace) &&
    isRecord(value.importanceTrace.importance) &&
    isRecord(value.importanceTrace.semantics) &&
    typeof value.importanceTrace.reason === "string"
  );
}

/** Reads a finite number in [0, 1] or undefined. */
function readUnit(value: unknown): number | undefined {
  return isFiniteNumber(value) && value >= 0 && value <= 1 ? value : undefined;
}

/**
 * Checks a presentation plan against the match timeline it was presented
 * for. Pure: the plan is never mutated; the same inputs yield the same
 * violations. When `policy` is supplied, the traced values are additionally
 * re-verified against the policy's own tables.
 */
export function checkPresentationPlan(
  plan: unknown,
  steps: readonly MatchTimelineStep[],
  policy?: PresentationPolicy,
): PresentationCheckResult {
  const violations: string[] = [];
  const push = (id: string, path: string, message: string): void => {
    violations.push(`${id}: ${path}: ${message}`);
  };

  if (!isRecord(plan)) {
    push("plan-shape", "plan", "must be an object");
    return { ok: false, violations };
  }
  if (typeof plan.presentationVersion !== "string" || plan.presentationVersion.length === 0) {
    push("plan-shape", "plan.presentationVersion", "must be a non-empty string");
  }
  if (!isRecord(plan.policy)) {
    push("plan-shape", "plan.policy", "must be an object");
  }
  if (!isRecord(plan.timeline)) {
    push("plan-shape", "plan.timeline", "must be an object");
  }
  const windows = plan.windows;
  if (!Array.isArray(windows) || windows.length === 0) {
    push("plan-shape", "plan.windows", "must be a non-empty array");
    return { ok: false, violations };
  }

  // camera-plan-wrapped: delegate the wrapped plan's own invariants to the
  // W604 harness (never re-implemented here), then check the 1:1 alignment.
  const cameraPlan = plan.cameraPlan;
  const cameraWindows: readonly unknown[] =
    isRecord(cameraPlan) && Array.isArray(cameraPlan.windows)
      ? (cameraPlan.windows as unknown[])
      : [];
  if (!isRecord(cameraPlan) || cameraWindows.length === 0) {
    push("camera-plan-wrapped", "plan.cameraPlan", "must be a CameraPlan record with windows");
  } else {
    const cameraCheck = checkCameraPlan(
      cameraPlan,
      steps as unknown as Parameters<typeof checkCameraPlan>[1],
    );
    if (!cameraCheck.ok) {
      for (const violation of cameraCheck.violations) {
        push("camera-plan-wrapped", "plan.cameraPlan", violation);
      }
    }
    if (cameraWindows.length !== windows.length) {
      push(
        "camera-plan-wrapped",
        "plan.windows",
        `must align 1:1 with the camera plan's windows (${cameraWindows.length} camera windows, ${windows.length} presentation windows)`,
      );
    }
  }

  // plan-shape + one-selection-per-window + every-window-traced.
  for (let i = 0; i < windows.length; i += 1) {
    const window = windows[i];
    if (!isWindowShape(window)) {
      push("plan-shape", `windows[${i}]`, "must be a presentation window record");
      continue;
    }
    if (window.index !== i) {
      push("plan-shape", `windows[${i}].index`, `must be ${i} (gap-free rundown order)`);
    }
    if (!(PRESENTATION_KINDS as readonly string[]).includes(window.presentationKind)) {
      push(
        "one-selection-per-window",
        `windows[${i}].presentationKind`,
        `"${String(window.presentationKind)}" is not a presentation kind (live-follow / replay / wide / tight)`,
      );
    }
    const decision = window.decision;
    if (!(CLASSIFICATION_RULES as readonly string[]).includes(decision.ruleId)) {
      push(
        "one-selection-per-window",
        `windows[${i}].decision.ruleId`,
        `"${String(decision.ruleId)}" is not a classification rule id`,
      );
    }
    const inputs = isRecord(decision.inputs) ? decision.inputs : undefined;
    if (inputs === undefined) {
      push(
        "one-selection-per-window",
        `windows[${i}].decision.inputs`,
        "must record the wrapped window's own inputs (planKind / directorRuleId / cameraSlotId)",
      );
    } else {
      if (!(PLAN_KINDS as readonly string[]).includes(inputs.planKind)) {
        push(
          "one-selection-per-window",
          `windows[${i}].decision.inputs.planKind`,
          `must be "live" or "review" (got ${String(inputs.planKind)})`,
        );
      }
      if (!(DIRECTOR_RULES as readonly string[]).includes(inputs.directorRuleId)) {
        push(
          "one-selection-per-window",
          `windows[${i}].decision.inputs.directorRuleId`,
          `"${String(inputs.directorRuleId)}" is not a camera-director rule id`,
        );
      }
      if (typeof inputs.cameraSlotId !== "string" || inputs.cameraSlotId.length === 0) {
        push(
          "one-selection-per-window",
          `windows[${i}].decision.inputs.cameraSlotId`,
          "must be a non-empty string",
        );
      }
    }
    checkTraceOfWindow(window, i, cameraWindows[i], policy, push);
  }

  // accounting-reconciled.
  checkAccounting(plan, cameraWindows, push);

  return { ok: violations.length === 0, violations };
}

/** Checks one window's importance trace (completeness + camera consistency + policy recompute). */
function checkTraceOfWindow(
  window: PresentationWindow,
  index: number,
  cameraWindow: unknown,
  policy: PresentationPolicy | undefined,
  push: (id: string, path: string, message: string) => void,
): void {
  const trace = window.importanceTrace;
  if (trace.windowIndex !== index) {
    push(
      "every-window-traced",
      `windows[${index}].importanceTrace.windowIndex`,
      `must be ${index}`,
    );
  }
  const importance = trace.importance;
  const semantics = trace.semantics;
  if (importance.source !== "event-rule" && importance.source !== "baseline") {
    push(
      "every-window-traced",
      `windows[${index}].importanceTrace.importance.source`,
      `must be "event-rule" or "baseline" (got ${String(importance.source)})`,
    );
  }
  const weight = readUnit(importance.weight);
  if (weight === undefined) {
    push(
      "every-window-traced",
      `windows[${index}].importanceTrace.importance.weight`,
      "must be a finite number in [0, 1]",
    );
  }
  if (importance.source === "event-rule") {
    if (typeof importance.eventType !== "string" || importance.eventType.length === 0) {
      push(
        "every-window-traced",
        `windows[${index}].importanceTrace.importance.eventType`,
        "must be a non-empty string (which event)",
      );
    }
    if (
      !isFiniteNumber(importance.ruleIndex) ||
      !Number.isInteger(importance.ruleIndex) ||
      importance.ruleIndex < 0
    ) {
      push(
        "every-window-traced",
        `windows[${index}].importanceTrace.importance.ruleIndex`,
        "must be an integer >= 0 (which table row)",
      );
    }
  }
  if (semantics.source !== "candidate" && semantics.source !== "baseline") {
    push(
      "every-window-traced",
      `windows[${index}].importanceTrace.semantics.source`,
      `must be "candidate" or "baseline" (got ${String(semantics.source)})`,
    );
  }
  const semanticScore = readUnit(semantics.score);
  if (semanticScore === undefined) {
    push(
      "every-window-traced",
      `windows[${index}].importanceTrace.semantics.score`,
      "must be a finite number in [0, 1]",
    );
  }
  const combined = readUnit(trace.combinedScore);
  if (combined === undefined) {
    push(
      "every-window-traced",
      `windows[${index}].importanceTrace.combinedScore`,
      "must be a finite number in [0, 1]",
    );
  }
  if (typeof trace.reason !== "string" || trace.reason.length === 0) {
    push(
      "every-window-traced",
      `windows[${index}].importanceTrace.reason`,
      "must be a non-empty string",
    );
  }

  // Consistency with the window's OWN camera decision (verbatim riding).
  const cameraDecision =
    isRecord(cameraWindow) && isRecord(cameraWindow.decision) ? cameraWindow.decision : undefined;
  if (cameraDecision === undefined) {
    return; // camera-plan-wrapped already flagged the missing camera window
  }
  const cameraRule = typeof cameraDecision.ruleId === "string" ? cameraDecision.ruleId : "";
  const eventDriven = cameraRule === "event-focus" || cameraRule === "replay-emphasis";
  const cameraEvent = isRecord(cameraDecision.event) ? cameraDecision.event : undefined;
  if (eventDriven) {
    if (importance.source !== "event-rule" || semantics.source !== "candidate") {
      push(
        "every-window-traced",
        `windows[${index}].importanceTrace`,
        "an event-driven camera decision must trace to the event-importance row AND the candidate",
      );
    }
    if (cameraEvent !== undefined && semantics.source === "candidate") {
      if (semantics.candidateId !== cameraEvent.candidateId) {
        push(
          "every-window-traced",
          `windows[${index}].importanceTrace.semantics.candidateId`,
          `"${String(semantics.candidateId)}" disagrees with the camera decision's verbatim candidate "${String(cameraEvent.candidateId)}"`,
        );
      }
      for (const [name, value] of [
        ["emphasis", semantics.emphasis],
        ["confidence", semantics.confidence],
      ] as Array<[string, unknown]>) {
        if (value !== cameraEvent[name]) {
          push(
            "every-window-traced",
            `windows[${index}].importanceTrace.semantics.${name}`,
            `${String(value)} disagrees with the camera decision's verbatim ${name} ${String(cameraEvent[name])} — the candidate must ride VERBATIM`,
          );
        }
      }
      if (typeof semantics.eventPhrase !== "string" || semantics.eventPhrase.length === 0) {
        push(
          "every-window-traced",
          `windows[${index}].importanceTrace.semantics.eventPhrase`,
          "must carry the candidate's verbatim matched text span",
        );
      }
      if (
        typeof importance.eventType === "string" &&
        typeof cameraEvent.eventType === "string" &&
        importance.eventType !== cameraEvent.eventType
      ) {
        push(
          "every-window-traced",
          `windows[${index}].importanceTrace.importance.eventType`,
          `"${String(importance.eventType)}" disagrees with the camera decision's event type "${String(cameraEvent.eventType)}"`,
        );
      }
    }
  } else if (cameraRule === "possession-follow") {
    if (importance.source !== "baseline" || semantics.source !== "baseline") {
      push(
        "every-window-traced",
        `windows[${index}].importanceTrace`,
        "a possession-follow camera decision must trace to the declared baseline (never an invented event/candidate)",
      );
    }
  }

  // Policy consistency (when the policy is supplied): every traced value
  // recomputes from the policy's own tables.
  if (
    policy === undefined ||
    weight === undefined ||
    semanticScore === undefined ||
    combined === undefined
  ) {
    return;
  }
  if (importance.source === "baseline") {
    if (weight !== policy.baselineImportance) {
      push(
        "policy-consistency",
        `windows[${index}].importanceTrace.importance.weight`,
        `must equal the policy baseline ${policy.baselineImportance} (got ${weight})`,
      );
    }
    const expectedSemantic = roundCheck(
      (policy.semantics.emphasisWeight + policy.semantics.confidenceWeight) *
        policy.baselineSemanticScore,
    );
    if (semanticScore !== expectedSemantic) {
      push(
        "policy-consistency",
        `windows[${index}].importanceTrace.semantics.score`,
        `must equal the policy baseline blend ${expectedSemantic} (got ${semanticScore})`,
      );
    }
  } else if (
    Number.isInteger(importance.ruleIndex) &&
    (importance.ruleIndex as number) >= 0 &&
    (importance.ruleIndex as number) < policy.eventImportance.length
  ) {
    const row = policy.eventImportance[importance.ruleIndex as number]!;
    if (weight !== row.weight) {
      push(
        "policy-consistency",
        `windows[${index}].importanceTrace.importance.weight`,
        `must equal the policy row ${importance.ruleIndex} weight ${row.weight} (got ${weight})`,
      );
    }
    if (importance.eventType !== undefined && importance.eventType !== row.eventType) {
      push(
        "policy-consistency",
        `windows[${index}].importanceTrace.importance.eventType`,
        `"${String(importance.eventType)}" disagrees with policy row ${importance.ruleIndex}'s type "${row.eventType}"`,
      );
    }
    if (
      semantics.source === "candidate" &&
      isFiniteNumber(semantics.emphasis) &&
      isFiniteNumber(semantics.confidence)
    ) {
      const expectedSemantic = roundCheck(
        policy.semantics.emphasisWeight * semantics.emphasis +
          policy.semantics.confidenceWeight * semantics.confidence,
      );
      if (semanticScore !== expectedSemantic) {
        push(
          "policy-consistency",
          `windows[${index}].importanceTrace.semantics.score`,
          `must equal the blend over the verbatim candidate ${expectedSemantic} (got ${semanticScore})`,
        );
      }
    }
  }
  const expectedCombined = roundCheck(policy.semantics.importanceWeight * weight + semanticScore);
  if (combined !== expectedCombined) {
    push(
      "policy-consistency",
      `windows[${index}].importanceTrace.combinedScore`,
      `must equal importanceWeight·weight + semantics.score = ${expectedCombined} (got ${combined})`,
    );
  }
  // The classification recomputes from the wrapped inputs + policy framing.
  if (isRecord(window.decision.inputs)) {
    const inputs = window.decision.inputs;
    const planKind = inputs.planKind;
    const directorRuleId = inputs.directorRuleId;
    const slotId = typeof inputs.cameraSlotId === "string" ? inputs.cameraSlotId : "";
    let expectedKind: string | undefined;
    if (planKind === "review") {
      expectedKind = "replay";
    } else if (directorRuleId === "possession-follow") {
      expectedKind = "live-follow";
    } else if (directorRuleId === "event-focus") {
      const row = policy.framing.find((rule) => rule.slotId === slotId);
      expectedKind = row?.framing;
    }
    if (expectedKind !== undefined && window.presentationKind !== expectedKind) {
      push(
        "policy-consistency",
        `windows[${index}].presentationKind`,
        `must classify as "${expectedKind}" from the wrapped inputs (got "${window.presentationKind}")`,
      );
    }
  }
}

/** The accounting reconciliation (candidate scoring mirrors the wrapped accounting). */
function checkAccounting(
  plan: Record<string, unknown>,
  cameraWindows: readonly unknown[],
  push: (id: string, path: string, message: string) => void,
): void {
  const summary = isRecord(plan.summary) ? plan.summary : undefined;
  if (summary === undefined) {
    push("accounting-reconciled", "plan.summary", "must be an object");
    return;
  }
  const cameraPlan = isRecord(plan.cameraPlan) ? plan.cameraPlan : undefined;
  const cameraSummary =
    cameraPlan !== undefined && isRecord(cameraPlan.summary) ? cameraPlan.summary : undefined;
  const cameraAccounting =
    cameraSummary !== undefined && Array.isArray(cameraSummary.eventAccounting)
      ? cameraSummary.eventAccounting
      : undefined;
  const scoring = Array.isArray(summary.candidateScoring) ? summary.candidateScoring : undefined;
  if (scoring === undefined) {
    push("accounting-reconciled", "plan.summary.candidateScoring", "must be an array");
  } else if (cameraAccounting !== undefined) {
    if (scoring.length !== cameraAccounting.length) {
      push(
        "accounting-reconciled",
        "plan.summary.candidateScoring",
        `must mirror the wrapped accounting's ${cameraAccounting.length} entries (got ${scoring.length})`,
      );
    }
    for (let i = 0; i < Math.min(scoring.length, cameraAccounting.length); i += 1) {
      const entry = isRecord(scoring[i]) ? scoring[i] : undefined;
      const cameraEntry = isRecord(cameraAccounting[i]) ? cameraAccounting[i] : undefined;
      if (entry === undefined || cameraEntry === undefined) {
        push("accounting-reconciled", `plan.summary.candidateScoring[${i}]`, "must be an object");
        continue;
      }
      for (const [name, value] of [
        ["candidateId", entry.candidateId],
        ["eventType", entry.eventType],
        ["eventTimeMs", entry.eventTimeMs],
        ["emphasis", entry.emphasis],
        ["confidence", entry.confidence],
        ["outcome", entry.outcome],
        ["supersededBy", entry.supersededBy],
      ] as Array<[string, unknown]>) {
        if (value !== cameraEntry[name]) {
          push(
            "accounting-reconciled",
            `plan.summary.candidateScoring[${i}].${name}`,
            `${String(value)} disagrees with the wrapped accounting entry's verbatim ${name} ${String(cameraEntry[name])}`,
          );
        }
      }
      if (typeof entry.eventPhrase !== "string" || entry.eventPhrase.length === 0) {
        push(
          "accounting-reconciled",
          `plan.summary.candidateScoring[${i}].eventPhrase`,
          "must carry the candidate's verbatim matched text span",
        );
      }
      const drove = entry.droveWindowIndices;
      if (!Array.isArray(drove)) {
        push(
          "accounting-reconciled",
          `plan.summary.candidateScoring[${i}].droveWindowIndices`,
          "must be an array",
        );
        continue;
      }
      for (const windowIndex of drove) {
        if (
          !Number.isInteger(windowIndex) ||
          windowIndex < 0 ||
          windowIndex >= cameraWindows.length
        ) {
          push(
            "accounting-reconciled",
            `plan.summary.candidateScoring[${i}].droveWindowIndices`,
            `${String(windowIndex)} is not a valid window index`,
          );
          continue;
        }
        const cameraWindow = cameraWindows[windowIndex];
        const decision =
          isRecord(cameraWindow) && isRecord(cameraWindow.decision)
            ? cameraWindow.decision
            : undefined;
        const cited =
          decision !== undefined && isRecord(decision.event)
            ? decision.event.candidateId
            : undefined;
        if (cited !== entry.candidateId) {
          push(
            "accounting-reconciled",
            `plan.summary.candidateScoring[${i}].droveWindowIndices`,
            `window ${String(windowIndex)}'s camera decision cites "${String(cited)}", not "${String(entry.candidateId)}"`,
          );
        }
      }
    }
  }
  // The presentation counts recompute from the plan's own windows.
  const windows = Array.isArray(plan.windows) ? plan.windows : [];
  const counts = isRecord(summary.presentationCounts) ? summary.presentationCounts : undefined;
  if (counts !== undefined) {
    const expected: Record<string, number> = { "live-follow": 0, replay: 0, wide: 0, tight: 0 };
    for (const window of windows) {
      if (isRecord(window) && typeof window.presentationKind === "string") {
        const kind = window.presentationKind as string;
        if (kind in expected) expected[kind] = (expected[kind] as number) + 1;
      }
    }
    // The summary's camelCase field names map onto the kebab-case kind ids.
    const pairs: Array<[string, string, unknown]> = [
      ["liveFollow", "live-follow", counts.liveFollow],
      ["replay", "replay", counts.replay],
      ["wide", "wide", counts.wide],
      ["tight", "tight", counts.tight],
    ];
    for (const [field, kind, value] of pairs) {
      if (value !== expected[kind]) {
        push(
          "accounting-reconciled",
          `plan.summary.presentationCounts.${field}`,
          `must be ${expected[kind]} (recomputed from the windows; got ${String(value)})`,
        );
      }
    }
    const total = pairs.reduce((sum, [, , value]) => sum + (isFiniteNumber(value) ? value : 0), 0);
    if (total !== windows.length) {
      push(
        "accounting-reconciled",
        "plan.summary.presentationCounts",
        `must sum to the window count ${windows.length} (got ${total})`,
      );
    }
  } else {
    push("accounting-reconciled", "plan.summary.presentationCounts", "must be an object");
  }
  if (summary.windowCount !== windows.length) {
    push("accounting-reconciled", "plan.summary.windowCount", `must be ${windows.length}`);
  }
  let expectedChanges = 0;
  for (let i = 1; i < windows.length; i += 1) {
    const previous = isRecord(windows[i - 1]) ? windows[i - 1]!.presentationKind : undefined;
    const current = isRecord(windows[i]) ? windows[i]!.presentationKind : undefined;
    if (typeof previous === "string" && typeof current === "string" && previous !== current) {
      expectedChanges += 1;
    }
  }
  if (summary.presentationChangeCount !== expectedChanges) {
    push(
      "accounting-reconciled",
      "plan.summary.presentationChangeCount",
      `must be ${expectedChanges} (kind changes between adjacent rundown windows)`,
    );
  }
  // The camera summary quotes the wrapped plan's own counts verbatim.
  if (cameraSummary !== undefined && isRecord(summary.cameraSummary)) {
    const pairs: Array<[string, unknown]> = [
      ["windowCount", cameraSummary.windowCount],
      ["liveWindowCount", cameraSummary.liveWindowCount],
      ["reviewWindowCount", cameraSummary.reviewWindowCount],
      ["cutCount", cameraSummary.cutCount],
    ];
    for (const [name, value] of pairs) {
      if (summary.cameraSummary[name] !== value) {
        push(
          "accounting-reconciled",
          `plan.summary.cameraSummary.${name}`,
          `must quote the wrapped plan's ${name} ${String(value)} verbatim (got ${String(summary.cameraSummary[name])})`,
        );
      }
    }
  }
}

/** The score rounding of `./present.ts` (one formula, both sides). */
function roundCheck(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}
