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
import type { AuthorizationPolicy } from "@sporta/contracts";
import type { LiveScenarioKind } from "@sporta/live-source";
import { encodeAnimeClip } from "@sporta/output-pipeline";
import {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  renderAnimeClip,
} from "@sporta/renderer-anime";
import type { AnimeRenderOutput } from "@sporta/renderer-anime";
import { AccountConflictError } from "@sporta/identity";
import type { Account, EntropySource } from "@sporta/identity";
import type { Role } from "@sporta/capability";
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

/** The dev-seed account (roles: the full grant set — see SEED_ACCOUNT_ROLES). */
const SEED_ACCOUNT_USERNAME = "sporta-dev-seed";

/**
 * The dev-seed account's grants (W907): the full five-role set, granted
 * through the REAL store — the platform's own content owner may hold every
 * workspace. Roles are grants, never authority: each action is still decided
 * per request by the identity policy (the seed creates with its creator
 * grant, reads its sessions as their owner, and would pass operator checks
 * only because it holds the operator grant).
 */
const SEED_ACCOUNT_ROLES: readonly Role[] = [
  "viewer",
  "creator",
  "analyst",
  "rights-holder",
  "operator",
];

/** The W907 multi-role demo account — ONE identity, all five workspaces. */
const DEMO_ACCOUNT_USERNAME = "sporta-demo";

/**
 * The demo account's sign-in path. By default the password is drawn from
 * REAL entropy and discarded — the account exists (its grants are real
 * store records) but is NOT signable-into. When an operator consciously
 * sets `SPORTA_DEMO_ACCOUNT_PASSWORD` (local testing / a labeled dev
 * preview), that exact password is used instead — the operator-granted
 * provisioning path the W906 audit identified: operators are minted via
 * the store, never self-registration.
 */
function demoPassword(entropy: EntropySource): string {
  const configured = process.env.SPORTA_DEMO_ACCOUNT_PASSWORD;
  if (configured !== undefined && configured.length >= 10) return configured;
  return drawSeedPassword(entropy);
}

/** Creates (or re-grants) a seeded account with EXACTLY the given roles. */
async function ensureSeededAccount(
  server: SportaServer,
  username: string,
  password: string,
  roles: readonly Role[],
): Promise<Account> {
  try {
    return await server.auth.createSeedAccount({ username, password, roles });
  } catch (err) {
    if (!(err instanceof AccountConflictError)) throw err;
    const existing = await server.accounts.findByUsername(username);
    if (existing === null) throw err;
    // A persisted re-seed (W911) reconciles the grants through the REAL
    // store's update path — grants may change, the credentials never do.
    const wanted = [...new Set(roles)].sort().join(",");
    const current = [...new Set(existing.roles)].sort().join(",");
    if (wanted !== current) {
      await server.accounts.update({ ...existing, roles: [...new Set(roles)] });
      return { ...existing, roles: [...new Set(roles)] };
    }
    return existing;
  }
}

/**
 * Runs the dev seed. Every session is created through the REAL gate, every
 * render through the REAL control plane, every stored output through the REAL
 * pipeline. Returns the seed's summary (also used by tests).
 */
