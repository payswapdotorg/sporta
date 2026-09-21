"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveReplayRecordDoc, LiveWorldFrameDoc } from "@/lib/live-sse";

/**
 * THE LIVE REPLAY PRESENTATION LIB (L014, presentation side) — the pure
 * continuity derivations + the replay controller the Live surface uses to
 * REPLAY a completed live window's recorded session state through the SAME
 * views.
 *
 * THE ACCEPTANCE, AS CODE (live-reality.md §8 — "a live session must be able
 * to become a replay session without translating into a second canonical
 * model"):
 *
 * - the replayed frames are the RECORDED `LiveWorldFrameDoc`s VERBATIM —
 *   the same wire shape the live views consumed (no translation, no second
 *   view model, no re-stamping);
 * - {@link replayContinuityVerdict} derives the honest alignment verdict
 *   over the record itself (ordinals strictly ascending, world versions
 *   strictly advancing, event times + watermarks non-decreasing) — the
 *   "state versions/timecodes remain aligned" acceptance as an assertable
 *   derivation, never a blind claim;
 * - {@link replayContinuityFacts} projects the visible continuity facts
 *   (the version/timecode span, the final watermark, the honest accounting)
 *   the replay UI shows;
 * - the controller ({@link useLiveReplay}) drives the replay cursor over
 *   the recorded frames — user-scrubbed or paced at the RECORDED transport
 *   cadence (the same duration the live window took, honestly labeled).
 *
 * PURITY: the derivations are pure functions of the record (no clock, no
 * env, no I/O — the exact discipline of `live-tactical-view.ts`); only the
 * controller owns pacing state, and its cursor math is the pure
 * {@link nextReplayCursor}.
 */

/** The replay record as the client consumes it (the route's own doc). */
export type LiveReplayRecord = LiveReplayRecordDoc;

/** One alignment problem, as a human-readable honest line. */
export interface ReplayContinuityVerdict {
  /** Whether the recorded timeline is aligned (no problems found). */
  aligned: boolean;
  /** The specific problems (empty when aligned — never a bare boolean). */
  problems: string[];
}

/**
 * The continuity verdict over the RECORDED frames: ordinals strictly
 * ascending (the transport's own guarantee), world versions strictly
 * advancing (the view-model's monotone guarantee), event times and
 * watermark sequence/ms non-decreasing (the frozen temporal rules). Pure.
 */
export function replayContinuityVerdict(
  frames: readonly LiveWorldFrameDoc[],
): ReplayContinuityVerdict {
  const problems: string[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1]!;
    const frame = frames[index]!;
    if (frame.ordinal <= previous.ordinal) {
      problems.push(
        `frame ${index}: ordinal ${frame.ordinal} does not advance past ${previous.ordinal}`,
      );
    }
    if (frame.worldVersion <= previous.worldVersion) {
      problems.push(
        `frame ${index}: world version ${frame.worldVersion} does not advance past ${previous.worldVersion}`,
      );
    }
    if (frame.eventTimeMs < previous.eventTimeMs) {
      problems.push(
        `frame ${index}: event time ${frame.eventTimeMs}ms went backwards from ${previous.eventTimeMs}ms`,
      );
    }
    if (frame.watermark.sequence < previous.watermark.sequence) {
      problems.push(
        `frame ${index}: watermark sequence ${frame.watermark.sequence} went backwards from ${previous.watermark.sequence}`,
      );
    }
    if (frame.watermark.watermarkMs < previous.watermark.watermarkMs) {
      problems.push(
        `frame ${index}: watermark ms ${frame.watermark.watermarkMs} went backwards from ${previous.watermark.watermarkMs}`,
      );
    }
  }
  return { aligned: problems.length === 0, problems };
}

/** The visible continuity facts of one replay record (pure). */
export interface ReplayContinuityFacts {
  frameCount: number;
  ordinalFirst: number | null;
  ordinalLast: number | null;
  worldVersionFirst: number | null;
  worldVersionLast: number | null;
  eventTimeFirstMs: number | null;
  eventTimeLastMs: number | null;
  watermarkFinal: { watermarkMs: number; sequence: number } | null;
  cadenceMs: number | null;
  deliveredFrames: number | null;
  droppedFrames: number | null;
}

