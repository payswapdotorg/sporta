/**
 * The SVG frame player (W702): pure playback logic for a supported batch
 * output — the W502-shaped `{ frames, manifest }` document.
 *
 * Purity/determinism: the player NEVER reads a wall clock. It is constructed
 * with an injected `clock: () => number` and advanced by host-driven
 * `tick()` calls (the DOM adapter schedules ticks; tests drive the fake
 * clock directly). The same command/tick script over the same clock yields a
 * deep-equal view-model trace (pinned by tests).
 *
 * Frame-index math is EXACT from the manifest timing — never invented:
 *
 * - the current frame is the frame whose `windowMs` contains the playhead
 *   (`windowMs.startMs <= timelineMs < windowMs.endMs`), so non-uniform
 *   frame timestamps (the W502 clip path) play correctly without assuming
 *   `output.frameIntervalMs` uniformity;
 * - `ended` happens exactly when `positionMs >= output.durationMs`, and the
 *   manifest is validated at load to guarantee the last frame's window ends
 *   exactly at `startMs + durationMs` (both W502 render paths satisfy this);
 * - `positionMs` is 0-based within the output; `timelineMs` is the manifest's
 *   absolute output timestamp (`startMs + positionMs`).
 *
 * Buffering is honest: a frame that has not been supplied yet (partial
 * `frames` at load, progressive `supplyFrame` delivery) shows
 * `buffering: true` with `frameSvg: null` — never a blank silent frame. While
 * PLAYING, a missing frame STALLS the playhead at that frame's window start
 * (the clock debt is discarded — playback waits, it does not skip); when the
 * frame arrives, advancing resumes.
 *
 * Loop/replay are explicit: `loop` auto-restarts playback only on the tick
 * that reaches the end; `replay()` is the explicit seek-to-zero-and-play.
 * `play()` at `ended` is a no-op (restart is `replay()`, never implicit).
 */
import { toErrorView } from "./errors.ts";
import type { ErrorView } from "./errors.ts";
import type { AnimeClipManifest, AnimeFrame } from "@sporta/renderer-anime";

/** Playback states of the player state machine. */
export type PlayerPlayback = "ready" | "playing" | "paused" | "ended";

/** What `load` accepts: the manifest plus any already-available frames. */
export interface FramePlayerSource {
  manifest: AnimeClipManifest;
  /** Frames already available (partial is fine — buffering stays honest). */
  frames?: AnimeFrame[];
}

/** The player view-model — a pure snapshot of the playback state. */
export interface PlayerViewModel {
  /** Discriminates the union with the segment player's view (dom-plan). */
  kind: "frames";
  playback: PlayerPlayback;
  /** `true` when the frame that should be displayed has not been supplied. */
  buffering: boolean;
  /** Playhead within the output, 0-based milliseconds (`0..durationMs`). */
  positionMs: number;
  /** The manifest's output duration, verbatim. */
  durationMs: number;
  /** The absolute output timestamp of the playhead (`startMs + positionMs`). */
  timelineMs: number;
  /** The frame covering the playhead (exact from the manifest windows). */
  frameIndex: number;
  /** Total frames declared by the manifest. */
  frameCount: number;
  /** The current frame's SVG, or `null` while buffering (never a fake). */
  frameSvg: string | null;
  /** How many frames have been supplied so far. */
  availableFrames: number;
  /** Whether playback auto-restarts at the end (explicit setting). */
  loop: boolean;
  /** Renderer provenance summary (from the manifest, verbatim). */
  renderer: {
    rendererId: string;
    rendererVersion: string;
    styleId: string;
  };
  /** Output timing summary (from the manifest, verbatim). */
  output: {
    startMs: number;
    frameIntervalMs: number;
  };
}

/** Result of `load` / `supplyFrame`: success or a classified error view. */
export type PlayerResult = { ok: true } | { ok: false; error: ErrorView };

