/**
 * THE WATCH VIDEO BYTE ROUTE TESTS (R504) — the HTML5 player's source,
 * proven end-to-end over the REAL composition:
 *
 * a REAL ffmpeg-generated MP4 (generateTestMp4 — never a committed
 * fixture) uploads through the real upload-sessions route, the real
 * normalization pipeline stores the original-reality artifact, and the
 * playback-gated byte route then serves those very bytes:
 *
 * - the GATES: the watch gate (anonymous on a private session answers the
 *   uniform unknown-session 404 — no existence oracle), the fail-closed
 *   rights derivation (a playback-denied session answers 403 BEFORE any
 *   byte), the closed reality vocabulary (a malformed kind is a 400), and
 *   the unknown-artifact 404;
 * - the VERIFIED READ: the full object's sha-256 equals the catalog
 *   descriptor's integrityHash (the integrity evidence, re-verified per
 *   request); a CORRUPTED store answers the typed integrity 500 — never
 *   wrong bytes;
 * - the RANGE contract: 200 full / 206 partial with Content-Range / 416
 *   unsatisfiable with the proof / malformed → 200 whole object;
 * - the honest NOT-VIDEO boundary: a derived reality's SVG segment
 *   answers a typed 415 (the diagnostics player renders those — they are
 *   never presented as video);
 * - the realities acquisition route carries the artifact catalog
 *   (additive — the per-renderer options stay unchanged).
 */
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeterministicTestHasher } from "@sporta/identity";
import { generateTestMp4, LocalFilesystemStorage, sha256OfBytes } from "@sporta/media-platform";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { InMemoryRedis } from "../src/server/platform/upstash/redis";
import { POST as uploadSessionRoute } from "../src/app/api/create/upload-sessions/route";
import { POST as renderRoute } from "../src/app/api/create/sessions/[sessionId]/renders/route";
import { GET as mediaJobRoute } from "../src/app/api/media/jobs/[jobId]/route";
import { GET as videoRoute } from "../src/app/api/watch/[sessionId]/realities/[kind]/artifacts/[artifactId]/content/route";
import { GET as realitiesRoute } from "../src/app/api/watch/[sessionId]/realities/route";
import { buildWatchArtifactCatalog } from "../src/server/catalog-service";

/** A deterministic stepping clock (the repo's hermetic rig). */
function steppingClock(): () => number {
  let current = 1_999_999_999_000;
  return () => {
    current += 17;
    return current;
  };
}

