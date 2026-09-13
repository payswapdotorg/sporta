import { describe, expect, test } from "bun:test";
import type { RenderRequest } from "@sporta/contracts";
import { buildEventEnvelope, buildWorldSnapshot } from "@sporta/testing";
import { createTestCardRenderer, runConformance } from "../src/index";
import type { ConformanceReport, RenderInput, RendererPlugin } from "../src/index";
import {
  SANE_CAPABILITY,
  cloneJson,
  makeSaneRenderer,
  saneRenderResult,
  saneValidate,
} from "./helpers";

/** The 13 stable check ids in documented order. */
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

function checkById(report: ConformanceReport, checkId: string) {
  const check = report.checks.find((item) => item.checkId === checkId);
  expect(check).toBeDefined();
  return check!;
}

/** A capability with the source-frames requirement switched on (still valid). */
const FRAMES_CAPABILITY = { ...SANE_CAPABILITY, requiresSourceFrames: true };

describe("runConformance — self-test against the reference renderer", () => {
  test("the test card renderer passes every check", () => {
    const report = runConformance(createTestCardRenderer());
    expect(report.passed).toBe(true);
    expect(report.checks.map((check) => check.checkId)).toEqual([...ALL_CHECK_IDS]);
    expect(report.plugin.rendererId).toBe("sporta.testcard");
  });

  test("the rights check is reported as n/a (the test card requires no source frames)", () => {
    const report = runConformance(createTestCardRenderer());
    const rightsCheck = checkById(report, "validate-rejects-source-frames-without-rights");
    expect(rightsCheck.passed).toBe(true);
    expect(rightsCheck.detail?.startsWith("n/a")).toBe(true);
  });

  test("passes with an explicitly empty event list (provenance baseline 0)", () => {
    const report = runConformance(createTestCardRenderer(), { events: [] });
    expect(report.passed).toBe(true);
    expect(checkById(report, "render-provenance-faithful").detail).toContain("lastEventSequence=0");
  });

  test("passes with a caller-provided snapshot and event stream", () => {
    const snapshot = buildWorldSnapshot(
      { sessionId: "sess-custom", watermark: { watermarkMs: 5_000, sequence: 10 } },
      42,
    );
    const events = [
      {
        sequence: 11,
        snapshotVersionAfter: 2,
        event: buildEventEnvelope(
          { eventId: "custom-a", sessionId: "sess-custom", eventTimeMs: 5_500 },
          42,
        ),
      },
      {
        sequence: 12,
        snapshotVersionAfter: 3,
        event: buildEventEnvelope(
          { eventId: "custom-b", sessionId: "sess-custom", eventTimeMs: 6_000 },
          42,
        ),
      },
    ];
    const report = runConformance(createTestCardRenderer(), { snapshot, events });
    expect(report.passed).toBe(true);
  });

  test("the sane mock itself passes every check (harness sanity)", () => {
    const report = runConformance(makeSaneRenderer());
    expect(report.passed).toBe(true);
  });

  test("a source-frames renderer passes with the rights check active", () => {
    const plugin = makeSaneRenderer({ capability: FRAMES_CAPABILITY });
    const report = runConformance(plugin);
    expect(report.passed).toBe(true);
    expect(checkById(report, "validate-rejects-source-frames-without-rights").detail).not.toContain(
      "n/a",
    );
  });
});

