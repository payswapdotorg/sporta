import { describe, expect, test } from "bun:test";
import { CANONICAL_CAMERA_SLOTS } from "@sporta/scene-projection";
import { cameraFromSlot } from "../src/index";
import {
  LIVE_CAMERA_INITIAL,
  LIVE_CAMERA_MAX_DISTANCE_M,
  LIVE_CAMERA_MIN_DISTANCE_M,
  LIVE_FIGURE_HEIGHT_M,
  applyLiveFrame,
  createLiveSceneState,
  liveCameraEye,
  liveCameraFrame,
  liveCameraReducer,
  livePitchLineSegments,
  projectLiveScene,
} from "../src/index";
import type { LiveCameraState, LiveWorldFrameInput } from "../src/index";

/**
 * THE LIVE 3D VIEW-MODEL ADAPTER TESTS (L013) — the deterministic battery
 * the work item requires, over FIXTURE world frames (the frozen
 * live-reality.md §5 `LiveRenderInput` semantics as delivered on the wire):
 *
 * - THE SCENE-GRAPH/PROJECTION MATH (exact where checkable): fixture
 *   frames apply to identity-continuous scene entities (canonical meters,
 *   honest carries); the projection through a fixture camera yields exact
 *   screen positions, depths and radii (the renderer's OWN camera math —
 *   never a second projection);
 * - CAMERA INTERACTIVITY DURING UPDATES: the camera reducer is a pure
 *   function of user actions (orbit/zoom/pan with documented bounds), and
 *   world-frame application NEVER touches the camera (the two are
 *   independent by construction — the frozen camera rule as code);
 * - UPDATE CONTINUITY: frames keep applying without a restart (the carry
 *   survives; entities appear/are carried honestly; the world version
 *   advances); the camera state survives across arbitrary frame sequences.
 * - THE CAMERA-MODEL EQUIVALENCE: a live camera placed at a canonical
 *   slot's position/target yields the IDENTICAL camera frame as
 *   `cameraFromSlot` — the live camera is the SAME camera model, not a
 *   second one.
 */

// ---------------------------------------------------------------------------
// Fixtures (hand-built wire frames — labeled REAL-vs-FIXTURE: fixtures)
// ---------------------------------------------------------------------------

function fixtureEntity(
  entityRef: string,
  overrides: Partial<LiveWorldFrameInput["entities"][number]> = {},
): LiveWorldFrameInput["entities"][number] {
  return {
    entityRef,
    kind: "PLAYER",
    teamRef: "team-home",
    xMeters: 52.5,
    yMeters: 34,
    detected: true,
    confidence: 0.9,
    staleForMs: 0,
    ...overrides,
  };
}

function fixtureFrame(
  entities: LiveWorldFrameInput["entities"],
  worldVersion: number,
  eventTimeMs = worldVersion * 100,
): LiveWorldFrameInput {
  return {
    worldVersion,
    eventTimeMs,
    quality: "nominal",
    entities,
    eventsSincePreviousFrame: [],
  };
}

/** The camera positioned exactly at a canonical slot (for the equivalence). */
function cameraAtSlot(slotIndex: number): LiveCameraState {
  const slot = CANONICAL_CAMERA_SLOTS[slotIndex]!;
  const eye = slot.position;
  const target = slot.target;
  const distance = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z);
  const elevationDeg = (Math.asin((target.z - eye.z) / -distance) * 180) / Math.PI;
  // eye = target + d·(sin(az)·cos(el), −cos(az)·cos(el), sin(el)):
  // sin(az)·cos(el) = (eye.x − target.x)/d ; −cos(az)·cos(el) = (eye.y − target.y)/d.
  const azimuthRad = Math.atan2(eye.x - target.x, -(eye.y - target.y));
  return {
    azimuthDeg: (azimuthRad * 180) / Math.PI,
    elevationDeg,
    distanceM: distance,
    target: { x: target.x, y: target.y },
  };
}

// ---------------------------------------------------------------------------
// The scene-graph / projection math
// ---------------------------------------------------------------------------

