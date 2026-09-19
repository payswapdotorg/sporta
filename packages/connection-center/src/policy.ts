/**
 * THE connection-center POLICY (R407/R409): a versioned, typed DATA
 * document — never code — holding every tunable the selection director
 * and the managed compute seam consult. The camera-director `policy.ts`
 * precedent: policy documents are config, not code (unknown keys are
 * IGNORED so older readers tolerate newer writers), every constant that
 * shapes a decision is a named, documented policy field, and the shipped
 * default is pinned by a committed golden
 * (`fixtures/golden/default-policy.json`) plus tests.
 *
 * What lives here (and WHY it is policy, not code):
 *
 * - the DEFAULT privacy posture and the auto-selection tie-break
 *   (product posture — the product team owns it);
 * - whether an explicit user selection MUST win or fail (the R407 accept
 *   criterion "user may explicitly choose" is enforced true — the policy
 *   documents that it can only ever be `true`, and validation rejects a
 *   `false` as dishonest);
 * - the VRAM preference bound (sanity: a floor above the declared
 *   `maxVramFloorMb` is rejected loudly — a caller typo, never a silent
 *   nothing-matches-everything filter);
 * - the managed-plane ALARM thresholds (fractions of an allowance at
 *   which a spend alarm event is recorded — the W919 posture) and the
 *   fail-closed admission switch (documented constant-true, same
 *   honesty rule).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// The privacy + capability vocabularies (DATA axes, never provider names)
// ---------------------------------------------------------------------------

/** The privacy postures a user may express (closed vocabulary). */
export const SELECTION_PRIVACY_POSTURES = [
  /** Only providers whose execution zone the user controls (self-hosted). */
  "privacy-local-only",
  /** Any execution zone. */
  "privacy-any",
] as const;
export type SelectionPrivacyPosture = (typeof SELECTION_PRIVACY_POSTURES)[number];

/**
 * The execution zones a provider ENTRY may declare (operator DATA — the
 * honest declaration of where jobs run; provider ids stay data). Closed
 * vocabulary so the privacy axis is a real guard, not a stringly match.
 */
export const PROVIDER_FACT_ZONES = [
  /** Runs on hardware the user controls (self-hosted). */
  "user-controlled",
  /** Runs on a third-party provider cloud (BYOC). */
  "provider-cloud",
  /** Runs on Sporta-managed infrastructure (the managed plane). */
  "sporta-managed",
] as const;
export type ProviderFactZone = (typeof PROVIDER_FACT_ZONES)[number];

/** The preference axes the director itself filters on (closed vocabulary). */
export const SELECTION_EXCLUSION_AXES = ["privacy", "vram", "capability"] as const;
export type SelectionExclusionAxis = (typeof SELECTION_EXCLUSION_AXES)[number];

// ---------------------------------------------------------------------------
// The policy document
// ---------------------------------------------------------------------------

/** The policy version (MAJOR.MINOR — bumped on any semantic change). */
export const CONNECTION_POLICY_VERSION = "1.0" as const;

const SelectionPolicySection = z
  .object({
    /** The posture when a caller expresses none (product default). */
    defaultPrivacyPosture: z.enum(SELECTION_PRIVACY_POSTURES),
    /** The auto-selection tie-break (only registration order exists). */
    autoTieBreak: z.literal("registration-order"),
    /** Whether an explicit user selection must win or fail (always true). */
    explicitMustWin: z.literal(true),
    /** Sanity bound on the VRAM-floor preference (reject typos loudly). */
    maxVramFloorMb: z.number().finite().min(1).max(1_000_000),
  })
  .strip();

const ManagedPolicySection = z
  .object({
    /** Allowance fractions at which a spend-alarm event is recorded. */
    alarmThresholds: z.array(z.number().finite().min(0).max(1)).min(1).max(16),
    /** Whether admission fails closed when allowance is exhausted (always true). */
    failClosedAdmission: z.literal(true),
  })
  .strip();

/** The whole policy document (unknown keys ignored — config, not code). */
export const ConnectionCenterPolicy = z
  .object({
    policyVersion: z.string().regex(/^\d+\.\d+$/, 'policyVersion must be "MAJOR.MINOR"'),
    selection: SelectionPolicySection,
    managed: ManagedPolicySection,
  })
  .strip();
export type ConnectionCenterPolicy = z.infer<typeof ConnectionCenterPolicy>;

/** The shipped default policy (pinned by the committed golden + tests). */
export const DEFAULT_CONNECTION_POLICY: ConnectionCenterPolicy = Object.freeze({
  policyVersion: CONNECTION_POLICY_VERSION,
  selection: Object.freeze({
    defaultPrivacyPosture: "privacy-any",
    autoTieBreak: "registration-order",
    explicitMustWin: true,
    maxVramFloorMb: 256 * 1024,
  }),
  managed: Object.freeze({
    alarmThresholds: Object.freeze([0.5, 0.8, 1.0]),
    failClosedAdmission: true,
  }),
}) as ConnectionCenterPolicy;

/**
 * Validates one policy document (zod, unknown keys ignored). Returns the
 * parsed policy or throws the honest validation error — callers never
 * silently fall back to defaults when their policy is malformed.
 */
export function validateConnectionPolicy(input: unknown): ConnectionCenterPolicy {
  const parsed = ConnectionCenterPolicy.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      "connection-center policy failed validation: " +
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  return parsed.data;
}
