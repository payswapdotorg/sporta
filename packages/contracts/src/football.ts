/**
 * Football sport extension.
 *
 * Football-specific rules live here and must not leak into generic transport
 * or rendering interfaces (architecture-lock §4). The generic
 * `WorldSnapshot` references this state optionally, so other sports can add
 * their own extension modules the same way.
 */
import { z } from "zod";
import { EntityId } from "./identity";
import { uncertainValue } from "./uncertainty";

/** Canonical pitch length along the x axis, in meters (IFAB-style standard pitch). */
export const PITCH_LENGTH_AXIS_METERS = 105;

/** Canonical pitch width along the y axis, in meters. */
export const PITCH_WIDTH_AXIS_METERS = 68;

/** Pitch coordinate origin: a corner of the pitch. */
export const PITCH_ORIGIN = "corner";

/** Axis convention: x runs along the touchline, y along the goal line. */
export const PITCH_AXES = "x=touchline, y=goal-line";

/**
 * The canonical football pitch frame. These are constants, not free
 * parameters: all football geometry in the SWM is expressed in this frame.
 * Changing the frame is a breaking schema change (see
 * docs/contracts/COMPATIBILITY.md).
 */
export const PitchFrame = z.object({
  lengthAxisMeters: z.literal(PITCH_LENGTH_AXIS_METERS),
  widthAxisMeters: z.literal(PITCH_WIDTH_AXIS_METERS),
  origin: z.literal(PITCH_ORIGIN),
  axes: z.literal(PITCH_AXES),
});
export type PitchFrame = z.infer<typeof PitchFrame>;

/** A point on the pitch, in meters within the canonical {@link PitchFrame}. */
export const PitchPoint = z.object({
  x: z.number(),
  y: z.number(),
});
export type PitchPoint = z.infer<typeof PitchPoint>;

/** Match periods. */
export const MatchPeriod = z.enum([
  "first-half",
  "second-half",
  "half-time",
  "pre-match",
  "post-match",
  "stoppage",
]);
export type MatchPeriod = z.infer<typeof MatchPeriod>;

/** The match clock: period, clock within the period, and stoppage flag. */
export const MatchClock = z.object({
  period: MatchPeriod,
  clockMs: z.number().min(0),
  stoppage: z.boolean(),
});
export type MatchClock = z.infer<typeof MatchClock>;

/** Whether the score is provisional or confirmed. */
export const ScoreStatusValue = z.enum(["provisional", "confirmed"]);
export type ScoreStatusValue = z.infer<typeof ScoreStatusValue>;

/**
 * The score with an uncertainty status: `known` once confirmed (e.g. by the
 * referee/official feed), otherwise a candidate value with confidence.
 */
export const Score = z.object({
  home: z.number().int().min(0),
  away: z.number().int().min(0),
  status: uncertainValue(ScoreStatusValue),
});
export type Score = z.infer<typeof Score>;

/**
 * Football-specific SWM state: canonical pitch frame, match clock, score,
 * possession candidate (uncertainty pattern over the possessing entity), and
 * the event taxonomy version in use.
 */
export const FootballState = z.object({
  pitch: PitchFrame,
  clock: MatchClock,
  score: Score,
  possession: uncertainValue(
    z.object({
      entityId: EntityId,
    }),
  ),
  eventTaxonomyVersion: z.string().min(1),
});
export type FootballState = z.infer<typeof FootballState>;

/**
 * The football event taxonomy (baseline v1). Event `eventTypeRef` strings
 * combine the sport, taxonomy version, and one of these types, e.g.
 * `"football/v1/pass"`.
 */
export const FOOTBALL_EVENT_TYPES = [
  "kickoff",
  "pass",
  "carry",
  "tackle",
  "shot",
  "save",
  "goal",
  "card",
  "substitution",
  "offside",
  "restart",
  "possession-change",
  "injury-pause",
  "referee-decision",
  "replay-cue",
  "commentary-emphasis",
] as const;
export type FootballEventType = (typeof FOOTBALL_EVENT_TYPES)[number];

/** Zod enum form of {@link FOOTBALL_EVENT_TYPES}. */
export const FootballEventType = z.enum(FOOTBALL_EVENT_TYPES);
