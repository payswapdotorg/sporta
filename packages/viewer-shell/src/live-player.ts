/**
 * The live stream player (W704): pure presentation logic for an ATTACHED live
 * output — the viewer-side counterpart of `./player.ts` (batch frames) and
 * `./segment-player.ts` (the W504 SMIL segment).
 *
 * Purity/determinism (constitution): the player NEVER reads a wall clock. It
 * is constructed with an injected `clock: () => number` and advanced by
 * host-driven `tick()` calls (the DOM bootstrap forwards `rAF`; tests drive
 * the fake clock). The same window/tick script over the same clock yields a
 * deep-equal view-model trace (pinned by tests).
 *
 * PRESENTATION MODEL (documented decisions, all test-pinned):
 *
 * - a live stream has NO complete manifest — the timeline GROWS as frame
 *   windows are applied. Frame identity is the payload's OWN
 *   `outputTimestampMs` (media timeline, VERBATIM — the W301 rule; `frameIndex`
 *   is per-window local numbering in the W304 emission shape, so the player
 *   keys frames by timestamp and window id, never by a global index);
 * - the playhead JOINS AT THE LIVE EDGE (the first applied window's newest
 *   frame) — live means "watch now", not "replay from the stream start";
 * - the displayed frame is the newest buffered frame at-or-before the
 *   playhead; the buffer keeps every APPLIED window (bounded by the W305
 *   session's own `maxWindowsInSession` bound — no second, invented
 *   eviction accounting at the presentation layer);
 * - `buffering` is an HONEST stall seam: the playhead is overdue the live
 *   edge by more than one full declared frame interval while content was
 *   already flowing (a RE-buffer — the initial wait for the first window is
 *   `frame === null`, never a fake "buffering frame 0");
 * - while disconnected (the core's reconnect window) the core simply does
 *   not tick the player — the presentation holds its frame, honestly.
 *
 * Absent metrics stay absent: `latencyMs` is `null` until the first window
 * is applied (never a faked 0), `frameIntervalMs` is `null` until a window
 * declares one. The latency itself is `now − newestAppliedWindow.emittedAtMs`
 * in the INJECTED clock domain (W305's own `latencyToLatestWindowMs`
 * semantics — real network latency measurement is W306's work, SLO
 * formalization W802's; this viewer never presents it as network latency).
 */
import { toErrorView } from "./errors.ts";
import type { ErrorView } from "./errors.ts";
import type { LiveFrameWindow, LiveOutputPayload } from "@sporta/webrtc-output";

/** The live player view-model — a pure snapshot of the presentation state. */
export interface LivePlayerViewModel {
  kind: "live";
  /**
   * `true` when the playhead is overdue the live edge by more than one
   * declared frame interval AFTER content was flowing (a re-buffer stall).
   * Always `false` before the first applied window.
   */
  buffering: boolean;
  /** The media-timeline playhead (the stream's own timestamp domain, ms). */
  playheadMs: number | null;
  /** The displayed frame, or `null` before the first applied window. */
  frame: { windowOrdinal: number; frameIndex: number; timestampMs: number } | null;
  /** The displayed frame's SVG, or `null` while nothing is displayable. */
  frameSvg: string | null;
  /** Frames applied so far (the honest "known" count — grows with delivery). */
  frameCount: number;
  /** Frames buffered AHEAD of the playhead (the buffered-count seam). */
  bufferedAhead: number;
  /** Windows applied so far (the delivery unit count). */
  windowsApplied: number;
  /** The declared frame interval (from the payload manifests); null until known. */
  frameIntervalMs: number | null;
  /**
   * The newest applied frame's media timestamp (the live edge); null before
   * the first window.
   */
  liveEdgeMs: number | null;
  /**
   * `now − the newest applied window's emittedAtMs` (INJECTED clock domain);
   * `null` before the first window — never a faked latency.
   */
  latencyMs: number | null;
  /**
   * The flat 0-based ordinal of the last displayed frame (in application
   * order); `null` before the first display. The rebuffer-stall telemetry
   * derives its `frameIndex` from this seam.
   */
  lastDisplayedFrame: number | null;
}

/** Result of `applyWindow`: success or a classified error view. */
export type LivePlayerResult = { ok: true } | { ok: false; error: ErrorView };

/** Options for {@link createLivePlayer}. */
export interface LivePlayerOptions {
  /** Injected time source (the viewer core's clock — the shared domain). */
  clock: () => number;
}

/** One buffered frame (flat, in application order). */
interface BufferedFrame {
  windowOrdinal: number;
  frameIndex: number;
  timestampMs: number;
  svg: string;
}

