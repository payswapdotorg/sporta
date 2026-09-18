/**
 * The presentation plan (R305): the deterministic output of the
 * presentation director (`./present.ts` `present`). A plan is the WRAPPED
 * W604 `CameraPlan` VERBATIM — every window, slot, and decision record
 * preserved — plus the ADDITIVE presentation layer:
 *
 * - **`importanceTrace`** — per directed window: the event-importance
 *   contribution (which event, which table row, what weight), the
 *   commentary-semantic contribution (which W209 candidate matched, its
 *   verbatim text), and the combined score that justified the window's
 *   emphasis. EVERY window's trace is complete — a possession-following
 *   window traces to the policy-declared baseline, never an unexplained
 *   selection.
 * - **presentation-kind decisions** — the `live-follow` / `replay` /
 *   `wide` / `tight` classification of every window, with the
 *   classification rule + the wrapped plan's own inputs recorded per
 *   decision.
 * - **total candidate accounting** — every input W209 candidate scored
 *   (its importance row, its verbatim semantic inputs, its combined
 *   score) with its wrapped-plan outcome VERBATIM and the windows it
 *   drove.
 *
 * ## The plan's coverage contract (the invariants `./selfcheck.ts` checks)
 *
 * - **camera-plan-verbatim**: the embedded `cameraPlan` passes the W604
 *   `checkCameraPlan` harness over the same steps, and the presentation
 *   windows align 1:1 with the camera windows (gap-free indices).
 * - **one-selection-per-window**: every window carries EXACTLY ONE
 *   presentation kind and one classification rule.
 * - **every-window-traced**: every window's importance trace is complete
 *   (a contribution source, a weight, a semantic score, a combined score
 *   in `[0, 1]`) and consistent with the window's own camera decision
 *   (event-driven decisions trace to the verbatim candidate;
 *   possession-follow decisions trace to the declared baseline).
 * - **accounting-reconciled**: the candidate scoring mirrors the wrapped
 *   plan's candidate accounting (same order, same verbatim fields, same
 *   outcomes), and the presentation counts recompute.
 *
 * Determinism: the plan is a pure function of (policy, steps, candidates)
 * — no clock, no RNG, no I/O — the same inputs yield a JSON-byte-identical
 * plan on every call (pinned by tests).
 */
import type {
  CameraPlan,
  DirectorRuleId,
  EventCandidateOutcome,
  PresentationKind,
} from "@sporta/camera-director";
import type { FramingClass, PresentationKindClass, PresentationRuleId } from "./policy";
import type { CommentaryEventType } from "@sporta/commentary-understanding";

/**
 * The event-importance contribution of one window's trace: which event and
 * which policy table row drove it (or the declared baseline).
 */
export interface ImportanceContribution {
  /** `"event-rule"` (an event-importance row applied) or `"baseline"` (the routine-play floor). */
  source: "event-rule" | "baseline";
  /** The event type (event-rule source only). */
  eventType?: CommentaryEventType;
  /** The row's index in the policy's `eventImportance` table (event-rule source only). */
  ruleIndex?: number;
  /** The importance weight that applied: the row's weight, or the policy baseline. */
  weight: number;
}

/**
 * The commentary-semantic contribution of one window's trace: which W209
 * candidate matched (its fields VERBATIM — the director never re-derives
 * or re-scores a candidate, it quotes it), or the declared baseline.
 */
export interface SemanticContribution {
  /** `"candidate"` (a W209 candidate drove the window) or `"baseline"`. */
  source: "candidate" | "baseline";
  /** The candidate's id, verbatim (candidate source only). */
  candidateId?: string;
  /** The candidate's matched text span, VERBATIM (candidate source only). */
  eventPhrase?: string;
  /** The candidate's emphasis, VERBATIM (candidate source only). */
  emphasis?: number;
  /** The candidate's confidence, VERBATIM (candidate source only). */
  confidence?: number;
  /**
   * The commentary-semantic sub-score: `emphasisWeight·emphasis +
   * confidenceWeight·confidence` over the verbatim candidate fields, or
   * the baseline value standing in for both inputs (the policy weights
   * applied to the declared baseline score).
   */
  score: number;
}

/** One window's complete importance trace — why this window got its emphasis. */
export interface WindowImportanceTrace {
  /** The window's index (the wrapped camera plan's rundown order). */
  windowIndex: number;
  /** The event-importance contribution. */
  importance: ImportanceContribution;
  /** The commentary-semantic contribution. */
  semantics: SemanticContribution;
  /**
   * The combined score in `[0, 1]`: `importanceWeight·weight +
   * semantics.score` — the number that justifies the window's emphasis.
   */
  combinedScore: number;
  /** The fixed-template explanation (a pure function of the record's own fields). */
  reason: string;
}

