/**
 * The W803 gate policy — the versioned DATA document that decides which
 * gates exist, which are blocking, and what a not-runnable gate counts
 * as. The canonical reference is `docs/GATES.md` (§1's table is pinned
 * row-for-row to {@link GATE_POLICY} by `test/policy-doc.test.ts`, both
 * directions — the W503 THRESHOLDS.md / W802 SLOs.md convention: a change
 * to either side without the other fails the suite).
 *
 * THERE IS NO GATE POLICY IN SCATTERED IFS: every gate-row field below is
 * carried verbatim into every release report row, and the overall verdict
 * is computed from those fields alone (`./report.ts`). A custom policy can
 * be injected into {@link evaluateReleaseReadiness} (the camera-director
 * `DirectorPolicy` precedent) and is re-validated fail-closed by
 * {@link validateGatePolicy} — the semantic constraints below are the
 * work order's own semantics, enforced at admission:
 *
 * 1. the release evaluation is TOTAL: all four canonical gates must be
 *    present (a policy that drops a gate is a silent vanish — rejected);
 * 2. the human gate is BLOCKING and its not-runnable outcome is
 *    `pending-human-review` (a missing/malformed/incomplete review record
 *    yields `PENDING-HUMAN-REVIEW`, never PASS, never a silent skip);
 * 3. the accounting gate is BLOCKING and its not-runnable outcome is
 *    `fail` (the ledger failing or not running is itself a failure);
 * 4. machine gates that cannot run count as FAIL (missing input, package
 *    error — never a silent skip, never vacuous credit);
 * 5. gate ids are a closed vocabulary (four ids, unique).
 */
import { fail } from "./errors";

/** The gate policy document's version (versioned with the policy shape). */
export const GATE_POLICY_VERSION = "w803-gate-policy@1";

/** The closed gate vocabulary (the release evaluation is exactly these gates). */
export const GATE_IDS = [
  "temporal-stability",
  "scene-correctness",
  "human-quality-checks",
  "gate-accounting",
] as const;

/** One gate's id (the closed vocabulary). */
export type GateId = (typeof GATE_IDS)[number];

/** What a not-runnable blocking gate counts as for the overall verdict. */
export type NotRunnableOutcome = "fail" | "pending-human-review";

/** One policy row: the gate's identity and verdict semantics. */
export interface GatePolicyEntry {
  /** The gate's id (closed vocabulary, unique within a policy). */
  readonly gateId: GateId;
  /** The package that owns the gate's measurement (verbatim package name). */
  readonly sourcePackage: string;
  /** Blocking gates decide the release verdict; advisory gates are reported only. */
  readonly blocking: boolean;
  /** What a not-runnable verdict counts as (see the module docblock). */
  readonly notRunnableOutcome: NotRunnableOutcome;
  /** One-line description, mirrored verbatim in docs/GATES.md §1. */
  readonly description: string;
}

/** A validated gate policy document. */
export interface GatePolicy {
  /** The policy version ({@link GATE_POLICY_VERSION} for the canonical policy). */
  readonly version: string;
  /** The gate rows, in policy order (the report's gate-row order). */
  readonly gates: readonly GatePolicyEntry[];
}

/**
 * The canonical gate policy (`w803-gate-policy@1`). Pinned row-for-row to
 * docs/GATES.md §1 by `test/policy-doc.test.ts`. Semantics per row:
 *
 * - `temporal-stability` — runs W503's real `evaluateTemporalConsistency`
 *   over each supplied fixture clip; the gate verdict is that report's own
 *   verdict. Thresholds are REFERENCED from W503's pinned
 *   `src/thresholds.ts` / `THRESHOLDS.md`; this package defines ZERO new
 *   numeric thresholds for it.
 * - `scene-correctness` — runs W605's real `evaluateSceneOutput` over each
 *   supplied fixture; the gate verdict is that report's own verdict
 *   (zero-threshold semantics are W605's own, referenced not re-stated).
 * - `human-quality-checks` — fail-closed human review over the record
 *   format of docs/REVIEW.md; absent/malformed/incomplete record →
 *   `PENDING-HUMAN-REVIEW`.
 * - `gate-accounting` — the never-silent ledger: every policy gate appears
 *   exactly once in the report and the counts reconcile; a gate that
 *   silently vanishes is itself a failure.
 */
