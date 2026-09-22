"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/components/account-provider";
import {
  ApiError,
  attachAnalystNote,
  fetchAnalystMarker,
  fetchCatalog,
  fetchSessionMarkers,
} from "@/lib/client-api";
import type { FetchState } from "@/lib/client-api";
import type { MarkerWithNotesLike, SessionCardLike, SessionMarkersLike } from "@/lib/api-types";
import { LoadingPanel, StatePanel } from "@/components/state-panels";
import { formatMatchTime } from "@/lib/match-lab";
import { ROUTES } from "@/lib/navigation";

/**
 * THE NOTES SURFACE (J010) — the Analyst workspace's attached notes: text
 * attached to SAVED media-time markers (the session's real timeline-backed
 * moments and clips), listed and revisitable. Notes are first-class domain
 * documents — author (the VERIFIED account id) + timestamp + text — never
 * comments on fabricated content: a note rides a marker that rides a REAL
 * timeline.
 *
 * Honest refusals surface with their useful next actions (the domain's
 * closed vocabulary); anonymous callers get the honest 401 state; callers
 * without the owner/operator/analyst standing get the real 403.
 */

/** The per-session notes document (markers with their notes loaded). */
type NotesState = FetchState<{ markers: MarkerWithNotesLike[] }>;

export function NotesSurface({ sessionId }: { sessionId: string | null }) {
  const { phase: accountPhase, account } = useAccount();
  const [catalog, setCatalog] = useState<FetchState<SessionCardLike[]>>({ phase: "loading" });
  const [selected, setSelected] = useState<string>(sessionId ?? "");
  const [markersDoc, setMarkersDoc] = useState<FetchState<SessionMarkersLike>>({
    phase: "loading",
  });
  const [notesState, setNotesState] = useState<NotesState>({ phase: "loading" });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
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

  const reload = useCallback(async (session: string) => {
    if (session.length === 0) {
      setMarkersDoc({ phase: "loading" });
      setNotesState({ phase: "loading" });
      return;
    }
    setMarkersDoc({ phase: "loading" });
    setNotesState({ phase: "loading" });
    try {
      const doc = await fetchSessionMarkers(session);
      setMarkersDoc({ phase: "ready", data: doc });
      // The revisit drill-down per marker (the domain's getMarker seam): each
      // marker WITH its notes. A marker that vanishes mid-reload is skipped
      // honestly (the list refresh follows).
      const withNotes = await Promise.all(
        doc.markers.map(async (marker) => {
          try {
            return await fetchAnalystMarker(marker.markerId);
          } catch {
            return null;
          }
        }),
      );
      setNotesState({
        phase: "ready",
        data: {
          markers: withNotes.filter((entry): entry is MarkerWithNotesLike => entry !== null),
        },
      });
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setMarkersDoc({
        phase: "failed",
        error: err instanceof Error ? err.message : String(err),
        status: apiErr?.status,
      });
    }
  }, []);

  useEffect(() => {
    if (accountPhase !== "ready" || account === null) return;
    void reload(selected);
  }, [accountPhase, account, selected, reload]);

  const attachNote = useCallback(
    async (markerId: string) => {
      const text = (drafts[markerId] ?? "").trim();
      if (text.length === 0) {
        setFlash("Write the note's text first (non-empty, at most 4000 characters).");
        return;
      }
      setBusy(markerId);
      setFlash(null);
      try {
        const note = await attachAnalystNote(markerId, text);
        setFlash(`Note ${note.noteId} attached to ${markerId}.`);
        setDrafts((prior) => ({ ...prior, [markerId]: "" }));
        await reload(selected);
      } catch (err) {
        // The closed refusal vocabulary (invalid-input, marker-unknown) or
        // the honest 401/403 — shown verbatim.
        setFlash(
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err),
        );
      } finally {
        setBusy(null);
      }
    },
    [drafts, reload, selected],
  );

  if (accountPhase === "loading") {
    return <LoadingPanel label="Checking session" />;
  }
  if (account === null) {
    return (
      <StatePanel
        state="denied"
        title="Sign in to attach analysis notes"
        reason="Notes attach to saved media-time markers by a signed-in analyst (the session's owner, an operator, or the analyst grant) — the author is the verified account, never a claim."
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

  return (
    <div className="surface-stack">
      <section className="studio-section" data-surface="notes-picker">
        <h2 className="section-title">Session under analysis</h2>
        <label className="field-label" htmlFor="notes-session">
          Session
        </label>
        <select
          id="notes-session"
          className="input-select"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Select a session…</option>
          {catalog.data.map((card) => (
            <option key={card.sessionId} value={card.sessionId}>
              {card.label} ({card.story?.storyKey ?? card.sessionId})
            </option>
          ))}
        </select>
        <p className="field-note">
          Notes attach to markers saved on the session&apos;s real media timeline — cut markers in{" "}
          <Link href={ROUTES.clips}>Clips</Link> first.
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
          title="Pick a session to read and write notes"
          reason="Each note rides a saved marker on the session's real timeline — select the session you are analyzing."
        />
      )}

      {markersDoc.phase === "failed" && (
        <StatePanel
          state={markersDoc.status === 403 ? "denied" : "failed"}
          title="The session's markers could not be read"
          reason={markersDoc.error}
        />
      )}

      {markersDoc.phase === "ready" && (
        <>
          {!markersDoc.data.timeline.available && (
            <StatePanel
              state="unavailable"
              title={
                markersDoc.data.timeline.reason === "no-timeline"
                  ? "No real media timeline"
                  : "Unknown session"
              }
              reason={
                markersDoc.data.timeline.reason === "no-timeline"
                  ? "This session has no real media timeline — markers (and notes on them) need real media. Upload authorized footage through the Create Studio first."
                  : "This session does not exist (or is not readable) — pick a session from the picker above."
              }
            />
          )}
          {markersDoc.data.timeline.available && markersDoc.data.markers.length === 0 && (
            <StatePanel
              state="unavailable"
              title="No markers saved on this session yet"
              reason="Notes attach to saved markers — cut a moment or a clip interval in Clips first, then attach notes here."
            />
          )}
        </>
      )}

      {notesState.phase === "ready" && notesState.data.markers.length > 0 && (
        <section className="studio-section" data-surface="notes-list">
          <h2 className="section-title">Markers and their notes</h2>
          <ul className="marker-list">
            {notesState.data.markers.map(({ marker, notes }) => (
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
                  {marker.markerId} · by <code>{marker.authorUserId}</code> at {marker.createdAtIso}
                </span>
                {notes.length === 0 ? (
                  <p className="field-note">No notes on this marker yet.</p>
                ) : (
                  <ul>
                    {notes.map((note) => (
                      <li key={note.noteId}>
                        <span className="marker-phrase">{note.text}</span>{" "}
                        <span className="marker-meta">
                          — {note.noteId} · by <code>{note.authorUserId}</code> at{" "}
                          {note.createdAtIso}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="rights-edit-body">
                  <label className="field-label">
                    Attach a note (non-empty, ≤ 4000 characters)
                    <textarea
                      className="input-select"
                      rows={2}
                      maxLength={4000}
                      value={drafts[marker.markerId] ?? ""}
                      onChange={(event) =>
                        setDrafts((prior) => ({ ...prior, [marker.markerId]: event.target.value }))
                      }
                    />
                  </label>
                  <div className="rights-actions">
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={busy === marker.markerId}
                      onClick={() => void attachNote(marker.markerId)}
                    >
                      Attach note
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="field-note">
            Every note is first-class and persisted: the author is the verified account id, the
            timestamp is the composition&apos;s clock, and the note rides a marker that rides a REAL
            timeline — no fabricated content anywhere in the chain.
          </p>
        </section>
      )}
    </div>
  );
}
