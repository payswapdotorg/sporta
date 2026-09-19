/**
 * THE COMPUTE/COST UX TESTS (R506) — the product's legibility surfaces over
 * the REAL composition:
 *
 * - GET /api/create/compute-status: the plane's ownership (the R408
 *   execution-ownership vocabulary from the operator's declared facts), the
 *   caller's daily allowance states (the W919 quotas), and the metered
 *   usage totals (null = not measured — never a fabricated 0);
 * - the per-job compute provenance: a dispatch WITH a directive carries the
 *   SelectionDirector's explanation VERBATIM into the job state and the
 *   session state's job rows; a dispatch WITHOUT one carries nothing (the
 *   honest absence, never an invented selection);
 * - the watch surface's provenance source: the session state's job rows are
 *   what the watch page reads (owner-scoped; a non-owner sees none).
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
import { GET as sessionStateRoute } from "../src/app/api/create/sessions/[sessionId]/route";
import { POST as createSessionRoute } from "../src/app/api/create/sessions/route";
import { POST as renderRoute } from "../src/app/api/create/sessions/[sessionId]/renders/route";
import { GET as jobRoute } from "../src/app/api/create/sessions/[sessionId]/jobs/[jobId]/route";

/** A deterministic stepping clock (the repo's hermetic rig). */
function steppingClock(): () => number {
  let current = 2_111_111_111_000;
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

let server: SportaServer;
let scratch = "";
let creatorToken = "";
let outsiderToken = "";

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "sporta-compute-status-"));
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
    username: "compute-status-creator",
    password: "a-real-compute-password",
    roles: ["creator", "viewer"],
  });
  creatorToken = (await server.auth.issueSession({ userId: registered.userId })).token;
  const outsider = await server.auth.register({
    username: "compute-status-outsider",
    password: "another-real-password",
    roles: ["viewer"],
  });
  outsiderToken = (await server.auth.issueSession({ userId: outsider.userId })).token;
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("GET /api/create/compute-status (R506)", () => {
  test("an anonymous caller gets the real 401 (the studio surface's own rule)", async () => {
    const response = await computeStatusRoute(withCookie(null, "/api/create/compute-status"));
    expect(response.status).toBe(401);
  });

  test("answers the plane's ownership, the caller's allowances, and honest usage totals", async () => {
    const response = await computeStatusRoute(
      withCookie(creatorToken, "/api/create/compute-status"),
    );
    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      plane: {
        provider: string;
        adapterId: string;
        providerId: string;
        executionOwnership: string;
        facts: { privacyZone: string; capabilityClasses: string[] };
      } | null;
      quotas: { quotaId: string; used: number | null; limit: number | null; exhausted: boolean; reasonCode: string }[];
      usage: { unitId: string; quantity: number }[] | null;
    };
    // The plane is the composition's own DATA (the in-process adapter the
    // selection seam registered) — never a vendor name.
    expect(server.selection).not.toBeNull();
    expect(body.plane).not.toBeNull();
    expect(body.plane!.providerId).toBe(server.selection!.providerId);
    expect(body.plane!.executionOwnership).toBe("sporta-managed");
    expect(body.plane!.facts.privacyZone).toBe("sporta-managed");
    // The allowance states: the W919 per-user daily quotas, real numbers.
    expect(body.quotas.length).toBeGreaterThan(0);
    for (const quota of body.quotas) {
      expect(quota.used).not.toBeNull();
      expect(quota.limit).not.toBeNull();
      expect(quota.reasonCode).toBe("ok");
    }
    // The metered usage totals: real numbers once the adapter metered any
    // job (null only when nothing was measured — never a fabricated 0).
    expect(body.usage === null || Array.isArray(body.usage)).toBe(true);
  });
});

describe("the per-job compute provenance (R506 — the selection carried verbatim)", () => {
  let sessionId = "";
  let jobWithDirective = "";
  let jobWithoutDirective = "";

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

    const providerId = server.selection?.providerId ?? "";
    expect(providerId.length).toBeGreaterThan(0);

    const withDirective = await renderRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/renders`,
        jsonPost({
          rendererId: "anime.prototype",
          styleId: "compute-status-test",
          compute: { mode: "user-explicit", providerId },
        }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(withDirective.status).toBe(202);
    jobWithDirective = ((await bodyOf(withDirective)) as { jobId: string }).jobId;

    const withoutDirective = await renderRoute(
      withCookie(
        creatorToken,
        `/api/create/sessions/${sessionId}/renders`,
        jsonPost({ rendererId: "anime.prototype", styleId: "compute-status-test-2" }),
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(withoutDirective.status).toBe(202);
    jobWithoutDirective = ((await bodyOf(withoutDirective)) as { jobId: string }).jobId;
    expect(jobWithDirective).not.toBe(jobWithoutDirective);
  });

  test("the job state carries the selection VERBATIM when the dispatch carried one", async () => {
    const response = await jobRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}/jobs/${jobWithDirective}`),
      { params: Promise.resolve({ sessionId, jobId: jobWithDirective }) },
    );
    expect(response.status).toBe(200);
    const job = (await bodyOf(response)) as {
      selection?: {
        providerId: string;
        mode: string;
        explanation: { selectedProviderId: string; selectionReason: string; considered: { providerId: string }[] };
      };
    };
    expect(job.selection).not.toBeUndefined();
    expect(job.selection!.providerId).toBe(server.selection!.providerId);
    expect(job.selection!.mode).toBe("user-explicit"); // the user-choice vs auto mode, visible
    expect(job.selection!.explanation.selectedProviderId).toBe(server.selection!.providerId);
    expect(job.selection!.explanation.selectionReason.length).toBeGreaterThan(0);
    expect(job.selection!.explanation.considered.length).toBeGreaterThan(0);
  });

  test("the job state carries NO selection when the dispatch carried no directive (the honest absence)", async () => {
    const response = await jobRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}/jobs/${jobWithoutDirective}`),
      { params: Promise.resolve({ sessionId, jobId: jobWithoutDirective }) },
    );
    expect(response.status).toBe(200);
    const job = (await bodyOf(response)) as { selection?: unknown };
    expect(job.selection).toBeUndefined();
  });

  test("the session state's job rows carry the selection (the watch surface's provenance source)", async () => {
    const response = await sessionStateRoute(
      withCookie(creatorToken, `/api/create/sessions/${sessionId}`),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(response.status).toBe(200);
    const state = (await bodyOf(response)) as {
      jobs: {
        jobId: string;
        state: string;
        rendererId: string | null;
        selection?: { providerId: string; mode: string };
      }[];
    };
    expect(state.jobs.length).toBe(2);
    const withRow = state.jobs.find((row) => row.jobId === jobWithDirective);
    const withoutRow = state.jobs.find((row) => row.jobId === jobWithoutDirective);
    expect(withRow!.rendererId).toBe("anime.prototype");
    expect(withRow!.selection).not.toBeUndefined();
    expect(withRow!.selection!.providerId).toBe(server.selection!.providerId);
    expect(withRow!.selection!.mode).toBe("user-explicit");
    expect(withoutRow!.selection).toBeUndefined();
  });

  test("the session state is owner-scoped — a non-owner sees nothing (the honest viewer boundary)", async () => {
    const response = await sessionStateRoute(
      withCookie(outsiderToken, `/api/create/sessions/${sessionId}`),
      { params: Promise.resolve({ sessionId }) },
    );
    expect([403, 404]).toContain(response.status);
  });
});
