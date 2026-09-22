"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/components/account-provider";
import { ApiError, fetchCatalog, fetchSessionMarkers, saveAnalystMarker } from "@/lib/client-api";
import type { FetchState } from "@/lib/client-api";
import type { SessionCardLike, SessionMarkersLike } from "@/lib/api-types";
import { LoadingPanel, StatePanel } from "@/components/state-panels";
import { formatMatchTime } from "@/lib/match-lab";
import { ROUTES } from "@/lib/navigation";

/**
 * THE CLIPS SURFACE (J010) — the Analyst workspace's saved media-time
 * markers: moments and clip intervals created ONLY where the session has a
 * REAL media timeline (the durable SourceAsset's duration — the honest
 * extent), listed as TIME RANGES + BACKING REFERENCES, and revisitable.
 *
 * THE NO-BYTES PIN (the domain's own invariant, visible here): a clip
 * marker is a time range on a real timeline — this surface never renders,
 * stores or mints media. Cutting actual clip bytes from the real media is a
 * LATER rendering lane's job; faking them here would violate the domain.
 *
 * Honest refusals (the domain seam's closed vocabulary) are surfaced with
 * their useful next actions — session-unknown, no-timeline (a story-only
 * session cannot host media-time markers), out-of-range, render-unknown —
 * never silently swallowed.
 */

/** The marker-creation draft (client-side until saved). */
interface MarkerDraft {
  kind: "moment" | "clip";
  atSeconds: string;
  startSeconds: string;
  endSeconds: string;
  label: string;
}

const EMPTY_DRAFT: MarkerDraft = {
  kind: "moment",
  atSeconds: "",
  startSeconds: "",
  endSeconds: "",
  label: "",
};

/** Parses a seconds string to ms (NaN when not a finite number). */
function msOfSeconds(input: string): number | null {
  const seconds = Number(input.trim());
  if (input.trim().length === 0 || !Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds * 1000);
}

