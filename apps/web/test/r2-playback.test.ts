/**
 * W912 PLAYBACK COMPOSITION TESTS (env-independent) — the R2 round-trip wiring
 * through the REAL app composition, against an in-process S3-compatible fake
 * (the `R2RenderOutputStore` `fetchImpl` seam — the same wire shapes the real
 * bucket speaks: signed PUT/GET/DELETE + presigned GET query auth).
 *
 * These are NOT the real-bucket tests (see platform/r2-artifacts.test.ts,
 * env-gated); what is proven HERE is the composition contract around the
 * store — the part that must hold in EVERY environment:
 *
 * 1. SEEDED OUTPUTS MIRROR TO R2: with `artifacts` configured, the dev seed
 *    stores every seeded output in the (fake) bucket — the store's stats and
 *    listing see them, keyed under the control plane's own render ids.
 * 2. THE WATCH OUTPUT ROUTE SERVES R2-SOURCED BYTES: the playback-gated
 *    output route answers 200 with `x-sporta-artifact-source: r2`, and the
 *    served document is byte-identical to the control plane's gated record
 *    (the fake S3's served envelope had to be fetched to produce it).
 * 3. UNAVAILABLE ARTIFACT STORAGE ANSWERS HONESTLY: when the (fake) bucket
 *    refuses reads, the route answers 503 provider-unavailable — it NEVER
 *    silently serves in-memory bytes while configured for R2.
 * 4. TAMPERED ARTIFACTS FAIL INTEGRITY: when the bucket serves content whose
 *    hash does not match the gated record, the route answers 500 — never
 *    different bytes presented as the stored output.
 * 5. UNCONFIGURED STAYS HONEST: without `artifacts`, the route serves the
 *    in-process bytes and says so (`x-sporta-artifact-source: in-memory`).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { R2RenderOutputStore } from "../src/server/platform/r2/r2-store";
import { GET as outputRoute } from "../src/app/api/watch/[sessionId]/renders/[renderId]/outputs/[segmentId]/route";

/**
 * A minimal in-process S3-compatible fake: a Map of URL → {body, headers},
 * honoring the wire shapes the real R2 answers (PUT/GET/DELETE objects with
 * SigV4 header auth; GET with SigV4 query auth). Access-control property:
 * requests WITHOUT either auth form are REFUSED (403) — the fake never serves
 * objects to an unsigned caller, mirroring the private-bucket posture.
 */
interface FakeR3Backend {
  store: R2RenderOutputStore;
  objects: Map<string, string>;
  /** Test seam: refuse all reads (simulates an outage). */
  refuseReads: boolean;
  /** Test seam: mutate served GET bodies (simulates corruption). */
  tamperBodies: boolean;
}

function createFakeR2(): FakeR3Backend {
  const objects = new Map<string, string>();
  const backend: FakeR3Backend = {
    store: null as unknown as R2RenderOutputStore,
    objects,
    refuseReads: false,
    tamperBodies: false,
  };
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url,
    );
    const hasHeaderAuth =
      typeof init?.headers === "object" &&
      init?.headers !== null &&
      "authorization" in (init?.headers as Record<string, unknown>);
    const hasQueryAuth = url.searchParams.has("X-Amz-Signature");
    const authorized = hasHeaderAuth || hasQueryAuth;
    if (!authorized) {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code></Error>`,
        { status: 403, headers: { "content-type": "application/xml" } },
      );
    }
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${url.hostname}${url.pathname}`;
    if (method === "PUT") {
      const body = typeof init?.body === "string" ? init.body : "";
      objects.set(key, body);
      return new Response("", { status: 200 });
    }
    if (backend.refuseReads) {
      return new Response(`<?xml version="1.0"?><Error><Code>InternalError</Code></Error>`, {
        status: 500,
      });
    }
    const stored = objects.get(key);
    if (stored === undefined) {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code></Error>`,
        { status: 404 },
      );
    }
    if (method === "DELETE") {
      objects.delete(key);
      return new Response("", { status: 204 });
    }
    const body = backend.tamperBodies ? `${stored}<!--tampered-->` : stored;
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  backend.store = new R2RenderOutputStore({
    endpoint: "https://fake.r2.cloudflarestorage.com",
    bucket: "sporta-test-fake",
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret",
      region: "auto",
      service: "s3",
    },
    nowMs: () => NOW_MS,
    fetchImpl,
  });
  return backend;
}

const NOW_MS = 1_777_777_778_000;

async function findSeededAnimeOutput(
  server: SportaServer,
): Promise<{ sessionId: string; renderId: string; segmentId: string }> {
  const catalog = await server.control.listSessions();
  for (const entry of catalog.sessions) {
    const story = server.storyIndex.get(entry.id);
    if (story?.storyKey === "training") continue; // rights-denied session
    const { renders } = await server.control.listRenders(entry.id);
    for (const render of renders) {
      const outputs = await server.control.listRenderOutputs(entry.id, render.renderId);
      if (outputs.segments.length > 0) {
        return {
          sessionId: entry.id,
          renderId: render.renderId,
          segmentId: outputs.segments[0]!.segmentId,
        };
      }
    }
  }
  throw new Error("no seeded anime output found");
}

function watchRequest(scope: { sessionId: string; renderId: string; segmentId: string }): Request {
  return new Request(
    `http://sporta.test/api/watch/${scope.sessionId}/renders/${scope.renderId}/outputs/${scope.segmentId}`,
  );
}

