/**
 * W920 FINAL-GATE REGRESSION TESTS — the R2 duplicate path performs ZERO
 * writes (the deployed cold-start write-storm fix).
 *
 * THE DEPLOYED DEFECT (found on the w920-final deployments, errorId-correlated
 * runtime logs): every cold serverless instance re-mirrors the dev-seed
 * outputs to R2, and every durable-control-plane reconstruction re-mirrors the
 * reconstructed session's outputs — and the storeSegment DUPLICATE path used
 * to re-PUT the identical document, the scope index, and the global stats on
 * EVERY such call (3 Class A writes per duplicate). A cold-start burst spawns
 * many instances at once; the resulting write storm tripped R2's per-account
 * rate limit (HTTP 429) and the fail-loud mirror turned READS of
 * already-durable data into 500s (19/24 in the captured burst).
 *
 * THE CONTRACT PINNED HERE (env-independent, the `fetchImpl` seam):
 * 1. a FIRST-TIME store still writes (document + index + stats — 3 PUTs);
 * 2. the DUPLICATE path issues ZERO PUTs (read-verify-only: the recorded hash
 *    vs the offered hash is the whole integrity contract) — sequentially AND
 *    under a parallel burst of duplicates (the cold-boot shape);
 * 3. different content under the same content-addressed id still fails LOUD
 *    (SegmentConflictError — never a silent replace);
 * 4. a FULL COMPOSITION RE-BOOT against an already-populated bucket writes
 *    NOTHING to R2 (the seed's mirrors are all duplicates) — the deployed
 *    cold-instance storm, pinned at the composition level.
 */
import { describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { createSportaServer } from "../src/server/composition";
import { R2RenderOutputStore, SegmentConflictError } from "../src/server/platform/r2/r2-store";

const NOW_MS = 1_788_888_888_000;

interface CountingFakeR2 {
  store: R2RenderOutputStore;
  objects: Map<string, string>;
  puts: () => number;
  gets: () => number;
}

function createCountingFakeR2(): CountingFakeR2 {
  const objects = new Map<string, string>();
  let putCount = 0;
  let getCount = 0;
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
    if (!hasHeaderAuth && !hasQueryAuth) {
      return new Response("<Error><Code>AccessDenied</Code></Error>", {
        status: 403,
        headers: { "content-type": "application/xml" },
      });
    }
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${url.hostname}${url.pathname}`;
    if (method === "PUT") {
      putCount += 1;
      objects.set(key, typeof init?.body === "string" ? init.body : "");
      return new Response("", { status: 200 });
    }
    if (method === "GET") getCount += 1;
    const stored = objects.get(key);
    if (stored === undefined) {
      return new Response("<Error><Code>NoSuchKey</Code></Error>", {
        status: 404,
        headers: { "content-type": "application/xml" },
      });
    }
    return new Response(stored, { status: 200 });
  }) as unknown as typeof fetch;
  const store = new R2RenderOutputStore({
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
  return { store, objects, puts: () => putCount, gets: () => getCount };
}

const SEGMENT = {
  segmentId: "anime-clip-w920storm01",
  contentType: "image/svg+xml",
  content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><text>w920-write-storm</text></svg>`,
  byteLength: 0, // set below (UTF-8 measured)
  contentHash: "", // set below (sha256 of content)
  manifest: { schema: "sporta.anime-container/1", deterministic: true, frames: 1 },
};
SEGMENT.byteLength = new TextEncoder().encode(SEGMENT.content).length;
SEGMENT.contentHash = await crypto.subtle
  .digest("SHA-256", new TextEncoder().encode(SEGMENT.content))
  .then((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""));

describe("W920 R2 duplicate path is read-verify-only (no write storm)", () => {
  test("1. first-time store writes (document + index + stats), duplicate writes NOTHING", async () => {
    const fake = createCountingFakeR2();
    const storeSegment = () =>
      fake.store.storeSegment({
        sessionId: "sess-w920-storm",
        renderId: "r-w920-storm",
        segment: SEGMENT,
      });
    const first = await storeSegment();
    expect(first.outcome).toBe("stored");
    const putsAfterStore = fake.puts();
    expect(putsAfterStore).toBe(3); // document + index + stats — the genuine write path

    const again = await storeSegment();
    expect(again.outcome).toBe("duplicate");
    expect(fake.puts()).toBe(putsAfterStore); // ZERO new writes — the regression pin
    expect(fake.gets()).toBeGreaterThan(0); // the verify reads happened
    if (again.outcome === "duplicate") {
      expect(again.duplicateCount).toBe(0); // no counter rewrite — reported verbatim
    }

    // The deployed failure shape: a PARALLEL burst of duplicates (many cold
    // instances mirroring the same immutable content at once).
    const burst = await Promise.all(
      Array.from({ length: 12 }, () => storeSegment().catch((err: unknown) => err)),
    );
    for (const outcome of burst) {
      expect(outcome).not.toBeInstanceOf(Error);
      expect((outcome as { outcome: string }).outcome).toBe("duplicate");
    }
    expect(fake.puts()).toBe(putsAfterStore); // still ZERO new writes
  });

  test("2. different content under the same id still fails LOUD (conflict)", async () => {
    const fake = createCountingFakeR2();
    await fake.store.storeSegment({
      sessionId: "sess-w920-storm",
      renderId: "r-w920-storm",
      segment: SEGMENT,
    });
    const mutated = `${SEGMENT.content}<!-- mutated -->`;
    const mutatedHash = await crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(mutated))
      .then((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""));
    await expect(
      fake.store.storeSegment({
        sessionId: "sess-w920-storm",
        renderId: "r-w920-storm",
        segment: {
          ...SEGMENT,
          content: mutated,
          byteLength: new TextEncoder().encode(mutated).length,
          contentHash: mutatedHash,
        },
      }),
    ).rejects.toBeInstanceOf(SegmentConflictError);
  });

  test("3. a full composition RE-BOOT against the populated bucket writes NOTHING to R2", async () => {
    const fake = createCountingFakeR2();
    // Boot #1: the seed mirrors its outputs (genuine first-time stores).
    const first = createSportaServer({
      nowMs: () => NOW_MS,
      passwordHasher: createDeterministicTestHasher(),
      artifacts: fake.store,
      seed: true,
    });
    await first.ready;
    const putsAfterFirstBoot = fake.puts();
    expect(putsAfterFirstBoot).toBeGreaterThanOrEqual(3); // the seed really mirrored

    // Boot #2 (a fresh instance — new in-process state, SAME durable bucket):
    // the seed re-mirrors, every storeSegment is a duplicate — and the
    // duplicate path must not PUT anything. This is the deployed cold-start
    // storm, pinned: N concurrent instances ⇒ still zero writes.
    const reboot = createSportaServer({
      nowMs: () => NOW_MS,
      passwordHasher: createDeterministicTestHasher(),
      artifacts: fake.store,
      seed: true,
    });
    await reboot.ready;
    expect(fake.puts()).toBe(putsAfterFirstBoot); // ZERO writes on the re-boot
    expect(fake.gets()).toBeGreaterThan(0); // the verify reads happened

    // The rebooted server still serves its seeded outputs from the pipeline.
    const renders = await reboot.control.listRenders("sess-1");
    expect(renders.renders.length).toBeGreaterThan(0);
  });
});
