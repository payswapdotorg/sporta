/**
 * THE COMPUTE TRANSPARENCY PROJECTION (J006 backend) — the six acceptance
 * fields (compute source, provider, selection reason, measured
 * allowance/cost, privacy posture and fallback state) projected onto the
 * API surfaces from the REAL compute/cost seams ONLY:
 *
 * - the composition's own plane DATA (`server.selection.facts` — the
 *   operator's declared provider facts; `server.compute` — the provider
 *   kind and adapter id);
 * - the REAL R407 SelectionDirector's auditable explanation (verbatim —
 *   the selection reason is its closed-vocabulary reason; the fallback
 *   state is derived from its per-provider considered records);
 * - the W919 guardrails' quota/usage seams (the caller's daily allowance
 *   states and the plane's metered usage totals — honest nulls intact,
 *   never a fabricated 0);
 * - the broker's own quote for the selected provider (the honest nullable
 *   `estimatedCostUsd`/`estimatedQueueSeconds` — an estimate is labeled an
 *   estimate, a measured number is labeled measured, and the two NEVER
 *   masquerade as each other).
 *
 * NOTHING here invents a measurement: a seam that cannot be read answers
 * its honest unknown (null / "unavailable"), and the fallback vocabulary
 * states the deployment's REAL posture (the dispatch invariant — a
 * selection that does not match the composition's dispatch provider fails
 * loud; an explicit selection the director refused is a typed refusal,
 * never a silent substitution).
 *
 * This module is a PROJECTION layer: no new domain vocabulary, no store
 * writes, no clock (every input is data the seams already produced). The
 * exact wire shapes are documented for the J006 UI lane (Worker C) in
 * `docs/status/j006-backend-compute-transparency.md`.
 */
import type { SelectionExplanation } from "@sporta/connection-center";
import type { SportaServer } from "./composition";

// ---------------------------------------------------------------------------
// The six-field views (the J006 acceptance vocabulary, by name)
// ---------------------------------------------------------------------------

/**
 * Field 1 — COMPUTE SOURCE: whose compute this is (the R408
 * execution-ownership vocabulary over the operator's declared facts).
 */
export interface TransparencyComputeSource {
  /** The responsibility boundary (the R408 vocabulary, verbatim). */
  executionOwnership: "sporta-managed" | "user-owned-provider";
  /** The composition's provider kind (DATA — `in-process` / `http`). */
  provider: string;
  /** The compute adapter's own id (the W914 descriptor). */
  adapterId: string;
}

/** Field 4 — MEASURED ALLOWANCE/COST (estimates vs measurements, labeled). */
export interface TransparencyMeasuredCost {
  /**
   * The SELECTED PROVIDER'S OWN QUOTE for the workload (the broker's
   * honest nullables — an estimate, labeled as one; `null` quote = the
   * provider cannot estimate, never a guessed number).
   */
  estimate: {
    estimatedCostUsd: number | null;
    estimatedQueueSeconds: number | null;
    source: "broker-quote";
  } | null;
  /**
   * The job's METERED usage (the W919 cost units — REAL measurements the
   * compute adapter's metering produced at execution time; present only
   * once the job is terminal). Absent = not measured yet.
   */
  measured: {
    units: { unitId: string; quantity: number }[];
    source: "compute-adapter-metering";
  } | null;
}

/** Field 5 — PRIVACY POSTURE (the applied constraint + the zone facts). */
export interface TransparencyPrivacyPosture {
  /** The preference BOTH selection modes applied (the R407 vocabulary). */
  appliedPreference: "privacy-local-only" | "privacy-any";
  /**
   * The selected provider's declared privacy zone (the operator's DATA
   * declaration behind the selection seam — `sporta-managed` /
   * `user-local` / `provider-cloud`; `null` when no plane is configured).
   */
  providerZone: string | null;
}

/** One considered provider that lost before the winner (honest reasons). */
export interface TransparencyRefusedCandidate {
  providerId: string;
  /** The broker's typed refusal reason (closed vocabulary), when recorded. */
  brokerRefusalReason?: string;
  /** The director's preference-exclusion axis, when one excluded it. */
  preferenceExclusionAxis?: string;
  /** The honest evidence line (never empty). */
  message: string;
}

