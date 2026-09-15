/**
 * THE composition (`src/compose.ts` `render3dDirectedMatch`): the camera
 * plan DRIVES renderer-3d's match path window by window through the
 * renderer's own `styleConfig.config.cameraSlotId` seam, stitched into one
 * rundown. These tests prove the W604 acceptance end to end:
 *
 * - events → plan → directed render: the composed manifest carries the
 *   DIRECTED slots + the plan's provenance verbatim;
 * - the boundary-tail drop: every shared boundary snapshot renders EXACTLY
 *   ONCE, from the window that STARTS there (the cut takes effect AT the
 *   boundary);
 * - review windows re-present existing match time at the W603 review
 *   profile (5 fps), authoring nothing new;
 * - parity: a single-window no-review plan is byte-identical to an
 *   undirected `render3dMatch`; a multi-window no-review plan is 1:1 in
 *   frame count and output positions;
 * - aggregation (watermarks, provenance, skipped markers, degradation) is
 *   the honest union across runs;
 * - fail-closed admission: plan-invalid and budget-exceeded; byte-level
 *   determinism of the whole composed output.
 */
import { describe, expect, test } from "bun:test";
import { buildEventEnvelope, buildWorldSnapshot } from "@sporta/testing";
import { projectScene } from "@sporta/scene-projection";
import type { SceneEventMarker } from "@sporta/scene-projection";
import {
  AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE,
  AVATAR_FIELD_GAME_OUTPUT_PROFILE,
  render3dMatch,
} from "@sporta/renderer-3d";
import type { AvatarField3dMatchStep } from "@sporta/renderer-3d";
import type { RenderRequest } from "@sporta/contracts";
import { DEFAULT_DIRECTOR_POLICY } from "../src/policy";
import type { DirectorPolicy } from "../src/policy";
import { direct } from "../src/direct";
import { render3dDirectedMatch, REVIEW_OUTPUT_PROFILE } from "../src/compose";
import { DirectorError } from "../src/errors";
import type { CameraPlan } from "../src/types";
import { SESSION_ID, buildCandidate, buildDirectorMatch, buildDirectorRequest } from "./helpers";

/** A deep clone of the default policy (fixture mutation base). */
function policyClone(): DirectorPolicy {
  return JSON.parse(JSON.stringify(DEFAULT_DIRECTOR_POLICY)) as DirectorPolicy;
}

/** The canonical directed plan (possession default + goal@5500 + review). */
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

