/**
 * `executeRenderJob` — the hosted compute worker's REAL job execution
 * (W914 Wave 2): one materialized dispatch request becomes one executed
 * render through the REAL renderer plugin (resolved from a
 * `RendererRegistry` — the W501 plugin interface), encoded through the REAL
 * W504 encoder (`encodeAnimeClip`), and stored through the REAL W504
 * render-segment store, handing back the content-addressed artifact.
 *
 * This mirrors the W701 synchronous `createRender` seam step-for-step where
 * the semantics are shared (resolve → init-once → fail-closed rights →
 * validate → render → validate result), then goes further: the W504
 * encode+store that the sync path leaves to composition is the worker's own
 * responsibility, and everything is measured against the INJECTED clock so
 * the fail-closed budgets (./budgets.ts) never trust a self-report.
 *
 * PURITY: no wall-clock read, no randomness, no network — the clock is
 * injected (`nowMs`), the only I/O is the caller-supplied store port.
 *
 * Fail-closed budgets (documented Vercel Hobby limits — ./budgets.ts):
 *
 * - duration: a job whose measured execution exceeds
 *   `min(budgets.maxExecutionMs, job.constraints.deadlineMs)` discards its
 *   outputs and resolves `failed` with terminal class `timeout`;
 * - size: an encoded artifact larger than `budgets.maxArtifactBytes` is
 *   never stored nor handed back — the job resolves `failed`
 *   (`artifact-too-large`, non-retryable).
 *
 * Rights posture (fail-closed at the provider, the audit's G8 minimum for
 * this wave): a resolved renderer that `requiresSourceFrames` NEVER
 * receives a job whose `rights.canReferenceSourceFrames` is false — the
 * job refuses before any rendering. The full delivery/storage capabilities
 * are the output pipeline's W504 gates (enforced fail-closed at
 * retrieval), not the dispatch boundary's; the `RenderRequest` is therefore
 * built from the MINIMAL posture (only the traveling capability, all
 * others false).
 *
 * Store scope honesty: the worker stores each encoded segment under
 * `(sessionId, renderId = job.jobId, segmentId)` — the compute job id IS the
 * render id in the worker's store scope, so a re-executed duplicate is a
 * counted no-op (the W504 idempotence), and the artifact handoff's metadata
 * names exactly those coordinates. The control plane assigns its own
 * `r-<seq>` render id when it ingests the inline artifacts into its
 * playback store (the pre-W912 inline-content mode the W914 audit blesses).
 */
import {
  RenderRequest,
  RenderResult,
  SCHEMA_VERSION,
  WorldEventStreamEntry,
  WorldSnapshot,
} from "@sporta/contracts";
import type {
  RenderRequest as RenderRequestDoc,
  RenderResult as RenderResultDoc,
  RightsCapabilities,
  WorldEventStreamEntry as WorldEventStreamEntryDoc,
  WorldSnapshot as WorldSnapshotDoc,
} from "@sporta/contracts";
import { ComputeDispatchRequest } from "@sporta/compute-adapter";
import type {
  ComputeDispatchRequest as ComputeDispatchRequestDoc,
  ComputeMaterializedInput,
  ComputeOutputArtifact,
} from "@sporta/compute-adapter";
import { encodeAnimeClip } from "@sporta/output-pipeline";
import type { ArtifactStore, RenderSegmentStore } from "@sporta/output-pipeline";
import {
  base64Of,
  ENCODED_ARTIFACT_CONTENT_TYPE,
  EncodingError,
  registerEncodedArtifact,
  validateEncodedManifest,
} from "@sporta/encoding";
import { RendererContractError, RendererRegistry } from "@sporta/renderer-contract";
import type { RendererPlugin } from "@sporta/renderer-contract";
import { HostedJobExecution } from "./envelope";
import type { HostedJobExecution as HostedJobExecutionDoc } from "./envelope";
import type { HostedComputeBudgets } from "./budgets";
import type { DerivedRealityRendererPort } from "./derived";
import { executeDerivedRealityRender } from "./derived-execution";

