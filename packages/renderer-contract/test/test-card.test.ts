import { describe, expect, test } from "bun:test";
import { RenderResult, RendererCapability } from "@sporta/contracts";
import type { RenderRequest, WorldEventStreamEntry, WorldSnapshot } from "@sporta/contracts";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import type { DeepPartial } from "@sporta/testing";
import {
  TEST_EPOCH_MS,
  buildEventEnvelope,
  buildRenderRequest,
  buildWorldSnapshot,
} from "@sporta/testing";
import {
  RendererContractError,
  TESTCARD_OUTPUT_PROFILE,
  createTestCardRenderer,
} from "../src/index";

/** A request targeting the test card renderer with defaults (config {}). */
function testCardRequest(overrides: DeepPartial<RenderRequest> = {}): RenderRequest {
  return buildRenderRequest({
    rendererId: "sporta.testcard",
    rendererVersion: "0.1.0",
    outputProfile: TESTCARD_OUTPUT_PROFILE,
    snapshotVersion: 1,
    styleConfig: { styleId: "testcard", configSchemaVersion: "0.1.0", config: {} },
    sourceFrameRefs: [],
    ...overrides,
  });
}

function snapshotWith(watermarkMs: number, sequence: number, sessionId: string): WorldSnapshot {
  return buildWorldSnapshot({ sessionId, watermark: { watermarkMs, sequence } });
}

describe("createTestCardRenderer — capability (R1)", () => {
  test("declares the documented identity, class, profile and gates", () => {
    const renderer = createTestCardRenderer();
    expect(renderer.pluginKind).toBe("sporta-renderer");
    expect(renderer.capability()).toEqual({
      rendererId: "sporta.testcard",
      rendererVersion: "0.1.0",
      rendererClass: "tactical",
      supportedOutputProfiles: [TESTCARD_OUTPUT_PROFILE],
      requiresSourceFrames: false,
      minSnapshotVersion: 0,
    });
    expect(RendererCapability.safeParse(renderer.capability()).success).toBe(true);
  });

  test("capability() is deep-equal stable across calls (R1)", () => {
    const renderer = createTestCardRenderer();
    const first = renderer.capability();
    const second = renderer.capability();
    expect(second).toEqual(first);
    // Callers cannot corrupt identity by mutating a returned document.
    first.rendererId = "mutated";
    expect(renderer.capability().rendererId).toBe("sporta.testcard");
  });
});

describe("createTestCardRenderer — determinism", () => {
  test("the same request and input produce deep-equal results (same and fresh instance)", () => {
    const input = {
      snapshot: snapshotWith(30_000, 40, "sess-determinism"),
      events: [] as WorldEventStreamEntry[],
    };
    const request = testCardRequest({ sessionId: "sess-determinism" });
    const first = createTestCardRenderer();
    const second = createTestCardRenderer();
    first.init();
    second.init();
    const a = first.render(request, input);
    const b = first.render(request, input);
    const c = second.render(request, input);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(RenderResult.safeParse(a).success).toBe(true);
  });

  test("health() reports a healthy idle renderer", () => {
    expect(createTestCardRenderer().health()).toEqual({ lagMs: 0, degraded: false });
  });
});

