/**
 * THE SERVER COMPOSITION ROOT (W904) — one module that constructs the real
 * in-process services the app's route handlers call.
 *
 * ⚠️ DEV BACKING, HONESTLY LABELED: everything this root constructs is real
 * (a real control app over a real renderer registry and a real render-output
 * store; real identity stores; the real capability composition) but it is all
 * IN-PROCESS — accounts, sessions, media sessions, renders and stored outputs
 * live in this Node/Bun process and disappear on restart. The hosted backing
 * (Neon control-plane state, R2 artifacts, Upstash queues — W910-W914) is
 * Worker B's wave; the seam for it is EXACTLY this module: route handlers
 * consume {@link SportaServer}'s ports and never construct services, so the
 * backing can be swapped here without touching a single route.
 *
 * Composition (all frozen packages, wired the documented way):
 * - `RendererRegistry` with the reference `sporta.testcard` renderer AND the
 *   real `anime.prototype` plugin (both registered, both renderable);
 * - `createControlApp` (W701) over a `worldModelFactory` that hands out the
 *   dev-seeded engines and fresh engines for everything else;
 * - `createAnimeOutputPipeline` (W504) as the control app's render-output
 *   store (in-process segment + artifact stores — B's R2 adapter's seam);
 * - `@sporta/identity`'s stores + policy as the auth surface;
 * - `createIdentityControlGate` (W902) as the owner-gated control facade —
 *   the dev seed creates its media sessions THROUGH this gate, so every
 *   seeded policy is identity-attested and ownership-recorded;
 * - the DEV SEED (./dev-seed.ts) — see its own header for the honesty rules.
 */
import { createControlApp } from "@sporta/control-api";
import type { ControlApp } from "@sporta/control-api";
import { InMemoryComputeBroker } from "@sporta/compute-adapter";
import type { ComputeAdapterPort } from "@sporta/compute-adapter";
import {
  ComputeWorker,
  HostedComputeAdapter,
  computeProviderSelectionOf,
  createDefaultOutputSegmentStore,
  resolveComputeAdapterFromEnv,
} from "@sporta/compute-adapter-hosted";
import type { ComputeProviderSelection } from "@sporta/compute-adapter-hosted";
import { SelectionDirector } from "@sporta/connection-center";
import type { ProviderSelectionFacts } from "@sporta/connection-center";
import { createAnimeOutputPipeline } from "@sporta/output-pipeline";
import type { AnimeOutputPipeline } from "@sporta/output-pipeline";
import { RendererRegistry, createTestCardRenderer } from "@sporta/renderer-contract";
import { createAnimePrototypeRenderer } from "@sporta/renderer-anime";
import { WorldModelEngine } from "@sporta/world-model";
import type { WorldModelEngine as WorldModelEngineInstance } from "@sporta/world-model";
import {
  InMemoryAccountStore,
  InMemoryMediaOwnershipStore,
  createIdentityControlGate,
  defaultEntropySource,
} from "@sporta/identity";
import type {
  AccountStore,
  EntropySource,
  IdentityControlGate,
  MediaOwnershipStore,
  PasswordHasher,
  SessionService,
} from "@sporta/identity";
import { argon2PasswordHasher } from "@sporta/identity";
import {
  InMemoryMediaJobRepository,
  InMemoryMediaManifestRepository,
  InMemoryRenderArtifactRepository,
  InMemorySourceAssetRepository,
  LocalFilesystemStorage,
  MediaPlatformService,
  SqliteMediaPlatformStore,
} from "@sporta/media-platform";
import type { MediaStoragePort } from "@sporta/media-platform";
import { createDerivedRealityPlane } from "./derived-reality";
import { createDerivedRealityRenderOutputWriter } from "./derived-reality-media";
import { neonConfigured, r2Configured, upstashConfigured } from "./platform/env";
import type { RealityKind } from "@sporta/contracts";
import { neonClient } from "./platform/db/pg";
import { PgControlPlaneRecordStore } from "./platform/control/pg-records";
import { getHostedIdentity, identityReady } from "./platform/identity/hosted";
import { nodeScryptPasswordHasher } from "./platform/identity/node-scrypt-hasher";
import { getHostedRenderOutputStore } from "./platform/r2/hosted";
import type { R2RenderOutputStore } from "./platform/r2/r2-store";
import { InMemoryRedis, getHostedTransientState } from "./platform/upstash/redis";
import type { RedisLike } from "./platform/upstash/redis";
import { BoundedJobQueue } from "./platform/upstash/queue";
import { QuotaGuard } from "./platform/upstash/quotas";
import { TtlCache } from "./platform/upstash/cache";
import {
  HOSTED_ADMISSION_LEASE_MS,
  HOSTED_CACHE_TTL_SECONDS,
  HOSTED_QUEUE_KEY,
  HOSTED_QUEUE_MAX_DEPTH,
} from "./platform/upstash/hosted";
import {
  CommandCounter,
  GuardrailsService,
  MeteredRedis,
  type MeteredJobUsageRecord,
} from "./platform/guardrails";
import { AuthService } from "./auth-service";
import { CreateStudioService } from "./create-studio-service";
import { createDurableControlPlane } from "./durable-control-plane";
import type { DurableControlPlane } from "./durable-control-plane";
import type { ControlPlaneRecordStore } from "./platform/control/records";
import { RightsCenterService } from "./rights-center-service";
import { EffectivePolicyStore, PolicyAuditLog } from "./rights-policy-store";
import { createRightsGovernedControl } from "./rights-governed-control";
import { OperationsService } from "./operations-service";
import { createSseLiveTransport, liveCadenceMs, liveTransportActive } from "./live";
import type { LiveTransport } from "./live";
import type { StoryEvent } from "./dev-story";
import { seedDevContent } from "./dev-seed";
import type { SeedStoryMeta } from "./dev-seed";
import { PublicationStore, PolicyAttestationIndex } from "./publication";

