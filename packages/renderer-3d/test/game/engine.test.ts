/**
 * `Software3DEngine` unit tests — the frozen `GameEngineAdapter` seam
 * (R302) exercised directly: descriptor stability, scene building from
 * canonical SWM, event-application accounting (replays vs out-of-envelope),
 * render staging with honest telemetry/provenance, the frame budget, and
 * scene determinism (byte-identical staged frames for identical input).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { SCHEMA_VERSION } from "@sporta/contracts";
import { Software3DEngine, Software3DEngineError } from "../../src/game/engine";
import { MAX_ENGINE_FRAMES, MAX_SCENE_ENTITIES } from "../../src/game/identity";
import { buildEventEnvelope } from "@sporta/testing";
import { buildFixtureEvents, buildFixtureSnapshot, SESSION_ID } from "./helpers";
import type { WorldEventStreamEntry } from "@sporta/contracts";

function buildRequest(style: "stylized-3d" | "cel-shaded" = "stylized-3d") {
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionId: SESSION_ID,
    snapshotVersion: 1,
    renderingStyle: style,
  } as const;
}

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("describe() — the immutable engine descriptor", () => {
  test("is deep-equal on every call and names no vendor", () => {
    const engine = new Software3DEngine();
    const a = engine.describe();
    const b = engine.describe();
    expect(a).toEqual(b);
    expect(a.engineKind).toBe("game-engine");
    expect(a.engineId).toBe("sporta.software-3d");
    expect(a.renderingStyles).toEqual(["stylized-3d", "cel-shaded"]);
    expect(a.outputFormats).toEqual(["frames-rgb24"]);
    expect(a.maxConcurrentEntities).toBe(MAX_SCENE_ENTITIES);
  });
});

describe("buildScene() — scene construction from canonical SWM", () => {
  test("binds the handle to the snapshot watermark honestly", () => {
    const engine = new Software3DEngine();
    const handle = engine.buildScene(buildRequest(), buildFixtureSnapshot(), []);
    expect(handle.sessionId).toBe(SESSION_ID);
    expect(handle.snapshotVersion).toBe(1);
    expect(handle.appliedEventSequence).toBe(0); // snapshot-only: nothing applied
    // 14 projectable participants/officials (keeper, 10 outfield, the
    // uncertain winger, the out-of-bounds defender, the official — the
    // no-position substitute and the team entity are accounted, not
    // placed) + the carried ball.
    expect(handle.entityCount).toBe(15);
    expect(handle.sceneId).toMatch(/^sw3d-[0-9a-f]+$/);
  });

  test("applies an event tail at build time and reports the sequence", () => {
    const engine = new Software3DEngine();
    const events = buildFixtureEvents();
    const handle = engine.buildScene(buildRequest(), buildFixtureSnapshot(), events);
    expect(handle.appliedEventSequence).toBe(7);
  });

  test("rejects a rendering style outside its descriptor (fail loud)", () => {
    const engine = new Software3DEngine();
    expect(() =>
      engine.buildScene(
        { ...buildRequest(), renderingStyle: "photorealistic-lite" },
        buildFixtureSnapshot(),
        [],
      ),
    ).toThrow(Software3DEngineError);
  });

  test("rejects a session mismatch (fail loud, never a cross-session scene)", () => {
    const engine = new Software3DEngine();
    expect(() =>
      engine.buildScene(buildRequest(), buildFixtureSnapshot({ sessionId: "sess-other" }), []),
    ).toThrow(/belongs to session/);
  });

  test("rejects a malformed request (schema-invalid)", () => {
    const engine = new Software3DEngine();
    expect(() =>
      engine.buildScene(
        { sessionId: "", snapshotVersion: -1 } as unknown as Parameters<
          typeof engine.buildScene
        >[0],
        buildFixtureSnapshot(),
        [],
      ),
    ).toThrow(Software3DEngineError);
  });
});

describe("applySceneEvents() — the event-accounting seam", () => {
  test("applies valid football events in order", () => {
    const engine = new Software3DEngine();
    const handle = engine.buildScene(buildRequest(), buildFixtureSnapshot(), []);
    const result = engine.applySceneEvents(handle, buildFixtureEvents());
    expect(result).toEqual({
      appliedEventSequence: 7,
      skippedEvents: 0,
      degraded: false,
    });
  });

  test("replays (at/below the applied sequence) skip WITHOUT degradation", () => {
    const engine = new Software3DEngine();
    const handle = engine.buildScene(buildRequest(), buildFixtureSnapshot(), buildFixtureEvents());
    const replay = engine.applySceneEvents(handle, buildFixtureEvents());
    expect(replay.skippedEvents).toBe(3);
    expect(replay.appliedEventSequence).toBe(7); // unchanged
    expect(replay.degraded).toBe(false);
    expect(replay.degradationReason).toBeUndefined();
  });

  test("snapshot-content events (at/below the watermark) are replays too", () => {
    const engine = new Software3DEngine();
    const handle = engine.buildScene(buildRequest(), buildFixtureSnapshot(), []);
    const stale = [
      {
        sequence: 4, // == snapshot watermark sequence
        snapshotVersionAfter: 10,
        event: buildEventEnvelope({
          eventId: "stale-1",
          sessionId: SESSION_ID,
          eventTimeMs: 9_000,
        }),
      },
    ];
    const result = engine.applySceneEvents(handle, stale);
    expect(result.skippedEvents).toBe(1);
    expect(result.appliedEventSequence).toBe(0);
    expect(result.degraded).toBe(false);
  });

  test("out-of-envelope entries skip WITH degradation and a reason", () => {
    const engine = new Software3DEngine();
    const handle = engine.buildScene(buildRequest(), buildFixtureSnapshot(), []);
    const crossSession: WorldEventStreamEntry = {
      sequence: 5,
      snapshotVersionAfter: 11,
      event: buildEventEnvelope({
        eventId: "x-1",
        sessionId: "sess-elsewhere",
        eventTimeMs: 10_100,
      }),
    };
    const nonFootball: WorldEventStreamEntry = {
      sequence: 6,
      snapshotVersionAfter: 12,
      event: buildEventEnvelope({
        eventId: "x-2",
        sessionId: SESSION_ID,
        eventTimeMs: 10_200,
        eventTypeRef: "basketball/v1/dunk",
      }),
    };
    const malformed = { sequence: 7, nope: true } as unknown as WorldEventStreamEntry;
    const valid: WorldEventStreamEntry = {
      sequence: 8,
      snapshotVersionAfter: 14,
      event: buildEventEnvelope({ eventId: "ok-1", sessionId: SESSION_ID, eventTimeMs: 10_300 }),
    };
    const result = engine.applySceneEvents(handle, [crossSession, nonFootball, malformed, valid]);
    expect(result.skippedEvents).toBe(3);
    expect(result.appliedEventSequence).toBe(8); // the one valid event
    expect(result.degraded).toBe(true);
    expect(result.degradationReason).toContain("out-of-envelope");
    expect(result.degradationReason).toContain("x-1");
    expect(result.degradationReason).toContain("basketball/v1/dunk");
  });

  test("an unknown scene id fails loud", () => {
    const engine = new Software3DEngine();
    expect(() =>
      engine.applySceneEvents(
        {
          sceneId: "sw3d-nope",
          sessionId: SESSION_ID,
          snapshotVersion: 1,
          appliedEventSequence: 0,
          entityCount: 0,
        },
        [],
      ),
    ).toThrow(Software3DEngineError);
  });
});

describe("renderScene() — staged frame output", () => {
  test("stages rgb24 frames content-addressed with honest telemetry + provenance", () => {
    const engine = new Software3DEngine();
    const handle = engine.buildScene(
      buildRequest("stylized-3d"),
      buildFixtureSnapshot(),
      buildFixtureEvents(),
    );
    const result = engine.renderScene({
      schemaVersion: SCHEMA_VERSION,
      sceneId: handle.sceneId,
      outputProfile: {
        widthPx: 320,
        heightPx: 180,
        fps: 10,
        durationMs: 1_000,
        format: "frames-rgb24",
      },
      presentation: { camera: "aerial-follow", seed: "3" },
    });
    expect(result.output.kind).toBe("frame-output");
    if (result.output.kind !== "frame-output") throw new Error("unreachable");
    expect(result.output.frameCount).toBe(10);
    expect(result.output.widthPx).toBe(320);
    expect(result.output.heightPx).toBe(180);
    expect(result.output.fps).toBe(10);
    expect(result.output.pixelFormat).toBe("rgb24");
    // The staged file exists and is exactly frameCount frames of rgb24.
    expect(statSync(result.output.stagingRef).size).toBe(320 * 180 * 3 * 10);
    // Honest telemetry.
    expect(result.telemetry.framesRendered).toBe(10);
    expect(result.telemetry.droppedFrames).toBe(0);
    expect(result.telemetry.renderMs).toBeGreaterThanOrEqual(0);
    // Provenance mirrors the handle.
    expect(result.provenance).toEqual({ snapshotVersion: 1, lastEventSequence: 7 });
    expect(result.degraded).toBe(false);
  });

  test("is deterministic: identical input stages byte-identical frames", () => {
    const render = (engine: Software3DEngine): string => {
      const handle = engine.buildScene(
        buildRequest("cel-shaded"),
        buildFixtureSnapshot(),
        buildFixtureEvents(),
      );
      const result = engine.renderScene({
        schemaVersion: SCHEMA_VERSION,
        sceneId: handle.sceneId,
        outputProfile: {
          widthPx: 320,
          heightPx: 180,
          fps: 10,
          durationMs: 1_000,
          format: "frames-rgb24",
        },
        presentation: { camera: "aerial-follow", seed: "5" },
      });
      if (result.output.kind !== "frame-output") throw new Error("unreachable");
      return sha256OfFile(result.output.stagingRef);
    };
    const a = render(new Software3DEngine());
    const b = render(new Software3DEngine()); // a SEPARATE engine instance
    expect(a).toBe(b);
  });

  test("different styles stage different frames (the ADR-009 seam, engine level)", () => {
    const engine = new Software3DEngine();
    const render = (style: "stylized-3d" | "cel-shaded"): string => {
      const handle = engine.buildScene(
        buildRequest(style),
        buildFixtureSnapshot(),
        buildFixtureEvents(),
      );
      const result = engine.renderScene({
        schemaVersion: SCHEMA_VERSION,
        sceneId: handle.sceneId,
        outputProfile: {
          widthPx: 320,
          heightPx: 180,
          fps: 10,
          durationMs: 1_000,
          format: "frames-rgb24",
        },
        presentation: { camera: "aerial-follow", seed: "5" },
      });
      if (result.output.kind !== "frame-output") throw new Error("unreachable");
      return sha256OfFile(result.output.stagingRef);
    };
    expect(render("stylized-3d")).not.toBe(render("cel-shaded"));
  });

  test("frame-budget overrun truncates with degraded flag + honest droppedFrames", () => {
    const engine = new Software3DEngine();
    const handle = engine.buildScene(buildRequest(), buildFixtureSnapshot(), []);
    // 100 fps × 60 s = 6000 frames >> the 2400 budget.
    const result = engine.renderScene({
      schemaVersion: SCHEMA_VERSION,
      sceneId: handle.sceneId,
      outputProfile: {
        widthPx: 160,
        heightPx: 90,
        fps: 100,
        durationMs: 60_000,
        format: "frames-rgb24",
      },
      presentation: {},
    });
    expect(result.telemetry.framesRendered).toBe(MAX_ENGINE_FRAMES);
    expect(result.telemetry.droppedFrames).toBe(6_000 - MAX_ENGINE_FRAMES);
    expect(result.degraded).toBe(true);
    expect(result.degradationReason).toContain("frame-budget-overrun");
  });

  test("rejects an unsupported output format and an unknown scene (fail loud)", () => {
    const engine = new Software3DEngine();
    const handle = engine.buildScene(buildRequest(), buildFixtureSnapshot(), []);
    expect(() =>
      engine.renderScene({
        schemaVersion: SCHEMA_VERSION,
        sceneId: handle.sceneId,
        outputProfile: {
          widthPx: 320,
          heightPx: 180,
          fps: 10,
          durationMs: 1_000,
          format: "mp4-h264",
        },
      }),
    ).toThrow(/output format/);
    expect(() =>
      engine.renderScene({
        schemaVersion: SCHEMA_VERSION,
        sceneId: "sw3d-nope",
        outputProfile: {
          widthPx: 320,
          heightPx: 180,
          fps: 10,
          durationMs: 1_000,
          format: "frames-rgb24",
        },
      }),
    ).toThrow(/no scene/);
  });

  test("entity-count degradation fires above the envelope", () => {
    const engine = new Software3DEngine();
    // 70 projectable participants (envelope: 64 incl. the ball).
    const snapshot = buildFixtureSnapshot({
      entities: [
        {
          entityId: "ball-1",
          kind: "ball",
          version: 1,
          lastEventTimeMs: 9_800,
          state: {
            pitchPosition: {
              status: "known" as const,
              value: { x: 52.5, y: 34 },
              confidence: 0.9,
            },
          },
        },
        ...[...Array(70)].map((_, i): import("@sporta/contracts").WorldEntity => ({
          entityId: `bulk-${i}`,
          kind: "participant",
          version: 1,
          lastEventTimeMs: 1_000,
          state: {
            pitchPosition: { status: "known", value: { x: 10 + i, y: 30 }, confidence: 0.5 },
          },
        })),
      ],
    });
    const handle = engine.buildScene(buildRequest(), snapshot, []);
    expect(handle.entityCount).toBe(MAX_SCENE_ENTITIES);
    const result = engine.renderScene({
      schemaVersion: SCHEMA_VERSION,
      sceneId: handle.sceneId,
      outputProfile: {
        widthPx: 160,
        heightPx: 90,
        fps: 5,
        durationMs: 200,
        format: "frames-rgb24",
      },
    });
    expect(result.degraded).toBe(true);
    expect(result.degradationReason).toContain("entity-count-above-envelope");
  });

  test("dispose is terminal for the engine instance", () => {
    const engine = new Software3DEngine();
    engine.dispose();
    expect(() => engine.buildScene(buildRequest(), buildFixtureSnapshot(), [])).toThrow(
      Software3DEngineError,
    );
    engine.dispose(); // idempotent
  });
});
