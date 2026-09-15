/**
 * The W603 motion model under test (`src/interpolate.ts`): deterministic
 * constant-velocity interpolation between consecutive scene specifications
 * with honest discontinuity handling.
 *
 * Deterministic fixtures only (docs/testing/HARNESS.md): explicit
 * milliseconds, no Math.random/Date.now; every pin is hand-derived from the
 * documented model.
 */
import { describe, expect, test } from "bun:test";
import { SceneSpecification } from "@sporta/scene-projection";
import { projectScene } from "@sporta/scene-projection";
import type { SceneSpecification as SceneSpecificationDoc } from "@sporta/scene-projection";
import { buildWorldSnapshot } from "@sporta/testing";
import type { WorldSnapshot } from "@sporta/contracts";
import {
  BALL_INTERPOLATION_BOUND_MPS,
  BALL_MAX_SPEED_MPS,
  PLAYER_INTERPOLATION_BOUND_MPS,
  PLAYER_MAX_SPEED_MPS,
  SPEED_EPSILON_MPS,
  interpolateMatchFrame,
  sceneCutHeldProvenance,
} from "../src/index";
import { buildFixtureSnapshot } from "./helpers";

// ---------------------------------------------------------------------------
// Fixture pairs
// ---------------------------------------------------------------------------

/** The canonical fixture pair: steps 0 and 1 (t = 1000, 2000). */
function fixturePair(): { from: SceneSpecificationDoc; to: SceneSpecificationDoc } {
  return {
    from: projectScene(buildFixtureSnapshot(0)),
    to: projectScene(buildFixtureSnapshot(1)),
  };
}

const CUSTOM_SESSION = "sess-interp";

/**
 * A minimal custom snapshot: full control over the entity list (the
 * football extension is deliberately absent — these pairs test entity
 * motion, not display state).
 */
function customSnapshot(
  atMs: number,
  sequence: number,
  entities: WorldSnapshot["entities"],
): WorldSnapshot {
  return buildWorldSnapshot(
    {
      sessionId: CUSTOM_SESSION,
      watermark: { watermarkMs: atMs, sequence },
      generatedAtMs: 1_736_164_800_000,
      entities,
    },
    99,
  );
}

/** The custom pair exercising every discontinuity + verbatim rule at once. */
function customPair(): { from: SceneSpecificationDoc; to: SceneSpecificationDoc } {
  const from = customSnapshot(1_000, 10, [
    {
      // Moving + heading changes across the pair: position interpolates,
      // heading is carried VERBATIM from the from-spec (never interpolated).
      entityId: "p-1",
      kind: "participant",
      version: 1,
      lastEventTimeMs: 1_000,
      state: {
        pitchPosition: { status: "known", value: { x: 10, y: 10 } },
        heading: { status: "known", value: 0.2 },
      },
    },
    {
      // Confidence changes across the pair: the from-spec's confidence is
      // carried verbatim (never averaged, never invented).
      entityId: "p-2",
      kind: "participant",
      version: 1,
      lastEventTimeMs: 1_000,
      state: {
        pitchPosition: { status: "uncertain", value: { x: 30, y: 30 }, confidence: 0.7 },
      },
    },
    {
      // A teleport: 70 m in 1 s (bound: 12.51 m/s) — HELD, never animated.
      entityId: "p-teleport",
      kind: "participant",
      version: 1,
      lastEventTimeMs: 1_000,
      state: { pitchPosition: { status: "known", value: { x: 10, y: 40 } } },
    },
    {
      // Present in FROM only: held (entity-absent-in-to).
      entityId: "p-vanishing",
      kind: "participant",
      version: 1,
      lastEventTimeMs: 1_000,
      state: { pitchPosition: { status: "known", value: { x: 20, y: 50 } } },
    },
    {
      // The ball: loses its carried height in the to-spec (z mismatch →
      // no z in the interpolated position; the from height slot passes
      // through verbatim).
      entityId: "ball-1",
      kind: "ball",
      version: 1,
      lastEventTimeMs: 1_000,
      state: {
        pitchPosition: { status: "known", value: { x: 50, y: 34 } },
        height: { status: "known", value: 1.0 },
      },
    },
  ]);
  const to = customSnapshot(2_000, 11, [
    {
      entityId: "p-1",
      kind: "participant",
      version: 2,
      lastEventTimeMs: 2_000,
      state: {
        pitchPosition: { status: "known", value: { x: 12, y: 10 } },
        heading: { status: "known", value: 1.0 },
      },
    },
    {
      entityId: "p-2",
      kind: "participant",
      version: 2,
      lastEventTimeMs: 2_000,
      state: {
        pitchPosition: { status: "uncertain", value: { x: 34, y: 30 }, confidence: 0.9 },
      },
    },
    {
      entityId: "p-teleport",
      kind: "participant",
      version: 2,
      lastEventTimeMs: 2_000,
      state: { pitchPosition: { status: "known", value: { x: 80, y: 40 } } },
    },
    {
      // Present in TO only: NOT interpolated into existence — the
      // synthesized scene keeps the from-spec's entity list.
      entityId: "p-appearing",
      kind: "participant",
      version: 1,
      lastEventTimeMs: 2_000,
      state: { pitchPosition: { status: "known", value: { x: 40, y: 55 } } },
    },
    {
      entityId: "ball-1",
      kind: "ball",
      version: 2,
      lastEventTimeMs: 2_000,
      state: { pitchPosition: { status: "known", value: { x: 52, y: 34 } } },
    },
  ]);
  return { from: projectScene(from), to: projectScene(to) };
}

