/**
 * Identity flicker metric tests (W503): clean values, the justified-omission
 * boundary (honest omissions are NEVER flicker), unexplained-absence
 * detection, style stability (manifest tokens + SVG marker bytes), and the
 * mid-clip entry boundary (first appearance is not a reappearance).
 */
import { describe, expect, test } from "bun:test";
import type { AnimeClipManifest, AnimeFrame } from "@sporta/renderer-anime";
import {
  TemporalEvaluationError,
  injectDispositionFlap,
  injectStyleInstability,
  injectUnexplainedAbsence,
  measureIdentityFlicker,
  measureStyleByteStability,
  renderW503CleanFixture,
} from "../src/index";

function cleanManifest(): AnimeClipManifest {
  return structuredClone(renderW503CleanFixture().manifest);
}

describe("measureIdentityFlicker — the clean W502 fixture", () => {
  const metrics = measureIdentityFlicker(cleanManifest());

  test("zero flicker, zero unexplained absence, zero reappearance", () => {
    expect(metrics.flickerCount).toBe(0);
    expect(metrics.unexplainedAbsenceCount).toBe(0);
    expect(metrics.reappearanceCount).toBe(0);
  });

  test("entity universe in first-appearance order (7 entities)", () => {
    expect(metrics.entityIds).toEqual([
      "player-7",
      "player-9",
      "player-11",
      "player-out",
      "player-far",
      "team-1",
      "ball-1",
    ]);
    expect(metrics.frameCount).toBe(6);
  });

  test("presence series: constant dispositions per entity across frames", () => {
    const byId = new Map(metrics.perEntity.map((entity) => [entity.entityId, entity]));
    expect(byId.get("player-7")!.presence).toEqual([
      "rendered",
      "rendered",
      "rendered",
      "rendered",
      "rendered",
      "rendered",
    ]);
    expect(byId.get("player-11")!.presence).toEqual(Array(6).fill("omitted-no-position"));
    expect(byId.get("player-out")!.presence).toEqual(Array(6).fill("rendered-out-of-play"));
    expect(byId.get("player-far")!.presence).toEqual(Array(6).fill("omitted-out-of-play"));
    expect(byId.get("team-1")!.presence).toEqual(Array(6).fill("not-rendered-kind"));
    expect(byId.get("ball-1")!.presence).toEqual(Array(6).fill("rendered"));
  });

  test("every entity's series starts at frame 0", () => {
    for (const entity of metrics.perEntity) {
      expect(entity.firstFrameIndex).toBe(0);
    }
  });

  test("style stability: 12 token frames (player-7, player-9 x 6), all stable, ratio 1.0", () => {
    expect(metrics.styleTokenFrames).toBe(12);
    expect(metrics.styleStableFrames).toBe(12);
    expect(metrics.styleInstabilityFrames).toBe(0);
    expect(metrics.styleStabilityRatio).toBe(1);
    const byId = new Map(metrics.perEntity.map((entity) => [entity.entityId, entity]));
    expect(byId.get("player-7")!.styleTokenFrames).toBe(6);
    expect(byId.get("player-7")!.distinctStyleTokens).toBe(1);
    expect(byId.get("player-9")!.styleTokenFrames).toBe(6);
    // Justified omissions and non-participants carry no token (vacuous, not
    // unstable): the series breaks honestly.
    expect(byId.get("player-11")!.styleTokenFrames).toBe(0);
    expect(byId.get("player-out")!.styleTokenFrames).toBe(0);
    expect(byId.get("ball-1")!.styleTokenFrames).toBe(0);
  });
});

describe("measureIdentityFlicker — the justified-omission boundary", () => {
  test("rendered -> omitted-no-position -> rendered is NOT flicker (honest accounting)", () => {
    // The flap injector turns one frame's entity into a JUSTIFIED omission.
    // Identity flicker must stay 0 (the artifact metric owns flapping).
    const perturbed = injectDispositionFlap(cleanManifest(), {
      frameIndex: 2,
      entityId: "player-9",
    });
    const metrics = measureIdentityFlicker(perturbed);
    expect(metrics.flickerCount).toBe(0);
    expect(metrics.unexplainedAbsenceCount).toBe(0);
    expect(metrics.reappearanceCount).toBe(0);
    const player9 = metrics.perEntity.find((entity) => entity.entityId === "player-9")!;
    expect(player9.presence).toEqual([
      "rendered",
      "rendered",
      "omitted-no-position",
      "rendered",
      "rendered",
      "rendered",
    ]);
  });

  test("an entity first appearing mid-clip is not a reappearance (series starts there)", () => {
    // Remove player-7 from frames 0 and 1: it now FIRST appears at frame 2.
    let manifest = cleanManifest();
    manifest = injectUnexplainedAbsence(manifest, { frameIndex: 0, entityId: "player-7" });
    manifest = injectUnexplainedAbsence(manifest, { frameIndex: 1, entityId: "player-7" });
    const metrics = measureIdentityFlicker(manifest);
    const player7 = metrics.perEntity.find((entity) => entity.entityId === "player-7")!;
    expect(player7.firstFrameIndex).toBe(2);
    expect(player7.presence).toEqual(["rendered", "rendered", "rendered", "rendered"]);
    expect(player7.reappearanceCount).toBe(0);
    expect(player7.unexplainedAbsenceCount).toBe(0);
    expect(player7.flickerCount).toBe(0);
  });
});

