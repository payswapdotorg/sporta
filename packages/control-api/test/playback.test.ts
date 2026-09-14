/**
 * W504 in-process E2E — the playback routes over the render-output store
 * port: golden path (byte-identical content + verbatim manifest), the
 * fail-closed rights gate (deny BEFORE existence is revealed), 404
 * classification (unknown-render vs unknown-segment), the no-store default
 * (≡ empty store), structural store-failure mapping (rights-denied → 403,
 * resource-limit → 413, unrecognized → 500), the scope-mismatch contract
 * guard, and malformed requests (405/404 transport rejections).
 *
 * The store here is a minimal in-test mock implementing the port (the real
 * implementation — `@sporta/output-pipeline`'s segment store/pipeline — is
 * exercised by the W504 e2e in that package, which wires it into
 * `createControlServer` through this same seam).
 */
import { afterAll, describe, expect, test } from "bun:test";
import type { AuthorizationPolicy } from "@sporta/contracts";
import { deriveRightsCapabilities } from "@sporta/contracts";
import { MetricsRegistry, createLogger } from "@sporta/observability";
import { TEST_EPOCH_MS } from "@sporta/testing";
import { createControlServer } from "../src/index";
import type { RenderOutputStore } from "../src/index";
import {
  analysisTransformationPolicy,
  callJson,
  counterValue,
  createSession,
  fullAllowPolicy,
  postJson,
} from "./helpers";
import type { ErrorBody } from "./helpers";

// ---------------------------------------------------------------------------
// The in-test mock store (the port contract, with failure injection)
// ---------------------------------------------------------------------------

/** A stored segment document in the mock store. */
interface MockSegment {
  sessionId: string;
  renderId: string;
  segmentId: string;
  contentType: string;
  content: string;
  byteLength: number;
  contentHash: string;
  manifest: unknown;
}

/** Failure injection: what the store should throw on the next call. */
interface StoreFailure {
  failureClass: string;
  message: string;
  details?: Record<string, unknown>;
}

/** A structural store failure (NOT an Error instance — exercises the mapper). */
class StructuralStoreFailure {
  readonly failureClass: string;
  readonly message: string;
  readonly details: Record<string, unknown>;

  constructor(failure: StoreFailure) {
    this.failureClass = failure.failureClass;
    this.message = failure.message;
    this.details = failure.details ?? {};
  }
}

/**
 * The mock render-output store: rights re-derivation on every retrieval
 * (fail-closed, exactly like the real store), scope-keyed documents, and
 * optional failure injection / scope-mismatch answers.
 */
function createMockStore(options: { failWith?: unknown; mismatchScope?: boolean } = {}) {
  const segments = new Map<string, MockSegment>();
  const key = (s: string, r: string, seg: string): string => `${s}\u0000${r}\u0000${seg}`;
  const store: RenderOutputStore & { add(segment: MockSegment): void } = {
    add(segment: MockSegment): void {
      segments.set(key(segment.sessionId, segment.renderId, segment.segmentId), segment);
    },
    getSegment(query) {
      if (options.failWith !== undefined) throw options.failWith;
      const caps = deriveRightsCapabilities(query.policy, new Date(query.nowMs));
      if (caps.canStoreDerivatives !== true) {
        // Store-side defense in depth: a structural rights denial.
        throw new StructuralStoreFailure({
          failureClass: "rights-denied",
          message: `store denied playback for session '${query.sessionId}'`,
          details: { sessionId: query.sessionId },
        });
      }
      const stored = segments.get(key(query.sessionId, query.renderId, query.segmentId));
      if (stored === undefined) return null;
      if (options.mismatchScope === true) {
        // Simulate a mis-scoped store answer (a contract violation).
        return { ...stored, sessionId: "sess-other", renderId: "r-other", segmentId: "seg-other" };
      }
      return { ...structuredClone(stored), manifest: structuredClone(stored.manifest) };
    },
    listSegments(query) {
      if (options.failWith !== undefined) throw options.failWith;
      const caps = deriveRightsCapabilities(query.policy, new Date(query.nowMs));
      if (caps.canStoreDerivatives !== true) {
        throw new StructuralStoreFailure({
          failureClass: "rights-denied",
          message: `store denied listing for session '${query.sessionId}'`,
          details: { sessionId: query.sessionId },
        });
      }
      const out: Array<{
        segmentId: string;
        contentType: string;
        byteLength: number;
        contentHash: string;
      }> = [];
      for (const segment of segments.values()) {
        if (segment.sessionId === query.sessionId && segment.renderId === query.renderId) {
          out.push({
            segmentId: segment.segmentId,
            contentType: segment.contentType,
            byteLength: segment.byteLength,
            contentHash: segment.contentHash,
          });
        }
      }
      return out;
    },
  };
  return store;
}

