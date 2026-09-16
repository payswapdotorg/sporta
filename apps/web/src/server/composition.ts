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
} from "@sporta/identity";
import { argon2PasswordHasher } from "@sporta/identity";
import { AuthService } from "./auth-service";
import type { StoryEvent } from "./dev-story";
import { seedDevContent } from "./dev-seed";
import type { SeedStoryMeta } from "./dev-seed";

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
  /** Shared account store (also what the gate resolves against). */
  accounts: AccountStore;
  /** Dev-seed story metadata by session id (the honest "story" data). */
  storyIndex: ReadonlyMap<string, SeedStoryMeta>;
  /** The session-scoped SWM engines the control plane's factory hands out. */
  engines: ReadonlyMap<string, WorldModelEngineInstance>;
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

  // 1. The real auth surface over shared stores.
  const auth = new AuthService({
    accounts,
    nowMs,
    entropy,
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

  // 4. Session-scoped world-model engines: the dev seed registers fused
  //    engines here BEFORE rendering; every other session gets a fresh
  //    engine (the documented W701 factory seam).
  const engines = new Map<string, WorldModelEngineInstance>();
  const storyIndex = new Map<string, SeedStoryMeta>();

  const control = createControlApp({
    rendererRegistry: registry,
    renderOutputStore: pipeline,
    nowMs,
    worldModelFactory: (sessionId: string) => {
      const seeded = engines.get(sessionId);
      if (seeded !== undefined) return seeded;
      const engine = WorldModelEngine.create(sessionId, { now: () => nowMs() });
      engines.set(sessionId, engine);
      return engine;
    },
  });

  // 5. The identity control gate (owner/operator reads, deny-before-existence).
  const ownership = new InMemoryMediaOwnershipStore();
  const gate = createIdentityControlGate({ accounts, sessions: auth.sessions, control, ownership });

  const server: SportaServer = {
    auth,
    control,
    registry,
    pipeline,
    gate,
    ownership,
    accounts,
    storyIndex,
    engines,
    nowMs,
    ready: Promise.resolve(),
  };

  // 6. The dev seed (honest, labeled, real-engine-only). It registers its
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

/** The singleton getter — the ONLY thing route handlers call. */
export function getSportaServer(): Promise<SportaServer> {
  const cache = globalThis as ServerCache;
  cache[SERVER_GLOBAL] ??= Promise.resolve(
    createSportaServer({
      nowMs: Date.now,
      passwordHasher: argon2PasswordHasher,
      seed: process.env.SPORTA_DISABLE_DEV_SEED !== "1",
    }),
  );
  return cache[SERVER_GLOBAL];
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
