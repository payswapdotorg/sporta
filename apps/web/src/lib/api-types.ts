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
  providers: {
    kind: string;
    health: string;
    reasonCode: string;
    detail?: string;
    /** What the provider's degraded state means for viewers (W901 fixture shape). */
    degradedMeaning?: string;
  }[];
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

/** One search result: the card plus which real fields matched (W916). */
export type SearchMatchLike = SessionCardLike & { matchedOn: readonly string[] };

/** The /api/catalog/search answer (W916 — the Search surface's data layer). */
export interface SearchResponseLike {
  catalogSchemaVersion: string;
  viewer: CatalogViewerLike;
  query: { q?: string; status?: string; renderer?: string; rights?: string };
  matches: SearchMatchLike[];
  /** The honest degraded report when the listing skipped terminated sessions. */
  degraded?: { reasonCode: string; skippedSessions: number } | null;
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
  /**
   * The REALITY ARTIFACT CATALOG (R503 shapes, R504/R505's data contract):
   * the four reality entries with their real artifact descriptors. A
   * playback-denied session carries `realities: null` — it reveals nothing.
   */
  artifacts: SessionArtifactCatalogLike;
}

// ---------------------------------------------------------------------------
// R503/R504/R505 — the reality artifact catalog (client-side mirror)
// ---------------------------------------------------------------------------

/** The frozen reality-kind vocabulary (the contracts `RealityKind`). */
export const REALITY_KINDS = ["original", "tactical", "three-d-game", "anime-npr"] as const;
export type RealityKindLike = (typeof REALITY_KINDS)[number];

/** One real artifact descriptor the store actually holds (R503). */
export interface RealityArtifactDescriptorLike {
  artifactId: string;
  kind: RealityKindLike;
  manifestLink: string;
  integrityHash: string;
  byteSize: number;
  contentType: string;
  producerId: string;
}

/** One reality's artifact set for one session (R503). */
export interface RealityArtifactEntryLike {
  kind: RealityKindLike;
  availability:
    | "ready"
    | "job-in-flight"
    | "job-failed"
    | "requires-render"
    | "requires-upload"
    | "producer-unavailable";
  reason: string;
  artifacts: RealityArtifactDescriptorLike[];
}

