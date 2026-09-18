/**
 * The COMPUTE BROKER contract (R401) — the provider-neutral quote/select
 * layer ABOVE the W914 `ComputeAdapterPort`.
 *
 * ## Why a broker exists (the architecture-lock §9 posture, restated)
 *
 * `ComputeAdapterPort` (./adapter.ts) is the per-provider seam; the control
 * plane should not have to pick a provider itself. The broker is the ONE
 * surface a caller hands a LOGICAL workload description to (no provider
 * name — provider ids are DATA), and it answers:
 *
 * - `providers()` — the descriptors of every registered adapter;
 * - `quote(request)` — one quote PER ELIGIBLE provider (cost/queue
 *   estimates may honestly be `null` when a provider cannot estimate);
 * - `select(request, policy)` — the chosen provider PLUS a typed refusal
 *   per otherwise-eligible provider (closed vocabulary, below), so a
 *   selection decision is never a silent skip;
 * - `dispatch`/`status`/`cancel` — delegated to the chosen provider's
 *   adapter VERBATIM (the broker adds NO execution semantics of its own).
 *
 * ## The typed refusal vocabulary (closed)
 *
 * `"no-compatible-gpu" | "quota-exhausted" | "credential-invalid" |
 * "budget-exceeded" | "provider-unavailable"` — every non-selected
 * provider's reason is one of these, carried in
 * {@link ComputeBrokerSelection.refusals}. A broker NEVER embeds provider
 * names into product/domain contracts: the provider id travels as data in
 * the refusal record, never as a vocabulary member.
 *
 * ## Honesty rules
 *
 * - A quote's `estimatedCostUsd`/`estimatedQueueSeconds` may be `null`
 *   (honest unknown) — never a fabricated number;
 * - `select` with an empty eligible set resolves a typed
 *   `ComputeBrokerRefusalError` (fail-loud — the caller learns WHY every
 *   provider was refused);
 * - `dispatch`/`status`/`cancel` NEVER consult a provider the caller did
 *   not select: the broker is stateless routing, the adapter is the
 *   ledger (the W914 accounting posture is untouched).
 */
import { z } from "zod";
import type {
  ComputeAdapterDescriptor,
  ComputeCancelOutcome,
  ComputeDispatchOutcome,
  ComputeJobDescription,
  ComputeJobSnapshot,
} from "./schemas";
import { computeSchemaVersionField } from "./schemas";
import type { ComputeAdapterPort } from "./adapter";

// ---------------------------------------------------------------------------
// Quote request (the LOGICAL workload — no provider name, ever)
// ---------------------------------------------------------------------------

/**
 * The logical workload description a caller quotes/selects against: the SAME
 * resource/latency vocabulary `ComputeJobDescription` uses (`outputProfile`
 * latency class, renderer id, resource hints, deadline) — with NO provider
 * name and NO execution identity. The broker matches this against every
 * registered adapter's descriptor.
 */