describe("the live scene state (L013 — fixture frames, exact math)", () => {
  test("applies a frame into identity-continuous scene entities (canonical meters)", () => {
    const { state, report } = applyLiveFrame(
      createLiveSceneState(),
      fixtureFrame(
        [
          fixtureEntity("p-home-01", { xMeters: 10.5, yMeters: 17 }),
          fixtureEntity("p-away-07", { teamRef: "team-away", xMeters: 94.5, yMeters: 51 }),
          fixtureEntity("ball-1", { kind: "BALL", teamRef: undefined, xMeters: 52.5, yMeters: 30 }),
        ],
        1,
      ),
    );
    expect(report).toEqual({ worldVersion: 1, updated: 3, carried: 0, appeared: 3 });
    expect(state.worldVersion).toBe(1);
    expect(state.entities.size).toBe(3);
    const home = state.entities.get("p-home-01")!;
    expect(home).toMatchObject({
      kind: "PLAYER",
      teamRef: "team-home",
      xMeters: 10.5,
      yMeters: 17,
      detected: true,
      staleForMs: 0,
    });
    // The pitch-frame coords ride VERBATIM (the canonical 105 × 68 frame —
    // the same frame the scene projection and camera use).
    expect(state.entities.get("ball-1")!.xMeters).toBe(52.5);
  });

  test("an undetected entity is carried at its LAST KNOWN position (honest, marked)", () => {
    let scene = createLiveSceneState();
    scene = applyLiveFrame(
      scene,
      fixtureFrame([fixtureEntity("p-home-05", { xMeters: 20, yMeters: 40 })], 1),
    ).state;
    const carried = applyLiveFrame(
      scene,
      fixtureFrame(
        [
          fixtureEntity("p-home-05", {
            detected: false,
            confidence: 0.3,
            staleForMs: 250,
            // The wire's undetected row repeats the LAST KNOWN position —
            // the carry keeps it verbatim either way.
            xMeters: 20,
            yMeters: 40,
          }),
        ],
        2,
      ),
    );
    expect(carried.report).toEqual({ worldVersion: 2, updated: 0, carried: 1, appeared: 0 });
    const entity = carried.state.entities.get("p-home-05")!;
    expect(entity.detected).toBe(false);
    expect(entity.staleForMs).toBe(250);
    expect(entity.confidence).toBe(0.3);
    expect(entity.xMeters).toBe(20);
    expect(entity.yMeters).toBe(40);
    // Identity continuity: the SAME ref (never a removal).
    expect(carried.state.entities.size).toBe(1);
  });

  test("update continuity: frames keep applying without a restart; the version advances", () => {
    let scene = createLiveSceneState();
    for (let version = 1; version <= 50; version += 1) {
      const applied = applyLiveFrame(
        scene,
        fixtureFrame(
          [
            fixtureEntity("p-home-01", { xMeters: 10 + version * 0.5, yMeters: 30 }),
            fixtureEntity("ball-1", {
              kind: "BALL",
              teamRef: undefined,
              xMeters: 50 + Math.sin(version / 5) * 10,
              yMeters: 34,
            }),
          ],
          version,
        ),
      );
      expect(applied.state.worldVersion).toBe(version);
      scene = applied.state;
    }
    expect(scene.entities.get("p-home-01")!.xMeters).toBeCloseTo(35, 10);
    // The full history of applications never reset the carry.
    expect(scene.entities.size).toBe(2);
  });
});

