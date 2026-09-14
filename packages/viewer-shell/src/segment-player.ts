/**
 * The SMIL segment player (W705) — pure presentation logic for the REAL W504
 * stored output: ONE self-contained animated-SVG segment document plus its
 * deterministic container manifest.
 *
 * THE HONEST PRESENTATION MODEL (the W705 decision the W702 wiring point
 * left to this work item):
 *
 * - The W504 artifact is **one self-animating document** — the frames exist
 *   inside it as `<g data-frame-index="…">` groups whose SMIL `<set>`
 *   elements make each visible for exactly its output window. The player
 *   therefore does NOT swap per-frame SVG supplies (there are none to
 *   supply, and pretending otherwise would fake frame-by-frame content).
 *   The view-model exposes the document ONCE (`document`) plus the
 *   manifest metadata verbatim (segment id, content hash, byte length,
 *   frame count, total duration, per-window frame index, renderer
 *   identity) — the presentation is the document and its metadata.
 * - The playhead the player tracks is the **DECLARED timeline** of the
 *   container manifest (`frames[i].beginMs/durMs` — derived by the encoder
 *   EXACTLY from the W502 output windows, so the SVG timeline and the
 *   manifest agree by construction; load CROSS-CHECKS that agreement and
 *   rejects any drift fail-loud). `play`/`pause`/`seek`/`step`/`replay`/`loop`
 *   are honest timeline controls, not content swaps.
 * - The DOM edge owns the ACTUAL document timeline: the browser's SVG
 *   animation APIs (`pauseAnimations`/`unpauseAnimations`/`setCurrentTime`)
 *   really pause, resume, and seek the SMIL clock of the presented
 *   document. The pure player cannot read that clock (no wall-clock reads,
 *   injected clock only — the constitution), so it emits an explicit
 *   `smil` sync instruction per view: `paused` (whether the document's
 *   animations must be paused) and `seekMs` (non-null exactly when the
 *   playhead moved discontinuously — load, play, pause, seek, step,
 *   replay, loop-restart — so the adapter re-locks the document clock to
 *   the model; natural tick advancement never re-seeks, the document
 *   animates on its own).
 * - No buffering: the segment document is complete at load (`buffering` is
 *   constantly `false` — an honest constant, not a state).
 * - The last frame FREEZES (`fill="freeze"` — an encoder presentation
 *   choice documented in W504 ENCODING.md): the player's `ended` at
 *   `positionMs === durationMs` matches it. `loop` is a VIEWER policy: the
 *   ending tick re-seeks the document clock to 0 and resumes (the document
 *   itself never loops).
 *
 * Purity/determinism: identical posture to `./player.ts` — injected
 * `clock`, host-driven `tick()`, no wall-clock reads; the same command/tick
 * script over the same clock yields a deep-equal view trace.
 */
import { toErrorView } from "./errors.ts";
import type { ErrorView } from "./errors.ts";
import type { PlayerResult } from "./player.ts";
import type { PlaybackSegmentDocument } from "./ports.ts";
import type { AnimeSegmentManifest } from "@sporta/output-pipeline";

/** Playback states of the segment player (mirrors the frame player). */
export type SegmentPlayback = "ready" | "playing" | "paused" | "ended";

/** What `load` accepts: the stored segment document + container manifest. */
export interface SegmentPlayerSource {
  segment: PlaybackSegmentDocument;
  manifest: AnimeSegmentManifest;
}

/** The SMIL sync instruction for the DOM edge (see the module docs). */
export interface SmilSync {
  /** Whether the presented document's animations must be PAUSED. */
  paused: boolean;
  /**
   * Force the document's SMIL clock to this 0-based position (ms), or
   * `null` when the playhead advanced naturally (no discontinuity to
   * re-lock).
   */
  seekMs: number | null;
}

