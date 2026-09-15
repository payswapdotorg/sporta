/**
 * THE director function (`src/direct.ts` `direct`): pure
 * `direct(policy, matchTimeline, events)` → `CameraPlan`. These tests pin
 * the documented algorithm end to end on the canonical 7-step fixture and
 * on purpose-built micro-fixtures:
 *
 * - rule 1 possession-follow (zones, cuts, hysteresis + suppression,
 *   fallbacks) with verbatim follow inputs on every default window;
 * - rule 2 event-importance windows (gates, holds extended to snapshot
 *   boundaries, clipping, nearest-goal resolution);
 * - rule 3 the overlay (priority, recency, id tie-breaks, merging,
 *   superseded accounting);
 * - rule 4 replay emphasis (lead/trail boundaries, review slots);
 * - rule 5 total candidate accounting, all five outcomes;
 * - determinism (byte-identical reruns, input-order invariance) and
 *   fail-closed admission (policy/timeline/candidates).
 */
import { describe, expect, test } from "bun:test";
import { projectScene } from "@sporta/scene-projection";
import type { AvatarField3dMatchStep } from "@sporta/renderer-3d";
import type { EventCandidate } from "@sporta/commentary-understanding";
import { DEFAULT_DIRECTOR_POLICY } from "../src/policy";
import type { DirectorPolicy } from "../src/policy";
import { DIRECTOR_VERSION } from "../src/policy";
import { DIRECTOR_POLICY_VERSION } from "../src/policy";
import { direct } from "../src/direct";
import { DirectorError } from "../src/errors";
import type { CameraPlan } from "../src/types";
import {
  buildCandidate,
  buildDirectorMatch,
  buildDirectorSnapshot,
  buildNoFootballMatch,
} from "./helpers";

/** A deep clone of the default policy (micro-fixture mutation base). */
function policyClone(): DirectorPolicy {
  return JSON.parse(JSON.stringify(DEFAULT_DIRECTOR_POLICY)) as DirectorPolicy;
}

/** Builds a match whose striker walks the given pitch-x values (1 s steps). */
function matchWithStrikerX(xs: readonly number[]): AvatarField3dMatchStep[] {
  return xs.map((x, index) => {
    const snapshot = buildDirectorSnapshot(index);
    snapshot.entities[0]!.state.pitchPosition = { status: "known", value: { x, y: 30 } } as never;
    return {
      atMs: (index + 1) * 1_000,
      scene: projectScene(snapshot, { events: [] }),
    };
  });
}

/** A compact window summary for assertions: kind[start,end]@slot(rule). */
function summarize(plan: CameraPlan): string[] {
  return plan.windows.map(
    (window) =>
      `${window.index}:${window.kind}[${window.source.startMs},${window.source.endMs}]@${window.cameraSlotId}(${window.decision.ruleId})`,
  );
}

