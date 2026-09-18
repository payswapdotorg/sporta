/**
 * The W501 conformance gate for BOTH R303/R304 plugins — the full harness
 * (13 stable checks) over the REAL render path. The harness probes with
 * the capability's FIRST output profile and the DEFAULT style config
 * (4 000 ms → 100 frames at 25 fps), so each run performs a real engine
 * render + real ffmpeg encode + real artifact verification.
 */
import { describe, expect, test } from "bun:test";
import { runConformance } from "@sporta/renderer-contract";
import type { ConformanceReport } from "@sporta/renderer-contract";
import { createAnimeNprRenderer, createGame3DRenderer } from "../../src/index";
import { CODEC } from "./helpers";

/** The 13 stable check ids in documented order (W501 contract). */
const ALL_CHECK_IDS = [
  "capability-schema-valid",
  "capability-stable",
  "validate-rejects-unsupported-profile",
  "validate-rejects-source-frames-without-rights",
  "validate-rejects-stale-snapshot",
  "render-result-schema-valid",
  "render-provenance-faithful",
  "render-watermark-monotonic",
  "render-segments-wellformed",
  "render-session-identity",
  "degradation-explicit",
  "render-refuses-after-dispose",
  "render-defense-in-depth",
] as const;

function failedCheckIds(report: ConformanceReport): string[] {
  return report.checks.filter((check) => !check.passed).map((check) => check.checkId);
}

describe.skipIf(!CODEC.available)(
  "runConformance — the R303/R304 plugins vs the full W501 harness",
  () => {
    test("Game3DRenderer PASSES all 13 checks (the R303 conformance gate)", () => {
      const report = runConformance(createGame3DRenderer());
      expect(report.passed).toBe(true);
      expect(failedCheckIds(report)).toEqual([]);
      expect(report.checks.map((check) => check.checkId)).toEqual([...ALL_CHECK_IDS]);
      expect(report.plugin.rendererId).toBe("game-3d.prototype");
    }, 30_000);

    test("AnimeNprRenderer PASSES all 13 checks (the R304 conformance gate)", () => {
      const report = runConformance(createAnimeNprRenderer());
      expect(report.passed).toBe(true);
      expect(failedCheckIds(report)).toEqual([]);
      expect(report.checks.map((check) => check.checkId)).toEqual([...ALL_CHECK_IDS]);
      expect(report.plugin.rendererId).toBe("anime-npr.prototype");
    }, 30_000);

    test("the rights probe is honestly n/a (pure SWM→scene→pixels, no source frames)", () => {
      for (const make of [createGame3DRenderer, createAnimeNprRenderer]) {
        const report = runConformance(make());
        const rightsCheck = report.checks.find(
          (check) => check.checkId === "validate-rejects-source-frames-without-rights",
        )!;
        expect(rightsCheck.passed).toBe(true);
        expect(rightsCheck.detail?.startsWith("n/a")).toBe(true);
      }
    }, 30_000);

    test("passes with an explicitly empty event list (provenance baseline 0)", () => {
      for (const make of [createGame3DRenderer, createAnimeNprRenderer]) {
        const report = runConformance(make(), { events: [] });
        expect(report.passed).toBe(true);
        const provenance = report.checks.find(
          (check) => check.checkId === "render-provenance-faithful",
        )!;
        expect(provenance.detail).toContain("lastEventSequence=0");
      }
    }, 30_000);

    test("passes with a caller-provided football snapshot and event stream", () => {
      const snapshot: import("@sporta/contracts").WorldSnapshot = {
        sessionId: "sess-conformance-game",
        schemaVersion: "1.1",
        watermark: { watermarkMs: 5_000, sequence: 10 },
        entities: [
          {
            entityId: "ball-1",
            kind: "ball" as const,
            version: 1,
            lastEventTimeMs: 4_900,
            state: { pitchPosition: { status: "known", value: { x: 60, y: 34 }, confidence: 0.9 } },
          },
          {
            entityId: "player-9",
            kind: "participant" as const,
            version: 2,
            lastEventTimeMs: 4_800,
            state: {
              pitchPosition: { status: "known", value: { x: 55, y: 30 }, confidence: 0.8 },
              teamRole: { status: "known", value: "midfielder" },
            },
          },
        ],
        football: {
          pitch: {
            lengthAxisMeters: 105,
            widthAxisMeters: 68,
            origin: "corner",
            axes: "x=touchline, y=goal-line",
          },
          clock: { period: "first-half", clockMs: 600_000, stoppage: false },
          score: { home: 0, away: 0, status: { status: "known", value: "provisional" } },
          possession: { status: "uncertain", value: { entityId: "player-9" }, confidence: 0.6 },
          eventTaxonomyVersion: "v1",
        },
        generatedAtMs: 1_736_164_800_000,
      };
      const events: import("@sporta/contracts").WorldEventStreamEntry[] = [1, 2, 3].map((i) => ({
        sequence: 10 + i,
        snapshotVersionAfter: 20 + i,
        event: {
          eventId: `cg-${i}`,
          sessionId: "sess-conformance-game",
          schemaVersion: "1.1",
          eventTypeRef: "football/v1/pass",
          interval: { startTimeMs: 5_000 + i * 100 - 50, endTimeMs: 5_000 + i * 100 },
          eventTimeMs: 5_000 + i * 100,
          provenance: "DERIVED",
          confidence: 0.8,
          evidence: { observationIds: [`obs-${i}`] },
        },
      }));
      for (const make of [createGame3DRenderer, createAnimeNprRenderer]) {
        const report = runConformance(make(), { snapshot, events });
        expect(report.passed).toBe(true);
        const watermark = report.checks.find(
          (check) => check.checkId === "render-watermark-monotonic",
        )!;
        expect(watermark.detail).toContain("sequence: 13");
      }
    }, 30_000);
  },
);
