/**
 * The Match Lab's pure view-model mapping (W907) — the Analyst workspace's
 * read-only analysis projection over the EXISTING watch data
 * (`/api/watch/[sessionId]`): the session's REAL SWM event tail becomes the
 * timeline, the story's REAL transcript becomes the commentary segments, and
 * the renders' REAL watermarks/provenance become the SWM-evidence rows.
 *
 * Pure functions only — no React, no fetch — so the whole mapping is directly
 * testable from `bun test` against real watch models (the analyst surface
 * data mapping the W907 acceptance asks for). Nothing is invented: markers,
 * segments and evidence rows are 1:1 projections of the watch document, and
 * playback-denied sessions yield honest empty projections (never a peek).
 */
import type { WatchModelLike, WatchEventTailLike } from "./api-types";

/** One timeline marker (a real world-model event, projected). */
export interface TimelineMarker {
  sequence: number;
  eventId: string;
  eventTimeMs: number;
  eventTypeRef: string;
  confidence?: number;
}

/** One commentary segment (a real transcript window, projected). */
export interface CommentarySegment {
  startMs: number;
  endMs: number;
  text: string;
  asrConfidence: number;
}

/** One SWM-evidence row (a render's real watermark + provenance). */
export interface EvidenceRow {
  renderId: string;
  rendererId: string;
  watermarkMs: number;
  watermarkSequence: number;
  snapshotVersion: number;
  lastEventSequence: number;
  rendererDegraded: boolean;
  degradationReason?: string;
}

/** The Match Lab view model (all fields honest: null = playback denied). */
export interface MatchLabModel {
  sessionId: string;
  label: string;
  status: string;
  timeline: readonly TimelineMarker[] | null;
  commentary: readonly CommentarySegment[] | null;
  evidence: readonly EvidenceRow[] | null;
  /** The real fusion-wave count the story produced, when one exists. */
  waveCount: number | null;
  /** The honest source label (the watch model's own `story.source`). */
  storySource: string | null;
}

/** Formats a match-time offset as `M:SS.mmm` (timeline ruler labels). */
export function formatMatchTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}

/** Maps the real event tail to timeline markers (order: match time, then sequence). */
export function mapTimeline(eventTail: readonly WatchEventTailLike[]): readonly TimelineMarker[] {
  return [...eventTail]
    .map((entry) => ({
      sequence: entry.sequence,
      eventId: entry.eventId,
      eventTimeMs: entry.eventTimeMs,
      eventTypeRef: entry.eventTypeRef,
      ...(entry.confidence !== undefined ? { confidence: entry.confidence } : {}),
    }))
    .sort((a, b) =>
      a.eventTimeMs === b.eventTimeMs ? a.sequence - b.sequence : a.eventTimeMs - b.eventTimeMs,
    );
}

/** Maps the story's real transcript to commentary segments (time order). */
export function mapCommentary(
  transcript: readonly { startMs: number; endMs: number; text: string; asrConfidence: number }[],
): readonly CommentarySegment[] {
  return [...transcript]
    .map((entry) => ({
      startMs: entry.startMs,
      endMs: entry.endMs,
      text: entry.text,
      asrConfidence: entry.asrConfidence,
    }))
    .sort((a, b) => a.startMs - b.startMs);
}

/** Maps the renders' real watermarks + provenance to SWM-evidence rows. */
export function mapEvidence(
  renders: readonly {
    renderId: string;
    rendererId: string;
    watermarkAfter: { watermarkMs: number; sequence: number };
    provenance: { snapshotVersion: number; lastEventSequence: number };
    rendererHealth: { lagMs: number; degraded: boolean; degradationReason?: string };
  }[] | null,
): readonly EvidenceRow[] | null {
  if (renders === null) return null;
  return renders.map((render) => ({
    renderId: render.renderId,
    rendererId: render.rendererId,
    watermarkMs: render.watermarkAfter.watermarkMs,
    watermarkSequence: render.watermarkAfter.sequence,
    snapshotVersion: render.provenance.snapshotVersion,
    lastEventSequence: render.provenance.lastEventSequence,
    rendererDegraded: render.rendererHealth.degraded,
    ...(render.rendererHealth.degradationReason !== undefined
      ? { degradationReason: render.rendererHealth.degradationReason }
      : {}),
  }));
}

/** Builds the whole Match Lab view model from a REAL watch document. */
export function buildMatchLabModel(watch: WatchModelLike): MatchLabModel {
  return {
    sessionId: watch.sessionId,
    label: watch.label,
    status: watch.status,
    timeline: watch.eventTail === null ? null : mapTimeline(watch.eventTail),
    commentary:
      watch.story === null ? null : mapCommentary(watch.story.transcript),
    evidence: mapEvidence(watch.renders),
    waveCount: watch.story === null ? null : watch.story.waveCount,
    storySource: watch.story === null ? null : watch.story.source,
  };
}