export const GATE_POLICY: GatePolicy = {
  version: GATE_POLICY_VERSION,
  gates: [
    {
      gateId: "temporal-stability",
      sourcePackage: "@sporta/renderer-evaluation",
      blocking: true,
      notRunnableOutcome: "fail",
      description:
        "W503's real temporal-consistency evaluation over the fixture clip; the gate verdict is that report's own verdict (thresholds referenced from W503's pinned THRESHOLDS, none defined here)",
    },
    {
      gateId: "scene-correctness",
      sourcePackage: "@sporta/scene-evaluation",
      blocking: true,
      notRunnableOutcome: "fail",
      description:
        "W605's real scene-correctness evaluation over the fixtures; the gate verdict is that report's own verdict (zero-threshold semantics referenced from W605)",
    },
    {
      gateId: "human-quality-checks",
      sourcePackage: "@sporta/quality-gates",
      blocking: true,
      notRunnableOutcome: "pending-human-review",
      description:
        "fail-closed human review record (docs/REVIEW.md checklist); a missing, malformed, or incomplete record yields PENDING-HUMAN-REVIEW, never PASS",
    },
    {
      gateId: "gate-accounting",
      sourcePackage: "@sporta/quality-gates",
      blocking: true,
      notRunnableOutcome: "fail",
      description:
        "the never-silent ledger: every policy gate appears exactly once and the counts reconcile (gates = pass + fail + not-runnable); a silently vanished gate is itself a failure",
    },
  ],
};

// ---------------------------------------------------------------------------
// Fail-closed validation
// ---------------------------------------------------------------------------

/** The exact key set of one policy row (unknown keys are rejected). */
const ROW_KEYS: readonly string[] = [
  "gateId",
  "sourcePackage",
  "blocking",
  "notRunnableOutcome",
  "description",
];

/** Bound: the policy's version string. */
const MAX_VERSION_LENGTH = 100;
/** Bound: a row's sourcePackage string. */
const MAX_SOURCE_PACKAGE_LENGTH = 200;
/** Bound: a row's description string. */
const MAX_DESCRIPTION_LENGTH = 1000;

/** True iff `value` is a string of length 1..max. */
function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= max;
}

/**
 * Validates a gate policy document fail-closed. Returns a frozen policy
 * with the rows in the DOCUMENT's order (row order is the report's gate
 * order). Throws {@link QualityGateError} (`gate-policy-malformed`) with
 * the JSON path of the violation — never a silent coercion.
 */