/** One playback harness: a real server with the mock store wired in. */
interface PlaybackHarness {
  server: ReturnType<typeof createControlServer>;
  baseUrl: string;
  store: ReturnType<typeof createMockStore>;
  lines: string[];
  metrics: MetricsRegistry;
}

function createPlaybackHarness(
  options: { store?: ReturnType<typeof createMockStore>; nowMs?: () => number } = {},
): PlaybackHarness {
  const lines: string[] = [];
  const logger = createLogger({
    sink: (line: string) => {
      lines.push(line);
    },
    now: () => TEST_EPOCH_MS,
  });
  const metrics = new MetricsRegistry();
  const store = options.store ?? createMockStore();
  const server = createControlServer({
    port: 0,
    observability: { logger, metrics },
    nowMs: options.nowMs ?? (() => TEST_EPOCH_MS),
    renderOutputStore: store,
  });
  return { server, baseUrl: `http://127.0.0.1:${server.port}`, store, lines, metrics };
}

/** The playback document shape answered by GET …/outputs/:segmentId. */
interface PlaybackDocument {
  sessionId: string;
  renderId: string;
  segmentId: string;
  contentType: string;
  byteLength: number;
  contentHash: string;
  content: string;
  manifest: unknown;
}

interface PlaybackList {
  sessionId: string;
  renderId: string;
  segments: Array<{
    segmentId: string;
    contentType: string;
    byteLength: number;
    contentHash: string;
  }>;
}

/** The canonical mock segment document (deterministic). */
function mockSegment(sessionId: string, renderId: string): MockSegment {
  const content = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"></svg>';
  return {
    sessionId,
    renderId,
    segmentId: "anime-clip-01234567",
    contentType: "image/svg+xml",
    content,
    byteLength: new TextEncoder().encode(content).length,
    contentHash: "a".repeat(64),
    manifest: { format: { kind: "animated-svg", version: 1 }, segmentId: "anime-clip-01234567" },
  };
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

const harness: PlaybackHarness = createPlaybackHarness();
afterAll(() => {
  harness.server.stop(true);
});

describe("GET /v1/sessions/:id/renders/:renderId/outputs — list (playback gate)", () => {
  test("allowed: summaries in insertion order with content hash + byte length", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    harness.store.add(mockSegment(sessionId, "r-1"));
    const response = await callJson<PlaybackList>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/r-1/outputs`,
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      sessionId,
      renderId: "r-1",
      segments: [
        {
          segmentId: "anime-clip-01234567",
          contentType: "image/svg+xml",
          byteLength: 64,
          contentHash: "a".repeat(64),
        },
      ],
    });
  });

  test("denied: no canStoreDerivatives → 403 rights-denied (app gate)", async () => {
    const sessionId = await createSession(harness.baseUrl, analysisTransformationPolicy);
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/r-1/outputs`,
    );
    expect(response.status).toBe(403);
    expect(response.body.error.failureClass).toBe("rights-denied");
    expect(response.body.error.message).toContain("canStoreDerivatives");
  });

  test("no store configured (the W701 default) ≡ empty store: 200 with []", async () => {
    const lines: string[] = [];
    const server = createControlServer({
      port: 0,
      observability: {
        logger: createLogger({ sink: (l) => lines.push(l) }),
        metrics: new MetricsRegistry(),
      },
      nowMs: () => TEST_EPOCH_MS,
    });
    try {
      const sessionId = await createSession(`http://127.0.0.1:${server.port}`, fullAllowPolicy);
      const response = await callJson<PlaybackList>(
        `http://127.0.0.1:${server.port}`,
        `/v1/sessions/${sessionId}/renders/r-1/outputs`,
      );
      expect(response.status).toBe(200);
      expect(response.body.segments).toEqual([]);
    } finally {
      void server.stop(true);
    }
  });

  test("unknown session → 404 unknown-session (gate order: session first)", async () => {
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      "/v1/sessions/sess-does-not-exist/renders/r-1/outputs",
    );
    expect(response.status).toBe(404);
    expect(response.body.error.failureClass).toBe("unknown-session");
  });
});

