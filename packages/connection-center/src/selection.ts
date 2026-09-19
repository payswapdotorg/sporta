/**
 * THE COMPUTE SELECTION DIRECTOR (R407): the auditable selection experience
 * over the FROZEN R401 compute broker (`ComputeBrokerPort` — quote/select/
 * dispatch delegates). The director WRAPS the broker; it never forks its
 * semantics: the broker's `ComputeBrokerSelection` (chosen provider + typed
 * refusals) is returned VERBATIM, and the director's own decision content
 * — WHY the chosen provider won, WHY every other provider lost, and which
 * USER preference axis excluded what — rides alongside as the auditable
 * {@link SelectionExplanation}.
 *
 * ## The accept criteria, restated
 *
 * - **User may explicitly choose** — `mode: "user-explicit"` with a
 *   provider id: the selection IS that provider or the typed
 *   {@link SelectionRefusedError} (fail-loud with every reason the broker
 *   recorded for it — the broker's silent preferred-provider FALLBACK is
 *   detected and refused: explicit means explicit);
 * - **…or let Sporta choose** — `mode: "sporta-auto"`: the broker's
 *   deterministic policy order (first eligible in registration order)
 *   under the caller's bounds, explained;
 * - selection considers capability, cost, VRAM, privacy, and
 *   availability: cost/queue/capability/availability flow through the
 *   broker's quotes and policy bounds (verbatim); privacy and VRAM are
 *   DIRECTOR axes over the provider FACTS (the operator's data
 *   declarations — privacy zone, VRAM, capability classes — never
 *   provider names in contracts).
 *
 * ## Auditability (the R407 deliverable)
 *
 * The explanation is a versioned, zod-validated document: for EVERY
 * registered provider — the quote the broker produced (verbatim, honest
 * nulls intact), the broker's typed refusal (verbatim), and the
 * preference exclusion that pre-filtered it (axis + message). A golden
 * test pins the canonical JSON byte-for-byte (deterministic: injected
 * clock, registration order, no hidden state).
 */
import { z } from "zod";
import { ComputeQuote } from "@sporta/compute-adapter";
import type {
  ComputeBrokerPort,
  ComputeBrokerSelection,
  ComputeProviderRefusal,
  ComputeQuoteRequest,
  ComputeSelectionPolicy,
} from "@sporta/compute-adapter";
import {
  PROVIDER_FACT_ZONES,
  SELECTION_EXCLUSION_AXES,
  SELECTION_PRIVACY_POSTURES,
  DEFAULT_CONNECTION_POLICY,
  type ConnectionCenterPolicy,
  type SelectionExclusionAxis,
} from "./policy";
import { CONNECTION_SCHEMA_VERSION } from "./schema";

// ---------------------------------------------------------------------------
// Provider facts (the operator's DATA declarations the director filters on)
// ---------------------------------------------------------------------------

/**
 * One provider's selection facts: the operator's honest DECLARATIONS (the
 * descriptor's authority stays with the adapter; these axes are not
 * descriptor members, so the composition declares them as data). A
 * provider without a VRAM declaration simply has none — a VRAM-floor
 * preference excludes it honestly ("no declaration"), never by guessing.
 */
export const ProviderSelectionFacts = z
  .object({
    providerId: z.string().min(1),
    /** Where this provider's jobs execute (the privacy axis, data). */
    privacyZone: z.enum(PROVIDER_FACT_ZONES),
    /** Declared VRAM in MB (operator declaration; omit = undeclared). */
    vramMb: z.number().finite().min(0).optional(),
    /** Declared capability classes (e.g. "gpu", "serverless" — data). */
    capabilityClasses: z.array(z.string().min(1)).max(16).optional(),
  })
  .strict();
export type ProviderSelectionFacts = z.infer<typeof ProviderSelectionFacts>;

// ---------------------------------------------------------------------------
// The user directive (explicit or auto) + preferences
// ---------------------------------------------------------------------------

