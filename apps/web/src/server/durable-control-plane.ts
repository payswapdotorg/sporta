/**
 * THE DURABLE CONTROL PLANE (W921) — the composition wiring that makes
 * user-created media sessions (and their renders, publication state and
 * derived product state) correct across serverless instances.
 *
 * THE DEFECT (TL-verified on the live deployment, S300-w920-gate-1): the
 * control plane's media-session/render state is IN-MEMORY PER COMPOSITION —
 * on Vercel's multiple warm instances a studio-created session exists only
 * on the instance that handled the create (other instances 404
 * unknown-session), and the `sess-<seq>` allocation collides across
 * instances. Identity was already Neon-durable (W911) and artifacts
 * R2-durable (W912); this layer carries the remaining control-plane records
 * (Neon, the frozen deployment-architecture placement) via the
 * {@link ControlPlaneRecordStore} port.
 *
 * DESIGN (flight 8, audited; deviations from the order's sketch are
 * documented in DEPLOYMENT.md §8):
 *
 * - WRITE-THROUGH at the real seams, fail-loud: the studio records each
 *   created session (id/owner/source/rights/visibility/createdAt — the
 *   record's createdAt comes from the control plane's own create answer,
 *   never the studio clock), each render observed through the studio's
 *   dispatch/poll path (render id + result document + stored segment ids +
 *   the DISPATCH RECIPE — renderer version/style/profile — reconstruction
 *   needs it verbatim), and every publication flip (studio + rights
 *   center). A configured store that rejects a write-through fails the
 *   request — never a silently undurable session.
 *
 * - READ-RECONSTRUCTION on instance miss: when a session-scoped read misses
 *   in-process, the durable record is loaded and the session is REPLAYED
 *   through the REAL seams — `createSession` with the recorded id, rights
 *   declaration, label and RECORDED creation time (the additive control-api
 *   seam), the deterministic fixture story re-run (the same engine/story
 *   data the creating instance produced — fixture-time-based content, the
 *   W912-mirror-proven determinism), the publication flag and attestation
 *   re-seeded, and the stored outputs RE-MATERIALIZED through the REAL
 *   renderer's detailed surface + the REAL W504 encoder + the REAL pipeline
 *   store under the RECORDED render id, mirroring the compute executor's
 *   own RenderRequest construction exactly (minimal rights posture, the
 *   engine's snapshot + event window, the recorded recipe). The
 *   content-addressed segment id is ASSERTED equal to the recorded one —
 *   determinism proven per reconstruction, never trusted. Reconstruction is
 *   once per session per instance (in-flight deduped).
 *
 * - RENDER IDS: the control plane's render-sequence counter is per-instance,
 *   so a through-the-seam replay on another instance cannot re-derive the
 *   creating instance's `r-<seq>` id, and NEW renders dispatched from other
 *   instances could collide with it (the exact W920 defect class, for
 *   renders). The audited design: (1) the studio dispatches every render
 *   with a collision-safe caller-supplied id (`r-u-<hex>` — the flight-8
 *   additive control-api seam); (2) the durable record IS the source of
 *   truth for the render id and the render-result document (served
 *   verbatim) — the replay restores the SAME ids, never presented as new
 *   work; (3) the decorated `listRenders` merges the in-process registry
 *   with the record (deduped by id), and `getRender` falls through to the
 *   record only on the raw app's typed unknown-render miss.
 *
 * - RECONSTRUCTION FAILURES ARE HONEST: a drift between the re-encoded
 *   segment id and the recorded one, an unknown source key, or a store
 *   failure propagates — the real reason, never stale or invented state.
 *   The one carved-out class: a session whose recorded policy has EXPIRED
 *   (or otherwise derives no capability) cannot be recreated — the control
 *   plane's fail-closed admission refuses it — so `listSessions` SKIPS it
 *   (counted, {@link reconstructionSkips}) the same way the catalog skips
 *   terminated sessions, while direct session reads answer the honest
 *   rights-denied error with the real reason.
 *
 * HONEST BOUNDARIES (documented in DEPLOYMENT.md §8): the compute ledger's
 * job records (live/terminal job projections, the studio's job index) stay
 * per-instance — a reconstructed session's studio job list is empty on the
 * reconstructing instance (never invented); W917 rights-holder policy
 * EDITS/revocations (overrides on top of the creation-time record) stay
 * per-instance; the dev-seed sessions (sess-1/2/3) are NOT recorded (they
 * are deterministically re-created per boot by the seed itself — the
 * unrecorded legacy `sess-<seq>` namespace).
 */