// ---------------------------------------------------------------------------
// The interpolation core
// ---------------------------------------------------------------------------

describe("interpolateMatchFrame — the constant-velocity motion model", () => {
  test("lerp exactness: the striker 60→60.8 m at fractions 0.2/0.5/0.8", () => {
    const { from, to } = fixturePair();
    for (const [fraction, expectedX] of [
      [0.2, 60.16],
      [0.5, 60.4],
      [0.8, 60.64],
    ] as const) {
      const { scene } = interpolateMatchFrame({ from, to, fraction, spanMs: 1_000 });
      const striker = scene.entities.find((entity) => entity.entityId === "striker-9")!;
      expect(striker.position).toEqual({ x: expectedX, y: 30, z: 0 });
    }
  });

  test("the ball's z interpolates when BOTH endpoints carry it (58→58.6, 1.2→1.4)", () => {
    const { from, to } = fixturePair();
    const { scene } = interpolateMatchFrame({ from, to, fraction: 0.5, spanMs: 1_000 });
    const ball = scene.entities.find((entity) => entity.entityId === "ball-1")!;
    // Expected values use the model's exact arithmetic (lerp), so the pins
    // are ulp-exact — the same IEEE-754 expressions, byte-for-byte.
    expect(ball.position).toEqual({
      x: 58 + 0.5 * (58.6 - 58),
      y: 30.5,
      z: 1.2 + 0.5 * (1.4 - 1.2),
    });
  });

  test("z is ABSENT when either endpoint lacks it (never a faked 0, never stale)", () => {
    const { from, to } = customPair();
    const { scene } = interpolateMatchFrame({ from, to, fraction: 0.5, spanMs: 1_000 });
    const ball = scene.entities.find((entity) => entity.entityId === "ball-1")!;
    // x interpolates (50→52 at 0.5 → 51); z does NOT (the to-spec lost it).
    expect(ball.position).toEqual({ x: 51, y: 34 });
    expect("z" in ball.position!).toBe(false);
    // The from-spec's height slot record passes through VERBATIM (the
    // carried-data accounting never drops it).
    expect(ball.height).toEqual({ status: "known", meters: 1 });
  });

  test("heading is carried VERBATIM from the from-spec (never interpolated)", () => {
    const { from, to } = customPair();
    const { scene } = interpolateMatchFrame({ from, to, fraction: 0.9, spanMs: 1_000 });
    const p1 = scene.entities.find((entity) => entity.entityId === "p-1")!;
    // The scene's heading slot record, verbatim from the from-spec: radians
    // 0.2 — NOT the to-spec's 1.0, never blended.
    expect(p1.heading).toEqual({ status: "known", radians: 0.2 });
  });

  test("confidence/status are carried VERBATIM from the from-spec", () => {
    const { from, to } = customPair();
    const { scene } = interpolateMatchFrame({ from, to, fraction: 0.5, spanMs: 1_000 });
    const p2 = scene.entities.find((entity) => entity.entityId === "p-2")!;
    expect(p2.positionStatus).toBe("uncertain");
    expect(p2.positionConfidence).toBe(0.7);
  });

  test("version and lastEventTimeMs are the from-spec's verbatim values", () => {
    const { from, to } = fixturePair();
    const { scene } = interpolateMatchFrame({ from, to, fraction: 0.5, spanMs: 1_000 });
    const striker = scene.entities.find((entity) => entity.entityId === "striker-9")!;
    expect(striker.version).toBe(3); // step 0's version, not step 1's 4
    expect(striker.lastEventTimeMs).toBe(1_000);
  });

  test("every scene block outside entities is the FROM spec's verbatim", () => {
    const { from, to } = fixturePair();
    const { scene } = interpolateMatchFrame({ from, to, fraction: 0.5, spanMs: 1_000 });
    expect(scene.source).toEqual(from.source);
    expect(scene.world).toEqual(from.world);
    expect(scene.scoreClock).toEqual(from.scoreClock);
    expect(scene.cameraSlots).toEqual(from.cameraSlots);
    expect(scene.eventMarkers).toEqual(from.eventMarkers);
    expect(scene.sessionId).toBe(from.sessionId);
    expect(scene.sceneSchemaVersion).toBe(from.sceneSchemaVersion);
    // ...and NEVER the to-spec's display state:
    expect(scene.scoreClock).not.toEqual(to.scoreClock);
  });

  test("the synthesized scene is SCHEMA-VALID (the W601 zod gate)", () => {
    const pairs = [fixturePair(), customPair()];
    for (const { from, to } of pairs) {
      for (const fraction of [0.04, 0.2, 0.5, 0.77, 0.96]) {
        const { scene } = interpolateMatchFrame({ from, to, fraction, spanMs: 1_000 });
        const parsed = SceneSpecification.safeParse(scene);
        expect(parsed.success, `fraction ${fraction}: ${JSON.stringify(scene.entities)}`).toBe(
          true,
        );
      }
    }
  });

  test("purity: the inputs are never mutated; rerun is deep-equal", () => {
    const { from, to } = customPair();
    const fromSnapshot = JSON.stringify(from);
    const toSnapshot = JSON.stringify(to);
    const a = interpolateMatchFrame({ from, to, fraction: 0.5, spanMs: 1_000 });
    const b = interpolateMatchFrame({ from, to, fraction: 0.5, spanMs: 1_000 });
    expect(a.scene).toEqual(b.scene);
    expect(a.entities).toEqual(b.entities);
    expect(JSON.stringify(from)).toBe(fromSnapshot);
    expect(JSON.stringify(to)).toBe(toSnapshot);
    // Fresh objects: no reference sharing with the inputs.
    expect(a.scene).not.toBe(from);
    expect(a.scene.entities[0]).not.toBe(from.entities[0]);
  });
});

