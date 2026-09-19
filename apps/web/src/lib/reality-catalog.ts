/**
 * THE REALITY CATALOG MODEL (R504/R505) — the pure, test-pinned derivations
 * the Watch surface runs over the R503 REALITY ARTIFACT CATALOG.
 *
 * The MATCH SESSION is the constant (Simulation G, unchanged): every
 * function here is a pure projection of (URL state + catalog data) — the
 * selected reality is a PURE FUNCTION of the URL's `reality` parameter and
 * the catalog's real availability, so a deep link reproduces exactly what
 * the switcher shows, before and after refresh.
 *
 * HONESTY RULES (the W919/W916 posture):
 * - a playback-denied catalog reveals NOTHING — no realities, no sources;
 * - a reality with no video artifact is NEVER faked: the switcher shows the
 *   catalog's own availability reason VERBATIM;
 * - the SVG frame renderers are DIAGNOSTICS — the primary player is the
 *   HTML5 `<video>` element playing real MP4 artifacts (R504's boundary);
 * - the browser's own player state is surfaced honestly (its typed MediaError
 *   reason rides VERBATIM — never smoothed over).
 */

import type {
  RealityArtifactDescriptorLike,
  RealityArtifactEntryLike,
  RealityKindLike,
  SessionArtifactCatalogLike,
  UxState,
} from "./api-types";
import { REALITY_KINDS } from "./api-types";

/** The presentation labels of the four MVP realities (no vendor vocabulary). */
export const REALITY_LABELS: Readonly<Record<RealityKindLike, string>> = Object.freeze({
  original: "Original",
  tactical: "Tactical",
  "three-d-game": "3D",
  "anime-npr": "Anime",
});

/** The canonical watch deep-link of one reality (shareable, refresh-stable). */
export function watchUrlOf(sessionId: string, kind: RealityKindLike): string {
  return `/watch?session=${encodeURIComponent(sessionId)}&reality=${encodeURIComponent(kind)}`;
}

// ---------------------------------------------------------------------------
// The HTML5 video source resolution (R504)
// ---------------------------------------------------------------------------

/** The byte route prefix of the watch player's artifact sources. */
const WATCH_ARTIFACT_CONTENT_PREFIX = "/api/watch/";

/**
 * Whether one artifact descriptor's bytes are HTML5-video playable: the
 * content type names the mp4 container (the media platform's
 * `container/codec` convention, e.g. `mp4/h264`) or is a video/mp4 type.
 * An SVG review segment (`image/svg+xml`) is honestly NOT video.
 */
export function isVideoArtifact(contentType: string): boolean {
  return contentType === "video/mp4" || contentType.startsWith("video/") || contentType.startsWith("mp4/");
}

/**
 * The FIRST video-playable artifact descriptor of one reality (the store's
 * own order — deterministic), or `null` when the reality holds no video
 * artifact (the honest boundary the player surfaces).
 */
export function videoDescriptorOf(
  entry: Pick<RealityArtifactEntryLike, "artifacts">,
): RealityArtifactDescriptorLike | null {
  return entry.artifacts.find((artifact) => isVideoArtifact(artifact.contentType)) ?? null;
}

/**
 * The HTML5 `<video>` element's source URL for one reality artifact: the
 * watch plane's playback-gated, integrity-verifying byte route (R504).
 * The URL is derived from the session + the descriptor's own identity —
 * the same route the golden path pins with a byte-level hash check.
 */
export function videoSourceOf(sessionId: string, kind: RealityKindLike, artifactId: string): string {
  return (
    WATCH_ARTIFACT_CONTENT_PREFIX +
    `${encodeURIComponent(sessionId)}/realities/${encodeURIComponent(kind)}/artifacts/${encodeURIComponent(artifactId)}/content`
  );
}

// ---------------------------------------------------------------------------
// The selection model (R505 — a pure function of URL + catalog data)
// ---------------------------------------------------------------------------

/** A `reality` URL parameter is valid when it names a frozen-vocabulary kind. */
export function isRealityKind(value: string | null | undefined): value is RealityKindLike {
  return value !== null && value !== undefined && (REALITY_KINDS as readonly string[]).includes(value);
}

/** The outcome of the selection derivation. */
export interface RealitySelection {
  /** The selected reality kind (`null` when nothing can be selected). */
  kind: RealityKindLike | null;
  /** Whether the URL's parameter drove the selection (the deep-link case). */
  fromUrl: boolean;
  /** Why the selection landed where it did (human words, test-pinned). */
  reason: string;
}