/** Projects the continuity facts the replay UI shows (pure). */
export function replayContinuityFacts(record: LiveReplayRecord): ReplayContinuityFacts {
  const frames = record.frames;
  const first = frames[0] ?? null;
  const last = frames[frames.length - 1] ?? null;
  return {
    frameCount: frames.length,
    ordinalFirst: first?.ordinal ?? null,
    ordinalLast: last?.ordinal ?? null,
    worldVersionFirst: record.meta?.worldVersionFirst ?? first?.worldVersion ?? null,
    worldVersionLast: record.meta?.worldVersionLast ?? last?.worldVersion ?? null,
    eventTimeFirstMs: record.meta?.eventTimeFirstMs ?? first?.eventTimeMs ?? null,
    eventTimeLastMs: record.meta?.eventTimeLastMs ?? last?.eventTimeMs ?? null,
    watermarkFinal: record.meta?.watermarkFinal ?? last?.watermark ?? null,
    cadenceMs: record.meta?.cadenceMs ?? null,
    deliveredFrames: record.meta?.deliveredFrames ?? null,
    droppedFrames: record.meta?.droppedFrames ?? null,
  };
}

/**
 * The pure replay-cursor transition: one step of `delta` (clamped to the
 * recorded frames; negative steps walk backwards — a replay is
 * user-controlled). Pure, so the stepping logic is exactly assertable.
 */
export function nextReplayCursor(cursor: number, frameCount: number, delta: number): number {
  if (frameCount <= 0) return 0;
  if (!Number.isInteger(cursor) || cursor < 0) return 0;
  return Math.min(frameCount - 1, Math.max(0, cursor + delta));
}

/** The replay controller's state + actions (drives the SAME views). */
export interface LiveReplayController {
  /** The record being replayed (always `complete`). */
  record: LiveReplayRecord;
  /** The 0-based cursor into `record.frames`. */
  cursor: number;
  /** The RECORDED frame at the cursor (null only for an empty record). */
  frame: LiveWorldFrameDoc | null;
  /** Whether the replay is auto-advancing at the recorded cadence. */
  playing: boolean;
  /** Starts the paced playback (from the end, it restarts from the start). */
  play(): void;
  /** Pauses the paced playback (the cursor stays — scrubbing stays free). */
  pause(): void;
  /** Steps the cursor (negative walks backwards). */
  step(delta: number): void;
  /** Seeks the cursor to an exact 0-based frame index (clamped). */
  seek(index: number): void;
}

/**
 * The replay controller: the cursor over the recorded frames, paced at the
 * RECORDED transport cadence (the live window's own duration — honestly
 * labeled in the UI, distinct from the event-time timeline the frames
 * carry). The frame it hands out is the RECORDED frame verbatim — the views
 * render it through the SAME projections they used live.
 */
export function useLiveReplay(record: LiveReplayRecord | null): LiveReplayController | null {
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const recordRef = useRef<LiveReplayRecord | null>(record);
  // A NEW record (a fresh live window completed) resets the cursor.
  if (record !== null && recordRef.current !== null && recordRef.current !== record) {
    recordRef.current = record;
    setCursor(0);
    setPlaying(false);
  } else if (record !== null && recordRef.current === null) {
    recordRef.current = record;
  } else if (record === null && recordRef.current !== null) {
    recordRef.current = null;
    setPlaying(false);
  }

  const frameCount = record?.frames.length ?? 0;
  const cadenceMs = record?.meta?.cadenceMs ?? 500;

  useEffect(() => {
    if (!playing || record === null) return;
    const timer = setInterval(
      () => {
        setCursor((current) => {
          if (current + 1 >= record.frames.length) {
            setPlaying(false); // the honest end: stop at the last recorded frame
            return current;
          }
          return current + 1;
        });
      },
      Math.max(100, cadenceMs),
    );
    return () => clearInterval(timer);
  }, [playing, record, cadenceMs]);

  const step = useCallback(
    (delta: number) => {
      setCursor((current) => nextReplayCursor(current, frameCount, delta));
    },
    [frameCount],
  );
  const seek = useCallback(
    (index: number) => {
      setCursor(nextReplayCursor(index, frameCount, 0));
    },
    [frameCount],
  );
  const play = useCallback(() => {
    setCursor((current) => (current + 1 >= frameCount ? 0 : current)); // from the end → restart
    setPlaying(true);
  }, [frameCount]);
  const pause = useCallback(() => setPlaying(false), []);

  const frame = useMemo(() => {
    if (record === null) return null;
    return record.frames[cursor] ?? record.frames[record.frames.length - 1] ?? null;
  }, [record, cursor]);

  if (record === null) return null;
  return { record, cursor, frame, playing, play, pause, step, seek };
}