/** What the executor needs from its host (all injected — no globals). */
export interface RenderJobExecutorDeps {
  /** The renderer registry the REAL plugins resolve from (per-process). */
  rendererRegistry: RendererRegistry;
  /** The REAL W504 render-segment store encoded artifacts land in. */
  outputSegmentStore: RenderSegmentStore;
  /** The injected clock (epoch-ms readings; the worker injects a real one). */
  nowMs: () => number;
  /** The fail-closed execution budgets (./budgets.ts). */
  budgets: HostedComputeBudgets;
  /**
   * The derived-reality MP4 renderer (R508-R510): renders the tactical /
   * 3D-game / anime-NPR realities through the R306 encoding bridges so
   * their artifacts are REAL MP4s. Absent (default) → those realities are
   * honestly unrenderable on this plane (never the SVG path in disguise).
   */
  derivedRealityRenderer?: DerivedRealityRendererPort;
  /**
   * The W504 content-addressed artifact store the R306 plane registers
   * encoded MP4s into (idempotent puts, counted duplicates; the honest
   * base64 representation over the store's string seam). Absent → the
   * MP4 artifacts hand back inline only (the registration is a
   * composition-level decision).
   */
  encodedArtifactStore?: ArtifactStore;
}

/** A determinate failure under construction. */
interface FailureSpec {
  errorClass: string;
  message: string;
  terminal: "non-retryable" | "timeout" | "internal";
}

/** Builds the failed envelope (never silent — always classified). */
function failedEnvelope(
  jobId: string,
  failure: FailureSpec,
  consumedInputIds: string[],
  metering: { startedAtMs: number; finishedAtMs: number },
): HostedJobExecutionDoc {
  return {
    jobId,
    status: "failed",
    outputs: [],
    consumedInputIds,
    failure: { ...failure, retryable: false },
    metering: {
      startedAtMs: metering.startedAtMs,
      finishedAtMs: metering.finishedAtMs,
      executionMs: Math.max(0, metering.finishedAtMs - metering.startedAtMs),
      framesRendered: 0,
      segmentsEncoded: 0,
      segmentsStored: 0,
      bytesEncoded: 0,
      duplicateStores: 0,
    },
  };
}

/** The structural check for the W502 detailed-render extension. */
function hasRenderDetailed(plugin: RendererPlugin): plugin is RendererPlugin & {
  renderDetailed(
    req: RenderRequestDoc,
    input: { snapshot: WorldSnapshotDoc; events: WorldEventStreamEntryDoc[] },
  ): { result: RenderResultDoc; frames: unknown[]; manifest: unknown };
} {
  return typeof (plugin as { renderDetailed?: unknown }).renderDetailed === "function";
}

/**
 * Executes ONE materialized dispatch request end-to-end. Never throws —
 * every outcome (including malformed input and internal faults) resolves as
 * a classified {@link HostedJobExecution} envelope (failures are values).
 */