describe("render3dDirectedMatch — the canonical end-to-end (events → plan → directed render)", () => {
  test("the composed manifest carries the plan's provenance verbatim (director block)", () => {
    const plan = canonicalPlan();
    const out = render3dDirectedMatch(buildDirectorRequest(), buildDirectorMatch(), plan);
    expect(out.manifest.director).toEqual({
      directorVersion: plan.directorVersion,
      policy: plan.policy,
      reviewOutputProfile: REVIEW_OUTPUT_PROFILE,
      timeline: plan.timeline,
      output: { startMs: 1_000, endMs: 11_400 },
      windowCount: plan.summary.windowCount,
      liveWindowCount: plan.summary.liveWindowCount,
      reviewWindowCount: plan.summary.reviewWindowCount,
      cutCount: plan.summary.cutCount,
      suppressedCuts: plan.summary.suppressedCuts,
      eventAccounting: plan.summary.eventAccounting,
    });
    expect(out.manifest.director.eventAccounting[0]!.outcome).toBe("governed");
  });

  test("the realized windows: directed slots verbatim, W601 slot geometry, frame counts, rundown ranges", () => {
    const out = render3dDirectedMatch(
      buildDirectorRequest(),
      buildDirectorMatch(),
      canonicalPlan(),
    );
    const windows = out.manifest.windows;
    expect(windows.map((window) => [window.index, window.kind, window.cameraSlotId])).toEqual([
      [0, "live", "main-touchline"],
      [1, "live", "behind-goal-x105"],
      [2, "review", "behind-goal-x105"],
    ]);
    expect(windows.map((window) => window.source)).toEqual([
      { startMs: 1_000, endMs: 5_000 },
      { startMs: 5_000, endMs: 7_000 },
      { startMs: 3_000, endMs: 7_000 },
    ]);
    // The rundown: live windows are 1:1 with the match timeline; the review
    // INSERTS its realized duration after the goal window.
    expect(windows.map((window) => window.output)).toEqual([
      { startMs: 1_000, endMs: 5_000 },
      { startMs: 5_000, endMs: 7_200 },
      { startMs: 7_200, endMs: 11_400 },
    ]);
    expect(windows.map((window) => window.frameCount)).toEqual([20, 11, 21]);
    expect(windows.map((window) => window.firstFrameIndex)).toEqual([0, 20, 31]);
    // The realized camera block is the canonical W601 geometry, verbatim.
    expect(windows[1]!.camera).toEqual({
      slotId: "behind-goal-x105",
      position: { x: 125, y: 34, z: 8 },
      target: { x: 105, y: 34, z: 1.22 },
      focalPx: 512,
      nearPlaneMeters: 0.5,
    });
    // The plan's decision record rides every window, verbatim.
    expect(windows[1]!.decision.event!.candidateId).toBe("ec-1");
    expect(windows[2]!.decision.ruleId).toBe("replay-emphasis");
    // The renderer identity block is carried from the runs.
    expect(out.manifest.renderer).toEqual({
      rendererId: "avatar-field.prototype",
      rendererVersion: "0.2.0",
      styleId: "style-3d-director",
      configSchemaVersion: "1.0",
    });
  });

  test("the frames: 52 total, globally renumbered, rundown-mapped, directed slot per frame", () => {
    const out = render3dDirectedMatch(
      buildDirectorRequest(),
      buildDirectorMatch(),
      canonicalPlan(),
    );
    expect(out.frames).toHaveLength(52);
    expect(out.manifest.frames).toHaveLength(52);
    expect(out.manifest.output.frameCount).toBe(52);
    for (let i = 0; i < 52; i += 1) {
      expect(out.frames[i]!.frameIndex).toBe(i);
      expect(out.manifest.frames[i]!.frameIndex).toBe(i);
    }
    // Window 0: [1000, 5000) at 200 ms — 20 frames, main-touchline.
    expect(out.manifest.frames[0]!.outputTimestampMs).toBe(1_000);
    expect(out.manifest.frames[19]!.outputTimestampMs).toBe(4_800);
    expect(
      out.manifest.frames.slice(0, 20).every((frame) => frame.cameraSlotId === "main-touchline"),
    ).toBe(true);
    // Window 1: [5000, 7000] + the kept tail — 11 frames, behind-goal-x105.
    expect(out.manifest.frames[20]!.outputTimestampMs).toBe(5_000);
    expect(out.manifest.frames[30]!.outputTimestampMs).toBe(7_000);
    expect(
      out.manifest.frames.slice(20, 31).every((frame) => frame.cameraSlotId === "behind-goal-x105"),
    ).toBe(true);
    // The review: source time 3000.. re-presented from rundown 7200 on.
    expect(out.manifest.frames[31]!.outputTimestampMs).toBe(7_200);
    expect(out.manifest.frames[31]!.sourceTimestampMs).toBe(3_000);
    expect(out.manifest.frames[51]!.outputTimestampMs).toBe(11_200);
    expect(out.manifest.frames[51]!.sourceTimestampMs).toBe(7_000);
    expect(out.manifest.frames.slice(31).every((frame) => frame.presentation === "review")).toBe(
      true,
    );
    // Each frame's window index matches its window.
    expect(out.manifest.frames[0]!.windowIndex).toBe(0);
    expect(out.manifest.frames[20]!.windowIndex).toBe(1);
    expect(out.manifest.frames[31]!.windowIndex).toBe(2);
  });

  test("the boundary-tail drop: the shared boundary snapshot renders EXACTLY ONCE, from the NEW slot", () => {
    const out = render3dDirectedMatch(
      buildDirectorRequest(),
      buildDirectorMatch(),
      canonicalPlan(),
    );
    // Exactly one frame at output position 5000 (the cut boundary)…
    const atBoundary = out.manifest.frames.filter((frame) => frame.outputTimestampMs === 5_000);
    expect(atBoundary).toHaveLength(1);
    // …and it renders from the window that STARTS there (the cut took effect).
    expect(atBoundary[0]!.cameraSlotId).toBe("behind-goal-x105");
    expect(atBoundary[0]!.entry.hud.cameraLabel).toBe("CAM · behind-goal-x105");
    // Window 0's run DID produce its own tail at 5000 — dropped, accounted
    // by the frame count (20 kept for a 4 s window at 5 fps).
    expect(out.manifest.windows[0]!.frameCount).toBe(20);
  });

  test("a MID-RUNDOWN review inserts its realized duration, SHIFTING every later window (rundown tiling)", () => {
    // Two governed goals (3400, 5500) + the shot they superseded: the
    // rundown is live, live, REVIEW, live, REVIEW — the first review sits
    // BETWEEN live windows, so every later window's output position must
    // shift by the review's realized extent (the §6.4 claim, pinned here
    // for the mid-rundown case the canonical fixture does not exercise).
    const steps = buildDirectorMatch();
    const plan = direct(DEFAULT_DIRECTOR_POLICY, steps, [
      buildCandidate({ candidateId: "ec-1", eventTimeMs: 5_500, eventType: "goal" }),
      buildCandidate({ candidateId: "ec-2", eventTimeMs: 3_200, eventType: "shot" }),
      buildCandidate({ candidateId: "ec-3", eventTimeMs: 3_400, eventType: "goal" }),
    ]);
    expect(
      plan.windows.map(
        (window) =>
          `${window.index}:${window.kind}[${window.source.startMs},${window.source.endMs}]@${window.cameraSlotId}`,
      ),
    ).toEqual([
      "0:live[1000,3000]@main-touchline",
      "1:live[3000,5000]@behind-goal-x105",
      "2:review[1000,6000]@behind-goal-x105",
      "3:live[5000,7000]@behind-goal-x105",
      "4:review[3000,7000]@behind-goal-x105",
    ]);
    const out = render3dDirectedMatch(buildDirectorRequest(), steps, plan);
    // Live windows are 1:1 with the match timeline; the FIRST review
    // occupies [5000, 10200] (26 frames × 200 ms), shifting live window 3
    // from 5000 to 10200; the second review shifts nothing after it.
    expect(out.manifest.windows.map((window) => window.output)).toEqual([
      { startMs: 1_000, endMs: 3_000 },
      { startMs: 3_000, endMs: 5_000 },
      { startMs: 5_000, endMs: 10_200 },
      { startMs: 10_200, endMs: 12_400 },
      { startMs: 12_400, endMs: 16_600 },
    ]);
    expect(out.manifest.windows.map((window) => window.frameCount)).toEqual([10, 10, 26, 11, 21]);
    expect(out.manifest.windows.map((window) => window.firstFrameIndex)).toEqual([
      0, 10, 20, 46, 57,
    ]);
    expect(out.frames).toHaveLength(78);
    // The shifted live window's frames keep their SOURCE timestamps
    // (source 5000 → output 10200: the review's realized extent in between).
    expect(out.manifest.frames[46]!.sourceTimestampMs).toBe(5_000);
    expect(out.manifest.frames[46]!.outputTimestampMs).toBe(10_200);
    expect(out.manifest.frames[57]!.sourceTimestampMs).toBe(3_000);
    expect(out.manifest.frames[57]!.outputTimestampMs).toBe(12_400);
    // The output timeline tiles with NO overlap between the review's tail
    // ([10000, 10200]) and the shifted live window's first frame
    // ([10200, 10400]).
    expect(out.manifest.frames[45]!.outputWindowMs).toEqual({ startMs: 10_000, endMs: 10_200 });
    expect(out.manifest.frames[46]!.outputWindowMs).toEqual({ startMs: 10_200, endMs: 10_400 });
    expect(out.manifest.director.output).toEqual({ startMs: 1_000, endMs: 16_600 });
  });

  test("the review renders EXISTING match time at the W603 review profile (5 fps, no new content)", () => {
    const out = render3dDirectedMatch(
      buildDirectorMatchRequestAtGameProfile(),
      buildDirectorMatch(),
      canonicalPlan(),
    );
    const windows = out.manifest.windows;
    // Live windows at the caller's 25 fps game profile; the review at 5 fps.
    expect(windows[0]!.outputProfile).toEqual(AVATAR_FIELD_GAME_OUTPUT_PROFILE);
    expect(windows[1]!.outputProfile).toEqual(AVATAR_FIELD_GAME_OUTPUT_PROFILE);
    expect(windows[2]!.outputProfile).toEqual(REVIEW_OUTPUT_PROFILE);
    expect(REVIEW_OUTPUT_PROFILE).toEqual(AVATAR_FIELD_ANIMATED_OUTPUT_PROFILE);
    expect(out.manifest.output.reviewFrameIntervalMs).toBe(200);
    // Live window 0: 4 s at 25 fps = 100 frames; review: 4 s at 5 fps + tail = 21.
    expect(windows[0]!.frameCount).toBe(100);
    expect(windows[2]!.frameCount).toBe(21);
    // The review frames' SOURCE timestamps are the existing 3000..7000 grid.
    const reviewSources = out.manifest.frames
      .filter((frame) => frame.presentation === "review")
      .map((frame) => frame.sourceTimestampMs);
    expect(reviewSources[0]).toBe(3_000);
    expect(reviewSources[20]).toBe(7_000);
  });

  test("the underlying renderer manifest entry rides VERBATIM (per-run interpolation provenance)", () => {
    const out = render3dDirectedMatch(
      buildDirectorRequest(),
      buildDirectorMatch(),
      canonicalPlan(),
    );
    // An interpolated live frame: source 5200 is between steps 5000/6000.
    const live = out.manifest.frames[21]!;
    expect(live.sourceTimestampMs).toBe(5_200);
    expect(live.entry.interpolation!.kind).toBe("interpolated");
    expect(live.entry.interpolation!.fraction).toBe(0.2);
    // The entry's indices/timestamps are the RUN's own (source timeline).
    expect(live.entry.frameIndex).toBe(1);
    expect(live.entry.interpolation!.fromAtMs).toBe(5_000);
    expect(live.entry.interpolation!.toAtMs).toBe(6_000);
    // A review frame: the same verbatim posture, run-local step indices.
    const review = out.manifest.frames[32]!;
    expect(review.sourceTimestampMs).toBe(3_200);
    expect(review.entry.interpolation!.kind).toBe("interpolated");
    expect(review.entry.interpolation!.fromStepIndex).toBe(0);
    expect(review.entry.interpolation!.toStepIndex).toBe(1);
  });

  test("aggregation: watermarks/provenance are the MAX across runs; the contract result mirrors them", () => {
    const out = render3dDirectedMatch(
      buildDirectorRequest(),
      buildDirectorMatch(),
      canonicalPlan(),
    );
    expect(out.manifest.watermarkAfter).toEqual({ watermarkMs: 7_200, sequence: 16 });
    expect(out.manifest.provenance).toEqual({ snapshotVersion: 1, lastEventSequence: 12 });
    expect(out.result.watermarkAfter).toEqual({ watermarkMs: 7_200, sequence: 16 });
    expect(out.result.provenance).toEqual({ snapshotVersion: 1, lastEventSequence: 12 });
    expect(out.result.sessionId).toBe(SESSION_ID);
    expect(out.result.rendererId).toBe("avatar-field.prototype");
    expect(out.result.rendererHealth).toEqual({ lagMs: 0, degraded: false });
    expect(out.manifest.degradation).toEqual({ degraded: false, reasons: [] });
    // One output segment per frame, on the rundown timeline.
    expect(out.result.outputSegments).toHaveLength(52);
    expect(out.result.outputSegments[0]).toEqual({
      segmentId: "scene3d-0",
      startMs: 1_000,
      endMs: 1_200,
      artifactRef: "scene3d://sess-3d-director/1/0",
    });
    expect(out.result.outputSegments[51]!.startMs).toBe(11_200);
    expect(out.result.outputSegments[51]!.endMs).toBe(11_400);
  });

  test("the caller's own styleConfig.cameraSlotId never overrides the DIRECTION", () => {
    const req = buildDirectorRequest({
      styleConfig: {
        styleId: "style-x",
        configSchemaVersion: "1.0",
        config: { cameraSlotId: "aerial-tactical" },
      },
    });
    const out = render3dDirectedMatch(req, buildDirectorMatch(), canonicalPlan());
    expect(out.manifest.windows.map((window) => window.cameraSlotId)).toEqual([
      "main-touchline",
      "behind-goal-x105",
      "behind-goal-x105",
    ]);
  });
});

