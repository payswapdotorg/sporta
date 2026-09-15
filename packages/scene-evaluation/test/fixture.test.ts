/**
 * The W605 fixture pins: every fixture is deterministic (two builds deep-equal
 * with byte-identical SVG frames), every step's scene is EXACTLY the real
 * W601 projection of its construction-time snapshot (the windowing
 * convention pinned), the stories carry the intended discontinuity classes,
 * and the two documented REPLICATIONS of renderer-internal behavior
 * (`expectedStyleKind`, the provenance overlay) match the real renderer's
 * output on every entity of every frame.
 */
import { describe, expect, test } from "bun:test";
import { projectScene } from "@sporta/scene-projection";
import type { AvatarField3dRenderOutput } from "@sporta/renderer-3d";
import type { DirectedRenderOutput } from "@sporta/camera-director";
import {
  buildCleanMatchFixture,
  buildCorrectionsMatchFixture,
  buildDirectedReviewFixture,
  expectedStyleKind,
  W605_CLEAN_SESSION_ID,
  W605_CORRECTIONS_SESSION_ID,
  W605_FIXTURE_NOW_MS,
} from "../src/index";
import type { SceneEvaluationFixture } from "../src/index";

const clean = buildCleanMatchFixture();
const corrections = buildCorrectionsMatchFixture();
const directed = buildDirectedReviewFixture();

describe("fixture determinism", () => {
  test("two clean builds are deep-equal with byte-identical frames", () => {
    const again = buildCleanMatchFixture();
    expect(JSON.stringify(again)).toBe(JSON.stringify(clean));
  });

  test("two corrections builds are deep-equal with byte-identical frames", () => {
    const again = buildCorrectionsMatchFixture();
    expect(JSON.stringify(again)).toBe(JSON.stringify(corrections));
  });

  test("two directed builds are deep-equal with byte-identical frames", () => {
    const again = buildDirectedReviewFixture();
    expect(JSON.stringify(again)).toBe(JSON.stringify(directed));
    expect(JSON.stringify(again.plan)).toBe(JSON.stringify(directed.plan));
  });

  test("every snapshot was generated on the injected clock domain", () => {
    for (const input of [clean, corrections, directed.input] as SceneEvaluationFixture[]) {
      for (const snapshot of input.snapshots) {
        expect(snapshot.generatedAtMs).toBe(W605_FIXTURE_NOW_MS);
      }
    }
  });
});

