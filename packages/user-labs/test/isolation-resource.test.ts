/**
 * REL-027 — RESOURCE ISOLATION: one tenant's quota exhaustion never
 * degrades another's capability responses.
 *
 * The quota is the lab BUDGET (the gate, not a hope): a run request whose
 * estimate crosses the remaining budget is a typed `budget-exceeded`
 * refusal carrying the numbers. The acceptance-grade invariants:
 *
 * - tenant A's exhausted lab refuses its OWN runs (typed, with numbers);
 * - tenant B's lab — over the SAME harness, the SAME source-data port and
 *   the SAME scripted run port — keeps full capability: domain selection,
 *   source selection, budget, run requests and candidate production all
 *   answer normally;
 * - A's OTHER lab (its own budget) keeps full capability too: quota is
 *   per-lab, never per-tenant-process;
 * - the exhaustion never mutates the shared fixture state silently: the
 *   refusals carry the exact remaining-budget numbers.
 */
import { describe, expect, test } from "bun:test";
import { completeCandidatePayload, createHarness } from "./fixtures";
import { tenantA, tenantB } from "./fixtures";
import type { Harness } from "./fixtures";
import type { LabRunOutcome } from "../src";

/** The refusal arm of the run outcome (discriminated locally — the exported vocabulary). */
type LabRunRefused = Extract<LabRunOutcome, { outcome: "refused" }>;

/** Creates a configured, budgeted lab owned by `tenant`. */
async function budgetedLab(
  harness: Harness,
  tenant: { tenantId: string },
  totalUsd: number,
): Promise<string> {
  const lab = await harness.labs.createLab(tenant, { name: `Lab of ${tenant.tenantId}` });
  await harness.labs.chooseDomainAndTask(tenant, lab.labId, {
    domainPackId: "football",
    task: "match",
  });
  await harness.labs.selectSourceData(tenant, lab.labId, ["src-licensed-1"]);
  await harness.labs.setBudget(tenant, lab.labId, { totalUsd });
  return lab.labId;
}

describe("one tenant's quota exhaustion never degrades another's responses", () => {
  test("tenant A's exhausted lab refuses typed; tenant B's lab runs the same request fine", async () => {
    const harness = createHarness();
    const labA = await budgetedLab(harness, tenantA, 20);
    const labB = await budgetedLab(harness, tenantB, 20);

    // Exhaust tenant A's budget: one run of 12 (8 remains), then a request
    // that crosses the remaining 8. The refused request never reaches the
    // run port (the budget check fires first) — so nothing is scripted for
    // it; the refusal is a pure typed record.
    harness.runFixture.queue({ status: "completed", costUsd: 12 });
    const firstA = await harness.labs.requestRun(tenantA, labA, {
      purpose: "search",
      estimatedCostUsd: 12,
      configuration: { seed: "seed-a1", iterations: 3 },
    });
    expect(firstA.outcome).toBe("requested");
    const secondA = await harness.labs.requestRun(tenantA, labA, {
      purpose: "search",
      estimatedCostUsd: 12, // crosses the 8 remaining
      configuration: { seed: "seed-a2", iterations: 3 },
    });
    expect(secondA.outcome).toBe("refused");
    const refused = secondA as LabRunRefused;
    expect(refused.reason).toBe("budget-exceeded");
    expect(refused.message).toContain("12.00");
    expect(refused.message).toContain("8.00");

    // Tenant B's lab: the IDENTICAL request shape answers with full
    // capability — B's budget is B's own.
    harness.runFixture.queue({
      status: "completed",
      costUsd: 12,
      candidates: [completeCandidatePayload()],
    });
    const runB = await harness.labs.requestRun(tenantB, labB, {
      purpose: "search",
      estimatedCostUsd: 12,
      configuration: { seed: "seed-b1", iterations: 3 },
    });
    expect(runB.outcome).toBe("requested");
    if (runB.outcome === "requested") {
      expect(runB.candidates).toHaveLength(1);
      expect(runB.run.requestedBy.tenantId).toBe("tenant-b");
    }
  });

  test("tenant A's SECOND lab keeps full capability while the first is exhausted", async () => {
    const harness = createHarness();
    const labA1 = await budgetedLab(harness, tenantA, 10);
    const labA2 = await budgetedLab(harness, tenantA, 30);

    // Exhaust lab 1 exactly (10 of 10).
    harness.runFixture.queue({ status: "completed", costUsd: 10 });
    const first = await harness.labs.requestRun(tenantA, labA1, {
      purpose: "search",
      estimatedCostUsd: 10,
      configuration: { seed: "seed-1", iterations: 3 },
    });
    expect(first.outcome).toBe("requested");
    // The refused request never reaches the port — nothing scripted for it.
    const exhausted = await harness.labs.requestRun(tenantA, labA1, {
      purpose: "search",
      estimatedCostUsd: 1,
      configuration: { seed: "seed-2", iterations: 3 },
    });
    expect(exhausted.outcome).toBe("refused");
    expect((exhausted as LabRunRefused).reason).toBe("budget-exceeded");

    // Lab 2 (own budget): full capability — run + candidates.
    harness.runFixture.queue({
      status: "completed",
      costUsd: 25,
      candidates: [completeCandidatePayload()],
    });
    const run2 = await harness.labs.requestRun(tenantA, labA2, {
      purpose: "search",
      estimatedCostUsd: 25,
      configuration: { seed: "seed-3", iterations: 3 },
    });
    expect(run2.outcome).toBe("requested");
    if (run2.outcome === "requested") {
      expect(run2.candidates).toHaveLength(1);
      expect(run2.run.labId).toBe(labA2);
    }
  });

  test("the capability responses (domain/source/budget) of the OTHER tenant never degrade", async () => {
    const harness = createHarness();
    const labA = await budgetedLab(harness, tenantA, 5);
    const labB = await budgetedLab(harness, tenantB, 5);

    // Drain A to refusal: 5 of 5 spent, then even 1 USD crosses zero. The
    // refused request never reaches the port — nothing scripted for it.
    harness.runFixture.queue({ status: "completed", costUsd: 5 });
    const drain = await harness.labs.requestRun(tenantA, labA, {
      purpose: "search",
      estimatedCostUsd: 5,
      configuration: { seed: "seed-a", iterations: 3 },
    });
    expect(drain.outcome).toBe("requested");
    const refused = await harness.labs.requestRun(tenantA, labA, {
      purpose: "search",
      estimatedCostUsd: 1,
      configuration: { seed: "seed-a2", iterations: 3 },
    });
    expect((refused as LabRunRefused).reason).toBe("budget-exceeded");

    // B's capability responses are all still normal.
    const domain = await harness.labs.chooseDomainAndTask(tenantB, labB, {
      domainPackId: "football",
      task: "clip",
    });
    expect(domain.outcome).toBe("selected");
    const sources = await harness.labs.selectSourceData(tenantB, labB, ["src-licensed-2"]);
    expect(sources.outcome).toBe("selected");
    const budget = await harness.labs.setBudget(tenantB, labB, { totalUsd: 15 });
    expect(budget.outcome).toBe("set");
    // And B's lab list still shows exactly B's lab.
    const labs = await harness.labs.listLabs(tenantB);
    expect(labs.map((lab) => lab.labId)).toEqual([labB]);
  });
});
