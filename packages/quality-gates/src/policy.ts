/**
 * The W803 GATE POLICY — the versioned DATA document that decides which
 * gates a release must pass (and which are advisory).
 *
 * **`docs/GATES.md` §1 is the normative document**; the table below is its
 * executable mirror, pinned row-for-row (value AND order, both directions)
 * by `test/policy.test.ts` — a change to either side without the other
 * fails the suite (the W503 THRESHOLDS.md / W802 SLOs.md convention; no
 * silent drift). There are NO gate decisions in scattered `if`s anywhere
 * in this package: which gates exist, what they are called, which package
 * owns them, whether they block, and which real exports they run all live
 * HERE, as data.
 *
 * Every machine gate names its REAL seams (`seams`): the workspace package
 * + export that implements the gate. `test/policy.test.ts` imports the
 * real packages and fails on any dangling reference (the W802
 * `DEGRADATION_POLICIES` machinery-pin convention — a policy naming a seam
 * that does not exist is a construction bug, fail-closed).
 *
 * This package defines ZERO quality thresholds in this table (GATES.md
 * §7): the machine gates' verdicts are the SOURCE packages' own verdicts,
 * under THEIR pinned thresholds (`@sporta/renderer-evaluation`
 * THRESHOLDS.md, `@sporta/scene-evaluation` THRESHOLDS.md). The only
 * numbers here are schema FORMAT BOUNDS of documents this package owns
 * (see `./humanReview.ts`), not quality thresholds.
 */
import { fail } from "./errors";

/** The gate policy document's identity (echoed by every release report). */
export const GATE_POLICY_ID = "w803-gate-policy@1";

/** What a gate is, for verdict composition (see GATES.md §2). */
export type GateRole =
  /** A machine evaluation composed from a real source package (blocking-relevant). */
  | "machine"
  /** The fail-closed human review gate (its incomplete-class failures yield PENDING-HUMAN-REVIEW). */
  | "human"
  /** The never-silent ledger gate (reconciles the report against this policy). */
  | "accounting";

/** One real, importable seam a gate runs (fail-closed pin target). */
export interface GateSeam {
  /** The workspace package (must exist and be importable — test-pinned). */
  readonly packageName: string;
  /** The export that implements the seam (must exist at runtime — test-pinned). */
  readonly exportName: string;
}

/** One gate policy row (one GATES.md §1 row, verbatim). */
export interface GatePolicyEntry {
  /** Stable machine-readable id, e.g. `"temporal-stability"`. */
  readonly gateId: string;
  /** The human-readable gate name (carried into every report row). */
  readonly name: string;
  /** The package that owns the gate's verdict. */
  readonly sourcePackage: string;
  /** The gate's role in verdict composition. */
  readonly role: GateRole;
  /** Whether the gate blocks the release (advisory failures are reported, never blocking). */
  readonly blocking: boolean;
  /** One line: what the gate decides (carried into GATES.md §1, pinned). */
  readonly description: string;
  /** The real seams the gate runs (all must exist — test-pinned, fail-closed). */
  readonly seams: readonly GateSeam[];
}

/** The gate policy document: its identity + its ordered gate rows. */
export interface GatePolicyDocument {
  readonly policyId: string;
  readonly gates: readonly GatePolicyEntry[];
}

/** The canonical W803 release gate policy (GATES.md §1, executable mirror). */
export const GATE_POLICY: GatePolicyDocument = {
  policyId: GATE_POLICY_ID,
  gates: [
    {
      gateId: "temporal-stability",
      name: "Temporal stability",
      sourcePackage: "@sporta/renderer-evaluation",
      role: "machine",
      blocking: true,
      description:
        "W503 temporal consistency of the rendered anime clip (identity flicker, geometry drift, temporal artifacts) over the real fixture clip; the gate verdict is the source report's own verdict under the source package's pinned thresholds.",
      seams: [
        { packageName: "@sporta/renderer-evaluation", exportName: "renderW503CleanFixture" },
        { packageName: "@sporta/renderer-evaluation", exportName: "evaluateRenderOutput" },
      ],
    },
    {
      gateId: "scene-correctness",
      name: "Scene correctness",
      sourcePackage: "@sporta/scene-evaluation",
      role: "machine",
      blocking: true,
      description:
        "W605 six-axis 3D-output correctness (score, clock, identity continuity, ordering, scene state, direction) over the real fixtures; the gate verdict is the conjunction of the source reports' own verdicts under the source package's pinned zero thresholds.",
      seams: [
        { packageName: "@sporta/scene-evaluation", exportName: "buildCleanMatchFixture" },
        { packageName: "@sporta/scene-evaluation", exportName: "buildCorrectionsMatchFixture" },
        { packageName: "@sporta/scene-evaluation", exportName: "buildDirectedReviewFixture" },
        { packageName: "@sporta/scene-evaluation", exportName: "evaluateSceneOutput" },
      ],
    },
    {
      gateId: "human-quality-checks",
      name: "Human quality checks",
      sourcePackage: "@sporta/quality-gates",
      role: "human",
      blocking: true,
      description:
        "Fail-closed human review over the documented checklist (docs/REVIEW.md): a missing, malformed, or incomplete record never passes and is never silently skipped (PENDING-HUMAN-REVIEW when the machine gates pass).",
      seams: [
        { packageName: "@sporta/quality-gates", exportName: "HUMAN_REVIEW_CHECKLIST" },
        { packageName: "@sporta/quality-gates", exportName: "SELF_CHECK_CHECKLIST" },
        { packageName: "@sporta/quality-gates", exportName: "validateHumanReviewRecord" },
      ],
    },
    {
      gateId: "accounting",
      name: "Accounting",
      sourcePackage: "@sporta/quality-gates",
      role: "accounting",
      blocking: true,
      description:
        "The never-silent ledger: every policy gate appears as exactly one report row, every row verdict is from the closed vocabulary, the counts reconcile (gates = pass + fail + not-runnable), and a gate that could not run counts as FAIL with the reason — a gate that silently vanishes fails the release.",
      seams: [{ packageName: "@sporta/quality-gates", exportName: "reconcileGateLedger" }],
    },
  ],
};