import {
  ControlRightsDeniedError,
  ControlUnknownRenderError,
  ControlUnknownSessionError,
} from "@sporta/control-api";
import type {
  ControlApp,
  RenderEnvelope,
  RenderSummary,
} from "@sporta/control-api";
import { SCHEMA_VERSION, deriveRightsCapabilities } from "@sporta/contracts";
import type { RenderRequest, WorldSnapshot } from "@sporta/contracts";
import { encodeAnimeClip } from "@sporta/output-pipeline";
import type { AnimeOutputPipeline } from "@sporta/output-pipeline";
import type { RendererRegistry, RendererPlugin } from "@sporta/renderer-contract";
import type { WorldModelEngine as WorldModelEngineInstance } from "@sporta/world-model";
import type {
  ControlPlaneRecordStore,
  ControlRenderRecipe,
  ControlRenderRecord,
  ControlSessionRecord,
  ControlVisibilityRecord,
} from "./platform/control/records";
import type { PolicyAttestationIndex, PublicationStore } from "./publication";
import type { SeedStoryMeta } from "./dev-seed";
import { studioSourceSpec } from "./create-studio-service";
import { runFixtureStory } from "./dev-story";
import type { R2RenderOutputStore } from "./platform/r2/r2-store";

/** What the durable layer needs from the composition (all REAL objects). */
export interface DurableControlPlaneOptions {
  /** The rights-governed control app (the layer this decorator fronts). */
  governed: ControlApp;
  /** The durable record store (Neon in production; the hermetic fake in tests). */
  records: ControlPlaneRecordStore;
  /** The renderer registry (plugin resolution for output re-materialization). */
  registry: RendererRegistry;
  /** The composition's engine map (where reconstructed engines land). */
  engines: Map<string, WorldModelEngineInstance>;
  /** The composition's story index (where reconstructed stories land). */
  storyIndex: Map<string, SeedStoryMeta>;
  /** The publication store (reconstructed visibility is seeded here). */
  publication: PublicationStore;
  /** The attestation index (reconstructed attestations are re-recorded). */
  attestations: PolicyAttestationIndex;
  /** The W504 render-output pipeline (re-materialized outputs land here). */
  pipeline: AnimeOutputPipeline;
  /** The hosted R2 artifact store when configured (idempotent mirrors). */
  artifacts: R2RenderOutputStore | null;
  /**
   * The record store's provider name (health surfaces): `"neon"` for the
   * PostgreSQL adapter, `"in-memory"` for the hermetic store. Defaults to
   * `"in-memory"` so the store's own kind is reported honestly — the
   * production singleton passes `"neon"` alongside the pg adapter.
   */
  provider?: "neon" | "in-memory";
  /** Wall clock. */
  nowMs: () => number;
}