describe("render3dDirectedMatch — parity with the undirected renderer", () => {
  test("a SINGLE-window no-review plan at the same slot is BYTE-IDENTICAL to render3dMatch", () => {
    const policy = policyClone();
    policy.possessionFollow.enabled = false; // one constant main-touchline window
    const plan = direct(policy, buildDirectorMatch(), []);
    const req = buildDirectorRequest();
    const directed = render3dDirectedMatch(req, buildDirectorMatch(), plan);
    const undirected = render3dMatch(req, buildDirectorMatch());
    expect(directed.frames).toHaveLength(undirected.frames.length);
    for (let i = 0; i < undirected.frames.length; i += 1) {
      expect(directed.frames[i]!.svg).toBe(undirected.frames[i]!.svg);
      expect(directed.frames[i]!.outputTimestampMs).toBe(undirected.frames[i]!.outputTimestampMs);
    }
  });

  test("a multi-window no-review plan is 1:1 in frame COUNT and POSITIONS; the cut frame differs", () => {
    const plan = direct(DEFAULT_DIRECTOR_POLICY, buildDirectorMatch(), []); // cut at 5000
    const req = buildDirectorRequest();
    const directed = render3dDirectedMatch(req, buildDirectorMatch(), plan);
    const undirected = render3dMatch(req, buildDirectorMatch());
    expect(directed.frames).toHaveLength(undirected.frames.length);
    for (let i = 0; i < undirected.frames.length; i += 1) {
      expect(directed.frames[i]!.outputTimestampMs).toBe(undirected.frames[i]!.outputTimestampMs);
    }
    // Frames before the cut are byte-identical (same slot, same scene).
    for (let i = 0; i < 20; i += 1) {
      expect(directed.frames[i]!.svg).toBe(undirected.frames[i]!.svg);
    }
    // The boundary frame at 5000 renders from the DIRECTED slot; the
    // undirected render keeps main-touchline (its config default).
    expect(directed.frames[20]!.svg).not.toBe(undirected.frames[20]!.svg);
    expect(directed.manifest.frames[20]!.cameraSlotId).toBe("behind-goal-x105");
  });
});

