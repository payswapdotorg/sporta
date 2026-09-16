"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  CapabilityLike,
  RenderOutputLike,
  WatchModelLike,
} from "@/lib/api-types";
import { ApiError } from "@/lib/client-api";
import type { FetchState } from "@/lib/client-api";
import { fetchCapability, fetchRenderOutput, fetchWatchModel } from "@/lib/client-api";
import {
  advanceFramePlayer,
  deriveFrameRateProfile,
  formatDisplayMs,
  frameIndexAtMs,
  framePlayerModel,
  initialFramePlayer,
  pauseFramePlayer,
  placeEventMarkers,
  playFramePlayer,
  seekFramePlayer,
  setDisplayRate,
  type EventMarker,
  type FramePlayerModel,
  type FramePlayerState,
} from "@/lib/frame-display";
import { prepareFrameForDisplay } from "@/lib/frame-svg";
import {
  createRealityMachine,
  switchReality,
  type RealityMachineState,
} from "@/lib/reality-machine";
import {
  deriveRealityOptions,
  deriveWatchState,
  formatTimelineMs,
  type RealityOption,
} from "@/lib/surface-state";
import { LoadingPanel, StateChip, StatePanel } from "@/components/state-panels";
import { ROUTES } from "@/lib/navigation";

/**
 * THE WATCH EXPERIENCE (W905): one match, many realities.
 *
 * - The MATCH SESSION is constant for the page's life; the Reality Switcher
 *   swaps only the selected renderer (client state — the pure
 *   `reality-machine`) and fetches that renderer's output for the SAME
 *   session. No navigation, no match reload (Simulation G).
 * - The primary player plays the REAL stored output frame by frame on the
 *   artifact's OWN manifest clock: play/pause, a timeline scrubber that
 *   SNAPS to the nearest real frame (frames are discrete — the player never
 *   interpolates a frame that does not exist), and event markers placed at
 *   the frames the render's own provenance says applied each real SWM
 *   event. Render outputs are animated-SVG review artifacts — honestly
 *   labeled as such, never presented as video.
 * - Availability is capability-driven + rights-aware: an option with no
 *   output for this session shows WHY (requires render / no stored output /
 *   rights / renderer unavailable) — never a fake "coming soon".
 * - Panels without real data show honest unavailable states (the
 *   deferred-surfaces posture): Camera needs live production (W915),
 *   Highlights have no real data this wave.
 */

/** The watch page's tab set (ux-architecture: Renderer | Camera | Commentary | Tactics | Stats | Highlights). */
const WATCH_TABS = [
  { id: "renderer", label: "Renderer" },
  { id: "camera", label: "Camera" },
  { id: "commentary", label: "Commentary" },
  { id: "tactics", label: "Tactics" },
  { id: "stats", label: "Stats" },
  { id: "highlights", label: "Highlights" },
] as const;

type WatchTabId = (typeof WATCH_TABS)[number]["id"];

