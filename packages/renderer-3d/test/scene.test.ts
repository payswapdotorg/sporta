import { describe, expect, test } from "bun:test";
import { projectScene } from "@sporta/scene-projection";
import { CANONICAL_CAMERA_SLOTS } from "@sporta/scene-projection";
import type { SceneCameraSlot, SceneSpecification } from "@sporta/scene-projection";
import { buildWorldSnapshot } from "@sporta/testing";
import {
  GROUND_CIRCLE_SEGMENTS,
  HUD_HEIGHT,
  OVERHEAD_FORWARD_Z,
  inDrawableRegion,
  resolve3dFrame,
} from "../src/index";
import type { AvatarDrawable, BallDrawable, EntityDrawable } from "../src/index";
import { buildFixtureSnapshot } from "./helpers";

const MAIN_SLOT = CANONICAL_CAMERA_SLOTS[0]!;
const AERIAL_SLOT = CANONICAL_CAMERA_SLOTS[4]!;
const CANVAS = { width: 1280, height: 720 };

/**
 * Type-guard find helpers: TS cannot narrow the `EntityDrawable` union
 * through a plain `find` predicate, so the guards carry the narrowing.
 */
function findAvatar(entities: EntityDrawable[], entityId: string): AvatarDrawable {
  return entities.find(
    (entity): entity is AvatarDrawable => entity.type === "avatar" && entity.entityId === entityId,
  )!;
}

function findBall(entities: EntityDrawable[], entityId: string): BallDrawable {
  return entities.find(
    (entity): entity is BallDrawable => entity.type === "ball" && entity.entityId === entityId,
  )!;
}

/** The fixture's projected scene (step 0). */
function fixtureScene(): SceneSpecification {
  return projectScene(buildFixtureSnapshot(0));
}

/** A one-entity scene for near-plane geometry probes (uncertain position). */
function nearScene(entityId: string, x: number, y: number): SceneSpecification {
  const snapshot = buildWorldSnapshot(
    {
      sessionId: "sess-near",
      watermark: { watermarkMs: 1_000, sequence: 1 },
      generatedAtMs: 1_736_164_800_000,
      entities: [
        {
          entityId,
          kind: "participant",
          version: 1,
          lastEventTimeMs: 1_000,
          state: {
            pitchPosition: { status: "uncertain", value: { x, y }, confidence: 0.7 },
          },
        },
      ],
      football: {
        pitch: {
          lengthAxisMeters: 105,
          widthAxisMeters: 68,
          origin: "corner",
          axes: "x=touchline, y=goal-line",
        },
        clock: { period: "first-half", clockMs: 0, stoppage: false },
        score: { home: 0, away: 0, status: { status: "known", value: "confirmed" } },
        possession: { status: "unknown" },
        eventTaxonomyVersion: "v1",
      },
    },
    777,
  );
  return projectScene(snapshot);
}

/** A one-ball scene with a carried height, for near-plane shadow probes. */
function nearBallScene(x: number, y: number, height: number): SceneSpecification {
  const snapshot = buildWorldSnapshot(
    {
      sessionId: "sess-near",
      watermark: { watermarkMs: 1_000, sequence: 1 },
      generatedAtMs: 1_736_164_800_000,
      entities: [
        {
          entityId: "ball-near",
          kind: "ball",
          version: 1,
          lastEventTimeMs: 1_000,
          state: {
            pitchPosition: { status: "known", value: { x, y } },
            height: { status: "known", value: height },
          },
        },
      ],
      football: {
        pitch: {
          lengthAxisMeters: 105,
          widthAxisMeters: 68,
          origin: "corner",
          axes: "x=touchline, y=goal-line",
        },
        clock: { period: "first-half", clockMs: 0, stoppage: false },
        score: { home: 0, away: 0, status: { status: "known", value: "confirmed" } },
        possession: { status: "unknown" },
        eventTaxonomyVersion: "v1",
      },
    },
    778,
  );
  return projectScene(snapshot);
}

