/**
 * Versioned, strict zod schemas of the provider-neutral compute-adapter
 * contract (W914 Wave 1): the transport-safe render job description, the
 * adapter capability descriptor, the dispatch handle, job lifecycle states,
 * progress/decision events, the terminal completion envelope (with input
 * accounting — never silent), and the per-job usage/metering record.
 *
 * ## Vocabulary alignment (CITED, and test-pinned in test/vocabulary.test.ts)
 *
 * Every closed vocabulary here is either VERBATIM from an existing package or
 * a documented adapter-level addition; nothing is invented where a live
 * precedent exists:
 *
 * - terminal dispositions `"succeeded" | "failed" | "cancelled" |
 *   "dead-lettered"` — VERBATIM `GpuTerminalDisposition`
 *   (`@sporta/gpu-worker` `src/types.ts`, W303);
 * - live job states `"queued" | "in-flight"` — VERBATIM live members of
 *   `GpuJobState` (W303); `"admitted"` / `"dispatched"` are the documented
 *   adapter-level additions (control-plane admission + provider handoff —
 *   states W303's in-process submit() never exposes);
 * - terminal failure classes `"non-retryable" | "retry-exhausted" |
 *   "timeout" | "internal"` — VERBATIM `GpuTerminalClass` (W303), which
 *   extends the W302 DLQ taxonomy with the W303 timeout class;
 * - decision-event kinds — the W303 `GpuJobEventType` members VERBATIM
 *   (`"submitted"`, `"claimed"`, `"lease-expired"`, `"requeued"`,
 *   `"worker-stale"`, `"deadline-timeout"`, `"cancelled"`,
 *   `"superseded-report"`, `"succeeded"`, `"failed"`, `"dead-lettered"`)
 *   plus the adapter-level `"dispatched"` (provider handoff) and
 *   `"progress"` (fractional progress — W906's "observe actual processing
 *   state");
 * - result timing field names (`submittedAtMs`, `startedAtMs`,
 *   `finishedAtMs`, `queueWaitMs`, `executionMs`) — VERBATIM
 *   `GpuJobResultTiming` (W303);
 * - result statuses `"succeeded" | "failed" | "cancelled"` — VERBATIM
 *   `GpuJobResult["status"]` (W303): dead-lettered jobs resolve `failed`;
 * - input `kind`s `"swm-snapshot" | "swm-event-window" | "source-media" |
 *   "renderer-fixture"` — abstract, aligned with the W304 `SwmUpdate`
 *   composition (snapshot + events) and the W501 `RenderInput`;
 * - output-profile fields (`resolution`, `frameRate`, `codec`, `container`,
 *   `latencyClass: "offline" | "near-live" | "live"`) — VERBATIM the
 *   `@sporta/contracts` `OutputProfile` shape (test-pinned equal);
 * - rights posture `canReferenceSourceFrames` — the R2 fail-closed gate of
 *   the W501 renderer contract (`RightsCapabilities`,
 *   `@sporta/contracts` `src/rights.ts`);
 * - artifact metadata field names (`sessionId`, `renderId`, `segmentId`,
 *   `snapshotVersion`, `frameCount`, `totalDurationMs`) — VERBATIM the W504
 *   `AnimeArtifactMetadata` (`@sporta/output-pipeline` `src/types.ts`), so a
 *   stored compute output drops straight into the W504 store seam;
 * - artifact ids: sha-256 content-addressing, 64 lowercase hex — the W504
 *   `contentHash`/`artifactId` convention;
 * - correlation fields (`sessionId`, `correlationId`, `traceId`) — the W007
 *   `CorrelationContext` triple (`@sporta/observability`);
 * - error failure classes `"rights-denied" | "media-invalid" |
 *   "resource-limit" | "internal"` — the `TerminalFailureClass` enum
 *   (`@sporta/contracts` `src/media-session.ts`).
 *
 * ## Strictness constitution
 *
 * Every object schema is `.strict()` (unknown keys REJECT — a wire-safe
 * contract must fail loud on drift), every enum is closed, and every
 * cross-field invariant that is decidable from the document alone is enforced
 * by `superRefine` (terminal-class/disposition coupling, content-hash
 * identity, input-accounting partition, cost-unit uniqueness).
 *
 * Runtime dependency: `zod` ONLY (the @sporta/contracts precedent). The
 * packages whose vocabularies are mirrored above are dev-dependencies,
 * consumed exclusively by the alignment tests.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema versioning (the @sporta/contracts "MAJOR.MINOR" convention)
// ---------------------------------------------------------------------------

/** Current compute-adapter contract version. Bumping MAJOR is breaking. */
export const COMPUTE_SCHEMA_VERSION = "1.0" as const;

/**
 * The version literal every v1 compute-adapter document must carry. A
 * document with any other version REJECTS — cross-version negotiation is an
 * explicit, deliberate change to this constant, never a silent parse.
 */
export const computeSchemaVersionField = z.literal(COMPUTE_SCHEMA_VERSION);

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Non-empty string (the W303 envelope-field convention). */
const nonEmpty = z.string().min(1);

