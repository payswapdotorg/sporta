/**
 * THE CREATE STUDIO SERVICE (W906) — the server side of the guided creation
 * flow, over the REAL seams only:
 *
 * - source selection is the checked-in FIXTURE LIBRARY the dev seed drives
 *   (`./dev-story.ts`) — real engine inputs (fixture camera + commentary
 *   transcript), never invented media;
 * - session creation goes through the REAL identity control gate
 *   (`createMediaSession` — the W902 pattern: identity-attested policy,
 *   ownership recorded), then runs the selected story through the REAL
 *   M1→M3 chain and registers the fused engine, exactly like the dev seed;
 * - render dispatch goes through the control plane's W914 ASYNC surface
 *   (`createRenderAsync` → the configured compute adapter → a REAL render
 *   job executing through the REAL renderer plugin + the REAL W504 encoder
 *   and store, with the never-silent input accounting);
 * - job polling is the control plane's OWN `getComputeJob` projection;
 * - rights PREVIEWS derive from `@sporta/contracts`' fail-closed
 *   `deriveRightsCapabilities` — this module never invents rights semantics;
 * - publish/private is the real {@link PublicationStore} flag.
 *
 * HONEST LIMITATIONS (this wave, surfaced to the UI): no upload path — the
 * authorized source is the fixture library (uploading arbitrary media needs
 * the perception pipeline over real frames, a later wave); the studio job
 * index and publication state are in-memory with the composition's other
 * control-plane state.
 */
import { deriveRightsCapabilities } from "@sporta/contracts";
import type { AuthorizationPolicy, RightsCapabilities } from "@sporta/contracts";
import type { AllowedOperation, SharingScope } from "@sporta/contracts";
import {
  IdentityPermissionDeniedError,
  IdentityValidationError,
  authorize,
} from "@sporta/identity";
import type { Account } from "@sporta/identity";
import type { WorldModelEngine as WorldModelEngineInstance } from "@sporta/world-model";
import type { SportaServer } from "./composition";
import type { SeedStoryMeta } from "./dev-seed";
import { RENDER_REQUESTS_QUOTA } from "./platform/upstash/hosted";
import type { PlatformQuotaState } from "./platform/upstash/quotas";
import { QueueFullError, RateLimitedError, retryAfterSeconds } from "./platform/upstash/guards";
import { DERBY_STORY, FRIENDLY_STORY, TRAINING_STORY, runFixtureStory } from "./dev-story";
import type { FixtureStorySpec, StoryRun } from "./dev-story";
import type { SessionVisibility } from "./publication";

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
  /** The honest upload answer (no fake upload, ever). */
  upload: { available: false; reason: string };
  /** The compute plane the async renders dispatch through (or null). */
  compute: { provider: string; adapterId: string } | null;
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

/** The studio's session state (GET /api/create/sessions/[sessionId]). */
export interface StudioSessionState {
  sessionId: string;
  label: string;
  status: string;
  createdAtIso: string;
  rightsCapabilities: RightsCapabilities;
  visibility: SessionVisibility;
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
  jobs: { jobId: string; state: string; rendererId: string | null }[];
}

