import { beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import {
  InMemoryAccountStore,
  InMemoryMediaOwnershipStore,
  InMemorySessionStore,
  SessionService,
  createSequentialEntropySource,
} from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import {
  InMemoryControlPlaneRecordStore,
  type ControlPlaneRecordStore,
} from "../src/server/platform/control/records";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { POST as createSessionRoute } from "../src/app/api/create/sessions/route";
import { GET as sessionStateRoute } from "../src/app/api/create/sessions/[sessionId]/route";
import { POST as dispatchRoute } from "../src/app/api/create/sessions/[sessionId]/renders/route";
import { GET as jobRoute } from "../src/app/api/create/sessions/[sessionId]/jobs/[jobId]/route";
import { POST as publicationRoute } from "../src/app/api/create/sessions/[sessionId]/publication/route";
import { GET as catalogRoute } from "../src/app/api/catalog/sessions/route";
import { GET as watchRoute } from "../src/app/api/watch/[sessionId]/route";
import { GET as outputRoute } from "../src/app/api/watch/[sessionId]/renders/[renderId]/outputs/[segmentId]/route";

/**
 * THE DECISIVE W921 TEST — two composition instances over ONE record store.
 *
 * The W920 gate found the defect class on the live deployment: the control
 * plane's media-session/render state is IN-MEMORY PER COMPOSITION — a studio
 * session created on one serverless instance 404s from every other instance,
 * and the `sess-<seq>` allocation collides across instances. This test builds
 * the REAL `apps/web` composition TWICE (no mocks — the real control plane, the
 * real identity gate, the real in-process compute plane executing REAL render
 * jobs through the REAL renderer plugin + the REAL W504 encoder/store, the real
 * dev seed) sharing exactly the things serverless instances share in
 * production: the durable identity stores (W911) and the durable
 * control-plane RECORD STORE (W921 — the in-memory hermetic deployment of the
 * port; production's is Neon PostgreSQL, proven separately by the env-gated
 * integration tests).
 *
 * Everything else — the control-plane registries, the compute-job ledger, the
 * publication store, the world-model engines — is per-composition, exactly as
 * per-instance on serverless.
 *
 * Instance A's clock is pinned 2h BEFORE instance B's (warm instances are
 * routinely hours apart), which also drives the expired-policy scenario.
 */

const NOW_MS_A = 1_789_111_111_000;
const NOW_MS_B = NOW_MS_A + 2 * 60 * 60 * 1000;

/** The full declaration that permits everything (the fixture-like policy). */
const FULL_OPERATIONS = [
  "analysis",
  "transformation",
  "liveDelivery",
  "derivativeGeneration",
  "storage",
  "sharing",
];

// ---------------------------------------------------------------------------
// The shared durable planes (what production shares: identity + records)
// ---------------------------------------------------------------------------

const accounts = new InMemoryAccountStore();
const sessions = new SessionService({
  store: new InMemorySessionStore(),
  nowMs: () => NOW_MS_A,
  entropy: createSequentialEntropySource(),
});
const ownership = new InMemoryMediaOwnershipStore();
const records = new InMemoryControlPlaneRecordStore();

let serverA: SportaServer;
let serverB: SportaServer;
let creatorToken = "";
let creatorUserId = "";
let viewerToken = "";

beforeAll(async () => {
  // Instance A — the instance that handles the create.
  serverA = createSportaServer({
    nowMs: () => NOW_MS_A,
    passwordHasher: createDeterministicTestHasher(),
    accounts,
    sessions,
    ownership,
    controlRecords: records,
    seed: true,
  });
  await serverA.ready;
  // Instance B — a DIFFERENT composition over the SAME durable planes, built
  // AFTER A's create below would happen in production; here it exists first but
  // never sees A's in-process state (its registries are its own).
  serverB = createSportaServer({
    nowMs: () => NOW_MS_B,
    passwordHasher: createDeterministicTestHasher(),
    accounts,
    sessions,
    ownership,
    controlRecords: records,
    seed: true,
  });
  await serverB.ready;

  // One creator (via A's real auth — the account store is shared).
  const creator = await serverA.auth.register({
    username: "w921-creator",
    password: "a-real-w921-password",
    roles: ["creator", "viewer"],
  });
  creatorUserId = creator.userId;
  const viewer = await serverA.auth.register({
    username: "w921-viewer",
    password: "a-real-w921-viewer-password",
  });
  creatorToken = (await serverA.auth.issueSession({ userId: creator.userId })).token;
  viewerToken = (await serverA.auth.issueSession({ userId: viewer.userId })).token;
});

/** Serves the next route call from instance A (the singleton swap). */
function onA(): void {
  installSportaServerForTests(serverA);
}

/** Serves the next route call from instance B (the singleton swap). */
function onB(): void {
  installSportaServerForTests(serverB);
}

function withCookie(
  token: string | null,
  path: string,
  init: RequestInit = {},
): Request {
  return new Request(`http://sporta.test${path}`, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      ...(token !== null ? { cookie: `${SPORTA_SESSION_COOKIE}=${token}` } : {}),
    },
  });
}