export async function executeRenderJob(
  request: unknown,
  deps: RenderJobExecutorDeps,
): Promise<HostedJobExecutionDoc> {
  const startedAtMs = deps.nowMs();
  const finishAt = (): number => deps.nowMs();

  // 1. Structural validation of the dispatch request (manifest + coverage).
  const parsedRequest = ComputeDispatchRequest.safeParse(request);
  if (!parsedRequest.success) {
    return failedEnvelope(
      typeof request === "object" &&
        request !== null &&
        typeof (request as { jobId?: unknown }).jobId === "string"
        ? (request as { jobId: string }).jobId
        : "unknown",
      {
        errorClass: "invalid-dispatch",
        message:
          "dispatch request is not a valid ComputeDispatchRequest: " +
          parsedRequest.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        terminal: "non-retryable",
      },
      [],
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }
  const dispatch: ComputeDispatchRequestDoc = parsedRequest.data;
  const job = dispatch.job;

  // 2. Resolve the REAL plugin (unknown renderer id/version is determinate).
  let plugin: RendererPlugin;
  try {
    plugin = deps.rendererRegistry.resolve(job.renderer.rendererId, job.renderer.rendererVersion);
  } catch (err) {
    const message =
      err instanceof RendererContractError
        ? err.message
        : `renderer resolution failed: ${String(err)}`;
    return failedEnvelope(
      job.jobId,
      { errorClass: "renderer-unknown", message, terminal: "non-retryable" },
      [],
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }
  // Init-once with no observability seam (the worker keeps its own meters;
  // a plugin that needs host services still gets the init call exactly once).
  if (!initializedPlugins.has(plugin)) {
    await plugin.init();
    initializedPlugins.add(plugin);
  }
  const capability = plugin.capability();

  // 3. Fail-closed rights re-check at the provider (the posture travels).
  if (capability.requiresSourceFrames && !job.rights.canReferenceSourceFrames) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "rights-denied",
        message: `renderer '${capability.rendererId}' requires source frames but the job's rights posture denies canReferenceSourceFrames`,
        terminal: "non-retryable",
      },
      [],
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }

  // 4. Extract + validate the materialized inputs (exactly one snapshot and
  //    one event window — the shape the control plane dispatches).
  const inputs = extractInputs(dispatch.inputs);
  if (typeof inputs === "string") {
    return failedEnvelope(
      job.jobId,
      { errorClass: "invalid-inputs", message: inputs, terminal: "non-retryable" },
      [],
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }
  const { snapshotInput, eventsInput } = inputs;
  const snapshotCheck = WorldSnapshot.safeParse(snapshotInput.payload.snapshot);
  if (!snapshotCheck.success) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "invalid-inputs",
        message:
          "swm-snapshot payload is not a valid contracts WorldSnapshot: " +
          snapshotCheck.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        terminal: "non-retryable",
      },
      [snapshotInput.inputId],
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }
  const events: WorldEventStreamEntryDoc[] = [];
  for (const entry of eventsInput.payload.entries) {
    const entryCheck = WorldEventStreamEntry.safeParse(entry);
    if (!entryCheck.success) {
      return failedEnvelope(
        job.jobId,
        {
          errorClass: "invalid-inputs",
          message: `swm-event-window entry is not a valid contracts WorldEventStreamEntry: ${entryCheck.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
          terminal: "non-retryable",
        },
        [snapshotInput.inputId],
        { startedAtMs, finishedAtMs: finishAt() },
      );
    }
    events.push(entryCheck.data);
  }

  // 5. Build the RenderRequest (renderer identity from the RESOLVED plugin —
  //    the W701 posture; rights = the MINIMAL posture derived from the job).
  const rightsCapabilities: RightsCapabilities = {
    canReferenceSourceFrames: job.rights.canReferenceSourceFrames,
    canDeliverLive: false,
    canStoreDerivatives: false,
    canShare: false,
  };
  const renderRequest: RenderRequestDoc = {
    sessionId: job.sessionId,
    schemaVersion: SCHEMA_VERSION,
    rendererId: capability.rendererId,
    rendererVersion: capability.rendererVersion,
    styleConfig: {
      styleId: job.recipe.styleId,
      configSchemaVersion: job.recipe.configSchemaVersion,
      config: job.recipe.config,
    },
    snapshotVersion: snapshotInput.payload.snapshotVersion,
    eventsSinceSequence: eventsInput.payload.fromSequence,
    outputProfile: job.outputProfile,
    rightsCapabilities,
    sourceFrameRefs: [],
  };
  const requestCheck = RenderRequest.safeParse(renderRequest);
  if (!requestCheck.success) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "invalid-request",
        message:
          "built RenderRequest failed contracts validation: " +
          requestCheck.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        terminal: "internal",
      },
      [snapshotInput.inputId, eventsInput.inputId],
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }

  // 6. Plugin gates: validateRequest, then render (rejections map onto
  //    determinate failures — the W304 render-refused precedent).
  const validation = plugin.validateRequest(requestCheck.data);
  if (!validation.ok) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "render-refused",
        message: `renderer rejected the request: ${validation.reason}`,
        terminal: "non-retryable",
      },
      [snapshotInput.inputId, eventsInput.inputId],
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }

  // 6'. The derived-reality MP4 path (R508-R510): when the resolved
  //     renderer is a derived-reality renderer this plane hosts, the
  //     render runs through the R306 encoding bridges — the artifact
  //     handed back is a REAL MP4 (an `EncodedArtifact` with a validated
  //     container manifest), never an SVG review segment. The W504
  //     SVG-only encode path stays the ANIME review-segment path below.
  if (
    deps.derivedRealityRenderer !== undefined &&
    deps.derivedRealityRenderer.supports(capability.rendererId)
  ) {
    return executeDerivedRealityRender({
      request: dispatch,
      job,
      renderRequest: requestCheck.data,
      snapshot: snapshotCheck.data,
      snapshotInput,
      eventsInput,
      events,
      capability,
      deps: {
        derivedRealityRenderer: deps.derivedRealityRenderer,
        ...(deps.encodedArtifactStore === undefined
          ? {}
          : { encodedArtifactStore: deps.encodedArtifactStore }),
        nowMs: deps.nowMs,
        budgets: deps.budgets,
      },
      startedAtMs,
      finishAt,
    });
  }

  const renderInput = { snapshot: snapshotCheck.data, events };
  let result: RenderResultDoc;
  let framesCount = 0;
  let detailedOutput: { frames: unknown[]; manifest: unknown } | undefined;
  try {
    if (hasRenderDetailed(plugin)) {
      // The W502 detailed render: the contract result PLUS the SVG frame
      // sequence the W504 encoder consumes (one render, not two).
      const detailed = plugin.renderDetailed(requestCheck.data, renderInput);
      result = detailed.result;
      detailedOutput = { frames: detailed.frames, manifest: detailed.manifest };
      framesCount = detailed.frames.length;
    } else {
      // A plugin without the W502 detailed surface: execute the contract
      // render, but this worker cannot encode artifacts for it — a render
      // with no artifact handoff is a determinate dispatch failure here.
      result = await plugin.render(requestCheck.data, renderInput);
    }
  } catch (err) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "renderer-error",
        message: err instanceof Error ? err.message : String(err),
        terminal: "internal",
      },
      [snapshotInput.inputId, eventsInput.inputId],
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }
  const resultCheck = RenderResult.safeParse(result);
  if (!resultCheck.success) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "invalid-render-result",
        message:
          "renderer returned an invalid RenderResult: " +
          resultCheck.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        terminal: "internal",
      },
      [snapshotInput.inputId, eventsInput.inputId],
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }
  if (detailedOutput === undefined) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "renderer-not-encodable",
        message: `renderer '${capability.rendererId}' does not expose the W502 detailed render surface this worker's W504 artifact handoff requires`,
        terminal: "non-retryable",
      },
      [snapshotInput.inputId, eventsInput.inputId],
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }

  // 7. W504 encode (the REAL encoder) + fail-closed size budget.
  let segment: ReturnType<typeof encodeAnimeClip>;
  try {
    segment = encodeAnimeClip({
      result: resultCheck.data,
      frames: detailedOutput.frames as never,
      manifest: detailedOutput.manifest as never,
    });
  } catch (err) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "encode-failed",
        message: err instanceof Error ? err.message : String(err),
        terminal: "internal",
      },
      [snapshotInput.inputId, eventsInput.inputId],
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }
  framesCount = segment.manifest.frameCount;
  if (segment.byteLength > deps.budgets.maxArtifactBytes) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "artifact-too-large",
        message: `encoded artifact is ${segment.byteLength} bytes, over the fail-closed budget of ${deps.budgets.maxArtifactBytes}`,
        terminal: "non-retryable",
      },
      [snapshotInput.inputId, eventsInput.inputId],
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }

  // 8. W504 store (the REAL render-segment store; the compute job id IS the
  //    render id in the worker's store scope — counted duplicates are no-ops).
  let duplicateStores = 0;
  try {
    const outcome = deps.outputSegmentStore.storeSegment({
      sessionId: job.sessionId,
      renderId: job.jobId,
      segment,
    });
    if (outcome.outcome === "duplicate") {
      duplicateStores = 1;
    }
  } catch (err) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "store-failed",
        message: err instanceof Error ? err.message : String(err),
        terminal: "internal",
      },
      [snapshotInput.inputId, eventsInput.inputId],
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }

  // 9. The artifact handoff (inline content mode — the pre-W912 mode).
  const artifact: ComputeOutputArtifact = {
    schemaVersion: "1.0",
    artifactId: segment.contentHash,
    contentHash: segment.contentHash,
    contentType: segment.contentType,
    byteLength: segment.byteLength,
    manifest: segment.manifest,
    metadata: {
      sessionId: job.sessionId,
      renderId: job.jobId,
      segmentId: segment.segmentId,
      snapshotVersion: snapshotInput.payload.snapshotVersion,
      frameCount: segment.manifest.frameCount,
      totalDurationMs: segment.manifest.totalDurationMs,
    },
    delivery: { mode: "inline", content: segment.content },
  };

  const finishedAtMs = finishAt();
  const executionMs = Math.max(0, finishedAtMs - startedAtMs);

  // 10. Fail-closed duration budget (post-hoc: outputs are DISCARDED).
  const durationBudgetMs = Math.min(deps.budgets.maxExecutionMs, job.constraints.deadlineMs);
  if (executionMs > durationBudgetMs) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "budget-exceeded",
        message: `measured execution ${executionMs}ms exceeded the fail-closed budget of ${durationBudgetMs}ms (worker ${deps.budgets.maxExecutionMs}ms / job deadline ${job.constraints.deadlineMs}ms) — outputs discarded`,
        terminal: "timeout",
      },
      [snapshotInput.inputId, eventsInput.inputId],
      { startedAtMs, finishedAtMs },
    );
  }

  const envelope: HostedJobExecutionDoc = {
    jobId: job.jobId,
    status: "succeeded",
    outputs: [artifact],
    consumedInputIds: [snapshotInput.inputId, eventsInput.inputId],
    renderResult: resultCheck.data,
    metering: {
      startedAtMs,
      finishedAtMs,
      executionMs,
      framesRendered: framesCount,
      segmentsEncoded: 1,
      segmentsStored: 1,
      bytesEncoded: segment.byteLength,
      duplicateStores,
    },
  };
  // Self-check: the envelope must satisfy the worker's own wire schema
  // (fail-loud on a construction bug — never hand back an invalid envelope).
  const envelopeCheck = HostedJobExecution.safeParse(envelope);
  if (!envelopeCheck.success) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "invalid-envelope",
        message:
          "constructed success envelope failed its own schema: " +
          envelopeCheck.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        terminal: "internal",
      },
      envelope.consumedInputIds,
      { startedAtMs, finishedAtMs },
    );
  }
  return envelopeCheck.data;
}

