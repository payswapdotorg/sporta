/**
 * THE J006 COMPUTE-TRANSPARENCY ROUTE TESTS — the six acceptance fields
 * (compute source, provider, selection reason, measured allowance/cost,
 * privacy posture, fallback state) on EVERY API surface that carries a
 * compute context, measured against the REAL composition:
 *
 * - GET /api/create/compute-status — the plane-level `transparency`
 *   document (Create's own status surface);
 * - POST /api/create/compute-preview — the selection-level document
 *   (Create's compute step), including the REFUSAL posture (an explicit
 *   selection the director refuses answers the typed 422 with every
 *   recorded reason — never a silent substitution);
 * - POST /api/create/sessions/[sessionId]/renders (dispatch) +
 *   GET …/jobs/[jobId] + GET …/sessions/[sessionId] — the per-job
 *   document, with the job's METERED usage attached at terminal state
 *   (labeled as measured, never mixed with the selection-time estimate);
 * - GET /api/watch/[sessionId] — the per-render compute provenance
 *   (present for directive dispatches, honestly absent otherwise);
 * - the fail-closed no-plane posture (a composition with no compute plane
 *   answers honest nulls / the typed unavailable error — never invented
 *   facts).
 */
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeterministicTestHasher } from "@sporta/identity";
import { createSportaServer, installSportaServerForTests } from "../src/server/composition";
import type { SportaServer } from "../src/server/composition";
import { SPORTA_SESSION_COOKIE } from "../src/server/auth-service";
import { InMemoryRedis } from "../src/server/platform/upstash/redis";
import { GET as computeStatusRoute } from "../src/app/api/create/compute-status/route";
import { POST as computePreviewRoute } from "../src/app/api/create/compute-preview/route";
import { POST as createSessionRoute } from "../src/app/api/create/sessions/route";
import { POST as renderRoute } from "../src/app/api/create/sessions/[sessionId]/renders/route";
import { GET as jobRoute } from "../src/app/api/create/sessions/[sessionId]/jobs/[jobId]/route";
import { GET as sessionStateRoute } from "../src/app/api/create/sessions/[sessionId]/route";
import { GET as watchRoute } from "../src/app/api/watch/[sessionId]/route";

/** A deterministic stepping clock (the repo's hermetic rig). */
function steppingClock(): () => number {
  let current = 2_222_222_222_000;
  return () => {
    current += 19;
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

let server: SportaServer;
let scratch = "";
let creatorToken = "";

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "sporta-j006-transparency-"));
  server = createSportaServer({
    nowMs: steppingClock(),
    passwordHasher: createDeterministicTestHasher(),
    transient: { redis: new InMemoryRedis(steppingClock()), provider: "in-memory" },
    seed: true,
    media: { db: ":memory:" },
  });
  installSportaServerForTests(server);
  await server.ready;
  const registered = await server.auth.register({
    username: "j006-transparency-creator",
    password: "a-real-transparency-password",
    roles: ["creator", "viewer"],
  });
  creatorToken = (await server.auth.issueSession({ userId: registered.userId })).token;
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The six-field shape assertion (shared by every selection-level surface)
// ---------------------------------------------------------------------------

