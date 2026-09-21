"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LIVE_CAMERA_INITIAL,
  applyLiveFrame,
  createLiveSceneState,
  liveCameraReducer,
  projectLiveScene,
} from "@sporta/renderer-3d";
import type { LiveCameraState, LiveSceneState } from "@sporta/renderer-3d";
import { useLiveWorldStream } from "@/lib/use-live-world-stream";
import {
  TACTICAL_TEAM_COLORS,
  entityMarkerColor,
  entityMarkerLabel,
} from "@/lib/live-tactical-view";
import type { LiveReplayPresentation } from "@/components/live-tactical";
import { StateChip, StatePanel } from "@/components/state-panels";

/**
 * THE LIVE 3D RENDERER (L013) — the browser's INTERACTIVE 3D view of the
 * live world state: the SAME W915 SSE world frames the tactical view
 * consumes (one transport, one world shape, two presentations), projected
 * through the renderer-3d package's own camera math via the L013 live
 * view-model adapter (`@sporta/renderer-3d`'s additive `live` seam).
 *
 * THE L013 ACCEPTANCE, AS CODE:
 *
 * - NO RENDERER-SPECIFIC WORLD TRUTH: the scene state is the adapter's
 *   VIEW carry of the wire frames (identity-continuous by `entityRef`,
 *   honest last-known carries) — the canonical SWM feeds the wire, never
 *   this component.
 * - THE CAMERA REMAINS INTERACTIVE WHILE STATE UPDATES: the camera state
 *   lives in a ref the world frames never touch (the adapter's
 *   `applyLiveFrame` has no camera input at all); drag orbits, wheel/pinch
 *   zooms, shift-drag pans, double-click resets — all while frames keep
 *   flowing and the scene keeps updating underneath.
 * - STATE UPDATES FLOW WITHOUT A RENDERER RESTART: each world frame is
 *   applied to the carried scene (per-entity, identity-continuous) and the
 *   canvas redraws — no remount, no reset, no re-subscribe.
 * - HONEST DEGRADED STATES: the same receipt watchdog (never a frozen
 *   picture), the recovery badge, the degraded quality chip, the watermark
 *   lag, and the undetected carry (hollow figures at last-known positions
 *   with their staleness).
 */

/** One live tactical source the 3D renderer streams (the same sessions). */
export interface Live3dSourceOption {
  sessionId: string;
  label: string;
  storyKey: string;
  sourceNote?: string;
}

/** The drag sensitivity (degrees per pixel — a documented constant). */
const ORBIT_DEG_PER_PX = 0.3;
/** The wheel zoom sensitivity (per wheel notch — a documented constant). */
const ZOOM_PER_NOTCH = 1.15;

