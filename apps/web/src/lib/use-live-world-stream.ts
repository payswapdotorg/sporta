"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveCloseDoc, LiveHelloDoc, LiveWorldFrameDoc } from "@/lib/live-sse";
import { LiveLatencyWindow } from "@/lib/live-latency";
import type { LiveLatencySnapshot } from "@/lib/live-latency";
import { frameEventPhrase, liveStaleness } from "@/lib/live-tactical-view";

/**
 * THE LIVE WORLD STREAM HOOK (L005/L013) — the ONE browser-side consumer
 * of the W915 SSE world frames both live renderers share: the connection
 * (hello → world → close, bounded reconnect), the §9 telemetry stubs
 * (counted frame drops, the receipt-window update rate, the latency
 * window), the honest recovery badge, the bounded event ticker, and the
 * RECEIPT WATCHDOG (the never-a-frozen-picture rule — a stalled stream is
 * a VISIBLE state, never a silently stale picture).
 *
 * Both renderers (the 2D tactical canvas and the interactive 3D view)
 * consume THE SAME stream semantics through this hook — one transport, one
 * world frame shape, two presentations (the L013 "no second world model"
 * rule holds on the browser side too: this hook carries view data only).
 */

/** The connection's honest phase. */
export type LiveWorldPhase = "connecting" | "live" | "closed" | "failed";

/** The bounded backoff schedule between reconnect attempts (ms). */
const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000] as const;

/** How many recent honest frame events the ticker keeps visible. */
export const EVENT_TICKER_DEPTH = 8;

/** The renderer-side telemetry snapshot (the §9 measurement stubs). */
export interface LiveWorldTelemetry {
  framesReceived: number;
  framesDropped: number;
  /** The newest worldVersion RECEIVED (monotone). */
  newestWorldVersion: number;
  /** The worldVersion currently RENDERED (== the latest drawn frame's). */
  renderedWorldVersion: number;
  /** The last frame's own watermark lag (ms, event-time terms). */
  watermarkLagMs: number;
  /** The last frame's undetected-entity count (the honest carry). */
  undetectedEntities: number;
  /** The effective update rate over the receipt window (Hz). */
  updateRateHz: number;
  /** Counted stall episodes (the watchdog fired, then a frame arrived). */
  stallEpisodes: number;
}

/** The empty telemetry (before the first frame). */
const EMPTY_TELEMETRY: LiveWorldTelemetry = {
  framesReceived: 0,
  framesDropped: 0,
  newestWorldVersion: 0,
  renderedWorldVersion: 0,
  watermarkLagMs: 0,
  undetectedEntities: 0,
  updateRateHz: 0,
  stallEpisodes: 0,
};

/** One ticker row: an honest frame event at a world version. */
export interface LiveWorldTickerRow {
  key: string;
  worldVersion: number;
  phrase: string;
}

/** The hook's full honest state (everything both renderers render from). */
export interface LiveWorldStreamState {
  phase: LiveWorldPhase;
  hello: LiveHelloDoc | null;
  frame: LiveWorldFrameDoc | null;
  telemetry: LiveWorldTelemetry;
  latency: LiveLatencySnapshot | null;
  terminal: LiveCloseDoc | null;
  failure: string | null;
  attempt: number;
  recoveryBadge: string | null;
  ticker: LiveWorldTickerRow[];
  staleness: ReturnType<typeof liveStaleness>;
}

/**
 * Consumes one live session's world frames over the real SSE transport.
 * EVENT-DRIVEN: the transport pushes (there is no polling loop anywhere).
 *
 * L014: `connect: false` keeps the hook DORMANT — no EventSource, no
 * reconnects — for the REPLAY presentation of a session whose live window
 * has already completed (the replay record is the honest continuation;
 * opening the stream would only collect the terminal 410s). The phase
 * stays `connecting` (the stream never opened); replay-mode components do
 * not render the stream's phase at all — they render the REPLAY state.
 */
