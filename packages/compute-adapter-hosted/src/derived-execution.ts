/**
 * `executeDerivedRealityRender` — the derived-reality execution leg of the
 * W914 executor (R508/R509/R510): one admitted dispatch whose renderer is
 * a derived-reality renderer (tactical / 3D game / anime-NPR) renders
 * through the R306 encoding bridges and hands back ONE REAL MP4 artifact.
 *
 * Same discipline as the executor's W504 leg, step for step where the
 * semantics are shared (fail-closed budgets, never-silent accounting,
 * failures are classified values, the envelope self-checks its own wire
 * schema), with the MP4-specific deltas:
 *
 * - the artifact handoff is the R306 honest base64 representation over
 *   the inline seam (`video/mp4+base64`): the inline content is the
 *   base64 of the REAL MP4 bytes, `artifactId`/`contentHash` are the
 *   sha-256 of the RAW bytes (the artifact's own content address), and
 *   `byteLength` is the inline document's UTF-8 byte length (the frozen
 *   Wave-2 contract's inline rule) — both numbers honest in their own
 *   documents, never conflated;
 * - the container manifest is VALIDATED (`validateEncodedManifest`) and
 *   the artifact tier must be `mp4` — a fixture-tier artifact is never
 *   handed back as video;
 * - the size budget measures the RAW MP4 bytes (the artifact's own size);
 * - the R306 registration store (the W504 content-addressed
 *   `ArtifactStore`, when composed) registers the artifact through
 *   `registerEncodedArtifact` — idempotent puts with counted duplicates
 *   (the store's own semantics), cross-verified at registration time;
 * - the metering reports the render's own frame count, one encoded
 *   segment, the registration outcome, and the RAW encoded byte size.
 */
import { RenderResult } from "@sporta/contracts";
import type {
  RendererCapability,
  RenderRequest as RenderRequestDoc,
  WorldEventStreamEntry as WorldEventStreamEntryDoc,
  WorldSnapshot as WorldSnapshotDoc,
} from "@sporta/contracts";
import type {
  ComputeDispatchRequest as ComputeDispatchRequestDoc,
  ComputeMaterializedInput,
  ComputeOutputArtifact,
} from "@sporta/compute-adapter";
import type { ArtifactStore } from "@sporta/output-pipeline";
import {
  base64Of,
  ENCODED_ARTIFACT_CONTENT_TYPE,
  EncodingError,
  registerEncodedArtifact,
  validateEncodedManifest,
} from "@sporta/encoding";
import { HostedJobExecution } from "./envelope";
import type { HostedJobExecution as HostedJobExecutionDoc } from "./envelope";
import type { HostedComputeBudgets } from "./budgets";
import type { DerivedRealityRendererPort } from "./derived";

/** A determinate failure under construction (the executor's own shape). */
interface FailureSpec {
  errorClass: string;
  message: string;
  terminal: "non-retryable" | "timeout" | "internal";
}

/** The derived-reality execution leg's inputs (shared with the executor). */
export interface DerivedRealityExecutionInput {
  request: ComputeDispatchRequestDoc;
  job: ComputeDispatchRequestDoc["job"];
  renderRequest: RenderRequestDoc;
  snapshot: WorldSnapshotDoc;
  snapshotInput: ComputeMaterializedInput & {
    payload: { snapshotVersion: number; snapshot: unknown };
  };
  eventsInput: ComputeMaterializedInput & {
    payload: { fromSequence: number; entries: unknown[] };
  };
  events: WorldEventStreamEntryDoc[];
  capability: RendererCapability;
  deps: {
    derivedRealityRenderer: DerivedRealityRendererPort;
    encodedArtifactStore?: ArtifactStore;
    nowMs: () => number;
    budgets: HostedComputeBudgets;
  };
  startedAtMs: number;
  finishAt: () => number;
}

/** Module-level encoder (pure, deterministic — the store module's convention). */
const textEncoder = new TextEncoder();

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