/** Init-once registry (per-process, the W501 lifecycle contract). */
const initializedPlugins = new WeakSet<RendererPlugin>();

/** The exact one-snapshot + one-event-window input shape, or an issue string. */
function extractInputs(inputs: readonly ComputeMaterializedInput[]):
  | {
      snapshotInput: ComputeMaterializedInput & {
        payload: { snapshotVersion: number; snapshot: unknown };
      };
      eventsInput: ComputeMaterializedInput & {
        payload: { fromSequence: number; entries: unknown[] };
      };
    }
  | string {
  const snapshots = inputs.filter((input) => input.kind === "swm-snapshot");
  const events = inputs.filter((input) => input.kind === "swm-event-window");
  if (snapshots.length !== 1) {
    return `the dispatch must carry exactly one swm-snapshot input (got ${snapshots.length})`;
  }
  if (events.length !== 1) {
    return `the dispatch must carry exactly one swm-event-window input (got ${events.length})`;
  }
  const snapshot = snapshots[0];
  const eventWindow = events[0];
  if (snapshot === undefined || eventWindow === undefined) {
    return "internal input-shape mismatch (length-1 filters produced undefined)";
  }
  if (!isRecord(snapshot.payload) || typeof snapshot.payload.snapshotVersion !== "number") {
    return "swm-snapshot payload is not { snapshotVersion, snapshot }";
  }
  if (
    !isRecord(eventWindow.payload) ||
    typeof eventWindow.payload.fromSequence !== "number" ||
    !Array.isArray(eventWindow.payload.entries)
  ) {
    return "swm-event-window payload is not { fromSequence, entries[] }";
  }
  return {
    snapshotInput: snapshot as (typeof snapshots)[number] & {
      payload: { snapshotVersion: number; snapshot: unknown };
    },
    eventsInput: eventWindow as typeof eventWindow & {
      payload: { fromSequence: number; entries: unknown[] };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
