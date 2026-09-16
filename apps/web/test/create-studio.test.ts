import { beforeAll, describe, expect, test } from "bun:test";
import { createDeterministicTestHasher } from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { GET as optionsRoute } from "../src/app/api/create/options/route";
import { POST as rightsPreviewRoute } from "../src/app/api/create/rights-preview/route";
import { POST as createSessionRoute } from "../src/app/api/create/sessions/route";
import { GET as sessionStateRoute } from "../src/app/api/create/sessions/[sessionId]/route";
import { POST as dispatchRoute } from "../src/app/api/create/sessions/[sessionId]/renders/route";
import { GET as jobRoute } from "../src/app/api/create/sessions/[sessionId]/jobs/[jobId]/route";
import { POST as publicationRoute } from "../src/app/api/create/sessions/[sessionId]/publication/route";
import { GET as catalogRoute } from "../src/app/api/catalog/sessions/route";
import { GET as libraryRoute } from "../src/app/api/catalog/library/route";
import { GET as watchRoute } from "../src/app/api/watch/[sessionId]/route";
import {
  GET as outputRoute,
} from "../src/app/api/watch/[sessionId]/renders/[renderId]/outputs/[segmentId]/route";

/**
 * CREATE STUDIO ROUTE TESTS (W906): the /api/create/* handlers driven as
 * real functions over real `Request`s, against a HERMETIC composition —
 * the real control plane WITH its real compute plane (the in-process worker
 * executing REAL render jobs through the REAL renderer plugin + the REAL
 * W504 encode/store), the real identity gate, the real dev seed. Nothing is
 * mocked: creation flows through the identity-attested gate, renders
 * through the real async compute surface, progress through the real ledger.
 */

const NOW_MS = 1_788_888_888_000;
let server: SportaServer;
let creatorToken = "";
let viewerToken = "";
let creatorUserId = "";

beforeAll(async () => {
  server = createSportaServer({
    nowMs: () => NOW_MS,
    passwordHasher: createDeterministicTestHasher(),
    seed: true,
  });
  installSportaServerForTests(server);
  await server.ready;
  const creator = await server.auth.register({
    username: "studio-creator",
    password: "a-real-studio-password",
    roles: ["creator", "viewer"],
  });
  creatorUserId = creator.userId;
  const viewer = await server.auth.register({
    username: "studio-viewer",
    password: "a-real-viewer-password",
  });
  creatorToken = (await server.auth.issueSession({ userId: creator.userId })).token;
  viewerToken = (await server.auth.issueSession({ userId: viewer.userId })).token;
});

function jsonRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`http://sporta.test${path}`, init);
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

/** The full declaration that permits everything (the fixture-like policy). */
const FULL_OPERATIONS = [
  "analysis",
  "transformation",
  "liveDelivery",
  "derivativeGeneration",
  "storage",
  "sharing",
];

/** Creates one studio session as the creator (the happy-path helper). */
async function createStudioSession(operations: string[] = FULL_OPERATIONS): Promise<string> {
  const response = await createSessionRoute(
    withCookie(
      creatorToken,
      "/api/create/sessions",
      post("/api/create/sessions", { sourceKey: "derby", operations }),
    ),
  );
  expect(response.status).toBe(201);
  const body = (await bodyOf(response)) as { sessionId: string };
  return body.sessionId;
}