/** The frame player surface (see the module docs for the semantics). */
export interface FramePlayer {
  /** Loads (replaces) the output document. Resets position and playback. */
  load(source: FramePlayerSource): PlayerResult;
  /** Supplies one frame (progressive availability). */
  supplyFrame(frame: AnimeFrame): PlayerResult;
  play(): void;
  pause(): void;
  /** Seeks to a 0-based position (clamped to `[0, durationMs]`). */
  seekToMs(positionMs: number): void;
  /** Steps one frame forward (pauses; at the end → `ended`). */
  stepForward(): void;
  /** Steps one frame backward (pauses; snaps to the frame start). */
  stepBackward(): void;
  setLoop(loop: boolean): void;
  /** Explicit replay: seek to zero and play. */
  replay(): void;
  /** Advances playback from the injected clock. Host-driven. */
  tick(): void;
  /** The current view-model snapshot (pure). */
  view(): PlayerViewModel;
  /** Subscribes to view-model changes; returns an unsubscribe function. */
  subscribe(listener: (view: PlayerViewModel) => void): () => void;
}

/** Options for {@link createFramePlayer}. */
export interface FramePlayerOptions {
  /** Injected time source (epoch or monotonic milliseconds — any unit). */
  clock: () => number;
}

// ---------------------------------------------------------------------------
// Manifest validation (fail-loud — never a guessed timeline)
// ---------------------------------------------------------------------------

interface ValidatedTiming {
  startMs: number;
  durationMs: number;
  frameIntervalMs: number;
  windows: { startMs: number; endMs: number }[];
}

function invalid(reason: string): PlayerResult {
  return { ok: false, error: toErrorView("loadOutput", "media-invalid", reason) };
}

/**
 * Validates the manifest timing contract the player relies on. Rejects:
 * non-finite/negative duration or interval; empty frames; frameIndex not
 * matching the array position; non-finite window bounds; `start >= end`;
 * windows not starting at `output.startMs`; gaps or overlaps between
 * windows; `outputTimestampMs` not equal to the window start; the last
 * window not ending exactly at `startMs + durationMs`. Every rejection
 * message names the exact violation (fail-loud, never invented timing).
 */
