/**
 * THE DEV SEED (W904/W905) — real engine content, honestly labeled.
 *
 * ⚠️ THIS IS A DEV SEED. What it does: register a labeled platform account
 * through the REAL register path, create three media sessions through the
 * REAL identity control gate (identity-attested policies, ownership
 * recorded), run each session's fixture story through the REAL M1→M3 chain
 * (fixture frames → tracker → camera → spatial state → observations → fusion
 * → world model), then create REAL renders through the REAL control plane
 * (`createRender` over the real renderer registry) and store REAL encoded
 * outputs through the REAL W504 pipeline (`encodeAndStore`).
 *
 * What it NEVER does: fabricate matches, thumbnails, live state, capability
 * data, positions, events or confidences. Everything the surfaces render is
 * either computed by the real engine here or honestly absent (e.g. live —
 * there is no live transport, and the Live surface says so).
 *
 * The seed account's password is drawn from real entropy and discarded: the
 * dev content is owned by the platform's seed account and is NOT signable-into.
 * Users register their own accounts; their Library lists their own sessions.
 */
import { SCHEMA_VERSION, deriveRightsCapabilities } from "@sporta/contracts";
import {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  renderAnimeClip,
} from "@sporta/renderer-anime";
import type { AnimeRenderOutput } from "@sporta/renderer-anime";
import { AccountConflictError } from "@sporta/identity";
import type { Account, EntropySource } from "@sporta/identity";
import type { WorldModelEngine as WorldModelEngineInstance } from "@sporta/world-model";
import { drawSeedPassword } from "./auth-service";
import type { SportaServer } from "./composition";
import {
  DERBY_STORY,
  FRIENDLY_STORY,
  TRAINING_STORY,
  SEED_POLICIES,
  runFixtureStory,
} from "./dev-story";
import type { FixtureStorySpec, StoryEvent, StoryRun } from "./dev-story";

/** The reference test-card renderer id (the Original-reality baseline). */
const TESTCARD_RENDERER_ID = "sporta.testcard";

/** Story metadata the watch model exposes (labeled dev-seed). */
export interface SeedStoryMeta {
  source: "dev-seed";
  storyKey: string;
  transcript: readonly {
    startMs: number;
    endMs: number;
    text: string;
    asrConfidence: number;
  }[];
  events: readonly StoryEvent[];
  waveCount: number;
}

/** Inputs to {@link seedDevContent}. */
export interface SeedOptions {
  server: SportaServer;
  /** The engine registry the control app's world-model factory consults. */
  engines: Map<string, WorldModelEngineInstance>;
  /** The story metadata index the watch model reads. */
  storyIndex: Map<string, SeedStoryMeta>;
  entropy: EntropySource;
}

/** One seeded session: which story, which renders to run. */
interface SeedPlan {
  story: FixtureStorySpec;
  label: string;
  /** Render with the reference test-card renderer (the Original baseline). */
  testcard: boolean;
  /** Render with the anime plugin AND store the encoded clip output. */
  anime: boolean;
}

/** The seed plan — three sessions covering every real product state. */
const SEED_PLAN: readonly SeedPlan[] = [
  {
    story: DERBY_STORY,
    label: "Derby night at Kings Park — fixture story A",
    testcard: true,
    anime: true,
  },
  {
    story: FRIENDLY_STORY,
    label: "Friendly under the lights — fixture story B",
    testcard: true,
    anime: false,
  },
  {
    story: TRAINING_STORY,
    label: "Training ground — fixture story C",
    testcard: false,
    anime: true,
  },
];

/** The dev-seed account (roles: the creator + viewer baseline). */
const SEED_ACCOUNT_USERNAME = "sporta-dev-seed";

/**
 * Runs the dev seed. Every session is created through the REAL gate, every
 * render through the REAL control plane, every stored output through the REAL
 * pipeline. Returns the seed's summary (also used by tests).
 */