/** sha-256 content hash: exactly 64 lowercase hex digits (the W504 rule). */
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex digits");

/** A finite non-negative millisecond reading (injected-clock domain). */
const ms = z.number().finite().min(0);

/**
 * UTF-8 byte length of a string (the W504 `byteLengthOf` convention — the
 * output-pipeline store validates `byteLength` as the UTF-8 byte length of
 * `content`, so the compute contract must measure the same way; this module
 * uses the platform `TextEncoder`, no new dependency).
 */
function utf8ByteLengthOf(content: string): number {
  return new TextEncoder().encode(content).length;
}

// ---------------------------------------------------------------------------
// Job description (the transport-safe render job — the W914 seam)
// ---------------------------------------------------------------------------

/**
 * The closed vocabulary of render-job input kinds. Abstract and
 * vendor-neutral: a `ref` is an OPAQUE address the provider resolves (the
 * W303 `payloadRef` posture — the protocol never interprets it).
 */
export const ComputeInputKind = z.enum([
  "swm-snapshot",
  "swm-event-window",
  "source-media",
  "renderer-fixture",
]);
export type ComputeInputKind = z.infer<typeof ComputeInputKind>;

/** One entry of a job's inputs manifest. */
export const ComputeInputRef = z
  .object({
    /** Manifest-unique identity of this input (non-empty). */
    inputId: nonEmpty,
    /** What kind of thing this input is (closed vocabulary, above). */
    kind: ComputeInputKind,
    /** Opaque provider-resolvable address (non-empty; the W303 payloadRef posture). */
    ref: nonEmpty,
    /** sha-256 of the referenced content, when known at dispatch (64 lowercase hex). */
    contentHash: sha256.optional(),
    /** Declared payload size in bytes (finite >= 0; the W104 sizer evidence). */
    byteSize: z.number().finite().min(0).optional(),
  })
  .strict();
export type ComputeInputRef = z.infer<typeof ComputeInputRef>;

/**
 * The rights posture that travels with a hosted job (architecture-lock §11:
 * "Rights metadata travels with the media session"). `policyRef` names the
 * authorization policy the control plane derived the posture from;
 * `canReferenceSourceFrames` is the R2 fail-closed gate of the W501 renderer
 * contract — a renderer that requires source frames must never receive a job
 * whose posture denies them. Delivery/storage capabilities are the output
 * pipeline's concern (W504 gates), not the dispatch boundary's.
 */
export const ComputeRightsPosture = z
  .object({
    /** Reference to the authorization policy this posture was derived from. */
    policyRef: nonEmpty,
    /** Whether source frames may be referenced during rendering (R2). */
    canReferenceSourceFrames: z.boolean(),
  })
  .strict();
export type ComputeRightsPosture = z.infer<typeof ComputeRightsPosture>;

/**
 * Encoded output constraints — the `@sporta/contracts` `OutputProfile` shape,
 * mirrored field-for-field so the contract is wire-safe without importing the
 * domain package (test/vocabulary.test.ts pins the equality).
 */
export const ComputeOutputProfile = z
  .object({
    resolution: z
      .object({
        w: z.number().int().min(1),
        h: z.number().int().min(1),
      })
      .strict(),
    frameRate: z.number().gt(0),
    codec: nonEmpty,
    container: nonEmpty,
    /** VERBATIM the contracts `OutputLatencyClass` enum. */
    latencyClass: z.enum(["offline", "near-live", "live"]),
  })
  .strict();
export type ComputeOutputProfile = z.infer<typeof ComputeOutputProfile>;

