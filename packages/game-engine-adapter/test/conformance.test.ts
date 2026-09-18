import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEventEnvelope, buildWorldSnapshot } from "@sporta/testing";
import { SoftwareSceneEngine } from "../src/engine";
import {
  GAME_ENGINE_CONFORMANCE_CHECK_IDS,
  runGameEngineConformance,
  type GameEngineConformanceReport,
} from "../src/conformance";

/**
 * R302 acceptance: the GameEngineAdapter conformance suite (G1-G13) against
 * the reference `SoftwareSceneEngine`, over SYNTHETIC-DIAGNOSTIC SWM
 * documents only (deterministic `@sporta/testing` builders — NOT real-video
 * acceptance; R305-R307 own that).
 */
let staging: string;

beforeAll(() => {
  staging = mkdtempSync(join(tmpdir(), "game-engine-conformance-"));
});

afterAll(() => {
  rmSync(staging, { recursive: true, force: true });
});

function failedCheckIds(report: GameEngineConformanceReport): string[] {
  return report.checks.filter((check) => !check.passed).map((check) => check.checkId);
}

describe("runGameEngineConformance — the reference software engine (synthetic-diagnostic)", () => {
  test("PASSES every one of the 13 checks (G1-G13 green)", () => {
    const report = runGameEngineConformance(new SoftwareSceneEngine({ stagingDir: staging }));
    expect(report.passed).toBe(true);
    expect(failedCheckIds(report)).toEqual([]);
    expect(report.checks.map((check) => check.checkId)).toEqual([
      ...GAME_ENGINE_CONFORMANCE_CHECK_IDS,
    ]);
    expect(report.engine?.engineId).toBe("sporta.software-raster");
  });

  test("G1 evidence: the descriptor is vendor-neutral with two styles and one format", () => {
    const report = runGameEngineConformance(new SoftwareSceneEngine({ stagingDir: staging }));
    const g1 = report.checks.find((check) => check.checkId === "G1")!;
    expect(g1.passed).toBe(true);
    expect(g1.detail).toContain("styles=[stylized-3d, cel-shaded]");
    expect(g1.detail).toContain("formats=[frames-rgb24]");
  });

  test("G10 evidence: the two styles render the same scene differently", () => {
    const report = runGameEngineConformance(new SoftwareSceneEngine({ stagingDir: staging }));
    const g10 = report.checks.find((check) => check.checkId === "G10")!;
    expect(g10.passed).toBe(true);
    expect(g10.detail).toContain("stylized-3d");
    expect(g10.detail).toContain("cel-shaded");
    expect(g10.detail).toContain("different frames");
  });

  test("G4 evidence: replays + out-of-envelope events are counted with degradation", () => {
    const report = runGameEngineConformance(new SoftwareSceneEngine({ stagingDir: staging }));
    const g4 = report.checks.find((check) => check.checkId === "G4")!;
    expect(g4.passed).toBe(true);
    expect(g4.detail).toContain("skipped 2 (1 replay + 1 unsupported)");
  });

  test("passes with a caller-provided synthetic snapshot + explicit events", () => {
    const snapshot = buildWorldSnapshot(
      { sessionId: "sess-engine-conf", watermark: { watermarkMs: 1_000, sequence: 5 } },
      30291,
    );
    const events = [
      {
        sequence: 6,
        snapshotVersionAfter: 6,
        event: buildEventEnvelope(
          { eventId: "ge-c1", sessionId: "sess-engine-conf", eventTimeMs: 1_500 },
          30292,
        ),
      },
      {
        sequence: 7,
        snapshotVersionAfter: 7,
        event: buildEventEnvelope(
          { eventId: "ge-c2", sessionId: "sess-engine-conf", eventTimeMs: 1_800 },
          30293,
        ),
      },
    ];
    const report = runGameEngineConformance(new SoftwareSceneEngine({ stagingDir: staging }), {
      snapshot,
      events,
    });
    expect(report.passed).toBe(true);
    expect(failedCheckIds(report)).toEqual([]);
  });

  test("passes with an explicitly empty event list (watermark baseline)", () => {
    const snapshot = buildWorldSnapshot(
      { sessionId: "sess-engine-empty", watermark: { watermarkMs: 500, sequence: 3 } },
      30294,
    );
    const report = runGameEngineConformance(new SoftwareSceneEngine({ stagingDir: staging }), {
      snapshot,
      events: [],
    });
    expect(report.passed).toBe(true);
    const g3 = report.checks.find((check) => check.checkId === "G3")!;
    expect(g3.detail).toContain(`appliedEventSequence=3`);
  });

  test("the harness never throws on a misbehaving adapter (fail-soft evidence)", () => {
    const broken = {
      describe: () => {
        throw new Error("broken describe");
      },
      buildScene: () => {
        throw new Error("broken buildScene");
      },
      applySceneEvents: () => {
        throw new Error("broken applySceneEvents");
      },
      renderScene: () => {
        throw new Error("broken renderScene");
      },
    };
    const report = runGameEngineConformance(broken);
    expect(report.passed).toBe(false);
    expect(report.checks.length).toBe(13);
    expect(report.checks.every((check) => typeof check.detail === "string")).toBe(true);
    expect(failedCheckIds(report).length).toBeGreaterThan(0);
  });
});