describe("render3dDirectedMatch — skipped markers + degradation (the honest union)", () => {
  test("a marker inside a window's steps but BEFORE its run window is skipped WITH its window index", () => {
    const steps = buildMatchWithExtraMarker();
    const plan = direct(DEFAULT_DIRECTOR_POLICY, steps, [
      buildCandidate({
        candidateId: "ec-1",
        eventTimeMs: 5_500,
        eventType: "goal",
        confidence: 0.86,
      }),
    ]);
    const out = render3dDirectedMatch(buildDirectorRequest(), steps, plan);
    // The review run [3000, 7000] carries the throw-in marker (it rides the
    // step at 3000) but its event time 2500 precedes the run window.
    expect(out.manifest.skippedMarkers).toEqual([
      {
        sequence: 13,
        eventId: "fe-throwin",
        eventTimeMs: 2_500,
        reason: "before-window",
        windowIndex: 2,
      },
    ]);
    expect(out.manifest.degradation).toEqual({
      degraded: true,
      reasons: ["markers-outside-render-window"],
    });
    expect(out.result.rendererHealth.degraded).toBe(true);
    expect(out.result.rendererHealth.degradationReason).toBe("markers-outside-render-window");
    // The marker still APPLIED exactly once in the live rundown (window 0).
    const applied = out.manifest.frames.filter((frame) =>
      frame.entry.appliedMarkerSequences.includes(13),
    );
    expect(applied).toHaveLength(1);
    expect(applied[0]!.windowIndex).toBe(0);
    expect(applied[0]!.sourceTimestampMs).toBe(2_400);
  });
});