/** Polls the job route until terminal (bounded — never a silent hang). */
async function pollToTerminal(
  sessionId: string,
  jobId: string,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await jobRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}/jobs/${jobId}`),
      { params: Promise.resolve({ sessionId, jobId }) },
    );
    expect(response.status).toBe(200);
    const job = await bodyOf(response);
    const state = job.state as string;
    if (
      state === "succeeded" ||
      state === "failed" ||
      state === "cancelled" ||
      state === "dead-lettered"
    ) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`job ${jobId} never reached a terminal state`);
}

// ---------------------------------------------------------------------------
// GET /api/create/options
// ---------------------------------------------------------------------------

describe("GET /api/create/options", () => {
  test("anonymous callers receive the uniform 401 (no studio without identity)", async () => {
    const response = await optionsRoute(jsonRequest("/api/create/options"));
    expect(response.status).toBe(401);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ failureClass: "unauthenticated" });
  });

  test("an invalid session token is still the uniform 401", async () => {
    const response = await optionsRoute(
      withCookie("not-a-real-token", "/api/create/options"),
    );
    expect(response.status).toBe(401);
  });

  test("lists the real fixture sources with their real inputs", async () => {
    const response = await optionsRoute(
      withCookie(creatorToken, "/api/create/options"),
    );
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      sources: {
        key: string;
        camera: { pan: number };
        commentary: { text: string }[];
        lexicon: { players: string[] };
      }[];
    };
    expect(body.sources.map((source) => source.key).sort()).toEqual([
      "derby",
      "friendly",
      "training",
    ]);
    const derby = body.sources.find((source) => source.key === "derby")!;
    expect(derby.camera.pan).toBe(0.5);
    expect(derby.commentary.length).toBe(3);
    expect(derby.commentary[0]!.text).toContain("kick off");
    expect(derby.lexicon.players).toContain("Salah");
  });

  test("lists the real renderers with the honest artifact-handoff answer", async () => {
    const response = await optionsRoute(
      withCookie(viewerToken, "/api/create/options"),
    );
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      renderers: {
        rendererId: string;
        supportedOutputProfiles: unknown[];
        artifactHandoff: { supported: boolean; reason: string };
      }[];
      compute: { provider: string; adapterId: string } | null;
    };
    expect(body.renderers.map((renderer) => renderer.rendererId).sort()).toEqual([
      "anime.prototype",
      "sporta.testcard",
    ]);
    const anime = body.renderers.find((r) => r.rendererId === "anime.prototype")!;
    const testcard = body.renderers.find((r) => r.rendererId === "sporta.testcard")!;
    expect(anime.artifactHandoff.supported).toBe(true);
    expect(testcard.artifactHandoff.supported).toBe(false);
    expect(testcard.artifactHandoff.reason).toContain("W502 detailed render surface");
    expect(testcard.supportedOutputProfiles.length).toBeGreaterThan(0);
  });

  test("says upload is unavailable honestly (never a fake upload)", async () => {
    const response = await optionsRoute(
      withCookie(creatorToken, "/api/create/options"),
    );
    const body = (await bodyOf(response)) as { upload: { available: boolean; reason: string } };
    expect(body.upload.available).toBe(false);
    expect(body.upload.reason).toContain("not available yet");
  });

  test("reports the real compute plane (in-process adapter, real id)", async () => {
    const response = await optionsRoute(
      withCookie(creatorToken, "/api/create/options"),
    );
    const body = (await bodyOf(response)) as { compute: { provider: string; adapterId: string } | null };
    expect(body.compute).not.toBeNull();
    expect(body.compute!.provider).toBe("in-process");
    expect(body.compute!.adapterId.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/create/rights-preview (semantics from the contracts only)
// ---------------------------------------------------------------------------

describe("POST /api/create/rights-preview", () => {
  test("derives every capability for the full declaration", async () => {
    const response = await rightsPreviewRoute(
      jsonRequest("/api/create/rights-preview", post("/api/create/rights-preview", { operations: FULL_OPERATIONS })),
    );
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      capabilities: Record<string, boolean>;
      sessionCreation: { allowed: boolean };
    };
    expect(body.capabilities).toEqual({
      canReferenceSourceFrames: true,
      canDeliverLive: true,
      canStoreDerivatives: true,
      canShare: true,
    });
    expect(body.sessionCreation.allowed).toBe(true);
  });

  test("transformation alone derives source-frame reference only", async () => {
    const response = await rightsPreviewRoute(
      jsonRequest("/api/create/rights-preview", post("/api/create/rights-preview", { operations: ["transformation"] })),
    );
    const body = (await bodyOf(response)) as { capabilities: Record<string, boolean> };
    expect(body.capabilities).toEqual({
      canReferenceSourceFrames: true,
      canDeliverLive: false,
      canStoreDerivatives: false,
      canShare: false,
    });
  });

  test("derivative generation without storage cannot store (honest playback denial)", async () => {
    const response = await rightsPreviewRoute(
      jsonRequest(
        "/api/create/rights-preview",
        post("/api/create/rights-preview", { operations: ["transformation", "derivativeGeneration"] }),
      ),
    );
    const body = (await bodyOf(response)) as { capabilities: Record<string, boolean> };
    expect(body.capabilities.canStoreDerivatives).toBe(false);
    expect(body.capabilities.canReferenceSourceFrames).toBe(true);
  });

  test("an expired declaration denies everything (fail-closed)", async () => {
    const response = await rightsPreviewRoute(
      jsonRequest(
        "/api/create/rights-preview",
        post("/api/create/rights-preview", {
          operations: FULL_OPERATIONS,
          expiresAtIso: new Date(NOW_MS - 1_000).toISOString(),
        }),
      ),
    );
    const body = (await bodyOf(response)) as {
      capabilities: Record<string, boolean>;
      sessionCreation: { allowed: boolean; reason: string };
    };
    expect(body.capabilities).toEqual({
      canReferenceSourceFrames: false,
      canDeliverLive: false,
      canStoreDerivatives: false,
      canShare: false,
    });
    expect(body.sessionCreation.allowed).toBe(false);
    expect(body.sessionCreation.reason).toContain("expired");
  });

  test("an unknown operation id is a 400 validation error", async () => {
    const response = await rightsPreviewRoute(
      jsonRequest("/api/create/rights-preview", post("/api/create/rights-preview", { operations: ["teleportation"] })),
    );
    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ failureClass: "validation" });
  });

  test("an empty declaration is a 400 (a policy must assert something)", async () => {
    const response = await rightsPreviewRoute(
      jsonRequest("/api/create/rights-preview", post("/api/create/rights-preview", { operations: [] })),
    );
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/create/sessions (the identity-attested control-gate path)
// ---------------------------------------------------------------------------

describe("POST /api/create/sessions", () => {
  test("anonymous callers receive 401", async () => {
    const response = await createSessionRoute(
      jsonRequest("/api/create/sessions", post("/api/create/sessions", { sourceKey: "derby", operations: FULL_OPERATIONS })),
    );
    expect(response.status).toBe(401);
  });

  test("an account without a creation grant is denied 403", async () => {
    const response = await createSessionRoute(
      withCookie(
        viewerToken,
        "/api/create/sessions",
        post("/api/create/sessions", { sourceKey: "derby", operations: FULL_OPERATIONS }),
      ),
    );
    expect(response.status).toBe(403);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ failureClass: "permission-denied" });
  });

  test("a creator creates a real private session from a real fixture", async () => {
    const response = await createSessionRoute(
      withCookie(
        creatorToken,
        "/api/create/sessions",
        post("/api/create/sessions", { sourceKey: "derby", operations: FULL_OPERATIONS, label: "My derby reality" }),
      ),
    );
    expect(response.status).toBe(201);
    const body = (await bodyOf(response)) as {
      sessionId: string;
      visibility: string;
      story: { eventCount: number; waveCount: number };
      rightsCapabilities: Record<string, boolean>;
      source: { key: string };
    };
    expect(body.sessionId).toMatch(/^sess-/);
    expect(body.visibility).toBe("private");
    expect(body.source.key).toBe("derby");
    expect(body.rightsCapabilities.canStoreDerivatives).toBe(true);
    // The REAL chain ran: events were extracted from the fixture transcript.
    expect(body.story.eventCount).toBeGreaterThan(0);
    expect(body.story.waveCount).toBe(6);
    // Ownership is recorded to the VERIFIED creator.
    expect(await server.ownership.ownerIdOf(body.sessionId)).toBe(creatorUserId);
  });

  test("a declaration that derives nothing is denied by the control plane (403)", async () => {
    const response = await createSessionRoute(
      withCookie(
        creatorToken,
        "/api/create/sessions",
        post("/api/create/sessions", { sourceKey: "derby", operations: ["analysis"] }),
      ),
    );
    expect(response.status).toBe(403);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ failureClass: "rights-denied" });
  });

  test("an unknown source key is a 400", async () => {
    const response = await createSessionRoute(
      withCookie(
        creatorToken,
        "/api/create/sessions",
        post("/api/create/sessions", { sourceKey: "made-up", operations: FULL_OPERATIONS }),
      ),
    );
    expect(response.status).toBe(400);
  });

  test("the created session is private: absent from the catalog, present in the owner's library", async () => {
    const sessionId = await createStudioSession();
    const catalog = (await bodyOf(await catalogRoute(jsonRequest("/api/catalog/sessions")))) as {
      sessions: { sessionId: string }[];
    };
    expect(catalog.sessions.find((entry) => entry.sessionId === sessionId)).toBeUndefined();
    const library = (await bodyOf(
      await libraryRoute(withCookie(creatorToken, "/api/catalog/library")),
    )) as { sessions: { sessionId: string }[] };
    expect(library.sessions.find((entry) => entry.sessionId === sessionId)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/create/sessions/[sessionId]/renders (the async compute surface)
// ---------------------------------------------------------------------------

describe("POST /api/create/sessions/[sessionId]/renders", () => {
  test("anonymous callers receive 401", async () => {
    const sessionId = await createStudioSession();
    const response = await dispatchRoute(
      jsonRequest(`/api/create/sessions/${sessionId}/renders`, post(`/api/create/sessions/${sessionId}/renders`, { rendererId: "anime.prototype" })),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(response.status).toBe(401);
  });

  test("a non-owner is denied 403 (the identity resource rule)", async () => {
    const sessionId = await createStudioSession();
    const response = await dispatchRoute(
      withCookie(
        viewerToken,
        `/api/create/sessions/${sessionId}/renders`,
        post(`/api/create/sessions/${sessionId}/renders`, { rendererId: "anime.prototype" }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(response.status).toBe(403);
    const body = await bodyOf(response);
    expect(body.error).toMatchObject({ failureClass: "permission-denied" });
  });

  test("an unknown session answers 404 without creating anything", async () => {
    const response = await dispatchRoute(
      withCookie(
        creatorToken,
        "/api/create/sessions/ms-does-not-exist/renders",
        post("/api/create/sessions/ms-does-not-exist/renders", { rendererId: "anime.prototype" }),
      ),
      { params: Promise.resolve({ sessionId: "ms-does-not-exist" }) },
    );
    expect(response.status).toBe(404);
  });

  test("dispatching an anime render runs a REAL job to a stored, playable output", async () => {
    const sessionId = await createStudioSession();
    const response = await dispatchRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/renders`,
        post(`/api/create/sessions/${sessionId}/renders`, {
          rendererId: "anime.prototype",
          styleId: "studio-test",
        }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(response.status).toBe(202);
    const dispatch = (await bodyOf(response)) as {
      disposition: string;
      jobId: string;
      adapterId: string;
      jobState: string;
    };
    expect(dispatch.disposition).toBe("admitted");
    expect(dispatch.jobId).toMatch(/^render-job-/);
    expect(dispatch.adapterId.length).toBeGreaterThan(0);
    expect(typeof dispatch.jobState).toBe("string");

    // Poll to terminal: the REAL ledger states, never-silent accounting.
    const job = (await pollToTerminal(sessionId, dispatch.jobId)) as {
      state: string;
      renderId?: string;
      ingest: { status: string };
      completion: {
        status: string;
        outputs: { contentType: string; byteLength: number; frameCount?: number }[];
        accounting: { consumedInputIds: string[]; unconsumedInputs: unknown[] };
        usage: { unitId: string; quantity: number }[];
        timing: { executionMs: number };
      };
    };
    expect(job.state).toBe("succeeded");
    expect(job.renderId).toMatch(/^r-/);
    expect(job.ingest.status).toBe("stored");
    expect(job.completion.outputs.length).toBeGreaterThan(0);
    expect(job.completion.outputs[0]!.contentType).toBe("image/svg+xml");
    expect(job.completion.outputs[0]!.byteLength).toBeGreaterThan(0);
    expect(job.completion.outputs[0]!.frameCount!).toBeGreaterThan(0);
    expect(job.completion.accounting.consumedInputIds).toContain("swm-snapshot");
    expect(job.completion.accounting.consumedInputIds).toContain("swm-events");
    expect(job.completion.accounting.unconsumedInputs).toEqual([]);
    expect(job.completion.usage.length).toBeGreaterThan(0);
    expect(job.completion.usage[0]!.quantity).toBeGreaterThan(0);
    expect(job.completion.timing.executionMs).toBeGreaterThanOrEqual(0);

    // The stored output is REALLY readable through the playback gate.
    const watch = (await bodyOf(
      await watchRoute(withCookie(creatorToken, `/api/watch/${sessionId}`), {
        params: Promise.resolve({ sessionId }),
      }),
    )) as {
      renders: { renderId: string; outputs: { segmentId: string }[] }[] | null;
    };
    expect(watch.renders).not.toBeNull();
    const render = watch.renders!.find((entry) => entry.renderId === job.renderId)!;
    expect(render.outputs.length).toBeGreaterThan(0);
    const outputResponse = await outputRoute(
      withCookie(
        creatorToken,
        `/api/watch/${sessionId}/renders/${render.renderId}/outputs/${render.outputs[0]!.segmentId}`,
      ),
      {
        params: Promise.resolve({
          sessionId,
          renderId: render.renderId,
          segmentId: render.outputs[0]!.segmentId,
        }),
      },
    );
    expect(outputResponse.status).toBe(200);
    const output = (await bodyOf(outputResponse)) as {
      contentType: string;
      content: string;
      manifest: { frameCount: number };
    };
    expect(output.contentType).toBe("image/svg+xml");
    expect(output.content).toContain("<svg");
    expect(output.manifest.frameCount).toBeGreaterThan(0);
  });

  test("dispatching the testcard renderer through the compute path fails honestly", async () => {
    const sessionId = await createStudioSession();
    const response = await dispatchRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/renders`,
        post(`/api/create/sessions/${sessionId}/renders`, { rendererId: "sporta.testcard" }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(response.status).toBe(202);
    const dispatch = (await bodyOf(response)) as { jobId: string };
    const job = (await pollToTerminal(sessionId, dispatch.jobId)) as {
      state: string;
      completion: { status: string; failure?: { errorClass: string } };
    };
    // The REAL semantics: no W502 detailed surface → no artifact handoff.
    expect(job.state).toBe("failed");
    expect(job.completion.status).toBe("failed");
    expect(job.completion.failure!.errorClass).toBe("renderer-not-encodable");
  });

  test("the job route is session-scoped (another session's job id answers 404)", async () => {
    const sessionId = await createStudioSession();
    const other = await createStudioSession();
    const response = await dispatchRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/renders`,
        post(`/api/create/sessions/${sessionId}/renders`, { rendererId: "anime.prototype" }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    const dispatch = (await bodyOf(response)) as { jobId: string };
    const crossResponse = await jobRoute(
      withCookie(creatorToken, `/api/create/sessions/${other}/jobs/${dispatch.jobId}`),
      { params: Promise.resolve({ sessionId: other, jobId: dispatch.jobId }) },
    );
    expect(crossResponse.status).toBe(404);
    expect((await bodyOf(crossResponse)).error).toMatchObject({
      failureClass: "unknown-compute-job",
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/create/sessions/[sessionId] (the studio session state)
// ---------------------------------------------------------------------------

describe("GET /api/create/sessions/[sessionId]", () => {
  test("the owner sees the real state incl. jobs and visibility", async () => {
    const sessionId = await createStudioSession();
    const dispatchResponse = await dispatchRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/renders`,
        post(`/api/create/sessions/${sessionId}/renders`, { rendererId: "anime.prototype" }),
      ),
    );
    const dispatch = (await bodyOf(dispatchResponse)) as { jobId: string };
    await pollToTerminal(sessionId, dispatch.jobId);

    const response = await sessionStateRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}`),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(response.status).toBe(200);
    const state = (await bodyOf(response)) as {
      visibility: string;
      jobs: { jobId: string }[];
      renders: { rendererId: string; hasStoredOutputs: boolean }[];
      rightsCapabilities: Record<string, boolean>;
    };
    expect(state.visibility).toBe("private");
    expect(state.jobs.map((job) => job.jobId)).toContain(dispatch.jobId);
    expect(state.renders.length).toBeGreaterThan(0);
    expect(state.renders.some((render) => render.rendererId === "anime.prototype")).toBe(true);
    expect(state.renders.every((render) => render.hasStoredOutputs)).toBe(true);
    expect(state.rightsCapabilities.canStoreDerivatives).toBe(true);
  });

  test("a non-owner is denied 403; an anonymous caller 401", async () => {
    const sessionId = await createStudioSession();
    const viewerResponse = await sessionStateRoute(
      withCookie(viewerToken, `/api/create/sessions/${sessionId}`),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(viewerResponse.status).toBe(403);
    const anonymousResponse = await sessionStateRoute(
      jsonRequest(`/api/create/sessions/${sessionId}`),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(anonymousResponse.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/create/sessions/[sessionId]/publication (the visibility flag)
// ---------------------------------------------------------------------------

describe("POST /api/create/sessions/[sessionId]/publication", () => {
  test("publishing puts the session in the public catalog and opens watching", async () => {
    const sessionId = await createStudioSession();
    // Before: private — no catalog entry, anonymous watch answers the
    // uniform unknown-session 404 (no existence oracle).
    const beforeCatalog = (await bodyOf(await catalogRoute(jsonRequest("/api/catalog/sessions")))) as {
      sessions: { sessionId: string }[];
    };
    expect(beforeCatalog.sessions.find((entry) => entry.sessionId === sessionId)).toBeUndefined();
    const beforeWatch = await watchRoute(jsonRequest(`/api/watch/${sessionId}`), {
      params: Promise.resolve({ sessionId }),
    });
    expect(beforeWatch.status).toBe(404);
    const ownerWatch = await watchRoute(withCookie(creatorToken, `/api/watch/${sessionId}`), {
      params: Promise.resolve({ sessionId }),
    });
    expect(ownerWatch.status).toBe(200);

    // Publish.
    const publishResponse = await publicationRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/publication`,
        post(`/api/create/sessions/${sessionId}/publication`, { visibility: "public" }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(publishResponse.status).toBe(200);
    expect(((await bodyOf(publishResponse)) as { visibility: string }).visibility).toBe("public");

    // After: catalog entry + anonymous watch allowed.
    const afterCatalog = (await bodyOf(await catalogRoute(jsonRequest("/api/catalog/sessions")))) as {
      sessions: { sessionId: string }[];
    };
    expect(afterCatalog.sessions.find((entry) => entry.sessionId === sessionId)).toBeDefined();
    const afterWatch = await watchRoute(jsonRequest(`/api/watch/${sessionId}`), {
      params: Promise.resolve({ sessionId }),
    });
    expect(afterWatch.status).toBe(200);
  });

  test("privatizing removes it again (the effect is real and reversible)", async () => {
    const sessionId = await createStudioSession();
    await publicationRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/publication`,
        post(`/api/create/sessions/${sessionId}/publication`, { visibility: "public" }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    const privatizeResponse = await publicationRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/publication`,
        post(`/api/create/sessions/${sessionId}/publication`, { visibility: "private" }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(privatizeResponse.status).toBe(200);
    const catalog = (await bodyOf(await catalogRoute(jsonRequest("/api/catalog/sessions")))) as {
      sessions: { sessionId: string }[];
    };
    expect(catalog.sessions.find((entry) => entry.sessionId === sessionId)).toBeUndefined();
    const anonymousWatch = await watchRoute(jsonRequest(`/api/watch/${sessionId}`), {
      params: Promise.resolve({ sessionId }),
    });
    expect(anonymousWatch.status).toBe(404);
  });

  test("a non-owner cannot publish (403) and invalid values are 400", async () => {
    const sessionId = await createStudioSession();
    const nonOwnerResponse = await publicationRoute(
      withCookie(
        viewerToken,
        `/api/create/sessions/${sessionId}/publication`,
        post(`/api/create/sessions/${sessionId}/publication`, { visibility: "public" }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(nonOwnerResponse.status).toBe(403);
    const invalidResponse = await publicationRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/publication`,
        post(`/api/create/sessions/${sessionId}/publication`, { visibility: "everyone" }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(invalidResponse.status).toBe(400);
    const body = await bodyOf(invalidResponse);
    expect(body.error).toMatchObject({ failureClass: "validation" });
  });

  test("publication on an unknown session answers 404 for the owner too", async () => {
    const response = await publicationRoute(
      withCookie(
        creatorToken,
        "/api/create/sessions/ms-does-not-exist/publication",
        post("/api/create/sessions/ms-does-not-exist/publication", { visibility: "public" }),
      ),
      { params: Promise.resolve({ sessionId: "ms-does-not-exist" }) },
    );
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// The private-session playback gate on the WATCH surface
// ---------------------------------------------------------------------------

describe("the private-session watch gate", () => {
  test("a private session is watchable by its owner, invisible to a signed-in non-owner", async () => {
    const sessionId = await createStudioSession();
    const owner = await watchRoute(withCookie(creatorToken, `/api/watch/${sessionId}`), {
      params: Promise.resolve({ sessionId }),
    });
    expect(owner.status).toBe(200);
    const otherViewer = await watchRoute(withCookie(viewerToken, `/api/watch/${sessionId}`), {
      params: Promise.resolve({ sessionId }),
    });
    expect(otherViewer.status).toBe(404);
    // The denial is byte-identical to the unknown-session answer.
    const unknown = await watchRoute(jsonRequest(`/api/watch/${sessionId}`), {
      params: Promise.resolve({ sessionId }),
    });
    expect(unknown.status).toBe(404);
    const otherBody = await bodyOf(otherViewer);
    const unknownBody = await bodyOf(unknown);
    expect(otherBody).toEqual(unknownBody);
  });
});
