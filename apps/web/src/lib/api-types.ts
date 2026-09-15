/**
 * CLIENT-SAFE API TYPES (W904/W905) — the structural shapes the /api routes
 * answer with, mirrored here so client components never import `@sporta/*`
 * (server-only). The capability shape is the FROZEN W901 contract (schema
 * version 1.0); tests pin that every W901 fixture parses as
 * `CapabilityLike` and drives the surface-state derivations.
 *
 * These types are deliberately structural and closed: they describe exactly
 * the JSON the routes serve — nothing more.
 */

/** Canonical UX state vocabulary (ux-architecture "UX state contract"). */
export const UX_STATES = [
  "loading",
  "ready",
  "processing",
  "degraded",
  "denied",
  "unavailable",
  "failed",
] as const;
export type UxState = (typeof UX_STATES)[number];

/** The frozen W901 capability response (client-side structural mirror). */
export interface CapabilityLike {
  schemaVersion: string;
  requestContext: { requestId?: string };
  auth: {
    state: "authenticated" | "anonymous" | "invalid-session";
    sessionValid: boolean;
    activeRole: string | null;
  };
  account: { authenticated: boolean; userId?: string; roles: string[] };
  renderers: {
    rendererId: string;
    rendererVersion?: string;
    rendererClass?: string;
    availability: "available" | "degraded" | "unavailable";
    reasonCode: string;
    requiresSourceFrames: boolean;
    rightsAwareness: string;
  }[];
  modes: {
    live: {
      availability: "available" | "degraded" | "unavailable";
      reasonCode: string;
      transportKind: string;
    };
    batch: { availability: "available" | "degraded" | "unavailable"; reasonCode: string };
  };
  quotas: unknown[];
  providers: { kind: string; health: string; reasonCode: string; detail?: string }[];
  content: {
    catalogSurfaces: {
      surfaceId: string;
      visibility: "visible" | "hidden";
      reasonCode: string;
    }[];
  };
  overall: { state: "ready" | "degraded" | "unavailable"; reasonCodes: string[] };
}

/** One catalog session card (the /api/catalog/* answer). */
export interface SessionCardLike {
  sessionId: string;
  label: string;
  status: string;
  createdAtIso: string;
  playback: { state: "authorized" | "denied"; reasonCode: "ok" | "rights-denied" };
  renders:
    | { renderId: string; rendererId: string; segmentCount: number; hasStoredOutputs: boolean }[]
    | null;
  outputCount: number | null;
  story: { source: "dev-seed"; storyKey: string; eventCount: number } | null;
}

/** One render in the watch model. */
export interface WatchRenderLike {
  renderId: string;
  rendererId: string;
  watermarkAfter: { watermarkMs: number; sequence: number };
  provenance: { snapshotVersion: number; lastEventSequence: number };
  rendererHealth: { lagMs: number; degraded: boolean; degradationReason?: string };
  segmentCount: number;
  outputs: { segmentId: string; contentType: string; byteLength: number; contentHash: string }[];
}

/** The watch model (the /api/watch/[sessionId] answer). */
export interface WatchModelLike {
  sessionId: string;
  label: string;
  status: string;
  createdAtIso: string;
  playback: { state: "authorized" | "denied"; reasonCode: "ok" | "rights-denied" };
  renders: WatchRenderLike[] | null;
  story: {
    source: "dev-seed";
    storyKey: string;
    transcript: { startMs: number; endMs: number; text: string; asrConfidence: number }[];
    events: {
      sequence: number;
      timeMs: number;
      type: string;
      phrase: string;
      confidence: number;
    }[];
    waveCount: number;
  } | null;
}

/** The stored-output document (the playback-gate read). */
export interface RenderOutputLike {
  sessionId: string;
  renderId: string;
  segmentId: string;
  contentType: string;
  byteLength: number;
  contentHash: string;
  content: string;
  manifest: {
    segmentId: string;
    frameCount: number;
    totalDurationMs: number;
    frames: { frameIndex: number; outputTimestampMs: number; beginMs: number; durMs: number }[];
    sourceManifest: {
      renderer: { rendererId: string; rendererVersion: string; styleId: string };
      output: { startMs: number; frameIntervalMs: number; durationMs: number };
      frames: {
        frameIndex: number;
        outputTimestampMs: number;
        windowMs: { startMs: number; endMs: number };
        appliedEventSequences: number[];
        captions: {
          statusLine: string | null;
          score: { displayed: boolean; status: string; text?: string } | null;
          clockText: string | null;
          events: { sequence: number; eventId: string; phrase: string }[];
          uncaptionedEvents: { sequence: number; eventId: string; eventTypeRef: string }[];
        };
        possession: {
          status: string;
          entityId?: string;
          confidence?: number;
          displayed: boolean;
        } | null;
        entities: {
          entityId: string;
          kind: string;
          disposition: string;
          positionMeters?: { x: number; y: number };
          svgPosition?: { x: number; y: number };
          confidence?: number;
        }[];
      }[];
      skippedEvents: { sequence: number; eventId: string; eventTimeMs: number; reason: string }[];
      degradation: { degraded: boolean; reasons: string[] };
    };
  };
}

/** The account view (/api/auth/* answers). */
export interface AccountViewLike {
  userId: string;
  username: string;
  email?: string;
  roles: string[];
  createdAtIso: string;
  activeRole: string | null;
}

/** The API error body. */
export interface ApiErrorBodyLike {
  error: { failureClass: string; message: string; details?: Record<string, unknown> };
}
