/**
 * THE CREATE STUDIO SERVICE (W906 → R501) — the server side of the guided
 * creation flow, over the REAL seams only:
 *
 * - SOURCE SELECTION is now TWO real paths (R501): the checked-in FIXTURE
 *   LIBRARY (an explicitly-labeled dev surface — real engine inputs, never
 *   invented media) OR a REAL browser upload — an authorized MP4 through
 *   the R101 ingestion boundary (the composition's media service:
 *   server-side constraint validation BEFORE storage, a durable
 *   hash-verified `SourceAsset`, a real processing job) whose bytes feed
 *   the REAL R207 real-to-SWM pipeline, so the session's world model is
 *   derived from the UPLOADED clip (real decode + real perception chains,
 *   never invented state);
 * - session creation goes through the REAL identity control gate
 *   (`createMediaSession` — the W902 pattern: identity-attested policy,
 *   ownership recorded), then registers the fused engine, exactly like
 *   the dev seed (fixture path) or the pipeline run (upload path);
 * - the COMPUTE step goes through the REAL R407 SelectionDirector (user
 *   choice or auto, with the auditable explanation shown); the dispatch
 *   re-verifies the same deterministic decision and then goes through the
 *   control plane's W914 ASYNC surface (`createRenderAsync` → the
 *   configured compute adapter → a REAL render job executing through the
 *   REAL renderer plugin + the REAL W504 encoder and store, with the
 *   never-silent input accounting);
 * - job polling is the control plane's OWN `getComputeJob` projection (and
 *   the media pipeline's OWN `MediaJobView` for the upload path — both
 *   honest state projections, never interpolated progress);
 * - rights PREVIEWS derive from `@sporta/contracts`' fail-closed
 *   `deriveRightsCapabilities` — this module never invents rights semantics;
 * - publish/private is the real {@link PublicationStore} flag.
 *
 * HONEST LIMITATIONS (surfaced to the UI): the studio job index and
 * publication state are in-memory with the composition's other
 * control-plane state; the R207 upload-path perception run and the R101
 * normalization BOTH execute on the request path's process (real ffmpeg —
 * a missing binary fails loud, never a faked pipeline); offered realities
 * are only the ones whose producer is registered on this control plane.
 *
 * J004 — THE ONE-SUBMISSION MULTI-REALITY PLAN (docs/contracts/
 * multi-reality-create.md, FROZEN): the upload route's additive `realities`
 * field selects the DERIVED reality kinds (tactical / three-d-game /
 * anime-npr — "original" is NOT a selection; the admitted media job's
 * normalization ALWAYS produces the original-reality artifact). After the
 * upload's media job reaches its stored-original state, this service
 * dispatches ONE async render per selected derived reality through the
 * SAME `createRenderAsync` surface the single-render path uses, under ONE
 * compute selection directive (the user's sporta-auto or user-explicit
 * choice — no per-reality re-selection). Per-reality failures are honest
 * and independent: one reality refusing (rights, producer-unavailable,
 * compute refusal) NEVER silently cancels the others; each refusal
 * surfaces in the plan's state with its typed failure class. The durable
 * result state rides the EXISTING job/render surfaces (session state, Jobs,
 * Watch availability) — no new state machine, no second source of truth.
 */
import { deriveRightsCapabilities } from "@sporta/contracts";
import type { AuthorizationPolicy, RightsCapabilities } from "@sporta/contracts";
import type { AllowedOperation, SharingScope } from "@sporta/contracts";
import type { ComputeQuoteRequest } from "@sporta/compute-adapter";
import { COMPUTE_SCHEMA_VERSION } from "@sporta/compute-adapter";
import { sniffContainer } from "@sporta/ingestion";
import { UPLOAD_CONSTRAINTS, sha256OfBytes } from "@sporta/media-platform";
import type { MediaJobView } from "@sporta/media-platform";
import { RealToSwmPipeline } from "@sporta/real-to-swm";
import type { ClipSource } from "@sporta/real-to-swm";
import type { SelectionExplanation } from "@sporta/connection-center";
import {
  IdentityPermissionDeniedError,
  IdentityValidationError,
  authorize,
} from "@sporta/identity";
import type { Account } from "@sporta/identity";
import type { WorldModelEngine as WorldModelEngineInstance } from "@sporta/world-model";
import type { RealityKind } from "@sporta/contracts";
import type { SportaServer } from "./composition";
import type { SeedStoryMeta } from "./dev-seed";
import type { ControlRenderRecipe } from "./platform/control/records";
import { RENDER_REQUESTS_QUOTA } from "./platform/upstash/hosted";
import type { PlatformQuotaState } from "./platform/upstash/quotas";
import { QueueFullError, RateLimitedError, retryAfterSeconds } from "./platform/upstash/guards";
import { DERBY_STORY, FRIENDLY_STORY, TRAINING_STORY, runFixtureStory } from "./dev-story";
import type { FixtureStorySpec, StoryRun } from "./dev-story";
import type { SessionVisibility } from "./publication";

/**
 * A collision-safe crypto-random id (W921): 16 bytes of REAL platform
 * entropy, hex-encoded. User-created sessions (`sess-u-…`) and their
 * renders (`r-u-…`) carry these ids so two serverless instances can never
 * allocate the same id for different state (the W920 gate's defect class).
 */
