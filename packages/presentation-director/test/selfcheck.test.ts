/**
 * The self-check harness tests: every documented invariant has a negative
 * fixture proving detection (the `checkCameraPlan` posture — fail-soft
 * violations with stable ids, never a silent pass).
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PRESENTATION_POLICY,
  checkPresentationPlan,
  present,
  type PresentationPlan,
} from "../src/index";
import { buildPresentationCandidates, buildPresentationMatch } from "./helpers";

const STEPS = buildPresentationMatch();
const CANDIDATES = buildPresentationCandidates();

/** A deep clone of the canonical plan (mutated per negative fixture). */
function clonedPlan(): PresentationPlan {
  return JSON.parse(
    JSON.stringify(present(DEFAULT_PRESENTATION_POLICY, STEPS, CANDIDATES)),
  ) as PresentationPlan;
}

function violationsOf(plan: unknown): string[] {
  return checkPresentationPlan(plan, STEPS, DEFAULT_PRESENTATION_POLICY).violations;
}

describe("plan-shape", () => {
  test("a non-object plan is refused", () => {
    const result = checkPresentationPlan(null, STEPS);
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("plan-shape: plan:");
  });

  test("an empty windows array is refused", () => {
    const plan = clonedPlan();
    (plan as { windows: unknown[] }).windows = [];
    expect(violationsOf(plan).some((v) => v.startsWith("plan-shape: plan.windows"))).toBe(true);
  });

  test("a gap-free index order is enforced", () => {
    const plan = clonedPlan();
    plan.windows[1]!.index = 7;
    expect(
      violationsOf(plan).some((v) =>
        v.startsWith("plan-shape: windows[1].index: must be 1"),
      ),
    ).toBe(true);
  });
});

describe("camera-plan-wrapped (delegated to the W604 harness + 1:1 alignment)", () => {
  test("a corrupted embedded camera plan is caught by the W604 harness itself", () => {
    const plan = clonedPlan();
    plan.cameraPlan.windows[0]!.cameraSlotId = "not-a-slot";
    expect(
      violationsOf(plan).some((v) => v.startsWith("camera-plan-wrapped: plan.cameraPlan:")),
    ).toBe(true);
  });

  test("a presentation window dropped breaks the 1:1 alignment", () => {
    const plan = clonedPlan();
    plan.windows.pop();
    expect(
      violationsOf(plan).some((v) => v.includes("must align 1:1 with the camera plan's windows")),
    ).toBe(true);
  });
});

describe("one-selection-per-window", () => {
  test("an out-of-vocabulary presentation kind is refused", () => {
    const plan = clonedPlan();
    (plan.windows[0] as { presentationKind: string }).presentationKind = "dolly-zoom";
    expect(
      violationsOf(plan).some((v) =>
        v.startsWith("one-selection-per-window: windows[0].presentationKind"),
      ),
    ).toBe(true);
  });

  test("an out-of-vocabulary classification rule is refused", () => {
    const plan = clonedPlan();
    (plan.windows[0]!.decision as { ruleId: string }).ruleId = "vibes";
    expect(
      violationsOf(plan).some((v) =>
        v.startsWith("one-selection-per-window: windows[0].decision.ruleId"),
      ),
    ).toBe(true);
  });

  test("missing decision inputs are refused", () => {
    const plan = clonedPlan();
    (plan.windows[0]!.decision as { inputs: unknown }).inputs = undefined;
    expect(
      violationsOf(plan).some((v) =>
        v.startsWith("one-selection-per-window: windows[0].decision.inputs"),
      ),
    ).toBe(true);
  });
});

describe("every-window-traced", () => {
  test("an out-of-range importance weight is refused", () => {
    const plan = clonedPlan();
    (plan.windows[1]!.importanceTrace.importance as { weight: number }).weight = 5;
    const violations = violationsOf(plan);
    expect(
      violations.some((v) => v.includes("windows[1].importanceTrace.importance.weight")),
    ).toBe(true);
  });

  test("an in-range but WRONG baseline weight is refused by policy-consistency", () => {
    const plan = clonedPlan();
    (plan.windows[1]!.importanceTrace.importance as { weight: number }).weight = 0.9;
    const violations = violationsOf(plan);
    expect(
      violations.some((v) =>
        v.startsWith("policy-consistency: windows[1].importanceTrace.importance.weight"),
      ),
    ).toBe(true);
    expect(
      violations.some((v) =>
        v.startsWith("policy-consistency: windows[1].importanceTrace.combinedScore"),
      ),
    ).toBe(true);
  });

  test("an event-driven window whose trace lost the candidate is refused", () => {
    const plan = clonedPlan();
    (plan.windows[2]!.importanceTrace.semantics as { candidateId: string }).candidateId = "ec-9";
    expect(
      violationsOf(plan).some((v) =>
        v.includes('disagrees with the camera decision\'s verbatim candidate "ec-2"'),
      ),
    ).toBe(true);
  });

  test("a possession window falsely tracing to an event is refused", () => {
    const plan = clonedPlan();
    plan.windows[1]!.importanceTrace.importance = {
      source: "event-rule",
      eventType: "goal",
      ruleIndex: 0,
      weight: 1,
    };
    plan.windows[1]!.importanceTrace.semantics = {
      source: "candidate",
      candidateId: "ec-2",
      eventPhrase: "GOAL",
      emphasis: 1,
      confidence: 0.9,
      score: 0.48,
    };
    expect(
      violationsOf(plan).some((v) =>
        v.includes("must trace to the declared baseline"),
      ),
    ).toBe(true);
  });

  test("a tampered verbatim field (emphasis) is refused", () => {
    const plan = clonedPlan();
    (plan.windows[2]!.importanceTrace.semantics as { emphasis: number }).emphasis = 0.11;
    expect(
      violationsOf(plan).some((v) =>
        v.includes("disagrees with the camera decision's verbatim emphasis"),
      ),
    ).toBe(true);
  });

  test("a missing eventPhrase (the verbatim text) is refused", () => {
    const plan = clonedPlan();
    delete (plan.windows[2]!.importanceTrace.semantics as { eventPhrase?: string }).eventPhrase;
    expect(
      violationsOf(plan).some((v) =>
        v.includes("must carry the candidate's verbatim matched text span"),
      ),
    ).toBe(true);
  });
});