describe("render3dDirectedMatch — fail-closed admission", () => {
  test("a plan with an INVENTED slot is refused (plan-invalid, the selfcheck violations carried)", () => {
    const plan = canonicalPlan() as CameraPlan;
    plan.windows[1]!.cameraSlotId = "railcam";
    try {
      render3dDirectedMatch(buildDirectorRequest(), buildDirectorMatch(), plan);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DirectorError);
      const directorError = error as DirectorError;
      expect(directorError.kind).toBe("plan-invalid");
      expect((directorError.details.violations as string[]).join("\n")).toContain(
        'one-selection-per-window: windows[1].cameraSlotId: "railcam" is not a canonical camera slot',
      );
    }
  });

  test("a plan directed against DIFFERENT steps is refused (timeline mismatch)", () => {
    const plan = canonicalPlan();
    const otherSteps = buildDirectorMatch().slice(0, 4);
    try {
      render3dDirectedMatch(buildDirectorRequest(), otherSteps, plan);
      expect.unreachable();
    } catch (error) {
      expect((error as DirectorError).kind).toBe("plan-invalid");
    }
  });

  test("a plan with a mid-segment boundary is refused (boundaries-respected)", () => {
    const plan = canonicalPlan() as CameraPlan;
    plan.windows[0]!.source = { startMs: 1_000, endMs: 4_500 };
    plan.windows[1]!.source = { startMs: 4_500, endMs: 7_000 };
    try {
      render3dDirectedMatch(buildDirectorRequest(), buildDirectorMatch(), plan);
      expect.unreachable();
    } catch (error) {
      expect((error as DirectorError).kind).toBe("plan-invalid");
    }
  });

  test("the TOTAL composed frame budget: > 3600 frames across runs is a fail-loud budget-exceeded", () => {
    const steps = buildLongMatch(121); // t = 1000..121000 (2 min at 1 s steps)
    const policy = policyClone();
    // Two goals whose ±40 s reviews push the 25 fps composed total past
    // 3600 while every individual run stays far below it: the cumulative
    // cursor is 2427 when the final 1376-frame live window tips it over.
    const goalRule = policy.eventRules.find((rule) => rule.eventType === "goal")!;
    goalRule.replay!.leadMs = 40_000;
    goalRule.replay!.trailMs = 40_000;
    const plan = direct(policy, steps, [
      buildCandidate({
        candidateId: "ec-a",
        eventTimeMs: 60_000,
        eventType: "goal",
        confidence: 0.9,
      }),
      buildCandidate({
        candidateId: "ec-b",
        eventTimeMs: 62_000,
        eventType: "goal",
        confidence: 0.9,
      }),
    ]);
    expect(plan.summary.reviewWindowCount).toBe(2);
    try {
      render3dDirectedMatch(buildDirectorMatchRequestAtGameProfile(), steps, plan);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DirectorError);
      const directorError = error as DirectorError;
      expect(directorError.kind).toBe("budget-exceeded");
      expect(directorError.details.maxRenderFrames).toBe(3_600);
      expect(directorError.details.framesSoFar).toBe(2_427);
      expect(directorError.details.windowFrames).toBe(1_376);
    }
    // The SAME timeline with NO goal reviews stays under budget (3001 frames).
    const plain = direct(policy, steps, []);
    const ok = render3dDirectedMatch(buildDirectorMatchRequestAtGameProfile(), steps, plain);
    expect(ok.frames).toHaveLength(3_001);
  });
});

