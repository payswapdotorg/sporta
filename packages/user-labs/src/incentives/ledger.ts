/**
 * The per-lab incentive ledger (REL-021): auditable accounting of credits
 * granted/used, private-use window start/expiry, and discovery boosts.
 *
 * THE INVARIANT (tested explicitly in test/incentives.test.ts):
 * DISCOVERY BOOSTS ARE EXPLICIT AND AUDITABLE EVENTS — never silently mixed
 * into quality evidence. A boost appends exactly one ledger entry that
 * references the POLICY VERSION in force when it was recorded and the
 * HUMAN-VISIBLE DISCOVERY text disclosed to the user; the ledger writes
 * nothing but that entry — the candidate store, the exchange publications
 * and every quality-evidence record remain untouched (the test snapshots the
 * published evidence before and after a boost and proves them deep-equal).
 *
 * PROSPECTIVE SEMANTICS (tested explicitly): every entry records the policy
 * version in force AT RECORDING TIME. A later policy version never rewrites
 * an existing entry — the audit trail keeps the terms each reward was
 * actually granted under.
 *
 * OFF-POLICY WRITES REFUSE: an incentive write whose benefit is not
 * configured in the active policy version (or whose amount is not the
 * on-policy amount) is a typed refusal — incentives are policy/configuration,
 * never hidden ranking rules (ADR-013 #12).
 *
 * Tenant isolation applies to the whole ledger: only the owning tenant may
 * read it or write to it (typed isolation refusal otherwise).
 */
import { z } from "zod";
import type { TenantRef } from "../domain";
import { deepFreeze, requireTenantRef } from "../domain";
import { createUserLabsDefaultClock, createSequentialIdSource, toIsoUtc } from "../clock";
import type { IdSource } from "../clock";
import { LabIsolationError, LabValidationError } from "../errors";
import type { IncentivePolicy, IncentivePolicyStore } from "./policy";

// ---------------------------------------------------------------------------
// Ledger entries (append-only, each carrying its policy version)
// ---------------------------------------------------------------------------

export const LEDGER_ENTRY_KINDS = [
  "credits-granted",
  "credits-used",
  "private-window-started",
  "private-window-expired",
  "discovery-boost",
] as const;

export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

interface LedgerEntryBase {
  entryId: string;
  labId: string;
  kind: LedgerEntryKind;
  /** The policy version in force when the entry was recorded (never rewritten). */
  policyVersion: number;
  recordedAt: string;
}

export interface CreditsGrantedEntry extends LedgerEntryBase {
  kind: "credits-granted";
  amount: number;
  balanceAfter: number;
  note?: string;
}

export interface CreditsUsedEntry extends LedgerEntryBase {
  kind: "credits-used";
  amount: number;
  balanceAfter: number;
  purpose?: string;
}

export interface PrivateWindowStartedEntry extends LedgerEntryBase {
  kind: "private-window-started";
  /** The window length granted, from the policy version above. */
  windowDays: number;
  startedAt: string;
  expiresAt: string;
}

export interface PrivateWindowExpiredEntry extends LedgerEntryBase {
  kind: "private-window-expired";
  startedAt: string;
  expiredAt: string;
}

export interface DiscoveryBoostEntry extends LedgerEntryBase {
  kind: "discovery-boost";
  /** The human-visible discovery text the boost was disclosed under. */
  disclosureText: string;
  /** What the boost applies to (a publication of the lab's candidate). */
  subject: { publicationId: string };
  note?: string;
}

export type IncentiveLedgerEntry =
  | CreditsGrantedEntry
  | CreditsUsedEntry
  | PrivateWindowStartedEntry
  | PrivateWindowExpiredEntry
  | DiscoveryBoostEntry;

// ---------------------------------------------------------------------------
// Outcomes (typed refusal records — never thrown)
// ---------------------------------------------------------------------------

export type LedgerRefusalReason =
  | "no-capability-credits-benefit"
  | "off-policy-amount"
  | "insufficient-credits"
  | "no-private-use-benefit"
  | "window-already-active"
  | "no-active-window"
  | "no-discovery-boost-benefit";

export interface LedgerRefused {
  outcome: "refused";
  reason: LedgerRefusalReason;
  message: string;
}

export interface LedgerRecorded {
  outcome: "recorded";
  entry: IncentiveLedgerEntry;
}

export type LedgerEntryOutcome = LedgerRecorded | LedgerRefused;