/** The segment player view-model — a pure snapshot of the presentation. */
export interface SegmentPlayerViewModel {
  /** Discriminates the union with the frame player's view (dom-plan). */
  kind: "segment";
  playback: SegmentPlayback;
  /** Constantly `false`: the segment document is complete at load. */
  buffering: false;
  /** Playhead within the segment, 0-based milliseconds (`0..durationMs`). */
  positionMs: number;
  /** The manifest's total playback duration, verbatim. */
  durationMs: number;
  /** The frame window covering the playhead (from the declared timing). */
  frameIndex: number;
  /** Total frames declared by the container manifest, verbatim. */
  frameCount: number;
  /** The one self-animating SVG document (presented once, never swapped). */
  document: string;
  /** Segment identity + integrity metadata, verbatim. */
  segmentId: string;
  contentType: string;
  contentHash: string;
  byteLength: number;
  /** Whether the ending tick auto-restarts playback (viewer policy). */
  loop: boolean;
  /** SMIL sync instruction for the DOM edge (see the module docs). */
  smil: SmilSync;
  /** Renderer provenance summary (from `sourceManifest`, verbatim). */
  renderer: {
    rendererId: string;
    rendererVersion: string;
    styleId: string;
  };
  /** Output timing summary (from `sourceManifest`, verbatim). */
  output: {
    startMs: number;
    frameIntervalMs: number;
  };
}

/** The segment player surface (see the module docs for the semantics). */
export interface SegmentPlayer {
  /** Loads (replaces) the segment document. Resets position and playback. */
  load(source: SegmentPlayerSource): PlayerResult;
  play(): void;
  pause(): void;
  /** Seeks to a 0-based position (clamped to `[0, durationMs]`). */
  seekToMs(positionMs: number): void;
  /** Steps one frame window forward (pauses; at the end → `ended`). */
  stepForward(): void;
  /** Steps one frame window backward (pauses; snaps to the window start). */
  stepBackward(): void;
  setLoop(loop: boolean): void;
  /** Explicit replay: seek to zero and play. */
  replay(): void;
  /** Advances the declared timeline from the injected clock. Host-driven. */
  tick(): void;
  /** The current view-model snapshot (pure). */
  view(): SegmentPlayerViewModel;
  /** Subscribes to view-model changes; returns an unsubscribe function. */
  subscribe(listener: (view: SegmentPlayerViewModel) => void): () => void;
}

/** Options for {@link createSegmentPlayer}. */
export interface SegmentPlayerOptions {
  /** Injected time source (epoch or monotonic milliseconds — any unit). */
  clock: () => number;
}

// ---------------------------------------------------------------------------
// Load validation (fail-loud — never a guessed timeline, never a bad doc)
// ---------------------------------------------------------------------------

interface ValidatedSegment {
  segmentId: string;
  contentType: string;
  contentHash: string;
  byteLength: number;
  content: string;
  durationMs: number;
  frameCount: number;
  /** 0-based windows `[beginMs, beginMs + durMs)` per frame. */
  windows: { startMs: number; endMs: number }[];
  renderer: { rendererId: string; rendererVersion: string; styleId: string };
  outputStartMs: number;
  frameIntervalMs: number;
}

/** The load-check outcome: a classified rejection or the validated value. */
type SegmentCheck = { ok: false; error: ErrorView } | { ok: true; value: ValidatedSegment };

function invalid(reason: string): SegmentCheck {
  return { ok: false, error: toErrorView("loadOutput", "media-invalid", reason) };
}

