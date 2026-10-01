/**
 * The external feed session (REL-031) — Phase 5's end-to-end story: a
 * CONTINUOUS external feed source driving the REL-024 platform-workspace
 * composition, batch after batch, over the imported authorities:
 *
 * ```
 * feed batch (media references + digests + rights bases)
 *   -> upload per item        (submitFeed's corpus path: registerReference
 *                               -> authorizeAccess -> recordAcquiredBytes —
 *                               real digests at birth, the rights gate)
 *   -> organization selection (the workspace session's own stages: the
 *                               registry's eligibility + visible evidence,
 *                               the DECLARED ordering — never a hidden
 *                               ranking)
 *   -> processing             (external-platform's FEED executor over the
 *                               embedded durable-jobs runtime — imported,
 *                               never reimplemented; PER-ITEM checkpoints)
 *   -> the quality gate       (the organization-declared gate the workspace
 *                               wires — the executor fails closed on it)
 *   -> artifact + evidence    (getOutput/getEvidence — the tenant-scoped
 *                               reads; the full evidence chain per batch)
 * ```
 *
 * THE COMPOSITION LAW (binding, inherited from workspace.ts): the feed
 * session is a TYPED CLIENT over the imported authorities — it is NEVER a
 * second job, rights, artifact, promotion or quality authority. It enqueues
 * nothing itself (`services.submitFeed` owns the durable enqueue), selects
 * nothing itself (the workspace session's stages ride the registry's choice
 * read model), executes nothing itself (`session.runJob` drives the
 * platform's executors through the embedded runtime), and gates nothing
 * itself (the executor's gate verdict is read back through `getEvidence`).
 *
 * RECOVERY (the Phase-5 durability law):
 * - a feed session SURVIVES a client disconnect: the session state lives
 *   server-side (the composition's staging ledger — the workspace's own
 *   uploads/journeys precedent), the durable truth lives in the job store,
 *   and `open()` is simply a new connection over the same canonical stores;
 * - a re-submitted batch CONVERGES by idempotency: every submission carries
 *   the deterministic key `feedSubmissionKey(feedSessionId, batchIndex)`,
 *   and the platform service's REL-029 law returns the SAME envelope for
 *   the same key + the identical request (the source is deterministic, so
 *   a re-derived batch is byte-identical to the original);
 * - a crashed worker resumes from the LAST PER-ITEM CHECKPOINT through the
 *   lease-expiry takeover (the durable-jobs machinery, driven by
 *   `session.runJob` on the accelerated clock);
 * - a CANCELLED feed session leaves NO partial authoritative output: the
 *   cooperative cancellation is requested through `services.cancelJob`,
 *   honored at the executor's next checkpoint, and the record carries the
 *   typed refusal only (`getOutput` refuses `platform.job-state`).
 *
 * THE FEED RECORD: an immutable, timestamp-free session record — items
 * submitted/accepted/refused/processed, per-batch REL-029 lineage (job id,
 * input digest, code version, artifact refs), the per-item digests
 * (declared vs the corpus's acquired/normalized checksums, joined through
 * the evidence bundle's source lineage), truncation/bounds if any, and the
 * provenance config. NO WALL CLOCK anywhere: every leg is a count, id,
 * digest, state or declared config — so `same seed + config` yields
 * deep-equal records, and an interrupted-then-resumed run yields the SAME
 * record as an uninterrupted one (the authoritative outcome is
 * history-independent; the lineage's `completedAt` leg is stripped exactly
 * like `lineageEquals` strips it).
 *
 * BOUNDS (enforced, never advisory): max items per batch, max accepted
 * items per session, max accrued cost (the selected organization's declared
 * per-run USD), and a per-batch latency ceiling measured on the durable
 * clock (`completedAt - createdAt` of the batch's job). A breach STOPS the
 * session and records the truncation honestly — remaining batches are
 * recorded as not-submitted, never silently dropped.
 */
import { z } from "zod";
import { EligibilityQuerySchema } from "@sporta/organization-registry";
import { isRegistryError } from "@sporta/organization-registry";
import { ChoiceOrderingInputSchema, EXTERNAL_SERVICE_VERSION } from "@sporta/external-platform";
import { isPlatformError } from "@sporta/external-platform";
import type { PlatformConnection, TenantScope } from "@sporta/external-platform";
import { isCorpusError } from "@sporta/historical-corpus";
import { lineageOf } from "@sporta/durable-jobs";
import type { JobRecord } from "@sporta/durable-jobs";
import { isWorkspaceError } from "./errors";
import type { PlatformWorkspace, WorkspaceSession } from "./workspace";
import type { SelectionMode } from "./domain";
import { createSequentialIdSource } from "./clock";
import type { IdSource } from "./clock";
import type {
  ExternalFeedBatchFamily,
  ExternalFeedBatchSpec,
  ExternalFeedItemKind,
  ExternalFeedItemSpec,
  ExternalFeedSource,
} from "./feed-source";
import { FeedBoundsError, FeedConflictError, FeedValidationError } from "./feed-errors";

// ---------------------------------------------------------------------------
// The bounds (enforced, never advisory)
// ---------------------------------------------------------------------------

/** The feed session's enforced bounds. */
export interface FeedBounds {
  /** The per-batch item ceiling — an oversized batch refuses typed AND stops the session. */
  readonly maxItemsPerBatch: number;
  /** The session-wide ceiling on ACCEPTED items (jobs' items). */
  readonly maxSessionItems: number;
  /** The session-wide ceiling on accrued cost (the org's declared per-run USD). */
  readonly maxCostUsd: number;
  /** The per-batch latency ceiling on the durable clock (job completedAt - createdAt, ms). */
  readonly maxBatchLatencyMs: number;
}

/** Zod schema for resolved bounds (positive, and the session cap dominates the batch cap). */
export const FeedBoundsSchema = z
  .object({
    maxItemsPerBatch: z.number().int().positive(),
    maxSessionItems: z.number().int().positive(),
    maxCostUsd: z.number().positive(),
    maxBatchLatencyMs: z.number().int().nonnegative(),
  })
  .refine((bounds) => bounds.maxSessionItems >= bounds.maxItemsPerBatch, {
    message:
      "maxSessionItems must be >= maxItemsPerBatch (the session cap dominates the batch cap)",
  });

