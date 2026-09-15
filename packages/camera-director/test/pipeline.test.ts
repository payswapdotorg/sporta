/**
 * THE end-to-end W604 acceptance chain: COMMENTARY TEXT → W208 units →
 * W209 event candidates → the camera plan → the directed render. This is
 * the work item's acceptance sentence made executable: "event importance
 * and commentary can influence camera/replay emphasis deterministically
 * enough to evaluate" — the influence flows from the words a commentator
 * says, through W209's deterministic extraction, into directed camera
 * slots and a replay window, with every decision traceable and the whole
 * chain byte-reproducible.
 *
 * The W208 units are built as plain literals (the segmentation package's
 * `CommentaryUnit` document — the same shape W209 consumes in production);
 * W209's `extractEventCandidates` is the REAL extraction (patterns,
 * emphasis, confidence — no stubs).
 */
import { describe, expect, test } from "bun:test";
import type { CommentaryUnit } from "@sporta/commentary-segmentation";
import { extractEventCandidates } from "@sporta/commentary-understanding";
import { DEFAULT_DIRECTOR_POLICY } from "../src/policy";
import { direct } from "../src/direct";
import { render3dDirectedMatch } from "../src/compose";
import { buildDirectorMatch, buildDirectorRequest } from "./helpers";

/** The commentary: a shot, THE goal (excited), and a routine pass. */
const COMMENTARY: CommentaryUnit[] = [
  {
    unitId: "cu-1",
    startMs: 1_200,
    endMs: 1_600,
    text: "He shoots from the edge of the box.",
    sourceWindowIds: ["tu-1"],
  },
  {
    unitId: "cu-2",
    startMs: 5_400,
    endMs: 5_900,
    text: "GOAL!!! What a strike from Dalvio!",
    speakerLabel: "main",
    sourceWindowIds: ["tu-2"],
  },
  {
    unitId: "cu-3",
    startMs: 6_500,
    endMs: 6_900,
    text: "Neat pass across the middle.",
    sourceWindowIds: ["tu-3"],
  },
];

/** W209's real extraction over the commentary (deterministic, verbatim). */
function candidatesFromCommentary() {
  return extractEventCandidates({
    units: COMMENTARY,
    lexicon: { players: ["Dalvio"], teams: [] },
  });
}

describe("commentary → camera direction (the W604 acceptance chain)", () => {
  test("W209 extracts the three candidates with its own deterministic confidences", () => {
    const candidates = candidatesFromCommentary();
    expect(
      candidates.map((candidate) => [
        candidate.candidateId,
        candidate.eventType,
        candidate.eventTimeMs,
      ]),
    ).toEqual([
      ["ec-1", "shot", 1_200],
      ["ec-2", "goal", 5_400],
      ["ec-3", "pass", 6_500],
    ]);
    // The excited goal sentence scores higher emphasis than the flat ones;
    // confidences are W209's own output, carried VERBATIM downstream
    // (exact IEEE-754 values — the no-invented-data rule).
    expect(candidates[1]!.emphasis).toBe(0.6000000000000001);
    expect(candidates[1]!.confidence).toBe(0.7100000000000001);
    expect(candidates[0]!.emphasis).toBe(0);
    expect(candidates[0]!.confidence).toBe(0.6699999999999999);
  });

  test("the COMMENTARY drives the camera: the shot and the goal open focus windows, the pass does not", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), candidatesFromCommentary());
    expect(
      plan.windows.map(
        (window) =>
          `${window.index}:${window.kind}[${window.source.startMs},${window.source.endMs}]@${window.cameraSlotId}(${window.decision.ruleId})`,
      ),
    ).toEqual([
      // "He shoots..." at 1200: snap 1000 (striker x=50, x0 side) → the
      // behind-goal-x0 framing until the hold's first honest boundary.
      "0:live[1000,3000]@behind-goal-x0(event-focus)",
      // Nothing happening: the possession default.
      "1:live[3000,5000]@main-touchline(possession-follow)",
      // "GOAL!!!" at 5400: snap 5000 (striker x=90, x105 side).
      "2:live[5000,7000]@behind-goal-x105(event-focus)",
      // The goal earns the replay (±2 s at the W603 review profile).
      "3:review[3000,7000]@behind-goal-x105(replay-emphasis)",
    ]);
    // The decision records quote the commentary-derived candidates verbatim.
    const goalDecision = plan.windows[2]!.decision;
    expect(goalDecision.event).toEqual({
      candidateId: "ec-2",
      eventType: "goal",
      eventTimeMs: 5_400,
      confidence: 0.7100000000000001,
      emphasis: 0.6000000000000001,
    });
    // Total accounting: the pass candidate is honestly "no-rule".
    expect(plan.summary.eventAccounting.map((entry) => [entry.candidateId, entry.outcome])).toEqual(
      [
        ["ec-1", "governed"],
        ["ec-2", "governed"],
        ["ec-3", "no-rule"],
      ],
    );
  });

  test("the commentary-directed plan composes with the renderer end to end", () => {
    const steps = buildDirectorMatch();
    const plan = direct(DEFAULT_DIRECTOR_POLICY, steps, candidatesFromCommentary());
    const out = render3dDirectedMatch(buildDirectorRequest(), steps, plan);
    // The directed slots: the shot's behind-goal-x0, the default, the
    // goal's behind-goal-x105, the review.
    expect(out.manifest.windows.map((window) => window.cameraSlotId)).toEqual([
      "behind-goal-x0",
      "main-touchline",
      "behind-goal-x105",
      "behind-goal-x105",
    ]);
    // The review window's provenance traces back to the commentary unit
    // (via the W209 candidate, verbatim).
    const review = out.manifest.windows[3]!;
    expect(review.kind).toBe("review");
    expect(review.decision.event!.eventTimeMs).toBe(5_400);
    expect(review.decision.event!.confidence).toBe(0.7100000000000001);
    expect(review.decision.reason).toBe(
      "replay-emphasis: goal review of [3000, 7000] (confidence 0.7100000000000001) at the W603 review profile from behind-goal-x105",
    );
  });

  test("the whole chain is byte-reproducible (same commentary → same plan, twice)", () => {
    const steps = buildDirectorMatch();
    const first = direct(DEFAULT_DIRECTOR_POLICY, steps, candidatesFromCommentary());
    const second = direct(DEFAULT_DIRECTOR_POLICY, steps, candidatesFromCommentary());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
