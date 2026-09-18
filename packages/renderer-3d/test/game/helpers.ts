/**
 * Deterministic R303/R304 test fixtures (docs/testing/HARNESS.md — no
 * Date.now, no Math.random; all times are explicit milliseconds).
 *
 * The canonical fixture: one session with a carried ball (KNOWN position
 * + height), 14 participants (a known goalkeeper, ten known-position
 * outfield players with headings, one uncertain winger, one no-position
 * substitute, one out-of-bounds recovering defender), one official, and
 * one non-projectable team entity — plus a 4-event football tail (two
 * passes, a goal, a cross-session junk entry lives in the dedicated
 * out-of-envelope tests, not here).
 */
import { buildEventEnvelope, buildWorldSnapshot, deepMerge } from "@sporta/testing";
import type { DeepPartial } from "@sporta/testing";
import type {
  RenderRequest,
  RightsCapabilities,
  WorldEntity,
  WorldEventStreamEntry,
  WorldSnapshot,
} from "@sporta/contracts";
import {
  ANIME_NPR_RENDERER_ID,
  ANIME_NPR_RENDERER_VERSION,
  GAME_3D_RENDERER_ID,
  GAME_3D_RENDERER_VERSION,
  GAME_MP4_SD_PROFILE,
  parseGameStyleConfig,
} from "../../src/index";
import type { GameCameraKey, GameStyleConfig } from "../../src/index";
import { probeCodec, type CodecAvailability } from "../../src/index";

export const SESSION_ID = "sess-game-render";

/** Full-allow rights (the happy-path capability set). */
export const ALLOW_ALL: RightsCapabilities = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
};

/** Full-deny rights (fail-closed probes). */
export const DENY_ALL: RightsCapabilities = {
  canReferenceSourceFrames: false,
  canDeliverLive: false,
  canStoreDerivatives: false,
  canShare: false,
};

/** The shared codec availability probe (typed skip guard for codec tests). */
export const CODEC: CodecAvailability = probeCodec();

/** Builds the canonical fixture snapshot. */
export function buildFixtureSnapshot(overrides: DeepPartial<WorldSnapshot> = {}): WorldSnapshot {
  const base: DeepPartial<WorldSnapshot> = {
    sessionId: SESSION_ID,
    watermark: { watermarkMs: 10_000, sequence: 4 },
    entities: [
      {
        entityId: "ball-1",
        kind: "ball",
        version: 1,
        lastEventTimeMs: 9_800,
        state: {
          pitchPosition: { status: "known", value: { x: 58.5, y: 31 }, confidence: 0.92 },
          height: { status: "known", value: 0.4, confidence: 0.8 },
        },
      },
      // The known goalkeeper (the distinct keeper kit path).
      {
        entityId: "player-1",
        kind: "participant",
        version: 3,
        lastEventTimeMs: 9_600,
        state: {
          pitchPosition: { status: "known", value: { x: 6, y: 34 }, confidence: 0.88 },
          teamRole: { status: "known", value: "goalkeeper" },
          jerseyNumber: { status: "known", value: 1 },
        },
      },
      // Ten known-position outfield players with carried headings.
      ...[...Array(10)].map((_, i): WorldEntity => ({
        entityId: `player-${i + 2}`,
        kind: "participant",
        version: 2,
        lastEventTimeMs: 9_500,
        state: {
          pitchPosition: {
            status: "known",
            value: { x: 30 + i * 4.2, y: 12 + (i % 6) * 8 },
            confidence: 0.7,
          },
          teamRole: { status: "known", value: i % 3 === 0 ? "defender" : "midfielder" },
          heading: { status: "known", value: i * 0.55, confidence: 0.6 },
        },
      })),
      // An uncertain winger (carried confidence, no heading).
      {
        entityId: "player-12",
        kind: "participant",
        version: 4,
        lastEventTimeMs: 9_700,
        state: {
          pitchPosition: { status: "uncertain", value: { x: 88, y: 20 }, confidence: 0.55 },
          teamRole: { status: "known", value: "forward" },
        },
      },
      // A no-position substitute (accounted, never placed).
      {
        entityId: "player-15",
        kind: "participant",
        version: 1,
        lastEventTimeMs: 8_000,
        state: { teamRole: { status: "known", value: "forward" } },
      },
      // An out-of-bounds recovering defender (TRUE position kept).
      {
        entityId: "player-16",
        kind: "participant",
        version: 5,
        lastEventTimeMs: 9_900,
        state: {
          pitchPosition: { status: "known", value: { x: 103, y: 70 }, confidence: 0.6 },
          teamRole: { status: "known", value: "defender" },
        },
      },
      // The official.
      {
        entityId: "official-1",
        kind: "official",
        version: 2,
        lastEventTimeMs: 9_000,
        state: {
          pitchPosition: { status: "known", value: { x: 52.5, y: 4 }, confidence: 0.9 },
        },
      },
      // A non-projectable kind (accounted by the projection, never drawn).
      {
        entityId: "team-home",
        kind: "team",
        version: 1,
        lastEventTimeMs: 0,
        state: {},
      },
    ],
    football: {
      pitch: {
        lengthAxisMeters: 105,
        widthAxisMeters: 68,
        origin: "corner",
        axes: "x=touchline, y=goal-line",
      },
      clock: { period: "first-half", clockMs: 1_275_000, stoppage: false },
      score: { home: 2, away: 1, status: { status: "known", value: "confirmed" } },
      possession: { status: "uncertain", value: { entityId: "player-8" }, confidence: 0.72 },
      eventTaxonomyVersion: "v1",
    },
    generatedAtMs: 1_736_164_800_000,
  };
  return buildWorldSnapshot(deepMerge(base, overrides), 42);
}