describe("GET …/outputs/:segmentId — golden path", () => {
  test("200 with byte-identical content + verbatim manifest + integrity fields", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const segment = mockSegment(sessionId, "r-1");
    harness.store.add(segment);
    const response = await callJson<PlaybackDocument>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/r-1/outputs/${segment.segmentId}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.sessionId).toBe(sessionId);
    expect(response.body.renderId).toBe("r-1");
    expect(response.body.segmentId).toBe(segment.segmentId);
    expect(response.body.contentType).toBe("image/svg+xml");
    // BYTE-IDENTICAL: the served content is the stored content, verbatim.
    expect(response.body.content).toBe(segment.content);
    expect(response.body.byteLength).toBe(new TextEncoder().encode(segment.content).length);
    expect(response.body.contentHash).toBe(segment.contentHash);
    // The manifest is carried verbatim (deep-equal, not re-serialized).
    expect(response.body.manifest).toEqual(segment.manifest);
    expect(response.requestId).toMatch(/^req-\d+$/);
  });

  test("a second identical fetch returns identical bytes (idempotent read)", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const segment = mockSegment(sessionId, "r-2");
    harness.store.add(segment);
    const first = await callJson<PlaybackDocument>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/r-2/outputs/${segment.segmentId}`,
    );
    const second = await callJson<PlaybackDocument>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/r-2/outputs/${segment.segmentId}`,
    );
    expect(second.body).toEqual(first.body);
    expect(second.body.content).toBe(segment.content);
  });
});

describe("GET …/outputs/:segmentId — the playback gate (fail-closed)", () => {
  test("denied BEFORE existence is revealed: absent render under a denied policy → 403, not 404", async () => {
    const sessionId = await createSession(harness.baseUrl, analysisTransformationPolicy);
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/r-999999/outputs/anime-clip-00000000`,
    );
    expect(response.status).toBe(403);
    expect(response.body.error.failureClass).toBe("rights-denied");
  });

  test("policy expired after creation → 403 rights-denied (re-derived at nowMs)", async () => {
    const nearExpiry: AuthorizationPolicy = {
      ...fullAllowPolicy,
      policyId: "policy-playback-expiry",
      expiresAtIso: "2025-01-06T13:00:00.000Z", // +1h over the test epoch
    };
    let clock = TEST_EPOCH_MS;
    const expired: PlaybackHarness = createPlaybackHarness({ nowMs: () => clock });
    try {
      const sessionId = await createSession(expired.baseUrl, nearExpiry);
      clock = TEST_EPOCH_MS + 2 * 3_600_000; // two hours later
      const response = await callJson<ErrorBody>(
        expired.baseUrl,
        `/v1/sessions/${sessionId}/renders/r-1/outputs/anime-clip-01234567`,
      );
      expect(response.status).toBe(403);
      expect(response.body.error.failureClass).toBe("rights-denied");
      expect(response.body.error.message).toContain("canStoreDerivatives");
    } finally {
      void expired.server.stop(true);
    }
  });
});

describe("GET …/outputs/:segmentId — 404 classification", () => {
  test("a render with no stored outputs → 404 unknown-render", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/r-999999/outputs/anime-clip-00000000`,
    );
    expect(response.status).toBe(404);
    expect(response.body.error.failureClass).toBe("unknown-render");
  });

  test("a render with outputs but not this segment id → 404 unknown-segment", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    harness.store.add(mockSegment(sessionId, "r-3"));
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/r-3/outputs/anime-clip-00000000`,
    );
    expect(response.status).toBe(404);
    expect(response.body.error.failureClass).toBe("unknown-segment");
    expect(response.body.error.details).toEqual({
      sessionId,
      renderId: "r-3",
      segmentId: "anime-clip-00000000",
    });
  });

  test("no store configured: get → 404 unknown-render (empty-store behavior)", async () => {
    const server = createControlServer({ port: 0, nowMs: () => TEST_EPOCH_MS });
    try {
      const sessionId = await createSession(`http://127.0.0.1:${server.port}`, fullAllowPolicy);
      const response = await callJson<ErrorBody>(
        `http://127.0.0.1:${server.port}`,
        `/v1/sessions/${sessionId}/renders/r-1/outputs/anime-clip-01234567`,
      );
      expect(response.status).toBe(404);
      expect(response.body.error.failureClass).toBe("unknown-render");
    } finally {
      void server.stop(true);
    }
  });
});

