/**
 * W801 W601-scene-fixture tests: the provenance chain and the loader's
 * fail-loud guarantees.
 *
 * - the in-code builder (the replicated W601 golden-fixture construction) is
 *   deterministic (deep-equal reruns);
 * - the CHECKED-IN fixture file is exactly the builder's serialization
 *   (neither side can drift silently — regeneration is an explicit script);
 * - the loader fails loud on unknown keys, wrong kind tags, unknown or
 *   duplicate camera slots, and missing files;
 * - the loaded fixture projects and conforms through the REAL evaluator.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CAMERA_SLOT_IDS, projectScene, runSceneConformance } from "@sporta/scene-projection";
import {
  W601_FIXTURE_SESSION,
  W601_SCENE_FIXTURE_KIND,
  buildW601SceneFixture,
  loadW601SceneFixture,
} from "../src/index";
import { scratchPath } from "./helpers";

const FIXTURE_PATH = `${import.meta.dir}/../fixtures/w601-scene-fixture.json`;

describe("W601 fixture: the in-code builder is deterministic", () => {
  test("two builds are deep-equal", () => {
    expect(buildW601SceneFixture()).toEqual(buildW601SceneFixture());
  });

  test("the builder produces the golden session and the canonical camera slots", () => {
    const fixture = buildW601SceneFixture();
    expect(fixture.snapshot.sessionId).toBe(W601_FIXTURE_SESSION);
    expect(fixture.cameraSlotIds).toEqual([...CAMERA_SLOT_IDS]);
    expect(fixture.events).toHaveLength(4);
    // The engine's injected clock: every snapshot read carries TEST_EPOCH_MS.
    expect(fixture.snapshot.generatedAtMs).toBe(1_736_164_800_000);
  });
});

describe("W601 fixture: the checked-in file is pinned to the builder", () => {
  test("the file's envelope has exactly the versioned shape", () => {
    const parsed = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      ["cameraSlotIds", "events", "fixtureKind", "sessionId", "snapshot"].sort(),
    );
    expect(parsed.fixtureKind).toBe(W601_SCENE_FIXTURE_KIND);
    expect(parsed.sessionId).toBe(W601_FIXTURE_SESSION);
  });

  test("the file IS the builder's serialization (provenance pin)", () => {
    const built = buildW601SceneFixture();
    const expected = {
      fixtureKind: W601_SCENE_FIXTURE_KIND,
      sessionId: W601_FIXTURE_SESSION,
      snapshot: built.snapshot,
      events: built.events,
      cameraSlotIds: built.cameraSlotIds,
    };
    const file = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
    expect(file).toEqual(expected);
  });
});

describe("W601 fixture: the loader fails loud", () => {
  const good = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, unknown>;

  const writeVariant = (name: string, mutate: (fixture: Record<string, unknown>) => void): string => {
    const clone = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
    mutate(clone);
    const path = scratchPath(name);
    writeFileSync(path, JSON.stringify(clone, null, 2));
    return path;
  };

  test("an unknown envelope key fails", () => {
    const path = writeVariant("w601-bad-key.json", (f) => {
      f.extraKey = true;
    });
    expect(() => loadW601SceneFixture(path)).toThrow(/unknown key "extraKey"/);
  });

  test("a wrong fixtureKind fails", () => {
    const path = writeVariant("w601-bad-kind.json", (f) => {
      f.fixtureKind = "something-else@1";
    });
    expect(() => loadW601SceneFixture(path)).toThrow(/fixtureKind/);
  });

  test("a missing envelope key fails", () => {
    const path = writeVariant("w601-missing-key.json", (f) => {
      delete f.events;
    });
    expect(() => loadW601SceneFixture(path)).toThrow(/missing required key "events"/);
  });

  test("an unknown camera slot fails", () => {
    const path = writeVariant("w601-bad-slot.json", (f) => {
      (f.cameraSlotIds as string[]).push("not-a-slot");
    });
    expect(() => loadW601SceneFixture(path)).toThrow(/unknown camera slot/);
  });

  test("a duplicate camera slot fails", () => {
    const path = writeVariant("w601-dup-slot.json", (f) => {
      const slots = f.cameraSlotIds as string[];
      slots.push(slots[0]!);
    });
    expect(() => loadW601SceneFixture(path)).toThrow(/duplicate camera slot/);
  });

  test("a missing file fails with the path", () => {
    expect(() => loadW601SceneFixture("/nonexistent/w601.json")).toThrow(
      /cannot read the scene fixture/,
    );
  });

  test("a file that is not JSON fails", () => {
    const path = scratchPath("w601-not-json.json");
    writeFileSync(path, "{not json");
    expect(() => loadW601SceneFixture(path)).toThrow(/not valid JSON/);
  });
});

describe("W601 fixture: the loaded fixture passes the real evaluator", () => {
  test("projectScene + runSceneConformance (full evidence) passes all checks", () => {
    const fixture = loadW601SceneFixture(FIXTURE_PATH);
    const scene = projectScene(fixture.snapshot, {
      events: fixture.events,
      cameraSlotIds: fixture.cameraSlotIds,
    });
    const report = runSceneConformance(scene, {
      snapshot: fixture.snapshot,
      events: fixture.events,
      cameraSlotIds: fixture.cameraSlotIds,
    });
    expect(report.passed).toBe(true);
    expect(report.checks).toHaveLength(12);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    // The scene's own session matches the fixture (the honest provenance).
    expect(scene.sessionId).toBe(fixture.sessionId);
  });

  test("the projection is deterministic (deep-equal rerun)", () => {
    const fixture = loadW601SceneFixture(FIXTURE_PATH);
    const project = () =>
      projectScene(fixture.snapshot, {
        events: fixture.events,
        cameraSlotIds: fixture.cameraSlotIds,
      });
    expect(project()).toEqual(project());
  });

  test("the checked-in scene golden of @sporta/scene-projection agrees byte-wise", () => {
    // The scene projected from OUR fixture is the same scene the
    // scene-projection package pins as ITS golden (the fixture replication
    // is proven faithful at the scene level, not just structurally).
    const fixture = loadW601SceneFixture(FIXTURE_PATH);
    const scene = projectScene(fixture.snapshot, {
      events: fixture.events,
      cameraSlotIds: fixture.cameraSlotIds,
    });
    const sceneGolden = JSON.parse(
      readFileSync(
        join(import.meta.dir, "../../scene-projection/fixtures/golden/scene-golden.json"),
        "utf8",
      ),
    );
    expect(scene).toEqual(sceneGolden);
  });
});
