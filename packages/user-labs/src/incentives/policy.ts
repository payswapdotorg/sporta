/**
 * The versioned incentive policy store (REL-021).
 *
 * THE CONTRACT (docs/contracts/organization-registry-and-promotion.md
 * §Incentive policy, FROZEN):
 *
 * - "The system supports configurable user-lab rewards: private-use window
 *   up to six months; disclosed discovery/featured benefit; capability
 *   credits or other plan-governed benefits."
 * - "A reward policy is versioned and displayed to the user."
 * - "Discovery boosts must be explicit and auditable; they are not silently
 *   mixed into quality evidence."
 *
 * POLICY CHANGE SEMANTICS (tested explicitly): a NEW version applies
 * PROSPECTIVELY — `effectiveFrom` decides which version is in force at any
 * instant, and existing ledger entries keep the policy version under which
 * they were recorded (src/incentives/ledger.ts never rewrites an entry).
 * Nothing here can retroactively re-price a reward.
 *
 * Fail-closed validation at registration: a private-use window longer than
 * six months (180 days), an UNDISCLOSED discovery boost, a non-monotonic
 * version or an out-of-order `effectiveFrom` all refuse the policy record
 * before it can govern anything — incentives are policy/configuration, never
 * hidden ranking rules (ADR-013 #12).
 */
import { z } from "zod";
import { deepFreeze } from "../domain";
import { LabConflictError, LabNotFoundError, LabValidationError } from "../errors";

// ---------------------------------------------------------------------------
// The policy record
// ---------------------------------------------------------------------------

/** Six months, the conventional bound the frozen contract names. */
export const MAX_PRIVATE_USE_WINDOW_DAYS = 180;

/** The plan-governed capability-credits benefit. */
export interface CapabilityCreditsBenefit {
  /** The on-policy credit amount ONE grant may award. */
  creditsPerGrant: number;
  /** Whether the benefit is additionally plan-governed (subject to plan/policy). */
  planGoverned: boolean;
}

/** The disclosed discovery/featured benefit. */
export interface DiscoveryBoostBenefit {
  /**
   * Must be `true` — the schema itself refuses an undisclosed boost
   * ("Discovery boosts must be explicit and auditable").
   */
  disclosed: true;
  /** The human-visible description of what the boost does. */
  description: string;
}

/** The benefit bundle an incentive policy version configures. */
export interface IncentivePolicyBenefits {
  /** Private-use window in days (null = no window benefit). */
  privateUseWindowDays: number | null;
  discoveryBoost: DiscoveryBoostBenefit | null;
  capabilityCredits: CapabilityCreditsBenefit | null;
}

/** A versioned, displayed-to-user incentive policy record. */
export interface IncentivePolicy {
  policyId: string;
  version: number;
  /** ISO-8601 UTC instant from which this version is in force. */
  effectiveFrom: string;
  benefits: IncentivePolicyBenefits;
  /** The human-visible policy disclosure displayed to the user. */
  disclosureText: string;
}

const IsoInstantSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)), {
  message: "effectiveFrom must be an ISO-8601 instant",
});

export const IncentivePolicySchema = z.strictObject({
  policyId: z.string().min(1),
  version: z.number().int().min(1),
  effectiveFrom: IsoInstantSchema,
  benefits: z.strictObject({
    privateUseWindowDays: z.number().int().min(1).max(MAX_PRIVATE_USE_WINDOW_DAYS).nullable(),
    discoveryBoost: z
      .strictObject({
        // z.literal(true): an undisclosed boost cannot even be expressed.
        disclosed: z.literal(true),
        description: z.string().min(1),
      })
      .nullable(),
    capabilityCredits: z
      .strictObject({
        creditsPerGrant: z.number().int().min(1),
        planGoverned: z.boolean(),
      })
      .nullable(),
  }),
  disclosureText: z.string().min(1),
});

// ---------------------------------------------------------------------------
// The policy store
// ---------------------------------------------------------------------------

/** The incentive-policy store port. */
export interface IncentivePolicyStore {
  /**
   * Registers a new policy version. Validation is fail-closed (typed
   * validation error listing every problem); a duplicate or non-monotonic
   * version is a typed conflict. The new version applies PROSPECTIVELY only.
   */
  addPolicy(policy: unknown): Promise<IncentivePolicy>;
  /** One version by number (typed not-found when unknown). */
  getPolicy(version: number): Promise<IncentivePolicy>;
  /** Every version, oldest first. */
  listPolicies(): Promise<IncentivePolicy[]>;
  /**
   * The policy in force at an instant: the latest version whose
   * `effectiveFrom` <= the instant. Typed not-found when no version is in
   * force yet — fail closed (no policy, no incentive writes).
   */
  activePolicyAt(when: string): Promise<IncentivePolicy>;
}

/** Builds the in-memory incentive-policy store. */
export function createIncentivePolicyStore(): IncentivePolicyStore {
  const versions: IncentivePolicy[] = [];

  function zodIssues(error: z.ZodError): unknown[] {
    return error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
  }

  return {
    async addPolicy(policy) {
      const parsed = IncentivePolicySchema.safeParse(policy);
      if (!parsed.success) {
        throw new LabValidationError("incentive policy is invalid", zodIssues(parsed.error));
      }
      const next = parsed.data;
      const previous = versions[versions.length - 1];
      if (previous !== undefined) {
        if (next.version <= previous.version) {
          throw new LabConflictError(
            "incentive policy version must increase (policy changes are new versions, " +
              "never in-place edits)",
            {
              policyId: next.policyId,
              attemptedVersion: next.version,
              latestVersion: previous.version,
            },
          );
        }
        if (Date.parse(next.effectiveFrom) < Date.parse(previous.effectiveFrom)) {
          throw new LabValidationError(
            "incentive policy effectiveFrom must not precede the previous version's",
            [
              {
                path: "effectiveFrom",
                message: `previous version ${previous.version} is effective from ${previous.effectiveFrom}`,
              },
            ],
          );
        }
      }
      const frozen = deepFreeze({ ...next, benefits: { ...next.benefits } });
      versions.push(frozen);
      return frozen;
    },

    async getPolicy(version) {
      const found = versions.find((p) => p.version === version);
      if (found === undefined) {
        throw new LabNotFoundError("incentive policy version not found", { version });
      }
      return found;
    },

    async listPolicies() {
      return [...versions];
    },

    async activePolicyAt(when) {
      const whenMs = Date.parse(when);
      if (!Number.isFinite(whenMs)) {
        throw new LabValidationError("activePolicyAt requires an ISO-8601 instant", [
          { path: "when", message: `not parseable: ${when}` },
        ]);
      }
      let active: IncentivePolicy | undefined;
      for (const policy of versions) {
        if (Date.parse(policy.effectiveFrom) <= whenMs) active = policy;
      }
      if (active === undefined) {
        throw new LabNotFoundError(
          "no incentive policy is in force at the requested instant — fail closed",
          { when },
        );
      }
      return active;
    },
  };
}