/** Field 6 — FALLBACK STATE (the deployment's real substitution posture). */
export interface TransparencyFallbackState {
  /** The directive mode the selection ran under (the R407 vocabulary). */
  mode: "user-explicit" | "sporta-auto";
  /** The provider the user named (explicit mode only). */
  requestedProviderId: string | null;
  /** The provider that actually won. */
  selectedProviderId: string;
  /**
   * Whether the winner DIFFERS from the requested provider. Always false
   * on a successful answer: an explicit selection the director could not
   * honor is a typed REFUSAL (422), never a silent substitution — the
   * invariant is stated because it is enforced, not assumed.
   */
  substitutedFromRequested: boolean;
  /** Every considered provider that lost before the winner (verbatim reasons). */
  refusedBeforeSelection: TransparencyRefusedCandidate[];
  /** The deployment's substitution policy (the enforced invariant). */
  policy: "explicit-selection-refuses-instead-of-substituting";
}

/** The six-field transparency document for ONE selection. */
export interface SelectionTransparencyView {
  computeSource: TransparencyComputeSource;
  /** Field 2 — PROVIDER: the selected provider id (DATA, never a vendor name). */
  provider: { providerId: string };
  /** Field 3 — SELECTION REASON: the director's own closed-vocabulary reason. */
  selectionReason: { reason: string; mode: "user-explicit" | "sporta-auto" };
  measuredAllowanceCost: TransparencyMeasuredCost;
  privacyPosture: TransparencyPrivacyPosture;
  fallbackState: TransparencyFallbackState;
}

// ---------------------------------------------------------------------------
// The plane-level view (GET /api/create/compute-status)
// ---------------------------------------------------------------------------

/** The plane-level six-field document (no selection context — honest). */
export interface PlaneTransparencyView {
  computeSource: TransparencyComputeSource | null;
  provider: { providerId: string } | null;
  /**
   * The plane's configuration reason: the composition's env-driven
   * configuration fact (NOT a per-request selection — the per-selection
   * reason lives on the selection surfaces). `null` when no plane exists.
   */
  selectionReason: {
    kind: "deployment-configured";
    detail: string;
  } | null;
  /**
   * The caller's daily allowance states + the plane's metered usage
   * totals (the W919 seams VERBATIM — an unreadable counter is the
   * fail-closed entry, an unmeasured total stays null).
   */
  measuredAllowanceCost: {
    allowance: unknown;
    measuredUsage: unknown;
    note: string;
  };
  privacyPosture: {
    zone: string | null;
    capabilityClasses: string[];
  };
  fallbackState: {
    /** How many providers the selection seam registered (a real count). */
    registeredProviders: number;
    /** The deployment's plane shape (honest — one provider is one provider). */
    posture: "single-provider-plane" | "multi-provider-plane";
    /** The dispatch invariant (enforced at every dispatch — see dispatchRender). */
    dispatchInvariant: string;
    /** The explicit-selection policy (the R407 fail-loud posture). */
    explicitSelectionPolicy: string;
  };
}

// ---------------------------------------------------------------------------
// The projections (pure — every input is seam data)
// ---------------------------------------------------------------------------

/** The plane's compute-source facts (null when no plane is configured). */
function planeSourceOf(server: SportaServer): TransparencyComputeSource | null {
  if (server.selection === null || server.compute === null) return null;
  return {
    executionOwnership:
      server.selection.facts.privacyZone === "sporta-managed"
        ? "sporta-managed"
        : "user-owned-provider",
    provider: server.compute.provider,
    adapterId: server.compute.adapterId,
  };
}

/**
 * The selection-level six-field projection. Inputs: the composition (the
 * plane facts + the compute identity), the director's explanation (the
 * auditable decision document), and the selected provider's own quote out
 * of that explanation (the winner's `considered` record).
 */
export function selectionTransparencyOf(
  server: SportaServer,
  explanation: SelectionExplanation,
): SelectionTransparencyView {
  const source = planeSourceOf(server);
  if (source === null) {
    // The caller (studio service) already refuses selection surfaces when
    // no plane exists — reaching here is a composition bug, fail loud.
    throw new Error("selection transparency requires a configured compute plane");
  }
  const winner = explanation.considered.find(
    (entry) => entry.providerId === explanation.selectedProviderId,
  );
  const refusedBeforeSelection: TransparencyRefusedCandidate[] = explanation.considered
    .filter((entry) => entry.providerId !== explanation.selectedProviderId)
    .filter((entry) => entry.brokerRefusal !== undefined || entry.preferenceExclusion !== undefined)
    .map((entry) => ({
      providerId: entry.providerId,
      ...(entry.brokerRefusal !== undefined
        ? { brokerRefusalReason: entry.brokerRefusal.reason }
        : {}),
      ...(entry.preferenceExclusion !== undefined
        ? { preferenceExclusionAxis: entry.preferenceExclusion.axis }
        : {}),
      message: entry.brokerRefusal?.message ?? entry.preferenceExclusion?.message ?? "refused",
    }));
  return {
    computeSource: source,
    provider: { providerId: explanation.selectedProviderId },
    selectionReason: { reason: explanation.selectionReason, mode: explanation.mode },
    measuredAllowanceCost: {
      estimate:
        winner?.quote !== undefined
          ? {
              estimatedCostUsd: winner.quote.estimatedCostUsd,
              estimatedQueueSeconds: winner.quote.estimatedQueueSeconds,
              source: "broker-quote",
            }
          : null,
      measured: null,
    },
    privacyPosture: {
      appliedPreference: explanation.appliedPreference.privacyPosture,
      providerZone: providerZoneOf(server, explanation.selectedProviderId),
    },
    fallbackState: {
      mode: explanation.mode,
      requestedProviderId: explanation.requestedProviderId ?? null,
      selectedProviderId: explanation.selectedProviderId,
      substitutedFromRequested:
        explanation.requestedProviderId !== undefined &&
        explanation.requestedProviderId !== explanation.selectedProviderId,
      refusedBeforeSelection,
      policy: "explicit-selection-refuses-instead-of-substituting",
    },
  };
}

