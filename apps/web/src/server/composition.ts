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
import type { ComputeAdapterPort } from "@sporta/compute-adapter";
import {
  ComputeWorker,
  HostedComputeAdapter,
  computeProviderSelectionOf,
  createDefaultOutputSegmentStore,
  resolveComputeAdapterFromEnv,
} from "@sporta/compute-adapter-hosted";
import type { ComputeProviderSelection } from "@sporta/compute-adapter-hosted";
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
import { neonConfigured, r2Configured, upstashConfigured } from "./platform/env";
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
import { AuthService } from "./auth-service";
import { CreateStudioService } from "./create-studio-service";
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
}

/** The composed in-process server every route handler consumes. */
export interface SportaServer {
  /** The real auth flows (register/login/logout/me/switch-role). */
  auth: AuthService;
  /** The transport-free control plane (sessions, renders, playback gate). */
  control: ControlApp;
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
  /** Wall clock the composition runs on. */
  nowMs: () => number;
  /** Resolves when the (optional) dev seed has finished. Route handlers await this. */
  ready: Promise<void>;
}

/**
 * Creates the composed server. The dev seed (when enabled) starts
 * asynchronously; await `server.ready` before serving catalog/watch traffic.
 */
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

  // 5. Session-scoped world-model engines: the dev seed registers fused
  //    engines here BEFORE rendering; every other session gets a fresh
  //    engine (the documented W701 factory seam).
  const engines = new Map<string, WorldModelEngineInstance>();
  const storyIndex = new Map<string, SeedStoryMeta>();

  const control = createControlApp({
    rendererRegistry: registry,
    renderOutputStore: pipeline,
    ...(computeAdapter !== undefined ? { computeAdapter } : {}),
    // The async surface's settled outputs land in the SAME playback store
    // the watch surface reads (the control plane re-keys them under its own
    // render id when it ingests the inline deliveries).
    renderOutputWriter: pipeline.segmentStore,
    nowMs,
    worldModelFactory: (sessionId: string) => {
      const seeded = engines.get(sessionId);
      if (seeded !== undefined) return seeded;
      const engine = WorldModelEngine.create(sessionId, { now: () => nowMs() });
      engines.set(sessionId, engine);
      return engine;
    },
  });

  // 6. The identity control gate (owner/operator reads, deny-before-existence).
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
  const transientBacking = options.transient ?? {
    redis: upstashConfigured() ? getHostedTransientState().redis : new InMemoryRedis(),
    provider: (upstashConfigured() ? "upstash" : "in-memory") as "upstash" | "in-memory",
  };
  const transientState: SportaServer["transientState"] = {
    provider: transientBacking.provider,
    redis: transientBacking.redis,
    queue: new BoundedJobQueue({
      redis: transientBacking.redis,
      key: HOSTED_QUEUE_KEY,
      maxDepth: HOSTED_QUEUE_MAX_DEPTH,
      admissionLeaseMs: HOSTED_ADMISSION_LEASE_MS,
      nowMs,
    }),
    quotas: new QuotaGuard({ redis: transientBacking.redis, nowMs }),
    cache: new TtlCache({
      redis: transientBacking.redis,
      namespace: "sporta:cache",
      ttlSeconds: HOSTED_CACHE_TTL_SECONDS,
    }),
  };

  // 6b. The hosted artifact store (W912): the R2-backed render-output store
  //     when configured. The dev seed MIRRORS every stored output into it
  //     (fail-closed — a configured R2 that rejects the mirror fails the
  //     seed loudly), and the watch output route then serves bytes fetched
  //     back from R2 through a short-lived presigned URL.
  const artifacts = options.artifacts ?? null;

  // 7. The Create Studio (W906) + the content model (W916: the visibility
  //    store + the rights-attestation index).
  const publication = new PublicationStore();
  const attestations = new PolicyAttestationIndex();
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

  const server: SportaServer = {
    auth,
    control,
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
    compute,
    computeAdapter: computeAdapter ?? null,
    operations,
    live,
    transientState,
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
 * The control plane's session/render REGISTRIES stay in-process in BOTH modes
 * (W913 scope); the render-output BYTES mirror to R2 when configured (W912:
 * `R2_*` bindings present — the seeded outputs persist in the private bucket
 * and playback reads them back through short-lived presigned delivery).
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
  return createSportaServer({
    nowMs: Date.now,
    accounts: hosted.accounts,
    sessions: hosted.sessions,
    ownership: hosted.ownership,
    passwordHasher: hosted.hasher,
    ...(artifacts !== null ? { artifacts } : {}),
    transient,
    seed,
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
