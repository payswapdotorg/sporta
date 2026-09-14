/**
 * Serve smoke tests (W702 + W705 + W706): `serveViewer` + `web/index.html`
 * actually serve and parse. This is the seam-level stand-in for real-browser
 * E2E (which remains OPEN future work — W706 as scoped delivered viewer
 * telemetry, not browser automation; W705 delivered the headless real-provider
 * data path in `playback-e2e.test.ts`, W706 the telemetry chain in
 * `telemetry-e2e.test.ts`): the index serves as HTML with the module
 * entry, every browser-reachable module transpiles (a 200 from the
 * on-the-fly transpiler IS the parse proof — `Bun.Transpiler` throws on
 * syntax errors) and contains NO bare `@sporta/*` specifiers (the browser
 * cannot resolve them; this pin caught a real inherited bug — viewer-core
 * imported `TEST_EPOCH_MS` as a value), the control proxy answers the real
 * W701 routes, and the stand-in output route serves the captured W502
 * document (this pin caught a real inherited bug — the route's segment
 * indices were wrong, so it always 404'd).
 */
import { describe, expect, test } from "bun:test";
import { serveViewer } from "../src/serve.ts";
import { fullAllowPolicy } from "./helpers.ts";

/** Every module the browser ES-module graph can reach from bootstrap.ts. */
const BROWSER_MODULES: string[] = [
  "/web/bootstrap.ts",
  "/src/http-client.ts",
  "/src/playback-provider.ts",
  "/src/output-provider.ts",
  "/src/dom-adapter.ts",
  "/src/dom-plan.ts",
  "/src/detail-plan.ts",
  "/src/selection-plan.ts",
  "/src/pane-signature.ts",
  "/src/viewer-core.ts",
  "/src/player.ts",
  "/src/segment-player.ts",
  "/src/errors.ts",
  "/src/default-clock.ts",
  "/src/telemetry-http-sink.ts",
  "/src/telemetry-plan.ts",
  "/src/telemetry.ts",
  "/src/telemetry-events.ts",
  "/src/telemetry-sink.ts",
];

/** Bare `@sporta/*` import specifiers found in a transpiled module body. */
function bareImports(body: string): string[] {
  const matches = body.matchAll(/(?:from|import)\s+["'](@sporta\/[^"']+)["']/g);
  return [...matches].map((match) => match[1] ?? "");
}