/** The canonical 3-event football tail (pass, pass, goal). */
export function buildFixtureEvents(): WorldEventStreamEntry[] {
  return [
    {
      sequence: 5,
      snapshotVersionAfter: 11,
      event: buildEventEnvelope(
        {
          eventId: "ge-1",
          sessionId: SESSION_ID,
          eventTimeMs: 10_400,
          eventTypeRef: "football/v1/pass",
        },
        101,
      ),
    },
    {
      sequence: 6,
      snapshotVersionAfter: 12,
      event: buildEventEnvelope(
        {
          eventId: "ge-2",
          sessionId: SESSION_ID,
          eventTimeMs: 11_000,
          eventTypeRef: "football/v1/pass",
        },
        102,
      ),
    },
    {
      sequence: 7,
      snapshotVersionAfter: 13,
      event: buildEventEnvelope(
        {
          eventId: "ge-3",
          sessionId: SESSION_ID,
          eventTimeMs: 11_600,
          eventTypeRef: "football/v1/goal",
        },
        103,
      ),
    },
  ];
}

/** Builds a style config with the fast test defaults. */
export function testStyleConfig(overrides: Partial<GameStyleConfig> = {}): {
  styleId: string;
  configSchemaVersion: string;
  config: Record<string, unknown>;
} {
  const parsed = parseGameStyleConfig({ durationMs: 1_600, camera: "aerial-follow", seed: 7 });
  if (!parsed.ok) throw new Error("test style config must parse");
  const value: GameStyleConfig = { ...parsed.value, ...overrides };
  return {
    styleId: "style-game-test",
    configSchemaVersion: "1.0",
    config: { durationMs: value.durationMs, camera: value.camera, seed: value.seed },
  };
}

/** Builds a deterministic, contract-valid request targeting one plugin. */
export function buildGameRequest(options: {
  rendererId: string;
  rendererVersion: string;
  camera?: GameCameraKey;
  durationMs?: number;
  seed?: number;
}): RenderRequest {
  const style = testStyleConfig({
    ...(options.camera !== undefined ? { camera: options.camera } : {}),
    ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
  });
  return {
    sessionId: SESSION_ID,
    schemaVersion: "1.1",
    rendererId: options.rendererId,
    rendererVersion: options.rendererVersion,
    styleConfig: style,
    snapshotVersion: 1,
    eventsSinceSequence: 4,
    outputProfile: GAME_MP4_SD_PROFILE,
    rightsCapabilities: ALLOW_ALL,
    sourceFrameRefs: [],
  };
}

/** A request targeting the R303 plugin. */
export function buildGame3dRequest(
  overrides: { camera?: GameCameraKey; durationMs?: number; seed?: number } = {},
): RenderRequest {
  return buildGameRequest({
    rendererId: GAME_3D_RENDERER_ID,
    rendererVersion: GAME_3D_RENDERER_VERSION,
    ...overrides,
  });
}

/** A request targeting the R304 plugin. */
export function buildAnimeRequest(
  overrides: { camera?: GameCameraKey; durationMs?: number; seed?: number } = {},
): RenderRequest {
  return buildGameRequest({
    rendererId: ANIME_NPR_RENDERER_ID,
    rendererVersion: ANIME_NPR_RENDERER_VERSION,
    ...overrides,
  });
}