describe("policy-consistency (the traced values recompute from the policy)", () => {
  test("a drifted combined score is refused", () => {
    const plan = clonedPlan();
    (plan.windows[2]!.importanceTrace as { combinedScore: number }).combinedScore = 0.99;
    expect(
      violationsOf(plan).some((v) =>
        v.startsWith("policy-consistency: windows[2].importanceTrace.combinedScore"),
      ),
    ).toBe(true);
  });

  test("a mis-classified presentation kind is refused", () => {
    const plan = clonedPlan();
    (plan.windows[2] as { presentationKind: string }).presentationKind = "wide";
    expect(
      violationsOf(plan).some((v) =>
        v.startsWith("policy-consistency: windows[2].presentationKind"),
      ),
    ).toBe(true);
  });

  test("a traced weight that disagrees with its policy row is refused", () => {
    const plan = clonedPlan();
    (plan.windows[0]!.importanceTrace.importance as { weight: number }).weight = 0.99;
    expect(
      violationsOf(plan).some((v) =>
        v.startsWith("policy-consistency: windows[0].importanceTrace.importance.weight"),
      ),
    ).toBe(true);
  });
});

describe("accounting-reconciled", () => {
  test("a dropped candidate scoring entry breaks the mirror", () => {
    const plan = clonedPlan();
    plan.summary.candidateScoring.pop();
    expect(
      violationsOf(plan).some((v) => v.includes("must mirror the wrapped accounting's")),
    ).toBe(true);
  });

  test("a tampered outcome is refused (must ride verbatim)", () => {
    const plan = clonedPlan();
    (plan.summary.candidateScoring[3] as { outcome: string }).outcome = "governed";
    expect(
      violationsOf(plan).some((v) =>
        v.includes("disagrees with the wrapped accounting entry's verbatim outcome"),
      ),
    ).toBe(true);
  });

  test("a bogus droveWindowIndices entry is refused", () => {
    const plan = clonedPlan();
    plan.summary.candidateScoring[3]!.droveWindowIndices = [99];
    expect(
      violationsOf(plan).some((v) =>
        v.includes("99 is not a valid window index"),
      ),
    ).toBe(true);
  });

  test("a window index whose camera decision cites ANOTHER candidate is refused", () => {
    const plan = clonedPlan();
    plan.summary.candidateScoring[3]!.droveWindowIndices = [2];
    expect(
      violationsOf(plan).some((v) =>
        v.includes(`cites "ec-2", not "ec-4"`),
      ),
    ).toBe(true);
  });

  test("a drifted presentation count is refused", () => {
    const plan = clonedPlan();
    plan.summary.presentationCounts.liveFollow = 5;
    expect(
      violationsOf(plan).some((v) =>
        v.startsWith("accounting-reconciled: plan.summary.presentationCounts.liveFollow"),
      ),
    ).toBe(true);
  });

  test("a drifted cameraSummary quote is refused", () => {
    const plan = clonedPlan();
    (plan.summary.cameraSummary as { cutCount: number }).cutCount = 99;
    expect(
      violationsOf(plan).some((v) =>
        v.startsWith("accounting-reconciled: plan.summary.cameraSummary.cutCount"),
      ),
    ).toBe(true);
  });
});

describe("the harness is pure (never mutates the plan)", () => {
  test("checking twice yields identical violations and an untouched plan", () => {
    const plan = clonedPlan();
    const before = JSON.stringify(plan);
    const first = checkPresentationPlan(plan, STEPS, DEFAULT_PRESENTATION_POLICY);
    const second = checkPresentationPlan(plan, STEPS, DEFAULT_PRESENTATION_POLICY);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(plan)).toBe(before);
  });
});
