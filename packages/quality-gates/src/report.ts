/**
 * The W803 release report: {@link evaluateReleaseReadiness} composes the
 * four accounted gates (`./gates.ts`) into ONE release verdict, and
 * {@link serializeReleaseReport} renders it in canonical form.
 *
 * Verdict semantics (docs/GATES.md §3, pinned by tests):
 *
 * - `PASS` — every blocking gate passed (machine gates on the source
 *   packages' own verdicts; the human gate on a complete, all-pass review
 *   record);
 * - `PENDING-HUMAN-REVIEW` — the machine gates passed but the human
 *   review record is absent, malformed, or incomplete (fail-closed: the
 *   review has not happened; never PASS, never a silent skip);
 * - `FAIL` — any blocking gate failed or could not run (not-runnable
 *   machine gates and the accounting gate count as FAIL via the policy's
 *   `notRunnableOutcome`), or the completed review record rejects the
 *   release.
 *
 * Advisory gates never change the outcome — but they are never silent
 * either: an advisory failure or not-runnable advisory gate is carried in
 * the verdict reason.
 *
 * Determinism: the report is a pure function of (input, policy) — no
 * clock, no RNG, no I/O, no stack traces, no hostnames. The same input
 * yields a byte-identical canonical report, pinned twice in one process
 * and across two subprocess invocations (SHA-256-compared stdout) by
 * `test/report.test.ts` and `test/subprocess.test.ts`.
 *
 * Fail-loud boundary: the release input's own structure and the policy
 * document are validated fail-closed (typed errors with JSON paths,
 * `./errors.ts`); everything INSIDE the gates is accounted, never thrown
 * (a not-runnable gate is an accounted row that counts as FAIL).
 */
import { fail } from "./errors";
import type { GatePolicy } from "./policy";
import { GATE_POLICY, validateGatePolicy } from "./policy";
import type {
  HumanReviewSection,
  ReleaseGateRow,
  SceneGateInput,
  TemporalGateInput,
} from "./gates";
import {
  buildAccountingRow,
  countGateVerdicts,
  reconcileGateRows,
  runHumanReviewGate,
  runSceneGate,
  runTemporalGate,
} from "./gates";

/** The release report's schema tag (versioned with the report shape). */
export const REPORT_SCHEMA_TAG = "sporta/quality-gates/w803@1";

/** The overall release verdict vocabulary (exactly three outcomes). */
export type ReleaseOutcome = "PASS" | "PENDING-HUMAN-REVIEW" | "FAIL";

/** The release-readiness input: the three gate inputs (docs/GATES.md §4). */
export interface ReleaseReadinessInput {
  /** The temporal gate's fixtures (W503 evaluation inputs). */
  readonly temporal: TemporalGateInput;
  /** The scene gate's fixtures (W605 evaluation inputs). */
  readonly scene: SceneGateInput;
  /**
   * The human-review record document (docs/REVIEW.md), or
   * undefined/null/absent — every non-absent value is validated
   * fail-closed by the gate; an invalid record is ACCOUNTED (malformed),
   * never silently skipped.
   */
  readonly humanReview: unknown;
}

/** The full W803 release-readiness report (docs/GATES.md §4). */
export interface ReleaseReadinessReport {
  /** Report schema tag: `"sporta/quality-gates/w803@1"`. */
  readonly schemaTag: string;
  /** The gate policy the evaluation ran under (echoed, verbatim fields). */
  readonly policy: {
    readonly version: string;
    readonly gateCount: number;
    readonly blockingGateCount: number;
    readonly advisoryGateCount: number;
  };
  /** What was evaluated (derived counts, documented in GATES.md §4). */
  readonly input: {
    readonly temporalFixtureCount: number;
    readonly sceneFixtureCount: number;
    readonly humanReviewSupplied: boolean;
  };
  /** The gate rows, in POLICY order — the accounted ledger. */
  readonly gates: readonly ReleaseGateRow[];
  /** The human-review section (the record's status, problems, echo). */
  readonly humanReview: HumanReviewSection;
  /**
   * The accounting table: counts that reconcile EXACTLY
   * (totalGates = passCount + failCount + notRunnableCount), pinned by
   * tests on every produced report.
   */
  readonly accounting: {
    readonly totalGates: number;
    readonly passCount: number;
    readonly failCount: number;
    readonly notRunnableCount: number;
  };
  /** The overall verdict and its accounted reason. */
  readonly verdict: {
    readonly outcome: ReleaseOutcome;
    readonly reason: string;
  };
}

// ---------------------------------------------------------------------------
// Fail-closed release-input validation
// ---------------------------------------------------------------------------