describe("the projection math (L013 — the renderer's own camera functions)", () => {
  const CANVAS = { width: 1280, height: 720 } as const;

  test("the pitch center projects to the canvas center (target-looked camera)", () => {
    const scene = applyLiveFrame(
      createLiveSceneState(),
      fixtureFrame(
        [
          // A PLAYER's base sits ON the ground plane — the exact point the
          // camera targets — so its base projects to the canvas center.
          fixtureEntity("p-home-01", { xMeters: 52.5, yMeters: 34 }),
          fixtureEntity("ball-1", { kind: "BALL", teamRef: undefined, xMeters: 52.5, yMeters: 34 }),
        ],
        1,
      ),
    ).state;
    const projected = projectLiveScene(scene, LIVE_CAMERA_INITIAL, CANVAS);
    // The camera looks AT the pitch center: (52.5, 34, 0) lands at the
    // canvas center (640, 360) — the perspective divide of the look-at point.
    const player = projected.entities.find((entity) => entity.entityRef === "p-home-01")!;
    expect(player.base.x).toBeCloseTo(640, 6);
    expect(player.base.y).toBeCloseTo(360, 6);
    // The ball's base rides ABOVE the ground (its center height) — a hair
    // above center on screen, and its billboard top above that.
    const ball = projected.entities.find((entity) => entity.entityRef === "ball-1")!;
    expect(ball.base.y).toBeLessThan(360);
    expect(ball.head.y).toBeLessThan(ball.base.y);
    // The ground polygon + the canonical markings are all drawable.
    expect(projected.pitch.points.length).toBeGreaterThanOrEqual(3);
    expect(projected.lines.length).toBeGreaterThan(20);
  });

  test("the depth + radius math is the renderer's own (exact where checkable)", () => {
    const scene = applyLiveScene(
      createLiveSceneState(),
      fixtureFrame(
        [
          fixtureEntity("p-home-01", { xMeters: 52.5, yMeters: 34 }),
          fixtureEntity("ball-1", {
            kind: "BALL",
            teamRef: undefined,
            xMeters: 52.5,
            yMeters: 34,
          }),
        ],
        1,
      ),
    ).state;
    const projected = projectLiveScene(scene, LIVE_CAMERA_INITIAL, CANVAS);
    const player = projected.entities.find((entity) => entity.entityRef === "p-home-01")!;
    const ball = projected.entities.find((entity) => entity.entityRef === "ball-1")!;
    // The player's base sits AT the camera's target → its depth IS the
    // orbit distance; the ball's elevated base (z = 0.11 m) is a hair
    // CLOSER along the forward axis (the honest geometry of the billboard).
    expect(player.depthMeters).toBeCloseTo(62, 9);
    expect(ball.depthMeters).toBeLessThan(player.depthMeters);
    // The player's billboard top is the figure height above the base.
    expect(LIVE_FIGURE_HEIGHT_M).toBe(1.82);
    // At broadcast distance the ball's raw radius (512·0.11/62 ≈ 0.9 px)
    // is BELOW the documented readability floor — it reads at the floor
    // (2.5 px), while the player (512·0.31/62 ≈ 2.56 px) reads true.
    expect(ball.radiusPx).toBe(2.5);
    expect(player.radiusPx).toBeCloseTo((512 * 0.31) / 62, 5);
    // Up close (a 15 m orbit), both radii read TRUE and follow
    // `projectedRadius` (r_screen ≈ f·r/depth): the player's shoulder
    // half-width (0.31 m) vs the ball's radius (0.11 m) — the ~2.8× ratio,
    // within the 2-decimal serialization rounding and the ball's slightly
    // smaller depth (its elevated base is closer to the camera).
    const closeCamera = { ...LIVE_CAMERA_INITIAL, distanceM: 15, target: { x: 52.5, y: 34 } };
    const closeUp = projectLiveScene(scene, closeCamera, CANVAS);
    const closePlayer = closeUp.entities.find((entity) => entity.entityRef === "p-home-01")!;
    const closeBall = closeUp.entities.find((entity) => entity.entityRef === "ball-1")!;
    expect(closePlayer.radiusPx).toBeCloseTo((512 * 0.31) / 15, 1);
    expect(closeBall.radiusPx).toBeGreaterThan(2.5); // above the floor up close
    expect(closePlayer.radiusPx / closeBall.radiusPx).toBeCloseTo(0.31 / 0.11, 1);
    // An entity behind the camera is omitted (never half-drawn).
    const behindCamera = projectLiveScene(
      applyLiveFrame(
        createLiveSceneState(),
        fixtureFrame([fixtureEntity("p-home-99", { xMeters: 52.5, yMeters: -90 })], 1),
      ).state,
      // A camera AT the entity's position looking away: the near plane
      // omits the figure entirely.
      {
        azimuthDeg: 0,
        elevationDeg: 10,
        distanceM: 40,
        target: { x: 52.5, y: 50 },
      },
      CANVAS,
    );
    expect(behindCamera.entities).toHaveLength(0);
  });

  test("determinism: the same scene + camera → the identical projection", () => {
    const scene = applyLiveFrame(
      createLiveSceneState(),
      fixtureFrame(
        [
          fixtureEntity("p-home-01", { xMeters: 30, yMeters: 20 }),
          fixtureEntity("p-away-02", { teamRef: "team-away", xMeters: 80, yMeters: 50 }),
        ],
        1,
      ),
    ).state;
    const a = projectLiveScene(scene, LIVE_CAMERA_INITIAL, CANVAS);
    const b = projectLiveScene(scene, LIVE_CAMERA_INITIAL, CANVAS);
    expect(a).toEqual(b);
  });

  test("the canonical pitch line set is the IFAB Law 1 markings (exact segment count)", () => {
    const segments = livePitchLineSegments();
    // 4 boundary + 1 halfway + 64 center-circle + per side (3 penalty + 3
    // goal-area + 8 spot) × 2 sides = 69 + 28 = 97.
    expect(segments).toHaveLength(4 + 1 + 64 + 2 * (3 + 3 + 8));
    // The boundary corners are exact.
    expect(segments[0]).toEqual({ a: { x: 0, y: 0, z: 0 }, b: { x: 105, y: 0, z: 0 } });
    expect(segments[3]).toEqual({ a: { x: 0, y: 68, z: 0 }, b: { x: 0, y: 0, z: 0 } });
  });
});

