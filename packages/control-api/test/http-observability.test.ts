/**
 * W701 in-process E2E — HTTP semantics, request-id correlation, the
 * observability contract, determinism, and the transport-free defaults.
 *
 * HTTP semantics: 404 unknown route, 405 method mismatch, 400 invalid JSON
 * bodies. Observability: an array sink proves EVERY request logs exactly one
 * valid-JSON line with stage "control-api" plus the request id, and the
 * `control_requests_total` / `control_failures_total` counters increment
 * with the right labels. Determinism: the TEST_EPOCH_MS-based clock keeps
 * timestamps reproducible.
 */
import { afterAll, describe, expect, test } from "bun:test";
import type { MediaSession } from "@sporta/contracts";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { createControlApp } from "../src/index";
import {
  callJson,
  counterValue,
  createHarness,
  createSession,
  fullAllowPolicy,
  parsedLines,
  postJson,
} from "./helpers";
import type { ErrorBody, Harness } from "./helpers";

// One harness per describe group so counts stay exact.
const httpHarness: Harness = createHarness();
const obsHarness: Harness = createHarness();
afterAll(() => {
  httpHarness.server.stop(true);
  obsHarness.server.stop(true);
});

describe("HTTP semantics", () => {
  test("unknown route → 404 with failureClass unknown-route", async () => {
    const response = await callJson<ErrorBody>(httpHarness.baseUrl, "/v1/nonsense");
    expect(response.status).toBe(404);
    expect(response.body.error.failureClass).toBe("unknown-route");
    expect(response.body.error.message).toContain("/v1/nonsense");
  });

  test("method mismatch → 405 with failureClass method-not-allowed and Allow header", async () => {
    const response = await callJson<ErrorBody>(httpHarness.baseUrl, "/v1/sessions", {
      method: "DELETE",
    });
    expect(response.status).toBe(405);
    expect(response.body.error.failureClass).toBe("method-not-allowed");
    expect(response.headers.get("allow")).toBe("GET, POST");
  });

  test("GET on a POST-only route → 405", async () => {
    const response = await callJson<ErrorBody>(
      httpHarness.baseUrl,
      "/v1/sessions/sess-1/terminate",
    );
    expect(response.status).toBe(405);
    expect(response.body.error.failureClass).toBe("method-not-allowed");
  });

  test("invalid JSON body → 400 validation", async () => {
    const response = await callJson<ErrorBody>(httpHarness.baseUrl, "/v1/sessions", {
      method: "POST",
      body: "{not valid json",
    });
    expect(response.status).toBe(400);
    expect(response.body.error.failureClass).toBe("validation");
    expect(response.body.error.message).toContain("not valid JSON");
  });

  test("non-object JSON body → 400 validation", async () => {
    const response = await callJson<ErrorBody>(httpHarness.baseUrl, "/v1/sessions", {
      method: "POST",
      body: "[1,2,3]",
    });
    expect(response.status).toBe(400);
    expect(response.body.error.failureClass).toBe("validation");
  });

  test("missing body on POST → 400 validation", async () => {
    const response = await callJson<ErrorBody>(httpHarness.baseUrl, "/v1/sessions", {
      method: "POST",
    });
    expect(response.status).toBe(400);
    expect(response.body.error.failureClass).toBe("validation");
    expect(response.body.error.message).toContain("body is required");
  });
});

