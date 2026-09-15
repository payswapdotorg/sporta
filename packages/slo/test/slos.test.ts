/**
 * The SLO-table tests: the formalized objectives' structural invariants, the
 * pinned equivalence with the W306 SLO CANDIDATES (the eval-harness case's
 * candidate-breach FAIL is therefore an SLO-objective breach gate by
 * construction), the deterministic frame-row derivation rule, and the
 * SLOs.md §2 doc pin (row-for-row, both directions — the W503 convention).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SLO_CANDIDATES } from "@sporta/latency-benchmark";
import {
  BASELINE_SOURCE,
  FRAME_HEADROOM_RULE,
  SLO_DEFINITIONS,
  SLO_SET_ID,
  assertSloTableInvariants,
  budgetFractionForMetric,
  frameTargetByRule,
  sloById,
} from "../src/slos";
import { SloTableInconsistentError } from "../src/errors";

const DOC: string = readFileSync(join(import.meta.dir, "..", "SLOs.md"), "utf8");

/** One row of the SLOs.md §2 table. */
interface DocSloRow {
  sloId: string;
  stage: string;
  metric: string;
  baselineMs: number;
  targetMs: number;
  budget: number;
}

/** Parses the §2 SLO table rows (rows whose first cell is a sloId). */
function parseDocSloRows(doc: string): DocSloRow[] {
  const rows: DocSloRow[] = [];
  for (const line of doc.split("\n")) {
    const match = /^\|\s*((?:batch|frame)\.[a-z0-9-]+\.[a-z0-9]+)\s*\|/.exec(line);
    if (match === null) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    // cells: ["", sloId, stage, metric, baseline, target, budget, derivation, ""]
    rows.push({
      sloId: cells[1]!,
      stage: cells[2]!,
      metric: cells[3]!,
      baselineMs: Number(cells[4]!.replace(/[^0-9.]/g, "")),
      targetMs: Number(cells[5]!.replace(/[^0-9.]/g, "")),
      budget: Number(cells[6]!.replace("%", "")) / 100,
    });
  }
  return rows;
}

describe("the SLO table's structural invariants", () => {
  test("16 objectives: 12 batch + 4 frame, unique ids", () => {
    assertSloTableInvariants();
    expect(SLO_DEFINITIONS).toHaveLength(16);
    expect(SLO_DEFINITIONS.filter((slo) => slo.scope === "batch")).toHaveLength(12);
    expect(SLO_DEFINITIONS.filter((slo) => slo.scope === "frame")).toHaveLength(4);
    expect(new Set(SLO_DEFINITIONS.map((slo) => slo.sloId)).size).toBe(16);
  });

  test("every budget is the exact percentile semantics", () => {
    for (const slo of SLO_DEFINITIONS) {
      expect(slo.allowedExceedanceFraction).toBe(budgetFractionForMetric(slo.metric));
      expect(slo.allowedExceedanceFraction).toBe(slo.metric === "p95" ? 0.05 : 0.5);
    }
  });

  test("every target sits strictly above its measured baseline (headroom)", () => {
    for (const slo of SLO_DEFINITIONS) {
      expect(slo.targetMs).toBeGreaterThan(slo.baselineMs);
    }
  });

  test("every row names the injected-clock domain and the evidence source", () => {
    for (const slo of SLO_DEFINITIONS) {
      expect(slo.unit).toBe("injected-clock-ms");
      expect(slo.derivation.length).toBeGreaterThan(20);
    }
    expect(BASELINE_SOURCE).toContain("w306-live-fixture");
    expect(SLO_SET_ID).toBe("w802-slo-v1");
  });

  test("sloById resolves every id and fails loud on unknowns", () => {
    for (const slo of SLO_DEFINITIONS) {
      expect(sloById(slo.sloId)).toBe(slo);
    }
    expect(() => sloById("batch.nonsense.p99")).toThrow(SloTableInconsistentError);
  });
});