/** Options for {@link createSportaServer} (every seam injectable; defaults are the REAL ones). */
export interface SportaServerOptions {
  /** Clock in epoch ms (default: the REAL wall clock — production posture). */
  nowMs?: () => number;
  /** Password hasher (default: REAL argon2id via `Bun.password`). */
  passwordHasher?: PasswordHasher;
  /** Session/seed entropy (default: REAL platform entropy). */
  entropy?: EntropySource;
  /** Shared account store (default: a fresh in-memory store). */
  accounts?: AccountStore;
  /** Pre-built session service (W911: the hosted Neon-backed one; default: in-memory). */
  sessions?: SessionService;
  /** Media-ownership store (default: a fresh in-memory store). */
  ownership?: MediaOwnershipStore;
  /**
   * A pre-built compute adapter for the async render surface (default: the
   * env-driven provider selection — `in-process` with this composition's
   * own renderer registry; `none` disables the async surface).
   */
  computeAdapter?: ComputeAdapterPort;
  /**
   * The live network transport (W915). Default: env-gated — ACTIVE only
   * when `SPORTA_LIVE_TRANSPORT=sse` (see ./live/env.ts); tests inject a
   * deterministic one through this seam.
   */
  liveTransport?: LiveTransport;
  /**
   * The hosted R2 artifact store (W912: the private-bucket render-output
   * store when the environment configures it; default: none — the seeded
   * outputs then live only in the in-process pipeline, and health reports
   * `artifacts: in-memory`).
   */
  artifacts?: R2RenderOutputStore | null;
  /**
   * The transient-state backing for THIS composition (W913): when injected,
   * the queue/quota/cache objects are built over the given `RedisLike`
   * (tests inject an `InMemoryRedis` with a pinned clock). Default: the REAL
   * hosted transient state — shared Upstash REST when both bindings exist,
   * a per-composition in-memory fallback otherwise (the honest per-instance
   * boundary; the production singleton passes the process-wide backing in
   * so `/api/platform/health` observes the same state).
   */
  transient?: { redis: RedisLike; provider: "upstash" | "in-memory" };
  /** Run the dev seed (default: true — this deployment IS the dev preview). */
  seed?: boolean;
  /**
   * The durable control-plane record store (W921): when injected, the
   * composition's control plane is fronted by the durable layer —
   * user-created sessions are written through (studio create / render poll /
   * publication flips) and reconstructed on instance miss through the real
   * seams. Default: absent — today's in-memory behavior, byte-identical.
   * The production singleton injects the Neon PostgreSQL adapter when
   * `DATABASE_URL` is configured (the W911 gate).
   */
  controlRecords?: ControlPlaneRecordStore;
  /**
   * The real-media loop's seams (R101-R104): the storage backend (default:
   * the local-filesystem adapter at `SPORTA_MEDIA_STORAGE` or
   * `db/media-storage`) and the sqlite database backing the durable
   * records (default: `SPORTA_MEDIA_DB` or `db/media-platform.db`). Tests
   * inject temp dirs and `:memory:`; an R2 adapter is a future drop-in
   * behind the same `MediaStoragePort` (no route change).
   */
  media?: {
    storage?: MediaStoragePort;
    /** A sqlite db path (or `:memory:`). */
    db?: string;
  };
}

