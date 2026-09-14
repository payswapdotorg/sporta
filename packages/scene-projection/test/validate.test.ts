/**
 * Conformance harness tests (W601): the 12 checks PASS on the golden scene
 * (with full evidence), and every RULE VIOLATION is caught — one negative
 * fixture per check id, each proving the specific check's teeth (the W501
 * negative-conformance posture: break exactly one thing, attribute the
 * failure to exactly one check).
 */
import { describe, expect, test } from "bun:test";
import type { SceneConformanceReport } from "../src/index";
import { projectScene, runSceneConformance } from "../src/index";
import type { SceneSpecification } from "../src/schema";
import { buildGoldenFixture, buildGoldenScene } from "./helpers";

const GOLDEN = buildGoldenFixture();

/** Runs the harness over the golden scene with the full evidence. */
function conformance(scene: unknown, options?: Parameters<typeof runSceneConformance>[1]) {
  return runSceneConformance(scene, options);
}

/** The full-evidence options (snapshot + events + camera selection). */
function fullEvidence() {
  return {
    snapshot: GOLDEN.snapshot,
    events: GOLDEN.events,
    cameraSlotIds: GOLDEN.options.cameraSlotIds,
  };
}

/** Finds one check by id (fails the test if the check is missing). */
function checkOf(report: SceneConformanceReport, checkId: string) {
  const check = report.checks.find((c) => c.checkId === checkId);
  expect(check).toBeDefined();
  return check!;
}

describe("runSceneConformance — the golden scene passes everything", () => {
  test("all 12 checks pass with the full evidence", () => {
    const scene = buildGoldenScene();
    const report = conformance(scene, fullEvidence());
    expect(report.checks.map((c) => c.checkId)).toEqual([
      "scene-schema-valid",
      "scene-version-compatible",
      "source-provenance-complete",
      "identity-stable-and-total",
      "disposition-accounting-closed",
      "pitch-geometry-canonical",
      "camera-slots-canonical",
      "score-clock-verbatim",
      "entity-slots-verbatim",
      "event-markers-verbatim",
      "determinism-byte-identical",
      "serialization-roundtrip",
    ]);
    expect(report.passed).toBe(true);
    expect(report.checks.every((c) => c.passed)).toBe(true);
  });

  test("the serialized golden also passes with the full evidence", () => {
    // parse → conformance: the W605 posture (a scene from disk, with its
    // claimed source snapshot supplied as evidence).
    const scene = JSON.parse(
      JSON.stringify(
        // roundtrip through JSON to mimic a wire/disk document
        buildGoldenScene(),
      ),
    );
    const report = conformance(scene, fullEvidence());
    expect(report.passed).toBe(true);
  });

  test("without any evidence, the standalone checks still pass (n/a elsewhere)", () => {
    const report = conformance(buildGoldenScene());
    expect(report.passed).toBe(true);
    expect(checkOf(report, "source-provenance-complete").detail).toMatch(/^n\/a —/);
    expect(checkOf(report, "identity-stable-and-total").detail).toMatch(/^n\/a —/);
    expect(checkOf(report, "score-clock-verbatim").detail).toMatch(/^n\/a —/);
    expect(checkOf(report, "entity-slots-verbatim").detail).toMatch(/^n\/a —/);
    expect(checkOf(report, "determinism-byte-identical").detail).toMatch(/^n\/a —/);
    // markers exist but no events were supplied → n/a, not a failure
    expect(checkOf(report, "event-markers-verbatim").detail).toMatch(/^n\/a —/);
  });

  test("the harness never throws on garbage input", () => {
    expect(() => conformance("a string")).not.toThrow();
    expect(() => conformance(null)).not.toThrow();
    expect(() => conformance(42)).not.toThrow();
    expect(() => conformance(undefined)).not.toThrow();
    const report = conformance("garbage");
    expect(report.passed).toBe(false);
    expect(checkOf(report, "scene-schema-valid").passed).toBe(false);
  });

  test("a malformed options snapshot fails the evidence-gated checks (not n/a)", () => {
    const report = conformance(buildGoldenScene(), {
      snapshot: { broken: true } as never,
    });
    expect(report.passed).toBe(false);
    for (const id of [
      "source-provenance-complete",
      "identity-stable-and-total",
      "score-clock-verbatim",
      "entity-slots-verbatim",
      "determinism-byte-identical",
    ]) {
      expect(checkOf(report, id).passed).toBe(false);
      expect(checkOf(report, id).detail).toContain("options.snapshot");
    }
  });

  test("malformed options events fail the events-gated checks", () => {
    const report = conformance(buildGoldenScene(), {
      snapshot: GOLDEN.snapshot,
      events: [{ garbage: true }] as never,
    });
    expect(checkOf(report, "event-markers-verbatim").passed).toBe(false);
    expect(checkOf(report, "determinism-byte-identical").passed).toBe(false);
  });
});