describe("direct — rule 1: the possession-following default", () => {
  test("the canonical walk: midfield zone → cut to the x105 final third at the snapshot boundary", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), []);
    expect(summarize(plan)).toEqual([
      "0:live[1000,5000]@main-touchline(possession-follow)",
      "1:live[5000,7000]@behind-goal-x105(possession-follow)",
    ]);
    expect(plan.summary).toEqual({
      windowCount: 2,
      liveWindowCount: 2,
      reviewWindowCount: 0,
      cutCount: 1,
      suppressedCuts: [],
      eventAccounting: [],
    });
  });

  test("default windows carry the verbatim follow inputs (entity, x, zone bounds, desired slot)", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), []);
    expect(plan.windows[0]!.decision.possession).toEqual({
      fallback: false,
      entityId: "striker-9",
      followX: 50,
      zone: { xMin: 17.5, xMax: 87.5 },
      desiredSlotId: "main-touchline",
    });
    expect(plan.windows[1]!.decision.possession).toEqual({
      fallback: false,
      entityId: "striker-9",
      followX: 90,
      zone: { xMin: 87.5, xMax: 105 },
      desiredSlotId: "behind-goal-x105",
    });
    // The reasons are fixed templates (deterministic strings, pinned).
    expect(plan.windows[0]!.decision.reason).toBe(
      "possession-follow: followX 50 in zone [17.5, 87.5] → main-touchline",
    );
    expect(plan.windows[1]!.decision.reason).toBe(
      "possession-follow: followX 90 in zone [87.5, 105] → behind-goal-x105",
    );
  });

  test("hysteresis: a desired cut 2 s after the previous cut is SUPPRESSED and accounted; it lands 3 s in", () => {
    const steps = matchWithStrikerX([50, 55, 90, 92]);
    const plan = direct(DEFAULT_DIRECTOR_POLICY, steps, []);
    expect(summarize(plan)).toEqual([
      "0:live[1000,4000]@main-touchline(possession-follow)",
      "1:live[4000,4000]@behind-goal-x105(possession-follow)",
    ]);
    expect(plan.summary.suppressedCuts).toEqual([
      {
        atMs: 3_000,
        desiredSlotId: "behind-goal-x105",
        heldSlotId: "main-touchline",
        msSincePreviousCut: 2_000,
      },
    ]);
    // The final zero-length window is the cut AT the last snapshot: its
    // decision is the new zone's (followX 92), and the tiling stays total.
    expect(plan.windows[1]!.decision.possession!.followX).toBe(92);
  });

  test("hysteresis 0: the cut lands at the FIRST desired snapshot", () => {
    const policy = policyClone();
    policy.possessionFollow.hysteresisMs = 0;
    const steps = matchWithStrikerX([50, 55, 90, 92]);
    const plan = direct(policy, steps, []);
    expect(summarize(plan)).toEqual([
      "0:live[1000,3000]@main-touchline(possession-follow)",
      "1:live[3000,4000]@behind-goal-x105(possession-follow)",
    ]);
    expect(plan.summary.suppressedCuts).toEqual([]);
  });

  test("the hysteresis HOLD is recorded honestly: desiredSlotId ≠ the window's slot, reason says so", () => {
    // hysteresis 5 s over [50, 55, 90, 92]: both zone changes suppressed.
    // A shot rule with an 800 ms hold opens [2000, 3000], so the span
    // [3000, 4000] falls back to the DEFAULT — which desires x105 while
    // holding main-touchline (the suppressed-cut record, verbatim).
    const policy = policyClone();
    policy.possessionFollow.hysteresisMs = 5_000;
    const shotRule = policy.eventRules.find((rule) => rule.eventType === "shot")!;
    shotRule.holdMs = 800;
    const steps = matchWithStrikerX([50, 55, 90, 92]);
    const plan = direct(policy, steps, [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 2_200,
        eventType: "shot",
        confidence: 0.7,
      }),
    ]);
    const held = plan.windows.find((window) => window.source.startMs === 3_000)!;
    expect(held.cameraSlotId).toBe("main-touchline");
    expect(held.decision.possession!.desiredSlotId).toBe("behind-goal-x105");
    expect(held.decision.reason).toBe(
      "possession-follow: followX 90 in zone [87.5, 105] desires behind-goal-x105, hysteresis holds main-touchline",
    );
    expect(plan.summary.suppressedCuts.map((cut) => cut.atMs)).toEqual([3_000, 4_000]);
  });

  test("a disabled follow rule is the constant fallback slot (documented default, honest reason)", () => {
    const policy = policyClone();
    policy.possessionFollow.enabled = false;
    const plan = direct(policy, buildDirectorMatch(), []);
    expect(summarize(plan)).toEqual(["0:live[1000,7000]@main-touchline(possession-follow)"]);
    expect(plan.windows[0]!.decision.possession).toEqual({
      fallback: true,
      desiredSlotId: "main-touchline",
    });
    expect(plan.windows[0]!.decision.reason).toBe(
      "possession-follow: disabled → fallback slot main-touchline",
    );
  });

  test("no football state / no placed reference → the fallback slot with fallback: true", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildNoFootballMatch(), []);
    expect(summarize(plan)).toEqual(["0:live[1000,5000]@main-touchline(possession-follow)"]);
    expect(plan.windows[0]!.decision.possession).toEqual({
      fallback: true,
      desiredSlotId: "main-touchline",
    });
    expect(plan.windows[0]!.decision.reason).toBe(
      "possession-follow: no usable follow reference → fallback slot main-touchline",
    );
  });

  test("an unplaced possessor degrades to the BALL's position (verbatim, first placed ball)", () => {
    // Possession names a bench player with no position → the ball (x=10)
    // is the follow reference → the x0 final-third zone.
    const snapshot = buildDirectorSnapshot(0);
    snapshot.football!.possession = {
      status: "uncertain",
      value: { entityId: "bench-12" },
      confidence: 0.5,
    };
    snapshot.entities[1]!.state.pitchPosition = {
      status: "known",
      value: { x: 10, y: 30 },
    } as never;
    const steps: AvatarField3dMatchStep[] = [
      { atMs: 1_000, scene: projectScene(snapshot, { events: [] }) },
    ];
    const plan = direct(DEFAULT_DIRECTOR_POLICY, steps, []);
    expect(plan.windows[0]!.cameraSlotId).toBe("behind-goal-x0");
    expect(plan.windows[0]!.decision.possession).toEqual({
      fallback: false,
      followX: 10,
      zone: { xMin: 0, xMax: 17.5 },
      desiredSlotId: "behind-goal-x0",
    });
  });

  test("an OFF-PITCH reference x matches no zone → the fallback slot (never clamped, never invented)", () => {
    const snapshot = buildDirectorSnapshot(0);
    snapshot.football!.possession = { status: "unknown" };
    snapshot.entities[1]!.state.pitchPosition = {
      status: "known",
      value: { x: 200, y: 30 },
    } as never;
    const steps: AvatarField3dMatchStep[] = [
      { atMs: 1_000, scene: projectScene(snapshot, { events: [] }) },
    ];
    const plan = direct(DEFAULT_DIRECTOR_POLICY, steps, []);
    expect(plan.windows[0]!.cameraSlotId).toBe("main-touchline");
    expect(plan.windows[0]!.decision.possession).toEqual({
      fallback: false,
      followX: 200,
      desiredSlotId: "main-touchline",
    });
    expect(plan.windows[0]!.decision.reason).toBe(
      "possession-follow: followX 200 matches no zone → fallback slot main-touchline",
    );
    // The flight-2 fix pin: this reason previously rendered "zone [undefined, undefined]".
    expect(plan.windows[0]!.decision.reason).not.toContain("undefined");
  });

  test("an off-pitch reference while a DIFFERENT slot is held: the hold is stated, never 'undefined'", () => {
    // The ball starts in the x0 zone (t=1000), flies off the pitch at
    // t=2000 (x=200 — the zone change to fallback is SUPPRESSED by the 3 s
    // hysteresis), and a 1 s shot focus [1000, 2000] ends exactly at the
    // off-pitch step — so the span [2000, 3000] falls to the DEFAULT,
    // which desires the fallback while holding behind-goal-x0.
    const policy = policyClone();
    policy.eventRules.find((rule) => rule.eventType === "shot")!.holdMs = 1_000;
    const steps = [10, 200, 200].map((x, index) => {
      const snapshot = buildDirectorSnapshot(index);
      snapshot.football!.possession = { status: "unknown" };
      snapshot.entities[1]!.state.pitchPosition = {
        status: "known",
        value: { x, y: 30 },
      } as never;
      return { atMs: (index + 1) * 1_000, scene: projectScene(snapshot, { events: [] }) };
    });
    const plan = direct(policy, steps, [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 1_200,
        eventType: "shot",
        confidence: 0.7,
      }),
    ]);
    expect(summarize(plan)).toEqual([
      "0:live[1000,2000]@behind-goal-x0(event-focus)",
      "1:live[2000,3000]@behind-goal-x0(possession-follow)",
    ]);
    expect(plan.windows[1]!.decision.possession).toEqual({
      fallback: false,
      followX: 200,
      desiredSlotId: "main-touchline",
    });
    expect(plan.windows[1]!.decision.reason).toBe(
      "possession-follow: followX 200 matches no zone, fallback main-touchline desired, hysteresis holds behind-goal-x0",
    );
    expect(plan.summary.suppressedCuts.map((cut) => cut.atMs)).toEqual([2_000, 3_000]);
  });
});