// ---------------------------------------------------------------------------
// Camera interactivity during updates (the frozen camera rule as code)
// ---------------------------------------------------------------------------

describe("the interactive camera (L013)", () => {
  test("the reducer is pure with documented bounds (orbit/zoom/pan)", () => {
    const state = LIVE_CAMERA_INITIAL;
    // Orbit: azimuth wraps, elevation clamps at the bounds.
    const orbited = liveCameraReducer(state, {
      kind: "orbit",
      deltaAzimuthDeg: 30,
      deltaElevationDeg: 10,
    });
    expect(orbited.azimuthDeg).toBeCloseTo(30, 12);
    expect(orbited.elevationDeg).toBeCloseTo(38, 12);
    const wrapped = liveCameraReducer(orbited, {
      kind: "orbit",
      deltaAzimuthDeg: 200,
      deltaElevationDeg: 0,
    });
    expect(wrapped.azimuthDeg).toBeCloseTo(-130, 12);
    const clamped = liveCameraReducer(state, {
      kind: "orbit",
      deltaAzimuthDeg: 0,
      deltaElevationDeg: -500,
    });
    expect(clamped.elevationDeg).toBe(2);
    // Zoom: divides the distance, clamped both ways.
    const zoomedIn = liveCameraReducer(state, { kind: "zoom", factor: 2 });
    expect(zoomedIn.distanceM).toBeCloseTo(31, 12);
    const clampedNear = liveCameraReducer(zoomedIn, { kind: "zoom", factor: 100 });
    expect(clampedNear.distanceM).toBe(LIVE_CAMERA_MIN_DISTANCE_M);
    const clampedFar = liveCameraReducer(state, { kind: "zoom", factor: 0.0001 });
    expect(clampedFar.distanceM).toBe(LIVE_CAMERA_MAX_DISTANCE_M);
    // A non-positive zoom factor is a no-op (the same state).
    expect(liveCameraReducer(state, { kind: "zoom", factor: 0 })).toEqual(state);
    expect(liveCameraReducer(state, { kind: "zoom", factor: -3 })).toEqual(state);
    // Pan: moves the target along the camera-relative basis, clamped to
    // the pitch + apron.
    const panned = liveCameraReducer(state, { kind: "pan", deltaX: 10, deltaY: 0 });
    expect(panned.target.y).toBeCloseTo(state.target.y, 6);
    expect(panned.target.x).toBeCloseTo(state.target.x + 10 * 0.62, 5);
    const pannedFar = liveCameraReducer(state, { kind: "pan", deltaX: 0, deltaY: 10_000 });
    expect(pannedFar.target.y).toBe(68 + 12); // the apron bound
  });

  test("the eye derivation is exact (the documented orbit formula)", () => {
    const eye = liveCameraEye(LIVE_CAMERA_INITIAL);
    // az=0, el=28°, d=62, target (52.5, 34): eye = target + 62·(0, −cos28°, sin28°).
    expect(eye.x).toBeCloseTo(52.5, 12);
    expect(eye.y).toBeCloseTo(34 - 62 * Math.cos((28 * Math.PI) / 180), 10);
    expect(eye.z).toBeCloseTo(62 * Math.sin((28 * Math.PI) / 180), 10);
    // At azimuth 90°: the eye moves to the +x side.
    const side = liveCameraEye({ ...LIVE_CAMERA_INITIAL, azimuthDeg: 90 });
    expect(side.x).toBeCloseTo(52.5 + 62 * Math.cos((28 * Math.PI) / 180), 10);
    expect(side.y).toBeCloseTo(34, 12);
  });

  test("CAMERA-MODEL EQUIVALENCE: a live camera at a canonical slot = cameraFromSlot", () => {
    // The ground-targeted canonical slots (main-touchline,
    // opposite-touchline, aerial-tactical): a live camera placed at the
    // slot's eye/target yields the IDENTICAL frame as `cameraFromSlot` —
    // the same camera model, never a second one. (The behind-goal slots
    // aim at the 1.22 m goal-center height; the interactive camera orbits
    // a GROUND target by design — an honest documented difference, not an
    // equivalence claim.)
    for (const slotIndex of [0, 1, 4]) {
      const slot = CANONICAL_CAMERA_SLOTS[slotIndex]!;
      const liveFrame = liveCameraFrame(cameraAtSlot(slotIndex));
      const canonicalFrame = cameraFromSlot(slot);
      expect(liveFrame.eye.x).toBeCloseTo(canonicalFrame.eye.x, 9);
      expect(liveFrame.eye.y).toBeCloseTo(canonicalFrame.eye.y, 9);
      expect(liveFrame.eye.z).toBeCloseTo(canonicalFrame.eye.z, 9);
      expect(liveFrame.forward.x).toBeCloseTo(canonicalFrame.forward.x, 9);
      expect(liveFrame.forward.y).toBeCloseTo(canonicalFrame.forward.y, 9);
      expect(liveFrame.forward.z).toBeCloseTo(canonicalFrame.forward.z, 9);
      expect(liveFrame.right.x).toBeCloseTo(canonicalFrame.right.x, 9);
      expect(liveFrame.right.y).toBeCloseTo(canonicalFrame.right.y, 9);
      expect(liveFrame.right.z).toBeCloseTo(canonicalFrame.right.z, 9);
      expect(liveFrame.up.x).toBeCloseTo(canonicalFrame.up.x, 9);
      expect(liveFrame.up.y).toBeCloseTo(canonicalFrame.up.y, 9);
      expect(liveFrame.up.z).toBeCloseTo(canonicalFrame.up.z, 9);
    }
  });

  test("camera interactivity DURING updates: world frames never touch the camera", () => {
    let camera = LIVE_CAMERA_INITIAL;
    let scene = createLiveSceneState();
    // Interleave: user actions + world frames, in every order.
    for (let version = 1; version <= 30; version += 1) {
      scene = applyLiveFrame(
        scene,
        fixtureFrame(
          [
            fixtureEntity("p-home-01", { xMeters: 10 + version * 0.4, yMeters: 30 }),
            fixtureEntity("ball-1", {
              kind: "BALL",
              teamRef: undefined,
              xMeters: 40 + version * 0.3,
              yMeters: 34,
            }),
          ],
          version,
        ),
      ).state;
      camera = liveCameraReducer(camera, {
        kind: "orbit",
        deltaAzimuthDeg: 2,
        deltaElevationDeg: version % 2 === 0 ? 0.5 : -0.5,
      });
      if (version % 5 === 0) {
        camera = liveCameraReducer(camera, { kind: "zoom", factor: 1.05 });
      }
    }
    // The world kept flowing (30 versions applied).
    expect(scene.worldVersion).toBe(30);
    expect(scene.entities.get("p-home-01")!.xMeters).toBeCloseTo(22, 10);
    // The camera kept moving by USER intent ONLY: the orbit accumulated
    // exactly 30 × 2° (wrapped), the zooms exactly 6 × 1.05, and the
    // elevation oscillated back to its start (15 × +0.5 then 15 × −0.5).
    expect(camera.azimuthDeg).toBeCloseTo(((((60 + 180) % 360) + 360) % 360) - 180, 9);
    expect(camera.elevationDeg).toBeCloseTo(28, 9);
    expect(camera.distanceM).toBeCloseTo(62 / Math.pow(1.05, 6), 9);
    // The projections respond to BOTH independently: the entity's screen
    // position differs between the initial camera and the moved one.
    const before = projectLiveScene(scene, LIVE_CAMERA_INITIAL, { width: 1280, height: 720 });
    const after = projectLiveScene(scene, camera, { width: 1280, height: 720 });
    const beforeBall = before.entities.find((entity) => entity.entityRef === "ball-1")!;
    const afterBall = after.entities.find((entity) => entity.entityRef === "ball-1")!;
    expect(
      Math.hypot(afterBall.base.x - beforeBall.base.x, afterBall.base.y - beforeBall.base.y),
    ).toBeGreaterThan(1);
  });
});

/** Applies a fixture frame (the local shorthand for the continuity suite). */
function applyLiveScene(
  state: ReturnType<typeof createLiveSceneState>,
  frame: LiveWorldFrameInput,
) {
  return applyLiveFrame(state, frame);
}