/**
 * The provider's declared privacy zone by provider id (the selection
 * seam's registered facts — DATA; null when the id is not registered,
 * which the dispatch invariant makes impossible for a winner).
 */
function providerZoneOf(server: SportaServer, providerId: string): string | null {
  // The composition registers exactly its own adapter under the selection
  // facts today; the facts map is the seam — a future multi-provider
  // composition extends it without touching this projection.
  return server.selection !== null && server.selection.providerId === providerId
    ? server.selection.facts.privacyZone
    : null;
}

/**
 * Attaches a job's METERED usage (the W919 cost units at terminal state)
 * to a selection record's transparency document — the measurement the
 * adapter's own metering produced, labeled as measured (never as an
 * estimate). Generic over the record shape so every surface's record type
 * can flow through unchanged.
 */
export function withMeasuredUsage<T extends { transparency: SelectionTransparencyView }>(
  record: T,
  usage: { unitId: string; quantity: number }[] | undefined,
): T {
  if (usage === undefined) return record;
  return {
    ...record,
    transparency: {
      ...record.transparency,
      measuredAllowanceCost: {
        ...record.transparency.measuredAllowanceCost,
        measured: {
          units: usage.map((unit) => ({ unitId: unit.unitId, quantity: unit.quantity })),
          source: "compute-adapter-metering",
        },
      },
    },
  };
}

/**
 * The plane-level six-field projection (the compute-status surface): the
 * deployment's own compute plane facts, the caller's allowance states and
 * the plane's metered totals (the guardrails seams, verbatim), and the
 * deployment's fallback posture (the registered-provider count + the two
 * enforced policies).
 */
export function planeTransparencyOf(
  server: SportaServer,
  seamData: {
    /** The caller's daily allowance states (the W919 quota seam's answer). */
    allowance: unknown;
    /** The plane's metered usage totals (the W919 usage seam's answer). */
    measuredUsage: unknown;
  },
): PlaneTransparencyView {
  const source = planeSourceOf(server);
  const registeredProviders = server.selection !== null ? 1 : 0;
  return {
    computeSource: source,
    provider: server.selection !== null ? { providerId: server.selection.providerId } : null,
    selectionReason:
      source !== null
        ? {
            kind: "deployment-configured",
            detail:
              "this deployment's compute plane is env-configured at composition (not a per-request selection); per-render selection reasons ride each job's selection explanation",
          }
        : null,
    measuredAllowanceCost: {
      allowance: seamData.allowance,
      measuredUsage: seamData.measuredUsage,
      note: "allowance = the W919 per-user daily quota states (fail-closed entries on unreadable counters); measuredUsage = the plane's metered totals (null = not measured, never a fabricated 0)",
    },
    privacyPosture: {
      zone: server.selection?.facts.privacyZone ?? null,
      capabilityClasses: [...(server.selection?.facts.capabilityClasses ?? [])],
    },
    fallbackState: {
      registeredProviders,
      posture:
        registeredProviders === 0
          ? "no-plane"
          : registeredProviders === 1
            ? "single-provider-plane"
            : "multi-provider-plane",
      dispatchInvariant:
        "every dispatch re-runs the REAL SelectionDirector over the same workload and REFUSES (fail-loud) any selection that does not match the composition's dispatch provider — a silent provider substitution cannot occur",
      explicitSelectionPolicy:
        "an explicitly selected provider the director cannot honor is a typed refusal (422 with every recorded reason) — explicit means explicit, fallback is never silent",
    },
  };
}
