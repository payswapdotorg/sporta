/**
 * Verbatim HUD text derivation for the avatar/field prototype (W602) — the
 * fixed phrase tables and templates of the frame's annotation band.
 *
 * HONESTY RULE (constitution: never invent text): every HUD string is
 * either
 *
 * 1. a FIXED phrase from the tables below ({@link EVENT_PHRASES},
 *    {@link PERIOD_PHRASES}, fixed separators and markers), or
 * 2. a FIXED template filled with numbers copied VERBATIM from the scene
 *    specification's `scoreClock` block (clock milliseconds, score
 *    integers), or
 * 3. a VERBATIM copy of the specification's own `eventTypeRef` string (for
 *    event markers whose type has no phrase — the reference itself is the
 *    honest text, never an invented phrase).
 *
 * There is no generative text, no name interpolation. The phrase tables are
 * this package's own original constants; changing one is a presentation
 * change that must ride a renderer version bump (identity-stable styling
 * includes the annotation layer).
 */
import type { Score } from "@sporta/contracts";
import type { SceneScoreClock } from "@sporta/scene-projection";

/**
 * The event-marker phrase table, keyed by football event type (v1
 * taxonomy). Fixed strings.
 */
export const EVENT_PHRASES: Readonly<Record<string, string>> = {
  kickoff: "Kick-off",
  pass: "Pass",
  carry: "Carry",
  tackle: "Tackle",
  shot: "Shot!",
  save: "Save!",
  goal: "GOAL!",
  card: "Card",
  substitution: "Substitution",
  offside: "Offside",
  restart: "Restart",
  "possession-change": "Possession change",
  "injury-pause": "Injury pause",
  "referee-decision": "Referee decision",
  "replay-cue": "Replay",
  "commentary-emphasis": "Commentary emphasis",
};

/** The status-line phrase for each match period (fixed table). */
export const PERIOD_PHRASES: Readonly<Record<string, string>> = {
  "first-half": "First half",
  "second-half": "Second half",
  "half-time": "Half-time",
  "pre-match": "Pre-match",
  "post-match": "Full time",
  stoppage: "Stoppage",
};

/** The separator used to join status-line parts (fixed). */
export const STATUS_SEPARATOR = " · ";

/** The marker appended when the score is not confirmed (fixed). */
export const SCORE_UNCONFIRMED_MARK = "?";

/** The part appended when the clock is in stoppage (fixed). */
export const STOPPAGE_MARK = "+stoppage";

/** The label prefix of the camera-slot annotation (fixed). */
export const CAMERA_LABEL_PREFIX = "CAM · ";

/** The phrase-table lookup key prefix accepted by {@link eventChipText}. */
const PHRASEABLE_PREFIX = "football/v1/";

/**
 * The fixed phrase for an event marker's `eventTypeRef`, or `undefined`
 * when the reference is not a known `football/v1/<type>` — the caller then
 * renders the VERBATIM `eventTypeRef` string as the chip text (accounted,
 * never an invented phrase).
 */
export function eventPhrase(eventTypeRef: string): string | undefined {
  if (!eventTypeRef.startsWith(PHRASEABLE_PREFIX)) return undefined;
  return EVENT_PHRASES[eventTypeRef.slice(PHRASEABLE_PREFIX.length)];
}

/**
 * The annotation text for one event marker: the fixed phrase when known,
 * otherwise the VERBATIM `eventTypeRef` (the honest unknown-type text).
 */
export function eventChipText(eventTypeRef: string): string {
  return eventPhrase(eventTypeRef) ?? eventTypeRef;
}

/**
 * Formats a match clock as `MM:SS` (fixed template, verbatim numbers):
 * minutes are `floor(clockMs / 60000)` (zero-padded to 2 but unbounded — a
 * 95th-minute clock prints `95:00`, never clamped), seconds are the
 * zero-padded remainder, and sub-second time truncates (floor).
 */
export function formatClock(clockMs: number): string {
  const minutes = Math.floor(clockMs / 60_000);
  const seconds = Math.floor((clockMs % 60_000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The score part of the status line, or `undefined` (honest omission) when
 * the score status is `unknown` — the schema's `home`/`away` integers are
 * then candidate fields with NO established value, and displaying them
 * would invent certainty (architecture-lock §4).
 *
 * - status `known` + value `"confirmed"` → `"1-0"` (asserted score);
 * - status `known` + value `"provisional"`, or status `uncertain` →
 *   `"1-0?"` (candidate score, visibly marked);
 * - status `unknown`, or a `known`/`uncertain` slot without a value →
 *   omitted (never invented).
 */
export function scorePart(score: Score): string | undefined {
  const slot = score.status;
  if (slot.status === "unknown" || slot.value === undefined) return undefined;
  const confirmed = slot.status === "known" && slot.value === "confirmed";
  const mark = confirmed ? "" : SCORE_UNCONFIRMED_MARK;
  return `${score.home}-${score.away}${mark}`;
}

/**
 * The full status line for a score/clock block: period phrase, clock,
 * score (omitted when unestablished), `+stoppage` when the stoppage flag is
 * set. Fixed template, verbatim numbers, parts joined by `" · "`.
 * `undefined` when the scene carries no football state (or carries neither
 * a clock nor a usable score part — an honest omission, never an invented
 * line).
 */
export function statusLine(scoreClock: SceneScoreClock): string | undefined {
  if (!scoreClock.footballState) return undefined;
  const clock = scoreClock.clock;
  const parts: string[] = [];
  if (clock !== undefined) {
    parts.push(PERIOD_PHRASES[clock.period] ?? clock.period);
    parts.push(formatClock(clock.clockMs));
  }
  if (scoreClock.score !== undefined) {
    const score = scorePart(scoreClock.score);
    if (score !== undefined) parts.push(score);
  }
  if (clock?.stoppage) parts.push(STOPPAGE_MARK);
  if (parts.length === 0) return undefined;
  return parts.join(STATUS_SEPARATOR);
}

/**
 * The camera-slot annotation text: `"CAM · <slotId>"` (the slot id
 * VERBATIM — the frame honestly labels which named slot produced it; W604
 * will pass the slot, the label never claims a choice was made).
 */
export function cameraLabel(slotId: string): string {
  return `${CAMERA_LABEL_PREFIX}${slotId}`;
}