/** The composed in-process server every route handler consumes. */
export interface SportaServer {
  /** The real auth flows (register/login/logout/me/switch-role). */
  auth: AuthService;
  /** The transport-free control plane (sessions, renders, playback gate). */
  control: ControlApp;
  /**
   * The durable control plane (W921): the write-through / reconstruct layer
   * over `control`, or `null` when no record store is configured (the
   * honest in-memory state the health route reports). Route layers that
   * gate on publication state BEFORE reading it (the watch gate) ensure
   * liveness through this seam so a cold instance never mistakes a durable
   * session's un-seeded in-process publication store for "public".
   */
  durable: DurableControlPlane | null;
  /** The renderer registry backing `control` (test-card + anime prototype). */
  registry: RendererRegistry;
  /** The W504 render-output store backing `control`'s playback routes. */
  pipeline: AnimeOutputPipeline;
  /** The identity-gated control facade (owner/operator reads; deny-before-existence). */
  gate: IdentityControlGate;
  /** Media-session ownership (which account created which session). */
  ownership: MediaOwnershipStore;
  /**
   * The hosted R2 artifact store (W912) — `null` when unconfigured (the
   * honest in-memory state health reports; seeded outputs are then NOT
   * mirrored to R2 and the watch output route serves the in-process bytes).
   */
  artifacts: R2RenderOutputStore | null;
  /** Shared account store (also what the gate resolves against). */
  accounts: AccountStore;
  /** Dev-seed story metadata by session id (the honest "story" data). */
  storyIndex: ReadonlyMap<string, SeedStoryMeta>;
  /** The session-scoped SWM engines the control plane's factory hands out. */
  engines: ReadonlyMap<string, WorldModelEngineInstance>;
  /** The Create Studio service (W906 — the guided creation flow). */
  studio: CreateStudioService;
  /** The publication store (the real publish/private visibility flag). */
  publication: PublicationStore;
  /**
   * The rights-attestation index (W916): which account attested each
   * session's rights policy at its real creation event — the data behind the
   * rights-holder POLICY SCOPE (a rights holder discovers sessions whose
   * rights they attested). Sessions created outside the recording paths are
   * unrecorded, hence outside every policy scope (fail-closed).
   */
  attestations: PolicyAttestationIndex;
  /**
   * The W917 rights-policy registry: each session's creation-time policy
   * record plus any rights-holder EDIT (the override the rights-governed
   * control plane re-derives every rights read from, fail-closed).
   */
  rightsPolicies: EffectivePolicyStore;
  /**
   * The W917 append-only policy-change record (who/what/when — in-memory
   * dev backing, documented at the store).
   */
  rightsAudit: PolicyAuditLog;
  /**
   * The Rights Center service (W917): policy inspection, policy editing,
   * visibility editing and revocation for content the caller owns or
   * controls — over the REAL contracts' semantics.
   */
  rights: RightsCenterService;
  /**
   * The compute plane the control plane's async render surface dispatches
   * through (W914): the env-selected provider + the REAL adapter id, or null
   * when the async surface is disabled (`COMPUTE_PROVIDER=none`).
   */
  compute: { provider: ComputeProviderSelection; adapterId: string } | null;
  /**
   * The compute adapter instance itself (W918): the operations console's
   * remediation seam — the REAL `cancel` + the accounting stats over the
   * SAME adapter the control plane dispatches through. Null when the async
   * surface is disabled.
   */
  computeAdapter: import("@sporta/compute-adapter").ComputeAdapterPort | null;
  /**
   * The compute SELECTION seam (R501): the REAL R407 SelectionDirector over
   * a broker registered with this composition's compute adapter, when the
   * provider id is knowable (the in-process worker's own id, or an injected
   * `computeProviderId`). The studio's compute step quotes/selects through
   * THIS director — the auditable explanation is its own document. `null`
   * when there is no adapter or no knowable provider id (the honest
   * unavailable state, never a fabricated selection).
   */
  selection: {
    director: SelectionDirector;
    /** The provider id the adapter is registered under (data, never a vendor name). */
    providerId: string;
    /** The operator's DATA declarations for the registered provider. */
    facts: ProviderSelectionFacts;
  } | null;
  /**
   * The renderer → reality declarations (R503): which registered renderer
   * produces which of the four MVP reality kinds. Composition DATA (the
   * operator's honest declarations — the renderer capabilities carry no
   * reality field, and the catalog never guesses): today only the anime
   * prototype maps to the `anime-npr` reality; the tactical and 3D
   * realities have NO registered producer (the renderers exist as packages
   * but cannot execute through the async compute plane's encode seam), so
   * the catalog reports them honestly unavailable. Renderers without a
   * mapping (the reference test card) are not product realities.
   */
  realityProducers: ReadonlyMap<string, RealityKind>;
  /**
   * The operations console service (W918): operator grant-gated health /
   * queues / providers / jobs panels + the audit-logged safe remediations
   * (retry a failed job, cancel an admitted job).
   */
  operations: OperationsService;
  /**
   * The live network transport (W915): real SSE frame streaming over HTTP,
   * env-gated — `state()` is `active` only when it is genuinely serving
   * (SPORTA_LIVE_TRANSPORT=sse); the capability response is wired to it.
   */
  live: LiveTransport;
  /**
   * The hosted transient state (W913): the bounded render job queue, the
   * quota/rate-limit counters, and the small TTL cache, over the REAL
   * Upstash REST backing when configured (shared across instances) or the
   * honest in-memory fallback (per-instance — health reports it).
   */
  transientState: {
    provider: "upstash" | "in-memory";
    redis: RedisLike;
    queue: BoundedJobQueue;
    quotas: QuotaGuard;
    cache: TtlCache;
  };
  /**
   * The cost/usage guardrails (W919): provider usage counters over the real
   * seams, the free-tier limit ledger, spend alarms, and the fail-closed
   * provider-capacity admission rung the studio's dispatch ladder runs.
   */
  guardrails: GuardrailsService;
  /**
   * The real-media loop (R101-R104): browser upload → pre-storage
   * constraint validation → durable hash-verified SourceAsset → REAL
   * ffmpeg normalization (the in-process executor; fails loud when ffmpeg
   * is absent) → the `original` reality artifact. Storage seams + the
   * sqlite record store are `SportaServerOptions.media` (the R2 adapter is
   * a drop-in behind the same port).
   */
  media: MediaPlatformService;
  /** The media loop's storage seam (the playback route's Range primitive). */
  mediaStorage: MediaStoragePort;
  /** Wall clock the composition runs on. */
  nowMs: () => number;
  /** Resolves when the (optional) dev seed has finished. Route handlers await this. */
  ready: Promise<void>;
}

