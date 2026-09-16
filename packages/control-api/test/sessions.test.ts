/**
 * W701 in-process E2E — sessions over real HTTP.
 *
 * A real `Bun.serve` on port 0 driven with real `fetch` (the "real user"
 * path): create / list / get / terminate, the fail-closed creation gate, and
 * lifecycle semantics on double termination.
 */
import { afterAll, describe, expect, test } from "bun:test";
import type { MediaSession, RightsCapabilities } from "@sporta/contracts";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import { createControlServer } from "../src/index";
import type { SessionSummary } from "../src/index";
import {
  analysisOnlyPolicy,
  analysisTransformationPolicy,
  callJson,
  capabilitiesWithoutAnalysisPolicy,
  counterValue,
  createHarness,
  createSession,
  expiredPolicy,
  fullAllowPolicy,
  postJson,
} from "./helpers";
import type { ErrorBody, Harness } from "./helpers";

const harness: Harness = createHarness();
afterAll(() => {
  harness.server.stop(true);
});

interface SessionResponse {
  session: MediaSession;
  rightsCapabilities: RightsCapabilities;
}

describe("POST /v1/sessions — create", () => {
  test("full-allow policy → ACTIVE (authorized) session with echoed capabilities", async () => {
    const response = await callJson<SessionResponse>(
      harness.baseUrl,
      "/v1/sessions",
      postJson({ authorizationPolicy: fullAllowPolicy, sourceLabel: "broadcast-clip-42" }),
    );
    expect(response.status).toBe(200);
    expect(response.body.session.status).toBe("authorized");
    expect(response.body.session.sessionId).toMatch(/^sess-\d+$/);
    expect(response.body.session.authorizationPolicyId).toBe("policy-full-allow");
    expect(response.body.session.sources).toHaveLength(1);
    expect(response.body.session.sources[0]?.declaredRightsPolicyId).toBe("policy-full-allow");
    expect(response.body.session.createdAtIso).toMatch(/^2025-01-06T12:00:00\./);
    expect(response.body.rightsCapabilities).toEqual({
      canReferenceSourceFrames: true,
      canDeliverLive: true,
      canStoreDerivatives: true,
      canShare: true,
    });
  });

  test("all-denied (analysis-only) policy → 403 rights-denied, no session created", async () => {
    const before = await callJson<{ sessions: SessionSummary[] }>(harness.baseUrl, "/v1/sessions");
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      "/v1/sessions",
      postJson({ authorizationPolicy: analysisOnlyPolicy }),
    );
    expect(response.status).toBe(403);
    expect(response.body.error.failureClass).toBe("rights-denied");
    expect(response.body.error.message).toContain("policy-analysis-only");
    const after = await callJson<{ sessions: SessionSummary[] }>(harness.baseUrl, "/v1/sessions");
    expect(after.body.sessions).toHaveLength(before.body.sessions.length);
  });

  test("expired policy → 403 rights-denied (fail-closed)", async () => {
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      "/v1/sessions",
      postJson({ authorizationPolicy: expiredPolicy }),
    );
    expect(response.status).toBe(403);
    expect(response.body.error.failureClass).toBe("rights-denied");
    expect(response.body.error.message).toContain("expired");
  });

  test("invalid authorizationPolicy → 400 validation", async () => {
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      "/v1/sessions",
      postJson({ authorizationPolicy: { policyId: "", allowedOperations: [], assertedBy: "" } }),
    );
    expect(response.status).toBe(400);
    expect(response.body.error.failureClass).toBe("validation");
    expect(Array.isArray(response.body.error.details?.issues)).toBe(true);
  });

  test("policy with capabilities but no analysis → 403 and a recorded failed session", async () => {
    // The app-level gate passes (canStoreDerivatives is true), but the
    // lifecycle gate (created -> authorized requires `analysis`) denies;
    // the denial is recorded as a terminal rights-denied failure.
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      "/v1/sessions",
      postJson({ authorizationPolicy: capabilitiesWithoutAnalysisPolicy }),
    );
    expect(response.status).toBe(403);
    expect(response.body.error.failureClass).toBe("rights-denied");

    const list = await callJson<{ sessions: SessionSummary[] }>(harness.baseUrl, "/v1/sessions");
    const failed = list.body.sessions.find(
      (session) => session.state === "failed" && session.id.match(/^sess-\d+$/),
    );
    expect(failed).toBeDefined();
    const getResponse = await callJson<SessionResponse>(
      harness.baseUrl,
      `/v1/sessions/${failed?.id ?? ""}`,
    );
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.session.status).toBe("failed");
    expect(getResponse.body.session.processingState.terminalFailureClass).toBe("rights-denied");
  });

  test("rights-denied creation increments the failure counter", () => {
    // Three rights-denied 403s so far: analysis-only, expired, and the
    // capabilities-without-analysis lifecycle denial.
    expect(
      counterValue(harness.metrics, "control_failures_total", { failure_class: "rights-denied" }),
    ).toBe(3);
  });
});