/** A camera slot object with custom geometry (a valid spec can carry any). */
function slot(
  position: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
): SceneCameraSlot {
  return {
    slotId: "main-touchline",
    position,
    target,
    derivation: "test geometry",
  };
}

describe("resolve3dFrame — the fixture through the main-touchline slot", () => {
  const frame = resolve3dFrame({ scene: fixtureScene(), cameraSlot: MAIN_SLOT, canvas: CANVAS });

  test("hand-verified projections: striker (705.63, 371.24) depth 58.51", () => {
    const striker = frame.manifestEntities.find((entry) => entry.entityId === "striker-9")!;
    expect(striker.renderDisposition).toBe("rendered");
    expect(striker.sceneDisposition).toBe("projected");
    expect(striker.screenPosition).toEqual({ x: 705.63, y: 371.24 });
    expect(striker.depthMeters).toBe(58.51);
    expect(striker.positionMeters).toEqual({ x: 60, y: 30, z: 0 });
    expect(striker.headingCarried).toBe(true);
    expect(striker.headingRadians).toBe(0.6);
    expect(striker.style).toEqual({ paletteIndex: 4, jersey: "#9b5de5", trim: "#ffd23f" });
    expect(striker.styleKind).toBe("identity");
    expect(striker.version).toBe(3); // verbatim, NOT a style input
  });

  test("the winger (uncertain) renders with a halo and its verbatim confidence", () => {
    const winger = frame.manifestEntities.find((entry) => entry.entityId === "winger-7")!;
    expect(winger.renderDisposition).toBe("rendered");
    expect(winger.screenPosition).toEqual({ x: 509.49, y: 406.93 });
    expect(winger.positionStatus).toBe("uncertain");
    expect(winger.positionConfidence).toBe(0.7);
    const drawable = findAvatar(frame.entities, "winger-7");
    expect(drawable.halo).not.toBeNull();
    expect(drawable.halo).toHaveLength(GROUND_CIRCLE_SEGMENTS);
    expect(drawable.opacity).toBe(0.805); // 0.35 + 0.65·0.7
  });

  test("disposition passthrough: omitted-no-position / not-rendered-kind, never placed", () => {
    const bench = frame.manifestEntities.find((entry) => entry.entityId === "bench-12")!;
    expect(bench.sceneDisposition).toBe("omitted-no-position");
    expect(bench.renderDisposition).toBe("omitted-no-position");
    expect(bench.positionMeters).toBeUndefined();
    expect(bench.screenPosition).toBeUndefined();
    const team = frame.manifestEntities.find((entry) => entry.entityId === "team-home")!;
    expect(team.sceneDisposition).toBe("not-projected-kind");
    expect(team.renderDisposition).toBe("not-rendered-kind");
    expect(frame.entities.some((entity) => entity.entityId === "bench-12")).toBe(false);
    expect(frame.entities.some((entity) => entity.entityId === "team-home")).toBe(false);
  });

  test("the official renders with the fixed uniform style (official-fixed, no token)", () => {
    const official = frame.manifestEntities.find((entry) => entry.entityId === "official-1")!;
    expect(official.renderDisposition).toBe("rendered");
    expect(official.screenPosition).toEqual({ x: 640, y: 341.18 });
    expect(official.styleKind).toBe("official-fixed");
    expect(official.style).toBeUndefined();
    const drawable = findAvatar(frame.entities, "official-1");
    expect(drawable.style).toEqual({ paletteIndex: 8, jersey: "#22223b", trim: "#ffd166" });
  });

  test("out-of-play honesty: the outlier draws at its TRUE position (never clamped)", () => {
    const outlier = frame.manifestEntities.find((entry) => entry.entityId === "outlier-8")!;
    expect(outlier.sceneDisposition).toBe("projected-out-of-bounds");
    expect(outlier.renderDisposition).toBe("rendered-out-of-play");
    expect(outlier.positionMeters).toEqual({ x: 112.5, y: 34, z: 0 }); // TRUE, verbatim
    expect(outlier.screenPosition).toEqual({ x: 1133.12, y: 360 });
    const drawable = findAvatar(frame.entities, "outlier-8");
    expect(drawable.outOfPlay).toBe(true);
    expect(drawable.figure).toBeNull(); // marker posture, never a styled figure
    expect(drawable.topView).toBeNull();
  });

  test("off-canvas honesty: the corner player is omitted, TRUE position verbatim", () => {
    const corner = frame.manifestEntities.find((entry) => entry.entityId === "corner-player")!;
    expect(corner.sceneDisposition).toBe("projected");
    expect(corner.renderDisposition).toBe("omitted-off-canvas");
    expect(corner.positionMeters).toEqual({ x: 0, y: 0, z: 0 });
    expect(corner.screenPosition).toBeUndefined();
  });

  test("the ball: rendered with carried height (shadow + drop line), confidence verbatim", () => {
    const ball = frame.manifestEntities.find((entry) => entry.entityId === "ball-1")!;
    expect(ball.renderDisposition).toBe("rendered");
    expect(ball.positionMeters).toEqual({ x: 58, y: 30.5, z: 1.2 });
    expect(ball.heightCarried).toBe(true);
    expect(ball.positionConfidence).toBe(0.9);
    expect(ball.styleKind).toBe("ball-fixed");
    const drawable = findBall(frame.entities, "ball-1");
    expect(drawable.heightCarried).toBe(true);
    expect(drawable.shadow).not.toBeNull();
    expect(drawable.dropTo).not.toBeNull();
    expect(drawable.opacity).toBe(0.935);
    // The ball draws ABOVE its ground point (the elevated center projects
    // higher on screen than the ground).
    expect(drawable.center.y).toBeLessThan(drawable.dropTo!.y);
  });

  test("possession: the ring displays around the rendered striker, verbatim slot", () => {
    expect(frame.possession).toEqual({
      status: "uncertain",
      entityId: "striker-9",
      confidence: 0.72,
      displayed: true,
    });
    expect(frame.possessionDrawable).not.toBeNull();
    expect(frame.possessionDrawable!.entityId).toBe("striker-9");
  });

  test("depth sort: painter's order far → near, spec order on ties", () => {
    const depths = frame.entities.map((entity) => entity.depth);
    for (let i = 1; i < depths.length; i += 1) {
      expect(depths[i]!).toBeLessThanOrEqual(depths[i - 1]!);
    }
  });

  test("the manifest keeps SPEC order (never re-sorted)", () => {
    expect(frame.manifestEntities.map((entry) => entry.entityId)).toEqual([
      "striker-9",
      "winger-7",
      "bench-12",
      "official-1",
      "outlier-8",
      "corner-player",
      "team-home",
      "ball-1",
    ]);
  });

  test("total accounting: every spec entity appears exactly once", () => {
    const scene = fixtureScene();
    expect(frame.manifestEntities).toHaveLength(scene.entities.length);
  });

  test("billboard mode from main-touchline (not overhead): figures, not footprints", () => {
    expect(frame.topView).toBe(false);
    const striker = findAvatar(frame.entities, "striker-9");
    expect(striker.figure).not.toBeNull();
    expect(striker.figure!.facing).not.toBeNull(); // heading 0.6 carried
    expect(striker.figure!.legs).toHaveLength(4);
    expect(striker.figure!.torso).toHaveLength(4);
    expect(striker.topView).toBeNull();
    expect(striker.facingDashed).toBe(false); // heading status "known"
  });
});

