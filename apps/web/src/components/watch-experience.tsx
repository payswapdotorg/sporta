"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  deriveRealityOptions,
  deriveWatchState,
  formatTimelineMs,
  mapOutputToViewModel,
} from "@/lib/surface-state";
import { LoadingPanel, StateChip, StatePanel } from "@/components/state-panels";
import { ROUTES } from "@/lib/navigation";

/**
 * THE WATCH EXPERIENCE (W905): one match, many realities.
 *
 * - The MATCH SESSION is constant for the page's life; the Reality Switcher
 *   swaps only the selected renderer (client state) and fetches that
 *   renderer's output for the SAME session — no navigation, no reload of the
 *   match context (Simulation G).
 * - The primary player consumes a REAL stored output through the control
 *   plane's playback gate. Render outputs are animated-SVG review artifacts
 *   (the W504 delivery format) — displayed faithfully as such, never
 *   presented as video.
 * - Availability is capability-driven + rights-aware: an option with no
 *   output for this session shows WHY (requires render / no stored output /
 *   rights / renderer unavailable) — never a fake "coming soon".
 */
export function WatchExperience({
  sessionId,
  initialRenderer,
}: {
  sessionId: string | null;
  initialRenderer: string | null;
}) {
  const [capability, setCapability] = useState<FetchState<CapabilityLike>>({ phase: "loading" });
  const [watch, setWatch] = useState<FetchState<WatchModelLike>>({ phase: "loading" });
  const [selectedRenderer, setSelectedRenderer] = useState<string | null>(initialRenderer);

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
      (error) => setWatch({ phase: "failed", error: String(error), status: error instanceof ApiError ? error.status : undefined }),
    );
  }, [sessionId]);

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
    return (
      <StatePanel
        state="failed"
        title="The match could not be read"
        reason={watch.error}
      />
    );
  }

  const options = deriveRealityOptions(capability.data, watch.data);
  const verdict = deriveWatchState(capability.data, watch.data);
  // The default selection: the query's renderer, else the first ready option.
  const effectiveSelection =
    selectedRenderer !== null && options.some((option) => option.rendererId === selectedRenderer)
      ? selectedRenderer
      : (options.find((option) => option.state === "ready")?.rendererId ?? null);

  return (
    <div className="watch-layout">
      <div className="watch-main">
        <MatchHeader watch={watch.data} verdict={verdict} />
        {effectiveSelection === null ? (
          <StatePanel
            state={verdict.state === "denied" ? "denied" : "unavailable"}
            title="Nothing to play for this match"
            reason={verdict.reason}
          />
        ) : (
          <PlayerSurface
            sessionId={sessionId}
            option={options.find((option) => option.rendererId === effectiveSelection)!}
          />
        )}
        {watch.data.story !== null && <CommentarySection watch={watch.data} />}
      </div>
      <aside className="watch-side">
        <RealitySwitcher
          options={options}
          selected={effectiveSelection}
          onSelect={(rendererId) => setSelectedRenderer(rendererId)}
        />
        <RendererControls
          capability={capability.data}
          rendererId={effectiveSelection}
        />
        <StatsSection watch={watch.data} />
      </aside>
    </div>
  );
}

