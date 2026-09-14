/**
 * Scene specification schema tests (W601): the zod contract's shape, version
 * literals, and rejection behavior. The golden-fixture COMPATIBILITY
 * (old scenes stay valid as the schema evolves) is pinned in
 * fixture.test.ts — this file pins the schema itself.
 */
import { describe, expect, test } from "bun:test";
import {
  CAMERA_SLOT_IDS,
  SCENE_ENTITY_DISPOSITIONS,
  SCENE_SCHEMA_MAJOR,
  SCENE_SCHEMA_MINOR,
  SCENE_SCHEMA_VERSION,
  SceneSpecification,
  isSceneVersionCompatible,
  sceneSchemaVersionField,
} from "../src/index";
import { buildGoldenScene } from "./helpers";

describe("scene schema version", () => {
  test("the current version is 1.0 and exported", () => {
    expect(SCENE_SCHEMA_VERSION).toBe("1.0");
    expect(SCENE_SCHEMA_MAJOR).toBe(1);
    expect(SCENE_SCHEMA_MINOR).toBe(0);
  });

  test("version compatibility follows the contracts posture", () => {
    expect(isSceneVersionCompatible("1.0")).toBe(true);
    expect(isSceneVersionCompatible("2.0")).toBe(false);
    expect(isSceneVersionCompatible("1.1")).toBe(false); // newer minor: reject, never partially parse
    expect(isSceneVersionCompatible("garbage")).toBe(false);
    expect(isSceneVersionCompatible("10")).toBe(false);
  });

  test("the version field pattern rejects malformed versions", () => {
    expect(schemaVersionFieldOk("1.0")).toBe(true);
    expect(schemaVersionFieldOk("1.10")).toBe(true);
    expect(schemaVersionFieldOk("1")).toBe(false);
    expect(schemaVersionFieldOk("1.0.0")).toBe(false);
    expect(schemaVersionFieldOk("v1.0")).toBe(false);
  });
});

function schemaVersionFieldOk(value: string): boolean {
  return sceneSchemaVersionField.safeParse(value).success;
}