describe("W912 R2 playback composition (in-process fake bucket)", () => {
  let server: SportaServer;
  let backend: FakeR3Backend;
  let scope: { sessionId: string; renderId: string; segmentId: string };

  beforeAll(async () => {
    backend = createFakeR2();
    server = createSportaServer({
      nowMs: () => NOW_MS,
      passwordHasher: createDeterministicTestHasher(),
      artifacts: backend.store,
      seed: true,
    });
    installSportaServerForTests(server);
    await server.ready;
    scope = await findSeededAnimeOutput(server);
  });

  test("1. seeded outputs are mirrored into the configured artifact store", async () => {
    const stats = await backend.store.stats();
    expect(stats.segments).toBeGreaterThanOrEqual(1);
    expect(stats.totalBytes).toBeGreaterThanOrEqual(1);
    const document = await server.control.getRenderOutput(
      scope.sessionId,
      scope.renderId,
      scope.segmentId,
    );
    expect(document.byteLength).toBeGreaterThan(0);
    // The mirrored object exists in the fake bucket under the scope key.
    expect(
      backend.objects.has(
        `fake.r2.cloudflarestorage.com/sporta-test-fake/render-outputs/${scope.sessionId}/${scope.renderId}/${scope.segmentId}.json`,
      ),
    ).toBe(true);
  });

  test("2. the watch output route serves R2-sourced byte-identical bytes", async () => {
    const gated = await server.control.getRenderOutput(
      scope.sessionId,
      scope.renderId,
      scope.segmentId,
    );
    const response = await outputRoute(watchRequest(scope), {
      params: Promise.resolve({ ...scope }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-sporta-artifact-source")).toBe("r2");
    const served = (await response.json()) as {
      content: string;
      contentHash: string;
      byteLength: number;
      manifest: unknown;
    };
    expect(served.content).toBe(gated.content); // byte-identical
    expect(served.contentHash).toBe(gated.contentHash);
    expect(served.byteLength).toBe(gated.byteLength);
    expect(served.manifest).toEqual(gated.manifest);
  });

  test("3. artifact-storage outage answers honest 503 (never an in-memory fallback)", async () => {
    backend.refuseReads = true;
    try {
      const response = await outputRoute(watchRequest(scope), {
        params: Promise.resolve({ ...scope }),
      });
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: { failureClass: string } };
      expect(body.error.failureClass).toBe("provider-unavailable");
    } finally {
      backend.refuseReads = false;
    }
  });

  test("4. tampered artifact bytes fail integrity (honest 500)", async () => {
    backend.tamperBodies = true;
    try {
      const response = await outputRoute(watchRequest(scope), {
        params: Promise.resolve({ ...scope }),
      });
      expect(response.status).toBe(500);
      const body = (await response.json()) as { error: { failureClass: string } };
      expect(body.error.failureClass).toBe("internal");
    } finally {
      backend.tamperBodies = false;
    }
  });

  test("5. without artifacts configured the route serves in-memory bytes, honestly labeled", async () => {
    const unconfigured = createSportaServer({
      nowMs: () => NOW_MS,
      passwordHasher: createDeterministicTestHasher(),
      artifacts: null,
      seed: true,
    });
    installSportaServerForTests(unconfigured);
    await unconfigured.ready;
    const other = await findSeededAnimeOutput(unconfigured);
    const gated = await unconfigured.control.getRenderOutput(
      other.sessionId,
      other.renderId,
      other.segmentId,
    );
    const response = await outputRoute(watchRequest(other), {
      params: Promise.resolve({ ...other }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-sporta-artifact-source")).toBe("in-memory");
    const served = (await response.json()) as { content: string; contentHash: string };
    expect(served.content).toBe(gated.content);
    expect(served.contentHash).toBe(gated.contentHash);
  });
});
