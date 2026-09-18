/**
 * The provider-plane REFUSAL layer (R402-R405): the typed vocabulary and
 * error the four real provider adapters throw when a provider cannot serve,
 * mapped onto the W914 `ComputeAdapterError` classification.
 *
 * ## Why this exists (the R401 vocabulary, restated at the adapter plane)
 *
 * The R401 compute broker (`@sporta/compute-adapter` `src/quote.ts`) defines
 * the CLOSED refusal vocabulary every provider-plane refusal travels as:
 *
 *   `"no-compatible-gpu" | "quota-exhausted" | "credential-invalid" |
 *      "budget-exceeded" | "provider-unavailable"`
 *
 * The provider adapters REUSE that vocabulary VERBATIM (imported, not
 * forked) as the `refusalReason` DATA every typed provider refusal carries —
 * a provider refusal never invents a new reason string, and a provider NAME
 * never appears in any vocabulary member (architecture-lock §9: provider
 * ids/names are DATA — adapter ids, descriptor fields, error details —
 * never contract members; test/vocabulary.test.ts pins this fail-closed).
 *
 * ## The refusal → W914 failure-class mapping (documented, test-pinned)
 *
 * Every typed refusal also carries the W914 `ComputeFailureClass`
 * (`@sporta/compute-adapter` `src/errors.ts`), because a dispatch-time
 * refusal must be classified for the control plane exactly like an
 * admission refusal:
 *
 * | refusalReason        | W914 class     | why |
 * |----------------------|----------------|-----|
 * | `provider-unavailable` | `resource-limit` | the compute resource is not obtainable right now (no credentials configured — the SandboxFallback posture — network/timeout/abort, or a 5xx); the W104/W303 "bounded resources refused the job" posture |
 * | `quota-exhausted`    | `resource-limit` | provider quota (HTTP 429) is literally a bounded resource |
 * | `no-compatible-gpu`  | `resource-limit` | a GPU-requiring workload against a CPU-only descriptor is the W104/W303 never-fits posture |
 * | `budget-exceeded`    | `resource-limit` | policy-bound exceeded (broker-level; mapped here so the table is total) |
 * | `credential-invalid` | `internal`     | a credential REJECTED by the provider is a deployment-configuration fault of THIS adapter instance — it is not a property of the workload (media-invalid would blame the job) and not a resource fact; the broker's own aggregate error may classify the same refusal coarsely for its caller-facing purpose, this is the adapter-boundary truth |
 *
 * The mapping is exported as the frozen {@link PROVIDER_REFUSAL_FAILURE_CLASSES}
 * record (total over the closed vocabulary) and pinned end-to-end by
 * every remote adapter's recorded-fixture tier plus the local live tier,
 * through every transport condition.
 */
import {
  ComputeAdapterError,
  COMPUTE_BROKER_REFUSALS,
  type ComputeBrokerRefusal,
  type ComputeFailureClass,
} from "@sporta/compute-adapter";

/** The R401 closed refusal vocabulary, REUSED VERBATIM (not forked). */
export const PROVIDER_REFUSAL_REASONS = COMPUTE_BROKER_REFUSALS;

/** The refusal-reason type (the R401 vocabulary member type, aliased). */
export type ProviderRefusalReason = ComputeBrokerRefusal;

/**
 * The total refusal → W914 failure-class map (see the module-doc table).
 * Frozen: a refusal reason NEVER changes class.
 */
export const PROVIDER_REFUSAL_FAILURE_CLASSES: Readonly<
  Record<ProviderRefusalReason, ComputeFailureClass>
> = Object.freeze({
  "no-compatible-gpu": "resource-limit",
  "quota-exhausted": "resource-limit",
  "credential-invalid": "internal",
  "budget-exceeded": "resource-limit",
  "provider-unavailable": "resource-limit",
});

/** The W914 failure class of one refusal reason (total, total-only). */
export function failureClassOfRefusal(reason: ProviderRefusalReason): ComputeFailureClass {
  return PROVIDER_REFUSAL_FAILURE_CLASSES[reason];
}

/** Transport-level evidence a provider refusal may carry (never a secret). */
export interface ProviderTransportEvidence {
  /** What the transport observed (closed vocabulary). */
  kind: "network" | "timeout" | "http" | "not-applicable";
  /** The HTTP status when `kind === "http"`. */
  status?: number;
  /** The provider's endpoint family that refused (data; e.g. "functions"). */
  endpoint?: string;
}

/**
 * One provider-plane refusal VALUE (what a provider client answers instead
 * of throwing): the closed-vocabulary reason, the human evidence, transport
 * evidence, whether the condition is PERMANENT for that provider job
 * (a status poll that 404s — the provider no longer knows the job — is
 * permanent: the ledger dead-letters it instead of polling forever), and
 * the optional provider-NATIVE error class a permanent refusal wants on
 * the dead-letter envelope (e.g. the R404 `pod-not-found` real cause).
 */
export interface ProviderRefusal {
  /** The typed reason (R401 closed vocabulary, DATA on the record). */
  reason: ProviderRefusalReason;
  /** Human-readable evidence (never empty). */
  message: string;
  /** Transport-level evidence (optional). */
  transport?: ProviderTransportEvidence;
  /** Whether retrying this exact call can never succeed (e.g. a 404 status poll). */
  permanent?: boolean;
  /** The provider-native error class for the dead-letter envelope (permanent refusals). */
  terminalErrorClass?: string;
}

/** Builds a refusal value (fail-loud on an empty message). */
export function providerRefusal(
  reason: ProviderRefusalReason,
  message: string,
  extra: Pick<ProviderRefusal, "transport" | "permanent" | "terminalErrorClass"> = {},
): ProviderRefusal {
  if (message.length === 0) {
    throw new Error("a provider refusal message is never empty (honest evidence)");
  }
  return { reason, message, ...extra };
}

/**
 * The TYPED error a provider adapter throws at the dispatch boundary when
 * the provider plane refuses BEFORE/WITHOUT admitting the job (missing or
 * invalid credentials — fail-loud, never a silent queue; admission-order
 * refusals keep using the W914 `ComputeValidationError` /
 * `ComputeAdmissionError` / `ComputeResourceLimitError` / `ComputeRightsError`
 * types). Extends `ComputeAdapterError`, so `terminalFailureClass` /
 * `failureClass` / `details` all behave like every other classified
 * boundary error; the R401 refusal reason travels as `refusalReason` DATA.
 */
export class ProviderRefusalError extends ComputeAdapterError {
  readonly refusalReason: ProviderRefusalReason;

  constructor(refusal: ProviderRefusal, details: Record<string, unknown> = {}) {
    super(refusal.message, failureClassOfRefusal(refusal.reason), {
      refusalReason: refusal.reason,
      ...(refusal.transport !== undefined ? { transport: refusal.transport } : {}),
      ...details,
    });
    this.name = "ProviderRefusalError";
    this.refusalReason = refusal.reason;
  }
}

/** Whether an unknown value is a {@link ProviderRefusalError}. */
export function isProviderRefusalError(value: unknown): value is ProviderRefusalError {
  return value instanceof ProviderRefusalError;
}