describe("the batch objectives ≡ the W306 SLO candidates (the harness-gate pin)", () => {
  test("every candidate row equals the batch SLO target, metric for metric", () => {
    const byStageMetric = new Map(
      SLO_DEFINITIONS.map((slo) => [`${slo.scope}.${slo.stage}.${slo.metric}`, slo]),
    );
    expect(SLO_CANDIDATES).toHaveLength(12);
    for (const candidate of SLO_CANDIDATES) {
      const p50 = byStageMetric.get(`batch.${candidate.stage}.p50`);
      const p95 = byStageMetric.get(`batch.${candidate.stage}.p95`);
      expect(p50).toBeDefined();
      expect(p95).toBeDefined();
      expect(p50!.targetMs).toBe(candidate.p50TargetMs);
      expect(p95!.targetMs).toBe(candidate.p95TargetMs);
    }
  });

  test("no batch SLO exists beyond the candidate stages (both directions)", () => {
    const candidateStages = new Set(SLO_CANDIDATES.map((candidate) => candidate.stage));
    const batchStages = new Set(
      SLO_DEFINITIONS.filter((slo) => slo.scope === "batch").map((slo) => slo.stage),
    );
    expect(batchStages).toEqual(candidateStages);
  });
});

describe("the frame objectives' derivation rule (deterministic, recomputed)", () => {
  test("the rule constants are the documented ones", () => {
    expect(FRAME_HEADROOM_RULE).toEqual({ p50Multiplier: 1.25, p95Multiplier: 1.35, roundUpToMs: 500 });
  });

  test("every frame target equals the rule applied to its baseline", () => {
    for (const slo of SLO_DEFINITIONS.filter((slo) => slo.scope === "frame")) {
      expect(slo.targetMs).toBe(frameTargetByRule(slo.metric, slo.baselineMs));
    }
  });

  test("the rule rounds UP to the next 500 ms multiple (spot pins)", () => {
    expect(frameTargetByRule("p50", 2121)).toBe(3000); // 2651.25 → 3000
    expect(frameTargetByRule("p95", 4680)).toBe(6500); // 6318 → 6500
    expect(frameTargetByRule("p50", 3968)).toBe(5000); // 4960 → 5000
    expect(frameTargetByRule("p95", 9080)).toBe(12500); // 12258 → 12500
    expect(frameTargetByRule("p50", 4000)).toBe(5000); // exactly 5000 stays (>= rule)
  });
});

describe("SLOs.md §2 ↔ SLO_DEFINITIONS (the doc pin, both directions)", () => {
  const rows = parseDocSloRows(DOC);

  test("the document table is present and complete (16 rows)", () => {
    expect(rows).toHaveLength(16);
  });

  test("every document row matches the code row (stage, metric, baseline, target, budget)", () => {
    expect(rows.map((row) => row.sloId)).toEqual(SLO_DEFINITIONS.map((slo) => slo.sloId));
    for (const row of rows) {
      const slo = sloById(row.sloId);
      expect(row.stage).toBe(slo.stage);
      expect(row.metric).toBe(slo.metric);
      expect(row.baselineMs).toBe(slo.baselineMs);
      expect(row.targetMs).toBe(slo.targetMs);
      expect(row.budget).toBe(slo.allowedExceedanceFraction);
    }
  });

  test("every code row appears in the document (both directions)", () => {
    const documented = new Set(rows.map((row) => row.sloId));
    for (const slo of SLO_DEFINITIONS) {
      expect(documented.has(slo.sloId)).toBe(true);
    }
  });
});

describe("the invariants guard itself (mutation teeth)", () => {
  test("a knife-edge target (target === baseline) is rejected", () => {
    const original = SLO_DEFINITIONS[0]!;
    (SLO_DEFINITIONS as { [index: number]: { targetMs: number } })[0] = {
      ...original,
      targetMs: original.baselineMs,
    } as typeof original;
    try {
      expect(() => assertSloTableInvariants()).toThrow(SloTableInconsistentError);
    } finally {
      (SLO_DEFINITIONS as { [index: number]: typeof original })[0] = original;
    }
  });
});