/** Describes a thrown error for the failure envelope (JSON-safe excerpt). */
function describeError(err: unknown): string {
  if (err instanceof EncodingError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Executes ONE admitted derived-reality render end-to-end. Never throws —
 * every outcome resolves as a classified {@link HostedJobExecution}
 * envelope (failures are values), exactly like the W504 leg.
 */
export async function executeDerivedRealityRender(
  input: DerivedRealityExecutionInput,
): Promise<HostedJobExecutionDoc> {
  const { job, deps, startedAtMs, finishAt } = input;
  const consumedInputIds = [input.snapshotInput.inputId, input.eventsInput.inputId];

  // 1. The render through the R306 bridge plane (fail-closed: a typed
  //    EncodingError or renderer refusal is a determinate failure).
  let rendered: ReturnType<DerivedRealityRendererPort["renderDerivedReality"]>;
  try {
    rendered = deps.derivedRealityRenderer.renderDerivedReality({
      sessionId: job.sessionId,
      rendererId: input.capability.rendererId,
      rendererVersion: input.capability.rendererVersion,
      snapshot: input.snapshot,
      events: input.events,
      snapshotVersion: input.snapshotInput.payload.snapshotVersion,
      eventsSinceSequence: input.eventsInput.payload.fromSequence,
      styleConfig: {
        styleId: job.recipe.styleId,
        configSchemaVersion: job.recipe.configSchemaVersion,
        config: job.recipe.config,
      },
      outputProfile: {
        resolution: {
          w: input.renderRequest.outputProfile.resolution.w,
          h: input.renderRequest.outputProfile.resolution.h,
        },
        frameRate: input.renderRequest.outputProfile.frameRate,
        codec: input.renderRequest.outputProfile.codec,
        container: input.renderRequest.outputProfile.container,
        latencyClass: input.renderRequest.outputProfile.latencyClass,
      },
      nowMs: deps.nowMs,
    });
  } catch (err) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: err instanceof EncodingError ? "encode-failed" : "renderer-error",
        message: describeError(err),
        terminal: "internal",
      },
      consumedInputIds,
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }

  // 2. The contract result (the frozen schema — the W501 document).
  const resultCheck = RenderResult.safeParse(rendered.result);
  if (!resultCheck.success) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "invalid-render-result",
        message:
          "the derived-reality renderer returned an invalid RenderResult: " +
          resultCheck.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        terminal: "internal",
      },
      consumedInputIds,
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }

  // 3. The container manifest must VALIDATE, and the artifact tier must be
  //    the REAL MP4 tier — a fixture-tier artifact is never handed back
  //    as video (the acceptance contract's automatic-rejection posture).
  const manifestCheck = validateEncodedManifest(rendered.artifact.manifest);
  if (!manifestCheck.ok) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "encode-failed",
        message: `the encoded artifact's container manifest failed validation: ${manifestCheck.issues.join("; ")}`,
        terminal: "internal",
      },
      consumedInputIds,
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }
  if (rendered.artifact.kind !== "mp4") {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "encode-failed",
        message: `the encoded artifact's tier is '${rendered.artifact.kind}', not a real MP4 — a fixture-tier artifact is never handed back as video`,
        terminal: "internal",
      },
      consumedInputIds,
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }

  // 4. The fail-closed size budget (the RAW MP4 bytes).
  if (rendered.artifact.byteSize > deps.budgets.maxArtifactBytes) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "artifact-too-large",
        message: `encoded artifact is ${rendered.artifact.byteSize} bytes, over the fail-closed budget of ${deps.budgets.maxArtifactBytes}`,
        terminal: "non-retryable",
      },
      consumedInputIds,
      { startedAtMs, finishedAtMs: finishAt() },
    );
  }

  // 5. The R306 registration (the W504 content-addressed artifact store,
  //    when composed): idempotent puts, counted duplicates, cross-verified
  //    at registration time (the store module's own contract).
  let segmentsStored = 0;
  let duplicateStores = 0;
  if (deps.encodedArtifactStore !== undefined) {
    try {
      const registration = registerEncodedArtifact(deps.encodedArtifactStore, rendered.artifact);
      segmentsStored = 1;
      if (registration.outcome === "duplicate") duplicateStores = 1;
    } catch (err) {
      return failedEnvelope(
        job.jobId,
        {
          errorClass: "store-failed",
          message: describeError(err),
          terminal: "internal",
        },
        consumedInputIds,
        { startedAtMs, finishedAtMs: finishAt() },
      );
    }
  }

  // 6. The artifact handoff: the R306 honest base64 representation over
  //    the inline seam. artifactId/contentHash are the RAW MP4's sha-256
  //    content address; the inline content is its base64 document and
  //    byteLength is that document's UTF-8 byte length (the frozen Wave-2
  //    inline rule).
  const base64Content = base64Of(rendered.artifact.bytes);
  const artifact: ComputeOutputArtifact = {
    schemaVersion: "1.0",
    artifactId: rendered.artifact.contentHash,
    contentHash: rendered.artifact.contentHash,
    contentType: ENCODED_ARTIFACT_CONTENT_TYPE,
    byteLength: textEncoder.encode(base64Content).length,
    manifest: rendered.artifact.manifest,
    metadata: {
      sessionId: job.sessionId,
      renderId: job.jobId,
      segmentId: rendered.artifact.manifestId,
      snapshotVersion: input.snapshotInput.payload.snapshotVersion,
      frameCount: rendered.artifact.manifest.geometry.frameCount,
      totalDurationMs: rendered.artifact.manifest.geometry.durationMs,
    },
    delivery: { mode: "inline", content: base64Content },
  };

  const finishedAtMs = finishAt();
  const executionMs = Math.max(0, finishedAtMs - startedAtMs);

  // 7. Fail-closed duration budget (post-hoc: outputs are DISCARDED).
  const durationBudgetMs = Math.min(deps.budgets.maxExecutionMs, job.constraints.deadlineMs);
  if (executionMs > durationBudgetMs) {
    return failedEnvelope(
      job.jobId,
      {
        errorClass: "budget-exceeded",
        message: `measured execution ${executionMs}ms exceeded the fail-closed budget of ${durationBudgetMs}ms (worker ${deps.budgets.maxExecutionMs}ms / job deadline ${job.constraints.deadlineMs}ms) — outputs discarded`,
        terminal: "timeout",
      },
      consumedInputIds,
      { startedAtMs, finishedAtMs },
    );
  }

  const envelope: HostedJobExecutionDoc = {
    jobId: job.jobId,
    status: "succeeded",
    outputs: [artifact],
    consumedInputIds,
    renderResult: resultCheck.data,
    metering: {
      startedAtMs,
      finishedAtMs,
      executionMs,
      framesRendered: rendered.frameCount,
      segmentsEncoded: 1,
      segmentsStored,
      bytesEncoded: rendered.artifact.byteSize,
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