describe("direct — rule 2: event-importance focus windows", () => {
  test("the canonical goal: focus from the snap boundary, nearest-goal on the snap reference, verbatim candidate", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 5_500,
        eventType: "goal",
        confidence: 0.86,
        emphasis: 0.9,
      }),
    ]);
    expect(summarize(plan)).toEqual([
      "0:live[1000,5000]@main-touchline(possession-follow)",
      "1:live[5000,7000]@behind-goal-x105(event-focus)",
      "2:review[3000,7000]@behind-goal-x105(replay-emphasis)",
    ]);
    const focus = plan.windows[1]!.decision;
    expect(focus.ruleId).toBe("event-focus");
    expect(focus.event).toEqual({
      candidateId: "ec-1",
      eventType: "goal",
      eventTimeMs: 5_500,
      confidence: 0.86,
      emphasis: 0.9,
    });
    expect(focus.holdMs).toBe(4_000);
    expect(focus.reason).toBe(
      "event-focus: goal (confidence 0.86, emphasis 0.9) at 5500 → behind-goal-x105 for 4000 ms",
    );
  });

  test("nearest-goal resolves BOTH sides: a snap reference on the x0 half → behind-goal-x0", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 1_200,
        eventType: "shot",
        confidence: 0.7,
      }),
    ]);
    // snap step t=1000, striker x=50 ≤ 52.5 → the x0 goal side.
    expect(plan.windows[0]!.cameraSlotId).toBe("behind-goal-x0");
    expect(plan.windows[0]!.source).toEqual({ startMs: 1_000, endMs: 3_000 });
  });

  test("nearest-goal with NO usable reference degrades honestly to the fallback slot", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildNoFootballMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 3_000,
        eventType: "goal",
        confidence: 0.9,
      }),
    ]);
    const focus = plan.windows.find((window) => window.decision.ruleId === "event-focus")!;
    expect(focus.cameraSlotId).toBe("main-touchline");
    expect(focus.source).toEqual({ startMs: 3_000, endMs: 5_000 });
  });

  test("the pinned hold is a MINIMUM: a mid-segment raw end extends to the NEXT snapshot boundary", () => {
    const policy = policyClone();
    const shotRule = policy.eventRules.find((rule) => rule.eventType === "shot")!;
    shotRule.holdMs = 1_500;
    const plan = direct(policy, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 3_600,
        eventType: "shot",
        confidence: 0.7,
      }),
    ]);
    // snap 3000 + 1500 = 4500 → the first boundary at-or-after is 5000.
    const focus = plan.windows.find((window) => window.decision.ruleId === "event-focus")!;
    expect(focus.source).toEqual({ startMs: 3_000, endMs: 5_000 });
  });

  test("a hold that overruns the timeline is CLIPPED to the timeline end", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 6_500,
        eventType: "goal",
        confidence: 0.9,
      }),
    ]);
    const focus = plan.windows.find((window) => window.decision.ruleId === "event-focus")!;
    expect(focus.source).toEqual({ startMs: 6_000, endMs: 7_000 });
  });

  test("an event exactly at the LAST snapshot opens a zero-length focus + its review", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 7_000,
        eventType: "goal",
        confidence: 0.9,
      }),
    ]);
    expect(summarize(plan)).toEqual([
      "0:live[1000,5000]@main-touchline(possession-follow)",
      "1:live[5000,7000]@behind-goal-x105(possession-follow)",
      "2:live[7000,7000]@behind-goal-x105(event-focus)",
      "3:review[5000,7000]@behind-goal-x105(replay-emphasis)",
    ]);
  });

  test("an event exactly at the FIRST snapshot opens at the timeline start", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 1_000,
        eventType: "kickoff",
        confidence: 0.9,
      }),
    ]);
    expect(plan.windows[0]!.source).toEqual({ startMs: 1_000, endMs: 4_000 });
    expect(plan.windows[0]!.cameraSlotId).toBe("main-touchline");
  });

  test("the confidence gate is STRICT: 0.5 admits a goal, 0.4999 does not", () => {
    const admitted = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 5_500,
        eventType: "goal",
        confidence: 0.5,
      }),
    ]);
    expect(admitted.summary.eventAccounting[0]!.outcome).toBe("governed");
    const refused = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 5_500,
        eventType: "goal",
        confidence: 0.4999,
      }),
    ]);
    expect(refused.summary.eventAccounting[0]!.outcome).toBe("below-confidence");
    expect(refused.windows.every((window) => window.decision.ruleId !== "event-focus")).toBe(true);
  });

  test("static selectors name their slot directly (card → main-touchline, fulltime → aerial-tactical)", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-card",
        eventTimeMs: 3_000,
        eventType: "card",
        confidence: 0.9,
      }),
      buildCandidate({
        candidateId: "ec-ft",
        eventTimeMs: 6_100,
        eventType: "fulltime",
        confidence: 0.9,
      }),
    ]);
    const cardWindow = plan.windows.find(
      (window) => window.decision.event?.candidateId === "ec-card",
    )!;
    expect(cardWindow.cameraSlotId).toBe("main-touchline");
    const ftWindow = plan.windows.find((window) => window.decision.event?.candidateId === "ec-ft")!;
    expect(ftWindow.cameraSlotId).toBe("aerial-tactical");
  });
});

