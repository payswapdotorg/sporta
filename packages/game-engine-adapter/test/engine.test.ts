import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEventEnvelope, buildWorldSnapshot } from "@sporta/testing";
import type {
  GameEngineFrameOutput,
  GameSceneRenderResult,
  WorldEventStreamEntry,
} from "@sporta/contracts";
import { GameEngineAdapterError } from "../src/errors";
import { SoftwareSceneEngine } from "../src/engine";

let staging: string;

beforeAll(() => {
  staging = mkdtempSync(join(tmpdir(), "game-engine-"));
});

afterAll(() => {
  rmSync(staging, { recursive: true, force: true });
});

/** A deterministic synthetic-diagnostic snapshot (seed-pinned builders). */
const snapshot = buildWorldSnapshot(
  {
    sessionId: "sess-engine-synthetic",
    watermark: { watermarkMs: 30_000, sequence: 20 },
    entities: [
      {
        entityId: "player-4",
        kind: "participant",
        version: 1,
        lastEventTimeMs: 30_000,
        state: {
          pitchPosition: { status: "uncertain", value: { x: 40, y: 30 }, confidence: 0.8 },
        },
      },
      {
        entityId: "player-7",
        kind: "participant",
        version: 1,
        lastEventTimeMs: 30_000,
        state: {
          pitchPosition: { status: "known", value: { x: 60, y: 40 } },
        },
      },
      {
        entityId: "ball-1",
        kind: "ball",
        version: 1,
        lastEventTimeMs: 30_000,
        state: {
          pitchPosition: { status: "known", value: { x: 52.5, y: 34 } },
          height: { status: "known", value: 1.1 },
        },
      },
      {
        // Not placed: no position slot (accounted, never invented).
        entityId: "bench-12",
        kind: "participant",
        version: 1,
        lastEventTimeMs: 30_000,
        state: { teamRole: { status: "known", value: "goalkeeper" } },
      },
    ],
  },
  30201,
);

/** The synthetic-diagnostic event tail (all football/v1). */
const events: WorldEventStreamEntry[] = [
  {
    sequence: 21,
    snapshotVersionAfter: 21,
    event: buildEventEnvelope(
      { eventId: "ge-1", sessionId: "sess-engine-synthetic", eventTimeMs: 30_500 },
      30211,
    ),
  },
  {
    sequence: 22,
    snapshotVersionAfter: 22,
    event: buildEventEnvelope(
      {
        eventId: "ge-2",
        sessionId: "sess-engine-synthetic",
        eventTypeRef: "football/v1/goal",
        eventTimeMs: 31_000,
      },
      30212,
    ),
  },
];

function makeEngine(): SoftwareSceneEngine {
  return new SoftwareSceneEngine({ stagingDir: staging });
}

/** Narrows a render result to its frame branch (fail loud if the kind drifted). */
function frameOutputOf(result: GameSceneRenderResult): GameEngineFrameOutput {
  if (result.output.kind !== "frame-output") {
    throw new Error(`expected frame-output, got ${String(result.output.kind)}`);
  }
  return result.output;
}

describe("SoftwareSceneEngine.describe (the neutral descriptor)", () => {
  test("is schema-valid, vendor-neutral, and deep-equal across calls", () => {
    const engine = makeEngine();
    const a = engine.describe();
    const b = engine.describe();
    expect(a).toEqual(b);
    expect(a.engineKind).toBe("game-engine");
    expect(a.engineId).toBe("sporta.software-raster");
    expect(a.renderingStyles).toEqual(["stylized-3d", "cel-shaded"]);
    expect(a.outputFormats).toEqual(["frames-rgb24"]);
    expect(a.maxConcurrentEntities).toBe(64);
    expect(JSON.stringify(a).toLowerCase()).not.toMatch(/godot|unity|unreal/);
  });
});