/**
 * THE SELECTION FUNCTION (R505): the selected reality is a pure function of
 * the URL's `reality` parameter and the catalog's real availability.
 *
 * - a URL that names a frozen-vocabulary kind SELECTS that kind — even when
 *   it is not ready: the deep link is the shareable state and the player
 *   surface shows that reality's honest availability (never a silent
 *   redirect to a different reality);
 * - without a (valid) parameter, the FIRST ready reality in the frozen
 *   contract order is selected (deterministic);
 * - a playback-denied catalog selects NOTHING (it reveals nothing);
 * - a catalog with no ready reality selects nothing (the honest verdict).
 */
export function selectedRealityOf(
  urlKind: string | null,
  catalog: SessionArtifactCatalogLike,
): RealitySelection {
  if (catalog.playback.state !== "authorized" || catalog.realities === null) {
    return {
      kind: null,
      fromUrl: false,
      reason: "playback is denied for this session — no reality is revealed",
    };
  }
  if (isRealityKind(urlKind)) {
    const entry = catalog.realities.find((reality) => reality.kind === urlKind);
    if (entry !== undefined) {
      return {
        kind: urlKind,
        fromUrl: true,
        reason: `the link selects the ${REALITY_LABELS[urlKind]} reality`,
      };
    }
  }
  const firstReady = catalog.realities.find((reality) => reality.availability === "ready");
  if (firstReady !== undefined) {
    return {
      kind: firstReady.kind,
      fromUrl: false,
      reason: `the ${REALITY_LABELS[firstReady.kind]} reality is the first with a stored artifact`,
    };
  }
  return {
    kind: null,
    fromUrl: false,
    reason: "no reality of this match holds a stored artifact yet",
  };
}

/**
 * The legacy `?renderer=<rendererId>` deep-link alias (W905): maps a
 * renderer id onto its reality kind through the catalog's own producer
 * data — a renderer whose reality holds artifacts maps to that kind;
 * anything else is honestly unmappable (`null`, the deterministic
 * fallback applies).
 */
export function realityKindOfRenderer(
  rendererId: string,
  catalog: SessionArtifactCatalogLike,
): RealityKindLike | null {
  if (catalog.realities === null) return null;
  for (const reality of catalog.realities) {
    if (reality.artifacts.some((artifact) => artifact.producerId === rendererId)) {
      return reality.kind;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The switcher's availability projection (R505 — the catalog's states, verbatim)
// ---------------------------------------------------------------------------

/** Maps one reality's catalog availability onto the UX state contract. */
export function switcherStateOf(availability: string): UxState {
  switch (availability) {
    case "ready":
      return "ready";
    case "job-in-flight":
      return "processing";
    case "job-failed":
      return "failed";
    default:
      // requires-render / requires-upload / producer-unavailable
      return "unavailable";
  }
}

// ---------------------------------------------------------------------------
// The video player's honest state (R504 — the browser's own state, verbatim)
// ---------------------------------------------------------------------------

/** The honest playback status of the `<video>` element (browser state only). */
export type VideoPlayerStatus =
  | { phase: "loading"; reason: "the video is being fetched" }
  | { phase: "ready"; reason: "the video is ready to play" }
  | { phase: "playing"; reason: "playing" }
  | { phase: "paused"; reason: "paused" }
  | { phase: "ended"; reason: "the video has ended" }
  | { phase: "error"; reason: string };

/** The browser's MediaError code names (the typed reason, surfaced verbatim). */
const MEDIA_ERROR_NAMES: Readonly<Record<number, string>> = Object.freeze({
  1: "MEDIA_ERR_ABORTED",
  2: "MEDIA_ERR_NETWORK",
  3: "MEDIA_ERR_DECODE",
  4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
});

/**
 * Derives the player status from the `<video>` element's REAL state (its
 * `error`, `ended`, `paused` and `readyState`/`networkState` fields — the
 * browser's own accounting, never a simulation). A MediaError carries the
 * code's name and the browser's message VERBATIM.
 */
export function videoStatusOf(element: {
  networkState: number;
  readyState: number;
  paused: boolean;
  ended: boolean;
  error: { code: number; message: string } | null;
}): VideoPlayerStatus {
  if (element.error !== null) {
    const name = MEDIA_ERROR_NAMES[element.error.code] ?? `MEDIA_ERR_${element.error.code}`;
    const message = element.error.message.trim();
    return {
      phase: "error",
      reason: message.length > 0 ? `${name}: ${message}` : name,
    };
  }
  if (element.ended) return { phase: "ended", reason: "the video has ended" };
  if (!element.paused) return { phase: "playing", reason: "playing" };
  if (element.readyState >= 3) return { phase: "ready", reason: "the video is ready to play" };
  if (element.readyState >= 1) return { phase: "ready", reason: "the video is ready to play" };
  return { phase: "loading", reason: "the video is being fetched" };
}