export function validateGatePolicy(policy: unknown): GatePolicy {
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
    fail("gate-policy-malformed", "$", "the policy must be an object");
  }
  const root = policy as Record<string, unknown>;
  const rootKeys = Object.keys(root).sort();
  if (rootKeys.length !== 2 || rootKeys[0] !== "gates" || rootKeys[1] !== "version") {
    fail(
      "gate-policy-malformed",
      "$",
      `the policy's key set must be exactly {gates, version} (found {${rootKeys.join(", ")}})`,
    );
  }
  if (!isBoundedString(root.version, MAX_VERSION_LENGTH)) {
    fail(
      "gate-policy-malformed",
      "$.version",
      `must be a non-empty string of at most ${MAX_VERSION_LENGTH} characters`,
    );
  }
  if (!Array.isArray(root.gates)) {
    fail("gate-policy-malformed", "$.gates", "must be an array of gate rows");
  }
  if (root.gates.length !== GATE_IDS.length) {
    fail(
      "gate-policy-malformed",
      "$.gates",
      `the release evaluation is total: exactly ${GATE_IDS.length} gate rows are required, found ${root.gates.length}`,
    );
  }
  const seen = new Set<GateId>();
  const rows: GatePolicyEntry[] = [];
  root.gates.forEach((row: unknown, index: number) => {
    const path = `$.gates[${index}]`;
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      fail("gate-policy-malformed", path, "a gate row must be an object");
    }
    const record = row as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== ROW_KEYS.length || !ROW_KEYS.every((key) => keys.includes(key))) {
      fail(
        "gate-policy-malformed",
        path,
        `a gate row's key set must be exactly {${ROW_KEYS.join(", ")}} (found {${keys.join(", ")}})`,
      );
    }
    const gateId = record.gateId;
    if (typeof gateId !== "string" || !(GATE_IDS as readonly string[]).includes(gateId)) {
      fail(
        "gate-policy-malformed",
        `${path}.gateId`,
        `"${String(gateId)}" is not a known gate id (closed vocabulary: ${GATE_IDS.join(", ")})`,
      );
    }
    if (seen.has(gateId as GateId)) {
      fail("gate-policy-malformed", `${path}.gateId`, `duplicate gate id "${gateId}"`);
    }
    seen.add(gateId as GateId);
    if (!isBoundedString(record.sourcePackage, MAX_SOURCE_PACKAGE_LENGTH)) {
      fail(
        "gate-policy-malformed",
        `${path}.sourcePackage`,
        `must be a non-empty string of at most ${MAX_SOURCE_PACKAGE_LENGTH} characters`,
      );
    }
    if (typeof record.blocking !== "boolean") {
      fail("gate-policy-malformed", `${path}.blocking`, "must be a boolean");
    }
    const outcome = record.notRunnableOutcome;
    if (outcome !== "fail" && outcome !== "pending-human-review") {
      fail(
        "gate-policy-malformed",
        `${path}.notRunnableOutcome`,
        `"${String(outcome)}" must be "fail" or "pending-human-review"`,
      );
    }
    if (!isBoundedString(record.description, MAX_DESCRIPTION_LENGTH)) {
      fail(
        "gate-policy-malformed",
        `${path}.description`,
        `must be a non-empty string of at most ${MAX_DESCRIPTION_LENGTH} characters`,
      );
    }
    rows.push({
      gateId: gateId as GateId,
      sourcePackage: record.sourcePackage,
      blocking: record.blocking,
      notRunnableOutcome: outcome,
      description: record.description,
    });
  });
  // Totality: every canonical gate present.
  for (const gateId of GATE_IDS) {
    if (!seen.has(gateId)) {
      fail(
        "gate-policy-malformed",
        "$.gates",
        `gate "${gateId}" is missing — the release evaluation is total, dropping a gate is a silent vanish`,
      );
    }
  }
  // The work order's own semantics, enforced at admission.
  const rowOf = (gateId: GateId): GatePolicyEntry => rows.find((row) => row.gateId === gateId)!;
  const human = rowOf("human-quality-checks");
  if (!human.blocking || human.notRunnableOutcome !== "pending-human-review") {
    fail(
      "gate-policy-malformed",
      "$.gates",
      'the human-quality-checks gate must be blocking with notRunnableOutcome "pending-human-review" (a missing review record yields PENDING-HUMAN-REVIEW, never PASS)',
    );
  }
  const accounting = rowOf("gate-accounting");
  if (!accounting.blocking || accounting.notRunnableOutcome !== "fail") {
    fail(
      "gate-policy-malformed",
      "$.gates",
      'the gate-accounting gate must be blocking with notRunnableOutcome "fail" (a failing or not-runnable ledger is itself a failure)',
    );
  }
  for (const machineId of ["temporal-stability", "scene-correctness"] as const) {
    if (rowOf(machineId).notRunnableOutcome !== "fail") {
      fail(
        "gate-policy-malformed",
        "$.gates",
        `the machine gate "${machineId}" must count a not-runnable verdict as FAIL (missing input / package error are accounted failures, never silent skips)`,
      );
    }
  }
  const pendingCount = rows.filter(
    (row) => row.notRunnableOutcome === "pending-human-review",
  ).length;
  if (pendingCount !== 1) {
    fail(
      "gate-policy-malformed",
      "$.gates",
      `exactly one gate (the human gate) may map not-runnable to pending-human-review, found ${pendingCount}`,
    );
  }
  return Object.freeze({ version: root.version, gates: Object.freeze(rows) });
}