/**
 * The gate-id pattern (kebab-case; the closed vocabulary of THIS policy's
 * gate ids is pinned by GATES.md §1 — new ids require a reviewed doc row).
 */
const GATE_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/;

/** The closed accounting-check id vocabulary (GATES.md §3, mirrored by `./accounting.ts`). */
export const ACCOUNTING_CHECK_IDS = [
  "row-count",
  "gate-set",
  "verdict-vocabulary",
  "count-reconciliation",
] as const;

/**
 * Asserts the policy table's structural and semantic invariants
 * (fail-loud `policy-malformed`; called on EVERY release evaluation — a
 * broken table is a construction bug, never a silently-degraded verdict):
 *
 * 1. a non-empty document with a well-formed `policyId`;
 * 2. every row well-formed (ids, roles, blocking flag, description, seams);
 * 3. unique gate ids (no duplicated gates);
 * 4. exactly ONE `accounting`-role gate (the ledger is a single row);
 * 5. exactly ONE `human`-role gate and it is BLOCKING — a release that
 *    could waive human review by policy data would defeat the W803
 *    acceptance ("human/automated quality checks"), so it is rejected;
 * 6. at least one `machine`-role gate (composing the real evaluations is
 *    this package's reason to exist; a machine-gate-less policy is vacuous).
 */
export function assertGatePolicyInvariants(policy: GatePolicyDocument): void {
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) {
    fail("policy-malformed", "$", "the policy must be a document object");
  }
  if (typeof policy.policyId !== "string" || policy.policyId.length === 0) {
    fail("policy-malformed", "$.policyId", "must be a non-empty string");
  }
  if (!Array.isArray(policy.gates) || policy.gates.length === 0) {
    fail("policy-malformed", "$.gates", "must be a non-empty array of gate rows");
  }
  // `Array.isArray` narrows readonly arrays to `any[]`; restore the typed view.
  const gates = policy.gates as readonly GatePolicyEntry[];
  const seen = new Set<string>();
  const roles: Record<GateRole, number> = { machine: 0, human: 0, accounting: 0 };
  gates.forEach((entry, index) => {
    const path = `$.gates[${index}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      fail("policy-malformed", path, "must be a gate row object");
    }
    if (typeof entry.gateId !== "string" || !GATE_ID_PATTERN.test(entry.gateId)) {
      fail("policy-malformed", `${path}.gateId`, `must match ${GATE_ID_PATTERN.source}`);
    }
    if (seen.has(entry.gateId)) {
      fail("policy-malformed", `${path}.gateId`, `duplicate gate id "${entry.gateId}"`);
    }
    seen.add(entry.gateId);
    if (typeof entry.name !== "string" || entry.name.length === 0) {
      fail("policy-malformed", `${path}.name`, "must be a non-empty string");
    }
    if (typeof entry.sourcePackage !== "string" || entry.sourcePackage.length === 0) {
      fail("policy-malformed", `${path}.sourcePackage`, "must be a non-empty string");
    }
    if (entry.role !== "machine" && entry.role !== "human" && entry.role !== "accounting") {
      fail("policy-malformed", `${path}.role`, `must be "machine" | "human" | "accounting"`);
    }
    if (typeof entry.blocking !== "boolean") {
      fail("policy-malformed", `${path}.blocking`, "must be a boolean");
    }
    if (typeof entry.description !== "string" || entry.description.length === 0) {
      fail("policy-malformed", `${path}.description`, "must be a non-empty string");
    }
    if (!Array.isArray(entry.seams)) {
      fail("policy-malformed", `${path}.seams`, "must be an array of seams");
    }
    entry.seams.forEach((seam, seamIndex) => {
      const seamPath = `${path}.seams[${seamIndex}]`;
      if (seam === null || typeof seam !== "object" || Array.isArray(seam)) {
        fail("policy-malformed", seamPath, "must be a seam object");
      }
      if (typeof seam.packageName !== "string" || seam.packageName.length === 0) {
        fail("policy-malformed", `${seamPath}.packageName`, "must be a non-empty string");
      }
      if (typeof seam.exportName !== "string" || seam.exportName.length === 0) {
        fail("policy-malformed", `${seamPath}.exportName`, "must be a non-empty string");
      }
    });
    roles[entry.role] += 1;
  });
  if (roles.accounting !== 1) {
    fail(
      "policy-malformed",
      "$.gates",
      `exactly one "accounting"-role gate is required (found ${roles.accounting})`,
    );
  }
  if (roles.human !== 1) {
    fail(
      "policy-malformed",
      "$.gates",
      `exactly one "human"-role gate is required (found ${roles.human})`,
    );
  }
  const humanEntry = gates.find((entry) => entry.role === "human");
  if (humanEntry !== undefined && !humanEntry.blocking) {
    fail(
      "policy-malformed",
      `$.gates[${gates.indexOf(humanEntry)}].blocking`,
      "the human-quality-checks gate must be blocking (a waivable human review defeats the W803 acceptance criterion)",
    );
  }
  if (roles.machine < 1) {
    fail(
      "policy-malformed",
      "$.gates",
      "at least one machine-role gate is required (composing the real evaluations is this package's purpose)",
    );
  }
}
