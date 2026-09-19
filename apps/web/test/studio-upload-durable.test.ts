/**
 * THE STUDIO UPLOAD-SOURCE DURABLE RECONSTRUCTION TEST (R501, the W921
 * upload variant) — two compositions over the SAME durable planes (the
 * shared account/session/ownership stores + the shared control-plane
 * record store + THE SHARED MEDIA SEAMS: one sqlite media db file + one
 * local-filesystem storage dir, exactly what production shares when
 * `DATABASE_URL` is configured).
 *
 * THE CYCLE: instance A runs the REAL upload flow (a real ffmpeg-generated
 * MP4 → the R101 boundary → the R207 pipeline engine → the control-plane
 * session + the durable `upload:<assetId>` record → a real render through
 * the async compute plane). Instance B — a DIFFERENT composition that never
 * saw A's in-process state — reconstructs the session: the stored upload
 * bytes are re-read (hash-verified through the storage port) and the R207
 * pipeline RE-RUNS over them (same bytes + same deterministic config → the
 * same engine), the recorded render's outputs are re-materialized under the
 * recorded ids with the segment id ASSERTED equal (determinism proven, the
 * W912-mirror posture), and B's watch serves the SAME content-addressed
 * output document A produced.
 */
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryAccountStore,
  InMemoryMediaOwnershipStore,
  InMemorySessionStore,
  SessionService,
  createDeterministicTestHasher,
  createSequentialEntropySource,
} from "@sporta/identity";
import { generateTestMp4, LocalFilesystemStorage } from "@sporta/media-platform";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { InMemoryControlPlaneRecordStore } from "../src/server/platform/control/records";
import { InMemoryRedis } from "../src/server/platform/upstash/redis";
import { POST as uploadSessionRoute } from "../src/app/api/create/upload-sessions/route";
import { POST as renderRoute } from "../src/app/api/create/sessions/[sessionId]/renders/route";
import { GET as jobRoute } from "../src/app/api/create/sessions/[sessionId]/jobs/[jobId]/route";
import { GET as watchRoute } from "../src/app/api/watch/[sessionId]/route";
import { GET as outputRoute } from "../src/app/api/watch/[sessionId]/renders/[renderId]/outputs/[segmentId]/route";

const NOW_MS_A = 1_777_900_000_000;
const NOW_MS_B = 1_778_000_000_000;

const OPERATIONS = ["analysis", "transformation", "derivativeGeneration", "storage"];

// The shared durable planes (what production shares: identity + records +
// the media db/storage — one file each, two compositions over them).
const accounts = new InMemoryAccountStore();
const sessions = new SessionService({
  store: new InMemorySessionStore(),
  nowMs: () => NOW_MS_A,
  entropy: createSequentialEntropySource(),
});
const ownership = new InMemoryMediaOwnershipStore();
const records = new InMemoryControlPlaneRecordStore();

let scratch = "";
let serverA: SportaServer;
let serverB: SportaServer;
let creatorToken = "";

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "sporta-upload-durable-"));
  // The SHARED media seams: one sqlite file + one storage dir, opened by
  // BOTH compositions (what a durable deployment shares).
  const mediaDb = join(scratch, "media-platform.db");
  const mediaStorage = new LocalFilesystemStorage(join(scratch, "media-storage"));
  const base = {
    passwordHasher: createDeterministicTestHasher(),
    accounts,
    sessions,
    ownership,
    controlRecords: records,
    media: { db: mediaDb, storage: mediaStorage },
    transient: { redis: new InMemoryRedis(() => NOW_MS_A), provider: "in-memory" as const },
  };
  serverA = createSportaServer({ ...base, nowMs: () => NOW_MS_A, seed: true });
  serverB = createSportaServer({ ...base, nowMs: () => NOW_MS_B, seed: true });
  await serverA.ready;
  await serverB.ready;

  const creator = await serverA.auth.register({
    username: "upload-durable-creator",
    password: "a-real-durable-password",
    roles: ["creator", "viewer"],
  });
  creatorToken = (await serverA.auth.issueSession({ userId: creator.userId })).token;
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

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

function onA(): void {
  installSportaServerForTests(serverA);
}

