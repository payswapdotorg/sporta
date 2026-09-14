/**
 * `projectScene` tests (W601): the pure, total, deterministic projection.
 *
 * Coverage: the golden path values, every disposition, the slot precedence
 * and frame-guard rules (the W401 fusion reconciliation), bounds edge
 * semantics, ball height/heading honesty, football-absent projection, event
 * markers, camera-slot selection, fail-loud input validation, output
 * freshness, and double-run determinism.
 */
import { describe, expect, test } from "bun:test";
import { buildEventEnvelope, buildWorldSnapshot } from "@sporta/testing";
import type { WorldSnapshot } from "@sporta/contracts";
import {
  CANONICAL_CAMERA_SLOTS,
  SceneProjectionError,
  projectScene,
  serializeScene,
} from "../src/index";
import { buildGoldenFixture, buildGoldenScene } from "./helpers";

const GOLDEN = buildGoldenFixture();

/** A participant entity skeleton for hand-built slot scenarios. */
function participant(
  entityId: string,
  state: Record<string, unknown>,
  lastEventTimeMs = 1_000,
): {
  entityId: string;
  kind: string;
  version: number;
  lastEventTimeMs: number;
  state: Record<string, unknown>;
} {
  return { entityId, kind: "participant", version: 1, lastEventTimeMs, state };
}

/** A hand-built contract-valid snapshot carrying the given entities. */
function snapshotOf(
  entities: Array<ReturnType<typeof participant>>,
  football?: unknown,
): WorldSnapshot {
  return buildWorldSnapshot({
    sessionId: "sess-projection-test",
    watermark: { watermarkMs: 1_000, sequence: 0 },
    entities: entities as never,
    ...(football === undefined ? { football: undefined } : {}),
  });
}

