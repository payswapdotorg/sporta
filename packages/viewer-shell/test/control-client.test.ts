/**
 * In-process control-client tests (W702): the adapter against the REAL
 * transport-free `createControlApp` (W701) — real operations, real typed
 * errors, fail-closed rights paths, and the one-line-per-call log
 * correlation — no network, no HTTP.
 */
import { describe, expect, test } from "bun:test";
import { createControlApp } from "@sporta/control-api";
import type { ControlApp } from "@sporta/control-api";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import { TEST_EPOCH_ISO, TEST_EPOCH_MS } from "@sporta/testing";
import { createInProcessControlClient } from "../src/control-client.ts";
import { isViewerControlError } from "../src/errors.ts";
import { analysisOnlyPolicy, analysisTransformationPolicy, fullAllowPolicy } from "./helpers.ts";

interface Harness {
  app: ControlApp;
  lines: string[];
}

function createHarness(): Harness {
  const lines: string[] = [];
  const logger = createLogger({
    sink: (line) => {
      lines.push(line);
    },
    now: () => TEST_EPOCH_MS,
  });
  const app = createControlApp({
    observability: { logger, metrics: new MetricsRegistry() },
    nowMs: () => TEST_EPOCH_MS,
  });
  return { app, lines };
}

async function createSession(app: ControlApp, policy: unknown, label?: string) {
  return app.createSession({
    authorizationPolicy: policy as never,
    ...(label !== undefined ? { sourceLabel: label } : {}),
  });
}

describe("in-process client — real control-app operations (happy path)", () => {
  test("create → list → get → render → playback-gated reads, all typed", async () => {
    const { app, lines } = createHarness();
    const client = createInProcessControlClient(app);

    const created = await client.createSession({
      authorizationPolicy: fullAllowPolicy,
      sourceLabel: "clip-01",
    });
    expect(created.session.sessionId).toBe("sess-1");
    expect(created.session.status).toBe("authorized");
    expect(created.rightsCapabilities.canStoreDerivatives).toBe(true);

    const list = await client.listSessions();
    // The harness clock is the constant TEST_EPOCH_MS, so the app stamps the
    // session with the deterministic TEST_EPOCH_ISO (no wall clock anywhere).
    expect(list.sessions).toEqual([
      { id: "sess-1", state: "authorized", createdAt: TEST_EPOCH_ISO, sourceLabel: "clip-01" },
    ]);

    const detail = await client.getSession("sess-1");
    expect(detail.session.sessionId).toBe("sess-1");
    expect(detail.rightsCapabilities.canDeliverLive).toBe(true);

    const renderers = await client.listRenderers();
    expect(renderers.renderers).toHaveLength(1);
    const testcard = renderers.renderers[0]!;
    expect(testcard.rendererId).toBe("sporta.testcard");

    const render = await client.createRender("sess-1", { rendererId: testcard.rendererId });
    expect(render.renderId).toBe("r-1");
    expect(render.result.rendererId).toBe(testcard.rendererId);
    expect(render.result.outputSegments.length).toBeGreaterThan(0);

    const fetched = await client.getRender("sess-1", "r-1");
    expect(fetched.result).toEqual(render.result);

    const renders = await client.listRenders("sess-1");
    expect(renders.renders).toHaveLength(1);
    expect(renders.renders[0]?.renderId).toBe("r-1");

    // Every app call logged exactly one line correlated with the viewer
    // request ids (viewer-1, viewer-2, ... in call order).
    const correlationIds = lines
      .map((line) => JSON.parse(line) as { correlationId?: string; msg?: string })
      .filter((parsed) => parsed.correlationId !== undefined)
      .map((parsed) => parsed.correlationId);
    expect(correlationIds).toEqual([
      "viewer-1",
      "viewer-2",
      "viewer-3",
      "viewer-4",
      "viewer-5",
      "viewer-6",
      "viewer-7",
    ]);
  });
});

