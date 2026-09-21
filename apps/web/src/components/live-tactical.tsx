"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveWorldFrameDoc } from "@/lib/live-sse";
import type { LiveReplayRecord } from "@/lib/live-replay";
import { useLiveWorldStream } from "@/lib/use-live-world-stream";
import {
  TACTICAL_PITCH_LINES,
  TACTICAL_PITCH_SURFACE,
  entityMarkerLabel,
  projectPitchGeometry,
  projectTacticalFrame,
  teamRefOf,
} from "@/lib/live-tactical-view";
import { StateChip, StatePanel } from "@/components/state-panels";

/**
 * THE LIVE TACTICAL RENDERER (L005 full) — a browser 2D tactical pitch
 * canvas that consumes LIVE world state over the W915 SSE transport and
 * VISIBLY CHANGES as positions and events change.
 *
 * WHAT IS REAL HERE (the full L005 surface, built on the Wave 1 scaffold):
 *
 * - The world frames arrive over the EXISTING W915 SSE transport
 *   (`EventSource` on `/api/live/[sessionId]`) — EVENT-DRIVEN updates (the
 *   transport pushes; there is no polling loop anywhere in this view). The
 *   stream plumbing lives in the shared `useLiveWorldStream` hook (the ONE
 *   browser-side consumer of the world frames — this view and the 3D view
 *   both render from it; one transport, one world shape, two presentations).
 * - Each frame is the server-side live view-model's projection of the L002
 *   deterministic synthetic TRACKING source (honestly labeled — never a
 *   real broadcast; the canonical-pitch 105 × 68 m frame is the source's
 *   own coordinate contract). The dev seed registers one session per L002
 *   delivery scenario (normal/jitter/delay/drop/out-of-order/reconnect) —
 *   replayable, honest, selectable on the Live surface.
 * - IDENTITY CONTINUITY IS VISIBLE: every marker is keyed by the canonical
 *   `entityRef` and carries a STABLE short label (the pure
 *   `entityMarkerLabel` projection) — the same entity keeps its marker AND
 *   its label while its position updates frame to frame. Selecting an
 *   entity (canvas click or the keyboard-reachable picker) pins the
 *   inspector to that identity across frames.
 * - A TRACKING MISS IS DATA: the undetected marker is drawn HOLLOW at its
 *   LAST KNOWN position with its growing staleness — never fabricated
 *   certainty, never a silent removal.
 * - DROPOUT/DEGRADED/STALL HONESTY: the source's reconnect accounting is
 *   displayed as a visible gap badge; the degraded quality state colors
 *   the status facts; the watermark lag is shown per frame; and the
 *   RECEIPT WATCHDOG (in the shared hook) surfaces a visible stalled
 *   overlay the moment world frames stop arriving — a frozen picture is
 *   never presented as live.
 * - TELEMETRY (live-reality.md §9): counted frame drops (ordinal gaps),
 *   rendered vs newest worldVersion, the SWM-to-render latency window
 *   (p50/p95/max), the effective update rate, watermark lag and the
 *   undetected carry — the measurement stubs the telemetry plane wires.
 */

/** One live tactical source the renderer streams. */
export interface LiveTacticalSourceOption {
  sessionId: string;
  label: string;
  storyKey: string;
  sourceNote?: string;
}

/**
 * L014: the REPLAY presentation input — the recorded frame the SAME view
 * renders (through the SAME projections — no second presentation path),
 * with the record for the honest continuity labeling.
 */
export interface LiveReplayPresentation {
  record: LiveReplayRecord;
  frame: LiveWorldFrameDoc | null;
}