describe("createTestCardRenderer — segment math", () => {
  test("durationMs 10_000 / segmentMs 2_000 yields 5 segments with exact boundaries", () => {
    const renderer = createTestCardRenderer();
    const input = {
      snapshot: snapshotWith(30_000, 40, "sess-segments"),
      events: [] as WorldEventStreamEntry[],
    };
    const request = testCardRequest({
      sessionId: "sess-segments",
      styleConfig: {
        styleId: "testcard",
        configSchemaVersion: "0.1.0",
        config: { durationMs: 10_000, segmentMs: 2_000 },
      },
    });
    const result = renderer.render(request, input);
    expect(result.outputSegments).toEqual([
      {
        segmentId: "tc-0",
        startMs: 30_000,
        endMs: 32_000,
        artifactRef: "testcard://sess-segments/1/0",
      },
      {
        segmentId: "tc-1",
        startMs: 32_000,
        endMs: 34_000,
        artifactRef: "testcard://sess-segments/1/1",
      },
      {
        segmentId: "tc-2",
        startMs: 34_000,
        endMs: 36_000,
        artifactRef: "testcard://sess-segments/1/2",
      },
      {
        segmentId: "tc-3",
        startMs: 36_000,
        endMs: 38_000,
        artifactRef: "testcard://sess-segments/1/3",
      },
      {
        segmentId: "tc-4",
        startMs: 38_000,
        endMs: 40_000,
        artifactRef: "testcard://sess-segments/1/4",
      },
    ]);
    // Empty events: provenance baseline is 0, watermark follows the snapshot.
    expect(result.provenance).toEqual({ snapshotVersion: 1, lastEventSequence: 0 });
    expect(result.watermarkAfter).toEqual({ watermarkMs: 40_000, sequence: 40 });
  });

  test("a partial final chunk is shortened, never zero-length", () => {
    const renderer = createTestCardRenderer();
    const input = {
      snapshot: snapshotWith(30_000, 40, "sess-partial"),
      events: [] as WorldEventStreamEntry[],
    };
    const request = testCardRequest({
      sessionId: "sess-partial",
      styleConfig: {
        styleId: "testcard",
        configSchemaVersion: "0.1.0",
        config: { durationMs: 5_000, segmentMs: 2_000 },
      },
    });
    const segments = renderer.render(request, input).outputSegments;
    expect(segments.map((s) => [s.startMs, s.endMs])).toEqual([
      [30_000, 32_000],
      [32_000, 34_000],
      [34_000, 35_000],
    ]);
  });

  test("a duration shorter than one segment yields a single shortened segment", () => {
    const renderer = createTestCardRenderer();
    const input = {
      snapshot: snapshotWith(30_000, 40, "sess-short"),
      events: [] as WorldEventStreamEntry[],
    };
    const request = testCardRequest({
      sessionId: "sess-short",
      styleConfig: {
        styleId: "testcard",
        configSchemaVersion: "0.1.0",
        config: { durationMs: 500, segmentMs: 2_000 },
      },
    });
    const segments = renderer.render(request, input).outputSegments;
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ startMs: 30_000, endMs: 30_500 });
  });
});

describe("createTestCardRenderer — watermark and provenance (R5/R6)", () => {
  test("applies all input events: last event sequence lands in both provenance and watermark", () => {
    const renderer = createTestCardRenderer();
    const snapshot = snapshotWith(10_000, 7, "sess-events");
    const events: WorldEventStreamEntry[] = [
      {
        sequence: 8,
        snapshotVersionAfter: 2,
        event: buildEventEnvelope({
          eventId: "evt-a",
          sessionId: "sess-events",
          eventTimeMs: 10_500,
        }),
      },
      {
        sequence: 9,
        snapshotVersionAfter: 3,
        event: buildEventEnvelope({
          eventId: "evt-b",
          sessionId: "sess-events",
          eventTimeMs: 11_000,
        }),
      },
      {
        sequence: 10,
        snapshotVersionAfter: 4,
        event: buildEventEnvelope({
          eventId: "evt-c",
          sessionId: "sess-events",
          eventTimeMs: 11_500,
        }),
      },
    ];
    const request = testCardRequest({ sessionId: "sess-events" });
    const result = renderer.render(request, { snapshot, events });
    expect(result.provenance).toEqual({ snapshotVersion: 1, lastEventSequence: 10 });
    expect(result.watermarkAfter).toEqual({ watermarkMs: 20_000, sequence: 10 });
    expect(result.watermarkAfter.watermarkMs).toBeGreaterThanOrEqual(
      snapshot.watermark.watermarkMs,
    );
  });

  test("empty events: provenance baseline is 0 and watermark echoes the snapshot sequence", () => {
    const renderer = createTestCardRenderer();
    const snapshot = snapshotWith(5_000, 99, "sess-empty");
    const request = testCardRequest({ sessionId: "sess-empty" });
    const result = renderer.render(request, { snapshot, events: [] });
    expect(result.provenance.lastEventSequence).toBe(0);
    expect(result.provenance.snapshotVersion).toBe(1);
    expect(result.watermarkAfter.sequence).toBe(99);
    expect(result.watermarkAfter.watermarkMs).toBeGreaterThanOrEqual(5_000);
  });
});