describe("in-process client — fail-closed rights paths", () => {
  test("an analysis-only policy is denied at session CREATION (no capability derived)", async () => {
    const { app } = createHarness();
    const client = createInProcessControlClient(app);
    const err = await client
      .createSession({ authorizationPolicy: analysisOnlyPolicy })
      .catch((e: unknown) => e);
    expect(isViewerControlError(err)).toBe(true);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("rights-denied");
      expect(err.message).toContain("grants no rights capabilities");
      expect(err.details.policyId).toBe("policy-analysis-only");
    }
    // Fail-closed: nothing was stored.
    const list = await client.listSessions();
    expect(list.sessions).toEqual([]);
  });

  test("analysis+transformation: rendering allowed, playback gate DENIED (fail-closed honored)", async () => {
    const { app } = createHarness();
    const client = createInProcessControlClient(app);
    await createSession(app, analysisTransformationPolicy);

    // Rendering is compute: allowed without canStoreDerivatives.
    const render = await client.createRender("sess-1", { rendererId: "sporta.testcard" });
    expect(render.renderId).toBe("r-1");

    // Playback access is denied BEFORE revealing anything.
    const listErr = await client.listRenders("sess-1").catch((e: unknown) => e);
    expect(isViewerControlError(listErr)).toBe(true);
    if (isViewerControlError(listErr)) {
      expect(listErr.failureClass).toBe("rights-denied");
      expect(listErr.message).toContain("canStoreDerivatives");
      expect(listErr.details.sessionId).toBe("sess-1");
    }
    const getErr = await client.getRender("sess-1", "r-1").catch((e: unknown) => e);
    expect(isViewerControlError(getErr)).toBe(true);
    if (isViewerControlError(getErr)) {
      expect(getErr.failureClass).toBe("rights-denied");
      // The denial must NOT reveal whether the render exists.
      expect(getErr.details.renderId).toBeUndefined();
    }
  });

  test("a malformed policy document is a validation error (typed, classified)", async () => {
    const { app } = createHarness();
    const client = createInProcessControlClient(app);
    const err = await client
      .createSession({ authorizationPolicy: { nonsense: true } as never })
      .catch((e: unknown) => e);
    expect(isViewerControlError(err)).toBe(true);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("validation");
      expect(err.message).toContain("AuthorizationPolicy");
    }
  });
});

describe("in-process client — 404-style and media-invalid classes", () => {
  test("unknown session → unknown-session class", async () => {
    const { app } = createHarness();
    const client = createInProcessControlClient(app);
    const err = await client.getSession("sess-404").catch((e: unknown) => e);
    expect(isViewerControlError(err)).toBe(true);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("unknown-session");
      expect(err.details.sessionId).toBe("sess-404");
    }
  });

  test("unknown render under a real session → unknown-render class", async () => {
    const { app } = createHarness();
    const client = createInProcessControlClient(app);
    await createSession(app, fullAllowPolicy);
    const err = await client.getRender("sess-1", "r-404").catch((e: unknown) => e);
    expect(isViewerControlError(err)).toBe(true);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("unknown-render");
      expect(err.details).toEqual({ sessionId: "sess-1", renderId: "r-404" });
    }
  });

  test("createRender with an unregistered renderer id → media-invalid", async () => {
    const { app } = createHarness();
    const client = createInProcessControlClient(app);
    await createSession(app, fullAllowPolicy);
    const err = await client
      .createRender("sess-1", { rendererId: "no.such.renderer" })
      .catch((e: unknown) => e);
    expect(isViewerControlError(err)).toBe(true);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("media-invalid");
      expect(err.message).toContain("no.such.renderer");
    }
  });
});

describe("in-process client — the adapter's error contract", () => {
  test("every rejection is a ViewerControlError (never a raw control error)", async () => {
    const { app } = createHarness();
    const client = createInProcessControlClient(app);
    const outcomes: unknown[] = [
      await client.getSession("sess-404").catch((e: unknown) => e),
      await client.listRenders("sess-404").catch((e: unknown) => e),
    ];
    for (const outcome of outcomes) {
      expect(isViewerControlError(outcome)).toBe(true);
    }
  });
});