/** Creates the live player over the injected clock (see the module docs). */
export function createLivePlayer(options: LivePlayerOptions): LivePlayer {
  const clock = options.clock;

  // Loaded state (grows as windows apply).
  const appliedWindowIds = new Set<string>();
  const frames: BufferedFrame[] = [];
  let frameIntervalMs: number | null = null;
  let newestWindow: { ordinal: number; emittedAtMs: number } | null = null;

  // Playback state.
  let playheadMs: number | null = null;
  let timeBaseClockMs = 0;
  let hadContent = false;

  function rebase(): void {
    timeBaseClockMs = clock();
  }

  /** Fail-loud classified rejection for a malformed window/payload pair. */
  function invalid(reason: string): LivePlayerResult {
    return { ok: false, error: toErrorView("openLive", "media-invalid", reason) };
  }

  function buildView(): LivePlayerViewModel {
    const displayed = lastDisplayedOrdinal();
    const head = playheadMs; // captured once — a stable basis for the filters below
    let liveEdgeMs: number | null = null;
    for (const frame of frames) {
      if (liveEdgeMs === null || frame.timestampMs > liveEdgeMs) liveEdgeMs = frame.timestampMs;
    }
    const buffering =
      hadContent &&
      head !== null &&
      liveEdgeMs !== null &&
      frameIntervalMs !== null &&
      head > liveEdgeMs + frameIntervalMs;
    return {
      kind: "live",
      buffering,
      playheadMs,
      frame: displayed === null ? null : frameAt(displayed),
      frameSvg: displayed === null ? null : (frames[displayed]?.svg ?? null),
      frameCount: frames.length,
      bufferedAhead: head === null ? 0 : frames.filter((frame) => frame.timestampMs > head).length,
      windowsApplied: appliedWindowIds.size,
      frameIntervalMs,
      liveEdgeMs,
      latencyMs:
        newestWindow === null ? null : clock() - newestWindow.emittedAtMs,
      lastDisplayedFrame: displayed,
    };
  }

  /**
   * The flat ordinal of the newest buffered frame at-or-before the playhead
   * (by timestamp — the honest "newest content" rule; ties resolve to the
   * later application, never a re-delivered stale window).
   */
  function lastDisplayedOrdinal(): number | null {
    if (playheadMs === null) return null;
    let result: number | null = null;
    let bestTimestamp = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      if (frame === undefined) continue;
      if (frame.timestampMs <= playheadMs && frame.timestampMs >= bestTimestamp) {
        bestTimestamp = frame.timestampMs;
        result = index;
      }
    }
    return result;
  }

  /** A display view of one buffered frame. */
  function frameAt(ordinal: number): LivePlayerViewModel["frame"] {
    const frame = frames[ordinal];
    if (frame === undefined) return null;
    return {
      windowOrdinal: frame.windowOrdinal,
      frameIndex: frame.frameIndex,
      timestampMs: frame.timestampMs,
    };
  }

  return {
    applyWindow(window, payload): LivePlayerResult {
      // Structural validation (defense in depth over W305's integrity-verified
      // delivery boundary — a malformed pair never buffers, fail-loud):
      if (typeof window.windowId !== "string" || window.windowId.length < 1) {
        return invalid("live window must carry a windowId");
      }
      if (window.frames.length !== payload.frames.length) {
        return invalid(
          `live window ${window.windowId} declares ${String(window.frames.length)} frame descriptors but the payload carries ${String(payload.frames.length)}`,
        );
      }
      const declaredInterval = payload.manifest.output.frameIntervalMs;
      if (
        typeof declaredInterval !== "number" ||
        !Number.isFinite(declaredInterval) ||
        declaredInterval <= 0
      ) {
        return invalid(
          `live window ${window.windowId} declares a non-positive frame interval (${String(declaredInterval)})`,
        );
      }
      if (frameIntervalMs !== null && declaredInterval !== frameIntervalMs) {
        return invalid(
          `live window ${window.windowId} declares frame interval ${String(declaredInterval)} ms but the stream presented ${String(frameIntervalMs)} ms (renegotiation required)`,
        );
      }
      for (let index = 0; index < payload.frames.length; index += 1) {
        const frame = payload.frames[index];
        if (frame === undefined) {
          return invalid(`live window ${window.windowId} payload frame ${String(index)} is missing`);
        }
        if (
          !Number.isInteger(frame.frameIndex) ||
          frame.frameIndex < 0 ||
          typeof frame.outputTimestampMs !== "number" ||
          !Number.isFinite(frame.outputTimestampMs) ||
          frame.outputTimestampMs < 0 ||
          typeof frame.svg !== "string" ||
          frame.svg.length < 1
        ) {
          return invalid(
            `live window ${window.windowId} frame ${String(index)} must carry a non-negative integer frameIndex, a finite non-negative outputTimestampMs and a non-empty svg`,
          );
        }
      }
      // Idempotent application (W305's Recovery rule at the presentation
      // layer too): a re-delivered window under a stable id is a no-op —
      // the SESSION already counted it as a duplicate; it never double-buffers.
      if (appliedWindowIds.has(window.windowId)) return { ok: true };
      appliedWindowIds.add(window.windowId);
      frameIntervalMs = declaredInterval;
      newestWindow = { ordinal: window.ordinal, emittedAtMs: window.emittedAtMs };
      for (const frame of payload.frames) {
        frames.push({
          windowOrdinal: window.ordinal,
          frameIndex: frame.frameIndex,
          timestampMs: frame.outputTimestampMs,
          svg: frame.svg,
        });
      }
      // Join at the live edge on the first content; afterwards the playhead
      // keeps running and the newest frames display as they arrive.
      if (!hadContent) {
        const newestTimestamp = frames[frames.length - 1]?.timestampMs ?? 0;
        playheadMs = newestTimestamp;
        hadContent = true;
        rebase();
      }
      return { ok: true };
    },

    tick(): void {
      if (playheadMs === null) return;
      const now = clock();
      const elapsed = now - timeBaseClockMs;
      timeBaseClockMs = now;
      if (elapsed <= 0) return;
      playheadMs += elapsed;
    },

    view(): LivePlayerViewModel {
      return buildView();
    },
  };
}

/** The live player surface (see the module docs for the semantics). */
export interface LivePlayer {
  /**
   * Applies one delivered frame window (integrity already verified by the
   * W305 delivery boundary; this re-validates structurally, fail-loud).
   * Idempotent by window id.
   */
  applyWindow(window: LiveFrameWindow, payload: LiveOutputPayload): LivePlayerResult;
  /** Advances the playhead by the elapsed injected clock. Host-driven. */
  tick(): void;
  /** The current view-model snapshot (pure). */
  view(): LivePlayerViewModel;
}