describe("scene schema shape", () => {
  test("the golden scene parses against the schema", () => {
    const scene = buildGoldenScene();
    const result = SceneSpecification.safeParse(scene);
    expect(result.success).toBe(true);
  });

  test("the disposition vocabulary is closed and matches the contract", () => {
    expect([...SCENE_ENTITY_DISPOSITIONS]).toEqual([
      "projected",
      "projected-out-of-bounds",
      "omitted-no-position",
      "omitted-invalid-position",
      "omitted-non-pitch-frame",
      "not-projected-kind",
    ]);
  });

  test("the camera slot ids are the five canonical slots in order", () => {
    expect([...CAMERA_SLOT_IDS]).toEqual([
      "main-touchline",
      "opposite-touchline",
      "behind-goal-x0",
      "behind-goal-x105",
      "aerial-tactical",
    ]);
  });

  test("a missing required top-level field fails the schema", () => {
    const scene = buildGoldenScene();
    expect(SceneSpecification.safeParse({ ...scene, entities: undefined }).success).toBe(false);
    expect(SceneSpecification.safeParse({ ...scene, source: undefined }).success).toBe(false);
    expect(SceneSpecification.safeParse({ ...scene, world: undefined }).success).toBe(false);
    expect(SceneSpecification.safeParse({ ...scene, scoreClock: undefined }).success).toBe(false);
  });

  test("an unknown disposition value fails the schema", () => {
    const scene = buildGoldenScene();
    const mutated = structuredClone(scene);
    mutated.entities[0]!.disposition = "rendered" as never;
    expect(SceneSpecification.safeParse(mutated).success).toBe(false);
  });

  test("a non-finite position number fails the schema", () => {
    const scene = buildGoldenScene();
    const mutated = structuredClone(scene);
    mutated.entities[0]!.position = { x: Number.POSITIVE_INFINITY, y: 1, z: 0 };
    expect(SceneSpecification.safeParse(mutated).success).toBe(false);
    const nanScene = structuredClone(scene);
    nanScene.entities[0]!.position = { x: Number.NaN, y: 1, z: 0 };
    expect(SceneSpecification.safeParse(nanScene).success).toBe(false);
  });

  test("a confidence outside [0, 1] fails the schema", () => {
    const scene = buildGoldenScene();
    const mutated = structuredClone(scene);
    mutated.entities[0]!.positionConfidence = 1.5;
    expect(SceneSpecification.safeParse(mutated).success).toBe(false);
  });

  test("the pitch bounds are schema-pinned literals (0/105/0/68)", () => {
    const scene = buildGoldenScene();
    const mutated = structuredClone(scene);
    mutated.world.pitch.bounds = { xMin: 0, xMax: 100 as never, yMin: 0, yMax: 68 };
    expect(SceneSpecification.safeParse(mutated).success).toBe(false);
    const mutatedPlane = structuredClone(scene);
    mutatedPlane.world.pitch.planeZMeters = 1 as never;
    expect(SceneSpecification.safeParse(mutatedPlane).success).toBe(false);
  });

  test("the furniture dimensions are schema-pinned literals (Law 1)", () => {
    const scene = buildGoldenScene();
    const mutated = structuredClone(scene);
    mutated.world.pitch.furniture.goals[0]!.widthMeters = 7.5 as never;
    expect(SceneSpecification.safeParse(mutated).success).toBe(false);
    const mutatedRadius = structuredClone(scene);
    mutatedRadius.world.pitch.furniture.centerCircle.radiusMeters = 9.2 as never;
    expect(SceneSpecification.safeParse(mutatedRadius).success).toBe(false);
    const mutatedCount = structuredClone(scene);
    mutatedCount.world.pitch.furniture.cornerArcs =
      mutatedCount.world.pitch.furniture.cornerArcs!.slice(0, 3);
    expect(SceneSpecification.safeParse(mutatedCount).success).toBe(false);
  });

  test("the furniture constant set version is pinned", () => {
    const scene = buildGoldenScene();
    const mutated = structuredClone(scene);
    mutated.world.pitch.furniture.constantsVersion = "ifab-law1-standard@2" as never;
    expect(SceneSpecification.safeParse(mutated).success).toBe(false);
  });

  test("the coordinate system is pinned by literals", () => {
    const scene = buildGoldenScene();
    const mutated = structuredClone(scene);
    mutated.world.coordinateSystem.units = "feet" as never;
    expect(SceneSpecification.safeParse(mutated).success).toBe(false);
    const mutatedAxes = structuredClone(scene);
    mutatedAxes.world.coordinateSystem.axes = {
      x: "goal-line" as never,
      y: "touchline" as never,
      z: "up",
    };
    expect(SceneSpecification.safeParse(mutatedAxes).success).toBe(false);
  });

  test("an event marker must be a stream entry with timeline anchoring", () => {
    const scene = buildGoldenScene();
    const mutated = structuredClone(scene);
    mutated.eventMarkers[0]!.anchoring = "spatial" as never;
    expect(SceneSpecification.safeParse(mutated).success).toBe(false);
    const dropped = structuredClone(scene);
    delete (dropped.eventMarkers[0]! as Record<string, unknown>).sequence;
    expect(SceneSpecification.safeParse(dropped).success).toBe(false);
  });

  test("a score status of known without a value fails the reused contracts schema", () => {
    const scene = buildGoldenScene();
    const mutated = structuredClone(scene);
    mutated.scoreClock.score!.status = { status: "known" };
    expect(SceneSpecification.safeParse(mutated).success).toBe(false);
  });

  test("a camera slot id outside the canonical set fails the schema", () => {
    const scene = buildGoldenScene();
    const mutated = structuredClone(scene);
    mutated.cameraSlots[0]!.slotId = "director-cut" as never;
    expect(SceneSpecification.safeParse(mutated).success).toBe(false);
  });

  test("an empty camera slot list fails the schema (min 1)", () => {
    const scene = buildGoldenScene();
    const mutated = structuredClone(scene);
    mutated.cameraSlots = [];
    expect(SceneSpecification.safeParse(mutated).success).toBe(false);
  });
});
