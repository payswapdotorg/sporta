"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CapabilityLike } from "@/lib/api-types";
import type { FetchState } from "@/lib/client-api";
import { fetchCapability, fetchLiveSources } from "@/lib/client-api";
import type { LiveSourcesLike } from "@/lib/client-api";
import { fetchLiveReplayRecord } from "@/lib/client-api";
import type { LiveReplayRecord } from "@/lib/live-replay";
import { replayContinuityFacts, replayContinuityVerdict, useLiveReplay } from "@/lib/live-replay";
import { deriveLiveState } from "@/lib/surface-state";
import { LoadingPanel, StateChip, StatePanel } from "@/components/state-panels";
import { ProviderNotices } from "@/components/provider-notices";
import { LivePlayer } from "@/components/live-player";
import type { LiveSourceOption } from "@/components/live-player";
import { LiveTacticalRenderer } from "@/components/live-tactical";
import type { LiveTacticalSourceOption } from "@/components/live-tactical";
import { Live3dRenderer } from "@/components/live-3d";
import type { Live3dSourceOption } from "@/components/live-3d";

/**
 * The Live data surface (W904 → W915 → L005 → L013 → L014): live is a
 * CAPABILITY verdict, and — since W915 — a REAL one. When the SSE live
 * transport is env-active (`SPORTA_LIVE_TRANSPORT=sse`) and an authorized
 * live source is registered, the capability response reports `modes.live`
 * available with `live-network` transport evidence, this surface lists the
 * real sources (the story timelines' animated-SVG players, the L005 live
 * tactical view's per-scenario sessions, and the L014 finite-window
 * continuity session), and each player consumes the real SSE stream over
 * the real HTTP network.
 *
 * L013: a tactical source offers BOTH presentations of the SAME live
 * world state — the 2D tactical canvas and the interactive 3D view (one
 * stream, one world shape, two renderers; the camera in the 3D view is
 * the user's — state updates never move it).
 *
 * L014 (presentation side): the FINITE live window ends honestly
 * (`live-window-complete`) and the SAME tactical/3D surfaces REPLAY the
 * recorded session state through the SAME view-model contracts — the
 * replay record (the transport's own recording of the window) drives the
 * same renderers, with the continuity (world versions, watermarks,
 * timecodes — verbatim, never re-stamped) VISIBLE in the facts panel and
 * ASSERTED by the pure `replayContinuityVerdict`. The shared scrub/step
 * control bar drives both presentations from one cursor. When the
 * transport is NOT active, the surface renders the honest unavailable
 * state — never a simulated live badge (Simulation F).
 */

/** One row of the sources listing (the transport's own data). */
interface LiveSourceRow extends LiveSourceOption {
  sourceKind: "story" | "tactical";
  sourceNote?: string;
  /** L014: the finite-window + replay continuity source. */
  finiteWindow?: boolean;
}

/** The presentation of a tactical source's world frames. */
type TacticalViewMode = "tactical-2d" | "tactical-3d";

