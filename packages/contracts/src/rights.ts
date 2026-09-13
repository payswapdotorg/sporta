/**
 * Media rights and authorization contracts (fail-closed).
 *
 * Architecture-lock §11: ingestion requires an explicit authorization/rights
 * policy record; rights metadata travels with the media session; engineering
 * must never assume that transformation by itself clears rights.
 *
 * FAIL-CLOSED SEMANTICS: a missing policy decision means DENY. If a policy is
 * absent, malformed, or expired, every capability in {@link RightsCapabilities}
 * is `false`. A capability is `true` only when the corresponding operation is
 * explicitly allowed by a currently-valid policy. Consumers must never infer
 * capabilities from the absence of a prohibition.
 */
import { z } from "zod";

/** Operations that an authorization policy may allow on ingested media. */
export const AllowedOperation = z.enum([
  "analysis",
  "transformation",
  "liveDelivery",
  "derivativeGeneration",
  "storage",
  "sharing",
]);
export type AllowedOperation = z.infer<typeof AllowedOperation>;

/** Who may see shared derivatives. */
export const SharingScope = z.enum(["private", "operator-authorized"]);
export type SharingScope = z.infer<typeof SharingScope>;

/**
 * An explicit authorization decision attached to a media session.
 *
 * `assertedBy` records who asserted the rights decision (operator identity or
 * service). `expiresAtIso` (ISO-8601 UTC) and `storageDurationDays` bound the
 * decision in time. `allowedOperations` must contain at least one operation;
 * an empty policy allows nothing and should be represented as a denial.
 */
export const AuthorizationPolicy = z.object({
  policyId: z.string().min(1),
  allowedOperations: z.array(AllowedOperation).min(1),
  assertedBy: z.string().min(1),
  expiresAtIso: z.iso.datetime().optional(),
  storageDurationDays: z.number().int().min(0).optional(),
  sharingScope: SharingScope.optional(),
});
export type AuthorizationPolicy = z.infer<typeof AuthorizationPolicy>;

/**
 * Effective rights capabilities passed to renderers (and other consumers).
 *
 * These are derived from an {@link AuthorizationPolicy} — never asserted
 * freely. Derivation rules (see {@link deriveRightsCapabilities}):
 *
 * - `canReferenceSourceFrames`: `transformation` is allowed and the policy is
 *   valid (renderers may reference source frames while transforming).
 * - `canDeliverLive`: `liveDelivery` is allowed and the policy is valid.
 * - `canStoreDerivatives`: both `derivativeGeneration` and `storage` are
 *   allowed and the policy is valid.
 * - `canShare`: `sharing` is allowed and the policy is valid.
 */
export const RightsCapabilities = z.object({
  canReferenceSourceFrames: z.boolean(),
  canDeliverLive: z.boolean(),
  canStoreDerivatives: z.boolean(),
  canShare: z.boolean(),
});
export type RightsCapabilities = z.infer<typeof RightsCapabilities>;

const DENY_ALL: RightsCapabilities = {
  canReferenceSourceFrames: false,
  canDeliverLive: false,
  canStoreDerivatives: false,
  canShare: false,
};

/**
 * Derives the effective {@link RightsCapabilities} from an authorization
 * policy. FAIL-CLOSED: a missing policy, or a policy whose `expiresAtIso` is
 * in the past at `now`, denies everything.
 *
 * @param policy the parsed authorization policy, or `undefined`/`null` when
 *   no decision exists (denial).
 * @param now evaluation time for expiry (defaults to current wall clock).
 */
export function deriveRightsCapabilities(
  policy: AuthorizationPolicy | null | undefined,
  now: Date = new Date(),
): RightsCapabilities {
  if (!policy) return DENY_ALL;
  if (policy.expiresAtIso !== undefined && Date.parse(policy.expiresAtIso) <= now.getTime()) {
    return DENY_ALL;
  }
  const allowed = new Set<AllowedOperation>(policy.allowedOperations);
  return {
    canReferenceSourceFrames: allowed.has("transformation"),
    canDeliverLive: allowed.has("liveDelivery"),
    canStoreDerivatives: allowed.has("derivativeGeneration") && allowed.has("storage"),
    canShare: allowed.has("sharing"),
  };
}
