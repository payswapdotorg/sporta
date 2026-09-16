/**
 * THE FRAME-DISPLAY MODEL (W905) — how the watch page plays a REAL stored
 * output, honestly.
 *
 * Render outputs this wave are self-contained animated-SVG review artifacts:
 * ONE document whose frame groups (`<g data-frame-index="…" display="none">`)
 * carry the real frames, plus a deterministic container manifest that records
 * each frame's REAL document-timeline window (`beginMs`/`durMs`) and the
 * complete source manifest (per-frame match-timeline windows, captions,
 * entity dispositions, applied event sequences).
 *
 * This module turns those REAL manifest numbers into the player's display
 * model — nothing is invented and nothing is interpolated:
 *
 * - the player clock IS the manifest's document timeline (0…totalDurationMs);
 * - the displayed frame is ALWAYS one of the artifact's real frames — the
 *   frame whose window contains the playhead;
 * - seeking SNAPS to the nearest real frame (frames are discrete — the
 *   player never interpolates a frame that does not exist);
 * - playback advances at the manifest's real timing (optionally scaled by
 *   an explicit, labeled display rate — a display cadence control, never a
 *   claim about the artifact);
 * - event markers come from the session's real SWM event tail and are
 *   placed at the frame the render ACTUALLY applied each event to
 *   (`appliedEventSequences` — the render's own provenance record).
 */

import type { WatchEventTailLike } from "./api-types";

/** One real frame window on the artifact's document timeline. */
export interface FrameWindow {
  frameIndex: number;
  /** Window start on the document timeline (ms from segment start). */
  beginMs: number;
  /** Window end (exclusive) on the document timeline. */
  endMs: number;
}

/** The player's model: the real frame windows + the real total duration. */
export interface FramePlayerModel {
  windows: readonly FrameWindow[];
  totalDurationMs: number;
}

/** One entry of the session's real SWM event tail (world-model events). */
export type EventTailEntry = WatchEventTailLike;

/** The player's state (playhead + transport). */
export interface FramePlayerState {
  /** Playhead on the document timeline (always a real frame boundary after a seek). */
  playheadMs: number;
  /** Whether the display is advancing. */
  playing: boolean;
  /** The explicit display-rate multiplier (1 = the manifest's real timing). */
  rate: number;
  /** Whether playback has reached the artifact's real end. */
  ended: boolean;
}

/** The supported display rates (the frame-rate profile's real choices). */
export const DISPLAY_RATES: readonly number[] = [0.5, 1, 2];

/**
 * Builds the player model from a REAL stored-output container manifest.
 * The manifest's frame windows are used VERBATIM (sorted by begin; the
 * encoder guarantees contiguity, but sorting keeps the model total).
 */
export function framePlayerModel(manifest: {
  totalDurationMs: number;
  frames: readonly { frameIndex: number; beginMs: number; durMs: number }[];
}): FramePlayerModel {
  const windows = [...manifest.frames]
    .map((frame) => ({
      frameIndex: frame.frameIndex,
      beginMs: frame.beginMs,
      endMs: frame.beginMs + frame.durMs,
    }))
    .sort((a, b) => a.beginMs - b.beginMs);
  const totalDurationMs =
    windows.length > 0
      ? Math.max(manifest.totalDurationMs, windows[windows.length - 1]!.endMs)
      : manifest.totalDurationMs;
  return { windows, totalDurationMs };
}

/** The initial player state: paused on the first real frame, real timing. */
export function initialFramePlayer(model: FramePlayerModel): FramePlayerState {
  const first = model.windows[0];
  return {
    playheadMs: first === undefined ? 0 : first.beginMs,
    playing: false,
    rate: 1,
    ended: model.windows.length === 0,
  };
}

/** Clamps a document-timeline position to the artifact's real bounds. */
function clampMs(model: FramePlayerModel, ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  if (ms < 0) return 0;
  if (ms > model.totalDurationMs) return model.totalDurationMs;
  return ms;
}

/**
 * The frame whose real window contains `ms` (clamped to the first/last frame
 * outside the artifact's bounds). With no frames, `-1`.
 */
