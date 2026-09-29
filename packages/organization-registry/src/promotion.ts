/**
 * Automated organization promotion and rollback (REL-018).
 *
 * The frozen promotion pipeline
 * (docs/contracts/organization-registry-and-promotion.md §Promotion):
 *
 *   Lab candidate -> reproducibility -> benchmark -> robustness
 *     -> rights/provenance -> cost/latency -> security/policy
 *     -> canary -> production
 *
 * mapped onto the lifecycle
 * (docs/contracts/agent-body-and-organization.md §Organization status):
 *
 *   draft -> benchmarked -> validated -> canary -> production -> retired
 *
 * One `requestPromotion` call advances EXACTLY ONE legal forward step — the
 * target is derived from the state machine, so an illegal jump (draft ->
 * validated) is structurally inexpressible, and the two statuses with no
 * forward step (production, retired) refuse with a typed
 * `no-forward-step` record. Gate requirements are cumulative per target.
 *
 * THE HARD RULE (tested explicitly): `evidence.simulatorReward` is never an
 * input to any gate (src/gates.ts reads only the six measured evidence
 * objects + canary evidence). A record carrying ONLY a simulator-reward
 * score is refused with `missing` gate results that say, in words, that the
 * reward does not count as benchmark/robustness/rights evidence.
 *
 * Refusals are TYPED RECORDS (never thrown — a refusal is evidence), and
 * every attempt, granted or refused, is appended to the registry's
 * hash-chained audit log. Policies are versioned and validated fail-closed:
 * an incomplete policy throws before any gate runs (no silent defaults, no
 * NaN comparisons).
 *
 * Rollback is AUTOMATIC: `requestRollback` is the entry point the canary /
 * production monitors call on a recorded trigger; only canary/production
 * can roll back, production may demote to canary only for the policy's
 * demotion triggers, and every rollback carries its trigger into the audit
 * log. `retired` is terminal — there is no edge back out.
 */
import type {
  ActorRef,
  AdditionalEvidence,
  OrganizationRecord,
  OrganizationStatus,
  RollbackTrigger,
} from "./domain";
import { isRollbackTrigger, systemActor } from "./domain";
import { RegistryValidationError } from "./errors";
import type { GateId, GatePolicy, GateResult } from "./gates";
import { allGatesPassed, evaluateGates } from "./gates";
import type { OrganizationRegistry, TransitionLogEntry } from "./registry";
import { forwardTargetFrom } from "./state-machine";

// ---------------------------------------------------------------------------
// The versioned promotion policy
// ---------------------------------------------------------------------------

/** The versioned eligibility policy every automated decision records. */
export interface PromotionPolicy {
  policyId: string;
  version: number;
  /** The gate thresholds (validated fail-closed before use). */
  gates: GatePolicy;
  rollback: {
    /** Triggers this policy recognizes for automatic rollback. */
    allowedTriggers: readonly RollbackTrigger[];
    /** Triggers that demote production -> canary instead of retiring. */
    demoteTriggers: readonly RollbackTrigger[];
  };
}

/** Policy reference recorded with every outcome (granted or refused). */
export interface PolicyRef {
  policyId: string;
  version: number;
}

/**
 * Fail-closed policy validation: every field the gates read must be present
 * and within its domain. Returns the (possibly empty) list of problems.
 */