/** The pure frame-draw (canvas primitives from the view projection). */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: LiveWorldFrameDoc | null,
  selectedRef: string | null,
): void {
  // The pitch surface + markings.
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = TACTICAL_PITCH_SURFACE;
  ctx.fillRect(0, 0, w, h);
  const pitch = projectPitchGeometry({ width: w, height: h });
  ctx.strokeStyle = TACTICAL_PITCH_LINES;
  ctx.lineWidth = Math.max(1, Math.min(w, h) / 240);
  ctx.strokeRect(pitch.boundary.x, pitch.boundary.y, pitch.boundary.w, pitch.boundary.h);
  ctx.beginPath();
  ctx.moveTo(pitch.halfwayLine.x1, pitch.halfwayLine.y1);
  ctx.lineTo(pitch.halfwayLine.x2, pitch.halfwayLine.y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(pitch.centerCircle.cx, pitch.centerCircle.cy, pitch.centerCircle.r, 0, Math.PI * 2);
  ctx.stroke();
  for (const area of pitch.penaltyAreas) {
    ctx.strokeRect(area.x, area.y, area.w, area.h);
  }
  for (const area of pitch.goalAreas) {
    ctx.strokeRect(area.x, area.y, area.w, area.h);
  }
  for (const spot of pitch.penaltySpots) {
    ctx.beginPath();
    ctx.arc(spot.cx, spot.cy, Math.max(1, w / 420), 0, Math.PI * 2);
    ctx.fillStyle = TACTICAL_PITCH_LINES;
    ctx.fill();
  }
  if (frame === null) return;

  // The entity markers (identity-continuous, honest carries, stable labels).
  const { markers } = projectTacticalFrame(frame.entities, { width: w, height: h });
  const labelFont = Math.max(9, Math.round(w / 78));
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `700 ${labelFont}px ui-monospace, monospace`;
  for (const marker of markers) {
    // The selection ring (the pinned identity, visible across frames).
    if (selectedRef !== null && marker.entityRef === selectedRef) {
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, marker.radius + Math.max(3, w / 210), 0, Math.PI * 2);
      ctx.strokeStyle = "#fde68a";
      ctx.lineWidth = Math.max(1.5, w / 420);
      ctx.setLineDash([]);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, marker.radius, 0, Math.PI * 2);
    if (marker.detected) {
      ctx.fillStyle = marker.color;
      ctx.fill();
      ctx.strokeStyle = "rgba(15, 23, 42, 0.85)";
      ctx.lineWidth = Math.max(1, w / 500);
      ctx.setLineDash([]);
      ctx.stroke();
    } else {
      // The honest carry: LAST KNOWN position, hollow + dashed.
      ctx.strokeStyle = marker.color;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = Math.max(1, w / 420);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // The STABLE identity label (never the ball — its marker reads alone).
    if (marker.kind !== "BALL") {
      const labelColor = marker.detected ? "rgba(226, 232, 240, 0.92)" : "rgba(148, 163, 184, 0.9)";
      ctx.fillStyle = labelColor;
      ctx.fillText(marker.label, marker.x, marker.y + marker.radius + 1);
      // The honest staleness note on an undetected marker.
      if (!marker.detected && marker.staleForMs > 0) {
        ctx.fillStyle = "rgba(251, 191, 36, 0.95)";
        ctx.fillText(
          `${Math.round(marker.staleForMs / 100) / 10}s`,
          marker.x,
          marker.y - labelFont - 2,
        );
      }
    }
  }
}

export function LiveTacticalRenderer({
  source,
  replay,
  onLiveWindowComplete,
}: {
  source: LiveTacticalSourceOption;
  /** L014: when present, the RECORDED frame replays through this same view. */
  replay?: LiveReplayPresentation;
  /** L014: fired when the live window ends (the surface fetches the record). */
  onLiveWindowComplete?: () => void;
}) {
  const replayActive = replay !== undefined;
  const stream = useLiveWorldStream(source.sessionId, { connect: !replayActive });
  const {
    phase,
    hello,
    frame: liveFrame,
    telemetry,
    latency,
    terminal,
    failure,
    attempt,
    recoveryBadge,
    ticker,
    staleness,
  } = stream;
  // L014: the frame this view renders — the RECORDED frame in replay mode
  // (verbatim: world version, watermark, event time are the recorded
  // values, never re-stamped), the live frame otherwise. Everything
  // downstream (the projection, the draw, the inspector) is the SAME code.
  const frame = replayActive ? (replay!.frame ?? null) : liveFrame;
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // L014: the live window's own terminal close — the surface continues
  // into the replay presentation (event-driven, never polled).
  useEffect(() => {
    if (terminal?.reason === "live-window-complete") onLiveWindowComplete?.();
  }, [terminal?.reason, onLiveWindowComplete]);

  // The canvas draw (every frame + selection change — the visible response
  // to state changes).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    drawFrame(ctx, canvas.width, canvas.height, frame, selectedRef);
    // The stalled overlay: the receipt watchdog fired — the picture is NOT
    // current and says so (never a frozen picture pretending to be live).
    if (staleness.state === "stalled") {
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
      ctx.fillRect(0, h / 2 - 44, w, 88);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `800 ${Math.max(14, Math.round(w / 42))}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = "#fbbf24";
      ctx.fillText("stalled — awaiting world state", w / 2, h / 2 - 10);
      ctx.font = `500 ${Math.max(11, Math.round(w / 70))}px ui-monospace, monospace`;
      ctx.fillStyle = "rgba(226, 232, 240, 0.9)";
      ctx.fillText(
        `no frame for ${Math.round(staleness.stalledForMs / 100) / 10}s (world v${staleness.lastWorldVersion}) — never a frozen picture`,
        w / 2,
        h / 2 + 18,
      );
    }
  }, [frame, selectedRef, staleness]);

  // The canvas click → the entity picker (hit-test the projected markers;
  // the keyboard path is the <select> below — both pin the SAME identity).
  const onCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (canvas === null || frame === null) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const px = (event.clientX - rect.left) * scaleX;
      const py = (event.clientY - rect.top) * scaleY;
      const { markers } = projectTacticalFrame(frame.entities, {
        width: canvas.width,
        height: canvas.height,
      });
      let best: { ref: string; distance: number } | null = null;
      for (const marker of markers) {
        const distance = Math.hypot(marker.x - px, marker.y - py);
        if (distance <= marker.radius + Math.max(6, canvas.width / 90)) {
          if (best === null || distance < best.distance) {
            best = { ref: marker.entityRef, distance };
          }
        }
      }
      setSelectedRef(best === null ? null : best.ref);
    },
    [frame],
  );

  // The pinned entity's LIVE state (identity continuity made inspectable:
  // the inspector follows the ENTITY REF across frames, not a position).
  const selectedEntity = useMemo(() => {
    if (frame === null || selectedRef === null) return null;
    return frame.entities.find((entity) => entity.entityRef === selectedRef) ?? null;
  }, [frame, selectedRef]);

  const teamA = frame?.entities.filter(
    (entity) => teamRefOf(entity.teamRef) === "team-home",
  ).length;
  const teamB = frame?.entities.filter(
    (entity) => teamRefOf(entity.teamRef) === "team-away",
  ).length;
  const cadenceMs = hello?.cadenceMs ?? 500;

  return (
    <section
      className="player-surface"
      data-live-phase={replayActive ? "replay" : phase}
      data-surface="live-tactical"
      data-staleness={replayActive ? "recorded" : staleness.state}
    >
      <div className="live-stage-header">
        {replayActive ? (
          // L014: the replay presentation is NEVER labelled live — the
          // recorded window replays, honestly badged.
          <span className="live-badge" data-phase="replay">
            replay
          </span>
        ) : (
          <span className={`live-badge ${phase === "live" ? "is-live" : ""}`} data-phase={phase}>
            {phase === "live" ? "live" : phase}
          </span>
        )}
        <span className="live-source-label">{source.label}</span>
        <span className="live-source-note">
          {replayActive
            ? `recorded live window — ${replay!.record.frames.length} world frames replayed VERBATIM through the same view (world versions/watermarks/timecodes unchanged, L014)`
            : `synthetic deterministic tracking (L002 source${hello !== null ? `, ${hello.cadenceMs} ms cadence` : ""}) — real SSE network transport, canonical 105 × 68 m pitch`}
        </span>
      </div>

      {!replayActive && recoveryBadge !== null && (
        <p className="form-notice" role="status" data-surface="recovery-badge">
          {recoveryBadge}
        </p>
      )}

      <div className="player-stage live-stage">
        {!replayActive && phase === "failed" ? (
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
            onClick={onCanvasClick}
            aria-label={
              frame !== null
                ? `${replayActive ? "Replay of the recorded live tactical pitch" : "Live tactical pitch"}: world version ${frame.worldVersion}, ${frame.entities.length} entities at event time ${Math.round(frame.eventTimeMs / 1000)}s${!replayActive && staleness.state === "stalled" ? " — STALLED, awaiting world state" : ""}`
                : `${replayActive ? "Replay" : "Live"} tactical pitch (connecting)`
            }
          />
        )}
      </div>

      {replayActive ? (
        <p className="live-stalled-note" role="status" data-surface="replay-note">
          replaying the recorded live window — the SAME view, the SAME view-model contracts; every
          scrub step re-renders the RECORDED frame (world version, watermark and event time are
          the values the live window emitted — never re-stamped, L014).
        </p>
      ) : (
        <p className="live-stalled-note" role="status" data-surface="stall-verdict">
          {staleness.state === "stalled"
            ? `stalled — no world frame for ${Math.round(staleness.stalledForMs / 100) / 10}s (last world version ${staleness.lastWorldVersion}); the view recovers on the next frame, never fakes one`
            : staleness.state === "awaiting-first-frame"
              ? "awaiting the first world frame…"
              : `receiving world state (tolerance ${Math.round(2.5 * cadenceMs)}ms; ${telemetry.stallEpisodes} stall${telemetry.stallEpisodes === 1 ? "" : "s"} recovered)`}
        </p>
      )}

      <div className="player-bar live-stats">
        <dl className="session-card-facts">
          <div className="fact">
            <dt>World version</dt>
            <dd>
              {frame !== null
                ? replayActive
                  ? `${frame.worldVersion} (recorded — of ${replay!.record.meta?.worldVersionLast ?? "?"})`
                  : `${frame.worldVersion} (rendered ${telemetry.renderedWorldVersion})`
                : "—"}
            </dd>
          </div>
          <div className="fact">
            <dt>Event time / watermark</dt>
            <dd>
              {frame !== null
                ? `${(frame.eventTimeMs / 1000).toFixed(1)}s / ${(frame.watermark.watermarkMs / 1000).toFixed(1)}s${replayActive ? " (recorded)" : ` (lag ${frame.telemetry.watermarkLagMs}ms)`}`
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
              {replayActive
                ? `${replay!.record.frames.length} recorded`
                : telemetry.framesReceived +
                  (telemetry.framesDropped > 0
                    ? ` (+${telemetry.framesDropped} dropped — counted)`
                    : "")}
            </dd>
          </div>
          <div className="fact">
            <dt>Update rate</dt>
            <dd>
              {replayActive
                ? replay!.record.meta?.cadenceMs !== undefined
                  ? `paced at ${replay!.record.meta.cadenceMs} ms (recorded cadence)`
                  : "—"
                : telemetry.updateRateHz > 0
                  ? `${telemetry.updateRateHz.toFixed(1)} Hz`
                  : "—"}
            </dd>
          </div>
          {!replayActive && (
            <>
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
            </>
          )}
          <div className="fact">
            <dt>Confidence (min/mean)</dt>
            <dd>
              {frame !== null
                ? `${frame.confidence.min.toFixed(2)} / ${frame.confidence.mean.toFixed(2)}`
                : "—"}
            </dd>
          </div>
        </dl>

        {/* THE IDENTITY INSPECTOR — pin an entity by its canonical ref; the
            inspector follows the IDENTITY across frames (continuity made
            inspectable; the picker is keyboard-reachable). */}
        <div className="live-entity-inspector" data-surface="entity-inspector">
          <label className="live-entity-picker-label" htmlFor="live-entity-picker">
            Inspect an entity (identity-continuous by ref)
          </label>
          <select
            id="live-entity-picker"
            className="live-entity-picker"
            value={selectedRef ?? ""}
            onChange={(event) =>
              setSelectedRef(event.target.value === "" ? null : event.target.value)
            }
          >
            <option value="">— none selected —</option>
            {(frame?.entities ?? []).map((entity) => (
              <option key={entity.entityRef} value={entity.entityRef}>
                {entityMarkerLabel(entity.entityRef)} · {entity.entityRef}
                {teamRefOf(entity.teamRef) !== null
                  ? ` (${teamRefOf(entity.teamRef) === "team-home" ? "home" : "away"})`
                  : ""}
              </option>
            ))}
          </select>
          {selectedEntity !== null ? (
            <dl className="session-card-facts">
              <div className="fact">
                <dt>Pinned entity</dt>
                <dd>
                  <code>{selectedEntity.entityRef}</code> · {selectedEntity.kind}
                  {selectedEntity.teamRef !== undefined ? ` · ${selectedEntity.teamRef}` : ""}
                </dd>
              </div>
              <div className="fact">
                <dt>Position (canonical m)</dt>
                <dd>
                  x {selectedEntity.xMeters.toFixed(2)} · y {selectedEntity.yMeters.toFixed(2)}
                </dd>
              </div>
              <div className="fact">
                <dt>Detection</dt>
                <dd>
                  <StateChip state={selectedEntity.detected ? "ready" : "degraded"}>
                    {selectedEntity.detected
                      ? "detected"
                      : `last-known (${Math.round(selectedEntity.staleForMs / 100) / 10}s stale)`}
                  </StateChip>
                </dd>
              </div>
              <div className="fact">
                <dt>Confidence</dt>
                <dd>{selectedEntity.confidence.toFixed(2)}</dd>
              </div>
            </dl>
          ) : (
            <p className="field-hint">
              Click a marker (or pick above): the pinned entity keeps its identity while its
              position updates every frame — a tracking miss shows as last-known, never a removal.
            </p>
          )}
        </div>

        {/* THE HONEST EVENT TICKER — the wire's own accounting events, newest
            first, bounded (never fabricated match events). In replay mode
            the RECORDED frame's own events list rides the inspector instead
            (the ticker is a live-receipt surface). */}
        {!replayActive && ticker.length > 0 && (
          <div className="live-event-ticker" data-surface="event-ticker">
            <h3 className="studio-subheading">Frame events (the honest accounting)</h3>
            <ul className="live-event-list">
              {ticker.map((row) => (
                <li key={row.key} className="live-event-row">
                  <span className="live-event-version">v{row.worldVersion}</span>
                  <span className="live-event-phrase">{row.phrase}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="live-latency-note">
          {replayActive
            ? "This is the REPLAY of the completed live window (L014): the recorded world frames re-render through the SAME tactical view and the SAME view-model contracts — no second presentation path, no re-stamped versions. The replay record is this transport instance's own recording; durable live-session persistence is the platform side of L014 (Worker B's lane)."
            : "The renderer consumes live world state over the real SSE transport (the W915 lane, producer re-pointed at the live tactical view-model). Updates are event-driven (the transport pushes; there is no polling loop). Latency is measured per frame (the server's generation clock → this browser's receipt clock; unsynchronized clocks — a real measurement, never a promise). The source is the L002 deterministic synthetic tracking package — honestly labeled, never a real broadcast."}
        </p>
        {source.sourceNote !== undefined && (
          <p className="live-latency-note">{source.sourceNote}</p>
        )}
        {!replayActive && terminal !== null ? (
          <p className="live-terminal-note">
            Stream closed ({terminal.reason}) — transport accounting: {terminal.deliveredFrames}{" "}
            delivered, {terminal.droppedFrames} dropped.
          </p>
        ) : null}
        {!replayActive && attempt > 0 && phase !== "failed" ? (
          <p className="live-reconnect-note">reconnecting (attempt {attempt})…</p>
        ) : null}
      </div>
    </section>
  );
}
