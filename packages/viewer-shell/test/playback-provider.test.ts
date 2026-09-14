/**
 * Playback provider tests (W705): the REAL render-output provider over the
 * W504 control-plane playback routes — through a scripted fetch seam
 * (deterministic, no external network; the REAL-wire behavior is pinned by
 * `playback-e2e.test.ts`).
 *
 * Pinned: the exact route URLs (list + segment), the parsed envelope
 * (integrity-verified against the REAL encoder's content hash), the honest
 * `outputs-pending` result for an empty list, the multi-segment
 * `unsupported-output` refusal, the VERBATIM wire-class passthrough on both
 * routes (the W705 wiring contract — a rights denial stays `rights-denied`,
 * never a retryable "server error"), the envelope-less / non-JSON / network
 / transport mappings, and determinism.
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
import { encodeAnimeClip, contentHashOf, byteLengthOf } from "@sporta/output-pipeline";
import { createHttpPlaybackProvider } from "../src/playback-provider.ts";
import type { FetchLike } from "../src/http-client.ts";
import { isViewerControlError } from "../src/errors.ts";
import type { ViewerFailureClass } from "../src/errors.ts";

const ALLOW_ALL = {
  canReferenceSourceFrames: true,
  canDeliverLive: true,
  canStoreDerivatives: true,
  canShare: true,
};

/** A REAL W504 encoded segment (the exact bytes + manifest the routes serve). */
function realSegment() {
  const sessionId = "sess-1";
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
      { sessionId, watermark: { watermarkMs: atMs, sequence: 10 + index }, entities: [] },
      200 + index,
    ),
    events: [],
  }));
  const encoded = encodeAnimeClip(renderAnimeClip(req, steps));
  return {
    sessionId,
    renderId: "r-1",
    segmentId: encoded.segmentId,
    summary: {
      segmentId: encoded.segmentId,
      contentType: encoded.contentType,
      byteLength: encoded.byteLength,
      contentHash: encoded.contentHash,
    },
    envelope: {
      sessionId,
      renderId: "r-1",
      segmentId: encoded.segmentId,
      contentType: encoded.contentType,
      byteLength: encoded.byteLength,
      contentHash: encoded.contentHash,
      content: encoded.content,
      manifest: encoded.manifest,
    },
  };
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

function listResponse(segments: unknown[]): Response {
  return jsonResponse(200, { sessionId: "sess-1", renderId: "r-1", segments });
}

