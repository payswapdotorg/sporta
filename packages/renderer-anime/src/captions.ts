/**
 * Verbatim caption derivation for the anime prototype (W502).
 *
 * HONESTY RULE (constitution: never invent text): every caption string is
 * either
 *
 * 1. a FIXED phrase from the DATA-pure tables below
 *    ({@link EVENT_PHRASES}, {@link PERIOD_PHRASES}, fixed separators and
 *    markers), or
 * 2. a FIXED template filled with numbers copied verbatim from the SWM
 *    snapshot (clock, score).
 *
 * There is no generative text, no interpolation of names, no invented
 * commentary. An event whose `eventTypeRef` is not `football/v1/<known
 * type>` is NOT captioned (no invented phrase) — it is accounted as
 * uncaptioned in the frame manifest instead. An absent football state
 * omits the status line (honest omission, accounted).
 */
import type { MatchClock, MatchPeriod, Score } from "@sporta/contracts";
import type { FootballEventType } from "@sporta/contracts";

/**
 * The football state fields captions consume (`FootballState` is not
 * re-exported by the contracts barrel; this structural pick is the exact
 * surface the caption rules need).
 */
export type FootballCaptionState = {
  clock: MatchClock;
  score: Score;
};

/**
 * The caption phrase table, keyed by football event type (v1 taxonomy).
 * Fixed strings; changing one is a caption-contract change and must ride a
 * renderer version bump.
 */
export const EVENT_PHRASES: Readonly<Record<FootballEventType, string>> = {
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
export const PERIOD_PHRASES: Readonly<Record<MatchPeriod, string>> = {
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

/** The phrase-table lookup key prefix accepted by {@link captionForEvent}. */
const CAPTIONABLE_PREFIX = "football/v1/";

/**
 * The fixed caption phrase for an event `eventTypeRef`, or `undefined` when
 * the reference is not a known `football/v1/<type>` — the caller must then
 * account the event as uncaptioned (never invent a phrase for it).
 */
export function captionForEvent(eventTypeRef: string): string | undefined {
  if (!eventTypeRef.startsWith(CAPTIONABLE_PREFIX)) return undefined;
  const type = eventTypeRef.slice(CAPTIONABLE_PREFIX.length);
  const phrase = (EVENT_PHRASES as Record<string, string | undefined>)[type];
  return phrase;
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
 * The full status line for a football state: period phrase, clock, score
 * (omitted when unestablished), `+stoppage` when the stoppage flag is set.
 * Fixed template, verbatim numbers, parts joined by `" · "`.
 */
export function statusLine(football: FootballCaptionState): string {
  const parts: string[] = [PERIOD_PHRASES[football.clock.period]];
  parts.push(formatClock(football.clock.clockMs));
  const score = scorePart(football.score);
  if (score !== undefined) parts.push(score);
  if (football.clock.stoppage) parts.push(STOPPAGE_MARK);
  return parts.join(STATUS_SEPARATOR);
}