/**
 * The presentation-kind decision record: which classification rule fired,
 * the wrapped plan's own inputs it consumed (verbatim), and the selected
 * presentation kind.
 */
export interface PresentationKindDecision {
  /** The window's index (the wrapped camera plan's rundown order). */
  windowIndex: number;
  /** The selected presentation kind (exactly one per window). */
  presentationKind: PresentationKindClass;
  /** Which classification rule fired (closed vocabulary). */
  ruleId: PresentationRuleId;
  /** The wrapped camera-plan window's own fields the rule consumed, verbatim. */
  inputs: {
    /** The wrapped window's presentation kind (`"live"` / `"review"`). */
    planKind: PresentationKind;
    /** The wrapped window's director rule id. */
    directorRuleId: DirectorRuleId;
    /** The wrapped window's canonical camera slot. */
    cameraSlotId: string;
    /** The slot's framing class (event-framing rule only). */
    framing?: FramingClass;
  };
  /** The fixed-template explanation (a pure function of the record's own fields). */
  reason: string;
}

/**
 * One presentation window: the ADDITIVE layer over the wrapped camera
 * window at the SAME index (`plan.cameraPlan.windows[index]` carries the
 * window's source range, camera slot, and decision record VERBATIM —
 * never duplicated here, never diverging).
 */
export interface PresentationWindow {
  /** The window's index (gap-free rundown order; aligns with the camera plan). */
  index: number;
  /** The selected presentation kind (exactly one per window). */
  presentationKind: PresentationKindClass;
  /** The presentation-kind decision record. */
  decision: PresentationKindDecision;
  /** The complete importance trace. */
  importanceTrace: WindowImportanceTrace;
}

/** One input candidate's presentation accounting entry (every candidate exactly once). */
export interface CandidatePresentationEntry {
  /** The candidate's id, verbatim. */
  candidateId: string;
  /** The candidate's event type, verbatim. */
  eventType: CommentaryEventType;
  /** The candidate's matched text span, VERBATIM (from the input stream). */
  eventPhrase: string;
  /** The candidate's event time (ms), verbatim. */
  eventTimeMs: number;
  /** The candidate's emphasis, verbatim. */
  emphasis: number;
  /** The candidate's confidence, verbatim. */
  confidence: number;
  /** The candidate's total outcome in the WRAPPED camera plan, VERBATIM. */
  outcome: EventCandidateOutcome;
  /** For `superseded` outcomes: the winning candidate id, verbatim. */
  supersededBy?: string;
  /** The importance row that applied (absent when the policy has no row for the type). */
  importanceWeight?: number;
  /** The applied row's index in the policy's table (absent with `importanceWeight`). */
  importanceRuleIndex?: number;
  /** The semantic sub-score (absent when the policy has no row for the type — never a half-scored entry). */
  semanticScore?: number;
  /** The combined score (absent when the policy has no row for the type). */
  combinedScore?: number;
  /** The windows this candidate drove (event-focus and replay-emphasis windows citing it). */
  droveWindowIndices: number[];
}

/** The presentation plan's accounting summary. */
export interface PresentationPlanSummary {
  /** Total presentation windows (equals the wrapped plan's window count). */
  windowCount: number;
  /** The presentation-kind counts (sum to `windowCount` — reconciled). */
  presentationCounts: {
    liveFollow: number;
    replay: number;
    wide: number;
    tight: number;
  };
  /** Presentation-kind changes between adjacent rundown windows. */
  presentationChangeCount: number;
  /** EVERY input candidate with its score + wrapped-plan outcome (reconciled). */
  candidateScoring: CandidatePresentationEntry[];
  /** The wrapped plan's own summary counts, quoted verbatim (reconciliation evidence). */
  cameraSummary: {
    windowCount: number;
    liveWindowCount: number;
    reviewWindowCount: number;
    cutCount: number;
  };
}

/**
 * THE presentation plan: the wrapped W604 `CameraPlan` VERBATIM plus the
 * additive presentation layer. Presentation-format-independent data (the
 * realized OUTPUT timeline is a composition-time concern).
 */
export interface PresentationPlan {
  /** The presentation-director contract version (`PRESENTATION_DIRECTOR_VERSION`). */
  presentationVersion: string;
  /** The policy identity the plan was presented by (presentation + camera layers). */
  policy: {
    policyId: string;
    policyVersion: string;
    cameraPolicyId: string;
    cameraPolicyVersion: string;
  };
  /** The match timeline extent (mirrors the wrapped plan, closed). */
  timeline: { startMs: number; endMs: number };
  /** The wrapped W604 `CameraPlan`, VERBATIM (every window, slot, decision record, accounting). */
  cameraPlan: CameraPlan;
  /** The additive layer: one presentation window per camera window, same order. */
  windows: PresentationWindow[];
  /** Accounting + evaluation summary. */
  summary: PresentationPlanSummary;
}