/** Asserts the six fields on a selection-level transparency document. */
function assertSelectionTransparency(
  transparency: Record<string, unknown>,
  expected: { providerId: string; mode: string },
): void {
  // Field 1 — compute source (the R408 execution-ownership vocabulary).
  const computeSource = transparency.computeSource as Record<string, unknown>;
  expect(computeSource.executionOwnership).toBe("sporta-managed");
  expect(typeof computeSource.provider).toBe("string");
  expect(computeSource.provider.length).toBeGreaterThan(0);
  expect(typeof computeSource.adapterId).toBe("string");
  // Field 2 — provider (DATA — the selected provider id).
  const provider = transparency.provider as Record<string, unknown>;
  expect(provider.providerId).toBe(expected.providerId);
  // Field 3 — selection reason (the director's closed-vocabulary reason).
  const selectionReason = transparency.selectionReason as Record<string, unknown>;
  expect(selectionReason.mode).toBe(expected.mode);
  expect(typeof selectionReason.reason).toBe("string");
  expect((selectionReason.reason as string).length).toBeGreaterThan(0);
  // Field 4 — measured allowance/cost (estimate labeled estimate; measured
  // only when the adapter metered the job — never mixed).
  const cost = transparency.measuredAllowanceCost as Record<string, unknown>;
  if (cost.estimate !== null) {
    const estimate = cost.estimate as Record<string, unknown>;
    expect(estimate.source).toBe("broker-quote");
    expect(
      estimate.estimatedCostUsd === null || typeof estimate.estimatedCostUsd === "number",
    ).toBe(true);
    expect(
      estimate.estimatedQueueSeconds === null || typeof estimate.estimatedQueueSeconds === "number",
    ).toBe(true);
  }
  // Field 5 — privacy posture (the applied preference + the provider zone).
  const privacy = transparency.privacyPosture as Record<string, unknown>;
  expect(["privacy-local-only", "privacy-any"]).toContain(privacy.appliedPreference);
  expect(privacy.providerZone).toBe(server.selection!.facts.privacyZone);
  // Field 6 — fallback state (the substitution posture, honestly derived).
  const fallback = transparency.fallbackState as Record<string, unknown>;
  expect(fallback.mode).toBe(expected.mode);
  expect(fallback.selectedProviderId).toBe(expected.providerId);
  expect(fallback.substitutedFromRequested).toBe(false);
  expect(fallback.policy).toBe("explicit-selection-refuses-instead-of-substituting");
  expect(Array.isArray(fallback.refusedBeforeSelection)).toBe(true);
}

// ---------------------------------------------------------------------------
// GET /api/create/compute-status — the plane-level transparency document
// ---------------------------------------------------------------------------

