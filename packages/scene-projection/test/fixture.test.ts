/**
 * Golden-fixture compatibility tests (W601, rule S8) — the W002
 * golden-enforcement precedent applied to the scene specification:
 *
 * - the checked-in projected-scene golden (`fixtures/golden/scene-golden.json`)
 *   parses through the fail-closed gate against the CURRENT schema, deep-equals
 *   the fresh projection of the golden fixture, and is byte-pinned in CANONICAL
 *   form (the FILE is Prettier-formatted, which is lossless for JSON — the
 *   W403 posture: canonical form to canonical form, never the file's cosmetic
 *   formatting);
 * - the JSON-Schema export golden (`fixtures/schemas-golden/`) matches a fresh
 *   `z.toJSONSchema` export, so any scene-schema drift — intentional or
 *   accidental — is visible in CI;
 * - drift has TEETH: a mutated golden breaks the byte pin and the conformance
 *   harness;
 * - the documented W402 caller path (`stateAt` + `eventWindow` →
 *   `projectScene`) is exercised end-to-end — the `@sporta/temporal`
 *   devDependency is real, not declared.
 *
 * A schema change that breaks these tests is either unintentional (revert the
 * source) or intentional (bump `SCENE_SCHEMA_MINOR`/`SCENE_SCHEMA_MAJOR`, run
 * `bun run export-schemas --update-golden`, regenerate the scene golden, and
 * have the tech lead review the golden diff — see CONTRACT.md).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { eventWindow, stateAt } from "@sporta/temporal";
import { SceneSpecification } from "../src/schema";
import type { SceneSpecification as SceneSpecificationType } from "../src/schema";
import {
  parseSceneSpecification,
  projectScene,
  runSceneConformance,
  serializeScene,
} from "../src/index";
import type { SceneConformanceReport } from "../src/index";
import { buildGoldenFixture, buildGoldenScene } from "./helpers";

const GOLDEN_SCENE_PATH = join(import.meta.dir, "..", "fixtures", "golden", "scene-golden.json");
const SCHEMA_GOLDEN_PATH = join(
  import.meta.dir,
  "..",
  "fixtures",
  "schemas-golden",
  "scene-specification.json",
);

const GOLDEN = buildGoldenFixture();
const goldenText = readFileSync(GOLDEN_SCENE_PATH, "utf8");
const parsedGolden = parseSceneSpecification(goldenText);
const canonicalFresh = serializeScene(buildGoldenScene());

/** Finds one check by id (fails the test if the check is missing). */
function checkOf(report: SceneConformanceReport, checkId: string) {
  const check = report.checks.find((c) => c.checkId === checkId);
  expect(check).toBeDefined();
  return check!;
}

/** The full-evidence options for the golden fixture. */
function fullEvidence() {
  return {
    snapshot: GOLDEN.snapshot,
    events: GOLDEN.events,
    cameraSlotIds: GOLDEN.options.cameraSlotIds,
  };
}