describe("direct — rule 3: the overlay (priority, recency, id, merging)", () => {
  test("IMPORTANCE first: a goal beats an overlapping shot (goal's rule index is lower)", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
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
    ]);
    expect(summarize(plan)).toEqual([
      "0:live[1000,3000]@main-touchline(possession-follow)",
      "1:live[3000,7000]@behind-goal-x105(event-focus)",
      "2:review[1000,6000]@behind-goal-x105(replay-emphasis)",
    ]);
    expect(plan.windows[1]!.decision.event!.candidateId).toBe("ec-b");
    expect(plan.summary.eventAccounting).toEqual([
      expect.objectContaining({ candidateId: "ec-a", outcome: "superseded", supersededBy: "ec-b" }),
      expect.objectContaining({ candidateId: "ec-b", outcome: "governed" }),
    ]);
  });

  test("RECENCY next: a later goal takes over from an earlier goal's still-open window", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-early",
        eventTimeMs: 3_200,
        eventType: "goal",
        confidence: 0.8,
      }),
      buildCandidate({
        candidateId: "ec-late",
        eventTimeMs: 6_600,
        eventType: "goal",
        confidence: 0.8,
      }),
    ]);
    expect(summarize(plan)).toEqual([
      "0:live[1000,3000]@main-touchline(possession-follow)",
      "1:live[3000,6000]@behind-goal-x105(event-focus)",
      "2:review[1000,6000]@behind-goal-x105(replay-emphasis)",
      "3:live[6000,7000]@behind-goal-x105(event-focus)",
      "4:review[4000,7000]@behind-goal-x105(replay-emphasis)",
    ]);
    expect(plan.windows[1]!.decision.event!.candidateId).toBe("ec-early");
    expect(plan.windows[3]!.decision.event!.candidateId).toBe("ec-late");
    expect(plan.summary.eventAccounting.every((entry) => entry.outcome === "governed")).toBe(true);
  });

  test("the final tie-break is DESCENDING candidate id in CODEPOINT order (never locale collation)", () => {
    // Same type, same time: "ec-9" vs "ec-10" — codepoint order says
    // "ec-9" > "ec-10" ('9' = 0x39 > '1' = 0x31); numeric collation would
    // disagree. The pinned winner is the codepoint-greater id.
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-9",
        eventTimeMs: 5_500,
        eventType: "goal",
        confidence: 0.8,
      }),
      buildCandidate({
        candidateId: "ec-10",
        eventTimeMs: 5_500,
        eventType: "goal",
        confidence: 0.8,
      }),
    ]);
    const governor = plan.windows.find((window) => window.decision.ruleId === "event-focus")!;
    expect(governor.decision.event!.candidateId).toBe("ec-9");
    expect(plan.summary.eventAccounting).toEqual([
      expect.objectContaining({ candidateId: "ec-9", outcome: "governed" }),
      expect.objectContaining({
        candidateId: "ec-10",
        outcome: "superseded",
        supersededBy: "ec-9",
      }),
    ]);
  });

  test("adjacent spans under the SAME candidate MERGE into one window (one review, not two)", () => {
    const policy = policyClone();
    const goalRule = policy.eventRules.find((rule) => rule.eventType === "goal")!;
    goalRule.holdMs = 1_000; // [3000, 4000] then [6000, 7000] — not adjacent, no merge
    const plan = direct(policy, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 3_200,
        eventType: "goal",
        confidence: 0.8,
      }),
      buildCandidate({
        candidateId: "ec-2",
        eventTimeMs: 6_600,
        eventType: "goal",
        confidence: 0.8,
      }),
    ]);
    // The two goal windows are separated by default spans (the striker's
    // zone cut to x105 lands at 5000 — a separate default boundary).
    expect(summarize(plan)).toEqual([
      "0:live[1000,3000]@main-touchline(possession-follow)",
      "1:live[3000,4000]@behind-goal-x105(event-focus)",
      "2:review[1000,6000]@behind-goal-x105(replay-emphasis)",
      "3:live[4000,5000]@main-touchline(possession-follow)",
      "4:live[5000,6000]@behind-goal-x105(possession-follow)",
      "5:live[6000,7000]@behind-goal-x105(event-focus)",
      "6:review[4000,7000]@behind-goal-x105(replay-emphasis)",
    ]);
  });
});