/** Whole-job execution constraints (the W303 envelope fields, verbatim names). */
export const ComputeJobConstraints = z
  .object({
    /** Whole-job time budget in ms from submission (finite > 0; W303 deadlineMs). */
    deadlineMs: z.number().finite().positive(),
    /** Claim budget — maximum lease epochs (integer >= 1; W303 maxAttempts). */
    maxAttempts: z.number().int().min(1).optional(),
    /** Scheduling priority (integer; higher = earlier; W303 priority). */
    priority: z.number().int().optional(),
    /** Declared resource needs (advisory, abstract — W303 requirements). */
    resourceHints: z
      .object({
        memoryMb: z.number().finite().min(0).optional(),
        computeClass: nonEmpty.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ComputeJobConstraints = z.infer<typeof ComputeJobConstraints>;

/**
 * THE transport-safe render job description (the W914 Wave-1 contract): what
 * the hosted control plane hands a compute adapter. Everything an executor
 * needs is ADDRESSABLE (inputs manifest), identified (jobId +
 * idempotencyKey), correlated (the W007 triple), rights-scoped, and
 * constrained — no in-memory object references, no implicit session state
 * (the audit's finding about the W701 synchronous path and the W304 inline
 * batches).
 */
export const ComputeJobDescription = z
  .object({
    schemaVersion: computeSchemaVersionField,
    /** Per-job identity (caller-authored, non-empty, unique per adapter). */
    jobId: nonEmpty,
    /** Dedupe/claim-once identity — the streaming-contract Recovery rule (W303). */
    idempotencyKey: nonEmpty,
    /** Session linkage + the W007 correlation triple. */
    sessionId: nonEmpty,
    correlationId: nonEmpty,
    traceId: nonEmpty,
    /** The renderer to execute (id + optional exact version). */
    renderer: z
      .object({
        rendererId: nonEmpty,
        rendererVersion: nonEmpty.optional(),
      })
      .strict(),
    /** The render recipe (the contracts `styleConfig` shape, mirrored). */
    recipe: z
      .object({
        styleId: nonEmpty,
        configSchemaVersion: nonEmpty,
        config: z.unknown(),
      })
      .strict(),
    /** The inputs manifest (at least one input; unique inputIds). */
    inputs: z.array(ComputeInputRef).min(1),
    /** Encoded output constraints. */
    outputProfile: ComputeOutputProfile,
    /** The rights posture traveling with the job (fail-closed at the provider). */
    rights: ComputeRightsPosture,
    /** Whole-job constraints (deadline, claim budget, priority, resource hints). */
    constraints: ComputeJobConstraints,
  })
  .strict()
  .superRefine((job, ctx) => {
    const seen = new Set<string>();
    for (const input of job.inputs) {
      if (seen.has(input.inputId)) {
        ctx.addIssue({
          code: "custom",
          path: ["inputs"],
          message: `duplicate inputId '${input.inputId}' in the inputs manifest`,
        });
        return;
      }
      seen.add(input.inputId);
    }
  });
export type ComputeJobDescription = z.infer<typeof ComputeJobDescription>;

// ---------------------------------------------------------------------------
// Adapter capability descriptor (provider-neutral)
// ---------------------------------------------------------------------------

/**
 * The closed vocabulary of provider kinds — ABSTRACT (architecture-lock §9
 * vendor neutrality): no vendor, cloud, or product name may appear here.
 * `in-memory` exists so the test-only reference can honestly describe
 * itself; production descriptors declare `cpu-worker` / `gpu-worker` /
 * `managed-actor` behind the same interface.
 */
export const ComputeProviderKind = z.enum([
  "in-memory",
  "cpu-worker",
  "gpu-worker",
  "managed-actor",
]);
export type ComputeProviderKind = z.infer<typeof ComputeProviderKind>;

/** The closed vocabulary of cost-unit kinds (abstract; W919 consumes). */
export const ComputeCostUnitKind = z.enum(["time-ms", "count", "bytes", "credit"]);
export type ComputeCostUnitKind = z.infer<typeof ComputeCostUnitKind>;

/** One declared cost unit (the metering currency of this adapter). */
export const ComputeCostUnit = z
  .object({
    /** Unit identity (non-empty; referenced by usage records). */
    unitId: nonEmpty,
    /** What the unit measures (closed vocabulary). */
    unitKind: ComputeCostUnitKind,
    /** Human-readable description of the unit (optional). */
    description: nonEmpty.optional(),
  })
  .strict();
export type ComputeCostUnit = z.infer<typeof ComputeCostUnit>;

/** One renderer this adapter declares support for. */
export const ComputeRendererSupport = z
  .object({
    /** The renderer id (must exist in a renderer registry at the provider). */
    rendererId: nonEmpty,
    /** Exact versions supported; omit = all versions the provider hosts. */
    rendererVersions: z.array(nonEmpty).optional(),
  })
  .strict();
export type ComputeRendererSupport = z.infer<typeof ComputeRendererSupport>;

/**
 * The adapter capability descriptor: what a hosted adapter HONESTLY
 * declares — supported renderers (admission is refused for anything else),
 * concurrency, dispatch timeout, deadline bounds, and the cost units usage
 * records may reference. Provider-neutral by construction: identity is
 * adapter-level (`adapterId`), the provider is a KIND, never a vendor.
 */
export const ComputeAdapterDescriptor = z
  .object({
    schemaVersion: computeSchemaVersionField,
    /** Adapter identity (non-empty; names logs and usage records). */
    adapterId: nonEmpty,
    /** Adapter version ("MAJOR.MINOR"). */
    adapterVersion: z.string().regex(/^\d+\.\d+$/, 'adapterVersion must be "MAJOR.MINOR"'),
    /** The kind of provider behind this adapter (closed vocabulary). */
    providerKind: ComputeProviderKind,
    /** Renderers this adapter can execute (at least one — descriptor honesty). */
    supportedRenderers: z.array(ComputeRendererSupport).min(1),
    /** Output latency classes this adapter serves (closed enum; at least one). */
    supportedLatencyClasses: z.array(z.enum(["offline", "near-live", "live"])).min(1),
    /** Maximum simultaneously executing jobs (integer >= 1). */
    maxConcurrentJobs: z.number().int().min(1),
    /** How long a dispatch handoff may take before it fails (finite > 0). */
    dispatchTimeoutMs: z.number().finite().positive(),
    /** The largest whole-job deadline this adapter accepts (finite > 0). */
    maxJobDeadlineMs: z.number().finite().positive(),
    /** The smallest whole-job deadline this adapter accepts (>= dispatch timeout). */
    minJobDeadlineMs: z.number().finite().positive().optional(),
    /** The cost units usage records may reference (at least one — metering is not optional). */
    costUnits: z.array(ComputeCostUnit).min(1),
  })
  .strict()
  .superRefine((descriptor, ctx) => {
    const seen = new Set<string>();
    for (const renderer of descriptor.supportedRenderers) {
      if (seen.has(renderer.rendererId)) {
        ctx.addIssue({
          code: "custom",
          path: ["supportedRenderers"],
          message: `duplicate supported rendererId '${renderer.rendererId}'`,
        });
        return;
      }
      seen.add(renderer.rendererId);
    }
    const unitIds = new Set<string>();
    for (const unit of descriptor.costUnits) {
      if (unitIds.has(unit.unitId)) {
        ctx.addIssue({
          code: "custom",
          path: ["costUnits"],
          message: `duplicate cost unitId '${unit.unitId}'`,
        });
        return;
      }
      unitIds.add(unit.unitId);
    }
    if (
      descriptor.minJobDeadlineMs !== undefined &&
      descriptor.minJobDeadlineMs > descriptor.maxJobDeadlineMs
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["minJobDeadlineMs"],
        message: `minJobDeadlineMs (${descriptor.minJobDeadlineMs}) must not exceed maxJobDeadlineMs (${descriptor.maxJobDeadlineMs})`,
      });
    }
  });
export type ComputeAdapterDescriptor = z.infer<typeof ComputeAdapterDescriptor>;

// ---------------------------------------------------------------------------
// Lifecycle states + decision/progress events
// ---------------------------------------------------------------------------

/**
 * The closed job-lifecycle vocabulary. Terminal members are VERBATIM the W303
 * `GpuTerminalDisposition`; `"queued"`/`"in-flight"` are VERBATIM live members
 * of the W303 `GpuJobState`; `"admitted"`/`"dispatched"` are the documented
 * adapter-level additions. Transition legality lives in ./states.ts and is
 * test-pinned.
 */
export const ComputeJobState = z.enum([
  "admitted",
  "dispatched",
  "queued",
  "in-flight",
  "succeeded",
  "failed",
  "cancelled",
  "dead-lettered",
]);
export type ComputeJobState = z.infer<typeof ComputeJobState>;

/** The terminal dispositions (exactly one per job — VERBATIM W303). */
export const ComputeTerminalDisposition = z.enum([
  "succeeded",
  "failed",
  "cancelled",
  "dead-lettered",
]);
export type ComputeTerminalDisposition = z.infer<typeof ComputeTerminalDisposition>;

/**
 * The terminal failure classification (VERBATIM the W303 `GpuTerminalClass`,
 * which extends the W302 DLQ taxonomy with the timeout class).
 */
export const ComputeTerminalClass = z.enum([
  "non-retryable",
  "retry-exhausted",
  "timeout",
  "internal",
]);
export type ComputeTerminalClass = z.infer<typeof ComputeTerminalClass>;

/**
 * The closed decision/progress-event vocabulary: the W303 `GpuJobEventType`
 * members VERBATIM (`submitted`, `claimed`, `lease-expired`, `requeued`,
 * `worker-stale`, `deadline-timeout`, `cancelled`, `superseded-report`,
 * `succeeded`, `failed`, `dead-lettered`) plus the adapter-level
 * `"dispatched"` (provider handoff) and `"progress"` (fractional progress,
 * for the W906 processing-state UX).
 */
export const ComputeJobEventType = z.enum([
  "submitted",
  "dispatched",
  "progress",
  "claimed",
  "lease-expired",
  "requeued",
  "worker-stale",
  "deadline-timeout",
  "cancelled",
  "superseded-report",
  "succeeded",
  "failed",
  "dead-lettered",
]);
export type ComputeJobEventType = z.infer<typeof ComputeJobEventType>;

/** A progress event: the fractional completion of the job (0 < fraction <= 1) plus an optional stage label. */
export const ComputeProgressEvent = z
  .object({
    schemaVersion: computeSchemaVersionField,
    jobId: nonEmpty,
    type: z.literal("progress"),
    /** Protocol-clock reading (injected; never wall time). */
    atMs: ms,
    /** Fraction of work completed (finite, > 0, <= 1). */
    fraction: z.number().finite().gt(0).lte(1),
    /** Optional stage label (non-empty; e.g. "encoding"). */
    stage: nonEmpty.optional(),
  })
  .strict();
export type ComputeProgressEvent = z.infer<typeof ComputeProgressEvent>;

/** A generic decision event with JSON-safe details (the W303 GpuJobEvent shape). */
export const ComputeDecisionEvent = z
  .object({
    schemaVersion: computeSchemaVersionField,
    jobId: nonEmpty,
    type: z.enum([
      "submitted",
      "dispatched",
      "claimed",
      "lease-expired",
      "requeued",
      "worker-stale",
      "deadline-timeout",
      "cancelled",
      "superseded-report",
      "succeeded",
      "failed",
      "dead-lettered",
    ]),
    atMs: ms,
    /** Structured, JSON-safe evidence (worker ids, error classes, ...). */
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type ComputeDecisionEvent = z.infer<typeof ComputeDecisionEvent>;

/** One lifecycle/progress event on a job's trail. */
export const ComputeJobEvent = z.discriminatedUnion("type", [
  ComputeProgressEvent,
  ComputeDecisionEvent,
]);
export type ComputeJobEvent = z.infer<typeof ComputeJobEvent>;

// ---------------------------------------------------------------------------
// Dispatch handle + outcomes
// ---------------------------------------------------------------------------

/** The handle an admitted dispatch returns (the W303 GpuSubmitHandle "admitted" arm). */
export const ComputeJobHandle = z
  .object({
    schemaVersion: computeSchemaVersionField,
    jobId: nonEmpty,
    idempotencyKey: nonEmpty,
    sessionId: nonEmpty,
    rendererId: nonEmpty,
    /** The adapter that admitted the job. */
    adapterId: nonEmpty,
    /** Protocol-clock reading at admission (injected). */
    admittedAtMs: ms,
  })
  .strict();
export type ComputeJobHandle = z.infer<typeof ComputeJobHandle>;

/**
 * The resolved disposition of one dispatch: `admitted` (a handle) or
 * `duplicate` (a KNOWN idempotency key — counted, skipped, never
 * double-claimed; the W303 GpuSubmitHandle "duplicate" arm, with the job's
 * live state instead of W303's in-process key registry view).
 */
export const ComputeDispatchOutcome = z.discriminatedUnion("disposition", [
  z
    .object({
      disposition: z.literal("admitted"),
      handle: ComputeJobHandle,
    })
    .strict(),
  z
    .object({
      disposition: z.literal("duplicate"),
      jobId: nonEmpty,
      idempotencyKey: nonEmpty,
      jobState: ComputeJobState,
    })
    .strict(),
]);
export type ComputeDispatchOutcome = z.infer<typeof ComputeDispatchOutcome>;

/** The resolved disposition of one cancel (VERBATIM the W303 GpuCancelOutcome shape). */
export const ComputeCancelOutcome = z.discriminatedUnion("cancelled", [
  z
    .object({
      cancelled: z.literal(true),
      jobId: nonEmpty,
    })
    .strict(),
  z
    .object({
      cancelled: z.literal(false),
      jobId: nonEmpty,
      /** The existing terminal disposition (idempotent no-op). */
      terminalDisposition: ComputeTerminalDisposition,
    })
    .strict(),
]);
export type ComputeCancelOutcome = z.infer<typeof ComputeCancelOutcome>;

// ---------------------------------------------------------------------------
// Input accounting (never silent)
// ---------------------------------------------------------------------------

/** Why one manifested input was not consumed. */
export const ComputeUnconsumedInput = z
  .object({
    inputId: nonEmpty,
    reason: nonEmpty,
  })
  .strict();
export type ComputeUnconsumedInput = z.infer<typeof ComputeUnconsumedInput>;

/**
 * The per-job input accounting block: every manifested input is accounted in
 * EXACTLY ONE of `consumedInputIds` / `unconsumedInputs` — a completed job
 * may not silently drop an input, and a failed job must carry reasons. The
 * manifest-level check (consumed + unconsumed partitions the job's manifest)
 * needs the job description and is enforced by the adapter; this schema
 * enforces the decidable part: no overlap, no duplicates within a list.
 */
export const ComputeInputAccounting = z
  .object({
    /** Manifest inputs the execution consumed. */
    consumedInputIds: z.array(nonEmpty),
    /** Manifest inputs the execution did NOT consume, each with a reason. */
    unconsumedInputs: z.array(ComputeUnconsumedInput),
  })
  .strict()
  .superRefine((accounting, ctx) => {
    const consumed = new Set(accounting.consumedInputIds);
    if (consumed.size !== accounting.consumedInputIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["consumedInputIds"],
        message: "duplicate inputId in consumedInputIds",
      });
      return;
    }
    const unconsumed = new Set<string>();
    for (const entry of accounting.unconsumedInputs) {
      if (unconsumed.has(entry.inputId)) {
        ctx.addIssue({
          code: "custom",
          path: ["unconsumedInputs"],
          message: `duplicate inputId '${entry.inputId}' in unconsumedInputs`,
        });
        return;
      }
      unconsumed.add(entry.inputId);
    }
    for (const id of consumed) {
      if (unconsumed.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["unconsumedInputs"],
          message: `inputId '${id}' is both consumed and unconsumed`,
        });
        return;
      }
    }
  });