describe("the projected-scene golden (fixtures/golden/scene-golden.json)", () => {
  test("parses through the fail-closed gate against the CURRENT schema (S8: old goldens keep parsing)", () => {
    // This is the additive-compatibility enforcement: a MINOR schema bump must
    // keep this checked-in golden valid; a MAJOR bump must land WITH a
    // consciously regenerated golden.
    expect(parsedGolden.sceneSchemaVersion).toBe("1.0");
    expect(SceneSpecification.safeParse(parsedGolden).success).toBe(true);
  });

  test("deep-equals the fresh projection of the golden fixture", () => {
    expect(parsedGolden).toEqual(buildGoldenScene());
  });

  test("is byte-pinned in canonical form (canonical form to canonical form)", () => {
    // The file may be Prettier-formatted (lossless for JSON); the SEMANTIC
    // content is pinned byte-exactly: the file's canonical serialization
    // equals the fresh projection's canonical serialization.
    expect(serializeScene(parsedGolden)).toBe(canonicalFresh);
    // And re-serializing is idempotent (the parsed golden is already canonical).
    expect(serializeScene(parsedGolden)).toBe(serializeScene(parsedGolden));
  });

  test("passes the full-evidence conformance run (12/12 checks)", () => {
    const report = runSceneConformance(parsedGolden, fullEvidence());
    expect(report.passed).toBe(true);
    expect(report.checks).toHaveLength(12);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    const determinism = checkOf(report, "determinism-byte-identical");
    expect(determinism.detail).toMatch(/byte-identical under canonical serialization/);
  });

  test("content pins: the dispositions and key values the golden carries", () => {
    expect(parsedGolden.sessionId).toBe("sess-scene-golden");
    expect(parsedGolden.source.entityCount).toBe(12);
    expect(parsedGolden.source.watermark).toEqual({ watermarkMs: 10_000, sequence: 4 });
    expect(parsedGolden.entities.map((e) => [e.entityId, e.disposition])).toEqual([
      ["striker-9", "projected"],
      ["winger-7", "projected"],
      ["keeper-1", "projected"],
      ["ref-1", "projected"],
      ["bench-12", "omitted-no-position"],
      ["injured-3", "omitted-no-position"],
      ["lost-4", "omitted-invalid-position"],
      ["img-5", "omitted-non-pitch-frame"],
      ["outlier-8", "projected-out-of-bounds"],
      ["ball-1", "projected"],
      ["camera-a", "not-projected-kind"],
      ["team-home", "not-projected-kind"],
    ]);
    // The fusion seam: keeper-1's position came from the "position" slot.
    expect(parsedGolden.entities[2]!.positionSlotKey).toBe("position");
    // Honesty pins: the ball's z is its carried height; the outlier stays true.
    expect(parsedGolden.entities[9]!.position).toEqual({ x: 52.5, y: 33.5, z: 1.5 });
    expect(parsedGolden.entities[8]!.position).toEqual({ x: 112.5, y: 34, z: 0 });
    // The correction chain stays visible in the markers.
    expect(parsedGolden.eventMarkers).toHaveLength(4);
    expect(parsedGolden.eventMarkers[3]!.event.correctionOf).toBe("fe-golden-3");
    expect(parsedGolden.cameraSlots.map((slot) => slot.slotId)).toEqual([
      "main-touchline",
      "opposite-touchline",
      "behind-goal-x0",
      "behind-goal-x105",
      "aerial-tactical",
    ]);
  });

  test("the golden fixture INPUT is pinned too (a fixture change is conscious)", () => {
    expect(GOLDEN.snapshot.entities.map((e) => e.entityId)).toEqual([
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
    expect(GOLDEN.events.map((entry) => entry.event.eventId)).toEqual([
      "fe-golden-1",
      "fe-golden-2",
      "fe-golden-3",
      "fe-golden-4",
    ]);
  });

  test("drift teeth: a mutated golden breaks the byte pin AND the conformance harness", () => {
    // Simulate a drifted golden FILE: any value drift changes the canonical
    // bytes (the byte pin fails loud) and the full-evidence harness attributes
    // it to the verbatim checks.
    const drifted: SceneSpecificationType = structuredClone(parsedGolden);
    drifted.entities[9]!.position!.z = 2.0; // an invented ball height
    expect(serializeScene(drifted)).not.toBe(canonicalFresh);
    const report = runSceneConformance(drifted, fullEvidence());
    expect(report.passed).toBe(false);
    expect(checkOf(report, "entity-slots-verbatim").passed).toBe(false);
    expect(checkOf(report, "determinism-byte-identical").passed).toBe(false);
    // And a dropped golden FILE is not silently skipped: the read above would
    // have thrown before any test ran (readFileSync at module scope).
  });
});

describe("the JSON-Schema export golden (fixtures/schemas-golden/) — the W002 precedent", () => {
  test("the checked-in golden matches a fresh z.toJSONSchema export of SceneSpecification", () => {
    const golden: unknown = JSON.parse(readFileSync(SCHEMA_GOLDEN_PATH, "utf8"));
    const fresh: unknown = z.toJSONSchema(SceneSpecification);
    expect(golden).toEqual(fresh);
  });

  test("the export is STRUCTURAL-only: the runtime refinements are invisible in it (documented limit)", () => {
    const golden = JSON.parse(readFileSync(SCHEMA_GOLDEN_PATH, "utf8")) as Record<string, unknown>;
    const text = JSON.stringify(golden);
    // The zod-only refinements (SceneBounds xMax >= xMin; the inherited
    // UncertainValue known-requires-value) have no JSON-Schema form — a
    // consumer validating with JSON Schema must treat them as extra rules
    // (the same posture as docs/contracts/COMPATIBILITY.md).
    expect(text).not.toContain("xMax >= xMin");
    expect(golden.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });
});

describe("the documented W402 caller path (stateAt + eventWindow → projectScene)", () => {
  /** The at-9000ms scene: stateAt snapshot + the [2000, 9000] event window. */
  function atTScene() {
    const { engine } = buildGoldenFixture();
    const { snapshot } = stateAt(engine, 9_000);
    const windowed = eventWindow(engine.eventsSince(0), { fromMs: 2_000, toMs: 9_000 });
    return { snapshot, windowed, scene: projectScene(snapshot, { events: windowed }) };
  }

  test("the event window selects the in-window events, input order preserved", () => {
    const { windowed } = atTScene();
    expect(windowed.map((entry) => entry.event.eventId)).toEqual([
      "fe-golden-2",
      "fe-golden-3",
      "fe-golden-4",
    ]);
  });

  test("the at-T snapshot projects with its own honest accounting", () => {
    const { scene } = atTScene();
    // Only entities with lastEventTimeMs <= 9000 are in the at-T snapshot
    // (injured-3 at 4000 and team-home at 0 — the engine's at-T contract).
    expect(scene.source.entityCount).toBe(2);
    expect(scene.entities.map((e) => [e.entityId, e.disposition])).toEqual([
      ["injured-3", "omitted-no-position"],
      ["team-home", "not-projected-kind"],
    ]);
    expect(scene.source.watermark).toEqual({ watermarkMs: 9_000, sequence: 4 });
    expect(scene.source.footballState).toBe(true);
    expect(scene.eventMarkers).toHaveLength(3);
  });

  test("the at-T scene passes the full-evidence conformance run", () => {
    const { snapshot, windowed, scene } = atTScene();
    const report = runSceneConformance(scene, { snapshot, events: windowed });
    expect(report.passed).toBe(true);
  });

  test("the at-T projection is deterministic (fresh engine, byte-identical scene)", () => {
    const first = atTScene().scene;
    const second = atTScene().scene;
    expect(serializeScene(first)).toBe(serializeScene(second));
  });
});
