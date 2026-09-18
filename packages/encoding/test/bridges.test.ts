/**
 * The three renderer-bridge tests over the REAL renderers (dev-only
 * dependencies — the renderers stay untouched): the tactical bridge
 * ADOPTS + VERIFIES R301's own staged MP4; the game bridges encode the
 * REAL Software3DEngine frame streams (stylized-3d for R303, cel-shaded
 * for R304) through the real ffmpeg `FrameEncoderPort`; every artifact
 * carries the source renderer id + version, frame count, duration, codec
 * params, sha-256 content hash, per-frame timing, and the renderer's own
 * manifest VERBATIM. Real-encode tests carry the typed skip guard.
 */
import { describe, expect, test } from "bun:test";
import { createTacticalRenderer } from "@sporta/renderer-tactical";
import { Software3DEngine } from "@sporta/renderer-3d";
import type { GameEngineFrameOutput } from "@sporta/contracts";
import {
  EncodingError,
  FixtureFrameEncoder,
  bridgeGameFrameOutput,
  bridgeRgbFrames,
  bridgeTacticalRenderer,
  createFfmpegFrameEncoder,
  decodeEncodedFrames,
  probeEncodedArtifact,
  registerEncodedArtifact,
  type EncodedArtifact,
} from "../src/index";
import { InMemoryArtifactStore } from "@sporta/output-pipeline";
import {
  FRAME_FPS,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  SESSION_ID,
  cleanDir,
  fixtureEvents,
  fixtureSnapshot,
  syntheticFrames,
  tacticalRenderRequest,
  tempDir,
} from "./helpers";

const encoder = createFfmpegFrameEncoder();
const available = encoder !== null;

describe.skipIf(!available)("the tactical bridge (adopt + verify R301's own MP4)", () => {
  test("adopts the real staged artifact with verified hashes + the frozen manifest VERBATIM", () => {
    const staging = tempDir("sporta-encoding-tactical-");
    try {
      const renderer = createTacticalRenderer({ stagingDir: staging });
      const artifact = bridgeTacticalRenderer({
        renderer,
        req: tacticalRenderRequest(),
        input: { snapshot: fixtureSnapshot(), events: fixtureEvents() },
      });
      expect(artifact.kind).toBe("mp4");
      expect(artifact.manifest.bridge).toBe("tactical");
      expect(artifact.manifest.source.rendererId).toBe("tactical.prototype");
      expect(artifact.manifest.source.rendererVersion).toBe("0.1.0");
      expect(artifact.manifest.swm).toEqual({ snapshotVersion: 1, lastEventSequence: 23 });
      // The renderer's own manifest rides VERBATIM (the frozen document).
      const frozen = artifact.manifest.rendererManifest as {
        schemaVersion: string;
        reality: string;
        contentHash: string;
        integrity: { verified: boolean };
      };
      expect(frozen.schemaVersion).toBe("1.1");
      expect(frozen.reality).toBe("tactical");
      expect(frozen.contentHash).toBe(artifact.contentHash);
      expect(frozen.integrity.verified).toBe(true);
      // The adopted MP4 is REAL: it probes and decodes.
      const probe = probeEncodedArtifact(artifact);
      expect(probe.codecName).toBe("h264");
      expect(probe.frameCount).toBe(artifact.manifest.geometry.frameCount);
      expect(decodeEncodedFrames(artifact).length).toBe(artifact.manifest.geometry.frameCount);
    } finally {
      cleanDir(staging);
    }
  });

  test("registers in the W504 store (the full R306 chain)", () => {
    const staging = tempDir("sporta-encoding-tactical-");
    try {
      const renderer = createTacticalRenderer({ stagingDir: staging });
      const artifact = bridgeTacticalRenderer({
        renderer,
        req: tacticalRenderRequest(),
        input: { snapshot: fixtureSnapshot(), events: fixtureEvents() },
      });
      const store = new InMemoryArtifactStore();
      const registration = registerEncodedArtifact(store, artifact);
      expect(registration.outcome).toBe("stored");
      expect(registration.metadata.renderId).toBe("tactical.prototype");
    } finally {
      cleanDir(staging);
    }
  });

  test("a lying staged record (hash mismatch) is refused", () => {
    const staging = tempDir("sporta-encoding-tactical-");
    try {
      const renderer = createTacticalRenderer({ stagingDir: staging });
      const req = tacticalRenderRequest();
      const input = { snapshot: fixtureSnapshot(), events: fixtureEvents() };
      const honest = renderer.renderDetailed(req, input);
      // A lying clone of the renderer's staged record.
      const lying = {
        renderDetailed: () => ({
          ...honest,
          details: {
            ...honest.details,
            artifact: { ...honest.details.artifact, contentHash: "0".repeat(64) },
          },
        }),
      };
      expect(() => bridgeTacticalRenderer({ renderer: lying, req, input })).toThrow(EncodingError);
    } finally {
      cleanDir(staging);
    }
  });
});

