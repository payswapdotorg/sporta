/**
 * The provider CREDENTIAL state machine (R402-R405): the honest, closed
 * status vocabulary every provider adapter reports, plus the fail-loud
 * gate that makes "dispatch on an adapter whose credential check failed
 * throws the typed refusal BEFORE any network call" true by construction.
 *
 * ## The status vocabulary (closed, honest)
 *
 * - `"missing"` — the configured credentials are ABSENT. The R402 packet's
 *   **SandboxFallback** free-tier development posture: the adapter answers
 *   `provider-unavailable` with a `devModeHint` pointing at the real
 *   in-process worker, and NEVER fakes success;
 * - `"present-unverified"` — credentials are configured but no successful
 *   verification call has completed yet (the first real call verifies de
 *   facto);
 * - `"verified"` — a REAL provider REST call authenticated successfully
 *   (observed by `verifyCredentials()` or a succeeded submit);
 * - `"invalid"` — the provider REJECTED the credentials (a real 401/403
 *   was observed). The packet's three-state vocabulary (`missing |
 *   present-unverified | verified`) is extended with this one member
 *   because reporting `present-unverified` after an observed rejection
 *   would be a lie by omission, and "dispatch … whose credential check
 *   failed throws the typed refusal" needs a state to fail from. The
 *   extension is documented here and in the package README.
 * - `"not-applicable"` — the provider needs no credentials (the R405 local
 *   self-hosted adapter).
 *
 * The DOMAIN adapters read NO environment (test/boundary.test.ts pins it):
 * credentials are INJECTED as plain values; `src/env.ts` is the documented
 * composition-root exception that reads the process environment (the
 * `@sporta/compute-adapter-hosted` `src/env.ts` precedent).
 */
import type { ProviderRefusal } from "./refusal";

/** The closed credential-status vocabulary (see module docs). */
export const PROVIDER_CREDENTIAL_STATES = [
  "missing",
  "present-unverified",
  "verified",
  "invalid",
  "not-applicable",
] as const;
export type ProviderCredentialState = (typeof PROVIDER_CREDENTIAL_STATES)[number];

/** What `adapter.credentialStatus()` answers — honest, never a secret. */
export interface ProviderCredentialStatus {
  /** The closed-vocabulary state (never invented). */
  state: ProviderCredentialState;
  /**
   * Human-readable evidence (which env names are absent, which provider
   * endpoint family verified, the rejection reason) — NEVER a credential
   * value. Present unless `state === "not-applicable"`.
   */
  detail?: string;
  /** The SandboxFallback development hint (present iff `state === "missing"`). */
  devModeHint?: string;
  /** When this status was last established (the injected clock domain). */
  checkedAtMs?: number;
}

/**
 * The fail-loud credential GATE: what a dispatch checks before any network
 * call. `missing` → the SandboxFallback `provider-unavailable` refusal
 * WITH the dev hint; `invalid` → the typed `credential-invalid` refusal.
 * `present-unverified`/`verified`/`not-applicable` pass (the real call
 * verifies de facto).
 */
export function credentialGateRefusal(status: ProviderCredentialStatus): ProviderRefusal | null {
  if (status.state === "missing") {
    const base =
      status.detail ??
      "no provider credentials are configured (SandboxFallback: the adapter refuses honestly instead of faking success)";
    return {
      reason: "provider-unavailable",
      // The devModeHint rides the refusal MESSAGE too, so a caller that
      // only reads the thrown error still learns the free-tier path.
      message: status.devModeHint !== undefined ? `${base} — ${status.devModeHint}` : base,
      transport: { kind: "not-applicable" },
    };
  }
  if (status.state === "invalid") {
    return {
      reason: "credential-invalid",
      message:
        status.detail ??
        "the provider rejected this adapter's credentials (dispatch refused before any network call)",
      transport: { kind: "not-applicable" },
    };
  }
  return null;
}

/** The SandboxFallback hint builder (the free-tier development path). */
export function sandboxFallbackHint(
  envNames: readonly string[],
  inProcessAlternative: string,
): string {
  const names = envNames.join(" + ");
  return `SandboxFallback: ${names} not configured — this adapter answers provider-unavailable honestly and NEVER fakes success. For free-tier local development use the real in-process compute worker (${inProcessAlternative}).`;
}

/**
 * The mutable credential monitor one remote adapter owns: constructed from
 * the INJECTED credentials (absent → `missing`; present →
 * `present-unverified`), advanced by the adapter as the REAL provider
 * calls answer (`verified` on an authenticated success, `invalid` on a
 * 401/403). Every transition is monotone-except-repair: once `invalid`,
 * only a successful verification call may restore `verified`.
 */
export class ProviderCredentialMonitor {
  private state: ProviderCredentialState;
  private detail: string | undefined;
  private devModeHint: string | undefined;
  private checkedAtMs: number | undefined;
  private readonly missingDetail: string;
  private readonly hint: string;

  constructor(options: {
    /** Whether the injected credentials are present (non-empty). */
    credentialsPresent: boolean;
    /** The honest missing-state evidence (env NAMES only, never values). */
    missingDetail: string;
    /** The SandboxFallback hint (present iff credentials are missing). */
    devModeHint: string;
  }) {
    this.state = options.credentialsPresent ? "present-unverified" : "missing";
    this.detail = options.credentialsPresent ? undefined : options.missingDetail;
    this.devModeHint = options.credentialsPresent ? undefined : options.devModeHint;
    this.missingDetail = options.missingDetail;
    this.hint = options.devModeHint;
  }

  /** The honest snapshot (never carries a credential value). */
  credentialStatus(): ProviderCredentialStatus {
    return {
      state: this.state,
      ...(this.detail !== undefined ? { detail: this.detail } : {}),
      ...(this.state === "missing" && this.devModeHint !== undefined
        ? { devModeHint: this.devModeHint }
        : {}),
      ...(this.checkedAtMs !== undefined ? { checkedAtMs: this.checkedAtMs } : {}),
    };
  }

  /** The gate check (see {@link credentialGateRefusal}). */
  gateRefusal(): ProviderRefusal | null {
    return credentialGateRefusal(this.credentialStatus());
  }

  /** Records a successful authenticated provider call. */
  markVerified(detail: string, atMs: number): void {
    this.state = "verified";
    this.detail = detail;
    this.devModeHint = undefined;
    this.checkedAtMs = atMs;
  }

  /** Records a provider credential rejection (401/403). */
  markInvalid(detail: string, atMs: number): void {
    this.state = "invalid";
    this.detail = detail;
    this.checkedAtMs = atMs;
  }

  /** Records that verification could not complete (network/timeout — NOT invalid). */
  markUnverifiable(detail: string, atMs: number): void {
    // An unreachable provider proves nothing about the credentials: keep
    // the honest prior state, record the attempt.
    if (this.state === "missing") {
      this.state = "missing";
      this.detail = `${this.missingDetail} (verification attempted: ${detail})`;
      this.devModeHint = this.hint;
    } else {
      this.detail = `${this.state} (verification attempted: ${detail})`;
    }
    this.checkedAtMs = atMs;
  }
}