describe("playback provider — the real W504 routes (URL + envelope + integrity)", () => {
  test("the request URLs and methods are exactly the playback routes", async () => {
    const segment = realSegment();
    const seen: string[] = [];
    const fake: FetchLike = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      // HeadersInit is a union (Headers | string[][] | Record) — read the
      // request id through the standard Headers view (handles all three).
      const requestId = new Headers(init?.headers).get("x-request-id") ?? "";
      seen.push(`${init?.method ?? "GET"} ${url} ${requestId}`);
      if (url.endsWith("/outputs")) return Promise.resolve(listResponse([segment.summary]));
      return Promise.resolve(jsonResponse(200, segment.envelope));
    };
    const provider = createHttpPlaybackProvider({ baseUrl: "http://control", fetch: fake });
    await provider.loadOutput("sess-1", "r-1");
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatch(
      /^GET http:\/\/control\/v1\/sessions\/sess-1\/renders\/r-1\/outputs viewer-out-1$/,
    );
    expect(seen[1]).toMatch(
      new RegExp(
        `^GET http://control/v1/sessions/sess-1/renders/r-1/outputs/${segment.segmentId} viewer-out-2$`,
      ),
    );
  });

  test("loadOutput resolves the animated-segment document, deep-equal to the encoder output", async () => {
    const segment = realSegment();
    const provider = createHttpPlaybackProvider({
      baseUrl: "http://control",
      fetch: scriptedFetch([
        { response: listResponse([segment.summary]) },
        { response: jsonResponse(200, segment.envelope) },
      ]),
    });
    const result = await provider.loadOutput("sess-1", "r-1");
    expect(result).toEqual({ kind: "animated-segment", segment: segment.envelope });
    // The client-side integrity check re-hashed the REAL encoder content.
    if (result.kind === "animated-segment") {
      expect(result.segment.content).toBe(segment.envelope.content);
      expect(contentHashOf(result.segment.content)).toBe(result.segment.contentHash);
    }
  });

  test("a tampered content (hash mismatch) → media-invalid, never trusted data", async () => {
    const segment = realSegment();
    // Same byte length (one character replaced) so ONLY the hash check fires.
    const tampered = {
      ...segment.envelope,
      content: segment.envelope.content.replace("viewBox", "viewB0x"),
    };
    expect(tampered.content).not.toBe(segment.envelope.content);
    const provider = createHttpPlaybackProvider({
      baseUrl: "http://control",
      fetch: scriptedFetch([
        { response: listResponse([segment.summary]) },
        { response: jsonResponse(200, tampered) },
      ]),
    });
    const err = await provider.loadOutput("sess-1", "r-1").catch((e: unknown) => e);
    expect(isViewerControlError(err)).toBe(true);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("media-invalid");
      expect(err.message).toContain("content hash mismatch");
      expect(err.message).toContain(contentHashOf(tampered.content));
    }
  });

  test("a wrong declared byte length → media-invalid", async () => {
    const segment = realSegment();
    const lying = { ...segment.envelope, byteLength: byteLengthOf(segment.envelope.content) + 1 };
    const provider = createHttpPlaybackProvider({
      baseUrl: "http://control",
      fetch: scriptedFetch([
        { response: listResponse([segment.summary]) },
        { response: jsonResponse(200, lying) },
      ]),
    });
    const err = await provider.loadOutput("sess-1", "r-1").catch((e: unknown) => e);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("media-invalid");
      expect(err.message).toContain("byte length mismatch");
    }
  });

  test("an envelope answering outside the requested scope → media-invalid (client-side guard)", async () => {
    const segment = realSegment();
    const scoped = { ...segment.envelope, renderId: "r-other" };
    const provider = createHttpPlaybackProvider({
      baseUrl: "http://control",
      fetch: scriptedFetch([{ response: jsonResponse(200, scoped) }]),
    });
    const err = await provider
      .fetchSegment("sess-1", "r-1", segment.segmentId)
      .catch((e: unknown) => e);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("media-invalid");
      expect(err.message).toContain("scope");
    }
  });

  test("a non-object / non-JSON / malformed envelope → internal or media-invalid (never partial)", async () => {
    const nonJson = createHttpPlaybackProvider({
      baseUrl: "http://control",
      fetch: scriptedFetch([{ response: new Response("<html/>", { status: 200 }) }]),
    });
    const nonJsonErr = await nonJson.fetchSegment("s", "r", "x").catch((e: unknown) => e);
    if (isViewerControlError(nonJsonErr)) {
      expect(nonJsonErr.failureClass).toBe("internal");
      expect(nonJsonErr.message).toContain("not JSON");
    }

    const nonObject = createHttpPlaybackProvider({
      baseUrl: "http://control",
      fetch: scriptedFetch([{ response: jsonResponse(200, "hello") }]),
    });
    const nonObjectErr = await nonObject.fetchSegment("s", "r", "x").catch((e: unknown) => e);
    if (isViewerControlError(nonObjectErr)) {
      expect(nonObjectErr.failureClass).toBe("internal");
      expect(nonObjectErr.message).toContain("not an object");
    }

    const malformed = createHttpPlaybackProvider({
      baseUrl: "http://control",
      fetch: scriptedFetch([
        { response: jsonResponse(200, { sessionId: "s", renderId: "r", segmentId: "x" }) },
      ]),
    });
    const malformedErr = await malformed.fetchSegment("s", "r", "x").catch((e: unknown) => e);
    if (isViewerControlError(malformedErr)) {
      expect(malformedErr.failureClass).toBe("media-invalid");
      expect(malformedErr.message).toContain(
        "contentType, byteLength, contentHash, content, manifest",
      );
    }
  });

  test("a connection failure → the network class; a bad list body → internal", async () => {
    const network = createHttpPlaybackProvider({
      baseUrl: "http://control",
      fetch: scriptedFetch([{ throw: new Error("ECONNREFUSED") }]),
    });
    const networkErr = await network.listSegments("s", "r").catch((e: unknown) => e);
    if (isViewerControlError(networkErr)) {
      expect(networkErr.failureClass).toBe("network");
      expect(networkErr.message).toContain("could not be reached");
    }

    const badList = createHttpPlaybackProvider({
      baseUrl: "http://control",
      fetch: scriptedFetch([{ response: jsonResponse(200, { hello: "world" }) }]),
    });
    const badListErr = await badList.listSegments("s", "r").catch((e: unknown) => e);
    if (isViewerControlError(badListErr)) {
      expect(badListErr.failureClass).toBe("internal");
      expect(badListErr.message).toContain("segments");
    }
  });
});