describe("measureIdentityFlicker — unexplained absence detection", () => {
  test("drawn-then-vanished entity: flicker 1, absence 1, reappearance 1", () => {
    const perturbed = injectUnexplainedAbsence(cleanManifest(), {
      frameIndex: 2,
      entityId: "player-7",
    });
    const metrics = measureIdentityFlicker(perturbed);
    expect(metrics.flickerCount).toBe(1);
    expect(metrics.unexplainedAbsenceCount).toBe(1);
    expect(metrics.reappearanceCount).toBe(1);
    const player7 = metrics.perEntity.find((entity) => entity.entityId === "player-7")!;
    expect(player7.presence).toEqual([
      "rendered",
      "rendered",
      "absent",
      "rendered",
      "rendered",
      "rendered",
    ]);
  });

  test("omitted-then-vanished entity: absence 1 but flicker 0 (was not drawn)", () => {
    const perturbed = injectUnexplainedAbsence(cleanManifest(), {
      frameIndex: 2,
      entityId: "player-11",
    });
    const metrics = measureIdentityFlicker(perturbed);
    expect(metrics.flickerCount).toBe(0);
    expect(metrics.unexplainedAbsenceCount).toBe(1);
    expect(metrics.reappearanceCount).toBe(1);
    const player11 = metrics.perEntity.find((entity) => entity.entityId === "player-11")!;
    expect(player11.presence[2]).toBe("absent");
  });
});

describe("measureIdentityFlicker — style stability detection", () => {
  test("one restyled frame: distinct tokens 2, 5/6 stable for the entity, ratio 11/12", () => {
    const perturbed = injectStyleInstability(cleanManifest(), {
      frameIndex: 2,
      entityId: "player-7",
    });
    const metrics = measureIdentityFlicker(perturbed);
    expect(metrics.styleTokenFrames).toBe(12);
    expect(metrics.styleStableFrames).toBe(11);
    expect(metrics.styleInstabilityFrames).toBe(1);
    expect(metrics.styleStabilityRatio).toBeCloseTo(11 / 12, 15);
    const player7 = metrics.perEntity.find((entity) => entity.entityId === "player-7")!;
    expect(player7.distinctStyleTokens).toBe(2);
    expect(player7.styleStableFrames).toBe(5);
    expect(player7.styleTokenFrames).toBe(6);
  });
});

describe("measureStyleByteStability — byte-level marker stability", () => {
  function framesWithMarkerGroups(markerBodies: string[]): AnimeFrame[] {
    return markerBodies.map((body, index) => ({
      frameIndex: index,
      outputTimestampMs: (index + 1) * 1_000,
      svg: `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`,
    }));
  }

  test("byte-identical groups across frames (only positions differ) are stable", () => {
    const frames = framesWithMarkerGroups([
      `<g data-entity="p1"><circle cx="100" cy="200" r="12" fill="#3f6fbf" stroke="#f2c94c" stroke-width="3"/><text x="100" y="226">p1</text></g>`,
      `<g data-entity="p1"><circle cx="110" cy="210" r="12" fill="#3f6fbf" stroke="#f2c94c" stroke-width="3"/><text x="110" y="236">p1</text></g>`,
    ]);
    const metrics = measureStyleByteStability(frames);
    expect(metrics.groupFrames).toBe(2);
    expect(metrics.unstableFrames).toBe(0);
    expect(metrics.stabilityRatio).toBe(1);
    expect(metrics.perEntity[0]!.distinctGroups).toBe(1);
  });

  test("confidence-driven opacity differences are NOT instability (stripped)", () => {
    const frames = framesWithMarkerGroups([
      `<g data-entity="p1"><circle cx="100" cy="200" r="12" fill="#3f6fbf" opacity="0.935"/></g>`,
      `<g data-entity="p1"><circle cx="110" cy="210" r="12" fill="#3f6fbf" opacity="0.7"/></g>`,
    ]);
    const metrics = measureStyleByteStability(frames);
    expect(metrics.stabilityRatio).toBe(1);
  });

  test("a jersey color change IS instability (detected byte-level)", () => {
    const frames = framesWithMarkerGroups([
      `<g data-entity="p1"><circle cx="100" cy="200" r="12" fill="#3f6fbf" stroke="#f2c94c" stroke-width="3"/></g>`,
      `<g data-entity="p1"><circle cx="110" cy="210" r="12" fill="#d64f4f" stroke="#f8f4e8" stroke-width="3"/></g>`,
    ]);
    const metrics = measureStyleByteStability(frames);
    expect(metrics.unstableFrames).toBe(1);
    expect(metrics.stabilityRatio).toBe(0.5);
    expect(metrics.perEntity[0]!.distinctGroups).toBe(2);
  });

  test("the clean fixture's SVG frames: 24 marker groups, all stable, ratio 1.0", () => {
    const output = renderW503CleanFixture();
    const metrics = measureStyleByteStability(output.frames);
    expect(metrics.groupFrames).toBe(24); // player-7, player-9, player-out, ball-1 x 6
    expect(metrics.stableFrames).toBe(24);
    expect(metrics.stabilityRatio).toBe(1);
    const ids = metrics.perEntity.map((entity) => entity.entityId);
    expect(ids).toEqual(["player-7", "player-9", "player-out", "ball-1"]);
  });

  test("malformed SVG frame documents fail loud (frames-malformed)", () => {
    try {
      measureStyleByteStability([{ frameIndex: 0, outputTimestampMs: 1_000, svg: "not-an-svg" }]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TemporalEvaluationError);
      expect((error as TemporalEvaluationError).code).toBe("frames-malformed");
      expect((error as TemporalEvaluationError).path).toBe("$.frames[0].svg");
    }
  });
});

describe("measureIdentityFlicker — determinism", () => {
  test("two measurements of the same manifest are deep-equal", () => {
    const manifest = cleanManifest();
    expect(measureIdentityFlicker(manifest)).toEqual(measureIdentityFlicker(manifest));
  });
});