/** The DECLARED default bounds (documented, exported, recorded in every feed record). */
export const DEFAULT_FEED_BOUNDS: FeedBounds = {
  maxItemsPerBatch: 8,
  maxSessionItems: 64,
  maxCostUsd: 100,
  maxBatchLatencyMs: 60_000,
};

/** Resolves + validates the session bounds (defaults for the absent legs). */
function resolveBounds(partial: Partial<FeedBounds> | undefined): FeedBounds {
  const merged: FeedBounds = { ...DEFAULT_FEED_BOUNDS, ...partial };
  const parsed = FeedBoundsSchema.safeParse(merged);
  if (!parsed.success) {
    throw new FeedValidationError(
      "the feed bounds violate the session contract shape",
      parsed.error.issues,
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// The selection spec (the composition's own selection stage configuration)
// ---------------------------------------------------------------------------

/** How the feed session selects the processing organization, per batch. */
export const FeedSelectionSpecSchema = z.union([
  z.object({ mode: z.literal("explicit"), organizationId: z.string().min(1) }),
  z.object({
    mode: z.literal("auto"),
    query: EligibilityQuerySchema,
    ordering: ChoiceOrderingInputSchema.optional(),
  }),
]);

export type FeedSelectionSpec = z.infer<typeof FeedSelectionSpecSchema>;

// ---------------------------------------------------------------------------
// The submission key (the at-least-once convergence rail, REL-029's law)
// ---------------------------------------------------------------------------

/**
 * The deterministic idempotency key of one batch's submission: every
 * submission of the same batch — first attempt or at-least-once re-affirmation
 * after a disconnect — carries this key, so the platform service's
 * convergence law returns the SAME envelope (the same durable job) for the
 * byte-identical re-derived request.
 */
export function feedSubmissionKey(feedSessionId: string, batchIndex: number): string {
  return `feed:${feedSessionId}:batch-${batchIndex}`;
}

// ---------------------------------------------------------------------------
// The feed record (immutable, timestamp-free)
// ---------------------------------------------------------------------------

/** A typed refusal leg — the boundary that owns the refusal names it. */
export interface FeedTypedRefusal {
  /** The owning boundary's stable code (e.g. "corpus.rights-basis-required"). */
  readonly code: string;
  /** The owning family's failure class, when the error carries one. */
  readonly failureClass: string | null;
  /** Where in the composition the refusal fired. */
  readonly stage: "bounds" | "selection" | "submission" | "output";
  readonly message: string;
}

/** One item's record in the feed session record. */
export interface FeedItemRecord {
  readonly itemId: string;
  readonly itemKind: ExternalFeedItemKind;
  readonly canonicalUrl: string;
  /** The corpus's source id (null when no job ever carried the item). */
  readonly sourceId: string | null;
  /** The digest the platform client declared (SHA-256 of its bytes, or null for references). */
  readonly declaredDigest: string | null;
  /** The corpus's acquired checksum (the authority), from the evidence lineage. */
  readonly acquiredChecksum: string | null;
  /** The corpus's normalized checksum (the authority), from the evidence lineage. */
  readonly normalizedChecksum: string | null;
  /** The per-item output digest from the artifact's lineage index. */
  readonly artifactChecksum: string | null;
  /**
   * Whether a durable checkpoint recorded the item as processed/skipped —
   * meaningful only for jobs without an authoritative outcome (null once
   * the item has one).
   */
  readonly checkpointed: boolean | null;
  readonly outcome:
    "transformed" | "skipped-reference" | "refused" | "unpublished" | "not-submitted";
}

/** The per-batch REL-029 lineage legs (the meaning projection — no timestamps). */
export interface FeedBatchLineage {
  readonly jobId: string;
  readonly kind: string;
  readonly attempts: number;
  readonly checkpointCount: number;
  /** SHA-256 of the canonical JSON of the job input (the content address of the request). */
  readonly inputDigest: string;
  readonly inputArtifactRefs: readonly string[];
  /** The executor's declared code version (null = undeclared — honest). */
  readonly codeVersion: string | null;
  readonly outputArtifactRefs: readonly string[];
  /** The store-level enqueue idempotency key (null — the service-level key governs feeds). */
  readonly idempotencyKey: string | null;
}

/** The artifact leg of a completed batch (content-addressed — no minted ids). */
export interface FeedBatchArtifact {
  readonly artifactRef: string;
  readonly checksum: string;
  readonly byteLength: number;
  readonly kind: "feed-output";
  readonly itemCount: number;
  readonly organizationId: string | null;
}

/** The quality-gate verdict leg of a completed batch. */
export interface FeedBatchQualityGate {
  readonly gateId: string;
  readonly passed: boolean;
  readonly checks: readonly { readonly name: string; readonly passed: boolean }[];
}

/** One batch's record. */
export interface FeedBatchRecord {
  readonly batchIndex: number;
  readonly family: ExternalFeedBatchFamily;
  readonly outcome:
    "completed" | "failed" | "cancelled" | "in-flight" | "refused" | "not-submitted";
  readonly jobId: string | null;
  readonly itemCount: number;
  /** The submission's transformable item count (null when no submission landed). */
  readonly transformableItemCount: number | null;
  readonly selection: {
    readonly organizationId: string;
    readonly organizationVersion: number;
    readonly mode: SelectionMode;
    readonly orderedBy: string | null;
    readonly candidatesConsidered: number;
  } | null;
  readonly lineage: FeedBatchLineage | null;
  readonly artifact: FeedBatchArtifact | null;
  readonly qualityGate: FeedBatchQualityGate | null;
  readonly items: readonly FeedItemRecord[];
  /** The typed refusal that owns this batch's refusal/failed/cancelled outcome. */
  readonly refusal: FeedTypedRefusal | null;
  /** The job record's own failure message (failed jobs), verbatim. */
  readonly jobFailure: string | null;
}

/** The truncation record — a bounds breach that stopped the session, honestly. */
export interface FeedTruncation {
  readonly kind: "max-items-per-batch" | "max-items" | "max-cost" | "latency-ceiling";
  readonly atBatchIndex: number;
  /** The bound that was breached (its configured value). */
  readonly limit: number;
  /** The observed value that breached it. */
  readonly observed: number;
  readonly unit: "items-per-batch" | "items" | "usd" | "ms";
  readonly batchesNotSubmitted: number;
  readonly itemsNotSubmitted: number;
  readonly detail: string;
}

/** The session totals (all counts — no wall clock anywhere). */
export interface FeedSessionTotals {
  readonly batches: number;
  /** Batches whose submission was attempted (accepted or refused at submission). */
  readonly batchesSubmitted: number;
  /** Batches whose submission landed (a durable job exists). */
  readonly batchesAccepted: number;
  readonly batchesCompleted: number;
  readonly batchesFailed: number;
  readonly batchesCancelled: number;
  readonly batchesRefused: number;
  readonly batchesNotSubmitted: number;
  readonly itemsSubmitted: number;
  readonly itemsAccepted: number;
  readonly itemsRefused: number;
  readonly itemsProcessed: number;
  readonly itemsSkipped: number;
  readonly itemsUnpublished: number;
  readonly itemsNotSubmitted: number;
  /** The accrued cost: the selected organizations' declared per-run USD over completed batches. */
  readonly costUsdAccrued: number;
}

/** The state of a feed session. */
export type FeedSessionState = "running" | "completed" | "truncated" | "cancelled";

/** THE FEED RECORD — the immutable session record (deeply frozen). */
export interface FeedSessionRecord {
  readonly feedSessionId: string;
  readonly scope: TenantScope;
  readonly provenance: {
    readonly sourceKind: string;
    readonly seed: string;
    readonly batchCount: number;
    readonly executorKind: "external.feed-processing";
    /** The imported application-service version every envelope carries. */
    readonly serviceVersion: number;
    readonly requireTransformation: boolean;
    readonly selection: {
      readonly mode: "auto" | "explicit";
      readonly organizationId: string | null;
    };
    readonly bounds: FeedBounds;
  };
  readonly batches: readonly FeedBatchRecord[];
  readonly totals: FeedSessionTotals;
  readonly truncation: FeedTruncation | null;
  /** Present when the session was cancelled (which in-flight job was cancelled). */
  readonly cancellation: { readonly inFlightJobId: string | null } | null;
  readonly outcome: FeedSessionState;
}

// ---------------------------------------------------------------------------
// The submission outcome (the submission-wave surface)
// ---------------------------------------------------------------------------

/** One submission wave's outcome (fresh, converged, or recorded refusal). */
export interface FeedBatchSubmission {
  readonly batchIndex: number;
  readonly family: ExternalFeedBatchFamily;
  /** The durable feed job this submission resolved to. */
  readonly jobId: string;
  /** True when this wave re-affirmed an interrupted submission (the convergence). */
  readonly convergentResubmission: boolean;
  readonly itemCount: number;
  readonly transformableItemCount: number | null;
  readonly organizationId: string | null;
}

// ---------------------------------------------------------------------------
// Options + the external feed
// ---------------------------------------------------------------------------

/** Everything the external feed composition needs. */
export interface ExternalFeedOptions {
  /** The REL-024 platform workspace (the composition this feed drives). */
  readonly workspace: PlatformWorkspace;
  /** The simulated external platform client's identity (the tenant scope carrier). */
  readonly platform: { readonly platformId: string; readonly tenantId: string };
  /** The typed external feed source (the continuous batched item stream). */
  readonly source: ExternalFeedSource;
  /** The selection configuration (explicit organization or auto under a declared ordering). */
  readonly selection: FeedSelectionSpec;
  /** Bounds overrides (defaults: {@link DEFAULT_FEED_BOUNDS}). */
  readonly bounds?: Partial<FeedBounds>;
  /** Must every item be transformable? Default true (the fail-closed feed law). */
  readonly requireTransformation?: boolean;
  /** Injected id source for the feed session id (default: `feed-1`, `feed-2`, ...). */
  readonly idSource?: IdSource;
}

/** One external feed: the server-side session state; `open()` mints client handles. */
export interface ExternalFeed {
  /** The feed session id (stable across opens — the reconnect identity). */
  readonly feedSessionId: string;
  /**
   * Opens (or reconnects to) the feed session: a NEW connection over the
   * same canonical stores, exactly where a real platform adapter sits.
   */
  open(): FeedSession;
}

/** A feed session handle over one connection (the client's wave surface). */
export interface FeedSession {
  readonly feedSessionId: string;
  /** The connection this handle rides (a reconnect is simply a new one). */
  readonly connection: PlatformConnection;
  /** The session state (running until completed / truncated / cancelled). */
  readonly state: FeedSessionState;
  /**
   * One submission wave: re-affirms the interrupted submission (the
   * at-least-once convergence) or submits the next pending batch. Typed
   * refusals are RECORDED and then re-thrown unchanged — the boundary that
   * owns the refusal throws it. Returns null when there is nothing to
   * submit (or the session has ended).
   */
  submitNext(): Promise<FeedBatchSubmission | null>;
  /**
   * Drives the feed to its end: re-drives interrupted batches from their
   * durable checkpoints, submits + drives the remaining ones. Per-batch
   * refusals are recorded (the feed continues); bounds breaches stop the
   * session with the truncation recorded; drive-level typed store faults
   * propagate (an honestly stuck session).
   */
  run(): Promise<FeedSessionRecord>;
  /**
   * Requests cancellation through the platform service: the in-flight
   * batch job's cooperative cancellation (honored at its next per-item
   * checkpoint) — no partial authoritative output is ever published.
   */
  cancel(): Promise<void>;
  /** The immutable feed record — the full projection, any time. */
  record(): Promise<FeedSessionRecord>;
}

// ---------------------------------------------------------------------------
// Internal staging state (the composition's own ledger — the workspace precedent)
// ---------------------------------------------------------------------------

/** The selection outcome recorded with each submitted batch. */
interface RecordedSelection {
  readonly organizationId: string;
  readonly organizationVersion: number;
  readonly mode: SelectionMode;
  readonly orderedBy: string | null;
  readonly candidatesConsidered: number;
  /** The selected organization's DECLARED per-run cost (the registry record). */
  readonly perRunUsd: number;
}

/** One batch's ledger entry (staging state; the durable truth is the job store). */
interface FeedLedgerEntry {
  /** Mutable: `submitted` -> `driven` once a drive reached drive-terminal state. */
  status: "submitted" | "refused" | "driven";
  readonly jobId: string | null;
  readonly refusal: FeedTypedRefusal | null;
  /** True when a submitFeed call was actually attempted for this batch. */
  readonly submissionAttempted: boolean;
  readonly itemCount: number;
  readonly transformableItemCount: number | null;
  readonly selection: RecordedSelection | null;
  /** The submission identity (the at-least-once re-submit reuses it verbatim). */
  readonly request: {
    readonly organizationId: string;
    readonly requireTransformation: boolean;
  } | null;
  /** Set when the batch's job reached `completed` (observed by a drive/post-drive). */
  completed: boolean;
}

/** The run-loop submit step's outcome. */
interface SubmitStepOutcome {
  readonly status: "submitted" | "refused" | "stopped";
  readonly submission: FeedBatchSubmission | null;
  /** The typed refusal error (recorded) — the wave surface re-throws it. */
  readonly error: unknown;
}

// ---------------------------------------------------------------------------
// The composition
// ---------------------------------------------------------------------------

/** Creates the external feed over the REL-024 workspace. */
export function createExternalFeed(options: ExternalFeedOptions): ExternalFeed {
  // -- the options validation (fail-closed, typed) ---------------------------
  if (
    typeof options.platform?.platformId !== "string" ||
    options.platform.platformId.length === 0 ||
    typeof options.platform?.tenantId !== "string" ||
    options.platform.tenantId.length === 0
  ) {
    throw new FeedValidationError(
      "the feed platform identity must carry non-empty platformId and tenantId",
    );
  }
  const parsedSelection = FeedSelectionSpecSchema.safeParse(options.selection);
  if (!parsedSelection.success) {
    throw new FeedValidationError(
      "the feed selection spec violates the session contract shape",
      parsedSelection.error.issues,
    );
  }
  const selectionSpec = parsedSelection.data;
  if (
    typeof options.source?.batchCount !== "number" ||
    !Number.isInteger(options.source.batchCount) ||
    options.source.batchCount < 0 ||
    typeof options.source?.batchAt !== "function"
  ) {
    throw new FeedValidationError(
      "the feed source must carry an integer batchCount and a batchAt(batchIndex) function",
    );
  }
  const bounds = resolveBounds(options.bounds);
  const requireTransformation = options.requireTransformation ?? true;
  const feedSessionId = (options.idSource ?? createSequentialIdSource("feed")).nextId();

  const source: ExternalFeedSource = options.source;
  const workspace = options.workspace;

  // -- the session staging state (server-side; survives client disconnects) --
  /** batchIndex -> the entry (absence = pending). */
  const ledger = new Map<number, FeedLedgerEntry>();
  let sessionState: FeedSessionState = "running";
  let truncation: Omit<FeedTruncation, "batchesNotSubmitted" | "itemsNotSubmitted"> | null = null;
  let cancellation: { readonly inFlightJobId: string | null } | null = null;

  // -- helpers ---------------------------------------------------------------

  /** The lowest index whose entry has the given status, or null. */
  function lowestIndexWithStatus(status: FeedLedgerEntry["status"]): number | null {
    for (let index = 0; index < source.batchCount; index += 1) {
      if (ledger.get(index)?.status === status) return index;
    }
    return null;
  }

  /** The lowest index with no entry yet (the pending frontier), or null. */
  function lowestPendingIndex(): number | null {
    for (let index = 0; index < source.batchCount; index += 1) {
      if (!ledger.has(index)) return index;
    }
    return null;
  }

  /** The accepted item count so far (items carried by landed jobs). */
  function acceptedItemCount(): number {
    let total = 0;
    for (const entry of ledger.values()) {
      if (entry.jobId !== null) total += entry.itemCount;
    }
    return total;
  }

  /** The accrued cost (completed batches × their org's declared per-run USD). */
  function accruedCostUsd(): number {
    let total = 0;
    for (const entry of ledger.values()) {
      if (entry.completed && entry.selection !== null) total += entry.selection.perRunUsd;
    }
    return round6(total);
  }

  /** Records a typed refusal for a batch (the ledger's honest refusal entry). */
  function recordRefusal(
    index: number,
    spec: ExternalFeedBatchSpec,
    stage: FeedTypedRefusal["stage"],
    error: unknown,
    attempted: boolean,
  ): void {
    const coded = error as { code?: unknown; failureClass?: unknown };
    const refusal: FeedTypedRefusal = {
      code: typeof coded?.code === "string" ? coded.code : "unknown",
      failureClass: typeof coded?.failureClass === "string" ? coded.failureClass : null,
      stage,
      message: error instanceof Error ? error.message : String(error),
    };
    ledger.set(index, {
      status: "refused",
      jobId: null,
      refusal,
      submissionAttempted: attempted,
      itemCount: spec.items.length,
      transformableItemCount: null,
      selection: null,
      request: null,
      completed: false,
    });
  }

  /** Sets the truncation + ends the session (the bounds law: stop + record). */
  function stopWithTruncation(
    truncationKind: FeedTruncation["kind"],
    atBatchIndex: number,
    limit: number,
    observed: number,
    unit: FeedTruncation["unit"],
    detail: string,
  ): void {
    truncation = { kind: truncationKind, atBatchIndex, limit, observed, unit, detail };
    sessionState = "truncated";
  }

  /** The submission request items (the deterministic re-derivation of a batch). */
  function feedItemsOf(spec: ExternalFeedBatchSpec): unknown[] {
    return spec.items.map((item) => ({
      metadata: item.metadata,
      ...(item.bytes !== null ? { bytes: item.bytes } : {}),
      ...(item.declaredBasis !== null ? { declaredBasis: item.declaredBasis } : {}),
    }));
  }

  /** The selection stage — the workspace composition's own (per batch). */
  async function selectOrganization(ws: WorkspaceSession): Promise<RecordedSelection> {
    if (selectionSpec.mode === "explicit") {
      const outcome = await ws.chooseOrganization({
        organizationId: selectionSpec.organizationId,
      });
      return {
        organizationId: outcome.organizationId,
        organizationVersion: outcome.organization.version,
        mode: outcome.mode,
        orderedBy: null,
        candidatesConsidered: outcome.candidatesConsidered,
        perRunUsd: outcome.organization.profile.cost.perRunUsd,
      };
    }
    const outcome = await ws.autoSelectOrganization({
      query: selectionSpec.query,
      ...(selectionSpec.ordering !== undefined ? { ordering: selectionSpec.ordering } : {}),
    });
    return {
      organizationId: outcome.organizationId,
      organizationVersion: outcome.organization.version,
      mode: outcome.mode,
      orderedBy: outcome.orderedBy,
      candidatesConsidered: outcome.candidatesConsidered,
      perRunUsd: outcome.organization.profile.cost.perRunUsd,
    };
  }

  /** The typed families the SELECTION stage records (everything else propagates). */
  function isSelectionRefusal(error: unknown): boolean {
    return isWorkspaceError(error) || isPlatformError(error) || isRegistryError(error);
  }

  /** The typed families the SUBMISSION stage records (everything else propagates). */
  function isSubmissionRefusal(error: unknown): boolean {
    return isPlatformError(error) || isCorpusError(error) || isRegistryError(error);
  }

  /**
   * One batch's submission step: the bounds gates, the selection stage, the
   * durable submission. Typed refusals are RECORDED (the ledger) and carried
   * in the outcome for the wave surface to re-throw; unknown faults propagate.
   */
  async function submitBatch(ws: WorkspaceSession, index: number): Promise<SubmitStepOutcome> {
    const spec = source.batchAt(index);

    // (1) the per-batch item ceiling — the typed bounds refusal AND the stop.
    if (spec.items.length > bounds.maxItemsPerBatch) {
      const error = new FeedBoundsError(
        `batch ${index} (${spec.family}) carries ${spec.items.length} items — the per-batch ` +
          `ceiling is ${bounds.maxItemsPerBatch} (the session refuses the oversized batch and ` +
          `stops; enforced, never advisory)`,
        { batchIndex: index, itemCount: spec.items.length, limit: bounds.maxItemsPerBatch },
      );
      recordRefusal(index, spec, "bounds", error, false);
      stopWithTruncation(
        "max-items-per-batch",
        index,
        bounds.maxItemsPerBatch,
        spec.items.length,
        "items-per-batch",
        `batch ${index} carries ${spec.items.length} items against the per-batch ceiling ` +
          `${bounds.maxItemsPerBatch} — the feed session stopped rather than submit an ` +
          `oversized batch`,
      );
      return { status: "stopped", submission: null, error };
    }

    // (2) the session-wide accepted-items ceiling (prospective — never start it).
    const acceptedSoFar = acceptedItemCount();
    if (acceptedSoFar + spec.items.length > bounds.maxSessionItems) {
      stopWithTruncation(
        "max-items",
        index,
        bounds.maxSessionItems,
        acceptedSoFar,
        "items",
        `accepting batch ${index} (${spec.items.length} items) would take the session to ` +
          `${acceptedSoFar + spec.items.length} accepted items against the session ceiling ` +
          `${bounds.maxSessionItems} — the feed session stopped honestly`,
      );
      return { status: "stopped", submission: null, error: undefined };
    }

    // (3) the selection stage — the composition's own (typed refusals recorded).
    let selection: RecordedSelection;
    try {
      selection = await selectOrganization(ws);
    } catch (error) {
      if (isSelectionRefusal(error)) {
        recordRefusal(index, spec, "selection", error, false);
        return { status: "refused", submission: null, error };
      }
      throw error;
    }

    // (4) the session cost ceiling (prospective — never start a breaching run).
    const accrued = accruedCostUsd();
    const prospective = round6(accrued + selection.perRunUsd);
    if (prospective > bounds.maxCostUsd) {
      stopWithTruncation(
        "max-cost",
        index,
        bounds.maxCostUsd,
        accrued,
        "usd",
        `the next batch would run under ${selection.organizationId} at ` +
          `$${selection.perRunUsd} per run — accrued $${accrued} + $${selection.perRunUsd} ` +
          `exceeds the session cost ceiling $${bounds.maxCostUsd} (the organization's own ` +
          `declared per-run cost, never re-computed here)`,
      );
      return { status: "stopped", submission: null, error: undefined };
    }

    // (5) THE SUBMISSION — the platform service (the corpus rides per item).
    const key = feedSubmissionKey(feedSessionId, index);
    try {
      const envelope = await workspace.services.submitFeed(ws.connection, {
        items: feedItemsOf(spec),
        organization: { organizationId: selection.organizationId },
        requireTransformation,
        idempotencyKey: key,
      });
      const result = envelope.result;
      ledger.set(index, {
        status: "submitted",
        jobId: result.jobId,
        refusal: null,
        submissionAttempted: true,
        itemCount: spec.items.length,
        transformableItemCount: result.transformableItemCount,
        selection,
        request: { organizationId: selection.organizationId, requireTransformation },
        completed: false,
      });
      return {
        status: "submitted",
        submission: {
          batchIndex: index,
          family: spec.family,
          jobId: result.jobId,
          convergentResubmission: false,
          itemCount: result.itemCount,
          transformableItemCount: result.transformableItemCount,
          organizationId: result.organizationId,
        },
        error: undefined,
      };
    } catch (error) {
      if (isSubmissionRefusal(error)) {
        recordRefusal(index, spec, "submission", error, true);
        return { status: "refused", submission: null, error };
      }
      throw error;
    }
  }

  /** The at-least-once re-affirmation of an interrupted submission (the convergence). */
  async function resubmitBatch(ws: WorkspaceSession, index: number): Promise<FeedBatchSubmission> {
    const entry = ledger.get(index);
    if (entry === undefined || entry.status !== "submitted" || entry.request === null) {
      throw new FeedConflictError(
        `the re-affirmation of batch ${index} found no recorded submission identity`,
        { batchIndex: index },
      );
    }
    const spec = source.batchAt(index);
    const envelope = await workspace.services.submitFeed(ws.connection, {
      items: feedItemsOf(spec),
      organization: { organizationId: entry.request.organizationId },
      requireTransformation: entry.request.requireTransformation,
      idempotencyKey: feedSubmissionKey(feedSessionId, index),
    });
    if (envelope.result.jobId !== entry.jobId) {
      // Impossible under REL-029's convergence law — refused typed, never
      // silently accepted (the invariant guard).
      throw new FeedConflictError(
        `the re-submitted batch ${index} converged to job ${envelope.result.jobId} — not the ` +
          `recorded job ${entry.jobId} (the at-least-once re-affirmation must resolve to the ` +
          `one durable job)`,
        { batchIndex: index, recordedJobId: entry.jobId, convergedJobId: envelope.result.jobId },
      );
    }
    return {
      batchIndex: index,
      family: spec.family,
      jobId: entry.jobId,
      convergentResubmission: true,
      itemCount: envelope.result.itemCount,
      transformableItemCount: envelope.result.transformableItemCount,
      organizationId: envelope.result.organizationId,
    };
  }

  /** Drives one submitted batch's job to its drive-terminal state. */
  async function driveBatch(ws: WorkspaceSession, index: number): Promise<void> {
    const entry = ledger.get(index);
    if (entry === undefined || entry.jobId === null) {
      throw new FeedConflictError(`the drive of batch ${index} found no recorded durable job`, {
        batchIndex: index,
      });
    }
    // Isolation-checked read first (the service boundary — a foreign job is
    // a typed not-found); an already-terminal job needs no drive.
    const jobRead = await ws.job({ jobId: entry.jobId });
    const state = jobRead.job.state;
    if (state !== "completed" && state !== "cancelled" && state !== "failed") {
      // One driven attempt — the embedded runtime executing the platform's
      // FEED executor (takeover-resume from the per-item checkpoints included).
      await ws.runJob({ jobId: entry.jobId });
    }
    entry.status = "driven";
  }

  /**
   * Post-drive: observe the completion (the authority's record), enforce the
   * per-batch latency ceiling. Returns true when the session must stop.
   */
  async function postDriveBatch(index: number): Promise<boolean> {
    const entry = ledger.get(index);
    if (entry === undefined || entry.jobId === null) return false;
    const record = await workspace.jobs.get(entry.jobId);
    if (record.state !== "completed") return false;
    entry.completed = true;
    const latencyMs = (record.completedAt ?? record.createdAt) - record.createdAt;
    if (latencyMs > bounds.maxBatchLatencyMs) {
      stopWithTruncation(
        "latency-ceiling",
        index,
        bounds.maxBatchLatencyMs,
        latencyMs,
        "ms",
        `batch ${index} completed in ${latencyMs}ms on the durable clock (job ` +
          `${entry.jobId}: completedAt - createdAt) — the per-batch latency ceiling is ` +
          `${bounds.maxBatchLatencyMs}ms — the feed session stopped honestly`,
      );
      return true;
    }
    return false;
  }

  // -- the record assembly (the pure projection over ledger + durable state) --

  /** The job input's items (the service's own submission order — positional). */
  function jobInputItems(record: JobRecord): readonly { sourceId: string }[] {
    const input = record.input as { items?: unknown } | null;
    if (typeof input !== "object" || input === null || !Array.isArray(input.items)) return [];
    return input.items as { sourceId: string }[];
  }

  /** The last durable checkpoint's processed/skipped ids (the resume truth). */
  function checkpointIds(record: JobRecord): { processed: Set<string>; skipped: Set<string> } {
    const last = record.checkpoints[record.checkpoints.length - 1];
    const state = last?.state as { processedItems?: unknown; skippedItems?: unknown } | undefined;
    return {
      processed: new Set<string>(
        Array.isArray(state?.processedItems) ? (state.processedItems as string[]) : [],
      ),
      skipped: new Set<string>(
        Array.isArray(state?.skippedItems) ? (state.skippedItems as string[]) : [],
      ),
    };
  }

  /** The typed output refusal of a non-completed job (fail-closed, captured). */
  async function outputRefusal(
    ws: WorkspaceSession,
    jobId: string,
  ): Promise<FeedTypedRefusal | null> {
    try {
      await ws.output({ jobId });
      return null;
    } catch (error) {
      if (isPlatformError(error)) {
        return {
          code: error.code,
          failureClass: error.failureClass,
          stage: "output",
          message: error.message,
        };
      }
      throw error;
    }
  }

  /** One item's record for a batch with no authoritative outcome. */
  function unpublishedItem(
    item: ExternalFeedItemSpec,
    sourceId: string | null,
    checkpointed: boolean,
  ): FeedItemRecord {
    return {
      itemId: item.itemId,
      itemKind: item.kind,
      canonicalUrl: item.metadata.canonicalUrl,
      sourceId,
      declaredDigest: item.declaredDigest,
      acquiredChecksum: null,
      normalizedChecksum: null,
      artifactChecksum: null,
      checkpointed,
      outcome: "unpublished",
    };
  }

  /** Assembles one batch's record (the authorities' own records, joined). */
  async function assembleBatchRecord(
    ws: WorkspaceSession,
    index: number,
  ): Promise<FeedBatchRecord> {
    const spec = source.batchAt(index);
    const entry = ledger.get(index);

    // Not-submitted (the truncation tail, or a snapshot before submission).
    if (entry === undefined) {
      return deepFreeze({
        batchIndex: index,
        family: spec.family,
        outcome: "not-submitted",
        jobId: null,
        itemCount: spec.items.length,
        transformableItemCount: null,
        selection: null,
        lineage: null,
        artifact: null,
        qualityGate: null,
        items: spec.items.map((item) => ({
          itemId: item.itemId,
          itemKind: item.kind,
          canonicalUrl: item.metadata.canonicalUrl,
          sourceId: null,
          declaredDigest: item.declaredDigest,
          acquiredChecksum: null,
          normalizedChecksum: null,
          artifactChecksum: null,
          checkpointed: null,
          outcome: "not-submitted",
        })),
        refusal: null,
        jobFailure: null,
      } satisfies FeedBatchRecord);
    }

    // Refused at a pre-drive stage (bounds / selection / submission).
    if (entry.status === "refused" && entry.jobId === null) {
      return deepFreeze({
        batchIndex: index,
        family: spec.family,
        outcome: "refused",
        jobId: null,
        itemCount: spec.items.length,
        transformableItemCount: null,
        selection: null,
        lineage: null,
        artifact: null,
        qualityGate: null,
        items: spec.items.map((item) => ({
          itemId: item.itemId,
          itemKind: item.kind,
          canonicalUrl: item.metadata.canonicalUrl,
          sourceId: null,
          declaredDigest: item.declaredDigest,
          acquiredChecksum: null,
          normalizedChecksum: null,
          artifactChecksum: null,
          checkpointed: null,
          outcome: "refused",
        })),
        refusal: entry.refusal,
        jobFailure: null,
      } satisfies FeedBatchRecord);
    }

    // A job exists — the durable record is the truth from here on.
    const jobId = entry.jobId;
    if (jobId === null) {
      throw new FeedConflictError(
        `the ledger entry of batch ${index} carries neither a job nor a refusal`,
        { batchIndex: index },
      );
    }
    const jobRecord = await workspace.jobs.get(jobId);
    const lineage = await lineageOf(jobRecord);
    const lineageLeg: FeedBatchLineage = {
      jobId: lineage.jobId,
      kind: lineage.kind,
      attempts: lineage.attempts,
      checkpointCount: lineage.checkpointCount,
      inputDigest: lineage.inputDigest,
      inputArtifactRefs: [...lineage.inputArtifactRefs],
      codeVersion: lineage.codeVersion,
      outputArtifactRefs: [...lineage.outputArtifactRefs],
      idempotencyKey: lineage.idempotencyKey,
    };
    const selectionLeg =
      entry.selection === null
        ? null
        : {
            organizationId: entry.selection.organizationId,
            organizationVersion: entry.selection.organizationVersion,
            mode: entry.selection.mode,
            orderedBy: entry.selection.orderedBy,
            candidatesConsidered: entry.selection.candidatesConsidered,
          };
    const refusal = await outputRefusal(ws, jobId);
    const jobFailure = jobRecord.failure === null ? null : jobRecord.failure.message;

    if (jobRecord.state === "completed") {
      // The authoritative retrieval legs — the tenant-scoped service reads.
      const outputRead = await ws.output({ jobId });
      const evidenceRead = await ws.evidence({ jobId });
      const artifact = outputRead.artifact;
      const evidence = evidenceRead.evidence;
      if (artifact.kind !== "feed-output") {
        // Fail-closed guard on an impossible state: the feed executor
        // publishes only feed outputs (the authority's own kind law).
        throw new FeedConflictError(
          `job ${jobId} published a '${artifact.kind}' artifact — the feed session records ` +
            `only feed outputs (the imported executor's own kind law)`,
          { jobId, kind: artifact.kind },
        );
      }
      const lineageByUrl = new Map(
        evidence.sourceLineage.map((line) => [line.canonicalUrl, line] as const),
      );
      const artifactChecksumBySource = new Map(
        artifact.items.map((item) => [item.sourceId, item.checksum] as const),
      );
      const items: FeedItemRecord[] = spec.items.map((item) => {
        const line = lineageByUrl.get(item.metadata.canonicalUrl);
        return {
          itemId: item.itemId,
          itemKind: item.kind,
          canonicalUrl: item.metadata.canonicalUrl,
          sourceId: line?.sourceId ?? null,
          declaredDigest: item.declaredDigest,
          acquiredChecksum: line?.acquiredChecksum ?? null,
          normalizedChecksum: line?.normalizedChecksum ?? null,
          artifactChecksum:
            line !== undefined ? (artifactChecksumBySource.get(line.sourceId) ?? null) : null,
          checkpointed: null,
          outcome: line?.outcome ?? "unpublished",
        };
      });
      return deepFreeze({
        batchIndex: index,
        family: spec.family,
        outcome: "completed",
        jobId,
        itemCount: spec.items.length,
        transformableItemCount: entry.transformableItemCount,
        selection: selectionLeg,
        lineage: lineageLeg,
        artifact: {
          artifactRef: artifact.artifactRef,
          checksum: artifact.checksum,
          byteLength: artifact.byteLength,
          kind: artifact.kind,
          itemCount: artifact.items.length,
          organizationId: artifact.organizationId,
        },
        qualityGate: {
          gateId: evidence.qualityGate.gateId,
          passed: evidence.qualityGate.passed,
          checks: evidence.qualityGate.checks.map((check) => ({
            name: check.name,
            passed: check.passed,
          })),
        },
        items,
        refusal: null,
        jobFailure: null,
      } satisfies FeedBatchRecord);
    }

    // Failed / cancelled / in-flight: no authoritative output exists — the
    // per-item truth is the durable checkpoint state, the refusal is typed.
    const inputItems = jobInputItems(jobRecord);
    const ids = checkpointIds(jobRecord);
    const items: FeedItemRecord[] = spec.items.map((item, position) => {
      const inputItem = inputItems[position];
      const sourceId = inputItem?.sourceId ?? null;
      const checkpointed =
        sourceId !== null && (ids.processed.has(sourceId) || ids.skipped.has(sourceId));
      return unpublishedItem(item, sourceId, checkpointed);
    });
    const outcome: FeedBatchRecord["outcome"] =
      jobRecord.state === "failed"
        ? "failed"
        : jobRecord.state === "cancelled"
          ? "cancelled"
          : "in-flight";
    return deepFreeze({
      batchIndex: index,
      family: spec.family,
      outcome,
      jobId,
      itemCount: spec.items.length,
      transformableItemCount: entry.transformableItemCount,
      selection: selectionLeg,
      lineage: lineageLeg,
      artifact: null,
      qualityGate: null,
      items,
      refusal,
      jobFailure,
    } satisfies FeedBatchRecord);
  }

  /** Assembles THE FEED RECORD (the full projection). */
  async function assembleRecord(ws: WorkspaceSession): Promise<FeedSessionRecord> {
    const batches: FeedBatchRecord[] = [];
    for (let index = 0; index < source.batchCount; index += 1) {
      batches.push(await assembleBatchRecord(ws, index));
    }

    // The totals fold (ledger + assembled outcomes — counts only).
    let batchesSubmitted = 0;
    let batchesAccepted = 0;
    let itemsSubmitted = 0;
    let itemsAccepted = 0;
    let itemsRefused = 0;
    let costUsdAccrued = 0;
    for (const [index, entry] of ledger) {
      if (entry.submissionAttempted) {
        batchesSubmitted += 1;
        itemsSubmitted += entry.itemCount;
      }
      if (entry.jobId !== null) {
        batchesAccepted += 1;
        itemsAccepted += entry.itemCount;
      } else {
        itemsRefused += entry.itemCount;
      }
      const batch = batches[index];
      if (batch !== undefined && batch.outcome === "completed" && entry.selection !== null) {
        costUsdAccrued = round6(costUsdAccrued + entry.selection.perRunUsd);
      }
    }
    let batchesCompleted = 0;
    let batchesFailed = 0;
    let batchesCancelled = 0;
    let itemsProcessed = 0;
    let itemsSkipped = 0;
    let itemsUnpublished = 0;
    let itemsNotSubmitted = 0;
    for (const batch of batches) {
      if (batch.outcome === "completed") batchesCompleted += 1;
      if (batch.outcome === "failed") batchesFailed += 1;
      if (batch.outcome === "cancelled") batchesCancelled += 1;
      if (batch.outcome === "not-submitted") itemsNotSubmitted += batch.itemCount;
      for (const item of batch.items) {
        if (item.outcome === "transformed") itemsProcessed += 1;
        if (item.outcome === "skipped-reference") itemsSkipped += 1;
        if (item.outcome === "unpublished") itemsUnpublished += 1;
      }
    }
    const batchesRefused = batches.filter((batch) => batch.outcome === "refused").length;
    const batchesNotSubmitted = batches.filter((batch) => batch.outcome === "not-submitted").length;

    const truncationLeg: FeedTruncation | null =
      truncation === null
        ? null
        : {
            ...truncation,
            batchesNotSubmitted,
            itemsNotSubmitted,
          };

    return deepFreeze({
      feedSessionId,
      scope: { platformId: options.platform.platformId, tenantId: options.platform.tenantId },
      provenance: {
        sourceKind: source.kind,
        seed: source.seed,
        batchCount: source.batchCount,
        executorKind: "external.feed-processing",
        serviceVersion: EXTERNAL_SERVICE_VERSION,
        requireTransformation,
        selection: {
          mode: selectionSpec.mode,
          organizationId: selectionSpec.mode === "explicit" ? selectionSpec.organizationId : null,
        },
        bounds,
      },
      batches,
      totals: {
        batches: source.batchCount,
        batchesSubmitted,
        batchesAccepted,
        batchesCompleted,
        batchesFailed,
        batchesCancelled,
        batchesRefused,
        batchesNotSubmitted,
        itemsSubmitted,
        itemsAccepted,
        itemsRefused,
        itemsProcessed,
        itemsSkipped,
        itemsUnpublished,
        itemsNotSubmitted,
        costUsdAccrued,
      },
      truncation: truncationLeg,
      cancellation,
      outcome: sessionState,
    } satisfies FeedSessionRecord);
  }

  // -- the session handle -----------------------------------------------------

  function openHandle(): FeedSession {
    // A reconnect is simply a new connection over the same canonical stores.
    const ws = workspace.connect({
      platformId: options.platform.platformId,
      tenantId: options.platform.tenantId,
    });

    const session: FeedSession = {
      feedSessionId,
      connection: ws.connection,
      get state(): FeedSessionState {
        return sessionState;
      },

      async submitNext(): Promise<FeedBatchSubmission | null> {
        if (sessionState !== "running") return null;
        // The at-least-once re-affirmation first: an interrupted submission
        // (submitted in a prior wave, not yet driven) converges under its key.
        const interrupted = lowestIndexWithStatus("submitted");
        if (interrupted !== null) {
          return resubmitBatch(ws, interrupted);
        }
        const pending = lowestPendingIndex();
        if (pending === null) return null;
        const outcome = await submitBatch(ws, pending);
        // The wave surface: the typed refusal is re-thrown UNCHANGED (the
        // boundary that owns it throws it) — after being recorded.
        if (outcome.error !== undefined) throw outcome.error;
        if (outcome.status !== "submitted") return null;
        return outcome.submission;
      },

      async run(): Promise<FeedSessionRecord> {
        if (sessionState !== "running") return assembleRecord(ws);
        for (let index = 0; index < source.batchCount; index += 1) {
          if (sessionState !== "running") break;
          const entry = ledger.get(index);
          if (entry !== undefined && (entry.status === "refused" || entry.status === "driven")) {
            continue; // already handled honestly
          }
          if (entry === undefined) {
            const outcome = await submitBatch(ws, index);
            if (outcome.status === "refused") continue; // recorded — the feed continues
            if (outcome.status === "stopped") break; // truncated — recorded
          }
          // The batch carries a submitted job (fresh or interrupted): drive it.
          await driveBatch(ws, index);
          if (sessionState !== "running") break;
          const stop = await postDriveBatch(index);
          if (stop) break;
        }
        if (sessionState === "running") sessionState = "completed";
        return assembleRecord(ws);
      },

      async cancel(): Promise<void> {
        if (sessionState !== "running") return;
        const inFlight = lowestIndexWithStatus("submitted");
        const jobId = inFlight !== null ? (ledger.get(inFlight)?.jobId ?? null) : null;
        if (jobId !== null) {
          // The cooperative cancellation request through the platform
          // service (tenant-scoped). Edge-terminal records refuse typed at
          // the store; the live state is read first so a just-completed
          // batch's authoritative output is never wrongly cancelled.
          const jobRead = await ws.job({ jobId });
          const state = jobRead.job.state;
          if (state !== "completed" && state !== "cancelled") {
            await workspace.services.cancelJob(ws.connection, { jobId });
          }
        }
        cancellation = { inFlightJobId: jobId };
        sessionState = "cancelled";
      },

      async record(): Promise<FeedSessionRecord> {
        return assembleRecord(ws);
      },
    };
    return session;
  }

  return {
    feedSessionId,
    open: openHandle,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Rounds to 6 decimal places (deterministic cost arithmetic). */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Deep freeze (the repo precedent): records handed out are immutable. */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    if (value instanceof Uint8Array) return value; // bytes stay usable
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    return Object.freeze(value);
  }
  return value;
}
