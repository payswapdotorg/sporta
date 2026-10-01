/**
 * The canary observation feed + the automatic-rollback monitor (REL-033).
 *
 * THE LAW (REL-A4, docs/testing/reality-engineering-lab-acceptance.md):
 * "Rollback must be automatic for configured hard SLO/policy failures."
 * The delivered promotion machinery (src/promotion.ts) owns `requestRollback`
 * — the typed, audited, policy-governed entry point — but nothing wired
 * CANARY OBSERVATIONS to it. This module is that wire, added additively:
 *
 * - `createCanaryFeed`: an in-memory, per-organization append-only feed of
 *   canary observations (an SLO/policy check verdict at an instant, stamped
 *   by the injected clock — never wall time);
 * - `evaluateCanaryObservations`: the PURE verdict over (observations,
 *   configured hard checks) — only failures of CONFIGURED hard checks can
 *   breach (an unconfigured failure is visible in the healthy verdict but
 *   never trips the wire: rollback is automatic only for CONFIGURED hard
 *   SLO/policy failures, the law's own word);
 * - `createCanaryMonitor`: ingests observations, evaluates the feed and, on
 *   a breach verdict, calls the DELIVERED `requestRollback` — never a
 *   bypass, never a direct store write. Every outcome is a typed assessment
 *   record; the rollback reason (the failed check ids and their details) is
 *   carried into the audited transition log through `requestRollback`'s own
 *   note seam.
 *
 * TRIGGER SEMANTICS: a failed configured hard SLO check maps to the closed
 * `hard-slo-failure` trigger; a failed configured hard policy check maps to
 * `policy-violation`. Both must be configured in the governing policy's
 * `rollback.allowedTriggers` — `requestRollback` refuses typed otherwise
 * (`trigger-not-configured`), surfaced here as a `rollback-refused`
 * assessment. The monitor never relaxes that.
 *
 * FIRE-ONCE SEMANTICS: one automatic rollback per organization per monitor
 * instance. After a granted rollback the assessment for further breach
 * verdicts is the typed `breach-already-handled` (the wire tripped; the
 * audit trail is the operator's next move — re-arming is a new monitor, an
 * explicit auditable decision). Refused rollbacks do NOT mark the wire
 * tripped: the breach is still live, so later ingests re-attempt, each
 * typed and recorded.
 */
import { createRegistryDefaultClock, toIsoUtc } from "./clock";
import type { OrganizationRegistry } from "./registry";
import { requestRollback } from "./promotion";
import type {
  PromotionPolicy,
  RollbackGranted,
  RollbackOutcome,
  RollbackRefused,
} from "./promotion";

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

/** Which kind of hard check an observation reports on. */
export type CanaryCheckKind = "slo" | "policy";

/** One canary observation: a hard-check verdict at an instant. */
export interface CanaryObservation {
  /** ISO-8601 UTC, stamped by the injected clock. */
  observedAt: string;
  /** The check's id (must be configured to be able to breach). */
  checkId: string;
  checkKind: CanaryCheckKind;
  passed: boolean;
  /** What was measured, in words (recorded into the rollback reason). */
  detail?: string;
}

/** The observation shape callers hand to the feed (the clock stamps time). */
export type CanaryObservationInput = Omit<CanaryObservation, "observedAt">;

/** The append-only, per-organization canary observation feed. */
export interface CanaryFeed {
  /** Appends one clock-stamped observation. */
  record(organizationId: string, observation: CanaryObservationInput): Promise<CanaryObservation>;
  /** Every observation for one organization, in feed order. */
  observationsFor(organizationId: string): Promise<readonly CanaryObservation[]>;
}

/** Options for {@link createCanaryFeed}. */
export interface CanaryFeedOptions {
  /** Injected clock (deterministic default — never `Date.now`). */
  clock?: () => number;
}

/** Builds the in-memory canary observation feed. */
export function createCanaryFeed(options: CanaryFeedOptions = {}): CanaryFeed {
  const clock = options.clock ?? createRegistryDefaultClock();
  /** organizationId -> observations, in feed (append) order. */
  const feed = new Map<string, CanaryObservation[]>();
  return {
    async record(organizationId, observation) {
      const stamped: CanaryObservation = Object.freeze({
        ...observation,
        observedAt: toIsoUtc(clock()),
      });
      const entries = feed.get(organizationId);
      if (entries === undefined) {
        feed.set(organizationId, [stamped]);
      } else {
        entries.push(stamped);
      }
      return stamped;
    },
    async observationsFor(organizationId) {
      return [...(feed.get(organizationId) ?? [])];
    },
  };
}

// ---------------------------------------------------------------------------
// The pure verdict
// ---------------------------------------------------------------------------

/** The configured hard checks that can trip the automatic rollback wire. */
export interface HardCanaryChecks {
  /** Hard SLO check ids — a failure maps to `hard-slo-failure`. */
  hardSloChecks: readonly string[];
  /** Hard policy check ids — a failure maps to `policy-violation`. */
  hardPolicyChecks: readonly string[];
}

/** One failed configured hard check, as the breach verdict names it. */
export interface FailedHardCheck {
  checkId: string;
  checkKind: CanaryCheckKind;
  observedAt: string;
  detail?: string;
}

/** The feed is healthy: no configured hard check has failed. */
export interface CanaryHealthyVerdict {
  verdict: "healthy";
  observationsEvaluated: number;
  /** Failed checks that are NOT configured triggers — visible, non-tripping. */
  unconfiguredFailedChecks: string[];
}

/** A configured hard check failed — the automatic rollback wire is live. */
export interface CanaryBreachVerdict {
  verdict: "breach";
  /** `hard-slo-failure` (latest failed SLO check) or `policy-violation`. */
  trigger: "hard-slo-failure" | "policy-violation";
  /** Every failed configured hard check, in feed order. */
  failedConfiguredChecks: readonly FailedHardCheck[];
}