describe("render3dDirectedMatch — determinism (the composed output)", () => {
  test("the same request + steps + plan yield a BYTE-IDENTICAL composed output", () => {
    const req = buildDirectorRequest();
    const steps = buildDirectorMatch();
    const plan = canonicalPlan();
    const first = render3dDirectedMatch(req, steps, plan);
    const second = render3dDirectedMatch(req, steps, plan);
    expect(JSON.stringify(second.result)).toBe(JSON.stringify(first.result));
    expect(JSON.stringify(second.manifest)).toBe(JSON.stringify(first.manifest));
    expect(second.frames.map((frame) => frame.svg).join("\n")).toBe(
      first.frames.map((frame) => frame.svg).join("\n"),
    );
  });

  test("the composed output is a FRESH document (mutating it never affects a re-render)", () => {
    const req = buildDirectorRequest();
    const steps = buildDirectorMatch();
    const first = render3dDirectedMatch(req, steps, canonicalPlan());
    first.frames[0]!.svg = "<svg>mutated</svg>";
    first.manifest.windows[0]!.cameraSlotId = "aerial-tactical";
    const second = render3dDirectedMatch(req, steps, canonicalPlan());
    expect(second.frames[0]!.svg).not.toBe("<svg>mutated</svg>");
    expect(second.manifest.windows[0]!.cameraSlotId).toBe("main-touchline");
  });

  test("a SHA-256 over the composed bytes is stable across calls (the cross-run pin)", async () => {
    const req = buildDirectorRequest();
    const steps = buildDirectorMatch();
    const plan = canonicalPlan();
    const digestOf = async () => {
      const out = render3dDirectedMatch(req, steps, plan);
      const data = new TextEncoder().encode(
        JSON.stringify(out.result) +
          JSON.stringify(out.manifest) +
          out.frames.map((f) => f.svg).join(""),
      );
      return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    };
    expect(await digestOf()).toBe(await digestOf());
  });
});

