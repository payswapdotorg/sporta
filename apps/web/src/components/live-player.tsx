"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { prepareLiveFrameForDisplay } from "@/lib/frame-svg";
import type { LiveCloseDoc, LiveFrameDoc, LiveHelloDoc } from "@/lib/live-sse";
import { LiveLatencyWindow } from "@/lib/live-latency";
import type { LiveLatencySnapshot } from "@/lib/live-latency";
import { StatePanel } from "@/components/state-panels";

/**
 * THE LIVE PLAYER (W915) — browser playback over the REAL live network
 * transport: one `EventSource` on `/api/live/[sessionId]`, real frames
 * rendered as they arrive, latency MEASURED end-to-end (the frame's server
 * generation timestamp vs the browser's real receipt clock — never a
 * promise; the clocks are unsynchronized, which the label says).
 *
 * Honesty rules this component enforces:
 *
 * - the LIVE badge renders ONLY while the stream is genuinely open (the
 *   transport is a real SSE connection — never a simulated indicator);
 * - the source is labeled (`dev-seed story timeline, cycled` — the content
 *   is the checked-in fixture story; the generation, transport and latency
 *   are real);
 * - dropped ordinals are COUNTED (a gap between successive frame ordinals
 *   is a real transport loss, surfaced — never a silent skip);
 * - the frame display is the same fail-closed posture as the watch player
 *   (`prepareLiveFrameForDisplay` refuses scripts/handlers/external refs);
 * - a terminal `close` event ends playback with the transport's own
 *   accounting; connection failures reconnect with bounded backoff, then
 *   surface the honest failed state (no infinite silent retry).
 */

/** The connection's honest phase. */
type LivePhase = "connecting" | "live" | "closed" | "failed";

/** The bounded backoff schedule between reconnect attempts (ms). */
const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000] as const;

/** One live source the player streams (from GET /api/live). */
export interface LiveSourceOption {
  sessionId: string;
  label: string;
  storyKey: string;
}