/** The match header: real session identity + the playback verdict. */
function MatchHeader({ watch, verdict }: { watch: WatchModelLike; verdict: { state: string; reason: string } }) {
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

/**
 * The primary playback surface: a REAL stored output fetched through the
 * playback gate, rendered as the animated-SVG review artifact it is.
 */
function PlayerSurface({
  sessionId,
  option,
}: {
  sessionId: string;
  option: { rendererId: string; state: string; reason: string; renderId?: string; segmentId?: string };
}) {
  const [output, setOutput] = useState<
    FetchState<RenderOutputLike> | { phase: "denied"; reason: string } | { phase: "nothing"; reason: string }
  >({ phase: "loading" });
  const [artifactUrl, setArtifactUrl] = useState<string | null>(null);
  const [replayKey, setReplayKey] = useState(0);

  useEffect(() => {
    if (option.segmentId === undefined || option.renderId === undefined) {
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
          setOutput({ phase: "denied", reason: "the playback gate denied this read before any byte was exposed" });
        } else {
          setOutput({ phase: "failed", error: String(error), status: error instanceof ApiError ? error.status : undefined });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sessionId, option.renderId, option.segmentId, option.reason]);

  // The artifact is displayed as a Blob URL in an <img> — animations play,
  // scripts cannot run, and the bytes are only the authorized document's.
  useEffect(() => {
    if (output.phase !== "ready") {
      setArtifactUrl(null);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([output.data.content], { type: output.data.contentType }),
    );
    setArtifactUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [output]);

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
        <StatePanel state="unavailable" title={`The ${option.rendererId} reality has no output`} reason={output.reason} />
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

  const view = mapOutputToViewModel(output.data);

  return (
    <section className="player-surface" data-renderer={option.rendererId}>
      <div className="player-stage">
        {artifactUrl !== null && (
          <img
            key={replayKey}
            src={artifactUrl}
            alt={`The ${view.rendererId} rendering of match session ${output.data.sessionId}: ${view.frameCount} frames over ${(view.totalDurationMs / 1000).toFixed(0)} seconds`}
            className="player-artifact"
          />
        )}
      </div>
      <div className="player-bar">
        <button
          type="button"
          className="button-ghost player-replay"
          onClick={() => setReplayKey((key) => key + 1)}
        >
          Replay
        </button>
        <p className="review-format-note" role="note">
          Rendered output — review format: this is the real stored artifact (a self-contained
          animated SVG segment). Sporta&rsquo;s renderers emit SVG review outputs this wave; there is no
          video codec to fake here.
        </p>
      </div>
      <TimelineSection view={view} />
      <TacticsSection view={view} />
    </section>
  );
}

/** The timeline: real frame windows + captioned event markers. */
function TimelineSection({ view }: { view: ReturnType<typeof mapOutputToViewModel> }) {
  return (
    <section className="timeline-section" aria-label="Match timeline">
      <h2 className="section-title">Timeline and events</h2>
      <div className="timeline-track" role="img" aria-label={`A ${view.totalDurationMs / 1000} second timeline with ${view.markers.length} event markers`}>
        {view.frames.map((frame) => (
          <span
            key={frame.frameIndex}
            className={`timeline-frame ${frame.marker !== null ? "has-marker" : ""}`}
            style={{ flexGrow: Math.max(1, frame.endMs - frame.atMs) }}
            title={`${formatTimelineMs(frame.atMs)}–${formatTimelineMs(frame.endMs)}${frame.clockText !== null ? ` · ${frame.clockText}` : ""}`}
          />
        ))}
        {view.markers.map((marker) => (
          <span
            key={marker.sequence}
            className="timeline-marker"
            style={{ left: `${(marker.atMs / Math.max(1, view.totalDurationMs)) * 100}%` }}
            title={`${formatTimelineMs(marker.atMs)} — ${marker.phrase}`}
          >
            <span className="timeline-marker-dot" aria-hidden="true" />
            <span className="sr-only">{`${formatTimelineMs(marker.atMs)} — ${marker.phrase}`}</span>
          </span>
        ))}
      </div>
      <ol className="marker-list">
        {view.markers.map((marker) => (
          <li key={marker.sequence}>
            <span className="marker-time">{formatTimelineMs(marker.atMs)}</span>
            <span className="marker-phrase">{marker.phrase}</span>
            <span className="marker-meta">event {marker.eventId} · sequence {marker.sequence}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Tactics: the real per-frame entity positions from the artifact manifest. */
function TacticsSection({ view }: { view: ReturnType<typeof mapOutputToViewModel> }) {
  const [frameIndex, setFrameIndex] = useState(view.frames.length - 1);
  const frame = view.frames[Math.min(frameIndex, view.frames.length - 1)] ?? view.frames[0];
  return (
    <section className="tactics-section" aria-label="Tactical positions">
      <h2 className="section-title">Tactics — real positions from the render manifest</h2>
      <div className="frame-picker" role="group" aria-label="Frame">
        {view.frames.map((entry) => (
          <button
            key={entry.frameIndex}
            type="button"
            className={`frame-picker-option ${entry.frameIndex === frame?.frameIndex ? "active" : ""}`}
            aria-pressed={entry.frameIndex === frame?.frameIndex}
            onClick={() => setFrameIndex(entry.frameIndex)}
          >
            {formatTimelineMs(entry.atMs)}
          </button>
        ))}
      </div>
      {frame === undefined ? (
        <p className="section-lede">No frame data in this artifact.</p>
      ) : (
        <table className="tactics-table">
          <caption className="sr-only">{`Entity positions at ${formatTimelineMs(frame.atMs)}${frame.clockText !== null ? ` (clock ${frame.clockText})` : ""}`}</caption>
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
            {frame.entities.map((entity) => (
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
    </section>
  );
}

/**
 * THE REALITY SWITCHER (Simulation G): the renderer options for THIS match
 * session, capability-driven and rights-aware, with the real reason for
 * every option that is not ready.
 */
function RealitySwitcher({
  options,
  selected,
  onSelect,
}: {
  options: ReturnType<typeof deriveRealityOptions>;
  selected: string | null;
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
    </section>
  );
}

/** The renderer controls panel: the real capability entry for the selection. */
function RendererControls({
  capability,
  rendererId,
}: {
  capability: CapabilityLike;
  rendererId: string | null;
}) {
  const renderer =
    rendererId === null
      ? null
      : (capability.renderers.find((entry) => entry.rendererId === rendererId) ?? null);
  return (
    <section className="renderer-controls" aria-label="Renderer controls">
      <h2 className="section-title">Renderer</h2>
      {renderer === null ? (
        <p className="section-lede">No renderer selected.</p>
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
              <StateChip state={renderer.availability === "available" ? "ready" : renderer.availability === "degraded" ? "degraded" : "unavailable"}>
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
    </section>
  );
}

/** The commentary section: the labeled dev-seed story data (real chain I/O). */
function CommentarySection({ watch }: { watch: WatchModelLike }) {
  const story = watch.story;
  if (story === null) return null;
  return (
    <section className="commentary-section" aria-label="Commentary and highlights">
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
            <span className="marker-meta">
              asr confidence {unit.asrConfidence.toFixed(2)}
            </span>
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
    </section>
  );
}

/** The stats section: real render/watermark/provenance numbers. */
function StatsSection({ watch }: { watch: WatchModelLike }) {
  const renders = watch.renders ?? [];
  const totals = renders.reduce(
    (acc, render) => ({
      segments: acc.segments + render.segmentCount,
      outputs: acc.outputs + render.outputs.length,
    }),
    { segments: 0, outputs: 0 },
  );
  return (
    <section className="stats-section" aria-label="Session statistics">
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
        {renders.map((render) => (
          <div className="fact" key={render.renderId}>
            <dt>
              <code>{render.renderId}</code> watermark
            </dt>
            <dd>
              seq {render.watermarkAfter.sequence} @ {formatTimelineMs(render.watermarkAfter.watermarkMs)} ·
              snapshot v{render.provenance.snapshotVersion} · last event {render.provenance.lastEventSequence}
            </dd>
          </div>
        ))}
      </dl>
      {renders.length === 0 && (
        <p className="section-lede">
          This session&rsquo;s rights deny stored playback, so its render state is not revealed
          here either.{" "}
          <Link href={ROUTES.explore} className="text-link">
            Back to Explore
          </Link>
        </p>
      )}
    </section>
  );
}
