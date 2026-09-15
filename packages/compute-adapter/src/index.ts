/**
 * @sporta/compute-adapter — the provider-neutral compute-adapter CONTRACT
 * (W914 Wave 1): versioned zod schemas + transport-free TypeScript ports +
 * a test-only in-memory reference, so the hosted control plane can dispatch
 * REAL render jobs to REAL compute (CPU workers, GPU/on-demand workers, or a
 * bounded managed actor) WITHOUT the domain knowing which provider executes.
 *
 * ## What this package IS
 *
 * - **The contract layer only.** Every schema is strict (unknown keys
 *   reject), every vocabulary is closed, and every closed vocabulary either
 *   is VERBATIM from an existing package (W303/W304/W504/contracts/
 *   observability — cited per constant in ./schemas.ts) or a documented
 *   adapter-level addition. `test/vocabulary.test.ts` pins the alignment
 *   against the real packages so drift fails the suite.
 * - **Transport-free but HTTP-shaped**: `ComputeAdapterPort`
 *   (dispatch / poll / subscribe / cancel / meter) maps 1:1 onto hosted
 *   routes; `ComputeProviderPort` is the narrow seam a Wave-2 hosted worker
 *   implements (the W303 `GpuDispatcherPort` narrowness, restated).
 * - **Never silent**: terminal completions carry the full input accounting
 *   (every manifested input consumed-with-reason or unconsumed-with-reason),
 *   exactly one usage record per terminally-disposed job, and whole-adapter
 *   accounting identities that REJECT settle on imbalance (./accounting.ts).
 *
 * ## What this package is NOT
 *
 * - **No real provider is wired.** `InMemoryComputeAdapter` is TEST-ONLY
 *   (loudly marked): the deterministic proof the contract is implementable.
 *   Wiring a hosted worker (HTTP, queue, or managed actor over the real
 *   renderers) is the W914 Wave-2 implementation.
 * - **No transport, no clock, no randomness**: no network, no timers, no
 *   wall-clock reads, no RNG anywhere (grep-pinned by test/boundary.test.ts).
 *   Every timestamp comes from the caller's injected source.
 *
 * ## Module map
 *
 * - `schemas`: the versioned zod schemas — `ComputeJobDescription`,
 *   `ComputeAdapterDescriptor`, `ComputeJobHandle`/`ComputeDispatchOutcome`,
 *   `ComputeJobEvent` (decision + progress), `ComputeJobCompletion`,
 *   `ComputeOutputArtifact` (the W504-aligned artifact handoff),
 *   `ComputeUsageRecord`, `ComputeJobSnapshot`, `ComputeAdapterStats`;
 * - `states`: the closed lifecycle vocabulary + the legal-transition table +
 *   `assertComputeTransition` (illegal transitions reject loudly);
 * - `errors`: the typed boundary errors, classified with the contracts
 *   `TerminalFailureClass` vocabulary (media-invalid / resource-limit /
 *   rights-denied / internal);
 * - `accounting`: the four never-silent identities and their assertion;
 * - `adapter`: the ports — `ComputeAdapterPort` (control-plane side),
 *   `ComputeProviderPort` (provider side), `awaitCompletion`;
 * - `memory-adapter`: `InMemoryComputeAdapter` — ***TEST-ONLY***
 *   in-memory reference over a simulated provider port.
 *
 * The seam-by-seam audit behind every decision here is
 * `docs/work-items/w914-compute-adapter-audit.md`.
 */
// schemas (versioned zod contracts)
export {
  COMPUTE_SCHEMA_VERSION,
  ComputeAdapterDescriptor,
  ComputeAdapterStats,
  ComputeArtifactDelivery,
  ComputeCancelOutcome,
  ComputeCostQuantity,
  ComputeCostUnit,
  ComputeCostUnitKind,
  ComputeDecisionEvent,
  ComputeDispatchOutcome,
  ComputeInputAccounting,
  ComputeInputKind,
  ComputeInputRef,
  ComputeJobCompletion,
  ComputeJobConstraints,
  ComputeJobDescription,
  ComputeJobEvent,
  ComputeJobEventType,
  ComputeJobFailure,
  ComputeJobHandle,
  ComputeJobSnapshot,
  ComputeJobState,
  ComputeJobTiming,
  ComputeOutputArtifact,
  ComputeOutputProfile,
  ComputeProgressEvent,
  ComputeProviderKind,
  ComputeRendererSupport,
  ComputeRightsPosture,
  ComputeTerminalClass,
  ComputeTerminalDisposition,
  ComputeUnconsumedInput,
  ComputeUsageRecord,
  emptyComputeStats,
} from "./schemas";
// lifecycle state machine
export {
  COMPUTE_JOB_STATES,
  COMPUTE_LIVE_STATES,
  COMPUTE_TERMINAL_DISPOSITIONS,
  COMPUTE_TRANSITIONS,
  assertComputeTransition,
  canTransitionComputeJob,
  isTerminalComputeState,
} from "./states";
export type { ComputeLiveState } from "./states";
// typed boundary errors
export {
  COMPUTE_FAILURE_CLASSES,
  ComputeAdapterError,
  ComputeAdapterMisuseError,
  ComputeAdmissionError,
  ComputeResourceLimitError,
  ComputeRightsError,
  ComputeValidationError,
  UnknownComputeJobError,
  isClassifiedComputeError,
} from "./errors";
export type {
  ClassifiedComputeError,
  ComputeAdapterErrorDetails,
  ComputeFailureClass,
} from "./errors";
// accounting identities
export { COMPUTE_IDENTITY_LABELS, assertComputeAccounting } from "./accounting";
// ports
export {
  awaitCompletion,
  type ComputeAdapterPort,
  type ComputeEventSink,
  type ComputeProviderOutcome,
  type ComputeProviderPort,
  type ComputeProviderProgress,
  type ComputeProviderSubmission,
  type ComputeSubscription,
  type ComputeUsageQuery,
} from "./adapter";
// TEST-ONLY in-memory reference (not a production provider)
export {
  DEFAULT_IN_MEMORY_LIMITS,
  InMemoryComputeAdapter,
  type InMemoryComputeAdapterOptions,
  type InMemoryComputeLimits,
  type MeterUsageFn,
  type NowMsSource,
} from "./memory-adapter";