// ---------------------------------------------------------------------------
// The discontinuity vocabulary (held, never blended)
// ---------------------------------------------------------------------------

describe("interpolateMatchFrame — honest discontinuity handling", () => {
  test("a disposition change holds the from-spec's VERBATIM position (never blended)", () => {
    // The winger is `projected` on step 2 and unpositioned on step 3.
    const step2 = projectScene(buildFixtureSnapshot(2));
    const snapshot3 = buildFixtureSnapshot(3);
    const unpositioned = snapshot3.entities.map((entity) =>
      entity.entityId === "winger-7"
        ? { ...entity, state: { teamRole: { status: "known" as const, value: "midfielder" } } }
        : entity,
    );
    const step3 = projectScene({ ...snapshot3, entities: unpositioned });
    const { scene, entities } = interpolateMatchFrame({
      from: step2,
      to: step3,
      fraction: 0.6,
      spanMs: 1_000,
    });
    const winger = scene.entities.find((entity) => entity.entityId === "winger-7")!;
    // The from-spec's exact position (40, 21) on the plane (z: 0) — no
    // motion toward "nothing".
    expect(winger.position).toEqual({ x: 40, y: 21, z: 0 });
    expect(winger.disposition).toBe("projected");
    expect(entities.find((entry) => entry.entityId === "winger-7")!.provenance).toEqual({
      positionProvenance: "held",
      heldReason: "disposition-change",
    });
  });

  test("a velocity beyond the physical ceiling holds (a teleport is never animated)", () => {
    const { from, to } = customPair();
    const { scene, entities } = interpolateMatchFrame({
      from,
      to,
      fraction: 0.5,
      spanMs: 1_000,
    });
    const teleporter = scene.entities.find((entity) => entity.entityId === "p-teleport")!;
    expect(teleporter.position).toEqual({ x: 10, y: 40, z: 0 }); // from-spec verbatim
    expect(entities.find((entry) => entry.entityId === "p-teleport")!.provenance).toEqual({
      positionProvenance: "held",
      heldReason: "velocity-bound",
    });
  });

  test("the bound is inclusive: exactly at the ceiling interpolates, above holds", () => {
    const { from, to } = fixturePair();
    // Re-span the same 0.8 m pair so the implied speed sits exactly at the
    // player bound: span = 0.8 / 12.51 s. (0.8 m / 63.949 ms = 12.51 m/s.)
    const spanAtBound = (0.8 / PLAYER_INTERPOLATION_BOUND_MPS) * 1_000;
    const atBound = interpolateMatchFrame({ from, to, fraction: 0.5, spanMs: spanAtBound });
    expect(atBound.entities.find((entry) => entry.entityId === "striker-9")!.provenance).toEqual({
      positionProvenance: "interpolated",
    });
    // One microsecond faster → above the bound → held.
    const above = interpolateMatchFrame({ from, to, fraction: 0.5, spanMs: spanAtBound - 0.001 });
    expect(above.entities.find((entry) => entry.entityId === "striker-9")!.provenance).toEqual({
      positionProvenance: "held",
      heldReason: "velocity-bound",
    });
  });

  test("an entity absent from the to-spec holds its from-spec state", () => {
    const { from, to } = customPair();
    const { scene, entities } = interpolateMatchFrame({ from, to, fraction: 0.5, spanMs: 1_000 });
    const vanishing = scene.entities.find((entity) => entity.entityId === "p-vanishing")!;
    expect(vanishing.position).toEqual({ x: 20, y: 50, z: 0 });
    expect(entities.find((entry) => entry.entityId === "p-vanishing")!.provenance).toEqual({
      positionProvenance: "held",
      heldReason: "entity-absent-in-to",
    });
  });

  test("an entity present only in the to-spec is NOT interpolated into existence", () => {
    const { from, to } = customPair();
    const { scene } = interpolateMatchFrame({ from, to, fraction: 0.5, spanMs: 1_000 });
    expect(scene.entities.map((entity) => entity.entityId)).not.toContain("p-appearing");
  });

  test("an unplaced entity (same disposition) is held with position-missing", () => {
    const { from, to } = fixturePair();
    const { entities } = interpolateMatchFrame({ from, to, fraction: 0.5, spanMs: 1_000 });
    expect(entities.find((entry) => entry.entityId === "bench-12")!.provenance).toEqual({
      positionProvenance: "held",
      heldReason: "position-missing",
    });
    expect(entities.find((entry) => entry.entityId === "team-home")!.provenance).toEqual({
      positionProvenance: "held",
      heldReason: "position-missing",
    });
  });

  test("reason precedence: disposition-change beats position-missing and velocity-bound", () => {
    // The winger both changes disposition AND (vacuously) has no to-position:
    // the disposition change is the reported reason.
    const step2 = projectScene(buildFixtureSnapshot(2));
    const snapshot3 = buildFixtureSnapshot(3);
    const unpositioned = snapshot3.entities.map((entity) =>
      entity.entityId === "winger-7"
        ? { ...entity, state: { teamRole: { status: "known" as const, value: "midfielder" } } }
        : entity,
    );
    const step3 = projectScene({ ...snapshot3, entities: unpositioned });
    const { entities } = interpolateMatchFrame({
      from: step2,
      to: step3,
      fraction: 0.1,
      spanMs: 1_000,
    });
    expect(entities.find((entry) => entry.entityId === "winger-7")!.provenance).toEqual({
      positionProvenance: "held",
      heldReason: "disposition-change",
    });
  });

  test("provenance covers EVERY from-spec entity, in from-spec order (total accounting)", () => {
    const { from, to } = fixturePair();
    const { entities } = interpolateMatchFrame({ from, to, fraction: 0.5, spanMs: 1_000 });
    expect(entities.map((entry) => entry.entityId)).toEqual(from.entities.map((e) => e.entityId));
  });
});