export function Live3dRenderer({
  source,
  replay,
  onLiveWindowComplete,
}: {
  source: Live3dSourceOption;
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
  // L014: the frame this view applies — the RECORDED frame in replay mode
  // (verbatim), the live frame otherwise. The adapter, the camera, the
  // projection — all the SAME code paths.
  const frame = replayActive ? (replay!.frame ?? null) : liveFrame;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // THE CAMERA: a ref the world frames NEVER touch (interactive by design).
  const cameraRef = useRef<LiveCameraState>({ ...LIVE_CAMERA_INITIAL });
  const [cameraVersion, setCameraVersion] = useState(0);
  const [cameraNote, setCameraNote] = useState<string | null>(null);
  // THE SCENE: the adapter's carried view state (identity-continuous).
  const sceneRef = useRef<LiveSceneState>(createLiveSceneState());
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    pan: boolean;
  } | null>(null);
  const pinchRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchDistanceRef = useRef<number | null>(null);

  /** Applies one camera action + bumps the redraw (the only camera writer). */
  const act = useCallback((action: Parameters<typeof liveCameraReducer>[1], note?: string) => {
    cameraRef.current = liveCameraReducer(cameraRef.current, action);
    setCameraVersion((version) => version + 1);
    if (note !== undefined) setCameraNote(note);
  }, []);

  // Apply every world frame to the carried scene (update continuity — no
  // restart, no reset; the camera is not an input here, by construction).
  // L014: in replay mode this applies the RECORDED frame at the scrub
  // cursor — the same identity-continuous carry, the same honest semantics.
  useEffect(() => {
    if (frame === null) return;
    sceneRef.current = applyLiveFrame(sceneRef.current, frame).state;
  }, [frame]);

  // L014: the live window's own terminal close — the surface continues
  // into the replay presentation (event-driven, never polled).
  useEffect(() => {
    if (terminal?.reason === "live-window-complete") onLiveWindowComplete?.();
  }, [terminal?.reason, onLiveWindowComplete]);

  // The canvas draw: every world frame, camera change, or selection change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    // The sky (a plain dark backdrop — the pitch carries the scene).
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, w, h);
    const projected = projectLiveScene(sceneRef.current, cameraRef.current, {
      width: w,
      height: h,
    });
    // The pitch ground (painter order: ground, then lines, then figures).
    if (projected.pitch.points.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(projected.pitch.points[0]!.x, projected.pitch.points[0]!.y);
      for (const point of projected.pitch.points.slice(1)) {
        ctx.lineTo(point.x, point.y);
      }
      ctx.closePath();
      ctx.fillStyle = "#2f7d4f";
      ctx.fill();
      ctx.strokeStyle = "rgba(226, 232, 240, 0.35)";
      ctx.lineWidth = Math.max(1, w / 640);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(226, 232, 240, 0.75)";
    ctx.lineWidth = Math.max(1, w / 720);
    ctx.beginPath();
    for (const segment of projected.lines) {
      ctx.moveTo(segment.a.x, segment.a.y);
      ctx.lineTo(segment.b.x, segment.b.y);
    }
    ctx.stroke();
    // The entity billboards, painter-sorted by depth (far first).
    const sorted = [...projected.entities].sort((a, b) => b.depthMeters - a.depthMeters);
    const labelFont = Math.max(9, Math.round(w / 84));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `700 ${labelFont}px ui-monospace, monospace`;
    for (const entity of sorted) {
      const color =
        entity.kind === "BALL"
          ? "#f8fafc"
          : entity.teamRef !== undefined && entity.teamRef in TACTICAL_TEAM_COLORS
            ? TACTICAL_TEAM_COLORS[entity.teamRef as keyof typeof TACTICAL_TEAM_COLORS]
            : entityMarkerColor({ kind: entity.kind });
      // The selection ring (the pinned identity, visible across frames).
      if (selectedRef !== null && entity.entityRef === selectedRef) {
        ctx.beginPath();
        ctx.arc(
          entity.base.x,
          entity.base.y,
          entity.radiusPx + Math.max(3, w / 200),
          0,
          Math.PI * 2,
        );
        ctx.strokeStyle = "#fde68a";
        ctx.lineWidth = Math.max(1.5, w / 460);
        ctx.setLineDash([]);
        ctx.stroke();
      }
      if (entity.kind === "BALL") {
        ctx.beginPath();
        ctx.arc(entity.base.x, entity.base.y, entity.radiusPx, 0, Math.PI * 2);
        ctx.fillStyle = entity.detected ? color : "rgba(248, 250, 252, 0.35)";
        ctx.fill();
        ctx.strokeStyle = "rgba(15, 23, 42, 0.85)";
        ctx.lineWidth = Math.max(1, w / 640);
        ctx.stroke();
        continue;
      }
      // The figure billboard: a rounded capsule from base to head.
      ctx.beginPath();
      ctx.moveTo(entity.base.x, entity.base.y);
      ctx.lineTo(entity.head.x, entity.head.y);
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(2, entity.radiusPx * 2);
      if (entity.detected) {
        ctx.strokeStyle = color;
        ctx.setLineDash([]);
        ctx.stroke();
        // A darker outline for figure separation.
        ctx.lineWidth = Math.max(1, entity.radiusPx * 0.35);
        ctx.strokeStyle = "rgba(15, 23, 42, 0.6)";
        ctx.stroke();
      } else {
        // The honest carry: hollow (dashed) at the LAST KNOWN position.
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.75;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      ctx.lineCap = "butt";
      // The stable identity label when the figure is close enough to read.
      if (entity.depthMeters < 90 || selectedRef === entity.entityRef) {
        ctx.fillStyle = entity.detected ? "rgba(226, 232, 240, 0.92)" : "rgba(148, 163, 184, 0.9)";
        ctx.fillText(entityMarkerLabel(entity.entityRef), entity.base.x, entity.base.y + 2);
        if (!entity.detected && entity.staleForMs > 0) {
          ctx.fillStyle = "rgba(251, 191, 36, 0.95)";
          ctx.fillText(
            `${Math.round(entity.staleForMs / 100) / 10}s`,
            entity.base.x,
            entity.base.y - labelFont - 2,
          );
        }
      }
    }
    // The stalled overlay: the receipt watchdog fired — the picture is NOT
    // current and says so (never a frozen picture pretending to be live).
    if (staleness.state === "stalled") {
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
  }, [frame, cameraVersion, selectedRef, staleness]);

  // The pointer interactions (orbit / pan / pinch-zoom — the camera is the
  // user's; world state never moves it).
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    pinchRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchRef.current.size === 2) {
      const [a, b] = [...pinchRef.current.values()];
      pinchDistanceRef.current = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      dragRef.current = null;
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pan: event.shiftKey || event.button === 1,
    };
  }, []);
  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (pinchRef.current.has(event.pointerId)) {
        pinchRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (pinchRef.current.size === 2 && pinchDistanceRef.current !== null) {
        const [a, b] = [...pinchRef.current.values()];
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const factor = distance / pinchDistanceRef.current;
        if (Math.abs(factor - 1) > 0.02) {
          act({ kind: "zoom", factor }, "pinch zoom");
          pinchDistanceRef.current = distance;
        }
        return;
      }
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (drag.pan) {
        act({ kind: "pan", deltaX: dx, deltaY: dy }, "pan");
      } else {
        act(
          {
            kind: "orbit",
            deltaAzimuthDeg: dx * ORBIT_DEG_PER_PX,
            deltaElevationDeg: -dy * ORBIT_DEG_PER_PX,
          },
          "orbit",
        );
      }
    },
    [act],
  );
  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    pinchRef.current.delete(event.pointerId);
    if (pinchRef.current.size < 2) pinchDistanceRef.current = null;
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }, []);
  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      act({ kind: "zoom", factor: Math.pow(ZOOM_PER_NOTCH, -Math.sign(event.deltaY)) }, "zoom");
    },
    [act],
  );
  const onDoubleClick = useCallback(() => {
    cameraRef.current = { ...LIVE_CAMERA_INITIAL };
    setCameraVersion((version) => version + 1);
    setCameraNote("reset to the broadcast framing (your explicit action)");
  }, []);
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      const step = event.shiftKey ? 10 : 3;
      switch (event.key) {
        case "ArrowLeft":
          act({ kind: "orbit", deltaAzimuthDeg: -step, deltaElevationDeg: 0 }, "orbit (keyboard)");
          break;
        case "ArrowRight":
          act({ kind: "orbit", deltaAzimuthDeg: step, deltaElevationDeg: 0 }, "orbit (keyboard)");
          break;
        case "ArrowUp":
          act({ kind: "orbit", deltaAzimuthDeg: 0, deltaElevationDeg: step }, "orbit (keyboard)");
          break;
        case "ArrowDown":
          act({ kind: "orbit", deltaAzimuthDeg: 0, deltaElevationDeg: -step }, "orbit (keyboard)");
          break;
        case "+":
        case "=":
          act({ kind: "zoom", factor: 1.2 }, "zoom (keyboard)");
          break;
        case "-":
          act({ kind: "zoom", factor: 1 / 1.2 }, "zoom (keyboard)");
          break;
        case "0":
          cameraRef.current = { ...LIVE_CAMERA_INITIAL };
          setCameraVersion((version) => version + 1);
          setCameraNote("reset to the broadcast framing (your explicit action)");
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [act],
  );

  // The canvas click → the entity picker (hit-test the projected billboards;
  // the depth-sorted nearest wins; the keyboard path is the picker below).
  const onCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const rect = canvas.getBoundingClientRect();
    const px = (event.clientX - rect.left) * (canvas.width / rect.width);
    const py = (event.clientY - rect.top) * (canvas.height / rect.height);
    const projected = projectLiveScene(sceneRef.current, cameraRef.current, {
      width: canvas.width,
      height: canvas.height,
    });
    let best: { ref: string; distance: number } | null = null;
    for (const entity of projected.entities) {
      const distance = Math.hypot(entity.base.x - px, entity.base.y - py);
      if (distance <= Math.max(entity.radiusPx * 2, 10)) {
        if (best === null || distance < best.distance) best = { ref: entity.entityRef, distance };
      }
    }
    setSelectedRef(best === null ? null : best.ref);
  }, []);

  // The pinned entity's LIVE state (identity continuity made inspectable).
  const selectedEntity = useMemo(() => {
    if (selectedRef === null) return null;
    return sceneRef.current.entities.get(selectedRef) ?? null;
    // The frame drives the re-derivation (the ref's content changes with it).
  }, [selectedRef, frame]);
  const camera = cameraRef.current;
  const cadenceMs = hello?.cadenceMs ?? 500;

  return (
    <section
      className="player-surface"
      data-live-phase={replayActive ? "replay" : phase}
      data-surface="live-3d"
      data-staleness={replayActive ? "recorded" : staleness.state}
    >
      <div className="live-stage-header">
        {replayActive ? (
          <span className="live-badge" data-phase="replay">
            replay
          </span>
        ) : (
          <span className={`live-badge ${phase === "live" ? "is-live" : ""}`} data-phase={phase}>
            {phase === "live" ? "live" : phase}
          </span>
        )}
        <span className="live-source-label">{source.label} — 3D view</span>
        <span className="live-source-note">
          {replayActive
            ? "the recorded live window in 3D — the SAME frames, the SAME adapter, your camera (L014 replay)"
            : "the SAME live world state as the tactical view, rendered in 3D — the camera is yours: state updates never move it (L013)"}
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
            title="The live 3D view could not be displayed"
            reason={failure ?? "an unexpected live failure"}
          />
        ) : (
          <canvas
            ref={canvasRef}
            width={960}
            height={600}
            className="live-tactical-canvas"
            role="img"
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            onDoubleClick={onDoubleClick}
            onKeyDown={onKeyDown}
            onClick={onCanvasClick}
            aria-label={
              frame !== null
                ? `${replayActive ? "Replay of the recorded live 3D pitch view" : "Live 3D pitch view"}: world version ${frame.worldVersion}, ${frame.entities.length} entities at event time ${Math.round(frame.eventTimeMs / 1000)}s. Drag or use arrow keys to orbit the camera, scroll or plus and minus to zoom, shift-drag to pan, zero to reset.${!replayActive && staleness.state === "stalled" ? " Currently STALLED, awaiting world state." : ""}`
                : `${replayActive ? "Replay" : "Live"} 3D pitch view (connecting)`
            }
          />
        )}
      </div>

      {replayActive ? (
        <p className="live-stalled-note" role="status" data-surface="replay-note">
          replaying the recorded live window in 3D — the SAME adapter applies the RECORDED frames
          (identity-continuous by ref, world versions verbatim); your camera stays yours (L014)
        </p>
      ) : (
        <p className="live-stalled-note" role="status" data-surface="stall-verdict">
          {staleness.state === "stalled"
            ? `stalled — no world frame for ${Math.round(staleness.stalledForMs / 100) / 10}s (last world version ${staleness.lastWorldVersion}); the view recovers on the next frame, never fakes one`
            : staleness.state === "awaiting-first-frame"
              ? "awaiting the first world frame…"
              : `receiving world state (tolerance ${Math.round(2.5 * cadenceMs)}ms; ${telemetry.stallEpisodes} stall${telemetry.stallEpisodes === 1 ? "" : "s"} recovered)`}
          {" · camera: "}
          <code>
            az {Math.round(camera.azimuthDeg)}° · el {Math.round(camera.elevationDeg)}° · d{" "}
            {Math.round(camera.distanceM)}m · target ({Math.round(camera.target.x)},{" "}
            {Math.round(camera.target.y)})
          </code>
          {cameraNote !== null ? ` · ${cameraNote}` : ""}
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
          {!replayActive && (
            <>
              <div className="fact">
                <dt>Update rate</dt>
                <dd>
                  {telemetry.updateRateHz > 0 ? `${telemetry.updateRateHz.toFixed(1)} Hz` : "—"}
                </dd>
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
            </>
          )}
        </dl>

        {/* THE IDENTITY INSPECTOR (the 3D view's own, same canonical refs). */}
        <div className="live-entity-inspector" data-surface="entity-inspector">
          <label className="live-entity-picker-label" htmlFor="live-3d-entity-picker">
            Inspect an entity (identity-continuous by ref)
          </label>
          <select
            id="live-3d-entity-picker"
            className="live-entity-picker"
            value={selectedRef ?? ""}
            onChange={(event) =>
              setSelectedRef(event.target.value === "" ? null : event.target.value)
            }
          >
            <option value="">— none selected —</option>
            {[...sceneRef.current.entities.values()].map((entity) => (
              <option key={entity.entityRef} value={entity.entityRef}>
                {entityMarkerLabel(entity.entityRef)} · {entity.entityRef}
                {entity.teamRef !== undefined ? ` · ${entity.teamRef}` : ""}
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
              Click a figure (or pick above). Drag or arrow keys orbit · scroll or +/− zoom ·
              shift-drag pans · 0 or double-click resets — the world keeps updating underneath,
              never the camera.
            </p>
          )}
        </div>

        {/* THE HONEST EVENT TICKER (the same wire accounting, bounded — a
            live-receipt surface; hidden in replay mode). */}
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
            ? "This is the 3D REPLAY of the completed live window (L014): the SAME interactive 3D view applies the RECORDED world frames through the SAME renderer-3d live adapter — one view-model contract, two presentations, zero second world truth. The replay record is this transport instance's own recording; durable live-session persistence is the platform side of L014 (Worker B's lane)."
            : "The 3D view consumes the SAME live world frames as the tactical view (one W915 stream, one world shape — projected through the renderer-3d live adapter, the renderer's own camera math). The camera is interactive state the world never touches; figures update per frame without any restart. The source is the L002 deterministic synthetic tracking package — honestly labeled, never a real broadcast."}
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
