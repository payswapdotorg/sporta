/**
 * THE presentation policy (R305): a versioned, typed DATA document — never
 * code — that drives the presentation director's ADDITIVE layer over the
 * wrapped W604 camera director.
 *
 * The policy follows the `@sporta/camera-director` policy pattern exactly
 * (a versioned document, structurally validated, unknown keys ignored,
 * every value rule test-pinned), and adds the presentation layer's own
 * tables:
 *
 * - the **camera layer** (`camera`): the complete W604 `DirectorPolicy`
 *   document, embedded verbatim — the wrapped director directs with it,
 *   untouched (WRAPPED, never replaced). Validation delegates to the W604
 *   `validatePolicy`.
 * - the **event-importance table** (`eventImportance`): one row per W209
 *   event type with the type's importance weight in `[0, 1]` — the
 *   event-importance contribution of every event-driven window's trace.
 *   Cross-layer rule (validated): every event type the CAMERA layer rules
 *   MUST have an importance row (a ruled event without a weight would be
 *   an unexplainable window — never admitted).
 * - the **commentary-semantic blend** (`semantics`): how the W209
 *   candidate's verbatim `emphasis` and `confidence` blend with the
 *   importance weight into the combined score. The three weights are each
 *   `>= 0` and sum to exactly 1 (a documented, test-pinned model — never
 *   hidden constants in the director code).
 * - the **baseline values** (`baselineImportance`, `baselineSemanticScore`):
 *   the honest routine-play floor — the importance and semantic
 *   contributions of possession-following windows (no event, no candidate:
 *   the declared baseline, never an invented one).
 * - the **framing classes** (`framing`): the `wide`/`tight` framing class
 *   of each canonical W601 camera slot. Presentation kinds classify from
 *   the wrapped plan's own fields (window kind + director rule + slot
 *   framing) — coverage of every canonical slot is enforced FAIL-CLOSED at
 *   use time (a plan whose slot has no framing row is refused, never
 *   defaulted).
 *
 * G7 boundary: the policy references ONLY the W601 canonical camera-slot
 * ids (public named geometry) and the W209 event-type vocabulary — no
 * proprietary broadcast conventions, no assets.
 */
import { DEFAULT_DIRECTOR_POLICY, type DirectorPolicy } from "@sporta/camera-director";
import { EVENT_TYPE_PRIORITY, type CommentaryEventType } from "@sporta/commentary-understanding";

/** The presentation-kind vocabulary (the closed classification of a window). */
export type PresentationKindClass =
  /** Live match presentation following the play (the possession-following default). */
  | "live-follow"
  /** A replay: re-presentation of past match time (the W604 review window). */
  | "replay"
  /** Live event presentation framed wide (main/opposite touchline, aerial). */
  | "wide"
  /** Live event presentation framed tight (the behind-goal slots). */
  | "tight";

/** The framing class of a camera slot (the wide/tight axis of event windows). */
export type FramingClass = "wide" | "tight";

/** One event-importance table row. */
export interface EventImportanceRow {
  /** The W209 event type this row weights (one row per type). */
  eventType: CommentaryEventType;
  /** The type's importance weight in `[0, 1]`. */
  weight: number;
}

/** The commentary-semantic blend weights (each `>= 0`, sum exactly 1). */
export interface SemanticBlendWeights {
  /** The blend weight of the event-importance contribution. */
  importanceWeight: number;
  /** The blend weight of the candidate's verbatim `emphasis`. */
  emphasisWeight: number;
  /** The blend weight of the candidate's verbatim `confidence`. */
  confidenceWeight: number;
}

/** One camera slot's framing class. */
export interface FramingRule {
  /** The canonical W601 camera-slot id. */
  slotId: string;
  /** The slot's framing class. */
  framing: FramingClass;
}

/**
 * THE presentation policy document: typed, versioned, validated data. The
 * wrapped W604 director directs the camera plan with `camera`; this layer
 * explains (importance trace) and classifies (presentation kinds) the
 * wrapped plan's windows.
 */