function randomHexId(prefix: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${hex}`;
}

/**
 * The durable source-key prefix of an UPLOAD-source studio session (R501):
 * `"upload:" + <the R101 source asset id>`. The asset id in the record is
 * the honest join — the durable layer reconstructs the session's engine by
 * re-running the real-to-SWM pipeline over THAT asset's stored bytes, and
 * the studio's session-state read resolves the source through it.
 */
export const STUDIO_UPLOAD_SOURCE_PREFIX = "upload:";

/**
 * The real-to-SWM pipeline's DELIBERATE decode budget for studio uploads
 * (R501 — a recorded decision, never a default): the same 1 GiB bound the
 * R208 replay-determinism gate declares over the 250-frame reference clip.
 * A clip whose decoded volume exceeds it refuses with the pipeline's typed
 * resource-limit error — honest, never a silent truncation.
 */
export const STUDIO_UPLOAD_DECODE_BUDGET_BYTES = 1024 * 1024 * 1024;

/**
 * The whole-job render deadline the studio's dispatches and compute quotes
 * share (the W304 `renderDeadlineMs` default `createRenderAsync` itself
 * uses — the compute step quotes the SAME workload shape the dispatch
 * runs, so the explanation the user saw is the decision the dispatch
 * verified).
 */
const STUDIO_RENDER_DEADLINE_MS = 60_000;

// ---------------------------------------------------------------------------
// Views (the JSON shapes the /api/create/* routes serve)
// ---------------------------------------------------------------------------

/** The vocabulary the rights declaration previews are phrased in. */
export const RIGHTS_OPERATIONS: readonly {
  id: AllowedOperation;
  label: string;
  description: string;
}[] = [
  {
    id: "analysis",
    label: "Analysis",
    description: "The session's model may be analyzed (events, tactics, statistics).",
  },
  {
    id: "transformation",
    label: "Transformation",
    description: "Renderers may reference source frames while transforming the session.",
  },
  {
    id: "liveDelivery",
    label: "Live delivery",
    description: "The session may be delivered as a live stream (no live transport exists yet).",
  },
  {
    id: "derivativeGeneration",
    label: "Derivative generation",
    description: "New viewing realities may be rendered from the session.",
  },
  {
    id: "storage",
    label: "Storage",
    description: "Rendered derivatives may be stored (stored playback requires this).",
  },
  {
    id: "sharing",
    label: "Sharing",
    description: "Derivatives may be shared beyond the creator.",
  },
];

/** One selectable authorized source (a real fixture story). */
export interface StudioSourceView {
  key: string;
  label: string;
  description: string;
  /** The story's REAL fixture camera parameters. */
  camera: { pan: number; zoom: number; jitter: number };
  /** The story's REAL fixture commentary transcript. */
  commentary: readonly { startMs: number; endMs: number; text: string }[];
  /** The fixture-scoped entity vocabulary (real W209 input). */
  lexicon: { players: readonly string[]; teams: readonly string[] };
}

/** The latency-class vocabulary (the frozen contracts enum). */
export type StudioLatencyClass = "offline" | "near-live" | "live";

/** One real output profile a renderer supports. */
export interface StudioOutputProfile {
  resolution: { w: number; h: number };
  frameRate: number;
  codec: string;
  container: string;
  latencyClass: StudioLatencyClass;
}

/** One selectable renderer (from the REAL registry, honestly annotated). */
export interface StudioRendererView {
  rendererId: string;
  rendererVersion: string;
  rendererClass: string;
  requiresSourceFrames: boolean;
  /** The renderer's REAL supported output profiles. */
  supportedOutputProfiles: StudioOutputProfile[];
  /**
   * Whether the compute worker's artifact handoff supports this renderer
   * (the W502 detailed render surface the W504 encoder consumes). Honest:
   * `sporta.testcard` renders but cannot hand artifacts back through the
   * async compute path this wave.
   */
  artifactHandoff: { supported: boolean; reason: string };
}

/** The studio's opening document (GET /api/create/options). */
export interface StudioOptions {
  sources: StudioSourceView[];
  renderers: StudioRendererView[];
  rights: {
    operations: typeof RIGHTS_OPERATIONS;
    sharingScopes: { id: SharingScope; label: string }[];
  };
  /**
   * The honest upload answer (R501): the studio's source step offers a REAL
   * browser upload constrained exactly as the R101 boundary enforces it
   * server-side (mp4 container, size, duration — the frozen
   * `UPLOAD_CONSTRAINTS` constants), or the honest reason upload is not
   * available. Never a fake upload, never an invented constraint.
   */
  upload:
    | {
        available: true;
        constraints: {
          container: "mp4";
          maxBytes: number;
          maxDurationMs: number;
        };
      }
    | { available: false; reason: string };
  /** The compute plane the async renders dispatch through (or null). */
  compute: { provider: string; adapterId: string } | null;
  /**
   * The compute SELECTION surface (R501): the providers the REAL
   * SelectionDirector can select between, with the operator's declared
   * facts (data — privacy zone, capability classes, VRAM when declared).
   * `null` when no selection seam is configured (the compute step then
   * shows the honest unavailable state).
   */
  selection: {
    providers: {
      providerId: string;
      privacyZone: string;
      capabilityClasses: string[];
      vramMb?: number;
    }[];
  } | null;
  /**
   * J004: the honest derived-reality capability states for the ONE-submission
   * multi-select — one row per derived reality kind (tactical / three-d-game
   * / anime-npr; "original" is NOT a selection: the admitted media job's
   * normalization always produces the original-reality artifact). Only
   * registered, artifact-handoff-capable producers are offered; the reason
   * line is the honest explanation for every state, never invented.
   */
  derivedRealities: {
    reality: StudioDerivedRealityKind;
    /** The registered producer renderer id (null when none is registered). */
    producerRendererId: string | null;
    offered: boolean;
    reason: string;
  }[];
  /**
   * The caller's live render-request quota state (W913 — the studio's honest
   * degraded-state input; `null` when the caller is not authenticated).
   */
  renderQuota: PlatformQuotaState | null;
}

/** A caller's rights declaration (pre-attestation — the gate re-attests). */
export interface RightsDeclarationInput {
  operations: readonly string[];
  expiresAtIso?: string;
  storageDurationDays?: number;
  sharingScope?: string;
}

/** The real derivation + its product meaning (POST /api/create/rights-preview). */
export interface RightsPreview {
  capabilities: RightsCapabilities;
  /** Whether the control plane would admit a session under this policy. */
  sessionCreation: { allowed: boolean; reason: string };
  /** What the policy means for the studio flow, derived — never asserted. */
  effects: { capability: keyof RightsCapabilities; allowed: boolean; effect: string }[];
}

/** The created studio session (POST /api/create/sessions). */
export interface StudioSessionView {
  sessionId: string;
  source: StudioSourceView;
  rightsCapabilities: RightsCapabilities;
  visibility: SessionVisibility;
  story: { eventCount: number; waveCount: number };
}

/** The uploaded source's durable state (the R101 records, verbatim fields). */
export interface StudioUploadSourceState {
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
  job: MediaJobView | null;
  /** The stored `original`-reality artifact manifest, once the job stored one. */
  artifact: { artifactId: string; contentHash: string; reality: string } | null;
}

/** The honest summary of the R207 real-to-SWM run over an uploaded clip. */
export interface StudioUploadPerceptionSummary {
  frameCount: number;
  snapshotCount: number;
  eventCount: number;
  degradationCount: number;
  /** The degradation ledger's own one-line summary (verbatim). */
  summary: string;
}

/**
 * The created UPLOAD-source studio session (POST /api/create/upload-sessions):
 * the session view's shape plus the durable source state (the R101 asset +
 * the admitted media job) and the honest perception summary of the R207
 * run that fed the session's world model.
 */
export interface StudioUploadSessionView {
  sessionId: string;
  label: string;
  rightsCapabilities: RightsCapabilities;
  visibility: SessionVisibility;
  source: StudioUploadSourceState;
  perception: StudioUploadPerceptionSummary;
  /**
   * J004 (additive): the ONE-submission render plan, present ONLY when the
   * upload carried the `realities` field (its absence preserves today's
   * behavior byte-for-byte — upload + original only, no member). Per-reality
   * renderId/jobId/state at answer time, plus each refusal's typed failure
   * class; the durable states ride the EXISTING job/render surfaces.
   */
  renderPlan?: StudioRenderPlan;
}

/** The derived reality kinds a ONE-submission plan can select (J004). */
export type StudioDerivedRealityKind = "tactical" | "three-d-game" | "anime-npr";

/** The closed vocabulary of the plan's selections ("original" excluded). */
export const DERIVED_REALITY_SELECTION_KINDS: readonly StudioDerivedRealityKind[] = Object.freeze([
  "tactical",
  "three-d-game",
  "anime-npr",
]);

/** One reality's entry in the ONE-submission render plan (J004). */
export interface StudioRealityPlanEntry {
  /** The selected derived reality kind (never "original"). */
  reality: StudioDerivedRealityKind;
  /** The producer renderer the kind resolved through (null when it refused). */
  rendererId: string | null;
  /** The entry's disposition at answer time. */
  disposition: "admitted" | "duplicate" | "failed";
  /** The stored render id, when the job's render was already ingested. */
  renderId?: string;
  /** The dispatched compute job id (present for admitted/duplicate entries). */
  jobId?: string;
  /** The job's REAL state at answer time (the control plane's projection). */
  jobState?: string;
  /** The typed failure class + message when the disposition is `failed`. */
  failure?: { errorClass: string; message: string };
}

/** The ONE-submission render plan carried by the upload answer (J004). */
export interface StudioRenderPlan {
  /** The plan's entries, in the submission's selection order. */
  realities: StudioRealityPlanEntry[];
  /**
   * The ONE compute selection that covered the whole plan (present when a
   * directive rode the submission and at least one dispatch verified it —
   * the user's sporta-auto or user-explicit choice, explained verbatim).
   */
  selection?: {
    providerId: string;
    mode: "user-explicit" | "sporta-auto";
    explanation: SelectionExplanation;
  };
}

/** The studio's session state (GET /api/create/sessions/[sessionId]). */
export interface StudioSessionState {
  sessionId: string;
  label: string;
  status: string;
  createdAtIso: string;
  rightsCapabilities: RightsCapabilities;
  visibility: SessionVisibility;
  /**
   * The session's SOURCE state (R501, additive): the fixture key the engine
   * chain ran, or the uploaded clip's durable R101 records (asset + media
   * job + stored artifact — the persistent source state a fresh browser
   * sees after refresh), or `null` when no source is recorded for the
   * session on this instance. Derived from the REAL stores only.
   */
  source: { kind: "fixture"; key: string } | ({ kind: "upload" } & StudioUploadSourceState) | null;
  renders: {
    renderId: string;
    rendererId: string;
    segmentCount: number;
    hasStoredOutputs: boolean;
    rendererHealth: { lagMs: number; degraded: boolean; degradationReason?: string };
  }[];
  /**
   * The session's studio-dispatched compute jobs, each with its LIVE state and
   * the renderer the dispatch named (recorded at dispatch; `null` when the
   * dispatch record is gone — never invented). W908: this is the watch
   * surface's `processing` source. A state of `unreadable` means the compute
   * read refused — the honest boundary, never a guessed state.
   */
  jobs: {
    jobId: string;
    state: string;
    rendererId: string | null;
    /**
     * The COMPUTE SELECTION the dispatch carried (R506): whose compute is
     * executing — provider + user-choice/auto mode + the auditable
     * explanation VERBATIM. Absent when the dispatch carried no directive.
     */
    selection?: {
      providerId: string;
      mode: "user-explicit" | "sporta-auto";
      explanation: SelectionExplanation;
    };
  }[];
}

/** The dispatch answer (POST /api/create/sessions/[sessionId]/renders). */
export interface StudioDispatchView {
  disposition: "admitted" | "duplicate";
  jobId: string;
  idempotencyKey: string;
  sessionId: string;
  adapterId: string;
  jobState: string;
  /**
   * The stored render id, when the job's render was already ingested at
   * dispatch return (the control plane's own answer, additive — J004 carries
   * it into the plan entries; absent means not ingested yet, never missing).
   */
  renderId?: string;
  /**
   * The compute selection the dispatch verified (R501, additive): the
   * provider the REAL SelectionDirector selected under the caller's
   * directive and the auditable explanation document — present when the
   * dispatch carried a compute directive.
   */
  selection?: {
    providerId: string;
    mode: "user-explicit" | "sporta-auto";
    explanation: SelectionExplanation;
  };
}

/** The job progress view (GET /api/create/sessions/[sessionId]/jobs/[jobId]). */
export interface StudioJobView {
  jobId: string;
  sessionId: string;
  state: string;
  /** The decision/progress trail in occurrence order (real compute events). */
  events: {
    atMs: number;
    type: string;
    fraction?: number;
    stage?: string;
    details?: Record<string, unknown>;
  }[];
  renderId?: string;
  /**
   * The COMPUTE SELECTION the dispatch carried (R506): whose compute is
   * executing this job — provider + user-choice/auto mode + the auditable
   * explanation VERBATIM. Absent when the dispatch carried no directive
   * (the honest boundary — nothing is invented).
   */
  selection?: {
    providerId: string;
    mode: "user-explicit" | "sporta-auto";
    explanation: SelectionExplanation;
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
    /** The never-silent input accounting (always present once terminal). */
    accounting: {
      consumedInputIds: string[];
      unconsumedInputs: { inputId: string; reason: string }[];
    };
    /** The metered cost quantities (descriptor-declared units). */
    usage: { unitId: string; quantity: number }[];
  };
}

/** The caller's compute/cost status document (R506 — GET /api/create/compute-status). */
export interface StudioComputeStatus {
  /** The compute plane's real configuration (`null` when none is configured). */
  plane: {
    provider: string;
    adapterId: string;
    /** The selection seam's registered provider id (DATA, never a vendor name). */
    providerId: string;
    /** The operator's declared responsibility boundary (the R408 vocabulary). */
    executionOwnership: "sporta-managed" | "user-owned-provider";
    facts: { privacyZone: string; capabilityClasses: string[] };
  } | null;
  /** The caller's daily compute allowance states (fail-closed on unreadable). */
  quotas: PlatformQuotaState[];
  /** The plane's metered usage totals (`null` = not measured — never a 0). */
  usage: { unitId: string; quantity: number }[] | null;
}

/** The publication answer (POST /api/create/sessions/[sessionId]/publication). */
export interface StudioPublicationView {
  sessionId: string;
  visibility: SessionVisibility;
}

/** One job row for the Jobs workspace surfaces (W907). */
export interface StudioJobRow {
  sessionId: string;
  jobId: string;
  /** The job's REAL compute state (admitted/dispatched/queued/in-flight/…). */
  state: string;
  /** The last real progress fraction on the event trail, when one exists. */
  progressFraction?: number;
  ingest: { status: "pending" | "stored" | "failed" | "none"; error?: string };
  completion?: {
    status: "succeeded" | "failed" | "cancelled";
    /**
     * The TYPED failure reason carried VERBATIM from the control plane
     * (R502 — the error class, the message, and the terminal disposition;
     * never a generic message). Absent for succeeded/cancelled completions
     * without a failure record.
     */
    failure?: { errorClass: string; message: string; terminal: string };
    /** @deprecated Use {@link StudioJobRow.completion.failure} — kept for compatibility. */
    failureMessage?: string;
    executionMs: number;
    usage: { unitId: string; quantity: number }[];
  };
}

// ---------------------------------------------------------------------------
// R501 — the compute-selection surface (the REAL SelectionDirector)
// ---------------------------------------------------------------------------

/** The caller's selection directive (the R407 vocabulary, verbatim). */
export interface StudioComputeDirective {
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

/**
 * The compute step's answer (POST /api/create/compute-preview): the REAL
 * SelectionDirector's outcome over the workload — the broker's selection
 * verbatim + the auditable explanation (every considered provider's
 * quote/refusal/exclusion). Derived, deterministic, and identical to the
 * decision the dispatch will verify for the same inputs.
 */
export interface StudioComputeSelectionView {
  /** The workload the selection ran against (echoed verbatim). */
  request: {
    rendererId: string;
    rendererVersion?: string;
    latencyClass: StudioLatencyClass;
    deadlineMs: number;
  };
  /** The selected provider (data — the broker's own selection, verbatim). */
  selection: { providerId: string };
  /** The auditable explanation document (the R407 shape, verbatim). */
  explanation: SelectionExplanation;
}

/** One session's jobs with its header (the Jobs workspace row group). */
export interface StudioSessionJobs {
  sessionId: string;
  label: string;
  status: string;
  jobs: StudioJobRow[];
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/** The fixture sources (the checked-in stories, with product labels). */
const SOURCES: readonly { spec: FixtureStorySpec; label: string; description: string }[] = [
  {
    spec: DERBY_STORY,
    label: "Derby night at Kings Park",
    description:
      "A full kickoff-to-goal fixture: 4 tracked objects, 6 fusion waves, 3 commentary windows.",
  },
  {
    spec: FRIENDLY_STORY,
    label: "Friendly under the lights",
    description:
      "A shorter evening fixture: 4 tracked objects, 6 fusion waves, 2 commentary windows.",
  },
  {
    spec: TRAINING_STORY,
    label: "Training ground drill",
    description:
      "A training-session fixture: 4 tracked objects, 6 fusion waves, 2 commentary windows.",
  },
];

/** The sentinel for "no mediated session has this id" (uniform denial). */
const NOT_OWNED = "\u0000not-a-user";

/**
 * The typed failure class of a per-reality plan refusal (J004): the error's
 * OWN class when it carries one (the platform's typed errors expose
 * `failureClass`), else the identity-layer class, else the honest internal
 * marker — never a generic "failed".
 */
function failureClassOf(err: unknown): string {
  if (
    typeof err === "object" &&
    err !== null &&
    "failureClass" in err &&
    typeof (err as { failureClass?: unknown }).failureClass === "string"
  ) {
    return (err as { failureClass: string }).failureClass;
  }
  if (err instanceof IdentityPermissionDeniedError) return "permission-denied";
  if (err instanceof IdentityValidationError) return "validation-failed";
  return "internal";
}

/**
 * Resolves a fixture source key to its REAL story spec (the checked-in
 * fixture inputs). W921: exported for the durable control plane's
 * reconstruction path (a recorded session's source key must resolve to the
 * same deterministic story the creating instance ran) — returns `null` for
 * an unknown key (never a guessed story).
 */
export function studioSourceSpec(sourceKey: string): FixtureStorySpec | null {
  const entry = SOURCES.find((source) => source.spec.key === sourceKey);
  return entry === undefined ? null : entry.spec;
}

/** Options for {@link CreateStudioService}. */
export interface CreateStudioServiceOptions {
  /** The composed server (resolved lazily — the service outlives the literal). */
  getServer: () => SportaServer;
  /** The engine registry (where created sessions' fused engines land). */
  engines: Map<string, WorldModelEngineInstance>;
  /** The story metadata index the watch model reads. */
  storyIndex: Map<string, SeedStoryMeta>;
  /** The publication store (the real visibility flag). */
  publication: {
    set(id: string, v: SessionVisibility): void;
    visibilityOf(id: string): SessionVisibility;
  };
  /**
   * The rights-attestation index (W916): the studio records which account
   * attested each session it creates — the gate itself attests as the
   * verified caller, so this is the gate's own decision, re-recorded.
   */
  attestations: { record(id: string, attestedByUserId: string): void };
  /**
   * The operations console seam (W918): where the studio's dispatch path
   * reports bounded-queue admission refusals so the console's queue panel
   * counts them at the seam they actually happen (never a parallel
   * fabrication).
   */
  operations: { noteAdmissionRefusal(depth: number, maxDepth: number): void };
  /**
   * J004: the derived-reality producer map (reality kind → the registered
   * producer renderer id) — the composition's frozen producer map, exactly
   * `tactical.prototype` / `game-3d.prototype` / `anime-npr.prototype` when
   * the derived-reality plane composed. A kind with no entry has NO
   * registered producer — honestly `producer-unavailable`, never invented.
   */
  derivedRealityProducers: ReadonlyMap<RealityKind, string>;
  /** Wall clock (rights expiry is evaluated against it). */
  nowMs: () => number;
}

/** The Create Studio service. */
export class CreateStudioService {
  private readonly getServer: () => SportaServer;
  private readonly engines: CreateStudioServiceOptions["engines"];
  private readonly storyIndex: Map<string, SeedStoryMeta>;
  private readonly publication: CreateStudioServiceOptions["publication"];
  private readonly attestations: CreateStudioServiceOptions["attestations"];
  private readonly operations: CreateStudioServiceOptions["operations"];
  /**
   * J004: the derived-reality producer map (reality kind → producer renderer
   * id). A kind with no entry has NO registered producer — honestly
   * `producer-unavailable`, never invented.
   */
  private readonly derivedRealityProducers: ReadonlyMap<RealityKind, string>;
  private readonly nowMs: () => number;
  /** The REAL job ids this studio dispatched, per session (in-memory). */
  private readonly jobsBySession = new Map<string, string[]>();
  /** Dispatched job id → its queue admission id (the slot released on settle). */
  private readonly admissionByJob = new Map<string, string>();
  /** Job ids whose admission was already released (idempotence guard). */
  private readonly releasedJobs = new Set<string>();
  /**
   * Dispatched job id → its DISPATCH RECIPE (W921: renderer version/style/
   * profile — the fields the durable record must carry verbatim so another
   * instance's reconstruction replays the SAME render).
   */
  private readonly recipesByJob = new Map<string, ControlRenderRecipe>();
  /**
   * Dispatched job id → its recorded dispatch parameters + actor (W918: the
   * operations console's retry re-dispatches from this REAL record — the
   * parameters of what was actually dispatched, never reconstructed).
   */
  private readonly dispatchesByJob = new Map<
    string,
    {
      rendererId: string;
      rendererVersion?: string;
      styleId?: string;
      dispatchedByUserId: string | null;
      dispatchedAtMs: number;
      /**
       * The COMPUTE SELECTION the dispatch carried (R506): the selected
       * provider + the user-choice/auto mode + the auditable explanation —
       * the compute-provenance record surfaced on the studio's processing
       * view and the watch surface. Absent when no directive rode the
       * dispatch (never invented).
       */
      selection?: {
        providerId: string;
        mode: "user-explicit" | "sporta-auto";
        explanation: SelectionExplanation;
      };
    }
  >();
  private policySeq = 0;
  /**
   * The studio's upload-source index (R501): session id → its R101 source
   * asset id + media job id — the warm-instance fast path of the session
   * state's source read. Cold durable instances resolve the same join from
   * the durable record's `upload:<assetId>` source key and the media
   * store's own session-indexed artifacts (see {@link uploadSourceOf}).
   */
  private readonly uploadBySession = new Map<string, { assetId: string; jobId: string }>();

  constructor(options: CreateStudioServiceOptions) {
    this.getServer = options.getServer;
    this.engines = options.engines;
    this.storyIndex = options.storyIndex;
    this.publication = options.publication;
    this.attestations = options.attestations;
    this.operations = options.operations;
    this.derivedRealityProducers = options.derivedRealityProducers;
    this.nowMs = options.nowMs;
  }

  // -----------------------------------------------------------------------
  // Options (the guided flow's opening document)
  // -----------------------------------------------------------------------

  /**
   * The studio's options: sources, renderers, rights vocabulary, honesty,
   * and the caller's live render quota (W913 — the degraded-state input).
   * `token` is optional (the route authenticates; the quota is `null`
   * without a resolvable caller).
   */
  async listOptions(token?: string): Promise<StudioOptions> {
    const server = this.getServer();
    let renderQuota: PlatformQuotaState | null = null;
    if (token !== undefined && token.length > 0) {
      try {
        const account = await server.auth.resolve(token);
        if (account !== null) {
          renderQuota = await server.transientState.quotas.peek(
            RENDER_REQUESTS_QUOTA,
            account.account.userId,
          );
        }
      } catch {
        renderQuota = null;
      }
    }
    const { renderers } = await server.control.listRenderers();
    const views: StudioRendererView[] = [];
    for (const capability of renderers) {
      // The honest artifact-handoff answer: the compute worker encodes
      // artifacts through the W502 detailed render surface (renderDetailed)
      // — a plugin without it renders but cannot hand a stored output back.
      let handoff: StudioRendererView["artifactHandoff"];
      try {
        const plugin = server.registry.resolve(capability.rendererId, capability.rendererVersion);
        handoff =
          typeof (plugin as { renderDetailed?: unknown }).renderDetailed === "function"
            ? { supported: true, reason: "the W502 detailed surface the compute worker encodes" }
            : {
                supported: false,
                reason: `renderer '${capability.rendererId}' does not expose the W502 detailed render surface the compute worker's artifact handoff requires`,
              };
      } catch {
        handoff = { supported: false, reason: "renderer failed to resolve from the registry" };
      }
      views.push({
        rendererId: capability.rendererId,
        rendererVersion: capability.rendererVersion,
        rendererClass: capability.rendererClass,
        requiresSourceFrames: capability.requiresSourceFrames,
        supportedOutputProfiles: capability.supportedOutputProfiles.map((profile) => ({
          resolution: { w: profile.resolution.w, h: profile.resolution.h },
          frameRate: profile.frameRate,
          codec: profile.codec,
          container: profile.container,
          latencyClass: profile.latencyClass,
        })),
        artifactHandoff: handoff,
      });
    }
    // J004: the honest derived-reality capability states — only registered,
    // artifact-handoff-capable producers are offered (the multi-select never
    // invents a reality this control plane cannot render). `renderers` is
    // the SAME capability listing the loop above consumed.
    const derivedRealities = DERIVED_REALITY_SELECTION_KINDS.map((reality) => {
      const producerRendererId = this.derivedRealityProducers.get(reality) ?? null;
      if (producerRendererId === null) {
        return {
          reality,
          producerRendererId: null,
          offered: false,
          reason:
            "no producer is registered for this reality on this control plane (the derived-reality encode plane is absent) — never invented",
        };
      }
      // The registry's own answer (registered + versioned + the W502
      // artifact-handoff surface the compute worker encodes through).
      let offered = false;
      let reason = "";
      try {
        const capability = renderers.find((entry) => entry.rendererId === producerRendererId);
        if (capability === undefined) {
          reason = `the registered producer '${producerRendererId}' is not listed by the control plane's renderer capability surface`;
        } else {
          const plugin = server.registry.resolve(capability.rendererId, capability.rendererVersion);
          offered = typeof (plugin as { renderDetailed?: unknown }).renderDetailed === "function";
          reason = offered
            ? `produced by the registered '${producerRendererId}'`
            : `renderer '${producerRendererId}' does not expose the W502 detailed render surface the compute worker's artifact handoff requires`;
        }
      } catch {
        reason = `the producer '${producerRendererId}' failed to resolve from the registry`;
      }
      return { reality, producerRendererId, offered, reason };
    });
    return {
      sources: SOURCES.map(({ spec, label, description }) => ({
        key: spec.key,
        label,
        description,
        camera: { pan: spec.camera.pan, zoom: spec.camera.zoom, jitter: spec.camera.jitter },
        commentary: spec.commentary.map((window) => ({ ...window })),
        lexicon: { players: [...spec.lexicon.players], teams: [...spec.lexicon.teams] },
      })),
      renderers: views,
      derivedRealities,
      rights: {
        operations: RIGHTS_OPERATIONS.map((operation) => ({ ...operation })),
        sharingScopes: [
          { id: "private", label: "Private" },
          { id: "operator-authorized", label: "Operator-authorized" },
        ],
      },
      upload: {
        available: true,
        constraints: {
          container: UPLOAD_CONSTRAINTS.container,
          maxBytes: UPLOAD_CONSTRAINTS.maxBytes,
          maxDurationMs: UPLOAD_CONSTRAINTS.maxDurationMs,
        },
      },
      compute:
        server.compute === null
          ? null
          : { provider: server.compute.provider, adapterId: server.compute.adapterId },
      selection:
        server.selection === null
          ? null
          : {
              providers: [
                {
                  providerId: server.selection.providerId,
                  privacyZone: server.selection.facts.privacyZone,
                  capabilityClasses: [...(server.selection.facts.capabilityClasses ?? [])],
                  ...(server.selection.facts.vramMb !== undefined
                    ? { vramMb: server.selection.facts.vramMb }
                    : {}),
                },
              ],
            },
      renderQuota,
    };
  }

  // -----------------------------------------------------------------------
  // Rights preview (semantics from @sporta/contracts ONLY)
  // -----------------------------------------------------------------------

  /** Parses a caller declaration into a policy (throws on shape errors). */
  private policyFrom(declaration: RightsDeclarationInput, policyId: string): AuthorizationPolicy {
    const operations = [...new Set(declaration.operations)];
    const known: AllowedOperation[] = [];
    for (const operation of operations) {
      const found = RIGHTS_OPERATIONS.find((entry) => entry.id === operation);
      if (found === undefined) {
        throw new IdentityValidationError(`unknown allowed operation '${String(operation)}'`);
      }
      known.push(found.id);
    }
    if (known.length === 0) {
      throw new IdentityValidationError(
        "a rights declaration needs at least one allowed operation",
      );
    }
    if (
      declaration.expiresAtIso !== undefined &&
      Number.isNaN(Date.parse(declaration.expiresAtIso))
    ) {
      throw new IdentityValidationError("expiresAtIso must be an ISO-8601 timestamp");
    }
    if (
      declaration.storageDurationDays !== undefined &&
      (!Number.isInteger(declaration.storageDurationDays) || declaration.storageDurationDays < 0)
    ) {
      throw new IdentityValidationError("storageDurationDays must be a non-negative integer");
    }
    const scope = declaration.sharingScope;
    if (scope !== undefined && scope !== "private" && scope !== "operator-authorized") {
      throw new IdentityValidationError("sharingScope must be 'private' or 'operator-authorized'");
    }
    return {
      policyId,
      allowedOperations: known,
      // Pre-attestation placeholder — the identity gate overwrites this with
      // the VERIFIED account id before the control plane ever sees it.
      assertedBy: "create-studio-declaration",
      ...(declaration.expiresAtIso !== undefined ? { expiresAtIso: declaration.expiresAtIso } : {}),
      ...(declaration.storageDurationDays !== undefined
        ? { storageDurationDays: declaration.storageDurationDays }
        : {}),
      ...(scope !== undefined ? { sharingScope: scope } : {}),
    };
  }

  /** Derives what a declaration really permits (fail-closed, from contracts). */
  previewRights(declaration: RightsDeclarationInput): RightsPreview {
    const policy = this.policyFrom(declaration, "policy-preview");
    const capabilities = deriveRightsCapabilities(policy, new Date(this.nowMs()));
    const allDenied =
      !capabilities.canReferenceSourceFrames &&
      !capabilities.canDeliverLive &&
      !capabilities.canStoreDerivatives &&
      !capabilities.canShare;
    const expired =
      policy.expiresAtIso !== undefined && Date.parse(policy.expiresAtIso) <= this.nowMs();
    return {
      capabilities,
      sessionCreation: {
        allowed: !allDenied,
        reason: allDenied
          ? expired
            ? "the declared policy is expired — no capability can be derived, so the control plane denies session creation"
            : "the declared policy derives no capability — the control plane denies session creation (fail-closed)"
          : "the declared policy derives at least one capability",
      },
      effects: [
        {
          capability: "canReferenceSourceFrames",
          allowed: capabilities.canReferenceSourceFrames,
          effect: "renderers may transform this session into new realities",
        },
        {
          capability: "canDeliverLive",
          allowed: capabilities.canDeliverLive,
          effect: "the session may be delivered live (no live transport exists this wave)",
        },
        {
          capability: "canStoreDerivatives",
          allowed: capabilities.canStoreDerivatives,
          effect: "rendered outputs are stored — playback and preview work",
        },
        {
          capability: "canShare",
          allowed: capabilities.canShare,
          effect: "derivatives may be shared beyond the creator",
        },
      ],
    };
  }

  // -----------------------------------------------------------------------
  // Session creation (the identity-attested W902 control-gate path)
  // -----------------------------------------------------------------------

  /**
   * Creates a studio session: the W902 identity-gate attestation sequence,
   * performed inline against the DECORATED control plane so the session is
   * created under a COLLISION-SAFE caller-supplied id (W921 — the additive
   * control-api seam). The gate's own structural interface
   * (`GatedControlApp`) does not carry a caller session id and
   * `@sporta/identity` is frozen for W921, so this method replicates the
   * gate's EXACT sequence with the same denial ordering: resolve the token
   * (401-shaped), require the `media-session.create` grant (403-shaped),
   * re-attest the declared policy (`assertedBy` = the VERIFIED account id),
   * create, then record ownership — every guarantee preserved, no invented
   * state. When a durable record store is configured the created session is
   * WRITTEN THROUGH to it (fail-loud).
   */
  async createSession(input: {
    token: string;
    sourceKey: string;
    declaration: RightsDeclarationInput;
    label?: string;
  }): Promise<StudioSessionView> {
    const server = this.getServer();
    const source = SOURCES.find((entry) => entry.spec.key === input.sourceKey);
    if (source === undefined) {
      throw new IdentityValidationError(`unknown authorized source '${input.sourceKey}'`);
    }
    this.policySeq += 1;
    const policy = this.policyFrom(
      input.declaration,
      `policy-create-studio-${source.spec.key}-${this.nowMs()}-${this.policySeq}`,
    );

    const label = input.label ?? source.label;

    // 1. The gate's exact attestation sequence, inline (see the method docs):
    //    token → account → `media-session.create` grant → re-attested policy.
    const account = await server.gate.requireAccount(input.token);
    const decision = authorize(account, "media-session.create");
    if (!decision.allowed) {
      throw new IdentityPermissionDeniedError(
        "media session creation requires a creator, rights-holder, or operator grant",
        { action: "media-session.create" },
      );
    }
    const attested: AuthorizationPolicy = { ...policy, assertedBy: account.userId };

    // 2. The REAL control-plane creation under the collision-safe id (W921:
    //    `sess-u-<32 hex>` — crypto-random, so two instances can never
    //    allocate the same id for different sessions).
    const sessionId = randomHexId("sess-u");
    const created = await server.control.createSession({
      authorizationPolicy: attested,
      sourceLabel: label,
      sessionId,
    });

    // 3. Ownership + the W916 attestation (the gate's own records — the
    //    attested policy is the verified account's, re-recorded here).
    await server.ownership.record(sessionId, account.userId);
    this.attestations.record(sessionId, account.userId);

    // 4. The REAL M1→M3 chain for the selected source, registered before any
    //    render (the control plane's world-model factory picks it up).
    const run: StoryRun = runFixtureStory(sessionId, source.spec, this.nowMs);
    this.engines.set(sessionId, run.engine);
    this.storyIndex.set(sessionId, {
      source: "dev-seed",
      storyKey: source.spec.key,
      transcript: run.transcript,
      events: run.events,
      waveCount: run.waveCount,
    });

    // 5. Fail-closed publication: studio sessions start private.
    this.publication.set(sessionId, "private");

    // 6. W921 write-through (fail-loud: a configured store that rejects the
    //    record fails the request — never a silently undurable session). The
    //    record's createdAt is the CONTROL PLANE's own create answer — never
    //    this studio's clock.
    if (server.durable !== null) {
      await server.durable.noteSessionCreated({
        sessionId,
        ownerUserId: account.userId,
        sourceKey: source.spec.key,
        label,
        rightsDeclaration: attested,
        visibility: { kind: "private", roles: [] },
        status: created.session.status,
        publishedAtMs: null,
        createdAtIso: created.session.createdAtIso,
        updatedAtMs: this.nowMs(),
      });
    }

    const view = this.sourceView(source);
    return {
      sessionId,
      source: view,
      rightsCapabilities: created.rightsCapabilities,
      visibility: "private",
      story: { eventCount: run.events.length, waveCount: run.waveCount },
    };
  }

  // -----------------------------------------------------------------------
  // R501 — the real upload path (browser MP4 → rights → R101 → R207)
  // -----------------------------------------------------------------------

  /**
   * Creates an UPLOAD-source studio session — the R501 flow's server path.
   * The order is deliberate and every rejection is typed:
   *
   * 1. the identity gate (the W902 sequence: token → account →
   *    `media-session.create` grant → re-attested policy);
   * 2. the R101 upload constraints, PRE-CHECKED against the frozen
   *    constants + the ingestion seam's own container sniffer (the same
   *    `UPLOAD_CONSTRAINTS` the media boundary enforces — the definitive
   *    gate still runs INSIDE `media.upload` below; this pre-check only
   *    refuses BEFORE any session is created, so an obvious rejection
   *    leaves no orphan state);
   * 3. the REAL R207 real-to-SWM pipeline over the uploaded bytes (its own
   *    fail-closed admission: rights gate, container, decode) — the
   *    session's fused engine is derived from the UPLOADED clip, never
   *    invented. Deterministic config (the pipeline's documented
   *    clock-injection posture, `nowMs: 0`);
   * 4. the REAL control-plane session creation (collision-safe id) +
   *    ownership + attestation + fail-closed private publication;
   * 5. the REAL R101 boundary: `media.upload` — server-side constraint
   *    validation, the durable hash-verified `SourceAsset`, the admitted
   *    media job (normalization → the `original`-reality artifact,
   *    auto-running async);
   * 6. W921 durable write-through with the `upload:<assetId>` source key
   *    (the durable layer's honest join for cold-instance reconstruction);
   * 7. J004 — the ONE-submission multi-reality plan (ONLY when the request
   *    carried the `realities` field): after the admitted media job reaches
   *    its stored-original state (its real terminal disposition — awaited
   *    bounded, honest on failure/timeout), ONE async render per selected
   *    derived reality dispatches through the SAME `createRenderAsync`
   *    surface the single-render path uses, under ONE compute selection
   *    directive. Per-reality failures are isolated and typed — one
   *    reality refusing never cancels the others; the plan's per-reality
   *    states ride the EXISTING job/render surfaces (no second truth).
   */
  async createUploadSession(input: {
    token: string;
    bytes: Uint8Array;
    filename?: string;
    declaration: RightsDeclarationInput;
    label?: string;
    /**
     * J004: the DERIVED reality kinds selected in this ONE submission
     * (validated — each must be `tactical` | `three-d-game` | `anime-npr`;
     * `undefined` = the field was absent = today's behavior exactly).
     */
    realities?: readonly string[];
    /** J004: the ONE compute selection directive covering the whole plan. */
    compute?: StudioComputeDirective;
    /** J004: the style label the plan's dispatches carry (recipe provenance). */
    styleId?: string;
  }): Promise<StudioUploadSessionView> {
    const server = this.getServer();

    // 1. The gate's exact attestation sequence (token → account → grant →
    //    re-attested policy) — identical to the fixture path.
    const account = await server.gate.requireAccount(input.token);
    const decision = authorize(account, "media-session.create");
    if (!decision.allowed) {
      throw new IdentityPermissionDeniedError(
        "media session creation requires a creator, rights-holder, or operator grant",
        { action: "media-session.create" },
      );
    }
    this.policySeq += 1;
    const policy = this.policyFrom(
      input.declaration,
      `policy-create-studio-upload-${this.nowMs()}-${this.policySeq}`,
    );
    // The pipeline references source frames and the R101 boundary stores
    // bytes — the derived capabilities must permit transformation (the
    // fail-closed derivation the studio's preview already showed).
    const capabilities = deriveRightsCapabilities(policy, new Date(this.nowMs()));
    if (!capabilities.canReferenceSourceFrames) {
      throw new IdentityValidationError(
        "an upload-source session requires a declaration that allows transformation " +
          "(the media pipeline references source frames — fail-closed)",
      );
    }
    const attested: AuthorizationPolicy = { ...policy, assertedBy: account.userId };

    // 1b. J004: validate the plan's selections BEFORE anything is created —
    //     each must be a DERIVED reality kind ("original" is NOT a selection;
    //     the admitted media job's normalization always produces it). The
    //     order is preserved and duplicates collapse (one entry per kind).
    let planKinds: StudioDerivedRealityKind[] | undefined;
    if (input.realities !== undefined) {
      const seen = new Set<string>();
      for (const raw of input.realities) {
        if (raw === "original") {
          throw new IdentityValidationError(
            "'original' is not a reality selection — the admitted media job always produces " +
              "the original-reality artifact (select only derived realities: tactical, three-d-game, anime-npr)",
          );
        }
        if (!(DERIVED_REALITY_SELECTION_KINDS as readonly string[]).includes(raw)) {
          throw new IdentityValidationError(
            `unknown derived reality '${String(raw)}' (the plan selects from: ${DERIVED_REALITY_SELECTION_KINDS.join(", ")})`,
          );
        }
        seen.add(raw);
      }
      planKinds = DERIVED_REALITY_SELECTION_KINDS.filter((kind) => seen.has(kind));
    }

    // 2. The R101 constraint pre-check (the frozen constants + the
    //    ingestion seam's own sniffer — the definitive gate is step 5).
    const { UploadRejectedError } = await import("@sporta/media-platform");
    if (input.bytes.byteLength === 0) {
      throw new UploadRejectedError("size-empty", "the upload carries no bytes", "media-invalid", {
        byteSize: 0,
      });
    }
    if (input.bytes.byteLength > UPLOAD_CONSTRAINTS.maxBytes) {
      throw new UploadRejectedError(
        "size-over-limit",
        `the upload measures ${input.bytes.byteLength} bytes, over the ${UPLOAD_CONSTRAINTS.maxBytes} byte bound`,
        "resource-limit",
        { byteSize: input.bytes.byteLength, maxBytes: UPLOAD_CONSTRAINTS.maxBytes },
      );
    }
    const sniffed = sniffContainer(input.bytes);
    if (sniffed.container !== UPLOAD_CONSTRAINTS.container) {
      throw new UploadRejectedError(
        "container-not-mp4",
        `the upload's container is '${sniffed.container}' (magic-byte sniffed), only 'mp4' is accepted`,
        "media-invalid",
        { sniffed: sniffed.container, detectedBy: sniffed.detectedBy },
      );
    }

    // 3. The REAL R207 pipeline over the uploaded bytes (registered BEFORE
    //    any render — the control plane's world-model factory picks it up).
    //    A pipeline refusal is typed and leaves nothing created. The clip
    //    provenance is content-derived (the sha-256 of the uploaded bytes —
    //    the same hash the R101 asset below records), never a placeholder.
    const sessionId = randomHexId("sess-u");
    const contentSha256 = sha256OfBytes(input.bytes);
    const clip: ClipSource = {
      provenance: {
        clipId: `upload-${contentSha256.slice(0, 12)}`,
        sourceSha256: contentSha256,
        normalizationNote: "user upload through the studio's R101 boundary",
      },
      bytes: input.bytes,
      authorizationPolicy: attested,
      ...(input.filename !== undefined ? { filename: input.filename } : {}),
    };
    const pipeline = new RealToSwmPipeline();
    const run = await pipeline.run({
      source: clip,
      config: {
        sessionId,
        decode: { maxTotalBytes: STUDIO_UPLOAD_DECODE_BUDGET_BYTES },
        nowMs: 0,
      },
    });

    // 4. The REAL control-plane creation + ownership + attestation +
    //    fail-closed private publication, then the engine registration.
    const label = input.label ?? `Uploaded clip (${sniffed.container})`;
    const created = await server.control.createSession({
      authorizationPolicy: attested,
      sourceLabel: label,
      sessionId,
    });
    await server.ownership.record(sessionId, account.userId);
    this.attestations.record(sessionId, account.userId);
    this.engines.set(sessionId, run.engine);
    this.publication.set(sessionId, "private");

    // 5. The REAL R101 boundary (the definitive constraint gate): durable
    //    hash-verified SourceAsset + the admitted media job.
    const outcome = await server.media.upload({
      bytes: input.bytes,
      sessionId,
      declaredRightsPolicyId: attested.policyId,
      ...(input.filename !== undefined ? { filename: input.filename } : {}),
    });
    this.uploadBySession.set(sessionId, {
      assetId: outcome.asset.assetId,
      jobId: outcome.job.jobId,
    });

    // 6. W921 write-through (fail-loud). The source key carries the R101
    //    asset id — the durable layer's reconstruction join.
    if (server.durable !== null) {
      await server.durable.noteSessionCreated({
        sessionId,
        ownerUserId: account.userId,
        sourceKey: `${STUDIO_UPLOAD_SOURCE_PREFIX}${outcome.asset.assetId}`,
        label,
        rightsDeclaration: attested,
        visibility: { kind: "private", roles: [] },
        status: created.session.status,
        publishedAtMs: null,
        createdAtIso: created.session.createdAtIso,
        updatedAtMs: this.nowMs(),
      });
    }

    // 7. J004 — the ONE-submission multi-reality plan (ONLY when the request
    //    carried the `realities` field; its absence preserves today's
    //    behavior — no wait, no dispatches, no plan member). The plan
    //    dispatches AFTER the media job reaches its stored-original state;
    //    per-reality failures are isolated and typed (never silent
    //    cancellations); the entries' durable states ride the EXISTING
    //    job/render surfaces (this.jobsBySession + the control plane's own
    //    projections).
    let renderPlan: StudioRenderPlan | undefined;
    if (planKinds !== undefined) {
      renderPlan = await this.dispatchRealityPlan({
        token: input.token,
        sessionId,
        mediaJobId: outcome.job.jobId,
        kinds: planKinds,
        ...(input.styleId !== undefined && input.styleId.length > 0
          ? { styleId: input.styleId }
          : {}),
        ...(input.compute !== undefined ? { compute: input.compute } : {}),
      });
    }
    // J004: when the plan ran, the media job's wait already observed its
    // settled state — the answer carries THAT view (the honest current
    // state), not the admission-time snapshot. Without a plan (the legacy
    // path), the admission-time view rides exactly as before.
    const settledMediaJob =
      renderPlan !== undefined ? server.media.jobView(outcome.job.jobId) : null;

    return {
      sessionId,
      label,
      rightsCapabilities: created.rightsCapabilities,
      visibility: "private",
      source: {
        asset: {
          assetId: outcome.asset.assetId,
          contentHash: outcome.asset.contentHash,
          byteSize: outcome.asset.byteSize,
          container: outcome.asset.container,
          durationMs: outcome.asset.durationMs,
          uploadState: outcome.asset.uploadState,
          checksumVerified: outcome.asset.checksumVerified,
          declaredRightsPolicyId: outcome.asset.declaredRightsPolicyId,
        },
        job: settledMediaJob ?? outcome.job,
        artifact: null,
      },
      perception: {
        frameCount: run.clip.frameCount,
        snapshotCount: run.snapshots.length,
        eventCount: run.events.length,
        degradationCount: run.ledger.totalEntries,
        summary:
          run.ledger.summary.length === 0
            ? `no degradations across ${run.ledger.stages.length} pipeline stage(s)`
            : `${run.ledger.totalEntries} recorded degradation(s) across ${run.ledger.stages.length} pipeline stage(s): ${run.ledger.summary
                .map((entry) => `${entry.kind}×${entry.count}`)
                .join(", ")}`,
      },
      ...(renderPlan !== undefined ? { renderPlan } : {}),
    };
  }

  // -----------------------------------------------------------------------
  // J004 — the ONE-submission multi-reality render plan
  // -----------------------------------------------------------------------

  /**
   * The bounded wait for the admitted media job's stored-original state: the
   * pipeline's OWN terminal projection (never an interpolated state). A
   * failed or timed-out wait is returned as-is — the plan's dispatcher
   * surfaces the honest precondition failure per reality, never a guessed
   * "probably done".
   */
  private async awaitMediaJobSettled(jobId: string): Promise<MediaJobView> {
    const pollIntervalMs = 25;
    const boundMs = 180_000; // the upload constraint's own 120s ceiling + headroom
    const deadline = this.nowMs() + boundMs;
    for (;;) {
      const view = this.getServer().media.jobView(jobId);
      if (view === null) {
        throw new RangeError(`media job '${jobId}' was not found (impossible on a live upload)`);
      }
      if (view.terminal || this.nowMs() >= deadline) return view;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  /**
   * Dispatches the ONE-submission multi-reality plan (J004): after the
   * upload's media job reaches its stored-original state, ONE async render
   * per selected derived reality goes through the SAME dispatch path the
   * single-render flow uses (quota + queue admission + `createRenderAsync`
   * → the W914 seam), each kind resolved through the composition's frozen
   * producer map, all under the ONE compute selection directive the
   * submission carried.
   *
   * FAILURE ISOLATION (the contract's explicit rule): every per-reality
   * dispatch is an independent try/catch — a refusal (producer unavailable,
   * quota/queue/compute refusal, a rights refusal) is recorded as that
   * reality's typed failure entry and NEVER cancels the others.
   */
  private async dispatchRealityPlan(input: {
    token: string;
    sessionId: string;
    mediaJobId: string;
    kinds: readonly StudioDerivedRealityKind[];
    styleId?: string;
    compute?: StudioComputeDirective;
  }): Promise<StudioRenderPlan> {
    const entries: StudioRealityPlanEntry[] = [];

    // The contract's sequencing precondition: the plan dispatches only after
    // the upload's media job reached its stored-original state. A failed or
    // timed-out media job is surfaced per reality with its own typed
    // failure — honest, never a silent skip and never a fabricated wait.
    const media = await this.awaitMediaJobSettled(input.mediaJobId);
    const mediaSettledOriginal = media.terminal && media.state === "succeeded";

    for (const kind of input.kinds) {
      const rendererId = this.derivedRealityProducers.get(kind) ?? null;
      if (rendererId === null) {
        entries.push({
          reality: kind,
          rendererId: null,
          disposition: "failed",
          failure: {
            errorClass: "producer-unavailable",
            message:
              `no producer is registered for the '${kind}' reality on this control plane ` +
              "(the derived-reality encode plane is absent) — the other selections are unaffected",
          },
        });
        continue;
      }
      if (!mediaSettledOriginal) {
        const detail =
          media.state === "succeeded"
            ? "the upload's media job is still settling"
            : media.failure !== undefined
              ? `the upload's media job failed (${media.failure.failureClass}: ${media.failure.message})`
              : `the upload's media job did not settle in the bounded wait (state ${media.state})`;
        entries.push({
          reality: kind,
          rendererId,
          disposition: "failed",
          failure: {
            errorClass:
              media.terminal && media.state !== "succeeded"
                ? `media-job-${media.state}`
                : "media-job-unsettled",
            message: `the plan dispatches only after the upload's media job reaches its stored-original state — ${detail}`,
          },
        });
        continue;
      }
      try {
        // The SAME dispatch path the single-render flow uses (the compute
        // directive verification + the W919 quota + the bounded queue
        // admission + `createRenderAsync` → the W914 seam). Failures here
        // are THIS reality's honest refusal, never the plan's.
        const dispatch = await this.dispatchRender({
          token: input.token,
          sessionId: input.sessionId,
          rendererId,
          ...(input.styleId !== undefined && input.styleId.length > 0
            ? { styleId: input.styleId }
            : {}),
          ...(input.compute !== undefined ? { compute: input.compute } : {}),
        });
        entries.push({
          reality: kind,
          rendererId,
          disposition: dispatch.disposition,
          ...(dispatch.renderId !== undefined ? { renderId: dispatch.renderId } : {}),
          jobId: dispatch.jobId,
          jobState: dispatch.jobState,
        });
      } catch (err) {
        entries.push({
          reality: kind,
          rendererId,
          disposition: "failed",
          failure: {
            errorClass: failureClassOf(err),
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    // The ONE selection that covered the whole plan: captured from the
    // dispatch record (the same directive rode every dispatch; the
    // SelectionDirector's deterministic decision is identical for each).
    const admittedJobIds = entries.filter((entry) => entry.jobId !== undefined);
    let selection: StudioRenderPlan["selection"];
    for (const entry of admittedJobIds) {
      const recorded = this.dispatchesByJob.get(entry.jobId!)?.selection;
      if (recorded !== undefined) {
        selection = recorded;
        break;
      }
    }
    return { realities: entries, ...(selection !== undefined ? { selection } : {}) };
  }

  /**
   * Resolves one session's upload source state from the REAL stores only
   * (never invented): the warm-instance index, else the durable record's
   * `upload:<assetId>` source key, else the media store's session-indexed
   * artifacts (post-completion). `null` when no upload source resolves.
   * Public read seam: the R503 artifact catalog derives the `original`
   * reality's availability from the same honest join (the studio owns the
   * session→source resolution; the catalog never re-implements it).
   */
  async sessionUploadSource(sessionId: string): Promise<StudioUploadSourceState | null> {
    return await this.uploadSourceOf(sessionId);
  }

  private async uploadSourceOf(sessionId: string): Promise<StudioUploadSourceState | null> {
    const server = this.getServer();
    let assetId: string | null = this.uploadBySession.get(sessionId)?.assetId ?? null;
    if (assetId === null && server.durable !== null) {
      const sourceKey = await server.durable.findSourceKey(sessionId);
      if (sourceKey !== null && sourceKey.startsWith(STUDIO_UPLOAD_SOURCE_PREFIX)) {
        assetId = sourceKey.slice(STUDIO_UPLOAD_SOURCE_PREFIX.length);
      }
    }
    if (assetId === null) {
      const artifact = server.media
        .artifactsOfSession(sessionId)
        .find((entry) => entry.reality === "original");
      assetId = artifact?.sourceAssetId ?? null;
    }
    if (assetId === null) return null;
    const asset = server.media.asset(assetId);
    if (asset === null) return null;
    const jobs = server.media.jobsForAsset(assetId);
    const job = jobs.length > 0 ? (jobs[jobs.length - 1] ?? null) : null;
    const artifact =
      server.media
        .artifactsOfSession(sessionId)
        .find((entry) => entry.reality === "original" && entry.sourceAssetId === assetId) ?? null;
    return {
      asset: {
        assetId: asset.assetId,
        contentHash: asset.contentHash,
        byteSize: asset.byteSize,
        container: asset.container,
        durationMs: asset.durationMs,
        uploadState: asset.uploadState,
        checksumVerified: asset.checksumVerified,
        declaredRightsPolicyId: asset.declaredRightsPolicyId,
      },
      job,
      artifact:
        artifact === null
          ? null
          : {
              artifactId: artifact.artifactId,
              contentHash: artifact.contentHash,
              reality: artifact.reality,
            },
    };
  }

  // -----------------------------------------------------------------------
  // Session state / render dispatch / job polling / publication
  // -----------------------------------------------------------------------

  /** Resolves the caller's account (401-shaped identity failure otherwise). */
  private async requireAccount(token: string): Promise<Account> {
    return this.getServer().gate.requireAccount(token);
  }

  /**
   * The studio's session-access rule: the identity layer's RESOURCE rule
   * (owner or operator) — evaluated with the REAL `authorize` policy over
   * the recorded ownership. A non-owner's denial is uniform whether or not
   * the session exists (the sentinel), so no existence oracle leaks.
   */
  private async requireSessionAccess(token: string, sessionId: string): Promise<Account> {
    const server = this.getServer();
    const account = await this.requireAccount(token);
    const ownerId = (await server.ownership.ownerIdOf(sessionId)) ?? NOT_OWNED;
    const decision = authorize(account, "media-session.read", { ownerId });
    if (!decision.allowed) {
      throw new IdentityPermissionDeniedError("media access is not authorized for this account", {
        action: "media-session.read",
      });
    }
    return account;
  }

  /** The studio's session state (owner/operator view). */
  async sessionState(token: string, sessionId: string): Promise<StudioSessionState> {
    const server = this.getServer();
    await this.requireSessionAccess(token, sessionId);
    const { session, rightsCapabilities } = await server.control.getSession(sessionId);
    const { sessions } = await server.control.listSessions();
    const label = sessions.find((entry) => entry.id === sessionId)?.sourceLabel ?? sessionId;
    const { renders } = await server.control.listRenders(sessionId);
    const renderViews: StudioSessionState["renders"] = [];
    for (const render of renders) {
      const envelope = await server.control.getRender(sessionId, render.renderId);
      const outputs = await server.control.listRenderOutputs(sessionId, render.renderId);
      renderViews.push({
        renderId: envelope.renderId,
        rendererId: envelope.result.rendererId,
        segmentCount: render.segmentCount,
        hasStoredOutputs: outputs.segments.length > 0,
        rendererHealth: envelope.result.rendererHealth,
      });
    }
    // R501: the session's source state — the upload's durable R101 records
    // (asset + media job + artifact) or the fixture key the engine chain
    // ran; `null` when neither resolves on this instance (never invented).
    const uploadSource = await this.uploadSourceOf(sessionId);
    const storyKey = this.storyIndex.get(sessionId)?.storyKey ?? null;
    const source: StudioSessionState["source"] =
      uploadSource !== null
        ? { kind: "upload", ...uploadSource }
        : storyKey !== null
          ? { kind: "fixture", key: storyKey }
          : null;
    return {
      sessionId,
      label,
      status: session.status,
      createdAtIso: session.createdAtIso,
      rightsCapabilities,
      visibility: this.publication.visibilityOf(sessionId),
      source,
      renders: renderViews,
      jobs: await Promise.all(
        (this.jobsBySession.get(sessionId) ?? []).map(async (jobId) => {
          const dispatch = this.dispatchesByJob.get(jobId);
          return {
            jobId,
            state: await this.jobComputeStateOf(sessionId, jobId),
            rendererId: dispatch?.rendererId ?? null,
            // R506: the compute selection the dispatch carried (verbatim).
            ...(dispatch?.selection !== undefined ? { selection: dispatch.selection } : {}),
          };
        }),
      ),
    };
  }

  /**
   * One studio job's live compute state for the session-state view — the
   * control plane's own projection. An unreadable job (unknown to the compute
   * plane, or the compute read refused) reports the honest `unreadable`
   * marker instead of a guessed state; the watch surface treats `unreadable`
   * as NOT in flight (fail-closed: processing is claimed only on evidence).
   */
  private async jobComputeStateOf(sessionId: string, jobId: string): Promise<string> {
    try {
      const job = await this.getServer().control.getComputeJob(sessionId, jobId);
      return job.state;
    } catch {
      return "unreadable";
    }
  }

  /**
   * The COMPUTE STEP (R501): runs the REAL R407 SelectionDirector over the
   * workload the dispatch will run — the user's directive (explicit provider
   * choice or auto) answered with the broker's selection VERBATIM plus the
   * auditable explanation (every considered provider's quote/refusal/
   * exclusion). Deterministic: the same inputs the dispatch carries produce
   * the same decision here. Requires an authenticated caller (the studio's
   * own surfaces); answers the control plane's typed unavailable error when
   * no compute plane / selection seam is configured.
   */
  async computeSelection(input: {
    token: string;
    rendererId: string;
    rendererVersion?: string;
    latencyClass: StudioLatencyClass;
    deadlineMs?: number;
    directive: StudioComputeDirective;
  }): Promise<StudioComputeSelectionView> {
    const server = this.getServer();
    await this.requireAccount(input.token);
    if (server.selection === null || server.compute === null) {
      const { ControlComputeUnavailableError } = await import("@sporta/control-api");
      throw new ControlComputeUnavailableError(
        "no compute plane is configured — compute selection is unavailable (the control plane answers its typed 503 for render dispatch too)",
      );
    }
    const request: ComputeQuoteRequest = {
      schemaVersion: COMPUTE_SCHEMA_VERSION,
      rendererId: input.rendererId,
      ...(input.rendererVersion !== undefined ? { rendererVersion: input.rendererVersion } : {}),
      latencyClass: input.latencyClass,
      deadlineMs: input.deadlineMs ?? STUDIO_RENDER_DEADLINE_MS,
    };
    const outcome = await server.selection.director.explain(request, input.directive);
    return {
      request: {
        rendererId: request.rendererId,
        ...(request.rendererVersion !== undefined
          ? { rendererVersion: request.rendererVersion }
          : {}),
        latencyClass: request.latencyClass,
        deadlineMs: request.deadlineMs,
      },
      selection: { providerId: outcome.selection.providerId },
      explanation: outcome.explanation,
    };
  }

  /**
   * THE COMPUTE/COST STATUS (R506): the caller's legibility document —
   * whose compute plane this deployment renders on (the composition's own
   * DATA: the compute provider, the selection seam's registered provider id,
   * and the operator's declared responsibility boundary in the R408
   * vocabulary), the caller's daily compute allowance states (the W919
   * per-user quotas, fail-closed entries on unreadable counters), and the
   * plane's metered usage totals where available (`null` = not measured —
   * the W919 posture: unknown is shown as unknown, never as 0).
   *
   * This is a PROJECTION of connection-center state (the SelectionDirector's
   * registered facts + the guardrails' quota/usage seams) — no new domain
   * vocabulary, nothing re-implemented.
   */
  async computeStatus(token: string): Promise<StudioComputeStatus> {
    const server = this.getServer();
    const account = await this.requireAccount(token);
    const plane: StudioComputeStatus["plane"] =
      server.selection === null || server.compute === null
        ? null
        : {
            provider: server.compute.provider,
            adapterId: server.compute.adapterId,
            providerId: server.selection.providerId,
            // The operator's declared responsibility boundary: the
            // `sporta-managed` privacy zone declares Sporta's own
            // infrastructure; anything else is the user's connected
            // provider (the R408 execution-ownership vocabulary).
            executionOwnership:
              server.selection.facts.privacyZone === "sporta-managed"
                ? "sporta-managed"
                : "user-owned-provider",
            facts: {
              privacyZone: server.selection.facts.privacyZone,
              capabilityClasses: [...(server.selection.facts.capabilityClasses ?? [])],
            },
          };
    return {
      plane,
      quotas: await server.guardrails.userQuotaStates(account.userId),
      usage: await server.guardrails.computeUsageTotals(),
    };
  }

  /**
   * Dispatches one REAL render through the control plane's async compute
   * surface (the W914 seam): the compute adapter executes the render job
   * (real renderer plugin, real W504 encode + store) and the control plane
   * ingests the artifacts into its playback store when the job settles.
   *
   * R501: a dispatch that carries a COMPUTE DIRECTIVE first re-runs the REAL
   * SelectionDirector over the SAME workload (deterministic — the decision
   * the compute step showed) and verifies the selected provider IS the
   * composition's dispatch provider; the auditable explanation rides in the
   * dispatch answer. A directive the director refuses fails the dispatch
   * with the typed refusal (never a silent fallback to a provider the user
   * did not choose).
   *
   * W913 + W919 admission ladder (fail-closed, Simulation E — new expensive
   * jobs stop admitting BEFORE the provider is asked to run them):
   * 1. the W919 provider-capacity check (READS ONLY, first on purpose: a
   *    capacity refusal must not charge the caller's request quota) — the
   *    per-user daily metered-compute quotas AND the global provider limits
   *    (R2 storage, Upstash command budget); at a hard limit → 503 with the
   *    REAL reason (limit id, measured usage vs threshold);
   * 2. the caller's per-user render-request quota is consumed — exhausted
   *    → 429 with the W901 QuotaState (admission refused);
   * 3. the job is admitted to the BOUNDED queue — at its hard depth bound
   *    → 503 (platform capacity; never silently dropped, never unbounded);
   * 4. only then does `createRenderAsync` run. The admission slot is
   *    released when the job poll observes a terminal state (or by the
   *    queue's admission lease if the client stops polling), and the
   *    terminal poll records the job's metered usage into the dispatching
   *    user's daily counters (the W919 usage meter's real write seam).
   */
  async dispatchRender(input: {
    token: string;
    sessionId: string;
    rendererId: string;
    rendererVersion?: string;
    styleId?: string;
    outputProfile?: StudioOutputProfile;
    compute?: StudioComputeDirective;
  }): Promise<StudioDispatchView> {
    const server = this.getServer();
    const account = await this.requireSessionAccess(input.token, input.sessionId);

    // 0. R501: the compute directive — the REAL SelectionDirector over the
    //    same workload the dispatch runs (fail-loud on a refusal; the
    //    selected provider must be the composition's dispatch provider).
    let selection: StudioDispatchView["selection"];
    if (input.compute !== undefined) {
      if (server.selection === null || server.compute === null) {
        const { ControlComputeUnavailableError } = await import("@sporta/control-api");
        throw new ControlComputeUnavailableError(
          "no compute plane is configured — the compute directive cannot be honored (fail-loud, never a silent dispatch without the user's selection)",
        );
      }
      const outcome = await server.selection.director.explain(
        {
          schemaVersion: COMPUTE_SCHEMA_VERSION,
          rendererId: input.rendererId,
          ...(input.rendererVersion !== undefined
            ? { rendererVersion: input.rendererVersion }
            : {}),
          latencyClass: input.outputProfile?.latencyClass ?? "offline",
          deadlineMs: STUDIO_RENDER_DEADLINE_MS,
        },
        input.compute,
      );
      if (outcome.selection.providerId !== server.selection.providerId) {
        // Invariant: the broker is registered with EXACTLY the composition's
        // adapter, so the director can only select it — anything else is a
        // composition bug. Fail loud, never dispatch on an unchosen provider.
        throw new Error(
          `compute selection mismatch: the director selected '${outcome.selection.providerId}' ` +
            `but this control plane dispatches through '${server.selection.providerId}' — refusing`,
        );
      }
      selection = {
        providerId: outcome.selection.providerId,
        mode: input.compute.mode,
        explanation: outcome.explanation,
      };
    }

    // 1. W919 provider capacity (reads before writes — a capacity refusal
    //    must not charge the caller's render-request quota).
    await server.guardrails.checkAdmission(account.userId);

    // 2. The per-user render quota (fail-closed: an unreadable counter refuses too).
    const quotaAttempt = await server.transientState.quotas.consume(
      RENDER_REQUESTS_QUOTA,
      account.userId,
    );
    if (!quotaAttempt.allowed) {
      throw new RateLimitedError(
        quotaAttempt.state,
        retryAfterSeconds(this.nowMs(), RENDER_REQUESTS_QUOTA.windowSeconds ?? 3600),
      );
    }

    // 3. The bounded queue admission (fail-closed at the hard depth bound).
    this.policySeq += 1;
    const admissionId = `adm-${this.nowMs().toString(36)}-${this.policySeq.toString(36)}`;
    const offered = await server.transientState.queue.offer({
      jobId: admissionId,
      userId: account.userId,
      kind: "render",
      payloadJson: JSON.stringify({
        sessionId: input.sessionId,
        rendererId: input.rendererId,
        ...(input.rendererVersion !== undefined ? { rendererVersion: input.rendererVersion } : {}),
        ...(input.styleId !== undefined ? { styleId: input.styleId } : {}),
      }),
    });
    if (!offered.accepted) {
      // W918: the console's queue panel counts refusals at this seam — the
      // only app path that offers jobs to the bounded queue.
      this.operations.noteAdmissionRefusal(offered.depth, offered.maxDepth);
      throw new QueueFullError(offered.depth, offered.maxDepth, 60);
    }

    // 3. The real dispatch (only past both guards). W921: when a durable
    //    record store is configured, the render carries a COLLISION-SAFE
    //    caller-supplied render id (`r-u-<32 hex>` — the additive
    //    control-api seam) so renders of the same session dispatched from
    //    different serverless instances can never collide on `r-<seq>` (the
    //    exact W920 defect class, for renders); without the store the
    //    historical `r-<seq>` allocation is unchanged. The dispatch RECIPE is
    //    remembered per job — it is what the render's durable record must
    //    carry verbatim so another instance's reconstruction replays the SAME
    //    render.
    const renderId = server.durable !== null ? randomHexId("r-u") : undefined;
    const recipe: ControlRenderRecipe = {
      ...(input.rendererVersion !== undefined ? { rendererVersion: input.rendererVersion } : {}),
      ...(input.styleId !== undefined
        ? { styleConfig: { styleId: input.styleId, config: {} } }
        : {}),
      ...(input.outputProfile !== undefined ? { outputProfile: input.outputProfile } : {}),
    };
    const dispatch = await server.control.createRenderAsync(input.sessionId, {
      rendererId: input.rendererId,
      ...(input.rendererVersion !== undefined ? { rendererVersion: input.rendererVersion } : {}),
      ...(input.styleId !== undefined
        ? { styleConfig: { styleId: input.styleId, config: {} } }
        : {}),
      ...(input.outputProfile !== undefined
        ? {
            outputProfile: {
              resolution: {
                w: input.outputProfile.resolution.w,
                h: input.outputProfile.resolution.h,
              },
              frameRate: input.outputProfile.frameRate,
              codec: input.outputProfile.codec,
              container: input.outputProfile.container,
              latencyClass: input.outputProfile.latencyClass,
            },
          }
        : {}),
      ...(renderId !== undefined ? { renderId } : {}),
    });
    const jobs = this.jobsBySession.get(input.sessionId) ?? [];
    if (!jobs.includes(dispatch.jobId)) jobs.push(dispatch.jobId);
    this.jobsBySession.set(input.sessionId, jobs);
    this.admissionByJob.set(dispatch.jobId, admissionId);
    this.recipesByJob.set(dispatch.jobId, recipe);
    this.dispatchesByJob.set(dispatch.jobId, {
      rendererId: input.rendererId,
      ...(input.rendererVersion !== undefined ? { rendererVersion: input.rendererVersion } : {}),
      ...(input.styleId !== undefined ? { styleId: input.styleId } : {}),
      dispatchedByUserId: account.userId,
      dispatchedAtMs: this.nowMs(),
      // R506: the compute selection rides the dispatch record — the
      // compute-provenance source for the processing view and the watch
      // surface (absent when no directive rode the dispatch).
      ...(selection !== undefined ? { selection } : {}),
    });
    return {
      disposition: dispatch.disposition,
      jobId: dispatch.jobId,
      idempotencyKey: dispatch.idempotencyKey,
      sessionId: dispatch.sessionId,
      adapterId: dispatch.adapterId,
      jobState: dispatch.jobState,
      // The control plane's own ingested-render id, when it already exists
      // at dispatch return (J004 carries it into the plan entries).
      ...(dispatch.renderId !== undefined ? { renderId: dispatch.renderId } : {}),
      ...(selection !== undefined ? { selection } : {}),
    };
  }

  /** Polls one job (the control plane's own projection, mapped for the UI). */
  async jobState(token: string, sessionId: string, jobId: string): Promise<StudioJobView> {
    await this.requireSessionAccess(token, sessionId);
    const server = this.getServer();
    const job = await server.control.getComputeJob(sessionId, jobId);
    // W921: the poll that observes the job's ingested RENDER is the render's
    // durable write-through point (with the recorded dispatch recipe —
    // fail-loud, idempotent per render id). The poll runs on the instance
    // that owns the compute-job ledger — exactly where the dispatch's
    // recipe memory lives.
    if (job.renderId !== undefined && server.durable !== null) {
      await server.durable.noteRenderObserved(
        sessionId,
        job.renderId,
        this.recipesByJob.get(jobId),
      );
    }
    // W919: the TERMINAL observation also records the job's metered usage
    // into the dispatching user's daily counters (the usage meter's real
    // write seam — idempotent per job, attributed from the recorded
    // dispatch, never invented).
    if (job.completion !== undefined) {
      await this.noteJobUsage(jobId, job.completion.usage.costUnits);
    }
    // W913: a TERMINAL observation releases the job's bounded-queue admission
    // slot (the render is no longer outstanding). Once-only per job; a client
    // that never polls is covered by the queue's admission lease instead.
    if (
      (job.state === "succeeded" ||
        job.state === "failed" ||
        job.state === "cancelled" ||
        job.state === "dead-lettered") &&
      !this.releasedJobs.has(jobId)
    ) {
      const admissionId = this.admissionByJob.get(jobId);
      if (admissionId !== undefined) {
        this.releasedJobs.add(jobId);
        this.admissionByJob.delete(jobId);
        await this.getServer().transientState.queue.release(admissionId);
      }
    }
    const view: StudioJobView = {
      jobId: job.jobId,
      sessionId: job.sessionId,
      state: job.state,
      events: job.events.map((event) => ({
        atMs: event.atMs,
        type: event.type,
        ...(event.type === "progress"
          ? {
              ...(event.fraction !== undefined ? { fraction: event.fraction } : {}),
              ...(event.stage !== undefined ? { stage: event.stage } : {}),
            }
          : {
              ...(event.details !== undefined && Object.keys(event.details).length > 0
                ? { details: event.details }
                : {}),
            }),
      })),
      ...(job.renderId !== undefined ? { renderId: job.renderId } : {}),
      // R506: the compute selection the dispatch carried — whose compute is
      // executing this job, carried VERBATIM (absent when no directive rode
      // the dispatch; never invented).
      ...(this.dispatchesByJob.get(jobId)?.selection !== undefined
        ? { selection: this.dispatchesByJob.get(jobId)!.selection }
        : {}),
      ingest: job.ingest,
    };
    if (job.completion !== undefined) {
      const completion = job.completion;
      view.completion = {
        status: completion.status,
        ...(completion.failure !== undefined ? { failure: completion.failure } : {}),
        outputs: completion.outputs.map((output) => ({
          artifactId: output.artifactId,
          contentType: output.contentType,
          byteLength: output.byteLength,
          ...(output.metadata.frameCount !== undefined
            ? { frameCount: output.metadata.frameCount }
            : {}),
          ...(output.metadata.totalDurationMs !== undefined
            ? { totalDurationMs: output.metadata.totalDurationMs }
            : {}),
        })),
        attempts: completion.attempts,
        claims: completion.claims,
        timing: completion.timing,
        accounting: completion.accounting,
        usage: completion.usage.costUnits.map((unit) => ({
          unitId: unit.unitId,
          quantity: unit.quantity,
        })),
      };
    }
    return view;
  }

  /**
   * Lists the session's dispatched jobs with their REAL compute state
   * (W907 — the Jobs workspace surfaces). Owner/operator gated through the
   * same identity policy as every studio read: a non-owner's denial is
   * uniform whether or not the session exists.
   */
  async sessionJobs(token: string, sessionId: string): Promise<StudioSessionJobs> {
    const server = this.getServer();
    await this.requireSessionAccess(token, sessionId);
    const { session } = await server.control.getSession(sessionId);
    const { sessions } = await server.control.listSessions();
    const label = sessions.find((entry) => entry.id === sessionId)?.sourceLabel ?? sessionId;
    const rows: StudioJobRow[] = [];
    for (const jobId of this.jobsBySession.get(sessionId) ?? []) {
      const job = await server.control.getComputeJob(sessionId, jobId);
      // W921: this listing is a render write-through point too (the Jobs
      // workspace surfaces observe the same ingested renders).
      if (job.renderId !== undefined && server.durable !== null) {
        await server.durable.noteRenderObserved(
          sessionId,
          job.renderId,
          this.recipesByJob.get(jobId),
        );
      }
      // W919: the Jobs workspace's listing is a terminal-observation seam too
      // — the metered usage is recorded once per job (idempotent).
      if (job.completion !== undefined) {
        await this.noteJobUsage(jobId, job.completion.usage.costUnits);
      }
      let progressFraction: number | undefined;
      for (const event of job.events) {
        if (event.type === "progress" && event.fraction !== undefined) {
          progressFraction = event.fraction;
        }
      }
      rows.push({
        sessionId,
        jobId: job.jobId,
        state: job.state,
        ...(progressFraction !== undefined ? { progressFraction } : {}),
        ingest: job.ingest,
        ...(job.completion !== undefined
          ? {
              completion: {
                status: job.completion.status,
                ...(job.completion.failure !== undefined
                  ? { failure: job.completion.failure }
                  : {}),
                ...(job.completion.failure !== undefined
                  ? { failureMessage: job.completion.failure.message }
                  : {}),
                executionMs: job.completion.timing.executionMs,
                usage: job.completion.usage.costUnits.map((unit) => ({
                  unitId: unit.unitId,
                  quantity: unit.quantity,
                })),
              },
            }
          : {}),
      });
    }
    return { sessionId, label, status: session.status, jobs: rows };
  }

  /** Publishes or privatizes a session (the real visibility flag). */
  async setPublication(input: {
    token: string;
    sessionId: string;
    visibility: SessionVisibility;
  }): Promise<StudioPublicationView> {
    await this.requireSessionAccess(input.token, input.sessionId);
    // The control plane must know the session (uniform 404 for the rest).
    await this.getServer().control.getSession(input.sessionId);
    this.publication.set(input.sessionId, input.visibility);
    // W921 write-through (fail-loud): the flip is durable so every instance
    // reconstructs the SAME publication state.
    const server = this.getServer();
    if (server.durable !== null) {
      await server.durable.noteVisibility(input.sessionId, {
        kind: input.visibility,
        roles: [],
      });
    }
    return { sessionId: input.sessionId, visibility: input.visibility };
  }

  // -----------------------------------------------------------------------
  // The operations console seams (W918 — read by the operator console only)
  // -----------------------------------------------------------------------

  /**
   * The studio's REAL job ledger index (W918): every async job this studio
   * dispatched, with its session, its recorded dispatch parameters (the
   * retry source) and whether its bounded-queue admission slot is still
   * held. The console enriches each row with the control plane's live job
   * projection — this method never fabricates job STATE, only the index.
   */
  jobLedger(): {
    jobId: string;
    sessionId: string;
    dispatch: {
      rendererId: string;
      rendererVersion?: string;
      styleId?: string;
      dispatchedByUserId: string | null;
      dispatchedAtMs: number;
    } | null;
    /** The held admission id (null once released/settled). */
    admissionId: string | null;
  }[] {
    const rows: ReturnType<CreateStudioService["jobLedger"]> = [];
    for (const [sessionId, jobIds] of this.jobsBySession) {
      for (const jobId of jobIds) {
        rows.push({
          jobId,
          sessionId,
          dispatch: this.dispatchesByJob.get(jobId) ?? null,
          admissionId: this.admissionByJob.get(jobId) ?? null,
        });
      }
    }
    return rows;
  }

  /**
   * Releases one job's bounded-queue admission slot NOW (W918: the console's
   * cancel remediation) — the same guarded, once-only release the terminal
   * job poll performs. Returns whether a held slot was released.
   */
  async releaseAdmissionOf(jobId: string): Promise<boolean> {
    const admissionId = this.admissionByJob.get(jobId);
    if (admissionId === undefined || this.releasedJobs.has(jobId)) {
      return false;
    }
    this.releasedJobs.add(jobId);
    this.admissionByJob.delete(jobId);
    return await this.getServer().transientState.queue.release(admissionId);
  }

  /** One source's view (shared by options + creation answers). */
  private sourceView(source: {
    spec: FixtureStorySpec;
    label: string;
    description: string;
  }): StudioSourceView {
    return {
      key: source.spec.key,
      label: source.label,
      description: source.description,
      camera: {
        pan: source.spec.camera.pan,
        zoom: source.spec.camera.zoom,
        jitter: source.spec.camera.jitter,
      },
      commentary: source.spec.commentary.map((window) => ({ ...window })),
      lexicon: { players: [...source.spec.lexicon.players], teams: [...source.spec.lexicon.teams] },
    };
  }

  /**
   * Records one terminal job's metered usage into the dispatching user's
   * daily counters (W919): attributed from the RECORDED dispatch (never
   * invented), idempotent per job, and fail-open ONLY for the metering write
   * (a lost write is retried on the next observation — an unreadable counter
   * still refuses admission, so the fail-closed posture is intact).
   */
  private async noteJobUsage(
    jobId: string,
    costUnits: readonly { unitId: string; quantity: number }[],
  ): Promise<void> {
    const dispatchedBy = this.dispatchesByJob.get(jobId)?.dispatchedByUserId ?? null;
    try {
      await this.getServer().guardrails.noteJobUsage(dispatchedBy, jobId, costUnits);
    } catch {
      // The metering write failed: the job stays un-metered (retried on the
      // next terminal observation); admission's fail-closed reads are
      // unaffected (an unreadable counter refuses, never admits).
    }
  }
}
