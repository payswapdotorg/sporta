/**
 * THE DURABLE CONTROL PLANE (W921) — the composition wiring that makes
 * user-created media sessions (and their renders, publication state and
 * derived product state) correct across serverless instances.
 *
 * THE DEFECT (TL-verified on the live deployment): the control plane's
 * media-session/render state is IN-MEMORY PER COMPOSITION — on Vercel's
 * multiple warm instances a studio-created session exists only on the
 * instance that handled the create (other instances 404 unknown-session),
 * and the `sess-<seq>` allocation collides across instances. Identity was
 * already Neon-durable (W911) and artifacts R2-durable (W912); this layer
 * carries the remaining control-plane records (Neon, the frozen
 * deployment-architecture placement) via the
 * {@link ControlPlaneRecordStore} port.
 *
 * DESIGN (audited; deviations from the order's sketch are documented in
 * DEPLOYMENT.md §8):
 * - WRITE-THROUGH at the real seams: the studio records each created session
 *   (id/owner/source/rights/visibility/createdAt), each observed render (the
 *   render id + result document + stored segment ids + dispatch recipe), and
 *   every publication flip. Fail-loud: a configured store that rejects a
 *   write-through fails the request — never a silent undurable session.
 * - READ-RECONSTRUCTION on instance miss: when a session-scoped read misses
 *   in-process, the durable record is loaded and the session is REPLAYED
 *   through the REAL seams — `createSession` with the recorded id, rights
 *   declaration, label and RECORDED creation time (the new additive control-api
 *   seam), the deterministic fixture story re-run (the same engine/story data
 *   the dev seed produces), the publication flag and attestation re-seeded,
 *   and the stored outputs RE-MATERIALIZED through the REAL renderer's
 *   detailed surface + the REAL W504 encoder + the REAL pipeline store under
 *   the RECORDED render ids (content-addressed segment ids — asserted equal
 *   to the recorded ones, never trusted). Reconstruction is once per session
 *   per instance (in-flight deduped); its cost is the documented
 *   per-cold-instance-per-session boundary.
 * - RENDER IDS: the control plane's render-sequence counter is per-instance,
 *   so a through-the-seam replay on another instance cannot re-derive the
 *   creating instance's `r-<seq>` id. The AUDITED alternative: the durable
 *   record IS the source of truth for the render id and the render result
 *   document (served verbatim), while the deterministic OUTPUTS are
 *   re-materialized through the real renderer/pipeline seams. The replay
 *   restores the SAME ids — never presented as new work.
 *
 * HONEST BOUNDARIES (documented in DEPLOYMENT.md §8): the compute ledger's
 * job records (live/terminal job projections) stay per-instance — a
 * reconstructed session's studio job index is empty on the reconstructing
 * instance (never invented); W917 rights-holder policy edits (overrides on
 * top of the creation-time record) stay per-instance; the dev-seed sessions
 * (sess-1/2/3) are NOT recorded (deterministic per-boot re-seed, unchanged).
 */
import {
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
  /** The rights-governed control app (the layer the decorator fronts). */
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
  /** The seed's session ids (excluded from render reconciliation — their
   *  namespace is deterministically re-created per boot and stays unrecorded). */
  seedSessionIds: readonly string[];
  /** Wall clock. */
  nowMs: () => number;
}

/** The durable control-plane surface the composition wires. */
export interface DurableControlPlane {
  /** The decorated control app (the composition's `control`). */
  control: ControlApp;
  /** Ensures a session is live in-process (reconstructing from the record). */
  ensureSessionLive(sessionId: string): Promise<boolean>;
  /** The studio's session-creation write-through (fail-loud). */
  noteSessionCreated(record: ControlSessionRecord): Promise<void>;
  /** The studio/rights-center publication write-through (fail-loud). */
  noteVisibility(sessionId: string, visibility: ControlVisibilityRecord): Promise<void>;
  /** The studio's render-observation write-through (fail-loud, idempotent). */
  noteRenderObserved(
    sessionId: string,
    renderId: string,
    recipe?: ControlRenderRecipe,
  ): Promise<void>;
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
  const { governed, records, registry, engines, storyIndex, publication, attestations, pipeline, artifacts, nowMs } =
    options;
  const seedSessionIds = new Set(options.seedSessionIds);

