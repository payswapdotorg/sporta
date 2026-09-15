/**
 * The compute-adapter PORTS (W914 Wave 1): the TypeScript interfaces a hosted
 * implementation satisfies in Wave 2. Transport-free at the type level, but
 * HTTP-shaped on purpose — every method is a request/response pair a Wave-2
 * hosted worker can map 1:1 onto HTTP routes without redesign:
 *
 * - `describe()`        → `GET  /v1/adapter` (the frozen descriptor document)
 * - `dispatch()`        → `POST /v1/jobs` (201-admitted / counted-duplicate / typed 4xx refusal)
 * - `getJob()`          → `GET  /v1/jobs/:jobId` (snapshot or 404)
 * - `subscribe()`       → long-poll or stream of the job's events
 * - `cancel()`          → `POST /v1/jobs/:jobId/cancel` (idempotent)
 * - `usage()`           → `GET  /v1/usage` (metering drain)
 *
 * The domain NEVER learns which provider executes: `ComputeAdapterPort` is
 * the only surface the hosted control plane sees, and the descriptor's
 * `providerKind` is an abstract closed vocabulary (architecture-lock §9
 * vendor neutrality).
 *
 * ## Failure posture (the W303 constitution, restated for this boundary)
 *
 * - Malformed job descriptions and typed admission refusals THROW
 *   (`ComputeValidationError` / `ComputeAdmissionError` /
 *   `ComputeResourceLimitError` / `ComputeRightsError`) — counted, logged,
 *   metered OUTSIDE the terminal identities; they never entered the ledger.
 * - A job that entered the ledger resolves EXACTLY ONE terminal completion;
 *   failures are VALUES inside the completion envelope, never rejected
 *   promises.
 * - Duplicate `idempotencyKey` dispatches resolve
 *   `{ disposition: "duplicate" }` — counted, skipped, never double-claimed.
 * - Cancel is idempotent and never loses a job; the eventual provider report
 *   of a cancelled job is accounted `superseded-report`, never dropped.
 * - Every terminally-disposed job carries EXACTLY ONE usage record
 *   (metering totality — never silent).
 */

import type {
  ComputeAdapterDescriptor,
  ComputeAdapterStats,
  ComputeCancelOutcome,
  ComputeDispatchOutcome,
  ComputeJobCompletion,
  ComputeJobDescription,
  ComputeJobEvent,
  ComputeJobSnapshot,
  ComputeOutputArtifact,
  ComputeUsageRecord,
} from "./schemas";

// ---------------------------------------------------------------------------
// The control-plane-facing port (what the hosted control plane consumes)
// ---------------------------------------------------------------------------

/** The sink a {@link ComputeAdapterPort.subscribe} consumer provides. */
export type ComputeEventSink = (event: ComputeJobEvent) => void;

/** A subscription handle: `unsubscribe()` stops delivery (idempotent). */
export interface ComputeSubscription {
  /** Stops event delivery. Calling it more than once is a no-op. */
  unsubscribe(): void;
}

/** Query for {@link ComputeAdapterPort.usage}. */
export interface ComputeUsageQuery {
  /** Only records for jobs of this session (omit = all). */
  sessionId?: string;
  /** Only records metered at or after this protocol-clock reading. */
  sinceMs?: number;
}

/**
 * THE compute-adapter port: dispatch, poll/subscribe, cancel, and meter —
 * the only surface the hosted control plane needs. Wave-2 hosted
 * implementations satisfy exactly this; the in-memory reference
 * (`./memory-adapter.ts`, TEST-ONLY) is the in-tree proof the contract is
 * implementable.
 */
export interface ComputeAdapterPort {
  /**
   * The adapter's frozen capability descriptor: supported renderers,
   * concurrency, timeouts, deadline bounds, cost units. Deep-equal stable
   * across calls (the W501 R1 identity-immutability posture) — hosts must
   * not rely on reference identity.
   */
  describe(): ComputeAdapterDescriptor;

  /**
   * Dispatches one job.
   *
   * - Malformed description ⇒ typed `ComputeValidationError` throw;
   * - descriptor-dishonest renderer/latency class/deadline ⇒ typed
   *   `ComputeAdmissionError` throw;
   * - `source-media` inputs without `canReferenceSourceFrames` ⇒ typed
   *   `ComputeRightsError` throw;
   * - capacity ⇒ typed `ComputeResourceLimitError` throw;
   * - known `idempotencyKey` ⇒ `{ disposition: "duplicate" }` (counted);
   * - otherwise `{ disposition: "admitted" }` with the handle.
   */
  dispatch(job: ComputeJobDescription): Promise<ComputeDispatchOutcome>;

  /**
   * Polls one job's snapshot (idempotent, cheap). `null` iff the adapter
   * never admitted the job — callers wanting the typed error use
   * `getJobOrFail`.
   */
  getJob(jobId: string): Promise<ComputeJobSnapshot | null>;

  /**
   * As {@link getJob} but throws `UnknownComputeJobError` for a job the
   * adapter never admitted (a poll that fabricates state for an unknown job
   * would be a silent lie).
   */
  getJobOrFail(jobId: string): Promise<ComputeJobSnapshot>;

  /**
   * Subscribes to one job's lifecycle/progress events: the PAST trail is
   * replayed to the sink synchronously (so no event between
   * dispatch-and-subscribe is lost), then live events flow until the job
   * reaches its terminal disposition (after which the subscription delivers
   * nothing further). Hosted implementations may back this with long-poll
   * or a stream — the PORT is transport-free.
   */
  subscribe(jobId: string, sink: ComputeEventSink): ComputeSubscription;

