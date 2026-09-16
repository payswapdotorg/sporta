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

/** One reality of a match session (the W916 card's reality groups). */
export interface RealityGroupLike {
  rendererId: string;
  renderId: string;
  state: "ready" | "no-stored-output" | "renderer-unavailable";
  segmentCount: number;
  hasStoredOutputs: boolean;
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
  /**
   * W916 reality linkage: this match session's renderings grouped per
   * renderer (`null` when playback is denied — no render existence leaked).
   */
  realities?: RealityGroupLike[] | null;
  /** How many realities this match exists in (`null` when denied). */
  realityCount?: number | null;
  /** The visibility flag — present only on the owner/operator view. */
  visibility?: {
    kind: "public" | "private" | "unlisted" | "role-scoped" | "unknown";
    roles: readonly string[];
  } | null;
  /** Operator-only operational fields (present only on the operator view). */
  operational?: { ownerRecorded: boolean } | null;
  story: { source: "dev-seed"; storyKey: string; eventCount: number } | null;
}

/** The requester-view summary every W916 catalog answer carries (self-data). */
export interface CatalogViewerLike {
  state: "anonymous" | "authenticated";
  userId: string | null;
  grants: readonly string[];
}

/** One match entry in the reality-grouped catalog view (/api/catalog/realities). */
export interface RealityMatchLike {
  sessionId: string;
  label: string;
  status: string;
  createdAtIso: string;
  playback: { state: "authorized" | "denied"; reasonCode: "ok" | "rights-denied" };
  realityCount: number | null;
  realities: RealityGroupLike[] | null;
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

/** One entry of the session's real SWM event tail (world-model events). */
export interface WatchEventTailLike {
  sequence: number;
  eventId: string;
  /** The event's real time on the session (match) timeline. */
  eventTimeMs: number;
  /** The taxonomy reference (e.g. `football/v1/pass`). */
  eventTypeRef: string;
  /** The event's real confidence, when the envelope carries one. */
  confidence?: number;
}

/** The watch model (the /api/watch/[sessionId] answer). */
export interface WatchModelLike {
  sessionId: string;
  label: string;
  status: string;
  createdAtIso: string;
  playback: { state: "authorized" | "denied"; reasonCode: "ok" | "rights-denied" };
  renders: WatchRenderLike[] | null;
  /** The session's real SWM event tail (`null` when playback is denied). */
  eventTail: WatchEventTailLike[] | null;
  story: {
    source: "dev-seed";
    storyKey: string;
    /** `readonly` — the server's `SeedStoryMeta` hands out frozen arrays. */
    transcript: readonly { startMs: number; endMs: number; text: string; asrConfidence: number }[];
    events: readonly {
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

/** The Reality Switcher surface (/api/watch/[sessionId]/realities answer). */
export interface RealityOptionsLike {
  /** The match session (constant across every switch — Simulation G). */
  sessionId: string;
  /** The per-renderer availability for THIS session, with real reasons. */
  options: {
    rendererId: string;
    rendererVersion?: string;
    rendererClass?: string;
    state:
      "ready" | "renderer-unavailable" | "rights-denied" | "requires-render" | "no-stored-output";
    reason: string;
    renderId?: string;
    segmentId?: string;
  }[];
}

/** The API error body. */
export interface ApiErrorBodyLike {
  error: { failureClass: string; message: string; details?: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// W906 — the Create Studio (/api/create/* answers)
// ---------------------------------------------------------------------------

/** One authorized source (a real fixture story the engine chain runs). */
export interface StudioSourceLike {
  key: string;
  label: string;
  description: string;
  camera: { pan: number; zoom: number; jitter: number };
  commentary: { startMs: number; endMs: number; text: string }[];
  lexicon: { players: string[]; teams: string[] };
}

/** One real output profile a renderer supports. */
export interface StudioOutputProfileLike {
  resolution: { w: number; h: number };
  frameRate: number;
  codec: string;
  container: string;
  latencyClass: "offline" | "near-live" | "live";
}

/** One selectable renderer (from the real registry, honestly annotated). */
export interface StudioRendererLike {
  rendererId: string;
  rendererVersion: string;
  rendererClass: string;
  requiresSourceFrames: boolean;
  supportedOutputProfiles: StudioOutputProfileLike[];
  artifactHandoff: { supported: boolean; reason: string };
}

/** The studio's opening document (GET /api/create/options). */
export interface StudioOptionsLike {
  sources: StudioSourceLike[];
  renderers: StudioRendererLike[];
  rights: {
    operations: { id: string; label: string; description: string }[];
    sharingScopes: { id: "private" | "operator-authorized"; label: string }[];
  };
  upload: { available: false; reason: string };
  compute: { provider: string; adapterId: string } | null;
}

/** What a rights declaration really permits (POST /api/create/rights-preview). */
export interface RightsPreviewLike {
  capabilities: {
    canReferenceSourceFrames: boolean;
    canDeliverLive: boolean;
    canStoreDerivatives: boolean;
    canShare: boolean;
  };
  sessionCreation: { allowed: boolean; reason: string };
  effects: { capability: string; allowed: boolean; effect: string }[];
}

/** The created studio session (POST /api/create/sessions). */
export interface StudioSessionLike {
  sessionId: string;
  source: StudioSourceLike;
  rightsCapabilities: RightsPreviewLike["capabilities"];
  visibility: "public" | "private";
  story: { eventCount: number; waveCount: number };
}

/** The studio's session state (GET /api/create/sessions/[sessionId]). */
export interface StudioSessionStateLike {
  sessionId: string;
  label: string;
  status: string;
  createdAtIso: string;
  rightsCapabilities: RightsPreviewLike["capabilities"];
  visibility: "public" | "private";
  renders: {
    renderId: string;
    rendererId: string;
    segmentCount: number;
    hasStoredOutputs: boolean;
    rendererHealth: { lagMs: number; degraded: boolean; degradationReason?: string };
  }[];
  jobs: { jobId: string }[];
}

/** The dispatch answer (POST /api/create/sessions/[sessionId]/renders). */
export interface StudioDispatchLike {
  disposition: "admitted" | "duplicate";
  jobId: string;
  idempotencyKey: string;
  sessionId: string;
  adapterId: string;
  jobState: string;
}

/** The job progress view (GET /api/create/sessions/[sessionId]/jobs/[jobId]). */
export interface StudioJobLike {
  jobId: string;
  sessionId: string;
  state: string;
  events: {
    atMs: number;
    type: string;
    fraction?: number;
    stage?: string;
    details?: Record<string, unknown>;
  }[];
  renderId?: string;
  ingest: { status: "pending" | "stored" | "failed" | "none"; error?: string };
  completion?: {
    status: "succeeded" | "failed" | "cancelled";
    failure?: { errorClass: string; message: string; terminal: string };
    outputs: {
      artifactId: string;
      contentType: string;
      byteLength: number;
      frameCount?: number;
      totalDurationMs?: number;
    }[];
    attempts: number;
    claims: number;
    timing: {
      submittedAtMs: number;
      startedAtMs?: number;
      finishedAtMs: number;
      queueWaitMs?: number;
      executionMs: number;
    };
    accounting: {
      consumedInputIds: string[];
      unconsumedInputs: { inputId: string; reason: string }[];
    };
    usage: { unitId: string; quantity: number }[];
  };
}

/** The publication answer (POST /api/create/sessions/[sessionId]/publication). */
export interface StudioPublicationLike {
  sessionId: string;
  visibility: "public" | "private";
}
