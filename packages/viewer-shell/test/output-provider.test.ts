/**
 * HTTP render-output provider tests (W702): the injectable output seam.
 *
 * Fixtures are REAL renderer-anime clip outputs (`renderAnimeClip` produces
 * the exact W502 `{ frames, manifest }` shape the provider must carry
 * through). Every documented error mapping (network, non-JSON, malformed
 * body, the `unsupported-output` classes for the W504 gap) is test-pinned
 * through a scripted fetch seam — deterministic, no external network.
 */
import { describe, expect, test } from "bun:test";
import {
  ANIME_OUTPUT_PROFILE,
  ANIME_RENDERER_ID,
  ANIME_RENDERER_VERSION,
  renderAnimeClip,
} from "@sporta/renderer-anime";
import type { AnimeClipStep } from "@sporta/renderer-anime";
import { buildRenderRequest, buildWorldSnapshot } from "@sporta/testing";
import { createHttpRenderOutputProvider } from "../src/output-provider.ts";
import type { FetchLike } from "../src/http-client.ts";
import { isViewerControlError } from "../src/errors.ts";
import type { ViewerFailureClass } from "../src/errors.ts";
import type { BatchRenderOutput } from "../src/ports.ts";

const ALLOW_ALL = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
};

/** A REAL W502 render output: 2 clip steps at t = 0, 1000 → duration 2000. */
function realW502Output(): BatchRenderOutput {
  const sessionId = "sess-provider";
  const req = buildRenderRequest({
    sessionId,
    rendererId: ANIME_RENDERER_ID,
    rendererVersion: ANIME_RENDERER_VERSION,
    snapshotVersion: 1,
    eventsSinceSequence: 0,
    outputProfile: ANIME_OUTPUT_PROFILE,
    styleConfig: { styleId: "style-provider-test", configSchemaVersion: "1.0", config: {} },
    rightsCapabilities: ALLOW_ALL,
    sourceFrameRefs: [],
  });
  const steps: AnimeClipStep[] = [0, 1_000].map((atMs, index) => ({
    atMs,
    snapshot: buildWorldSnapshot(
      {
        sessionId,
        watermark: { watermarkMs: atMs, sequence: 10 + index },
        entities: [],
      },
      200 + index,
    ),
    events: [],
  }));
  const output = renderAnimeClip(req, steps);
  return { frames: output.frames, manifest: output.manifest };
}

/** A scripted fetch answering from a queue (or throwing). */
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

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("render-output provider — the real W502 document carries through verbatim", () => {
  test("a 200 { frames, manifest } resolves deep-equal to the real render output", async () => {
    const output = realW502Output();
    const provider = createHttpRenderOutputProvider({
      baseUrl: "http://viewer",
      fetch: scriptedFetch([{ response: jsonResponse(200, output) }]),
    });
    const loaded = await provider.loadOutput("sess-provider", "r-1");
    expect(loaded).toEqual(output);
    // It IS the W502 shape: SVG frames + the clip manifest.
    expect(loaded.frames).toHaveLength(2);
    expect(loaded.frames[0]?.svg.startsWith("<svg")).toBe(true);
    expect(loaded.manifest.renderer.rendererId).toBe(ANIME_RENDERER_ID);
    expect(loaded.manifest.frames).toHaveLength(2);
  });

  test("the request URL and method are exactly the output route", async () => {
    const output = realW502Output();
    const seen: string[] = [];
    const fake: FetchLike = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seen.push(`${init?.method ?? "GET"} ${url}`);
      return Promise.resolve(jsonResponse(200, output));
    };
    const provider = createHttpRenderOutputProvider({ baseUrl: "http://viewer", fetch: fake });
    await provider.loadOutput("sess-1", "r-2");
    expect(seen).toEqual(["GET http://viewer/output/sess-1/r-2"]);
  });
});