describe("playback provider — the honest processing states", () => {
  test("an empty outputs list → outputs-pending (a real state, not an error, not a fake player)", async () => {
    const provider = createHttpPlaybackProvider({
      baseUrl: "http://control",
      fetch: scriptedFetch([{ response: listResponse([]) }]),
    });
    const result = await provider.loadOutput("sess-1", "r-1");
    expect(result).toEqual({ kind: "outputs-pending" });
  });

  test("more than one stored segment → unsupported-output, never a silent first-segment-wins", async () => {
    const a = realSegment();
    const b = realSegment(); // same content/summary shape; only the count matters here
    const provider = createHttpPlaybackProvider({
      baseUrl: "http://control",
      fetch: scriptedFetch([{ response: listResponse([a.summary, b.summary]) }]),
    });
    const err = await provider.loadOutput("sess-1", "r-1").catch((e: unknown) => e);
    expect(isViewerControlError(err)).toBe(true);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("unsupported-output");
      expect(err.message).toContain("2 stored output segments");
      expect(err.details.segmentIds).toEqual([a.summary.segmentId, b.summary.segmentId]);
    }
  });

  test("a listed summary that disagrees with the fetched envelope → media-invalid (defense in depth)", async () => {
    const segment = realSegment();
    const disagreeingSummary = { ...segment.summary, byteLength: segment.summary.byteLength + 1 };
    const provider = createHttpPlaybackProvider({
      baseUrl: "http://control",
      fetch: scriptedFetch([
        { response: listResponse([disagreeingSummary]) },
        { response: jsonResponse(200, segment.envelope) },
      ]),
    });
    const err = await provider.loadOutput("sess-1", "r-1").catch((e: unknown) => e);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("media-invalid");
      expect(err.message).toContain("disagrees with the outputs list summary");
    }
  });
});

describe("playback provider — wire error classes pass through VERBATIM (the W705 wiring contract)", () => {
  test("a rights denial (403) on EITHER route stays rights-denied — never a retryable server error", async () => {
    const provider = createHttpPlaybackProvider({
      baseUrl: "http://control",
      fetch: scriptedFetch([
        {
          response: jsonResponse(403, {
            error: {
              failureClass: "rights-denied",
              message: "playback access denied: rightsCapabilities.canStoreDerivatives is false",
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

    const segmentRoute = createHttpPlaybackProvider({
      baseUrl: "http://control",
      fetch: scriptedFetch([
        {
          response: jsonResponse(403, {
            error: { failureClass: "rights-denied", message: "denied at the segment route" },
          }),
        },
      ]),
    });
    const segmentErr = await segmentRoute
      .fetchSegment("sess-1", "r-1", "anime-clip-00000000")
      .catch((e: unknown) => e);
    if (isViewerControlError(segmentErr)) {
      expect(segmentErr.failureClass).toBe("rights-denied");
      expect(segmentErr.details.httpStatus).toBe(403);
    }
  });

  test("every other recognized control class passes through verbatim on both routes", async () => {
    const classes: Array<[ViewerFailureClass, number]> = [
      ["media-invalid", 400],
      ["validation", 400],
      ["resource-limit", 413],
      ["internal", 500],
      ["unknown-session", 404],
      ["unknown-render", 404],
      ["unknown-segment", 404],
      ["unknown-route", 404],
      ["method-not-allowed", 405],
    ];
    for (const [failureClass, status] of classes) {
      const probe = createHttpPlaybackProvider({
        baseUrl: "http://control",
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

  test("an UNRECOGNIZED wire class → internal carrying the raw class (never silently mapped)", async () => {
    const provider = createHttpPlaybackProvider({
      baseUrl: "http://control",
      fetch: scriptedFetch([
        { response: jsonResponse(418, { error: { failureClass: "teapot", message: "brewing" } }) },
      ]),
    });
    const err = await provider.loadOutput("sess-1", "r-1").catch((e: unknown) => e);
    expect(isViewerControlError(err)).toBe(true);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("internal");
      expect(err.message).toBe("brewing");
      expect(err.details.wireFailureClass).toBe("teapot");
      expect(err.details.httpStatus).toBe(418);
    }
  });

  test("an error body without the error envelope → internal (malformed error body)", async () => {
    const provider = createHttpPlaybackProvider({
      baseUrl: "http://control",
      fetch: scriptedFetch([{ response: jsonResponse(500, { hello: "world" }) }]),
    });
    const err = await provider.loadOutput("sess-1", "r-1").catch((e: unknown) => e);
    if (isViewerControlError(err)) {
      expect(err.failureClass).toBe("internal");
      expect(err.message).toContain("malformed error body");
    }
  });
});

describe("playback provider — determinism", () => {
  test("the same script yields deep-equal outcomes (ok + classified errors)", async () => {
    async function run(): Promise<string> {
      const segment = realSegment();
      const provider = createHttpPlaybackProvider({
        baseUrl: "http://control",
        fetch: scriptedFetch([
          { response: listResponse([segment.summary]) },
          { response: jsonResponse(200, segment.envelope) },
          { response: listResponse([]) },
          {
            response: jsonResponse(403, {
              error: { failureClass: "rights-denied", message: "denied" },
            }),
          },
        ]),
      });
      const ok = await provider.loadOutput("a", "1").then(
        (value) => JSON.stringify(value),
        (err: unknown) => `err:${String(err)}`,
      );
      const pending = await provider.loadOutput("a", "2").then(
        (value) => JSON.stringify(value),
        (err: unknown) => `err:${String(err)}`,
      );
      const denied = await provider.loadOutput("a", "3").then(
        () => "ok",
        (err: unknown) => (isViewerControlError(err) ? `err:${err.failureClass}` : "other"),
      );
      return `${ok}|${pending}|${denied}`;
    }
    expect(await run()).toEqual(await run());
  });
});