export interface PresentationPolicy {
  /** The policy's logical id (stable across versions). */
  policyId: string;
  /** The policy document's version (immutable per content). */
  policyVersion: string;
  /** The embedded W604 `DirectorPolicy` (validated via the wrapped seam). */
  camera: DirectorPolicy;
  /** The event-importance table (unique rows, W209 vocabulary). */
  eventImportance: ReadonlyArray<EventImportanceRow>;
  /** The routine-play importance floor in `[0, 1]` (no event, no candidate). */
  baselineImportance: number;
  /** The commentary-semantic blend weights. */
  semantics: SemanticBlendWeights;
  /** The routine-commentary semantic floor in `[0, 1]`. */
  baselineSemanticScore: number;
  /** The framing class of each canonical camera slot. */
  framing: ReadonlyArray<FramingRule>;
}

/**
 * The version of THIS policy document shape. Bumping it is a breaking
 * change to the director's input contract (the plan carries the policy
 * version it was presented by).
 */
export const PRESENTATION_POLICY_VERSION = "presentation-director.policy@1";

/**
 * The version of the presentation-director contract itself (the plan +
 * trace + decision-record shape). Carried by every {@link PresentationPlan}.
 */
export const PRESENTATION_DIRECTOR_VERSION = "presentation-director@1";

/**
 * THE canonical policy: `broadcast-classic-presentation` — the additive
 * presentation layer over the W604 `broadcast-classic` camera grammar.
 *
 * - the camera layer IS the W604 `DEFAULT_DIRECTOR_POLICY`, imported
 *   verbatim (never re-stated — the wrapped seam's own default);
 * - the event-importance table covers the FULL W209 vocabulary, ordered by
 *   W209's own `EVENT_TYPE_PRIORITY` (a documented alignment, test-pinned,
 *   mirroring the camera default's alignment rule);
 * - the semantic blend is 0.5 importance / 0.3 emphasis / 0.2 confidence
 *   (sum exactly 1 — pinned);
 * - the baseline floor: routine play weighs 0.1 with a 0.2 routine
 *   commentary level (policy-declared, never invented per window);
 * - the framing classes: the two behind-goal slots are `tight`, the
 *   touchline and aerial slots are `wide` (all five canonical slots).
 *
 * Every value below is pinned by `test/policy.test.ts` and the golden
 * `fixtures/golden/default-presentation-policy.json`.
 */
export const DEFAULT_PRESENTATION_POLICY: PresentationPolicy = {
  policyId: "broadcast-classic-presentation",
  policyVersion: PRESENTATION_POLICY_VERSION,
  camera: DEFAULT_DIRECTOR_POLICY,
  eventImportance: [
    { eventType: "goal", weight: 1 },
    { eventType: "save", weight: 0.8 },
    { eventType: "shot", weight: 0.7 },
    { eventType: "free-kick", weight: 0.6 },
    { eventType: "card", weight: 0.6 },
    { eventType: "corner", weight: 0.5 },
    { eventType: "foul", weight: 0.3 },
    { eventType: "offside", weight: 0.3 },
    { eventType: "throw-in", weight: 0.2 },
    { eventType: "substitution", weight: 0.3 },
    { eventType: "kickoff", weight: 0.4 },
    { eventType: "fulltime", weight: 0.7 },
    { eventType: "pass", weight: 0.1 },
    { eventType: "other", weight: 0.05 },
  ],
  baselineImportance: 0.1,
  semantics: { importanceWeight: 0.5, emphasisWeight: 0.3, confidenceWeight: 0.2 },
  baselineSemanticScore: 0.2,
  framing: [
    { slotId: "main-touchline", framing: "wide" },
    { slotId: "opposite-touchline", framing: "wide" },
    { slotId: "aerial-tactical", framing: "wide" },
    { slotId: "behind-goal-x0", framing: "tight" },
    { slotId: "behind-goal-x105", framing: "tight" },
  ],
};

/** The presentation director's classification rule vocabulary (which rule fired). */
export type PresentationRuleId =
  /** A review window (the W604 replay-emphasis re-presentation). */
  | "review-window"
  /** The possession-following default governs (live match follow). */
  | "possession-default"
  /** An event-focus window classified by its slot's framing class. */
  | "event-framing";

/** The full W209 event-type vocabulary, in its own priority order (imported). */
export const W209_EVENT_TYPES: readonly CommentaryEventType[] = EVENT_TYPE_PRIORITY;
