/**
 * Canonical serialization tests (W601, rule S5): sorted keys, byte
 * stability, full number precision, the total roundtrip, and the fail-closed
 * parse gate.
 */
import { describe, expect, test } from "bun:test";
import { buildWorldSnapshot } from "@sporta/testing";
import {
  SceneProjectionError,
  parseSceneSpecification,
  projectScene,
  serializeScene,
} from "../src/index";
import { buildGoldenFixture, buildGoldenScene } from "./helpers";

const GOLDEN = buildGoldenFixture();

describe("serializeScene — canonical form", () => {
  test("object keys are sorted recursively (arrays keep their semantic order)", () => {
    const text = serializeScene(buildGoldenScene());
    // The first key of the whole document is cameraSlots (alphabetically first)…
    expect(text.startsWith('{"cameraSlots"')).toBe(true);
    // …and within a slot, derivation < position < slotId < target (alphabetical).
    const firstSlot = JSON.parse(text).cameraSlots[0] as Record<string, unknown>;
    expect(Object.keys(firstSlot)).toEqual(["derivation", "position", "slotId", "target"]);
    // Entities keep SNAPSHOT order (not sorted): striker-9 is still first.
    const entities = (JSON.parse(text) as { entities: Array<{ entityId: string }> }).entities;
    expect(entities.map((e) => e.entityId)).toEqual([
      "striker-9",
      "winger-7",
      "keeper-1",
      "ref-1",
      "bench-12",
      "injured-3",
      "lost-4",
      "img-5",
      "outlier-8",
      "ball-1",
      "camera-a",
      "team-home",
    ]);
  });

  test("byte-identical across double runs and across fresh fixture rebuilds", () => {
    const scene = projectScene(GOLDEN.snapshot, GOLDEN.options);
    expect(serializeScene(scene)).toBe(
      serializeScene(projectScene(GOLDEN.snapshot, GOLDEN.options)),
    );
    const rebuilt = buildGoldenFixture();
    expect(serializeScene(scene)).toBe(
      serializeScene(projectScene(rebuilt.snapshot, rebuilt.options)),
    );
  });

  test("full float precision is preserved verbatim (no rounding)", () => {
    const scene = buildGoldenScene();
    const text = serializeScene(scene);
    expect(text).toContain("3.9269908169872414"); // the ball heading, all 16 digits
    expect(text).toContain("0.83"); // the striker confidence
    expect(text).toContain("2704000");
  });

  test("non-finite numbers throw fail-loud (no canonical form exists)", () => {
    const scene = buildGoldenScene();
    const mutated = structuredClone(scene);
    mutated.entities[0]!.position = { x: Number.NaN, y: 1, z: 0 };
    expect(() => serializeScene(mutated)).toThrow(/non-finite number/);
  });

  test("explicit undefined values are dropped by the canonical form", () => {
    const scene = buildGoldenScene();
    const mutated = structuredClone(scene);
    (mutated.entities[0] as Record<string, unknown>).heading = undefined;
    // The key is present-but-undefined: the canonical form omits it entirely.
    const text = serializeScene(mutated);
    const parsed = JSON.parse(text) as { entities: Array<Record<string, unknown>> };
    expect("heading" in parsed.entities[0]!).toBe(false);
  });
});

describe("parseSceneSpecification — the fail-closed inverse", () => {
  test("roundtrips the golden scene deep-equal", () => {
    const scene = buildGoldenScene();
    const back = parseSceneSpecification(serializeScene(scene));
    expect(back).toEqual(scene);
  });

  test("roundtrips a scene with no football state and no markers", () => {
    const noFootball = buildWorldSnapshot({ sessionId: "sess-serialize", football: undefined });
    const scene = projectScene(noFootball, {});
    expect(scene.scoreClock.footballState).toBe(false);
    expect(scene.eventMarkers).toEqual([]);
    const back = parseSceneSpecification(serializeScene(scene));
    expect(back).toEqual(scene);
  });

  test("a scene with an unknown extra key is NOT canonical (roundtrip fails deep-equal)", () => {
    const scene = buildGoldenScene();
    const mutated = structuredClone(scene);
    (mutated.entities[0] as Record<string, unknown>).futureField = { x: 1 };
    // The key parses (zod strips unknown keys) but the roundtrip drops it —
    // the roundtrip check of the harness catches exactly this class.
    const back = parseSceneSpecification(serializeScene(mutated));
    expect(back).not.toEqual(mutated);
    expect(back).toEqual(scene);
  });

  test("invalid JSON throws SceneProjectionError", () => {
    expect(() => parseSceneSpecification("{not json")).toThrow(SceneProjectionError);
    expect(() => parseSceneSpecification("{not json")).toThrow(/not valid JSON/);
  });

  test("a structurally invalid scene throws with issues", () => {
    expect(() => parseSceneSpecification("{}")).toThrow(/not a valid SceneSpecification/);
    expect(() => parseSceneSpecification('{"sceneSchemaVersion": "1.0"}')).toThrow(
      /not a valid SceneSpecification/,
    );
  });

  test("an incompatible scene version is rejected fail-closed (never partially parsed)", () => {
    const scene = buildGoldenScene();
    const mutated = structuredClone(scene);
    mutated.sceneSchemaVersion = "1.1";
    const text = serializeScene(mutated);
    expect(() => parseSceneSpecification(text)).toThrow(/not compatible/);
    const majorBump = structuredClone(scene);
    majorBump.sceneSchemaVersion = "2.0";
    expect(() => parseSceneSpecification(serializeScene(majorBump))).toThrow(/not compatible/);
  });

  test("the current version roundtrips through the gate", () => {
    const scene = buildGoldenScene();
    expect(scene.sceneSchemaVersion).toBe("1.0");
    expect(parseSceneSpecification(serializeScene(scene)).sceneSchemaVersion).toBe("1.0");
  });
});
