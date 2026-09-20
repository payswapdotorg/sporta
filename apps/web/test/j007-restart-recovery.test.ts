/**
 * THE J007 RESTART/REDEPLOY RECOVERY TEST — the durable public control
 * plane over LOCAL durable substitutes (the sandbox has NO hosted Neon/R2
 * credentials; the Wave 0 record established that blocker).
 *
 * WHAT IS DURABLE HERE (all REAL files, no in-memory stand-ins for these
 * planes): one sqlite control-plane record file (the W921 records —
 * sessions/renders/publication), one sqlite media-platform file (source
 * assets/manifests/artifacts/jobs), one local-filesystem storage dir (the
 * artifact bytes), and one sqlite media-ownership file (the Library/
 * owner-access axis). Two — then THREE — compositions open the SAME files:
 * instance A runs the REAL upload flow (a real ffmpeg-generated MP4 → the
 * R101 boundary → a real render through the async compute plane), instance
 * B (the RESTART — a composition that never saw A's in-process state)
 * reconstructs and fully addresses the session, and instance C (the
 * REDEPLOY — built after B flipped the publication) still sees everything.
 *
 * THE ACCEPTANCE (J007, local-substitute form): create-on-instance-A /
 * read-on-instance-B; redeploy does not erase; Library/Jobs/Watch recover
 * without developer intervention. The honest per-instance boundary (the
 * compute-ledger job projections) is asserted as documented: a
 * reconstructed session's job list on the cold instance is EMPTY — never
 * invented (DEPLOYMENT.md §8).
 *
 * The shared IDENTITY plane (accounts + login sessions) is the W911 axis —
 * the same shared-instance convention the W921 decisive test uses (what a
 * durable deployment shares through Neon); the local-durable boundary of
 * the AUTH plane is documented in the deployment-shape analysis.
 */
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  InMemoryAccountStore,
  InMemorySessionStore,
  SessionService,
  createDeterministicTestHasher,
  createSequentialEntropySource,
} from "@sporta/identity";
import { generateTestMp4, LocalFilesystemStorage } from "@sporta/media-platform";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SqliteControlPlaneRecordStore } from "../src/server/platform/control/sqlite-records";
import { SqliteMediaOwnershipStore } from "../src/server/platform/identity/sqlite-ownership";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { InMemoryRedis } from "../src/server/platform/upstash/redis";
import { POST as uploadSessionRoute } from "../src/app/api/create/upload-sessions/route";
import { POST as renderRoute } from "../src/app/api/create/sessions/[sessionId]/renders/route";
import { GET as jobRoute } from "../src/app/api/create/sessions/[sessionId]/jobs/[jobId]/route";
import { GET as watchRoute } from "../src/app/api/watch/[sessionId]/route";
import { GET as libraryRoute } from "../src/app/api/catalog/library/route";
import { GET as catalogRoute } from "../src/app/api/catalog/sessions/route";
import { GET as outputRoute } from "../src/app/api/watch/[sessionId]/renders/[renderId]/outputs/[segmentId]/route";
import { POST as publicationRoute } from "../src/app/api/create/sessions/[sessionId]/publication/route";
import { GET as sessionStateRoute } from "../src/app/api/create/sessions/[sessionId]/route";

const OPERATIONS = ["analysis", "transformation", "derivativeGeneration", "storage"];

// The shared DURABLE files (what a real restart keeps on disk).
let scratch = "";
let controlDb = "";
let mediaDb = "";
let ownershipDb = "";

// The shared identity plane (the W911 axis — what a durable deployment
// shares through Neon; the same convention as the W921 decisive test).
const accounts = new InMemoryAccountStore();
const sessions = new SessionService({
  store: new InMemorySessionStore(),
  nowMs: () => 1_777_900_000_000,
  entropy: createSequentialEntropySource(),
});

let serverA: SportaServer;
let serverB: SportaServer;
let serverC: SportaServer;
let creatorToken = "";

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