export function useLiveWorldStream(
  sessionId: string,
  options?: { connect?: boolean },
): LiveWorldStreamState {
  const connectEnabled = options?.connect !== false;
  const [phase, setPhase] = useState<LiveWorldPhase>("connecting");
  const [hello, setHello] = useState<LiveHelloDoc | null>(null);
  const [frame, setFrame] = useState<LiveWorldFrameDoc | null>(null);
  const [telemetry, setTelemetry] = useState<LiveWorldTelemetry>(EMPTY_TELEMETRY);
  const [latency, setLatency] = useState<LiveLatencySnapshot | null>(null);
  const [terminal, setTerminal] = useState<LiveCloseDoc | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [recoveryBadge, setRecoveryBadge] = useState<string | null>(null);
  const [ticker, setTicker] = useState<LiveWorldTickerRow[]>([]);
  const [watchdogTick, setWatchdogTick] = useState(0);
  const lastOrdinalRef = useRef<number | null>(null);
  const lastReceiptRef = useRef<number | null>(null);
  const stallOpenRef = useRef(false);
  const frameClockRef = useRef<{ firstAtMs: number | null; count: number }>({
    firstAtMs: null,
    count: 0,
  });
  const windowRef = useRef<LiveLatencyWindow | null>(null);
  if (windowRef.current === null) windowRef.current = new LiveLatencyWindow();

  // The receipt watchdog: while live, re-evaluate staleness twice per
  // cadence so a stalled stream becomes VISIBLE (never a frozen picture).
  useEffect(() => {
    if (phase !== "live") return;
    const cadence = hello?.cadenceMs ?? 500;
    const timer = setInterval(
      () => setWatchdogTick((tick) => tick + 1),
      Math.max(200, cadence / 2),
    );
    return () => clearInterval(timer);
  }, [phase, hello?.cadenceMs]);

  // The connection (the same bounded-reconnect posture as the story player).
  const connect = useCallback(
    (attemptCount: number): (() => void) | undefined => {
      if (typeof EventSource === "undefined") {
        setFailure("this browser does not support EventSource (Server-Sent-Events)");
        setPhase("failed");
        return undefined;
      }
      const stream = new EventSource(`/api/live/${sessionId}`);
      let settled = false;
      let pendingTimer: ReturnType<typeof setTimeout> | undefined;
      let cleanup: (() => void) | undefined = () => stream.close();

      stream.addEventListener("hello", (event) => {
        settled = true;
        setAttempt(0);
        setPhase("live");
        setTerminal(null);
        setFailure(null);
        lastOrdinalRef.current = null;
        lastReceiptRef.current = null;
        stallOpenRef.current = false;
        frameClockRef.current = { firstAtMs: null, count: 0 };
        windowRef.current?.reset();
        setLatency(null);
        setTelemetry(EMPTY_TELEMETRY);
        setTicker([]);
        try {
          setHello(JSON.parse((event as MessageEvent<string>).data) as LiveHelloDoc);
        } catch {
          setFailure("the live stream's hello event was not valid JSON");
          setPhase("failed");
          stream.close();
        }
      });

      // THE WORLD FRAMES: one per real cadence tick, each a fresh live
      // view-model projection of the source's observations.
      stream.addEventListener("world", (event) => {
        try {
          const doc = JSON.parse((event as MessageEvent<string>).data) as LiveWorldFrameDoc;
          const receivedAtMs = Date.now();
          // The counted frame-drop stub: an ordinal gap is a real transport
          // loss, surfaced — never a silent skip (§9).
          const previous = lastOrdinalRef.current;
          const dropped =
            previous !== null && doc.ordinal > previous + 1 ? doc.ordinal - previous - 1 : 0;
          lastOrdinalRef.current = doc.ordinal;
          // The watchdog's honest accounting: a frame arriving while the
          // stall state was OPEN closes a counted stall episode.
          const stallEpisode = stallOpenRef.current ? 1 : 0;
          stallOpenRef.current = false;
          lastReceiptRef.current = receivedAtMs;
          // The receipt-window clock (the effective update rate stub).
          if (frameClockRef.current.firstAtMs === null) {
            frameClockRef.current.firstAtMs = receivedAtMs;
          }
          frameClockRef.current.count += 1;
          const spanSeconds = (receivedAtMs - frameClockRef.current.firstAtMs!) / 1000;
          const updateRateHz = spanSeconds > 0.25 ? frameClockRef.current.count / spanSeconds : 0;
          windowRef.current?.add(receivedAtMs - doc.generatedAtMs);
          setLatency(windowRef.current?.snapshot() ?? null);
          setFrame(doc);
          setTelemetry((prev) => ({
            framesReceived: prev.framesReceived + 1,
            framesDropped: prev.framesDropped + dropped,
            newestWorldVersion: doc.worldVersion,
            renderedWorldVersion: doc.worldVersion,
            watermarkLagMs: doc.telemetry.watermarkLagMs,
            undetectedEntities: doc.telemetry.undetectedEntities,
            updateRateHz,
            stallEpisodes: prev.stallEpisodes + stallEpisode,
          }));
          // The honest recovery accounting: a visible gap badge (accounted,
          // never smoothed over).
          const recovery = doc.eventsSincePreviousFrame.find(
            (entry) => entry.type === "source-recovery",
          );
          if (recovery !== undefined) {
            setRecoveryBadge(
              `source reconnect: ${recovery.detail?.missedUpdates ?? "?"} missed updates ` +
                `(${Math.round((recovery.detail?.gapDurationMs ?? 0) / 100) / 10}s gap, accounted)`,
            );
          } else {
            setRecoveryBadge(null);
          }
          // The honest event ticker (bounded; the newest first).
          const rows = doc.eventsSincePreviousFrame.map((entry) => ({
            key: `${doc.worldVersion}:${entry.type}:${entry.atMs}`,
            worldVersion: doc.worldVersion,
            phrase: frameEventPhrase(entry),
          }));
          if (rows.length > 0) {
            setTicker((prev) => [...rows, ...prev].slice(0, EVENT_TICKER_DEPTH));
          }
        } catch (err) {
          setFailure(err instanceof Error ? err.message : String(err));
          setPhase("failed");
          stream.close();
        }
      });

      stream.addEventListener("close", (event) => {
        try {
          setTerminal(JSON.parse((event as MessageEvent<string>).data) as LiveCloseDoc);
        } catch {
          setTerminal({ reason: "transport-closed", deliveredFrames: 0, droppedFrames: 0 });
        }
        setPhase("closed");
        stream.close();
      });

      stream.onerror = () => {
        stream.close();
        if (settled && lastOrdinalRef.current !== null) return; // terminal close handled above
        const nextAttempt = attemptCount + 1;
        if (nextAttempt <= RECONNECT_BACKOFF_MS.length) {
          setAttempt(nextAttempt);
          const timer = setTimeout(
            () => {
              cleanup = connect(nextAttempt);
            },
            RECONNECT_BACKOFF_MS[nextAttempt - 1],
          );
          pendingTimer = timer;
          return;
        }
        setFailure(
          "the live connection could not be opened (the transport, the session token, or the live-delivery rights refused it) — a real failure, not simulated",
        );
        setPhase("failed");
      };

      return () => {
        if (pendingTimer !== undefined) clearTimeout(pendingTimer);
        cleanup?.();
      };
    },
    [sessionId],
  );

  useEffect(() => {
    if (!connectEnabled) return; // dormant (L014 replay mode): no connection
    const cleanup = connect(0);
    return () => cleanup?.();
  }, [connect, connectEnabled]);

  // The honest staleness verdict (re-evaluated on every frame, watchdog
  // tick, and phase change — the pure `liveStaleness` projection).
  const staleness = useMemo(
    () =>
      liveStaleness({
        lastFrameReceivedAtMs: lastReceiptRef.current,
        lastWorldVersion: frame !== null ? frame.worldVersion : null,
        nowMs: Date.now(),
        cadenceMs: hello?.cadenceMs ?? 500,
      }),
    // The watchdog tick and the frame are the honest change signals (the
    // receipt ref is read inside; the tick forces the re-read).
    [frame, watchdogTick, phase, hello?.cadenceMs],
  );
  useEffect(() => {
    stallOpenRef.current = staleness.state === "stalled";
  }, [staleness.state]);

  return {
    phase,
    hello,
    frame,
    telemetry,
    latency,
    terminal,
    failure,
    attempt,
    recoveryBadge,
    ticker,
    staleness,
  };
}
