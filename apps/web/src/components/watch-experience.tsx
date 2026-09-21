"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  CapabilityLike,
  RealityKindLike,
  RealityOptionsLike,
  RenderOutputLike,
  SessionArtifactCatalogLike,
  StudioSessionStateLike,
  WatchModelLike,
} from "@/lib/api-types";
import { ApiError } from "@/lib/client-api";
import type { FetchState } from "@/lib/client-api";
import {
  fetchCapability,
  fetchRealityOptions,
  fetchRenderOutput,
  fetchStudioSession,
  fetchWatchModel,
} from "@/lib/client-api";
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
  REALITY_LABELS,
  isRealityKind,
  realityKindOfRenderer,
  selectedRealityOf,
  switcherStateOf,
  videoDescriptorOf,
  videoSourceOf,
  videoStatusOf,
  watchUrlOf,
  type VideoPlayerStatus,
} from "@/lib/reality-catalog";
import {
  deriveRealityOptions,
  formatTimelineMs,
  watchVerdictOfOptions,
  withRendererJobStates,
  type RealityOption,
} from "@/lib/surface-state";
import { LoadingPanel, StateChip, StatePanel } from "@/components/state-panels";
import { ProviderNotices } from "@/components/provider-notices";
import { WatchComputeTransparency } from "@/components/compute-transparency";
import { ROUTES } from "@/lib/navigation";

