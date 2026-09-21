/**
 * THE RECORDED AUTHORIZED-API RESPONSE SCHEMA (L009) — what the provider's
 * `GET /api/match/{match_id}/tracking` answers, as RECORDED from the
 * provider's own artifacts (fetched 2026-09-21; full citations in
 * ../profile.ts):
 *
 * - THE PAGINATION ENVELOPE: Django REST Framework list shape
 *   `{count, next, previous, results}` — recorded from the provider's
 *   Python SDK `pagination.py` (the SDK walks `response['next']` links);
 * - THE FRAME CORE: the provider's published tracking frame format (the
 *   opendata schema of record — `@sporta/live-open-data` `skillcorner/format`,
 *   recorded from the provider repository 2026-09-21): `frame`, `timestamp`
 *   `"HH:MM:SS.ss"`, `period` 1|2, `ball_data {x,y,z,is_detected}`,
 *   `player_data [{x,y,player_id,is_detected}]` — meters, center-origin
 *   pitch frame.
 *
 * THE AUTHORIZED-SHAPE DOCTRINE (this is a LIVE endpoint we cannot sample
 * without credentials — the honest posture):
 * - KNOWN-CONSUMED fields (the five above) validate STRICTLY — a mismatch
 *   refuses loudly (`skillcorner-authorized.frame-schema-mismatch`), never
 *   a guessed mapping;
 * - KNOWN-UNMAPPED recorded fields (`possession`, `image_corners_projection`)
 *   are counted per page (`knownUnmappedFieldRows`) — visible provider-field
 *   isolation, never silently dropped, never forwarded;
 * - UNKNOWN fields (absent from the recorded format) are collected by NAME
 *   (`unknownFieldKinds`) — the activation-time verification hook: the
 *   operator sees exactly what the live feed carries beyond the record, and
 *   the record is then extended deliberately.
 *
 * PURITY: schema + pure parsing — no clock, no env, no I/O.
 */
import { z } from "zod";

/** The provider's nominal frame rate (the recorded format: 10 fps). */
export const SKILLCORNER_AUTHORIZED_FRAME_RATE_HZ = 10;

/** The provider's frame interval in ms. */
export const SKILLCORNER_AUTHORIZED_FRAME_INTERVAL_MS = 100;

/** The default pitch (the recorded format: 105m x 68m). */
export const SKILLCORNER_AUTHORIZED_DEFAULT_PITCH = {
  lengthMeters: 105,
  widthMeters: 68,
} as const;

/** The frame fields this adapter CONSUMES (strict — the recorded core). */
export const SKILLCORNER_AUTHORIZED_CONSUMED_FIELDS = [
  "frame",
  "timestamp",
  "period",
  "ball_data",
  "player_data",
] as const;

/** Recorded provider fields the adapter deliberately does NOT map. */
export const SKILLCORNER_AUTHORIZED_UNMAPPED_FIELDS = [
  "possession",
  "image_corners_projection",
] as const;

/** The nullable ball record (z meters above the pitch plane). */
export const SkillCornerAuthorizedBallData = z
  .object({
    x: z.number().nullable(),
    y: z.number().nullable(),
    z: z.number().nullable(),
    is_detected: z.boolean().nullable(),
  })
  .strict();
export type SkillCornerAuthorizedBallData = z.infer<typeof SkillCornerAuthorizedBallData>;

/** One player row (meters, center-origin frame; nullable pre-match). */
export const SkillCornerAuthorizedPlayerData = z
  .object({
    x: z.number().nullable(),
    y: z.number().nullable(),
    player_id: z.number(),
    is_detected: z.boolean().nullable(),
  })
  .strict();
export type SkillCornerAuthorizedPlayerData = z.infer<typeof SkillCornerAuthorizedPlayerData>;

/** The strict KNOWN-CONSUMED projection of one tracking frame. */
export const SkillCornerAuthorizedFrameCore = z
  .object({
    frame: z.number().int().min(0),
    timestamp: z.string().nullable(),
    period: z.union([z.literal(1), z.literal(2)]).nullable(),
    ball_data: SkillCornerAuthorizedBallData,
    player_data: z.array(SkillCornerAuthorizedPlayerData),
  })
  .strict();
export type SkillCornerAuthorizedFrameCore = z.infer<typeof SkillCornerAuthorizedFrameCore>;

