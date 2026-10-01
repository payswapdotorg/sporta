/**
 * Publication incentive accrual (REL-034): the honest wire between a
 * REL-022 publication and the REL-021 incentive ledger.
 *
 * THE CONTRACTS (docs/contracts/organization-registry-and-promotion.md
 * §Incentive policy, FROZEN; ADR-013 #12; Gate REL-A6):
 *
 * - "A reward policy is versioned and displayed to the user." —
 *   {@link incentivePolicyView} is the displayable view of the policy in
 *   force at an instant (the A6 "see incentive policy" clause, shown at
 *   every choice point of the lab journey).
 * - "Discovery boosts must be explicit and auditable; they are not silently
 *   mixed into quality evidence." — the accrual records boosts through the
 *   ledger's own `recordDiscoveryBoost` (policy version + human-visible
 *   disclosure on the entry, subject = the publication).
 * - Enforcement is HONEST: publication accrues EXACTLY what the policy in
 *   force at accrual time configures — the on-policy credit amount (the
 *   ledger re-verifies it), the disclosed boost, the private-use window —
 *   and every off-policy attempt refuses TYPED and RECORDED, never silently
 *   adjusted:
 *     - wrong actor (a tenant that is not the publisher) -> `wrong-actor`;
 *     - double claim (the publication already accrued) -> `already-accrued`;
 *     - revoked publication (withdrawn) -> `publication-withdrawn`;
 *     - incomplete exchange eligibility (the publication carries no
 *       security/policy evidence, or a failed check — the exchange
 *       boundary's own rule) -> `evidence-ineligible`: the incentive ledger
 *       reflects only publications eligible at the exchange boundary.
 *   Every attempt, granted or refused, appends to the accrual's own
 *   append-only attempt log (`attempts()`); benefit-level refusals (for
 *   example a private-use window that is already active) are carried per
 *   benefit on the granted record — named, never silently dropped.
 *
 * WIRING CONTRACT: construct the accrual with the LEDGER of the lab that
 * owns the publication and the SAME policy store (and clock) the ledger was
 * constructed with. The accrual enumerates benefits from the active policy
 * and the ledger independently re-verifies every write against the same
 * policy — defense in depth, one truth.
 *
 * Fail-closed inheritance: an accrual attempt when NO policy version is in
 * force propagates the policy store's typed not-found (no policy, no
 * incentive writes — the ledger's own law); an unknown publication id
 * propagates the exchange's typed not-found (storage boundary).
 */
import { z } from "zod";
import type { TenantRef } from "../domain";
import { requireTenantRef } from "../domain";
import { createUserLabsDefaultClock, createSequentialIdSource, toIsoUtc } from "../clock";
import type { IdSource } from "../clock";
import { LabValidationError } from "../errors";
import type { Exchange, PublishedOrganization } from "../exchange/publish";
import type { IncentiveLedger, LedgerRefusalReason } from "./ledger";
import type { IncentivePolicy, IncentivePolicyStore } from "./policy";

// ---------------------------------------------------------------------------
// The A6 "see incentive policy" view
// ---------------------------------------------------------------------------

/** The displayable incentive policy in force at an instant (REL-A6). */
export interface IncentivePolicyView {
  policyId: string;
  policyVersion: number;
  effectiveFrom: string;
  /** The instant the view was taken for (the choice point). */
  inForceAt: string;
  /** The human-visible policy disclosure displayed to the user. */
  disclosureText: string;
  benefits: {
    privateUseWindowDays: number | null;
    discoveryBoost: { disclosed: true; description: string } | null;
    capabilityCredits: { creditsPerGrant: number; planGoverned: boolean } | null;
  };
}

/**
 * The incentive policy VISIBLE to the user at a choice point: the version in
 * force at `when`, with its full benefit configuration and the exact
 * disclosure text a UI must display. Fails closed (typed not-found) when no
 * version is in force yet — the user must never be shown an invented policy.
 */
export async function incentivePolicyView(
  policies: IncentivePolicyStore,
  when: string,
): Promise<IncentivePolicyView> {
  const policy: IncentivePolicy = await policies.activePolicyAt(when);
  return {
    policyId: policy.policyId,
    policyVersion: policy.version,
    effectiveFrom: policy.effectiveFrom,
    inForceAt: when,
    disclosureText: policy.disclosureText,
    benefits: {
      privateUseWindowDays: policy.benefits.privateUseWindowDays,
      discoveryBoost:
        policy.benefits.discoveryBoost === null ? null : { ...policy.benefits.discoveryBoost },
      capabilityCredits:
        policy.benefits.capabilityCredits === null
          ? null
          : { ...policy.benefits.capabilityCredits },
    },
  };
}

// ---------------------------------------------------------------------------
// Exchange eligibility of a publication (the boundary's own rule)
// ---------------------------------------------------------------------------

/**
 * Every exchange-eligibility gap of a publication, in words — the REL-023
 * import boundary's own security rule (evidence present AND passed; absence
 * of evidence is not a pass). Empty list = eligible. The incentive accrual
 * refuses on a non-empty list: the ledger reflects only eligible
 * publications.
 */
