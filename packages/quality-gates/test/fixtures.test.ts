/**
 * The fixture-layer tests: the checked-in self-check record (an honest
 * document — clearly marked as the pipeline's own record, never a human
 * attestation) and the demo input builders (the real fixture set, in the
 * documented order, over the real seams).
 */
import { describe, expect, test } from "bun:test";
import { DEMO_SCENE_FIXTURES, DEMO_TEMPORAL_FIXTURE, buildDemoReleaseInput } from "../src/release";
import {
  HUMAN_REVIEW_CHECKLIST,
  SELF_CHECK_REVIEWER_ID,
  validateHumanReviewRecord,
  reviewRecordCompleteness,
} from "../src/review";
import { loadDemoRecord } from "./helpers";

describe("the checked-in self-check record is an honest document", () => {
  test("it validates complete against the checked-in checklist", () => {
    const record = validateHumanReviewRecord(loadDemoRecord());
    expect(reviewRecordCompleteness(record).complete).toBe(true);
    expect(record.checklistResults.length).toBe(HUMAN_REVIEW_CHECKLIST.length);
  });

  test("it is clearly marked as the automated pipeline self-check, NOT a human attestation", () => {
    const record = validateHumanReviewRecord(loadDemoRecord());
    expect(record.isHumanAttestation).toBe(false);
    expect(record.reviewer).toBe(SELF_CHECK_REVIEWER_ID);
    expect(record.recordId).toBe("w803-fixture-demo-self-check");
    // The scope statement names the fixtures and denies production scope.
    expect(record.scope).toContain("fixture demo run only");
    expect(record.scope).toContain("no production output");
    // Every visual-inspection item's notes honestly state the self-check
    // path (deterministic re-render/byte-pin), never a human viewing.
    for (const itemId of [
      "rendered-clip-anime",
      "rendered-clip-3d-match",
      "rendered-clip-3d-directed",
    ]) {
      const result = record.checklistResults.find((entry) => entry.itemId === itemId)!;
      expect(result.notes!.toLowerCase()).toContain("no human viewed");
    }
  });

  test("the record-level notes state the boundary explicitly", () => {
    const record = validateHumanReviewRecord(loadDemoRecord());
    expect(record.notes).toContain("isHumanAttestation is false");
    expect(record.notes).toContain("no human reviewed production output");
    // The sign-off item carries the explicit not-an-attestation marker.
    const signoff = record.checklistResults.find((entry) => entry.itemId === "release-signoff")!;
    expect(signoff.notes).toContain("NOT a human attestation");
  });
});

describe("the demo input builders (the real fixture set)", () => {
  test("the documented fixture names and order", () => {
    expect(DEMO_TEMPORAL_FIXTURE).toBe("w503-clean-clip");
    expect(DEMO_SCENE_FIXTURES).toEqual([
      "w605-clean-match",
      "w605-corrections-match",
      "w605-directed-review",
    ]);
  });

  test("the demo input carries exactly the documented fixtures with real payloads", () => {
    const input = buildDemoReleaseInput(loadDemoRecord());
    expect(input.temporal.evaluations.map((entry) => entry.name)).toEqual(["w503-clean-clip"]);
    expect(input.temporal.evaluations[0]!.input).toBeDefined();
    expect(input.scene.evaluations.map((entry) => entry.name)).toEqual([...DEMO_SCENE_FIXTURES]);
    for (const entry of input.scene.evaluations) {
      expect(entry.input).toBeDefined();
    }
    expect(input.humanReview).toEqual(loadDemoRecord());
  });

  test("the temporal fixture carries the manifest AND the frames (styleBytes is measured)", () => {
    const input = buildDemoReleaseInput(loadDemoRecord());
    const temporal = input.temporal.evaluations[0]!.input!;
    expect(temporal.frames!.length).toBe(temporal.manifest.frames.length);
    expect(temporal.frames!.length).toBe(6);
  });
});