export type ComputeInputAccounting = z.infer<typeof ComputeInputAccounting>;

// ---------------------------------------------------------------------------
// Output artifact handoff (the W504-aligned shape; R2 wiring is W912)
// ---------------------------------------------------------------------------

/**
 * How a completed output artifact is delivered to the control plane:
 * `inline` (the bytes ride the completion envelope — small outputs, or a
 * pre-W912 deployment) or `stored` (the provider already wrote the artifact
 * through the output-store seam; the receipt names the store). The
 * content-addressed identity is REQUIRED in both modes — the control plane
 * never trusts unnamed bytes.
 */
export const ComputeArtifactDelivery = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("inline"),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("stored"),
      receipt: z
        .object({
          /** The store the artifact landed in (W504 port implementor's id). */
          storeId: nonEmpty,
          /** Protocol-clock reading of the store (injected). */
          storedAtMs: ms,
        })
        .strict(),
    })
    .strict(),
]);
export type ComputeArtifactDelivery = z.infer<typeof ComputeArtifactDelivery>;

/**
 * One output artifact handed back by a completed job: the content-addressed
 * identity (sha-256, W504 convention), content type, byte length, the
 * deterministic manifest (opaque at this layer — W504 `AnimeSegmentManifest`
 * is the live precedent), the W504 store-scope metadata (field names
 * VERBATIM `AnimeArtifactMetadata`), and the delivery mode.
 */
