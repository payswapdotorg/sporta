/**
 * THE direction policy of the camera director (W604): a versioned, typed
 * DATA document — never code — that maps match state + commentary-derived
 * event candidates onto camera-slot choices and presentation emphasis.
 *
 * Work item W604: "event importance and commentary can influence
 * camera/replay emphasis deterministically enough to evaluate." The policy
 * is the deterministic content of that influence:
 *
 * - a **possession-following default** (the slot when nothing is
 *   happening): pitch-x zones → canonical slots, with hysteresis (a
 *   minimum shot duration so the default never strobes);
 * - an **event-importance table** (the pinned priority order): W209 event
 *   types ranked for camera importance, each with a confidence gate, a
 *   focus slot selector, and a pinned hold duration;
 * - **replay-emphasis decisions**: which event types earn a review window
 *   (a re-presentation of the event's time range at the W603 review
 *   profile) and its lookback/trail.
 *
 * Everything here is DATA: typed, versioned ({@link DIRECTOR_POLICY_VERSION}),
 * structurally validated (`./validate.ts`), and pinned by goldens
 * (`fixtures/golden/default-policy.json`) and tests. There are no hidden
 * constants in the director code — every duration, threshold, zone bound,
 * and priority is a named, documented policy field (POLICY.md is the
 * decision record).
 *
 * G7 boundary: the policy references ONLY the W601 canonical camera-slot
 * ids (public named geometry) and W209 event-type vocabulary — no
 * proprietary broadcast conventions are copied, no assets referenced.
 */
import type { CommentaryEventType } from "@sporta/commentary-understanding";

/**
 * How a focus/replay window's camera slot is chosen. Slots are SELECTED,
 * never invented: the three static selectors name canonical slots
 * directly; `nearest-goal` resolves per event to the behind-goal slot on
 * the side the follow reference (possessor/ball pitch x, verbatim from the
 * scene spec) is on — the split is the pitch's own halfway x (documented
 * module constant {@link GOAL_SIDE_SPLIT_X_METERS}). With NO usable
 * reference position the dynamic selector degrades honestly to the
 * policy's possession-follow fallback slot (never an invented angle).
 */
export type FocusSlotSelector =
  /** The behind-goal slot nearest the event's follow reference (dynamic). */
  | "nearest-goal"
  /** The canonical main broadcast slot (static). */
  | "main-touchline"
  /** The canonical mirrored touchline slot (static). */
  | "opposite-touchline"
  /** The canonical straight-down tactical view (static). */
  | "aerial-tactical";

/**
 * The x that splits the two "nearest goal" sides: the pitch's halfway x
 * (105 / 2 = 52.5 m, the `@sporta/contracts` pitch-length constant divided
 * by two — a pure derivation of the W601 pitch geometry, not a new
 * constant). A reference x at or left of the split is on the `behind-goal-x0`
 * side (ties to x0: canonical-first, documented).
 */
export const GOAL_SIDE_SPLIT_X_METERS: number = 105 / 2;

/** The static selectors (the selectors that need no reference position). */
export const STATIC_SLOT_SELECTORS: readonly FocusSlotSelector[] = [
  "main-touchline",
  "opposite-touchline",
  "aerial-tactical",
];

/** The full selector vocabulary, in documented order. */
export const FOCUS_SLOT_SELECTORS: readonly FocusSlotSelector[] = [
  "nearest-goal",
  ...STATIC_SLOT_SELECTORS,
];

/**
 * The possession-following default: which canonical slot frames the match
 * when no event window governs.
 */