describe("store-side failures map onto the typed-error taxonomy (structural recognition)", () => {
  /** A harness whose store fails every call with `failWith`, plus a session. */
  async function failingStoreHarness(
    failWith: unknown,
  ): Promise<{ baseUrl: string; sessionId: string; stop: () => void }> {
    const failing = createPlaybackHarness({ store: createMockStore({ failWith }) });
    const sessionId = await createSession(failing.baseUrl, fullAllowPolicy);
    return {
      baseUrl: failing.baseUrl,
      sessionId,
      stop: (): void => {
        void failing.server.stop(true);
      },
    };
  }

  test("structural rights-denied from the store → 403 with the store's message", async () => {
    const harness0 = await failingStoreHarness(
      new StructuralStoreFailure({
        failureClass: "rights-denied",
        message: "store-side denial (stricter than the app gate)",
      }),
    );
    try {
      const response = await callJson<ErrorBody>(
        harness0.baseUrl,
        `/v1/sessions/${harness0.sessionId}/renders/r-1/outputs/anime-clip-01234567`,
      );
      expect(response.status).toBe(403);
      expect(response.body.error.failureClass).toBe("rights-denied");
      expect(response.body.error.message).toBe("store-side denial (stricter than the app gate)");
    } finally {
      harness0.stop();
    }
  });

  test("structural media-invalid from the store → 400 with the store's message", async () => {
    const harness0 = await failingStoreHarness(
      new StructuralStoreFailure({
        failureClass: "media-invalid",
        message: "store rejected the segment document",
      }),
    );
    try {
      const response = await callJson<ErrorBody>(
        harness0.baseUrl,
        `/v1/sessions/${harness0.sessionId}/renders/r-1/outputs/anime-clip-01234567`,
      );
      expect(response.status).toBe(400);
      expect(response.body.error.failureClass).toBe("media-invalid");
      expect(response.body.error.message).toBe("store rejected the segment document");
    } finally {
      harness0.stop();
    }
  });

  test("structural resource-limit from the store → 413 with details preserved", async () => {
    const harness0 = await failingStoreHarness(
      new StructuralStoreFailure({
        failureClass: "resource-limit",
        message: "segment store is full",
        details: { limit: "maxSegments" },
      }),
    );
    try {
      const response = await callJson<ErrorBody>(
        harness0.baseUrl,
        `/v1/sessions/${harness0.sessionId}/renders/r-1/outputs/anime-clip-01234567`,
      );
      expect(response.status).toBe(413);
      expect(response.body.error.failureClass).toBe("resource-limit");
      expect(response.body.error.details).toEqual({ limit: "maxSegments" });
    } finally {
      harness0.stop();
    }
  });

  test("an unrecognized error from the store → 500 internal (never a raw leak)", async () => {
    const harness0 = await failingStoreHarness(new Error("boom"));
    try {
      const response = await callJson<ErrorBody>(
        harness0.baseUrl,
        `/v1/sessions/${harness0.sessionId}/renders/r-1/outputs/anime-clip-01234567`,
      );
      expect(response.status).toBe(500);
      expect(response.body.error.failureClass).toBe("internal");
      expect(response.body.error.message).toContain("render output store failed");
    } finally {
      harness0.stop();
    }
  });

  test("a bogus failureClass → 500 internal (only the four contract classes are recognized)", async () => {
    const harness0 = await failingStoreHarness(
      new StructuralStoreFailure({ failureClass: "teapot", message: "brewing" }),
    );
    try {
      const response = await callJson<ErrorBody>(
        harness0.baseUrl,
        `/v1/sessions/${harness0.sessionId}/renders/r-1/outputs/anime-clip-01234567`,
      );
      expect(response.status).toBe(500);
      expect(response.body.error.failureClass).toBe("internal");
    } finally {
      harness0.stop();
    }
  });

  test("a store answer outside the requested scope → 500 internal (contract guard)", async () => {
    const mismatched = createPlaybackHarness({ store: createMockStore({ mismatchScope: true }) });
    try {
      const sessionId = await createSession(mismatched.baseUrl, fullAllowPolicy);
      mismatched.store.add(mockSegment(sessionId, "r-1"));
      const response = await callJson<ErrorBody>(
        mismatched.baseUrl,
        `/v1/sessions/${sessionId}/renders/r-1/outputs/anime-clip-01234567`,
      );
      expect(response.status).toBe(500);
      expect(response.body.error.failureClass).toBe("internal");
      expect(response.body.error.message).toContain("outside the requested scope");
    } finally {
      void mismatched.server.stop(true);
    }
  });
});