export const ComputeQuoteRequest = z
  .object({
    schemaVersion: computeSchemaVersionField,
    /** The renderer the workload needs (must appear in a descriptor). */
    rendererId: z.string().min(1),
    /** Exact renderer version when the workload pins one. */
    rendererVersion: z.string().min(1).optional(),
    /** The output latency class the workload requires. */
    latencyClass: z.enum(["offline", "near-live", "live"]),
    /** The whole-job deadline the workload carries (ms). */
    deadlineMs: z.number().finite().positive(),
    /** Declared resource needs (advisory, abstract — the W303 requirements). */
    resourceHints: z
      .object({
        memoryMb: z.number().finite().min(0).optional(),
        computeClass: z.string().min(1).optional(),
        /** Whether the workload requires GPU-class compute. */
        requiresGpu: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ComputeQuoteRequest = z.infer<typeof ComputeQuoteRequest>;

// ---------------------------------------------------------------------------
// The quote (one per eligible provider)
// ---------------------------------------------------------------------------

/**
 * One provider's quote for a logical workload. `estimatedCostUsd` and
 * `estimatedQueueSeconds` are HONEST NULLABLES: a provider that cannot
 * estimate says so with `null`, never a fabricated number.
 */
export const ComputeQuote = z
  .object({
    schemaVersion: computeSchemaVersionField,
    /** The quoting provider's id (data — never a vocabulary member). */
    providerId: z.string().min(1),
    /** The adapter's declared capability summary (provider-neutral). */
    capability: z
      .object({
        providerKind: z.enum(["in-memory", "cpu-worker", "gpu-worker", "managed-actor"]),
        maxConcurrentJobs: z.number().int().min(1),
        maxJobDeadlineMs: z.number().finite().positive(),
        supportedLatencyClasses: z.array(z.enum(["offline", "near-live", "live"])).min(1),
      })
      .strict(),
    /** Estimated cost in USD, or `null` when the provider cannot estimate. */
    estimatedCostUsd: z.number().finite().min(0).nullable(),
    /** Estimated queue wait in seconds, or `null` when unknowable. */
    estimatedQueueSeconds: z.number().finite().min(0).nullable(),
    /** Quote issue time (ms — the injected clock domain). */
    quotedAtMs: z.number().finite().min(0),
    /** When the quote stops being valid (ms; quotes are perishable). */
    validUntilMs: z.number().finite().min(0),
  })
  .strict()
  .superRefine((quote, ctx) => {
    if (quote.validUntilMs < quote.quotedAtMs) {
      ctx.addIssue({
        code: "custom",
        path: ["validUntilMs"],
        message: "validUntilMs cannot precede quotedAtMs",
      });
    }
  });
export type ComputeQuote = z.infer<typeof ComputeQuote>;

// ---------------------------------------------------------------------------
// Selection (the chosen provider + typed refusals for the rest)
// ---------------------------------------------------------------------------

/** The closed vocabulary of broker refusals (R401 — provider ids are data). */
export const COMPUTE_BROKER_REFUSALS = [
  "no-compatible-gpu",
  "quota-exhausted",
  "credential-invalid",
  "budget-exceeded",
  "provider-unavailable",
] as const;
export type ComputeBrokerRefusal = (typeof COMPUTE_BROKER_REFUSALS)[number];

/** Why one otherwise-considered provider was not selected. */
export interface ComputeProviderRefusal {
  /** The provider that was refused (data — any id). */
  providerId: string;
  /** The typed reason (closed vocabulary, above). */
  reason: ComputeBrokerRefusal;
  /** Human-readable evidence (never empty). */
  message: string;
}

/** The selection policy a caller hands `select` (all bounds optional). */
export interface ComputeSelectionPolicy {
  /** Maximum acceptable estimated cost in USD (`null` estimates pass). */
  maxEstimatedCostUsd?: number;
  /** Maximum acceptable estimated queue wait in seconds (`null` passes). */
  maxEstimatedQueueSeconds?: number;
  /** Prefer this provider when eligible (data, not a vocabulary member). */
  preferredProviderId?: string;
}

/** The outcome of a successful `select`: the chosen provider + the refusals. */
export interface ComputeBrokerSelection {
  /** The selected provider's id. */
  providerId: string;
  /** The quote the selection was made against. */
  quote: ComputeQuote;
  /** Every other considered provider's typed refusal (never a silent skip). */
  refusals: ComputeProviderRefusal[];
}

// ---------------------------------------------------------------------------
// The typed refusal error (fail-loud selection)
// ---------------------------------------------------------------------------

/** The contracts `TerminalFailureClass` member a broker refusal carries. */
export type ComputeBrokerFailureClass = "resource-limit" | "media-invalid" | "internal";

/**
 * Thrown by `select` when NO provider is selectable: carries EVERY
 * provider's typed refusal, so the caller learns each reason. Classified
 * `resource-limit` for capacity/quota refusals, `media-invalid` when the
 * workload itself matches no descriptor, `internal` for broker misuse.
 */
export class ComputeBrokerRefusalError extends Error {
  readonly failureClass: ComputeBrokerFailureClass;
  readonly terminalFailureClass: ComputeBrokerFailureClass;
  readonly refusals: readonly ComputeProviderRefusal[];

  constructor(
    message: string,
    failureClass: ComputeBrokerFailureClass,
    refusals: readonly ComputeProviderRefusal[],
  ) {
    super(message);
    this.name = "ComputeBrokerRefusalError";
    this.failureClass = failureClass;
    this.terminalFailureClass = failureClass;
    this.refusals = refusals;
  }
}

/** Thrown when a caller references a provider the broker never registered. */
export class UnknownComputeProviderError extends Error {
  readonly providerId: string;

  constructor(providerId: string) {
    super(`compute provider '${providerId}' is not registered with this broker`);
    this.name = "UnknownComputeProviderError";
    this.providerId = providerId;
  }
}

// ---------------------------------------------------------------------------
// The broker port
// ---------------------------------------------------------------------------

/** One registered provider: its id + its adapter (the W914 seam). */
export interface ComputeBrokerProvider {
  /** The provider's identity (data — unique per broker). */
  providerId: string;
  /** The provider's adapter (dispatch/status/cancel delegate HERE verbatim). */
  adapter: ComputeAdapterPort;
}

/**
 * THE compute-broker port (R401): quote/select over registered providers,
 * with dispatch/status/cancel DELEGATED to the chosen provider's adapter.
 * The broker NEVER embeds provider names into product/domain contracts —
 * provider ids are data.
 */
export interface ComputeBrokerPort {
  /** The descriptors of every registered provider (in registration order). */
  providers(): ComputeAdapterDescriptor[];
  /**
   * Quotes one logical workload against every ELIGIBLE provider (descriptor-
   * compatible: renderer + latency class + deadline bounds). Estimates may
   * honestly be `null`; an ineligible provider is simply not quoted.
   */
  quote(request: ComputeQuoteRequest): Promise<ComputeQuote[]>;
  /**
   * Selects one provider for the workload under the caller's policy: the
   * chosen provider + a typed refusal for every other considered provider.
   * Throws {@link ComputeBrokerRefusalError} when nothing is selectable.
   */
  select(
    request: ComputeQuoteRequest,
    policy?: ComputeSelectionPolicy,
  ): Promise<ComputeBrokerSelection>;
  /**
   * Delegates a dispatch to the CHOSEN provider's adapter (the W914
   * semantics, verbatim — the broker adds nothing). The job's own
   * `renderer`/`constraints` fields drive adapter admission as usual.
   */
  dispatch(providerId: string, job: ComputeJobDescription): Promise<ComputeDispatchOutcome>;
  /** Delegates a status poll to the chosen provider's adapter. */
  status(providerId: string, jobId: string): Promise<ComputeJobSnapshot | null>;
  /** Delegates a cancel to the chosen provider's adapter. */
  cancel(providerId: string, jobId: string): Promise<ComputeCancelOutcome>;
}

// ---------------------------------------------------------------------------
// The in-memory reference broker (over registered ComputeAdapterPorts)
// ---------------------------------------------------------------------------

/** How one provider's estimates are produced (injected — never invented). */
export interface ComputeBrokerProviderQuoting {
  /**
   * The provider's estimate for one workload, or `null` per field when it
   * cannot estimate (honest unknowns). The broker wraps this into a
   * `ComputeQuote` with its own clock and validity window.
   */
  estimate: (request: ComputeQuoteRequest) => {
    estimatedCostUsd: number | null;
    estimatedQueueSeconds: number | null;
  };
}

/** Options for {@link InMemoryComputeBroker}. */
export interface InMemoryComputeBrokerOptions {
  /** The registered providers (at least one). */
  providers: readonly ComputeBrokerProvider[];
  /**
   * Per-provider estimate functions, keyed by provider id. A provider with
   * NO entry quotes honest `null`s (the default posture: the in-memory
   * reference has no real cost knowledge — it never fabricates).
   */
  quoting?: ReadonlyMap<string, ComputeBrokerProviderQuoting>;
  /** Per-provider availability overrides (tests exercise `provider-unavailable`). */
  unavailable?: ReadonlySet<string>;
  /** Per-provider exhausted-quota overrides (tests exercise `quota-exhausted`). */
  quotaExhausted?: ReadonlySet<string>;
  /** Per-provider invalid-credential overrides (tests exercise `credential-invalid`). */
  credentialInvalid?: ReadonlySet<string>;
  /** The injected clock (ms; default: constant 0 — the reference posture). */
  nowMs?: () => number;
  /** How long a quote stays valid (ms; default 60_000). */
  quoteValidityMs?: number;
}

/** Whether one adapter's descriptor can serve the logical workload. */
function descriptorServes(
  descriptor: ComputeAdapterDescriptor,
  request: ComputeQuoteRequest,
): { serves: boolean; reason?: ComputeBrokerRefusal; message?: string } {
  const renderer = descriptor.supportedRenderers.find(
    (entry) => entry.rendererId === request.rendererId,
  );
  if (renderer === undefined) {
    return {
      serves: false,
      reason: "provider-unavailable",
      message: `descriptor declares no renderer '${request.rendererId}'`,
    };
  }
  if (
    renderer.rendererVersions !== undefined &&
    request.rendererVersion !== undefined &&
    !renderer.rendererVersions.includes(request.rendererVersion)
  ) {
    return {
      serves: false,
      reason: "provider-unavailable",
      message: `renderer '${request.rendererId}' version '${request.rendererVersion}' is not among the declared versions`,
    };
  }
  if (!descriptor.supportedLatencyClasses.includes(request.latencyClass)) {
    return {
      serves: false,
      reason: "provider-unavailable",
      message: `latency class '${request.latencyClass}' is not served`,
    };
  }
  if (request.deadlineMs > descriptor.maxJobDeadlineMs) {
    return {
      serves: false,
      reason: "provider-unavailable",
      message: `deadline ${request.deadlineMs}ms exceeds the adapter bound ${descriptor.maxJobDeadlineMs}ms`,
    };
  }
  if (
    descriptor.minJobDeadlineMs !== undefined &&
    request.deadlineMs < descriptor.minJobDeadlineMs
  ) {
    return {
      serves: false,
      reason: "provider-unavailable",
      message: `deadline ${request.deadlineMs}ms is below the adapter floor ${descriptor.minJobDeadlineMs}ms`,
    };
  }
  if (request.resourceHints?.requiresGpu === true && descriptor.providerKind !== "gpu-worker") {
    return {
      serves: false,
      reason: "no-compatible-gpu",
      message: `workload requires GPU-class compute; provider kind is '${descriptor.providerKind}'`,
    };
  }
  return { serves: true };
}

/**
 * The in-memory reference broker (R401): quote/select/dispatch/status/cancel
 * over REGISTERED `ComputeAdapterPort` instances — typically the W914
 * in-memory reference adapter (`./memory-adapter.ts`), exactly as the R401
 * packet prescribes. TEST-AND-COMPOSITION substrate: it holds no ledger of
 * its own (the adapters own the accounting); it reads NO clock source of
 * its own beyond the injected `nowMs`.
 */
export class InMemoryComputeBroker implements ComputeBrokerPort {
  private readonly registered: readonly ComputeBrokerProvider[];
  private readonly quoting: ReadonlyMap<string, ComputeBrokerProviderQuoting>;
  private readonly unavailable: ReadonlySet<string>;
  private readonly quotaExhausted: ReadonlySet<string>;
  private readonly credentialInvalid: ReadonlySet<string>;
  private readonly nowMs: () => number;
  private readonly quoteValidityMs: number;

  constructor(options: InMemoryComputeBrokerOptions) {
    if (options.providers.length === 0) {
      throw new Error("an in-memory compute broker needs at least one provider");
    }
    const seen = new Set<string>();
    for (const provider of options.providers) {
      if (seen.has(provider.providerId)) {
        throw new Error(`duplicate compute provider id '${provider.providerId}'`);
      }
      seen.add(provider.providerId);
    }
    this.registered = options.providers;
    this.quoting = options.quoting ?? new Map();
    this.unavailable = options.unavailable ?? new Set();
    this.quotaExhausted = options.quotaExhausted ?? new Set();
    this.credentialInvalid = options.credentialInvalid ?? new Set();
    this.nowMs = options.nowMs ?? (() => 0);
    this.quoteValidityMs = options.quoteValidityMs ?? 60_000;
  }

  /** Route-resolution: the registered provider or the typed unknown error. */
  private providerOrFail(providerId: string): ComputeBrokerProvider {
    const provider = this.registered.find((entry) => entry.providerId === providerId);
    if (provider === undefined) {
      throw new UnknownComputeProviderError(providerId);
    }
    return provider;
  }

  providers(): ComputeAdapterDescriptor[] {
    return this.registered.map((provider) => provider.adapter.describe());
  }

  async quote(request: ComputeQuoteRequest): Promise<ComputeQuote[]> {
    const quotes: ComputeQuote[] = [];
    for (const provider of this.registered) {
      if (this.unavailable.has(provider.providerId)) continue;
      if (this.credentialInvalid.has(provider.providerId)) continue;
      if (this.quotaExhausted.has(provider.providerId)) continue;
      const descriptor = provider.adapter.describe();
      if (!descriptorServes(descriptor, request).serves) continue;
      const quoting = this.quoting.get(provider.providerId);
      const estimate = quoting?.estimate(request) ?? {
        estimatedCostUsd: null,
        estimatedQueueSeconds: null,
      };
      const quotedAtMs = this.nowMs();
      quotes.push({
        schemaVersion: descriptor.schemaVersion,
        providerId: provider.providerId,
        capability: {
          providerKind: descriptor.providerKind,
          maxConcurrentJobs: descriptor.maxConcurrentJobs,
          maxJobDeadlineMs: descriptor.maxJobDeadlineMs,
          supportedLatencyClasses: descriptor.supportedLatencyClasses,
        },
        estimatedCostUsd: estimate.estimatedCostUsd,
        estimatedQueueSeconds: estimate.estimatedQueueSeconds,
        quotedAtMs,
        validUntilMs: quotedAtMs + this.quoteValidityMs,
      });
    }
    return quotes;
  }

  async select(
    request: ComputeQuoteRequest,
    policy: ComputeSelectionPolicy = {},
  ): Promise<ComputeBrokerSelection> {
    const refusals: ComputeProviderRefusal[] = [];
    const quotes = await this.quote(request);
    const byProvider = new Map(quotes.map((quote) => [quote.providerId, quote]));

    // Every registered provider gets a typed verdict — never a silent skip.
    for (const provider of this.registered) {
      const quote = byProvider.get(provider.providerId);
      if (quote !== undefined) continue;
      if (this.unavailable.has(provider.providerId)) {
        refusals.push({
          providerId: provider.providerId,
          reason: "provider-unavailable",
          message: "the provider is currently unavailable",
        });
        continue;
      }
      if (this.credentialInvalid.has(provider.providerId)) {
        refusals.push({
          providerId: provider.providerId,
          reason: "credential-invalid",
          message: "the provider's credentials failed validation",
        });
        continue;
      }
      if (this.quotaExhausted.has(provider.providerId)) {
        refusals.push({
          providerId: provider.providerId,
          reason: "quota-exhausted",
          message: "the provider's quota is exhausted",
        });
        continue;
      }
      const served = descriptorServes(provider.adapter.describe(), request);
      refusals.push({
        providerId: provider.providerId,
        reason: served.reason ?? "provider-unavailable",
        message: served.message ?? "the provider cannot serve this workload",
      });
    }

    // Policy filters over the QUOTED providers (estimate-aware).
    const eligible: ComputeQuote[] = [];
    for (const quote of quotes) {
      if (
        policy.maxEstimatedCostUsd !== undefined &&
        quote.estimatedCostUsd !== null &&
        quote.estimatedCostUsd > policy.maxEstimatedCostUsd
      ) {
        refusals.push({
          providerId: quote.providerId,
          reason: "budget-exceeded",
          message: `estimated cost $${quote.estimatedCostUsd} exceeds the policy bound $${policy.maxEstimatedCostUsd}`,
        });
        continue;
      }
      if (
        policy.maxEstimatedQueueSeconds !== undefined &&
        quote.estimatedQueueSeconds !== null &&
        quote.estimatedQueueSeconds > policy.maxEstimatedQueueSeconds
      ) {
        refusals.push({
          providerId: quote.providerId,
          reason: "quota-exhausted",
          message: `estimated queue ${quote.estimatedQueueSeconds}s exceeds the policy bound ${policy.maxEstimatedQueueSeconds}s`,
        });
        continue;
      }
      eligible.push(quote);
    }

    if (eligible.length === 0) {
      const anyCapacity = refusals.some(
        (refusal) => refusal.reason === "quota-exhausted" || refusal.reason === "budget-exceeded",
      );
      throw new ComputeBrokerRefusalError(
        `no compute provider is selectable for renderer '${request.rendererId}' (${refusals
          .map((refusal) => `${refusal.providerId}: ${refusal.reason}`)
          .join("; ")})`,
        anyCapacity ? "resource-limit" : "media-invalid",
        refusals,
      );
    }

    // Preferred provider wins when quoted+eligible; otherwise the FIRST
    // eligible provider in registration order (deterministic).
    const preferred =
      policy.preferredProviderId !== undefined
        ? eligible.find((quote) => quote.providerId === policy.preferredProviderId)
        : undefined;
    const chosen = preferred ?? eligible[0]!;

    return {
      providerId: chosen.providerId,
      quote: chosen,
      refusals,
    };
  }

  async dispatch(providerId: string, job: ComputeJobDescription): Promise<ComputeDispatchOutcome> {
    const provider = this.providerOrFail(providerId);
    return provider.adapter.dispatch(job);
  }

  async status(providerId: string, jobId: string): Promise<ComputeJobSnapshot | null> {
    const provider = this.providerOrFail(providerId);
    return provider.adapter.getJob(jobId);
  }

  async cancel(providerId: string, jobId: string): Promise<ComputeCancelOutcome> {
    const provider = this.providerOrFail(providerId);
    return provider.adapter.cancel(jobId);
  }
}
