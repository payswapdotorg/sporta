import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  ANIME_MP4_SD_TWOS_PROFILE,
  ANIME_NPR_RENDERER_ID,
  ANIME_NPR_RENDERER_VERSION,
  GAME_MP4_HD_PROFILE,
  GAME_MP4_SD_PROFILE,
  createAnimeNprRenderer,
} from "../../src/index";
import type { GameRealityRenderer } from "../../src/index";
import { CODEC, ALLOW_ALL, buildFixtureEvents, buildFixtureSnapshot } from "./helpers";
import type { RenderRequest } from "@sporta/contracts";

/**
 * THE ANIME-BUDGET RESOLUTION PIN (Wave-3, J013 finding (b) — the TL decision
 * "slim the render, keep the platform budget"): the anime-NPR prototype's
 * DEFAULT render must fit UNDER the hosted compute plane's fail-closed
 * 1 000 000-byte artifact budget (packages/compute-adapter-hosted/src/
 * budgets.ts `DEFAULT_HOSTED_COMPUTE_BUDGETS.maxArtifactBytes` — the platform
 * guardrail, TL-gated and untouched by this change).
 *
 * THE KNOB (renderer-local, per the decision): the frame BUDGET — the anime
 * capability's DEFAULT output profile is now the "on twos" SD profile
 * (640×360 @ 12 fps — the traditional cel-animation cadence), so the default
 * render is 12 fps × the 4 000 ms default duration = 48 frames instead of
 * 100. Measured through the REAL pipeline (the apps/web J013 battery, the
 * pitch-marked perception path): 650 036–671 203 bytes ≈ 65 % of the budget
 * (the previous default measured 1 038 993–1 082 922 bytes — OVER).
 *
 * THE HONEST QUALITY TRADE-OFF: half the temporal resolution (12 fps). The
 * historical SD @ 25 fps and HD @ 25 fps profiles REMAIN SUPPORTED — an
 * explicit request for them is honored (and may still exceed the platform
 * budget, failing closed at the compute plane — never a silent downgrade).
 *
 * REAL-vs-FIXTURE: the artifact under test is a REAL ffmpeg/libx264 encode
 * of the REAL engine's staged frames over the canonical FIXTURE SWM (the
 * deterministic @sporta/testing snapshot + event tail — no clock, no RNG).
 * The renderer-local measurement here is the conservative fast pin; the
 * app-path measurement (real perception → SWM → dispatch → compute plane)
 * is the J013 battery's own graduated gate.
 */

/** The platform guardrail this renderer's defaults must fit (documented, not imported — the budget is the compute plane's constant). */
const HOSTED_MAX_ARTIFACT_BYTES = 1_000_000;

/** The default render request: the FIRST supported profile + the DEFAULT style config (no overrides). */
function defaultAnimeRequest(): RenderRequest {
  const capability = createAnimeNprRenderer().capability();
  return {
    sessionId: "sess-game-render",
    schemaVersion: "1.1",
    rendererId: ANIME_NPR_RENDERER_ID,
    rendererVersion: ANIME_NPR_RENDERER_VERSION,
    styleConfig: { styleId: "default", configSchemaVersion: "1.0", config: {} },
    snapshotVersion: 1,
    eventsSinceSequence: 4,
    outputProfile: capability.supportedOutputProfiles[0]!,
    rightsCapabilities: ALLOW_ALL,
    sourceFrameRefs: [],
  };
}

/** One real render of the fixture world (the populated pitch + its event tail). */
function renderDefaults(plugin: GameRealityRenderer): {
  byteSize: number;
  framesRendered: number;
  durationMs: number;
  contentHash: string;
} {
  const output = plugin.renderDetailed(defaultAnimeRequest(), {
    snapshot: buildFixtureSnapshot(),
    events: buildFixtureEvents(),
  });
  const bytes = readFileSync(output.artifactPath);
  expect(bytes.byteLength).toBe(output.manifest.byteSize);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(output.contentHash);
  return {
    byteSize: output.manifest.byteSize,
    framesRendered: output.engine.framesRendered,
    durationMs: output.manifest.durationMs,
    contentHash: output.contentHash,
  };
}