/** One session's reality artifact catalog (R503 — the player's contract). */
export interface SessionArtifactCatalogLike {
  sessionId: string;
  label: string;
  status: string;
  createdAtIso: string;
  playback: { state: "authorized" | "denied"; reasonCode: "ok" | "rights-denied" };
  realities: RealityArtifactEntryLike[] | null;
  readyRealityCount: number | null;
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
  /**
   * The honest upload answer (R501): a REAL browser upload constrained
   * exactly as the R101 boundary enforces it server-side, or the honest
   * reason it is unavailable.
   */
  upload:
    | {
        available: true;
        constraints: { container: "mp4"; maxBytes: number; maxDurationMs: number };
      }
    | { available: false; reason: string };
  compute: { provider: string; adapterId: string } | null;
  /** The compute-selection surface (R501): the selectable providers' facts. */
  selection: {
    providers: {
      providerId: string;
      privacyZone: string;
      capabilityClasses: string[];
      vramMb?: number;
    }[];
  } | null;
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

// ---------------------------------------------------------------------------
// R501 — the upload path + the compute step (/api/create/* answers)
// ---------------------------------------------------------------------------

/** The uploaded source's durable state (the R101 records' fields). */
export interface StudioUploadSourceLike {
  asset: {
    assetId: string;
    contentHash: string;
    byteSize: number;
    container: string;
    durationMs: number;
    uploadState: string;
    checksumVerified: boolean;
    declaredRightsPolicyId: string;
  };
  /** The latest media job for the asset (its REAL state — the R103 view). */
  job: MediaJobLike | null;
  /** The stored `original`-reality artifact manifest, once the job stored one. */
  artifact: { artifactId: string; contentHash: string; reality: string } | null;
}

/** The honest summary of the R207 real-to-SWM run over an uploaded clip. */
export interface StudioUploadPerceptionLike {
  frameCount: number;
  snapshotCount: number;
  eventCount: number;
  degradationCount: number;
  summary: string;
}

/** The created UPLOAD-source session (POST /api/create/upload-sessions). */
export interface StudioUploadSessionLike {
  sessionId: string;
  label: string;
  rightsCapabilities: RightsPreviewLike["capabilities"];
  visibility: "public" | "private";
  source: StudioUploadSourceLike;
  perception: StudioUploadPerceptionLike;
}

/**
 * The media pipeline's honest job view (GET /api/media/jobs/[jobId] — the
 * R103 projection): the W914 state vocabulary, the stage-completion trail
 * (progress TIED to actual completions), and the typed failure verbatim.
 */
export interface MediaJobLike {
  jobId: string;
  sourceAssetId: string;
  sessionId: string;
  state: string;
  terminal: boolean;
  progress: number;
  stages: { stage: string; atMs: number; fraction: number }[];
  failure?: { failureClass: string; message: string };
  result?: { manifestId: string; artifactId: string };
  createdAtMs: number;
  updatedAtMs: number;
}

/** The caller's compute-selection directive (the R407 vocabulary). */
export interface StudioComputeDirectiveLike {
  mode: "user-explicit" | "sporta-auto";
  providerId?: string;
  preference?: {
    privacyPosture: "privacy-local-only" | "privacy-any";
    maxEstimatedCostUsd?: number;
    maxEstimatedQueueSeconds?: number;
    vramFloorMb?: number;
    capabilityClass?: string;
  };
}

/** One considered provider in the auditable selection explanation. */
export interface SelectionConsideredLike {
  providerId: string;
  quote?: {
    providerId: string;
    capability: {
      providerKind: string;
      maxConcurrentJobs: number;
      maxJobDeadlineMs: number;
      supportedLatencyClasses: string[];
    };
    estimatedCostUsd: number | null;
    estimatedQueueSeconds: number | null;
    quotedAtMs: number;
    validUntilMs: number;
  };
  brokerRefusal?: { reason: string; message: string };
  preferenceExclusion?: { axis: string; message: string };
}

/** The R407 auditable explanation document (verbatim). */
export interface SelectionExplanationLike {
  schemaVersion: string;
  decidedAtMs: number;
  mode: "user-explicit" | "sporta-auto";
  requestedProviderId?: string;
  selectedProviderId: string;
  selectionReason: string;
  appliedPreference: {
    privacyPosture: string;
    maxEstimatedCostUsd?: number;
    maxEstimatedQueueSeconds?: number;
    vramFloorMb?: number;
    capabilityClass?: string;
  };
  considered: SelectionConsideredLike[];
}

/** The compute step's answer (POST /api/create/compute-preview). */
export interface StudioComputeSelectionLike {
  request: {
    rendererId: string;
    rendererVersion?: string;
    latencyClass: "offline" | "near-live" | "live";
    deadlineMs: number;
  };
  selection: { providerId: string };
  explanation: SelectionExplanationLike;
}

/** The studio's session state (GET /api/create/sessions/[sessionId]). */
export interface StudioSessionStateLike {
  sessionId: string;
  label: string;
  status: string;
  createdAtIso: string;
  rightsCapabilities: RightsPreviewLike["capabilities"];
  visibility: "public" | "private";
  /**
   * The session's SOURCE state (R501): the fixture key the engine chain
   * ran, or the uploaded clip's durable R101 records (asset + media job +
   * stored artifact — the persistent source state a fresh browser sees
   * after refresh), or `null` when no source is recorded.
   */
  source: { kind: "fixture"; key: string } | ({ kind: "upload" } & StudioUploadSourceLike) | null;
  renders: {
    renderId: string;
    rendererId: string;
    segmentCount: number;
    hasStoredOutputs: boolean;
    rendererHealth: { lagMs: number; degraded: boolean; degradationReason?: string };
  }[];
  /**
   * The session's studio-dispatched compute jobs with their LIVE state and
   * the renderer the dispatch named (recorded at dispatch). This is the
   * W908 processing source: an in-flight job means the watch surface shows
   * `processing` for that renderer — never a spinner pretending nothing is
   * happening. R506: each row also carries the COMPUTE SELECTION its
   * dispatch carried (provider + user-choice/auto mode + the auditable
   * explanation VERBATIM) — present only when a directive rode the dispatch.
   */
  jobs: {
    jobId: string;
    state: string;
    rendererId: string | null;
    selection?: {
      providerId: string;
      mode: "user-explicit" | "sporta-auto";
      explanation: SelectionExplanationLike;
    };
  }[];
}

/** The dispatch answer (POST /api/create/sessions/[sessionId]/renders). */
export interface StudioDispatchLike {
  disposition: "admitted" | "duplicate";
  jobId: string;
  idempotencyKey: string;
  sessionId: string;
  adapterId: string;
  jobState: string;
  /**
   * The compute selection the dispatch verified (R501): the selected
   * provider + the auditable explanation — present when the dispatch
   * carried a compute directive.
   */
  selection?: {
    providerId: string;
    mode: "user-explicit" | "sporta-auto";
    explanation: SelectionExplanationLike;
  };
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
  /**
   * The compute selection the dispatch carried (R506): whose compute is
   * executing this job — the selected provider, the user-choice vs auto
   * mode, and the auditable explanation VERBATIM. Absent when the dispatch
   * carried no directive (the honest boundary — nothing is invented).
   */
  selection?: {
    providerId: string;
    mode: "user-explicit" | "sporta-auto";
    explanation: SelectionExplanationLike;
  };
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

// ---------------------------------------------------------------------------
// R506 — the compute/cost status (a projection of connection-center state)
// ---------------------------------------------------------------------------

/** One user-scoped allowance state (the W901 QuotaState vocabulary). */
export interface ComputeQuotaStateLike {
  quotaId: string;
  scope: string;
  /** `null` = not measured (never rendered as 0 — the W919 posture). */
  used: number | null;
  limit: number | null;
  remaining: number | null;
  exhausted: boolean;
  reasonCode: string;
}

/**
 * The caller's compute/cost document (GET /api/create/compute-status):
 * whose compute plane this deployment renders on, the caller's daily
 * allowance states, and the metered usage totals where available (null =
 * not measured). A PROJECTION of connection-center state — no new domain
 * vocabulary.
 */
export interface StudioComputeStatusLike {
  /** The compute plane's real configuration (`null` = no plane configured). */
  plane: {
    provider: string;
    adapterId: string;
    /** The selection seam's registered provider id (DATA, never a vendor name). */
    providerId: string;
    /** The operator's declared responsibility boundary (R408 vocabulary). */
    executionOwnership: "sporta-managed" | "user-owned-provider";
    facts: { privacyZone: string; capabilityClasses: string[] };
  } | null;
  /** The caller's daily compute allowance states (fail-closed entries on unreadable). */
  quotas: ComputeQuotaStateLike[];
  /** The metered usage totals across the plane (`null` = not measured). */
  usage: { unitId: string; quantity: number }[] | null;
}

// ---------------------------------------------------------------------------
// W907 — the role-workspace documents
// ---------------------------------------------------------------------------

/** One rights-policy record in the Rights Center (/api/rights/center). */
export interface RightsCenterEntryLike {
  sessionId: string;
  label: string;
  status: string;
  createdAtIso: string;
  policyId: string;
  rightsCapabilities: {
    canReferenceSourceFrames: boolean;
    canDeliverLive: boolean;
    canStoreDerivatives: boolean;
    canShare: boolean;
  };
  visibility: "public" | "private";
  access: "owned" | "operator";
}

/** The Rights Center document (/api/rights/center answer). */
export interface RightsCenterLike {
  scope: "owned" | "operator";
  entries: RightsCenterEntryLike[];
  note: string;
}

/** One job row in the Jobs workspace (/api/workspaces/jobs). */
export interface WorkspaceJobRowLike {
  sessionId: string;
  jobId: string;
  state: string;
  progressFraction?: number;
  ingest: { status: "pending" | "stored" | "failed" | "none"; error?: string };
  completion?: {
    status: "succeeded" | "failed" | "cancelled";
    /** The TYPED failure verbatim (R502 — error class + message + terminal). */
    failure?: { errorClass: string; message: string; terminal: string };
    failureMessage?: string;
    executionMs: number;
    usage: { unitId: string; quantity: number }[];
  };
}

/** One session's job group in the Jobs workspace. */
export interface WorkspaceJobsSessionLike {
  sessionId: string;
  label: string;
  status: string;
  jobs: WorkspaceJobRowLike[];
}

/** The Jobs workspace document (/api/workspaces/jobs answer). */
export interface JobsOverviewLike {
  scope: "owned" | "operator";
  sessions: WorkspaceJobsSessionLike[];
}

/** The pending-work document (/api/workspaces/pending-work answer). */
export interface PendingWorkLike {
  /** Only roles the account holds — absent roles carry no badge (honest). */
  roles: Partial<Record<string, { label: string; count: number }>>;
}

/** The Operations document (/api/operations answer, operator-only). */
export interface OperationsLike {
  health: {
    env: string;
    deployMarker: string | null;
    providers: Record<
      string,
      { provider: string; configured: boolean; check: { state: string; detail?: string } }
    >;
    usageGuardrails: { note: string; storeLimits: Record<string, number> };
    renderQueue: { key: string; maxDepth: number; admissionLeaseMs: number; depth: number | null };
  };
  compute: { provider: string; adapterId: string } | null;
  queues: { key: string; maxDepth: number; admissionLeaseMs: number; depth: number | null };
  live: { state: "unavailable" | "active"; detail: string; servingSources: number };
  failedJobs: { sessionId: string; jobId: string; state: string; failureMessage?: string }[];
}

// W917 — the Rights Center (policy inspection / editing / revocation)
// ---------------------------------------------------------------------------

/** The rights vocabulary (structural mirror of the contracts' enums). */
export const RIGHTS_OPERATIONS = [
  "analysis",
  "transformation",
  "liveDelivery",
  "derivativeGeneration",
  "storage",
  "sharing",
] as const;
export type RightsOperationLike = (typeof RIGHTS_OPERATIONS)[number];

/** One session's rights policy as the Rights Center answers it. */
export interface RightsPolicyLike {
  policyId: string;
  allowedOperations: RightsOperationLike[];
  assertedBy: string;
  expiresAtIso?: string;
  storageDurationDays?: number;
  sharingScope?: "private" | "operator-authorized";
}

/** The W916 visibility record as the Rights Center answers it. */
export interface RightsVisibilityLike {
  kind: "public" | "private" | "unlisted" | "role-scoped";
  roles: string[];
  setBy: string | null;
  setAtIso: string | null;
}

/** One Rights Center entry (GET /api/rights/policies). */
export interface RightsPolicyEntryLike {
  sessionId: string;
  label: string;
  status: string;
  createdAtIso: string;
  access: "owned" | "attested" | "operator";
  policy: RightsPolicyLike | null;
  effectiveSource: "creation" | "edited" | "unrecorded";
  rightsCapabilities: RightsPreviewLike["capabilities"];
  revoked: boolean;
  visibility: RightsVisibilityLike | null;
  lastChange: { atIso: string; actorUserId: string; changeKind: string } | null;
}

/** The scoped policy list (GET /api/rights/policies). */
export interface RightsCenterListLike {
  viewer: { userId: string; grants: string[] };
  entries: RightsPolicyEntryLike[];
  note: string;
}

/** One append-only policy-change record (who/what/when). */
export interface PolicyAuditEntryLike {
  atIso: string;
  actorUserId: string;
  sessionId: string;
  changeKind: "visibility" | "policy" | "revocation";
  summary: string;
  from: unknown;
  to: unknown;
}

/** The one-session inspection answer (GET /api/rights/policies/[sessionId]). */
export interface RightsCenterInspectLike {
  entry: RightsPolicyEntryLike;
  audit: PolicyAuditEntryLike[];
}

/** The caller's audit trail (GET /api/rights/audit). */
export interface RightsAuditListLike {
  viewer: { userId: string; grants: string[] };
  entries: PolicyAuditEntryLike[];
}

// Operations console (W918) — the operator workspace's client-safe model
// ---------------------------------------------------------------------------

/** The health board's snapshot (GET /api/operations/health). */
export interface OperationsHealthLike {
  /** The environment tier ("local" | "preview" | "beta-personal"). */
  env: string;
  deployMarker: string | null;
  overall: "ok" | "degraded" | "error";
  providers: {
    identity: { provider: string; configured: boolean; state: string; detail: string };
    artifacts: { provider: string; configured: boolean; state: string; detail: string };
    transientState: { provider: string; configured: boolean; state: string; detail: string };
  };
  /** The W919 spend alarms (window-scoped, persisted limit states). */
  spendAlarms: {
    limitId: string;
    provider: string;
    state: "under" | "approaching" | "reached" | "exceeded" | "unmeasured";
    used: number | null;
    limit: number;
    unit: string;
    changedAtMs: number;
    transitioned: boolean;
    previousState: string | null;
  }[];
  compute: { configured: boolean; provider: string | null; adapterId: string | null };
  liveTransport: { state: string; note: string };
  renderQueue: {
    key: string;
    maxDepth: number;
    admissionLeaseMs: number;
    depth: number | null;
  };
}

/** The queue panel's snapshot (GET /api/operations/queues). */
export interface OperationsQueuesLike {
  provider: "upstash" | "in-memory";
  queue: {
    key: string;
    maxDepth: number;
    admissionLeaseMs: number;
    depth: number | null;
    utilization: number | null;
    entries: {
      jobId: string;
      userId: string | null;
      kind: string;
      enqueuedAtMs: number;
      ageMs: number;
    }[];
  };
  admissionRefusals: {
    count: number;
    last: { atMs: number; depth: number; maxDepth: number } | null;
    note: string;
  };
}

/** The provider panel's snapshot (GET /api/operations/providers). */
export interface OperationsProvidersLike {
  providers: {
    provider: string;
    usage: "measured" | "unknown";
    counters: { name: string; value: number }[];
    limits: { name: string; value: number | string }[];
    /** The W919 ledger evaluations (usage vs threshold, honest unmeasured). */
    limitStates: {
      limitId: string;
      name: string;
      used: number | null;
      limit: number;
      unit: string;
      state: "under" | "approaching" | "reached" | "exceeded" | "unmeasured";
      admissionEnforced: boolean;
      meterNote: string;
      source: string;
    }[];
    note: string;
  }[];
  notes: string[];
}

/** One job row in the console's jobs table (GET /api/operations/jobs). */
export interface OperationsJobLike {
  jobId: string;
  sessionId: string;
  state: string;
  rendererId: string | null;
  dispatchedByUserId: string | null;
  dispatchedAtMs: number;
  admission: { released: boolean; admissionId: string | null };
  renderId: string | null;
  completion: {
    status: string;
    failure: { errorClass: string; message: string; terminal: string } | null;
    outputs: number;
    accounting: {
      consumedInputs: number;
      unconsumedInputs: { inputId: string; reason: string }[];
    } | null;
    usage: { unitId: string; quantity: number }[];
  } | null;
  unavailableReason: string | null;
}

/** The jobs panel's snapshot (GET /api/operations/jobs). */
export interface OperationsJobsLike {
  jobs: OperationsJobLike[];
  totals: {
    all: number;
    failed: number;
    inFlight: number;
    cancelled: number;
    succeeded: number;
  };
  computeUnavailable: boolean;
}

/** The audit panel's snapshot (GET /api/operations/audit). */
export interface OperationsAuditLike {
  records: {
    atMs: number;
    actorUserId: string;
    actorUsername: string;
    action: string;
    targetJobId: string;
    sessionId: string | null;
    outcome: "succeeded" | "refused";
    detail: string;
  }[];
  note: string;
}

/** The retry action's result (POST /api/operations/jobs/[jobId]/retry). */
export interface OperationsRetryLike {
  originalJobId: string;
  newJobId: string;
  disposition: string;
  note: string;
}

/** The cancel action's result (POST /api/operations/jobs/[jobId]/cancel). */
export interface OperationsCancelLike {
  jobId: string;
  cancelled: boolean;
  alreadyTerminal: string | null;
}