export async function seedDevContent(options: SeedOptions): Promise<{
  seedAccountUsername: string;
  demoAccountUsername: string;
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
  //    the dev content stays owned by the platform's seed account). W907:
  //    the seed account holds the FULL grant set (see SEED_ACCOUNT_ROLES),
  //    reconciled through the store's update path on re-seed.
  const seedAccount = await ensureSeededAccount(
    server,
    SEED_ACCOUNT_USERNAME,
    drawSeedPassword(entropy),
    SEED_ACCOUNT_ROLES,
  );

  // 1b. The W907 multi-role demo account — ONE identity holding all five
  //     grants (the role workspaces are coherent and switchable from it),
  //     minted through the REAL store. Not signable-into unless an operator
  //     consciously sets SPORTA_DEMO_ACCOUNT_PASSWORD (see demoPassword).
  await ensureSeededAccount(
    server,
    DEMO_ACCOUNT_USERNAME,
    demoPassword(entropy),
    SEED_ACCOUNT_ROLES,
  );

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

    // W916: the gate attests the policy as the VERIFIED seed account —
    // record that attestation (the rights-holder policy scope's data).
    server.attestations.record(sessionId, seedAccount.userId);

    // The seeded sessions are the platform's PUBLIC preview content — the
    // publication flag is explicit (the store's default is public too, but
    // the seed says so rather than implying it).
    server.publication.set(sessionId, "public");

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

      // 2d-2 (W912): MIRROR the stored output into the hosted R2 artifact
      // store when one is configured. Fail-closed by design — a deployment
      // that configures R2 must actually get its artifacts persisted there;
      // a mirror that silently no-ops (or silently swallows R2 failures)
      // would make health lie. The store is idempotent (same content =
      // COUNTED duplicate), so a cold-start re-seed is safe.
      //
      // The mirror re-runs the pipeline's OWN deterministic encoder
      // (`encodeAnimeClip` — the exact function `encodeAndStore` uses) instead
      // of reading the segment back through the rights-gated retrieval: the
      // training story's policy deliberately denies derivative STORAGE, so a
      // playback-gated read of its output denies (the honest W905 reality);
      // the WRITE side (like the pipeline's own `storeSegment`) carries no
      // rights gate. Deterministic encode ⇒ same segment id + hash as the
      // pipeline's stored record (asserted, not trusted).
      if (server.artifacts !== null) {
        const encoded = encodeAnimeClip(clip);
        if (encoded.segmentId !== stored.segmentId) {
          // Unreachable barring a pipeline-contract violation — loud, never
          // an in-memory-only deployment pretending R2 persistence.
          throw new Error(
            `dev seed mirror: encoder/pipeline segment id drift (` +
              `${encoded.segmentId} != ${stored.segmentId})`,
          );
        }
        await server.artifacts.storeSegment({
          sessionId,
          renderId: animeRenderId,
          segment: {
            segmentId: encoded.segmentId,
            contentType: encoded.contentType,
            content: encoded.content,
            byteLength: encoded.byteLength,
            contentHash: encoded.contentHash,
            manifest: encoded.manifest,
          },
        });
      }
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

  // 3. L005 (full) — the LIVE TACTICAL sessions: real control-plane
  //     sessions whose live-authorized policies carry the L002 deterministic
  //     tracking source as their LIVE sources. The registration is the
  //     transport's producer-seam re-point (the tactical view-model instead
  //     of a story timeline) — honestly labeled: SYNTHETIC deterministic
  //     tracking data, never a real broadcast. ONE session per L002 delivery
  //     scenario (normal / jitter / delay / drop / out-of-order / reconnect)
  //     so the full L005 surface shows every honest delivery behavior —
  //     replayable, deterministic, selectable on the Live page.
  const LIVE_SCENARIO_SEEDS: ReadonlyArray<{
    scenario: LiveScenarioKind;
    label: string;
    note: string;
  }> = [
    {
      scenario: "normal",
      label: "Synthetic live tracking — normal delivery",
      note: "every tick delivered in order at the base latency",
    },
    {
      scenario: "jitter",
      label: "Synthetic live tracking — jitter",
      note: "irregular inter-arrival (bounded sender jitter, order preserved)",
    },
    {
      scenario: "delay",
      label: "Synthetic live tracking — delay window",
      note: "a contiguous late-arrival window (watermark lag grows, then catches up)",
    },
    {
      scenario: "drop",
      label: "Synthetic live tracking — scattered drops",
      note: "seeded per-tick drops (visible sequence gaps, counted, never smoothed)",
    },
    {
      scenario: "out-of-order",
      label: "Synthetic live tracking — out-of-order",
      note: "bounded adjacent swaps (reorder depth one — the reorder-window stress)",
    },
    {
      scenario: "reconnect",
      label: "Synthetic live tracking — reconnect",
      note: "one dropout window then reconnect (recovery accounting + degraded quality)",
    },
  ];
  const liveTacticalPolicy: AuthorizationPolicy = {
    policyId: "policy-dev-seed-live-tactical",
    allowedOperations: [
      "analysis",
      "transformation",
      "liveDelivery",
      "derivativeGeneration",
      "storage",
    ],
    assertedBy: "dev-seed",
    sharingScope: "operator-authorized",
  };
  for (const scenarioSeed of LIVE_SCENARIO_SEEDS) {
    const created = await server.gate.createMediaSession(login.token, {
      authorizationPolicy: liveTacticalPolicy,
      sourceLabel: `Synthetic live tracking — ${scenarioSeed.scenario} (L002 source)`,
    });
    const scenarioSessionId = (created as { session: { sessionId: string } }).session.sessionId;
    server.attestations.record(scenarioSessionId, seedAccount.userId);
    server.publication.set(scenarioSessionId, "public");
    // The story metadata the card/catalog model exposes (labeled): the
    // tactical session is dev-seed content whose "story" is the live
    // synthetic tracking window itself (no stored transcript/events).
    storyIndex.set(scenarioSessionId, {
      source: "dev-seed",
      storyKey: "live-tactical-synthetic",
      transcript: [],
      events: [],
      waveCount: 0,
    });
    server.live.registerSource({
      sessionId: scenarioSessionId,
      label: scenarioSeed.label,
      storyKey: "live-tactical-synthetic",
      steps: [],
      policy: liveTacticalPolicy,
      snapshotVersion: 0,
      watermarkSequence: 0,
      tactical: {
        config: {
          seed: 20260920,
          scenario: scenarioSeed.scenario,
          tickCount: 600,
          rateMs: 100,
          playersPerTeam: 11,
          referees: 1,
        },
        sourceNote: scenarioSeed.note,
      },
    });
    summary.push({
      sessionId: scenarioSessionId,
      storyKey: "live-tactical-synthetic",
      renderIds: [],
      storedSegmentIds: [],
    });
  }

  // 3b. L014 (presentation side) — the LIVE/REPLAY CONTINUITY session: the
  //     SAME L002 deterministic tracking source, but as a FINITE live
  //     window — the scripted window runs ONCE (24 ticks), the stream ends
  //     with the honest `live-window-complete` close, and the transport
  //     retains the RECORDED world frames. After the window, the SAME
  //     tactical/3D surfaces replay the recorded session state through the
  //     SAME view-model contracts (the replay record route serves the
  //     frames verbatim — world versions/watermarks/timecodes unchanged).
  //     HONEST LABEL: synthetic deterministic tracking (never a real
  //     broadcast), and the record is THIS transport instance's memory —
  //     the durable live-session persistence (the platform side of L014)
  //     is Worker B's lane.
  {
    const created = await server.gate.createMediaSession(login.token, {
      authorizationPolicy: liveTacticalPolicy,
      sourceLabel: "Synthetic live tracking — finite window (L002 source, L014 replay)",
    });
    const replaySessionId = (created as { session: { sessionId: string } }).session.sessionId;
    server.attestations.record(replaySessionId, seedAccount.userId);
    server.publication.set(replaySessionId, "public");
    storyIndex.set(replaySessionId, {
      source: "dev-seed",
      storyKey: "live-tactical-synthetic",
      transcript: [],
      events: [],
      waveCount: 0,
    });
    server.live.registerSource({
      sessionId: replaySessionId,
      label: "Synthetic live tracking — finite window + replay",
      storyKey: "live-tactical-synthetic",
      steps: [],
      policy: liveTacticalPolicy,
      snapshotVersion: 0,
      watermarkSequence: 0,
      tactical: {
        config: {
          seed: 20260921,
          scenario: "normal",
          tickCount: 24,
          rateMs: 100,
          playersPerTeam: 11,
          referees: 1,
        },
        sourceNote:
          "a finite 24-tick live window that ends honestly, then replays through the same views",
        finiteWindow: true,
      },
    });
    summary.push({
      sessionId: replaySessionId,
      storyKey: "live-tactical-synthetic",
      renderIds: [],
      storedSegmentIds: [],
    });
  }

  return {
    seedAccountUsername: SEED_ACCOUNT_USERNAME,
    demoAccountUsername: DEMO_ACCOUNT_USERNAME,
    sessions: summary,
  };
}