describe("the anime-budget resolution (Wave-3 — the slim default profile)", () => {
  test("the anime capability's DEFAULT profile is the on-twos SD profile; the historical SD/HD remain supported", () => {
    const capability = createAnimeNprRenderer().capability();
    expect(capability.supportedOutputProfiles[0]).toEqual(ANIME_MP4_SD_TWOS_PROFILE);
    expect(ANIME_MP4_SD_TWOS_PROFILE.frameRate).toBe(12);
    expect(ANIME_MP4_SD_TWOS_PROFILE.resolution).toEqual({ w: 640, h: 360 });
    // The honest escape hatches stay advertised (explicit requests honored).
    expect(capability.supportedOutputProfiles).toContainEqual(GAME_MP4_SD_PROFILE);
    expect(capability.supportedOutputProfiles).toContainEqual(GAME_MP4_HD_PROFILE);
    // The version moved with the deliberate restyle (immutable versions).
    expect(capability.rendererVersion).toBe("0.2.0");
  });

  test.skipIf(!CODEC.available)(
    "the DEFAULT render of a populated pitch fits UNDER the platform's fail-closed artifact budget",
    () => {
      const plugin = createAnimeNprRenderer();
      const { byteSize, framesRendered, durationMs } = renderDefaults(plugin);
      // The frame budget knob, pinned: 12 fps × the 4 000 ms default = 48.
      expect(framesRendered).toBe(48);
      expect(durationMs).toBeGreaterThanOrEqual(4_000);
      // The budget pin (the platform guardrail the defaults must fit).
      expect(byteSize).toBeLessThanOrEqual(HOSTED_MAX_ARTIFACT_BYTES);
      // Honest margin, not a shaved pass: the fixture render lands well under.
      expect(byteSize).toBeGreaterThan(100_000);
    },
  );

  test.skipIf(!CODEC.available)(
    "the same defaults → byte-identical artifacts (the determinism pin holds for the new profile)",
    () => {
      const first = renderDefaults(createAnimeNprRenderer());
      const second = renderDefaults(createAnimeNprRenderer());
      expect(second.contentHash).toBe(first.contentHash);
      expect(second.byteSize).toBe(first.byteSize);
      expect(second.framesRendered).toBe(first.framesRendered);
    },
  );

  test.skipIf(!CODEC.available)(
    "an EXPLICIT SD @ 25 fps request is still honored (never a silent downgrade)",
    () => {
      const plugin = createAnimeNprRenderer();
      const request: RenderRequest = {
        ...defaultAnimeRequest(),
        outputProfile: GAME_MP4_SD_PROFILE,
      };
      const validation = plugin.validateRequest(request);
      expect(validation.ok).toBe(true);
      const output = plugin.renderDetailed(request, {
        snapshot: buildFixtureSnapshot(),
        events: buildFixtureEvents(),
      });
      // The explicit 25 fps profile renders its full 100-frame window.
      expect(output.engine.framesRendered).toBe(100);
    },
  );

  test.skipIf(!CODEC.available)(
    "the on-twos default still responds to MEANINGFUL SWM differences (sensitivity survives the slimming)",
    () => {
      // The J013 sensitivity direction, at the DEFAULTS: two materially
      // different fixture worlds render different artifacts through the
      // slim default profile (the renderer still responds at 12 fps).
      const plugin = createAnimeNprRenderer();
      const request = defaultAnimeRequest();
      const left = plugin.renderDetailed(request, {
        snapshot: buildFixtureSnapshot(),
        events: buildFixtureEvents(),
      });
      const different = buildFixtureSnapshot();
      const ball = different.entities.find((entity) => entity.entityId === "ball-1")!;
      ball.state["pitchPosition"] = { status: "known", value: { x: 12.5, y: 55 }, confidence: 0.9 };
      ball.state["height"] = { status: "known", value: 1.8, confidence: 0.7 };
      const mover = different.entities.find((entity) => entity.entityId === "player-8")!;
      mover.state["pitchPosition"] = { status: "known", value: { x: 95, y: 60 }, confidence: 0.75 };
      const right = plugin.renderDetailed(request, {
        snapshot: different,
        events: buildFixtureEvents(),
      });
      expect(right.contentHash).not.toBe(left.contentHash);
    },
  );
});