describe("buildScene (honest handles)", () => {
  test("applies the event tail and counts placed entities", () => {
    const engine = makeEngine();
    const handle = engine.buildScene(
      {
        schemaVersion: "1.1",
        sessionId: "sess-engine-synthetic",
        snapshotVersion: 5,
        renderingStyle: "stylized-3d",
      },
      snapshot,
      events,
    );
    expect(handle.sessionId).toBe("sess-engine-synthetic");
    expect(handle.snapshotVersion).toBe(5);
    expect(handle.appliedEventSequence).toBe(22);
    expect(handle.entityCount).toBe(3); // bench-12 has no position: not placed
    expect(handle.sceneId).toMatch(/^scene-[0-9a-f]{8}$/);
  });

  test("without events the applied sequence is the snapshot watermark", () => {
    const engine = makeEngine();
    const handle = engine.buildScene(
      {
        schemaVersion: "1.1",
        sessionId: "sess-engine-synthetic",
        snapshotVersion: 5,
        renderingStyle: "stylized-3d",
      },
      snapshot,
      [],
    );
    expect(handle.appliedEventSequence).toBe(20);
  });

  test("rejects an unsupported rendering style (fail loud)", () => {
    const engine = makeEngine();
    expect(() =>
      engine.buildScene(
        {
          schemaVersion: "1.1",
          sessionId: "sess-engine-synthetic",
          snapshotVersion: 5,
          renderingStyle: "photorealistic-lite",
        },
        snapshot,
        [],
      ),
    ).toThrow(GameEngineAdapterError);
  });

  test("rejects a session mismatch between the request and the snapshot", () => {
    const engine = makeEngine();
    expect(() =>
      engine.buildScene(
        {
          schemaVersion: "1.1",
          sessionId: "sess-other",
          snapshotVersion: 5,
          renderingStyle: "stylized-3d",
        },
        snapshot,
        [],
      ),
    ).toThrow(/does not match the snapshot session/);
  });

  test("rejects over-capacity scenes (never clamps)", () => {
    const engine = new SoftwareSceneEngine({ stagingDir: staging, maxConcurrentEntities: 2 });
    expect(() =>
      engine.buildScene(
        {
          schemaVersion: "1.1",
          sessionId: "sess-engine-synthetic",
          snapshotVersion: 5,
          renderingStyle: "stylized-3d",
        },
        snapshot,
        [],
      ),
    ).toThrow(/above this engine's maximum/);
  });

  test("rejects malformed event entries (structurally invalid input throws)", () => {
    const engine = makeEngine();
    expect(() =>
      engine.buildScene(
        {
          schemaVersion: "1.1",
          sessionId: "sess-engine-synthetic",
          snapshotVersion: 5,
          renderingStyle: "stylized-3d",
        },
        snapshot,
        [{ sequence: 1, snapshotVersionAfter: 1, event: { eventId: "nope" } as never }],
      ),
    ).toThrow(/WorldEventStreamEntry/);
  });

  test("same identity rebuilds deterministically (same scene id)", () => {
    const engine = makeEngine();
    const request = {
      schemaVersion: "1.1",
      sessionId: "sess-engine-synthetic",
      snapshotVersion: 5,
      renderingStyle: "stylized-3d",
    } as const;
    const a = engine.buildScene(request, snapshot, events);
    const b = engine.buildScene(request, snapshot, events);
    expect(a).toEqual(b);
  });
});

describe("applySceneEvents (skipped counted, degradation explicit)", () => {
  test("replays are idempotent no-ops (skipped, NOT degraded)", () => {
    const engine = makeEngine();
    const handle = engine.buildScene(
      {
        schemaVersion: "1.1",
        sessionId: "sess-engine-synthetic",
        snapshotVersion: 5,
        renderingStyle: "stylized-3d",
      },
      snapshot,
      events,
    );
    const result = engine.applySceneEvents(handle, [events[0]!]);
    expect(result.appliedEventSequence).toBe(22); // unchanged
    expect(result.skippedEvents).toBe(1);
    expect(result.degraded).toBe(false);
    expect(result.degradationReason).toBeUndefined();
  });

  test("out-of-envelope events are skipped WITH degradation", () => {
    const engine = makeEngine();
    const handle = engine.buildScene(
      {
        schemaVersion: "1.1",
        sessionId: "sess-engine-synthetic",
        snapshotVersion: 5,
        renderingStyle: "stylized-3d",
      },
      snapshot,
      events,
    );
    const foreign = {
      sequence: 30,
      snapshotVersionAfter: 30,
      event: buildEventEnvelope(
        {
          eventId: "ge-x",
          sessionId: "sess-engine-synthetic",
          eventTypeRef: "other/v1/x",
          eventTimeMs: 31_500,
        },
        30213,
      ),
    };
    const result = engine.applySceneEvents(handle, [foreign]);
    expect(result.appliedEventSequence).toBe(22); // nothing new applied
    expect(result.skippedEvents).toBe(1);
    expect(result.degraded).toBe(true);
    expect(result.degradationReason).toMatch(/supported envelope/);
  });

  test("a new applicable event advances the watermark", () => {
    const engine = makeEngine();
    const handle = engine.buildScene(
      {
        schemaVersion: "1.1",
        sessionId: "sess-engine-synthetic",
        snapshotVersion: 5,
        renderingStyle: "stylized-3d",
      },
      snapshot,
      events,
    );
    const next = {
      sequence: 23,
      snapshotVersionAfter: 23,
      event: buildEventEnvelope(
        { eventId: "ge-3", sessionId: "sess-engine-synthetic", eventTimeMs: 31_500 },
        30214,
      ),
    };
    const result = engine.applySceneEvents(handle, [next]);
    expect(result.appliedEventSequence).toBe(23);
    expect(result.skippedEvents).toBe(0);
    expect(result.degraded).toBe(false);
  });

  test("an unknown handle fails loud", () => {
    const engine = makeEngine();
    expect(() =>
      engine.applySceneEvents(
        {
          sceneId: "scene-nope",
          sessionId: "sess-engine-synthetic",
          snapshotVersion: 5,
          appliedEventSequence: 0,
          entityCount: 0,
        },
        [],
      ),
    ).toThrow(/no scene with id/);
  });
});

describe("renderScene (frames staged, telemetry + provenance honest)", () => {
  const buildRequest = {
    schemaVersion: "1.1",
    sessionId: "sess-engine-synthetic",
    snapshotVersion: 5,
    renderingStyle: "stylized-3d",
  } as const;
  const renderRequest = (sceneId: string) => ({
    schemaVersion: "1.1",
    sceneId,
    outputProfile: {
      widthPx: 320,
      heightPx: 180,
      fps: 4,
      durationMs: 1_000,
      format: "frames-rgb24",
    },
  });

  test("stages REAL rgb24 frames with exact byte accounting", () => {
    const engine = makeEngine();
    const handle = engine.buildScene(buildRequest, snapshot, events);
    const result = engine.renderScene(renderRequest(handle.sceneId));
    expect(result.output.kind).toBe("frame-output");
    expect(result.provenance).toEqual({ snapshotVersion: 5, lastEventSequence: 22 });
    expect(result.telemetry.framesRendered).toBe(4); // 4 fps × 1000 ms
    expect(result.telemetry.droppedFrames).toBe(0);
    expect(result.telemetry.renderMs).toBeGreaterThanOrEqual(0);
    expect(result.degraded).toBe(false);
    const staged = engine.readStagedFrames(result);
    expect(staged.frameCount).toBe(4);
    expect(staged.byteLength).toBe(4 * 320 * 180 * 3);
    expect(readFileSync(frameOutputOf(result).stagingRef).length).toBe(staged.byteLength);
  });

  test("renders are deterministic (byte-identical staged sequences)", () => {
    const engineA = makeEngine();
    const engineB = makeEngine();
    const handleA = engineA.buildScene(buildRequest, snapshot, events);
    const handleB = engineB.buildScene(buildRequest, snapshot, events);
    const a = engineA.renderScene(renderRequest(handleA.sceneId));
    const b = engineB.renderScene(renderRequest(handleB.sceneId));
    expect(frameOutputOf(a).stagingRef).toBe(frameOutputOf(b).stagingRef); // deterministic refs
    expect(
      Buffer.compare(
        readFileSync(frameOutputOf(a).stagingRef),
        readFileSync(frameOutputOf(b).stagingRef),
      ),
    ).toBe(0);
    expect(a).toEqual(b); // deep-equal results (deterministic clock default)
  });

  test("the SAME scene renders differently per style (ADR-009)", () => {
    const engine = makeEngine();
    const stylized = engine.buildScene(
      { ...buildRequest, renderingStyle: "stylized-3d" },
      snapshot,
      events,
    );
    const cel = engine.buildScene(
      { ...buildRequest, renderingStyle: "cel-shaded" },
      snapshot,
      events,
    );
    const a = engine.renderScene(renderRequest(stylized.sceneId));
    const b = engine.renderScene(renderRequest(cel.sceneId));
    const bytesA = readFileSync(frameOutputOf(a).stagingRef);
    const bytesB = readFileSync(frameOutputOf(b).stagingRef);
    expect(Buffer.compare(bytesA, bytesB)).not.toBe(0);
    // The two styles also produce visibly different frame content: count
    // distinct colors (cel shading is flat two-band + outlines).
    const colorsOf = (bytes: Buffer): Set<string> => {
      const colors = new Set<string>();
      for (let i = 0; i < bytes.length; i += 3) {
        colors.add(`${bytes[i]},${bytes[i + 1]},${bytes[i + 2]}`);
      }
      return colors;
    };
    expect(colorsOf(bytesA).size).toBeGreaterThan(8);
    expect(colorsOf(bytesB).size).toBeGreaterThan(8);
  });

  test("the aerial presentation hint moves the camera (different frames)", () => {
    const engine = makeEngine();
    const handle = engine.buildScene(buildRequest, snapshot, events);
    const ground = engine.renderScene(renderRequest(handle.sceneId));
    const aerial = engine.renderScene({
      ...renderRequest(handle.sceneId),
      presentation: { camera: "aerial" },
    });
    expect(
      Buffer.compare(
        readFileSync(frameOutputOf(ground).stagingRef),
        readFileSync(frameOutputOf(aerial).stagingRef),
      ),
    ).not.toBe(0);
  });

  test("an event applied between renders changes the frames (badges are real)", () => {
    const engine = makeEngine();
    const handle = engine.buildScene(buildRequest, snapshot, events);
    const before = engine.renderScene(renderRequest(handle.sceneId));
    engine.applySceneEvents(handle, [
      {
        sequence: 23,
        snapshotVersionAfter: 23,
        event: buildEventEnvelope(
          { eventId: "ge-3", sessionId: "sess-engine-synthetic", eventTimeMs: 30_400 },
          30215,
        ),
      },
    ]);
    const after = engine.renderScene(renderRequest(handle.sceneId));
    expect(after.provenance.lastEventSequence).toBe(23);
    expect(
      Buffer.compare(
        readFileSync(frameOutputOf(before).stagingRef),
        readFileSync(frameOutputOf(after).stagingRef),
      ),
    ).not.toBe(0);
  });

  test("a frame budget overrun drops frames with loud degradation", () => {
    const engine = new SoftwareSceneEngine({ stagingDir: staging, maxFramesPerRender: 3 });
    const handle = engine.buildScene(buildRequest, snapshot, events);
    const result = engine.renderScene({
      schemaVersion: "1.1",
      sceneId: handle.sceneId,
      outputProfile: {
        widthPx: 320,
        heightPx: 180,
        fps: 10,
        durationMs: 1_000,
        format: "frames-rgb24",
      },
    });
    expect(result.telemetry.framesRendered).toBe(3);
    expect(result.telemetry.droppedFrames).toBe(7); // 10 requested, 3 rendered
    expect(result.degraded).toBe(true);
    expect(result.degradationReason).toMatch(/frame budget/);
  });

  test("unsupported formats and unknown scenes fail loud", () => {
    const engine = makeEngine();
    const handle = engine.buildScene(buildRequest, snapshot, events);
    expect(() =>
      engine.renderScene({
        schemaVersion: "1.1",
        sceneId: handle.sceneId,
        outputProfile: {
          widthPx: 320,
          heightPx: 180,
          fps: 4,
          durationMs: 1_000,
          format: "mp4-h264",
        },
      }),
    ).toThrow(GameEngineAdapterError);
    expect(() =>
      engine.renderScene({
        schemaVersion: "1.1",
        sceneId: "scene-deadbeef",
        outputProfile: {
          widthPx: 320,
          heightPx: 180,
          fps: 4,
          durationMs: 1_000,
          format: "frames-rgb24",
        },
      }),
    ).toThrow(/no scene with id/);
  });

  test("invalid output profiles fail loud", () => {
    const engine = makeEngine();
    const handle = engine.buildScene(buildRequest, snapshot, events);
    expect(() =>
      engine.renderScene({
        schemaVersion: "1.1",
        sceneId: handle.sceneId,
        outputProfile: {
          widthPx: 0,
          heightPx: 180,
          fps: 4,
          durationMs: 1_000,
          format: "frames-rgb24",
        },
      }),
    ).toThrow(/does not parse against its frozen contract schema/);
    expect(() =>
      engine.renderScene({
        schemaVersion: "1.1",
        sceneId: handle.sceneId,
        outputProfile: {
          widthPx: 320,
          heightPx: 180,
          fps: 4,
          durationMs: 1_000,
          format: "frames-rgb24",
        },
        presentation: { camera: 42 as never },
      }),
    ).toThrow(/does not parse against its frozen contract schema/);
  });
});

describe("construction", () => {
  test("requires a declared staging root", () => {
    expect(() => new SoftwareSceneEngine({ stagingDir: "" })).toThrow(GameEngineAdapterError);
  });
});
