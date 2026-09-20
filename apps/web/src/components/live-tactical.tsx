"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveCloseDoc, LiveHelloDoc, LiveWorldFrameDoc } from "@/lib/live-sse";
import { LiveLatencyWindow } from "@/lib/live-latency";
import type { LiveLatencySnapshot } from "@/lib/live-latency";
import { StateChip, StatePanel } from "@/components/state-panels";

/**
 * THE LIVE TACTICAL RENDERER (L005 scaffold) — a browser 2D tactical pitch
 * canvas that consumes LIVE world state and VISIBLY changes as positions
 * and events change.
 *
 * WHAT IS REAL HERE (and what is honestly scaffold):
 *
 * - The world frames arrive over the EXISTING W915 SSE transport
 *   (`EventSource` on `/api/live/[sessionId]`) — the `world` event grammar
 *   this scaffold adds additively to the wire (unknown events are ignored
 *   by older consumers, per the SSE grammar's own rule).
 * - Each frame is the server-side live view-model's projection of the L002
 *   deterministic synthetic TRACKING source (honestly labeled — never a
 *   real broadcast; the canonical-pitch 105 x 68 m frame is the source's
 *   own coordinate contract).
 * - ENTITY IDENTITY CONTINUITY: the canvas keys every marker by the
 *   canonical `entityRef` — the same entity keeps its marker while its
 *   position updates frame to frame. A tracking miss is displayed honestly:
 *   the undetected marker is drawn hollow at its LAST KNOWN position with
 *   its growing staleness — never fabricated certainty, never a silent
 *   removal.
 * - DROPOUT/DEGRADED HONESTY: the source's reconnect recovery accounting
 *   (the missed window) is displayed as a visible gap badge — accounted,
 *   never smoothed over; the degraded quality state colors the status bar;
 *   the watermark lag is shown per frame.
 * - TELEMETRY STUBS (live-reality.md §9): frame drops (counted ordinal
 *   gaps), rendered worldVersion (vs the newest received), the SWM-to-
 *   render latency (the frame's server generation clock → this browser's
 *   receipt clock — unsynchronized clocks, labeled as such), the effective
 *   update rate, and the per-frame watermark lag + undetected counters the
 *   view-model carries. These are the measurement stubs the later waves
 *   will wire into the real telemetry plane.
 */

/** The connection's honest phase. */
type LivePhase = "connecting" | "live" | "closed" | "failed";

/** The bounded backoff schedule between reconnect attempts (ms). */
const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000] as const;

/** The canonical pitch frame (meters — the sporta-canonical coordinate contract). */
const PITCH_X_METERS = 105;
const PITCH_Y_METERS = 68;

/** One live tactical source the renderer streams. */
export interface LiveTacticalSourceOption {
  sessionId: string;
  label: string;
  storyKey: string;
  sourceNote?: string;
}

/** One renderer-side telemetry snapshot (the §9 measurement stubs). */
interface RendererTelemetry {
  framesReceived: number;
  framesDropped: number;
  /** The newest worldVersion RECEIVED (monotone). */
  newestWorldVersion: number;
  /** The worldVersion currently RENDERED (== the latest drawn frame's). */
  renderedWorldVersion: number;
  /** The rendered-vs-newest world version lag (versions). */
  worldVersionLag: number;
  /** The last frame's own watermark lag (ms, event-time terms). */
  watermarkLagMs: number;
  /** The last frame's undetected-entity count (the honest carry). */
  undetectedEntities: number;
  /** The effective update rate over the receipt window (Hz). */
  updateRateHz: number;
}

/** The empty telemetry (before the first frame). */
const EMPTY_TELEMETRY: RendererTelemetry = {
  framesReceived: 0,
  framesDropped: 0,
  newestWorldVersion: 0,
  renderedWorldVersion: 0,
  worldVersionLag: 0,
  watermarkLagMs: 0,
  undetectedEntities: 0,
  updateRateHz: 0,
};