export function WatchExperience({
  sessionId,
  initialRenderer,
}: {
  sessionId: string | null;
  initialRenderer: string | null;
}) {
  const [capability, setCapability] = useState<FetchState<CapabilityLike>>({ phase: "loading" });
  const [watch, setWatch] = useState<FetchState<WatchModelLike>>({ phase: "loading" });
  const [tab, setTab] = useState<WatchTabId>("renderer");
  const [machine, setMachine] = useState<RealityMachineState | null>(null);
  const [switchNotice, setSwitchNotice] = useState<string | null>(null);

  useEffect(() => {
    void fetchCapability().then(
      (data) => setCapability({ phase: "ready", data }),
      (error) => setCapability({ phase: "failed", error: String(error) }),
    );
  }, []);

  useEffect(() => {
    if (sessionId === null) return;
    setWatch({ phase: "loading" });
    void fetchWatchModel(sessionId).then(
      (data) => setWatch({ phase: "ready", data }),
      (error) =>
        setWatch({
          phase: "failed",
          error: String(error),
          status: error instanceof ApiError ? error.status : undefined,
        }),
    );
  }, [sessionId]);

  const options = useMemo(
    () =>
      capability.phase === "ready" && watch.phase === "ready"
        ? deriveRealityOptions(capability.data, watch.data)
        : null,
    [capability, watch],
  );

  // The Reality Switcher's machine: created ONCE per session when the
  // options arrive — the session is frozen into it for the page's life.
  useEffect(() => {
    if (options === null || sessionId === null) return;
    setMachine((current) => current ?? createRealityMachine(sessionId, options, initialRenderer));
  }, [options, sessionId, initialRenderer]);

  if (sessionId === null) {
    return (
      <StatePanel
        state="unavailable"
        title="No match selected"
        reason="Open a card from Home or Explore to watch a match. The watch surface always needs a real session."
      />
    );
  }
  if (capability.phase === "loading" || watch.phase === "loading") {
    return <LoadingPanel label="Loading the match" />;
  }
  if (capability.phase === "failed") {
    return (
      <StatePanel
        state="failed"
        title="The capability state could not be read"
        reason="The capability request failed — a real failure, not simulated."
      />
    );
  }
  if (watch.phase === "failed") {
    if (watch.status === 404) {
      return (
        <StatePanel
          state="unavailable"
          title="No such match session"
          reason={`The control plane has no session '${sessionId}'. This is the real answer, not a placeholder.`}
        />
      );
    }
    return <StatePanel state="failed" title="The match could not be read" reason={watch.error} />;
  }

  const currentOptions = options ?? [];
  const verdict = deriveWatchState(capability.data, watch.data);
  const effectiveMachine =
    machine ??
    createRealityMachine(sessionId, currentOptions, initialRenderer);
  const selectedOption =
    effectiveMachine.selectedRendererId === null
      ? null
      : (currentOptions.find((option) => option.rendererId === effectiveMachine.selectedRendererId) ??
        null);

  /** One reality switch: same session, new renderer (Simulation G). */
  const onSwitch = (rendererId: string) => {
    const transition = switchReality(effectiveMachine, currentOptions, rendererId);
    if (transition.status === "switched") {
      setMachine(transition.state);
      setSwitchNotice(null);
      return;
    }
    setSwitchNotice(`${rendererId}: ${transition.reason}`);
  };

  return (
    <div className="watch-layout">
      <div className="watch-main">
        <MatchHeader watch={watch.data} verdict={verdict} />
        {selectedOption === null ? (
          <StatePanel
            state={verdict.state === "denied" ? "denied" : "unavailable"}
            title="Nothing to play for this match"
            reason={verdict.reason}
          />
        ) : (
          <PlayerSection
            sessionId={sessionId}
            option={selectedOption}
            eventTail={watch.data.eventTail}
          />
        )}
        <WatchTabsPanel
          tab={tab}
          onTab={setTab}
          capability={capability.data}
          watch={watch.data}
          option={selectedOption}
        />
      </div>
      <aside className="watch-side">
        <RealitySwitcher
          options={currentOptions}
          selected={effectiveMachine.selectedRendererId}
          notice={switchNotice}
          onSelect={onSwitch}
        />
        <SessionFactsSection watch={watch.data} />
      </aside>
    </div>
  );
}

/** The match header: real session identity + the playback verdict. */
function MatchHeader({
  watch,
  verdict,
}: {
  watch: WatchModelLike;
  verdict: { state: string; reason: string };
}) {
  return (
    <header className="match-header">
      <p className="page-kicker">Match session {watch.sessionId}</p>
      <h1 className="match-title">{watch.label}</h1>
      <dl className="session-card-facts">
        <div className="fact">
          <dt>Event status</dt>
          <dd>{watch.status}</dd>
        </div>
        <div className="fact">
          <dt>Created</dt>
          <dd>{new Date(watch.createdAtIso).toLocaleString("en-GB", { timeZone: "UTC" })}</dd>
        </div>
        <div className="fact">
          <dt>Playback</dt>
          <dd>
            <StateChip state={watch.playback.state === "authorized" ? "authorized" : "denied"}>
              {watch.playback.state}
            </StateChip>
          </dd>
        </div>
      </dl>
      <p className="section-lede">{verdict.reason}</p>
    </header>
  );
}

// ---------------------------------------------------------------------------
// The primary player surface (plays the REAL stored output)
// ---------------------------------------------------------------------------