/** The preference axes a user (or product) may bound selection with. */
export const SelectionPreference = z
  .object({
    /** Which privacy posture the selection must respect. */
    privacyPosture: z.enum(SELECTION_PRIVACY_POSTURES),
    /** Maximum acceptable estimated cost in USD (null estimates pass). */
    maxEstimatedCostUsd: z.number().finite().min(0).optional(),
    /** Maximum acceptable estimated queue wait in seconds (null passes). */
    maxEstimatedQueueSeconds: z.number().finite().min(0).optional(),
    /** The minimum declared VRAM (MB) the chosen provider must have. */
    vramFloorMb: z.number().finite().min(0).optional(),
    /** A capability class the chosen provider must declare. */
    capabilityClass: z.string().min(1).optional(),
  })
  .strict();
export type SelectionPreference = z.infer<typeof SelectionPreference>;

/** The closed directive modes (the R407 accept criteria). */
export const SELECTION_DIRECTIVE_MODES = ["user-explicit", "sporta-auto"] as const;
export type SelectionDirectiveMode = (typeof SELECTION_DIRECTIVE_MODES)[number];

/** What the user asked for (strict — a bespoke mode fails loudly). */
export const UserSelectionDirective = z
  .object({
    mode: z.enum(SELECTION_DIRECTIVE_MODES),
    /** The provider the user explicitly chose (required in explicit mode). */
    providerId: z.string().min(1).optional(),
    /** The bounds both modes respect (optional). */
    preference: SelectionPreference.optional(),
  })
  .strict()
  .superRefine((directive, ctx) => {
    if (directive.mode === "user-explicit" && directive.providerId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["providerId"],
        message: "user-explicit selection names the provider (providerId is required)",
      });
    }
    if (directive.mode === "sporta-auto" && directive.providerId !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["providerId"],
        message: "sporta-auto selection names no provider (the broker's policy order decides)",
      });
    }
  });
export type UserSelectionDirective = z.infer<typeof UserSelectionDirective>;

// ---------------------------------------------------------------------------
// The explanation (the auditable decision document)
// ---------------------------------------------------------------------------

/** Why one considered provider was pre-filtered by a preference axis. */
export const PreferenceExclusion = z
  .object({
    /** The axis that excluded it (closed vocabulary). */
    axis: z.enum(SELECTION_EXCLUSION_AXES),
    /** The honest evidence (never empty). */
    message: z.string().min(1),
  })
  .strict();
export type PreferenceExclusion = z.infer<typeof PreferenceExclusion>;

/** One considered provider's full, honest record in the decision. */
export const ConsideredProvider = z
  .object({
    providerId: z.string().min(1),
    /** The broker's quote (verbatim, honest nulls intact) when produced. */
    quote: ComputeQuote.optional(),
    /** The broker's typed refusal (verbatim) when recorded. */
    brokerRefusal: z
      .object({
        reason: z.enum([
          "no-compatible-gpu",
          "quota-exhausted",
          "credential-invalid",
          "budget-exceeded",
          "provider-unavailable",
        ]),
        message: z.string().min(1),
      })
      .strict()
      .optional(),
    /** The director's preference exclusion when pre-filtered. */
    preferenceExclusion: PreferenceExclusion.optional(),
  })
  .strict();
export type ConsideredProvider = z.infer<typeof ConsideredProvider>;

/** The closed selection-reason vocabulary (never a bespoke string). */
export const SELECTION_REASONS = {
  explicit:
    "the user explicitly selected this provider and it satisfied every preference axis and the broker's eligibility",
  auto: "the first eligible provider in registration order that survives the caller's preference axes and the broker's policy bounds (the broker's deterministic order)",
} as const;
export type SelectionReasonKey = keyof typeof SELECTION_REASONS;

/** The auditable explanation (versioned, deterministic, zod-validated). */
export const SelectionExplanation = z
  .object({
    schemaVersion: z.literal(CONNECTION_SCHEMA_VERSION),
    decidedAtMs: z.number().finite().min(0),
    mode: z.enum(SELECTION_DIRECTIVE_MODES),
    /** The provider the user named (explicit mode only). */
    requestedProviderId: z.string().min(1).optional(),
    /** The provider that won. */
    selectedProviderId: z.string().min(1),
    /** The selection reason (closed vocabulary key + message). */
    selectionReason: z.string().min(1),
    /** The preference actually applied (defaults resolved, honest). */
    appliedPreference: SelectionPreference,
    /** EVERY registered provider's record, in registration order. */
    considered: z.array(ConsideredProvider).min(1),
  })
  .strict();