/** The durable control-plane surface the composition wires. */
export interface DurableControlPlane {
  /** The decorated control app (the composition's `control`). */
  control: ControlApp;
  /**
   * Ensures a session is live in-process (reconstructing from the record).
   * `false` when the id is neither in-process nor durable — the honest 404.
   */
  ensureSessionLive(sessionId: string): Promise<boolean>;
  /** The studio's session-creation write-through (fail-loud). */
  noteSessionCreated(record: ControlSessionRecord): Promise<void>;
  /** The studio/rights-center publication write-through (fail-loud). */
  noteVisibility(sessionId: string, visibility: ControlVisibilityRecord): Promise<void>;
  /**
   * The render write-through (fail-loud, idempotent per render id). Called
   * from the studio's dispatch/poll path with the DISPATCH RECIPE — the
   * fields reconstruction must replay verbatim.
   */
  noteRenderObserved(
    sessionId: string,
    renderId: string,
    recipe?: ControlRenderRecipe,
  ): Promise<void>;
  /**
   * Counted reconstruction skips of the rights-denied class (a recorded
   * policy that has expired / derives no capability cannot be recreated —
   * the control plane's fail-closed admission). Observable for the honest
   * degraded-listing note; every other failure propagates.
   */
  reconstructionSkips(): number;
  /**
   * Refreshes the in-process publication flag of one session from its
   * durable record (the source of truth for publication state). A no-op for
   * ids that are not durable (the dev-seed namespace — in-process only).
   * Called by the read seams that gate on publication BEFORE any control
   * read (the watch gate) so a publication flip made on ANOTHER instance is
   * honored by a warm instance that still holds the session in-process.
   */
  syncVisibility(sessionId: string): Promise<void>;
  /** The record store's provider name (health). */
  provider: "neon" | "in-memory";
}

/** The structural W502 detailed-render extension (the executor's own check). */
function hasRenderDetailed(
  plugin: RendererPlugin,
): plugin is RendererPlugin & {
  renderDetailed(
    req: RenderRequest,
    input: { snapshot: WorldSnapshot; events: unknown[] },
  ): { result: RenderEnvelope["result"]; frames: unknown[]; manifest: unknown };
} {
  return typeof (plugin as { renderDetailed?: unknown }).renderDetailed === "function";
}

/**
 * Builds the durable control plane over the governed control app. See the
 * module docs for the write-through / read-reconstruction design and its
 * audited deviations.
 */