/**
 * Creates the composed server. The dev seed (when enabled) starts
 * asynchronously; await `server.ready` before serving catalog/watch traffic.
 */

/** The record store's provider name (structural — wrappers inherit nothing). */
function providerOfRecords(store: ControlPlaneRecordStore): "neon" | "in-memory" {
  return (store as { providerName?: unknown }).providerName === "neon" ? "neon" : "in-memory";
}

export function createSportaServer(options: SportaServerOptions = {}): SportaServer {
  const nowMs = options.nowMs ?? Date.now;
  const entropy = options.entropy ?? defaultEntropySource;
  const accounts = options.accounts ?? new InMemoryAccountStore();

  // 1. The real auth surface over shared stores (W911: over the Neon-backed
  //    stores when the environment configures them — see getSportaServer).
  const auth = new AuthService({
    accounts,
    nowMs,
    entropy,
    ...(options.sessions !== undefined ? { sessions: options.sessions } : {}),
    ...(options.passwordHasher !== undefined ? { passwordHasher: options.passwordHasher } : {}),
  });

  // 2. The real renderer registry: the W501 reference test-card renderer and
  //    the REAL W502 anime plugin. (3D and Tactical are NOT registered — no
  //    such renderer exists; the product never invents one.)
  const registry = new RendererRegistry();
  registry.register(createTestCardRenderer());
  registry.register(createAnimePrototypeRenderer());

  // 2'. The derived-reality plane (R508-R510): the REAL tactical/3D/anime
  //     renderers + the R306 encoding bridges, composed ONLY when the real
  //     encode toolchain probes available (system ffmpeg + libx264). When
  //     it composes, the derived realities (tactical / three-d-game /
  //     anime-npr) render through the REAL MP4 encode plane; when it does
  //     not, they stay honestly producer-unavailable — never a silent
  //     SVG fallback presented as video.
  const derivedPlane = createDerivedRealityPlane({ nowMs });
  if (derivedPlane !== null) derivedPlane.registerRenderers(registry);

  // 3. The real W504 output pipeline (in-process stores) as the control
  //    plane's render-output store.
  const pipeline = createAnimeOutputPipeline();

  // 4. The compute plane (the W914 seam, env-driven like the worker route):
  //    `in-process` (default) executes REAL render jobs in this process
  //    through THIS composition's own renderer registry — the same code path
  //    `apps/web/src/app/api/compute` runs; `http` is pre-resolved by the
  //    singleton (it fetches the worker's live descriptor); `none` disables
  //    the async surface (its typed 503 answers honestly).
  let computeAdapter: ComputeAdapterPort | undefined = options.computeAdapter;
  const computeProvider = computeProviderSelectionOf(process.env);
  if (computeAdapter === undefined && computeProvider === "in-process") {
    const worker = new ComputeWorker({
      rendererRegistry: registry,
      outputSegmentStore: createDefaultOutputSegmentStore(),
      // R508-R510: the derived-reality MP4 renderer (the R306 bridge
      // plane) + the W504 content-addressed artifact store it registers
      // encoded MP4s into (the pipeline's own store — the same instance
      // the routing render-output writer reads back through).
      ...(derivedPlane === null
        ? {}
        : { derivedRealityRenderer: derivedPlane.derivedRealityRenderer }),
      encodedArtifactStore: pipeline.artifactStore,
      nowMs,
    });
    computeAdapter = new HostedComputeAdapter({
      descriptor: worker.describe(),
      execute: async (job, materialized) => {
        if (materialized === undefined) {
          throw new Error("in-process execution requires materialized inputs");
        }
        const execution = await worker.execute({ job, inputs: materialized });
        if (execution.kind === "refused") {
          throw new Error(`${execution.reason.errorClass}: ${execution.reason.message}`);
        }
        return execution.result;
      },
      nowMs,
      providerId: worker.providerId,
    });
  }
  const compute: SportaServer["compute"] =
    computeAdapter === undefined
      ? null
      : { provider: computeProvider, adapterId: computeAdapter.describe().adapterId };

  // 4a. The compute SELECTION seam (R501): the REAL R407 SelectionDirector
  //     over an R401 InMemoryComputeBroker registered with this
  //     composition's adapter. The R407 identity axis is the ADAPTER's own
  //     descriptor id (`adapterId` — the director's registeredProviderIds
  //     reads the descriptors; the connection-center's own composition
  //     convention registers the broker entry under that same id), so the
  //     seam is available whenever an adapter is — no separate provider-id
  //     knowledge needed. The FACTS are the operator's DATA declarations
  //     (R407 vocabulary): the in-process adapter executes in this
  //     deployment's own process (`sporta-managed`), declares the
  //     descriptor's own provider kind as its capability class, and
  //     declares NO VRAM (an undeclared axis excludes honestly, never by
  //     guessing).
  let selection: SportaServer["selection"] = null;
  if (computeAdapter !== undefined) {
    const selectionProviderId = computeAdapter.describe().adapterId;
    const selectionFacts: ProviderSelectionFacts = {
      providerId: selectionProviderId,
      privacyZone: "sporta-managed",
      capabilityClasses: [computeAdapter.describe().providerKind],
    };
    selection = {
      director: new SelectionDirector({
        broker: new InMemoryComputeBroker({
          providers: [{ providerId: selectionProviderId, adapter: computeAdapter }],
        }),
        facts: new Map([[selectionProviderId, selectionFacts]]),
        nowMs,
      }),
      providerId: selectionProviderId,
      facts: selectionFacts,
    };
  }

  // 5. Session-scoped world-model engines: the dev seed registers fused
  //    engines here BEFORE rendering; every other session gets a fresh
  //    engine (the documented W701 factory seam).
  const engines = new Map<string, WorldModelEngineInstance>();
  const storyIndex = new Map<string, SeedStoryMeta>();

  // 5-pre. The late-binding holder for the media service (the routing
  //         render-output writer resolves it at LANDING time — see the
  //         createControlApp wiring above).
  const mediaServiceHolder: { service: MediaPlatformService | null } = { service: null };

  const rawControl = createControlApp({
    rendererRegistry: registry,
    renderOutputStore: pipeline,
    ...(computeAdapter !== undefined ? { computeAdapter } : {}),
    // The async surface's settled outputs land in the SAME playback store
    // the watch surface reads (the control plane re-keys them under its own
    // render id when it ingests the inline deliveries). R508-R510: the
    // writer ROUTES by the artifact's honest content type — the W504 SVG
    // review segments land in the pipeline's segment store exactly as
    // before, while the R306-encoded derived-reality MP4s (the primary
    // artifacts of the tactical / 3D / anime realities) land in the media
    // platform (bytes content-addressed + the frozen manifest), the same
    // landing the `original` reality's normalized MP4s take. The media
    // seam is constructed BELOW this point, so the writer resolves it at
    // LANDING time (an ingest can only fire once the whole composition
    // exists).
    renderOutputWriter: createDerivedRealityRenderOutputWriter({
      segmentStore: pipeline.segmentStore,
      getMedia: () => {
        if (mediaServiceHolder.service === null) {
          throw new Error(
            "the derived-reality render-output writer fired before the media seam was composed (impossible on a completed composition)",
          );
        }
        return mediaServiceHolder.service;
      },
      encodedArtifactStore: pipeline.artifactStore,
    }),
    nowMs,
    worldModelFactory: (sessionId: string) => {
      const seeded = engines.get(sessionId);
      if (seeded !== undefined) return seeded;
      const engine = WorldModelEngine.create(sessionId, { now: () => nowMs() });
      engines.set(sessionId, engine);
      return engine;
    },
  });

  // 5a. The W917 rights-policy layer: the registry (creation records +
  //     rights-holder edits) + the append-only audit log, fronting the raw
  //     control app so every rights-checking read re-derives from the
  //     EFFECTIVE policy (fail-closed per read). The gate, the studio, the
  //     catalog and every route below consume this GOVERNED control plane —
  //     the raw app is never handed out.
  const rightsPolicies = new EffectivePolicyStore();
  const rightsAudit = new PolicyAuditLog();
  let control: ControlApp = createRightsGovernedControl(rawControl, rightsPolicies, nowMs);

  // 6b. The real-media loop (R101-R104): the durable sqlite record store +
  //     the storage seam (the local-filesystem adapter by default; the R2
  //     adapter is a drop-in behind the same `MediaStoragePort` — the
  //     composition root is the ONLY wiring point). Rights resolve through
  //     the W917 effective-policy store (fail-closed per upload); the
  //     pipeline executor runs in-process (REAL ffmpeg — fails loud when
  //     the binary is absent, never a faked normalization).
  //     HOISTED BEFORE the durable layer (R501): the durable control plane
  //     reconstructs upload-source sessions by re-running the R207
  //     real-to-SWM pipeline over the STORED source bytes (the media
  //     service's own storage + records), so it needs the media seam.
  //
  //     The bundled runtimes (Turbopack/webpack alias `bun:sqlite` to the
  //     loud W911 shim — see next.config.ts) cannot construct the durable
  //     sqlite store: the constructor fails with the shim's message and the
  //     honest fallback is the in-memory repositories plus the loud banner
  //     below (the W911 doctrine — the deployed backing is the in-memory
  //     plane). The run itself stays real end-to-end (pipeline, ffmpeg,
  //     artifacts); only cross-RESTART durability is absent, and that
  //     property is carried by the sqlite runs (the batteries execute the
  //     real `bun:sqlite` store under the real Bun runtime). Any OTHER
  //     construction failure is re-thrown — never masked.
  const SQLITE_SHIM_REFUSAL =
    "bun:sqlite is available only under the Bun runtime";
  let mediaStore: {
    sourceAssets: import("@sporta/media-platform").SourceAssetRepository;
    manifests: import("@sporta/media-platform").MediaManifestRepository;
    artifacts: import("@sporta/media-platform").RenderArtifactRepository;
    jobs: import("@sporta/media-platform").MediaJobRepository;
  };
  try {
    mediaStore = new SqliteMediaPlatformStore(
      options.media?.db ?? process.env.SPORTA_MEDIA_DB ?? "db/media-platform.db",
    );
  } catch (error) {
    if (!String(error).includes(SQLITE_SHIM_REFUSAL)) {
      throw error;
    }
    console.error(
      "[sporta] media records are IN-MEMORY this run (the bundled runtime has no bun:sqlite); " +
        "restarts do not persist sessions — the durable sqlite store runs under the real Bun runtime",
    );
    mediaStore = {
      sourceAssets: new InMemorySourceAssetRepository(),
      manifests: new InMemoryMediaManifestRepository(),
      artifacts: new InMemoryRenderArtifactRepository(),
      jobs: new InMemoryMediaJobRepository(),
    };
  }
  const mediaStorage: MediaStoragePort =
    options.media?.storage ??
    new LocalFilesystemStorage(
      process.env.SPORTA_MEDIA_STORAGE ?? "db/media-storage",
      "media-local-fs",
    );
  const media = new MediaPlatformService({
    storage: mediaStorage,
    sourceAssets: mediaStore.sourceAssets,
    manifests: mediaStore.manifests,
    artifacts: mediaStore.artifacts,
    jobs: mediaStore.jobs,
    resolvePolicy: (sessionId) => rightsPolicies.effectiveOf(sessionId),
    nowMs,
    autoRun: true,
  });
  // R508-R510: the routing render-output writer's late-bound media seam is
  // now live — derived-reality MP4 ingests can land from here on.
  mediaServiceHolder.service = media;

  // 7 (hoisted from the studio block — W921): the publication store and the
  //     rights-attestation index are the durable layer's reconstruction
  //     targets (a reconstructed session re-seeds its recorded visibility
  //     and attestation into them), so they exist before it does.
  const publication = new PublicationStore();
  const attestations = new PolicyAttestationIndex();
  const artifacts: R2RenderOutputStore | null = options.artifacts ?? null;

  // 5c. The durable control plane (W921): when a record store is configured,
  //     the governed control app is fronted by the durable layer —
  //     session/render write-through at the real seams, reconstruction on
  //     instance miss through the real seams, and the render-id merge.
  //     Without a store, `durable` is null and `control` stays the governed
  //     app — today's in-memory behavior, byte-identical.
  const durable: DurableControlPlane | null =
    options.controlRecords !== undefined && options.controlRecords !== null
      ? createDurableControlPlane({
          governed: control,
          records: options.controlRecords,
          registry,
          engines,
          storyIndex,
          publication,
          attestations,
          pipeline,
          artifacts,
          media: { service: media, storage: mediaStorage },
          provider: providerOfRecords(options.controlRecords),
          nowMs,
        })
      : null;
  if (durable !== null) control = durable.control;

  // 6. The identity control gate (owner/operator reads, deny-before-existence)
  //    — over the DECORATED control plane (the gate's mediated reads then
  //    reconstruct and merge exactly like every other reader).
  const ownership = options.ownership ?? new InMemoryMediaOwnershipStore();
  const gate = createIdentityControlGate({ accounts, sessions: auth.sessions, control, ownership });

  // 5b. The live network transport (W915): env-gated — active only when
  //     SPORTA_LIVE_TRANSPORT=sse; the dev seed registers the
  //     live-authorized sessions' story timelines as its live sources. The
  //     composition root is the ONLY env reader (the documented convention).
  const live =
    options.liveTransport ??
    createSseLiveTransport({
      active: liveTransportActive(),
      nowMs,
      cadenceMs: liveCadenceMs(),
    });

  // 6a. The transient state (W913): the bounded render queue, the quota
  //     counters, and the small TTL cache. Injected for tests; otherwise the
  //     REAL hosted backing — shared Upstash REST when configured, an
  //     in-memory per-composition fallback (honestly per-instance) when not.
  //     W919: the backing is wrapped in the METERED redis — every command the
  //     queue/quota/cache layers issue is counted toward the Upstash monthly
  //     command allowance (the guardrails service persists the counters).
  const transientBacking = options.transient ?? {
    redis: upstashConfigured() ? getHostedTransientState().redis : new InMemoryRedis(),
    provider: (upstashConfigured() ? "upstash" : "in-memory") as "upstash" | "in-memory",
  };
  const commandCounter = new CommandCounter();
  const meteredRedis = new MeteredRedis(transientBacking.redis, () => commandCounter.note());
  const transientState: SportaServer["transientState"] = {
    provider: transientBacking.provider,
    redis: meteredRedis,
    queue: new BoundedJobQueue({
      redis: meteredRedis,
      key: HOSTED_QUEUE_KEY,
      maxDepth: HOSTED_QUEUE_MAX_DEPTH,
      admissionLeaseMs: HOSTED_ADMISSION_LEASE_MS,
      nowMs,
    }),
    quotas: new QuotaGuard({ redis: meteredRedis, nowMs }),
    cache: new TtlCache({
      redis: meteredRedis,
      namespace: "sporta:cache",
      ttlSeconds: HOSTED_CACHE_TTL_SECONDS,
    }),
  };

  // 6a'. The cost/usage guardrails (W919) over the REAL seams: the metered
  //      redis (command volume), the compute adapter's usage drain (per-job
  //      cpu-ms/render-requests/artifact-bytes), and the composition's own
  //      R2 artifact store (stored bytes — the live stock). The ledger is
  //      env-overridable (SPORTA_LIMIT_* — fail-loud on invalid values).
  const guardrails = new GuardrailsService({
    redis: meteredRedis,
    commands: commandCounter,
    nowMs,
    computeUsage: async () => {
      if (computeAdapter === undefined) return null;
      const records = await computeAdapter.usage();
      return records.map((record): MeteredJobUsageRecord => ({
        jobId: record.jobId,
        meteredAtMs: record.meteredAtMs,
        costUnits: record.costUnits.map((unit) => ({
          unitId: unit.unitId,
          quantity: unit.quantity,
        })),
      }));
    },
    r2Stats: async () => {
      // The composition's OWN artifact store (options-injected or null).
      const store = options.artifacts ?? null;
      return store === null ? null : await store.stats();
    },
  });

  // 7. The Create Studio (W906) + the content model (W916: the visibility
  //    store + the rights-attestation index — constructed above, hoisted
  //    for the durable layer). The hosted artifact store (W912) is likewise
  //    bound above: the dev seed MIRRORS every stored output into it
  //     (fail-closed — a configured R2 that rejects the mirror fails the
  //     seed loudly), and the watch output route then serves bytes fetched
  //     back from R2 through a short-lived presigned URL.
  // W918: the operations console — constructed before the studio so the
  // studio's dispatch seam can count admission refusals into it (the only
  // app path that offers jobs to the bounded queue).
  const operations = new OperationsService({ getServer: () => server, nowMs });
  const studio = new CreateStudioService({
    getServer: () => server,
    engines,
    storyIndex,
    publication,
    attestations,
    nowMs,
    operations: {
      noteAdmissionRefusal: (depth, maxDepth) => operations.noteAdmissionRefusal(depth, maxDepth),
    },
  });
  const rights = new RightsCenterService({ getServer: () => server, nowMs });

  // 7'. The renderer → reality declarations (R503): composition DATA over
  //      the REGISTERED renderers only. The anime prototype produces the
  //      anime-npr reality (the product's anime reality — its id and class
  //      are the prototype's own, never a vendor name) — its W504 SVG
  //      review segments are the DIAGNOSTICS surface of that reality. The
  //      R508-R510 derived-reality plane contributes the PRIMARY MP4
  //      producers — tactical.prototype → tactical, game-3d.prototype →
  //      three-d-game, anime-npr.prototype → anime-npr — but ONLY when the
  //      real encode toolchain composed (honest producer-unavailability
  //      otherwise). The reference test card is not a product reality.
  const realityProducers: SportaServer["realityProducers"] = new Map([
    ["anime.prototype", "anime-npr"],
    ...(derivedPlane === null ? [] : [...derivedPlane.producers.entries()]),
  ]);

  const server: SportaServer = {
    auth,
    control,
    durable,
    registry,
    pipeline,
    gate,
    ownership,
    accounts,
    artifacts,
    storyIndex,
    engines,
    studio,
    publication,
    attestations,
    rightsPolicies,
    rightsAudit,
    rights,
    compute,
    computeAdapter: computeAdapter ?? null,
    selection,
    realityProducers,
    operations,
    live,
    transientState,
    guardrails,
    media,
    mediaStorage,
    nowMs,
    ready: Promise.resolve(),
  };

  // 8. The dev seed (honest, labeled, real-engine-only). It registers its
  //    engines into `engines` and its story metadata into `storyIndex`.
  if (options.seed !== false) {
    server.ready = seedDevContent({
      server,
      engines,
      storyIndex,
      entropy,
    }).then(() => undefined);
  }
  return server;
}