export type SelectionExplanation = z.infer<typeof SelectionExplanation>;

// ---------------------------------------------------------------------------
// The typed refusal (fail-loud explicit selection / empty selection)
// ---------------------------------------------------------------------------

/** The typed director refusal record (broker refusals + preference exclusions). */
export interface SelectionRefusalRecord {
  providerId: string;
  /** The broker's typed refusal (R401 vocabulary) when one was recorded. */
  brokerRefusal?: ComputeProviderRefusal;
  /** The director's preference exclusion when one was recorded. */
  preferenceExclusion?: { axis: SelectionExclusionAxis; message: string };
}

/**
 * Thrown when the directive cannot be honored: an explicit selection the
 * broker refused (or a preference excluded), or a selection where nothing
 * is selectable (the broker's own `ComputeBrokerRefusalError` propagates
 * verbatim in that case — this error is the DIRECTOR's refusal shape).
 * Carries every reason, so the caller learns each one (never a silent
 * fallback to a provider the user did not choose).
 */
export class SelectionRefusedError extends Error {
  readonly failureClass: "resource-limit" | "media-invalid" | "internal";
  readonly terminalFailureClass: "resource-limit" | "media-invalid" | "internal";
  readonly requestedProviderId: string | undefined;
  readonly refusals: readonly SelectionRefusalRecord[];

  constructor(options: {
    message: string;
    failureClass: "resource-limit" | "media-invalid" | "internal";
    requestedProviderId?: string;
    refusals: readonly SelectionRefusalRecord[];
  }) {
    super(options.message);
    this.name = "SelectionRefusedError";
    this.failureClass = options.failureClass;
    this.terminalFailureClass = options.failureClass;
    this.requestedProviderId = options.requestedProviderId;
    this.refusals = options.refusals;
  }
}

/** A malformed directive/preference/facts input (fail-loud). */
export class SelectionValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`selection input failed validation: ${issues.join("; ")}`);
    this.name = "SelectionValidationError";
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// The director
// ---------------------------------------------------------------------------

/** Options for {@link SelectionDirector}. */
export interface SelectionDirectorOptions {
  /** The broker the director wraps (the R401 seam — frozen semantics). */
  broker: ComputeBrokerPort;
  /**
   * The provider facts (the operator's DATA declarations), keyed by
   * provider id. MUST cover every broker-registered provider — a provider
   * without facts is a composition bug the director refuses to guess at.
   */
  facts: ReadonlyMap<string, ProviderSelectionFacts>;
  /** The injected clock (REQUIRED). */
  nowMs: () => number;
  /** The policy (default: the shipped {@link DEFAULT_CONNECTION_POLICY}). */
  policy?: ConnectionCenterPolicy;
}

/** The director's outcome: the broker selection VERBATIM + the explanation. */
export interface SelectionOutcome {
  /** The broker's selection, byte-for-byte (the director adds nothing). */
  selection: ComputeBrokerSelection;
  /** The auditable explanation. */
  explanation: SelectionExplanation;
}

/**
 * THE selection director (R407): wraps one broker; one `explain` call per
 * selection. Stateless beyond its options (determinism by construction);
 * every decision is explainable after the fact via the returned document.
 */
export class SelectionDirector {
  private readonly broker: ComputeBrokerPort;
  private readonly facts: ReadonlyMap<string, ProviderSelectionFacts>;
  private readonly nowMs: () => number;
  private readonly policy: ConnectionCenterPolicy;

  constructor(options: SelectionDirectorOptions) {
    this.broker = options.broker;
    this.facts = options.facts;
    this.nowMs = options.nowMs;
    this.policy = options.policy ?? DEFAULT_CONNECTION_POLICY;
  }