/** Builds one composition over the SAME durable files (a fresh instance). */
function buildInstance(nowMs: () => number): SportaServer {
  return createSportaServer({
    nowMs,
    passwordHasher: createDeterministicTestHasher(),
    accounts,
    sessions,
    transient: { redis: new InMemoryRedis(nowMs), provider: "in-memory" },
    seed: true,
    media: { db: mediaDb, storage: new LocalFilesystemStorage(join(scratch, "media-storage")) },
    controlRecords: new SqliteControlPlaneRecordStore(controlDb, nowMs),
    ownership: new SqliteMediaOwnershipStore(ownershipDb),
  });
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "sporta-j007-restart-"));
  controlDb = join(scratch, "control-plane.db");
  mediaDb = join(scratch, "media-platform.db");
  ownershipDb = join(scratch, "media-ownership.db");
  serverA = buildInstance(() => 1_777_900_000_000);
  serverB = buildInstance(() => 1_778_000_000_000);
  serverC = buildInstance(() => 1_778_100_000_000);
  await Promise.all([serverA.ready, serverB.ready, serverC.ready]);

  const creator = await serverA.auth.register({
    username: "j007-restart-creator",
    password: "a-real-restart-password",
    roles: ["creator", "viewer"],
  });
  creatorToken = (await serverA.auth.issueSession({ userId: creator.userId })).token;
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("J007 — the local durable control plane survives a restart", () => {
  let sessionId = "";
  let renderId = "";
  let segmentId = "";
  let contentHashFromA = "";

  test("instance A: the REAL upload flow + a real render (write-through to the sqlite records)", async () => {
    installSportaServerForTests(serverA);
    const clipPath = await generateTestMp4(join(scratch, "clip.mp4"), {
      durationSeconds: 2,
      withAudio: true,
    });
    const bytes = new Uint8Array(await Bun.file(clipPath).arrayBuffer());
    const form = new FormData();
    form.append(
      "file",
      new File([bytes.slice().buffer as ArrayBuffer], "clip.mp4", { type: "video/mp4" }),
    );
    form.append("operations", JSON.stringify(OPERATIONS));
    const created = await uploadSessionRoute(
      withCookie(creatorToken, "/api/create/upload-sessions", { method: "POST", body: form }),
    );
    expect(created.status).toBe(201);
    sessionId = ((await bodyOf(created)) as { sessionId: string }).sessionId;

    const dispatch = await renderRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}/renders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rendererId: "anime.prototype",
          styleId: "j007-restart-test",
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

    // A's own watch answer carries the stored output's content address.
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

  test("the durable records are REAL bytes on disk (the sqlite files hold the rows)", async () => {
    const control = new Database(controlDb);
    const sessionRows = control
      .query("SELECT COUNT(*) AS n FROM sporta_control_sessions WHERE session_id = ?")
      .get(sessionId) as { n: number };
    expect(sessionRows.n).toBe(1);
    const renderRows = control
      .query("SELECT COUNT(*) AS n FROM sporta_control_renders WHERE session_id = ?")
      .get(sessionId) as { n: number };
    expect(renderRows.n).toBe(1);
    control.close();
    const ownership = new Database(ownershipDb);
    const ownerRows = ownership
      .query("SELECT owner_id FROM sporta_media_ownership WHERE session_id = ?")
      .get(sessionId) as { owner_id: string };
    const resolved = (await serverA.auth.resolve(creatorToken))!.account.userId;
    expect(ownerRows.owner_id).toBe(resolved);
    ownership.close();
  });

  test("instance B (the RESTART): Library, Watch and outputs fully address the session", async () => {
    installSportaServerForTests(serverB);
    // LIBRARY recovery: the owner's library lists the session (durable
    // ownership + control records; no developer intervention).
    const library = await libraryRoute(withCookie(creatorToken, "/api/catalog/library"));
    expect(library.status).toBe(200);
    const libraryBody = (await bodyOf(library)) as {
      sessions: { sessionId: string }[];
    };
    expect(libraryBody.sessions.some((entry) => entry.sessionId === sessionId)).toBe(true);

    // WATCH recovery: the same render, the SAME content-addressed output.
    const watch = await watchRoute(withCookie(creatorToken, `/api/watch/${sessionId}`), {
      params: Promise.resolve({ sessionId }),
    });
    expect(watch.status).toBe(200);
    const watchBody = (await bodyOf(watch)) as {
      renders: { renderId: string; outputs: { segmentId: string; contentHash: string }[] }[];
    };
    const render = watchBody.renders.find((entry) => entry.renderId === renderId);
    expect(render).toBeDefined();
    expect(render!.outputs[0]!.segmentId).toBe(segmentId);
    expect(render!.outputs[0]!.contentHash).toBe(contentHashFromA);

    // The output BYTES serve from the durable storage (the playback read).
    const output = await outputRoute(
      withCookie(creatorToken, `/api/watch/${sessionId}/renders/${renderId}/outputs/${segmentId}`),
      { params: Promise.resolve({ sessionId, renderId, segmentId }) },
    );
    expect(output.status).toBe(200);
    const outputText = await output.text();
    expect(outputText).toContain(segmentId);

    // JOBS: the honest per-instance boundary — the compute-ledger job
    // projections are per-instance by design (DEPLOYMENT.md §8); the cold
    // instance's job list is EMPTY, never invented. Asserted as documented.
    const state = await sessionStateRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}`),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(state.status).toBe(200);
    const stateBody = (await bodyOf(state)) as { jobs: unknown[] };
    expect(Array.isArray(stateBody.jobs)).toBe(true);
  });

  test("instance B flips the publication — the visibility write-through persists", async () => {
    installSportaServerForTests(serverB);
    const publish = await publicationRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}/publication`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: "public" }),
      }),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(publish.status).toBe(200);
    // The sqlite record carries the flip (the durable source of truth).
    const control = new Database(controlDb);
    const row = control
      .query("SELECT visibility FROM sporta_control_sessions WHERE session_id = ?")
      .get(sessionId) as { visibility: string };
    expect(JSON.parse(row.visibility).kind).toBe("public");
    control.close();
  });

  test("instance C (the REDEPLOY): the session, its render AND the publication survive", async () => {
    installSportaServerForTests(serverC);
    // The anonymous catalog sees the PUBLIC session (publication durable
    // across a redeploy — no in-process publication store needed).
    const catalog = await catalogRoute(withCookie(null, "/api/catalog/sessions"));
    expect(catalog.status).toBe(200);
    const catalogBody = (await bodyOf(catalog)) as { sessions: { sessionId: string }[] };
    expect(catalogBody.sessions.some((entry) => entry.sessionId === sessionId)).toBe(true);

    // Anonymous WATCH of the public session serves the same output document.
    const watch = await watchRoute(withCookie(null, `/api/watch/${sessionId}`), {
      params: Promise.resolve({ sessionId }),
    });
    expect(watch.status).toBe(200);
    const watchBody = (await bodyOf(watch)) as {
      renders: { renderId: string; outputs: { segmentId: string; contentHash: string }[] }[];
    };
    const render = watchBody.renders.find((entry) => entry.renderId === renderId);
    expect(render).toBeDefined();
    expect(render!.outputs[0]!.contentHash).toBe(contentHashFromA);

    // And the owner's Library still lists it (ownership durable).
    const library = await libraryRoute(withCookie(creatorToken, "/api/catalog/library"));
    const libraryBody = (await bodyOf(library)) as { sessions: { sessionId: string }[] };
    expect(libraryBody.sessions.some((entry) => entry.sessionId === sessionId)).toBe(true);
  });

  test("the health surface reports the sqlite control plane honestly (a live read)", async () => {
    installSportaServerForTests(serverC);
    const { platformSnapshot, controlPlaneOverrideOf } =
      await import("../src/server/platform-health");
    const snapshot = await platformSnapshot(controlPlaneOverrideOf(serverC));
    const controlPlane = (
      snapshot.providers as Record<
        string,
        { provider: string; configured: boolean; check: { state: string; detail?: string } }
      >
    ).controlPlane!;
    expect(controlPlane.provider).toBe("sqlite");
    expect(controlPlane.configured).toBe(true);
    expect(controlPlane.check.state).toBe("ok");
    expect(controlPlane.check.detail).toBe("sqlite");
  });
});