// ---------------------------------------------------------------------------
// The process singleton (dev-server hot reload safe)
// ---------------------------------------------------------------------------

/** The global cache key (kept on globalThis so Next.js dev reloads reuse it). */
const SERVER_GLOBAL = Symbol.for("sporta.web.server");

type ServerCache = { [SERVER_GLOBAL]?: Promise<SportaServer> };

/** Whether this process runs under the Bun runtime (vs Node on Vercel). */
function runningUnderBun(): boolean {
  return typeof process.versions.bun === "string";
}

/** The singleton getter — the ONLY thing route handlers call. */
export function getSportaServer(): Promise<SportaServer> {
  const cache = globalThis as ServerCache;
  cache[SERVER_GLOBAL] ??= buildSingleton().catch((err) => {
    // A failed build (e.g. a transient Neon outage during the first request's
    // migrations) must not POISON the singleton: clear the cached promise so
    // the next request retries instead of serving the same rejection forever.
    delete cache[SERVER_GLOBAL];
    throw err;
  });
  return cache[SERVER_GLOBAL]!;
}

/**
 * Builds the process singleton, env-gated (W911):
 *
 * - `DATABASE_URL` present → the HOSTED identity backing: the Neon PostgreSQL
 *   stores (`Pg*Store` via `getHostedIdentity()`), migrations ensured first
 *   (`identityReady()` — advisory-locked, once per runtime instance), and the
 *   Node `scrypt` hasher (Vercel's Node runtime cannot run the Bun argon2id
 *   default — the W902 `PasswordHasher` port exists for exactly this swap).
 *   Accounts, sessions (hashed tokens) and media ownership then persist
 *   across deploys and cold starts.
 * - Absent → the local dev composition (in-memory stores + the runtime's
 *   REAL KDF: Bun's argon2id when running under Bun, the Node `scrypt`
 *   hasher on Node — the same W902 port, so an unconfigured Node runtime
 *   (a Vercel preview without bindings) still serves working in-memory auth
 *   instead of crashing on the missing `Bun` global). `/api/platform/health`
 *   reports this state honestly as `in-memory`.
 *
 * The control plane's session/render REGISTRIES are in-process on the
 * unconfigured path; with `DATABASE_URL` they are DURABLE (W921) — user
 * sessions/renders/publication write through to Neon and reconstruct on
 * instance miss, while the compute-job LEDGER stays per-instance (the
 * documented W921 boundary). The render-output BYTES mirror to R2 when
 * configured (W912: `R2_*` bindings present — the outputs persist in the
 * private bucket and playback reads them back through short-lived presigned
 * delivery).
 */