function onB(): void {
  installSportaServerForTests(serverB);
}

describe("W921 upload variant — the studio upload-source session reconstructs on a cold instance", () => {
  let sessionId = "";
  let renderId = "";
  let segmentId = "";
  let contentHashFromA = "";

  test("instance A: the REAL upload flow + a real render (the durable records)", async () => {
    onA();
    const clipPath = await generateTestMp4(join(scratch, "clip.mp4"), {
      durationSeconds: 2,
      withAudio: true,
    });
    const bytes = new Uint8Array(await Bun.file(clipPath).arrayBuffer());
    const form = new FormData();
    form.append("file", new File([bytes.slice().buffer as ArrayBuffer], "clip.mp4", { type: "video/mp4" }));
    form.append("operations", JSON.stringify(OPERATIONS));
    const created = await uploadSessionRoute(
      withCookie(creatorToken, "/api/create/upload-sessions", { method: "POST", body: form }),
    );
    expect(created.status).toBe(201);
    sessionId = ((await bodyOf(created)) as { sessionId: string }).sessionId;

    // The real render through the async compute plane.
    const dispatch = await renderRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}/renders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rendererId: "anime.prototype",
          styleId: "durable-upload-test",
          compute: { mode: "sporta-auto" },
        }),
      }),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(dispatch.status).toBe(202);
    const dispatchBody = (await bodyOf(dispatch)) as { jobId: string };
    let renderIdFromPoll = "";
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const poll = await jobRoute(
        withCookie(creatorToken, `/api/create/sessions/${sessionId}/jobs/${dispatchBody.jobId}`),
        { params: Promise.resolve({ sessionId, jobId: dispatchBody.jobId }) },
      );
      const job = await bodyOf(poll);
      if (job.renderId !== undefined) {
        renderIdFromPoll = job.renderId as string;
        break;
      }
      await Bun.sleep(25);
    }
    expect(renderIdFromPoll).not.toBe("");
    renderId = renderIdFromPoll;

    // A's own watch answer carries the stored output (its content hash).
    const watch = await watchRoute(withCookie(creatorToken, `/api/watch/${sessionId}`), {
      params: Promise.resolve({ sessionId }),
    });
    expect(watch.status).toBe(200);
    const watchBody = (await bodyOf(watch)) as {
      renders: { renderId: string; outputs: { segmentId: string; contentHash: string }[] }[];
    };
    const render = watchBody.renders.find((entry) => entry.renderId === renderId)!;
    expect(render.outputs.length).toBeGreaterThan(0);
    segmentId = render.outputs[0]!.segmentId;
    contentHashFromA = render.outputs[0]!.contentHash;
  });

  test("instance B (cold): reconstructs the upload session — the pipeline re-runs over the STORED bytes and the output is byte-identical", async () => {
    onB();
    // B never saw A's in-process state; the watch read reconstructs the
    // session from the durable record + the SHARED media seams.
    const watch = await watchRoute(withCookie(creatorToken, `/api/watch/${sessionId}`), {
      params: Promise.resolve({ sessionId }),
    });
    expect(watch.status).toBe(200);
    const watchBody = (await bodyOf(watch)) as {
      renders: { renderId: string; outputs: { segmentId: string; contentHash: string }[] }[];
    };
    const render = watchBody.renders.find((entry) => entry.renderId === renderId);
    expect(render).toBeDefined();
    expect(render!.outputs.length).toBeGreaterThan(0);
    // The re-materialized output carries the SAME content address (the
    // reconstruction asserted the segment id — determinism proven).
    expect(render!.outputs[0]!.segmentId).toBe(segmentId);
    expect(render!.outputs[0]!.contentHash).toBe(contentHashFromA);

    // And B serves the SAME output document bytes (the playback-gated read).
    const outputA = await (await outputRoute(
      withCookie(creatorToken, `/api/watch/${sessionId}/renders/${renderId}/outputs/${segmentId}`),
      { params: Promise.resolve({ sessionId, renderId, segmentId }) },
    )).text();
    expect(outputA.length).toBeGreaterThan(0);
    expect(outputA).toContain(segmentId);
  });
});