export async function seedDevContent(options: SeedOptions): Promise<{
  seedAccountUsername: string;
  sessions: {
    sessionId: string;
    storyKey: string;
    renderIds: string[];
    storedSegmentIds: string[];
  }[];
}> {
  const { server, engines, storyIndex, entropy } = options;

  // 1. The labeled platform seed account — created through the real store
  //    with a real hashed password drawn from real entropy and discarded.
  //    W911: with the Neon-backed account store the username PERSISTS, so a
  //    later cold start re-seeding the same deployment reuses the existing
  //    row (its password is random each run and never signable-into anyway —
  //    the dev content stays owned by the platform's seed account).
  let seedAccount: Account;
  try {
    seedAccount = await server.auth.createSeedAccount({
      username: SEED_ACCOUNT_USERNAME,
      password: drawSeedPassword(entropy),
      roles: ["creator", "viewer"],
    });
  } catch (err) {
    if (!(err instanceof AccountConflictError)) throw err;
    const existing = await server.accounts.findByUsername(SEED_ACCOUNT_USERNAME);
    if (existing === null) throw err;
    seedAccount = existing;
  }

  // 2. A session token for the gate (the seed acts as its verified identity).
  const login = await server.auth.issueSession({ userId: seedAccount.userId });

  const summary: {
    sessionId: string;
    storyKey: string;
    renderIds: string[];
    storedSegmentIds: string[];
  }[] = [];

  for (const plan of SEED_PLAN) {
    // 2a. Create the media session through the REAL identity gate — the
    //     policy is identity-attested (assertedBy = the seed account) and
    //     ownership is recorded.
    const policy = SEED_POLICIES[plan.story.key as keyof typeof SEED_POLICIES];
    const created = (await server.gate.createMediaSession(login.token, {
      authorizationPolicy: policy,
      sourceLabel: plan.label,
    })) as { session: { sessionId: string } };
    const sessionId = created.session.sessionId;

    // 2b. Run the story through the REAL chain and register the fused engine
    //     BEFORE any render (the control plane's factory picks it up).
    const run: StoryRun = runFixtureStory(sessionId, plan.story, server.nowMs);
    engines.set(sessionId, run.engine);

    // 2c. The renders — every one through the REAL control plane.
    const renderIds: string[] = [];
    let animeRenderId: string | null = null;
    if (plan.testcard) {
      const render = await server.control.createRender(sessionId, {
        rendererId: TESTCARD_RENDERER_ID,
      });
      renderIds.push(render.renderId);
    }
    if (plan.anime) {
      const render = await server.control.createRender(sessionId, {
        rendererId: ANIME_RENDERER_ID,
      });
      renderIds.push(render.renderId);
      animeRenderId = render.renderId;
    }

    // 2d. The stored output — the host-side clip render (the documented W504
    //     wiring: the clip-path output is stored under the control plane's
    //     render id) encoded + stored through the REAL pipeline.
    const storedSegmentIds: string[] = [];
    if (plan.anime && animeRenderId !== null) {
      // The host-side clip request carries the REAL derived capabilities of
      // the session's (identity-attested) policy — never invented.
      const rightsCapabilities = deriveRightsCapabilities(policy, new Date(server.nowMs()));
      const clip: AnimeRenderOutput = renderAnimeClip(
        {
          sessionId,
          schemaVersion: SCHEMA_VERSION,
          rendererId: ANIME_RENDERER_ID,
          rendererVersion: ANIME_RENDERER_VERSION,
          styleConfig: {
            styleId: `dev-seed-${plan.story.key}`,
            configSchemaVersion: "1.0",
            config: {},
          },
          snapshotVersion: run.engine.snapshotVersion,
          eventsSinceSequence: run.engine.snapshot().watermark.sequence,
          outputProfile: ANIME_OUTPUT_PROFILE,
          rightsCapabilities,
          sourceFrameRefs: [],
        },
        run.steps,
      );
      const stored = server.pipeline.encodeAndStore({
        sessionId,
        renderId: animeRenderId,
        output: clip,
      });
      storedSegmentIds.push(stored.segmentId);
    }

    // 2e. Record the story metadata the watch model exposes (labeled).
    storyIndex.set(sessionId, {
      source: "dev-seed",
      storyKey: plan.story.key,
      transcript: run.transcript,
      events: run.events,
      waveCount: run.waveCount,
    });

    // 2f. W915: a session whose policy authorizes LIVE delivery is
    //     registered as a LIVE SOURCE — its real story timeline (the
    //     per-wave engine outputs) + its identity-attested policy become
    //     the SSE transport's inputs. The transport itself only serves
    //     while env-active (SPORTA_LIVE_TRANSPORT=sse); the registration
    //     is data, the serving is state.
    const liveRights = deriveRightsCapabilities(policy, new Date(server.nowMs()));
    if (liveRights.canDeliverLive) {
      server.live.registerSource({
        sessionId,
        label: plan.label,
        storyKey: plan.story.key,
        steps: run.steps,
        policy,
        snapshotVersion: run.engine.snapshotVersion,
        watermarkSequence: run.engine.snapshot().watermark.sequence,
      });
    }

    summary.push({ sessionId, storyKey: plan.story.key, renderIds, storedSegmentIds });
  }

  return { seedAccountUsername: SEED_ACCOUNT_USERNAME, sessions: summary };
}