export const ComputeOutputArtifact = z
  .object({
    schemaVersion: computeSchemaVersionField,
    /** The content-addressed artifact id (sha-256, 64 lowercase hex). */
    artifactId: sha256,
    /** sha-256 of the content — MUST equal artifactId (content addressing). */
    contentHash: sha256,
    contentType: nonEmpty,
    byteLength: z.number().int().min(0),
    /** The deterministic container manifest (opaque, JSON-safe). */
    manifest: z.unknown(),
    metadata: z
      .object({
        sessionId: nonEmpty,
        renderId: nonEmpty.optional(),
        segmentId: nonEmpty.optional(),
        snapshotVersion: z.number().int().min(0).optional(),
        frameCount: z.number().int().min(0).optional(),
        totalDurationMs: z.number().finite().min(0).optional(),
      })
      .strict(),
    delivery: ComputeArtifactDelivery,
  })
  .strict()
  .superRefine((artifact, ctx) => {
    if (artifact.artifactId !== artifact.contentHash) {
      ctx.addIssue({
        code: "custom",
        path: ["contentHash"],
        message: "contentHash must equal artifactId (content-addressed identity)",
      });
    }
    if (
      artifact.delivery.mode === "inline" &&
      artifact.byteLength !== utf8ByteLengthOf(artifact.delivery.content)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["byteLength"],
        message: `inline delivery byteLength (${artifact.byteLength}) does not match the content's UTF-8 byte length (${utf8ByteLengthOf(artifact.delivery.content)})`,
      });
    }
  });