export function createDurableControlPlane(
  options: DurableControlPlaneOptions,
): DurableControlPlane {
  const {
    governed,
    records,
    registry,
    engines,
    storyIndex,
    publication,
    attestations,
    pipeline,
    artifacts,
    provider = "in-memory",
    nowMs,
  } = options;

  // Per-instance memos (positives only — a negative can become positive when
  // another instance creates the id later, so misses are always re-checked).
  const durableSessions = new Set<string>();
  const recordedRenders = new Set<string>();
  const reconstructionsInFlight = new Map<string, Promise<boolean>>();
  const initedPlugins = new WeakSet<RendererPlugin>();
  let reconstructionSkipCount = 0;

  // -----------------------------------------------------------------------
  // Reconstruction (deterministic replay through the REAL seams)
  // -----------------------------------------------------------------------

  /** Seeds the in-process publication store from a recorded decision. */
  function seedVisibility(sessionId: string, visibility: ControlVisibilityRecord): void {
    publication.set(sessionId, {
      kind: visibility.kind,
      ...(visibility.roles.length > 0 ? { roles: [...visibility.roles] } : {}),
    });
  }
  /**
   * Re-materializes one render's stored outputs through the REAL renderer
   * detailed surface + the REAL W504 encoder + the REAL pipeline store,
   * under the RECORDED render id — mirroring the compute executor's own
   * RenderRequest construction (the minimal rights posture, the replayed
   * engine's snapshot + event window, the recorded recipe) and ASSERTING
   * the content-addressed segment id equals the recorded one (determinism
   * proven, never trusted). Renders the current registry can no longer
   * resolve, or that recorded no stored outputs, are served from their
   * record with outputs honestly absent.
   */
  async function rematerializeOutputs(
    record: ControlRenderRecord,
    engine: WorldModelEngineInstance,
    canReferenceSourceFrames: boolean,
  ): Promise<void> {
    const storedSegmentIds = record.storedSegmentIds ?? [];
    if (storedSegmentIds.length === 0) return; // nothing was stored originally
    if (storedSegmentIds.length > 1) {
      // The W504 clip path encodes ONE segment per render; a multi-segment
      // record cannot be faithfully re-materialized — loud, never partial.
      throw new Error(
        `durable control plane: session '${record.sessionId}' render '${record.renderId}' ` +
          `records ${storedSegmentIds.length} stored segments; reconstruction supports exactly one`,
      );
    }
    const plugin = registry.resolve(record.rendererId, record.recipe.rendererVersion);
    if (!initedPlugins.has(plugin)) {
      await plugin.init();
      initedPlugins.add(plugin);
    }
    if (!hasRenderDetailed(plugin)) return; // not encodable — honest no-outputs
    const capability = plugin.capability();

    // The request mirrors the compute executor's construction: the recorded
    // recipe (style + profile) over the replayed engine's snapshot, with the
    // executor's MINIMAL rights posture (the job carried
    // canReferenceSourceFrames only — not the session's full capabilities).
    const snapshot = engine.snapshot();
    const events = engine.eventsSince(snapshot.watermark.sequence);
    const request: RenderRequest = {
      sessionId: record.sessionId,
      schemaVersion: SCHEMA_VERSION,
      rendererId: capability.rendererId,
      rendererVersion: capability.rendererVersion,
      styleConfig: {
        styleId: record.recipe.styleConfig?.styleId ?? "default",
        configSchemaVersion: SCHEMA_VERSION,
        config: record.recipe.styleConfig?.config ?? {},
      },
      snapshotVersion: engine.snapshotVersion,
      eventsSinceSequence: snapshot.watermark.sequence,
      outputProfile:
        (record.recipe.outputProfile as RenderRequest["outputProfile"] | undefined) ??
        capability.supportedOutputProfiles[0]!,
      rightsCapabilities: {
        canReferenceSourceFrames,
        canDeliverLive: false,
        canStoreDerivatives: false,
        canShare: false,
      },
      sourceFrameRefs: [],
    };
    const validation = plugin.validateRequest(request);
    if (!validation.ok) {
      throw new Error(
        `durable control plane: reconstruction render request rejected for session ` +
          `'${record.sessionId}' render '${record.renderId}': ${validation.reason}`,
      );
    }
    const detailed = plugin.renderDetailed(request, { snapshot, events });
    // The seed's own mirror posture: the deterministic encoder (the exact
    // function `encodeAndStore` uses) proves the segment id BEFORE storing.
    const encoded = encodeAnimeClip({
      result: detailed.result,
      frames: detailed.frames as never,
      manifest: detailed.manifest as never,
    });
    if (encoded.segmentId !== storedSegmentIds[0]) {
      // Determinism violation: the replay produced different bytes than the
      // recorded segment id promises. Loud, never served.
      throw new Error(
        `durable control plane: reconstruction segment id drift for session ` +
          `'${record.sessionId}' render '${record.renderId}' ` +
          `(re-encoded '${encoded.segmentId}' != recorded '${storedSegmentIds[0]}')`,
      );
    }
    pipeline.encodeAndStore({
      sessionId: record.sessionId,
      renderId: record.renderId,
      output: {
        result: detailed.result,
        frames: detailed.frames as never,
        manifest: detailed.manifest as never,
      },
    });
    if (artifacts !== null) {
      // The W912 mirror posture: content-addressed + idempotent (same content
      // = counted duplicate); fail-closed on a configured-but-rejecting R2.
      await artifacts.storeSegment({
        sessionId: record.sessionId,
        renderId: record.renderId,
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

  /**
   * Reconstructs one durable session in-process: `createSession` through the
   * REAL (rights-governed) control plane with the recorded id, policy, label
   * and RECORDED creation time; the deterministic fixture story re-run (the
   * same engine/story data the creating instance produced); the recorded
   * publication decision and attestation re-seeded; each recorded render's
   * outputs re-materialized under the recorded ids. A reconstruction failure
   * propagates — the honest error, never stale or invented state.
   */
  async function reconstruct(record: ControlSessionRecord): Promise<boolean> {
    const spec = studioSourceSpec(record.sourceKey);
    if (spec === null) {
      throw new Error(
        `durable control plane: session '${record.sessionId}' records unknown source key ` +
          `'${record.sourceKey}' (cannot reconstruct)`,
      );
    }
    // 1. The REAL session creation, with the recorded id + RECORDED createdAt
    //    (the additive control-api seam). The rights-governed wrapper records
    //    the creation-time policy on the way through (the W917 record).
    await governed.createSession({
      authorizationPolicy: record.rightsDeclaration,
      sourceLabel: record.label,
      sessionId: record.sessionId,
      createdAtIso: record.createdAtIso,
    });
    // 2. The deterministic story replay — the same engine + story metadata
    //    the creating instance registered (registered BEFORE any render).
    //    The fixture story's content is fixture-time-based (the W912-mirror
    //    determinism proof: re-runs across boots/clocks re-mirror the same
    //    content-addressed ids).
    const run = runFixtureStory(record.sessionId, spec, nowMs);
    engines.set(record.sessionId, run.engine);
    storyIndex.set(record.sessionId, {
      source: "dev-seed",
      storyKey: record.sourceKey,
      transcript: run.transcript,
      events: run.events,
      waveCount: run.waveCount,
    });
    // 3. The recorded publication decision + attestation (in-process stores
    //    re-seeded from the record — the W916 visibility is the record's).
    seedVisibility(record.sessionId, record.visibility);
    attestations.record(record.sessionId, record.ownerUserId);
    // 4. The renders: results served from the record (the decorator's
    //    fall-through); outputs re-materialized under the recorded ids with
    //    the executor's own rights posture.
    const renders = await records.findRenders(record.sessionId);
    for (const render of renders) {
      await rematerializeOutputs(render, run.engine, canReferenceSourceFramesOf(record));
    }
    durableSessions.add(record.sessionId);
    return true;
  }

  /** The recorded policy's dispatch-time source-frames posture (the executor's input). */
  function canReferenceSourceFramesOf(record: ControlSessionRecord): boolean {
    // The control plane derives the dispatch posture from the stored policy
    // (createRenderAsyncImpl); re-derive it from the RECORDED declaration.
    return deriveRightsCapabilities(record.rightsDeclaration, new Date(nowMs()))
      .canReferenceSourceFrames;
  }

  /** Ensures a session is live in-process; `false` when no durable record. */
  async function ensureSessionLive(sessionId: string): Promise<boolean> {
    try {
      await governed.getSession(sessionId);
      return true; // already live (the fast path — no store read)
    } catch (err) {
      if (!(err instanceof ControlUnknownSessionError)) throw err;
    }
    const existing = reconstructionsInFlight.get(sessionId);
    if (existing !== undefined) return existing;
    const attempt = (async () => {
      const record = await records.findSession(sessionId);
      if (record === null) return false; // not durable either — the honest 404
      return reconstruct(record);
    })();
    reconstructionsInFlight.set(sessionId, attempt);
    try {
      return await attempt;
    } finally {
      reconstructionsInFlight.delete(sessionId);
    }
  }

  /**
   * Refreshes the in-process publication flag from the record (see the
   * interface docs): the honest cost is ONE primary-key record read on the
   * durable path, a no-op for the unrecorded dev-seed namespace.
   */
  async function syncVisibility(sessionId: string): Promise<void> {
    const record = await records.findSession(sessionId);
    if (record === null) return; // not durable — the in-process flag stands
    seedVisibility(sessionId, record.visibility);
  }

  // -----------------------------------------------------------------------
  // Write-through (the studio / rights-center seams)
  // -----------------------------------------------------------------------

  async function noteSessionCreated(record: ControlSessionRecord): Promise<void> {
    await records.upsertSession(record);
    durableSessions.add(record.sessionId);
  }

  async function noteVisibility(
    sessionId: string,
    visibility: ControlVisibilityRecord,
  ): Promise<void> {
    if (!durableSessions.has(sessionId)) {
      const record = await records.findSession(sessionId);
      if (record === null) return; // not a durable session — in-process only
      durableSessions.add(sessionId);
    }
    await records.setVisibility(sessionId, visibility);
  }

  async function noteRenderObserved(
    sessionId: string,
    renderId: string,
    recipe?: ControlRenderRecipe,
  ): Promise<void> {
    if (recordedRenders.has(renderId)) return; // already recorded (counted)
    if (!durableSessions.has(sessionId)) {
      const record = await records.findSession(sessionId);
      if (record === null) return; // not a durable session — in-process only
      durableSessions.add(sessionId);
    }
    // The render envelope from the in-process control plane (this is the
    // creating/reconstructing instance's live truth).
    const envelope = await governed.getRender(sessionId, renderId);
    const outputs = await governed.listRenderOutputs(sessionId, renderId);
    const existing = await records.findRenders(sessionId);
    if (existing.some((entry) => entry.renderId === renderId)) {
      recordedRenders.add(renderId);
      return; // counted duplicate — never a second row
    }
    await records.recordRender({
      sessionId,
      renderOrdinal: existing.length + 1,
      renderId,
      rendererId: envelope.result.rendererId,
      recipe: recipe ?? {},
      result: envelope.result,
      storedSegmentIds: outputs.segments.map((segment) => segment.segmentId),
      createdAtMs: nowMs(),
    });
    recordedRenders.add(renderId);
  }

  // -----------------------------------------------------------------------
  // The decorated control app
  // -----------------------------------------------------------------------

  /** One recorded render as a summary (the decorator's merge shape). */
  function summaryOf(record: ControlRenderRecord): RenderSummary {
    return {
      renderId: record.renderId,
      rendererId: record.rendererId,
      segmentCount: record.result.outputSegments.length,
      provenance: structuredClone(record.result.provenance),
      watermarkAfter: structuredClone(record.result.watermarkAfter),
    };
  }

  const control: ControlApp = {
    observability: governed.observability,

    async createSession(input, ctx) {
      // Pass-through: the studio (the only creator of durable sessions)
      // performs its own write-through with the fields the control plane
      // never sees (owner, source key).
      return governed.createSession(input, ctx);
    },

    async getSession(sessionId, ctx) {
      const live = await ensureSessionLive(sessionId);
      if (!live) throw new ControlUnknownSessionError(sessionId);
      return governed.getSession(sessionId, ctx);
    },

    async listSessions(ctx) {
      // Seeded (in-process) ∪ durable: every durable record is ensured live
      // (reconstructed once per instance) so the raw registry then lists it
      // natively, and its RECORDED publication decision is re-seeded (the
      // record is the source of truth for publication state — a flip made on
      // another instance is honored here, warm instance or cold). A recorded
      // policy that has expired / derives no capability cannot be recreated
      // (the control plane's fail-closed admission) — that session is SKIPPED
      // and counted, exactly like the catalog's terminated-session skip.
      // Every other failure propagates (the honest 500 with the real reason).
      const durable = await records.listSessions();
      for (const record of durable) {
        try {
          await ensureSessionLive(record.sessionId);
          seedVisibility(record.sessionId, record.visibility);
        } catch (err) {
          if (err instanceof ControlRightsDeniedError) {
            reconstructionSkipCount += 1;
            continue;
          }
          throw err;
        }
      }
      return governed.listSessions(ctx);
    },

    async terminateSession(sessionId, ctx) {
      return governed.terminateSession(sessionId, ctx);
    },

    async listRenderers(ctx) {
      return governed.listRenderers(ctx);
    },

    async createRender(sessionId, input, ctx) {
      // Reconstruct first (the unknown-session 404 stays uniform), then the
      // real dispatch, then the write-through with the dispatch recipe.
      const live = await ensureSessionLive(sessionId);
      if (!live) throw new ControlUnknownSessionError(sessionId);
      const envelope = await governed.createRender(sessionId, input, ctx);
      await noteRenderObserved(sessionId, envelope.renderId, recipeOfInput(input));
      return envelope;
    },

    async getRender(sessionId, renderId, ctx) {
      // Ensure-live FIRST: a cold session must reconstruct before the raw
      // app's unknown-session 404 can escape (the raw ordering — existence
      // before render revelation — is preserved; the rights gate still runs
      // inside the governed call for every read).
      const live = await ensureSessionLive(sessionId);
      if (!live) throw new ControlUnknownSessionError(sessionId);
      try {
        return await governed.getRender(sessionId, renderId, ctx);
      } catch (err) {
        if (!(err instanceof ControlUnknownRenderError)) throw err;
      }
      const recorded = (await records.findRenders(sessionId)).find(
        (entry) => entry.renderId === renderId,
      );
      if (recorded === undefined) throw new ControlUnknownRenderError(sessionId, renderId);
      return {
        renderId: recorded.renderId,
        result: structuredClone(recorded.result),
      };
    },

    async listRenders(sessionId, ctx) {
      const live = await ensureSessionLive(sessionId);
      if (!live) throw new ControlUnknownSessionError(sessionId);
      const raw = await governed.listRenders(sessionId, ctx);
      const recorded = await records.findRenders(sessionId);
      const rawIds = new Set(raw.renders.map((render) => render.renderId));
      const merged: RenderSummary[] = [
        ...raw.renders,
        ...recorded.filter((entry) => !rawIds.has(entry.renderId)).map(summaryOf),
      ];
      return { renders: merged };
    },

    async getRenderOutput(sessionId, renderId, segmentId, ctx) {
      const live = await ensureSessionLive(sessionId);
      if (!live) throw new ControlUnknownSessionError(sessionId);
      return governed.getRenderOutput(sessionId, renderId, segmentId, ctx);
    },

    async listRenderOutputs(sessionId, renderId, ctx) {
      const live = await ensureSessionLive(sessionId);
      if (!live) throw new ControlUnknownSessionError(sessionId);
      return governed.listRenderOutputs(sessionId, renderId, ctx);
    },

    async createRenderAsync(sessionId, input, ctx) {
      // Ensure-live first (a render for a cold durable session reconstructs
      // it), then the real dispatch, then the write-through when the dispatch
      // answer already carries the ingested render id (the duplicate path);
      // the studio's poll observes the admitted path's ingest.
      const live = await ensureSessionLive(sessionId);
      if (!live) throw new ControlUnknownSessionError(sessionId);
      const dispatch = await governed.createRenderAsync(sessionId, input, ctx);
      if (dispatch.renderId !== undefined) {
        await noteRenderObserved(sessionId, dispatch.renderId, recipeOfInput(input));
      }
      return dispatch;
    },

    async getComputeJob(sessionId, jobId, ctx) {
      return governed.getComputeJob(sessionId, jobId, ctx);
    },
  };

  return {
    control,
    ensureSessionLive,
    noteSessionCreated,
    noteVisibility,
    noteRenderObserved,
    reconstructionSkips: () => reconstructionSkipCount,
    syncVisibility,
    provider,
  };
}

/** The dispatch recipe of a createRender/createRenderAsync input (audit shape). */
function recipeOfInput(input: unknown): ControlRenderRecipe {
  if (typeof input !== "object" || input === null) return {};
  const value = input as {
    rendererVersion?: unknown;
    styleConfig?: { styleId?: unknown; config?: unknown };
    outputProfile?: unknown;
  };
  return {
    ...(typeof value.rendererVersion === "string" ? { rendererVersion: value.rendererVersion } : {}),
    ...(value.styleConfig !== undefined
      ? {
          styleConfig: {
            ...(typeof value.styleConfig.styleId === "string"
              ? { styleId: value.styleConfig.styleId }
              : {}),
            ...(value.styleConfig.config !== undefined ? { config: value.styleConfig.config } : {}),
          },
        }
      : {}),
    ...(value.outputProfile !== undefined ? { outputProfile: value.outputProfile } : {}),
  };
}