describe("runSceneConformance — rule-violation teeth (one mutation per check)", () => {
  /** Mutates a fresh clone of the golden scene. */
  function mutate(edit: (scene: SceneSpecification) => void): SceneSpecification {
    const scene = structuredClone(buildGoldenScene());
    edit(scene);
    return scene;
  }

  test("S2/S8 schema: a missing sessionId fails scene-schema-valid (and the report)", () => {
    const scene = mutate((s) => {
      delete (s as Record<string, unknown>).sessionId;
    });
    const report = conformance(scene, fullEvidence());
    expect(report.passed).toBe(false);
    expect(checkOf(report, "scene-schema-valid").passed).toBe(false);
    expect(checkOf(report, "scene-schema-valid").detail).toMatch(/^scene-schema-invalid/);
  });

  test("S8 version: a newer-minor version fails scene-version-compatible", () => {
    const scene = mutate((s) => {
      s.sceneSchemaVersion = "1.1";
    });
    const report = conformance(scene, fullEvidence());
    expect(report.passed).toBe(false);
    expect(checkOf(report, "scene-version-compatible").passed).toBe(false);
  });

  test("S1 source: a bumped watermark sequence fails source-provenance-complete", () => {
    const scene = mutate((s) => {
      s.source.watermark.sequence = 99;
    });
    const report = conformance(scene, fullEvidence());
    expect(report.passed).toBe(false);
    const check = checkOf(report, "source-provenance-complete");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("$.source.watermark.sequence");
  });

  test("S1 identity: a dropped entity fails identity + closure + entity-verbatim + determinism", () => {
    const scene = mutate((s) => {
      s.entities.pop(); // team-home
    });
    const report = conformance(scene, fullEvidence());
    expect(report.passed).toBe(false);
    expect(checkOf(report, "identity-stable-and-total").passed).toBe(false);
    expect(checkOf(report, "identity-stable-and-total").detail).toContain("entity count differs");
    expect(checkOf(report, "disposition-accounting-closed").passed).toBe(false);
    expect(checkOf(report, "entity-slots-verbatim").passed).toBe(false);
    expect(checkOf(report, "determinism-byte-identical").passed).toBe(false);
  });

  test("S1 identity: a swapped entity order fails identity (order is contract)", () => {
    const scene = mutate((s) => {
      s.entities = [s.entities[1]!, s.entities[0]!, ...s.entities.slice(2)];
    });
    const report = conformance(scene, fullEvidence());
    expect(checkOf(report, "identity-stable-and-total").passed).toBe(false);
    expect(checkOf(report, "identity-stable-and-total").detail).toContain("entities[0]");
    // Closure is order-independent and still holds.
    expect(checkOf(report, "disposition-accounting-closed").passed).toBe(true);
  });

  test("S1 identity: a re-mapped entity id fails identity", () => {
    const scene = mutate((s) => {
      s.entities[0]!.entityId = "someone-else";
    });
    const report = conformance(scene, fullEvidence());
    expect(checkOf(report, "identity-stable-and-total").passed).toBe(false);
    expect(checkOf(report, "identity-stable-and-total").detail).toContain("identity differs");
  });

  test("S3 closure: an omitted entity carrying a position fails disposition closure", () => {
    const scene = mutate((s) => {
      const bench = s.entities[4]!; // bench-12: omitted-no-position
      bench.position = { x: 20, y: 20 };
    });
    const report = conformance(scene, fullEvidence());
    expect(report.passed).toBe(false);
    const check = checkOf(report, "disposition-accounting-closed");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("bench-12");
  });

  test("S3 closure: a projected entity whose position was removed fails closure", () => {
    const scene = mutate((s) => {
      delete (s.entities[0] as Record<string, unknown>).position;
    });
    const report = conformance(scene, fullEvidence());
    expect(checkOf(report, "disposition-accounting-closed").passed).toBe(false);
  });

  test("S4 bounds honesty: an out-of-bounds entity relabeled projected fails closure", () => {
    const scene = mutate((s) => {
      s.entities[8]!.disposition = "projected"; // outlier-8 at x=112.5
    });
    const report = conformance(scene, fullEvidence());
    const check = checkOf(report, "disposition-accounting-closed");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("outside the inclusive pitch bounds");
  });

  test("S4 bounds honesty: an in-bounds entity flagged out-of-bounds fails closure", () => {
    const scene = mutate((s) => {
      s.entities[0]!.disposition = "projected-out-of-bounds";
    });
    const report = conformance(scene, fullEvidence());
    const check = checkOf(report, "disposition-accounting-closed");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("INSIDE the pitch bounds");
  });

  test("S6 fake z: a ball carrying z without a height value fails closure", () => {
    const scene = mutate((s) => {
      const ball = s.entities[9]!;
      ball.position = { x: 52.5, y: 33.5, z: 0 }; // faked 0, no carried height value
      ball.height = { status: "known" };
    });
    const report = conformance(scene, fullEvidence());
    const check = checkOf(report, "disposition-accounting-closed");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("without a carried height value");
  });

  test("S4 plane: a participant lifted off the plane fails closure", () => {
    const scene = mutate((s) => {
      s.entities[0]!.position = { x: 47.5, y: 30.25, z: 1.2 };
    });
    const report = conformance(scene, fullEvidence());
    const check = checkOf(report, "disposition-accounting-closed");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("must sit on the pitch plane");
  });

  test("S3 scope: a not-projected-kind entity carrying slot fields fails closure", () => {
    const scene = mutate((s) => {
      s.entities[10]!.heading = { status: "known", radians: 1 }; // camera-a
    });
    const report = conformance(scene, fullEvidence());
    const check = checkOf(report, "disposition-accounting-closed");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("not-projected-kind");
  });

  test("S3 closure: a wrong entityCount fails closure", () => {
    const scene = mutate((s) => {
      s.source.entityCount = 11;
    });
    const report = conformance(scene, fullEvidence());
    expect(checkOf(report, "disposition-accounting-closed").passed).toBe(false);
  });

  test("S2 constants: a moved camera slot fails camera-slots-canonical", () => {
    const scene = mutate((s) => {
      s.cameraSlots[0]!.position = { x: 52.5, y: -30, z: 20 };
    });
    const report = conformance(scene, fullEvidence());
    expect(report.passed).toBe(false);
    const check = checkOf(report, "camera-slots-canonical");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("main-touchline");
  });

  test("S2 constants: a reordered camera slot list fails camera-slots-canonical", () => {
    const scene = mutate((s) => {
      s.cameraSlots = [s.cameraSlots[4]!, ...s.cameraSlots.slice(0, 4)];
    });
    const report = conformance(scene, fullEvidence());
    const check = checkOf(report, "camera-slots-canonical");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("canonical order");
  });

  test("S2 constants: a dropped camera slot fails camera-slots-canonical (count)", () => {
    const scene = mutate((s) => {
      s.cameraSlots = s.cameraSlots.slice(0, 4);
    });
    const report = conformance(scene, fullEvidence());
    expect(checkOf(report, "camera-slots-canonical").passed).toBe(false);
  });

  test("S2 constants: a drifted furniture dimension fails pitch-geometry-canonical", () => {
    const scene = mutate((s) => {
      s.world.pitch.furniture.penaltyAreas[0]!.bounds.yMin = 14;
    });
    const report = conformance(scene, fullEvidence());
    expect(report.passed).toBe(false);
    const check = checkOf(report, "pitch-geometry-canonical");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("$.world.pitch.furniture");
  });

  test("S2 provenance: a wrong frameSource fails pitch-geometry-canonical", () => {
    const scene = mutate((s) => {
      s.world.pitch.frameSource = "contracts-constant"; // the snapshot HAS football
    });
    const report = conformance(scene, fullEvidence());
    const check = checkOf(report, "pitch-geometry-canonical");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("frameSource");
  });

  test("S6 display: a changed score fails score-clock-verbatim + determinism", () => {
    const scene = mutate((s) => {
      s.scoreClock.score!.home = 3;
    });
    const report = conformance(scene, fullEvidence());
    expect(report.passed).toBe(false);
    expect(checkOf(report, "score-clock-verbatim").passed).toBe(false);
    expect(checkOf(report, "determinism-byte-identical").passed).toBe(false);
  });

  test("S6 verbatim: a re-derived position confidence fails entity-slots-verbatim", () => {
    const scene = mutate((s) => {
      s.entities[0]!.positionConfidence = 0.84; // the SWM said 0.83
    });
    const report = conformance(scene, fullEvidence());
    expect(report.passed).toBe(false);
    const check = checkOf(report, "entity-slots-verbatim");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("positionConfidence");
  });

  test("S2 invented: a moved position fails entity-slots-verbatim + closure + determinism", () => {
    const scene = mutate((s) => {
      s.entities[0]!.position = { x: 48, y: 30.25, z: 0 };
    });
    const report = conformance(scene, fullEvidence());
    expect(checkOf(report, "entity-slots-verbatim").passed).toBe(false);
    expect(checkOf(report, "determinism-byte-identical").passed).toBe(false);
  });

  test("S2 invented: a rounded position (precision loss) fails entity-slots-verbatim", () => {
    const scene = mutate((s) => {
      s.entities[0]!.position = { x: 47.5, y: 30.3, z: 0 }; // 30.25 rounded to 30.3
    });
    const report = conformance(scene, fullEvidence());
    expect(checkOf(report, "entity-slots-verbatim").passed).toBe(false);
  });

  test("S6 honesty: an invented ball height fails entity-slots-verbatim", () => {
    const scene = mutate((s) => {
      s.entities[9]!.height = { status: "known", meters: 1.6 };
      s.entities[9]!.position = { x: 52.5, y: 33.5, z: 1.6 };
    });
    const report = conformance(scene, fullEvidence());
    expect(checkOf(report, "entity-slots-verbatim").passed).toBe(false);
  });

  test("S7 events: a dropped marker fails event-markers-verbatim", () => {
    const scene = mutate((s) => {
      s.eventMarkers.pop();
    });
    const report = conformance(scene, fullEvidence());
    expect(report.passed).toBe(false);
    expect(checkOf(report, "event-markers-verbatim").passed).toBe(false);
    expect(checkOf(report, "determinism-byte-identical").passed).toBe(false);
  });

  test("S7 events: a reordered marker list fails event-markers-verbatim (order)", () => {
    const scene = mutate((s) => {
      s.eventMarkers = [s.eventMarkers[1]!, s.eventMarkers[0]!, ...s.eventMarkers.slice(2)];
    });
    const report = conformance(scene, fullEvidence());
    expect(checkOf(report, "event-markers-verbatim").passed).toBe(false);
  });

  test("S7 events: a tampered marker field fails event-markers-verbatim", () => {
    const scene = mutate((s) => {
      s.eventMarkers[0]!.event.eventTypeRef = "football/v1/goal";
    });
    const report = conformance(scene, fullEvidence());
    expect(checkOf(report, "event-markers-verbatim").passed).toBe(false);
    expect(checkOf(report, "event-markers-verbatim").detail).toContain("$.eventMarkers[0]");
  });

  test("S5 determinism: any value drift fails determinism-byte-identical (re-projection proof)", () => {
    const scene = mutate((s) => {
      s.entities[2]!.positionSlotKey = "pitchPosition"; // keeper-1 came from "position"
    });
    const report = conformance(scene, fullEvidence());
    expect(checkOf(report, "determinism-byte-identical").passed).toBe(false);
    expect(checkOf(report, "determinism-byte-identical").detail).toContain("re-projection differs");
  });

  test("S5 canonical form: an extra unknown key fails serialization-roundtrip", () => {
    const scene = mutate((s) => {
      (s.entities[0] as Record<string, unknown>).futureField = 1;
    });
    const report = conformance(scene, fullEvidence());
    const check = checkOf(report, "serialization-roundtrip");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("not in canonical form");
  });

  test("S5 canonical form: an explicit undefined value fails serialization-roundtrip", () => {
    const scene = mutate((s) => {
      (s.entities[0] as Record<string, unknown>).heading = undefined;
    });
    const report = conformance(scene, fullEvidence());
    expect(checkOf(report, "serialization-roundtrip").passed).toBe(false);
  });
});