describe("GET /v1/sessions — list", () => {
  test("summaries carry id, state, createdAt, sourceLabel", async () => {
    const list = await callJson<{ sessions: SessionSummary[] }>(harness.baseUrl, "/v1/sessions");
    const withLabel = list.body.sessions.find((s) => s.sourceLabel === "broadcast-clip-42");
    expect(withLabel).toBeDefined();
    expect(withLabel?.state).toBe("authorized");
    expect(withLabel?.createdAt).toMatch(/^2025-01-06T12:00:00\./);
    expect(typeof withLabel?.id).toBe("string");
  });
});

describe("GET /v1/sessions/:id — inspect", () => {
  test("returns the session and derived capabilities", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const response = await callJson<SessionResponse>(harness.baseUrl, `/v1/sessions/${sessionId}`);
    expect(response.status).toBe(200);
    expect(response.body.session.sessionId).toBe(sessionId);
    expect(response.body.session.status).toBe("authorized");
    expect(response.body.rightsCapabilities.canStoreDerivatives).toBe(true);
  });

  test("unknown session id → 404 unknown-session", async () => {
    const response = await callJson<ErrorBody>(harness.baseUrl, "/v1/sessions/sess-does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body.error.failureClass).toBe("unknown-session");
  });

  test("capabilities are re-derived fail-closed after policy expiry", async () => {
    // Mutable fixed clock: create while valid, then read after expiry.
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
        policyId: "policy-expires-later",
        // Expires one hour after the test epoch.
        expiresAtIso: "2025-01-06T13:00:00.000Z",
      });
      const before = await callJson<SessionResponse>(base, `/v1/sessions/${sessionId}`);
      expect(before.body.rightsCapabilities.canStoreDerivatives).toBe(true);

      clock = TEST_EPOCH + 2 * 3_600_000; // two hours later
      const after = await callJson<SessionResponse>(base, `/v1/sessions/${sessionId}`);
      expect(after.status).toBe(200);
      expect(after.body.rightsCapabilities).toEqual({
        canReferenceSourceFrames: false,
        canDeliverLive: false,
        canStoreDerivatives: false,
        canShare: false,
      });
    } finally {
      void server.stop(true);
    }
  });
});

describe("POST /v1/sessions/:id/terminate — lifecycle", () => {
  test("terminates to the terminal cancelled state", async () => {
    const sessionId = await createSession(harness.baseUrl, analysisTransformationPolicy);
    const response = await callJson<{ session: MediaSession }>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/terminate`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    expect(response.body.session.status).toBe("cancelled");
    expect(response.body.session.cancelledAtIso).toBeDefined();

    const getResponse = await callJson<SessionResponse>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}`,
    );
    expect(getResponse.body.session.status).toBe("cancelled");
  });

  test("double-terminate follows lifecycle idempotency (cancelledAtIso unchanged)", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const first = await callJson<{ session: MediaSession }>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/terminate`,
      { method: "POST" },
    );
    const second = await callJson<{ session: MediaSession }>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/terminate`,
      { method: "POST" },
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.session.status).toBe("cancelled");
    expect(second.body.session.cancelledAtIso).toBe(first.body.session.cancelledAtIso);
  });

  test("unknown session → 404 unknown-session", async () => {
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      "/v1/sessions/sess-does-not-exist/terminate",
      { method: "POST" },
    );
    expect(response.status).toBe(404);
    expect(response.body.error.failureClass).toBe("unknown-session");
  });
});

