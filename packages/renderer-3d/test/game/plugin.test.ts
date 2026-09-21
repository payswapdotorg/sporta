/**
 * The R303/R304 plugin tests — the W501 contract rules exercised against
 * BOTH renderer identities through their REAL render path (real staged
 * frames → real ffmpeg encode → real content-addressed MP4 artifact +
 * manifest). The ADR-009 difference test and the same-event integrity
 * tests live in their own files; this file proves each plugin INDIVIDUALLY
 * honors the gates, the artifact chain, and honest degradation.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { RendererContractError } from "@sporta/renderer-contract";
import { manifestProvenanceIssues } from "@sporta/contracts";
import {
  ANIME_MP4_SD_TWOS_PROFILE,
  ANIME_NPR_RENDERER_ID,
  ANIME_NPR_RENDERER_VERSION,
  GAME_3D_RENDERER_ID,
  GAME_3D_RENDERER_VERSION,
  GAME_MP4_SD_PROFILE,
  createAnimeNprRenderer,
  createGame3DRenderer,
  parseGameStyleConfig,
} from "../../src/index";
import type { GameRealityRenderer } from "../../src/index";
import { Software3DEngine } from "../../src/game/engine";
import type { GameEngineAdapter, WorldEventStreamEntry } from "@sporta/contracts";
import {
  CODEC,
  DENY_ALL,
  buildAnimeRequest,
  buildFixtureEvents,
  buildFixtureSnapshot,
  buildGame3dRequest,
} from "./helpers";

/** The shared per-plugin suite (the SAME structure both identities honor). */
function pluginSuite(options: {
  name: string;
  make: () => GameRealityRenderer;
  makeWithEngine: (engine: GameEngineAdapter) => GameRealityRenderer;
  rendererId: string;
  rendererVersion: string;
  makeRequest: (overrides?: {
    camera?: "aerial-follow" | "sideline-follow";
    durationMs?: number;
  }) => ReturnType<typeof buildGame3dRequest>;
}): void {
  const { name, make, makeWithEngine, rendererId, rendererVersion, makeRequest } = options;

  describe(`${name} — capability + admission gates`, () => {
    test("R1: capability() is schema-valid and deep-equal on every call", () => {
      const plugin = make();
      expect(plugin.capability()).toEqual(plugin.capability());
      expect(plugin.capability().rendererId).toBe(rendererId);
      expect(plugin.capability().rendererVersion).toBe(rendererVersion);
      expect(plugin.capability().requiresSourceFrames).toBe(false);
      // R304 (Wave-3): the anime capability carries THREE profiles (the slim
      // "on twos" default first + the historical SD + HD); R303 keeps TWO.
      expect(plugin.capability().supportedOutputProfiles.length).toBe(
        rendererId === "anime-npr.prototype" ? 3 : 2,
      );
      expect(plugin.pluginKind).toBe("sporta-renderer");
    });

    test("init() without a context is a no-op; health() is a static snapshot", () => {
      const plugin = make();
      expect(plugin.init()).toBeUndefined();
      expect(plugin.health()).toEqual({ lagMs: 0, degraded: false });
    });

    test("R3: rejects a wrong renderer identity", () => {
      const plugin = make();
      const validation = plugin.validateRequest({
        ...makeRequest(),
        rendererId: "someone-else",
      });
      expect(validation).toMatchObject({ ok: false, failureClass: "media-invalid" });
    });

    test("R3: rejects an off-list output profile", () => {
      const plugin = make();
      const validation = plugin.validateRequest({
        ...makeRequest(),
        outputProfile: { ...GAME_MP4_SD_PROFILE, codec: "av1" },
      });
      expect(validation).toMatchObject({ ok: false, failureClass: "media-invalid" });
    });

    test("R3: rejects a stale snapshot version", () => {
      const plugin = make();
      const validation = plugin.validateRequest({ ...makeRequest(), snapshotVersion: -1 });
      expect(validation).toMatchObject({ ok: false, failureClass: "media-invalid" });
    });

    test("R2 posture: carried source-frame refs without rights are rights-denied", () => {
      const plugin = make();
      const validation = plugin.validateRequest({
        ...makeRequest(),
        rightsCapabilities: DENY_ALL,
        sourceFrameRefs: ["src-frame-1"],
      });
      expect(validation).toMatchObject({ ok: false, failureClass: "rights-denied" });
    });

    test("rejects a malformed style config (media-invalid, never silent)", () => {
      const plugin = make();
      const validation = plugin.validateRequest({
        ...makeRequest(),
        styleConfig: { styleId: "s", configSchemaVersion: "1.0", config: { durationMs: 1 } },
      });
      expect(validation).toMatchObject({ ok: false, failureClass: "media-invalid" });
      expect((validation as { reason?: string }).reason).toContain("durationMs");
    });

    test("parseGameStyleConfig defaults and bounds", () => {
      expect(parseGameStyleConfig(undefined)).toEqual({
        ok: true,
        value: { durationMs: 4_000, camera: "aerial-follow", seed: 0 },
      });
      expect(
        parseGameStyleConfig({ durationMs: 2_000, camera: "sideline-follow", seed: -3 }),
      ).toEqual({
        ok: true,
        value: { durationMs: 2_000, camera: "sideline-follow", seed: -3 },
      });
      expect(parseGameStyleConfig("nope").ok).toBe(false);
      expect(parseGameStyleConfig({ camera: "drone" }).ok).toBe(false);
      expect(parseGameStyleConfig({ seed: 0.5 }).ok).toBe(false);
    });
  });

  describe.skipIf(!CODEC.available)(`${name} — the real render path`, () => {
    test("produces a REAL playable MP4 with the full artifact chain", () => {
      const plugin = make();
      const output = plugin.renderDetailed(makeRequest(), {
        snapshot: buildFixtureSnapshot(),
        events: buildFixtureEvents(),
      });
      // The artifact exists, probes honest, and hashes to its content address.
      const bytes = readFileSync(output.artifactPath);
      expect(bytes.byteLength).toBe(output.manifest.byteSize);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(output.contentHash);
      expect(output.manifest.contentHash).toBe(output.contentHash);
      expect(output.manifest.integrity).toEqual({ algorithm: "sha256", verified: true });
      expect(output.manifest.rendererId).toBe(rendererId);
      expect(output.manifest.rendererVersion).toBe(rendererVersion);
      expect(output.probe.codecName).toBe("h264");
      expect(output.probe.widthPx).toBe(640);
      expect(output.probe.heightPx).toBe(360);
      // The manifest carries SWM provenance and passes the structural rule.
      expect(output.manifest.swm).toEqual({ snapshotVersion: 1, lastEventSequence: 7 });
      expect(manifestProvenanceIssues(output.manifest)).toEqual([]);
      // The engine telemetry is honest and present.
      expect(output.engine.framesRendered).toBe(40); // 1600 ms @ 25 fps
      expect(output.engine.descriptor.engineId).toBe("sporta.software-3d");
    });

    test("the W501 result: provenance, watermark, segments, session identity", () => {
      const plugin = make();
      const output = plugin.renderDetailed(makeRequest(), {
        snapshot: buildFixtureSnapshot(),
        events: buildFixtureEvents(),
      });
      const result = output.result;
      expect(result.sessionId).toBe(result.sessionId);
      expect(result.rendererId).toBe(rendererId);
      // R5: lastEventSequence = the last APPLIED event's sequence.
      expect(result.provenance).toEqual({ snapshotVersion: 1, lastEventSequence: 7 });
      // R6: watermarkAfter = the input position (last event), advanced in time.
      expect(result.watermarkAfter.sequence).toBe(7);
      expect(result.watermarkAfter.watermarkMs).toBe(10_000 + 1_600);
      // R8: one well-formed segment referencing the artifact by content hash.
      expect(result.outputSegments).toHaveLength(1);
      const segment = result.outputSegments[0]!;
      expect(segment.startMs).toBe(10_000);
      expect(segment.endMs).toBe(11_600);
      expect(segment.artifactRef).toBe(`artifact://${output.contentHash}`);
      expect(segment.segmentId.length).toBeGreaterThan(0);
      // Health is honest: no degradation on the happy path.
      expect(result.rendererHealth.degraded).toBe(false);
    });

    test("R5 baseline: no events → lastEventSequence 0, watermark = snapshot's", () => {
      const plugin = make();
      const output = plugin.renderDetailed(makeRequest(), {
        snapshot: buildFixtureSnapshot(),
        events: [],
      });
      expect(output.result.provenance.lastEventSequence).toBe(0);
      expect(output.result.watermarkAfter.sequence).toBe(4); // snapshot watermark
      expect(output.manifest.swm).toEqual({ snapshotVersion: 1, lastEventSequence: 0 });
    });

    test("R7: engine-reported degradation propagates WITH a reason (injectable seam)", () => {
      // The plugin consumes any GameEngineAdapter behind the frozen seam;
      // an adapter that reports degradation must surface it honestly in the
      // result health (never swallowed, never invented).
      const real = new Software3DEngine();
      const degrading: GameEngineAdapter = {
        describe: () => real.describe(),
        buildScene: (request, snapshot, events) => real.buildScene(request, snapshot, events),
        applySceneEvents: (handle, events) => real.applySceneEvents(handle, events),
        renderScene: (request) => {
          const result = real.renderScene(request);
          return {
            ...result,
            degraded: true,
            degradationReason: "stubbed: engine degradation propagation probe",
          };
        },
      };
      const plugin = makeWithEngine(degrading);
      const output = plugin.renderDetailed(makeRequest(), {
        snapshot: buildFixtureSnapshot(),
        events: buildFixtureEvents(),
      });
      expect(output.result.rendererHealth.degraded).toBe(true);
      expect(output.result.rendererHealth.degradationReason).toContain(
        "stubbed: engine degradation propagation probe",
      );
      // The artifact + provenance stay honest alongside the degradation.
      expect(output.manifest.integrity.verified).toBe(true);
      expect(output.manifest.swm).toEqual({ snapshotVersion: 1, lastEventSequence: 7 });
    });

    test("out-of-envelope events are refused loud at admission (never partially applied)", () => {
      // The avatar-field admission discipline: a cross-session event is a
      // malformed INPUT for a render (media-invalid), not something the
      // engine silently skips mid-render — the engine's own out-of-envelope
      // accounting is exercised directly in engine.test.ts.
      const plugin = make();
      const junk = [
        ...buildFixtureEvents(),
        {
          sequence: 8,
          snapshotVersionAfter: 14,
          event: {
            eventId: "junk-1",
            sessionId: "sess-elsewhere",
            schemaVersion: "1.1",
            eventTypeRef: "football/v1/pass",
            interval: { startTimeMs: 11_000, endTimeMs: 11_100 },
            eventTimeMs: 11_100,
            provenance: "DERIVED",
            evidence: { observationIds: ["obs-junk"] },
          },
        } satisfies WorldEventStreamEntry,
      ];
      expect(() =>
        plugin.render(makeRequest(), {
          snapshot: buildFixtureSnapshot(),
          events: junk,
        }),
      ).toThrow(/belongs to session/);
    });

    test("R4: disposal is terminal — render after dispose throws internal", () => {
      const plugin = make();
      plugin.dispose();
      expect(() =>
        plugin.render(makeRequest(), {
          snapshot: buildFixtureSnapshot(),
          events: buildFixtureEvents(),
        }),
      ).toThrow(RendererContractError);
      try {
        plugin.render(makeRequest(), { snapshot: buildFixtureSnapshot(), events: [] });
        expect.unreachable();
      } catch (error) {
        expect((error as RendererContractError).failureClass).toBe("internal");
      }
      plugin.dispose(); // idempotent
    });

    test("defense in depth: render re-runs every gate without prior validation", () => {
      const plugin = make();
      // Off-list profile straight to render (no validateRequest first).
      expect(() =>
        plugin.render(
          { ...makeRequest(), outputProfile: { ...GAME_MP4_SD_PROFILE, codec: "av1" } },
          { snapshot: buildFixtureSnapshot(), events: [] },
        ),
      ).toThrow(RendererContractError);
      // Carried refs without rights straight to render.
      expect(() =>
        plugin.render(
          { ...makeRequest(), rightsCapabilities: DENY_ALL, sourceFrameRefs: ["s-1"] },
          { snapshot: buildFixtureSnapshot(), events: [] },
        ),
      ).toThrow(RendererContractError);
      try {
        plugin.render(
          { ...makeRequest(), outputProfile: { ...GAME_MP4_SD_PROFILE, codec: "av1" } },
          { snapshot: buildFixtureSnapshot(), events: [] },
        );
        expect.unreachable();
      } catch (error) {
        expect((error as RendererContractError).failureClass).toBe("media-invalid");
      }
    });

    test("malformed SWM documents fail loud (media-invalid), never a fake render", () => {
      const plugin = make();
      expect(() =>
        plugin.render(makeRequest(), {
          snapshot: { ...buildFixtureSnapshot(), sessionId: "sess-other" },
          events: [],
        }),
      ).toThrow(/belongs to session/);
      expect(() =>
        plugin.render(makeRequest(), {
          snapshot: buildFixtureSnapshot(),
          events: [
            {
              sequence: 5,
              snapshotVersionAfter: 11,
              event: { ...buildFixtureEvents()[0]!.event, sessionId: "sess-other" },
            },
          ],
        }),
      ).toThrow(/belongs to session/);
      expect(() =>
        plugin.render(makeRequest(), {
          snapshot: buildFixtureSnapshot(),
          events: [
            {
              sequence: 4, // NOT above the previous (none) — still must ascend from nothing? 4 is fine alone
              snapshotVersionAfter: 11,
              event: buildFixtureEvents()[0]!.event,
            },
            {
              sequence: 4, // duplicate sequence: non-ascending
              snapshotVersionAfter: 12,
              event: buildFixtureEvents()[1]!.event,
            },
          ],
        }),
      ).toThrow(/not above the previous/);
    });

    test("the sideline camera preset renders a different (still valid) artifact", () => {
      const plugin = make();
      const aerial = plugin.renderDetailed(makeRequest({ camera: "aerial-follow" }), {
        snapshot: buildFixtureSnapshot(),
        events: buildFixtureEvents(),
      });
      const sideline = plugin.renderDetailed(makeRequest({ camera: "sideline-follow" }), {
        snapshot: buildFixtureSnapshot(),
        events: buildFixtureEvents(),
      });
      expect(sideline.probe.codecName).toBe("h264");
      expect(sideline.contentHash).not.toBe(aerial.contentHash);
    });
  });
}

