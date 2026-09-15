/**
 * The W803 gate policy — the versioned DATA document that decides which
 * gates exist, where each one's evaluation comes from, and how each one's
 * failure propagates to the release verdict (docs/GATES.md §gates is the
 * normative mirror, pinned row-for-row in both directions by
 * `test/policyDoc.test.ts` — the W503 THRESHOLDS.md convention).
 *
 * Why data and not `if` statements: the work item's style rule — "gate
 * policy (which gates are blocking vs advisory) is a versioned DATA
 * document pinned to code by test both directions — no policy in scattered
 * ifs". `evaluateReleaseReadiness` reads blocking-ness and not-runnable
 * outcomes from THIS table; nothing in the gate code hard-codes a gate's
 * privilege.
 *
 * v1 declares every gate BLOCKING. Downgrading a gate to advisory would be
 * an invented escape hatch — no measured evidence exists that any gate's
 * failure is survivable for a release — so none is advisory
 * (docs/GATES.md §gates). The advisory MECHANISM is still real code (it
 * reads `blocking` from the policy), and `test/gates.test.ts` proves it
 * with a test-only policy variant; only the classification is v1 data.
 */
import { QualityGatesError } from "./errors";

/** The policy document's identity (echoed by the release report). */
export const GATE_POLICY_ID = "w803-gates-v1";

/**
 * What a blocking gate's `NOT-RUNNABLE` verdict contributes to the overall
 * release verdict:
 *
 * - `"release-fail"` — the gate could not run (missing input, package
 *   error); the release FAILS. The machine gates' fail-closed posture.
 * - `"pending-human-review"` — the gate could not run because its human
 *   input is absent/malformed/incomplete; the release verdict becomes
 *   `PENDING-HUMAN-REVIEW` (every machine gate having passed). Exactly one
 *   gate may carry this outcome: the human gate, whose input is a human
 *   act that code cannot perform on behalf of a person.
 */
export type NotRunnableOutcome = "release-fail" | "pending-human-review";

/** One declared gate (a row of the policy table). */
export interface GatePolicyEntry {
  /** The gate's stable id (the report's gate rows key on this). */
  readonly gateId: string;
  /** The human-readable gate name. */
  readonly name: string;
  /** The workspace package that owns the gate's evaluation. */
  readonly sourcePackage: string;
  /** Whether the gate's non-PASS verdicts block the release. */
  readonly blocking: boolean;
  /** What this gate's NOT-RUNNABLE contributes (see {@link NotRunnableOutcome}). */
  readonly notRunnableOutcome: NotRunnableOutcome;
}

/** The gate that never lets a gate silently vanish (the ledger itself). */
export const ACCOUNTING_GATE_ID = "gate-accounting";
/** The fail-closed human review gate. */
export const HUMAN_GATE_ID = "human-quality-checks";

/**
 * The canonical W803 gate policy. Order is the report's gate-row order and
 * the evaluation order.
 */
export const GATE_POLICY: readonly GatePolicyEntry[] = [
  {
    gateId: "temporal-stability",
    name: "Temporal stability",
    sourcePackage: "@sporta/renderer-evaluation",
    blocking: true,
    notRunnableOutcome: "release-fail",
  },
  {
    gateId: "scene-correctness",
    name: "Scene correctness",
    sourcePackage: "@sporta/scene-evaluation",
    blocking: true,
    notRunnableOutcome: "release-fail",
  },
  {
    gateId: HUMAN_GATE_ID,
    name: "Human quality checks",
    sourcePackage: "@sporta/quality-gates",
    blocking: true,
    notRunnableOutcome: "pending-human-review",
  },
  {
    gateId: ACCOUNTING_GATE_ID,
    name: "Gate accounting",
    sourcePackage: "@sporta/quality-gates",
    blocking: true,
    notRunnableOutcome: "release-fail",
  },
] as const;

/**
 * Fails loud (`QualityGatesError("report-inconsistent")`) on a policy that
 * would break the documented verdict semantics: duplicate gate ids, a
 * missing accounting gate, zero or multiple pending-outcome gates, or a
 * pending outcome on any gate other than the human gate. The policy is
 * data, but not arbitrary data — it must be able to mean what
 * docs/GATES.md §verdicts says it means.
 */
export function assertGatePolicyWellFormed(policy: readonly GatePolicyEntry[]): void {
  const path = "$.gates";
  const ids = policy.map((entry) => entry.gateId);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    throw new QualityGatesError(
      "report-inconsistent",
      `${path}[?].gateId`,
      `duplicate gate id(s): ${duplicates.join(", ")}`,
    );
  }
  if (!ids.includes(ACCOUNTING_GATE_ID)) {
    throw new QualityGatesError(
      "report-inconsistent",
      path,
      `the policy must declare the accounting gate "${ACCOUNTING_GATE_ID}"`,
    );
  }
  const pending = policy.filter((entry) => entry.notRunnableOutcome === "pending-human-review");
  if (pending.length !== 1 || pending[0]!.gateId !== HUMAN_GATE_ID) {
    throw new QualityGatesError(
      "report-inconsistent",
      `${path}[?].notRunnableOutcome`,
      "exactly one gate — the human gate — may map NOT-RUNNABLE to pending-human-review " +
        `(found ${pending.length}: ${pending.map((entry) => entry.gateId).join(", ") || "none"})`,
    );
  }
  if (!ids.includes(HUMAN_GATE_ID)) {
    throw new QualityGatesError(
      "report-inconsistent",
      path,
      `the policy must declare the human gate "${HUMAN_GATE_ID}"`,
    );
  }
}

/**
 * Looks one policy entry up by gate id (fail-loud: an unknown id is a code
 * bug, never an evaluation result). Defaults to the canonical policy; the
 * accounting builder passes its checked policy explicitly.
 */
export function policyEntryOf(
  gateId: string,
  policy: readonly GatePolicyEntry[] = GATE_POLICY,
): GatePolicyEntry {
  const entry = policy.find((candidate) => candidate.gateId === gateId);
  if (entry === undefined) {
    throw new RangeError(`policyEntryOf: no gate "${gateId}" in the gate policy`);
  }
  return entry;
}