describe("runConformance — negative conformance (one broken rule per mock)", () => {
  test("BadCapability (invalid capability document) → capability-schema-valid", () => {
    const badCapability = { ...SANE_CAPABILITY, minSnapshotVersion: -1 }; // schema-invalid
    const report = runConformance(
      makeSaneRenderer({ capability: badCapability, gatesCapability: SANE_CAPABILITY }),
    );
    expect(report.passed).toBe(false);
    expect(failedCheckIds(report)).toEqual(["capability-schema-valid"]);
    expect(checkById(report, "capability-schema-valid").detail).toContain("minSnapshotVersion");
  });

  test("UnstableCapability (identity drifts between calls) → capability-stable", () => {
    const base = makeSaneRenderer();
    let calls = 0;
    const unstable: RendererPlugin = {
      ...base,
      capability: () => {
        calls += 1;
        return calls === 1
          ? cloneJson(SANE_CAPABILITY)
          : cloneJson({ ...SANE_CAPABILITY, rendererVersion: "9.9.9" });
      },
    };
    const report = runConformance(unstable);
    expect(report.passed).toBe(false);
    expect(failedCheckIds(report)).toEqual(["capability-stable"]);
  });

  test("SloppyValidate (accepts an unsupported profile) → validate-rejects-unsupported-profile", () => {
    const sloppy = makeSaneRenderer({
      validateRequest: (req) => saneValidate(req, SANE_CAPABILITY, { skipProfileGate: true }),
    });
    const report = runConformance(sloppy);
    expect(report.passed).toBe(false);
    expect(failedCheckIds(report)).toEqual(["validate-rejects-unsupported-profile"]);
  });

  test("ProvenanceLiar (claims more application than the events allow) → render-provenance-faithful", () => {
    const liar = makeSaneRenderer({
      decorateResult: (_req, _input, base) => ({
        ...base,
        provenance: {
          ...base.provenance,
          lastEventSequence: base.provenance.lastEventSequence + 7,
        },
      }),
    });
    const report = runConformance(liar);
    expect(report.passed).toBe(false);
    expect(failedCheckIds(report)).toEqual(["render-provenance-faithful"]);
  });

  test("WatermarkRegressor (sequence regresses below the last event) → render-watermark-monotonic", () => {
    const regressor = makeSaneRenderer({
      decorateResult: (_req, _input, base) => ({
        ...base,
        watermarkAfter: { ...base.watermarkAfter, sequence: base.watermarkAfter.sequence - 1 },
      }),
    });
    const report = runConformance(regressor);
    expect(report.passed).toBe(false);
    expect(failedCheckIds(report)).toEqual(["render-watermark-monotonic"]);
  });

  test("WatermarkMsRegressor (watermarkMs regresses below the snapshot) → render-watermark-monotonic", () => {
    const regressor = makeSaneRenderer({
      decorateResult: (_req, input, base) => ({
        ...base,
        watermarkAfter: {
          ...base.watermarkAfter,
          watermarkMs: input.snapshot.watermark.watermarkMs - 1,
        },
      }),
    });
    const snapshot = buildWorldSnapshot({
      sessionId: "sess-ms-regress",
      watermark: { watermarkMs: 5_000, sequence: 10 },
    });
    const report = runConformance(regressor, { snapshot });
    expect(report.passed).toBe(false);
    expect(failedCheckIds(report)).toEqual(["render-watermark-monotonic"]);
  });

  test("OverlapSegments (overlapping segments with duplicate ids) → render-segments-wellformed", () => {
    const overlapping = makeSaneRenderer({
      decorateResult: (_req, input, base) => {
        const startMs = input.snapshot.watermark.watermarkMs;
        return {
          ...base,
          outputSegments: [
            { segmentId: "ov-0", startMs, endMs: startMs + 3_000, artifactRef: "sane://ov-0" },
            {
              segmentId: "ov-0",
              startMs: startMs + 2_000,
              endMs: startMs + 4_000,
              artifactRef: "sane://ov-1",
            },
          ],
        };
      },
    });
    const report = runConformance(overlapping);
    expect(report.passed).toBe(false);
    expect(failedCheckIds(report)).toEqual(["render-segments-wellformed"]);
    const detail = checkById(report, "render-segments-wellformed").detail ?? "";
    expect(detail).toContain("overlaps");
    expect(detail).toContain("duplicate segmentId");
  });

  test("IdentitySwap (result echoes the wrong sessionId) → render-session-identity", () => {
    const swapper = makeSaneRenderer({
      decorateResult: (_req, _input, base) => ({ ...base, sessionId: "session-swapped" }),
    });
    const report = runConformance(swapper);
    expect(report.passed).toBe(false);
    expect(failedCheckIds(report)).toEqual(["render-session-identity"]);
  });

  test("StaleSilent (skips events but reports healthy) → degradation-explicit", () => {
    const staleSilent = makeSaneRenderer({
      decorateResult: (_req, input, base) => ({
        ...base,
        provenance: {
          ...base.provenance,
          lastEventSequence: input.events.length > 0 ? input.events[0]!.sequence : 0,
        },
      }),
    });
    const report = runConformance(staleSilent);
    expect(report.passed).toBe(false);
    expect(failedCheckIds(report)).toEqual(["degradation-explicit"]);
    expect(checkById(report, "degradation-explicit").detail).toContain("silent staleness");
    // The honest partial provenance itself stays faithful (R5 allows less
    // than full application when flagged; the silence is the R7 violation).
    expect(checkById(report, "render-provenance-faithful").passed).toBe(true);
  });

  test("Zombie (renders after dispose) → render-refuses-after-dispose", () => {
    const zombie = makeSaneRenderer({ dispose: () => {} });
    const report = runConformance(zombie);
    expect(report.passed).toBe(false);
    expect(failedCheckIds(report)).toEqual(["render-refuses-after-dispose"]);
  });

  test("NoDefense (validate rejects but render proceeds) → render-defense-in-depth", () => {
    const noDefense = makeSaneRenderer({ renderValidates: false });
    const report = runConformance(noDefense);
    expect(report.passed).toBe(false);
    expect(failedCheckIds(report)).toEqual(["render-defense-in-depth"]);
  });

  test("RightsLeaker (accepts source frames without rights) → validate-rejects-source-frames-without-rights", () => {
    const leaker = makeSaneRenderer({
      capability: FRAMES_CAPABILITY,
      validateRequest: (req) => saneValidate(req, FRAMES_CAPABILITY, { skipRightsGate: true }),
    });
    const report = runConformance(leaker);
    expect(report.passed).toBe(false);
    expect(failedCheckIds(report)).toEqual(["validate-rejects-source-frames-without-rights"]);
  });
});