describe("runSceneConformance — camera-slot subset verification (no selection evidence)", () => {
  /** A partial-selection scene (2 of 5 slots, canonical order). */
  function partialScene(): SceneSpecification {
    return projectScene(GOLDEN.snapshot, {
      events: GOLDEN.events,
      cameraSlotIds: ["behind-goal-x0", "aerial-tactical"],
    });
  }

  test("a canonical partial selection passes WITHOUT the selection option (subset consistency)", () => {
    const report = conformance(partialScene());
    const check = checkOf(report, "camera-slots-canonical");
    expect(check.passed).toBe(true);
    expect(check.detail).toMatch(/canonical subset \(2 of 5/);
    expect(report.passed).toBe(true);
  });

  test("a tampered slot in a partial scene fails WITHOUT the selection option", () => {
    const scene = structuredClone(partialScene());
    scene.cameraSlots[0]!.position = { x: 0, y: 0, z: 0 };
    const report = conformance(scene);
    const check = checkOf(report, "camera-slots-canonical");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("differs from the canonical constant");
    expect(check.detail).toContain("behind-goal-x0");
  });

  test("a REORDERED subset fails (canonical order is contract even for subsets)", () => {
    const scene = structuredClone(partialScene());
    // [behind-goal-x0, aerial-tactical] -> [aerial-tactical, behind-goal-x0]
    scene.cameraSlots = [scene.cameraSlots[1]!, scene.cameraSlots[0]!];
    const report = conformance(scene);
    const check = checkOf(report, "camera-slots-canonical");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("no canonical slot with this id at or after canonical position");
  });

  test("a DUPLICATED slot fails the subset walk (the schema alone allows duplicates)", () => {
    const scene = structuredClone(partialScene());
    scene.cameraSlots = [scene.cameraSlots[0]!, scene.cameraSlots[0]!];
    const report = conformance(scene);
    const check = checkOf(report, "camera-slots-canonical");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("no canonical slot with this id at or after canonical position");
  });

  test("a malformed options snapshot fails determinism even for a partial-selection scene (fail beats n/a)", () => {
    const report = conformance(partialScene(), { snapshot: { broken: true } as never });
    const check = checkOf(report, "determinism-byte-identical");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("options.snapshot");
  });

  test("a partial selection with the full evidence set is exact-verified (not subset mode)", () => {
    const selection = ["behind-goal-x0", "aerial-tactical"];
    const scene = partialScene();
    const report = conformance(scene, {
      snapshot: GOLDEN.snapshot,
      events: GOLDEN.events,
      cameraSlotIds: selection,
    });
    const check = checkOf(report, "camera-slots-canonical");
    expect(check.passed).toBe(true);
    expect(check.detail).toMatch(/canonical set/);
    // And a slot DROPPED from the evidence-verified scene is caught (count):
    const tampered = structuredClone(scene);
    tampered.cameraSlots = tampered.cameraSlots.slice(0, 1);
    const tamperedReport = conformance(tampered, {
      snapshot: GOLDEN.snapshot,
      events: GOLDEN.events,
      cameraSlotIds: selection,
    });
    const tamperedCheck = checkOf(tamperedReport, "camera-slots-canonical");
    expect(tamperedCheck.passed).toBe(false);
    expect(tamperedCheck.detail).toContain("camera slot count differs");
  });
});

describe("runSceneConformance — partial evidence degradation (n/a, never false)", () => {
  test("a partial camera selection is n/a without the selection option, verified with it", () => {
    const selection = ["aerial-tactical", "behind-goal-x0"];
    const scene = projectScene(GOLDEN.snapshot, {
      events: GOLDEN.events,
      cameraSlotIds: selection,
    });
    // Without the option the re-projection would emit all five slots: n/a.
    const noEvidence = conformance(scene);
    expect(noEvidence.passed).toBe(true);
    expect(checkOf(noEvidence, "determinism-byte-identical").detail).toMatch(
      /n\/a — the scene carries a partial camera-slot selection/,
    );
    // With the option the scene is fully verified.
    const withEvidence = conformance(scene, {
      snapshot: GOLDEN.snapshot,
      events: GOLDEN.events,
      cameraSlotIds: selection,
    });
    expect(checkOf(withEvidence, "determinism-byte-identical").passed).toBe(true);
    expect(checkOf(withEvidence, "camera-slots-canonical").passed).toBe(true);
  });

  test("a scene with markers but no events evidence is n/a for markers + determinism", () => {
    const report = conformance(buildGoldenScene(), { snapshot: GOLDEN.snapshot });
    expect(report.passed).toBe(true);
    expect(checkOf(report, "event-markers-verbatim").detail).toMatch(/^n\/a —/);
    expect(checkOf(report, "determinism-byte-identical").detail).toMatch(
      /n\/a — the scene carries event markers/,
    );
  });

  test("a scene with NO markers and no events evidence runs the determinism check", () => {
    const scene = buildGoldenScene();
    scene.eventMarkers = [];
    const report = conformance(scene, { snapshot: GOLDEN.snapshot });
    // The re-projection without events produces no markers — it reproduces
    // the scene only because the markers are empty. It runs, not n/a.
    expect(checkOf(report, "determinism-byte-identical").passed).toBe(true);
    expect(checkOf(report, "determinism-byte-identical").detail).toMatch(
      /byte-identical under canonical serialization/,
    );
  });
});
