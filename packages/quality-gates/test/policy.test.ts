/**
 * The GATES.md pin, both directions (the W503 THRESHOLDS.md / W802 SLOs.md
 * convention): §1's machine-parseable gate table mirrors `GATE_POLICY`
 * row-for-row (value AND order); §4's seam table mirrors the policy's
 * seams row-for-row; the identity table mirrors the policy id and gate
 * count. Every doc row is a code row and every code row is a doc row — a
 * change to either side without the other fails the suite.
 *
 * The seam rows are then resolved against the REAL packages: every seam
 * the policy names must exist as an importable export (the W802
 * DEGRADATION_POLICIES machinery-pin convention — a policy naming a seam
 * that does not exist is a construction bug, fail-closed).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as rendererEvaluation from "@sporta/renderer-evaluation";
import * as sceneEvaluation from "@sporta/scene-evaluation";
import {
  ACCOUNTING_CHECK_IDS,
  GATE_POLICY,
  GATE_POLICY_ID,
  QualityGateError,
  assertGatePolicyInvariants,
  type GatePolicyDocument,
  type GatePolicyEntry,
} from "../src/index";
import * as self from "../src/index";

const DOC: string = readFileSync(join(import.meta.dir, "..", "docs", "GATES.md"), "utf8");

/** One parsed §1 gate row. */
interface DocGateRow {
  readonly gateId: string;
  readonly name: string;
  readonly sourcePackage: string;
  readonly role: string;
  readonly blocking: string;
  readonly description: string;
}