/** The DRF list envelope (recorded from the provider SDK's pagination). */
export const SkillCornerAuthorizedPage = z
  .object({
    count: z.number().int().min(0),
    next: z.string().nullable(),
    previous: z.string().nullable(),
    results: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();
export type SkillCornerAuthorizedPage = z.infer<typeof SkillCornerAuthorizedPage>;

/** The typed refusal when a payload fails the recorded schema. */
export class SkillCornerAuthorizedFormatError extends Error {
  readonly failureClass = "skillcorner-authorized.page-schema-mismatch" as const;
  constructor(message: string) {
    super(message);
    this.name = "SkillCornerAuthorizedFormatError";
  }
}

/** What one frame's field accounting found (the honest isolation surface). */
export interface FrameFieldAccounting {
  /** Frames whose KNOWN-CONSUMED projection validated. */
  parsedFrames: number;
  /** Frames that failed the strict core (refused — never partially kept). */
  refusedFrames: number;
  /** Rows seen in recorded-but-unmapped provider fields (counted, dropped). */
  knownUnmappedFieldRows: number;
  /** Field NAMES absent from the recorded format (counted, dropped, named). */
  unknownFieldKinds: string[];
}

/**
 * Parses `"HH:MM:SS.ss"` into ms within the period (null when unparseable —
 * the recorded format's pre-match null timestamps). Mirrors the provider's
 * published clock format exactly.
 */
export function parseSkillCornerAuthorizedTimestampMs(timestamp: string | null): number | null {
  if (timestamp === null) return null;
  const match = /^(\d{2}):(\d{2}):(\d{2}(?:\.\d{1,3})?)$/.exec(timestamp);
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds >= 60) return null;
  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
}

/**
 * Validates ONE raw frame's KNOWN-CONSUMED projection against the recorded
 * core and accounts every other field honestly. NEVER mutates the input and
 * never retains unknown values — only their NAMES.
 */
export function parseSkillCornerAuthorizedFrame(
  raw: Record<string, unknown>,
): { frame: SkillCornerAuthorizedFrameCore } | { refused: string } {
  const consumed: Record<string, unknown> = {};
  for (const key of SKILLCORNER_AUTHORIZED_CONSUMED_FIELDS) {
    consumed[key] = raw[key];
  }
  const parsed = SkillCornerAuthorizedFrameCore.safeParse(consumed);
  if (!parsed.success) {
    return {
      refused: parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    };
  }
  return { frame: parsed.data };
}

/**
 * Accounts one page's frame fields (the isolation surface): parses every
 * result row's consumed projection, counts unmapped/unknown fields, and
 * returns the valid cores in order. A page whose envelope fails the
 * recorded DRF shape refuses LOUD (never a partial page).
 */
export function parseSkillCornerAuthorizedPage(payload: unknown): {
  page: SkillCornerAuthorizedPage;
  frames: SkillCornerAuthorizedFrameCore[];
} & FrameFieldAccounting {
  const parsedPage = SkillCornerAuthorizedPage.safeParse(payload);
  if (!parsedPage.success) {
    throw new SkillCornerAuthorizedFormatError(
      `the authorized tracking payload failed the recorded DRF envelope: ${parsedPage.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const page = parsedPage.data;
  const accounting: FrameFieldAccounting = {
    parsedFrames: 0,
    refusedFrames: 0,
    knownUnmappedFieldRows: 0,
    unknownFieldKinds: [],
  };
  const unknownNames = new Set<string>();
  const consumedSet = new Set<string>(SKILLCORNER_AUTHORIZED_CONSUMED_FIELDS);
  const unmappedSet = new Set<string>(SKILLCORNER_AUTHORIZED_UNMAPPED_FIELDS);
  const frames: SkillCornerAuthorizedFrameCore[] = [];
  for (const row of page.results) {
    for (const key of Object.keys(row)) {
      if (consumedSet.has(key)) continue;
      if (unmappedSet.has(key)) {
        accounting.knownUnmappedFieldRows += 1;
        continue;
      }
      unknownNames.add(key);
    }
    const parsed = parseSkillCornerAuthorizedFrame(row);
    if ("refused" in parsed) {
      accounting.refusedFrames += 1;
      continue;
    }
    accounting.parsedFrames += 1;
    frames.push(parsed.frame);
  }
  accounting.unknownFieldKinds = [...unknownNames].sort();
  return { page, frames, ...accounting };
}
