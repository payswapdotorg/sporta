/**
 * The accounting teeth: the never-silent ledger is a real checker with
 * bite, proven through its exported pure seams —
 * `evaluateAccountingGate` (a vanishing gate, an undeclared row, a
 * duplicate row, a reason-less NOT-RUNNABLE, an unknown verdict → the
 * accounting gate FAILs with the violation accounted),
 * `computeLedger` (counts; fail-loud on a row set that is not the policy's
 * gates in order, or on an unknown verdict), the policy self-check
 * (`assertGatePolicyWellFormed`), and the policy lookup
 * (`policyEntryOf`).
 */
import { describe, expect, test } from "bun:test";
import {
  ACCOUNTING_GATE_ID,
  GATE_POLICY,
  QualityGatesError,
  assertGatePolicyWellFormed,
  computeLedger,
  evaluateAccountingGate,
  evaluateReleaseReadiness,
  policyEntryOf,
  subjectGateIds,
} from "../src/index";
import type { AccountableRow, AccountingCheck } from "../src/index";

/** Three healthy subject rows (the canonical shape). */
function healthySubjects(): AccountableRow[] {
  return subjectGateIds(GATE_POLICY).map((gateId) => ({
    gateId,
    verdict: "PASS" as const,
    reason: "healthy",
  }));
}

/** Runs the accounting gate over one subject row set. */
function check(subjects: AccountableRow[]): AccountingCheck {
  return evaluateAccountingGate(subjects, GATE_POLICY);
}

describe("evaluateAccountingGate — the never-silent ledger has teeth", () => {
  test("the healthy row set passes with zero violations", () => {
    const result = check(healthySubjects());
    expect(result.verdict).toBe("PASS");
    expect(result.violations).toEqual([]);
  });

  test("a gate that silently vanishes fails the accounting gate", () => {
    const subjects = healthySubjects();
    const withoutHuman = subjects.filter((row) => row.gateId !== "human-quality-checks");
    const result = check(withoutHuman);
    expect(result.verdict).toBe("FAIL");
    expect(
      result.violations.some((violation) =>
        violation.includes(
          'gate "human-quality-checks" is declared in the policy but has no accounted row',
        ),
      ),
    ).toBe(true);
  });

  test("an undeclared row fails the accounting gate", () => {
    const result = check([
      ...healthySubjects(),
      { gateId: "mystery-gate", verdict: "PASS", reason: "?" },
    ]);
    expect(result.verdict).toBe("FAIL");
    expect(
      result.violations.some((violation) => violation.includes("not declared in the policy")),
    ).toBe(true);
  });

  test("a duplicated gate row fails the accounting gate", () => {
    const subjects = healthySubjects();
    const result = check([...subjects, subjects[0]!]);
    expect(result.verdict).toBe("FAIL");
    expect(result.violations.some((violation) => /has 2 rows/.test(violation))).toBe(true);
  });

  test("a NOT-RUNNABLE row with no accounted reason fails the accounting gate", () => {
    const subjects = healthySubjects();
    subjects[0] = { gateId: subjects[0]!.gateId, verdict: "NOT-RUNNABLE", reason: "   " };
    const result = check(subjects);
    expect(result.verdict).toBe("FAIL");
    expect(result.violations.some((violation) => violation.includes("no accounted reason"))).toBe(
      true,
    );
  });

  test("a NOT-RUNNABLE row WITH an accounted reason does not violate (the honest state)", () => {
    const subjects = healthySubjects();
    subjects[0] = {
      gateId: subjects[0]!.gateId,
      verdict: "NOT-RUNNABLE",
      reason: "missing input (accounted)",
    };
    const result = check(subjects);
    expect(result.verdict).toBe("PASS");
  });

  test("an unknown verdict fails the accounting gate", () => {
    const subjects = healthySubjects();
    (subjects[0] as { verdict: string }).verdict = "MAYBE";
    const result = check(subjects);
    expect(result.verdict).toBe("FAIL");
    expect(result.violations.some((violation) => violation.includes("unknown verdict"))).toBe(true);
  });
});

describe("computeLedger — the report's accounting table", () => {
  test("counts the four canonical rows and reconciles", () => {
    const report = evaluateReleaseReadiness({});
    // The empty-input report: 3 machine/human gates NOT-RUNNABLE + accounting PASS.
    expect(report.accounting).toMatchObject({
      totalGates: 4,
      pass: 1,
      fail: 0,
      notRunnable: 3,
      reconciles: true,
    });
    expect(report.accounting.perGate.map((row) => row.gateId)).toEqual(
      GATE_POLICY.map((entry) => entry.gateId),
    );
  });

  test("fails loud on a row set that is not the policy's gates in order", () => {
    const rows = healthySubjects();
    expect(() => computeLedger(rows, GATE_POLICY)).toThrow(QualityGatesError);
    try {
      computeLedger(rows, GATE_POLICY);
      throw new Error("unreachable");
    } catch (error) {
      expect((error as QualityGatesError).code).toBe("report-inconsistent");
      expect((error as QualityGatesError).path).toBe("$.gates");
    }
  });

  test("fails loud on an unknown verdict", () => {
    const rows: AccountableRow[] = GATE_POLICY.map((entry) => ({
      gateId: entry.gateId,
      verdict: "PASS" as const,
      reason: "ok",
    }));
    (rows[0] as { verdict: string }).verdict = "SHRUG";
    expect(() => computeLedger(rows, GATE_POLICY)).toThrow(/unknown verdict/);
  });
});

describe("the policy self-check (data, but not arbitrary data)", () => {
  test("the canonical policy passes its own self-check", () => {
    expect(() => assertGatePolicyWellFormed(GATE_POLICY)).not.toThrow();
  });

  test("duplicate gate ids are rejected", () => {
    const policy = [...GATE_POLICY, GATE_POLICY[0]!];
    expect(() => assertGatePolicyWellFormed(policy)).toThrow(/duplicate gate id/);
  });

  test("a missing accounting gate is rejected", () => {
    const policy = GATE_POLICY.filter((entry) => entry.gateId !== ACCOUNTING_GATE_ID);
    expect(() => assertGatePolicyWellFormed(policy)).toThrow(/accounting gate/);
  });

  test("a second pending-outcome gate is rejected (exactly one human gate pends)", () => {
    const policy = GATE_POLICY.map((entry) =>
      entry.gateId === "temporal-stability"
        ? { ...entry, notRunnableOutcome: "pending-human-review" as const }
        : entry,
    );
    expect(() => assertGatePolicyWellFormed(policy)).toThrow(/exactly one gate/);
  });

  test("a pending outcome on a non-human gate is rejected", () => {
    const policy = GATE_POLICY.map((entry) =>
      entry.gateId === "human-quality-checks"
        ? { ...entry, gateId: "some-other-gate" }
        : entry.gateId === "temporal-stability"
          ? { ...entry, notRunnableOutcome: "pending-human-review" as const }
          : entry,
    );
    expect(() => assertGatePolicyWellFormed(policy)).toThrow(/exactly one gate/);
  });
});

describe("policyEntryOf — the fail-loud policy lookup", () => {
  test("every canonical gate id resolves to its entry", () => {
    for (const entry of GATE_POLICY) {
      expect(policyEntryOf(entry.gateId)).toBe(entry);
    }
  });

  test("an unknown gate id is a RangeError (a code bug, never an evaluation result)", () => {
    expect(() => policyEntryOf("no-such-gate")).toThrow(RangeError);
  });
});