export type ComputeOutputArtifact = z.infer<typeof ComputeOutputArtifact>;

// ---------------------------------------------------------------------------
// Usage / metering records (W919's raw material)
// ---------------------------------------------------------------------------

/** One metered cost quantity, in a unit the adapter's descriptor declared. */
export const ComputeCostQuantity = z
  .object({
    unitId: nonEmpty,
    /** Metered quantity (finite >= 0; the unit's kind gives the semantics). */
    quantity: z.number().finite().min(0),
  })
  .strict();
export type ComputeCostQuantity = z.infer<typeof ComputeCostQuantity>;

/**
 * The per-job usage record: what a hosted adapter must meter for W919 — the
 * provider identity, the job's timing envelope (W303 names), attempt/claim
 * counts, and cost quantities in the DECLARED units. Metering totality: one
 * record per terminally-disposed job, never silent (cancelled-never-executed
 * jobs carry one too, with zero-valued units).
 */
export const ComputeUsageRecord = z
  .object({
    schemaVersion: computeSchemaVersionField,
    jobId: nonEmpty,
    idempotencyKey: nonEmpty,
    sessionId: nonEmpty,
    /** The adapter that executed the job. */
    adapterId: nonEmpty,
    /** The provider that executed the job (abstract identity, never a vendor). */
    providerId: nonEmpty,
    /** The terminal disposition the usage is metered for. */
    terminalDisposition: ComputeTerminalDisposition,
    timing: z
      .object({
        /** Time from admission to execution start (W303 queueWaitMs, >= 0). */
        queueWaitMs: z.number().finite().min(0),
        /** Total reported execution time (W303 executionMs, >= 0). */
        executionMs: z.number().finite().min(0),
      })
      .strict(),
    /** Total executor invocations reported (W303 attempts). */
    attempts: z.number().int().min(0),
    /** Total claims (lease epochs) consumed (W303 claims; 0 when never executed). */
    claims: z.number().int().min(0),
    /** Metered quantities, each in a descriptor-declared unit (unique unitIds). */
    costUnits: z.array(ComputeCostQuantity).min(1),
    /** Protocol-clock reading at metering (injected). */
    meteredAtMs: ms,
  })
  .strict()
  .superRefine((record, ctx) => {
    const seen = new Set<string>();
    for (const unit of record.costUnits) {
      if (seen.has(unit.unitId)) {
        ctx.addIssue({
          code: "custom",
          path: ["costUnits"],
          message: `duplicate cost unitId '${unit.unitId}'`,
        });
        return;
      }
      seen.add(unit.unitId);
    }
  });
export type ComputeUsageRecord = z.infer<typeof ComputeUsageRecord>;

// ---------------------------------------------------------------------------
// Terminal completion envelope (accounting totality)
// ---------------------------------------------------------------------------

