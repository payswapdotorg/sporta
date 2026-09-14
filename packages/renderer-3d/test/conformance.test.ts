import { describe, expect, test } from "bun:test";
import { buildEventEnvelope, buildWorldSnapshot } from "@sporta/testing";
import { runConformance } from "@sporta/renderer-contract";
import type { ConformanceReport } from "@sporta/renderer-contract";
import { createAvatarFieldRenderer } from "../src/index";

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

describe("runConformance — the avatar/field prototype vs the full W501 harness", () => {
  test("PASSES every one of the 13 checks (the W602 acceptance gate)", () => {
    const report = runConformance(createAvatarFieldRenderer());
    expect(report.passed).toBe(true);
    expect(failedCheckIds(report)).toEqual([]);
    expect(report.checks.map((check) => check.checkId)).toEqual([...ALL_CHECK_IDS]);
    expect(report.plugin.rendererId).toBe("avatar-field.prototype");
  });

  test("the rights probe is honestly n/a (pure SWM→scene projection, no source frames required)", () => {
    const report = runConformance(createAvatarFieldRenderer());
    const rightsCheck = report.checks.find(
      (check) => check.checkId === "validate-rejects-source-frames-without-rights",
    )!;
    expect(rightsCheck.passed).toBe(true);
    expect(rightsCheck.detail?.startsWith("n/a")).toBe(true);
    // The fail-closed rights posture lives in the plugin's own extra gate
    // (carried references without rights → rights-denied); see plugin tests.
  });

  test("passes with an explicitly empty event list (provenance baseline 0)", () => {
    const report = runConformance(createAvatarFieldRenderer(), { events: [] });
    expect(report.passed).toBe(true);
    const provenance = report.checks.find(
      (check) => check.checkId === "render-provenance-faithful",
    )!;
    expect(provenance.detail).toContain("lastEventSequence=0");
  });

  test("passes with a caller-provided football snapshot and event stream", () => {
    const snapshot = buildWorldSnapshot(
      {
        sessionId: "sess-conformance-3d",
        watermark: { watermarkMs: 5_000, sequence: 10 },
      },
      42,
    );
    const events = [1, 2, 3].map((i) => {
      const event = buildEventEnvelope(
        {
          eventId: `fe-${i}`,
          sessionId: "sess-conformance-3d",
          eventTimeMs: 5_500 + i * 100,
          eventTypeRef: "football/v1/pass",
        },
        100 + i,
      );
      return { sequence: 10 + i, snapshotVersionAfter: 20 + i, event };
    });
    const report = runConformance(createAvatarFieldRenderer(), { snapshot, events });
    expect(report.passed).toBe(true);
    const watermark = report.checks.find(
      (check) => check.checkId === "render-watermark-monotonic",
    )!;
    expect(watermark.detail).toContain("watermarkMs: 11000, sequence: 13");
  });
});