export interface PossessionFollowConfig {
  /** Whether the follow rule is active (`false` ⇒ the constant fallback slot). */
  enabled: boolean;
  /**
   * The pitch-x zone table, in DECLARED priority order: the first zone
   * whose closed `[xMin, xMax]` contains the follow reference x wins.
   * Validation requires the zones to COVER the whole pitch x span
   * `[0, 105]` (a gap would be a policy bug, not an honest "unknown").
   */
  zones: ReadonlyArray<{ xMin: number; xMax: number; slotId: string }>;
  /**
   * The documented default slot: no football state / no usable follow
   * reference / follow disabled. This is the "gaps/unknown → the documented
   * default slot" of the plan's totality contract — also the honest
   * degradation of the dynamic `nearest-goal` selector.
   */
  fallbackSlotId: string;
  /**
   * The hysteresis (minimum default shot duration, milliseconds): a
   * default slot change at a snapshot boundary takes effect only when at
   * least this long has passed since the previous default cut. Suppressed
   * cuts are ACCOUNTED in the plan (never silently dropped).
   */
  hysteresisMs: number;
}

/**
 * The replay-emphasis decision for one event type: after the focus window,
 * re-present the event's time range at the W603 review profile (5 fps —
 * `AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE`, the "animated-review cadence"
 * of RENDERER.md §1). The review renders EXISTING scene steps — no new
 * content is authored.
 */
export interface ReplayConfig {
  /** The slot selector for the review window (resolved like the focus slot). */
  replaySlotSelector: FocusSlotSelector;
  /** The review source range starts this long before the event (ms, ≥ 0). */
  leadMs: number;
  /** The review source range ends this long after the event (ms, ≥ 0). */
  trailMs: number;
}

/**
 * One event-importance rule: the W209 event type, its confidence gate, its
 * focus slot selector, its pinned hold duration, and (optionally) its
 * replay-emphasis decision.
 */
export interface EventFocusRule {
  /** The W209 event type this rule matches (one rule per type). */
  eventType: CommentaryEventType;
  /**
   * The confidence gate in `[0, 1]`: a candidate with confidence strictly
   * below this is ignored (accounted `below-confidence`). The candidate's
   * confidence is copied VERBATIM from the W209 candidate.
   */
  minConfidence: number;
  /** The focus window's slot selector. */
  focusSlotSelector: FocusSlotSelector;
  /**
   * The pinned MINIMUM focus duration (milliseconds, > 0). The realized
   * window end is the first snapshot boundary at-or-after
   * `start + holdMs` (camera changes land at snapshot boundaries, never
   * mid-segment) — the hold is never shortened, only extended to the next
   * honest cut point, and clipped to the match timeline end.
   */
  holdMs: number;
  /** The replay-emphasis decision, when this type earns a review window. */
  replay?: ReplayConfig;
}

/**
 * THE direction policy document: typed, versioned, validated data. The
 * event-rule array's INDEX is the event-importance priority (lower index =
 * higher priority) — the pinned priority table of POLICY.md §3.
 */
export interface DirectorPolicy {
  /** The policy's logical id (stable across versions). */
  policyId: string;
  /** The policy document's version (immutable per content). */
  policyVersion: string;
  /** The possession-following default (the non-event direction). */
  possessionFollow: PossessionFollowConfig;
  /**
   * The event-importance table in priority order. May be empty (a pure
   * possession-follow policy). One rule per event type; the order MUST be
   * ascending in W209's own `EVENT_TYPE_PRIORITY` ranking for the DEFAULT
   * policy (a documented alignment, test-pinned) but any order is valid
   * data for a custom policy.
   */
  eventRules: ReadonlyArray<EventFocusRule>;
}

/**
 * The version of THIS policy document shape. Bumping it is a breaking
 * change to the director's input contract (the plan carries the policy
 * version it was directed by).
 */
export const DIRECTOR_POLICY_VERSION = "camera-director.policy@1";

/**
 * The version of the director contract itself (the plan + decision-record
 * shape). Carried by every {@link CameraPlan} and directed manifest.
 */
export const DIRECTOR_VERSION = "camera-director@1";