type OutputState =
  | { phase: "loading" }
  | { phase: "ready"; data: RenderOutputLike }
  | { phase: "denied"; reason: string }
  | { phase: "nothing"; reason: string }
  | { phase: "failed"; error: string };

/**
 * The primary player: acquires the selected reality's stored output through
 * the playback gate, then plays it frame by frame on the artifact's own
 * manifest clock.
 */
function PlayerSection({
  sessionId,
  option,
  eventTail,
}: {
  sessionId: string;
  option: RealityOption;
  eventTail: WatchModelLike["eventTail"];
}) {
  const [output, setOutput] = useState<OutputState>({ phase: "loading" });
  const [player, setPlayer] = useState<FramePlayerState | null>(null);

  // The Simulation G fetch: the SAME session, the newly-selected renderer's
  // output — the only I/O a switch performs (the page never reloads).
  useEffect(() => {
    if (option.renderId === undefined || option.segmentId === undefined) {
      setOutput({ phase: "nothing", reason: option.reason });
      return;
    }
    let cancelled = false;
    setOutput({ phase: "loading" });
    void fetchRenderOutput(sessionId, option.renderId, option.segmentId).then(
      (data) => {
        if (cancelled) return;
        setOutput({ phase: "ready", data });
      },
      (error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) {
          setOutput({
            phase: "denied",
            reason: "the playback gate denied this read before any byte was exposed",
          });
        } else {
          setOutput({ phase: "failed", error: String(error) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sessionId, option.renderId, option.segmentId, option.reason]);

  const model = useMemo(
    () => (output.phase === "ready" ? framePlayerModel(output.data.manifest) : null),
    [output],
  );

  // A new artifact (or a new reality) resets the transport to its first frame.
  useEffect(() => {
    setPlayer(model === null ? null : initialFramePlayer(model));
  }, [model]);

  // The play loop: real elapsed time advances the playhead on the
  // manifest's document timeline (scaled by the explicit display rate).
  useEffect(() => {
    if (player === null || model === null || !playing) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const delta = now - last;
      last = now;
      setPlayer((current) =>
        current === null ? current : advanceFramePlayer(current, model, delta),
      );
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, model, player === null]);

  const markers = useMemo(
    () =>
      model === null || output.phase !== "ready"
        ? []
        : placeEventMarkers(model, eventTail ?? [], output.data.manifest.sourceManifest),
    [model, eventTail, output],
  );
  const profile = useMemo(() => (model === null ? null : deriveFrameRateProfile(model)), [model]);
  const playing = player?.playing ?? false;

  if (output.phase === "loading") {
    return (
      <section className="player-surface" aria-busy="true">
        <LoadingPanel label={`Fetching the ${option.rendererId} output`} />
      </section>
    );
  }
  if (output.phase === "denied") {
    return (
      <section className="player-surface">
        <StatePanel state="denied" title="Playback denied" reason={output.reason} />
      </section>
    );
  }
  if (output.phase === "nothing") {
    return (
      <section className="player-surface">
        <StatePanel
          state="unavailable"
          title={`The ${option.rendererId} reality has no output`}
          reason={output.reason}
        />
      </section>
    );
  }
  if (output.phase === "failed") {
    return (
      <section className="player-surface">
        <StatePanel state="failed" title="The output could not be read" reason={output.error} />
      </section>
    );
  }
  if (model === null || player === null) {
    return (
      <section className="player-surface" aria-busy="true">
        <LoadingPanel label="Preparing the player" />
      </section>
    );
  }

  return (
    <FramePlayerView
      output={output.data}
      model={model}
      player={player}
      markers={markers}
      profile={profile}
      onPlayer={setPlayer}
      rendererId={option.rendererId}
    />
  );
}

/** The rendered frame player: stage + transport + scrub timeline + markers. */
function FramePlayerView({
  output,
  model,
  player,
  markers,
  profile,
  onPlayer,
  rendererId,
}: {
  output: RenderOutputLike;
  model: FramePlayerModel;
  player: FramePlayerState;
  markers: EventMarker[];
  profile: ReturnType<typeof deriveFrameRateProfile>;
  onPlayer: (next: FramePlayerState) => void;
  rendererId: string;
}) {
  const frameIndex = frameIndexAtMs(model, player.playheadMs);
  const sourceFrame =
    output.manifest.sourceManifest.frames.find((frame) => frame.frameIndex === frameIndex) ?? null;
  const totalFrames = model.windows.length;

  // The display document: the REAL stored artifact with the selected frame's
  // group shown (the transform is pure + fail-closed — see frame-svg.ts).
  const prepared = useMemo(() => {
    if (frameIndex < 0) {
      return { ok: false as const, error: "this artifact carries no frames" };
    }
    try {
      return { ok: true as const, svg: prepareFrameForDisplay(output.content, frameIndex) };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  }, [output.content, frameIndex]);

  return (
    <section className="player-surface" data-renderer={rendererId}>
      {prepared.ok ? (
        <div
          className="player-stage"
          // The stored output is the deterministic W504 encoder's own SVG
          // (no scripts, no external resources — verified per frame by the
          // fail-closed prepare step above).
          role="img"
          aria-label={`The ${rendererId} rendering of match session ${output.sessionId}, frame ${frameIndex + 1} of ${totalFrames}`}
          dangerouslySetInnerHTML={{ __html: prepared.svg }}
        />
      ) : (
        <div className="player-stage">
          <StatePanel
            state="failed"
            title="The frame could not be displayed"
            reason={prepared.error}
          />
        </div>
      )}

      <div className="player-bar">
        <button
          type="button"
          className="button-ghost player-toggle"
          onClick={() => onPlayer(player.ended ? playFramePlayer(player, model) : player.playing ? pauseFramePlayer(player) : playFramePlayer(player, model))}
        >
          {player.playing ? "Pause" : player.ended ? "Replay" : "Play"}
        </button>
        <p className="player-clock" aria-live="off">
          <span className="player-clock-time">
            {formatDisplayMs(player.playheadMs)} / {formatDisplayMs(model.totalDurationMs)}
          </span>
          <span className="player-clock-frame">
            frame {frameIndex >= 0 ? frameIndex + 1 : 0} of {totalFrames}
          </span>
        </p>
        {profile !== null && profile.supported && (
          <div className="player-rate" role="group" aria-label="Display cadence">
            {profile.rates.map((rate) => (
              <button
                key={rate}
                type="button"
                className={`player-rate-option ${player.rate === rate ? "active" : ""}`}
                aria-pressed={player.rate === rate}
                onClick={() => onPlayer(setDisplayRate(player, rate))}
              >
                {rate === 1 ? "1×" : rate === 0.5 ? "½×" : `${rate}×`}
              </button>
            ))}
          </div>
        )}
        <p className="review-format-note" role="note">
          Rendered output — review format: this is the real stored artifact (a self-contained
          animated-SVG segment), displayed frame by frame on its own manifest clock. Sporta&rsquo;s
          renderers emit SVG review outputs this wave; there is no video codec to fake here.
        </p>
      </div>

      <div className="player-scrub">
        <label className="sr-only" htmlFor="player-seek">
          Seek the rendered output
        </label>
        <input
          id="player-seek"
          className="player-seek"
          type="range"
          min={0}
          max={Math.max(1, model.totalDurationMs)}
          step={1}
          value={Math.min(player.playheadMs, model.totalDurationMs)}
          aria-valuetext={`${formatDisplayMs(player.playheadMs)}, frame ${frameIndex >= 0 ? frameIndex + 1 : 0} of ${totalFrames}`}
          aria-disabled={model.windows.length === 0}
          onChange={(event) => onPlayer(seekFramePlayer(player, model, Number(event.target.value)))}
        />
        <div className="timeline-track player-track" aria-hidden="true">
          {model.windows.map((window) => (
            <span
              key={window.frameIndex}
              className={`timeline-frame ${window.frameIndex === frameIndex ? "current" : ""}`}
              style={{ flexGrow: Math.max(1, window.endMs - window.beginMs) }}
            />
          ))}
          {markers
            .filter((marker) => marker.markerMs !== null)
            .map((marker) => (
              <span
                key={marker.sequence}
                className="timeline-marker"
                style={{ left: `${(marker.markerMs! / Math.max(1, model.totalDurationMs)) * 100}%` }}
              >
                <span className="timeline-marker-dot" />
              </span>
            ))}
        </div>
        <ul className="marker-list player-markers">
          {markers.map((marker) => (
            <li key={marker.sequence}>
              {marker.frameIndex !== null ? (
                <button
                  type="button"
                  className="marker-jump"
                  onClick={() => onPlayer(seekFramePlayer(player, model, marker.markerMs ?? 0))}
                >
                  <span className="marker-time">{formatDisplayMs(marker.markerMs ?? 0)}</span>
                  <span className="marker-phrase">{marker.eventTypeRef}</span>
                  <span className="marker-meta">
                    frame {marker.frameIndex + 1} · seek snaps to the nearest real frame
                  </span>
                </button>
              ) : (
                <span className="marker-unplaced">
                  <span className="marker-phrase">{marker.eventTypeRef}</span>
                  <span className="marker-meta">{marker.reason}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <dl className="session-card-facts player-frame-facts">
        <div className="fact">
          <dt>Match clock</dt>
          <dd>{sourceFrame?.captions.clockText ?? "—"}</dd>
        </div>
        <div className="fact">
          <dt>Status</dt>
          <dd>{sourceFrame?.captions.statusLine ?? "—"}</dd>
        </div>
        <div className="fact">
          <dt>Score</dt>
          <dd>
            {sourceFrame !== null &&
            sourceFrame.captions.score !== null &&
            sourceFrame.captions.score.displayed
              ? (sourceFrame.captions.score.text ?? sourceFrame.captions.score.status)
              : "—"}
          </dd>
        </div>
        <div className="fact">
          <dt>Event on frame</dt>
          <dd>
            {sourceFrame !== null && sourceFrame.captions.events.length > 0
              ? sourceFrame.captions.events.map((event) => event.phrase).join("; ")
              : "—"}
          </dd>
        </div>
      </dl>

      <div className="frame-entities">
        <h3 className="section-subtitle">
          Entities on frame {frameIndex + 1} — real manifest accounting
        </h3>
        {sourceFrame === null || sourceFrame.entities.length === 0 ? (
          <p className="section-lede">This frame&rsquo;s manifest records no entities.</p>
        ) : (
          <table className="tactics-table">
            <caption className="sr-only">{`Entity dispositions at the displayed frame${sourceFrame.captions.clockText !== null ? ` (clock ${sourceFrame.captions.clockText})` : ""}`}</caption>
            <thead>
              <tr>
                <th scope="col">Entity</th>
                <th scope="col">Kind</th>
                <th scope="col">Position (m)</th>
                <th scope="col">Confidence</th>
                <th scope="col">Disposition</th>
              </tr>
            </thead>
            <tbody>
              {sourceFrame.entities.map((entity) => (
                <tr key={entity.entityId}>
                  <td>
                    <code>{entity.entityId}</code>
                  </td>
                  <td>{entity.kind}</td>
                  <td>
                    {entity.positionMeters !== undefined
                      ? `${entity.positionMeters.x.toFixed(1)}, ${entity.positionMeters.y.toFixed(1)}`
                      : "—"}
                  </td>
                  <td>{entity.confidence !== undefined ? entity.confidence.toFixed(2) : "—"}</td>
                  <td>{entity.disposition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ProvenancePanel output={output} profile={profile} />
    </section>
  );
}

/** The artifact's provenance: real hashes, sizes, renderer identity, degradation. */
function ProvenancePanel({
  output,
  profile,
}: {
  output: RenderOutputLike;
  profile: ReturnType<typeof deriveFrameRateProfile> | null;
}) {
  const source = output.manifest.sourceManifest;
  return (
    <section className="provenance-panel" aria-label="Output provenance">
      <h2 className="section-title">Provenance — the real artifact</h2>
      <dl className="session-card-facts">
        <div className="fact">
          <dt>Renderer</dt>
          <dd>
            <code>{source.renderer.rendererId}</code>@{source.renderer.rendererVersion}
          </dd>
        </div>
        <div className="fact">
          <dt>Style</dt>
          <dd>{source.renderer.styleId}</dd>
        </div>
        <div className="fact">
          <dt>Stored bytes</dt>
          <dd>
            {output.byteLength} B · <code>{output.contentHash.slice(0, 12)}…</code>
          </dd>
        </div>
        <div className="fact">
          <dt>Frames</dt>
          <dd>
            {output.manifest.frameCount} over {output.manifest.totalDurationMs} ms (document clock)
          </dd>
        </div>
        <div className="fact">
          <dt>Output window</dt>
          <dd>
            session {formatTimelineMs(source.output.startMs)}–
            {formatTimelineMs(source.output.startMs + source.output.durationMs)} · frame interval{" "}
            {source.output.frameIntervalMs} ms
          </dd>
        </div>
        {profile !== null && profile.baseFrameMs !== null && (
          <div className="fact">
            <dt>Display cadence</dt>
            <dd>{profile.reason}</dd>
          </div>
        )}
        <div className="fact">
          <dt>Degradation</dt>
          <dd>
            <StateChip state={source.degradation.degraded ? "degraded" : "ready"}>
              {source.degradation.degraded
                ? (source.degradation.reasons.join(", ") || "degraded")
                : "not degraded"}
            </StateChip>
          </dd>
        </div>
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The tabs (Renderer | Camera | Commentary | Tactics | Stats | Highlights)
// ---------------------------------------------------------------------------

function WatchTabsPanel({
  tab,
  onTab,
  capability,
  watch,
  option,
}: {
  tab: WatchTabId;
  onTab: (tab: WatchTabId) => void;
  capability: CapabilityLike;
  watch: WatchModelLike;
  option: RealityOption | null;
}) {
  return (
    <section className="watch-tabs" aria-label="Match detail panels">
      <div className="watch-tablist" role="tablist" aria-label="Match detail">
        {WATCH_TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`watch-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`watch-panel-${entry.id}`}
            className={`watch-tab ${tab === entry.id ? "active" : ""}`}
            onClick={() => onTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`watch-panel-${tab}`}
        aria-labelledby={`watch-tab-${tab}`}
        className="watch-tabpanel"
      >
        {tab === "renderer" && <RendererPanel capability={capability} option={option} />}
        {tab === "camera" && <CameraPanel />}
        {tab === "commentary" && <CommentaryPanel watch={watch} />}
        {tab === "tactics" && <TacticsPanel watch={watch} option={option} />}
        {tab === "stats" && <StatsPanel watch={watch} />}
        {tab === "highlights" && <HighlightsPanel watch={watch} />}
      </div>
    </section>
  );
}

/** The Renderer tab: the real capability entry + the renderer-scoped controls. */
function RendererPanel({
  capability,
  option,
}: {
  capability: CapabilityLike;
  option: RealityOption | null;
}) {
  const renderer =
    option === null
      ? null
      : (capability.renderers.find((entry) => entry.rendererId === option.rendererId) ?? null);
  return (
    <div>
      <h2 className="section-title">Renderer</h2>
      {renderer === null ? (
        <p className="section-lede">No renderer is selected for this match.</p>
      ) : (
        <dl className="session-card-facts">
          <div className="fact">
            <dt>Renderer</dt>
            <dd>
              <code>{renderer.rendererId}</code>
            </dd>
          </div>
          {renderer.rendererVersion !== undefined && (
            <div className="fact">
              <dt>Version</dt>
              <dd>{renderer.rendererVersion}</dd>
            </div>
          )}
          {renderer.rendererClass !== undefined && (
            <div className="fact">
              <dt>Class</dt>
              <dd>{renderer.rendererClass}</dd>
            </div>
          )}
          <div className="fact">
            <dt>Availability</dt>
            <dd>
              <StateChip
                state={
                  renderer.availability === "available"
                    ? "ready"
                    : renderer.availability === "degraded"
                      ? "degraded"
                      : "unavailable"
                }
              >
                {renderer.availability}
              </StateChip>
            </dd>
          </div>
          <div className="fact">
            <dt>Rights</dt>
            <dd>{renderer.rightsAwareness}</dd>
          </div>
        </dl>
      )}
      <p className="section-lede">
        Renderer-specific controls stay scoped to the selected renderer: the player&rsquo;s
        display-cadence choices apply only while this reality&rsquo;s artifact is showing, and a
        renderer whose output carries no frame manifest gets no cadence control at all.
      </p>
    </div>
  );
}

/** The Camera tab: honest unavailable (live production is W915). */
function CameraPanel() {
  return (
    <div>
      <StatePanel
        state="unavailable"
        title="Camera control is not available for stored renders"
        reason="Camera direction is a live-production capability (real network live transport — W915). A stored review render carries one fixed view per frame — exactly the frame the player shows; there is no camera data to fake here."
      />
    </div>
  );
}

/** The Commentary tab: the labeled dev-seed story data (real chain I/O). */
function CommentaryPanel({ watch }: { watch: WatchModelLike }) {
  const story = watch.story;
  if (story === null) {
    return (
      <div>
        <StatePanel
          state="unavailable"
          title="No commentary data for this session"
          reason="This session carries no commentary transcript — nothing is invented to fill the panel."
        />
      </div>
    );
  }
  return (
    <div>
      <h2 className="section-title">Commentary</h2>
      <p className="section-lede">
        The fixture transcript this session&rsquo;s world model was really built from (dev seed —
        the real W207→W209 chain input).
      </p>
      <ul className="commentary-list">
        {story.transcript.map((unit, index) => (
          <li key={index}>
            <span className="marker-time">
              {formatTimelineMs(unit.startMs)}–{formatTimelineMs(unit.endMs)}
            </span>
            <blockquote className="commentary-line">{unit.text}</blockquote>
            <span className="marker-meta">asr confidence {unit.asrConfidence.toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <h3 className="section-subtitle">Extracted events</h3>
      <ol className="marker-list">
        {story.events.map((event) => (
          <li key={event.sequence}>
            <span className="marker-time">{formatTimelineMs(event.timeMs)}</span>
            <span className="marker-phrase">{event.type}</span>
            <span className="marker-meta">
              phrase &ldquo;{event.phrase}&rdquo; · confidence {event.confidence.toFixed(2)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The Tactics tab: the real per-frame entity positions from the artifact. */
function TacticsPanel({ watch, option }: { watch: WatchModelLike; option: RealityOption | null }) {
  if (watch.renders === null || watch.renders.length === 0) {
    return (
      <div>
        <StatePanel
          state="unavailable"
          title="No tactical data for this session"
          reason="Tactical positions come from stored render manifests; this session has none to read."
        />
      </div>
    );
  }
  return (
    <div>
      <h2 className="section-title">Tactics — per-render provenance</h2>
      <p className="section-lede">
        Position data lives in each stored artifact&rsquo;s manifest (the player&rsquo;s Provenance
        panel links the same numbers). {option !== null ? `Currently showing the ${option.rendererId} reality.` : ""}
      </p>
      <ol className="marker-list">
        {watch.renders.map((render) => (
          <li key={render.renderId}>
            <span className="marker-phrase">
              <code>{render.renderId}</code> ({render.rendererId})
            </span>
            <span className="marker-meta">
              watermark seq {render.watermarkAfter.sequence} @{" "}
              {formatTimelineMs(render.watermarkAfter.watermarkMs)} · snapshot v
              {render.provenance.snapshotVersion} · last event {render.provenance.lastEventSequence}{" "}
              · {render.outputs.length} stored segment(s)
            </span>
          </li>
        ))}
      </ol>
      <p className="section-lede">
        The live per-frame entity table renders beside the player for any frame you seek — every
        row is the manifest&rsquo;s own accounting (kind, disposition, position, confidence).
      </p>
    </div>
  );
}

/** The Stats tab: real render/watermark/provenance numbers. */
function StatsPanel({ watch }: { watch: WatchModelLike }) {
  const renders = watch.renders ?? [];
  const totals = renders.reduce(
    (acc, render) => ({
      segments: acc.segments + render.segmentCount,
      outputs: acc.outputs + render.outputs.length,
    }),
    { segments: 0, outputs: 0 },
  );
  const eventTail = watch.eventTail ?? null;
  return (
    <div>
      <h2 className="section-title">Session</h2>
      <dl className="session-card-facts">
        <div className="fact">
          <dt>Renders</dt>
          <dd>{renders.length === 0 ? "not revealed (rights)" : renders.length}</dd>
        </div>
        <div className="fact">
          <dt>Output segments</dt>
          <dd>{renders.length === 0 ? "not revealed (rights)" : totals.outputs}</dd>
        </div>
        <div className="fact">
          <dt>SWM events</dt>
          <dd>
            {eventTail === null
              ? "not revealed (rights)"
              : `${eventTail.length} in the world-model event tail`}
          </dd>
        </div>
        {eventTail !== null &&
          eventTail.map((event) => (
            <div className="fact" key={event.sequence}>
              <dt>
                event {event.sequence} · <code>{event.eventTypeRef}</code>
              </dt>
              <dd>
                session time {formatTimelineMs(event.eventTimeMs)}
                {event.confidence !== undefined
                  ? ` · confidence ${event.confidence.toFixed(2)}`
                  : ""}
              </dd>
            </div>
          ))}
      </dl>
      {renders.length === 0 && (
        <p className="section-lede">
          This session&rsquo;s rights deny stored playback, so its render state is not revealed here
          either.{" "}
          <Link href={ROUTES.explore} className="text-link">
            Back to Explore
          </Link>
        </p>
      )}
    </div>
  );
}

/** The Highlights tab: honest unavailable (no real highlight data this wave). */
function HighlightsPanel({ watch }: { watch: WatchModelLike }) {
  const eventTail = watch.eventTail;
  if (eventTail === null || eventTail.length === 0) {
    return (
      <div>
        <StatePanel
          state="unavailable"
          title="No highlight reel data exists"
          reason="Highlights would be derived selections of stored outputs; no such data exists for this session this wave. The real event list is on the Timeline and in Stats."
        />
      </div>
    );
  }
  return (
    <div>
      <h2 className="section-title">Highlights</h2>
      <p className="section-lede">
        No highlight reel has been produced for this match yet — the real events below are the
        world model&rsquo;s own event tail (the Timeline places them on the artifact).
      </p>
      <ol className="marker-list">
        {eventTail.map((event) => (
          <li key={event.sequence}>
            <span className="marker-time">{formatTimelineMs(event.eventTimeMs)}</span>
            <span className="marker-phrase">{event.eventTypeRef}</span>
            <span className="marker-meta">event {event.eventId}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE REALITY SWITCHER (Simulation G — the session stays constant)
// ---------------------------------------------------------------------------

function RealitySwitcher({
  options,
  selected,
  notice,
  onSelect,
}: {
  options: ReturnType<typeof deriveRealityOptions>;
  selected: string | null;
  notice: string | null;
  onSelect: (rendererId: string) => void;
}) {
  return (
    <section className="reality-switcher" aria-label="Reality Switcher">
      <h2 className="section-title">Reality Switcher</h2>
      <p className="section-lede">
        Same match, different realities. Switching stays on this page — the match session never
        reloads.
      </p>
      <ul className="switcher-options">
        {options.map((option) => {
          const isSelected = option.rendererId === selected;
          return (
            <li key={option.rendererId}>
              <button
                type="button"
                className={`switcher-option ${isSelected ? "selected" : ""} state-${option.state}`}
                aria-pressed={isSelected}
                disabled={option.state !== "ready"}
                onClick={() => onSelect(option.rendererId)}
              >
                <span className="switcher-name">{option.rendererId}</span>
                <span className={`switcher-state state-${option.state}`}>{option.state}</span>
                <span className="switcher-reason">{option.reason}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {notice !== null && (
        <p className="switcher-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

/** The side rail's session facts (real counts; rights-aware). */
function SessionFactsSection({ watch }: { watch: WatchModelLike }) {
  const renders = watch.renders ?? [];
  return (
    <section className="stats-section" aria-label="Session facts">
      <h2 className="section-title">Session facts</h2>
      <dl className="session-card-facts">
        <div className="fact">
          <dt>Session</dt>
          <dd>
            <code>{watch.sessionId}</code>
          </dd>
        </div>
        <div className="fact">
          <dt>Renders</dt>
          <dd>{watch.renders === null ? "not revealed (rights)" : renders.length}</dd>
        </div>
        <div className="fact">
          <dt>Story</dt>
          <dd>
            {watch.story === null
              ? "none"
              : `${watch.story.storyKey} (${watch.story.eventCount} events, dev seed)`}
          </dd>
        </div>
      </dl>
    </section>
  );
}