describe("createTestCardRenderer — degradation mode (R7)", () => {
  const input = {
    snapshot: snapshotWith(0, 0, "sess-degraded"),
    events: [] as WorldEventStreamEntry[],
  };

  test("simulateDegradation marks the result degraded with a reason", () => {
    const renderer = createTestCardRenderer();
    const request = testCardRequest({
      sessionId: "sess-degraded",
      styleConfig: {
        styleId: "testcard",
        configSchemaVersion: "0.1.0",
        config: { simulateDegradation: true },
      },
    });
    const result = renderer.render(request, input);
    expect(result.rendererHealth).toEqual({
      lagMs: 0,
      degraded: true,
      degradationReason: "simulated-degradation",
    });
    expect(result.quality).toEqual({ temporalConsistencyScore: 1 });
  });

  test("the default configuration is healthy without a degradationReason", () => {
    const renderer = createTestCardRenderer();
    const request = testCardRequest({ sessionId: "sess-degraded" });
    const result = renderer.render(request, input);
    expect(result.rendererHealth).toEqual({ lagMs: 0, degraded: false });
    expect(result.rendererHealth.degradationReason).toBeUndefined();
  });
});

describe("createTestCardRenderer — validateRequest gates (R2/R3 + config)", () => {
  const happyRequest = () => testCardRequest({ sessionId: "sess-validate" });

  test("accepts the base request", () => {
    expect(createTestCardRenderer().validateRequest(happyRequest())).toEqual({ ok: true });
  });

  test("rejects requests that target another renderer identity (R3)", () => {
    expect(
      createTestCardRenderer().validateRequest(testCardRequest({ rendererId: "sporta.other" })),
    ).toMatchObject({ ok: false, failureClass: "media-invalid" });
    expect(
      createTestCardRenderer().validateRequest(testCardRequest({ rendererVersion: "9.9.9" })),
    ).toMatchObject({ ok: false, failureClass: "media-invalid" });
  });

  test("rejects unsupported output profiles (R3)", () => {
    const offProfile = { ...TESTCARD_OUTPUT_PROFILE, resolution: { w: 999, h: 999 } };
    expect(
      createTestCardRenderer().validateRequest(testCardRequest({ outputProfile: offProfile })),
    ).toMatchObject({ ok: false, failureClass: "media-invalid" });
    const wrongLatency = { ...TESTCARD_OUTPUT_PROFILE, latencyClass: "live" as const };
    expect(
      createTestCardRenderer().validateRequest(testCardRequest({ outputProfile: wrongLatency })),
    ).toMatchObject({ ok: false, failureClass: "media-invalid" });
  });

  test("rejects snapshot versions below the minimum (R3)", () => {
    // Built by post-mutation: the zod-validating builder refuses snapshotVersion -1.
    const stale = { ...happyRequest(), snapshotVersion: -1 };
    expect(createTestCardRenderer().validateRequest(stale)).toMatchObject({
      ok: false,
      failureClass: "media-invalid",
    });
  });

  test("rejects invalid style configuration values (media-invalid)", () => {
    const cases: unknown[] = [
      { durationMs: 0 },
      { durationMs: 0.5 },
      { durationMs: "10" },
      { durationMs: Number.NaN },
      { durationMs: Number.POSITIVE_INFINITY },
      { segmentMs: 0 },
      { segmentMs: -2000 },
      { simulateDegradation: "yes" },
    ];
    for (const config of cases) {
      const rejection = createTestCardRenderer().validateRequest(
        testCardRequest({
          styleConfig: { styleId: "testcard", configSchemaVersion: "0.1.0", config },
        }),
      );
      expect(rejection).toMatchObject({ ok: false, failureClass: "media-invalid" });
    }
    // A non-object config is rejected too.
    expect(
      createTestCardRenderer().validateRequest(
        testCardRequest({
          styleConfig: { styleId: "testcard", configSchemaVersion: "0.1.0", config: null },
        }),
      ),
    ).toMatchObject({ ok: false, failureClass: "media-invalid" });
  });

  test("ignores unknown style configuration keys", () => {
    const acceptance = createTestCardRenderer().validateRequest(
      testCardRequest({
        styleConfig: {
          styleId: "testcard",
          configSchemaVersion: "0.1.0",
          config: { durationMs: 4_000, theme: "dark" },
        },
      }),
    );
    expect(acceptance).toEqual({ ok: true });
  });

  test("R2 is n/a for the test card: denied source-frame rights do not block a renderer that does not require them", () => {
    const denied = testCardRequest({
      sessionId: "sess-rights",
      rightsCapabilities: {
        canReferenceSourceFrames: false,
        canDeliverLive: false,
        canStoreDerivatives: false,
        canShare: false,
      },
    });
    expect(createTestCardRenderer().validateRequest(denied)).toEqual({ ok: true });
  });
});