/** The exact allowed key set of the release input (humanReview optional). */
const INPUT_KEYS: readonly string[] = ["humanReview", "scene", "temporal"];
/** The exact key set of one gate section. */
const SECTION_KEYS: readonly string[] = ["evaluations"];
/** The exact key set of one fixture case. */
const CASE_KEYS: readonly string[] = ["input", "name"];
/** Bound: a fixture name. */
const MAX_FIXTURE_NAME_LENGTH = 200;

/** True iff `value` is a string of length 1..max. */
function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= max;
}

/**
 * Validates one machine gate's section: an object with exactly the
 * `evaluations` key, an array of case objects with exactly {name, input}
 * keys, unique bounded names. The case `input` may be anything (undefined
 * = missing; anything else is the source package's own validation's
 * authority — its rejection is an accounted not-runnable gate).
 */
function validateGateSection(
  value: unknown,
  path: string,
): { evaluations: readonly { name: string; input: unknown }[] } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("release-input-malformed", path, `the ${path.slice(2)} gate section must be an object`);
  }
  const section = value as Record<string, unknown>;
  const keys = Object.keys(section).sort();
  if (keys.length !== SECTION_KEYS.length || !SECTION_KEYS.every((key) => keys.includes(key))) {
    fail(
      "release-input-malformed",
      path,
      `the gate section's key set must be exactly {${SECTION_KEYS.join(", ")}} (found {${keys.join(", ")}})`,
    );
  }
  if (!Array.isArray(section.evaluations)) {
    fail("release-input-malformed", `${path}.evaluations`, "must be an array of fixture cases");
  }
  const names = new Set<string>();
  section.evaluations.forEach((entry: unknown, index: number) => {
    const casePath = `${path}.evaluations[${index}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      fail("release-input-malformed", casePath, "a fixture case must be an object");
    }
    const record = entry as Record<string, unknown>;
    const caseKeys = Object.keys(record).sort();
    if (caseKeys.length !== CASE_KEYS.length || !CASE_KEYS.every((key) => caseKeys.includes(key))) {
      fail(
        "release-input-malformed",
        casePath,
        `a fixture case's key set must be exactly {${CASE_KEYS.join(", ")}} (found {${caseKeys.join(", ")}})`,
      );
    }
    if (!isBoundedString(record.name, MAX_FIXTURE_NAME_LENGTH)) {
      fail(
        "release-input-malformed",
        `${casePath}.name`,
        `must be a non-empty string of at most ${MAX_FIXTURE_NAME_LENGTH} characters`,
      );
    }
    if (names.has(record.name)) {
      fail(
        "release-input-malformed",
        `${casePath}.name`,
        `duplicate fixture name "${record.name}" — gate accounting is ambiguous`,
      );
    }
    names.add(record.name);
  });
  return {
    evaluations: section.evaluations as readonly { name: string; input: unknown }[],
  };
}

/**
 * Validates the release-readiness input's structure fail-closed: an
 * object whose key set is within {temporal, scene, humanReview} with the
 * two machine sections required. The case-level inputs are NOT validated
 * here — the source packages' own fail-loud validation is the authority,
 * and its rejection is an accounted not-runnable gate, never a throw at
 * this layer.
 */
function validateReleaseInput(input: unknown): ReleaseReadinessInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("release-input-malformed", "$", "the release input must be an object");
  }
  const root = input as Record<string, unknown>;
  for (const key of Object.keys(root)) {
    if (!INPUT_KEYS.includes(key)) {
      fail(
        "release-input-malformed",
        `$.${key}`,
        `unknown key — the release input's key set must be within {${INPUT_KEYS.join(", ")}}`,
      );
    }
  }
  if (!("temporal" in root)) {
    fail("release-input-malformed", "$.temporal", "the temporal gate section is required");
  }
  if (!("scene" in root)) {
    fail("release-input-malformed", "$.scene", "the scene gate section is required");
  }
  const temporal = validateGateSection(root.temporal, "$.temporal");
  const scene = validateGateSection(root.scene, "$.scene");
  return {
    temporal: temporal as TemporalGateInput,
    scene: scene as SceneGateInput,
    humanReview: "humanReview" in root ? root.humanReview : undefined,
  };
}

// ---------------------------------------------------------------------------
// The overall verdict
// ---------------------------------------------------------------------------