/** The dispatch answer (POST /api/create/sessions/[sessionId]/renders). */
export interface StudioDispatchView {
  disposition: "admitted" | "duplicate";
  jobId: string;
  idempotencyKey: string;
  sessionId: string;
  adapterId: string;
  jobState: string;
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
    failureMessage?: string;
    executionMs: number;
    usage: { unitId: string; quantity: number }[];
  };
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
  private readonly nowMs: () => number;
  /** The REAL job ids this studio dispatched, per session (in-memory). */
  private readonly jobsBySession = new Map<string, string[]>();
  /** Dispatched job id → its queue admission id (the slot released on settle). */
  private readonly admissionByJob = new Map<string, string>();
  /** Job ids whose admission was already released (idempotence guard). */
  private readonly releasedJobs = new Set<string>();
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
    }
  >();
  private policySeq = 0;

  constructor(options: CreateStudioServiceOptions) {
    this.getServer = options.getServer;
    this.engines = options.engines;
    this.storyIndex = options.storyIndex;
    this.publication = options.publication;
    this.attestations = options.attestations;
    this.operations = options.operations;
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
      rights: {
        operations: RIGHTS_OPERATIONS.map((operation) => ({ ...operation })),
        sharingScopes: [
          { id: "private", label: "Private" },
          { id: "operator-authorized", label: "Operator-authorized" },
        ],
      },
      upload: {
        available: false,
        reason:
          "uploading your own media is not available yet — it needs the real perception pipeline over uploaded frames; this studio selects from the checked-in authorized fixture library instead",
      },
      compute:
        server.compute === null
          ? null
          : { provider: server.compute.provider, adapterId: server.compute.adapterId },
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
   * Creates a studio session: the identity gate (re-attesting the declared
   * policy to the verified account), then the REAL fixture chain for the
   * selected source, registered before any render — exactly the dev seed's
   * own wiring.
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

    // The REAL identity gate: `media-session.create` grant required, the
    // policy re-attested (`assertedBy` = the verified account), ownership
    // recorded, the control plane's own fail-closed admission applied.
    const created = (await server.gate.createMediaSession(input.token, {
      authorizationPolicy: policy,
      sourceLabel: input.label ?? source.label,
    })) as { session: { sessionId: string }; rightsCapabilities: RightsCapabilities };
    const sessionId = created.session.sessionId;

    // W916: the gate attested the policy as the VERIFIED calling account —
    // record that attestation (the rights-holder policy scope's data).
    const attester = await server.auth.resolve(input.token);
    if (attester !== null) {
      this.attestations.record(sessionId, attester.account.userId);
    }

    // The REAL M1→M3 chain for the selected source, registered before any
    // render (the control plane's world-model factory picks it up).
    const run: StoryRun = runFixtureStory(sessionId, source.spec, this.nowMs);
    this.engines.set(sessionId, run.engine);
    this.storyIndex.set(sessionId, {
      source: "dev-seed",
      storyKey: source.spec.key,
      transcript: run.transcript,
      events: run.events,
      waveCount: run.waveCount,
    });

    // Fail-closed publication: studio sessions start private.
    this.publication.set(sessionId, "private");

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
    return {
      sessionId,
      label,
      status: session.status,
      createdAtIso: session.createdAtIso,
      rightsCapabilities,
      visibility: this.publication.visibilityOf(sessionId),
      renders: renderViews,
      jobs: await Promise.all(
        (this.jobsBySession.get(sessionId) ?? []).map(async (jobId) => ({
          jobId,
          state: await this.jobComputeStateOf(sessionId, jobId),
          rendererId: this.dispatchesByJob.get(jobId)?.rendererId ?? null,
        })),
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
   * Dispatches one REAL render through the control plane's async compute
   * surface (the W914 seam): the compute adapter executes the render job
   * (real renderer plugin, real W504 encode + store) and the control plane
   * ingests the artifacts into its playback store when the job settles.
   *
   * W913 admission ladder (fail-closed, Simulation E — new expensive jobs
   * stop admitting BEFORE the provider is asked to run them):
   * 1. the caller's per-user render-request quota is consumed — exhausted
   *    → 429 with the W901 QuotaState (admission refused);
   * 2. the job is admitted to the BOUNDED queue — at its hard depth bound
   *    → 503 (platform capacity; never silently dropped, never unbounded);
   * 3. only then does `createRenderAsync` run. The admission slot is
   *    released when the job poll observes a terminal state (or by the
   *    queue's admission lease if the client stops polling).
   */
  async dispatchRender(input: {
    token: string;
    sessionId: string;
    rendererId: string;
    rendererVersion?: string;
    styleId?: string;
    outputProfile?: StudioOutputProfile;
  }): Promise<StudioDispatchView> {
    const server = this.getServer();
    const account = await this.requireSessionAccess(input.token, input.sessionId);

    // 1. The per-user render quota (fail-closed: an unreadable counter refuses too).
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

    // 2. The bounded queue admission (fail-closed at the hard depth bound).
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

    // 3. The real dispatch (only past both guards).
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
    });
    const jobs = this.jobsBySession.get(input.sessionId) ?? [];
    if (!jobs.includes(dispatch.jobId)) jobs.push(dispatch.jobId);
    this.jobsBySession.set(input.sessionId, jobs);
    this.admissionByJob.set(dispatch.jobId, admissionId);
    this.dispatchesByJob.set(dispatch.jobId, {
      rendererId: input.rendererId,
      ...(input.rendererVersion !== undefined ? { rendererVersion: input.rendererVersion } : {}),
      ...(input.styleId !== undefined ? { styleId: input.styleId } : {}),
      dispatchedByUserId: account.userId,
      dispatchedAtMs: this.nowMs(),
    });
    return {
      disposition: dispatch.disposition,
      jobId: dispatch.jobId,
      idempotencyKey: dispatch.idempotencyKey,
      sessionId: dispatch.sessionId,
      adapterId: dispatch.adapterId,
      jobState: dispatch.jobState,
    };
  }

  /** Polls one job (the control plane's own projection, mapped for the UI). */
  async jobState(token: string, sessionId: string, jobId: string): Promise<StudioJobView> {
    await this.requireSessionAccess(token, sessionId);
    const job = await this.getServer().control.getComputeJob(sessionId, jobId);
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
}