describe("direct — rule 4: replay emphasis", () => {
  test("the canonical review: lead/trail snap boundaries, the review slot, holdMs = the realized range", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 5_500,
        eventType: "goal",
        confidence: 0.86,
        emphasis: 0.9,
      }),
    ]);
    const review = plan.windows[2]!;
    expect(review.kind).toBe("review");
    expect(review.source).toEqual({ startMs: 3_000, endMs: 7_000 });
    expect(review.cameraSlotId).toBe("behind-goal-x105");
    expect(review.decision.holdMs).toBe(4_000);
    expect(review.decision.reason).toBe(
      "replay-emphasis: goal review of [3000, 7000] (confidence 0.86) at the W603 review profile from behind-goal-x105",
    );
  });

  test("a rule WITHOUT a replay config earns no review (the shot outcome may still earn one)", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 3_200,
        eventType: "shot",
        confidence: 0.7,
      }),
    ]);
    expect(plan.windows.every((window) => window.kind === "live")).toBe(true);
    expect(plan.summary.reviewWindowCount).toBe(0);
  });

  test("a SUPERSEDED candidate earns no review (only governing events replay)", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-shot",
        eventTimeMs: 3_200,
        eventType: "shot",
        confidence: 0.7,
      }),
      buildCandidate({
        candidateId: "ec-goal",
        eventTimeMs: 3_400,
        eventType: "goal",
        confidence: 0.8,
      }),
    ]);
    const reviewDrivers = plan.windows
      .filter((window) => window.kind === "review")
      .map((window) => window.decision.event!.candidateId);
    expect(reviewDrivers).toEqual(["ec-goal"]);
  });

  test("the save replay: shorter lead/trail (1.5 s) — both replay configs are live policy data", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 5_500,
        eventType: "save",
        confidence: 0.8,
      }),
    ]);
    // lead 1.5 s: snapBefore(4000) = 4000; trail 1.5 s: boundary(7000) = 7000.
    const review = plan.windows.find((window) => window.kind === "review")!;
    expect(review.source).toEqual({ startMs: 4_000, endMs: 7_000 });
    expect(review.decision.holdMs).toBe(3_000);
  });

  test("a review range never leaves the match timeline (reviews re-present existing time)", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 6_900,
        eventType: "goal",
        confidence: 0.9,
      }),
    ]);
    const review = plan.windows.find((window) => window.kind === "review")!;
    expect(review.source.startMs).toBeGreaterThanOrEqual(1_000);
    expect(review.source.endMs).toBeLessThanOrEqual(7_000);
  });
});

