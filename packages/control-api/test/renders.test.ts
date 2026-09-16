/**
 * W701 in-process E2E — renderers, renders, and the playback access gate.
 *
 * A real `Bun.serve` on port 0 driven with real `fetch`: renderer listing,
 * render creation against the reference test-card plugin (snapshot at the
 * current watermark, empty event tail), typed mapping of plugin rejections,
 * and BOTH sides of the playback gate (canStoreDerivatives): rendering stays
 * allowed without storage rights, retrieval is denied.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { RenderResult } from "@sporta/contracts";
import type { RendererCapability, RenderResult as RenderResultDoc } from "@sporta/contracts";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import { createControlServer } from "../src/index";
import type { RenderSummary } from "../src/index";
import {
  analysisTransformationPolicy,
  callJson,
  createHarness,
  createSession,
  fullAllowPolicy,
  postJson,
} from "./helpers";
import type { ErrorBody, Harness } from "./helpers";

const harness: Harness = createHarness();
afterAll(() => {
  harness.server.stop(true);
});

interface RenderResponse {
  renderId: string;
  result: RenderResultDoc;
}

describe("GET /v1/renderers — registry capabilities", () => {
  test("lists the sporta.testcard capability", async () => {
    const response = await callJson<{ renderers: RendererCapability[] }>(
      harness.baseUrl,
      "/v1/renderers",
    );
    expect(response.status).toBe(200);
    const testcard = response.body.renderers.find((r) => r.rendererId === "sporta.testcard");
    expect(testcard).toBeDefined();
    expect(testcard?.rendererVersion).toBe("0.1.0");
    expect(testcard?.rendererClass).toBe("tactical");
    expect(testcard?.supportedOutputProfiles).toHaveLength(1);
    expect(testcard?.requiresSourceFrames).toBe(false);
  });
});

describe("POST /v1/sessions/:id/renders — create render", () => {
  test("happy path: 5 segments (10s/2s), provenance = snapshot version, watermarkAfter.sequence = snapshot sequence", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const response = await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: "sporta.testcard" }),
    );
    expect(response.status).toBe(200);
    expect(response.body.renderId).toMatch(/^r-\d+$/);
    // The result is a valid RenderResult document.
    expect(RenderResult.safeParse(response.body.result).success).toBe(true);
    // Test-card math: ceil(10_000 / 2_000) = 5 segments from the snapshot
    // watermark (a fresh world model: watermark 0/0, snapshot version 1).
    expect(response.body.result.outputSegments).toHaveLength(5);
    expect(response.body.result.outputSegments.map((segment) => segment.segmentId)).toEqual([
      "tc-0",
      "tc-1",
      "tc-2",
      "tc-3",
      "tc-4",
    ]);
    expect(response.body.result.outputSegments[0]?.artifactRef).toBe(`testcard://${sessionId}/1/0`);
    expect(response.body.result.provenance).toEqual({ snapshotVersion: 1, lastEventSequence: 0 });
    expect(response.body.result.watermarkAfter).toEqual({ watermarkMs: 10_000, sequence: 0 });
    expect(response.body.result.rendererHealth.degraded).toBe(false);
    expect(response.body.result.sessionId).toBe(sessionId);
    expect(response.body.result.rendererId).toBe("sporta.testcard");
  });

  test("unknown renderer id → 400 media-invalid", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: "sporta.nonexistent" }),
    );
    expect(response.status).toBe(400);
    expect(response.body.error.failureClass).toBe("media-invalid");
    expect(response.body.error.message).toContain("sporta.nonexistent");
  });

  test("unknown renderer version → 400 media-invalid", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: "sporta.testcard", rendererVersion: "99.0.0" }),
    );
    expect(response.status).toBe(400);
    expect(response.body.error.failureClass).toBe("media-invalid");
    expect(response.body.error.message).toContain("99.0.0");
  });

  test("styleConfig overrides segment math (6s/2s → 3 segments)", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const response = await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({
        rendererId: "sporta.testcard",
        styleConfig: { styleId: "testcard", config: { durationMs: 6_000, segmentMs: 2_000 } },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.body.result.outputSegments).toHaveLength(3);
    expect(response.body.result.watermarkAfter.watermarkMs).toBe(6_000);
  });

  test("unsupported outputProfile → 400 media-invalid (plugin R3 rejection mapped)", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({
        rendererId: "sporta.testcard",
        outputProfile: {
          resolution: { w: 640, h: 360 },
          frameRate: 24,
          codec: "h264",
          container: "mp4",
          latencyClass: "offline",
        },
      }),
    );
    expect(response.status).toBe(400);
    expect(response.body.error.failureClass).toBe("media-invalid");
    expect(response.body.error.message).toContain("outputProfile");
  });

  test("invalid body → 400 validation (rendererId missing)", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererVersion: "0.1.0" }),
    );
    expect(response.status).toBe(400);
    expect(response.body.error.failureClass).toBe("validation");
  });

  test("unknown session → 404 unknown-session", async () => {
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      "/v1/sessions/sess-does-not-exist/renders",
      postJson({ rendererId: "sporta.testcard" }),
    );
    expect(response.status).toBe(404);
    expect(response.body.error.failureClass).toBe("unknown-session");
  });

  test("RENDER side of the gate: rights lacking canStoreDerivatives still allow rendering", async () => {
    const sessionId = await createSession(harness.baseUrl, analysisTransformationPolicy);
    const response = await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: "sporta.testcard" }),
    );
    expect(response.status).toBe(200);
    expect(response.body.result.outputSegments).toHaveLength(5);
  });

  test("fail-closed at render time: policy expired after creation → 403 rights-denied", async () => {
    const lines: string[] = [];
    const logger = createLogger({
      sink: (line: string) => {
        lines.push(line);
      },
    });
    const metrics = new MetricsRegistry();
    const TEST_EPOCH = 1_736_164_800_000;
    let clock = TEST_EPOCH;
    const server = createControlServer({
      port: 0,
      observability: { logger, metrics },
      nowMs: () => clock,
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const sessionId = await createSession(base, {
        ...fullAllowPolicy,
        policyId: "policy-render-expiry",
        expiresAtIso: "2025-01-06T13:00:00.000Z", // +1h
      });
      clock = TEST_EPOCH + 2 * 3_600_000; // two hours later
      const response = await callJson<ErrorBody>(
        base,
        `/v1/sessions/${sessionId}/renders`,
        postJson({ rendererId: "sporta.testcard" }),
      );
      expect(response.status).toBe(403);
      expect(response.body.error.failureClass).toBe("rights-denied");
    } finally {
      void server.stop(true);
    }
  });
});

describe("GET /v1/sessions/:id/renders/:renderId — playback access gate", () => {
  test("PLAYBACK side of the gate (allowed): canStoreDerivatives → 200 with the stored result", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const created = await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: "sporta.testcard" }),
    );
    const response = await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/${created.body.renderId}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.renderId).toBe(created.body.renderId);
    expect(response.body.result).toEqual(created.body.result);
  });

  test("PLAYBACK side of the gate (denied): no canStoreDerivatives → 403 rights-denied", async () => {
    const sessionId = await createSession(harness.baseUrl, analysisTransformationPolicy);
    const created = await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: "sporta.testcard" }),
    );
    expect(created.status).toBe(200); // render itself succeeded (gate: compute side)
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/${created.body.renderId}`,
    );
    expect(response.status).toBe(403);
    expect(response.body.error.failureClass).toBe("rights-denied");
    expect(response.body.error.message).toContain("canStoreDerivatives");
  });

  test("unknown renderId → 404 unknown-render", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/r-999999`,
    );
    expect(response.status).toBe(404);
    expect(response.body.error.failureClass).toBe("unknown-render");
  });

  test("render owned by another session → 404 unknown-render", async () => {
    const sessionA = await createSession(harness.baseUrl, fullAllowPolicy);
    const sessionB = await createSession(harness.baseUrl, fullAllowPolicy);
    const created = await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionA}/renders`,
      postJson({ rendererId: "sporta.testcard" }),
    );
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionB}/renders/${created.body.renderId}`,
    );
    expect(response.status).toBe(404);
    expect(response.body.error.failureClass).toBe("unknown-render");
  });

  test("unknown session → 404 unknown-session", async () => {
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      "/v1/sessions/sess-does-not-exist/renders/r-1",
    );
    expect(response.status).toBe(404);
    expect(response.body.error.failureClass).toBe("unknown-session");
  });
});

describe("GET /v1/sessions/:id/renders — list (same playback gate)", () => {
  test("allowed: summaries of the session's renders in creation order", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: "sporta.testcard" }),
    );
    await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({
        rendererId: "sporta.testcard",
        styleConfig: { config: { durationMs: 4_000, segmentMs: 2_000 } },
      }),
    );
    const response = await callJson<{ renders: RenderSummary[] }>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
    );
    expect(response.status).toBe(200);
    expect(response.body.renders).toHaveLength(2);
    expect(response.body.renders[0]?.rendererId).toBe("sporta.testcard");
    expect(response.body.renders[0]?.segmentCount).toBe(5);
    expect(response.body.renders[1]?.segmentCount).toBe(2);
    expect(response.body.renders[0]?.provenance).toEqual({
      snapshotVersion: 1,
      lastEventSequence: 0,
    });
  });

  test("denied: no canStoreDerivatives → 403 rights-denied", async () => {
    const sessionId = await createSession(harness.baseUrl, analysisTransformationPolicy);
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
    );
    expect(response.status).toBe(403);
    expect(response.body.error.failureClass).toBe("rights-denied");
  });
});

describe("POST /v1/sessions/:id/renders — W921 flight-8 caller-supplied renderId (additive seam)", () => {
  test("caller-supplied renderId is honored EXACTLY (never renumbered)", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const response = await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: "sporta.testcard", renderId: "r-u-6f0b2c1d4e5a9733" }),
    );
    expect(response.status).toBe(200);
    expect(response.body.renderId).toBe("r-u-6f0b2c1d4e5a9733");
    // The id is addressable immediately (get + list by the caller's id).
    const fetched = await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/r-u-6f0b2c1d4e5a9733`,
    );
    expect(fetched.status).toBe(200);
    expect(fetched.body.renderId).toBe("r-u-6f0b2c1d4e5a9733");
    const listed = await callJson<{ renders: RenderSummary[] }>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
    );
    expect(listed.body.renders.map((render) => render.renderId)).toEqual(["r-u-6f0b2c1d4e5a9733"]);
  });

  test("absent renderId keeps the historical r-<seq> allocation (byte-identical)", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const first = await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: "sporta.testcard" }),
    );
    const second = await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: "sporta.testcard" }),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.renderId).toMatch(/^r-\d+$/);
    expect(second.body.renderId).toMatch(/^r-\d+$/);
    expect(first.body.renderId).not.toBe(second.body.renderId);
  });

  test.each([
    ["empty", ""],
    ["uppercase", "r-U-1"],
    ["underscore", "r_u_1"],
    ["slash", "r/u/1"],
    ["space", "r u 1"],
    ["too long", `r-u-${"a".repeat(129)}`],
  ])("invalid renderId (%s) → 400 validation, nothing stored", async (_label, bad) => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: "sporta.testcard", renderId: bad }),
    );
    expect(response.status).toBe(400);
    expect(response.body.error.failureClass).toBe("validation");
    expect(response.body.error.message).toContain("renderId");
    const listed = await callJson<{ renders: RenderSummary[] }>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
    );
    expect(listed.body.renders).toHaveLength(0);
  });

  test("duplicate renderId → typed 400 duplicate-render-id (never renumbered)", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const first = await callJson<RenderResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: "sporta.testcard", renderId: "r-u-taken" }),
    );
    expect(first.status).toBe(200);
    const second = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: "sporta.testcard", renderId: "r-u-taken" }),
    );
    expect(second.status).toBe(400);
    expect(second.body.error.failureClass).toBe("validation");
    expect(second.body.error.message).toContain("already in use");
    const listed = await callJson<{ renders: RenderSummary[] }>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders`,
    );
    expect(listed.body.renders.map((render) => render.renderId)).toEqual(["r-u-taken"]);
  });
});