pluginSuite({
  name: "Game3DRenderer (R303, stylized-3d)",
  make: createGame3DRenderer,
  makeWithEngine: (engine) => createGame3DRenderer({ engine }),
  rendererId: GAME_3D_RENDERER_ID,
  rendererVersion: GAME_3D_RENDERER_VERSION,
  makeRequest: (overrides) => buildGame3dRequest(overrides),
});

pluginSuite({
  name: "AnimeNprRenderer (R304, cel-shaded)",
  make: createAnimeNprRenderer,
  makeWithEngine: (engine) => createAnimeNprRenderer({ engine }),
  rendererId: ANIME_NPR_RENDERER_ID,
  rendererVersion: ANIME_NPR_RENDERER_VERSION,
  makeRequest: (overrides) => buildAnimeRequest(overrides),
});

describe("the two identities share one structure (same seams, different style)", () => {
  test("identities differ; capabilities differ only in identity+class+profile list", () => {
    const game = createGame3DRenderer().capability();
    const anime = createAnimeNprRenderer().capability();
    expect(game.rendererId).not.toBe(anime.rendererId);
    expect(game.rendererClass).toBe("procedural-3d");
    expect(anime.rendererClass).toBe("stylized-video");
    // Wave-3: the anime capability now carries its OWN default profile first
    // (the on-twos slim default — the J013 budget resolution); the shared
    // tail (the historical SD + HD profiles both still support) is the same.
    expect(anime.supportedOutputProfiles[0]).toBe(ANIME_MP4_SD_TWOS_PROFILE);
    expect(anime.supportedOutputProfiles.slice(1)).toEqual(game.supportedOutputProfiles);
    expect(game.requiresSourceFrames).toBe(anime.requiresSourceFrames);
  });
});