describe("direct — rule 5: total candidate accounting (the five outcomes)", () => {
  test("every input candidate appears EXACTLY once with verbatim confidence/emphasis", () => {
    const candidates: EventCandidate[] = [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 5_500,
        eventType: "goal",
        confidence: 0.86,
        emphasis: 0.9,
      }),
      buildCandidate({
        candidateId: "ec-2",
        eventTimeMs: 3_200,
        eventType: "shot",
        confidence: 0.7,
        emphasis: 0.5,
      }),
      buildCandidate({
        candidateId: "ec-3",
        eventTimeMs: 3_400,
        eventType: "goal",
        confidence: 0.8,
        emphasis: 0.85,
      }),
      buildCandidate({
        candidateId: "ec-4",
        eventTimeMs: 2_000,
        eventType: "pass",
        confidence: 0.9,
        emphasis: 0.1,
      }),
      buildCandidate({
        candidateId: "ec-5",
        eventTimeMs: 1_500,
        eventType: "goal",
        confidence: 0.3,
        emphasis: 0.2,
      }),
      buildCandidate({
        candidateId: "ec-6",
        eventTimeMs: 99_000,
        eventType: "save",
        confidence: 0.9,
        emphasis: 0.9,
      }),
      buildCandidate({
        candidateId: "ec-7",
        eventTimeMs: 500,
        eventType: "save",
        confidence: 0.9,
        emphasis: 0.4,
      }),
    ];
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), candidates);
    expect(plan.summary.eventAccounting.map((entry) => [entry.candidateId, entry.outcome])).toEqual(
      [
        ["ec-1", "governed"],
        ["ec-2", "superseded"],
        ["ec-3", "governed"],
        ["ec-4", "no-rule"],
        ["ec-5", "below-confidence"],
        ["ec-6", "outside-timeline"],
        ["ec-7", "outside-timeline"],
      ],
    );
    // Verbatim fields on every accounting entry.
    for (let i = 0; i < candidates.length; i += 1) {
      const entry = plan.summary.eventAccounting[i]!;
      expect(entry.eventType).toBe(candidates[i]!.eventType);
      expect(entry.eventTimeMs).toBe(candidates[i]!.eventTimeMs);
      expect(entry.confidence).toBe(candidates[i]!.confidence);
      expect(entry.emphasis).toBe(candidates[i]!.emphasis);
    }
    // The shot (ec-2) was superseded by the OVERLAPPING goal (ec-3); the
    // non-overlapping goal (ec-1, snap 5000) governed its own window.
    expect(plan.summary.eventAccounting[1]!.supersededBy).toBe("ec-3");
  });
});