describe("request ids (x-request-id)", () => {
  test("caller-supplied id is echoed on the response and logged as correlationId", async () => {
    const response = await fetch(`${httpHarness.baseUrl}/v1/renderers`, {
      headers: { "x-request-id": "my-req-42" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("my-req-42");
    const lines = parsedLines(httpHarness);
    const last = lines[lines.length - 1];
    expect(last?.stage).toBe("control-api");
    expect(last?.correlationId).toBe("my-req-42");
  });

  test("absent id → deterministic generated id (req-<n>) returned and logged", async () => {
    // Fresh harness so the counter starts at 1.
    const fresh = createHarness();
    try {
      const response = await callJson<{ renderers: unknown[] }>(fresh.baseUrl, "/v1/renderers");
      expect(response.status).toBe(200);
      expect(response.requestId).toMatch(/^req-\d+$/);
      const parsed = parsedLines(fresh);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.correlationId).toBe(response.requestId ?? undefined);
      expect(parsed[0]?.stage).toBe("control-api");
    } finally {
      void fresh.server.stop(true);
    }
  });
});

describe("observability contract", () => {
  test("every request logs exactly one valid-JSON control-api line carrying a request id", async () => {
    const fresh = createHarness();
    try {
      await Promise.all([
        fetch(`${fresh.baseUrl}/v1/sessions`, postJson({ authorizationPolicy: fullAllowPolicy })),
        fetch(`${fresh.baseUrl}/v1/sessions`),
        fetch(`${fresh.baseUrl}/v1/renderers`),
        fetch(`${fresh.baseUrl}/v1/nope`),
        fetch(`${fresh.baseUrl}/v1/sessions`, { method: "DELETE" }),
        fetch(`${fresh.baseUrl}/v1/sessions`, { method: "POST", body: "{oops" }),
      ]);
      const records = parsedLines(fresh);
      // Every line is valid JSON (parse succeeded) and has a level/msg.
      for (const record of records) {
        expect(typeof record.msg).toBe("string");
        expect(typeof record.ts).toBe("number");
      }
      const controlLines = records.filter((record) => record.stage === "control-api");
      expect(controlLines).toHaveLength(6);
      const ids = controlLines.map((record) => record.correlationId);
      for (const id of ids) {
        expect(typeof id).toBe("string");
        expect(id?.length).toBeGreaterThan(0);
      }
      // Six requests → six distinct request ids.
      expect(new Set(ids).size).toBe(6);
    } finally {
      void fresh.server.stop(true);
    }
  });

  test("successful calls log level info with outcome ok and the bound sessionId", async () => {
    const fresh = createHarness();
    try {
      const sessionId = await createSession(fresh.baseUrl, fullAllowPolicy);
      const records = parsedLines(fresh).filter((record) => record.stage === "control-api");
      const createLine = records.find((record) => record.msg === "control.create_session");
      expect(createLine).toBeDefined();
      expect(createLine?.level).toBe("info");
      expect(createLine?.sessionId).toBe(sessionId);
      expect(createLine?.fields?.outcome).toBe("ok");
    } finally {
      void fresh.server.stop(true);
    }
  });

  test("counters increment with route and failure_class labels", async () => {
    const fresh = createHarness();
    try {
      await fetch(`${fresh.baseUrl}/v1/sessions`);
      await fetch(`${fresh.baseUrl}/v1/sessions`);
      await fetch(`${fresh.baseUrl}/v1/sessions`, {
        method: "POST",
        body: "{oops",
      });
      await fetch(`${fresh.baseUrl}/v1/nonsense`);
      expect(
        counterValue(fresh.metrics, "control_requests_total", { route: "list_sessions" }),
      ).toBe(2);
      expect(
        counterValue(fresh.metrics, "control_requests_total", { route: "create_session" }),
      ).toBe(1);
      expect(counterValue(fresh.metrics, "control_requests_total", { route: "unknown" })).toBe(1);
      expect(
        counterValue(fresh.metrics, "control_failures_total", { failure_class: "validation" }),
      ).toBe(1);
      expect(
        counterValue(fresh.metrics, "control_failures_total", { failure_class: "unknown-route" }),
      ).toBe(1);
      expect(
        counterValue(fresh.metrics, "control_failures_total", {
          failure_class: "method-not-allowed",
        }),
      ).toBe(0);
    } finally {
      void fresh.server.stop(true);
    }
  });

  test("rights-denied failures increment control_failures_total{failure_class=rights-denied}", async () => {
    const fresh = createHarness();
    try {
      const response = await callJson<ErrorBody>(
        fresh.baseUrl,
        "/v1/sessions",
        postJson({
          authorizationPolicy: {
            ...fullAllowPolicy,
            policyId: "p",
            allowedOperations: ["analysis"],
          },
        }),
      );
      expect(response.status).toBe(403);
      expect(
        counterValue(fresh.metrics, "control_failures_total", { failure_class: "rights-denied" }),
      ).toBe(1);
      expect(
        counterValue(fresh.metrics, "control_requests_total", { route: "create_session" }),
      ).toBe(1);
    } finally {
      void fresh.server.stop(true);
    }
  });

  test("render requests additionally emit the renderer-stage line (cross-stage traceability)", async () => {
    const sessionId = await createSession(obsHarness.baseUrl, fullAllowPolicy);
    await fetch(
      `${obsHarness.baseUrl}/v1/sessions/${sessionId}/renders`,
      postJson({ rendererId: "sporta.testcard" }),
    );
    const records = parsedLines(obsHarness);
    const renderLine = records.find((record) => record.stage === "render");
    expect(renderLine).toBeDefined();
    expect(renderLine?.msg).toBe("testcard.render");
    expect(renderLine?.sessionId).toBe(sessionId);
    // The control-api line for the same request also exists, bound to the
    // session: one control-api line plus one renderer line.
    const controlRenderLine = records.find((record) => record.msg === "control.create_render");
    expect(controlRenderLine?.sessionId).toBe(sessionId);
    expect(controlRenderLine?.fields?.outcome).toBe("ok");
  });
});

describe("determinism", () => {
  test("injected TEST_EPOCH_MS + counter clock keeps timestamps deterministic", async () => {
    const fresh = createHarness();
    try {
      const response = await callJson<{ session: MediaSession }>(
        fresh.baseUrl,
        "/v1/sessions",
        postJson({ authorizationPolicy: fullAllowPolicy }),
      );
      const createdAt = Date.parse(response.body.session.createdAtIso);
      expect(createdAt).toBeGreaterThanOrEqual(TEST_EPOCH_MS);
      expect(createdAt).toBeLessThan(TEST_EPOCH_MS + 1_000);
    } finally {
      void fresh.server.stop(true);
    }
  });
});

describe("createControlApp defaults (transport-free)", () => {
  test("in-memory repo, test-card registry, deterministic TEST_EPOCH-based clock, silent observability", async () => {
    const app = createControlApp();
    const created = await app.createSession({ authorizationPolicy: fullAllowPolicy });
    expect(created.session.sessionId).toBe("sess-1");
    expect(created.session.status).toBe("authorized");
    expect(Date.parse(created.session.createdAtIso)).toBeGreaterThan(TEST_EPOCH_MS - 1);
    expect(Date.parse(created.session.createdAtIso)).toBeLessThan(TEST_EPOCH_MS + 100);

    const renderers = await app.listRenderers();
    expect(renderers.renderers.some((r) => r.rendererId === "sporta.testcard")).toBe(true);

    const render = await app.createRender(created.session.sessionId, {
      rendererId: "sporta.testcard",
    });
    expect(render.renderId).toBe("r-1");
    expect(render.result.outputSegments).toHaveLength(5);

    const playback = await app.getRender(created.session.sessionId, render.renderId);
    expect(playback.result).toEqual(render.result);

    const terminated = await app.terminateSession(created.session.sessionId);
    expect(terminated.session.status).toBe("cancelled");

    // A second app instance has independent state (fresh counters).
    const second = createControlApp();
    const again = await second.createSession({ authorizationPolicy: fullAllowPolicy });
    expect(again.session.sessionId).toBe("sess-1");
  });
});