async function buildSingleton(): Promise<SportaServer> {
  const seed = process.env.SPORTA_DISABLE_DEV_SEED !== "1";
  // The env-selected compute provider (fail-loud on a bad value). The http
  // provider's adapter is pre-resolved here — its descriptor is fetched
  // LIVE from the configured worker (never locally invented).
  const computeProvider = computeProviderSelectionOf(process.env);
  const httpCompute =
    computeProvider === "http" ? await resolveComputeAdapterFromEnv({ nowMs: Date.now }) : null;
  const artifacts = r2Configured() ? getHostedRenderOutputStore() : null;
  // The PROCESS-WIDE transient backing (W913): the shared Upstash REST client
  // when both bindings exist, the shared in-memory fallback otherwise — the
  // SAME instance `/api/platform/health` probes, so the health route's
  // queue/quota observations match what this composition actually uses.
  const transient = getHostedTransientState();
  if (!neonConfigured()) {
    return createSportaServer({
      nowMs: Date.now,
      passwordHasher: runningUnderBun() ? argon2PasswordHasher : nodeScryptPasswordHasher,
      ...(artifacts !== null ? { artifacts } : {}),
      transient,
      seed,
      ...(httpCompute?.adapter !== undefined && httpCompute.adapter !== null
        ? { computeAdapter: httpCompute.adapter }
        : {}),
    });
  }
  await identityReady();
  const hosted = getHostedIdentity();
  // W921: the durable control-plane records ride the SAME gate as identity
  // (DATABASE_URL configured ⇒ Neon). `identityReady()` has ensured BOTH
  // migrations (0001 identity + 0002 control-plane) before any store use.
  const controlRecords = new PgControlPlaneRecordStore(neonClient()!, Date.now);
  return createSportaServer({
    nowMs: Date.now,
    accounts: hosted.accounts,
    sessions: hosted.sessions,
    ownership: hosted.ownership,
    passwordHasher: hosted.hasher,
    ...(artifacts !== null ? { artifacts } : {}),
    transient,
    seed,
    controlRecords,
    ...(httpCompute?.adapter !== undefined && httpCompute.adapter !== null
      ? { computeAdapter: httpCompute.adapter }
      : {}),
  });
}

/**
 * TEST-ONLY: installs a pre-built server as the process singleton, so route
 * tests can drive the exported route handlers against a hermetic composition
 * (deterministic clock, test hasher, optional seed) instead of the production
 * singleton. Never imported by app code.
 */
export function installSportaServerForTests(server: SportaServer): void {
  const cache = globalThis as ServerCache;
  cache[SERVER_GLOBAL] = Promise.resolve(server);
}

export type { StoryEvent };