function unsupported(reason: string): SegmentCheck {
  return { ok: false, error: toErrorView("loadOutput", "unsupported-output", reason) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Requires a finite number; returns it (fail-loud helper). `field` names the
 * exact manifest path in the rejection message.
 */
function requireFiniteNumber(
  value: unknown,
  field: string,
  options: { min?: number; integer?: boolean } = {},
): number | { failed: string } {
  const { min = -Number.POSITIVE_INFINITY, integer = false } = options;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { failed: `${field} must be a finite number (got ${describeValue(value)})` };
  }
  if (value < min) {
    return { failed: `${field} must be >= ${String(min)} (got ${String(value)})` };
  }
  if (integer && !Number.isInteger(value)) {
    return { failed: `${field} must be an integer (got ${String(value)})` };
  }
  return value;
}

/**
 * Validates the segment document + container manifest against the W705
 * presentation contract. Rejects (fail-loud, exact messages): a container
 * format this player cannot present (`unsupported-output`); id/hash/length
 * mismatches; a timing table that is not contiguous, first-anchored at 0,
 * and last-anchored at `totalDurationMs`; a timing table that DISAGREES with
 * the embedded W502 `sourceManifest` (the encoder guarantees agreement —
 * drift is never silently presented); a non-SVG content type; a malformed
 * document (pragmatic structural check — not a full XML parse, the same
 * honesty the W504 encoder itself documents).
 */
function validateSegment(source: SegmentPlayerSource): SegmentCheck {
  const { segment, manifest } = source;
  if (!isRecord(segment) || !isRecord(manifest)) {
    return invalid("segment and manifest must be objects");
  }
  // 1. Container format: this player presents the W504 animated-svg container.
  const format = isRecord(manifest.format) ? manifest.format : undefined;
  if (format?.kind !== "animated-svg" || format.version !== 1) {
    return unsupported(
      `segment container format must be animated-svg version 1 (got kind ${String(format?.kind)}, version ${String(format?.version)})`,
    );
  }
  // 2. Content type: the presentation model is an SVG document.
  if (segment.contentType !== "image/svg+xml") {
    return unsupported(
      `segment contentType must be image/svg+xml for this player's presentation model (got ${String(segment.contentType)})`,
    );
  }
  // 3. Segment identity consistency (envelope ↔ manifest).
  if (typeof manifest.segmentId !== "string" || manifest.segmentId.length < 1) {
    return invalid("manifest.segmentId must be a non-empty string");
  }
  if (segment.segmentId !== manifest.segmentId) {
    return invalid(
      `segment.segmentId ("${segment.segmentId}") must equal manifest.segmentId ("${manifest.segmentId}")`,
    );
  }
  if (segment.contentHash !== manifest.contentHash) {
    return invalid(
      `segment.contentHash ("${String(segment.contentHash)}") must equal manifest.contentHash ("${String(manifest.contentHash)}")`,
    );
  }
  if (typeof segment.contentHash !== "string" || !/^[0-9a-f]{64}$/.test(segment.contentHash)) {
    return invalid("segment.contentHash must be 64 lowercase hex digits (sha-256)");
  }
  // 4. Timing table: contiguous, first-anchored, last-anchored.
  const durationMs = requireFiniteNumber(manifest.totalDurationMs, "manifest.totalDurationMs", {
    min: 1,
  });
  if (typeof durationMs === "object") return invalid(durationMs.failed);
  if (!Array.isArray(manifest.frames) || manifest.frames.length < 1) {
    return invalid("manifest.frames must be a non-empty array");
  }
  const frameCount = manifest.frames.length;
  if (manifest.frameCount !== frameCount) {
    return invalid(
      `manifest.frameCount (${String(manifest.frameCount)}) must equal manifest.frames.length (${String(frameCount)})`,
    );
  }
  const windows: { startMs: number; endMs: number }[] = [];
  let previousEnd: number | undefined;
  for (let index = 0; index < frameCount; index += 1) {
    const timing = manifest.frames[index];
    if (!isRecord(timing)) {
      return invalid(`manifest.frames[${String(index)}] must be an object`);
    }
    if (timing.frameIndex !== index) {
      return invalid(
        `manifest.frames[${String(index)}].frameIndex is ${String(timing.frameIndex)} (expected ${String(index)})`,
      );
    }
    const beginMs = requireFiniteNumber(
      timing.beginMs,
      `manifest.frames[${String(index)}].beginMs`,
      {
        min: 0,
      },
    );
    if (typeof beginMs === "object") return invalid(beginMs.failed);
    const durMs = requireFiniteNumber(timing.durMs, `manifest.frames[${String(index)}].durMs`, {
      min: 1,
    });
    if (typeof durMs === "object") return invalid(durMs.failed);
    if (index === 0) {
      if (beginMs !== 0) {
        return invalid(
          `manifest.frames[0].beginMs must be 0 (the segment timeline starts at 0; got ${String(beginMs)})`,
        );
      }
    } else if (beginMs !== previousEnd) {
      return invalid(
        `manifest.frames[${String(index)}].beginMs (${String(beginMs)}) must continue the previous window (ending ${String(previousEnd)})`,
      );
    }
    previousEnd = beginMs + durMs;
    windows.push({ startMs: beginMs, endMs: previousEnd });
  }
  if (previousEnd !== durationMs) {
    return invalid(
      `the last frame window ends at ${String(previousEnd)} but manifest.totalDurationMs is ${String(durationMs)}`,
    );
  }
  // 5. The embedded W502 source manifest must AGREE (never a guessed timeline).
  const sourceManifest = manifest.sourceManifest;
  if (!isRecord(sourceManifest)) {
    return invalid(
      "manifest.sourceManifest must be an object (the W502 render manifest, verbatim)",
    );
  }
  const sourceOutput = isRecord(sourceManifest.output) ? sourceManifest.output : undefined;
  const sourceStartMs = requireFiniteNumber(
    sourceOutput?.startMs,
    "sourceManifest.output.startMs",
    {
      min: 0,
    },
  );
  if (typeof sourceStartMs === "object") return invalid(sourceStartMs.failed);
  const frameIntervalMs = requireFiniteNumber(
    sourceOutput?.frameIntervalMs,
    "sourceManifest.output.frameIntervalMs",
    { min: 1 },
  );
  if (typeof frameIntervalMs === "object") return invalid(frameIntervalMs.failed);
  const sourceDurationMs = requireFiniteNumber(
    sourceOutput?.durationMs,
    "sourceManifest.output.durationMs",
    { min: 1 },
  );
  if (typeof sourceDurationMs === "object") return invalid(sourceDurationMs.failed);
  if (sourceDurationMs !== durationMs) {
    return invalid(
      `manifest.totalDurationMs (${String(durationMs)}) must equal sourceManifest.output.durationMs (${String(sourceDurationMs)})`,
    );
  }
  if (!Array.isArray(sourceManifest.frames) || sourceManifest.frames.length !== frameCount) {
    return invalid(
      `sourceManifest.frames must have the same length as the timing table (${String(frameCount)})`,
    );
  }
  for (let index = 0; index < frameCount; index += 1) {
    const sourceFrame = sourceManifest.frames[index];
    if (!isRecord(sourceFrame)) {
      return invalid(`sourceManifest.frames[${String(index)}] must be an object`);
    }
    const window = isRecord(sourceFrame.windowMs) ? sourceFrame.windowMs : undefined;
    const windowStart = requireFiniteNumber(
      window?.startMs,
      `sourceManifest.frames[${String(index)}].windowMs.startMs`,
      { min: 0 },
    );
    if (typeof windowStart === "object") return invalid(windowStart.failed);
    const windowEnd = requireFiniteNumber(
      window?.endMs,
      `sourceManifest.frames[${String(index)}].windowMs.endMs`,
      { min: 0 },
    );
    if (typeof windowEnd === "object") return invalid(windowEnd.failed);
    const timing = manifest.frames[index]!;
    const expectedBegin = windowStart - sourceStartMs;
    if (timing.beginMs !== expectedBegin || timing.durMs !== windowEnd - windowStart) {
      return invalid(
        `manifest.frames[${String(index)}] (begin ${String(timing.beginMs)}, dur ${String(timing.durMs)}) disagrees with sourceManifest.frames[${String(index)}] (window [${String(windowStart)}, ${String(windowEnd)}) at output start ${String(sourceStartMs)})`,
      );
    }
  }
  const rendererRecord = isRecord(sourceManifest.renderer) ? sourceManifest.renderer : undefined;
  const rendererId = rendererRecord?.rendererId;
  const rendererVersion = rendererRecord?.rendererVersion;
  const styleId = rendererRecord?.styleId;
  if (typeof rendererId !== "string" || rendererId.length < 1) {
    return invalid("sourceManifest.renderer.rendererId must be a non-empty string");
  }
  if (typeof rendererVersion !== "string" || rendererVersion.length < 1) {
    return invalid("sourceManifest.renderer.rendererVersion must be a non-empty string");
  }
  if (typeof styleId !== "string" || styleId.length < 1) {
    return invalid("sourceManifest.renderer.styleId must be a non-empty string");
  }
  // 6. The document itself (structural, honest-pragmatic).
  if (typeof segment.content !== "string" || segment.content.length < 1) {
    return invalid("segment.content must be a non-empty string (the SVG document)");
  }
  if (!segment.content.startsWith("<svg") || !segment.content.endsWith("</svg>")) {
    return invalid(
      "segment.content must be a complete <svg …>…</svg> document (pragmatic structural check, not a full XML parse)",
    );
  }
  const byteLength = new TextEncoder().encode(segment.content).length;
  if (segment.byteLength !== byteLength) {
    return invalid(
      `segment.byteLength (${String(segment.byteLength)}) must equal the UTF-8 byte length of segment.content (${String(byteLength)})`,
    );
  }
  return {
    ok: true,
    value: {
      segmentId: manifest.segmentId,
      contentType: segment.contentType,
      contentHash: segment.contentHash,
      byteLength,
      content: segment.content,
      durationMs,
      frameCount,
      windows,
      renderer: { rendererId, rendererVersion, styleId },
      outputStartMs: sourceStartMs,
      frameIntervalMs,
    },
  };
}

// ---------------------------------------------------------------------------
// Frame-window math (0-based, exact from the validated windows)
// ---------------------------------------------------------------------------

/** The frame window covering `positionMs` (0-based). */
function frameIndexAt(
  timing: { windows: { startMs: number; endMs: number }[]; durationMs: number },
  positionMs: number,
): { index: number; ended: boolean } {
  const lastIndex = timing.windows.length - 1;
  if (positionMs >= timing.durationMs) return { index: lastIndex, ended: true };
  if (positionMs <= 0) return { index: 0, ended: false };
  for (let index = 0; index < timing.windows.length; index += 1) {
    const window = timing.windows[index];
    if (window === undefined) continue; // unreachable after validation
    if (positionMs >= window.startMs && positionMs < window.endMs) return { index, ended: false };
  }
  // Unreachable after validation (windows cover [0, duration)).
  return { index: lastIndex, ended: true };
}

// ---------------------------------------------------------------------------
// createSegmentPlayer
// ---------------------------------------------------------------------------

/** Creates the SMIL segment player over the injected clock. */
export function createSegmentPlayer(options: SegmentPlayerOptions): SegmentPlayer {
  const clock = options.clock;
  const listeners = new Set<(view: SegmentPlayerViewModel) => void>();

  // Loaded state (null until a successful load).
  let loaded: ValidatedSegment | null = null;

  // Playback state.
  let playback: SegmentPlayback = "ready";
  let positionMs = 0;
  let loop = false;
  let timeBaseClockMs = 0;
  // The last emitted SMIL sync instruction (the `view()` snapshot replays
  // it — the DOM edge reads the same instruction the subscribers got).
  let lastSmil: SmilSync = { paused: true, seekMs: null };

  function rebase(): void {
    timeBaseClockMs = clock();
  }

  function displayIndex(): number {
    if (loaded === null) return 0;
    return frameIndexAt(loaded, positionMs).index;
  }

  function buildView(smil: SmilSync): SegmentPlayerViewModel {
    const segment = loaded;
    const renderer = segment?.renderer;
    return {
      kind: "segment",
      playback,
      buffering: false,
      positionMs,
      durationMs: segment?.durationMs ?? 0,
      frameIndex: displayIndex(),
      frameCount: segment?.frameCount ?? 0,
      document: segment?.content ?? "",
      segmentId: segment?.segmentId ?? "",
      contentType: segment?.contentType ?? "",
      contentHash: segment?.contentHash ?? "",
      byteLength: segment?.byteLength ?? 0,
      loop,
      smil,
      renderer: {
        rendererId: renderer?.rendererId ?? "",
        rendererVersion: renderer?.rendererVersion ?? "",
        styleId: renderer?.styleId ?? "",
      },
      output: {
        startMs: segment?.outputStartMs ?? 0,
        frameIntervalMs: segment?.frameIntervalMs ?? 0,
      },
    };
  }

  function emit(smil: SmilSync): void {
    lastSmil = smil;
    const view = buildView(smil);
    for (const listener of listeners) listener(view);
  }

  /** Emits a natural-advancement view (no discontinuity — the document animates on). */
  function emitNatural(): void {
    emit({ paused: playback !== "playing", seekMs: null });
  }

  /** Emits a re-lock view: force the document clock to the current playhead. */
  function emitSeek(): void {
    emit({ paused: playback !== "playing", seekMs: positionMs });
  }

  const player: SegmentPlayer = {
    load(source): PlayerResult {
      const check = validateSegment(source);
      if (!check.ok) return check;
      loaded = check.value;
      playback = "ready";
      positionMs = 0;
      loop = false;
      rebase();
      emitSeek();
      return { ok: true };
    },

    play(): void {
      if (loaded === null || playback === "ended" || playback === "playing") return;
      playback = "playing";
      rebase();
      // Resume re-locks the document clock to the model's playhead (the
      // document was paused with its own clock possibly elsewhere).
      emitSeek();
    },

    pause(): void {
      if (playback !== "playing") return;
      playback = "paused";
      // Pause re-locks too: the document freezes exactly at the model's
      // playhead, never wherever its own clock drifted.
      emitSeek();
    },

    seekToMs(targetMs: number): void {
      if (loaded === null || !Number.isFinite(targetMs)) return;
      const clamped = Math.min(Math.max(targetMs, 0), loaded.durationMs);
      positionMs = clamped;
      if (clamped >= loaded.durationMs) {
        playback = "ended";
      } else if (playback === "playing") {
        rebase();
      } else {
        // Seeking back from `ended` (or around while ready/paused) lands in
        // `paused` — restarting playback is `play`/`replay`, never implicit.
        playback = "paused";
      }
      emitSeek();
    },

    stepForward(): void {
      if (loaded === null || playback === "ended") return;
      const { index } = frameIndexAt(loaded, positionMs);
      const next = loaded.windows[index + 1];
      if (next === undefined) {
        positionMs = loaded.durationMs;
        playback = "ended";
      } else {
        positionMs = next.startMs;
        playback = "paused";
      }
      emitSeek();
    },

    stepBackward(): void {
      if (loaded === null) return;
      if (playback === "ended") {
        const lastIndex = loaded.windows.length - 1;
        const last = loaded.windows[lastIndex];
        positionMs = last !== undefined ? last.startMs : 0;
        playback = "paused";
        emitSeek();
        return;
      }
      const { index } = frameIndexAt(loaded, positionMs);
      const current = loaded.windows[index];
      const frameStart = current !== undefined ? current.startMs : 0;
      if (positionMs > frameStart) {
        positionMs = frameStart;
      } else if (index > 0) {
        const previous = loaded.windows[index - 1];
        positionMs = previous !== undefined ? previous.startMs : 0;
      } else {
        positionMs = 0;
      }
      playback = "paused";
      emitSeek();
    },

    setLoop(value: boolean): void {
      if (loop === value) return;
      loop = value;
      emitNatural();
    },

    replay(): void {
      if (loaded === null) return;
      positionMs = 0;
      playback = "playing";
      rebase();
      emitSeek();
    },

    tick(): void {
      if (loaded === null || playback !== "playing") return;
      const t = loaded;
      const now = clock();
      const elapsed = now - timeBaseClockMs;
      timeBaseClockMs = now;
      if (elapsed <= 0) return;
      const target = Math.min(positionMs + elapsed, t.durationMs);

      // End of media (exact): positionMs >= durationMs. The last frame is
      // frozen by the document itself (`fill="freeze"`); loop is a viewer
      // policy that re-seeks the document clock to 0 and resumes.
      if (target >= t.durationMs) {
        if (loop) {
          positionMs = 0;
          playback = "playing";
          emit({ paused: false, seekMs: 0 });
          return;
        }
        positionMs = t.durationMs;
        playback = "ended";
        emitNatural();
        return;
      }
      positionMs = target;
      emitNatural();
    },

    view(): SegmentPlayerViewModel {
      return buildView(lastSmil);
    },

    subscribe(listener: (view: SegmentPlayerViewModel) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return player;
}