describe("serveViewer — the static shell serves and parses", () => {
  test("GET / serves the index HTML with the module entry", async () => {
    const server = serveViewer({ port: 0 });
    try {
      const response = await fetch(`${server.url}/`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      const body = await response.text();
      // "Parses": doctype, a single module script entry, closed document.
      expect(body.startsWith("<!doctype html>")).toBe(true);
      expect(body.trimEnd().endsWith("</html>")).toBe(true);
      expect(body.match(/<script[^>]*src="\/web\/bootstrap\.ts"[^>]*>/g)).toHaveLength(1);
      expect(body).toContain("<title>Sporta viewer shell</title>");
      // GET /index.html is the same document.
      const alias = await fetch(`${server.url}/index.html`);
      expect(alias.status).toBe(200);
      expect(await alias.text()).toBe(body);
    } finally {
      server.stop();
    }
  });

  test("every browser-reachable module transpiles and carries ZERO bare @sporta imports", async () => {
    const server = serveViewer({ port: 0 });
    try {
      for (const modulePath of BROWSER_MODULES) {
        const response = await fetch(`${server.url}${modulePath}`);
        expect(response.status, modulePath).toBe(200);
        expect(response.headers.get("content-type"), modulePath).toBe(
          "text/javascript; charset=utf-8",
        );
        const body = await response.text();
        // The TS was transpiled (type-only imports erased)…
        expect(body, modulePath).not.toContain("import type");
        // …and no bare specifier remains (the browser cannot resolve them).
        const bare = bareImports(body);
        expect(bare, modulePath).toEqual([]);
      }
    } finally {
      server.stop();
    }
  });

  test("unknown routes and missing assets answer typed JSON 404s", async () => {
    const server = serveViewer({ port: 0 });
    try {
      const noRoute = await fetch(`${server.url}/nope`);
      expect(noRoute.status).toBe(404);
      expect(await noRoute.json()).toEqual({
        error: { failureClass: "unknown-route", message: expect.stringContaining("/nope") },
      });

      const noAsset = await fetch(`${server.url}/web/missing.ts`);
      expect(noAsset.status).toBe(404);
      const body = (await noAsset.json()) as { error: { failureClass: string } };
      expect(body.error.failureClass).toBe("unknown-route");

      const unsupportedType = await fetch(`${server.url}/web/bootstrap.ts.css`);
      expect(unsupportedType.status).toBe(404);
    } finally {
      server.stop();
    }
  });
});

describe("serveViewer — the control proxy + the stand-in output route (real data path)", () => {
  test("proxy serves the real W701 routes; the output route serves the captured W502 document", async () => {
    const server = serveViewer({ port: 0 });
    try {
      // The proxy answers the real renderers list (the W701 surface).
      const renderers = await fetch(`${server.url}/control/v1/renderers`);
      expect(renderers.status).toBe(200);
      const renderersBody = (await renderers.json()) as {
        renderers: Array<{ rendererId: string }>;
      };
      expect(renderersBody.renderers.map((r) => r.rendererId)).toEqual(["anime.prototype"]);

      // A full render flow through the proxy (what the browser does).
      const create = await fetch(`${server.url}/control/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorizationPolicy: fullAllowPolicy, sourceLabel: "smoke" }),
      });
      expect(create.status).toBe(200);
      const session = (await create.json()) as { session: { sessionId: string } };
      expect(session.session.sessionId).toBe("sess-1");

      const render = await fetch(
        `${server.url}/control/v1/sessions/${session.session.sessionId}/renders`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rendererId: "anime.prototype" }),
        },
      );
      expect(render.status).toBe(200);
      const envelope = (await render.json()) as {
        renderId: string;
        result: { outputSegments: unknown[] };
      };
      expect(envelope.renderId).toBe("r-1");

      // The output route: 200 with EXACTLY the captured document.
      const output = await fetch(
        `${server.url}/output/${session.session.sessionId}/${envelope.renderId}`,
      );
      expect(output.status).toBe(200);
      const outputBody = (await output.json()) as { frames: unknown[]; manifest: unknown };
      const record = server.captureStore?.resolve("r-1");
      if (record === undefined) throw new Error("capture store is missing r-1");
      expect(outputBody).toEqual(record.output);
      expect(outputBody.frames).toHaveLength(envelope.result.outputSegments.length);
    } finally {
      server.stop();
    }
  });

  test("unknown renders / malformed output paths answer typed errors; POST is 405", async () => {
    const server = serveViewer({ port: 0 });
    try {
      // Prime one render so the route's resolve path is real.
      await fetch(`${server.url}/control/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorizationPolicy: fullAllowPolicy }),
      });
      await fetch(`${server.url}/control/v1/sessions/sess-1/renders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rendererId: "anime.prototype" }),
      });

      const unknownRender = await fetch(`${server.url}/output/sess-1/r-404`);
      expect(unknownRender.status).toBe(404);
      const unknownBody = (await unknownRender.json()) as { error: { failureClass: string } };
      expect(unknownBody.error.failureClass).toBe("unsupported-output");

      // Right render id, wrong session: still unknown (the record is
      // session-scoped).
      const wrongSession = await fetch(`${server.url}/output/sess-2/r-1`);
      expect(wrongSession.status).toBe(404);

      const malformed = await fetch(`${server.url}/output/sess-1`);
      expect(malformed.status).toBe(404);
      const malformedBody = (await malformed.json()) as { error: { failureClass: string } };
      expect(malformedBody.error.failureClass).toBe("unknown-route");

      const post = await fetch(`${server.url}/output/sess-1/r-1`, { method: "POST" });
      expect(post.status).toBe(405);
    } finally {
      server.stop();
    }
  });

  test("external-control mode: the output route answers the honest 501 unsupported-output", async () => {
    // The external control server never needs to exist for THIS assertion.
    const server = serveViewer({ port: 0, controlBaseUrl: "http://127.0.0.1:9" });
    try {
      expect(server.control).toBeNull();
      expect(server.captureStore).toBeNull();
      const response = await fetch(`${server.url}/output/sess-1/r-1`);
      expect(response.status).toBe(501);
      const body = (await response.json()) as {
        error: { failureClass: string; message: string };
      };
      expect(body.error.failureClass).toBe("unsupported-output");
      expect(body.error.message).toContain("external control server");
    } finally {
      server.stop();
    }
  });

  test("the proxy reports an unreachable control server as a typed 502", async () => {
    const server = serveViewer({ port: 0, controlBaseUrl: "http://127.0.0.1:9" });
    try {
      const response = await fetch(`${server.url}/control/v1/renderers`);
      expect(response.status).toBe(502);
      const body = (await response.json()) as { error: { failureClass: string } };
      expect(body.error.failureClass).toBe("internal");
    } finally {
      server.stop();
    }
  });
});