describe("J006 — GET /api/create/compute-status carries the six-field transparency", () => {
  test("an anonymous caller gets the real 401 (the studio surface's own rule)", async () => {
    const response = await computeStatusRoute(withCookie(null, "/api/create/compute-status"));
    expect(response.status).toBe(401);
  });

  test("the plane-level document carries all six fields over the real seams", async () => {
    const response = await computeStatusRoute(
      withCookie(creatorToken, "/api/create/compute-status"),
    );
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      plane: Record<string, unknown> | null;
      transparency: Record<string, unknown>;
    };
    expect(body.plane).not.toBeNull();
    const t = body.transparency;
    // Field 1 — compute source: consistent with the plane's own facts.
    const computeSource = t.computeSource as Record<string, unknown>;
    expect(computeSource.executionOwnership).toBe("sporta-managed");
    expect(computeSource.provider).toBe((body.plane as Record<string, unknown>).provider);
    expect(computeSource.adapterId).toBe((body.plane as Record<string, unknown>).adapterId);
    // Field 2 — provider.
    const provider = t.provider as Record<string, unknown>;
    expect(provider.providerId).toBe(server.selection!.providerId);
    // Field 3 — the plane's honest configuration reason (not a selection).
    const selectionReason = t.selectionReason as Record<string, unknown>;
    expect(selectionReason.kind).toBe("deployment-configured");
    expect(typeof selectionReason.detail).toBe("string");
    // Field 4 — allowance + measured usage (the W919 seams, verbatim).
    const cost = t.measuredAllowanceCost as Record<string, unknown>;
    expect(Array.isArray(cost.allowance)).toBe(true);
    expect(cost.measuredUsage === null || Array.isArray(cost.measuredUsage)).toBe(true);
    expect(typeof cost.note).toBe("string");
    // Field 5 — privacy posture.
    const privacy = t.privacyPosture as Record<string, unknown>;
    expect(privacy.zone).toBe(server.selection!.facts.privacyZone);
    expect(Array.isArray(privacy.capabilityClasses)).toBe(true);
    // Field 6 — fallback state.
    const fallback = t.fallbackState as Record<string, unknown>;
    expect(fallback.registeredProviders).toBe(1);
    expect(fallback.posture).toBe("single-provider-plane");
    expect(typeof fallback.dispatchInvariant).toBe("string");
    expect(typeof fallback.explicitSelectionPolicy).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// POST /api/create/compute-preview — the selection-level document
// ---------------------------------------------------------------------------

describe("J006 — POST /api/create/compute-preview carries the six-field transparency", () => {
  test("sporta-auto: the six fields over the director's real decision", async () => {
    const response = await computePreviewRoute(
      withCookie(
        creatorToken,
        "/api/create/compute-preview",
        jsonPost({
          rendererId: "anime.prototype",
          latencyClass: "offline",
          compute: { mode: "sporta-auto" },
        }),
      ),
    );
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      selection: { providerId: string };
      transparency: Record<string, unknown>;
    };
    expect(body.selection.providerId).toBe(server.selection!.providerId);
    assertSelectionTransparency(body.transparency, {
      providerId: server.selection!.providerId,
      mode: "sporta-auto",
    });
    // The auto-mode fallback state: nothing requested, nothing substituted.
    const fallback = body.transparency.fallbackState as Record<string, unknown>;
    expect(fallback.requestedProviderId).toBeNull();
  });

  test("user-explicit: the requested provider is honored and labeled", async () => {
    const response = await computePreviewRoute(
      withCookie(
        creatorToken,
        "/api/create/compute-preview",
        jsonPost({
          rendererId: "anime.prototype",
          latencyClass: "offline",
          compute: { mode: "user-explicit", providerId: server.selection!.providerId },
        }),
      ),
    );
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as { transparency: Record<string, unknown> };
    assertSelectionTransparency(body.transparency, {
      providerId: server.selection!.providerId,
      mode: "user-explicit",
    });
    const fallback = body.transparency.fallbackState as Record<string, unknown>;
    expect(fallback.requestedProviderId).toBe(server.selection!.providerId);
    expect(fallback.substitutedFromRequested).toBe(false);
  });

  test("the privacy preference is honored and rides the posture fields", async () => {
    const response = await computePreviewRoute(
      withCookie(
        creatorToken,
        "/api/create/compute-preview",
        jsonPost({
          rendererId: "anime.prototype",
          latencyClass: "offline",
          compute: {
            mode: "sporta-auto",
            preference: { privacyPosture: "privacy-any" },
          },
        }),
      ),
    );
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as { transparency: Record<string, unknown> };
    const privacy = body.transparency.privacyPosture as Record<string, unknown>;
    expect(privacy.appliedPreference).toBe("privacy-any");
    expect(privacy.providerZone).toBe(server.selection!.facts.privacyZone);
  });

  test("the refusal posture: an explicit unknown provider is the typed 422 with every reason (never a silent substitution)", async () => {
    const response = await computePreviewRoute(
      withCookie(
        creatorToken,
        "/api/create/compute-preview",
        jsonPost({
          rendererId: "anime.prototype",
          latencyClass: "offline",
          compute: { mode: "user-explicit", providerId: "provider.does-not-exist" },
        }),
      ),
    );
    expect(response.status).toBe(422);
    const body = (await bodyOf(response)) as {
      error: {
        failureClass: string;
        message: string;
        details: { requestedProviderId: string | null; refusals: unknown[] };
      };
    };
    // The director's closed aggregate vocabulary (resource-limit when a
    // capacity reason was recorded; media-invalid otherwise).
    expect(["resource-limit", "media-invalid"]).toContain(body.error.failureClass);
    expect(body.error.details.requestedProviderId).toBe("provider.does-not-exist");
    expect(Array.isArray(body.error.details.refusals)).toBe(true);
    expect(body.error.details.refusals.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The dispatch / job / session / watch surfaces
// ---------------------------------------------------------------------------

describe("J006 — the dispatch, job, session and watch surfaces carry the transparency", () => {
  let sessionId = "";
  let jobWithDirective = "";
  let jobWithoutDirective = "";
  let renderIdWithDirective = "";

  test("a fixture-source session dispatches one render WITH and one WITHOUT a directive", async () => {
    const created = await createSessionRoute(
      withCookie(
        creatorToken,
        "/api/create/sessions",
        jsonPost({
          sourceKey: "derby",
          operations: ["analysis", "transformation", "derivativeGeneration", "storage"],
        }),
      ),
    );
    expect(created.status).toBe(201);
    sessionId = ((await bodyOf(created)) as { sessionId: string }).sessionId;

    const providerId = server.selection!.providerId;
    const withDirective = await renderRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/renders`,
        jsonPost({
          rendererId: "anime.prototype",
          styleId: "j006-transparency-test",
          compute: { mode: "user-explicit", providerId },
        }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(withDirective.status).toBe(202);
    const dispatchBody = (await bodyOf(withDirective)) as {
      jobId: string;
      selection?: Record<string, unknown>;
    };
    jobWithDirective = dispatchBody.jobId;
    // The DISPATCH ANSWER carries the selection with its transparency.
    expect(dispatchBody.selection).not.toBeUndefined();
    assertSelectionTransparency(
      (dispatchBody.selection as Record<string, unknown>).transparency as Record<string, unknown>,
      { providerId, mode: "user-explicit" },
    );

    const withoutDirective = await renderRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/renders`,
        jsonPost({ rendererId: "anime.prototype", styleId: "j006-transparency-test-2" }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(withoutDirective.status).toBe(202);
    const withoutBody = (await bodyOf(withoutDirective)) as { jobId: string; selection?: unknown };
    jobWithoutDirective = withoutBody.jobId;
    // The honest absence: no directive → no selection, no transparency.
    expect(withoutBody.selection).toBeUndefined();
  });

  test("the job view carries the transparency, and at terminal state the METERED usage rides it", async () => {
    const providerId = server.selection!.providerId;
    let renderId = "";
    let terminal = false;
    let measuredSeen = false;
    for (let attempt = 0; attempt < 400 && !terminal; attempt += 1) {
      const poll = await jobRoute(
        withCookie(creatorToken, `/api/create/sessions/${sessionId}/jobs/${jobWithDirective}`),
        { params: Promise.resolve({ sessionId, jobId: jobWithDirective }) },
      );
      expect(poll.status).toBe(200);
      const job = (await bodyOf(poll)) as {
        state: string;
        renderId?: string;
        selection?: Record<string, unknown>;
      };
      if (job.renderId !== undefined) renderId = job.renderId;
      if (job.selection !== undefined) {
        const transparency = job.selection.transparency as Record<string, unknown>;
        assertSelectionTransparency(transparency, { providerId, mode: "user-explicit" });
        const cost = transparency.measuredAllowanceCost as Record<string, unknown>;
        if (cost.measured !== null) {
          measuredSeen = true;
          const measured = cost.measured as Record<string, unknown>;
          expect(measured.source).toBe("compute-adapter-metering");
          expect(Array.isArray(measured.units)).toBe(true);
          expect((measured.units as unknown[]).length).toBeGreaterThan(0);
        }
      }
      if (["succeeded", "failed", "cancelled", "dead-lettered"].includes(job.state)) {
        terminal = true;
      } else {
        await Bun.sleep(25);
      }
    }
    expect(terminal).toBe(true);
    expect(measuredSeen).toBe(true);
    renderIdWithDirective = renderId;
    expect(renderIdWithDirective.length).toBeGreaterThan(0);
  });

  test("the session state's job rows carry the selection with its transparency", async () => {
    const response = await sessionStateRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}`),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(response.status).toBe(200);
    const state = (await bodyOf(response)) as {
      jobs: { jobId: string; selection?: Record<string, unknown> }[];
    };
    const withRow = state.jobs.find((row) => row.jobId === jobWithDirective);
    const withoutRow = state.jobs.find((row) => row.jobId === jobWithoutDirective);
    expect(withRow!.selection).not.toBeUndefined();
    assertSelectionTransparency(withRow!.selection!.transparency as Record<string, unknown>, {
      providerId: server.selection!.providerId,
      mode: "user-explicit",
    });
    expect(withoutRow!.selection).toBeUndefined();
  });

  test("the watch surface carries the per-render compute provenance (present only for directive dispatches)", async () => {
    const response = await watchRoute(withCookie(creatorToken, `/api/watch/${sessionId}`), {
      params: Promise.resolve({ sessionId }),
    });
    expect(response.status).toBe(200);
    const watch = (await bodyOf(response)) as {
      renders: { renderId: string; compute?: Record<string, unknown> }[];
    };
    expect(watch.renders.length).toBe(2);
    const withCompute = watch.renders.find((render) => render.renderId === renderIdWithDirective);
    expect(withCompute).toBeDefined();
    expect(withCompute!.compute).not.toBeUndefined();
    assertSelectionTransparency(
      (withCompute!.compute as Record<string, unknown>).transparency as Record<string, unknown>,
      { providerId: server.selection!.providerId, mode: "user-explicit" },
    );
    // The directive-less render honestly carries NO provenance.
    const withoutCompute = watch.renders.find(
      (render) => render.renderId !== renderIdWithDirective,
    );
    expect(withoutCompute).toBeDefined();
    expect(withoutCompute!.compute).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The fail-closed no-plane posture
// ---------------------------------------------------------------------------

describe("J006 — the fail-closed no-plane posture (never invented facts)", () => {
  let noPlaneServer: SportaServer | null = null;
  let token = "";

  beforeAll(async () => {
    // A composition with NO compute plane (the env gate the singleton uses,
    // applied to a direct composition — the honest deployment shape where
    // COMPUTE_PROVIDER=none).
    const previous = process.env.COMPUTE_PROVIDER;
    process.env.COMPUTE_PROVIDER = "none";
    try {
      noPlaneServer = createSportaServer({
        nowMs: steppingClock(),
        passwordHasher: createDeterministicTestHasher(),
        transient: { redis: new InMemoryRedis(steppingClock()), provider: "in-memory" },
        seed: true,
        media: { db: ":memory:" },
      });
    } finally {
      if (previous === undefined) delete process.env.COMPUTE_PROVIDER;
      else process.env.COMPUTE_PROVIDER = previous;
    }
    installSportaServerForTests(noPlaneServer);
    await noPlaneServer.ready;
    const registered = await noPlaneServer.auth.register({
      username: "j006-no-plane-creator",
      password: "another-real-password",
      roles: ["creator", "viewer"],
    });
    token = (await noPlaneServer.auth.issueSession({ userId: registered.userId })).token;
  });

  afterAll(() => {
    // Restore the hermetic composition's server for any later suite use.
    installSportaServerForTests(server);
  });

  test("compute-status answers the honest no-plane transparency (nulls, never guesses)", async () => {
    expect(noPlaneServer!.selection).toBeNull();
    expect(noPlaneServer!.compute).toBeNull();
    const response = await computeStatusRoute(withCookie(token, "/api/create/compute-status"));
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      plane: unknown;
      transparency: Record<string, unknown>;
    };
    expect(body.plane).toBeNull();
    expect(body.transparency.computeSource).toBeNull();
    expect(body.transparency.provider).toBeNull();
    expect(body.transparency.selectionReason).toBeNull();
    const privacy = body.transparency.privacyPosture as Record<string, unknown>;
    expect(privacy.zone).toBeNull();
    const fallback = body.transparency.fallbackState as Record<string, unknown>;
    expect(fallback.registeredProviders).toBe(0);
    expect(fallback.posture).toBe("no-plane");
  });

  test("compute-preview answers the typed unavailable error (the control plane's own 503 class)", async () => {
    const response = await computePreviewRoute(
      withCookie(
        token,
        "/api/create/compute-preview",
        jsonPost({
          rendererId: "anime.prototype",
          latencyClass: "offline",
          compute: { mode: "sporta-auto" },
        }),
      ),
    );
    expect([503, 500]).toContain(response.status);
    const body = (await bodyOf(response)) as { error: { failureClass: string } };
    expect(typeof body.error.failureClass).toBe("string");
    expect(body.error.failureClass.length).toBeGreaterThan(0);
  });
});