export function frameIndexAtMs(model: FramePlayerModel, ms: number): number {
  if (model.windows.length === 0) return -1;
  const position = clampMs(model, ms);
  // Positions at/after the total clamp to the LAST frame's window.
  if (position >= model.totalDurationMs) return model.windows[model.windows.length - 1]!.frameIndex;
  for (const window of model.windows) {
    if (position >= window.beginMs && position < window.endMs) return window.frameIndex;
  }
  // Contiguity is the encoder's contract; a gap would be a real defect —
  // fall back to the last window that starts at/before the position.
  let candidate = model.windows[0]!;
  for (const window of model.windows) {
    if (window.beginMs <= position) candidate = window;
    else break;
  }
  return candidate.frameIndex;
}

/**
 * SNAPS a document-timeline position to the nearest REAL frame boundary
 * (frames are discrete: the result is always an existing frame's `beginMs`,
 * never an interpolated position between frames). Ties resolve to the
 * earlier frame (deterministic).
 */
export function snapToNearestFrame(
  model: FramePlayerModel,
  ms: number,
): { frameIndex: number; playheadMs: number } {
  if (model.windows.length === 0) return { frameIndex: -1, playheadMs: 0 };
  const position = clampMs(model, ms);
  let best = model.windows[0]!;
  let bestDistance = Math.abs(position - best.beginMs);
  for (const window of model.windows.slice(1)) {
    const distance = Math.abs(position - window.beginMs);
    if (distance < bestDistance) {
      best = window;
      bestDistance = distance;
    }
  }
  return { frameIndex: best.frameIndex, playheadMs: best.beginMs };
}

/** Transport: play (restarts from the first frame when ended). */
export function playFramePlayer(
  state: FramePlayerState,
  model: FramePlayerModel,
): FramePlayerState {
  if (state.playing && !state.ended) return state;
  if (state.ended) {
    const first = model.windows[0];
    return {
      playheadMs: first === undefined ? 0 : first.beginMs,
      playing: model.windows.length > 0,
      rate: state.rate,
      ended: false,
    };
  }
  return { ...state, playing: model.windows.length > 0 };
}

/** Transport: pause (the playhead stays on its real frame). */
export function pauseFramePlayer(state: FramePlayerState): FramePlayerState {
  if (!state.playing) return state;
  return { ...state, playing: false };
}

/**
 * Transport: advance by `deltaMs` of REAL time. The playhead moves by
 * `deltaMs * rate` on the manifest's document timeline — the manifest's
 * timing is the truth; the rate is an explicitly labeled display cadence.
 * Reaching the artifact's real end ends playback (paused, `ended`).
 */
export function advanceFramePlayer(
  state: FramePlayerState,
  model: FramePlayerModel,
  deltaMs: number,
): FramePlayerState {
  if (!state.playing || state.ended || model.windows.length === 0 || deltaMs <= 0) {
    return state;
  }
  const next = state.playheadMs + deltaMs * state.rate;
  if (next >= model.totalDurationMs) {
    return {
      playheadMs: model.totalDurationMs,
      playing: false,
      rate: state.rate,
      ended: true,
    };
  }
  return { ...state, playheadMs: next };
}

/**
 * Transport: seek to a document-timeline position — SNAPPED to the nearest
 * real frame boundary (honest seek: no frame is invented between frames).
 * Seeking does not change the playing/ended transport flags (a real player
 * keeps playing across a seek; `ended` clears because a position before the
 * end is now showing).
 */
export function seekFramePlayer(
  state: FramePlayerState,
  model: FramePlayerModel,
  ms: number,
): FramePlayerState {
  if (model.windows.length === 0) return state;
  const snap = snapToNearestFrame(model, ms);
  return { ...state, playheadMs: snap.playheadMs, ended: false };
}

/**
 * Selects the display rate (the frame-rate profile). Only the supported
 * rates are accepted; anything else is a no-op (fail-closed to the current
 * rate — the player never invents a cadence).
 */
export function setDisplayRate(state: FramePlayerState, rate: number): FramePlayerState {
  if (!Number.isFinite(rate) || !(DISPLAY_RATES as readonly number[]).includes(rate)) return state;
  if (state.rate === rate) return state;
  return { ...state, rate };
}