function withCookie(token: string | null, path: string, init: RequestInit = {}): Request {
  return new Request(`http://sporta.test${path}`, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      ...(token === null ? {} : { cookie: `${SPORTA_SESSION_COOKIE}=${token}` }),
    },
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function jsonPost(payload: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

/** Builds one real MP4 upload request (multipart, like a browser form). */
function uploadSessionRequest(
  token: string | null,
  bytes: Uint8Array,
  operations: string[],
): Request {
  const form = new FormData();
  form.append(
    "file",
    new File([bytes.slice().buffer as ArrayBuffer], "clip.mp4", { type: "video/mp4" }),
  );
  form.append("operations", JSON.stringify(operations));
  return withCookie(token, "/api/create/upload-sessions", { method: "POST", body: form });
}

let server: SportaServer;
let scratch = "";
let creatorToken = "";
let sessionId = "";
let deniedSessionId = "";
let artifactId = "";
let artifactHash = "";
/** The real stored bytes (the storage port's own `ArrayBufferLike` backing). */
let artifactBytes: Uint8Array = new Uint8Array(0);
let artifactIdDenied = "";

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "sporta-watch-video-"));
  server = createSportaServer({
    nowMs: steppingClock(),
    passwordHasher: createDeterministicTestHasher(),
    transient: { redis: new InMemoryRedis(steppingClock()), provider: "in-memory" },
    seed: true,
    media: {
      db: ":memory:",
      storage: new LocalFilesystemStorage(join(scratch, "media-storage")),
    },
  });
  installSportaServerForTests(server);
  await server.ready;

  const registered = await server.auth.register({
    username: "watch-video-creator",
    password: "a-real-watch-password",
    roles: ["creator", "viewer"],
  });
  creatorToken = (await server.auth.issueSession({ userId: registered.userId })).token;

  // THE REAL UPLOAD: ffmpeg generates the MP4; the real pipeline
  // normalizes it and stores the original-reality artifact.
  const clipPath = await generateTestMp4(join(scratch, "clip.mp4"), {
    durationSeconds: 2,
    withAudio: true,
  });
  const uploadBytes = new Uint8Array(await Bun.file(clipPath).arrayBuffer());

  const upload = await uploadSessionRoute(
    uploadSessionRequest(creatorToken, uploadBytes, [
      "analysis",
      "transformation",
      "derivativeGeneration",
      "storage",
    ]),
  );
  expect(upload.status).toBe(201);
  const uploadBody = (await bodyOf(upload)) as {
    sessionId: string;
    source: { job: { jobId: string } | null };
  };
  sessionId = uploadBody.sessionId;
  expect(uploadBody.source.job).not.toBeNull();
  const mediaJobId = uploadBody.source.job!.jobId;

  // The playback-denying session (the W916 posture, for the 403 gate).
  const deniedUpload = await uploadSessionRoute(
    uploadSessionRequest(creatorToken, uploadBytes, ["analysis", "transformation"]),
  );
  expect(deniedUpload.status).toBe(201);
  const deniedBody = (await bodyOf(deniedUpload)) as {
    sessionId: string;
    source: { job: { jobId: string } | null };
  };
  deniedSessionId = deniedBody.sessionId;
  expect(deniedBody.source.job).not.toBeNull();
  const deniedMediaJobId = deniedBody.source.job!.jobId;

  // Poll the real media job to terminal success, then read the artifact
  // the catalog descriptor names.
  let artifact: { artifactId: string; contentHash: string } | null = null;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const response = await mediaJobRoute(
      withCookie(creatorToken, `/api/media/jobs/${mediaJobId}`),
      { params: Promise.resolve({ jobId: mediaJobId }) },
    );
    expect(response.status).toBe(200);
    const job = (await bodyOf(response)) as {
      terminal: boolean;
      state: string;
      result: { artifactId: string; contentHash: string } | null;
    };
    if (job.terminal) {
      expect(job.state).toBe("succeeded");
      expect(job.result).not.toBeNull();
      artifact = job.result;
      break;
    }
    await Bun.sleep(25);
  }
  expect(artifact).not.toBeNull();
  artifactId = artifact!.artifactId;
  // The artifact record's own content hash (the content address the store
  // verified — the descriptor's integrityHash is exactly this value).
  const artifactRecord = server.media.artifact(artifactId);
  expect(artifactRecord).not.toBeNull();
  artifactHash = artifactRecord!.contentHash;

  // The denied session's media job settles too (the transformation
  // operation runs the pipeline; the PLAYBACK derivation is what denies).
  let deniedArtifactId = "";
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const response = await mediaJobRoute(
      withCookie(creatorToken, `/api/media/jobs/${deniedMediaJobId}`),
      { params: Promise.resolve({ jobId: deniedMediaJobId }) },
    );
    expect(response.status).toBe(200);
    const job = (await bodyOf(response)) as {
      terminal: boolean;
      result: { artifactId: string } | null;
    };
    if (job.terminal) {
      expect(job.result).not.toBeNull();
      deniedArtifactId = job.result!.artifactId;
      break;
    }
    await Bun.sleep(25);
  }
  expect(deniedArtifactId.length).toBeGreaterThan(0);
  artifactIdDenied = deniedArtifactId;

  // The denied session's artifact id (its bytes must NEVER be servable —
  // the artifact exists; the catalog reveals nothing, and the byte route
  // denies before consulting the store).
  const deniedCatalog = await buildWatchArtifactCatalog(server, deniedSessionId);
  expect(deniedCatalog.realities).toBeNull(); // the W916 posture
  artifactIdDenied =
    server.media.artifactsOfSession(deniedSessionId).find((record) => record.reality === "original")
      ?.artifactId ?? "";
  expect(artifactIdDenied).toBe(deniedArtifactId);

  // The real bytes (for the slice comparisons) — read through the store
  // the route itself reads.
  const { normalizedMediaKey } = await import("@sporta/media-platform");
  const stored = await server.mediaStorage.get(normalizedMediaKey(artifactHash));
  expect(stored).not.toBeNull();
  artifactBytes = stored!;
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("GET /api/watch/[sessionId]/realities/[kind]/artifacts/[artifactId]/content (R504)", () => {
  test("the gates: the watch gate answers the uniform 404 before existence is revealed", async () => {
    const response = await videoRoute(
      withCookie(
        null,
        `/api/watch/${sessionId}/realities/original/artifacts/${artifactId}/content`,
      ),
      {
        params: Promise.resolve({ sessionId, kind: "original", artifactId }),
      },
    );
    // A private session is not watchable by anonymous callers — the
    // unknown-session 404, byte-identical (no existence oracle).
    expect(response.status).toBe(404);
    const body = await bodyOf(response);
    expect((body.error as { failureClass: string }).failureClass).toBe("unknown-session");
  });

  test("the closed reality vocabulary: a malformed kind is a typed 400", async () => {
    const response = await videoRoute(
      withCookie(
        creatorToken,
        `/api/watch/${sessionId}/realities/not-a-kind/artifacts/${artifactId}/content`,
      ),
      {
        params: Promise.resolve({ sessionId, kind: "not-a-kind", artifactId }),
      },
    );
    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect((body.error as { message: string }).message).toContain("closed vocabulary");
  });

  test("the fail-closed rights derivation: a denied session answers 403 BEFORE any byte", async () => {
    expect(artifactIdDenied.length).toBeGreaterThan(0);
    const response = await videoRoute(
      withCookie(
        creatorToken,
        `/api/watch/${deniedSessionId}/realities/original/artifacts/${artifactIdDenied}/content`,
      ),
      {
        params: Promise.resolve({
          sessionId: deniedSessionId,
          kind: "original",
          artifactId: artifactIdDenied,
        }),
      },
    );
    expect(response.status).toBe(403);
    const body = await bodyOf(response);
    expect((body.error as { failureClass: string }).failureClass).toBe("rights-denied");
  });

  test("an unknown artifact of an entitled session is the uniform 404", async () => {
    const response = await videoRoute(
      withCookie(
        creatorToken,
        `/api/watch/${sessionId}/realities/original/artifacts/no-such-artifact/content`,
      ),
      {
        params: Promise.resolve({ sessionId, kind: "original", artifactId: "no-such-artifact" }),
      },
    );
    expect(response.status).toBe(404);
  });

  test("THE VERIFIED READ: the full object serves as video/mp4 and re-hashes to the descriptor's integrity hash", async () => {
    const response = await videoRoute(
      withCookie(
        creatorToken,
        `/api/watch/${sessionId}/realities/original/artifacts/${artifactId}/content`,
      ),
      {
        params: Promise.resolve({ sessionId, kind: "original", artifactId }),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("x-sporta-integrity-verified")).toBe("sha256");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength).toBe(artifactBytes.byteLength);
    // THE INTEGRITY EVIDENCE: the served bytes' sha-256 equals the catalog
    // descriptor's integrityHash (the store re-verifies per request).
    expect(sha256OfBytes(bytes)).toBe(artifactHash);
  });

  test("the RANGE contract: a single range answers 206 with Content-Range and the exact slice", async () => {
    const response = await videoRoute(
      withCookie(
        creatorToken,
        `/api/watch/${sessionId}/realities/original/artifacts/${artifactId}/content`,
        { headers: { range: "bytes=10-49" } },
      ),
      {
        params: Promise.resolve({ sessionId, kind: "original", artifactId }),
      },
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 10-49/${artifactBytes.byteLength}`);
    expect(response.headers.get("content-length")).toBe("40");
    const slice = new Uint8Array(await response.arrayBuffer());
    expect(slice.byteLength).toBe(40);
    expect(Array.from(slice)).toEqual(Array.from(artifactBytes.slice(10, 50)));
  });

  test("an open-ended range serves to the last byte", async () => {
    const response = await videoRoute(
      withCookie(
        creatorToken,
        `/api/watch/${sessionId}/realities/original/artifacts/${artifactId}/content`,
        { headers: { range: `bytes=${artifactBytes.byteLength - 5}-` } },
      ),
      {
        params: Promise.resolve({ sessionId, kind: "original", artifactId }),
      },
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes ${artifactBytes.byteLength - 5}-${artifactBytes.byteLength - 1}/${artifactBytes.byteLength}`,
    );
  });

  test("an unsatisfiable range answers 416 with the proof", async () => {
    const response = await videoRoute(
      withCookie(
        creatorToken,
        `/api/watch/${sessionId}/realities/original/artifacts/${artifactId}/content`,
        { headers: { range: `bytes=${artifactBytes.byteLength + 10}-` } },
      ),
      {
        params: Promise.resolve({ sessionId, kind: "original", artifactId }),
      },
    );
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(`bytes */${artifactBytes.byteLength}`);
  });

  test("a malformed Range is ignored per RFC 9110 — the whole object answers 200", async () => {
    const response = await videoRoute(
      withCookie(
        creatorToken,
        `/api/watch/${sessionId}/realities/original/artifacts/${artifactId}/content`,
        { headers: { range: "bytes=abc" } },
      ),
      {
        params: Promise.resolve({ sessionId, kind: "original", artifactId }),
      },
    );
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength).toBe(artifactBytes.byteLength);
  });

  test("FAIL-CLOSED integrity: a corrupted store answers the typed 500 — never wrong bytes", async () => {
    const { normalizedMediaKey } = await import("@sporta/media-platform");
    const key = normalizedMediaKey(artifactHash);
    // Corrupt the stored object (the local-fs adapter's own layout).
    await writeFile(join(scratch, "media-storage", key), new Uint8Array([0x00, 0x01, 0x02, 0x03]));
    const response = await videoRoute(
      withCookie(
        creatorToken,
        `/api/watch/${sessionId}/realities/original/artifacts/${artifactId}/content`,
      ),
      {
        params: Promise.resolve({ sessionId, kind: "original", artifactId }),
      },
    );
    expect(response.status).toBe(500);
    const body = await bodyOf(response);
    expect((body.error as { failureClass: string }).failureClass).toBe("internal");

    // Restore the real bytes directly (the store's own put is exclusive-create
    // — the file already exists; the route's verified read then serves again).
    await writeFile(join(scratch, "media-storage", key), artifactBytes);
    const restored = await videoRoute(
      withCookie(
        creatorToken,
        `/api/watch/${sessionId}/realities/original/artifacts/${artifactId}/content`,
      ),
      {
        params: Promise.resolve({ sessionId, kind: "original", artifactId }),
      },
    );
    expect(restored.status).toBe(200);
    expect(sha256OfBytes(new Uint8Array(await restored.arrayBuffer()))).toBe(artifactHash);
  });

  test("the honest NOT-VIDEO boundary: a derived reality's SVG segment answers a typed 415", async () => {
    // Dispatch a real anime render so the anime-npr reality holds a real
    // stored (SVG) output segment.
    const dispatch = await renderRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/renders`,
        jsonPost({ rendererId: "anime.prototype", styleId: "watch-video-test" }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(dispatch.status).toBe(202);
    const dispatchBody = (await bodyOf(dispatch)) as { jobId: string };

    // Poll the job to success (the real renderer + the real W504 store).
    const jobRoute = (await import("../src/app/api/create/sessions/[sessionId]/jobs/[jobId]/route"))
      .GET;
    let segmentId = "";
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const response = await jobRoute(
        withCookie(creatorToken, `/api/create/sessions/${sessionId}/jobs/${dispatchBody.jobId}`),
        { params: Promise.resolve({ sessionId, jobId: dispatchBody.jobId }) },
      );
      expect(response.status).toBe(200);
      const job = (await bodyOf(response)) as {
        completion?: { outputs: { artifactId: string; contentType: string }[] };
      };
      if (job.completion !== undefined) {
        expect(job.completion.outputs.length).toBeGreaterThan(0);
        segmentId = job.completion.outputs[0]!.artifactId;
        break;
      }
      await Bun.sleep(25);
    }
    expect(segmentId.length).toBeGreaterThan(0);

    // The catalog's own anime-npr descriptor (the artifact id the player
    // resolves — the compute job's output artifact id is the content hash,
    // the catalog descriptor's is the segment id; the catalog is the truth).
    const catalog = await buildWatchArtifactCatalog(server, sessionId);
    const animeEntry = catalog.realities!.find((entry) => entry.kind === "anime-npr");
    expect(animeEntry!.availability).toBe("ready");
    expect(animeEntry!.artifacts.length).toBeGreaterThan(0);
    segmentId = animeEntry!.artifacts[0]!.artifactId;

    const response = await videoRoute(
      withCookie(
        creatorToken,
        `/api/watch/${sessionId}/realities/anime-npr/artifacts/${segmentId}/content`,
      ),
      {
        params: Promise.resolve({ sessionId, kind: "anime-npr", artifactId: segmentId }),
      },
    );
    expect(response.status).toBe(415);
    const body = await bodyOf(response);
    const error = body.error as { failureClass: string; message: string };
    expect(error.failureClass).toBe("media-invalid");
    expect(error.message).toContain("not an HTML5 video artifact");
  });
});

describe("GET /api/watch/[sessionId]/realities — the artifact catalog acquisition (R504/R505)", () => {
  test("carries the four reality entries with the real descriptors (additive; options unchanged)", async () => {
    const response = await realitiesRoute(
      withCookie(creatorToken, `/api/watch/${sessionId}/realities`),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      sessionId: string;
      options: { rendererId: string }[];
      artifacts: {
        playback: { state: string };
        realities:
          | {
              kind: string;
              availability: string;
              reason: string;
              artifacts: { artifactId: string; integrityHash: string; contentType: string }[];
            }[]
          | null;
      };
    };
    expect(body.sessionId).toBe(sessionId); // the Simulation G constant
    expect(body.options.length).toBeGreaterThan(0); // the W905 options stay
    expect(body.artifacts.realities).not.toBeNull();
    expect(body.artifacts.realities!.map((entry) => entry.kind)).toEqual([
      "original",
      "tactical",
      "three-d-game",
      "anime-npr",
    ]);
    const original = body.artifacts.realities!.find((entry) => entry.kind === "original")!;
    expect(original.availability).toBe("ready");
    expect(original.artifacts[0]!.artifactId).toBe(artifactId);
    expect(original.artifacts[0]!.integrityHash).toBe(artifactHash);
    expect(original.artifacts[0]!.contentType).toContain("mp4");
    // The tactical/3D realities: producers are REGISTERED (R508-R510's
    // derived-reality plane composes when the real ffmpeg toolchain is
    // present) but no render has been dispatched for them on this session —
    // the honest requires-render, never invented artifacts.
    const tactical = body.artifacts.realities!.find((entry) => entry.kind === "tactical")!;
    expect(tactical.availability).toBe("requires-render");
    expect(tactical.artifacts).toHaveLength(0);
  });

  test("a playback-denied session reveals NOTHING (realities: null)", async () => {
    const response = await realitiesRoute(
      withCookie(creatorToken, `/api/watch/${deniedSessionId}/realities`),
      { params: Promise.resolve({ sessionId: deniedSessionId }) },
    );
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      artifacts: { playback: { state: string }; realities: unknown };
    };
    expect(body.artifacts.playback.state).toBe("denied");
    expect(body.artifacts.realities).toBeNull();
  });
});