export function LivePlayer({ source }: { source: LiveSourceOption }) {
  const [phase, setPhase] = useState<LivePhase>("connecting");
  const [hello, setHello] = useState<LiveHelloDoc | null>(null);
  const [frame, setFrame] = useState<{ doc: LiveFrameDoc; svg: string } | null>(null);
  const [latency, setLatency] = useState<LiveLatencySnapshot | null>(null);
  const [framesReceived, setFramesReceived] = useState(0);
  const [framesMissed, setFramesMissed] = useState(0);
  const [terminal, setTerminal] = useState<LiveCloseDoc | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const lastOrdinalRef = useRef<number | null>(null);
  const windowRef = useRef<LiveLatencyWindow | null>(null);
  if (windowRef.current === null) windowRef.current = new LiveLatencyWindow();

  const connect = useCallback(
    (attemptCount: number): (() => void) | undefined => {
      if (typeof EventSource === "undefined") {
        setFailure("this browser does not support EventSource (Server-Sent-Events)");
        setPhase("failed");
        return undefined;
      }
      const source_ = new EventSource(`/api/live/${source.sessionId}`);
      let settled = false;
      let pendingTimer: ReturnType<typeof setTimeout> | undefined;
      let cleanup: (() => void) | undefined = () => source_.close();

      source_.addEventListener("hello", (event) => {
        settled = true;
        setAttempt(0);
        setPhase("live");
        setTerminal(null);
        setFailure(null);
        lastOrdinalRef.current = null;
        windowRef.current?.reset();
        setLatency(null);
        setFramesReceived(0);
        setFramesMissed(0);
        try {
          setHello(JSON.parse((event as MessageEvent<string>).data) as LiveHelloDoc);
        } catch {
          setFailure("the live stream's hello event was not valid JSON");
          setPhase("failed");
          source_.close();
        }
      });

      source_.addEventListener("frame", (event) => {
        try {
          const doc = JSON.parse((event as MessageEvent<string>).data) as LiveFrameDoc;
          const receivedAtMs = Date.now();
          const previous = lastOrdinalRef.current;
          if (previous !== null && doc.ordinal > previous + 1) {
            setFramesMissed((count) => count + (doc.ordinal - previous - 1));
          }
          lastOrdinalRef.current = doc.ordinal;
          const svg = prepareLiveFrameForDisplay(doc.svg);
          setFrame({ doc, svg });
          windowRef.current?.add(receivedAtMs - doc.generatedAtMs);
          setLatency(windowRef.current?.snapshot() ?? null);
          setFramesReceived((count) => count + 1);
        } catch (err) {
          setFailure(err instanceof Error ? err.message : String(err));
          setPhase("failed");
          source_.close();
        }
      });

      source_.addEventListener("close", (event) => {
        try {
          setTerminal(JSON.parse((event as MessageEvent<string>).data) as LiveCloseDoc);
        } catch {
          setTerminal({ reason: "transport-closed", deliveredFrames: 0, droppedFrames: 0 });
        }
        setPhase("closed");
        source_.close();
      });

      source_.onerror = () => {
        source_.close();
        if (settled && lastOrdinalRef.current !== null) return; // terminal close handled above
        const nextAttempt = attemptCount + 1;
        if (nextAttempt <= RECONNECT_BACKOFF_MS.length) {
          setAttempt(nextAttempt);
          const timer = setTimeout(() => {
            cleanup = connect(nextAttempt);
          }, RECONNECT_BACKOFF_MS[nextAttempt - 1]);
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
    [source.sessionId],
  );

  useEffect(() => {
    const cleanup = connect(0);
    return () => cleanup?.();
  }, [connect]);

  return (
    <section className="player-surface" data-live-phase={phase}>
      <div className="live-stage-header">
        <span className={`live-badge ${phase === "live" ? "is-live" : ""}`} data-phase={phase}>
          {phase === "live" ? "live" : phase}
        </span>
        <span className="live-source-label">{source.label}</span>
        <span className="live-source-note">
          dev-seed story timeline ({source.storyKey}), cycled — real generation, real SSE network
          transport
          {hello !== null ? `, ${hello.cadenceMs} ms cadence` : ""}
        </span>
      </div>

      <div className="player-stage live-stage">
        {frame !== null ? (
          <div
            className="live-frame"
            // The frame is the real renderer's SVG, verified per frame by the
            // fail-closed prepare step (no scripts/handlers/external refs).
            role="img"
            aria-label={`Live frame ${frame.doc.ordinal} of session ${source.sessionId}`}
            dangerouslySetInnerHTML={{ __html: frame.svg }}
          />
        ) : (
          <StatePanel
            state={phase === "failed" ? "failed" : "loading"}
            title={
              phase === "failed"
                ? "The live stream could not be displayed"
                : phase === "closed"
                  ? "The live stream has ended"
                  : "Connecting over the live network transport"
            }
            reason={
              phase === "failed"
                ? (failure ?? "an unexpected live failure")
                : phase === "closed"
                  ? "the transport closed the stream (see the accounting below)"
                  : "opening the SSE stream — real frames appear here as they arrive"
            }
          />
        )}
      </div>

      <div className="player-bar live-stats">
        <dl className="session-card-facts">
          <div className="fact">
            <dt>Frames received</dt>
            <dd>
              {framesReceived}
              {framesMissed > 0 ? ` (+${framesMissed} missed ordinals — counted)` : ""}
            </dd>
          </div>
          <div className="fact">
            <dt>Last latency</dt>
            <dd>{latency !== null ? `${latency.lastMs} ms` : "—"}</dd>
          </div>
          <div className="fact">
            <dt>p50 / p95 / max</dt>
            <dd>
              {latency !== null
                ? `${latency.p50Ms} / ${latency.p95Ms} / ${latency.maxMs} ms`
                : "—"}
            </dd>
          </div>
          <div className="fact">
            <dt>Window</dt>
            <dd>{latency !== null ? `${latency.count} frames` : "—"}</dd>
          </div>
        </dl>
        <p className="live-latency-note">
          Latency is measured end-to-end per frame (the server&apos;s real clock at generation →
          this browser&apos;s real clock at receipt; the two clocks are unsynchronized, so the
          number includes their skew — a real measurement, never a promise).
        </p>
        {terminal !== null ? (
          <p className="live-terminal-note">
            Stream closed ({terminal.reason}) — transport accounting: {terminal.deliveredFrames}{" "}
            delivered, {terminal.droppedFrames} dropped.
          </p>
        ) : null}
        {attempt > 0 && phase !== "failed" ? (
          <p className="live-reconnect-note">reconnecting (attempt {attempt})…</p>
        ) : null}
      </div>
    </section>
  );
}