/** The release verdict's accounted decision (outcome + reason). */
function computeOverallOutcome(rows: readonly ReleaseGateRow[]): {
  outcome: ReleaseOutcome;
  reason: string;
} {
  const describeRow = (row: ReleaseGateRow): string =>
    `${row.gateId}=${row.verdict}${row.reason === undefined ? "" : ` (${row.reason})`}`;
  const blocking = rows.filter((row) => row.blocking);
  const hardFailures = blocking.filter(
    (row) =>
      row.verdict === "FAIL" ||
      (row.verdict === "NOT-RUNNABLE" && row.notRunnableOutcome === "fail"),
  );
  const pendingReviews = blocking.filter((row) => row.verdict === "NOT-RUNNABLE");
  if (hardFailures.length > 0) {
    return {
      outcome: "FAIL",
      reason: `blocking gate(s) failed or could not run: ${hardFailures.map(describeRow).join("; ")}`,
    };
  }
  if (pendingReviews.length > 0) {
    return {
      outcome: "PENDING-HUMAN-REVIEW",
      reason: `human review required: ${pendingReviews.map(describeRow).join("; ")}`,
    };
  }
  const advisoryNotes = rows
    .filter((row) => !row.blocking && row.verdict !== "PASS")
    .map(describeRow);
  const advisorySuffix =
    advisoryNotes.length === 0
      ? ""
      : `; advisory gate(s) reported without release effect: ${advisoryNotes.join("; ")}`;
  return {
    outcome: "PASS",
    reason: `every blocking gate passed${advisorySuffix}`,
  };
}

// ---------------------------------------------------------------------------
// The release evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluates the release readiness of the supplied inputs under the
 * supplied gate policy (default: the canonical {@link GATE_POLICY}).
 *
 * Pure and deterministic: the same (input, policy) yields a byte-identical
 * canonical report on every call, in-process and across subprocesses.
 * Throws {@link QualityGateError} only for malformed CONTAINERS — the
 * release input's own structure (`release-input-malformed`) or a
 * semantically illegal policy (`gate-policy-malformed`) — plus
 * `report-volatile` if the assembled report has no canonical form (an
 * evaluator bug). Every gate-level failure is an accounted row.
 */
export function evaluateReleaseReadiness(
  input: unknown,
  policy: GatePolicy = GATE_POLICY,
): ReleaseReadinessReport {
  const validatedPolicy = validateGatePolicy(policy);
  const validatedInput = validateReleaseInput(input);

  const temporalRow = runTemporalGate(validatedInput.temporal, validatedPolicy);
  const sceneRow = runSceneGate(validatedInput.scene, validatedPolicy);
  const humanGate = runHumanReviewGate(validatedInput.humanReview, validatedPolicy);

  const precedingRows = [temporalRow, sceneRow, humanGate.row];
  const reconciliation = reconcileGateRows(precedingRows, validatedPolicy);
  const accountingRow = buildAccountingRow(reconciliation, precedingRows, validatedPolicy);

  // The report's gate rows in POLICY order (deterministic row order).
  const byId = new Map<string, ReleaseGateRow>();
  for (const row of [...precedingRows, accountingRow]) byId.set(row.gateId, row);
  const gates = validatedPolicy.gates
    .map((entry) => byId.get(entry.gateId))
    .filter((row): row is ReleaseGateRow => row !== undefined);
  if (gates.length !== validatedPolicy.gates.length) {
    fail(
      "report-volatile",
      "$.gates",
      "a policy gate has no row — the assembly lost a gate (an evaluator bug, never a silent skip)",
    );
  }

  const counts = countGateVerdicts(gates);
  const verdict = computeOverallOutcome(gates);
  return {
    schemaTag: REPORT_SCHEMA_TAG,
    policy: {
      version: validatedPolicy.version,
      gateCount: validatedPolicy.gates.length,
      blockingGateCount: validatedPolicy.gates.filter((entry) => entry.blocking).length,
      advisoryGateCount: validatedPolicy.gates.filter((entry) => !entry.blocking).length,
    },
    input: {
      temporalFixtureCount: validatedInput.temporal.evaluations.length,
      sceneFixtureCount: validatedInput.scene.evaluations.length,
      humanReviewSupplied:
        validatedInput.humanReview !== undefined && validatedInput.humanReview !== null,
    },
    gates,
    humanReview: humanGate.section,
    accounting: {
      totalGates: counts.total,
      passCount: counts.pass,
      failCount: counts.fail,
      notRunnableCount: counts.notRunnable,
    },
    verdict,
  };
}

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

/**
 * Canonicalizes a JSON value: object keys sorted recursively, arrays kept
 * in order, `undefined` and non-finite numbers REJECTED (volatile values
 * have no canonical form). The W403 serializer semantics, local (the
 * W306 `canonicalize` precedent).
 */
function canonicalize(value: unknown, path: string): unknown {
  if (value === undefined) {
    fail("report-volatile", path, "an undefined value has no canonical form");
  }
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      fail("report-volatile", path, "a non-finite number has no canonical form");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalize(entry, `${path}[${index}]`));
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = canonicalize(record[key], `${path}.${key}`);
  }
  return sorted;
}

/**
 * Serializes the release report in canonical form: recursively sorted
 * keys, two-space indent, one trailing newline. Byte-deterministic —
 * the same report yields the same bytes in every process (pinned by
 * tests in-process and across subprocesses).
 */
export function serializeReleaseReport(report: ReleaseReadinessReport): string {
  return `${JSON.stringify(canonicalize(report, "$"), null, 2)}\n`;
}