// ---------------------------------------------------------------------------
// Event markers (the session's real SWM event tail → the artifact's frames)
// ---------------------------------------------------------------------------

/** One placed event marker: the REAL event + where the render applied it. */
export interface EventMarker {
  sequence: number;
  eventId: string;
  eventTimeMs: number;
  eventTypeRef: string;
  confidence?: number;
  /** The frame the render applied this event to (`null` when none did). */
  frameIndex: number | null;
  /** Marker position on the document timeline (the applied frame's begin). */
  markerMs: number | null;
  /** Honest reason when the event is not placed on this artifact. */
  reason: string | null;
}

/**
 * Places the session's real SWM events onto the artifact's timeline — each
 * marker at the REAL frame the render's own provenance says applied that
 * event (`appliedEventSequences`). Events no frame applied are listed with
 * the honest reason (outside the render's output window, per the render's
 * `skippedEvents` record, or simply not applied) — never dropped silently.
 */
export function placeEventMarkers(
  model: FramePlayerModel,
  eventTail: readonly EventTailEntry[],
  sourceManifest: {
    frames: readonly {
      frameIndex: number;
      appliedEventSequences: readonly number[];
    }[];
    skippedEvents: readonly { sequence: number; reason: string }[];
  },
): EventMarker[] {
  const frameByIndex = new Map(model.windows.map((window) => [window.frameIndex, window]));
  return eventTail.map((event) => {
    const appliedFrame = sourceManifest.frames.find((frame) =>
      frame.appliedEventSequences.includes(event.sequence),
    );
    const base = {
      sequence: event.sequence,
      eventId: event.eventId,
      eventTimeMs: event.eventTimeMs,
      eventTypeRef: event.eventTypeRef,
      confidence: event.confidence,
    };
    if (appliedFrame === undefined) {
      const skipped = sourceManifest.skippedEvents.find(
        (entry) => entry.sequence === event.sequence,
      );
      return {
        ...base,
        frameIndex: null,
        markerMs: null,
        reason:
          skipped !== undefined
            ? `outside this render's output window (${skipped.reason})`
            : "not applied to any frame of this render",
      };
    }
    const window = frameByIndex.get(appliedFrame.frameIndex);
    if (window === undefined) {
      return {
        ...base,
        frameIndex: null,
        markerMs: null,
        reason: "the render manifest references a frame this artifact does not contain",
      };
    }
    return { ...base, frameIndex: appliedFrame.frameIndex, markerMs: window.beginMs, reason: null };
  });
}

// ---------------------------------------------------------------------------
// The frame-rate profile (the renderer-scoped display control)
// ---------------------------------------------------------------------------

/** The renderer-scoped frame-rate profile for one artifact. */
export interface FrameRateProfile {
  /** Whether the control applies (the artifact must carry real frame windows). */
  supported: boolean;
  /** The honest reason when the control does not apply. */
  reason: string;
  /** The artifact's real base frame interval (the median real window). */
  baseFrameMs: number | null;
  /** The supported display-rate multipliers. */
  rates: readonly number[];
}

/**
 * Derives the frame-rate profile from the REAL frame windows: the base
 * cadence is the median real frame window (a real number the manifest
 * carries), and the choices are explicit display-rate multipliers over it.
 * Artifacts without frame windows get an honest "not applicable" — the
 * control is never shown for a renderer that cannot honor it.
 */
export function deriveFrameRateProfile(model: FramePlayerModel): FrameRateProfile {
  if (model.windows.length === 0) {
    return {
      supported: false,
      reason: "this renderer's output carries no frame manifest to pace",
      baseFrameMs: null,
      rates: [],
    };
  }
  const durations = [...model.windows]
    .map((window) => window.endMs - window.beginMs)
    .sort((a, b) => a - b);
  const median = durations[Math.floor((durations.length - 1) / 2)]!;
  return {
    supported: true,
    reason: `the artifact paces ${durations.length} real frames at a ${median} ms base interval`,
    baseFrameMs: median,
    rates: DISPLAY_RATES,
  };
}

/** Formats a document-timeline position as `0:SS` / `M:SS` (display only). */
export function formatDisplayMs(ms: number): string {
  const clamped = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(clamped / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