  /**
   * Selects under the user's directive and explains the decision:
   * `selection` is the broker's `ComputeBrokerSelection` VERBATIM;
   * `explanation` is the auditable document (every registered provider's
   * quote/refusal/exclusion).
   */
  async explain(
    request: ComputeQuoteRequest,
    directive: UserSelectionDirective,
  ): Promise<SelectionOutcome> {
    const parsedDirective = UserSelectionDirective.safeParse(directive);
    if (!parsedDirective.success) {
      throw new SelectionValidationError(
        parsedDirective.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      );
    }
    const resolved = this.resolvePreference(parsedDirective.data);
    this.validateFactsCover();

    // The broker's honest quote set (estimates may be null — never invented).
    const quotes = await this.broker.quote(request);
    const quoteOf = new Map(quotes.map((quote) => [quote.providerId, quote]));

    // The director's preference pre-filters over the facts (privacy/VRAM/
    // capability — DATA axes; cost/queue flow through the broker policy).
    const exclusions = new Map<string, PreferenceExclusion>();
    for (const providerId of this.registeredProviderIds()) {
      const exclusion = this.exclusionOf(providerId, quoteOf.get(providerId), resolved);
      if (exclusion !== null) exclusions.set(providerId, exclusion);
    }

    // The candidates the director will hand the broker, in order:
    // explicit mode → exactly the requested provider (explicit means
    // explicit); auto mode → every survivor of the preference axes, in
    // registration order (the broker's deterministic order).
    const candidates =
      parsedDirective.data.mode === "user-explicit"
        ? [parsedDirective.data.providerId!]
        : this.registeredProviderIds().filter((id) => !exclusions.has(id));

    // Explicit mode: the named provider must survive the director's axes
    // FIRST — or the typed refusal with the axis reason.
    if (parsedDirective.data.mode === "user-explicit") {
      const requested = parsedDirective.data.providerId!;
      const directExclusion = exclusions.get(requested);
      if (directExclusion !== undefined) {
        throw new SelectionRefusedError({
          message: `the explicitly selected provider '${requested}' is excluded by the ${directExclusion.axis} preference (${directExclusion.message})`,
          failureClass: "resource-limit",
          requestedProviderId: requested,
          refusals: [
            {
              providerId: requested,
              preferenceExclusion: {
                axis: directExclusion.axis,
                message: directExclusion.message,
              },
            },
          ],
        });
      }
    }

    // The candidate loop: each candidate is attempted through the frozen
    // broker `select` (preferredProviderId + the cost/queue bounds). A
    // broker aggregate throw (NOTHING eligible under the bounds) is
    // terminal and propagates VERBATIM in both modes; a candidate the
    // broker refused (or policy-filtered out — the broker's silent
    // preferred-provider fallback) is ACCUMULATED as a typed refusal and
    // the next candidate is attempted.
    const accumulated: ComputeProviderRefusal[] = [];
    const bounds: ComputeSelectionPolicy = {
      ...(resolved.maxEstimatedCostUsd !== undefined
        ? { maxEstimatedCostUsd: resolved.maxEstimatedCostUsd }
        : {}),
      ...(resolved.maxEstimatedQueueSeconds !== undefined
        ? { maxEstimatedQueueSeconds: resolved.maxEstimatedQueueSeconds }
        : {}),
    };
    let accepted: ComputeBrokerSelection | undefined;
    for (const candidateId of candidates) {
      // A broker aggregate throw (nothing selectable under the bounds)
      // propagates VERBATIM — the caller learns every provider's reason
      // from the frozen seam.
      const attempt = await this.broker.select(request, {
        ...bounds,
        preferredProviderId: candidateId,
      });
      if (attempt.providerId === candidateId) {
        accepted = attempt;
        break;
      }
      // The broker preferred another provider: the candidate's typed
      // refusal is recorded in the attempt's refusals — accumulate it
      // and try the next candidate (never a silent substitute).
      const candidateRefusal = attempt.refusals.find(
        (refusal) => refusal.providerId === candidateId,
      );
      if (candidateRefusal !== undefined) {
        accumulated.push(candidateRefusal);
      }
    }

    if (accepted === undefined) {
      // Every candidate was refused (explicit: the one; auto: all the
      // survivors) — the typed director refusal carries each reason.
      const refusalRecords: SelectionRefusalRecord[] = accumulated.map((refusal) => ({
        providerId: refusal.providerId,
        brokerRefusal: refusal,
      }));
      if (parsedDirective.data.mode === "user-explicit") {
        const requested = parsedDirective.data.providerId!;
        const brokerRefusal = accumulated.find((refusal) => refusal.providerId === requested);
        throw new SelectionRefusedError({
          message: `the explicitly selected provider '${requested}' was refused by the broker${brokerRefusal !== undefined ? ` (${brokerRefusal.reason}: ${brokerRefusal.message})` : ""} — an explicit selection never silently falls back`,
          failureClass: this.aggregateFailureClass(accumulated),
          requestedProviderId: requested,
          refusals: refusalRecords.length > 0 ? refusalRecords : [{ providerId: requested }],
        });
      }
      throw new SelectionRefusedError({
        message: `no provider is selectable under the applied preference (${refusalRecords
          .map((record) => `${record.providerId}: ${record.brokerRefusal?.reason ?? "refused"}`)
          .join("; ")})`,
        failureClass: this.aggregateFailureClass(accumulated),
        refusals: refusalRecords,
      });
    }
    const selection = accepted;

    const explanation = this.buildExplanation(
      parsedDirective.data,
      resolved,
      selection,
      quotes,
      exclusions,
      accumulated,
    );
    return { selection, explanation };
  }