export function validatePromotionPolicy(policy: PromotionPolicy): string[] {
  const problems: string[] = [];
  if (typeof policy.policyId !== "string" || policy.policyId.length === 0) {
    problems.push("policyId must be a non-empty string");
  }
  if (!Number.isInteger(policy.version) || policy.version < 1) {
    problems.push("version must be an integer >= 1");
  }
  const gates = policy.gates as Partial<GatePolicy> | undefined;
  if (gates === undefined || gates === null) {
    problems.push("gates is required");
    return problems;
  }
  const repro = gates.reproducibility;
  if (
    repro === undefined ||
    !Number.isInteger(repro.minReproductionRuns) ||
    repro.minReproductionRuns < 1
  ) {
    problems.push("gates.reproducibility.minReproductionRuns must be an integer >= 1");
  }
  const bench = gates.benchmark;
  if (
    bench === undefined ||
    typeof bench.minimumScores !== "object" ||
    bench.minimumScores === null ||
    Object.keys(bench.minimumScores).length === 0
  ) {
    problems.push("gates.benchmark.minimumScores must be a non-empty axis -> bar map");
  } else if (bench !== undefined && bench.minimumScores !== undefined) {
    for (const [axis, bar] of Object.entries(bench.minimumScores)) {
      if (typeof bar !== "number" || !Number.isFinite(bar) || bar < 0 || bar > 10) {
        problems.push(`gates.benchmark.minimumScores.${axis} must be a number in [0, 10]`);
      }
    }
  }
  const robust = gates.robustness;
  if (robust === undefined) {
    problems.push("gates.robustness is required");
  } else {
    if (!Number.isInteger(robust.minSeedsTested) || robust.minSeedsTested < 1) {
      problems.push("gates.robustness.minSeedsTested must be an integer >= 1");
    }
    if (
      !Number.isFinite(robust.minOutOfDistributionScore) ||
      robust.minOutOfDistributionScore < 0 ||
      robust.minOutOfDistributionScore > 10
    ) {
      problems.push("gates.robustness.minOutOfDistributionScore must be in [0, 10]");
    }
    if (
      !Number.isFinite(robust.minSimulatorModelAgreement) ||
      robust.minSimulatorModelAgreement < 0 ||
      robust.minSimulatorModelAgreement > 1
    ) {
      problems.push("gates.robustness.minSimulatorModelAgreement must be in [0, 1]");
    }
    if (
      !Number.isFinite(robust.minBenchmarkCorpusCoverage) ||
      robust.minBenchmarkCorpusCoverage < 0 ||
      robust.minBenchmarkCorpusCoverage > 1
    ) {
      problems.push("gates.robustness.minBenchmarkCorpusCoverage must be in [0, 1]");
    }
  }
  const cost = gates["cost-latency"];
  if (cost === undefined) {
    problems.push('gates["cost-latency"] is required');
  } else {
    if (!Number.isFinite(cost.maxP95LatencyMs) || cost.maxP95LatencyMs <= 0) {
      problems.push('gates["cost-latency"].maxP95LatencyMs must be > 0');
    }
    if (!Number.isFinite(cost.maxPerRunUsd) || cost.maxPerRunUsd < 0) {
      problems.push('gates["cost-latency"].maxPerRunUsd must be >= 0');
    }
    if (!Number.isInteger(cost.minSampleCount) || cost.minSampleCount < 1) {
      problems.push('gates["cost-latency"].minSampleCount must be an integer >= 1');
    }
  }
  const security = gates["security-policy"];
  if (
    security === undefined ||
    !Array.isArray(security.requiredChecks) ||
    security.requiredChecks.length === 0 ||
    security.requiredChecks.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    problems.push('gates["security-policy"].requiredChecks must be a non-empty list of check ids');
  }
  const canary = gates.canary;
  if (
    canary === undefined ||
    !Number.isInteger(canary.minCanaryObservations) ||
    canary.minCanaryObservations < 1
  ) {
    problems.push("gates.canary.minCanaryObservations must be an integer >= 1");
  }
  const rollback = policy.rollback;
  if (
    rollback === undefined ||
    !Array.isArray(rollback.allowedTriggers) ||
    rollback.allowedTriggers.length === 0 ||
    rollback.allowedTriggers.some((t) => !isRollbackTrigger(t))
  ) {
    problems.push("rollback.allowedTriggers must be a non-empty list of valid rollback triggers");
  } else if (rollback !== undefined && Array.isArray(rollback.allowedTriggers)) {
    if (
      !Array.isArray(rollback.demoteTriggers) ||
      rollback.demoteTriggers.some(
        (t) => !isRollbackTrigger(t) || !rollback.allowedTriggers.includes(t),
      )
    ) {
      problems.push("rollback.demoteTriggers must be a subset of allowedTriggers");
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The gate requirements per promotion target (cumulative, fail-visible)
// ---------------------------------------------------------------------------

/**
 * The gates required to ENTER each forward status. Cumulative by design: to
 * stand in `validated` an organization must hold the full non-canary
 * eligibility; `canary` re-proves it on the current version; `production`
 * adds the canary pass (REL-A4's full list).
 */
export const PROMOTION_GATES_BY_TARGET: Readonly<
  Record<"benchmarked" | "validated" | "canary" | "production", readonly GateId[]>
> = {
  benchmarked: ["reproducibility", "benchmark"],
  validated: [
    "reproducibility",
    "benchmark",
    "robustness",
    "rights-provenance",
    "cost-latency",
    "security-policy",
  ],
  canary: [
    "reproducibility",
    "benchmark",
    "robustness",
    "rights-provenance",
    "cost-latency",
    "security-policy",
  ],
  production: [
    "reproducibility",
    "benchmark",
    "robustness",
    "rights-provenance",
    "cost-latency",
    "security-policy",
    "canary",
  ],
};

// ---------------------------------------------------------------------------
// Promotion outcomes (typed refusal records, never thrown)
// ---------------------------------------------------------------------------

/** Why a promotion was refused. */
export type PromotionRefusalReason = "no-forward-step" | "gate-failure" | "incomplete-lineage";

/** A granted promotion: the new record + the audited transition. */
export interface PromotionGranted {
  outcome: "granted";
  organizationId: string;
  fromVersion: number;
  fromStatus: OrganizationStatus;
  toVersion: number;
  toStatus: OrganizationStatus;
  policy: PolicyRef;
  gateResults: readonly GateResult[];
  record: OrganizationRecord;
  transition: TransitionLogEntry;
  occurredAt: string;
}

/** A refused promotion — typed evidence of what was missing or failed. */
export interface PromotionRefused {
  outcome: "refused";
  organizationId: string;
  /** The record version the gates evaluated (evidence may have just been added). */
  evaluatedVersion: number;
  fromStatus: OrganizationStatus;
  /** The forward target attempted (null when no forward step exists at all). */
  attemptedTarget: OrganizationStatus | null;
  policy: PolicyRef;
  reason: PromotionRefusalReason;
  /** The auditable refusal message (names the law and the numbers). */
  message: string;
  gateResults: readonly GateResult[];
  refusedAt: string;
}

/** The union a caller discriminates on. */
export type PromotionOutcome = PromotionGranted | PromotionRefused;

/** Parameters for {@link requestPromotion}. */
export interface PromotionRequest {
  organizationId: string;
  policy: PromotionPolicy;
  /** Defaults to the automated policy-engine actor (the promotion IS automated). */
  actor?: ActorRef;
  /** Evidence added (as its own audited version) before gates evaluate. */
  additionalEvidence?: AdditionalEvidence;
}

/**
 * Requests one automated promotion step. Throws ONLY typed registry errors
 * for storage-boundary failures (unknown organization, malformed policy) —
 * every eligibility decision is a returned record.
 */
export async function requestPromotion(
  registry: OrganizationRegistry,
  request: PromotionRequest,
): Promise<PromotionOutcome> {
  const problems = validatePromotionPolicy(request.policy);
  if (problems.length > 0) {
    throw new RegistryValidationError("promotion policy is malformed", problems);
  }
  const actor: ActorRef =
    request.actor ?? systemActor(request.policy.policyId, request.policy.version);
  const policyRef: PolicyRef = {
    policyId: request.policy.policyId,
    version: request.policy.version,
  };
  const organizationId = request.organizationId;
  await registry.get(organizationId); // typed not-found when unknown
  if (request.additionalEvidence !== undefined) {
    await registry.recordEvidence(
      organizationId,
      request.additionalEvidence,
      actor,
      "evidence submitted with promotion request",
    );
  }
  const current = await registry.get(organizationId);
  const target = forwardTargetFrom(current.status);

  if (target === null) {
    const message =
      current.status === "retired"
        ? `promotion refused: 'retired' is terminal — retirement preserves lineage, it never resurrects (organization '${organizationId}')`
        : `promotion refused: there is no forward step from '${current.status}' — rollback is the only exit (organization '${organizationId}')`;
    const entry = await registry.appendLifecycleRefusal(organizationId, {
      operation: "promotion",
      actor,
      gateResults: [],
      detail: message,
      refusalReason: "no-forward-step",
    });
    return {
      outcome: "refused",
      organizationId,
      evaluatedVersion: current.version,
      fromStatus: current.status,
      attemptedTarget: null,
      policy: policyRef,
      reason: "no-forward-step",
      message,
      gateResults: [],
      refusedAt: entry.recordedAt,
    };
  }

  const gateIds = PROMOTION_GATES_BY_TARGET[target];
  const gateResults = evaluateGates(gateIds, current, request.policy.gates);
  if (!allGatesPassed(gateResults)) {
    const notPassed = gateResults.filter((result) => result.status !== "pass");
    const message =
      `promotion refused (${current.status} -> ${target}) under policy ` +
      `${policyRef.policyId}:v${policyRef.version}: ${notPassed.length} of ${gateResults.length} ` +
      `gate(s) not passed — ${notPassed.map((r) => `${r.gate}=${r.status}`).join(", ")}`;
    const entry = await registry.appendLifecycleRefusal(organizationId, {
      operation: "promotion",
      actor,
      gateResults,
      detail: message,
      refusalReason: "gate-failure",
    });
    return {
      outcome: "refused",
      organizationId,
      evaluatedVersion: current.version,
      fromStatus: current.status,
      attemptedTarget: target,
      policy: policyRef,
      reason: "gate-failure",
      message,
      gateResults,
      refusedAt: entry.recordedAt,
    };
  }

  if (
    (target === "validated" || target === "canary" || target === "production") &&
    current.provenance.lineage.length === 0
  ) {
    const message =
      `promotion refused (${current.status} -> ${target}): the provenance lineage is empty — ` +
      `complete lineage is required before '${target}' (REL-A4)`;
    const entry = await registry.appendLifecycleRefusal(organizationId, {
      operation: "promotion",
      actor,
      gateResults,
      detail: message,
      refusalReason: "incomplete-lineage",
    });
    return {
      outcome: "refused",
      organizationId,
      evaluatedVersion: current.version,
      fromStatus: current.status,
      attemptedTarget: target,
      policy: policyRef,
      reason: "incomplete-lineage",
      message,
      gateResults,
      refusedAt: entry.recordedAt,
    };
  }

  const detail =
    `automated promotion ${current.status} -> ${target} under policy ` +
    `${policyRef.policyId}:v${policyRef.version}: ${gateResults.length}/${gateResults.length} gates passed`;
  const { record, entry } = await registry.applyLifecycleTransition(organizationId, {
    toStatus: target,
    operation: "promotion",
    actor,
    gateResults,
    detail,
  });
  return {
    outcome: "granted",
    organizationId,
    fromVersion: current.version,
    fromStatus: current.status,
    toVersion: record.version,
    toStatus: record.status,
    policy: policyRef,
    gateResults,
    record,
    transition: entry,
    occurredAt: record.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Rollback outcomes
// ---------------------------------------------------------------------------

/** Why a rollback was refused. */
export type RollbackRefusalReason =
  "unknown-trigger" | "trigger-not-configured" | "not-rollback-eligible";

/** A granted rollback: versioned, audited, trigger recorded. */
export interface RollbackGranted {
  outcome: "granted";
  organizationId: string;
  fromVersion: number;
  fromStatus: OrganizationStatus;
  toVersion: number;
  toStatus: OrganizationStatus;
  policy: PolicyRef;
  trigger: RollbackTrigger;
  record: OrganizationRecord;
  transition: TransitionLogEntry;
  occurredAt: string;
}

/** A refused rollback — typed evidence of why no rollback fired. */
export interface RollbackRefused {
  outcome: "refused";
  organizationId: string;
  fromStatus: OrganizationStatus;
  /** The trigger as the caller supplied it (may be outside the vocabulary). */
  attemptedTrigger: string;
  policy: PolicyRef;
  reason: RollbackRefusalReason;
  message: string;
  gateResults: readonly GateResult[];
  refusedAt: string;
}

/** The union a caller discriminates on. */
export type RollbackOutcome = RollbackGranted | RollbackRefused;

/** Parameters for {@link requestRollback}. */
export interface RollbackRequest {
  organizationId: string;
  /** The observed failure trigger. Validated against the closed vocabulary. */
  trigger: string;
  policy: PromotionPolicy;
  /** Defaults to the automated policy-engine actor (rollback IS automatic). */
  actor?: ActorRef;
  /** Optional operator context recorded into the audit detail. */
  note?: string;
}

/**
 * Requests an automatic rollback: canary/production -> retired, or
 * production -> canary for the policy's demotion triggers. The trigger is
 * RECORDED into the audited, versioned transition — never a silent demotion.
 */
export async function requestRollback(
  registry: OrganizationRegistry,
  request: RollbackRequest,
): Promise<RollbackOutcome> {
  const problems = validatePromotionPolicy(request.policy);
  if (problems.length > 0) {
    throw new RegistryValidationError("promotion policy is malformed", problems);
  }
  const actor: ActorRef =
    request.actor ?? systemActor(request.policy.policyId, request.policy.version);
  const policyRef: PolicyRef = {
    policyId: request.policy.policyId,
    version: request.policy.version,
  };
  const organizationId = request.organizationId;
  const current = await registry.get(organizationId);

  if (!isRollbackTrigger(request.trigger)) {
    const message =
      `rollback refused: '${request.trigger}' is not a rollback trigger — the closed vocabulary is ` +
      `'hard-slo-failure', 'policy-violation', 'rights-failure', 'cost-blowout'`;
    const entry = await registry.appendLifecycleRefusal(organizationId, {
      operation: "rollback",
      actor,
      gateResults: [],
      detail: message,
      refusalReason: "unknown-trigger",
    });
    return {
      outcome: "refused",
      organizationId,
      fromStatus: current.status,
      attemptedTrigger: request.trigger,
      policy: policyRef,
      reason: "unknown-trigger",
      message,
      gateResults: [],
      refusedAt: entry.recordedAt,
    };
  }
  const trigger = request.trigger;

  if (!request.policy.rollback.allowedTriggers.includes(trigger)) {
    const message =
      `rollback refused: trigger '${trigger}' is not configured in policy ` +
      `${policyRef.policyId}:v${policyRef.version} — rollback is automatic only for configured hard SLO/policy failures (REL-A4)`;
    const entry = await registry.appendLifecycleRefusal(organizationId, {
      operation: "rollback",
      actor,
      gateResults: [],
      detail: message,
      refusalReason: "trigger-not-configured",
    });
    return {
      outcome: "refused",
      organizationId,
      fromStatus: current.status,
      attemptedTrigger: trigger,
      policy: policyRef,
      reason: "trigger-not-configured",
      message,
      gateResults: [],
      refusedAt: entry.recordedAt,
    };
  }

  if (current.status !== "canary" && current.status !== "production") {
    const message =
      current.status === "retired"
        ? `rollback refused: 'retired' is terminal — there is nothing left to roll back (organization '${organizationId}')`
        : `rollback refused: only canary/production organizations can roll back — current status is '${current.status}'`;
    const entry = await registry.appendLifecycleRefusal(organizationId, {
      operation: "rollback",
      actor,
      gateResults: [],
      detail: message,
      refusalReason: "not-rollback-eligible",
    });
    return {
      outcome: "refused",
      organizationId,
      fromStatus: current.status,
      attemptedTrigger: trigger,
      policy: policyRef,
      reason: "not-rollback-eligible",
      message,
      gateResults: [],
      refusedAt: entry.recordedAt,
    };
  }

  const demote =
    current.status === "production" && request.policy.rollback.demoteTriggers.includes(trigger);
  const target: OrganizationStatus = demote ? "canary" : "retired";
  const detail =
    `automatic rollback on recorded trigger '${trigger}': ${current.status} -> ${target} ` +
    `(policy ${policyRef.policyId}:v${policyRef.version})` +
    (request.note !== undefined ? ` — ${request.note}` : "");
  const { record, entry } = await registry.applyLifecycleTransition(organizationId, {
    toStatus: target,
    operation: "rollback",
    actor,
    gateResults: [],
    detail,
    rollbackTrigger: trigger,
  });
  return {
    outcome: "granted",
    organizationId,
    fromVersion: current.version,
    fromStatus: current.status,
    toVersion: record.version,
    toStatus: record.status,
    policy: policyRef,
    trigger,
    record,
    transition: entry,
    occurredAt: record.updatedAt,
  };
}
