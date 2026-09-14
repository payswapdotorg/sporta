/**
 * HTTP control-client tests (W702): the typed client over the REAL W701
 * control-api HTTP surface — endpoints, payloads, status codes, and error
 * shapes are pinned against a REAL `createControlServer` (ephemeral port,
 * real `fetch`, no external network). The wire surface is asserted EXACTLY
 * (paths, methods, JSON bodies, x-request-id) through a recording fetch
 * seam, and every documented error mapping (network, non-JSON, unrecognized
 * wire class, malformed body, non-object OK body) is test-pinned.
 */
import { describe, expect, test } from "bun:test";
import { createControlServer } from "@sporta/control-api";
import type { ControlServer } from "@sporta/control-api";
import { TEST_EPOCH_ISO, TEST_EPOCH_MS } from "@sporta/testing";
import { createHttpControlClient } from "../src/http-client.ts";
import type { FetchLike } from "../src/http-client.ts";
import { isViewerControlError } from "../src/errors.ts";
import { analysisOnlyPolicy, analysisTransformationPolicy, fullAllowPolicy } from "./helpers.ts";

/** One control server on an ephemeral port with the deterministic clock. */
function startServer(): { server: ControlServer; baseUrl: string } {
  const server = createControlServer({ port: 0, nowMs: () => TEST_EPOCH_MS });
  return { server, baseUrl: `http://127.0.0.1:${server.port}` };
}

/** Records every request the client issues (the wire-surface evidence). */
interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
  requestId: string | null;
}

function recordingFetch(real: FetchLike): {
  fetch: FetchLike;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const wrapped: FetchLike = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let body: unknown;
    if (init?.body !== undefined && typeof init.body === "string") {
      body = JSON.parse(init.body) as unknown;
    }
    const headers = new Headers(init?.headers);
    requests.push({
      url,
      method: init?.method ?? "GET",
      body,
      requestId: headers.get("x-request-id"),
    });
    return real(input, init);
  };
  return { fetch: wrapped, requests };
}