/** Job timing measured on the injected clocks (VERBATIM W303 GpuJobResultTiming fields). */
export const ComputeJobTiming = z
  .object({
    submittedAtMs: ms,
    startedAtMs: ms.optional(),
    finishedAtMs: ms,
    queueWaitMs: ms.optional(),
    executionMs: z.number().finite().min(0),
  })
  .strict()
  .superRefine((timing, ctx) => {
    if (timing.startedAtMs !== undefined && timing.startedAtMs < timing.submittedAtMs) {
      ctx.addIssue({
        code: "custom",
        path: ["startedAtMs"],
        message: "startedAtMs cannot precede submittedAtMs",
      });
    }
    if (timing.finishedAtMs < timing.submittedAtMs) {
      ctx.addIssue({
        code: "custom",
        path: ["finishedAtMs"],
        message: "finishedAtMs cannot precede submittedAtMs",
      });
    }
  });
export type ComputeJobTiming = z.infer<typeof ComputeJobTiming>;

/** Failure details on a completion envelope (VERBATIM the W303 GpuJobFailure shape). */
export const ComputeJobFailure = z
  .object({
    errorClass: nonEmpty,
    message: nonEmpty,
    terminal: ComputeTerminalClass,
  })
  .strict();
export type ComputeJobFailure = z.infer<typeof ComputeJobFailure>;

/**
 * The terminal envelope of one compute job — resolves EXACTLY ONCE, when the
 * job reaches its EXACTLY-ONE terminal disposition. Failures are VALUES
 * (the W303 posture): `status` is the submitter-facing outcome (`dead-lettered`
 * resolves `failed`), `terminalDisposition` keeps the ledger bucket disjoint,
 * and `failure.terminal` must be consistent with the bucket (W303 §7:
 * `failed` = `non-retryable`/`timeout`; `dead-lettered` =
 * `retry-exhausted`/`internal`). Every completion carries the input
 * accounting block and its usage record — never silent.
 */
export const ComputeJobCompletion = z
  .object({
    schemaVersion: computeSchemaVersionField,
    jobId: nonEmpty,
    idempotencyKey: nonEmpty,
    sessionId: nonEmpty,
    /** The submitter-facing result status (VERBATIM W303 GpuJobResult.status). */
    status: z.enum(["succeeded", "failed", "cancelled"]),
    /** The ledger bucket (VERBATIM W303 GpuTerminalDisposition). */
    terminalDisposition: ComputeTerminalDisposition,
    /** Present iff status === "failed" (VERBATIM W303 GpuJobFailure). */
    failure: ComputeJobFailure.optional(),
    /** Output artifacts (non-empty only when succeeded). */
    outputs: z.array(ComputeOutputArtifact),
    /** Total executor invocations reported (W303 attempts). */
    attempts: z.number().int().min(0),
    /** Total claims (lease epochs) consumed (W303 claims; 0 when never executed). */
    claims: z.number().int().min(0),
    /** The job's measured timing envelope (W303 names). */
    timing: ComputeJobTiming,
    /** The never-silent input accounting (ALWAYS present). */
    accounting: ComputeInputAccounting,
    /** The metering record for this terminal job (ALWAYS present). */
    usage: ComputeUsageRecord,
  })
  .strict()
  .superRefine((completion, ctx) => {
    // status ↔ terminalDisposition coupling (dead-lettered resolves failed).
    if (completion.terminalDisposition === "dead-lettered") {
      if (completion.status !== "failed") {
        ctx.addIssue({
          code: "custom",
          path: ["status"],
          message: 'terminalDisposition "dead-lettered" must resolve status "failed"',
        });
      }
    } else if (completion.status !== completion.terminalDisposition) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: `status "${completion.status}" must equal terminalDisposition "${completion.terminalDisposition}"`,
      });
    }
    // failure presence coupling.
    if (completion.status === "failed" && completion.failure === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["failure"],
        message: 'status "failed" requires failure details',
      });
    }
    if (completion.status !== "failed" && completion.failure !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["failure"],
        message: `failure details are only legal when status is "failed" (got "${completion.status}")`,
      });
    }
    // outputs only on success.
    if (completion.status !== "succeeded" && completion.outputs.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["outputs"],
        message: `outputs are only legal when status is "succeeded" (got "${completion.status}")`,
      });
    }
    // terminal-class ↔ bucket coupling (W303 §7).
    if (completion.failure !== undefined) {
      const allowed: readonly string[] =
        completion.terminalDisposition === "dead-lettered"
          ? ["retry-exhausted", "internal"]
          : ["non-retryable", "timeout"];
      if (!allowed.includes(completion.failure.terminal)) {
        ctx.addIssue({
          code: "custom",
          path: ["failure", "terminal"],
          message: `terminal class "${completion.failure.terminal}" is not legal for terminalDisposition "${completion.terminalDisposition}"`,
        });
      }
    }
    // usage-record coupling: the record meters THIS job's disposition.
    if (completion.usage.terminalDisposition !== completion.terminalDisposition) {
      ctx.addIssue({
        code: "custom",
        path: ["usage", "terminalDisposition"],
        message: "the usage record must meter the same terminal disposition as the completion",
      });
    }
    if (completion.usage.jobId !== completion.jobId) {
      ctx.addIssue({
        code: "custom",
        path: ["usage", "jobId"],
        message: "the usage record must meter the same job as the completion",
      });
    }
  });