// ---------------------------------------------------------------------------
// Local fixture builders
// ---------------------------------------------------------------------------

/** A request at the 25 fps game profile (live windows 40 ms apart). */
function buildDirectorMatchRequestAtGameProfile(): RenderRequest {
  return buildDirectorRequest({ outputProfile: AVATAR_FIELD_GAME_OUTPUT_PROFILE });
}

/**
 * The canonical match plus a throw-in marker at 2500 (carried by the step
 * at 3000 — the (2000, 3000] window). The marker lies INSIDE window 0's
 * source range but BEFORE the review run's [3000, …) window.
 */
function buildMatchWithExtraMarker(): AvatarField3dMatchStep[] {
  const extra = markerEvent("fe-throwin", 2_500, "football/v1/throw-in", 13);
  return buildDirectorMatch().map((step, index) => {
    if (index !== 2) return step; // the step at 3000 carries the extra marker
    const withExtra: AvatarField3dMatchStep = {
      atMs: step.atMs,
      scene: { ...step.scene, eventMarkers: [...step.scene.eventMarkers, extra] },
    };
    return withExtra;
  });
}

/** A marker stream entry in the scene-spec shape (the S7 timeline anchoring included). */
function markerEvent(
  eventId: string,
  eventTimeMs: number,
  eventTypeRef: string,
  sequence: number,
): SceneEventMarker {
  const event = buildEventEnvelope(
    { eventId, sessionId: SESSION_ID, eventTimeMs, eventTypeRef, confidence: 0.9 },
    9_999 + sequence,
  );
  // The scene-spec marker shape: the stream entry + the timeline anchoring
  // literal `projectScene` adds (rule S7 — markers are timeline-anchored).
  return { sequence, snapshotVersionAfter: sequence + 20, event, anchoring: "timeline" };
}

/**
 * A long constant-possession match (striker parked at midfield x=50, so the
 * possession default never cuts): `stepCount` steps at 1 s intervals.
 */
function buildLongMatch(stepCount: number): AvatarField3dMatchStep[] {
  const steps: AvatarField3dMatchStep[] = [];
  for (let index = 0; index < stepCount; index += 1) {
    const atMs = (index + 1) * 1_000;
    const snapshot = buildWorldSnapshot(
      {
        sessionId: SESSION_ID,
        watermark: { watermarkMs: atMs, sequence: 10 + index },
        generatedAtMs: 1_736_164_800_000,
        entities: [
          {
            entityId: "striker-9",
            kind: "participant",
            version: 3 + index,
            lastEventTimeMs: atMs,
            state: { pitchPosition: { status: "known", value: { x: 50, y: 30 } } },
          },
          {
            entityId: "ball-1",
            kind: "ball",
            version: 4,
            lastEventTimeMs: atMs,
            state: { pitchPosition: { status: "known", value: { x: 49, y: 30.5 } } },
          },
        ],
        football: {
          pitch: {
            lengthAxisMeters: 105,
            widthAxisMeters: 68,
            origin: "corner",
            axes: "x=touchline, y=goal-line",
          },
          clock: { period: "second-half", clockMs: 2_704_000 + index * 1_000, stoppage: false },
          score: { home: 2, away: 1, status: { status: "known", value: "confirmed" } },
          possession: { status: "uncertain", value: { entityId: "striker-9" }, confidence: 0.72 },
          eventTaxonomyVersion: "v1",
        },
      },
      1_234 + index,
    );
    steps.push({ atMs, scene: projectScene(snapshot, { events: [] }) });
  }
  return steps;
}