describe.skipIf(!available)("the game-3d bridge (R303 frame stream → real MP4)", () => {
  test("encodes the real Software3DEngine stream (stylized-3d) with engine provenance", () => {
    const stagingRoot = tempDir("sporta-encoding-game-");
    try {
      const engine = new Software3DEngine({ stagingRoot });
      const snapshot = fixtureSnapshot();
      const handle = engine.buildScene(
        {
          schemaVersion: "1.1",
          sessionId: SESSION_ID,
          snapshotVersion: 1,
          renderingStyle: "stylized-3d",
        },
        snapshot,
        fixtureEvents(),
      );
      const rendered = engine.renderScene({
        schemaVersion: "1.1",
        sceneId: handle.sceneId,
        outputProfile: {
          widthPx: 160,
          heightPx: 90,
          fps: 25,
          durationMs: 800,
          format: "frames-rgb24",
        },
        presentation: { camera: "aerial-follow", seed: "7" },
      });
      expect(rendered.output.kind).toBe("frame-output");
      const frameOutput = rendered.output as GameEngineFrameOutput;
      const artifact = bridgeGameFrameOutput({
        encoder: encoder!,
        frameOutput,
        sessionId: SESSION_ID,
        origin: {
          rendererId: "game-3d.prototype",
          rendererVersion: "0.1.0",
          bridge: "game-3d",
          engineId: engine.describe().engineId,
          engineVersion: engine.describe().engineVersion,
        },
        swm: { snapshotVersion: 1, lastEventSequence: rendered.provenance.lastEventSequence },
      });
      expect(artifact.kind).toBe("mp4");
      expect(artifact.manifest.bridge).toBe("game-3d");
      expect(artifact.manifest.source.engineId).toBe("sporta.software-3d");
      expect(artifact.manifest.geometry.frameCount).toBe(20);
      expect(artifact.manifest.geometry.durationMs).toBe(800);
      expect(probeEncodedArtifact(artifact).codecName).toBe("h264");
      engine.dispose();
    } finally {
      cleanDir(stagingRoot);
    }
  });

  test("DETERMINISM: a fresh engine + fresh encode reproduces the byte-identical MP4", () => {
    const render = (root: string) => {
      const engine = new Software3DEngine({ stagingRoot: root });
      const handle = engine.buildScene(
        {
          schemaVersion: "1.1",
          sessionId: SESSION_ID,
          snapshotVersion: 1,
          renderingStyle: "stylized-3d",
        },
        fixtureSnapshot(),
        fixtureEvents(),
      );
      const rendered = engine.renderScene({
        schemaVersion: "1.1",
        sceneId: handle.sceneId,
        outputProfile: {
          widthPx: 160,
          heightPx: 90,
          fps: 25,
          durationMs: 800,
          format: "frames-rgb24",
        },
        presentation: { camera: "aerial-follow", seed: "7" },
      });
      const artifact = bridgeGameFrameOutput({
        encoder: encoder!,
        frameOutput: rendered.output as GameEngineFrameOutput,
        sessionId: SESSION_ID,
        origin: {
          rendererId: "game-3d.prototype",
          rendererVersion: "0.1.0",
          bridge: "game-3d",
          engineId: engine.describe().engineId,
          engineVersion: engine.describe().engineVersion,
        },
        swm: { snapshotVersion: 1, lastEventSequence: rendered.provenance.lastEventSequence },
      });
      engine.dispose();
      return artifact;
    };
    const a = render(tempDir("sporta-encoding-det-a-"));
    const b = render(tempDir("sporta-encoding-det-b-"));
    expect(a.contentHash).toBe(b.contentHash);
    expect(Buffer.compare(Buffer.from(a.bytes), Buffer.from(b.bytes))).toBe(0);
  });
});