describe("malformed playback requests (transport rejections)", () => {
  test("POST on the outputs list route → 405 method-not-allowed with Allow: GET", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/r-1/outputs`,
      postJson({}),
    );
    expect(response.status).toBe(405);
    expect(response.body.error.failureClass).toBe("method-not-allowed");
    expect(response.headers.get("allow")).toBe("GET");
  });

  test("unknown deeper route → 404 unknown-route", async () => {
    const sessionId = await createSession(harness.baseUrl, fullAllowPolicy);
    const response = await callJson<ErrorBody>(
      harness.baseUrl,
      `/v1/sessions/${sessionId}/renders/r-1/outputs/anime-clip-01234567/extra`,
    );
    expect(response.status).toBe(404);
    expect(response.body.error.failureClass).toBe("unknown-route");
  });
});

describe("observability contract (the playback routes)", () => {
  test("every playback request logs exactly one control-api line and bumps the route counters", async () => {
    const fresh = createPlaybackHarness();
    try {
      const sessionId = await createSession(fresh.baseUrl, fullAllowPolicy);
      fresh.store.add(mockSegment(sessionId, "r-1"));
      await callJson<PlaybackList>(fresh.baseUrl, `/v1/sessions/${sessionId}/renders/r-1/outputs`);
      await callJson<PlaybackDocument>(
        fresh.baseUrl,
        `/v1/sessions/${sessionId}/renders/r-1/outputs/anime-clip-01234567`,
      );
      // Denied call (gate): one more line + a rights-denied failure counter.
      const deniedSession = await createSession(fresh.baseUrl, analysisTransformationPolicy);
      await callJson<ErrorBody>(
        fresh.baseUrl,
        `/v1/sessions/${deniedSession}/renders/r-1/outputs/anime-clip-01234567`,
      );
      const lines = fresh.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      const playbackLines = lines.filter(
        (line) =>
          line.msg === "control.get_render_output" || line.msg === "control.list_render_outputs",
      );
      expect(playbackLines).toHaveLength(3);
      for (const line of playbackLines) {
        expect(line.stage).toBe("control-api");
        const fields = line.fields as Record<string, unknown> | undefined;
        expect(line.level).toBe(fields?.outcome === "ok" ? "info" : "warn");
      }
      expect(
        counterValue(fresh.metrics, "control_requests_total", { route: "list_render_outputs" }),
      ).toBe(1);
      expect(
        counterValue(fresh.metrics, "control_requests_total", { route: "get_render_output" }),
      ).toBe(2);
      expect(
        counterValue(fresh.metrics, "control_failures_total", { failure_class: "rights-denied" }),
      ).toBe(1);
    } finally {
      void fresh.server.stop(true);
    }
  });
});