  // Per-instance memos (positives only — a negative can become positive when
  // another instance creates the id later, so misses are always re-checked).
  const durableSessions = new Set<string>();
  const recordedRenders = new Set<string>();
  const reconstructionsInFlight = new Map<string, Promise<boolean>>();

  // -----------------------------------------------------------------------
  // Reconstruction (deterministic replay through the REAL seams)
  // -----------------------------------------------------------------------

  /**
   * Re-materializes one render's stored outputs through the REAL renderer
   * detailed surface + the REAL W504 encoder + the REAL pipeline store, under
   * the RECORDED render id — asserting the content-addressed segment ids are
   * exactly the recorded ones (determinism proven, never trusted). Renders the
   * current registry can no longer resolve are served from their record (the
   * catalog's own honest `renderer-unavailable` state) — outputs for them
   * simply do not re-materialize.
   */
  async function rematerializeOutputs(
    record: ControlRenderRecord,
    engine: WorldModelEngineInstance,
    rightsDeclaration: ControlSessionRecord["rightsDeclaration"],
  ): Promise<void> {
    const storedSegmentIds = record.storedSegmentIds ?? [];
    if (storedSegmentIds.length === 0) return; // nothing was stored originally
    const plugin = registry.resolve(record.rendererId, record.recipe.rendererVersion);
    if (!hasRenderDetailed(plugin)) return; // not encodable — honest no-outputs
    const capability = plugin.capability();

    // The request mirrors the compute worker's construction: the recorded
    // recipe (style + profile) over the replayed engine's snapshot.
    const snapshot = engine.snapshot();
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
      rightsCapabilities: deriveRightsCapabilities(rightsDeclaration, new Date(nowMs())),
      sourceFrameRefs: [],
    };
    const detailed = plugin.renderDetailed(request, { snapshot, events: [] });
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
    pipeline.segmentStore.storeSegment({
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
    publication.set(record.sessionId, {
      kind: record.visibility.kind,
      ...(record.visibility.roles.length > 0 ? { roles: [...record.visibility.roles] } : {}),
    });
    attestations.record(record.sessionId, record.ownerUserId);
    // 4. The renders: records served by the decorator; outputs re-materialized.
    const renders = await records.findRenders(record.sessionId);
    for (const render of renders) {
      await rematerializeOutputs(render, run.engine, record.rightsDeclaration);
    }
    durableSessions.add(record.sessionId);
    return true;
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
    if (seedSessionIds.has(sessionId)) return; // the seed namespace is unrecorded
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
    if (seedSessionIds.has(sessionId)) return; // the seed namespace is unrecorded
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
      return governed.createSession(input, ctx);
    },

    async getSession(sessionId, ctx) {
      const live = await ensureSessionLive(sessionId);
      if (!live) throw new ControlUnknownSessionError(sessionId);
      return governed.getSession(sessionId, ctx);
    },

    async listSessions(ctx) {
      // Seeded (in-process) ∪ durable: every durable record is reconstructed
      // (once per instance) so the raw registry then lists it natively.
      const durable = await records.listSessions();
      for (const record of durable) {
        await ensureSessionLive(record.sessionId).catch(() => undefined);
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
      return governed.createRender(sessionId, input, ctx);
    },

    async getRender(sessionId, renderId, ctx) {
      // The raw app's own ordering is preserved: its rights gate runs before
      // existence is revealed; only its unknown-render miss falls through to
      // the durable record.
      try {
        const envelope = await governed.getRender(sessionId, renderId, ctx);
        await noteRenderObserved(sessionId, renderId).catch(() => undefined);
        return envelope;
      } catch (err) {
        if (!(err instanceof ControlUnknownRenderError)) throw err;
      }
      const live = await ensureSessionLive(sessionId);
      if (!live) throw new ControlUnknownSessionError(sessionId);
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
      for (const render of raw.renders) {
        await noteRenderObserved(sessionId, render.renderId).catch(() => undefined);
      }
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
      return governed.createRenderAsync(sessionId, input, ctx);
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
    provider: "neon",
  };
}