describe("projectScene — golden path values (verbatim, never re-derived)", () => {
  test("every entity carries verbatim identity and accounted dispositions", () => {
    const scene = buildGoldenScene();
    expect(scene.entities.map((e) => [e.entityId, e.disposition])).toEqual([
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
    expect(scene.source.entityCount).toBe(GOLDEN.snapshot.entities.length);
  });

  test("positions, statuses and confidences are copied verbatim (no rounding)", () => {
    const scene = buildGoldenScene();
    const striker = scene.entities[0]!;
    expect(striker.position).toEqual({ x: 47.5, y: 30.25, z: 0 });
    expect(striker.positionSlotKey).toBe("pitchPosition");
    expect(striker.positionStatus).toBe("uncertain");
    expect(striker.positionConfidence).toBe(0.83);
    expect(striker.heading).toEqual({ status: "known", radians: 1.25 });
    // Precision is preserved: an oddball float survives verbatim.
    const ball = scene.entities[9]!;
    expect(ball.heading!.radians).toBe(3.9269908169872414);
  });

  test("the ball's z is its carried height; participants sit on the plane", () => {
    const scene = buildGoldenScene();
    const ball = scene.entities[9]!;
    expect(ball.position).toEqual({ x: 52.5, y: 33.5, z: 1.5 });
    expect(ball.height).toEqual({ status: "known", meters: 1.5 });
    expect(scene.entities[0]!.position!.z).toBe(0);
    expect(scene.entities[3]!.position!.z).toBe(0); // official: plane constant
  });

  test("a fusion-shaped pitch position projects (the G4 seam closure)", () => {
    const scene = buildGoldenScene();
    const keeper = scene.entities[2]!;
    expect(keeper.disposition).toBe("projected");
    expect(keeper.positionSlotKey).toBe("position");
    expect(keeper.position).toEqual({ x: 5.25, y: 34, z: 0 });
    expect(keeper.positionConfidence).toBe(0.64);
  });

  test("out-of-bounds keeps TRUE coordinates, flagged, never clamped", () => {
    const scene = buildGoldenScene();
    const outlier = scene.entities[8]!;
    expect(outlier.disposition).toBe("projected-out-of-bounds");
    expect(outlier.position).toEqual({ x: 112.5, y: 34, z: 0 });
  });

  test("the boundary is inclusive: x=105 projects as in-bounds", () => {
    const scene = buildGoldenScene();
    const winger = scene.entities[1]!;
    expect(winger.disposition).toBe("projected");
    expect(winger.position!.x).toBe(105);
  });

  test("the score/clock display state is verbatim", () => {
    const scene = buildGoldenScene();
    expect(scene.scoreClock).toEqual({
      footballState: true,
      score: { home: 2, away: 1, status: { status: "known", value: "confirmed" } },
      clock: { period: "second-half", clockMs: 2_704_000, stoppage: false },
      possession: { status: "uncertain", value: { entityId: "striker-9" }, confidence: 0.72 },
      eventTaxonomyVersion: "v1",
    });
  });

  test("event markers are the input tail, verbatim, timeline-anchored, in order", () => {
    const scene = buildGoldenScene();
    expect(scene.eventMarkers).toHaveLength(4);
    expect(scene.eventMarkers.map((m) => m.event.eventId)).toEqual([
      "fe-golden-1",
      "fe-golden-2",
      "fe-golden-3",
      "fe-golden-4",
    ]);
    expect(scene.eventMarkers.every((m) => m.anchoring === "timeline")).toBe(true);
    expect(scene.eventMarkers[3]!.event.correctionOf).toBe("fe-golden-3");
    expect(scene.eventMarkers[2]!.event.confidence).toBe(0.91);
    expect(scene.eventMarkers[1]!.sequence).toBe(2);
  });

  test("source provenance is verbatim", () => {
    const scene = buildGoldenScene();
    expect(scene.sessionId).toBe(GOLDEN.snapshot.sessionId);
    expect(scene.source).toEqual({
      schemaVersion: GOLDEN.snapshot.schemaVersion,
      watermark: GOLDEN.snapshot.watermark,
      generatedAtMs: GOLDEN.snapshot.generatedAtMs,
      footballState: true,
      entityCount: 12,
    });
  });

  test("the pitch frame is verbatim from the football state", () => {
    const scene = buildGoldenScene();
    expect(scene.world.pitch.frame).toEqual(GOLDEN.snapshot.football!.pitch);
    expect(scene.world.pitch.frameSource).toBe("snapshot-football");
  });
});

describe("projectScene — slot precedence and frame guards (rules S2/S3)", () => {
  test("no position slots at all → omitted-no-position with no slot fields", () => {
    const scene = projectScene(
      snapshotOf([participant("p1", { teamRole: { status: "known", value: "mid" } })]),
    );
    const entity = scene.entities[0]!;
    expect(entity.disposition).toBe("omitted-no-position");
    expect(entity.position).toBeUndefined();
    expect(entity.positionSlotKey).toBeUndefined();
    expect(entity.positionStatus).toBeUndefined();
  });

  test("an unknown-status slot → omitted-no-position, status still recorded", () => {
    const scene = projectScene(
      snapshotOf([participant("p1", { pitchPosition: { status: "unknown" } })]),
    );
    const entity = scene.entities[0]!;
    expect(entity.disposition).toBe("omitted-no-position");
    expect(entity.positionSlotKey).toBe("pitchPosition");
    expect(entity.positionStatus).toBe("unknown");
  });

  test("an uncertain slot with no value → omitted-no-position", () => {
    const scene = projectScene(
      snapshotOf([participant("p1", { pitchPosition: { status: "uncertain" } })]),
    );
    expect(scene.entities[0]!.disposition).toBe("omitted-no-position");
  });

  test("a non-object slot value → omitted-invalid-position", () => {
    const scene = projectScene(
      snapshotOf([
        participant("p1", { pitchPosition: { status: "uncertain", value: "left wing" } }),
      ]),
    );
    expect(scene.entities[0]!.disposition).toBe("omitted-invalid-position");
  });

  test("a value missing y or with non-finite numbers → omitted-invalid-position", () => {
    const noY = projectScene(
      snapshotOf([participant("p1", { pitchPosition: { status: "uncertain", value: { x: 10 } } })]),
    );
    expect(noY.entities[0]!.disposition).toBe("omitted-invalid-position");
    const infinity = projectScene(
      snapshotOf([
        participant("p2", {
          pitchPosition: { status: "uncertain", value: { x: Number.POSITIVE_INFINITY, y: 10 } },
        }),
      ]),
    );
    expect(infinity.entities[0]!.disposition).toBe("omitted-invalid-position");
  });

  test("a fusion position without any spatialFrame → omitted-non-pitch-frame (frame-less Point2D is never assumed pitch)", () => {
    const scene = projectScene(
      snapshotOf([
        participant("p1", { position: { status: "uncertain", value: { x: 10, y: 20 } } }),
      ]),
    );
    const entity = scene.entities[0]!;
    expect(entity.disposition).toBe("omitted-non-pitch-frame");
    expect(entity.positionSlotKey).toBe("position");
  });

  test("a fusion position with an image frame → omitted-non-pitch-frame", () => {
    const scene = projectScene(
      snapshotOf([
        participant("p1", {
          position: { status: "uncertain", value: { x: 0.5, y: 0.5 } },
          spatialFrame: { status: "known", value: "image" },
        }),
      ]),
    );
    expect(scene.entities[0]!.disposition).toBe("omitted-non-pitch-frame");
  });

  test("a fusion position with an UNCERTAIN pitch frame is not established → omitted-non-pitch-frame", () => {
    const scene = projectScene(
      snapshotOf([
        participant("p1", {
          position: { status: "uncertain", value: { x: 10, y: 20 } },
          spatialFrame: { status: "uncertain", value: "pitch", confidence: 0.5 },
        }),
      ]),
    );
    expect(scene.entities[0]!.disposition).toBe("omitted-non-pitch-frame");
  });

  test("a fusion position with a known pitch frame projects", () => {
    const scene = projectScene(
      snapshotOf([
        participant("p1", {
          position: { status: "uncertain", value: { x: 10, y: 20 }, confidence: 0.7 },
          spatialFrame: { status: "known", value: "pitch" },
        }),
      ]),
    );
    const entity = scene.entities[0]!;
    expect(entity.disposition).toBe("projected");
    expect(entity.position).toEqual({ x: 10, y: 20, z: 0 });
    expect(entity.positionConfidence).toBe(0.7);
  });

  test("pitchPosition takes precedence and there is NO fallback to position", () => {
    const scene = projectScene(
      snapshotOf([
        participant("p1", {
          pitchPosition: { status: "unknown" },
          position: { status: "uncertain", value: { x: 10, y: 20 }, confidence: 0.9 },
          spatialFrame: { status: "known", value: "pitch" },
        }),
      ]),
    );
    const entity = scene.entities[0]!;
    expect(entity.disposition).toBe("omitted-no-position");
    expect(entity.positionSlotKey).toBe("pitchPosition");
  });

  test("all non-projectable kinds get not-projected-kind with accounting only", () => {
    const kinds = ["match", "competition", "team", "venue", "camera"];
    const entities = kinds.map((kind, i) => ({
      entityId: `e-${i}`,
      kind,
      version: 1,
      lastEventTimeMs: 1_000,
      state: { pitchPosition: { status: "known", value: { x: 10, y: 20 } } },
    }));
    const scene = projectScene(snapshotOf(entities as never));
    for (const entity of scene.entities) {
      expect(entity.disposition).toBe("not-projected-kind");
      expect(entity.position).toBeUndefined();
      expect(entity.positionSlotKey).toBeUndefined();
      expect(entity.heading).toBeUndefined();
      expect(entity.height).toBeUndefined();
    }
  });

  test("an official with a pitch position projects (projectable kind)", () => {
    const scene = projectScene(
      snapshotOf([
        {
          entityId: "ref-1",
          kind: "official",
          version: 1,
          lastEventTimeMs: 1_000,
          state: { pitchPosition: { status: "known", value: { x: 52.5, y: 42.5 } } },
        },
      ] as never),
    );
    expect(scene.entities[0]!.disposition).toBe("projected");
    expect(scene.entities[0]!.position).toEqual({ x: 52.5, y: 42.5, z: 0 });
  });
});

describe("projectScene — ball height and heading honesty (rule S6)", () => {
  function ballOf(state: Record<string, unknown>) {
    const scene = projectScene(
      snapshotOf([
        { entityId: "ball-1", kind: "ball", version: 1, lastEventTimeMs: 1_000, state },
      ] as never),
    );
    return scene.entities[0]!;
  }

  test("no height slot → no z at all (never a faked 0)", () => {
    const ball = ballOf({ pitchPosition: { status: "known", value: { x: 10, y: 20 } } });
    expect(ball.position).toEqual({ x: 10, y: 20 });
    expect("z" in ball.position!).toBe(false);
    expect(ball.height).toBeUndefined();
  });

  test("an unknown height slot → height recorded verbatim, still no z", () => {
    const ball = ballOf({
      pitchPosition: { status: "known", value: { x: 10, y: 20 } },
      height: { status: "unknown" },
    });
    expect(ball.height).toEqual({ status: "unknown" });
    expect("z" in ball.position!).toBe(false);
  });

  test("a known height → z equals the height meters verbatim", () => {
    const ball = ballOf({
      pitchPosition: { status: "uncertain", value: { x: 10, y: 20 }, confidence: 0.9 },
      height: { status: "known", value: 2.75 },
    });
    expect(ball.position).toEqual({ x: 10, y: 20, z: 2.75 });
    expect(ball.height).toEqual({ status: "known", meters: 2.75 });
  });

  test("an uncertain height with confidence → carried verbatim", () => {
    const ball = ballOf({
      pitchPosition: { status: "known", value: { x: 10, y: 20 } },
      height: { status: "uncertain", value: 0.5, confidence: 0.6 },
    });
    expect(ball.height).toEqual({ status: "uncertain", meters: 0.5, confidence: 0.6 });
    expect(ball.position!.z).toBe(0.5);
  });

  test("a non-number height value → height status recorded, no meters, slot accounted", () => {
    const ball = ballOf({
      pitchPosition: { status: "known", value: { x: 10, y: 20 } },
      height: { status: "known", value: "high" },
    });
    expect(ball.height).toEqual({ status: "known" });
    expect("z" in ball.position!).toBe(false);
    expect(ball.invalidSlotKeys).toEqual(["height"]);
  });

  test("a non-finite height (NaN) → unusable, accounted, no z", () => {
    const ball = ballOf({
      pitchPosition: { status: "known", value: { x: 10, y: 20 } },
      height: { status: "known", value: Number.NaN },
    });
    expect(ball.invalidSlotKeys).toEqual(["height"]);
    expect("z" in ball.position!).toBe(false);
  });

  test("a height slot on a NON-ball kind is never re-interpreted as elevation", () => {
    const scene = projectScene(
      snapshotOf([
        participant("p1", {
          pitchPosition: { status: "known", value: { x: 10, y: 20 } },
          height: { status: "known", value: 1.8 },
        }),
      ]),
    );
    const entity = scene.entities[0]!;
    expect(entity.height).toBeUndefined();
    expect(entity.position!.z).toBe(0);
    expect(entity.invalidSlotKeys).toBeUndefined();
  });

  test("a heading slot is carried verbatim for projectable kinds, including omitted entities", () => {
    const scene = projectScene(
      snapshotOf([
        participant("p1", {
          pitchPosition: { status: "known", value: { x: 10, y: 20 } },
          heading: { status: "uncertain", value: 0.75, confidence: 0.4 },
        }),
        participant("p2", {
          heading: { status: "known", value: 3.1 },
        }),
      ]),
    );
    expect(scene.entities[0]!.heading).toEqual({
      status: "uncertain",
      radians: 0.75,
      confidence: 0.4,
    });
    // p2 has no position (omitted) but its heading is still verbatim truth.
    expect(scene.entities[1]!.disposition).toBe("omitted-no-position");
    expect(scene.entities[1]!.heading).toEqual({ status: "known", radians: 3.1 });
  });

  test("a non-number heading value → no radians, slot accounted", () => {
    const scene = projectScene(
      snapshotOf([
        participant("p1", {
          pitchPosition: { status: "known", value: { x: 10, y: 20 } },
          heading: { status: "known", value: "north" },
        }),
      ]),
    );
    const entity = scene.entities[0]!;
    expect(entity.heading).toEqual({ status: "known" });
    expect(entity.invalidSlotKeys).toEqual(["heading"]);
  });
});

describe("projectScene — football-absent and events options", () => {
  test("no football state → contracts-constant frame, empty display state", () => {
    const scene = projectScene(snapshotOf([participant("p1", {})], undefined));
    expect(scene.scoreClock).toEqual({ footballState: false });
    expect(scene.world.pitch.frameSource).toBe("contracts-constant");
    expect(scene.world.pitch.frame).toEqual({
      lengthAxisMeters: 105,
      widthAxisMeters: 68,
      origin: "corner",
      axes: "x=touchline, y=goal-line",
    });
    expect(scene.source.footballState).toBe(false);
  });

  test("no events option → no markers", () => {
    const scene = projectScene(snapshotOf([participant("p1", {})]));
    expect(scene.eventMarkers).toEqual([]);
  });

  test("events are validated fail-loud (malformed entry throws)", () => {
    const snapshot = snapshotOf([participant("p1", {})]);
    const bad = buildEventEnvelope({ sessionId: "sess-projection-test" }, 1);
    delete (bad as Record<string, unknown>).eventId;
    const entry = { sequence: 1, snapshotVersionAfter: 1, event: bad };
    expect(() => projectScene(snapshot, { events: [entry] })).toThrow(SceneProjectionError);
  });

  test("cross-session events are rejected fail-loud", () => {
    const snapshot = snapshotOf([participant("p1", {})]);
    const other = buildEventEnvelope({ sessionId: "sess-another-session" }, 2);
    const entry = { sequence: 1, snapshotVersionAfter: 1, event: other };
    expect(() => projectScene(snapshot, { events: [entry] })).toThrow(/belongs to session/);
  });

  test("the default camera slots are all five, in canonical order", () => {
    const scene = projectScene(snapshotOf([participant("p1", {})]));
    expect(scene.cameraSlots.map((slot) => slot.slotId)).toEqual([
      "main-touchline",
      "opposite-touchline",
      "behind-goal-x0",
      "behind-goal-x105",
      "aerial-tactical",
    ]);
    expect(scene.cameraSlots).toEqual(
      CANONICAL_CAMERA_SLOTS.map((slot) => ({
        ...slot,
        position: { ...slot.position },
        target: { ...slot.target },
      })),
    );
  });

  test("a camera slot selection is emitted in CANONICAL order (not caller order)", () => {
    const scene = projectScene(snapshotOf([participant("p1", {})]), {
      cameraSlotIds: ["aerial-tactical", "behind-goal-x0"],
    });
    expect(scene.cameraSlots.map((slot) => slot.slotId)).toEqual([
      "behind-goal-x0",
      "aerial-tactical",
    ]);
  });

  test("unknown, duplicate, and empty camera slot selections throw fail-loud", () => {
    const snapshot = snapshotOf([participant("p1", {})]);
    expect(() => projectScene(snapshot, { cameraSlotIds: ["director-cut"] })).toThrow(
      /unknown camera slot id/,
    );
    expect(() =>
      projectScene(snapshot, { cameraSlotIds: ["aerial-tactical", "aerial-tactical"] }),
    ).toThrow(/duplicate camera slot id/);
    expect(() => projectScene(snapshot, { cameraSlotIds: [] })).toThrow(/non-empty array/);
    expect(() => projectScene(snapshot, { cameraSlotIds: "aerial-tactical" as never })).toThrow();
  });
});

describe("projectScene — input validation and output freshness", () => {
  test("an invalid snapshot throws SceneProjectionError with issues", () => {
    const broken = buildWorldSnapshot();
    delete (broken as Record<string, unknown>).sessionId;
    expect(() => projectScene(broken as never)).toThrow(SceneProjectionError);
    expect(() => projectScene(broken as never)).toThrow(/not a valid WorldSnapshot/);
  });

  test("a null options object throws (options must be an object)", () => {
    expect(() => projectScene(snapshotOf([participant("p1", {})]), null as never)).toThrow(
      SceneProjectionError,
    );
  });

  test("events must be an array", () => {
    expect(() =>
      projectScene(snapshotOf([participant("p1", {})]), { events: "nope" as never }),
    ).toThrow(/array of WorldEventStreamEntry/);
  });

  test("mutating the input after projection cannot affect the scene (fresh objects)", () => {
    const snapshot = snapshotOf([
      participant("p1", {
        pitchPosition: { status: "uncertain", value: { x: 10, y: 20 }, confidence: 0.5 },
      }),
    ]);
    const scene = projectScene(snapshot);
    (snapshot.entities[0]!.state.pitchPosition!.value as { x: number }).x = 999;
    (snapshot.entities[0]!.state.pitchPosition as { confidence?: number }).confidence = 0.99;
    expect(scene.entities[0]!.position!.x).toBe(10);
    expect(scene.entities[0]!.positionConfidence).toBe(0.5);
    // The camera-slot constants are equally isolated from mutation.
    scene.cameraSlots[0]!.position.x = 999;
    expect(CANONICAL_CAMERA_SLOTS[0]!.position.x).toBe(52.5);
  });
});

describe("projectScene — determinism (rule S5)", () => {
  test("two projections of the same input are deep-equal and byte-identical", () => {
    const first = projectScene(GOLDEN.snapshot, GOLDEN.options);
    const second = projectScene(GOLDEN.snapshot, GOLDEN.options);
    expect(first).toEqual(second);
    expect(serializeScene(first)).toBe(serializeScene(second));
  });

  test("fresh deep-cloned inputs produce the identical scene", () => {
    const rebuilt = buildGoldenFixture();
    const first = projectScene(GOLDEN.snapshot, GOLDEN.options);
    const second = projectScene(rebuilt.snapshot, rebuilt.options);
    expect(serializeScene(first)).toBe(serializeScene(second));
  });

  test("the builder-generated snapshot projects (m1/m2 posture)", () => {
    const scene = projectScene(buildWorldSnapshot({ sessionId: "sess-builder" }));
    // ball-1 has an uncertain position; player-7's is unknown (unset, never invented).
    const dispositions = scene.entities.map((e) => [e.entityId, e.disposition]);
    expect(dispositions).toContainEqual(["ball-1", "projected"]);
    expect(dispositions).toContainEqual(["player-7", "omitted-no-position"]);
    expect(scene.scoreClock.footballState).toBe(true);
  });
});