export function exchangeEligibilityGaps(publication: PublishedOrganization): string[] {
  const gaps: string[] = [];
  const security = publication.snapshot.evidence.securityPolicy;
  if (security === undefined) {
    gaps.push(
      "evidence: no security/policy evidence on the publication — absence of evidence is not a pass",
    );
    return gaps;
  }
  const failed = security.checks.filter((check) => !check.passed).map((check) => check.checkId);
  if (failed.length > 0) {
    gaps.push(`evidence: security/policy check(s) failed: ${failed.join(", ")}`);
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// Outcomes (typed refusal records — never thrown)
// ---------------------------------------------------------------------------

/** Why a publication accrual was refused (the four off-policy shapes). */
export type AccrualRefusalReason =
  "wrong-actor" | "already-accrued" | "publication-withdrawn" | "evidence-ineligible";

/** One configured benefit's accrual result (accrued, or refused with reason). */
export interface AccrualBenefitOutcome {
  benefit: "capability-credits" | "discovery-boost" | "private-use-window";
  outcome: "accrued" | "refused";
  /** Present iff refused — the ledger's own typed refusal reason. */
  reason?: LedgerRefusalReason;
  message: string;
}

/** A granted accrual: what the policy in force granted, per benefit. */
export interface AccrualGranted {
  outcome: "accrued";
  attemptId: string;
  publicationId: string;
  /** The policy version in force at accrual time (recorded, never rewritten). */
  policyVersion: number;
  /** Per-benefit results — a benefit-level refusal is named, never dropped. */
  benefits: readonly AccrualBenefitOutcome[];
  recordedAt: string;
}

/** A refused accrual — typed evidence of the off-policy attempt. */
export interface AccrualRefused {
  outcome: "refused";
  attemptId: string;
  publicationId: string;
  policyVersion: number;
  reason: AccrualRefusalReason;
  message: string;
  /** The eligibility gaps in words (evidence-ineligible only). */
  gaps?: string[];
  recordedAt: string;
}

/** The union a caller discriminates on. */
export type AccrualOutcome = AccrualGranted | AccrualRefused;

// ---------------------------------------------------------------------------
// The attempt log (every attempt recorded — granted AND refused)
// ---------------------------------------------------------------------------

/** One auditable accrual attempt, whatever its outcome. */
export interface AccrualAttemptRecord {
  attemptId: string;
  /** The tenant that attempted (the wrong actor is recorded as itself). */
  caller: TenantRef;
  publicationId: string;
  outcome: "accrued" | "refused";
  reason?: AccrualRefusalReason;
  /** The eligibility gaps in words (evidence-ineligible only). */
  gaps?: string[];
  policyVersion: number;
  recordedAt: string;
  /** Per-benefit results (granted attempts only). */
  benefits?: readonly AccrualBenefitOutcome[];
}

// ---------------------------------------------------------------------------
// The accrual engine
// ---------------------------------------------------------------------------

/** Options for {@link createPublicationIncentiveAccrual}. */
export interface AccrualOptions {
  /** The per-lab ledger incentives are accrued into (the lab owning the publication). */
  ledger: IncentiveLedger;
  /** The SAME policy store the ledger checks against (one truth, defense in depth). */
  policies: IncentivePolicyStore;
  /** The exchange the publication lives in. */
  exchange: Exchange;
  /** Injected clock (deterministic default — never `Date.now`). */
  clock?: () => number;
  attemptIds?: IdSource;
}

const AccrualRequestSchema = z.strictObject({
  publicationId: z.string().min(1),
});

/** The publication-incentive accrual port. */
export interface PublicationIncentiveAccrual {
  /**
   * Accrues a publication's incentives under the policy in force. Every
   * refusal is a typed record AND an entry in the attempt log; nothing is
   * ever silently adjusted.
   */
  accrue(caller: TenantRef, request: { publicationId: string }): Promise<AccrualOutcome>;
  /** Every attempt, oldest first — granted and refused alike. */
  attempts(): Promise<readonly AccrualAttemptRecord[]>;
}

function zodIssues(error: z.ZodError): unknown[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/** Builds the in-memory publication-incentive accrual. */
export function createPublicationIncentiveAccrual(
  options: AccrualOptions,
): PublicationIncentiveAccrual {
  const { ledger, policies, exchange } = options;
  const clock = options.clock ?? createUserLabsDefaultClock();
  const attemptIds = options.attemptIds ?? createSequentialIdSource("accrual");
  const attemptLog: AccrualAttemptRecord[] = [];
  /** Publication ids whose accrual was granted (the double-claim guard). */
  const accrued = new Set<string>();

  function recordAttempt(entry: AccrualAttemptRecord): AccrualAttemptRecord {
    const frozen = Object.freeze(entry) as AccrualAttemptRecord;
    attemptLog.push(frozen);
    return frozen;
  }

  return {
    async accrue(caller, request) {
      requireTenantRef(caller);
      const parsed = AccrualRequestSchema.safeParse(request);
      if (!parsed.success) {
        throw new LabValidationError("accrual request is invalid", zodIssues(parsed.error));
      }
      const publicationId = parsed.data.publicationId;
      const recordedAt = toIsoUtc(clock());
      // Fail closed: no policy in force -> the store's typed not-found (the
      // ledger's own law — no policy, no incentive writes).
      const policy: IncentivePolicy = await policies.activePolicyAt(recordedAt);
      const publication: PublishedOrganization = await exchange.getPublication(publicationId);

      const refuse = (reason: AccrualRefusalReason, message: string, gaps?: string[]) => {
        const attemptId = attemptIds.nextId();
        recordAttempt({
          attemptId,
          caller: { ...caller },
          publicationId,
          outcome: "refused",
          reason,
          policyVersion: policy.version,
          recordedAt,
          ...(gaps !== undefined ? { gaps } : {}),
        } as AccrualAttemptRecord);
        return {
          outcome: "refused",
          attemptId,
          publicationId,
          policyVersion: policy.version,
          reason,
          message,
          ...(gaps !== undefined ? { gaps } : {}),
          recordedAt,
        } satisfies AccrualRefused;
      };

      // 1. Wrong actor: only the publishing tenant accrues its publication.
      if (publication.publishedBy.tenantId !== caller.tenantId) {
        return refuse(
          "wrong-actor",
          `accrual refused: tenant '${caller.tenantId}' may not accrue the incentives of ` +
            `publication '${publicationId}' published by tenant ` +
            `'${publication.publishedBy.tenantId}' — only the publisher accrues`,
        );
      }
      // 2. Double claim: one accrual per publication, ever.
      if (accrued.has(publicationId)) {
        return refuse(
          "already-accrued",
          `accrual refused: publication '${publicationId}' has already accrued its incentives ` +
            `under policy '${policy.policyId}' — a second grant would be a hidden reward`,
        );
      }
      // 3. Revoked publication: withdrawal preserves lineage but closes accrual.
      if (publication.status === "withdrawn") {
        return refuse(
          "publication-withdrawn",
          `accrual refused: publication '${publicationId}' is withdrawn — the lineage is ` +
            `preserved but the incentive path is closed`,
        );
      }
      // 4. Exchange eligibility: the ledger reflects only eligible publications.
      const gaps = exchangeEligibilityGaps(publication);
      if (gaps.length > 0) {
        return refuse(
          "evidence-ineligible",
          `accrual refused: publication '${publicationId}' fails exchange eligibility — ` +
            `${gaps.length} gap(s): ${gaps.join("; ")}`,
          gaps,
        );
      }

      // The on-policy accrual: exactly what the policy in force configures,
      // each benefit through the ledger's own policy-checked operation.
      const benefits: AccrualBenefitOutcome[] = [];
      const credits = policy.benefits.capabilityCredits;
      if (credits !== null) {
        const result = await ledger.grantCredits(caller, {
          amount: credits.creditsPerGrant,
          note: `publication accrual: ${publicationId}`,
        });
        benefits.push(
          result.outcome === "recorded"
            ? {
                benefit: "capability-credits",
                outcome: "accrued",
                message: `granted ${credits.creditsPerGrant} capability credits (policy '${policy.policyId}':v${policy.version})`,
              }
            : {
                benefit: "capability-credits",
                outcome: "refused",
                reason: result.reason,
                message: result.message,
              },
        );
      }
      const boost = policy.benefits.discoveryBoost;
      if (boost !== null) {
        const result = await ledger.recordDiscoveryBoost(caller, {
          publicationId,
          note: "publication accrual",
        });
        benefits.push(
          result.outcome === "recorded"
            ? {
                benefit: "discovery-boost",
                outcome: "accrued",
                message: `recorded the disclosed discovery boost under policy '${policy.policyId}':v${policy.version}`,
              }
            : {
                benefit: "discovery-boost",
                outcome: "refused",
                reason: result.reason,
                message: result.message,
              },
        );
      }
      if (policy.benefits.privateUseWindowDays !== null) {
        const result = await ledger.startPrivateUseWindow(caller);
        benefits.push(
          result.outcome === "recorded"
            ? {
                benefit: "private-use-window",
                outcome: "accrued",
                message: `started a ${policy.benefits.privateUseWindowDays}-day private-use window (policy '${policy.policyId}':v${policy.version})`,
              }
            : {
                benefit: "private-use-window",
                outcome: "refused",
                reason: result.reason,
                message: result.message,
              },
        );
      }

      accrued.add(publicationId);
      const attemptId = attemptIds.nextId();
      recordAttempt({
        attemptId,
        caller: { ...caller },
        publicationId,
        outcome: "accrued",
        policyVersion: policy.version,
        recordedAt,
        benefits,
      } as AccrualAttemptRecord);
      return {
        outcome: "accrued",
        attemptId,
        publicationId,
        policyVersion: policy.version,
        benefits,
        recordedAt,
      } satisfies AccrualGranted;
    },

    async attempts() {
      return [...attemptLog];
    },
  };
}