export function ClipsSurface({ sessionId }: { sessionId: string | null }) {
  const { phase: accountPhase, account } = useAccount();
  const [catalog, setCatalog] = useState<FetchState<SessionCardLike[]>>({ phase: "loading" });
  const [selected, setSelected] = useState<string>(sessionId ?? "");
  const [markers, setMarkers] = useState<FetchState<SessionMarkersLike>>({ phase: "loading" });
  const [draft, setDraft] = useState<MarkerDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    void fetchCatalog().then(
      (data) => setCatalog({ phase: "ready", data }),
      (error) =>
        setCatalog({
          phase: "failed",
          error: error instanceof ApiError ? error.message : String(error),
        }),
    );
  }, []);

  const reloadMarkers = useCallback(async (session: string) => {
    if (session.length === 0) {
      setMarkers({ phase: "loading" });
      return;
    }
    setMarkers({ phase: "loading" });
    try {
      const data = await fetchSessionMarkers(session);
      setMarkers({ phase: "ready", data });
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setMarkers({
        phase: "failed",
        error: err instanceof Error ? err.message : String(err),
        status: apiErr?.status,
      });
    }
  }, []);

  useEffect(() => {
    if (accountPhase !== "ready" || account === null) return;
    void reloadMarkers(selected);
  }, [accountPhase, account, selected, reloadMarkers]);

  const saveMarker = useCallback(async () => {
    if (markers.phase !== "ready") return;
    setBusy(true);
    setFlash(null);
    try {
      const atMs = draft.kind === "moment" ? msOfSeconds(draft.atSeconds) : null;
      const startMs = draft.kind === "clip" ? msOfSeconds(draft.startSeconds) : null;
      const endMs = draft.kind === "clip" ? msOfSeconds(draft.endSeconds) : null;
      if (draft.kind === "moment" && atMs === null) {
        setFlash("Enter the moment's time as a non-negative number of seconds first.");
        return;
      }
      if (draft.kind === "clip" && (startMs === null || endMs === null)) {
        setFlash("Enter the clip's start and end as non-negative numbers of seconds first.");
        return;
      }
      const input =
        draft.kind === "moment"
          ? {
              sessionId: selected,
              kind: "moment" as const,
              atMs: atMs as number,
              ...(draft.label.trim().length > 0 ? { label: draft.label.trim() } : {}),
            }
          : {
              sessionId: selected,
              kind: "clip" as const,
              startMs: startMs as number,
              endMs: endMs as number,
              ...(draft.label.trim().length > 0 ? { label: draft.label.trim() } : {}),
            };
      const saved = await saveAnalystMarker(input);
      setFlash(
        `Saved ${saved.markerId} (${saved.kind} on ${
          saved.backing.kind === "session-timeline"
            ? "the session's real timeline"
            : `render ${saved.backing.renderId}`
        }).`,
      );
      setDraft({ ...EMPTY_DRAFT, kind: draft.kind });
      await reloadMarkers(selected);
    } catch (err) {
      // The domain seam's closed refusal vocabulary rides the message with
      // its useful next action — shown verbatim, never smoothed.
      setFlash(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setBusy(false);
    }
  }, [markers, draft, selected, reloadMarkers]);

  if (accountPhase === "loading") {
    return <LoadingPanel label="Checking session" />;
  }
  if (account === null) {
    return (
      <StatePanel
        state="denied"
        title="Sign in to save analysis clips"
        reason="Clips are media-time markers saved against a real session timeline by a signed-in analyst (the session's owner, an operator, or the analyst grant)."
      />
    );
  }
  if (catalog.phase === "loading") {
    return <LoadingPanel label="Reading the catalog" />;
  }
  if (catalog.phase === "failed") {
    return (
      <StatePanel state="failed" title="The catalog could not be read" reason={catalog.error} />
    );
  }

  const sessions = catalog.data;

  return (
    <div className="surface-stack">
      <section className="studio-section" data-surface="clips-picker">
        <h2 className="section-title">Session under analysis</h2>
        <label className="field-label" htmlFor="clips-session">
          Session
        </label>
        <select
          id="clips-session"
          className="input-select"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Select a session…</option>
          {sessions.map((card) => (
            <option key={card.sessionId} value={card.sessionId}>
              {card.label} ({card.story?.storyKey ?? card.sessionId})
            </option>
          ))}
        </select>
        <p className="field-note">
          {sessions.length} session{sessions.length === 1 ? "" : "s"} reachable in your catalog —
          markers save only where the session has a REAL media timeline.
        </p>
      </section>

      {flash !== null && (
        <p className="studio-flash" role="status">
          {flash}
        </p>
      )}

      {selected.length === 0 && (
        <StatePanel
          state="unavailable"
          title="Pick a session to save and revisit clips"
          reason="Moments and clip intervals save against the session's real media timeline — select the session you are analyzing."
        />
      )}

      {markers.phase === "failed" && (
        <StatePanel
          state={markers.status === 403 ? "denied" : "failed"}
          title="The markers could not be read"
          reason={markers.error}
        />
      )}

      {markers.phase === "ready" && (
        <>
          <section className="studio-section" data-surface="clips-timeline">
            <h2 className="section-title">Real media timeline</h2>
            {markers.data.timeline.available ? (
              <p className="field-note">
                The session&apos;s durable source asset backs a real timeline of{" "}
                <strong>{formatMatchTime(markers.data.timeline.durationMs)}</strong> (
                {markers.data.timeline.durationMs} ms) — markers must fall inside it.
              </p>
            ) : (
              <StatePanel
                state="unavailable"
                title={
                  markers.data.timeline.reason === "no-timeline"
                    ? "No real media timeline"
                    : "Unknown session"
                }
                reason={
                  markers.data.timeline.reason === "no-timeline"
                    ? "This session has no real media timeline (no stored original artifact) — a story-only session cannot host media-time markers. Upload authorized footage through the Create Studio to get a real timeline."
                    : "This session does not exist (or is not readable) — pick a session from the picker above."
                }
              />
            )}
          </section>

          {markers.data.timeline.available && (
            <section className="studio-section" data-surface="clips-create">
              <h2 className="section-title">Save a marker</h2>
              <fieldset>
                <legend>Kind</legend>
                {(["moment", "clip"] as const).map((kind) => (
                  <label key={kind} className="rights-op">
                    <input
                      type="radio"
                      name="clips-kind"
                      checked={draft.kind === kind}
                      onChange={() => setDraft((prior) => ({ ...prior, kind }))}
                    />
                    {kind === "moment" ? "Moment (one point in time)" : "Clip (a time interval)"}
                  </label>
                ))}
              </fieldset>
              {draft.kind === "moment" ? (
                <label className="field-label">
                  At (seconds into the timeline)
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    className="input-select"
                    value={draft.atSeconds}
                    onChange={(event) =>
                      setDraft((prior) => ({ ...prior, atSeconds: event.target.value }))
                    }
                  />
                </label>
              ) : (
                <div className="rights-edit-body">
                  <label className="field-label">
                    Start (seconds)
                    <input
                      type="number"
                      min={0}
                      step="0.001"
                      className="input-select"
                      value={draft.startSeconds}
                      onChange={(event) =>
                        setDraft((prior) => ({ ...prior, startSeconds: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field-label">
                    End (seconds)
                    <input
                      type="number"
                      min={0}
                      step="0.001"
                      className="input-select"
                      value={draft.endSeconds}
                      onChange={(event) =>
                        setDraft((prior) => ({ ...prior, endSeconds: event.target.value }))
                      }
                    />
                  </label>
                </div>
              )}
              <label className="field-label">
                Label (optional)
                <input
                  type="text"
                  maxLength={200}
                  className="input-select"
                  value={draft.label}
                  onChange={(event) =>
                    setDraft((prior) => ({ ...prior, label: event.target.value }))
                  }
                />
              </label>
              <div className="rights-actions">
                <button
                  type="button"
                  className="button-primary"
                  disabled={busy}
                  onClick={() => void saveMarker()}
                >
                  Save marker
                </button>
              </div>
              <p className="field-note">
                A marker is a <strong>time range + a backing reference</strong> — never clip bytes.
                Cutting actual media is a later rendering lane&apos;s job; this surface records
                where it would cut, against the real timeline above.
              </p>
            </section>
          )}

          <section className="studio-section" data-surface="clips-list">
            <h2 className="section-title">Saved markers ({markers.data.markers.length})</h2>
            {markers.data.markers.length === 0 ? (
              <StatePanel
                state="unavailable"
                title="No markers saved on this session yet"
                reason="Save a moment or a clip interval above — every marker is revisitable here and in Notes."
              />
            ) : (
              <ul className="marker-list">
                {markers.data.markers.map((marker) => (
                  <li key={marker.markerId}>
                    <span className="marker-time">
                      {marker.kind === "moment"
                        ? formatMatchTime(marker.atMs ?? 0)
                        : `${formatMatchTime(marker.startMs ?? 0)} – ${formatMatchTime(marker.endMs ?? 0)}`}
                    </span>{" "}
                    <span className="marker-phrase">
                      {marker.kind === "moment" ? "moment" : "clip"}
                      {marker.label !== undefined && marker.label.length > 0
                        ? ` — ${marker.label}`
                        : ""}
                    </span>{" "}
                    <span className="marker-meta">
                      {marker.markerId} · backing{" "}
                      {marker.backing.kind === "session-timeline"
                        ? `session timeline (${marker.backing.durationMs} ms)`
                        : `render ${marker.backing.renderId}`}{" "}
                      · by <code>{marker.authorUserId}</code> at {marker.createdAtIso}
                    </span>
                    <p className="field-note">
                      <Link
                        href={`${ROUTES.notes}?session=${encodeURIComponent(marker.sessionId)}`}
                      >
                        Notes on this session →
                      </Link>{" "}
                      <Link
                        href={`${ROUTES.watch}?session=${encodeURIComponent(marker.sessionId)}`}
                      >
                        Open the match in Watch →
                      </Link>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