export function LiveSurface() {
  const [capability, setCapability] = useState<FetchState<CapabilityLike>>({ phase: "loading" });
  const [sources, setSources] = useState<FetchState<LiveSourcesLike>>({ phase: "loading" });
  const [picked, setPicked] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<TacticalViewMode>("tactical-2d");
  // L014: the selected tactical session's replay record (null = live mode).
  const [replayRecord, setReplayRecord] = useState<LiveReplayRecord | null>(null);
  const [replayFetchFailed, setReplayFetchFailed] = useState<string | null>(null);

  useEffect(() => {
    void fetchCapability().then(
      (data) => setCapability({ phase: "ready", data }),
      (error) => setCapability({ phase: "failed", error: String(error) }),
    );
  }, []);

  const transportActive =
    capability.phase === "ready" &&
    capability.data.modes.live.availability === "available" &&
    capability.data.modes.live.transportKind === "live-network";

  useEffect(() => {
    if (!transportActive) return;
    void fetchLiveSources().then(
      (data) => setSources({ phase: "ready", data }),
      (error) => setSources({ phase: "failed", error: String(error) }),
    );
  }, [transportActive]);

  // L014: the sources rows + the default pick are computed WITHOUT hooks so
  // every hook below runs UNCONDITIONALLY (the hooks-order rule — the early
  // returns for the loading/failed capability states come after them).
  const rows: LiveSourceRow[] =
    sources.phase === "ready"
      ? sources.data.sources.map((source) => ({
          sessionId: source.sessionId,
          label: source.label,
          storyKey: source.storyKey,
          sourceKind: source.sourceKind ?? "story",
          ...(source.sourceNote !== undefined ? { sourceNote: source.sourceNote } : {}),
          ...(source.finiteWindow === true ? { finiteWindow: true } : {}),
        }))
      : [];
  // The default pick: the FIRST tactical source (the L005 scaffold's live
  // tactical view), else the first source — a deliberate, visible default.
  const selected =
    capability.phase === "ready"
      ? (rows.find((row) => row.sessionId === picked) ??
        rows.find((row) => row.sourceKind === "tactical") ??
        rows[0] ??
        null)
      : null;

  // L014: the replay controller over the record (drives BOTH presentations
  // from one cursor — the same recorded frame renders in either view mode).
  const replay = useLiveReplay(replayRecord);

  // L014: when a tactical source is selected, READ the replay record state
  // first (a completed window replays immediately — including after a page
  // reload; an open window keeps the live presentation; no record yet means
  // the window has not run on this transport instance — the live view runs
  // it). One fetch per selection change — never a polling loop.
  useEffect(() => {
    if (!transportActive || selected === null || selected.sourceKind !== "tactical") {
      setReplayRecord(null);
      setReplayFetchFailed(null);
      return;
    }
    let cancelled = false;
    setReplayFetchFailed(null);
    void fetchLiveReplayRecord(selected.sessionId).then(
      (record) => {
        if (cancelled) return;
        setReplayRecord(
          record !== null && record.state === "complete"
            ? (record as unknown as LiveReplayRecord)
            : null,
        );
      },
      (error) => {
        if (cancelled) return;
        setReplayRecord(null);
        setReplayFetchFailed(String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [transportActive, selected?.sessionId, selected?.sourceKind]);

  // L014: the live window's own terminal close — fetch the record and
  // continue into the replay presentation (event-driven, never polled).
  const onLiveWindowComplete = useCallback(() => {
    if (selected === null) return;
    void fetchLiveReplayRecord(selected.sessionId).then(
      (record) => {
        setReplayRecord(
          record !== null && record.state === "complete"
            ? (record as unknown as LiveReplayRecord)
            : null,
        );
      },
      (error) => setReplayFetchFailed(String(error)),
    );
  }, [selected?.sessionId]);

  // L014: the visible continuity facts + the alignment verdict (pure
  // derivations over the record — memoized, still above the early returns).
  const continuity = useMemo(() => {
    if (replayRecord === null || replayRecord.state !== "complete") return null;
    return {
      facts: replayContinuityFacts(replayRecord),
      verdict: replayContinuityVerdict(replayRecord.frames),
    };
  }, [replayRecord]);

  if (capability.phase === "loading") {
    return <LoadingPanel label="Live" />;
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

  const live = deriveLiveState(capability.data);
  const replayActive = replay !== null && replay.record.state === "complete";

  return (
    <div className="surface-stack">
      <ProviderNotices capability={capability.data} />
      <StatePanel state={live.state} title="Live now" reason={live.reason} />

      {transportActive ? (
        sources.phase === "loading" ? (
          <LoadingPanel label="Live sources" />
        ) : sources.phase === "failed" ? (
          <StatePanel
            state="failed"
            title="The live sources could not be read"
            reason={sources.error}
          />
        ) : rows.length === 0 ? (
          <StatePanel
            state="unavailable"
            title="No live source is registered"
            reason="the live transport is active but no authorized live session is registered — nothing may be labelled live (Simulation F)"
          />
        ) : (
          <>
            <fieldset className="form-field" data-surface="live-source-picker">
              <legend>Live sources (the transport&rsquo;s own list)</legend>
              <ul className="studio-operation-list">
                {rows.map((row) => (
                  <li key={row.sessionId}>
                    <label>
                      <input
                        type="radio"
                        name="live-source"
                        checked={selected?.sessionId === row.sessionId}
                        onChange={() => setPicked(row.sessionId)}
                      />
                      <span className="studio-operation-label">{row.label}</span>
                      <span className="studio-operation-description">
                        {row.sourceKind === "tactical"
                          ? row.finiteWindow === true
                            ? "finite live window — it ENDS honestly, then the recorded session replays through the same views (L014)"
                            : "live tactical view — the live view-model's world frames (L002 deterministic tracking source)"
                          : `dev-seed story timeline (${row.storyKey}), cycled`}
                      </span>
                      {row.sourceKind === "tactical" ? (
                        row.finiteWindow === true ? (
                          <StateChip state="ready">finite window + replay</StateChip>
                        ) : (
                          <StateChip state="ready">tactical view-model</StateChip>
                        )
                      ) : (
                        <StateChip state="degraded">story timeline</StateChip>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            {selected !== null &&
              (selected.sourceKind === "tactical" ? (
                <fieldset className="form-field" data-surface="live-view-mode">
                  <legend>View the {replayActive ? "recorded" : "live"} world state as</legend>
                  <ul className="studio-operation-list">
                    <li>
                      <label>
                        <input
                          type="radio"
                          name="live-view-mode"
                          checked={viewMode === "tactical-2d"}
                          onChange={() => setViewMode("tactical-2d")}
                        />
                        <span className="studio-operation-label">2D tactical canvas</span>
                        <span className="studio-operation-description">
                          the canonical top-down pitch — identity-continuous markers
                        </span>
                      </label>
                    </li>
                    <li>
                      <label>
                        <input
                          type="radio"
                          name="live-view-mode"
                          checked={viewMode === "tactical-3d"}
                          onChange={() => setViewMode("tactical-3d")}
                        />
                        <span className="studio-operation-label">3D view (interactive camera)</span>
                        <span className="studio-operation-description">
                          the same {replayActive ? "recorded" : "world"} frames in 3D — your camera,
                          never moved by state updates (L013)
                        </span>
                      </label>
                    </li>
                  </ul>
                </fieldset>
              ) : null)}

            {/* L014: THE REPLAY CONTROL BAR — the shared cursor that drives
                BOTH presentations (scrub/step/play over the RECORDED frames,
                paced at the recorded cadence; the continuity verdict rides
                alongside — VISIBLE, never asserted blindly). */}
            {replayActive && replay !== null && continuity !== null ? (
              <fieldset className="form-field" data-surface="live-replay-controls">
                <legend>
                  Replay the recorded live window — {replay.record.frames.length} world frames
                  (world v{continuity.facts.worldVersionFirst} → v
                  {continuity.facts.worldVersionLast})
                </legend>
                <div className="live-replay-controls">
                  <div className="live-replay-buttons">
                    <button type="button" onClick={replay.play} disabled={replay.playing}>
                      ▶ play (recorded cadence{" "}
                      {continuity.facts.cadenceMs !== null
                        ? `${continuity.facts.cadenceMs} ms`
                        : "—"}
                      )
                    </button>
                    <button type="button" onClick={replay.pause} disabled={!replay.playing}>
                      ⏸ pause
                    </button>
                    <button type="button" onClick={() => replay.step(-1)}>
                      ⏮ step back
                    </button>
                    <button type="button" onClick={() => replay.step(1)}>
                      step forward ⏭
                    </button>
                  </div>
                  <label className="live-replay-scrub">
                    <span>
                      frame {replay.cursor + 1} / {replay.record.frames.length}
                      {replay.frame !== null
                        ? ` — world v${replay.frame.worldVersion} @ ${(replay.frame.eventTimeMs / 1000).toFixed(1)}s`
                        : ""}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, replay.record.frames.length - 1)}
                      value={replay.cursor}
                      onChange={(event) => replay.seek(Number(event.target.value))}
                      aria-label="scrub the recorded live window"
                    />
                  </label>
                </div>
                <dl className="session-card-facts">
                  <div className="fact">
                    <dt>Continuity verdict</dt>
                    <dd>
                      <StateChip state={continuity.verdict.aligned ? "ready" : "degraded"}>
                        {continuity.verdict.aligned
                          ? "aligned — versions/timecodes advance monotonically"
                          : "MISALIGNED (honest display)"}
                      </StateChip>
                    </dd>
                  </div>
                  <div className="fact">
                    <dt>World versions</dt>
                    <dd>
                      {continuity.facts.worldVersionFirst} → {continuity.facts.worldVersionLast} (of{" "}
                      {continuity.facts.frameCount} recorded frames, ordinals{" "}
                      {continuity.facts.ordinalFirst}–{continuity.facts.ordinalLast})
                    </dd>
                  </div>
                  <div className="fact">
                    <dt>Event-time span</dt>
                    <dd>
                      {(continuity.facts.eventTimeFirstMs! / 1000).toFixed(1)}s →{" "}
                      {(continuity.facts.eventTimeLastMs! / 1000).toFixed(1)}s · final watermark{" "}
                      {continuity.facts.watermarkFinal?.sequence} @{" "}
                      {(continuity.facts.watermarkFinal?.watermarkMs ?? 0 / 1000).toFixed(1)}s
                    </dd>
                  </div>
                  <div className="fact">
                    <dt>Window accounting</dt>
                    <dd>
                      {continuity.facts.deliveredFrames} delivered
                      {continuity.facts.droppedFrames !== null && continuity.facts.droppedFrames > 0
                        ? ` · ${continuity.facts.droppedFrames} dropped (counted)`
                        : " · 0 dropped"}
                    </dd>
                  </div>
                </dl>
                {!continuity.verdict.aligned && (
                  <ul className="form-notice" role="status">
                    {continuity.verdict.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                )}
                <p className="field-hint">
                  The replay re-renders the RECORDED world frames through the SAME views (2D and 3D)
                  — the same view-model contracts, the recorded versions/timecodes VERBATIM. Pacing
                  follows the recorded transport cadence, not the event-time rate. The record is
                  this transport instance&rsquo;s own recording of the live window; durable
                  live-session persistence (the platform side of L014) is Worker B&rsquo;s lane.
                </p>
              </fieldset>
            ) : null}

            {replayFetchFailed !== null && selected?.sourceKind === "tactical" ? (
              <p className="form-notice" role="status">
                the replay record could not be read ({replayFetchFailed}) — the live presentation
                continues; the replay stays honestly unavailable
              </p>
            ) : null}

            {selected !== null &&
              (selected.sourceKind === "tactical" ? (
                viewMode === "tactical-3d" ? (
                  <Live3dRenderer
                    source={selected as Live3dSourceOption}
                    {...(replayActive && replay !== null
                      ? { replay: { record: replay.record, frame: replay.frame } }
                      : {})}
                    {...(!replayActive ? { onLiveWindowComplete } : {})}
                  />
                ) : (
                  <LiveTacticalRenderer
                    source={selected as LiveTacticalSourceOption}
                    {...(replayActive && replay !== null
                      ? { replay: { record: replay.record, frame: replay.frame } }
                      : {})}
                    {...(!replayActive ? { onLiveWindowComplete } : {})}
                  />
                )
              ) : (
                <LivePlayer source={selected} />
              ))}
          </>
        )
      ) : null}

      <section className="live-transport-detail">
        <h2 className="section-title">What the transport actually is</h2>
        <dl className="session-card-facts">
          <div className="fact">
            <dt>Live availability</dt>
            <dd>{capability.data.modes.live.availability}</dd>
          </div>
          <div className="fact">
            <dt>Reason code</dt>
            <dd>
              <code>{capability.data.modes.live.reasonCode}</code>
            </dd>
          </div>
          <div className="fact">
            <dt>Transport kind</dt>
            <dd>
              <code>{capability.data.modes.live.transportKind}</code>
            </dd>
          </div>
          {sources.phase === "ready" ? (
            <div className="fact">
              <dt>Transport detail</dt>
              <dd>{sources.data.detail}</dd>
            </div>
          ) : null}
        </dl>
        <p className="section-lede">
          Sporta labels something live only when a real live network transport backs it. The
          transport is Server-Sent-Events over HTTP — a genuine network path with real-time delivery
          and measured end-to-end latency. The live tactical view (and its 3D presentation) consumes
          live world state through the same transport (its producer seam re-pointed at the live
          view-model — one stream, one world shape, two renderers). A finite live window ends
          honestly and becomes a REPLAY through the same views (L014) — the recorded session state
          replays with its world versions and timecodes intact. When the transport is not enabled on
          this deployment, this page stays honestly unavailable.
        </p>
        {transportActive ? (
          <StateChip state="ready">live network transport active</StateChip>
        ) : (
          <StateChip state="not-live">not live</StateChip>
        )}
      </section>
    </div>
  );
}
