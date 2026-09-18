import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEventEnvelope, buildWorldSnapshot } from "@sporta/testing";
import { runConformance, type ConformanceReport } from "@sporta/renderer-contract";
import { createFfmpegH264Codec } from "../src/codec";
import { createTacticalRenderer } from "../src/plugin";
import {
  SYNTHETIC_FIXTURE_LABEL,
  buildSyntheticTacticalEvents,
  buildSyntheticTacticalSnapshot,
} from "./helpers";

/**
 * R301 acceptance: the W501 renderer-contract conformance harness
 * (`runConformance`) against the tactical plugin, over SYNTHETIC-DIAGNOSTIC
 * SWM documents only (this is NOT real-video acceptance — that arrives with
 * the R305-R307 reconstructed-SWM waves).
 */
const ffmpegOk = createFfmpegH264Codec() !== null;

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

let staging: string;

beforeAll(() => {
  staging = mkdtempSync(join(tmpdir(), "tactical-conformance-"));
});

afterAll(() => {
  rmSync(staging, { recursive: true, force: true });
});

function failedCheckIds(report: ConformanceReport): string[] {
  return report.checks.filter((check) => !check.passed).map((check) => check.checkId);
}

describe(`runConformance — the tactical renderer vs the full W501 harness (${SYNTHETIC_FIXTURE_LABEL})`, () => {
  test.skipIf(!ffmpegOk)("PASSES every one of the 13 checks (R1-R8 green)", () => {
    const report = runConformance(createTacticalRenderer({ stagingDir: staging }));
    expect(report.passed).toBe(true);
    expect(failedCheckIds(report)).toEqual([]);
    expect(report.checks.map((check) => check.checkId)).toEqual([...ALL_CHECK_IDS]);
    expect(report.plugin.rendererId).toBe("tactical.prototype");
  });

  test.skipIf(!ffmpegOk)("the rights probe is honestly n/a (pure SWM projection)", () => {
    const report = runConformance(createTacticalRenderer({ stagingDir: staging }));
    const rightsCheck = report.checks.find(
      (check) => check.checkId === "validate-rejects-source-frames-without-rights",
    )!;
    expect(rightsCheck.passed).toBe(true);
    expect(rightsCheck.detail?.startsWith("n/a")).toBe(true);
  });

  test.skipIf(!ffmpegOk)(
    "passes with an explicitly empty event list (provenance baseline 0)",
    () => {
      const report = runConformance(createTacticalRenderer({ stagingDir: staging }), {
        events: [],
      });
      expect(report.passed).toBe(true);
      const provenance = report.checks.find(
        (check) => check.checkId === "render-provenance-faithful",
      )!;
      expect(provenance.detail).toContain("lastEventSequence=0");
    },
  );

  test.skipIf(!ffmpegOk)(
    `passes with the ${SYNTHETIC_FIXTURE_LABEL} football snapshot + event tail`,
    () => {
      const snapshot = buildSyntheticTacticalSnapshot();
      const events = buildSyntheticTacticalEvents();
      const report = runConformance(createTacticalRenderer({ stagingDir: staging }), {
        snapshot,
        events,
      });
      expect(report.passed).toBe(true);
      expect(failedCheckIds(report)).toEqual([]);
    },
  );

  test.skipIf(!ffmpegOk)("passes with a caller-provided bare snapshot and composed events", () => {
    const snapshot = buildWorldSnapshot(
      { sessionId: "sess-conformance-tactical", watermark: { watermarkMs: 5_000, sequence: 10 } },
      42,
    );
    const events = [
      {
        sequence: 11,
        snapshotVersionAfter: 2,
        event: buildEventEnvelope(
          { eventId: "tactical-a", sessionId: "sess-conformance-tactical", eventTimeMs: 5_500 },
          42,
        ),
      },
      {
        sequence: 12,
        snapshotVersionAfter: 3,
        event: buildEventEnvelope(
          { eventId: "tactical-b", sessionId: "sess-conformance-tactical", eventTimeMs: 6_000 },
          42,
        ),
      },
    ];
    const report = runConformance(createTacticalRenderer({ stagingDir: staging }), {
      snapshot,
      events,
    });
    expect(report.passed).toBe(true);
    expect(failedCheckIds(report)).toEqual([]);
  });

  test.skipIf(!ffmpegOk)(
    "happy-path detail: healthy with full application, one well-formed segment",
    () => {
      const report = runConformance(createTacticalRenderer({ stagingDir: staging }));
      const segments = report.checks.find(
        (check) => check.checkId === "render-segments-wellformed",
      )!;
      expect(segments.detail).toContain("1 segment(s) well-formed");
      const degradation = report.checks.find((check) => check.checkId === "degradation-explicit")!;
      expect(degradation.detail).toContain("healthy with full application");
    },
  );
});
