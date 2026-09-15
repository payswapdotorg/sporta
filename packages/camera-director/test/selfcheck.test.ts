/**
 * The plan self-check harness (`src/selfcheck.ts` `checkCameraPlan`): the
 * W604 evaluation-readiness invariant set. The CANONICAL plan (live windows
 * + review) passes clean; every documented violation class has a NEGATIVE
 * FIXTURE proving detection with its stable id — the harness is fail-soft
 * (violations reported, never a throw) and pure (the plan is never
 * mutated). The composition's admission runs this same check, so these
 * ids are also the composed render's refusal reasons.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_DIRECTOR_POLICY } from "../src/policy";
import { direct } from "../src/direct";
import { checkCameraPlan } from "../src/selfcheck";
import type { CameraPlan } from "../src/types";
import { buildCandidate, buildDirectorMatch } from "./helpers";

/** The canonical directed plan (possession default + a goal + its review). */
function canonicalPlan(): CameraPlan {
  return direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
    buildCandidate({
      candidateId: "ec-1",
      eventTimeMs: 5_500,
      eventType: "goal",
      confidence: 0.86,
      emphasis: 0.9,
    }),
  ]);
}

/** A deep clone of the canonical plan (negative-fixture mutation base). */
function planClone(): CameraPlan {
  return JSON.parse(JSON.stringify(canonicalPlan())) as CameraPlan;
}

/** The violations of a mutated plan, filtered to one expected id. */
function violationsOf(plan: unknown, id: string): string[] {
  const result = checkCameraPlan(plan, buildDirectorMatch());
  const matched = result.violations.filter((violation) => violation.startsWith(`${id}:`));
  expect(matched.length).toBeGreaterThan(0);
  return matched;
}

describe("checkCameraPlan — the canonical plan passes clean", () => {
  test("the canonical plan (live + review) violates nothing", () => {
    const result = checkCameraPlan(canonicalPlan(), buildDirectorMatch());
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test("the no-event plan (pure possession default) also passes", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), []);
    expect(checkCameraPlan(plan, buildDirectorMatch()).ok).toBe(true);
  });

  test("the check is PURE: the plan is never mutated", () => {
    const plan = canonicalPlan();
    const before = JSON.stringify(plan);
    checkCameraPlan(plan, buildDirectorMatch());
    expect(JSON.stringify(plan)).toBe(before);
  });

  test("fail-soft: garbage input reports violations, never throws", () => {
    for (const garbage of [null, undefined, 42, "plan", [], [{}]]) {
      const result = checkCameraPlan(garbage, buildDirectorMatch());
      expect(result.ok).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    }
  });

  test("empty STEPS are a timeline-consistency violation (nothing to compose with)", () => {
    const result = checkCameraPlan(canonicalPlan(), []);
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toBe(
      "timeline-consistency: steps: must be a non-empty array of match steps",
    );
  });
});