/**
 * THE WATCH EXPERIENCE (W905 → R504/R505/R506): one match, many realities.
 *
 * - The MATCH SESSION is constant for the page's life; the Reality Switcher
 *   (R505) swaps only the selected REALITY KIND (Original/Tactical/3D/Anime)
 *   — the selection is a PURE function of the URL's `reality` parameter and
 *   the R503 artifact catalog's real availability, it is URL-addressable
 *   (shareable, refresh-stable) and it never re-acquires the match.
 * - The PRIMARY player (R504) is an HTML5 `<video>` element playing the
 *   REAL encoded MP4 artifact of the selected reality, sourced through the
 *   watch plane's playback-gated, integrity-verifying byte route. The
 *   browser's own state (loading/ready/playing/paused/ended/error) is
 *   surfaced honestly — a typed MediaError reason rides verbatim.
 * - The SVG frame player remains as the explicitly-labeled DIAGNOSTIC
 *   review surface for realities whose stored artifacts are animated-SVG
 *   review segments — never the primary player for MVP output.
 * - The compute provenance panel (R506) makes legible WHOSE compute
 *   produced the selected reality's artifact (the connection-center
 *   selection explanation, carried verbatim; user-choice vs auto mode),
 *   with honest "not recorded" boundaries.
 * - Availability follows the catalog's fail-closed rights derivation: a
 *   denied session reveals nothing.
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
  initialReality,
  initialRenderer,
}: {
  sessionId: string | null;
  initialReality: string | null;
  initialRenderer: string | null;
}) {
  const [capability, setCapability] = useState<FetchState<CapabilityLike>>({ phase: "loading" });
  const [watch, setWatch] = useState<FetchState<WatchModelLike>>({ phase: "loading" });
  // The owner/operator view of this session's studio state (W908): the REAL
  // per-renderer render-job states (R506: the compute provenance source). A
  // 401/403/404 is the honest viewer boundary — a viewer who is not the
  // owner simply has no job data (null), and the compute panel shows its
  // honest unavailable state.
  const [studio, setStudio] = useState<StudioSessionStateLike | null>(null);
  const [realities, setRealities] = useState<FetchState<RealityOptionsLike>>({ phase: "loading" });
  const [tab, setTab] = useState<WatchTabId>("renderer");
  // The URL-addressable selection state (R505): starts from the page's
  // `reality` parameter; every switch updates it (and the URL).
  const [userKind, setUserKind] = useState<RealityKindLike | null>(
    isRealityKind(initialReality) ? initialReality : null,
  );

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

  // The Reality Switcher's acquisition (R504/R505): the per-renderer options
  // AND the R503 reality artifact catalog for the SAME session — fetched
  // once; every later switch is a pure client-side derivation.
  useEffect(() => {
    if (sessionId === null) return;
    setRealities({ phase: "loading" });
    void fetchRealityOptions(sessionId).then(
      (data) => setRealities({ phase: "ready", data }),
      (error) =>
        setRealities({
          phase: "failed",
          error: String(error),
          status: error instanceof ApiError ? error.status : undefined,
        }),
    );
  }, [sessionId]);

  // The opportunistic studio read (owner/operator only): the session's real
  // render-job states + their compute selections (R506). Any refusal is the
  // honest viewer boundary — no job data, no provenance claim.
  useEffect(() => {
    if (sessionId === null) return;
    let cancelled = false;
    setStudio(null);
    void fetchStudioSession(sessionId).then(
      (data) => {
        if (!cancelled) setStudio(data);
      },
      () => {
        if (!cancelled) setStudio(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const options = useMemo(
    () =>
      capability.phase === "ready" && watch.phase === "ready"
        ? withRendererJobStates(
            deriveRealityOptions(capability.data, watch.data),
            studio?.jobs ?? [],
          )
        : null,
    [capability, watch, studio],
  );

  const catalog: SessionArtifactCatalogLike | null =
    realities.phase === "ready" ? realities.data.artifacts : null;

  // The legacy `?renderer=<id>` deep-link alias (W905): mapped onto its
  // reality kind through the catalog's own producer data, deterministically.
  const legacyKind = useMemo(
    () =>
      catalog !== null && initialRenderer !== null
        ? realityKindOfRenderer(initialRenderer, catalog)
        : null,
    [catalog, initialRenderer],
  );

  // THE SELECTION (R505): a pure function of the URL state + catalog data.
  const selection = useMemo(
    () => (catalog === null ? null : selectedRealityOf(userKind ?? legacyKind, catalog)),
    [catalog, userKind, legacyKind],
  );

  // Keep the visible URL addressable for the CURRENT selection (the
  // shareable deep link; replaceState — no history spam, refresh-stable).
  useEffect(() => {
    const kind = selection === null ? null : selection.kind;
    if (kind === null || sessionId === null) return;
    if (typeof window === "undefined") return;
    const canonical = watchUrlOf(sessionId, kind);
    if (window.location.pathname + window.location.search !== canonical) {
      window.history.replaceState(null, "", canonical);
    }
  }, [selection, sessionId]);

  if (sessionId === null) {
    return (
      <StatePanel
        state="unavailable"
        title="No match selected"
        reason="Open a card from Home or Explore to watch a match. The watch surface always needs a real session."
      />
    );
  }
  if (
    capability.phase === "loading" ||
    watch.phase === "loading" ||
    realities.phase === "loading"
  ) {
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
  if (realities.phase === "failed") {
    return (
      <StatePanel
        state="failed"
        title="The reality catalog could not be read"
        reason={realities.error}
      />
    );
  }

  const currentOptions = options ?? [];
  const verdict = watchVerdictOfOptions(currentOptions);
  const selectedKind = selection?.kind ?? null;
  const selectedEntry =
    selectedKind === null || catalog === null || catalog.realities === null
      ? null
      : (catalog.realities.find((reality) => reality.kind === selectedKind) ?? null);
  const selectedDescriptor = selectedEntry === null ? null : videoDescriptorOf(selectedEntry);
  // The producing renderer's option (the diagnostics player + the Renderer
  // tab's capability entry) — derived from the catalog's own producer data.
  const producingOption =
    selectedEntry === null || selectedEntry.artifacts.length === 0
      ? null
      : (currentOptions.find(
          (option) =>
            option.rendererId === selectedEntry.artifacts[0]!.producerId &&
            option.renderId !== undefined &&
            option.segmentId !== undefined,
        ) ?? null);

  /** One reality switch (R505): same session, new selected reality. */
  const onSwitch = (kind: RealityKindLike) => {
    setUserKind(kind);
    // The URL is the addressable selection state — update it in place.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", watchUrlOf(sessionId, kind));
    }
  };

  return (
    <div className="watch-layout">
      <div className="watch-main">
        <ProviderNotices capability={capability.data} />
        <MatchHeader
          watch={watch.data}
          verdict={{
            state:
              selectedEntry !== null && selectedEntry.availability !== "ready"
                ? switcherStateOf(selectedEntry.availability)
                : verdict.state,
            reason:
              selectedEntry !== null && selectedEntry.availability !== "ready"
                ? selectedEntry.reason
                : verdict.reason,
          }}
        />
        {selectedKind === null || selectedEntry === null ? (
          <StatePanel
            state={
              watch.data.playback.state === "denied"
                ? "denied"
                : verdict.state === "processing"
                  ? "processing"
                  : "unavailable"
            }
            title={
              watch.data.playback.state === "denied"
                ? "Playback is denied for this match"
                : verdict.state === "processing"
                  ? "A render is being produced"
                  : "Nothing to play for this match"
            }
            reason={
              watch.data.playback.state === "denied"
                ? "The session's rights deny stored playback — no reality is revealed."
                : (selection?.reason ?? verdict.reason)
            }
          />
        ) : selectedEntry.availability !== "ready" ? (
          <StatePanel
            state={switcherStateOf(selectedEntry.availability)}
            title={`The ${REALITY_LABELS[selectedKind]} reality is ${
              selectedEntry.availability === "job-in-flight"
                ? "being produced"
                : selectedEntry.availability === "job-failed"
                  ? "unavailable (its job failed)"
                  : "not available"
            }`}
            reason={selectedEntry.reason}
          />
        ) : selectedDescriptor !== null ? (
          <VideoPlayerSection
            sessionId={sessionId}
            kind={selectedKind}
            label={REALITY_LABELS[selectedKind]}
            descriptor={selectedDescriptor}
            realityCount={catalog?.readyRealityCount ?? null}
          />
        ) : (
          <ReviewFormatSection
            sessionId={sessionId}
            kind={selectedKind}
            entry={selectedEntry}
            option={producingOption}
            eventTail={watch.data.eventTail}
          />
        )}
        <WatchTabsPanel
          tab={tab}
          onTab={setTab}
          capability={capability.data}
          watch={watch.data}
          option={producingOption}
        />
      </div>
      <aside className="watch-side">
        <RealitySwitcher
          catalog={catalog}
          selected={selectedKind}
          onSelect={onSwitch}
          sessionLabel={watch.data.label}
        />
        <ComputeProvenanceSection kind={selectedKind} entry={selectedEntry} studio={studio} />
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
// THE PRIMARY PLAYER (R504): the HTML5 <video> element over the real MP4
// ---------------------------------------------------------------------------

/**
 * The primary player: an HTML5 `<video>` element playing the selected
 * reality's REAL encoded MP4 artifact through the watch plane's
 * integrity-verifying byte route. The player state is the BROWSER's own
 * state (events → the pure `videoStatusOf`), surfaced honestly; the
 * provenance facts beside it are the catalog descriptor's own numbers.
 */
function VideoPlayerSection({
  sessionId,
  kind,
  label,
  descriptor,
  realityCount,
}: {
  sessionId: string;
  kind: RealityKindLike;
  label: string;
  descriptor: NonNullable<ReturnType<typeof videoDescriptorOf>>;
  realityCount: number | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<VideoPlayerStatus>({
    phase: "loading",
    reason: "the video is being fetched",
  });
  const src = videoSourceOf(sessionId, kind, descriptor.artifactId);

  // The browser's real state, derived on every media event (pure mapping).
  useEffect(() => {
    const element = videoRef.current;
    if (element === null) return;
    const derive = () => {
      const error = element.error;
      setStatus(
        videoStatusOf({
          networkState: element.networkState,
          readyState: element.readyState,
          paused: element.paused,
          ended: element.ended,
          error:
            error === null
              ? null
              : {
                  code: error.code,
                  message: typeof error.message === "string" ? error.message : "",
                },
        }),
      );
    };
    const events = [
      "loadstart",
      "loadedmetadata",
      "canplay",
      "playing",
      "play",
      "pause",
      "ended",
      "error",
      "stalled",
      "waiting",
      "suspend",
      "emptied",
    ];
    for (const event of events) element.addEventListener(event, derive);
    derive();
    return () => {
      for (const event of events) element.removeEventListener(event, derive);
    };
  }, [src]);

  // A new artifact (a reality switch) resets the surfaced state honestly.
  useEffect(() => {
    setStatus({ phase: "loading", reason: "the video is being fetched" });
  }, [src]);

  return (
    <section className="player-surface" data-player="html5-video" data-reality={kind}>
      <video
        ref={videoRef}
        className="video-stage"
        controls
        preload="metadata"
        src={src}
        aria-label={`The ${label} rendering of match session ${sessionId} — the real stored MP4 artifact`}
      />
      <p className="video-status" data-video-status={status.phase} role="status">
        <StateChip
          state={
            status.phase === "loading" ? "loading" : status.phase === "error" ? "failed" : "ready"
          }
        >
          {status.phase}
        </StateChip>{" "}
        {status.reason}
      </p>
      <dl className="session-card-facts player-frame-facts">
        <div className="fact">
          <dt>Reality</dt>
          <dd>
            {label}
            {realityCount !== null
              ? ` · ${realityCount} of this match’s realities hold artifacts`
              : ""}
          </dd>
        </div>
        <div className="fact">
          <dt>Artifact</dt>
          <dd>
            <code>{descriptor.artifactId}</code>
          </dd>
        </div>
        <div className="fact">
          <dt>Integrity (sha-256)</dt>
          <dd>
            <code title={descriptor.integrityHash}>{descriptor.integrityHash.slice(0, 16)}…</code>{" "}
            re-verified per request
          </dd>
        </div>
        <div className="fact">
          <dt>Stored bytes</dt>
          <dd>
            {descriptor.byteSize} B · {descriptor.contentType}
          </dd>
        </div>
        <div className="fact">
          <dt>Producer</dt>
          <dd>
            <code>{descriptor.producerId}</code>
          </dd>
        </div>
      </dl>
      <p className="review-format-note" role="note">
        Real MP4 playback — the primary Watch player plays the real stored encoded artifact of the
        selected reality through the playback-gated byte route (the store re-reads and sha-256
        verifies the bytes on every request; a mismatch refuses to serve). The frame-by-frame SVG
        review renderers remain available as diagnostics on the realities that store them.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The review-format boundary (SVG artifacts — the diagnostic player)
// ---------------------------------------------------------------------------

type OutputState =
  | { phase: "loading" }
  | { phase: "ready"; data: RenderOutputLike }
  | { phase: "denied"; reason: string }
  | { phase: "nothing"; reason: string }
  | { phase: "failed"; error: string };

/**
 * The REVIEW FORMAT surface (R504's named boundary): a reality whose stored
 * artifacts are animated-SVG review segments gets an HONEST "not video"
 * panel plus the frame-by-frame DIAGNOSTIC player (the W905 frame player,
 * explicitly labeled — never presented as the MVP video output).
 */
function ReviewFormatSection({
  sessionId,
  kind,
  entry,
  option,
  eventTail,
}: {
  sessionId: string;
  kind: RealityKindLike;
  entry: { availability: string; reason: string; artifacts: { contentType: string }[] };
  option: RealityOption | null;
  eventTail: WatchModelLike["eventTail"];
}) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  return (
    <section className="player-surface" data-player="review-format" data-reality={kind}>
      <StatePanel
        state="unavailable"
        title={`The ${REALITY_LABELS[kind]} reality stores a review-format artifact, not video`}
        reason={`This reality's stored artifact is ${
          entry.artifacts[0]?.contentType ?? "a review segment"
        } — the renderer emitted a review format for it. It is never presented as video: the diagnostic frame player below renders it frame by frame on its own manifest clock. ${entry.reason}`}
      />
      {option === null ? (
        <p className="section-lede">
          The stored review segment has no frame-manifest player to drive this wave.
        </p>
      ) : (
        <div className="diagnostics-disclosure">
          <button
            type="button"
            className="button-ghost"
            aria-expanded={showDiagnostics}
            onClick={() => setShowDiagnostics((current) => !current)}
          >
            {showDiagnostics ? "Hide" : "Show"} diagnostics — the frame-by-frame review player
          </button>
          {showDiagnostics && (
            <div className="diagnostics-body">
              <p className="review-format-note" role="note">
                DIAGNOSTICS (not the MVP video output): the W504 review segment displayed frame by
                frame — the deterministic encoder&rsquo;s own SVG document on its manifest clock.
              </p>
              <PlayerSection sessionId={sessionId} option={option} eventTail={eventTail} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The diagnostic frame player (W905): acquires the selected reality's stored
 * review output through the playback gate, then plays it frame by frame on
 * the artifact's own manifest clock.
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

  useEffect(() => {
    setPlayer(model === null ? null : initialFramePlayer(model));
  }, [model]);

  const markers = useMemo(
    () =>
      model === null || output.phase !== "ready"
        ? []
        : placeEventMarkers(model, eventTail ?? [], output.data.manifest.sourceManifest),
    [model, eventTail, output],
  );
  const profile = useMemo(() => (model === null ? null : deriveFrameRateProfile(model)), [model]);
  const playing = player?.playing ?? false;

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

  if (output.phase === "loading") {
    return (
      <div aria-busy="true">
        <LoadingPanel label={`Fetching the ${option.rendererId} review output`} />
      </div>
    );
  }
  if (output.phase === "denied") {
    return <StatePanel state="denied" title="Playback denied" reason={output.reason} />;
  }
  if (output.phase === "nothing") {
    return (
      <StatePanel
        state={option.state === "processing" ? "processing" : "unavailable"}
        title={
          option.state === "processing"
            ? `The ${option.rendererId} reality is being rendered`
            : `The ${option.rendererId} reality has no output`
        }
        reason={output.reason}
      />
    );
  }
  if (output.phase === "failed") {
    return <StatePanel state="failed" title="The output could not be read" reason={output.error} />;
  }
  if (model === null || player === null) {
    return <LoadingPanel label="Preparing the player" />;
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
  profile: ReturnType<typeof deriveFrameRateProfile> | null;
  onPlayer: (next: FramePlayerState) => void;
  rendererId: string;
}) {
  const frameIndex = frameIndexAtMs(model, player.playheadMs);
  const sourceFrame =
    output.manifest.sourceManifest.frames.find((frame) => frame.frameIndex === frameIndex) ?? null;
  const totalFrames = model.windows.length;

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
    <div className="player-surface diagnostics-player" data-renderer={rendererId}>
      {prepared.ok ? (
        <div
          className="player-stage"
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
          onClick={() =>
            onPlayer(
              player.ended
                ? playFramePlayer(player, model)
                : player.playing
                  ? pauseFramePlayer(player)
                  : playFramePlayer(player, model),
            )
          }
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
          renderers emit SVG review outputs for this reality; this is the diagnostic surface, not
          the primary video player.
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
                style={{
                  left: `${(marker.markerMs! / Math.max(1, model.totalDurationMs)) * 100}%`,
                }}
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
    </div>
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
                ? source.degradation.reasons.join(", ") || "degraded"
                : "not degraded"}
            </StateChip>
          </dd>
        </div>
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// THE REALITY SWITCHER (R505 — the catalog-driven four-reality selection)
// ---------------------------------------------------------------------------

function RealitySwitcher({
  catalog,
  selected,
  onSelect,
  sessionLabel,
}: {
  catalog: SessionArtifactCatalogLike | null;
  selected: RealityKindLike | null;
  onSelect: (kind: RealityKindLike) => void;
  sessionLabel: string;
}) {
  if (catalog === null || catalog.realities === null) {
    return (
      <section className="reality-switcher" aria-label="Reality Switcher">
        <h2 className="section-title">Reality Switcher</h2>
        <p className="section-lede">
          This session&rsquo;s rights deny stored playback — its realities are not revealed.
        </p>
      </section>
    );
  }
  return (
    <section className="reality-switcher" aria-label="Reality Switcher">
      <h2 className="section-title">Reality Switcher</h2>
      <p className="section-lede">
        Same match, different realities. Switching stays on this page — the match session{" "}
        <code>{sessionLabel}</code> never reloads, and the selection lives in the link (shareable,
        refresh-stable).
      </p>
      <ul className="switcher-options">
        {catalog.realities.map((reality) => {
          const isSelected = reality.kind === selected;
          const state = switcherStateOf(reality.availability);
          return (
            <li key={reality.kind}>
              <button
                type="button"
                className={`switcher-option ${isSelected ? "selected" : ""} state-${state}`}
                aria-pressed={isSelected}
                onClick={() => onSelect(reality.kind)}
              >
                <span className="switcher-name">{REALITY_LABELS[reality.kind]}</span>
                <span className={`switcher-state state-${state}`}>
                  {reality.availability}
                  {reality.availability === "ready" && reality.artifacts.length > 0
                    ? ` · ${reality.artifacts.length} artifact${
                        reality.artifacts.length === 1 ? "" : "s"
                      }`
                    : ""}
                </span>
                <span className="switcher-reason">{reality.reason}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// THE COMPUTE PROVENANCE PANEL (R506 — whose compute produced this reality)
// ---------------------------------------------------------------------------

/**
 * The compute provenance (R506): is THIS reality's artifact on Sporta
 * compute or the user's connected compute? The answer is the
 * connection-center's own data — the selection explanation carried VERBATIM
 * from the dispatch (user-choice vs auto mode visible), with honest
 * "not recorded" boundaries for renders whose dispatch carried no directive
 * (e.g. the dev seed) and the honest viewer boundary for non-owners.
 */
function ComputeProvenanceSection({
  kind,
  entry,
  studio,
}: {
  kind: RealityKindLike | null;
  entry: { artifacts: { producerId: string }[] } | null;
  studio: StudioSessionStateLike | null;
}) {
  // J006: the derived-reality branch delegates to the transparency panel
  // (the six facts: source, provider, reason, measured cost, privacy,
  // fallback — the honest unknowns included).
  if (kind === null) {
    return null;
  }
  // The original reality: the normalization pipeline (this deployment's own
  // process — the in-process media executor; no user compute involved).
  if (kind === "original") {
    return (
      <section className="stats-section" aria-label="Compute provenance">
        <h2 className="section-title">Compute</h2>
        <dl className="session-card-facts">
          <div className="fact">
            <dt>Whose compute</dt>
            <dd>
              <StateChip state="ready">sporta-managed</StateChip>
            </dd>
          </div>
          <div className="fact">
            <dt>How this reality is produced</dt>
            <dd>
              The original reality&rsquo;s artifact is produced by the normalization pipeline on
              this deployment&rsquo;s own process — no user compute selection is involved.
            </dd>
          </div>
        </dl>
        <p className="section-lede">
          Rendered realities carry their own provenance: select one to see whose compute executed
          its render, with the selection explanation the connection center recorded.
        </p>
      </section>
    );
  }
  const producerId = entry?.artifacts[0]?.producerId ?? null;
  if (producerId === null) {
    return (
      <section className="stats-section" aria-label="Compute provenance">
        <h2 className="section-title">Compute</h2>
        <p className="section-lede">
          No artifact exists for the {REALITY_LABELS[kind]} reality yet — there is no render whose
          compute provenance could be shown.
        </p>
      </section>
    );
  }
  // The producing render's dispatch record (owner/operator view only).
  const job = studio?.jobs.find((row) => row.rendererId === producerId) ?? null;
  return (
    <WatchComputeTransparency
      realityLabel={REALITY_LABELS[kind]}
      producerId={producerId}
      job={job}
    />
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
        <p className="section-lede">
          No renderer is selected for this match (the selected reality&rsquo;s producer is not a
          registered renderer capability, or the reality holds no artifact).
        </p>
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
        Renderer-specific controls stay scoped to the selected reality&rsquo;s producing renderer:
        the diagnostic player&rsquo;s display-cadence choices apply only while that reality&rsquo;s
        review artifact is showing, and a renderer whose output carries no frame manifest gets no
        cadence control at all.
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
        reason="Camera direction is a live-production capability (real network live transport — W915). A stored render carries one fixed view per frame — exactly the frame the player shows; there is no camera data to fake here."
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
        Position data lives in each stored artifact&rsquo;s manifest (the diagnostics player&rsquo;s
        Provenance panel links the same numbers).{" "}
        {option !== null ? `Currently showing the ${option.rendererId} reality.` : ""}
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
        The live per-frame entity table renders beside the diagnostics player for any frame you seek
        — every row is the manifest&rsquo;s own accounting (kind, disposition, position,
        confidence).
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
        No highlight reel has been produced for this match yet — the real events below are the world
        model&rsquo;s own event tail (the Timeline places them on the artifact).
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
              : `${watch.story.storyKey} (${watch.story.events.length} events, dev seed)`}
          </dd>
        </div>
      </dl>
    </section>
  );
}
