/**
 * The camera plan: the deterministic output of the director function
 * (`./direct.ts` `direct`). A plan is a RUNDOWN — an ordered sequence of
 * directed windows over the match timeline — plus total accounting.
 *
 * ## The plan's coverage contract (the invariants `./selfcheck.ts` checks)
 *
 * - **One selection per window.** Every window carries EXACTLY ONE
 *   canonical camera slot id and one presentation kind.
 * - **Totality.** The LIVE windows tile the whole match timeline
 *   `[timeline.startMs, timeline.endMs]` with SHARED boundaries:
 *   `windows[i].source.endMs === windows[i+1].source.startMs`, the first
 *   starts at `timeline.startMs`, the last ends at `timeline.endMs`. The
 *   boundary snapshot renders from the window that STARTS at the boundary
 *   (the cut takes effect there); a gap or an overlap is a bug, never a
 *   silently tolerated hole. Gaps in the INPUT DATA (no possession, no
 *   event) are covered by the documented default slot — never by an
 *   invented angle.
 * - **Honest transitions.** Live window boundaries are always SNAPSHOT
 *   boundaries (step `atMs` values): the camera changes at
 *   policy-specified cut points that land on snapshots, never mid-segment
 *   (the renderer-3d match-path camera-stability posture). Hysteresis,
 *   when the policy declares it, suppresses (and ACCOUNTS) default cuts
 *   that would violate the minimum shot duration.
 * - **Reviews never invent time.** A review window's source range is
 *   within `[timeline.startMs, timeline.endMs]` — a re-presentation of
 *   existing match time, never new content.
 *
 * ## Provenance (the evaluation surface for W605)
 *
 * Every window carries a DECISION RECORD: which rule fired, the event
 * candidate that drove it (its W209 fields VERBATIM — id, type, time,
 * confidence, emphasis), and the possession-follow inputs in force. Every
 * input candidate is accounted in `summary.eventAccounting` (governed /
 * superseded / below-confidence / no-rule / outside-timeline). Every
 * hysteresis-suppressed cut is accounted in `summary.suppressedCuts`.
 */
import type { CommentaryEventType } from "@sporta/commentary-understanding";

/** The presentation kind of a directed window. */
export type PresentationKind =
  /** Live match presentation at the request's output profile. */
  | "live"
  /**
   * Replay emphasis: a re-presentation of a past match range at the W603
   * review profile (`AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE`, 5 fps). No new
   * content is authored — existing scene steps are re-rendered.
   */
  | "review";

/** The closed rule vocabulary of the director (which rule fired). */
export type DirectorRuleId =
  /** The possession-following default chose this window's slot. */
  | "possession-follow"
  /** An event-importance rule opened a focus window. */
  | "event-focus"
  /** A replay-emphasis decision scheduled a review window. */
  | "replay-emphasis";

/**
 * The W209 event candidate that drove a decision, copied VERBATIM (the
 * no-invented-data rule: the director never re-derives or re-scores a
 * candidate — it quotes it).
 */
export interface EventDecisionRef {
  /** The candidate's id, verbatim (`"ec-<seq>"`). */
  candidateId: string;
  /** The candidate's event type, verbatim. */
  eventType: CommentaryEventType;
  /** The candidate's event time (ms), verbatim. */
  eventTimeMs: number;
  /** The candidate's confidence, VERBATIM (drives the confidence gate). */
  confidence: number;
  /** The candidate's emphasis, VERBATIM (commentary excitement). */
  emphasis: number;
}

/** The possession-follow inputs in force when a default window's slot governs. */
export interface PossessionDecisionInputs {
  /**
   * `true` when no usable follow reference existed (no football state, no
   * possession value, no placed possessor/ball): the policy's fallback
   * slot is in force — the honest no-data default.
   */
  fallback: boolean;
  /** The possessing entity id, VERBATIM from the step's spec, when the possession slot carried one. */
  entityId?: string;
  /**
   * The pitch x (meters) the follow resolved on: the possessor's position,
   * else the ball's, VERBATIM from the step's scene spec. Absent iff
   * `fallback` is `true`.
   */
  followX?: number;
  /** The zone the follow x matched (the policy zone's bounds, verbatim), when a zone matched. */
  zone?: { xMin: number; xMax: number };
  /**
   * The slot possession-follow DESIRES at this window's governing step
   * (the zone rule's answer for the current state). When this differs
   * from the window's slot, the hysteresis hold is in force — the record
   * proves the hold honestly.
   */
  desiredSlotId: string;
}