describe("checkCameraPlan — negative fixtures per violation id", () => {
  test("plan-shape: not an object", () => {
    const result = checkCameraPlan("not a plan", buildDirectorMatch());
    expect(result.violations).toEqual(["plan-shape: plan: must be an object"]);
  });

  test("plan-shape: windows must be a non-empty array", () => {
    const plan = planClone();
    plan.windows = [];
    const result = checkCameraPlan(plan, buildDirectorMatch());
    expect(result.violations).toEqual(["plan-shape: plan.windows: must be a non-empty array"]);
  });

  test("plan-shape: a window must be a directed window record", () => {
    const plan = planClone();
    (plan.windows as unknown[])[1] = "window";
    const result = checkCameraPlan(plan, buildDirectorMatch());
    expect(
      result.violations.some(
        (violation) => violation === "plan-shape: windows[1]: must be a directed window record",
      ),
    ).toBe(true);
  });

  test("plan-shape: window indices must be gap-free rundown order", () => {
    const plan = planClone();
    plan.windows[1]!.index = 7;
    expect(violationsOf(plan, "plan-shape")).toEqual([
      "plan-shape: windows[1].index: must be 1 (gap-free rundown order)",
    ]);
  });

  test("plan-shape: source endMs must not precede startMs", () => {
    const plan = planClone();
    plan.windows[0]!.source = { startMs: 5_000, endMs: 3_000 };
    expect(violationsOf(plan, "plan-shape")).toEqual([
      "plan-shape: windows[0].source: endMs 3000 < startMs 5000",
    ]);
  });

  test("one-selection-per-window: the kind must be live or review", () => {
    const plan = planClone();
    (plan.windows[0] as { kind: string }).kind = "smash-cut";
    expect(violationsOf(plan, "one-selection-per-window")).toEqual([
      'one-selection-per-window: windows[0].kind: must be "live" or "review" (got smash-cut)',
    ]);
  });

  test("one-selection-per-window: the slot must be a CANONICAL slot (never an invented angle)", () => {
    const plan = planClone();
    plan.windows[0]!.cameraSlotId = "railcam";
    expect(violationsOf(plan, "one-selection-per-window")).toEqual([
      'one-selection-per-window: windows[0].cameraSlotId: "railcam" is not a canonical camera slot (never an invented angle)',
    ]);
  });

  test("boundaries-respected: window boundaries must be SNAPSHOT boundaries", () => {
    const plan = planClone();
    plan.windows[0]!.source = { startMs: 1_200, endMs: 5_000 };
    expect(violationsOf(plan, "boundaries-respected")).toEqual([
      "boundaries-respected: windows[0].source: boundaries [1200, 5000] must be snapshot boundaries (step atMs values)",
    ]);
  });

  test("live-tiling-total: the FIRST live window must start at the timeline start", () => {
    const plan = planClone();
    plan.windows[0]!.source = { startMs: 3_000, endMs: 5_000 };
    expect(violationsOf(plan, "live-tiling-total")).toContain(
      "live-tiling-total: windows[0].source.startMs: the first live window must start at the timeline start 1000 (got 3000)",
    );
  });

  test("live-tiling-total: the LAST live window must end at the timeline end", () => {
    const plan = planClone();
    plan.windows[1]!.source = { startMs: 5_000, endMs: 6_000 };
    expect(violationsOf(plan, "live-tiling-total")).toContain(
      "live-tiling-total: windows[last-live].source.endMs: the last live window must end at the timeline end 7000 (got 6000)",
    );
  });

  test("live-tiling-total: adjacent live windows must SHARE boundaries (no gap, no overlap)", () => {
    const plan = planClone();
    // Window 1 starts at 6000 while window 0 ends at 5000 → a gap.
    plan.windows[1]!.source = { startMs: 6_000, endMs: 7_000 };
    expect(violationsOf(plan, "live-tiling-total")).toContain(
      "live-tiling-total: windows[1].source.startMs: live tiling broken: previous window ends at 5000, this starts at 6000 (no gap, no overlap)",
    );
  });

  test("live-tiling-total: a non-last live window must not be degenerate", () => {
    const plan = planClone();
    // Squeeze window 0 to zero length (still tiling: 1000..1000, 1000..5000).
    plan.windows[0]!.source = { startMs: 1_000, endMs: 1_000 };
    plan.windows[1]!.source = { startMs: 1_000, endMs: 7_000 };
    plan.windows[2]!.source = { startMs: 3_000, endMs: 7_000 };
    expect(violationsOf(plan, "live-tiling-total")).toContain(
      "live-tiling-total: windows[0].source: non-last live window is degenerate [1000, 1000]",
    );
  });

  test("live-tiling-total: a plan with NO live window is refused (totality)", () => {
    const plan = planClone();
    for (const window of plan.windows) window.kind = "review";
    expect(violationsOf(plan, "live-tiling-total")).toContain(
      "live-tiling-total: plan.windows: the plan must carry at least one live window (totality)",
    );
  });

  test("review-within-timeline: a review range must lie INSIDE the match timeline", () => {
    const plan = planClone();
    plan.windows[2]!.source = { startMs: 0, endMs: 7_000 };
    expect(violationsOf(plan, "review-within-timeline")).toEqual([
      "review-within-timeline: windows[2].source: review range [0, 7000] lies outside the match timeline [1000, 7000]",
    ]);
    const plan2 = planClone();
    plan2.windows[2]!.source = { startMs: 3_000, endMs: 8_000 };
    expect(violationsOf(plan2, "review-within-timeline")).toEqual([
      "review-within-timeline: windows[2].source: review range [3000, 8000] lies outside the match timeline [1000, 7000]",
    ]);
  });

  test("decision-records: the ruleId must be a director rule", () => {
    const plan = planClone();
    (plan.windows[0]!.decision as { ruleId: string }).ruleId = "director-instinct";
    expect(violationsOf(plan, "decision-records")).toEqual([
      'decision-records: windows[0].decision.ruleId: "director-instinct" is not a director rule id',
    ]);
  });

  test("decision-records: event-driven rules must carry the verbatim candidate", () => {
    const plan = planClone();
    delete (plan.windows[1]!.decision as { event?: unknown }).event;
    expect(violationsOf(plan, "decision-records")).toEqual([
      "decision-records: windows[1].decision.event: event-driven rules must carry the verbatim candidate",
    ]);
  });

  test("decision-records: the verbatim candidate fields are shape-checked", () => {
    const plan = planClone();
    plan.windows[1]!.decision.event!.confidence = -0.5;
    expect(violationsOf(plan, "decision-records")).toEqual([
      "decision-records: windows[1].decision.event.confidence: must be a finite number >= 0 (verbatim)",
    ]);
    const plan2 = planClone();
    plan2.windows[1]!.decision.event!.candidateId = "";
    expect(violationsOf(plan2, "decision-records")).toEqual([
      "decision-records: windows[1].decision.event.candidateId: must be a non-empty string",
    ]);
  });

  test("decision-records: possession-follow decisions must carry the follow inputs", () => {
    const plan = planClone();
    delete (plan.windows[0]!.decision as { possession?: unknown }).possession;
    expect(violationsOf(plan, "decision-records")).toEqual([
      "decision-records: windows[0].decision.possession: possession-follow decisions must carry the follow inputs",
    ]);
  });

  test("timeline-consistency: the plan's declared timeline must equal the steps' span", () => {
    const plan = planClone();
    plan.timeline = { startMs: 1_000, endMs: 9_000 };
    expect(violationsOf(plan, "timeline-consistency")).toEqual([
      "timeline-consistency: plan.timeline: must equal the steps' atMs span [1000, 7000] (got [1000, 9000])",
    ]);
  });

  test("summary-consistency: the window counts must recompute exactly", () => {
    const plan = planClone();
    plan.summary.liveWindowCount = 5;
    expect(violationsOf(plan, "summary-consistency")).toEqual([
      "summary-consistency: plan.summary.liveWindowCount: must be 2",
    ]);
    const plan2 = planClone();
    plan2.summary.windowCount = 99;
    expect(violationsOf(plan2, "summary-consistency")).toEqual([
      "summary-consistency: plan.summary.windowCount: must be 3",
    ]);
  });

  test("summary-consistency: the CUT count must recompute (slot changes between adjacent windows)", () => {
    // The canonical plan cuts once (main-touchline → behind-goal-x105
    // between windows 0 and 1; the review repeats the goal slot).
    const plan = planClone();
    expect(plan.summary.cutCount).toBe(1);
    plan.summary.cutCount = 7;
    expect(violationsOf(plan, "summary-consistency")).toEqual([
      "summary-consistency: plan.summary.cutCount: must be 1 (slot changes between adjacent rundown windows)",
    ]);
    // A slot tamper that changes the REAL cut count flips the recomputed
    // value (the window count is unchanged — only cutCount catches it).
    const plan2 = planClone();
    plan2.windows[2]!.cameraSlotId = "aerial-tactical";
    expect(violationsOf(plan2, "summary-consistency")).toEqual([
      "summary-consistency: plan.summary.cutCount: must be 2 (slot changes between adjacent rundown windows)",
    ]);
  });

  test("summary-consistency: every accounting entry must be a well-formed record", () => {
    const plan = planClone();
    (plan.summary.eventAccounting as unknown[])[0] = "not an entry";
    expect(violationsOf(plan, "summary-consistency")).toEqual([
      "summary-consistency: plan.summary.eventAccounting[0]: must be an object",
      'summary-consistency: windows[1].decision.event.candidateId: "ec-1" is absent from the candidate accounting (every event-driven window must trace to an accounted candidate)',
      'summary-consistency: windows[2].decision.event.candidateId: "ec-1" is absent from the candidate accounting (every event-driven window must trace to an accounted candidate)',
    ]);
    const plan2 = planClone();
    (plan2.summary as { eventAccounting?: unknown }).eventAccounting = undefined;
    expect(violationsOf(plan2, "summary-consistency")).toEqual([
      "summary-consistency: plan.summary.eventAccounting: must be an array",
    ]);
    const plan3 = planClone();
    plan3.summary.eventAccounting[0]!.confidence = Number.NaN;
    expect(violationsOf(plan3, "summary-consistency")).toEqual([
      "summary-consistency: plan.summary.eventAccounting[0].confidence: must be a finite number >= 0 (verbatim)",
      "summary-consistency: windows[1].decision.event.confidence: 0.86 disagrees with the accounting entry (NaN) — the candidate must ride VERBATIM",
      "summary-consistency: windows[2].decision.event.confidence: 0.86 disagrees with the accounting entry (NaN) — the candidate must ride VERBATIM",
    ]);
  });

  test("summary-consistency: candidate ids in the accounting must be UNIQUE (exactly-once totality)", () => {
    const plan = planClone();
    plan.summary.eventAccounting.push({ ...plan.summary.eventAccounting[0]! });
    expect(violationsOf(plan, "summary-consistency")).toEqual([
      'summary-consistency: plan.summary.eventAccounting[1].candidateId: "ec-1" appears more than once (every input candidate appears exactly once)',
    ]);
  });

  test("summary-consistency: every event-driven window must trace to an ACCOUNTED, GOVERNED candidate", () => {
    // An event window citing a candidate the accounting disowns.
    const plan = planClone();
    plan.windows[1]!.decision.event!.candidateId = "ec-ghost";
    expect(violationsOf(plan, "summary-consistency")).toEqual([
      'summary-consistency: windows[1].decision.event.candidateId: "ec-ghost" is absent from the candidate accounting (every event-driven window must trace to an accounted candidate)',
    ]);
    // A window citing a candidate accounted as NOT governed (the focus
    // window AND its review both trace to the disowned candidate).
    const plan2 = planClone();
    plan2.summary.eventAccounting[0]!.outcome = "below-confidence";
    expect(violationsOf(plan2, "summary-consistency")).toEqual([
      'summary-consistency: windows[1].decision.event.candidateId: "ec-1" is accounted "below-confidence" — only a governed candidate may drive a window',
      'summary-consistency: windows[2].decision.event.candidateId: "ec-1" is accounted "below-confidence" — only a governed candidate may drive a window',
    ]);
    // A window whose candidate fields DISAGREE with the accounting entry
    // (the verbatim rule: the record must quote the accounted candidate).
    const plan3 = planClone();
    plan3.windows[2]!.decision.event!.emphasis = 0.1111;
    expect(violationsOf(plan3, "summary-consistency")).toEqual([
      "summary-consistency: windows[2].decision.event.emphasis: 0.1111 disagrees with the accounting entry (0.9) — the candidate must ride VERBATIM",
    ]);
  });

  test("summary-consistency: the canonical multi-event plans pass the accounting checks clean", () => {
    // All five outcomes at once, through the REAL director (the property
    // loop below also covers this — here the accounting itself is the
    // point: duplicates impossible, every window traceable).
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({ candidateId: "ec-1", eventTimeMs: 5_500, eventType: "goal" }),
      buildCandidate({ candidateId: "ec-2", eventTimeMs: 3_200, eventType: "shot" }),
      buildCandidate({ candidateId: "ec-3", eventTimeMs: 3_400, eventType: "goal" }),
      buildCandidate({ candidateId: "ec-4", eventTimeMs: 2_000, eventType: "pass" }),
      buildCandidate({
        candidateId: "ec-5",
        eventTimeMs: 1_500,
        eventType: "goal",
        confidence: 0.3,
      }),
      buildCandidate({ candidateId: "ec-6", eventTimeMs: 99_000, eventType: "save" }),
    ]);
    expect(checkCameraPlan(plan, buildDirectorMatch()).ok).toBe(true);
    expect(new Set(plan.summary.eventAccounting.map((e) => e.candidateId)).size).toBe(6);
  });
});