  /**
   * Cancels one job (idempotent, never loses a job):
   * live ⇒ cancelled (the provider's eventual report is accounted
   * `superseded-report`); terminal ⇒ counted no-op returning the existing
   * disposition; unknown ⇒ typed `UnknownComputeJobError` throw.
   */
  cancel(jobId: string): Promise<ComputeCancelOutcome>;

  /**
   * The metering drain: every usage record recorded so far (one per
   * terminally-disposed job — metering totality). Optionally filtered by
   * session and/or metering time.
   */
  usage(query?: ComputeUsageQuery): Promise<ComputeUsageRecord[]>;

  /** Whole-adapter accounting snapshot (all identities hold — ./accounting.ts). */
  stats(): ComputeAdapterStats;
}

// ---------------------------------------------------------------------------
// The provider-facing port (what a Wave-2 hosted worker implements)
// ---------------------------------------------------------------------------

/** The provider's acceptance of one submitted job. */
export interface ComputeProviderSubmission {
  /** Whether the provider took the job into its queue. */
  accepted: boolean;
  /**
   * When not accepted: the determinate reason. A provider refusal is a
   * DETERMINATE failure (the job resolves `failed` with a non-retryable or
   * resource-limit class) — never a silent drop.
   */
  reason?: {
    errorClass: string;
    message: string;
    terminal: "non-retryable" | "resource-limit";
  };
}

/** The provider's progress report for one executing job. */
export interface ComputeProviderProgress {
  /** Fraction of work completed (finite, > 0, <= 1). */
  fraction: number;
  /** Optional stage label (e.g. "encoding"). */
  stage?: string;
}

/** The execution outcome the provider reports for one job. */
export type ComputeProviderOutcome =
  | {
      status: "succeeded";
      /** The output artifacts (content-addressed, W504-aligned). */
      outputs: ComputeOutputArtifact[];
      /** Which manifest inputs the execution consumed. */
      consumedInputIds: string[];
    }
  | {
      status: "failed";
      errorClass: string;
      message: string;
      /** `retryable` failures consume the recovery budget; non-retryable never retry. */
      retryable: boolean;
      /** Which manifest inputs the execution consumed before failing. */
      consumedInputIds: string[];
    };

/**
 * The provider-side seam a Wave-2 hosted worker implements behind the
 * adapter: submit (idempotent by `jobId`), progress reporting while
 * executing, and the terminal outcome. This mirrors the W303
 * `GpuDispatcherPort` narrowness — JSON-safe messages, no transport
 * assumptions — so a hosted worker behind HTTP, a queue, or a managed actor
 * (the deployment-architecture's "bounded managed executor") satisfies the
 * same port.
 */
export interface ComputeProviderPort {
  /**
   * Submits one admitted job (idempotent by `jobId`: re-submitting a known
   * id is a no-op returning the original acceptance). Returns the
   * acceptance immediately; execution happens after.
   */
  submit(job: ComputeJobDescription): Promise<ComputeProviderSubmission>;

  /**
   * Reports that execution of one queued job STARTED (the W303 claim
   * notification: a lease was granted). Exactly once per execution round;
   * the adapter transitions the job `queued → in-flight`.
   */
  reportStarted(jobId: string): void;

  /**
   * Reports fractional progress for one executing job (no-op for a job that
   * is not executing — counted, never thrown).
   */
  reportProgress(jobId: string, progress: ComputeProviderProgress): void;

  /**
   * Registers the terminal outcome of one job. At most one per execution
   * round; a report racing a cancellation is counted `superseded-report` by
   * the adapter (never silently dropped — the W303 posture).
   */
  reportOutcome(jobId: string, outcome: ComputeProviderOutcome): void;
}

// ---------------------------------------------------------------------------
// Completion access (the settled result)
// ---------------------------------------------------------------------------

/**
 * Awaits one job's terminal completion. Resolves exactly once, when the
 * snapshot is terminal; the promise NEVER REJECTS — failures are values in
 * the completion envelope (the W303 result-promise posture). A job that
 * never reaches a terminal disposition is awaited forever (the caller cancels
 * or the deadline machinery disposes it — never a fabricated result).
 *
 * Implementation: subscription-backed (the past trail replays, then live
 * events); if the job is already terminal at call time, resolves
 * immediately. Awaiting an unknown job rejects with the typed
 * `UnknownComputeJobError` (fail-loud — the alternative is a lie).
 */
export function awaitCompletion(
  adapter: ComputeAdapterPort,
  jobId: string,
): Promise<ComputeJobCompletion> {
  return new Promise<ComputeJobCompletion>((resolve, reject) => {
    let settled = false;
    let subscription: ComputeSubscription | undefined;
    const finish = (completion: ComputeJobCompletion): void => {
      if (settled) return;
      settled = true;
      subscription?.unsubscribe();
      resolve(completion);
    };
    adapter
      .getJobOrFail(jobId)
      .then((snapshot) => {
        if (snapshot.completion !== undefined) {
          finish(snapshot.completion);
          return;
        }
        subscription = adapter.subscribe(jobId, (event) => {
          if (
            event.type === "succeeded" ||
            event.type === "failed" ||
            event.type === "dead-lettered" ||
            event.type === "cancelled"
          ) {
            // The terminal event implies the completion envelope exists on
            // the next poll; re-read the (now terminal) snapshot.
            adapter
              .getJobOrFail(jobId)
              .then((terminal) => {
                if (terminal.completion !== undefined) {
                  finish(terminal.completion);
                }
              })
              .catch(reject);
          }
        });
        // Re-check in case the job reached terminal between the first poll
        // and the subscription (the subscription replays the trail, but the
        // completion envelope re-read above only runs on live events).
        adapter
          .getJobOrFail(jobId)
          .then((second) => {
            if (second.completion !== undefined) {
              finish(second.completion);
            }
          })
          .catch(reject);
      })
      .catch(reject);
  });
}