  // -------------------------------------------------------------------------
  // Internals (deterministic, closed vocabularies)
  // -------------------------------------------------------------------------

  /** Resolves the applied preference (defaults from the policy). */
  private resolvePreference(directive: UserSelectionDirective): SelectionPreference {
    const preference = directive.preference ?? {
      privacyPosture: this.policy.selection.defaultPrivacyPosture,
    };
    const parsed = SelectionPreference.safeParse({
      privacyPosture: preference.privacyPosture,
      ...(preference.maxEstimatedCostUsd !== undefined
        ? { maxEstimatedCostUsd: preference.maxEstimatedCostUsd }
        : {}),
      ...(preference.maxEstimatedQueueSeconds !== undefined
        ? { maxEstimatedQueueSeconds: preference.maxEstimatedQueueSeconds }
        : {}),
      ...(preference.vramFloorMb !== undefined ? { vramFloorMb: preference.vramFloorMb } : {}),
      ...(preference.capabilityClass !== undefined
        ? { capabilityClass: preference.capabilityClass }
        : {}),
    });
    if (!parsed.success) {
      throw new SelectionValidationError(
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      );
    }
    if (
      parsed.data.vramFloorMb !== undefined &&
      parsed.data.vramFloorMb > this.policy.selection.maxVramFloorMb
    ) {
      throw new SelectionValidationError([
        `vramFloorMb ${parsed.data.vramFloorMb} exceeds the policy sanity bound ${this.policy.selection.maxVramFloorMb} (a floor this high excludes everything — rejected loudly, never a silent nothing-matches filter)`,
      ]);
    }
    return parsed.data;
  }

  /** Registered provider ids in the broker's registration order. */
  private registeredProviderIds(): string[] {
    return this.broker.providers().map((descriptor) => descriptor.adapterId);
  }

  /** Facts must cover every registered provider (the director never guesses). */
  private validateFactsCover(): void {
    for (const providerId of this.registeredProviderIds()) {
      if (!this.facts.has(providerId)) {
        throw new SelectionValidationError([
          `provider '${providerId}' has no selection facts — the director refuses to guess privacy/VRAM/capability (compose the facts entry)`,
        ]);
      }
    }
  }

  /** The director's exclusion for one provider under the resolved preference. */
  private exclusionOf(
    providerId: string,
    quote: ComputeQuote | undefined,
    preference: SelectionPreference,
  ): PreferenceExclusion | null {
    const facts = this.facts.get(providerId)!;
    if (
      preference.privacyPosture === "privacy-local-only" &&
      facts.privacyZone !== "user-controlled"
    ) {
      return {
        axis: "privacy",
        message: `the privacy posture requires user-controlled execution; provider '${providerId}' declares zone '${facts.privacyZone}'`,
      };
    }
    if (preference.vramFloorMb !== undefined) {
      if (facts.vramMb === undefined) {
        return {
          axis: "vram",
          message: `the preference requires at least ${preference.vramFloorMb} MB VRAM; provider '${providerId}' declares none (honest unknown — excluded, never guessed)`,
        };
      }
      if (facts.vramMb < preference.vramFloorMb) {
        return {
          axis: "vram",
          message: `the preference requires at least ${preference.vramFloorMb} MB VRAM; provider '${providerId}' declares ${facts.vramMb} MB`,
        };
      }
    }
    if (preference.capabilityClass !== undefined) {
      const classes = facts.capabilityClasses ?? [];
      if (!classes.includes(preference.capabilityClass)) {
        return {
          axis: "capability",
          message: `the preference requires capability class '${preference.capabilityClass}'; provider '${providerId}' declares [${classes.join(", ")}]`,
        };
      }
    }
    // Silence the unused-parameter lint honestly: the quote is carried into
    // future per-axis reasoning (cost honesty flows through the broker).
    void quote;
    return null;
  }