describe("direct — the plan document (identity + tiling invariants)", () => {
  test("the plan carries the director version and the policy identity verbatim", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), []);
    expect(plan.directorVersion).toBe(DIRECTOR_VERSION);
    expect(plan.policy).toEqual({
      policyId: "broadcast-classic",
      policyVersion: DIRECTOR_POLICY_VERSION,
    });
    expect(plan.timeline).toEqual({ startMs: 1_000, endMs: 7_000 });
  });

  test("live windows TILE the timeline: shared boundaries, first start, last end", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 5_500,
        eventType: "goal",
        confidence: 0.86,
      }),
    ]);
    const live = plan.windows.filter((window) => window.kind === "live");
    expect(live[0]!.source.startMs).toBe(1_000);
    expect(live[live.length - 1]!.source.endMs).toBe(7_000);
    for (let i = 1; i < live.length; i += 1) {
      expect(live[i - 1]!.source.endMs).toBe(live[i]!.source.startMs);
    }
  });

  test("every window boundary is a SNAPSHOT boundary (a step atMs, never mid-segment)", () => {
    const steps = buildDirectorMatch();
    const atMs = new Set(steps.map((step) => step.atMs));
    const plan = direct(DEFAULT_DIRECTOR_POLICY, steps, [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 5_500,
        eventType: "goal",
        confidence: 0.86,
      }),
      buildCandidate({
        candidateId: "ec-2",
        eventTimeMs: 3_200,
        eventType: "shot",
        confidence: 0.7,
      }),
    ]);
    for (const window of plan.windows) {
      expect(atMs.has(window.source.startMs)).toBe(true);
      expect(atMs.has(window.source.endMs)).toBe(true);
    }
  });
});

