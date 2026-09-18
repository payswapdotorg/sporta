/**
 * The director tests: the pure `present` over the canonical fixture —
 * determinism (byte-identical), the wrapped camera plan VERBATIM, the
 * complete importance trace on every window, the presentation-kind
 * classification, the candidate scoring, and every fail-closed refusal.
 */
import { describe, expect, test } from "bun:test";
import { direct, DEFAULT_DIRECTOR_POLICY, DirectorError } from "@sporta/camera-director";
import {
  DEFAULT_PRESENTATION_POLICY,
  PresentationDirector,
  PresentationError,
  checkPresentationPlan,
  present,
  type PresentationPolicy,
} from "../src/index";
import {
  buildPresentationCandidates,
  buildPresentationMatch,
  buildCandidate,
} from "./helpers";

const STEPS = buildPresentationMatch();
const CANDIDATES = buildPresentationCandidates();

/** The canonical plan (built once per test group — deterministic anyway). */
function canonicalPlan() {
  return present(DEFAULT_PRESENTATION_POLICY, STEPS, CANDIDATES);
}

describe("determinism (the pinned contract)", () => {
  test("the same inputs yield a JSON-byte-identical plan", () => {
    const a = JSON.stringify(canonicalPlan());
    const b = JSON.stringify(canonicalPlan());
    expect(a).toBe(b);
  });

  test("the plan is JSON-round-trippable (no NaN, no undefined-only fields)", () => {
    expect(JSON.parse(JSON.stringify(canonicalPlan()))).toEqual(canonicalPlan());
  });
});

describe("the wrapped camera plan rides VERBATIM", () => {
  test("the embedded cameraPlan deep-equals the W604 director's own plan over the same inputs", () => {
    const plan = canonicalPlan();
    const cameraPlan = direct(DEFAULT_DIRECTOR_POLICY, STEPS, CANDIDATES);
    expect(plan.cameraPlan).toEqual(cameraPlan);
  });

  test("the presentation windows align 1:1 with the camera windows", () => {
    const plan = canonicalPlan();
    expect(plan.windows.length).toBe(plan.cameraPlan.windows.length);
    for (let i = 0; i < plan.windows.length; i += 1) {
      expect(plan.windows[i]!.index).toBe(plan.cameraPlan.windows[i]!.index);
    }
  });

  test("mutating the returned plan can never reach the wrapped seam's output", () => {
    const first = canonicalPlan();
    first.cameraPlan.windows[0]!.cameraSlotId = "aerial-tactical";
    const second = direct(DEFAULT_DIRECTOR_POLICY, STEPS, CANDIDATES);
    expect(second.windows[0]!.cameraSlotId).not.toBe("aerial-tactical");
  });
});

describe("presentation kinds classify from the wrapped plan's own fields", () => {
  test("every kind of the canonical fixture appears (wide, live-follow, tight, replay)", () => {
    const plan = canonicalPlan();
    expect(plan.windows.map((window) => window.presentationKind)).toEqual([
      "wide",
      "live-follow",
      "tight",
      "replay",
    ]);
    expect(plan.summary.presentationCounts).toEqual({ liveFollow: 1, replay: 1, wide: 1, tight: 1 });
    expect(plan.summary.presentationChangeCount).toBe(3);
  });

  test("the kickoff's event-focus window from main-touchline classifies wide", () => {
    const plan = canonicalPlan();
    const window = plan.windows[0]!;
    expect(window.decision.ruleId).toBe("event-framing");
    expect(window.decision.inputs).toEqual({
      planKind: "live",
      directorRuleId: "event-focus",
      cameraSlotId: "main-touchline",
      framing: "wide",
    });
  });

  test("the possession-follow window classifies live-follow", () => {
    const plan = canonicalPlan();
    const window = plan.windows[1]!;
    expect(window.presentationKind).toBe("live-follow");
    expect(window.decision.ruleId).toBe("possession-default");
    expect(window.decision.inputs.directorRuleId).toBe("possession-follow");
  });

  test("the goal's event-focus window from a behind-goal slot classifies tight", () => {
    const plan = canonicalPlan();
    const window = plan.windows[2]!;
    expect(window.presentationKind).toBe("tight");
    expect(window.decision.inputs.cameraSlotId).toBe("behind-goal-x105");
    expect(window.decision.inputs.framing).toBe("tight");
  });

  test("the goal's review window classifies replay", () => {
    const plan = canonicalPlan();
    const window = plan.windows[3]!;
    expect(window.presentationKind).toBe("replay");
    expect(window.decision.ruleId).toBe("review-window");
    expect(window.decision.inputs.planKind).toBe("review");
  });
});