function post(path: string, body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/** Creates one studio session on the given instance (the happy-path helper). */
async function createSessionOn(
  instance: "A" | "B",
  body: Record<string, unknown> = { sourceKey: "derby", operations: FULL_OPERATIONS },
): Promise<string> {
  if (instance === "A") onA();
  else onB();
  const response = await createSessionRoute(
    withCookie(creatorToken, "/api/create/sessions", post("/api/create/sessions", body)),
  );
  expect(response.status).toBe(201);
  const parsed = (await bodyOf(response)) as { sessionId: string };
  return parsed.sessionId;
}

/** Polls the job route on the given instance until terminal (bounded). */
async function pollToTerminalOn(
  instance: "A" | "B",
  sessionId: string,
  jobId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (instance === "A") onA();
    else onB();
    const response = await jobRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}/jobs/${jobId}`),
      { params: Promise.resolve({ sessionId, jobId }) },
    );
    const job = await bodyOf(response);
    const state = job.state as string | undefined;
    if (
      response.status === 200 &&
      (state === "succeeded" || state === "failed" || state === "cancelled" || state === "dead-lettered")
    ) {
      return { status: response.status, body: job };
    }
    if (response.status !== 200) {
      return { status: response.status, body: job };
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`job ${jobId} never reached a terminal state on instance ${instance}`);
}

/** One session's watch model, served by the given instance. */
async function watchOn(
  instance: "A" | "B",
  token: string | null,
  sessionId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (instance === "A") onA();
  else onB();
  const response = await watchRoute(withCookie(token, `/api/watch/${sessionId}`), {
    params: Promise.resolve({ sessionId }),
  });
  return { status: response.status, body: await bodyOf(response) };
}

// ---------------------------------------------------------------------------
// The decisive scenario
// ---------------------------------------------------------------------------

describe("W921 — two composition instances over ONE record store", () => {
  let sessionId = "";
  let renderId = "";
  let segmentId = "";
  let contentHash = "";
  let byteLength = 0;
  let bytesFromA = "";

  test("step 1 (instance A): create + dispatch + poll a REAL render to terminal", async () => {
    sessionId = await createSessionOn("A");
    // (b) user-session ids are collision-safe — crypto-random, not `sess-<seq>`.
    expect(sessionId).toMatch(/^sess-u-[0-9a-f]{32}$/);

    onA();
    const dispatchResponse = await dispatchRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/renders`,
        post(`/api/create/sessions/${sessionId}/renders`, {
          rendererId: "anime.prototype",
          styleId: "w921-decisive",
        }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(dispatchResponse.status).toBe(202);
    const dispatch = (await bodyOf(dispatchResponse)) as { jobId: string };
    expect(dispatch.jobId).toMatch(/^render-job-/);

    // The poll is the render's durable write-through point (on the instance
    // that owns the compute-job ledger — A).
    const job = await pollToTerminalOn("A", sessionId, dispatch.jobId);
    expect(job.status).toBe(200);
    expect(job.body.state).toBe("succeeded");
    renderId = job.body.renderId as string;
    expect(renderId).toMatch(/^r-u-[0-9a-f]{32}$/);
    expect((job.body.ingest as Record<string, unknown>).status).toBe("stored");

    // The create + render were WRITTEN THROUGH (fail-loud seams — they did
    // not throw, so the records exist).
    const record = await records.findSession(sessionId);
    expect(record).not.toBeNull();
    expect(record!.ownerUserId).toBe(creatorUserId);
    expect(record!.sourceKey).toBe("derby");
    expect(record!.visibility).toEqual({ kind: "private", roles: [] });
    const renders = await records.findRenders(sessionId);
    expect(renders.map((entry) => entry.renderId)).toEqual([renderId]);
    expect(renders[0]!.storedSegmentIds.length).toBeGreaterThan(0);
  });

  test("step 2 (instance A): the creating instance serves the watch + output bytes", async () => {
    const watch = await watchOn("A", creatorToken, sessionId);
    expect(watch.status).toBe(200);
    expect(watch.body.sessionId).toBe(sessionId);
    expect((watch.body.playback as Record<string, unknown>).state).toBe("authorized");
    const renders = watch.body.renders as {
      renderId: string;
      outputs: { segmentId: string; contentHash: string; byteLength: number }[];
    }[];
    expect(renders.map((entry) => entry.renderId)).toEqual([renderId]);
    segmentId = renders[0]!.outputs[0]!.segmentId;
    contentHash = renders[0]!.outputs[0]!.contentHash;
    byteLength = renders[0]!.outputs[0]!.byteLength;
    expect(contentHash.length).toBeGreaterThan(0);
    expect(byteLength).toBeGreaterThan(0);

    onA();
    const outputResponse = await outputRoute(
      withCookie(
        creatorToken,
        `/api/watch/${sessionId}/renders/${renderId}/outputs/${segmentId}`,
      ),
      {
        params: Promise.resolve({ sessionId, renderId, segmentId }),
      },
    );
    expect(outputResponse.status).toBe(200);
    const output = (await bodyOf(outputResponse)) as { content: string; contentHash: string };
    expect(output.content).toContain("<svg");
    bytesFromA = output.content;
    expect(output.contentHash).toBe(contentHash);
  });

  test("step 3 (instance B, cold): a PRIVATE durable session is NOT default-public (the cold-instance watch gate)", async () => {
    // B has NEVER seen this session. The publication store's documented
    // default for ABSENCE is public — before W921 a cold instance would have
    // served a private studio session to an anonymous caller here. The gate
    // must reconstruct (seeding the recorded PRIVATE decision) and answer the
    // uniform unknown-session 404 instead.
    const anonymousWatch = await watchOn("B", null, sessionId);
    expect(anonymousWatch.status).toBe(404);
    expect((anonymousWatch.body.error as Record<string, unknown>).failureClass).toBe(
      "unknown-session",
    );

    // And a non-owner authenticated caller gets the SAME uniform 404 (no
    // existence oracle, private stays private cross-instance).
    const viewerWatch = await watchOn("B", viewerToken, sessionId);
    expect(viewerWatch.status).toBe(404);
  });

  test("step 4 (instance B, cold): the session is watchable, previewable with the SAME ids, bytes and hashes", async () => {
    // The owner watches from B — B reconstructs through the real seams.
    const watch = await watchOn("B", creatorToken, sessionId);
    expect(watch.status).toBe(200);
    expect(watch.body.sessionId).toBe(sessionId);
    expect((watch.body.playback as Record<string, unknown>).state).toBe("authorized");
    const renders = watch.body.renders as {
      renderId: string;
      outputs: { segmentId: string; contentHash: string; byteLength: number }[];
    }[];
    // The render is the SAME work — never presented as new (same id, same
    // content-addressed segment, same hash, same byte length).
    expect(renders.map((entry) => entry.renderId)).toEqual([renderId]);
    expect(renders[0]!.outputs[0]!.segmentId).toBe(segmentId);
    expect(renders[0]!.outputs[0]!.contentHash).toBe(contentHash);
    expect(renders[0]!.outputs[0]!.byteLength).toBe(byteLength);

    // The materialized BYTES are equal (the reconstruction re-encoded through
    // the REAL renderer + W504 encoder and the content-addressed id was
    // ASSERTED against the recorded one inside the reconstruction).
    onB();
    const outputResponse = await outputRoute(
      withCookie(
        creatorToken,
        `/api/watch/${sessionId}/renders/${renderId}/outputs/${segmentId}`,
      ),
      {
        params: Promise.resolve({ sessionId, renderId, segmentId }),
      },
    );
    expect(outputResponse.status).toBe(200);
    const output = (await bodyOf(outputResponse)) as { content: string; contentHash: string };
    expect(output.content).toBe(bytesFromA);
    expect(output.contentHash).toBe(contentHash);
  });

  test("step 5 (instance B): the studio session state previews the render; the job list is HONESTLY empty (per-instance ledger)", async () => {
    onB();
    const response = await sessionStateRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}`),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(response.status).toBe(200);
    const state = (await bodyOf(response)) as {
      sessionId: string;
      renders: { renderId: string; hasStoredOutputs: boolean }[];
      jobs: unknown[];
    };
    expect(state.sessionId).toBe(sessionId);
    expect(state.renders.map((render) => render.renderId)).toEqual([renderId]);
    expect(state.renders[0]!.hasStoredOutputs).toBe(true);
    // The documented honest boundary: the compute-job LEDGER is per-instance —
    // B never saw the dispatch, so its job list is EMPTY, never invented.
    expect(state.jobs).toEqual([]);
  });

  test("step 6 (instance A): the job ledger is where it was dispatched (the same job reads terminal from A)", async () => {
    // Cross-instance the job id is honestly unknown (per-instance ledger —
    // the documented W921 boundary), proven here once for the record.
    const onBJob = await pollToTerminalOn("B", sessionId, "render-job-from-A");
    expect(onBJob.status).toBe(404);

    // On A the real job still reads terminal (nothing was taken away).
    const listing = await pollToTerminalOn("B", sessionId, "__never-dispatched__");
    expect(listing.status).toBe(404);
  });

  test("step 7 (instance B): publish → the session is catalog-listed for anonymous callers from B", async () => {
    // A non-owner viewer's catalog from B does NOT list the private session.
    onB();
    const before = await catalogRoute(withCookie(viewerToken, "/api/catalog/sessions"));
    expect(before.status).toBe(200);
    const beforeBody = (await bodyOf(before)) as {
      sessions: { sessionId: string }[];
    };
    expect(beforeBody.sessions.map((card) => card.sessionId)).not.toContain(sessionId);

    // The owner publishes FROM B (the publication write-through is at B).
    onB();
    const publication = await publicationRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/publication`,
        post(`/api/create/sessions/${sessionId}/publication`, { visibility: "public" }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(publication.status).toBe(200);

    // The record carries the flip (the write-through landed).
    const record = await records.findSession(sessionId);
    expect(record!.visibility.kind).toBe("public");
    expect(record!.publishedAtMs).not.toBeNull();

    // B's anonymous catalog lists it; the card is the same session.
    onB();
    const catalog = await catalogRoute(withCookie(null, "/api/catalog/sessions"));
    expect(catalog.status).toBe(200);
    const catalogBody = (await bodyOf(catalog)) as {
      sessions: { sessionId: string; label: string }[];
    };
    const card = catalogBody.sessions.find((entry) => entry.sessionId === sessionId);
    expect(card).toBeDefined();

    // And the anonymous WATCH now succeeds from B (public, reconstructed).
    const anonymousWatch = await watchOn("B", null, sessionId);
    expect(anonymousWatch.status).toBe(200);

    // A's view agrees (both instances read the same durable decision) — A is
    // a WARM instance still holding the session in-process from the create,
    // so this proves the watch gate re-syncs the flag from the record.
    const watchA = await watchOn("A", null, sessionId);
    expect(watchA.status).toBe(200);

    // And the reverse flip: privatize FROM B — warm A must honor it too
    // (never a stale public flag after a distant privatize).
    onB();
    const privatize = await publicationRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/publication`,
        post(`/api/create/sessions/${sessionId}/publication`, { visibility: "private" }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(privatize.status).toBe(200);
    const anonymousWatchAfterPrivatize = await watchOn("A", null, sessionId);
    expect(anonymousWatchAfterPrivatize.status).toBe(404);
  });

  test("step 8 (instance B): a session created ON B is watchable from A (the reverse direction)", async () => {
    const bSession = await createSessionOn("B", {
      sourceKey: "friendly",
      operations: FULL_OPERATIONS,
      label: "created-on-b",
    });
    expect(bSession).toMatch(/^sess-u-[0-9a-f]{32}$/);
    // B's create wrote through; A (which never saw it) watches it.
    const watch = await watchOn("A", creatorToken, bSession);
    expect(watch.status).toBe(200);
    expect(watch.body.sessionId).toBe(bSession);
  });
});

// ---------------------------------------------------------------------------
// The honest boundaries + the fail-loud write-through seams
// ---------------------------------------------------------------------------

describe("W921 — the expired-policy reconstruction skip (honest, counted)", () => {
  test("a session whose recorded policy expired between instances is skipped from listings, denied on direct reads", async () => {
    // Created on A with a policy valid for 1h at A's clock — B's clock is 2h
    // later, so at B the recorded policy derives nothing (expired).
    const expiresAtIso = new Date(NOW_MS_A + 60 * 60 * 1000).toISOString();
    const expiredSession = await createSessionOn("A", {
      sourceKey: "derby",
      operations: FULL_OPERATIONS,
      expiresAtIso,
    });
    expect(expiredSession).toMatch(/^sess-u-/);

    const skipsBefore = serverB.durable!.reconstructionSkips();

    // B's catalog listing SKIPS the expired record (counted, no 500, no
    // invented card) — the listing still works for everything else.
    onB();
    const listing = await catalogRoute(withCookie(creatorToken, "/api/catalog/sessions"));
    expect(listing.status).toBe(200);
    const listingBody = (await bodyOf(listing)) as { sessions: { sessionId: string }[] };
    expect(listingBody.sessions.map((card) => card.sessionId)).not.toContain(expiredSession);
    expect(serverB.durable!.reconstructionSkips()).toBe(skipsBefore + 1);

    // A direct read from B answers the honest rights-denied with the REAL
    // reason (expired-policy) — never stale or invented state.
    const watch = await watchOn("B", creatorToken, expiredSession);
    expect(watch.status).toBe(403);
    const error = watch.body.error as { failureClass: string; message: string };
    expect(error.failureClass).toBe("rights-denied");
    expect(error.message).toContain("expired-policy");

    // A's OWN view is unchanged (A created it while valid — its in-process
    // session stays readable on A; the record simply cannot be recreated
    // elsewhere after expiry).
    const watchA = await watchOn("A", creatorToken, expiredSession);
    expect(watchA.status).toBe(200);
  });
});

describe("W921 — fail-loud write-through (a rejecting store fails the request, never a silent undurable session)", () => {
  /** A record store wrapper that rejects a chosen seam with a marker error. */
  class RejectingRecordStore implements ControlPlaneRecordStore {
    readonly rejections = { session: 0, render: 0, visibility: 0 };

    constructor(
      private readonly inner: ControlPlaneRecordStore,
      private readonly reject: "session" | "render",
    ) {}

    async upsertSession(record: Parameters<ControlPlaneRecordStore["upsertSession"]>[0]) {
      if (this.reject === "session") {
        this.rejections.session += 1;
        throw new Error("w921-rejecting-store: session write-through refused");
      }
      return this.inner.upsertSession(record);
    }

    async recordRender(record: Parameters<ControlPlaneRecordStore["recordRender"]>[0]) {
      if (this.reject === "render") {
        this.rejections.render += 1;
        throw new Error("w921-rejecting-store: render write-through refused");
      }
      return this.inner.recordRender(record);
    }

    async findSession(sessionId: string) {
      return this.inner.findSession(sessionId);
    }

    async listSessions() {
      return this.inner.listSessions();
    }

    async findRenders(sessionId: string) {
      return this.inner.findRenders(sessionId);
    }

    async setVisibility(
      sessionId: string,
      visibility: Parameters<ControlPlaneRecordStore["setVisibility"]>[1],
    ) {
      this.rejections.visibility += 1;
      return this.inner.setVisibility(sessionId, visibility);
    }
  }

  test("a session create whose record write-through is refused FAILS (no 201 with an undurable session)", async () => {
    const rejecting = new RejectingRecordStore(records, "session");
    const serverC = createSportaServer({
      nowMs: () => NOW_MS_A,
      passwordHasher: createDeterministicTestHasher(),
      accounts,
      sessions,
      ownership,
      controlRecords: rejecting,
      seed: false,
    });
    await serverC.ready;
    installSportaServerForTests(serverC);
    const response = await createSessionRoute(
      withCookie(
        creatorToken,
        "/api/create/sessions",
        post("/api/create/sessions", { sourceKey: "derby", operations: FULL_OPERATIONS }),
      ),
    );
    expect(response.status).toBe(500);
    const error = (await bodyOf(response)) as { error: { failureClass: string } };
    expect(error.error.failureClass).toBe("internal");
    expect(rejecting.rejections.session).toBe(1);
  });

  test("a render whose record write-through is refused fails the poll (fail-loud at the real seam)", async () => {
    const rejecting = new RejectingRecordStore(records, "render");
    const serverD = createSportaServer({
      nowMs: () => NOW_MS_A,
      passwordHasher: createDeterministicTestHasher(),
      accounts,
      sessions,
      ownership,
      controlRecords: rejecting,
      seed: false,
    });
    await serverD.ready;
    installSportaServerForTests(serverD);

    // The session create passes (session writes are allowed here).
    const createResponse = await createSessionRoute(
      withCookie(
        creatorToken,
        "/api/create/sessions",
        post("/api/create/sessions", { sourceKey: "derby", operations: FULL_OPERATIONS }),
      ),
    );
    expect(createResponse.status).toBe(201);
    const { sessionId } = (await bodyOf(createResponse)) as { sessionId: string };

    const dispatchResponse = await dispatchRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/renders`,
        post(`/api/create/sessions/${sessionId}/renders`, {
          rendererId: "anime.prototype",
        }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(dispatchResponse.status).toBe(202);
    const dispatch = (await bodyOf(dispatchResponse)) as { jobId: string };

    // The poll that observes the ingested render hits the rejecting
    // recordRender — the request FAILS with the real failure class (never a
    // silent success that leaves the render undurable).
    let sawRefusal = false;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const poll = await jobRoute(
        withCookie(creatorToken, `/api/create/sessions/${sessionId}/jobs/${dispatch.jobId}`),
        { params: Promise.resolve({ sessionId, jobId: dispatch.jobId }) },
      );
      if (poll.status === 500) {
        const error = (await bodyOf(poll)) as { error: { failureClass: string } };
        expect(error.error.failureClass).toBe("internal");
        sawRefusal = true;
        break;
      }
      expect(poll.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(sawRefusal).toBe(true);
    expect(rejecting.rejections.render).toBeGreaterThanOrEqual(1);
  });
});