describe("runConformance — harness robustness (never throws on a violating plugin)", () => {
  test("an async render (Promise) fails the render-dependent checks without escaping", () => {
    const base = makeSaneRenderer();
    const asyncPlugin: RendererPlugin = {
      ...base,
      render: (req: RenderRequest, input: RenderInput) =>
        Promise.resolve(saneRenderResult(req, input)),
    };
    const report = runConformance(asyncPlugin);
    expect(report.passed).toBe(false);
    expect(failedCheckIds(report)).toEqual([
      "render-result-schema-valid",
      "render-provenance-faithful",
      "render-watermark-monotonic",
      "render-segments-wellformed",
      "render-session-identity",
      "degradation-explicit",
      "render-refuses-after-dispose",
      "render-defense-in-depth",
    ]);
    expect(checkById(report, "render-result-schema-valid").detail).toContain("Promise");
  });

  test("a plugin that throws from every method yields a full report, not an exception", () => {
    const hostile: RendererPlugin = {
      pluginKind: "sporta-renderer",
      capability: () => {
        throw new Error("boom-capability");
      },
      init: () => {
        throw new Error("boom-init");
      },
      validateRequest: () => {
        throw new Error("boom-validate");
      },
      render: () => {
        throw new Error("boom-render");
      },
      health: () => {
        throw new Error("boom-health");
      },
      dispose: () => {
        throw new Error("boom-dispose");
      },
    };
    const report = runConformance(hostile);
    expect(report.checks).toHaveLength(13);
    expect(report.passed).toBe(false);
    expect(failedCheckIds(report)).toContain("capability-schema-valid");
    expect(failedCheckIds(report)).toContain("render-result-schema-valid");
    expect(failedCheckIds(report)).toContain("render-refuses-after-dispose");
  });
});