describe("POST /v1/sessions — W921 caller-supplied sessionId/createdAtIso (additive seam)", () => {
  test("caller-supplied sessionId is honored EXACTLY (never renumbered)", async () => {
    const response = await callJson<SessionResponse>(
      harness.baseUrl,
      "/v1/sessions",
      postJson({
        authorizationPolicy: fullAllowPolicy,
        sourceLabel: "durable-reconstruction-probe",
        sessionId: "sess-u-9f13c2ab77e04d51",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.body.session.sessionId).toBe("sess-u-9f13c2ab77e04d51");
    expect(response.body.session.status).toBe("authorized");
    // The id is addressable immediately (get by the caller's id).
    const fetched = await callJson<SessionResponse>(
      harness.baseUrl,
      "/v1/sessions/sess-u-9f13c2ab77e04d51",
    );
    expect(fetched.status).toBe(200);
    expect(fetched.body.session.sessionId).toBe("sess-u-9f13c2ab77e04d51");
  });

  test("caller-supplied createdAtIso is preserved VERBATIM (not the app clock)", async () => {
    const recorded = "2026-09-16T12:34:56.789Z";
    const response = await callJson<SessionResponse>(
      harness.baseUrl,
      "/v1/sessions",
      postJson({
        authorizationPolicy: fullAllowPolicy,
        sessionId: "sess-u-created-at-probe",
        createdAtIso: recorded,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.body.session.createdAtIso).toBe(recorded);
  });

  test("absent sessionId keeps the historical sess-<seq> allocation (byte-identical)", async () => {
    const before = await callJson<{ sessions: SessionSummary[] }>(harness.baseUrl, "/v1/sessions");
    const response = await callJson<SessionResponse>(
      harness.baseUrl,
      "/v1/sessions",
      postJson({ authorizationPolicy: fullAllowPolicy }),
    );
    expect(response.status).toBe(200);
    expect(response.body.session.sessionId).toMatch(/^sess-\d+$/);
    // Exactly ONE new session appeared (the seq allocation did not double-create).
    const after = await callJson<{ sessions: SessionSummary[] }>(harness.baseUrl, "/v1/sessions");
    expect(after.body.sessions).toHaveLength(before.body.sessions.length + 1);
  });

  test.each([
    ["empty", ""],
    ["uppercase", "sess-U-1"],
    ["underscore", "sess_u_1"],
    ["slash", "sess/u/1"],
    ["space", "sess u 1"],
    ["too long", `sess-u-${"a".repeat(129)}`],
  ])("invalid sessionId (%s) → 400 validation, nothing created", async (_label, bad) => {
    const before = await callJson<{ sessions: SessionSummary[] }>(harness.baseUrl, "/v1/sessions");
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      "/v1/sessions",
      postJson({ authorizationPolicy: fullAllowPolicy, sessionId: bad }),
    );
    expect(response.status).toBe(400);
    expect(response.body.error.failureClass).toBe("validation");
    expect(response.body.error.message).toContain("sessionId");
    const after = await callJson<{ sessions: SessionSummary[] }>(harness.baseUrl, "/v1/sessions");
    expect(after.body.sessions).toHaveLength(before.body.sessions.length);
  });

  test("duplicate sessionId → typed 400 duplicate-session-id (never renumbered)", async () => {
    const first = await callJson<SessionResponse>(
      harness.baseUrl,
      "/v1/sessions",
      postJson({ authorizationPolicy: fullAllowPolicy, sessionId: "sess-u-taken" }),
    );
    expect(first.status).toBe(200);
    const before = await callJson<{ sessions: SessionSummary[] }>(harness.baseUrl, "/v1/sessions");
    const second = await callJson<ErrorBody>(
      harness.baseUrl,
      "/v1/sessions",
      postJson({ authorizationPolicy: fullAllowPolicy, sessionId: "sess-u-taken" }),
    );
    expect(second.status).toBe(400);
    expect(second.body.error.failureClass).toBe("validation");
    expect(second.body.error.message).toContain("already in use");
    // The original session is untouched and no renumbered twin was created.
    const after = await callJson<{ sessions: SessionSummary[] }>(harness.baseUrl, "/v1/sessions");
    expect(after.body.sessions).toHaveLength(before.body.sessions.length);
    expect(after.body.sessions.some((entry) => entry.id === "sess-u-taken")).toBe(true);
  });

  test("invalid createdAtIso → 400 validation", async () => {
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      "/v1/sessions",
      postJson({
        authorizationPolicy: fullAllowPolicy,
        sessionId: "sess-u-bad-created-at",
        createdAtIso: "not-a-timestamp",
      }),
    );
    expect(response.status).toBe(400);
    expect(response.body.error.failureClass).toBe("validation");
    expect(response.body.error.message).toContain("createdAtIso");
  });
});
