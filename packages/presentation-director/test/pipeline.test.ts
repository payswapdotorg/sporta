/**
 * The pipeline test: the REAL W209 `extractEventCandidates` feeding the
 * presentation director over the canonical timeline (the camera-director
 * pipeline-test convention — the director consumes the real commentary
 * seam's output, never hand-forged candidates).
 */
import { describe, expect, test } from "bun:test";
import { extractEventCandidates } from "@sporta/commentary-understanding";
import type { CommentaryUnit } from "@sporta/commentary-segmentation";
import { DEFAULT_PRESENTATION_POLICY, checkPresentationPlan, present } from "../src/index";
import { buildPresentationMatch } from "./helpers";

const STEPS = buildPresentationMatch();

/** The canonical commentary passage: a kickoff, a goal, a routine pass. */
function commentaryUnits(): CommentaryUnit[] {
  return [
    {
      unitId: "cu-1",
      startMs: 1_000,
      endMs: 1_500,
      text: "The kick-off gets us underway at the far end.",
      sourceWindowIds: ["tu-1"],
    },
    {
      unitId: "cu-2",
      startMs: 5_400,
      endMs: 6_000,
      text: "GOAL!!! An absolute thunderbolt from the striker!",
      speakerLabel: "main",
      sourceWindowIds: ["tu-2"],
    },
    {
      unitId: "cu-3",
      startMs: 6_400,
      endMs: 6_900,
      text: "They keep it simple with a short pass.",
      sourceWindowIds: ["tu-3"],
    },
  ];
}

describe("the real W209 → R305 pipeline", () => {
  const candidates = extractEventCandidates({
    units: commentaryUnits(),
    lexicon: { players: [], teams: [] },
  });

  test("the real extraction produces the expected candidate stream", () => {
    expect(candidates.map((candidate) => candidate.eventType)).toEqual(["kickoff", "goal", "pass"]);
    expect(candidates[0]!.candidateId).toBe("ec-1");
  });

  test("the director presents the real candidates into a self-check-clean plan", () => {
    const plan = present(DEFAULT_PRESENTATION_POLICY, STEPS, candidates);
    const result = checkPresentationPlan(plan, STEPS, DEFAULT_PRESENTATION_POLICY);
    expect(result.violations).toEqual([]);
    // The governed goal carries a replay window.
    expect(plan.summary.presentationCounts.replay).toBe(1);
    // Every event-driven trace quotes the REAL W209 phrase verbatim.
    const goalWindow = plan.windows.find(
      (window) => window.importanceTrace.importance.eventType === "goal",
    );
    expect(goalWindow!.importanceTrace.semantics.eventPhrase).toBe("GOAL");
  });

  test("the pipeline is deterministic end to end (byte-identical reruns)", () => {
    const a = JSON.stringify(present(DEFAULT_PRESENTATION_POLICY, STEPS, candidates));
    const b = JSON.stringify(present(DEFAULT_PRESENTATION_POLICY, STEPS, candidates));
    expect(a).toBe(b);
  });
});
