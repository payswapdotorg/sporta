/**
 * THE RECORDED SKILLCORNER OPENDATA TRACKING SCHEMA (L007) — the published
 * format of `github.com/SkillCorner/opendata`
 * `data/matches/{id}/{id}_tracking_extrapolated.jsonl`, RECORDED 2026-09-21
 * from the repo's README (tracking-data description section) and from real
 * sampled frames (the LFS media endpoint, byte ranges of match 2017461):
 * the all-null pre-match frames at the head of the file and a populated
 * mid-match frame (`{"frame":28203,"timestamp":"00:42:49.30","period":1,
 * "ball_data":{"x":-9.54,"y":-33.08,"z":1.84,"is_detected":false},…,
 * "player_data":[{"x":-44.62,"y":-8.31,"player_id":51678,
 * "is_detected":false},…22 players]}`). This module is the schema of record
 * the adapter parses; NOTHING here is copied DATA — only the FORMAT.
 *
 * THE FORMAT (per the README + samples):
 *
 * - one JSON object per line (JSONL), one per tracked frame at 10 fps;
 * - `frame`: the 0-based frame number;
 * - `timestamp`: `"HH:MM:SS.ss"` match time within the period (null pre-match);
 * - `period`: 1 or 2 (null pre-match);
 * - `ball_data`: `{x, y, z, is_detected}` — all nullable; `z` is meters above
 *   the pitch plane; `is_detected` false = an EXTRAPOLATED position (the
 *   honest carry flag — it maps VERBATIM to the frozen live contract's
 *   `detected`);
 * - `possession`: `{player_id, group}` — PROVIDER-SPECIFIC (the broadcast
 *   possessor hypothesis); consumed for adapter accounting only, NEVER
 *   mapped into a product contract (the SWM derives possession from
 *   canonical evidence);
 * - `image_corners_projection`: the broadcast image polygon —
 *   provider-specific, not mapped (the adapter's stream is pitch-space);
 * - `player_data`: the players found this frame — `{x, y, player_id,
 *   is_detected}`; meters, CENTER-ORIGIN pitch frame (x along the long side
 *   ∈ [-52.5, 52.5], y along the short side ∈ [-34, 34] on a 105×68 pitch);
 *   a player ABSENT from a frame is simply unobserved that frame (broadcast
 *   tracking sees the screen).
 *
 * PURITY: schema + pure parsing only — no clock, no env, no I/O (the adapter
 * receives the JSONL text).
 */
import { z } from "zod";

/** The provider's nominal frame rate (README: "the frame of the video the data comes from at 10 fps"). */
export const SKILLCORNER_FRAME_RATE_HZ = 10;

/** The provider's frame interval in ms. */
export const SKILLCORNER_FRAME_INTERVAL_MS = 100;

/** The default pitch (README: "Here is an illustration for a field of size 105mx68m"). */
export const SKILLCORNER_DEFAULT_PITCH = { lengthMeters: 105, widthMeters: 68 } as const;

/** The nullable ball record (all-null pre-match; z is meters above the pitch). */
export const SkillCornerBallData = z
  .object({
    x: z.number().nullable(),
    y: z.number().nullable(),
    z: z.number().nullable(),
    is_detected: z.boolean().nullable(),
  })
  .strict();
export type SkillCornerBallData = z.infer<typeof SkillCornerBallData>;

/** One player found at a frame (meters, center-origin; is_detected false = extrapolated). */
export const SkillCornerPlayerData = z
  .object({
    x: z.number().nullable(),
    y: z.number().nullable(),
    player_id: z.number().int(),
    is_detected: z.boolean().nullable(),
  })
  .strict();
export type SkillCornerPlayerData = z.infer<typeof SkillCornerPlayerData>;

/** The provider's possessor hypothesis (PROVIDER-SPECIFIC — never mapped to a product contract). */
export const SkillCornerPossession = z
  .object({
    player_id: z.number().int().nullable(),
    group: z.string().nullable(),
  })
  .strict();
export type SkillCornerPossession = z.infer<typeof SkillCornerPossession>;

/** The broadcast image polygon (PROVIDER-SPECIFIC — not mapped; pitch-space stream). */
export const SkillCornerImageCorners = z
  .object({
    x_top_left: z.number().nullable(),
    y_top_left: z.number().nullable(),
    x_bottom_left: z.number().nullable(),
    y_bottom_left: z.number().nullable(),
    x_bottom_right: z.number().nullable(),
    y_bottom_right: z.number().nullable(),
    x_top_right: z.number().nullable(),
    y_top_right: z.number().nullable(),
  })
  .strict();
export type SkillCornerImageCorners = z.infer<typeof SkillCornerImageCorners>;

/** One tracking frame — the schema of record (strict: unknown keys refused). */
export const SkillCornerTrackingFrame = z
  .object({
    frame: z.number().int().min(0),
    timestamp: z.string().nullable(),
    period: z.union([z.literal(1), z.literal(2)]).nullable(),
    ball_data: SkillCornerBallData,
    possession: SkillCornerPossession,
    image_corners_projection: SkillCornerImageCorners,
    player_data: z.array(SkillCornerPlayerData),
  })
  .strict();
export type SkillCornerTrackingFrame = z.infer<typeof SkillCornerTrackingFrame>;

/** A frame that failed the recorded schema (fail-loud, never partially parsed). */
export class SkillCornerFormatError extends Error {
  constructor(
    readonly line: number,
    issues: readonly string[],
  ) {
    super(
      `SkillCorner opendata frame at line ${line} failed the recorded schema: ${issues.join("; ")}`,
    );
    this.name = "SkillCornerFormatError";
  }
}

/** Parses one JSONL line into a {@link SkillCornerTrackingFrame} (fail-loud). */
export function parseSkillCornerFrame(line: number, text: string): SkillCornerTrackingFrame {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new SkillCornerFormatError(line, [`invalid JSON: ${(error as Error).message}`]);
  }
  const parsed = SkillCornerTrackingFrame.safeParse(document);
  if (!parsed.success) {
    throw new SkillCornerFormatError(
      line,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return parsed.data;
}

/** Parses the whole JSONL text (blank lines skipped; line numbers preserved). */
export function parseSkillCornerJsonl(text: string): SkillCornerTrackingFrame[] {
  const frames: SkillCornerTrackingFrame[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line.length === 0) continue;
    frames.push(parseSkillCornerFrame(index + 1, line));
  }
  return frames;
}

/**
 * Parses a provider timestamp `"HH:MM:SS.ss"` (or `"MM:SS.ss"`) into
 * milliseconds within the period. Returns `null` for null/empty values
 * (the pre-match posture) — never a fabricated time.
 */
export function parseSkillCornerTimestampMs(timestamp: string | null): number | null {
  if (timestamp === null || timestamp.trim().length === 0) return null;
  const parts = timestamp.trim().split(":");
  if (parts.length < 2 || parts.length > 3) {
    throw new SkillCornerFormatError(0, [`unparseable timestamp "${timestamp}"`]);
  }
  const secondsPart = parts[parts.length - 1]!;
  const seconds = Number(secondsPart);
  const minutes = Number(parts[parts.length - 2]!);
  const hours = parts.length === 3 ? Number(parts[0]!) : 0;
  if (![seconds, minutes, hours].every((value) => Number.isFinite(value))) {
    throw new SkillCornerFormatError(0, [`unparseable timestamp "${timestamp}"`]);
  }
  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
}