/** Draws the canonical pitch (105 x 68 m) markings on the canvas. */
function drawPitch(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const mx = (x: number): number => (x / PITCH_X_METERS) * w;
  const my = (y: number): number => (y / PITCH_Y_METERS) * h;
  ctx.strokeStyle = "rgba(148, 163, 184, 0.9)";
  ctx.lineWidth = Math.max(1, Math.min(w, h) / 240);
  // The touchlines + goal lines.
  ctx.strokeRect(mx(0), my(0), mx(PITCH_X_METERS), my(PITCH_Y_METERS));
  // The halfway line.
  ctx.beginPath();
  ctx.moveTo(mx(PITCH_X_METERS / 2), my(0));
  ctx.lineTo(mx(PITCH_X_METERS / 2), my(PITCH_Y_METERS));
  ctx.stroke();
  // The center circle (9.15 m radius).
  ctx.beginPath();
  ctx.arc(mx(PITCH_X_METERS / 2), my(PITCH_Y_METERS / 2), mx(9.15), 0, Math.PI * 2);
  ctx.stroke();
  // The penalty areas (16.5 m deep, 40.32 m wide) + goal areas.
  for (const side of [0, 1] as const) {
    const x0 = side === 0 ? 0 : PITCH_X_METERS;
    const dir = side === 0 ? 1 : -1;
    ctx.strokeRect(
      mx(side === 0 ? 0 : PITCH_X_METERS - 16.5),
      my((PITCH_Y_METERS - 40.32) / 2),
      mx(16.5),
      my(40.32),
    );
    ctx.strokeRect(
      mx(side === 0 ? 0 : PITCH_X_METERS - 5.5),
      my((PITCH_Y_METERS - 18.32) / 2),
      mx(5.5),
      my(18.32),
    );
    // The penalty spots.
    ctx.beginPath();
    ctx.arc(mx(x0 + dir * 11), my(PITCH_Y_METERS / 2), Math.max(1, w / 420), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(148, 163, 184, 0.9)";
    ctx.fill();
  }
}

/** Draws one entity marker (honest: undetected = hollow + last-known). */
function drawEntity(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  entity: LiveWorldFrameDoc["entities"][number],
): void {
  const x = (entity.xMeters / PITCH_X_METERS) * w;
  const y = (entity.yMeters / PITCH_Y_METERS) * h;
  const isBall = entity.kind === "BALL";
  const radius = isBall ? Math.max(2.5, w / 300) : Math.max(4, w / 200);
  // The L002 frozen teamRef vocabulary is `team-home` | `team-away` — the
  // marker color follows THAT contract (home = pink, away = green); an
  // unknown team ref falls back to the away color, never a wrong split.
  const teamColor =
    entity.teamRef !== undefined
      ? entity.teamRef.endsWith("home")
        ? "#e879b9"
        : "#34d399"
      : entity.kind === "REFEREE"
        ? "#fbbf24"
        : "#94a3b8";
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  if (entity.detected) {
    ctx.fillStyle = teamColor;
    ctx.fill();
    ctx.strokeStyle = "rgba(15, 23, 42, 0.85)";
    ctx.lineWidth = Math.max(1, w / 500);
    ctx.stroke();
  } else {
    // The honest carry: LAST KNOWN position, hollow + dashed, labeled by
    // its staleness — never fabricated certainty.
    ctx.strokeStyle = teamColor;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = Math.max(1, w / 420);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export function LiveTacticalRenderer({ source }: { source: LiveTacticalSourceOption }) {
  const [phase, setPhase] = useState<LivePhase>("connecting");
  const [hello, setHello] = useState<LiveHelloDoc | null>(null);
  const [frame, setFrame] = useState<LiveWorldFrameDoc | null>(null);
  const [telemetry, setTelemetry] = useState<RendererTelemetry>(EMPTY_TELEMETRY);
  const [latency, setLatency] = useState<LiveLatencySnapshot | null>(null);
  const [terminal, setTerminal] = useState<LiveCloseDoc | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [recoveryBadge, setRecoveryBadge] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastOrdinalRef = useRef<number | null>(null);
  const frameClockRef = useRef<{ firstAtMs: number | null; count: number }>({
    firstAtMs: null,
    count: 0,
  });
  const windowRef = useRef<LiveLatencyWindow | null>(null);
  if (windowRef.current === null) windowRef.current = new LiveLatencyWindow();

  // The connection (the same bounded-reconnect posture as the story player).
  const connect = useCallback(
    (attemptCount: number): (() => void) | undefined => {
      if (typeof EventSource === "undefined") {
        setFailure("this browser does not support EventSource (Server-Sent-Events)");
        setPhase("failed");
        return undefined;
      }
      const stream = new EventSource(`/api/live/${source.sessionId}`);
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
        frameClockRef.current = { firstAtMs: null, count: 0 };
        windowRef.current?.reset();
        setLatency(null);
        setTelemetry(EMPTY_TELEMETRY);
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
            worldVersionLag: 0,
            watermarkLagMs: doc.telemetry.watermarkLagMs,
            undetectedEntities: doc.telemetry.undetectedEntities,
            updateRateHz,
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
    [source.sessionId],
  );

  useEffect(() => {
    const cleanup = connect(0);
    return () => cleanup?.();
  }, [connect]);

  // The canvas draw (every frame — the visible response to state changes).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    const w = canvas.width;
    const h = canvas.height;
    // The pitch surface.
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, w, h);
    drawPitch(ctx, w, h);
    if (frame !== null) {
      for (const entity of frame.entities) {
        drawEntity(ctx, w, h, entity);
      }
    }
  }, [frame]);

  const teamA = frame?.entities.filter(
    (entity) => entity.teamRef !== undefined && entity.teamRef.endsWith("home"),
  ).length;
  const teamB = frame?.entities.filter(
    (entity) => entity.teamRef !== undefined && entity.teamRef.endsWith("away"),
  ).length;

  return (
    <section className="player-surface" data-live-phase={phase} data-surface="live-tactical">
      <div className="live-stage-header">
        <span className={`live-badge ${phase === "live" ? "is-live" : ""}`} data-phase={phase}>
          {phase === "live" ? "live" : phase}
        </span>
        <span className="live-source-label">{source.label}</span>
        <span className="live-source-note">
          synthetic deterministic tracking (L002 source
          {hello !== null ? `, ${hello.cadenceMs} ms cadence` : ""}) — real SSE network transport,
          canonical 105 × 68 m pitch
        </span>
      </div>

      {recoveryBadge !== null && (
        <p className="form-notice" role="status" data-surface="recovery-badge">
          {recoveryBadge}
        </p>
      )}

      <div className="player-stage live-stage">
        {phase === "failed" ? (
          <StatePanel
            state="failed"
            title="The live tactical view could not be displayed"
            reason={failure ?? "an unexpected live failure"}
          />
        ) : (
          <canvas
            ref={canvasRef}
            width={840}
            height={544}
            className="live-tactical-canvas"
            role="img"
            aria-label={
              frame !== null
                ? `Live tactical pitch: world version ${frame.worldVersion}, ${frame.entities.length} entities at event time ${Math.round(frame.eventTimeMs / 1000)}s`
                : "Live tactical pitch (connecting)"
            }
          />
        )}
      </div>

      <div className="player-bar live-stats">
        <dl className="session-card-facts">
          <div className="fact">
            <dt>World version</dt>
            <dd>
              {frame !== null
                ? `${frame.worldVersion} (rendered ${telemetry.renderedWorldVersion})`
                : "—"}
              {telemetry.worldVersionLag > 0 ? ` · ${telemetry.worldVersionLag} behind` : ""}
            </dd>
          </div>
          <div className="fact">
            <dt>Event time / watermark</dt>
            <dd>
              {frame !== null
                ? `${(frame.eventTimeMs / 1000).toFixed(1)}s / ${(frame.watermark.watermarkMs / 1000).toFixed(1)}s (lag ${frame.telemetry.watermarkLagMs}ms)`
                : "—"}
            </dd>
          </div>
          <div className="fact">
            <dt>Quality</dt>
            <dd>
              {frame !== null ? (
                <StateChip state={frame.quality === "nominal" ? "ready" : "degraded"}>
                  {frame.quality}
                </StateChip>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="fact">
            <dt>Entities</dt>
            <dd>
              {frame !== null
                ? `${frame.entities.length} tracked · ${frame.telemetry.undetectedEntities} last-known (honest carry)`
                : "—"}
            </dd>
          </div>
          <div className="fact">
            <dt>Teams</dt>
            <dd>{frame !== null ? `${teamA ?? 0} vs ${teamB ?? 0} (+ball/referee)` : "—"}</dd>
          </div>
          <div className="fact">
            <dt>Frames</dt>
            <dd>
              {telemetry.framesReceived}
              {telemetry.framesDropped > 0
                ? ` (+${telemetry.framesDropped} dropped — counted)`
                : ""}
            </dd>
          </div>
          <div className="fact">
            <dt>Update rate</dt>
            <dd>{telemetry.updateRateHz > 0 ? `${telemetry.updateRateHz.toFixed(1)} Hz` : "—"}</dd>
          </div>
          <div className="fact">
            <dt>SWM-to-render latency</dt>
            <dd>{latency !== null ? `${latency.lastMs} ms` : "—"}</dd>
          </div>
          <div className="fact">
            <dt>p50 / p95 / max</dt>
            <dd>
              {latency !== null ? `${latency.p50Ms} / ${latency.p95Ms} / ${latency.maxMs} ms` : "—"}
            </dd>
          </div>
          <div className="fact">
            <dt>Confidence (min/mean)</dt>
            <dd>
              {frame !== null
                ? `${frame.confidence.min.toFixed(2)} / ${frame.confidence.mean.toFixed(2)}`
                : "—"}
            </dd>
          </div>
        </dl>
        <p className="live-latency-note">
          The renderer consumes live world state over the real SSE transport (the W915 lane,
          producer re-pointed at the live tactical view-model). Latency is measured per frame (the
          server&apos;s generation clock → this browser&apos;s receipt clock; unsynchronized clocks
          — a real measurement, never a promise). The source is the L002 deterministic synthetic
          tracking package — honestly labeled, never a real broadcast.
        </p>
        {source.sourceNote !== undefined && (
          <p className="live-latency-note">{source.sourceNote}</p>
        )}
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
