/**
 * THE SKILLCORNER OPENDATA REPLAY ADAPTER (L007) — replays the MIT-licensed
 * open broadcast-tracking dataset through the EXACT live path:
 *
 * ```text
 * SkillCorner JSONL → SkillCornerOpenDataReplay (LiveObservation batches)
 *   → TemporalBufferEngine (L004) → LiveSwmUpdater (L003) → WorldModelEngine
 * ```
 *
 * THE PROVIDER-FIELD ISOLATION RULE (the L007 acceptance): every
 * provider-specific field normalizes HERE — `player_id` → the session-scoped
 * `entityRef`, center-origin meters → the Sporta canonical corner-origin
 * pitch frame, `is_detected` → the frozen `detected` honesty flag — and the
 * provider's `possession` hypothesis and `image_corners_projection` are
 * consumed for adapter ACCOUNTING ONLY, never mapped into a product contract
 * (the SWM derives possession from canonical evidence; the frozen
 * LiveObservation is strict, so any leak would refuse loudly).
 *
 * HONEST NORMALIZATIONS (each documented, none fabricated):
 *
 * - COORDINATES: the provider's center-origin meters (`x ∈ [-52.5, 52.5]`
 *   along the long side, `y ∈ [-34, 34]` along the short side on the 105×68
 *   default) translate to the Sporta canonical corner-origin frame by
 *   `+ (length/2, width/2)`. The pitch size is configurable (the provider's
 *   per-match `{id}_match.json` carries it; the recorded default is 105×68);
 * - CONFIDENCE: the format carries NO confidence — the adapter supplies the
 *   documented PRIOR by detectedness (detected 0.85 / extrapolated carry
 *   0.25 — the same honest bands the synthetic source uses), recorded as a
 *   prior in the TechnologyProfile, never presented as a measured value;
 * - VELOCITY: the format carries none — never invented (omitted);
 * - TIMELINE: period-1 frames map to their parsed timestamp; period-2 frames
 *   continue the session timeline at the data-derived offset (the last
 *   period-1 frame's time + one 10 fps frame interval — two-pass replay,
 *   deterministic);
 * - SEQUENCE: `frame + 1` (1-based like the frozen contract; gaps stay
 *   visible);
 * - EMISSION WATERMARK: each batch carries the conservative contiguous
 *   frontier at its own emission (the batch's event time, like the
 *   synthetic source's normal scenario) — the L004 engine owns the windowing;
 * - EMPTY FRAMES: the all-null pre-match frames (no players, no ball) yield
 *   no batch — counted (`emptyFramesSkipped`), never an empty observation
 *   (the frozen contract requires at least one entity row);
 * - DETECTED: `is_detected === true` is the ONLY detected-true evidence
 *   (null/false → the honest carry `detected: false`);
 * - MID-STREAM SLICES: replaying a byte-range slice of a match keeps the
 *   provider's frame numbers as sequences — the undelivered prefix is a
 *   VISIBLE accounted hole in the L004 engine (never renumbered; the stats
 *   surface records the slice boundary for operators).
 */
import { batchConfidenceOf } from "@sporta/live-source";
import type { LiveEntityObservation, LiveObservation } from "@sporta/live-source";
import {
  SKILLCORNER_DEFAULT_PITCH,
  SKILLCORNER_FRAME_INTERVAL_MS,
  parseSkillCornerJsonl,
  parseSkillCornerTimestampMs,
  type SkillCornerTrackingFrame,
} from "./format";

/** The adapter's identity (carried on every batch's sourceId — honest naming). */
export const SKILLCORNER_ADAPTER_ID = "live-open-data.skillcorner-replay";
export const SKILLCORNER_ADAPTER_VERSION = "0.1.0";
export const SKILLCORNER_DEFAULT_SOURCE_ID = "skillcorner-open-data";

/** The documented confidence priors (the format carries no confidence). */
export const SKILLCORNER_CONFIDENCE_PRIORS = {
  detected: 0.85,
  carried: 0.25,
} as const;

/** Configuration for {@link createSkillCornerOpenDataReplay}. */
export interface SkillCornerOpenDataReplayConfig {
  /** The session the replay feeds (rides every batch). */
  sessionId: string;
  /** The tracking JSONL text (the recorded schema — see ./format). */
  jsonl: string;
  /** The source identity (default `skillcorner-open-data`). */
  sourceId?: string;
  /** The replay ingest offset (ms) every batch carries (default 120). */
  baseLatencyMs?: number;
  /** The pitch length in meters (default 105 — the recorded default). */
  pitchLengthMeters?: number;
  /** The pitch width in meters (default 68). */
  pitchWidthMeters?: number;
}