describe.skipIf(!available)("the anime-npr bridge (R304 frame stream → real MP4)", () => {
  test("encodes the real Software3DEngine stream (cel-shaded) — a materially different artifact", () => {
    const render = (style: "stylized-3d" | "cel-shaded", bridge: "game-3d" | "anime-npr") => {
      const stagingRoot = tempDir("sporta-encoding-anime-");
      try {
        const engine = new Software3DEngine({ stagingRoot });
        const handle = engine.buildScene(
          {
            schemaVersion: "1.1",
            sessionId: SESSION_ID,
            snapshotVersion: 1,
            renderingStyle: style,
          },
          fixtureSnapshot(),
          fixtureEvents(),
        );
        const rendered = engine.renderScene({
          schemaVersion: "1.1",
          sceneId: handle.sceneId,
          outputProfile: {
            widthPx: 160,
            heightPx: 90,
            fps: 25,
            durationMs: 800,
            format: "frames-rgb24",
          },
          presentation: { camera: "aerial-follow", seed: "7" },
        });
        return bridgeGameFrameOutput({
          encoder: encoder!,
          frameOutput: rendered.output as GameEngineFrameOutput,
          sessionId: SESSION_ID,
          origin: {
            rendererId: bridge === "anime-npr" ? "anime-npr.prototype" : "game-3d.prototype",
            rendererVersion: "0.1.0",
            bridge,
            engineId: engine.describe().engineId,
            engineVersion: engine.describe().engineVersion,
          },
          swm: { snapshotVersion: 1, lastEventSequence: rendered.provenance.lastEventSequence },
        });
      } finally {
        cleanDir(stagingRoot);
      }
    };
    const anime = render("cel-shaded", "anime-npr");
    expect(anime.kind).toBe("mp4");
    expect(anime.manifest.bridge).toBe("anime-npr");
    expect(decodeEncodedFrames(anime).length).toBe(20);
    // The two realities are materially different artifacts (different bytes).
    const game = render("stylized-3d", "game-3d");
    expect(anime.contentHash).not.toBe(game.contentHash);
  });
});

describe("the raw-frames bridge (in-memory tier)", () => {
  const fixtureEncoder = new FixtureFrameEncoder();

  test("encodes in-memory frames through the same port (fixture tier without ffmpeg)", () => {
    const artifact = bridgeRgbFrames({
      encoder: fixtureEncoder,
      frames: syntheticFrames(4),
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      fps: FRAME_FPS,
      origin: { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" },
      sessionId: SESSION_ID,
    });
    expect(artifact.kind).toBe("fixture");
    expect(artifact.manifest.geometry.frameCount).toBe(4);
    expect(artifact.manifest.frames[3]).toEqual({ frameIndex: 3, frameMs: 120 });
  });

  test("the game bridge refuses a non-game origin (closed vocabulary)", () => {
    expect(() =>
      bridgeGameFrameOutput({
        encoder: fixtureEncoder,
        frameOutput: {
          kind: "frame-output",
          stagingRef: "/nonexistent.rgb24",
          frameCount: 2,
          widthPx: FRAME_WIDTH,
          heightPx: FRAME_HEIGHT,
          fps: FRAME_FPS,
          pixelFormat: "rgb24",
        },
        sessionId: SESSION_ID,
        origin: { rendererId: "x", rendererVersion: "0", bridge: "raw-frames" },
      }),
    ).toThrow(EncodingError);
  });

  test("the game bridge refuses a non-rgb24 pixel format (fail-closed)", () => {
    expect(() =>
      bridgeGameFrameOutput({
        encoder: fixtureEncoder,
        frameOutput: {
          kind: "frame-output",
          stagingRef: "/nonexistent.rgba",
          frameCount: 2,
          widthPx: FRAME_WIDTH,
          heightPx: FRAME_HEIGHT,
          fps: FRAME_FPS,
          pixelFormat: "rgba32",
        },
        sessionId: SESSION_ID,
        origin: { rendererId: "game-3d.prototype", rendererVersion: "0.1.0", bridge: "game-3d" },
      }),
    ).toThrow(EncodingError);
  });

  test("an encoded artifact typechecks as the exported EncodedArtifact", () => {
    const artifact: EncodedArtifact = bridgeRgbFrames({
      encoder: fixtureEncoder,
      frames: syntheticFrames(2),
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      fps: FRAME_FPS,
      origin: { rendererId: "test", rendererVersion: "0.0.0", bridge: "raw-frames" },
      sessionId: SESSION_ID,
    });
    expect(artifact.manifestId).toMatch(/^enc-[0-9a-f]{8}$/);
  });
});