describe("EVERY window's importance trace is complete", () => {
  test("event-driven windows trace to the event row AND the verbatim candidate", () => {
    const plan = canonicalPlan();
    const goalWindow = plan.windows[2]!;
    const trace = goalWindow.importanceTrace;
    expect(trace.importance).toEqual({
      source: "event-rule",
      eventType: "goal",
      ruleIndex: 0,
      weight: 1,
    });
    expect(trace.semantics.source).toBe("candidate");
    expect(trace.semantics.candidateId).toBe("ec-2");
    expect(trace.semantics.eventPhrase).toBe("GOAL!!! What a strike");
    expect(trace.semantics.emphasis).toBe(1);
    expect(trace.semantics.confidence).toBe(0.9);
    // The blend, recomputed by hand: 0.5·1 + 0.3·1 + 0.2·0.9 = 0.98.
    expect(trace.combinedScore).toBe(0.98);
    expect(trace.reason).toContain("goal row 0");
    expect(trace.reason).toContain("GOAL!!! What a strike");
  });

  test("possession-follow windows trace to the DECLARED baseline (never an invented event)", () => {
    const plan = canonicalPlan();
    const trace = plan.windows[1]!.importanceTrace;
    expect(trace.importance).toEqual({ source: "baseline", weight: 0.1 });
    expect(trace.semantics.source).toBe("baseline");
    // 0.5·0.1 + (0.3 + 0.2)·0.2 = 0.05 + 0.1 = 0.15.
    expect(trace.combinedScore).toBe(0.15);
    expect(trace.reason).toContain("routine-play baseline");
  });

  test("review windows trace to the same governing candidate as their focus window", () => {
    const plan = canonicalPlan();
    const replayTrace = plan.windows[3]!.importanceTrace;
    expect(replayTrace.importance.source).toBe("event-rule");
    expect(replayTrace.semantics.candidateId).toBe("ec-2");
    expect(replayTrace.combinedScore).toBe(0.98);
  });

  test("every window's combined score lies in [0, 1] and every reason is non-empty", () => {
    const plan = canonicalPlan();
    for (const window of plan.windows) {
      expect(window.importanceTrace.combinedScore).toBeGreaterThanOrEqual(0);
      expect(window.importanceTrace.combinedScore).toBeLessThanOrEqual(1);
      expect(window.importanceTrace.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("candidate scoring (total accounting)", () => {
  test("every candidate appears exactly once with verbatim fields + wrapped outcomes", () => {
    const plan = canonicalPlan();
    const scoring = plan.summary.candidateScoring;
    expect(scoring.map((entry) => entry.candidateId)).toEqual(["ec-1", "ec-2", "ec-3", "ec-4"]);
    const pass = scoring[3]!;
    expect(pass.eventType).toBe("pass");
    expect(pass.eventPhrase).toBe("a simple pass");
    expect(pass.outcome).toBe("no-rule");
    // The pass has an importance row (0.1): 0.5·0.1 + 0.3·0.2 + 0.2·0.7 = 0.25.
    expect(pass.combinedScore).toBe(0.25);
    expect(pass.droveWindowIndices).toEqual([]);
    const save = scoring[2]!;
    expect(save.outcome).toBe("below-confidence");
  });

  test("the goal candidate scored the windows it drove (focus + replay)", () => {
    const plan = canonicalPlan();
    const goal = plan.summary.candidateScoring[1]!;
    expect(goal.combinedScore).toBe(0.98);
    expect(goal.droveWindowIndices).toEqual([2, 3]);
  });

  test("an UNSCORED candidate (no importance row) is honest, never half-scored", () => {
    const policy: PresentationPolicy = JSON.parse(JSON.stringify(DEFAULT_PRESENTATION_POLICY));
    policy.eventImportance = policy.eventImportance.filter((row) => row.eventType !== "pass");
    const plan = present(policy, STEPS, CANDIDATES);
    const pass = plan.summary.candidateScoring[3]!;
    expect(pass.importanceWeight).toBeUndefined();
    expect(pass.semanticScore).toBeUndefined();
    expect(pass.combinedScore).toBeUndefined();
    expect(pass.outcome).toBe("no-rule");
  });
});

describe("fail-closed refusals (never a silent partial presentation)", () => {
  test("a plan whose slot has no framing row is refused (framing-gap)", () => {
    const policy: PresentationPolicy = JSON.parse(JSON.stringify(DEFAULT_PRESENTATION_POLICY));
    policy.framing = [{ slotId: "main-touchline", framing: "wide" }];
    try {
      present(policy, STEPS, CANDIDATES);
      throw new Error("unreachable: present should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationError);
      expect((error as PresentationError).kind).toBe("framing-gap");
      expect((error as PresentationError).details.slotId).toBe("behind-goal-x105");
    }
  });

  test("malformed steps surface the WRAPPED seam's own DirectorError verbatim", () => {
    try {
      present(DEFAULT_PRESENTATION_POLICY, [{ atMs: 1, scene: null }], CANDIDATES);
      throw new Error("unreachable: present should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(DirectorError);
    }
  });

  test("a non-array candidate stream is refused at the presentation layer", () => {
    try {
      present(DEFAULT_PRESENTATION_POLICY, STEPS, undefined as unknown as never);
      throw new Error("unreachable: present should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationError);
      expect((error as PresentationError).kind).toBe("candidates-invalid");
    }
  });
});

describe("the PresentationDirector class wrapper", () => {
  test("carries one validated policy; present is pure and deterministic", () => {
    const director = new PresentationDirector();
    const a = JSON.stringify(director.present(STEPS, CANDIDATES));
    const b = JSON.stringify(director.present(STEPS, CANDIDATES));
    expect(a).toBe(b);
    expect(JSON.parse(a!)).toEqual(canonicalPlan());
  });

  test("refuses an invalid policy at construction (never half-constructed)", () => {
    const policy: PresentationPolicy = JSON.parse(JSON.stringify(DEFAULT_PRESENTATION_POLICY));
    policy.semantics = { importanceWeight: 0.5, emphasisWeight: 0.4, confidenceWeight: 0.2 };
    expect(() => new PresentationDirector({ policy })).toThrow(PresentationError);
  });

  test("later mutations of the caller's policy document can never leak in", () => {
    const policy: PresentationPolicy = JSON.parse(JSON.stringify(DEFAULT_PRESENTATION_POLICY));
    const director = new PresentationDirector({ policy });
    policy.baselineImportance = 0.9;
    const plan = director.present(STEPS, CANDIDATES);
    const baselineWindow = plan.windows.find(
      (window) => window.importanceTrace.importance.source === "baseline",
    );
    expect(baselineWindow!.importanceTrace.importance.weight).toBe(0.1);
  });
});

describe("the self-check passes on the canonical plan (policy-consistent)", () => {
  test("checkPresentationPlan ok over the canonical plan + policy", () => {
    const result = checkPresentationPlan(canonicalPlan(), STEPS, DEFAULT_PRESENTATION_POLICY);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("the self-check is stable without the policy (structural checks only)", () => {
    const result = checkPresentationPlan(canonicalPlan(), STEPS);
    expect(result.ok).toBe(true);
  });
});

describe("the empty-candidate edge (a pure possession-follow presentation)", () => {
  test("a plan with no candidates traces every window to the baseline", () => {
    const plan = present(DEFAULT_PRESENTATION_POLICY, STEPS, []);
    expect(plan.summary.candidateScoring).toEqual([]);
    expect(plan.windows.length).toBeGreaterThan(0);
    for (const window of plan.windows) {
      expect(window.presentationKind).toBe("live-follow");
      expect(window.importanceTrace.importance.source).toBe("baseline");
    }
    expect(checkPresentationPlan(plan, STEPS, DEFAULT_PRESENTATION_POLICY).ok).toBe(true);
  });
});

describe("a governed save overrides the possession default (kind + trace)", () => {
  test("a confident save candidate drives a tight window + its replay", () => {
    const candidates = [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 3_500,
        eventType: "save",
        eventPhrase: "What a save!",
        emphasis: 0.8,
        confidence: 0.9,
      }),
    ];
    const plan = present(DEFAULT_PRESENTATION_POLICY, STEPS, candidates);
    const tight = plan.windows.find((window) => window.presentationKind === "tight");
    expect(tight).toBeDefined();
    // 0.5·0.8 + 0.3·0.8 + 0.2·0.9 = 0.4 + 0.24 + 0.18 = 0.82.
    expect(tight!.importanceTrace.combinedScore).toBe(0.82);
    expect(plan.summary.candidateScoring[0]!.outcome).toBe("governed");
    expect(checkPresentationPlan(plan, STEPS, DEFAULT_PRESENTATION_POLICY).ok).toBe(true);
  });
});
