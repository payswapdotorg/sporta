/**
 * The clean-fixture evaluation tests (W503 deliverable 3): the W502 fixture
 * clip, replicated in this package and driven through the REAL renderer,
 * MUST pass every threshold — with the measured values pinned exactly
 * (flicker 0, styleStability 1.0, styleBytes 1.0, jumpCount 0, all
 * artifact counts 0).
 */
import { describe, expect, test } from "bun:test";
import {
  buildW503ClipSteps,
  buildW503EventStream,
  buildW503RenderRequest,
  buildW503Snapshot,
  evaluateRenderOutput,
  renderW503CleanFixture,
} from "../src/index";

describe("renderW503CleanFixture — the replicated W502 fixture clip", () => {
  test("6 frames at t = 1000..6000 with the fixture's entities and captions", () => {
    const output = renderW503CleanFixture();
    expect(output.frames).toHaveLength(6);
    expect(output.manifest.frames.map((frame) => frame.outputTimestampMs)).toEqual([
      1_000, 2_000, 3_000, 4_000, 5_000, 6_000,
    ]);
    const entityIds = output.manifest.frames[0]!.entities.map((entity) => entity.entityId);
    expect(entityIds).toEqual([
      "player-7",
      "player-9",
      "player-11",
      "player-out",
      "player-far",
      "team-1",
      "ball-1",
    ]);
    expect(
      output.manifest.frames.map((frame) => frame.captions.events.map((e) => e.phrase)),
    ).toEqual([["Kick-off"], [], ["Pass"], ["Shot!"], [], ["GOAL!"]]);
  });

  test("deterministic render: two calls deep-equal end to end", () => {
    const first = renderW503CleanFixture();
    const second = renderW503CleanFixture();
    expect(first.manifest).toEqual(second.manifest);
    expect(first.frames).toEqual(second.frames);
    expect(first.frames[0]!.svg).toBe(second.frames[0]!.svg);
  });

  test("the clip builders are the documented fixture shape (hand-derived)", () => {
    const steps = buildW503ClipSteps();
    expect(steps).toHaveLength(6);
    expect(steps[0]!.atMs).toBe(1_000);
    // player-7 moves 0.8 m per step: 52.5 -> 53.3 at step 1.
    const snapshot1 = buildW503Snapshot(1);
    const player7 = snapshot1.entities.find((entity) => entity.entityId === "player-7")!;
    expect(player7.state.pitchPosition!.value).toEqual({ x: 53.3, y: 34 });
    // The event stream: kickoff, pass, shot, uncaptionable, goal (seq 11..15).
    expect(buildW503EventStream().map((entry) => entry.sequence)).toEqual([11, 12, 13, 14, 15]);
    // Step 3's caption window is (3000, 4000]: the shot (seq 13, at 4000);
    // the uncaptionable event (4700) falls into step 4's window.
    expect(steps[3]!.events.map((entry) => entry.sequence)).toEqual([13]);
    expect(steps[4]!.events.map((entry) => entry.sequence)).toEqual([14]);
    expect(buildW503RenderRequest().rendererId).toBe("anime.prototype");
  });
});

describe("the clean fixture evaluation — every measured value pinned", () => {
  const report = evaluateRenderOutput(renderW503CleanFixture());

  test("VERDICT: PASS — every check green (20 + conditional styleBytes)", () => {
    expect(report.verdict.pass).toBe(true);
    expect(report.verdict.failures).toEqual([]);
    expect(report.verdict.checks).toHaveLength(21);
    expect(report.verdict.checks.every((check) => check.pass)).toBe(true);
  });

  test("identity: flicker 0, unexplainedAbsence 0, styleStability 1.0 (12/12 tokens)", () => {
    expect(report.identity.flickerCount).toBe(0);
    expect(report.identity.unexplainedAbsenceCount).toBe(0);
    expect(report.identity.reappearanceCount).toBe(0);
    expect(report.identity.styleTokenFrames).toBe(12);
    expect(report.identity.styleStableFrames).toBe(12);
    expect(report.identity.styleStabilityRatio).toBe(1);
  });

  test("styleBytes: 24 marker groups, all byte-identical, ratio 1.0", () => {
    expect(report.styleBytes!.groupFrames).toBe(24);
    expect(report.styleBytes!.stableFrames).toBe(24);
    expect(report.styleBytes!.unstableFrames).toBe(0);
    expect(report.styleBytes!.stabilityRatio).toBe(1);
  });

  test("geometry: 25 pairs, 0 jumps, max displacement 0.8 m, max jump 0, 0 gaps", () => {
    expect(report.geometry.measuredPairCount).toBe(25);
    expect(report.geometry.jumpCount).toBe(0);
    expect(report.geometry.maxDisplacementMeters).toBeCloseTo(0.8, 10);
    expect(report.geometry.maxJumpMeters).toBe(0);
    expect(report.geometry.maxJumpRatio).toBeGreaterThan(0);
    expect(report.geometry.maxJumpRatio).toBeLessThan(0.07);
    expect(report.geometry.gapFrameCount).toBe(0);
    expect(report.geometry.gapSpanCount).toBe(0);
  });

  test("artifacts: every count 0, no anomaly records", () => {
    expect(report.artifacts.frameCount).toBe(6);
    for (const [key, value] of Object.entries(report.artifacts)) {
      if (key === "frameCount" || key === "anomalies") continue;
      expect(value).toBe(0);
    }
    expect(report.artifacts.anomalies).toEqual([]);
  });
});