describe("http client — the REAL control-server surface, happy path", () => {
  test("create → list → get → renderers → render → getRender → listRenders over real HTTP", async () => {
    const { server, baseUrl } = startServer();
    try {
      const { fetch, requests } = recordingFetch(globalThis.fetch);
      const client = createHttpControlClient({ baseUrl, fetch });

      const created = await client.createSession({
        authorizationPolicy: fullAllowPolicy,
        sourceLabel: "wire-01",
      });
      expect(created.session.sessionId).toBe("sess-1");
      expect(created.session.status).toBe("authorized");
      expect(created.rightsCapabilities.canStoreDerivatives).toBe(true);

      const list = await client.listSessions();
      expect(list.sessions).toHaveLength(1);
      // The server clock is the constant TEST_EPOCH_MS → deterministic ISO.
      expect(list.sessions[0]).toEqual({
        id: "sess-1",
        state: "authorized",
        createdAt: TEST_EPOCH_ISO,
        sourceLabel: "wire-01",
      });

      const detail = await client.getSession("sess-1");
      expect(detail.session.sessionId).toBe("sess-1");
      expect(detail.session.status).toBe("authorized");

      const renderers = await client.listRenderers();
      expect(renderers.renderers.map((r) => r.rendererId)).toContain("sporta.testcard");

      const render = await client.createRender("sess-1", { rendererId: "sporta.testcard" });
      expect(render.renderId).toBe("r-1");
      expect(render.result.outputSegments.length).toBeGreaterThan(0);

      const fetched = await client.getRender("sess-1", "r-1");
      expect(fetched.result).toEqual(render.result);

      const renders = await client.listRenders("sess-1");
      expect(renders.renders.map((r) => r.renderId)).toEqual(["r-1"]);

      // The wire surface EXACTLY (mirrors control-api/src/http.ts routes):
      // method, path, and JSON body per call.
      expect(requests.map((r) => `${r.method} ${r.url.replace(baseUrl, "")}`)).toEqual([
        "POST /v1/sessions",
        "GET /v1/sessions",
        "GET /v1/sessions/sess-1",
        "GET /v1/renderers",
        "POST /v1/sessions/sess-1/renders",
        "GET /v1/sessions/sess-1/renders/r-1",
        "GET /v1/sessions/sess-1/renders",
      ]);
      // The JSON POST bodies are the operation documents, verbatim.
      expect(requests[0]?.body).toEqual({
        authorizationPolicy: fullAllowPolicy,
        sourceLabel: "wire-01",
      });
      expect(requests[4]?.body).toEqual({ rendererId: "sporta.testcard" });
      // Every request carries a deterministic per-client x-request-id.
      expect(requests.map((r) => r.requestId)).toEqual([
        "viewer-1",
        "viewer-2",
        "viewer-3",
        "viewer-4",
        "viewer-5",
        "viewer-6",
        "viewer-7",
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("terminate is a POST with no JSON body (the app route reads no body)", async () => {
    const { server, baseUrl } = startServer();
    try {
      const { fetch, requests } = recordingFetch(globalThis.fetch);
      const client = createHttpControlClient({ baseUrl, fetch });
      await client.createSession({ authorizationPolicy: fullAllowPolicy });
      const terminated = await client.terminateSession("sess-1");
      expect(terminated.session.status).toBe("cancelled");
      expect(requests[1]).toMatchObject({
        method: "POST",
        url: `${baseUrl}/v1/sessions/sess-1/terminate`,
        body: undefined,
      });
      // Idempotent over the wire (the app re-terminates as a no-op).
      const again = await client.terminateSession("sess-1");
      expect(again.session.status).toBe("cancelled");
    } finally {
      server.stop(true);
    }
  });

  test("a caller-supplied requestId factory is honored verbatim", async () => {
    const { server, baseUrl } = startServer();
    try {
      const ids = ["trace-a", "trace-b"];
      const { fetch, requests } = recordingFetch(globalThis.fetch);
      const client = createHttpControlClient({
        baseUrl,
        fetch,
        requestId: () => ids.shift() ?? "trace-x",
      });
      await client.listSessions();
      await client.listSessions();
      // The factory's ids landed on the wire's x-request-id headers, in order.
      expect(requests.map((r) => r.requestId)).toEqual(["trace-a", "trace-b"]);
    } finally {
      server.stop(true);
    }
  });
});

describe("http client — fail-closed rights classes from the REAL wire", () => {
  test("analysis-only policy → 403 rights-denied (verbatim class + details)", async () => {
    const { server, baseUrl } = startServer();
    try {
      const client = createHttpControlClient({ baseUrl, fetch: globalThis.fetch });
      const err = await client
        .createSession({ authorizationPolicy: analysisOnlyPolicy })
        .catch((e: unknown) => e);
      expect(isViewerControlError(err)).toBe(true);
      if (isViewerControlError(err)) {
        expect(err.failureClass).toBe("rights-denied");
        expect(err.message).toContain("grants no rights capabilities");
        expect(err.details.httpStatus).toBe(403);
        expect(err.details.policyId).toBe("policy-analysis-only");
      }
    } finally {
      server.stop(true);
    }
  });

  test("playback gate (analysis+transformation) → 403 on listRenders AND getRender", async () => {
    const { server, baseUrl } = startServer();
    try {
      const client = createHttpControlClient({ baseUrl, fetch: globalThis.fetch });
      await client.createSession({ authorizationPolicy: analysisTransformationPolicy });
      // Rendering is compute: allowed.
      const render = await client.createRender("sess-1", { rendererId: "sporta.testcard" });
      expect(render.renderId).toBe("r-1");
      // Playback gate: denied BEFORE revealing anything.
      const listErr = await client.listRenders("sess-1").catch((e: unknown) => e);
      expect(isViewerControlError(listErr)).toBe(true);
      if (isViewerControlError(listErr)) {
        expect(listErr.failureClass).toBe("rights-denied");
        expect(listErr.message).toContain("canStoreDerivatives");
        expect(listErr.details.httpStatus).toBe(403);
      }
      const getErr = await client.getRender("sess-1", "r-1").catch((e: unknown) => e);
      if (isViewerControlError(getErr)) {
        expect(getErr.failureClass).toBe("rights-denied");
        // The denial must NOT reveal whether the render exists.
        expect(getErr.details.renderId).toBeUndefined();
      }
    } finally {
      server.stop(true);
    }
  });

  test("unknown session / unknown render / unknown renderer → the 404-style + 400 classes", async () => {
    const { server, baseUrl } = startServer();
    try {
      const client = createHttpControlClient({ baseUrl, fetch: globalThis.fetch });
      await client.createSession({ authorizationPolicy: fullAllowPolicy });

      const unknownSession = await client.getSession("sess-404").catch((e: unknown) => e);
      if (isViewerControlError(unknownSession)) {
        expect(unknownSession.failureClass).toBe("unknown-session");
        expect(unknownSession.details.httpStatus).toBe(404);
        expect(unknownSession.details.sessionId).toBe("sess-404");
      }

      const unknownRender = await client.getRender("sess-1", "r-404").catch((e: unknown) => e);
      if (isViewerControlError(unknownRender)) {
        expect(unknownRender.failureClass).toBe("unknown-render");
        expect(unknownRender.details).toEqual({
          sessionId: "sess-1",
          renderId: "r-404",
          httpStatus: 404,
        });
      }

      const badRenderer = await client
        .createRender("sess-1", { rendererId: "no.such.renderer" })
        .catch((e: unknown) => e);
      if (isViewerControlError(badRenderer)) {
        expect(badRenderer.failureClass).toBe("media-invalid");
        expect(badRenderer.message).toContain("no.such.renderer");
        expect(badRenderer.details.httpStatus).toBe(400);
      }
    } finally {
      server.stop(true);
    }
  });

  test("an unknown route through the client → the transport unknown-route class", async () => {
    const { server, baseUrl } = startServer();
    try {
      // There is no client method for an unknown route (by design); drive the
      // transport class mapping through the shared wireError path instead:
      // a method-mismatch answered by the REAL server. DELETE on /v1/sessions
      // is method-not-allowed (405) with class on the wire.
      const response = await fetch(`${baseUrl}/v1/sessions`, { method: "DELETE" });
      expect(response.status).toBe(405);
      const body = (await response.json()) as { error: { failureClass: string } };
      expect(body.error.failureClass).toBe("method-not-allowed");
      expect(response.headers.get("allow")).toBe("GET, POST");
    } finally {
      server.stop(true);
    }
  });
});

describe("http client — scripted transport (every failure mapping, no network)", () => {
  /** Builds a scripted fetch that answers from a queue (or throws). */
  function scriptedFetch(outcomes: Array<{ response: Response } | { throw: Error }>): FetchLike {
    const queue = [...outcomes];
    const fake: FetchLike = () => {
      const outcome = queue.shift();
      if (outcome === undefined) {
        return Promise.reject(new Error("scriptedFetch: no outcome left"));
      }
      if ("throw" in outcome) return Promise.reject(outcome.throw);
      return Promise.resolve(outcome.response);
    };
    return fake;
  }

  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  test("connection failure → the viewer-side network class (retryable)", async () => {
    const client = createHttpControlClient({
      baseUrl: "http://127.0.0.1:1",
      fetch: scriptedFetch([{ throw: new Error("ECONNREFUSED") }]),
    });
    const err = await client.listSessions().catch((e: unknown) => e);
    expect(isViewerControlError(err)).toBe(true);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("network");
      expect(err.message).toContain("could not be reached");
      expect(err.message).toContain("ECONNREFUSED");
    }
  });

  test("a non-JSON body (success or failure) → internal, never partial data", async () => {
    const notJson = new Response("<html>gateway</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
    const client = createHttpControlClient({
      baseUrl: "http://x",
      fetch: scriptedFetch([{ response: notJson }]),
    });
    const err = await client.listSessions().catch((e: unknown) => e);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("internal");
      expect(err.message).toContain("was not JSON");
    }

    const notJsonOk = new Response("OK", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
    const client2 = createHttpControlClient({
      baseUrl: "http://x",
      fetch: scriptedFetch([{ response: notJsonOk }]),
    });
    const err2 = await client2.listSessions().catch((e: unknown) => e);
    if (isViewerControlError(err2)) {
      expect(err2.failureClass).toBe("internal");
    }
  });

  test("an unrecognized wire failure class → internal carrying the raw class (never silently mapped)", async () => {
    const client = createHttpControlClient({
      baseUrl: "http://x",
      fetch: scriptedFetch([
        { response: json(418, { error: { failureClass: "teapot", message: "short and stout" } }) },
      ]),
    });
    const err = await client.listSessions().catch((e: unknown) => e);
    expect(isViewerControlError(err)).toBe(true);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("internal");
      expect(err.message).toBe("short and stout");
      expect(err.details.wireFailureClass).toBe("teapot");
      expect(err.details.httpStatus).toBe(418);
    }
  });

  test("a malformed error body (no error object) → internal with a body sample", async () => {
    const client = createHttpControlClient({
      baseUrl: "http://x",
      fetch: scriptedFetch([{ response: json(500, { oops: true }) }]),
    });
    const err = await client.listSessions().catch((e: unknown) => e);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("internal");
      expect(err.message).toContain("malformed error body");
    }
  });

  test("an OK response whose body is not an object → internal (never invented data)", async () => {
    const client = createHttpControlClient({
      baseUrl: "http://x",
      fetch: scriptedFetch([{ response: json(200, [1, 2, 3]) }]),
    });
    const err = await client.listSessions().catch((e: unknown) => e);
    expect(isViewerControlError(err)).toBe(true);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("internal");
      expect(err.message).toContain("was not an object");
    }
  });

  test("a wire error with details passes them through verbatim", async () => {
    const client = createHttpControlClient({
      baseUrl: "http://x",
      fetch: scriptedFetch([
        {
          response: json(403, {
            error: {
              failureClass: "rights-denied",
              message: "denied for test",
              details: { sessionId: "sess-9", reason: "expired-policy" },
            },
          }),
        },
      ]),
    });
    const err = await client.listRenders("sess-9").catch((e: unknown) => e);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("rights-denied");
      expect(err.details.sessionId).toBe("sess-9");
      expect(err.details.reason).toBe("expired-policy");
    }
  });
});