/** The §1 rows (the machine-parseable 6-column gate table). */
const gateRows: DocGateRow[] = [];
for (const line of DOC.split("\n")) {
  const match =
    /^\|\s*([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)\s*\|\s*([^|]+?)\s*\|\s*(@sporta\/[a-z-]+)\s*\|\s*(machine|human|accounting)\s*\|\s*(true|false)\s*\|\s*([^|]+?)\s*\|\s*$/.exec(
      line,
    );
  if (match === null) continue;
  gateRows.push({
    gateId: match[1]!,
    name: match[2]!,
    sourcePackage: match[3]!,
    role: match[4]!,
    blocking: match[5]!,
    description: match[6]!,
  });
}

/** One parsed §4 seam row (the 3-column seam table). */
interface DocSeamRow {
  readonly gateId: string;
  readonly packageName: string;
  readonly exportName: string;
}

const seamRows: DocSeamRow[] = [];
for (const line of DOC.split("\n")) {
  const match =
    /^\|\s*([a-z][a-z0-9-]*)\s*\|\s*(@sporta\/[a-z-]+)\s*\|\s*([A-Za-z_][A-Za-z0-9_]*)\s*\|\s*$/.exec(
      line,
    );
  if (match === null) continue;
  seamRows.push({ gateId: match[1]!, packageName: match[2]!, exportName: match[3]! });
}

/** The §1 identity table's values (field → value). */
const identityRows = new Map<string, string>();
for (const line of DOC.split("\n")) {
  const match = /^\|\s*(policy id|gate count)\s*\|\s*([^|]+?)\s*\|\s*$/.exec(line);
  if (match === null) continue;
  identityRows.set(match[1]!, match[2]!);
}

/** The policy rows flattened to the doc row shape (order preserved). */
const policyAsDocRows: DocGateRow[] = GATE_POLICY.gates.map((entry) => ({
  gateId: entry.gateId,
  name: entry.name,
  sourcePackage: entry.sourcePackage,
  role: entry.role,
  blocking: String(entry.blocking),
  description: entry.description,
}));

/** The policy's seams flattened (order preserved). */
const policySeams = GATE_POLICY.gates.flatMap((entry) =>
  entry.seams.map((seam) => ({
    gateId: entry.gateId,
    packageName: seam.packageName,
    exportName: seam.exportName,
  })),
);

/** The module map for seam resolution (the self package resolves to this package's own surface). */
function moduleFor(packageName: string): Record<string, unknown> {
  if (packageName === "@sporta/renderer-evaluation") return rendererEvaluation;
  if (packageName === "@sporta/scene-evaluation") return sceneEvaluation;
  if (packageName === "@sporta/quality-gates") return self;
  throw new Error(`test bug: unknown seam package ${packageName}`);
}

describe("GATES.md §1 mirrors GATE_POLICY (row-for-row, order-preserving, both directions)", () => {
  test("the identity table mirrors the policy id and gate count", () => {
    expect(identityRows.get("policy id")).toBe(GATE_POLICY_ID);
    expect(identityRows.get("policy id")).toBe(GATE_POLICY.policyId);
    expect(identityRows.get("gate count")).toBe(String(GATE_POLICY.gates.length));
  });

  test("the gate table's row count and order match the policy exactly", () => {
    expect(gateRows).toHaveLength(4);
    expect(GATE_POLICY.gates).toHaveLength(4);
    expect(gateRows).toEqual(policyAsDocRows);
  });

  test("every policy gate appears in the document (both directions, via the row-for-row equality)", () => {
    const documented = new Set(gateRows.map((row) => row.gateId));
    for (const entry of GATE_POLICY.gates) {
      expect(documented.has(entry.gateId), `gate ${entry.gateId} missing from GATES.md §1`).toBe(
        true,
      );
    }
    const coded = new Set(GATE_POLICY.gates.map((entry) => entry.gateId));
    for (const row of gateRows) {
      expect(coded.has(row.gateId), `GATES.md §1 row ${row.gateId} is not a policy gate`).toBe(
        true,
      );
    }
  });

  test("the canonical gate ids are the W803 accept criterion's three gates plus the ledger", () => {
    expect(GATE_POLICY.gates.map((entry) => entry.gateId)).toEqual([
      "temporal-stability",
      "scene-correctness",
      "human-quality-checks",
      "accounting",
    ]);
    expect(GATE_POLICY.gates.map((entry) => entry.role)).toEqual([
      "machine",
      "machine",
      "human",
      "accounting",
    ]);
    expect(GATE_POLICY.gates.every((entry) => entry.blocking)).toBe(true);
  });
});

describe("GATES.md §4 mirrors the policy seams (row-for-row, both directions)", () => {
  test("the seam table's rows match the policy's flattened seams exactly", () => {
    expect(seamRows).toHaveLength(10);
    expect(seamRows).toEqual(policySeams);
  });

  test("every seam exists as a real importable export (fail-closed against dangling references)", () => {
    for (const seam of policySeams) {
      const module = moduleFor(seam.packageName);
      const resolved = module[seam.exportName];
      expect(
        resolved,
        `seam ${seam.packageName}#${seam.exportName} (gate ${seam.gateId}) does not exist — the policy names machinery that is not there`,
      ).toBeDefined();
    }
  });
});

describe("the policy invariants (fail-loud on every evaluation)", () => {
  test("the canonical policy passes its own invariants", () => {
    expect(() => assertGatePolicyInvariants(GATE_POLICY)).not.toThrow();
  });

  /** Clones the canonical policy with one gate row overridden. */
  function withGate(override: Partial<GatePolicyEntry>, gateId: string): GatePolicyDocument {
    return {
      policyId: "test-policy@1",
      gates: GATE_POLICY.gates.map((entry) =>
        entry.gateId === gateId ? { ...entry, ...override } : entry,
      ),
    };
  }

  test("duplicate gate ids are policy-malformed", () => {
    const duplicated: GatePolicyDocument = {
      policyId: "test-policy@1",
      gates: [...GATE_POLICY.gates, GATE_POLICY.gates[0]!],
    };
    expect(() => assertGatePolicyInvariants(duplicated)).toThrow(QualityGateError);
    try {
      assertGatePolicyInvariants(duplicated);
    } catch (error) {
      expect((error as QualityGateError).code).toBe("policy-malformed");
    }
  });

  test("a second accounting gate is policy-malformed", () => {
    const twoLedgers: GatePolicyDocument = {
      policyId: "test-policy@1",
      gates: [...GATE_POLICY.gates, { ...GATE_POLICY.gates[3]!, gateId: "accounting-2" }],
    };
    expect(() => assertGatePolicyInvariants(twoLedgers)).toThrow(QualityGateError);
  });

  test("an advisory human gate is policy-malformed (a waivable human review defeats W803)", () => {
    const advisory = withGate({ blocking: false }, "human-quality-checks");
    expect(() => assertGatePolicyInvariants(advisory)).toThrow(QualityGateError);
    try {
      assertGatePolicyInvariants(advisory);
    } catch (error) {
      expect((error as QualityGateError).code).toBe("policy-malformed");
      expect((error as QualityGateError).path).toBe("$.gates[2].blocking");
    }
  });

  test("a policy with no machine gate is policy-malformed (a vacuous suite)", () => {
    const humanOnly: GatePolicyDocument = {
      policyId: "test-policy@1",
      gates: [GATE_POLICY.gates[2]!, GATE_POLICY.gates[3]!],
    };
    expect(() => assertGatePolicyInvariants(humanOnly)).toThrow(QualityGateError);
  });

  test("an empty or non-document policy is policy-malformed", () => {
    expect(() => assertGatePolicyInvariants({ policyId: "x@1", gates: [] })).toThrow(
      QualityGateError,
    );
    expect(() =>
      assertGatePolicyInvariants({ policyId: "x@1", gates: [null as unknown as GatePolicyEntry] }),
    ).toThrow(QualityGateError);
    expect(() => assertGatePolicyInvariants(null as unknown as GatePolicyDocument)).toThrow(
      QualityGateError,
    );
  });

  test("the accounting check id vocabulary is closed and mirrored by the accounting module", () => {
    expect(ACCOUNTING_CHECK_IDS).toEqual([
      "row-count",
      "gate-set",
      "verdict-vocabulary",
      "count-reconciliation",
    ]);
    expect(DOC).toContain("| row-count |");
    expect(DOC).toContain("| gate-set |");
    expect(DOC).toContain("| verdict-vocabulary |");
    expect(DOC).toContain("| count-reconciliation |");
  });
});