describe("render-output provider — the honest unsupported-output gap (W504 pending)", () => {
  test("a 404 with the unsupported-output class maps verbatim", async () => {
    const provider = createHttpRenderOutputProvider({
      baseUrl: "http://viewer",
      fetch: scriptedFetch([
        {
          response: jsonResponse(404, {
            error: {
              failureClass: "unsupported-output",
              message: "no captured render output for render 'r-404' under session 'sess-1'",
              details: { renderId: "r-404" },
            },
          }),
        },
      ]),
    });
    const err = await provider.loadOutput("sess-1", "r-404").catch((e: unknown) => e);
    expect(isViewerControlError(err)).toBe(true);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("unsupported-output");
      expect(err.message).toContain("no captured render output");
      expect(err.details.httpStatus).toBe(404);
      expect(err.details.renderId).toBe("r-404");
    }
  });

  test("the 501 external-control mode maps to the same class (the gap, honestly)", async () => {
    const provider = createHttpRenderOutputProvider({
      baseUrl: "http://viewer",
      fetch: scriptedFetch([
        {
          response: jsonResponse(501, {
            error: {
              failureClass: "unsupported-output",
              message:
                "this viewer server targets an external control server and has no render-output capture store",
            },
          }),
        },
      ]),
    });
    const err = await provider.loadOutput("sess-1", "r-1").catch((e: unknown) => e);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("unsupported-output");
      expect(err.details.httpStatus).toBe(501);
    }
  });

  test("a RECOGNIZED control-plane class on the wire passes through VERBATIM (the W705 wiring contract, never reclassified)", async () => {
    // The real playback routes (W504/W705) answer the CONTROL classes. A
    // rights denial from the output seam must surface as `rights-denied`
    // (label "Rights denied", NOT retryable) — the audit fix: the inherited
    // provider reclassified every non-`unsupported-output` class as
    // `internal` ("Server error", RETRYABLE), which would have shown a
    // retry button for a permanent denial and mislabeled the banner.
    const provider = createHttpRenderOutputProvider({
      baseUrl: "http://viewer",
      fetch: scriptedFetch([
        {
          response: jsonResponse(403, {
            error: {
              failureClass: "rights-denied",
              message: "playback access denied: canStoreDerivatives is false",
              details: { sessionId: "sess-1" },
            },
          }),
        },
      ]),
    });
    const err = await provider.loadOutput("sess-1", "r-1").catch((e: unknown) => e);
    expect(isViewerControlError(err)).toBe(true);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("rights-denied");
      expect(err.message).toContain("canStoreDerivatives");
      expect(err.details).toEqual({ sessionId: "sess-1", httpStatus: 403 });
      expect(err.details.wireFailureClass).toBeUndefined();
    }

    // Same contract for the other recognized classes (each verbatim).
    const classes: Array<[ViewerFailureClass, number]> = [
      ["media-invalid", 400],
      ["validation", 400],
      ["resource-limit", 413],
      ["internal", 500],
      ["unknown-session", 404],
      ["unknown-render", 404],
      ["unknown-route", 404],
      ["method-not-allowed", 405],
    ];
    for (const [failureClass, status] of classes) {
      const probe = createHttpRenderOutputProvider({
        baseUrl: "http://viewer",
        fetch: scriptedFetch([
          {
            response: jsonResponse(status, {
              error: { failureClass, message: `wire ${failureClass}` },
            }),
          },
        ]),
      });
      const probeErr = await probe.loadOutput("sess-1", "r-1").catch((e: unknown) => e);
      expect(isViewerControlError(probeErr)).toBe(true);
      if (isViewerControlError(probeErr)) {
        expect(probeErr.failureClass).toBe(failureClass);
        expect(probeErr.details.httpStatus).toBe(status);
      }
    }
  });

  test("an UNRECOGNIZED wire failure class → internal carrying the raw class (never silently mapped)", async () => {
    const provider = createHttpRenderOutputProvider({
      baseUrl: "http://viewer",
      fetch: scriptedFetch([
        {
          response: jsonResponse(418, {
            error: { failureClass: "teapot", message: "short and stout" },
          }),
        },
      ]),
    });
    const err = await provider.loadOutput("sess-1", "r-1").catch((e: unknown) => e);
    expect(isViewerControlError(err)).toBe(true);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("internal");
      expect(err.message).toBe("short and stout");
      expect(err.details.wireFailureClass).toBe("teapot");
      expect(err.details.httpStatus).toBe(418);
    }
  });

  test("a non-error 404 body (text or JSON) → the default unsupported-output class", async () => {
    const textProvider = createHttpRenderOutputProvider({
      baseUrl: "http://viewer",
      fetch: scriptedFetch([{ response: new Response("not found", { status: 404 }) }]),
    });
    const textErr = await textProvider.loadOutput("sess-1", "r-1").catch((e: unknown) => e);
    if (isViewerControlError(textErr)) {
      expect(textErr.failureClass).toBe("unsupported-output");
      expect(textErr.message).toContain("not available through this viewer server");
    }

    const jsonProvider = createHttpRenderOutputProvider({
      baseUrl: "http://viewer",
      fetch: scriptedFetch([{ response: jsonResponse(404, { hello: "world" }) }]),
    });
    const jsonErr = await jsonProvider.loadOutput("sess-1", "r-1").catch((e: unknown) => e);
    if (isViewerControlError(jsonErr)) {
      expect(jsonErr.failureClass).toBe("unsupported-output");
    }
  });
});

