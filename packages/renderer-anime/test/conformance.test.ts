import { describe, expect, test } from "bun:test";
import { buildEventEnvelope, buildWorldSnapshot } from "@sporta/testing";
import { runConformance } from "@sporta/renderer-contract";
import type { ConformanceReport } from "@sporta/renderer-contract";
import { createAnimePrototypeRenderer } from "../src/index";

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

describe("runConformance — the anime prototype vs the full W501 harness", () => {
  test("PASSES every one of the 13 checks (W502 acceptance gate)", () => {
    const report = runConformance(createAnimePrototypeRenderer());
    expect(report.passed).toBe(true);
    expect(failedCheckIds(report)).toEqual([]);
    expect(report.checks.map((check) => check.checkId)).toEqual([...ALL_CHECK_IDS]);
    expect(report.plugin.rendererId).toBe("anime.prototype");
  });

  test("the rights probe is honestly n/a (pure SWM projection, no source frames required)", () => {
    const report = runConformance(createAnimePrototypeRenderer());
    const rightsCheck = report.checks.find(
      (check) => check.checkId === "validate-rejects-source-frames-without-rights",
    )!;
    expect(rightsCheck.passed).toBe(true);
    expect(rightsCheck.detail?.startsWith("n/a")).toBe(true);
    // The fail-closed rights posture lives in the plugin's own extra gate
    // (carried references without rights → rights-denied); see plugin tests.
  });

  test("passes with an explicitly empty event list (provenance baseline 0)", () => {
    const report = runConformance(createAnimePrototypeRenderer(), { events: [] });
    expect(report.passed).toBe(true);
    const provenance = report.checks.find(
      (check) => check.checkId === "render-provenance-faithful",
    )!;
    expect(provenance.detail).toContain("lastEventSequence=0");
  });

  test("passes with a caller-provided football snapshot and event stream", () => {
    const snapshot = buildWorldSnapshot(
      { sessionId: "sess-conformance-anime", watermark: { watermarkMs: 5_000, sequence: 10 } },
      42,
    );
    const events = [
      {
        sequence: 11,
        snapshotVersionAfter: 2,
        event: buildEventEnvelope(
          { eventId: "anime-a", sessionId: "sess-conformance-anime", eventTimeMs: 5_500 },
          42,
        ),
      },
      {
        sequence: 12,
        snapshotVersionAfter: 3,
        event: buildEventEnvelope(
          { eventId: "anime-b", sessionId: "sess-conformance-anime", eventTimeMs: 6_000 },
          42,
        ),
      },
    ];
    const report = runConformance(createAnimePrototypeRenderer(), { snapshot, events });
    expect(report.passed).toBe(true);
    expect(failedCheckIds(report)).toEqual([]);
  });

  test("happy-path detail: full application, healthy, 6 well-formed segments", () => {
    const report = runConformance(createAnimePrototypeRenderer());
    const segments = report.checks.find((check) => check.checkId === "render-segments-wellformed")!;
    expect(segments.detail).toContain("6 segment(s) well-formed");
    const degradation = report.checks.find((check) => check.checkId === "degradation-explicit")!;
    expect(degradation.detail).toContain("healthy with full application");
  });
});