describe("fixture construction (the real seams, pinned)", () => {
  test("each step's scene is the real W601 projection of its snapshot with the windowed events", () => {
    for (const input of [clean, corrections, directed.input] as SceneEvaluationFixture[]) {
      expect(input.steps.length).toBe(input.snapshots.length);
      for (let k = 0; k < input.steps.length; k += 1) {
        const step = input.steps[k]!;
        const windowFrom = k === 0 ? 0 : input.steps[k - 1]!.atMs;
        const windowed = input.eventStream.filter(
          (entry) => entry.event.eventTimeMs > windowFrom && entry.event.eventTimeMs <= step.atMs,
        );
        const reprojected = projectScene(input.snapshots[k]!, { events: windowed });
        expect(JSON.stringify(reprojected)).toBe(JSON.stringify(step.scene));
      }
    }
  });

  test("the event stream is the engine's log: 3 and 9 strictly increasing entries", () => {
    expect(clean.eventStream.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
    expect(corrections.eventStream.map((entry) => entry.sequence)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(corrections.eventStream.map((entry) => entry.event.eventId)).toContain("evt-card-fix");
    const correction = corrections.eventStream.find(
      (entry) => entry.event.eventId === "evt-card-fix",
    )!;
    expect(correction.event.correctionOf).toBe("evt-card");
  });

  test("session ids are the documented ones", () => {
    expect(clean.snapshots[0]!.sessionId).toBe(W605_CLEAN_SESSION_ID);
    expect(corrections.snapshots[0]!.sessionId).toBe(W605_CORRECTIONS_SESSION_ID);
    expect(directed.input.snapshots[0]!.sessionId).toBe(W605_CORRECTIONS_SESSION_ID);
  });
});

describe("the corrections story (the discontinuity classes, pinned)", () => {
  const manifest = (corrections.output as AvatarField3dRenderOutput).manifest;

  test("8 steps, 36 frames, a declared cut into the last step", () => {
    expect(corrections.steps).toHaveLength(8);
    expect(corrections.steps.map((step) => step.atMs)).toEqual([
      1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000,
    ]);
    expect(corrections.steps[7]!.sceneCutBefore).toBe(true);
    expect(manifest.frames).toHaveLength(36);
  });

  test("the score evolves 0-0 → 1-0 provisional → 1-0 confirmed across steps", () => {
    const scores = corrections.steps.map((step) => step.scene.scoreClock.score);
    expect(scores.slice(0, 4).every((score) => score?.home === 0 && score?.away === 0)).toBe(true);
    expect(scores[4]!.home).toBe(1);
    expect(scores[4]!.status.value).toBe("provisional");
    expect(scores[4]!.status.status).toBe("uncertain");
    expect(scores[5]!.status.value).toBe("confirmed");
    expect(scores.slice(5).every((score) => score?.home === 1 && score?.away === 0)).toBe(true);
  });

  test("the clock advances each step and the stoppage flag lands at step 7000", () => {
    expect(corrections.steps.map((step) => step.scene.scoreClock.clock?.clockMs)).toEqual([
      2_701_000, 2_702_000, 2_703_000, 2_704_000, 2_705_000, 2_706_000, 2_707_000, 2_708_000,
    ]);
    expect(corrections.steps[5]!.scene.scoreClock.clock?.stoppage).toBe(false);
    expect(corrections.steps[6]!.scene.scoreClock.clock?.stoppage).toBe(true);
    expect(manifest.frames[0]!.hud.statusLine).toBe("Second half · 45:01 · 0-0");
    expect(manifest.frames[35]!.hud.statusLine).toBe("Second half · 45:08 · 1-0 · +stoppage");
  });

  test("the keeper's disposition changes to out-of-bounds from step 6000", () => {
    const dispositionAt = (frameIndex: number): string => {
      const frame = manifest.frames[frameIndex]!;
      return frame.entities.find((entity) => entity.entityId === "keeper-1")!.sceneDisposition;
    };
    expect(dispositionAt(0)).toBe("projected");
    expect(dispositionAt(24)).toBe("projected");
    expect(dispositionAt(25)).toBe("projected-out-of-bounds");
    expect(dispositionAt(35)).toBe("projected-out-of-bounds");
  });

  test("the ball's height gap: z carried through frame 25, absent from 26 on", () => {
    const ballAt = (frameIndex: number) =>
      manifest.frames[frameIndex]!.entities.find((entity) => entity.entityId === "ball-1")!;
    expect(ballAt(25).positionMeters?.z).toBe(2);
    for (const frameIndex of [26, 27, 28, 29, 30, 31, 34, 35]) {
      expect("z" in (ballAt(frameIndex).positionMeters ?? {})).toBe(false);
    }
    expect(ballAt(20).positionMeters?.z).not.toBeUndefined();
  });

  test("the teleport is velocity-bound held across the 3000→4000 segment", () => {
    for (const frameIndex of [11, 12, 13, 14]) {
      const teleport = manifest.frames[frameIndex]!.entities.find(
        (entity) => entity.entityId === "teleport-3",
      )!;
      expect(teleport.positionProvenance).toBe("held");
      expect(teleport.heldReason).toBe("velocity-bound");
    }
  });

  test("the substitute appears at step 4000 and is never interpolated into existence", () => {
    expect(manifest.frames[14]!.entities.some((entity) => entity.entityId === "sub-15")).toBe(
      false,
    );
    expect(manifest.frames[15]!.entities.some((entity) => entity.entityId === "sub-15")).toBe(true);
  });

  test("the declared cut holds the 7000→8000 segment with scene-cut provenance", () => {
    for (const frameIndex of [31, 32, 33, 34]) {
      const frame = manifest.frames[frameIndex]!;
      expect(frame.interpolation?.kind).toBe("held");
      expect(frame.interpolation?.sceneCut).toBe(true);
      for (const entity of frame.entities) {
        expect(entity.positionProvenance).toBe("held");
        expect(entity.heldReason).toBe("scene-cut");
      }
    }
    expect(manifest.frames[30]!.interpolation?.kind).toBe("observed");
    expect(manifest.frames[35]!.interpolation?.kind).toBe("observed");
  });

  test("the marker windows follow the (prevAtMs, atMs] convention", () => {
    expect(corrections.steps[0]!.scene.eventMarkers.map((m) => m.sequence)).toEqual([1]);
    expect(corrections.steps[1]!.scene.eventMarkers).toHaveLength(0);
    expect(corrections.steps[2]!.scene.eventMarkers.map((m) => m.sequence)).toEqual([2]);
    expect(corrections.steps[3]!.scene.eventMarkers.map((m) => m.sequence)).toEqual([3, 4]);
    expect(corrections.steps[4]!.scene.eventMarkers.map((m) => m.sequence)).toEqual([5, 6]);
    expect(corrections.steps[5]!.scene.eventMarkers).toHaveLength(0);
    expect(corrections.steps[6]!.scene.eventMarkers.map((m) => m.sequence)).toEqual([7]);
    expect(corrections.steps[7]!.scene.eventMarkers.map((m) => m.sequence)).toEqual([8, 9]);
  });

  test("one frame carries two markers in source order (goal 4400 + carry 4550)", () => {
    const frame = manifest.frames[17]!;
    expect(frame.outputTimestampMs).toBe(4_400);
    expect(frame.markers.map((marker) => marker.sequence)).toEqual([5, 6]);
    expect(frame.markers.map((marker) => marker.eventId)).toEqual(["evt-goal", "evt-carry"]);
  });

  test("the unknown-taxonomy event's chip text is the verbatim type ref", () => {
    const frame = manifest.frames[32]!;
    const flare = frame.markers.find((marker) => marker.eventId === "evt-flare");
    expect(flare?.text).toBe("custom/v9/flare");
    // The correction follows one frame later, with the fixed phrase.
    const fix = manifest.frames[33]!.markers.find((marker) => marker.eventId === "evt-card-fix");
    expect(fix?.text).toBe("Referee decision");
  });
});

describe("the directed story (the W604 chain, pinned)", () => {
  const manifest = (directed.input.output as DirectedRenderOutput).manifest;

  test("four windows: three live (two cuts) and one review", () => {
    expect(manifest.windows.map((window) => window.kind)).toEqual([
      "live",
      "live",
      "live",
      "review",
    ]);
    expect(
      manifest.windows.map(
        (window) =>
          `${window.index}[${window.source.startMs},${window.source.endMs}]@${window.cameraSlotId}(${window.decision.ruleId})`,
      ),
    ).toEqual([
      "0[1000,3000]@behind-goal-x0(event-focus)",
      "1[3000,4000]@main-touchline(possession-follow)",
      "2[4000,8000]@behind-goal-x105(event-focus)",
      "3[2000,7000]@behind-goal-x105(replay-emphasis)",
    ]);
    expect(manifest.frames).toHaveLength(62);
    expect(manifest.windows.map((window) => window.frameCount)).toEqual([10, 5, 21, 26]);
  });

  test("the review re-presents past match time (source range inside the live timeline)", () => {
    const review = manifest.windows[3]!;
    expect(review.kind).toBe("review");
    expect(review.output.startMs).toBeGreaterThan(review.source.startMs);
  });

  test("the boundary-exact marker (restart@4000) is transferred and re-presented", () => {
    // Window 1 [3000,4000] is a non-last live window: its observed tail frame
    // at 4000 is DROPPED — the marker rides it out and must return with the
    // window that starts at 4000.
    const window2First = manifest.frames.find(
      (frame) => frame.windowIndex === 2 && frame.sourceTimestampMs === 4_000,
    );
    expect(window2First).toBeDefined();
    expect(window2First!.entry.markers.map((marker) => marker.sequence)).toContain(4);
    // And the review re-presents it too.
    const reviewFirst = manifest.frames.find(
      (frame) => frame.windowIndex === 3 && frame.sourceTimestampMs === 4_000,
    );
    expect(reviewFirst!.entry.markers.map((marker) => marker.sequence)).toContain(4);
  });

  test("the skipped-marker accounting: pass before window 1, save before window 2", () => {
    expect(manifest.skippedMarkers).toHaveLength(2);
    expect(
      manifest.skippedMarkers.map(
        (entry) => `${entry.sequence}:${entry.reason}:w${entry.windowIndex}`,
      ),
    ).toEqual(["2:before-window:w1", "3:before-window:w2"]);
  });
});

describe("the documented replications match the real renderer", () => {
  test("expectedStyleKind equals the renderer's own styleKind on every entity of every frame", () => {
    for (const input of [clean, corrections, directed.input] as SceneEvaluationFixture[]) {
      const manifest = (input.output as AvatarField3dRenderOutput).manifest;
      for (const frame of manifest.frames) {
        const entry = (frame as unknown as { entry?: unknown }).entry ?? frame;
        const entities = (entry as { entities: Array<{ entityId: string; styleKind: string }> })
          .entities;
        const authoritativeScene = input.steps.find(
          (step) =>
            step.atMs ===
            (entry as { interpolation?: { fromAtMs?: number } }).interpolation?.fromAtMs,
        )!.scene;
        for (const entity of entities) {
          const sceneEntity = authoritativeScene.entities.find(
            (candidate) => candidate.entityId === entity.entityId,
          );
          expect(sceneEntity).toBeDefined();
          expect(expectedStyleKind(sceneEntity!) === entity.styleKind).toBe(true);
        }
      }
    }
  });
});