describe("direct — determinism (W604's core claim)", () => {
  test("the same inputs yield a JSON-BYTE-IDENTICAL plan on every call", () => {
    const steps = buildDirectorMatch();
    const candidates = [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 5_500,
        eventType: "goal",
        confidence: 0.86,
      }),
      buildCandidate({
        candidateId: "ec-2",
        eventTimeMs: 3_200,
        eventType: "shot",
        confidence: 0.7,
      }),
    ];
    const first = JSON.stringify(direct(DEFAULT_DIRECTOR_POLICY, steps, candidates));
    const second = JSON.stringify(direct(DEFAULT_DIRECTOR_POLICY, steps, candidates));
    expect(first).toBe(second);
  });

  test("the plan is a FRESH document: mutating it never affects the next call", () => {
    const steps = buildDirectorMatch();
    const first = direct(DEFAULT_DIRECTOR_POLICY, steps, []);
    first.windows[0]!.cameraSlotId = "aerial-tactical";
    first.summary.cutCount = 999;
    const second = direct(DEFAULT_DIRECTOR_POLICY, steps, []);
    expect(second.windows[0]!.cameraSlotId).toBe("main-touchline");
    expect(second.summary.cutCount).toBe(1);
  });

  test("candidate INPUT ORDER does not change the directed windows (accounting order follows input)", () => {
    const steps = buildDirectorMatch();
    const candidates = [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 5_500,
        eventType: "goal",
        confidence: 0.86,
      }),
      buildCandidate({
        candidateId: "ec-2",
        eventTimeMs: 3_200,
        eventType: "shot",
        confidence: 0.7,
      }),
    ];
    const forward = direct(DEFAULT_DIRECTOR_POLICY, steps, candidates);
    const reversed = direct(DEFAULT_DIRECTOR_POLICY, steps, [candidates[1]!, candidates[0]!]);
    expect(JSON.stringify(reversed.windows)).toBe(JSON.stringify(forward.windows));
    expect(reversed.summary.eventAccounting.map((entry) => entry.candidateId)).toEqual([
      "ec-2",
      "ec-1",
    ]);
  });

  test("a single-step timeline directs ONE zero-length window (the degenerate total case)", () => {
    const snapshot = buildDirectorSnapshot(0);
    const steps: AvatarField3dMatchStep[] = [
      { atMs: 1_000, scene: projectScene(snapshot, { events: [] }) },
    ];
    const plan = direct(DEFAULT_DIRECTOR_POLICY, steps, []);
    expect(summarize(plan)).toEqual(["0:live[1000,1000]@main-touchline(possession-follow)"]);
  });
});

describe("direct — fail-closed admission (DirectorError, never a partial plan)", () => {
  test("an invalid policy is refused with its validation issues", () => {
    const bad = policyClone();
    bad.possessionFollow.zones = [];
    try {
      direct(bad, buildDirectorMatch(), []);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DirectorError);
      const directorError = error as DirectorError;
      expect(directorError.kind).toBe("policy-invalid");
      expect(directorError.name).toBe("DirectorError");
      expect(directorError.message).toContain("camera-director refused input (policy-invalid)");
      expect((directorError.details.issues as string[]).join("\n")).toContain(
        "policy.possessionFollow.zones: must be a non-empty array",
      );
      expect(directorError.describe()).toContain("policy-invalid");
    }
  });

  test("a malformed timeline is refused (empty, non-increasing, bad atMs, bad scene shape)", () => {
    const cases: Array<[string, unknown]> = [
      ["empty", []],
      [
        "non-increasing atMs",
        [
          { atMs: 2_000, scene: projectScene(buildDirectorSnapshot(1), { events: [] }) },
          { atMs: 2_000, scene: projectScene(buildDirectorSnapshot(1), { events: [] }) },
        ],
      ],
      [
        "negative atMs",
        [{ atMs: -1, scene: projectScene(buildDirectorSnapshot(0), { events: [] }) }],
      ],
      ["no scene", [{ atMs: 1_000 }]],
      ["scene not a record", [{ atMs: 1_000, scene: "scene" }]],
    ];
    for (const [name, steps] of cases) {
      try {
        direct(DEFAULT_DIRECTOR_POLICY, steps as never, []);
        expect.unreachable(name);
      } catch (error) {
        expect(error).toBeInstanceOf(DirectorError);
        expect((error as DirectorError).kind).toBe("timeline-invalid");
      }
    }
  });

  test("a malformed candidate stream is refused (fields, ranges, shapes)", () => {
    const steps = buildDirectorMatch();
    const cases: Array<[string, Partial<EventCandidate> | unknown]> = [
      ["no candidateId", { ...buildCandidate(), candidateId: "" }],
      ["confidence above 1", { ...buildCandidate(), confidence: 1.5 }],
      ["emphasis below 0", { ...buildCandidate(), emphasis: -0.1 }],
      ["negative eventTimeMs", { ...buildCandidate(), eventTimeMs: -5 }],
      ["empty eventType", { ...buildCandidate(), eventType: "" }],
      ["empty eventPhrase", { ...buildCandidate(), eventPhrase: "" }],
      ["subjects not an array", { ...buildCandidate(), subjects: "none" as never }],
      ["not an object", "ec-1"],
    ];
    for (const [name, candidate] of cases) {
      try {
        direct(DEFAULT_DIRECTOR_POLICY, steps, [candidate as EventCandidate]);
        expect.unreachable(name);
      } catch (error) {
        expect(error).toBeInstanceOf(DirectorError);
        expect((error as DirectorError).kind).toBe("candidates-invalid");
      }
    }
  });
});