/**
 * Why this window exists and what set its slot — the per-window decision
 * record (the W605 evaluation surface).
 */
export interface WindowDecision {
  /** Which rule fired (closed vocabulary). */
  ruleId: DirectorRuleId;
  /** The event candidate that drove the decision, VERBATIM (event-driven rules only). */
  event?: EventDecisionRef;
  /** The possession-follow inputs in force (possession-follow windows only). */
  possession?: PossessionDecisionInputs;
  /**
   * The pinned duration the policy declared for this window (ms), when the
   * rule declared one: the event-rule's `holdMs` for `event-focus`
   * windows; for `replay-emphasis` windows the REALIZED review range
   * (`endMs − startMs` — the policy declares lead/trail, not a hold, and
   * the realized range is the honest record of what was re-presented).
   */
  holdMs?: number;
  /**
   * The fixed-template explanation (deterministic: a pure function of the
   * record's own fields — never free-form text).
   */
  reason: string;
}

/**
 * One directed window of the rundown. Source ranges are CLOSED
 * `[startMs, endMs]`; live windows tile the match timeline with shared
 * boundaries (the boundary snapshot belongs to the window STARTING there —
 * the realized render drops the previous run's boundary tail frame).
 */
export interface DirectedWindow {
  /** The window's index in rundown order (0-based, gap-free). */
  index: number;
  /** The presentation kind (live / review). */
  kind: PresentationKind;
  /**
   * The match-timeline range this window presents (closed). Live windows:
   * the tiling contract above. Review windows: the re-presented past
   * range, within the match timeline.
   */
  source: { startMs: number; endMs: number };
  /** The canonical W601 camera slot id directed for this window (never invented). */
  cameraSlotId: string;
  /** The decision record: which rule fired, which event drove it, verbatim inputs. */
  decision: WindowDecision;
}

/** A default cut suppressed by the policy's hysteresis (accounted, never silent). */
export interface SuppressedCut {
  /** The snapshot boundary where the default DESIRED a different slot. */
  atMs: number;
  /** The slot the zone rule desired. */
  desiredSlotId: string;
  /** The slot actually held (the previous default cut's slot). */
  heldSlotId: string;
  /** Milliseconds since the previous default cut (the hysteresis clock). */
  msSincePreviousCut: number;
}

/** The total outcome of one input W209 event candidate. */
export type EventCandidateOutcome =
  /** The candidate drove at least one directed window. */
  | "governed"
  /** A higher-priority (or newer) candidate's window governed instead. */
  | "superseded"
  /** Confidence strictly below the rule's gate. */
  | "below-confidence"
  /** The event type has no rule in this policy (the default covers it). */
  | "no-rule"
  /** Event time outside the match timeline extent. */
  | "outside-timeline";

/** One input candidate accounted (every input candidate appears exactly once). */
export interface EventAccountingEntry extends EventDecisionRef {
  /** The candidate's total outcome. */
  outcome: EventCandidateOutcome;
  /** For `superseded`: the candidate id that won the overlap. */
  supersededBy?: string;
}

/** The plan's accounting summary (the W605 evaluation surface). */
export interface CameraPlanSummary {
  /** Total directed windows (live + review). */
  windowCount: number;
  /** Live windows. */
  liveWindowCount: number;
  /** Review (replay-emphasis) windows. */
  reviewWindowCount: number;
  /** Slot changes between adjacent rundown windows (the cuts). */
  cutCount: number;
  /** Default cuts suppressed by hysteresis (accounted, never silent). */
  suppressedCuts: SuppressedCut[];
  /** EVERY input candidate with its outcome — total accounting. */
  eventAccounting: EventAccountingEntry[];
}

/**
 * THE camera plan: the director's complete, deterministic decision over
 * one match timeline + one candidate stream. The realized OUTPUT timeline
 * (rundown positions) is computed at composition time (it depends on the
 * output profile's frame interval — the plan itself is
 * presentation-format-independent data).
 */
export interface CameraPlan {
  /** The director contract version (`DIRECTOR_VERSION`). */
  directorVersion: string;
  /** The policy identity the plan was directed by (verbatim). */
  policy: { policyId: string; policyVersion: string };
  /** The match timeline extent (the steps' `atMs` span, closed). */
  timeline: { startMs: number; endMs: number };
  /** The directed windows, rundown order. */
  windows: DirectedWindow[];
  /** Accounting + evaluation summary. */
  summary: CameraPlanSummary;
}