describe("sceneCutHeldProvenance — the declared-cut accounting", () => {
  test("every from-spec entity is held with reason scene-cut, in spec order", () => {
    const scene = projectScene(buildFixtureSnapshot(0));
    const provenance = sceneCutHeldProvenance(scene);
    expect(provenance).toHaveLength(scene.entities.length);
    expect(provenance.map((entry) => entry.entityId)).toEqual(
      scene.entities.map((entity) => entity.entityId),
    );
    for (const entry of provenance) {
      expect(entry.provenance).toEqual({
        positionProvenance: "held",
        heldReason: "scene-cut",
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Fail-loud preconditions
// ---------------------------------------------------------------------------

describe("interpolateMatchFrame — fail-loud preconditions", () => {
  const { from, to } = fixturePair();

  test("fraction must be strictly inside (0, 1)", () => {
    for (const bad of [0, 1, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => interpolateMatchFrame({ from, to, fraction: bad, spanMs: 1_000 })).toThrow(
        /fraction must be a finite number in \(0, 1\)/,
      );
    }
  });

  test("spanMs must be a finite number > 0", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => interpolateMatchFrame({ from, to, fraction: 0.5, spanMs: bad })).toThrow(
        /spanMs must be a finite number > 0/,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The documented bounds
// ---------------------------------------------------------------------------

describe("the interpolation speed bounds (documented derivations)", () => {
  test("player 12.5 m/s (Bolt Berlin 2009: 10.44 avg, ~12.4 peak) + 0.01 epsilon", () => {
    expect(PLAYER_MAX_SPEED_MPS).toBe(12.5);
    expect(SPEED_EPSILON_MPS).toBe(0.01);
    expect(PLAYER_INTERPOLATION_BOUND_MPS).toBe(12.51);
  });

  test("ball 40 m/s (hard-struck football ~130-140 km/h) + 0.01 epsilon", () => {
    expect(BALL_MAX_SPEED_MPS).toBe(40);
    expect(BALL_INTERPOLATION_BOUND_MPS).toBe(40.01);
  });
});