describe("resolve3dFrame — the aerial-tactical slot (top view)", () => {
  const frame = resolve3dFrame({ scene: fixtureScene(), cameraSlot: AERIAL_SLOT, canvas: CANVAS });

  test("the nadir camera classifies as overhead (forward.z ≤ −0.75)", () => {
    expect(frame.camera.forward.z).toBeLessThanOrEqual(OVERHEAD_FORWARD_Z);
    expect(frame.topView).toBe(true);
  });

  test("hand-verified nadir projections (pitch center at screen center)", () => {
    const striker = frame.manifestEntities.find((entry) => entry.entityId === "striker-9")!;
    // screen = (640 + 512·(x−52.5)/60, 360 − 512·(y−34)/60) for z = 0.
    expect(striker.screenPosition).toEqual({ x: 704, y: 394.13 });
    const official = frame.manifestEntities.find((entry) => entry.entityId === "official-1")!;
    expect(official.screenPosition).toEqual({ x: 640, y: 291.73 });
  });

  test("the corner player RENDERS from above (it was off-canvas from the touchline)", () => {
    const corner = frame.manifestEntities.find((entry) => entry.entityId === "corner-player")!;
    expect(corner.renderDisposition).toBe("rendered");
    expect(corner.screenPosition).toEqual({ x: 192, y: 650.13 });
  });

  test("top-view markers: footprints with ground facing wedges, no billboards", () => {
    const striker = findAvatar(frame.entities, "striker-9");
    expect(striker.topView).not.toBeNull();
    expect(striker.topView!.circle).toHaveLength(GROUND_CIRCLE_SEGMENTS);
    expect(striker.topView!.facing).not.toBeNull();
    expect(striker.figure).toBeNull();
  });

  test("the elevated ball's drop line still grounds it from above", () => {
    const ball = findBall(frame.entities, "ball-1");
    expect(ball.heightCarried).toBe(true);
    // Nadir camera: elevation shortens the depth (60 − 1.2), the ball
    // projects at its (x, y) ground position, slightly scaled.
    expect(ball.center).toEqual({ x: 687.89, y: 390.48 });
  });
});