function validateTiming(manifest: AnimeClipManifest): PlayerResult {
  const output = manifest.output;
  const { durationMs, frameIntervalMs } = output;
  const startMs = output.startMs;
  if (
    typeof startMs !== "number" ||
    !Number.isFinite(startMs) ||
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    typeof frameIntervalMs !== "number" ||
    !Number.isFinite(frameIntervalMs) ||
    frameIntervalMs <= 0
  ) {
    return invalid(
      `manifest.output timing must be finite positive numbers (got startMs=${String(startMs)}, durationMs=${String(durationMs)}, frameIntervalMs=${String(frameIntervalMs)})`,
    );
  }
  const frames = manifest.frames;
  if (!Array.isArray(frames) || frames.length === 0) {
    return invalid("manifest.frames must be a non-empty array");
  }
  const windows: { startMs: number; endMs: number }[] = [];
  let previousEnd: number | undefined;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame === undefined) return invalid(`manifest.frames[${index}] is missing`);
    if (frame.frameIndex !== index) {
      return invalid(
        `manifest.frames[${index}].frameIndex is ${String(frame.frameIndex)} (expected ${String(index)})`,
      );
    }
    const window = frame.windowMs;
    const { startMs: wStart, endMs: wEnd } = window;
    if (
      !Number.isFinite(wStart) ||
      !Number.isFinite(wEnd) ||
      typeof wStart !== "number" ||
      typeof wEnd !== "number" ||
      wStart >= wEnd
    ) {
      return invalid(
        `manifest.frames[${index}].windowMs must be a finite ascending range (got [${String(wStart)}, ${String(wEnd)}))`,
      );
    }
    if (frame.outputTimestampMs !== wStart) {
      return invalid(
        `manifest.frames[${index}].outputTimestampMs is ${String(frame.outputTimestampMs)} but its window starts at ${String(wStart)}`,
      );
    }
    if (index === 0) {
      if (wStart !== startMs) {
        return invalid(
          `manifest.frames[0].windowMs.startMs is ${String(wStart)} but output.startMs is ${String(startMs)}`,
        );
      }
    } else if (wStart !== previousEnd) {
      return invalid(
        `manifest.frames[${index}].windowMs starts at ${String(wStart)} but the previous window ends at ${String(previousEnd)} (windows must be contiguous)`,
      );
    }
    previousEnd = wEnd;
    windows.push({ startMs: wStart, endMs: wEnd });
  }
  const expectedEnd = startMs + durationMs;
  if (previousEnd !== expectedEnd) {
    return invalid(
      `the last frame window ends at ${String(previousEnd)} but startMs + durationMs is ${String(expectedEnd)}`,
    );
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Frame-index math (exact from the validated windows)
// ---------------------------------------------------------------------------

/**
 * The frame covering `positionMs` (0-based). Before the first window →
 * frame 0; at/after the end → the LAST frame with `ended: true`.
 */
function frameIndexAt(
  timing: ValidatedTiming,
  positionMs: number,
): { index: number; ended: boolean } {
  const lastIndex = timing.windows.length - 1;
  if (positionMs >= timing.durationMs) return { index: lastIndex, ended: true };
  if (positionMs <= 0) return { index: 0, ended: false };
  const t = timing.startMs + positionMs;
  for (let index = 0; index < timing.windows.length; index += 1) {
    const window = timing.windows[index];
    if (window === undefined) continue; // unreachable after validation
    if (t >= window.startMs && t < window.endMs) return { index, ended: false };
  }
  // Unreachable after validation (windows cover [start, start+duration)).
  return { index: lastIndex, ended: true };
}

// ---------------------------------------------------------------------------
// createFramePlayer
// ---------------------------------------------------------------------------

/** Creates a frame player over the injected clock (see the module docs). */
export function createFramePlayer(options: FramePlayerOptions): FramePlayer {
  const clock = options.clock;
  const listeners = new Set<(view: PlayerViewModel) => void>();

  // Loaded state (null until a successful load).
  let timing: ValidatedTiming | null = null;
  let manifest: AnimeClipManifest | null = null;
  let frames = new Map<number, string>();
  let frameCount = 0;

  // Playback state.
  let playback: PlayerPlayback = "ready";
  let positionMs = 0;
  let loop = false;
  let timeBaseClockMs = 0;

  function rebase(): void {
    timeBaseClockMs = clock();
  }

  /**
   * Validates one frame against a manifest. Returns the frame's svg on
   * success or a classified rejection (fail-loud, never a silent drop).
   */
  function checkFrame(
    frame: AnimeFrame,
    against: AnimeClipManifest,
  ): { ok: true; svg: string } | { ok: false; error: ErrorView } {
    if (typeof frame.svg !== "string") {
      return {
        ok: false,
        error: toErrorView(
          "loadOutput",
          "media-invalid",
          `supplied frame ${String(frame.frameIndex)} has a non-string svg (got ${typeof frame.svg})`,
        ),
      };
    }
    if (
      !Number.isInteger(frame.frameIndex) ||
      frame.frameIndex < 0 ||
      frame.frameIndex >= against.frames.length
    ) {
      return {
        ok: false,
        error: toErrorView(
          "loadOutput",
          "media-invalid",
          `supplied frame index ${String(frame.frameIndex)} is outside the manifest (0..${String(against.frames.length - 1)})`,
        ),
      };
    }
    const expected = against.frames[frame.frameIndex];
    if (expected === undefined || frame.outputTimestampMs !== expected.outputTimestampMs) {
      return {
        ok: false,
        error: toErrorView(
          "loadOutput",
          "media-invalid",
          `supplied frame ${String(frame.frameIndex)} has outputTimestampMs ${String(frame.outputTimestampMs)} but the manifest declares ${String(expected?.outputTimestampMs)}`,
        ),
      };
    }
    return { ok: true, svg: frame.svg };
  }

  function displayIndex(): number {
    if (timing === null) return 0;
    return frameIndexAt(timing, positionMs).index;
  }

  function buildView(): PlayerViewModel {
    const loaded = timing !== null && manifest !== null;
    const index = displayIndex();
    const svg = loaded ? (frames.get(index) ?? null) : null;
    const startMs = timing?.startMs ?? 0;
    const renderer = manifest?.renderer;
    return {
      kind: "frames",
      playback,
      buffering: svg === null,
      positionMs,
      durationMs: timing?.durationMs ?? 0,
      timelineMs: startMs + positionMs,
      frameIndex: index,
      frameCount,
      frameSvg: svg,
      availableFrames: frames.size,
      loop,
      renderer: {
        rendererId: renderer?.rendererId ?? "",
        rendererVersion: renderer?.rendererVersion ?? "",
        styleId: renderer?.styleId ?? "",
      },
      output: {
        startMs,
        frameIntervalMs: timing?.frameIntervalMs ?? 0,
      },
    };
  }

  function emit(): void {
    const view = buildView();
    for (const listener of listeners) listener(view);
  }

  const player: FramePlayer = {
    load(source): PlayerResult {
      const check = validateTiming(source.manifest);
      if (!check.ok) return check;
      // Frames provided at load are validated one by one BEFORE any state is
      // assigned — a frame that does not match the manifest, a non-object
      // entry, or a duplicate index with DIFFERENT content is a fail-loud
      // rejection that leaves the previous playback state untouched. The
      // duplicate rule is the same contract as `supplyFrame`: re-supplying
      // IDENTICAL content is an idempotent no-op, conflicting content never
      // silently wins (never-silent error handling).
      const provided = source.frames ?? [];
      const seen = new Map<number, string>();
      for (let i = 0; i < provided.length; i += 1) {
        const frame = provided[i];
        if (typeof frame !== "object" || frame === null) {
          return invalid(`frames[${String(i)}] is not a frame document (got ${typeof frame})`);
        }
        const frameCheck = checkFrame(frame, source.manifest);
        if (!frameCheck.ok) return frameCheck;
        const previous = seen.get(frame.frameIndex);
        if (previous !== undefined && previous !== frameCheck.svg) {
          return invalid(
            `frame ${String(frame.frameIndex)} is supplied twice with different content`,
          );
        }
        seen.set(frame.frameIndex, frameCheck.svg);
      }
      timing = {
        startMs: source.manifest.output.startMs,
        durationMs: source.manifest.output.durationMs,
        frameIntervalMs: source.manifest.output.frameIntervalMs,
        windows: source.manifest.frames.map((frame) => ({
          startMs: frame.windowMs.startMs,
          endMs: frame.windowMs.endMs,
        })),
      };
      manifest = source.manifest;
      // Exactly the validated frames (seen), keyed by index.
      frames = new Map(seen);
      frameCount = source.manifest.frames.length;
      playback = "ready";
      positionMs = 0;
      loop = false;
      rebase();
      emit();
      return { ok: true };
    },

    supplyFrame(frame): PlayerResult {
      if (manifest === null) {
        return {
          ok: false,
          error: toErrorView(
            "loadOutput",
            "media-invalid",
            "cannot supply a frame before an output is loaded",
          ),
        };
      }
      const frameCheck = checkFrame(frame, manifest);
      if (!frameCheck.ok) return frameCheck;
      const existing = frames.get(frame.frameIndex);
      if (existing !== undefined) {
        if (existing !== frame.svg) {
          return {
            ok: false,
            error: toErrorView(
              "loadOutput",
              "media-invalid",
              `frame ${String(frame.frameIndex)} was already supplied with different content`,
            ),
          };
        }
        return { ok: true };
      }
      frames.set(frame.frameIndex, frame.svg);
      // Resuming from a stall: snap the playhead to the frame's window start
      // and rebase so no clock debt accumulates while it was missing.
      if (playback === "playing" && displayIndex() === frame.frameIndex && timing !== null) {
        const window = timing.windows[frame.frameIndex];
        if (window !== undefined) positionMs = window.startMs - timing.startMs;
        rebase();
      }
      emit();
      return { ok: true };
    },

    play(): void {
      if (timing === null || playback === "ended" || playback === "playing") return;
      playback = "playing";
      rebase();
      emit();
    },

    pause(): void {
      if (playback !== "playing") return;
      playback = "paused";
      emit();
    },

    seekToMs(targetMs: number): void {
      if (timing === null || !Number.isFinite(targetMs)) return;
      const clamped = Math.min(Math.max(targetMs, 0), timing.durationMs);
      positionMs = clamped;
      if (clamped >= timing.durationMs) {
        playback = "ended";
      } else if (playback === "playing") {
        rebase();
      } else {
        // Seeking back from `ended` (or around while ready/paused) lands in
        // `paused` — restarting playback is `play`/`replay`, never implicit.
        playback = "paused";
      }
      emit();
    },

    stepForward(): void {
      if (timing === null || playback === "ended") return;
      const { index } = frameIndexAt(timing, positionMs);
      const next = timing.windows[index + 1];
      if (next === undefined) {
        positionMs = timing.durationMs;
        playback = "ended";
      } else {
        positionMs = next.startMs - timing.startMs;
        playback = "paused";
      }
      emit();
    },

    stepBackward(): void {
      if (timing === null) return;
      if (playback === "ended") {
        const lastIndex = timing.windows.length - 1;
        const last = timing.windows[lastIndex];
        positionMs = last !== undefined ? last.startMs - timing.startMs : 0;
        playback = "paused";
        emit();
        return;
      }
      const { index } = frameIndexAt(timing, positionMs);
      const current = timing.windows[index];
      const frameStart = current !== undefined ? current.startMs - timing.startMs : 0;
      if (positionMs > frameStart) {
        positionMs = frameStart;
      } else if (index > 0) {
        const previous = timing.windows[index - 1];
        positionMs = previous !== undefined ? previous.startMs - timing.startMs : 0;
      } else {
        positionMs = 0;
      }
      playback = "paused";
      emit();
    },

    setLoop(value: boolean): void {
      if (loop === value) return;
      loop = value;
      emit();
    },

    replay(): void {
      if (timing === null) return;
      positionMs = 0;
      playback = "playing";
      rebase();
      emit();
    },

    tick(): void {
      if (timing === null || manifest === null || playback !== "playing") return;
      const t = timing;
      const now = clock();
      const elapsed = now - timeBaseClockMs;
      timeBaseClockMs = now;
      if (elapsed <= 0) return;
      const target = Math.min(positionMs + elapsed, t.durationMs);

      // Honest buffering along the path: playback may only advance up to the
      // START of the FIRST missing frame between here and the target — a
      // stall never skips a missing frame, never reaches the end over one,
      // and shows `buffering` (the view derives it from the missing frame).
      const currentIndex = frameIndexAt(t, positionMs).index;
      const targetIndex = frameIndexAt(t, target).index;
      for (let index = currentIndex; index <= targetIndex; index += 1) {
        if (frames.has(index)) continue;
        const window = t.windows[index];
        if (window !== undefined) {
          const stallAt = window.startMs - t.startMs;
          if (stallAt > positionMs) positionMs = stallAt;
        }
        emit();
        return;
      }

      // End of media (exact): positionMs >= durationMs. The last frame must
      // be available — the ended state holds it (otherwise the loop above
      // already stalled at its window start).
      if (target >= t.durationMs) {
        if (loop) {
          // Loop is explicit and applies exactly at the ending tick.
          positionMs = 0;
          playback = "playing";
          emit();
          return;
        }
        positionMs = t.durationMs;
        playback = "ended";
        emit();
        return;
      }

      positionMs = target;
      emit();
    },

    view(): PlayerViewModel {
      return buildView();
    },

    subscribe(listener: (view: PlayerViewModel) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return player;
}