/**
 * THE canonical policy: `broadcast-classic` — the classic broadcast
 * direction grammar expressed over the five canonical W601 slots.
 *
 * The event-importance order INHERITS W209's `EVENT_TYPE_PRIORITY` ranking
 * for every ruled type (goal > save > shot > free-kick > card > corner >
 * kickoff > fulltime — the same relative order W209's extraction lexicon
 * uses, test-pinned). Ruled types without a rule (`pass`, `foul`,
 * `offside`, `throw-in`, `substitution`, `other`) stay with the
 * possession-following default: routine events do not move the camera in
 * this grammar (a documented, test-pinned decision).
 *
 * Every value below is pinned by `test/policy.test.ts` and the golden
 * `fixtures/golden/default-policy.json`.
 */
export const DEFAULT_DIRECTOR_POLICY: DirectorPolicy = {
  policyId: "broadcast-classic",
  policyVersion: DIRECTOR_POLICY_VERSION,
  possessionFollow: {
    enabled: true,
    zones: [
      // The final third toward the x0 goal: the behind-goal-x0 framing.
      { xMin: 0, xMax: 17.5, slotId: "behind-goal-x0" },
      // The final third toward the x105 goal: the behind-goal-x105 framing.
      { xMin: 87.5, xMax: 105, slotId: "behind-goal-x105" },
      // Everything in between: the classic main broadcast slot.
      { xMin: 17.5, xMax: 87.5, slotId: "main-touchline" },
    ],
    // No usable possession/position data → the classic main slot (the
    // documented default slot of the plan's totality contract).
    fallbackSlotId: "main-touchline",
    // A 3 s minimum default shot: the classic broadcast "don't cut too
    // often" grammar, expressed as hysteresis over snapshot boundaries.
    hysteresisMs: 3_000,
  },
  eventRules: [
    {
      // THE event: the goal window cuts to the goal being attacked and
      // holds 4 s, then the replay re-presents ±2 s around the goal.
      eventType: "goal",
      minConfidence: 0.5,
      focusSlotSelector: "nearest-goal",
      holdMs: 4_000,
      replay: { replaySlotSelector: "nearest-goal", leadMs: 2_000, trailMs: 2_000 },
    },
    {
      // A save earns the same behind-goal framing, a shorter hold, and a
      // shorter replay.
      eventType: "save",
      minConfidence: 0.6,
      focusSlotSelector: "nearest-goal",
      holdMs: 2_500,
      replay: { replaySlotSelector: "nearest-goal", leadMs: 1_500, trailMs: 1_500 },
    },
    {
      // A shot earns the behind-goal framing; no replay (the outcome may
      // still earn one — goal/save rules govern at higher priority).
      eventType: "shot",
      minConfidence: 0.65,
      focusSlotSelector: "nearest-goal",
      holdMs: 2_000,
    },
    {
      // A free-kick near the box frames best from behind the attacked goal.
      eventType: "free-kick",
      minConfidence: 0.6,
      focusSlotSelector: "nearest-goal",
      holdMs: 3_000,
    },
    {
      // A card: the classic wide main-touchline view (the fracas around
      // the referee, no tight angle exists among the canonical slots).
      eventType: "card",
      minConfidence: 0.6,
      focusSlotSelector: "main-touchline",
      holdMs: 3_000,
    },
    {
      // A corner is taken at a corner arc next to a goal — the
      // behind-goal framing shows the box and the incoming ball.
      eventType: "corner",
      minConfidence: 0.6,
      focusSlotSelector: "nearest-goal",
      holdMs: 2_500,
    },
    {
      // Kickoff: the classic main-touchline center framing.
      eventType: "kickoff",
      minConfidence: 0.6,
      focusSlotSelector: "main-touchline",
      holdMs: 3_000,
    },
    {
      // Fulltime: the wide aerial tactical view (the whole-pitch close).
      eventType: "fulltime",
      minConfidence: 0.6,
      focusSlotSelector: "aerial-tactical",
      holdMs: 5_000,
    },
  ],
};