describe("resolve3dFrame — the whole-figure near-plane guarantee (the fixed crash class)", () => {
  test("an entity whose body crosses the near plane is omitted WHOLE (was a RangeError)", () => {
    // Eye (50, 30, 0.5) → target (50.6, 30, 0): the entity's torso top
    // (1.5 m above a 0.5 m camera looking down) is BEHIND the camera.
    // Before the fix this crashed resolve3dFrame with a RangeError from a
    // mustProject call (first the halo ring, then the figure quads).
    const nearSlot = slot({ x: 50, y: 30, z: 0.5 }, { x: 50.6, y: 30, z: 0 });
    const frame = resolve3dFrame({
      scene: nearScene("near-player", 50.6, 30),
      cameraSlot: nearSlot,
      canvas: CANVAS,
    });
    const entry = frame.manifestEntities[0]!;
    expect(entry.renderDisposition).toBe("omitted-behind-camera");
    expect(entry.positionMeters).toEqual({ x: 50.6, y: 30, z: 0 }); // TRUE, verbatim
    expect(entry.screenPosition).toBeUndefined(); // drawn dispositions only
    expect(entry.depthMeters).toBeUndefined();
    expect(frame.entities).toHaveLength(0);
  });

  test("a base behind the near plane is omitted (the original rule)", () => {
    const nearSlot = slot({ x: 50, y: 30, z: 0.8 }, { x: 51.6, y: 30, z: 0 });
    // Entity 0.1 m in front of the eye along x: forward ≈ (0.894, 0, −0.447),
    // cam z = 0.1·0.894 + 0.8·0.447 ≈ 0.447 < 0.5.
    const frame = resolve3dFrame({
      scene: nearScene("too-close", 50.1, 30),
      cameraSlot: nearSlot,
      canvas: CANVAS,
    });
    expect(frame.manifestEntities[0]!.renderDisposition).toBe("omitted-behind-camera");
    expect(frame.manifestEntities[0]!.screenPosition).toBeUndefined();
  });

  test("a drawn figure with a PARTIALLY-clipped halo ring (near-plane annotation clip)", () => {
    // Eye (50, 30, 0.45) → target (55, 30, 1.5): an upward-tilted close-up.
    // Every figure point is in front (whole-figure check passes) while the
    // halo ring's far side crosses behind the near plane — the ring is
    // CLIPPED, not crashed (the annotation near-plane rule).
    const nearSlot = slot({ x: 50, y: 30, z: 0.45 }, { x: 55, y: 30, z: 1.5 });
    const frame = resolve3dFrame({
      scene: nearScene("halo-player", 51.1, 30),
      cameraSlot: nearSlot,
      canvas: CANVAS,
    });
    const entry = frame.manifestEntities[0]!;
    expect(entry.renderDisposition).toBe("rendered");
    const drawable = findAvatar(frame.entities, "halo-player");
    expect(drawable.halo).not.toBeNull();
    expect(drawable.halo!.length).toBe(11); // 12 − 3 behind + 2 crossings
    expect(drawable.halo!.length).toBeLessThan(GROUND_CIRCLE_SEGMENTS);
  });

  test("an elevated ball close to the camera keeps a CLIPPED shadow ring", () => {
    // Eye (50.06, 30, 0.25) → target (51, 30, 0): the ball's ground ring
    // crosses the near plane while the ball itself is drawn.
    const nearSlot = slot({ x: 50.06, y: 30, z: 0.25 }, { x: 51, y: 30, z: 0 });
    const frame = resolve3dFrame({
      scene: nearBallScene(50.6, 30, 0.25),
      cameraSlot: nearSlot,
      canvas: CANVAS,
    });
    const entry = frame.manifestEntities[0]!;
    expect(entry.renderDisposition).toBe("rendered");
    expect(entry.heightCarried).toBe(true);
    const drawable = findBall(frame.entities, "ball-near");
    expect(drawable.shadow).not.toBeNull();
    expect(drawable.shadow!.length).toBeLessThan(GROUND_CIRCLE_SEGMENTS);
    expect(drawable.shadow!.length).toBeGreaterThanOrEqual(3);
  });

  test("near-band resolution is deterministic (rerun deep-equal)", () => {
    const nearSlot = slot({ x: 50, y: 30, z: 0.45 }, { x: 55, y: 30, z: 1.5 });
    const scene = nearScene("halo-player", 51.1, 30);
    const a = resolve3dFrame({ scene, cameraSlot: nearSlot, canvas: CANVAS });
    const b = resolve3dFrame({ scene, cameraSlot: nearSlot, canvas: CANVAS });
    expect(a).toEqual(b);
  });
});