/** The honest accounting surface (never a silent anything). */
export interface SkillCornerReplayStats {
  /** Frames parsed from the JSONL. */
  framesParsed: number;
  /** The first and last provider frame numbers in the replayed slice. */
  slice: { firstFrame: number | null; lastFrame: number | null };
  /** Frames that yielded a LiveObservation batch. */
  batchesEmitted: number;
  /** All-null/empty frames skipped (no entity rows to observe). */
  emptyFramesSkipped: number;
  /** Frames whose timestamp was null but carried rows (event time from the frame clock). */
  nullTimestampFrames: number;
  /** Player rows emitted (detected + carried). */
  playerRowsEmitted: number;
  /** Ball rows emitted. */
  ballRowsEmitted: number;
  /** Carried rows (`is_detected` not true — the honest extrapolation count). */
  carriedRowsEmitted: number;
  /** Frames whose provider possession hypothesis was present (accounting only). */
  framesWithProviderPossession: number;
  /** The period boundaries (data-derived): period 1 end ms, period 2 offset ms. */
  periodTimeline: { period1EndMs: number | null; period2OffsetMs: number | null };
  /** Whether the replay is exhausted. */
  exhausted: boolean;
}

/**
 * The SkillCorner opendata replay source. Created through
 * {@link createSkillCornerOpenDataReplay}; pull-based and deterministic (the
 * whole JSONL is parsed up-front — a replay, not a stream; same input →
 * byte-identical batches).
 */
export class SkillCornerOpenDataReplay {
  readonly sourceId: string;
  private readonly sessionId: string;
  private readonly frames: readonly SkillCornerTrackingFrame[];
  private readonly baseLatencyMs: number;
  private readonly originX: number;
  private readonly originY: number;
  private readonly period2OffsetMs: number | null;
  private readonly period1EndMs: number | null;
  private readonly providerPossessionFrames: number;
  private readonly nullTimestampFrameCount: number;
  private nextFrameIndex = 0;
  private batchesEmitted = 0;
  private emptyFramesSkipped = 0;
  private playerRows = 0;
  private ballRows = 0;
  private carriedRows = 0;

  constructor(config: SkillCornerOpenDataReplayConfig) {
    if (typeof config.sessionId !== "string" || config.sessionId.length === 0) {
      throw new RangeError("SkillCornerOpenDataReplay: sessionId must be a non-empty string");
    }
    if (typeof config.jsonl !== "string" || config.jsonl.trim().length === 0) {
      throw new RangeError("SkillCornerOpenDataReplay: jsonl must be a non-empty string");
    }
    this.sessionId = config.sessionId;
    this.sourceId = config.sourceId ?? SKILLCORNER_DEFAULT_SOURCE_ID;
    this.baseLatencyMs = config.baseLatencyMs ?? 120;
    const length = config.pitchLengthMeters ?? SKILLCORNER_DEFAULT_PITCH.lengthMeters;
    const width = config.pitchWidthMeters ?? SKILLCORNER_DEFAULT_PITCH.widthMeters;
    if (!(length > 0) || !(width > 0)) {
      throw new RangeError("SkillCornerOpenDataReplay: pitch dimensions must be > 0");
    }
    this.originX = length / 2;
    this.originY = width / 2;
    // Two-pass replay: pass 1 derives the period timeline (the session
    // timeline continuation for period 2), pass 2 emits.
    this.frames = parseSkillCornerJsonl(config.jsonl);
    let period1EndMs: number | null = null;
    this.providerPossessionFrames = this.frames.filter(
      (frame) => frame.possession.player_id !== null || frame.possession.group !== null,
    ).length;
    this.nullTimestampFrameCount = this.frames.filter(
      (frame) => parseSkillCornerTimestampMs(frame.timestamp) === null,
    ).length;
    for (const frame of this.frames) {
      if (frame.period !== 1) continue;
      const time = parseSkillCornerTimestampMs(frame.timestamp);
      if (time !== null && time > (period1EndMs ?? -1)) period1EndMs = time;
    }
    this.period1EndMs = period1EndMs;
    this.period2OffsetMs =
      period1EndMs !== null ? period1EndMs + SKILLCORNER_FRAME_INTERVAL_MS : null;
  }

  /** The replay's honest accounting (live — reflects every emission so far). */
  stats(): SkillCornerReplayStats {
    return {
      framesParsed: this.frames.length,
      slice: {
        firstFrame: this.frames.length > 0 ? this.frames[0]!.frame : null,
        lastFrame: this.frames.length > 0 ? this.frames[this.frames.length - 1]!.frame : null,
      },
      batchesEmitted: this.batchesEmitted,
      emptyFramesSkipped: this.emptyFramesSkipped,
      nullTimestampFrames: this.nullTimestampFrameCount,
      playerRowsEmitted: this.playerRows,
      ballRowsEmitted: this.ballRows,
      carriedRowsEmitted: this.carriedRows,
      framesWithProviderPossession: this.providerPossessionFrames,
      periodTimeline: {
        period1EndMs: this.period1EndMs,
        period2OffsetMs: this.period2OffsetMs,
      },
      exhausted: this.nextFrameIndex >= this.frames.length,
    };
  }