/** The running credit balance (audited by the ledger entries). */
export interface LedgerBalance {
  creditsGranted: number;
  creditsUsed: number;
  creditsRemaining: number;
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

/** Options for {@link createIncentiveLedger}. */
export interface IncentiveLedgerOptions {
  labId: string;
  owner: TenantRef;
  /** The versioned policy store every write checks against (fail closed). */
  policies: IncentivePolicyStore;
  /** Injected clock (deterministic default — never `Date.now`). */
  clock?: () => number;
  entryIds?: IdSource;
}

const UseCreditsSchema = z.strictObject({
  amount: z.number().finite().positive(),
  purpose: z.string().min(1).optional(),
});
const GrantCreditsSchema = z.strictObject({
  amount: z.number().finite().positive(),
  note: z.string().min(1).optional(),
});
const BoostSchema = z.strictObject({
  publicationId: z.string().min(1),
  note: z.string().min(1).optional(),
});

/** The per-lab incentive ledger port. */
export interface IncentiveLedger {
  /** Grants credits — the on-policy amount only (typed refusal otherwise). */
  grantCredits(
    caller: TenantRef,
    input: { amount: number; note?: string },
  ): Promise<LedgerEntryOutcome>;
  /** Uses credits — typed refusal when the balance is insufficient. */
  useCredits(
    caller: TenantRef,
    input: { amount: number; purpose?: string },
  ): Promise<LedgerEntryOutcome>;
  /** Starts the private-use window under the policy in force (expiry computed). */
  startPrivateUseWindow(caller: TenantRef): Promise<LedgerEntryOutcome>;
  /** Records the private-use window's expiry (an auditable event). */
  expirePrivateUseWindow(caller: TenantRef): Promise<LedgerEntryOutcome>;
  /**
   * Records an EXPLICIT, AUDITABLE discovery boost referencing the policy
   * version + the human-visible disclosure. Writes exactly one entry —
   * nothing else (quality evidence is never touched).
   */
  recordDiscoveryBoost(
    caller: TenantRef,
    input: { publicationId: string; note?: string },
  ): Promise<LedgerEntryOutcome>;
  /** The whole append-only audit trail (owning tenant only). */
  entries(caller: TenantRef): Promise<readonly IncentiveLedgerEntry[]>;
  /** The running credit balance (owning tenant only). */
  balance(caller: TenantRef): Promise<LedgerBalance>;
}

const MS_PER_DAY = 86_400_000;

/** Builds the in-memory per-lab incentive ledger. */
export function createIncentiveLedger(options: IncentiveLedgerOptions): IncentiveLedger {
  const { labId, owner, policies } = options;
  const clock = options.clock ?? createUserLabsDefaultClock();
  const entryIds = options.entryIds ?? createSequentialIdSource("entry");
  const entries: IncentiveLedgerEntry[] = [];
  let creditsBalance = 0;
  let activeWindow: { startedAt: string; expiresAt: string } | null = null;

  function own(caller: TenantRef): void {
    requireTenantRef(caller);
    if (caller.tenantId !== owner.tenantId) {
      throw new LabIsolationError(
        `tenant '${caller.tenantId}' may not access the incentive ledger of lab '${labId}' ` +
          `owned by tenant '${owner.tenantId}' — tenant isolation is a hard boundary`,
        {
          attemptingTenantId: caller.tenantId,
          owningTenantId: owner.tenantId,
          resourceType: "incentive-ledger",
          resourceId: labId,
        },
      );
    }
  }

  async function activePolicy(): Promise<IncentivePolicy> {
    // Fail closed: no policy in force -> typed not-found, no incentive writes.
    return policies.activePolicyAt(toIsoUtc(clock()));
  }

  function zodIssues(error: z.ZodError): unknown[] {
    return error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
  }

  function append(entry: IncentiveLedgerEntry): IncentiveLedgerEntry {
    const frozen = deepFreeze(entry);
    entries.push(frozen);
    return frozen;
  }

  return {
    async grantCredits(caller, input) {
      own(caller);
      const parsed = GrantCreditsSchema.safeParse(input);
      if (!parsed.success) {
        throw new LabValidationError("credit grant is invalid", zodIssues(parsed.error));
      }
      const policy = await activePolicy();
      const benefit = policy.benefits.capabilityCredits;
      if (benefit === null) {
        return {
          outcome: "refused",
          reason: "no-capability-credits-benefit",
          message:
            `credit grant refused: policy '${policy.policyId}':v${policy.version} configures no ` +
            `capability-credits benefit — incentives are policy-governed, never improvised`,
        } satisfies LedgerRefused;
      }
      if (parsed.data.amount !== benefit.creditsPerGrant) {
        return {
          outcome: "refused",
          reason: "off-policy-amount",
          message:
            `credit grant refused: requested ${parsed.data.amount} credits but policy ` +
            `'${policy.policyId}':v${policy.version} grants exactly ${benefit.creditsPerGrant} ` +
            `per grant — off-policy amounts are hidden rewards`,
        } satisfies LedgerRefused;
      }
      creditsBalance += parsed.data.amount;
      const entry = append({
        entryId: entryIds.nextId(),
        labId,
        kind: "credits-granted",
        policyVersion: policy.version,
        recordedAt: toIsoUtc(clock()),
        amount: parsed.data.amount,
        balanceAfter: creditsBalance,
        ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
      } satisfies CreditsGrantedEntry);
      return { outcome: "recorded", entry } satisfies LedgerRecorded;
    },

    async useCredits(caller, input) {
      own(caller);
      const parsed = UseCreditsSchema.safeParse(input);
      if (!parsed.success) {
        throw new LabValidationError("credit use is invalid", zodIssues(parsed.error));
      }
      const policy = await activePolicy();
      if (parsed.data.amount > creditsBalance) {
        return {
          outcome: "refused",
          reason: "insufficient-credits",
          message:
            `credit use refused: requested ${parsed.data.amount} credits against a balance of ` +
            `${creditsBalance} — the ledger never goes negative`,
        } satisfies LedgerRefused;
      }
      creditsBalance -= parsed.data.amount;
      const entry = append({
        entryId: entryIds.nextId(),
        labId,
        kind: "credits-used",
        policyVersion: policy.version,
        recordedAt: toIsoUtc(clock()),
        amount: parsed.data.amount,
        balanceAfter: creditsBalance,
        ...(parsed.data.purpose !== undefined ? { purpose: parsed.data.purpose } : {}),
      } satisfies CreditsUsedEntry);
      return { outcome: "recorded", entry } satisfies LedgerRecorded;
    },

    async startPrivateUseWindow(caller) {
      own(caller);
      const policy = await activePolicy();
      const windowDays = policy.benefits.privateUseWindowDays;
      if (windowDays === null) {
        return {
          outcome: "refused",
          reason: "no-private-use-benefit",
          message:
            `private-use window refused: policy '${policy.policyId}':v${policy.version} configures ` +
            `no private-use window benefit`,
        } satisfies LedgerRefused;
      }
      if (activeWindow !== null) {
        return {
          outcome: "refused",
          reason: "window-already-active",
          message:
            `private-use window refused: a window is already active (started ` +
            `${activeWindow.startedAt}, expires ${activeWindow.expiresAt})`,
        } satisfies LedgerRefused;
      }
      const startedAtMs = clock();
      const startedAt = toIsoUtc(startedAtMs);
      const expiresAt = toIsoUtc(startedAtMs + windowDays * MS_PER_DAY);
      activeWindow = { startedAt, expiresAt };
      const entry = append({
        entryId: entryIds.nextId(),
        labId,
        kind: "private-window-started",
        policyVersion: policy.version,
        recordedAt: startedAt,
        windowDays,
        startedAt,
        expiresAt,
      } satisfies PrivateWindowStartedEntry);
      return { outcome: "recorded", entry } satisfies LedgerRecorded;
    },

    async expirePrivateUseWindow(caller) {
      own(caller);
      if (activeWindow === null) {
        return {
          outcome: "refused",
          reason: "no-active-window",
          message: "private-use window expiry refused: no window is active",
        } satisfies LedgerRefused;
      }
      const policy = await activePolicy();
      const expiredAt = toIsoUtc(clock());
      const startedAt = activeWindow.startedAt;
      activeWindow = null;
      const entry = append({
        entryId: entryIds.nextId(),
        labId,
        kind: "private-window-expired",
        policyVersion: policy.version,
        recordedAt: expiredAt,
        startedAt,
        expiredAt,
      } satisfies PrivateWindowExpiredEntry);
      return { outcome: "recorded", entry } satisfies LedgerRecorded;
    },

    async recordDiscoveryBoost(caller, input) {
      own(caller);
      const parsed = BoostSchema.safeParse(input);
      if (!parsed.success) {
        throw new LabValidationError("discovery boost is invalid", zodIssues(parsed.error));
      }
      const policy = await activePolicy();
      const benefit = policy.benefits.discoveryBoost;
      if (benefit === null) {
        return {
          outcome: "refused",
          reason: "no-discovery-boost-benefit",
          message:
            `discovery boost refused: policy '${policy.policyId}':v${policy.version} configures no ` +
            `discovery-boost benefit — an undisclosed boost is not expressible in this system`,
        } satisfies LedgerRefused;
      }
      // THE INVARIANT: exactly one explicit, auditable entry — policy version
      // + the human-visible disclosure it was granted under. Nothing else
      // anywhere is written by this operation.
      const entry = append({
        entryId: entryIds.nextId(),
        labId,
        kind: "discovery-boost",
        policyVersion: policy.version,
        recordedAt: toIsoUtc(clock()),
        disclosureText: benefit.description,
        subject: { publicationId: parsed.data.publicationId },
        ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
      } satisfies DiscoveryBoostEntry);
      return { outcome: "recorded", entry } satisfies LedgerRecorded;
    },

    async entries(caller) {
      own(caller);
      return [...entries];
    },

    async balance(caller) {
      own(caller);
      let creditsGranted = 0;
      let creditsUsed = 0;
      for (const entry of entries) {
        if (entry.kind === "credits-granted") creditsGranted += entry.amount;
        if (entry.kind === "credits-used") creditsUsed += entry.amount;
      }
      return {
        creditsGranted,
        creditsUsed,
        creditsRemaining: creditsBalance,
      } satisfies LedgerBalance;
    },
  };
}