export type ComputeJobCompletion = z.infer<typeof ComputeJobCompletion>;

// ---------------------------------------------------------------------------
// Job snapshot (the poll result)
// ---------------------------------------------------------------------------

/**
 * The poll-able state of one job: its live/terminal state, its full event
 * trail, and its (possibly partial) input accounting. Terminal snapshots
 * carry the completion envelope instead.
 */
export const ComputeJobSnapshot = z
  .object({
    schemaVersion: computeSchemaVersionField,
    jobId: nonEmpty,
    idempotencyKey: nonEmpty,
    sessionId: nonEmpty,
    state: ComputeJobState,
    /** The decision/progress trail in occurrence order. */
    events: z.array(ComputeJobEvent),
    /** Present once the job is terminally disposed. */
    completion: ComputeJobCompletion.optional(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const isTerminal = (snapshot.state === "succeeded" ||
      snapshot.state === "failed" ||
      snapshot.state === "cancelled" ||
      snapshot.state === "dead-lettered") as boolean;
    if (isTerminal && snapshot.completion === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["completion"],
        message: `terminal state "${snapshot.state}" requires the completion envelope`,
      });
    }
    if (!isTerminal && snapshot.completion !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["completion"],
        message: `live state "${snapshot.state}" must not carry a completion envelope`,
      });
    }
    if (
      snapshot.completion !== undefined &&
      snapshot.completion.terminalDisposition !== snapshot.state
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["state"],
        message: "the snapshot state must equal the completion's terminalDisposition",
      });
    }
  });
export type ComputeJobSnapshot = z.infer<typeof ComputeJobSnapshot>;

// ---------------------------------------------------------------------------
// Adapter-level accounting stats (the never-silent ledger)
// ---------------------------------------------------------------------------

/**
 * Whole-adapter accounting (the W303 GpuDispatchStats posture, reduced to
 * the compute-adapter's own identity):
 *
 *   `jobsDispatched === admitted + duplicates`
 *   `admitted === succeeded + failed + cancelled + deadLettered + inFlight`
 *   `inputsManifested === inputsConsumed + inputsUnconsumed + inputsInFlight`
 *   `usageRecords === succeeded + failed + cancelled + deadLettered`
 *     (exactly one record per terminally-disposed job — metering totality)
 *
 * An imbalance rejects settle (./accounting.ts), never a lying result.
 */
export const ComputeAdapterStats = z
  .object({
    /** Dispatch calls that entered the ledger (admitted + duplicates). */
    jobsDispatched: z.number().int().min(0),
    admitted: z.number().int().min(0),
    duplicates: z.number().int().min(0),
    succeeded: z.number().int().min(0),
    failed: z.number().int().min(0),
    cancelled: z.number().int().min(0),
    deadLettered: z.number().int().min(0),
    /** Not-yet-terminal jobs (0 at settle). */
    inFlight: z.number().int().min(0),
    /** Typed admission refusals (unsupported renderer/latency class, deadline bounds). */
    refusedAdmissions: z.number().int().min(0),
    /** Typed capacity refusals at dispatch (queue/admitted budget). */
    resourceRefusals: z.number().int().min(0),
    /** Malformed-description refusals (schema violations). */
    malformedDispatches: z.number().int().min(0),
    /** Rights refusals (source frames without the capability). */
    rightsRefusals: z.number().int().min(0),
    /** Sum of every manifested input across admitted jobs. */
    inputsManifested: z.number().int().min(0),
    inputsConsumed: z.number().int().min(0),
    inputsUnconsumed: z.number().int().min(0),
    /** Inputs of not-yet-terminal jobs (0 at settle). */
    inputsInFlight: z.number().int().min(0),
    /** Usage records emitted (one per terminal job). */
    usageRecords: z.number().int().min(0),
    /** Cancel calls against unknown jobs (typed throws). */
    unknownCancelTargets: z.number().int().min(0),
    /** Provider reports that lost the race to a terminal disposition (counted, never dropped). */
    supersededReports: z.number().int().min(0),
    /** Structurally invalid provider reports (lying providers — internal faults). */
    invalidProviderReports: z.number().int().min(0),
  })
  .strict();
export type ComputeAdapterStats = z.infer<typeof ComputeAdapterStats>;

/** A fresh all-zero stats snapshot. */
export function emptyComputeStats(): ComputeAdapterStats {
  return {
    jobsDispatched: 0,
    admitted: 0,
    duplicates: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    deadLettered: 0,
    inFlight: 0,
    refusedAdmissions: 0,
    resourceRefusals: 0,
    malformedDispatches: 0,
    rightsRefusals: 0,
    inputsManifested: 0,
    inputsConsumed: 0,
    inputsUnconsumed: 0,
    inputsInFlight: 0,
    usageRecords: 0,
    unknownCancelTargets: 0,
    supersededReports: 0,
    invalidProviderReports: 0,
  };
}