  /** The broker-aggregate failure class of a set of refusals (mirrored). */
  private aggregateFailureClass(
    refusals: readonly ComputeProviderRefusal[],
  ): "resource-limit" | "media-invalid" {
    const anyCapacity = refusals.some(
      (refusal) =>
        refusal.reason === "quota-exhausted" ||
        refusal.reason === "budget-exceeded" ||
        refusal.reason === "no-compatible-gpu" ||
        refusal.reason === "provider-unavailable",
    );
    return refusals.length === 0
      ? "media-invalid"
      : anyCapacity
        ? "resource-limit"
        : "media-invalid";
  }

  /** Assembles the auditable explanation (registration order, verbatim parts). */
  private buildExplanation(
    directive: UserSelectionDirective,
    preference: SelectionPreference,
    selection: ComputeBrokerSelection,
    quotes: ComputeQuote[],
    exclusions: ReadonlyMap<string, PreferenceExclusion>,
    accumulated: readonly ComputeProviderRefusal[],
  ): SelectionExplanation {
    const quoteOf = new Map(quotes.map((quote) => [quote.providerId, quote]));
    // The refusal mapping: the ACCEPTED selection's refusals are
    // authoritative; refusals accumulated from refused candidates ride
    // along verbatim (first occurrence wins — deterministic).
    const refusalOf = new Map<string, ComputeProviderRefusal>();
    for (const refusal of accumulated) {
      refusalOf.set(refusal.providerId, refusal);
    }
    for (const refusal of selection.refusals) {
      if (!refusalOf.has(refusal.providerId)) {
        refusalOf.set(refusal.providerId, refusal);
      }
    }
    const considered: ConsideredProvider[] = this.registeredProviderIds().map((providerId) => {
      const quote = quoteOf.get(providerId);
      const refusal = refusalOf.get(providerId);
      const exclusion = exclusions.get(providerId);
      return {
        providerId,
        ...(quote !== undefined ? { quote } : {}),
        ...(refusal !== undefined
          ? { brokerRefusal: { reason: refusal.reason, message: refusal.message } }
          : {}),
        ...(exclusion !== undefined ? { preferenceExclusion: exclusion } : {}),
      };
    });
    return {
      schemaVersion: CONNECTION_SCHEMA_VERSION,
      decidedAtMs: this.nowMs(),
      mode: directive.mode,
      ...(directive.providerId !== undefined ? { requestedProviderId: directive.providerId } : {}),
      selectedProviderId: selection.providerId,
      selectionReason:
        directive.mode === "user-explicit" ? SELECTION_REASONS.explicit : SELECTION_REASONS.auto,
      appliedPreference: preference,
      considered,
    };
  }
}

// ---------------------------------------------------------------------------
// Canonical serialization (byte-identical output, golden-pinned)
// ---------------------------------------------------------------------------

/** Recursively sorts object keys (stable, deterministic serialization). */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const out: Record<string, unknown> = {};
    for (const [key, inner] of entries) out[key] = sortValue(inner);
    return out;
  }
  return value;
}

/**
 * The canonical JSON of one explanation: sorted keys, no whitespace —
 * byte-identical across runs for identical inputs (the golden-pinning
 * substrate). Deterministic by construction (injected clock, registration
 * order, closed vocabularies).
 */
export function canonicalSelectionExplanation(explanation: SelectionExplanation): string {
  return JSON.stringify(sortValue(explanation));
}