describe("resolve3dFrame — purity + misc", () => {
  test("the input scene is never mutated", () => {
    const scene = fixtureScene();
    const before = JSON.stringify(scene);
    resolve3dFrame({ scene, cameraSlot: MAIN_SLOT, canvas: CANVAS });
    expect(JSON.stringify(scene)).toBe(before);
  });

  test("the camera slot is carried verbatim in the resolved frame", () => {
    const frame = resolve3dFrame({ scene: fixtureScene(), cameraSlot: MAIN_SLOT, canvas: CANVAS });
    expect(frame.slot).toEqual(MAIN_SLOT);
    expect(frame.camera.eye).toEqual(MAIN_SLOT.position);
  });

  test("inDrawableRegion bounds the drawable region below the HUD band", () => {
    expect(HUD_HEIGHT).toBe(64);
    expect(inDrawableRegion({ x: 0, y: HUD_HEIGHT }, CANVAS)).toBe(true);
    expect(inDrawableRegion({ x: 1280, y: 720 }, CANVAS)).toBe(true);
    expect(inDrawableRegion({ x: 0, y: HUD_HEIGHT - 1 }, CANVAS)).toBe(false);
    expect(inDrawableRegion({ x: -0.01, y: 400 }, CANVAS)).toBe(false);
    expect(inDrawableRegion({ x: 1280.01, y: 400 }, CANVAS)).toBe(false);
    expect(inDrawableRegion({ x: 640, y: 720.01 }, CANVAS)).toBe(false);
  });
});