describe("checkCameraPlan — the harness runs against REAL director output (property loop)", () => {
  test("every plan the director produces over varied fixtures passes its own check", () => {
    const steps = buildDirectorMatch();
    const fixtures: Parameters<typeof direct>[2][] = [
      [],
      [
        buildCandidate({
          candidateId: "ec-1",
          eventTimeMs: 5_500,
          eventType: "goal",
          confidence: 0.86,
        }),
      ],
      [
        buildCandidate({
          candidateId: "ec-1",
          eventTimeMs: 7_000,
          eventType: "goal",
          confidence: 0.9,
        }),
      ],
      [
        buildCandidate({
          candidateId: "ec-a",
          eventTimeMs: 3_200,
          eventType: "shot",
          confidence: 0.7,
        }),
        buildCandidate({
          candidateId: "ec-b",
          eventTimeMs: 3_400,
          eventType: "goal",
          confidence: 0.8,
        }),
        buildCandidate({
          candidateId: "ec-c",
          eventTimeMs: 2_000,
          eventType: "pass",
          confidence: 0.9,
        }),
        buildCandidate({
          candidateId: "ec-d",
          eventTimeMs: 1_500,
          eventType: "goal",
          confidence: 0.3,
        }),
        buildCandidate({
          candidateId: "ec-e",
          eventTimeMs: 99_000,
          eventType: "goal",
          confidence: 0.9,
        }),
      ],
    ];
    for (const candidates of fixtures) {
      const plan = direct(DEFAULT_DIRECTOR_POLICY, steps, candidates);
      const result = checkCameraPlan(plan, steps);
      expect(result.violations).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });
});
