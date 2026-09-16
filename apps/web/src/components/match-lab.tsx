"use client";

import { useEffect, useMemo, useState } from "react";
import type { SessionCardLike, WatchModelLike } from "@/lib/api-types";
import { ApiError, fetchCatalog, fetchWatchModel } from "@/lib/client-api";
import type { FetchState } from "@/lib/client-api";
import { buildMatchLabModel, formatMatchTime, type MatchLabModel } from "@/lib/match-lab";
import { LoadingPanel, StatePanel } from "@/components/state-panels";

/**
 * MATCH LAB (W907) — the Analyst / Commentator workspace's read-only
 * analysis surface, built ENTIRELY over the existing watch data:
 *
 * - the session's REAL SWM event tail renders as the timeline (sequence,
 *   taxonomy ref, match time, confidence);
 * - the story's REAL transcript renders as the commentary segments;
 * - the renders' REAL watermarks + provenance render as the SWM evidence;
 * - nothing here can change anything: it is inspection only, over the same
 *   authorized watch document the Watch surface serves.
 *
 * Sessions are picked from the REAL public catalog (the same cards Home
 * and Explore serve).
 */
export function MatchLab({ sessionId }: { sessionId: string | null }) {
  const [catalog, setCatalog] = useState<FetchState<SessionCardLike[]>>({ phase: "loading" });
  const [watch, setWatch] = useState<FetchState<WatchModelLike>>({ phase: "loading" });
  const [selected, setSelected] = useState<string>(sessionId ?? "");

  useEffect(() => {
    void fetchCatalog().then(
      (data) => setCatalog({ phase: "ready", data }),
      (error) => setCatalog({ phase: "failed", error: String(error) }),
    );
  }, []);

  useEffect(() => {
    if (selected.length === 0) {
      setWatch({ phase: "loading" });
      return;
    }
    setWatch({ phase: "loading" });
    void fetchWatchModel(selected).then(
      (data) => setWatch({ phase: "ready", data }),
      (error) =>
        setWatch({
          phase: "failed",
          error: String(error),
          status: error instanceof ApiError ? error.status : undefined,
        }),
    );
  }, [selected]);

  const model = useMemo<MatchLabModel | null>(
    () => (watch.phase === "ready" ? buildMatchLabModel(watch.data) : null),
    [watch],
  );

  if (catalog.phase === "loading" && selected.length === 0) {
    return <LoadingPanel label="Reading the catalog" />;
  }
  if (catalog.phase === "failed") {
    return (
      <StatePanel state="failed" title="The catalog could not be read" reason={catalog.error} />
    );
  }

  const playable = (catalog.phase === "ready" ? catalog.data : []).filter(
    (card) => card.playback.state === "authorized",
  );

  return (
    <div className="surface-stack">
      <section className="studio-section" data-surface="matchlab-picker">
        <h2 className="section-title">Match under analysis</h2>
        <label className="field-label" htmlFor="matchlab-session">
          Session
        </label>
        <select
          id="matchlab-session"
          className="input-select"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Select a published session…</option>
          {playable.map((card) => (
            <option key={card.sessionId} value={card.sessionId}>
              {card.label} ({card.story?.storyKey ?? card.sessionId})
            </option>
          ))}
        </select>
        <p className="field-note">
          {playable.length} published session{playable.length === 1 ? "" : "s"} in the real catalog.
          The lab is read-only: it inspects the same authorized watch document the Watch surface
          serves.
        </p>
      </section>

      {selected.length === 0 && (
        <StatePanel
          state="unavailable"
          title="No match selected"
          reason="Pick a published session to inspect its timeline, commentary and SWM evidence."
        />
      )}

      {selected.length > 0 && watch.phase === "loading" && (
        <LoadingPanel label="Reading the match" />
      )}
      {selected.length > 0 && watch.phase === "failed" && (
        <StatePanel state="failed" title="The match could not be read" reason={watch.error} />
      )}

      {model !== null && (
        <>
          <section className="studio-section" data-surface="matchlab-header">
            <h2 className="section-title">{model.label}</h2>
            <p className="field-note">
              status {model.status} · source {model.storySource ?? "none"} ·{" "}
              {model.waveCount === null
                ? "no story"
                : `${model.waveCount} fusion waves (real world-model run)`}
            </p>
          </section>

          <section className="studio-section" data-surface="matchlab-timeline">
            <h2 className="section-title">Event timeline</h2>
            {model.timeline === null ? (
              <StatePanel
                state="unavailable"
                title="Timeline unavailable"
                reason="Playback rights deny this session — the event tail is not revealed (fail-closed)."
              />
            ) : model.timeline.length === 0 ? (
              <StatePanel
                state="unavailable"
                title="No events extracted"
                reason="The real extraction pipeline produced no world-model events for this session."
              />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Match time</th>
                    <th scope="col">Seq</th>
                    <th scope="col">Event</th>
                    <th scope="col">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {model.timeline.map((marker) => (
                    <tr key={marker.eventId}>
                      <td>{formatMatchTime(marker.eventTimeMs)}</td>
                      <td>{marker.sequence}</td>
                      <td>
                        <code>{marker.eventTypeRef}</code>{" "}
                        <span className="field-note">({marker.eventId})</span>
                      </td>
                      <td>
                        {marker.confidence === undefined ? "—" : marker.confidence.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="studio-section" data-surface="matchlab-commentary">
            <h2 className="section-title">Commentary segments</h2>
            {model.commentary === null ? (
              <StatePanel
                state="unavailable"
                title="Commentary unavailable"
                reason="Playback rights deny this session — the transcript is not revealed."
              />
            ) : model.commentary.length === 0 ? (
              <StatePanel
                state="unavailable"
                title="No commentary windows"
                reason="The story's transcript has no commentary windows for this session."
              />
            ) : (
              <ol className="segment-list">
                {model.commentary.map((segment, index) => (
                  <li key={index} className="segment-item">
                    <span className="segment-time">
                      {formatMatchTime(segment.startMs)} → {formatMatchTime(segment.endMs)}
                    </span>
                    <p className="segment-text">{segment.text}</p>
                    <span className="field-note">
                      ASR confidence {segment.asrConfidence.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="studio-section" data-surface="matchlab-evidence">
            <h2 className="section-title">SWM evidence (render provenance)</h2>
            {model.evidence === null ? (
              <StatePanel
                state="unavailable"
                title="Evidence unavailable"
                reason="Playback rights deny this session — its renders are not revealed."
              />
            ) : model.evidence.length === 0 ? (
              <StatePanel
                state="unavailable"
                title="No renders"
                reason="This session has no render results to inspect yet."
              />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Render</th>
                    <th scope="col">Renderer</th>
                    <th scope="col">Watermark</th>
                    <th scope="col">Snapshot</th>
                    <th scope="col">Last event seq</th>
                    <th scope="col">Health</th>
                  </tr>
                </thead>
                <tbody>
                  {model.evidence.map((row) => (
                    <tr key={row.renderId}>
                      <td>
                        <code>{row.renderId}</code>
                      </td>
                      <td>{row.rendererId}</td>
                      <td>
                        {formatMatchTime(row.watermarkMs)} · seq {row.watermarkSequence}
                      </td>
                      <td>v{row.snapshotVersion}</td>
                      <td>{row.lastEventSequence}</td>
                      <td>
                        {row.rendererDegraded
                          ? `degraded (${row.degradationReason ?? "unspecified"})`
                          : "ok"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