describe("createTestCardRenderer — render refusals (defense in depth)", () => {
  const input = {
    snapshot: snapshotWith(0, 0, "sess-defense"),
    events: [] as WorldEventStreamEntry[],
  };

  test("render throws RendererContractError for an unsupported profile", () => {
    const renderer = createTestCardRenderer();
    const bad = testCardRequest({ outputProfile: { ...TESTCARD_OUTPUT_PROFILE, codec: "vp9" } });
    expect(() => renderer.render(bad, input)).toThrow(RendererContractError);
    try {
      renderer.render(bad, input);
    } catch (error) {
      const contractError = error as RendererContractError;
      expect(contractError.failureClass).toBe("media-invalid");
      expect(contractError.name).toBe("RendererContractError");
      expect(contractError.details).toMatchObject({ rendererId: "sporta.testcard" });
    }
  });

  test("render throws RendererContractError for invalid style configuration", () => {
    const renderer = createTestCardRenderer();
    const bad = testCardRequest({
      styleConfig: { styleId: "testcard", configSchemaVersion: "0.1.0", config: { segmentMs: 0 } },
    });
    expect(() => renderer.render(bad, input)).toThrow(RendererContractError);
  });
});

describe("createTestCardRenderer — disposal (R4)", () => {
  test("render refuses with failureClass internal after dispose; dispose is idempotent", () => {
    const renderer = createTestCardRenderer();
    const request = testCardRequest({ sessionId: "sess-dispose" });
    const input = {
      snapshot: snapshotWith(0, 0, "sess-dispose"),
      events: [] as WorldEventStreamEntry[],
    };
    expect(renderer.render(request, input).sessionId).toBe("sess-dispose");
    renderer.dispose();
    renderer.dispose(); // idempotent
    expect(() => renderer.render(request, input)).toThrow(RendererContractError);
    try {
      renderer.render(request, input);
    } catch (error) {
      expect((error as RendererContractError).failureClass).toBe("internal");
    }
  });
});

describe("createTestCardRenderer — observability seam", () => {
  test("render emits exactly one structured log line per call and bumps request/failure counters", () => {
    const lines: string[] = [];
    const logger = createLogger({
      sink: (line) => {
        lines.push(line);
      },
      now: () => TEST_EPOCH_MS,
    });
    const metrics = new MetricsRegistry();
    const renderer = createTestCardRenderer();
    renderer.init({ observability: { logger, metrics } });

    const request = testCardRequest({ sessionId: "sess-observability" });
    const input = {
      snapshot: snapshotWith(0, 0, "sess-observability"),
      events: [] as WorldEventStreamEntry[],
    };
    renderer.render(request, input);

    // ONE line for ONE call, valid JSON, with sessionId, stage and level.
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record["sessionId"]).toBe("sess-observability");
    expect(record["stage"]).toBe("render");
    expect(record["level"]).toBe("info");
    expect(record["ts"]).toBe(TEST_EPOCH_MS);

    const afterSuccess = metrics.snapshot();
    expect(afterSuccess.counters.find((c) => c.name === "render_requests_total")?.value).toBe(1);
    expect(
      afterSuccess.counters.find((c) => c.name === "render_failures_total")?.value,
    ).toBeUndefined();

    // A refused call logs its line and bumps the failure counter.
    const bad = testCardRequest({
      sessionId: "sess-observability",
      outputProfile: { ...TESTCARD_OUTPUT_PROFILE, codec: "vp9" },
    });
    expect(() => renderer.render(bad, input)).toThrow(RendererContractError);
    expect(lines).toHaveLength(2);
    const secondRecord = JSON.parse(lines[1]!) as Record<string, unknown>;
    expect(secondRecord["sessionId"]).toBe("sess-observability");
    expect(secondRecord["stage"]).toBe("render");
    const afterFailure = metrics.snapshot();
    expect(afterFailure.counters.find((c) => c.name === "render_requests_total")?.value).toBe(2);
    expect(afterFailure.counters.find((c) => c.name === "render_failures_total")?.value).toBe(1);
  });

  test("an absent seam is a silent no-op and does not affect results", () => {
    const bare = createTestCardRenderer();
    bare.init();
    const withSeam = createTestCardRenderer();
    withSeam.init({ observability: {} });
    const request = testCardRequest({ sessionId: "sess-noseam" });
    const input = {
      snapshot: snapshotWith(0, 0, "sess-noseam"),
      events: [] as WorldEventStreamEntry[],
    };
    expect(bare.render(request, input)).toEqual(withSeam.render(request, input));
  });
});