/** The union verdict of {@link evaluateCanaryObservations}. */
export type CanaryVerdict = CanaryHealthyVerdict | CanaryBreachVerdict;

/**
 * The PURE verdict over a feed slice: breach iff at least one CONFIGURED hard
 * check has failed. Deterministic: the trigger comes from the LATEST failed
 * configured check in feed order; the failed list preserves feed order.
 */
export function evaluateCanaryObservations(
  observations: readonly CanaryObservation[],
  checks: HardCanaryChecks,
): CanaryVerdict {
  const hardSlo = new Set(checks.hardSloChecks);
  const hardPolicy = new Set(checks.hardPolicyChecks);
  const failedConfigured: FailedHardCheck[] = [];
  const unconfiguredFailed: string[] = [];
  for (const observation of observations) {
    if (observation.passed) continue;
    const configured =
      (observation.checkKind === "slo" && hardSlo.has(observation.checkId)) ||
      (observation.checkKind === "policy" && hardPolicy.has(observation.checkId));
    if (configured) {
      failedConfigured.push({
        checkId: observation.checkId,
        checkKind: observation.checkKind,
        observedAt: observation.observedAt,
        ...(observation.detail !== undefined ? { detail: observation.detail } : {}),
      });
    } else {
      unconfiguredFailed.push(observation.checkId);
    }
  }
  if (failedConfigured.length === 0) {
    return {
      verdict: "healthy",
      observationsEvaluated: observations.length,
      unconfiguredFailedChecks: unconfiguredFailed,
    };
  }
  const latest = failedConfigured[failedConfigured.length - 1] as FailedHardCheck;
  return {
    verdict: "breach",
    trigger: latest.checkKind === "slo" ? "hard-slo-failure" : "policy-violation",
    failedConfiguredChecks: failedConfigured,
  };
}

// ---------------------------------------------------------------------------
// The automatic-rollback monitor
// ---------------------------------------------------------------------------

/** Options for {@link createCanaryMonitor}. */
export interface CanaryMonitorOptions {
  /** The registry whose organizations are monitored. */
  registry: OrganizationRegistry;
  /** The versioned policy whose rollback configuration governs. */
  policy: PromotionPolicy;
  /** The configured hard checks that can trip the wire (REL-A4's "configured"). */
  checks: HardCanaryChecks;
  /** The feed to observe (a fresh one is created when omitted). */
  feed?: CanaryFeed;
}

/** An automatic rollback this monitor fired (the audit of the wire). */
export interface FiredRollback {
  organizationId: string;
  trigger: "hard-slo-failure" | "policy-violation";
  firedAt: string;
}

/** The typed assessment of one ingest. */
export type CanaryAssessment =
  | { assessment: "healthy"; verdict: CanaryHealthyVerdict }
  | {
      assessment: "rolled-back";
      verdict: CanaryBreachVerdict;
      rollback: RollbackGranted;
    }
  | {
      assessment: "rollback-refused";
      verdict: CanaryBreachVerdict;
      rollback: RollbackRefused;
    }
  | { assessment: "breach-already-handled"; verdict: CanaryBreachVerdict };

/** The canary monitor: the automatic wire between the feed and rollback. */
export interface CanaryMonitor {
  /** Records one observation and assesses; fires rollback on a live breach. */
  ingest(organizationId: string, observation: CanaryObservationInput): Promise<CanaryAssessment>;
  /** The underlying feed (audit reads). */
  feed(): CanaryFeed;
  /** Every automatic rollback this monitor has fired. */
  firedRollbacks(): readonly FiredRollback[];
}

/** The rollback note naming every failed configured check — the recorded reason. */
function rollbackNote(verdict: CanaryBreachVerdict): string {
  const described = verdict.failedConfiguredChecks
    .map(
      (check) =>
        `${check.checkId} (${check.checkKind} check, observed ${check.observedAt}${
          check.detail !== undefined ? `: ${check.detail}` : ""
        })`,
    )
    .join("; ");
  return `automatic canary rollback: ${verdict.failedConfiguredChecks.length} configured hard check(s) failed — ${described}`;
}

/**
 * Builds the canary monitor. The monitor holds no independent state machine:
 * every rollback goes through the delivered `requestRollback`, so the state
 * machine, the trigger vocabulary, the policy configuration check and the
 * audited, hash-chained transition log are all the DELIVERED semantics —
 * this module only decides WHEN to call them.
 */
export function createCanaryMonitor(options: CanaryMonitorOptions): CanaryMonitor {
  const { registry, policy, checks } = options;
  const feed = options.feed ?? createCanaryFeed();
  const fired: FiredRollback[] = [];

  return {
    async ingest(organizationId, observation) {
      await feed.record(organizationId, observation);
      const observations = await feed.observationsFor(organizationId);
      const verdict = evaluateCanaryObservations(observations, checks);
      if (verdict.verdict === "healthy") {
        return { assessment: "healthy", verdict };
      }
      if (fired.some((f) => f.organizationId === organizationId)) {
        return { assessment: "breach-already-handled", verdict };
      }
      const outcome: RollbackOutcome = await requestRollback(registry, {
        organizationId,
        trigger: verdict.trigger,
        policy,
        note: rollbackNote(verdict),
      });
      if (outcome.outcome === "granted") {
        fired.push({
          organizationId,
          trigger: verdict.trigger,
          firedAt: outcome.occurredAt,
        });
        return { assessment: "rolled-back", verdict, rollback: outcome };
      }
      return { assessment: "rollback-refused", verdict, rollback: outcome };
    },

    feed() {
      return feed;
    },

    firedRollbacks() {
      return [...fired];
    },
  };
}