  /** The next planned arrival's ingest time (the bridge's pacing primitive). */
  plannedIngestTimeMs(): number | null {
    for (let index = this.nextFrameIndex; index < this.frames.length; index += 1) {
      const eventTimeMs = this.eventTimeOf(this.frames[index]!);
      if (eventTimeMs !== null) return eventTimeMs + this.baseLatencyMs;
    }
    return null;
  }

  /**
   * The next observation batch in frame order, or `null` when the replay is
   * exhausted. Every returned document parses against the frozen
   * LiveObservation contract (strict — provider fields cannot leak).
   */
  next(): LiveObservation | null {
    while (this.nextFrameIndex < this.frames.length) {
      const frame = this.frames[this.nextFrameIndex]!;
      this.nextFrameIndex += 1;
      const batch = this.batchOf(frame);
      if (batch === null) {
        this.emptyFramesSkipped += 1;
        continue; // the honest empty-frame skip (counted, never a fake batch)
      }
      this.batchesEmitted += 1;
      this.playerRows += batch.entityObservations.filter((row) => row.kind === "PLAYER").length;
      this.ballRows += batch.entityObservations.filter((row) => row.kind === "BALL").length;
      this.carriedRows += batch.entityObservations.filter((row) => !row.detected).length;
      return batch;
    }
    return null;
  }

  /** The session-timeline event time of one frame (null when unresolvable). */
  private eventTimeOf(frame: SkillCornerTrackingFrame): number | null {
    const withinPeriodMs = parseSkillCornerTimestampMs(frame.timestamp);
    if (withinPeriodMs === null) return null;
    if (frame.period === 2) {
      return (this.period2OffsetMs ?? 0) + withinPeriodMs;
    }
    return withinPeriodMs;
  }

  /** Builds one batch from a frame (null when the frame yields no rows). */
  private batchOf(frame: SkillCornerTrackingFrame): LiveObservation | null {
    const eventTimeMs = this.eventTimeOf(frame) ?? frame.frame * SKILLCORNER_FRAME_INTERVAL_MS; // null-timestamp frames: the frame clock
    const rows: LiveEntityObservation[] = [];
    for (const player of frame.player_data) {
      if (player.x === null || player.y === null) continue; // unpositioned — not observed
      const detected = player.is_detected === true;
      rows.push({
        entityRef: `sc-p-${player.player_id}`,
        kind: "PLAYER",
        position: { xMeters: player.x + this.originX, yMeters: player.y + this.originY },
        detected,
        sourceLocalTrackId: String(player.player_id),
        confidence: detected
          ? SKILLCORNER_CONFIDENCE_PRIORS.detected
          : SKILLCORNER_CONFIDENCE_PRIORS.carried,
        observedAtMs: eventTimeMs,
      });
    }
    const ball = frame.ball_data;
    if (ball.x !== null && ball.y !== null) {
      const detected = ball.is_detected === true;
      rows.push({
        entityRef: "sc-ball",
        kind: "BALL",
        position: {
          xMeters: ball.x + this.originX,
          yMeters: ball.y + this.originY,
          ...(ball.z !== null && ball.z > 0 ? { zMeters: ball.z } : {}),
        },
        detected,
        sourceLocalTrackId: "ball",
        confidence: detected
          ? SKILLCORNER_CONFIDENCE_PRIORS.detected
          : SKILLCORNER_CONFIDENCE_PRIORS.carried,
        observedAtMs: eventTimeMs,
      });
    }
    if (rows.length === 0) return null;
    return {
      schemaVersion: "sporta.live-observation/1",
      sessionId: this.sessionId,
      sourceId: this.sourceId,
      sourceType: "TRACKING",
      sequence: frame.frame + 1,
      eventTimeMs,
      ingestTimeMs: eventTimeMs + this.baseLatencyMs,
      watermark: { watermarkMs: eventTimeMs, sequence: frame.frame + 1 },
      entityObservations: rows,
      confidence: batchConfidenceOf(rows),
      provenance: "DERIVED",
      quality: "nominal",
    };
  }
}

/** Creates the SkillCorner opendata replay source (L007). */
export function createSkillCornerOpenDataReplay(
  config: SkillCornerOpenDataReplayConfig,
): SkillCornerOpenDataReplay {
  return new SkillCornerOpenDataReplay(config);
}