describe("render-output provider — transport failure mappings (never partial data)", () => {
  test("a connection failure → the network class", async () => {
    const provider = createHttpRenderOutputProvider({
      baseUrl: "http://viewer",
      fetch: scriptedFetch([{ throw: new Error("ECONNREFUSED") }]),
    });
    const err = await provider.loadOutput("sess-1", "r-1").catch((e: unknown) => e);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("network");
      expect(err.message).toContain("could not be reached");
    }
  });

  test("a non-JSON response → internal", async () => {
    const provider = createHttpRenderOutputProvider({
      baseUrl: "http://viewer",
      fetch: scriptedFetch([
        {
          response: new Response("<html/>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
        },
      ]),
    });
    const err = await provider.loadOutput("sess-1", "r-1").catch((e: unknown) => e);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("internal");
      expect(err.message).toContain("was not JSON");
    }
  });

  test("a 200 whose body is not the { frames, manifest } document → internal (never invented data)", async () => {
    const provider = createHttpRenderOutputProvider({
      baseUrl: "http://viewer",
      fetch: scriptedFetch([{ response: jsonResponse(200, { hello: "world" }) }]),
    });
    const err = await provider.loadOutput("sess-1", "r-1").catch((e: unknown) => e);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("internal");
      expect(err.message).toContain("frames, manifest");
    }

    const provider2 = createHttpRenderOutputProvider({
      baseUrl: "http://viewer",
      fetch: scriptedFetch([{ response: jsonResponse(200, { frames: [], manifest: 42 }) }]),
    });
    const err2 = await provider2.loadOutput("sess-1", "r-1").catch((e: unknown) => e);
    if (isViewerControlError(err2)) {
      expect(err2.failureClass).toBe("internal");
    }
  });

  test("determinism: the same script yields deep-equal outcomes", async () => {
    async function run(): Promise<string> {
      const output = realW502Output();
      const provider = createHttpRenderOutputProvider({
        baseUrl: "http://viewer",
        fetch: scriptedFetch([
          { response: jsonResponse(200, output) },
          {
            response: jsonResponse(404, {
              error: { failureClass: "unsupported-output", message: "gone" },
            }),
          },
        ]),
      });
      const ok = await provider.loadOutput("a", "1").then(
        (value) => JSON.stringify(value),
        (err: unknown) => `err:${String(err)}`,
      );
      const fail = await provider.loadOutput("a", "2").then(
        (value) => JSON.stringify(value),
        (err: unknown) => (isViewerControlError(err) ? `err:${err.failureClass}` : "other"),
      );
      return `${ok}|${fail}`;
    }
    expect(await run()).toEqual(await run());
  });
});
